/**
 * RM-058, fatia N4 (D1 a D4 da ork-rm058n4): os checkpoints da supervisão do arco.
 *
 * O histórico da supervisão mora num log append-only próprio, `.orkastery/noctum/arcos/<arco>/supervisao.jsonl`, na raiz
 * do estado, ao lado do log do arco (N1 e N2) e com as mesmas garantias: cada linha leva o sha256 da anterior e um MAC de
 * subchave derivada da chave local do núcleo, num domínio próprio (a chave do log do arco não serve aqui, nem o
 * contrário). O limite também é o mesmo: a chave local é legível por qualquer processo com o mesmo usuário do sistema, que
 * pode escrever linha nova ou truncar o log, como no ledger.
 *
 * O log do arco não ganha linha da supervisão (D1): a supervisão nunca autoriza, renova nem emenda o envelope, e a
 * contabilidade da reserva continua no `concluirDespacho`. Aqui ficam as gerações de quem conduz, as batidas, os tiques do
 * vigia, as retomadas autorizadas, as sessões paradas, as contas que o arco tirou da seleção, os trabalhos isolados, as
 * recusas de ambiente, a parada, os efeitos de resultado incerto e os pedidos da fila de rate limit já tratados.
 *
 * Os parâmetros (cadência, carências, prazos e tetos) são gravados uma vez, na primeira linha (D2), e relidos dali: um
 * processo novo, um manifesto mudado ou outra conta não mudam as regras de um arco que já começou, nem zeram nada. Nada
 * fica em memória: toda leitura relê o disco.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { kernelDisponivel, tentarTravaExclusiva } from './fila-pesada';
import { chaveLocal } from './hitl-local-receipt';
import { formatarDataHora } from './horario';
import { lerLedger } from './ledger';
import { ManifestoCarregado } from './manifest';
import { EstadoDoArco } from './noctum-arco';
import { MotivoDaCapacidade } from './noctum-capacidade';
import { Capacidade, ConteudoDoEnvelope, ID_DO_ARCO, MotivoDeRecusaDoArco, shaDoPedido, Trabalho } from './noctum-envelope';
import { CADENCIA_MS } from './noctum-fila';
import { CARENCIA_DO_TURNO_ENCERRADO_MIN } from './ocupacao';
import { StoreDePerfis } from './runtime-profiles';
import { alvosDaOrdemDeFallback, ConfigDeBlocoComFallback, configDoBloco, lerSetup } from './setup';
import { dirThread, lerThread, listarIds } from './thread';
import { EventoLedger, Fase, FASES, Thread } from './types';

export const CONTRATO_SUPERVISAO = 'ork.noctum-supervisao/v1' as const;

/** D1: tipo fechado próprio, fora do `MotivoGate` e do `MotivoDeRecusaDoArco`. */
export const MOTIVOS_DA_SUPERVISAO = [
  'noctum.supervisao.adulterada', 'noctum.supervisao.invalida', 'noctum.supervisao.ocupada', 'noctum.supervisao.sem-kernel',
] as const;
export type MotivoDaSupervisao = typeof MOTIVOS_DA_SUPERVISAO[number];

export class RecusaDaSupervisao extends Error {
  constructor(readonly motivo: MotivoDaSupervisao, detalhe: string) {
    super(`${motivo}: ${detalhe}`);
    this.name = 'RecusaDaSupervisao';
  }
}

/** D2: os parâmetros do arco, gravados na primeira linha do log e relidos dali. */
export interface ParametrosDaSupervisao {
  /** A cadência do vigia (D3 do dono): o tique e a batida do condutor. */
  cadenciaMs: number;
  /** A carência do turno encerrado, a mesma que solta a vaga do `phase run`. */
  carenciaMs: number;
  /** Sem tique do vigia por mais que isto, o condutor não despacha nada novo. */
  vigiaAusenteMs: number;
  /** Tiques do vigia interrompidos em série que param o arco. */
  interrupcoesQueParam: number;
  /** Sessão sem nenhuma atividade depois do despacho por mais que isto não começou o turno. */
  primeiroTurnoMs: number;
  /** Sessão sem evento de produto por mais que isto está presa. */
  semAvancoMs: number;
  /** Retomadas autorizadas por trabalho e fase antes de isolar. */
  tetoDeRetomadas: number;
  /** Retomadas por sessão que não começou o turno antes de isolar (a causa costuma ser de ambiente). */
  retomadasSemPrimeiroTurno: number;
  /** Recusas de ambiente seguidas que param o arco. */
  recusasDeAmbienteQueParam: number;
  /** Quanto a reserva de lançamento incerto espera prova antes de isolar o trabalho. */
  carenciaDaReservaMs: number;
  /** Leituras do remoto de um efeito incerto antes de isolar. */
  leiturasDoEfeito: number;
  /**
   * A ausência na listagem do runtime só prova o fim de uma sessão despachada há pelo menos isto antes da leitura: a sessão
   * que acabou de nascer pode ainda não aparecer.
   */
  ausenciaMinimaMs: number;
}

/** Os valores de partida; o teto de retomadas vem do `retry.max_tentativas` do manifesto no instante da gravação. */
export function parametrosPadrao(manifesto: ManifestoCarregado['manifesto']): ParametrosDaSupervisao {
  return {
    cadenciaMs: CADENCIA_MS,
    carenciaMs: CARENCIA_DO_TURNO_ENCERRADO_MIN * 60_000,
    vigiaAusenteMs: 3 * CADENCIA_MS,
    interrupcoesQueParam: 3,
    primeiroTurnoMs: 15 * 60_000,
    semAvancoMs: 90 * 60_000,
    tetoDeRetomadas: Math.max(1, manifesto.retry.max_tentativas),
    retomadasSemPrimeiroTurno: 1,
    recusasDeAmbienteQueParam: 2,
    carenciaDaReservaMs: CARENCIA_DO_TURNO_ENCERRADO_MIN * 60_000,
    leiturasDoEfeito: 2,
    ausenciaMinimaMs: CADENCIA_MS,
  };
}

