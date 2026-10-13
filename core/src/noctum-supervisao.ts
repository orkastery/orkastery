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
import { ManifestoCarregado } from './manifest';
import { ID_DO_ARCO } from './noctum-envelope';
import { CADENCIA_MS } from './noctum-fila';
import { CARENCIA_DO_TURNO_ENCERRADO_MIN } from './ocupacao';
import { Fase, FASES } from './types';

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
  };
}

export type Papel = 'condutor' | 'vigia';

/** Quem escreve: o papel, a instância (um uuid por processo), o pid e a máquina. */
export interface Instancia { papel: Papel; instancia: string; pid: number; maquina: string }

export type MotivoDaRetomada = 'sessao-morta' | 'fim-de-turno-sem-resultado' | 'sem-avanco' | 'sem-primeiro-turno' | 'despacho-falho' |
  'limite-de-uso';
/** As contas que o arco tira da seleção (D13). Subteto, perfil ausente e desativado são relidos a cada passo, sem linha. */
export type MotivoDaConta = 'cota' | 'cota-sem-reset' | 'limite-de-uso' | 'auth';
export type MotivoDoIsolamento = 'reserva-incerta' | 'retomadas-esgotadas' | 'sem-primeiro-turno' | 'sessao-presa' | 'condutor-externo' |
  'sessao-fora-do-registro' | 'efeito-divergente' | 'efeito-sem-leitura' | 'erro-repetido';
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
  | { tipo: 'tique_iniciado'; quem: Instancia }
  | { tipo: 'tique_concluido'; quem: Instancia; resumo: string }
  | { tipo: 'vigia_interrompido'; interrompido: string; prova: string }
  | { tipo: 'retomada_autorizada'; trabalho: string; thread: string; fase: Fase; tentativa: number; motivo: MotivoDaRetomada;
    sessao: string | null; prova: string }
  | { tipo: 'sessao_parada'; trabalho: string; thread: string; sessionId: string; motivo: MotivoDaRetomada; confirmada: boolean; prova: string }
  | { tipo: 'conta_fora'; conta: string; runtime: string; motivo: MotivoDaConta; ate: string | null; prova: string }
  | { tipo: 'isolado'; trabalho: string; thread: string | null; motivo: MotivoDoIsolamento; detalhe: string }
  | { tipo: 'recusa_de_ambiente'; trabalho: string; thread: string | null; detalhe: string }
  | { tipo: 'parada'; motivo: MotivoDaParada; detalhe: string }
  | { tipo: 'efeito_incerto'; id: string; efeito: EfeitoIncerto }
  | { tipo: 'efeito_reconciliado'; id: string; desfecho: DesfechoDoEfeito; prova: string }
  | { tipo: 'pedido_tratado'; pedido: string; thread: string; acao: 'retomada-autorizada' | 'cancelado'; motivo: string };

const TIPOS: readonly EventoDaSupervisao['tipo'][] = ['parametros', 'conducao_assumida', 'batida', 'tique_iniciado', 'tique_concluido',
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
  const { raiz } = carregado;
  if (eventos.some(e => e.tipo === 'parametros')) throw new RecusaDaSupervisao('noctum.supervisao.invalida', 'os parâmetros só a primeira gravação escreve');
  return comTrava(raiz, arco, () => {
    let log = lerLog(raiz, arco);
    if (!log.linhas.length) log = anexar(raiz, arco, log, { tipo: 'parametros', parametros: parametrosPadrao(carregado.manifesto) }, quando);
    for (const e of eventos) log = anexar(raiz, arco, log, e, quando);
    const relido = lerLog(raiz, arco);
    if (relido.linhas.length !== log.linhas.length || !relido.terminaEmQuebra) throw adulterado('a gravação não ficou inteira no log');
    return derivar(arco, relido.linhas);
  });
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

function derivar(arco: string, linhas: readonly DadosDaLinha[]): EstadoDaSupervisao {
  const s: EstadoDaSupervisao = { contrato: CONTRATO_SUPERVISAO, arco, linhas: linhas.length, parametros: null, geracao: null,
    batidas: { condutor: null, vigia: null }, tiqueAberto: null, interrupcoesSeguidas: 0, retomadas: [], sessoesParadas: [],
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
          prova: e.prova, em });
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