export type Papel = 'condutor' | 'vigia';

/** Quem escreve: o papel, a instância (um uuid por processo), o pid e a máquina. */
export interface Instancia { papel: Papel; instancia: string; pid: number; maquina: string }

/** Razões fechadas pelas quais o passo do arco espera, preservadas no log sem texto livre. */
export type MotivoDoPassoEmEspera = MotivoDaCapacidade | MotivoDeRecusaDoArco
  | 'em-curso' | 'bloqueada' | 'fonte-indisponivel' | 'agendado' | 'sem-autorizacao'
  | 'sem-trava-do-kernel' | 'despacho-em-curso' | 'capacidade' | 'baseline-pendente' | 'baseline-gravada'
  | 'vigia-ausente';

/** Quem ocupa a vaga, sem id de sessão, conta, thread, máquina, caminho ou outro dado privado. */
export interface OcupanteDaEspera {
  origem: 'conducao' | 'despacho' | 'runtime';
  runtime: string | null;
  revisao: boolean;
}

export interface EsperaDoPasso {
  motivo: MotivoDoPassoEmEspera;
  desde: string;
  papel: Papel;
  ocupantes: OcupanteDaEspera[];
}

/** A recusa corrente do passo. O detalhe já nasce sem texto do adaptador, conta, sessão ou caminho local. */
export interface RecusaDoPasso {
  trabalho: string;
  motivo: string;
  detalhe: string;
  desde: string;
  papel: Papel;
}

export type MotivoDaRetomada = 'sessao-morta' | 'fim-de-turno-sem-resultado' | 'sem-avanco' | 'sem-primeiro-turno' | 'despacho-falho' |
  'limite-de-uso' | 'ordem-cancelada';
/** As contas que o arco tira da seleção (D13). Subteto, perfil ausente e desativado são relidos a cada passo, sem linha. */
export type MotivoDaConta = 'cota' | 'cota-sem-reset' | 'limite-de-uso' | 'auth';
export type MotivoDoIsolamento = 'reserva-incerta' | 'retomadas-esgotadas' | 'sem-primeiro-turno' | 'sessao-presa' | 'condutor-externo' |
  'sessao-fora-do-registro' | 'efeito-divergente' | 'efeito-sem-leitura' | 'efeito-esgotado' | 'erro-repetido' | 'recusas-repetidas' |
  'baseline-falhou';
export type MotivoDaParada = 'supervisor-falhou' | 'teto-do-arco' | 'violacao-de-custo' | 'ambiente-do-despacho';
export type DesfechoDoEfeito = 'confirmado' | 'ausente' | 'divergente' | 'sem-leitura';

/** O efeito externo de resultado incerto (D18). A N4 só conhece o push; a entrega que o chama é da N5. */
export interface EfeitoIncerto {
  acao: 'push';
  repositorio: string;
  /** O remoto que o `git ls-remote` lê: nome do remoto na worktree ou endereço. */
  remoto: string;
  branch: string;
  sha: string;
  trabalho: string;
  thread: string | null;
  detalhe: string;
}

export type EventoDaSupervisao =
  | { tipo: 'parametros'; parametros: ParametrosDaSupervisao }
  | { tipo: 'conducao_assumida'; geracao: number; quem: Instancia; prova: string }
  | { tipo: 'batida'; quem: Instancia; geracao: number | null }
  | { tipo: 'passo_em_espera'; papel: Papel; motivo: MotivoDoPassoEmEspera; ocupantes: OcupanteDaEspera[] }
  | { tipo: 'passo_recusado'; papel: Papel; trabalho: string; motivo: string; detalhe: string }
  | { tipo: 'passo_retomado'; papel: Papel }
  | { tipo: 'tique_iniciado'; quem: Instancia }
  | { tipo: 'tique_concluido'; quem: Instancia; resumo: string }
  | { tipo: 'vigia_interrompido'; interrompido: string; prova: string }
  | { tipo: 'retomada_autorizada'; trabalho: string; thread: string; fase: Fase; tentativa: number; motivo: MotivoDaRetomada;
    sessao: string | null; prova: string;
    /** NA1 da rodada 2: o último `seq` de reserva do arco quando a autorização foi gravada; só reserva de `seq` maior a atende. */
    aposReserva?: number }
  | { tipo: 'sessao_parada'; trabalho: string; thread: string; sessionId: string; motivo: MotivoDaRetomada; confirmada: boolean; prova: string }
  | { tipo: 'conta_fora'; conta: string; runtime: string; motivo: MotivoDaConta; ate: string | null; prova: string }
  | { tipo: 'isolado'; trabalho: string; thread: string | null; motivo: MotivoDoIsolamento; detalhe: string }
  | { tipo: 'recusa_de_ambiente'; trabalho: string; thread: string | null; detalhe: string }
  | { tipo: 'parada'; motivo: MotivoDaParada; detalhe: string }
  | { tipo: 'efeito_incerto'; id: string; efeito: EfeitoIncerto }
  | { tipo: 'efeito_reconciliado'; id: string; desfecho: DesfechoDoEfeito; prova: string }
  | { tipo: 'pedido_tratado'; pedido: string; thread: string; acao: 'retomada-autorizada' | 'cancelado'; motivo: string };

const TIPOS: readonly EventoDaSupervisao['tipo'][] = ['parametros', 'conducao_assumida', 'batida', 'passo_em_espera', 'passo_recusado', 'passo_retomado',
  'tique_iniciado', 'tique_concluido',
  'vigia_interrompido', 'retomada_autorizada', 'sessao_parada', 'conta_fora', 'isolado', 'recusa_de_ambiente', 'parada',
  'efeito_incerto', 'efeito_reconciliado', 'pedido_tratado'];

interface DadosDaLinha {
  contrato: typeof CONTRATO_SUPERVISAO;
  arco: string;
  seq: number;
  /** sha256 do texto da linha anterior; a primeira aponta para zeros. */
  anterior: string;
  em: string;
  evento: EventoDaSupervisao;
}

export interface RetomadaAutorizada {
  trabalho: string; thread: string; fase: Fase; tentativa: number; motivo: MotivoDaRetomada; sessao: string | null; prova: string; em: string;
  /** O último `seq` de reserva do arco na autorização; `null` na linha que não o traz (aí vale o instante). */
  aposReserva: number | null;
}
export interface ContaFora { conta: string; runtime: string; motivo: MotivoDaConta; ate: string | null; prova: string; em: string }
export interface Isolamento { trabalho: string; thread: string | null; motivo: MotivoDoIsolamento; detalhe: string; em: string }
export interface EfeitoRegistrado {
  id: string; efeito: EfeitoIncerto; registradoEm: string; desfechos: Array<{ desfecho: DesfechoDoEfeito; prova: string; em: string }>;
}

/** O estado da supervisão, derivado do log a cada leitura. */
export interface EstadoDaSupervisao {
  contrato: typeof CONTRATO_SUPERVISAO;
  arco: string;
  linhas: number;
  parametros: ParametrosDaSupervisao | null;
  /** A geração vigente: quem conduz o arco nesta máquina desde quando, e por qual prova. */
  geracao: { numero: number; quem: Instancia; desde: string; prova: string } | null;
  batidas: { condutor: { em: string; quem: Instancia } | null; vigia: { em: string; quem: Instancia } | null };
  /** A espera atual do passo; `desde` é a primeira observação deste motivo. */
  espera: EsperaDoPasso | null;
  /** A recusa atual; `desde` é a primeira observação deste motivo, sem repetir a cada cadência. */
  recusaDoPasso: RecusaDoPasso | null;
  /** O último tique do vigia que começou e não terminou, quando há. */
  tiqueAberto: { quem: Instancia; em: string } | null;
  /** Tiques interrompidos registrados desde o último tique concluído. */
  interrupcoesSeguidas: number;
  retomadas: RetomadaAutorizada[];
  /** As paradas que o vigia pediu ao runtime, confirmadas ou não. */
  sessoesParadas: Array<{ trabalho: string; thread: string; sessionId: string; motivo: MotivoDaRetomada; confirmada: boolean; prova: string; em: string }>;
  /** A última decisão do arco sobre cada conta. */
  contasFora: Map<string, ContaFora>;
  isolados: Map<string, Isolamento>;
  recusasDeAmbiente: Array<{ trabalho: string; thread: string | null; detalhe: string; em: string }>;
  parada: { motivo: MotivoDaParada; detalhe: string; em: string } | null;
  efeitos: Map<string, EfeitoRegistrado>;
  pedidos: Map<string, { thread: string; acao: 'retomada-autorizada' | 'cancelado'; motivo: string; em: string }>;
}

const ZERO = '0'.repeat(64);
const ARQUIVO = 'supervisao.jsonl';
const TRAVA = 'supervisao.lock';
/** A trava do log é curta: quem grava lê, confere e anexa algumas linhas. */
const ESPERA_DA_TRAVA_MS = 10_000;
const PAUSA_MS = 50;
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const adulterado = (detalhe: string) => new RecusaDaSupervisao('noctum.supervisao.adulterada', `${detalhe}; a supervisão do arco exige inspeção`);
const dormir = (ms: number) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.ceil(ms)); };

/** O diretório do arco na raiz do estado; a supervisão nunca o cria (o arco nasce da proposta da N1). */
export function dirDaSupervisao(raiz: string, arco: string): string {
  if (typeof arco !== 'string' || !ID_DO_ARCO.test(arco)) throw new RecusaDaSupervisao('noctum.supervisao.invalida', 'identificador de arco inválido');
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'noctum', 'arcos', arco]);
  return path.join(principal, '.orkastery', 'noctum', 'arcos', arco);
}

/** Subchave própria da supervisão: o mesmo segredo do recibo local, separado por domínio do log do arco. */
function chaveDaSupervisao(raiz: string, criar: boolean): Buffer {
  return createHmac('sha256', chaveLocal(raiz, criar)).update(CONTRATO_SUPERVISAO).digest();
}

interface LogDaSupervisao {
  linhas: DadosDaLinha[];
  ultimaLinha: string | null;
  terminaEmQuebra: boolean;
  bytesCompletos: number;
  bytesLidos: number;
}

/** Lê e confere o log inteiro; a cauda sem quebra de linha está sendo gravada e não conta. */
function lerLog(raiz: string, arco: string): LogDaSupervisao {
  const file = path.join(dirDaSupervisao(raiz, arco), ARQUIVO);
  let bruto: Buffer;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) {
        throw adulterado('log da supervisão não é arquivo privado do núcleo');
      }
      bruto = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { linhas: [], ultimaLinha: null, terminaEmQuebra: true, bytesCompletos: 0, bytesLidos: 0 };
    if (e instanceof RecusaDaSupervisao) throw e;
    throw adulterado('log da supervisão ilegível');
  }
  const fim = bruto.lastIndexOf(0x0a) + 1;
  const textos = bruto.subarray(0, fim).toString('utf8').split('\n').slice(0, -1);
  const tamanhos = { terminaEmQuebra: fim === bruto.length, bytesCompletos: fim, bytesLidos: bruto.length };
  if (!textos.length) return { linhas: [], ultimaLinha: null, ...tamanhos };
  let chave: Buffer;
  try { chave = chaveDaSupervisao(raiz, false); } catch { throw adulterado('chave do núcleo ausente para conferir o log'); }
  let anterior = ZERO;
  const linhas = textos.map((texto, i) => {
    let l: unknown;
    try { l = JSON.parse(texto); } catch { throw adulterado(`linha ${i + 1} não é JSON`); }
    if (!objeto(l) || Object.keys(l).sort().join(',') !== 'dados,mac' || typeof l.mac !== 'string' || !/^[a-f0-9]{64}$/.test(l.mac)) {
      throw adulterado(`linha ${i + 1} fora do formato`);
    }
    const esperado = createHmac('sha256', chave).update(JSON.stringify(l.dados)).digest();
    if (!timingSafeEqual(Buffer.from(l.mac, 'hex'), esperado)) throw adulterado(`linha ${i + 1} com MAC que não confere`);
    const d = l.dados as DadosDaLinha;
    if (d.contrato !== CONTRATO_SUPERVISAO || d.arco !== arco || d.seq !== i + 1 || d.anterior !== anterior) {
      throw adulterado(`linha ${i + 1} fora da cadeia`);
    }
    if (!objeto(d.evento) || !TIPOS.includes(d.evento.tipo) || typeof d.em !== 'string' || !Number.isFinite(Date.parse(d.em))) {
      throw adulterado(`linha ${i + 1} com evento desconhecido`);
    }
    // D2: os parâmetros são a primeira linha e só ela.
    if ((d.evento.tipo === 'parametros') !== (i === 0)) throw adulterado(`linha ${i + 1}: os parâmetros são a primeira linha, e só ela`);
    anterior = sha(texto);
    return d;
  });
  return { linhas, ultimaLinha: textos.at(-1)!, ...tamanhos };
}

/**
 * Grava uma linha, sob a trava, depois de `lerLog`. A cauda sem quebra é escrita abortada e sai antes da linha nova; a
 * escrita curta volta o arquivo ao tamanho de antes e é acusada.
 */
function anexar(raiz: string, arco: string, log: LogDaSupervisao, evento: EventoDaSupervisao, quando: string): LogDaSupervisao {
  const dados: DadosDaLinha = { contrato: CONTRATO_SUPERVISAO, arco, seq: log.linhas.length + 1,
    anterior: log.ultimaLinha === null ? ZERO : sha(log.ultimaLinha), em: quando, evento };
  const texto = JSON.stringify({ dados, mac: createHmac('sha256', chaveDaSupervisao(raiz, true)).update(JSON.stringify(dados)).digest('hex') });
  const linha = Buffer.from(texto + '\n', 'utf8');
  const file = path.join(dirDaSupervisao(raiz, arco), ARQUIVO);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    if (fs.fstatSync(fd).size !== log.bytesLidos) throw adulterado('o log mudou entre a leitura e a escrita sob a trava');
    if (log.bytesLidos !== log.bytesCompletos) fs.ftruncateSync(fd, log.bytesCompletos);
    const escritos = fs.writeSync(fd, linha);
    if (escritos !== linha.length) {
      fs.ftruncateSync(fd, log.bytesCompletos);
      fs.fsyncSync(fd);
      throw adulterado(`escrita curta no log (${escritos} de ${linha.length} bytes); nada foi gravado`);
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  const bytes = log.bytesCompletos + linha.length;
  return { linhas: [...log.linhas, dados], ultimaLinha: texto, terminaEmQuebra: true, bytesCompletos: bytes, bytesLidos: bytes };
}

/** A trava do log: a do kernel, curta, com espera em passos. */
function comTrava<T>(raiz: string, arco: string, executar: () => T): T {
  if (!kernelDisponivel()) throw new RecusaDaSupervisao('noctum.supervisao.sem-kernel', 'a supervisão do arco exige /usr/bin/flock');
  const dir = dirDaSupervisao(raiz, arco);
  if (!fs.existsSync(dir)) throw new RecusaDaSupervisao('noctum.supervisao.invalida', `arco ${arco} sem proposta`);
  const prazo = Date.now() + ESPERA_DA_TRAVA_MS;
  for (;;) {
    const fd = tentarTravaExclusiva(path.join(dir, TRAVA));
    if (fd !== null) {
      try { return executar(); } finally { fs.closeSync(fd); }
    }
    if (Date.now() >= prazo) throw new RecusaDaSupervisao('noctum.supervisao.ocupada', 'outro processo segura o log da supervisão');
    dormir(Math.min(PAUSA_MS, prazo - Date.now()));
  }
}

/**
 * Grava eventos na supervisão do arco, na ordem, e devolve o estado relido do disco. Log vazio ganha antes a linha dos
 * parâmetros (D2), com os valores de partida e o teto de retomadas do manifesto de agora; depois, vale o que foi gravado.
 */
export function gravarNaSupervisao(carregado: ManifestoCarregado, arco: string, eventos: readonly EventoDaSupervisao[],
  quando = new Date().toISOString()): EstadoDaSupervisao {
  return gravarComEstado(carregado, arco, () => eventos, quando);
}

/**
 * A gravação que decide o que gravar a partir do estado lido sob a trava (a geração seguinte, o que ainda não foi
 * gravado). O que seria gravado é conferido antes, com o estado inteiro (A4 do CHECK): uma linha que tornaria o log
 * ilegível (uma geração fora de ordem, um efeito repetido) é recusada como inválida e não vai ao disco.
 */
export function gravarComEstado(carregado: ManifestoCarregado, arco: string, montar: (s: EstadoDaSupervisao) => readonly EventoDaSupervisao[],
  quando = new Date().toISOString()): EstadoDaSupervisao {
  const { raiz } = carregado;
  return comTrava(raiz, arco, () => {
    let log = lerLog(raiz, arco);
    const eventos = montar(derivar(arco, log.linhas));
    if (eventos.some(e => e.tipo === 'parametros')) throw new RecusaDaSupervisao('noctum.supervisao.invalida', 'os parâmetros só a primeira gravação escreve');
    const primeira: EventoDaSupervisao[] = log.linhas.length ? [] : [{ tipo: 'parametros', parametros: parametrosPadrao(carregado.manifesto) }];
    const novas = [...primeira, ...eventos].map((evento, i): DadosDaLinha => ({ contrato: CONTRATO_SUPERVISAO, arco,
      seq: log.linhas.length + 1 + i, anterior: '', em: quando, evento }));
    try { derivar(arco, [...log.linhas, ...novas]); }
    catch (e) {
      if (!(e instanceof RecusaDaSupervisao)) throw e;
      throw new RecusaDaSupervisao('noctum.supervisao.invalida', `a gravação deixaria o log ilegível (${e.message}); nada foi gravado`);
    }
    for (const e of [...primeira, ...eventos]) log = anexar(raiz, arco, log, e, quando);
    const relido = lerLog(raiz, arco);
    if (relido.linhas.length !== log.linhas.length || !relido.terminaEmQuebra) throw adulterado('a gravação não ficou inteira no log');
    return derivar(arco, relido.linhas);
  });
}

/**
 * D4 e A4 do CHECK: assume a condução com a geração seguinte, lida sob a trava do log (nunca de uma leitura de antes).
 * Devolve o número da geração gravada.
 */
export function assumirConducao(carregado: ManifestoCarregado, arco: string, quem: Instancia, prova: (anterior: EstadoDaSupervisao['geracao']) => string,
  quando = new Date().toISOString()): number {
  let numero = 0;
  gravarComEstado(carregado, arco, (s) => {
    numero = (s.geracao?.numero ?? 0) + 1;
    return [{ tipo: 'conducao_assumida', geracao: numero, quem, prova: prova(s.geracao) }];
  }, quando);
  return numero;
}

/** Garante a linha dos parâmetros e devolve os que valem no arco. */
export function parametrosDoArco(carregado: ManifestoCarregado, arco: string, quando = new Date().toISOString()): ParametrosDaSupervisao {
  const atual = lerSupervisao(carregado.raiz, arco);
  if (atual.parametros) return atual.parametros;
  return gravarNaSupervisao(carregado, arco, [], quando).parametros!;
}

/** O estado da supervisão, relido do disco. Arco sem log de supervisão devolve o estado vazio. */
export function lerSupervisao(raiz: string, arco: string): EstadoDaSupervisao {
  return derivar(arco, lerLog(raiz, arco).linhas);
}

/**
 * RM-058, integração (T8 da ork-rm058integra, D12): os eventos do log da supervisão, conferidos como na leitura do estado,
 * cada um com o instante dele. O aceite do piloto mede por eles a recuperação de cada falha injetada (a geração nova, a
 * retomada, o vigia interrompido), que o estado derivado guarda só pela última.
 */
export function eventosDaSupervisao(raiz: string, arco: string): Array<{ em: string; evento: EventoDaSupervisao }> {
  return lerLog(raiz, arco).linhas.map(l => ({ em: l.em, evento: l.evento }));
}

function derivar(arco: string, linhas: readonly DadosDaLinha[]): EstadoDaSupervisao {
  const s: EstadoDaSupervisao = { contrato: CONTRATO_SUPERVISAO, arco, linhas: linhas.length, parametros: null, geracao: null,
    batidas: { condutor: null, vigia: null }, espera: null, recusaDoPasso: null, tiqueAberto: null, interrupcoesSeguidas: 0, retomadas: [], sessoesParadas: [],
    contasFora: new Map(), isolados: new Map(), recusasDeAmbiente: [], parada: null, efeitos: new Map(), pedidos: new Map() };
  for (const { evento: e, em } of linhas) {
    switch (e.tipo) {
      case 'parametros': s.parametros = e.parametros; break;
      case 'conducao_assumida':
        if (e.geracao !== (s.geracao?.numero ?? 0) + 1) throw adulterado(`geração ${e.geracao} fora de ordem`);
        s.geracao = { numero: e.geracao, quem: e.quem, desde: em, prova: e.prova };
        if (e.quem.papel === 'condutor') s.batidas.condutor = { em, quem: e.quem };
        break;
      case 'batida':
        s.batidas[e.quem.papel] = { em, quem: e.quem };
        break;
      case 'passo_em_espera':
        s.espera = { motivo: e.motivo, desde: em, papel: e.papel, ocupantes: e.ocupantes };
        s.recusaDoPasso = null;
        break;
      case 'passo_recusado':
        s.espera = null;
        s.recusaDoPasso = { trabalho: e.trabalho, motivo: e.motivo, detalhe: e.detalhe, desde: em, papel: e.papel };
        break;
      case 'passo_retomado': s.espera = null; s.recusaDoPasso = null; break;
      case 'tique_iniciado':
        s.tiqueAberto = { quem: e.quem, em };
        s.batidas.vigia = { em, quem: e.quem };
        break;
      case 'tique_concluido':
        if (s.tiqueAberto?.quem.instancia === e.quem.instancia) s.tiqueAberto = null;
        s.interrupcoesSeguidas = 0;
        s.batidas.vigia = { em, quem: e.quem };
        break;
      case 'vigia_interrompido':
        if (s.tiqueAberto?.quem.instancia === e.interrompido) s.tiqueAberto = null;
        s.interrupcoesSeguidas += 1;
        break;
      case 'retomada_autorizada':
        s.retomadas.push({ trabalho: e.trabalho, thread: e.thread, fase: e.fase, tentativa: e.tentativa, motivo: e.motivo, sessao: e.sessao,
          prova: e.prova, em, aposReserva: typeof e.aposReserva === 'number' && Number.isSafeInteger(e.aposReserva) ? e.aposReserva : null });
        break;
      case 'sessao_parada':
        s.sessoesParadas.push({ trabalho: e.trabalho, thread: e.thread, sessionId: e.sessionId, motivo: e.motivo, confirmada: e.confirmada === true,
          prova: e.prova, em });
        break;
      case 'conta_fora': s.contasFora.set(e.conta, { conta: e.conta, runtime: e.runtime, motivo: e.motivo, ate: e.ate, prova: e.prova, em }); break;
      case 'isolado':
        // O primeiro isolamento vale: o trabalho não sai do isolamento sozinho neste arco.
        if (!s.isolados.has(e.trabalho)) s.isolados.set(e.trabalho, { trabalho: e.trabalho, thread: e.thread, motivo: e.motivo, detalhe: e.detalhe, em });
        break;
      case 'recusa_de_ambiente': s.recusasDeAmbiente.push({ trabalho: e.trabalho, thread: e.thread, detalhe: e.detalhe, em }); break;
      case 'parada': if (!s.parada) s.parada = { motivo: e.motivo, detalhe: e.detalhe, em }; break;
      case 'efeito_incerto':
        if (s.efeitos.has(e.id)) throw adulterado(`efeito ${e.id} registrado duas vezes`);
        s.efeitos.set(e.id, { id: e.id, efeito: e.efeito, registradoEm: em, desfechos: [] });
        break;
      case 'efeito_reconciliado': {
        const ef = s.efeitos.get(e.id);
        if (!ef) throw adulterado(`desfecho do efeito ${e.id} sem registro`);
        ef.desfechos.push({ desfecho: e.desfecho, prova: e.prova, em });
        break;
      }
      case 'pedido_tratado': s.pedidos.set(e.pedido, { thread: e.thread, acao: e.acao, motivo: e.motivo, em }); break;
    }
  }
  return s;
}

/** Quantas retomadas o trabalho já teve nesta fase. É a tentativa de quem vem depois, menos um. */
export function retomadasDe(s: EstadoDaSupervisao, trabalho: string, fase: Fase): number {
  return s.retomadas.filter(r => r.trabalho === trabalho && r.fase === fase).length;
}

/** A conta que o arco tirou e que ainda está fora no instante dado: reset conhecido que passou devolve a conta. */
export function contaForaAgora(s: EstadoDaSupervisao, conta: string, quando: string): ContaFora | null {
  const f = s.contasFora.get(conta);
  if (!f) return null;
  return f.ate !== null && Date.parse(f.ate) <= Date.parse(quando) ? null : f;
}

/** Uma fase do ciclo, para validar o que vem de fora (fixtures e ledgers). */
export const faseValida = (v: unknown): v is Fase => typeof v === 'string' && (FASES as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// RM-058 N4 (D13 a D15): as contas e os runtimes do arco.
// ---------------------------------------------------------------------------

/** O envelope `v2` vigente, com a lista de trabalhos e a capacidade. */
export type ConteudoV2 = ConteudoDoEnvelope & { trabalhos: Trabalho[]; capacidade: Capacidade };

/** As threads do arco: a de cada trabalho (a que o envelope diz, ou a que casa com o item e o sha256 do pedido) e as dos despachos. */
export function threadsDoArco(raiz: string, conteudo: ConteudoV2, estado: EstadoDoArco): Map<string, string> {
  const porTrabalho = new Map<string, string>();
  const pedidos = conteudo.trabalhos.filter(t => t.pedido !== undefined);
  const lidas: Thread[] = [];
  if (pedidos.length) for (const id of listarIds(raiz)) { try { lidas.push(lerThread(raiz, id)); } catch { /* ilegível: a fila diz a lacuna */ } }
  for (const t of conteudo.trabalhos) {
    if (t.thread !== undefined) { porTrabalho.set(t.id, t.thread); continue; }
    const alvo = shaDoPedido(t.pedido!);
    const casam = lidas.filter(x => x.roadmap === t.item && x.pedido?.sha256 === alvo);
    if (casam.length === 1) porTrabalho.set(t.id, casam[0].id);
  }
  for (const d of estado.despachos) {
    const th = d.threadDespachada ?? d.thread;
    if (th && !porTrabalho.has(d.trabalho)) porTrabalho.set(d.trabalho, th);
  }
  return porTrabalho;
}

/** A correlação que o passo do arco grava em todo despacho dele. */
export const correlacaoDoArco = (arco: string): string => `noctum:${arco}`;

export interface ContaDoArco {
  conta: string;
  runtime: string | null;
  disponivel: boolean;
  /** Por que está fora: o motivo da linha do arco, ou o estado do perfil no store, ou o subteto. */
  motivo: string | null;
  /** Até quando, quando se sabe. `null` com a conta fora é reset desconhecido ou impedimento do dono. */
  ate: string | null;
}

export interface VisaoDeContas {
  /** Os perfis que o passo pode usar agora: do envelope, disponíveis no store e não tirados pelo arco. */
  perfis: Array<{ id: string; runtime: string }>;
  contas: ContaDoArco[];
  /** O que a leitura não sabe: store ilegível, reset desconhecido. Lacuna nunca é conta disponível. */
  lacunas: string[];
  /** O teto do arco esgotado para tudo (D15); sem rodízio que resolva. */
  parada: { motivo: MotivoDaParada; detalhe: string } | null;
}

/**
 * D13: as contas que o passo pode usar. Só as do envelope (capacidade e orçamento), que o store dá como disponíveis (com o
 * registro compartilhado da RM-040) e que o arco não tirou: a linha `conta_fora` do arco vale até o reset conhecido, e a
 * sem reset vale pelo resto do arco. O subteto esgotado tira a conta; o teto do arco esgotado para o arco. `store` nulo é
 * store ilegível: nenhuma conta, e a lacuna diz por quê.
 */
export function contasDoArco(conteudo: ConteudoV2, estado: EstadoDoArco, sup: EstadoDaSupervisao, store: StoreDePerfis | null,
  quando: string): VisaoDeContas {
  const agora = Date.parse(quando);
  const lacunas: string[] = store ? [] : ['o store de perfis não pôde ser lido: nenhuma conta é dada como disponível'];
  const tetoDoArco = conteudo.orcamento.arco;
  const parada = tetoDoArco.unidade === 'sessoes' && estado.consumo.arco >= tetoDoArco.valor
    ? { motivo: 'teto-do-arco' as const, detalhe: `o teto do arco é de ${tetoDoArco.valor} sessoes e ${estado.consumo.arco} já foram reservadas` }
    : null;
  let provider: string | null = null;
  const contas: ContaDoArco[] = conteudo.capacidade.porConta.map(({ conta }) => {
    const p = store?.perfis.find(x => x.id === conta) ?? null;
    const fora = (motivo: string, ate: string | null = null): ContaDoArco => ({ conta, runtime: p?.runtime ?? null, disponivel: false, motivo, ate });
    if (!store) return fora('store-ilegivel');
    if (!p) return fora('perfil-ausente');
    const doArco = contaForaAgora(sup, conta, quando);
    if (doArco) {
      if (doArco.ate === null && doArco.motivo !== 'auth') lacunas.push(`conta ${conta}: reset desconhecido, fora pelo resto do arco (${doArco.prova})`);
      return fora(doArco.motivo, doArco.ate);
    }
    const teto = conteudo.orcamento.porConta.find(x => x.conta === conta)?.teto;
    if (teto?.unidade === 'sessoes' && (estado.consumo.porConta[conta] ?? 0) >= teto.valor) return fora('subteto');
    if (p.estado === 'ativo') return { conta, runtime: p.runtime, disponivel: true, motivo: null, ate: null };
    if (p.estado === 'esgotado' && p.esgotadoAte !== null && Date.parse(p.esgotadoAte) <= agora) {
      return { conta, runtime: p.runtime, disponivel: true, motivo: null, ate: null };
    }
    if (p.estado === 'esgotado') {
      // D13 (A1 do CHECK): o prazo do store pode ter sido estimado (a janela padrão), e sem a prova do arco o reset é
      // desconhecido: lacuna. O vigia grava a conta fora do arco (`observarContas`), para valer depois que o store a devolver.
      lacunas.push(`conta ${conta}: esgotada no store sem prova do arco do reset, fora do arco como lacuna`);
      return fora('cota-sem-reset', null);
    }
    if (p.estado === 'provider-pago') provider = conta;
    return fora(p.estado);
  });
  // D15 (A2 do CHECK): uma conta do envelope que virou provider pago para o arco, como a recusa por custo.
  const porCusto = provider ? { motivo: 'violacao-de-custo' as const,
    detalhe: `a conta ${provider} do envelope está com credencial de provider pago no store: o arco para, sem retry nem troca de conta` } : null;
  return { perfis: contas.filter(c => c.disponivel && c.runtime).map(c => ({ id: c.conta, runtime: c.runtime! })), contas, lacunas,
    parada: parada ?? porCusto };
}

/**
 * D14: os runtimes em que a fase pode sair, em ordem: o do bloco e depois a ordem de fallback do bloco (o modelo e o
 * esforço de cada item), só os que o envelope admite (capacidade e orçamento) e com o subteto em `sessoes` ainda aberto.
 */
export function alvosDaFase(carregado: ManifestoCarregado, conteudo: ConteudoV2, estado: EstadoDoArco, fase: Fase, runtimeDoBloco: string,
  modo: Thread['modo']): Array<{ runtime: string; model?: string; effort?: string }> {
  let bloco: ConfigDeBlocoComFallback | null = null;
  try { bloco = configDoBloco(lerSetup(carregado.raiz), modo, fase) as ConfigDeBlocoComFallback | null; } catch { bloco = null; }
  const doEnvelope = (r: string): boolean => conteudo.capacidade.porRuntime.some(x => x.runtime === r) &&
    conteudo.orcamento.porRuntime.some(x => x.runtime === r);
  const aberto = (r: string): boolean => {
    const teto = conteudo.orcamento.porRuntime.find(x => x.runtime === r)?.teto;
    return !teto || teto.unidade !== 'sessoes' || (estado.consumo.porRuntime[r] ?? 0) < teto.valor;
  };
  const lista = [{ runtime: runtimeDoBloco }, ...alvosDaOrdemDeFallback(bloco?.fallback, runtimeDoBloco)
    .map(a => ({ runtime: a.runtime, model: a.model, ...(a.effort ? { effort: a.effort } : {}) }))];
  const vistos = new Set<string>();
  return lista.filter(a => { if (vistos.has(a.runtime)) return false; vistos.add(a.runtime); return doEnvelope(a.runtime) && aberto(a.runtime); });
}

/** O id do perfil de um evento de despacho (o `perfil` gravado pelo `phase run`: objeto com `id`, ou o id). */
function perfilDoEvento(e: EventoLedger): string | null {
  const p = e.perfil as unknown;
  if (typeof p === 'string') return p;
  if (objeto(p) && typeof p.id === 'string') return p.id;
  return null;
}

/**
 * D13 e D15: o que o arco sabe das contas, desde a autorização. Dos despachos do arco: a cota esgotada com o reset dito
 * (fora até ele), a cota sem reset dito (fora pelo resto do arco), o login perdido e o limite de uso transitório (até o
 * `liberaEm` do pedido da fila durável, dito ou estimado, como a fila B3). Da sessão do arco que viu a cota no meio do
 * turno (`runtime_quota_detected`), o mesmo. Do store (A1 do CHECK): a conta esgotada sem a prova do arco do reset, e a
 * sem login, ficam fora do arco, porque o reset é desconhecido e o login só o dono refaz. Devolve as linhas `conta_fora`
 * novas (a decisão já gravada não se repete) e a parada por violação de custo, quando o núcleo recusou um despacho do
 * arco por provider pago.
 */
export function observarContas(raiz: string, arco: string, conteudo: ConteudoV2, estado: EstadoDoArco, sup: EstadoDaSupervisao,
  store: StoreDePerfis | null, quando: string): { eventos: EventoDaSupervisao[]; parada: { motivo: MotivoDaParada; detalhe: string } | null } {
  const desde = Date.parse(estado.autorizadoPor?.recebidoEm ?? conteudo.janela.inicio);
  const agora = Date.parse(quando);
  const correlacao = correlacaoDoArco(arco);
  // A falha mais nova de cada conta decide, entre todas as threads do arco.
  const decisoes = new Map<string, { evento: Extract<EventoDaSupervisao, { tipo: 'conta_fora' }>; em: number }>();
  const decidir = (conta: string, evento: Extract<EventoDaSupervisao, { tipo: 'conta_fora' }>, em: number) => {
    if (!((decisoes.get(conta)?.em ?? -Infinity) > em)) decisoes.set(conta, { evento, em });
  };
  let parada: { motivo: MotivoDaParada; detalhe: string } | null = null;
  for (const thread of new Set(threadsDoArco(raiz, conteudo, estado).values())) {
    let eventos: EventoLedger[];
    try { eventos = lerLedger(dirThread(raiz, thread)); } catch { continue; }
    const sessoesDoArco = new Set(eventos.filter(e => e.tipo === 'phase_dispatch' && e.correlacao === correlacao).map(e => e.sessionId));
    eventos.forEach((e, i) => {
      if (!(Date.parse(e.ts) >= desde)) return;
      if (e.tipo === 'runtime_quota_detected' && typeof e.sessionId === 'string' && sessoesDoArco.has(e.sessionId)) {
        const conta = perfilDoEvento(e);
        if (!conta) return;
        const reset = typeof e.resetEm === 'string' && Date.parse(e.resetEm) > Date.parse(e.ts) ? e.resetEm : null;
        decidir(conta, { tipo: 'conta_fora', conta, runtime: typeof e.runtime === 'string' ? e.runtime : '', motivo: reset ? 'cota' : 'cota-sem-reset',
          ate: reset, prova: `${thread}: runtime_quota_detected ${String(e.eventId ?? '')} da sessão ${e.sessionId}` }, Date.parse(e.ts));
        return;
      }
      if (e.tipo !== 'phase_dispatch_failed' || e.correlacao !== correlacao) return;
      const conta = perfilDoEvento(e);
      const runtime = typeof e.runtime === 'string' ? e.runtime : '';
      // O que o núcleo gravou logo depois desta falha, até o próximo despacho: o gate tipado e o pedido da fila durável.
      const depois: EventoLedger[] = [];
      for (const x of eventos.slice(i + 1)) {
        if (x.tipo === 'phase_dispatch' || x.tipo === 'phase_dispatch_failed' || x.tipo === 'phase_prompt_recorded') break;
        depois.push(x);
      }
      const gate = depois.find(x => x.tipo === 'gate_blocked');
      const falha = objeto(gate?.falhaDeConta) ? gate!.falhaDeConta as { motivo?: unknown; resetEm?: unknown } : null;
      const prova = `${thread}: ${gate ? `gate_blocked ${String(gate.motivo)}` : 'phase_dispatch_failed'} ${String((gate ?? e).eventId ?? '')}`.trim();
      if (gate?.motivo === 'cost.violation') {
        parada ??= { motivo: 'violacao-de-custo', detalhe: `o núcleo recusou um despacho do arco por custo (${prova}); sem retry nem troca de conta` };
        return;
      }
      if (!conta) return;
      const fila = depois.find(x => x.tipo === 'rate_limit_queued');
      const em = Date.parse(e.ts);
      if (falha?.motivo === 'runtime.quota-exhausted') {
        const reset = typeof falha.resetEm === 'string' && Date.parse(falha.resetEm) > Date.parse(e.ts) ? falha.resetEm : null;
        decidir(conta, { tipo: 'conta_fora', conta, runtime, motivo: reset ? 'cota' : 'cota-sem-reset', ate: reset, prova }, em);
      } else if (falha?.motivo === 'runtime.auth-missing') {
        decidir(conta, { tipo: 'conta_fora', conta, runtime, motivo: 'auth', ate: null, prova }, em);
      } else if (fila && typeof fila.liberaEm === 'string') {
        decidir(conta, { tipo: 'conta_fora', conta, runtime, motivo: 'limite-de-uso', ate: fila.liberaEm,
          prova: `${thread}: rate_limit_queued ${String(fila.pedido ?? '')} (${fila.janelaEstimada === true ? 'janela estimada' : 'hora dita pelo runtime'})` }, em);
      }
    });
  }
  // A1 do CHECK: o que só o store sabe, sem decisão do arco valendo agora. A decisão do arco que já venceu (a cota com o
  // reset dito no passado) não segura a do store (NS4 da rodada 2): senão a janela estimada do store voltaria a valer.
  const valendo = (d: { evento: Extract<EventoDaSupervisao, { tipo: 'conta_fora' }> } | undefined): boolean =>
    !!d && (d.evento.ate === null || Date.parse(d.evento.ate) > agora);
  for (const { conta } of conteudo.capacidade.porConta) {
    const p = store?.perfis.find(x => x.id === conta);
    if (!p || valendo(decisoes.get(conta)) || contaForaAgora(sup, conta, quando)) continue;
    if (p.estado === 'esgotado' && p.esgotadoAte !== null && Date.parse(p.esgotadoAte) > agora) {
      decisoes.set(conta, { em: agora, evento: { tipo: 'conta_fora', conta, runtime: p.runtime, motivo: 'cota-sem-reset', ate: null,
        prova: `o store de perfis dá a conta como esgotada até ${formatarDataHora(p.esgotadoAte)}, prazo que pode ser estimado: sem a prova do arco, ` +
          'o reset é desconhecido' } });
    } else if (p.estado === 'sem-auth') {
      decisoes.set(conta, { em: agora, evento: { tipo: 'conta_fora', conta, runtime: p.runtime, motivo: 'auth', ate: null,
        prova: 'o store de perfis dá a conta sem login: só o dono refaz o login' } });
    }
  }
  // RA1 da rodada 3: a decisão que já venceu (a cota com o reset dito no passado) não se grava: senão ela trocaria, tique
  // sim, tique não, a decisão do store gravada depois dela.
  const eventos = [...decisoes.values()].map(d => d.evento)
    .filter(d => d.ate === null || Date.parse(d.ate) > agora)
    .filter(d => {
      const atual = sup.contasFora.get(d.conta);
      return !atual || atual.motivo !== d.motivo || atual.ate !== d.ate || atual.prova !== d.prova;
    });
  return { eventos, parada };
}
