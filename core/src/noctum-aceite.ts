/**
 * RM-058, integração (T8 da ork-rm058integra, D12): o aceite do piloto. `aceiteDoPiloto` lê o log do arco, a supervisão, o
 * registro do relatório, os ledgers das threads do arco, o remoto (a ponta da base pelo `git ls-remote` e a ancestralidade
 * de cada merge) e a forja (os PRs da branch, quando o remoto é do GitHub), e dá o contrato `ork.noctum-piloto/v1`: as
 * medidas M1 a M10 (valor, unidade, fonte e lacunas), os critérios A1 a A8 e I1 a I6 com o limiar e a origem dele (`dono`
 * ou `proposta`), e o veredito (`aprovado`, `reprovado`, `incompleto` ou `simulado`).
 *
 * Medida que não se lê é lacuna, nunca zero, e o critério com lacuna fica incompleto. Qualquer marca de simulação (a máquina
 * do ensaio, o remoto de fixture, evento marcado `simulado`, o canal que grava num arquivo local, o despacho cuja sessão o
 * runtime não confirmou) dá `simulado`, e o veredito
 * nunca é `aprovado`: o ensaio não vale como piloto. O resultado não traz o instante de quem roda: o mesmo arco dá o mesmo
 * hash. `publicavel` troca caminho absoluto, e-mail, id de sessão, conta, máquina e o dono do repositório por rótulos
 * estáveis; o arquivo completo fica no estado, ao lado do log do arco.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { shaValido } from './branch-de-estado';
import { repositorioGitHub } from './ci';
import { formatarDataHora } from './horario';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { autoriaHumana } from './master';
import { EstadoDoArco, lerArco, versoesAutorizadas } from './noctum-arco';
import { ConteudoDoEnvelope, envelopeMultimaquina, RecusaDoArco, Unidade } from './noctum-envelope';
import { derivarCoordenacao, EstadoDaCoordenacao } from './noctum-coordenacao';
import { CADENCIA_MS } from './noctum-fila';
import { consumoDoEscopoNaUnidade, MedicaoDoArco, medirArco } from './noctum-medicao';
import { lerRegistro, RecusaDoRegistro } from './noctum-registro';
import { ARQUIVO_DO_TRANSPORTE, INTERVALO_ENTRE_TENTATIVAS_MS, JANELA_DE_ENTREGA_MS, MAXIMO_DE_TENTATIVAS, vencimentoDoRelatorio } from './noctum-relatorio';
import { ConteudoV2, correlacaoDoArco, dirDaSupervisao, EventoDaSupervisao, eventosDaSupervisao, RecusaDaSupervisao, threadsDoArco }
  from './noctum-supervisao';
import { ExecutorDoGh, ghPadrao } from './parado-no-condutor';
import { raizDoEstado } from './estado-thread';
import { dirThread, lerThread } from './thread';
import { EventoLedger } from './types';
import { conferirCoordenacao } from './noctum-coordenacao';
import { DadosDoRegistro, lerRamo } from './noctum-transporte';
import { exec } from './util';
import { branchDaWorktree } from './worktree';

export const CONTRATO_PILOTO = 'ork.noctum-piloto/v1' as const;
export const CONTRATO_LIMIARES = 'ork.noctum-limiares/v1' as const;
/** A máquina do ensaio (`core/scripts/ensaio-noctum.cjs`): o arco que ela conduziu é simulado. */
export const MAQUINA_DO_ENSAIO = 'maquina-do-ensaio';
/** O arquivo completo do aceite, no estado, ao lado do log do arco. */
export const ARQUIVO_DO_ACEITE = 'aceite-piloto.json';

export type IdDaMedida = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8' | 'M9' | 'M10';
export type IdDoCriterio = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6';
export type VereditoDoPiloto = 'aprovado' | 'reprovado' | 'incompleto' | 'simulado';
/** `do-dono`: o núcleo não mede (a confirmação do dono, a escrita fora do repositório); o critério não muda o veredito. */
export type VereditoDoCriterio = 'aprovado' | 'reprovado' | 'incompleto' | 'do-dono';

export interface MedidaDoPiloto {
  id: IdDaMedida;
  nome: string;
  /** `null` é lacuna: a medida não se leu, e nunca vale zero. */
  valor: number | null;
  unidade: string;
  fonte: string;
  lacunas: string[];
  evidencia: Record<string, unknown>;
}

export interface CriterioDoPiloto {
  id: IdDoCriterio;
  texto: string;
  limiar: Record<string, number> | null;
  origemDoLimiar: 'dono' | 'proposta' | null;
  veredito: VereditoDoCriterio;
  detalhe: string;
}

export interface ResultadoDoAceite {
  contrato: typeof CONTRATO_PILOTO;
  arco: string;
  envelope: { contrato: string | null; versao: number | null; sha256: string | null };
  janela: { inicio: string; fim: string; fuso: string; horas: number } | null;
  encerramento: { motivo: string; em: string } | null;
  /** A máquina que compôs este resultado; em v1/v2 também identifica a fonte local. */
  maquina: string;
  /** As fontes locais combinadas no resultado. */
  maquinas: Array<{ maquina: string; fonte: string; sha256: string; veredito: VereditoDoPiloto }>;
  simulacao: { simulado: boolean; marcas: string[] };
  medidas: MedidaDoPiloto[];
  criterios: CriterioDoPiloto[];
  veredito: VereditoDoPiloto;
  lacunas: string[];
}

/** Os limiares dos critérios: os do dono (`--limiares`) e, no que ele não disse, a proposta do plano, marcada como proposta. */
export interface Limiares {
  /** A1: horas de condução sem intervenção; a proposta é a janela inteira do piloto. */
  m1MinimoHoras: number;
  /** A4: o tempo máximo de recuperação, em minutos (três cadências). */
  m5MaximoMin: number;
  /** A5: as entregas provadas mínimas; a proposta é 2 no piloto de até 6 h e 4 no de 12 h. */
  entregasMinimas: number;
  /** I4: a margem além do teto, em fração do teto (0: nada além dele). */
  margemDoTeto: number;
  /** A7: o atraso máximo da versão 1 do relatório depois do vencimento, em minutos (um tique). */
  atrasoDoRelatorioMin: number;
}

/** Uma falha da agenda: o tipo (F1 a F11), o instante em que foi injetada e, quando há, o alvo. */
export interface Injecao { falha: string; instante: string; alvo?: string }

/** O git que o aceite lê; em produção, o da raiz do projeto. Os testes o trocam. */
export interface LeitorDoGit {
  url(remoto: string): string | null;
  ponta(remoto: string, base: string): string | null;
  /** O sha é ancestral da ponta nesta cópia? `null` quando o git não sabe (o objeto não está aqui). */
  ancestral(sha: string, ponta: string): boolean | null;
  /**
   * Os commits entre o merge e a ponta que dizem "This reverts commit <sha>", com a data de cada um; `null` quando o git não
   * sabe. Sem o método (um leitor de teste), o aceite fica só com as reversões que o núcleo gravou no ledger.
   */
  reversoes?(sha: string, ponta: string): Array<{ sha: string; em: string }> | null;
}

export interface OpcoesDoAceite {
  injecoes?: Injecao[] | null;
  limiares?: Partial<Limiares> | null;
  remoto?: string;
  git?: LeitorDoGit;
  executorGh?: ExecutorDoGh;
  medir?: (raiz: string, estado: EstadoDoArco, quando: string) => MedicaoDoArco;
  /** Identidade desta composição; os testes fixam o nome sem tocar a identidade persistente. */
  maquina?: string;
  /** Aceites completos vindos de `--outra-maquina`, com o hash dos bytes lidos. */
  outrasMaquinas?: Array<{ fonte: string; sha256: string; resultado: unknown }>;
  /** Leitura já conferida da coordenação; seam dos testes, sem transporte Git. */
  rede?: { registros: DadosDoRegistro[]; estado: EstadoDaCoordenacao | null; ordensIsoladas?: Array<{ maquina: string; trabalho: string }>;
    vagas?: EstadoDaCoordenacao['vagas'] };
}

export class RecusaDoAceite extends Error {
  constructor(readonly motivo: 'noctum.aceite.sem-arco' | 'noctum.aceite.limiares-invalidos' | 'noctum.aceite.injecoes-invalidas' |
    'noctum.aceite.outra-maquina-invalida', detalhe: string) {
    super(`${motivo}: ${detalhe}`);
    this.name = 'RecusaDoAceite';
  }
}

const HORA = 3_600_000;
/** As falhas que o plano mede pelo tempo de recuperação (M5): a sessão morta, o condutor morto e a máquina perdida. */
export const FALHAS_DO_M5: readonly string[] = ['F1', 'F2', 'F11'];
const MIN = 60_000;
const arred = (x: number, casas = 2): number => Math.round(x * 10 ** casas) / 10 ** casas;
const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** O git da raiz: a URL do remoto, a ponta da base pelo `ls-remote` e a ancestralidade pelo `merge-base`. */
export function gitDaRaiz(raiz: string): LeitorDoGit {
  return {
    url: (remoto) => { const r = exec('git', ['remote', 'get-url', '--', remoto], raiz, 15_000); return r.ok ? r.stdout.trim() : null; },
    ponta: (remoto, base) => {
      const r = exec('git', ['ls-remote', '--', remoto, `refs/heads/${base}`], raiz, 60_000);
      return r.ok ? r.stdout.trim().split(/\s+/)[0] || null : null;
    },
    ancestral: (sha, ponta) => {
      const r = exec('git', ['merge-base', '--is-ancestor', sha, ponta], raiz, 30_000);
      return r.code === 0 ? true : r.code === 1 ? false : null;
    },
    reversoes: (sha, ponta) => {
      // O sha vem do ledger: só hexadecimal chega ao `git log`, como na detecção do `ship`.
      if (!shaValido(sha) || !shaValido(ponta)) return null;
      const r = exec('git', ['log', '--fixed-strings', `--grep=This reverts commit ${sha}`, '--format=%H%x1f%cI%x1e', '--end-of-options', `${sha}..${ponta}`],
        raiz, 60_000);
      if (!r.ok) return null;
      return r.stdout.split('\x1e').map(x => x.trim().split('\x1f')).filter(([h, d]) => h && d).map(([h, d]) => ({ sha: h, em: d }));
    },
  };
}

/** O remoto que não é um endereço de rede: caminho local ou `file://`. É o remoto de fixture do ensaio. */
export function remotoLocal(url: string): boolean {
  return /^file:/i.test(url) || /^(\/|\.{1,2}\/|[A-Za-z]:[\\/])/.test(url) || (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^[^@\s]+@[^:\s]+:/.test(url));
}

/** Os limiares da proposta, pela janela do piloto. */
export function limiaresDaProposta(horas: number, multimaquina = false): Limiares {
  return { m1MinimoHoras: arred(horas), m5MaximoMin: multimaquina ? 25 : 15, entregasMinimas: horas < 12 ? 2 : 4,
    margemDoTeto: 0, atrasoDoRelatorioMin: CADENCIA_MS / MIN };
}

/** As chaves dos limiares do dono, no contrato `ork.noctum-limiares/v1`. */
export const CHAVES_DOS_LIMIARES = ['m1MinimoHoras', 'm5MaximoMin', 'entregasMinimas', 'margemDoTeto', 'atrasoDoRelatorioMin'] as const;

/** Confere os limiares do dono (`--limiares`): o contrato, só as chaves conhecidas e números não negativos; o que falta fica com a proposta. */
export function lerLimiares(bruto: unknown): Partial<Limiares> {
  if (!objeto(bruto) || bruto.contrato !== CONTRATO_LIMIARES) {
    throw new RecusaDoAceite('noctum.aceite.limiares-invalidos', `os limiares do dono são um JSON com contrato ${CONTRATO_LIMIARES}`);
  }
  const saida: Partial<Limiares> = {};
  // M8 do CHECK 2: a chave com erro de digitação não some em silêncio, deixando o critério com a proposta.
  const desconhecidas = Object.keys(bruto).filter(k => k !== 'contrato' && !(CHAVES_DOS_LIMIARES as readonly string[]).includes(k));
  if (desconhecidas.length) {
    throw new RecusaDoAceite('noctum.aceite.limiares-invalidos', `chave(s) desconhecida(s): ${desconhecidas.join(', ')}; as válidas: ${CHAVES_DOS_LIMIARES.join(', ')}`);
  }
  for (const chave of CHAVES_DOS_LIMIARES) {
    const v = bruto[chave];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RecusaDoAceite('noctum.aceite.limiares-invalidos', `${chave} não é um número não negativo`);
    saida[chave] = v;
  }
  return saida;
}

/** Lê a agenda de injeções: uma linha JSON por falha, com `falha` (F1 a F11) e `instante` (ISO). */
export function lerInjecoes(texto: string): Injecao[] {
  const saida: Injecao[] = [];
  for (const [i, linha] of texto.split('\n').entries()) {
    if (!linha.trim()) continue;
    let v: unknown;
    try { v = JSON.parse(linha); } catch { throw new RecusaDoAceite('noctum.aceite.injecoes-invalidas', `a linha ${i + 1} da agenda não é JSON`); }
    if (!objeto(v) || typeof v.falha !== 'string' || !/^F([1-9]|1[01])$/.test(v.falha) || typeof v.instante !== 'string' || !Number.isFinite(Date.parse(v.instante))) {
      throw new RecusaDoAceite('noctum.aceite.injecoes-invalidas', `a linha ${i + 1} da agenda precisa de falha (F1 a F11) e instante (ISO)`);
    }
    // N7 do CHECK 3: a chave com erro de digitação ("Alvo") ou o alvo que não é texto não viram injeção sem alvo em silêncio.
    const desconhecidas = Object.keys(v).filter(k => !['falha', 'instante', 'alvo'].includes(k));
    // M4 do CHECK 4: o alvo vazio também, que valeria como o arco inteiro.
    if (desconhecidas.length || (v.alvo !== undefined && (typeof v.alvo !== 'string' || !v.alvo.trim()))) {
      throw new RecusaDoAceite('noctum.aceite.injecoes-invalidas', `a linha ${i + 1} da agenda só aceita falha, instante e alvo (texto)` +
        `${desconhecidas.length ? `; chave(s) desconhecida(s): ${desconhecidas.join(', ')}` : ''}`);
    }
    saida.push({ falha: v.falha, instante: new Date(v.instante).toISOString(), ...(typeof v.alvo === 'string' ? { alvo: v.alvo } : {}) });
  }
  return saida;
}

interface LedgerDaThread { trabalho: string; thread: string; eventos: EventoLedger[] | null; erro: string | null }

interface Entrega {
  trabalho: string; thread: string; ship: EventoLedger; provada: boolean | null; motivo: string; master: boolean; duplicadas: number;
}

/** O primeiro instante, depois da injeção, de um evento que a falha deve provocar; e o evento, como fonte. */
function sinalDe<T extends { em: string; fonte: string }>(eventos: ReadonlyArray<T>, desde: number): T | null {
  return eventos.filter(e => Date.parse(e.em) >= desde).sort((a, b) => Date.parse(a.em) - Date.parse(b.em))[0] ?? null;
}

/**
 * O aceite de um arco, pelos registros do núcleo. Recusa só o arco que não existe; toda leitura que falha vira lacuna da
 * medida que dependia dela.
 */
export function aceiteDoPiloto(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoAceite = {}): ResultadoDoAceite {
  const { raiz } = carregado;
  let estado: EstadoDoArco | null;
  try { estado = lerArco(raiz, arco); }
  catch (e) {
    if (e instanceof RecusaDoArco) throw new RecusaDoAceite('noctum.aceite.sem-arco', `o log do arco ${arco} não se lê (${e.motivo})`);
    throw e;
  }
  if (!estado?.conteudo || !estado.autorizadoPor) throw new RecusaDoAceite('noctum.aceite.sem-arco', `o arco ${arco} nunca foi autorizado pelo dono`);
  const conteudo: ConteudoDoEnvelope = estado.conteudo;
  const multimaquina = envelopeMultimaquina(conteudo);
  const maquinaAtual = nomeDaMaquina(opcoes.maquina);
  let rede: NonNullable<OpcoesDoAceite['rede']> | null = null;
  let erroDaRede: string | null = null;
  if (multimaquina) {
    try {
      if (opcoes.rede) rede = opcoes.rede;
      else {
        const leitura = lerRamo(carregado, arco, { remoto: opcoes.remoto, maquina: maquinaAtual }, conferirCoordenacao);
        rede = { registros: leitura.registros.map(r => r.dados), estado: derivarCoordenacao(leitura) };
      }
    } catch (e) {
      erroDaRede = `a coordenação não se lê (${e instanceof RecusaDoArco ? e.motivo : (e as Error).message.slice(0, 120)})`;
    }
  }
  const janela = conteudo.janela;
  // A condução começa no início da janela ou na primeira autorização, o que vier depois; as autorizações seguintes, dentro
  // da janela, são emendas do dono.
  let autorizacoes: Array<{ versao: number; autorizadoEm: string; envelopeSha256: string }> = [];
  try { autorizacoes = versoesAutorizadas(raiz, arco).map(v => ({ versao: v.versao, autorizadoEm: v.autorizadoEm, envelopeSha256: v.envelopeSha256 })); }
  catch (e) { if (!(e instanceof RecusaDoArco)) throw e; }
  const primeiraAutorizacao = autorizacoes[0]?.autorizadoEm ?? estado.autorizadoPor.recebidoEm;
  const inicioMs = Math.max(Date.parse(janela.inicio), Date.parse(primeiraAutorizacao));
  const fim = estado.encerramento?.em ?? janela.fim;
  const fimMs = Date.parse(fim);
  const horasDaJanela = (Date.parse(janela.fim) - Date.parse(janela.inicio)) / HORA;
  const git = opcoes.git ?? gitDaRaiz(raiz);
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica?.remoto ?? 'origin';

  const outras: Array<{ fonte: string; sha256: string; resultado: ResultadoDoAceite }> = [];
  for (const outra of opcoes.outrasMaquinas ?? []) {
    const r = outra.resultado;
    const envelope = objeto(r) && objeto(r.envelope) ? r.envelope : null;
    const maquina = objeto(r) && typeof r.maquina === 'string' ? r.maquina : null;
    const valida = objeto(r) && r.contrato === CONTRATO_PILOTO && r.arco === arco && envelope && typeof envelope.sha256 === 'string' &&
      autorizacoes.some(v => v.envelopeSha256 === envelope.sha256) && maquina && multimaquina && conteudo.maquinas.some(m => m.nome === maquina) &&
      Array.isArray(r.medidas) && Array.isArray(r.criterios) && typeof r.veredito === 'string';
    if (!valida) {
      throw new RecusaDoAceite('noctum.aceite.outra-maquina-invalida',
        `${outra.fonte}: o arquivo precisa ser um ${CONTRATO_PILOTO} completo do arco ${arco}, de uma máquina e envelope autorizados aqui`);
    }
    outras.push({ ...outra, resultado: r as unknown as ResultadoDoAceite });
  }

  // As leituras: a supervisão, o relatório e os ledgers das threads do arco.
  let supervisao: Array<{ em: string; evento: EventoDaSupervisao }> | null = null;
  let erroDaSupervisao: string | null = null;
  try { supervisao = eventosDaSupervisao(raiz, arco); }
  catch (e) { if (!(e instanceof RecusaDaSupervisao)) throw e; erroDaSupervisao = `o log da supervisão não se lê (${e.motivo})`; }
  let relatorio: ReturnType<typeof lerRegistro<Record<string, unknown>>> | null = null;
  let erroDoRelatorio: string | null = null;
  try { relatorio = lerRegistro<Record<string, unknown>>(raiz, arco, 'relatorio'); }
  catch (e) { if (!(e instanceof RecusaDoRegistro)) throw e; erroDoRelatorio = `o registro do relatório não se lê (${e.motivo})`; }
  // N1 do CHECK 3: o recibo que o reenvio do dono trouxe (a tentativa anterior da mesma página com `forcado`) não é do envio
  // automático: não conta no M10 nem como sinal da F7.
  const confirmacoesAutomaticas: Array<{ em: string; evento: Record<string, unknown> }> = [];
  {
    const forcada = new Map<string, boolean>();
    for (const l of relatorio ?? []) {
      const chave = `${String(l.evento.versao)} ${String(l.evento.pagina)} ${String(l.evento.canal)}`;
      if (l.evento.tipo === 'envio_tentado') forcada.set(chave, l.evento.forcado === true);
      else if (l.evento.tipo === 'envio_confirmado' && forcada.get(chave) !== true) confirmacoesAutomaticas.push(l);
    }
  }
  const comTrabalhos = 'trabalhos' in conteudo && Array.isArray((conteudo as ConteudoV2).trabalhos);
  const porTrabalho = comTrabalhos ? threadsDoArco(raiz, conteudo as ConteudoV2, estado) : new Map<string, string>();
  const ledgers: LedgerDaThread[] = [...porTrabalho].map(([trabalho, thread]) => {
    try { return { trabalho, thread, eventos: lerLedger(dirThread(raiz, thread)), erro: null }; }
    catch (e) { return { trabalho, thread, eventos: null, erro: `o ledger da thread ${thread} não se lê (${(e as Error).message.slice(0, 120)})` }; }
  });
  // M7 do CHECK 2: a linha que não se lê vira `ledger_corrupted` na leitura, e o ato do dono ou a entrega podem estar nela.
  const ilegiveis = [...ledgers.filter(l => l.erro).map(l => l.erro!),
    ...ledgers.filter(l => l.eventos?.some(e => e.tipo === 'ledger_corrupted')).map(l => `o ledger da thread ${l.thread} tem linha corrompida`)];
  const eventosDasThreads: Array<EventoLedger & { threadDoArco: string }> = ledgers.flatMap(l => (l.eventos ?? []).map(e => ({ ...e, threadDoArco: l.thread })));

  // As marcas de simulação.
  const marcas: string[] = [];
  const urlDoRemoto = git.url(remoto);
  if (urlDoRemoto && remotoLocal(urlDoRemoto)) marcas.push(`o remoto ${remoto} é de fixture (caminho local), não um endereço de rede`);
  const maquinas = new Set((supervisao ?? []).map(l => objeto(l.evento) && 'quem' in l.evento ? l.evento.quem.maquina : null).filter((x): x is string => !!x));
  if (maquinas.has(MAQUINA_DO_ENSAIO)) marcas.push(`a máquina do ensaio (${MAQUINA_DO_ENSAIO}) conduziu o arco`);
  const simulados = eventosDasThreads.filter(e => e.simulado === true).length;
  if (simulados) marcas.push(`${simulados} evento(s) marcado(s) simulado nos ledgers das threads do arco`);
  // I3 do CHECK 4: o despacho sem sessão do runtime. Cada sessão que o arco diz ter despachado tem, no ledger da thread, o
  // `phase_dispatch_verified` que o `phase run` grava quando o runtime a lista (`encontrada: true`), por uma fonte que não
  // se diz simulada. O ledger que não se lê já é lacuna, e não marca.
  const confirmadas = new Set(eventosDasThreads.filter(e => e.tipo === TIPOS_DE_EVENTO.despachoVerificado && e.encontrada === true &&
    typeof e.sessionId === 'string' && !(typeof e.fonte === 'string' && /simulad/i.test(e.fonte))).map(e => `${e.threadDoArco} ${String(e.sessionId)}`));
  const lidas = new Set(ledgers.filter(l => l.eventos).map(l => l.thread));
  const semSessao = [...new Set(estado.despachos.filter(d => d.sessionId && lidas.has(d.threadDespachada ?? d.thread ?? '') &&
    !confirmadas.has(`${d.threadDespachada ?? d.thread} ${d.sessionId}`)).map(d => d.seq))];
  if (semSessao.length) marcas.push(`${semSessao.length} despacho(s) do arco sem a sessão confirmada pelo runtime (reserva ${semSessao.join(', ')})`);
  // O transporte do canal, de onde o relatório o lê (a raiz do estado). Só o nome diz que ele é simulado: o transporte que
  // grava num arquivo com outro nome não aparece aqui, e a confirmação do dono (A8) o cobre.
  try {
    const transporte = fs.readFileSync(path.join(raizDoEstado(raiz), '.orkastery', 'monitor', ARQUIVO_DO_TRANSPORTE), 'utf8');
    if (/simulad/i.test(transporte)) marcas.push('o transporte do canal do relatório é simulado (grava num arquivo local)');
  } catch { /* sem transporte configurado: o relatório diz a lacuna */ }

  const medidas: MedidaDoPiloto[] = [];
  const medida = (m: MedidaDoPiloto) => { medidas.push(m); return m; };
  const nomesDasMaquinas = multimaquina ? conteudo.maquinas.map(m => m.nome) : [maquinaAtual];
  const porMaquina = <T>(valor: (maquina: string) => T): Record<string, T> =>
    Object.fromEntries(nomesDasMaquinas.map(maquina => [maquina, valor(maquina)]));

  /**
   * I1 do CHECK 2: a entrega do arco é o `ship_done` que a entrega dele gravou (o arco na evidência), e não a reconciliação
   * de um merge feito por fora (`incorporadaPor: 'outro-caminho'`) nem o ship do dono depois do arco.
   */
  const doArco = (e: EventoLedger): boolean => {
    const ev = e.evidencia as { arco?: unknown; incorporadaPor?: unknown } | undefined;
    return ev?.arco === arco && ev.incorporadaPor !== 'outro-caminho';
  };
  /** N6 do CHECK 3: o MASTER por omissão do arco é o que a entrega dele marca com o arco na evidência. */
  const masterDoArco = (e: EventoLedger): boolean => (e.evidencia as { arco?: unknown } | undefined)?.arco === arco;

  const ponta = new Map<string, string | null>();
  const pontaDa = (base: string) => { if (!ponta.has(base)) ponta.set(base, git.ponta(remoto, base)); return ponta.get(base)!; };
  const baseDoShip = (ship: EventoLedger): string =>
    typeof ship.para === 'string' && ship.para ? ship.para : comTrabalhos ? conteudo.destinos[0]?.base ?? 'main' : 'main';

  /**
   * I2 do CHECK 4: a reversão de uma entrega do arco (o `mergeSha` de um `ship_done` dele; a de uma entrega anterior ao arco
   * não conta), com o instante do commit que reverte. O núcleo grava o `rollback_done` quando a detecta (no `ork ship` e no
   * MASTER), e esse instante pode vir depois do arco; o aceite procura também no git a reversão que ninguém detectou ainda.
   * A detectada depois do arco, sem a data do commit no git, é lacuna: não se sabe se foi na condução.
   */
  const mergesDoArco = new Map<string, { thread: string; base: string }>();
  for (const l of ledgers) {
    for (const e of l.eventos ?? []) {
      if (e.tipo === TIPOS_DE_EVENTO.shipConcluido && doArco(e) && typeof e.mergeSha === 'string' && e.mergeSha && !mergesDoArco.has(e.mergeSha)) {
        mergesDoArco.set(e.mergeSha, { thread: l.thread, base: baseDoShip(e) });
      }
    }
  }
  const reversoes = new Map<string, { em: string | null; detectadaEm: string | null; thread: string; mergeSha: string }>();
  const lacunasDaReversao: string[] = [];
  for (const [mergeSha, { thread, base }] of mergesDoArco) {
    const p = git.reversoes ? pontaDa(base) : null;
    const achadas = p ? git.reversoes!(mergeSha, p) : [];
    if (achadas === null) { lacunasDaReversao.push(`as reversões do merge ${mergeSha.slice(0, 12)} não se leram no git`); continue; }
    for (const r of achadas) {
      const t = Date.parse(r.em);
      if (Number.isFinite(t)) reversoes.set(r.sha, { em: new Date(t).toISOString(), detectadaEm: null, thread, mergeSha });
    }
  }
  for (const [i, e] of eventosDasThreads.entries()) {
    if (e.tipo !== TIPOS_DE_EVENTO.rollbackConcluido || typeof e.mergeSha !== 'string' || !mergesDoArco.has(e.mergeSha)) continue;
    // O registro sem o sha do revert é uma reversão por si: a chave é a posição dele na leitura.
    const chave = typeof e.revertSha === 'string' && e.revertSha ? e.revertSha : `registro-${i}`;
    reversoes.set(chave, { em: reversoes.get(chave)?.em ?? null, detectadaEm: e.ts, thread: e.threadDoArco, mergeSha: e.mergeSha });
  }

  // M1: condução sem intervenção.
  const atos: Array<{ em: string; ato: string }> = [];
  for (const [revertSha, r] of reversoes) {
    // Sem a data do commit, a detecção até o fim do arco prova que a reversão foi nele; a de depois não prova nada.
    const em = r.em ?? (r.detectadaEm && Date.parse(r.detectadaEm) <= fimMs ? r.detectadaEm : null);
    if (em === null) { lacunasDaReversao.push(`a reversão ${revertSha.slice(0, 12)} do merge ${r.mergeSha.slice(0, 12)} não tem a data do commit no git`); continue; }
    const t = Date.parse(em);
    if (t >= inicioMs && t <= fimMs) atos.push({ em, ato: `reversão de entrega na thread ${r.thread}` });
  }
  if (estado.revogadoPor) atos.push({ em: estado.revogadoPor.recebidoEm, ato: 'revogação do envelope pelo dono' });
  for (const a of autorizacoes.slice(1)) {
    if (Date.parse(a.autorizadoEm) > Date.parse(janela.inicio)) atos.push({ em: a.autorizadoEm, ato: `emenda do envelope (versão ${a.versao}) durante a janela` });
  }
  for (const e of eventosDasThreads) {
    const t = Date.parse(e.ts);
    if (!(t >= inicioMs && t <= fimMs)) continue;
    if (e.tipo === 'human_gate' && e.source === 'human') atos.push({ em: e.ts, ato: `gate respondido pelo dono na thread ${e.threadDoArco}` });
    else if (e.tipo === 'session_answered') atos.push({ em: e.ts, ato: `sessão respondida pelo dono na thread ${e.threadDoArco}` });
    else if (e.tipo === TIPOS_DE_EVENTO.threadFechadaAdmin) atos.push({ em: e.ts, ato: `thread ${e.threadDoArco} fechada à mão` });
    else if (e.tipo === TIPOS_DE_EVENTO.masterConcluido && autoriaHumana(e.por) && e.regime !== 'omissao') {
      atos.push({ em: e.ts, ato: `MASTER do dono na thread ${e.threadDoArco}` });
    } else if (e.tipo === TIPOS_DE_EVENTO.faseDespachada && e.correlacao !== correlacaoDoArco(arco)) {
      atos.push({ em: e.ts, ato: `despacho de fora do arco na thread ${e.threadDoArco}` });
    } else if (e.tipo === TIPOS_DE_EVENTO.shipConcluido && !doArco(e)) {
      atos.push({ em: e.ts, ato: `entrega de fora do arco na thread ${e.threadDoArco}` });
    } else if (e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao && !masterDoArco(e)) {
      atos.push({ em: e.ts, ato: `MASTER por omissão de fora do arco na thread ${e.threadDoArco}` });
    }
  }
  atos.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  const primeiroAto = atos[0] ?? null;
  const ateOAto = primeiroAto ? Math.max(inicioMs, Date.parse(primeiroAto.em)) : fimMs;
  // O arco aberto ainda não tem a condução inteira: M1 é lacuna, e o aceite nunca aprova um piloto em curso.
  const lacunasDoM1 = [...(estado.encerramento ? [] : ['o arco ainda não fechou: a condução se mede no arco encerrado']), ...ilegiveis, ...lacunasDaReversao];
  medida({ id: 'M1', nome: 'Condução sem intervenção', valor: lacunasDoM1.length ? null : arred(Math.max(0, ateOAto - inicioMs) / HORA), unidade: 'h',
    fonte: 'log do arco e ledgers das threads do arco', lacunas: lacunasDoM1, evidencia: { inicio: new Date(inicioMs).toISOString(), fim, atos } });

  // M2 e M3: as entregas com prova e o MASTER delas.
  const entregas: Entrega[] = [];
  const lacunasDaEntrega: string[] = [...ilegiveis];
  for (const l of ledgers) {
    const ships = (l.eventos ?? []).filter(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido && doArco(e));
    if (!ships.length) continue;
    const ship = ships[0];
    const sha = typeof ship.mergeSha === 'string' && ship.mergeSha ? ship.mergeSha : typeof ship.shaRemoto === 'string' ? ship.shaRemoto : null;
    const base = baseDoShip(ship);
    let provada: boolean | null = false, motivo = '';
    if (ship.pushVerificado !== true || !sha) motivo = 'ship_done sem a prova do push';
    else {
      const p = pontaDa(base);
      const anc = p ? git.ancestral(sha, p) : null;
      if (!p) { provada = null; motivo = `a ponta de ${base} no remoto ${remoto} não se leu`; lacunasDaEntrega.push(`${l.thread}: ${motivo}`); }
      else if (anc === null) { provada = null; motivo = `o merge ${sha.slice(0, 12)} não está nesta cópia`; lacunasDaEntrega.push(`${l.thread}: ${motivo}`); }
      else { provada = anc; motivo = anc ? `merge ${sha.slice(0, 12)} na ponta de ${base}` : `o merge ${sha.slice(0, 12)} não está na base do remoto`; }
    }
    let fechada = false;
    try { fechada = lerThread(raiz, l.thread).status === 'fechada'; } catch { /* a thread ilegível não tem MASTER provado */ }
    // O MASTER do arco é o por omissão que a entrega dele grava antes do fim; o da fábrica ou do dono depois do arco não conta.
    const master = fechada && (l.eventos ?? []).some(e => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao && masterDoArco(e) && Date.parse(e.ts) <= fimMs);
    entregas.push({ trabalho: l.trabalho, thread: l.thread, ship, provada, motivo, master, duplicadas: ships.length - 1 });
  }
  const provadas = entregas.filter(e => e.provada === true);
  const semLeitura = entregas.some(e => e.provada === null) || ilegiveis.length > 0;
  medida({ id: 'M2', nome: 'Entregas com prova', valor: semLeitura ? null : provadas.length, unidade: `entregas provadas de ${entregas.length} alegadas`,
    fonte: 'ship_done dos ledgers, ponta da base pelo git ls-remote e ancestralidade do merge', lacunas: lacunasDaEntrega,
    evidencia: { alegadas: entregas.length, entregas: entregas.map(e => ({ trabalho: e.trabalho, thread: e.thread, provada: e.provada, motivo: e.motivo })),
      ...(multimaquina ? { porMaquina: porMaquina(maquina => (rede?.registros ?? []).filter(r => r.tipo === 'entrega' && r.por === maquina).length) } : {}) } });
  medida({ id: 'M3', nome: 'MASTER por omissão', valor: semLeitura ? null : provadas.filter(e => e.master).length, unidade: `entregas com MASTER de ${provadas.length} provadas`,
    fonte: 'aceite_por_omissao com o arco na evidência, antes do fim do arco, e a thread fechada', lacunas: semLeitura ? ['as entregas não se provaram todas'] : [],
    evidencia: { semMaster: provadas.filter(e => !e.master).map(e => e.thread) } });

  // M4 e M5: as falhas injetadas e a recuperação delas.
  // Cada sinal leva os alvos que ele toca (o trabalho, a thread, a conta); a injeção com `alvo` só se recupera pelo sinal
  // dele. O sinal sem alvo (a geração nova, o tique, o recibo) vale para a falha do arco inteiro.
  const sup = supervisao ?? [];
  const alvosDe = (e: Record<string, unknown>): string[] => ['trabalho', 'thread', 'conta'].map(k => e[k]).filter((x): x is string => typeof x === 'string');
  const daSupervisao = (tipos: string[]) => sup.filter(l => tipos.includes(l.evento.tipo))
    .map(l => ({ em: l.em, fonte: `supervisão: ${l.evento.tipo}`, alvos: alvosDe(l.evento as Record<string, unknown>) }));
  const dosLedgers = (tipos: string[]) => eventosDasThreads.filter(e => tipos.includes(e.tipo))
    .map(e => ({ em: e.ts, fonte: `ledger da ${e.threadDoArco}: ${e.tipo}`, alvos: [e.threadDoArco, ...[...porTrabalho].filter(([, t]) => t === e.threadDoArco).map(([w]) => w)] }));
  const ordensDaRede = new Map((rede?.registros ?? []).filter(r => r.tipo === 'ordem' && typeof r.ordem === 'string')
    .map(r => [String(r.ordem), { maquina: String(r.maquina), trabalho: String(r.trabalho) }]));
  const vezesDaRede = new Map((rede?.registros ?? []).filter(r => r.tipo === 'vez' && typeof r.chave === 'string' && typeof r.n === 'number')
    .map(r => [`${String(r.chave)}/${String(r.n)}`, { maquina: String(r.por), trabalho: ordensDaRede.get(String(r.ordem))?.trabalho ?? '' }]));
  const daRede = (i: Injecao, falha: 'F10' | 'F11'): Array<{ em: string; fonte: string; alvos: string[]; maquina: string }> | string => {
    if (!i.alvo) return `${falha} exige o alvo (a máquina afetada) na agenda`;
    if (erroDaRede) return erroDaRede;
    if (!rede) return 'a coordenação da rede não foi lida';
    if (falha === 'F10') {
      return rede.registros.filter(r => r.por === i.alvo)
        .map(r => ({ em: r.em, fonte: `coordenação: ${r.tipo} assinado por ${r.por}`, alvos: [i.alvo!], maquina: r.por }));
    }
    const isoladas = rede.ordensIsoladas?.filter(o => o.maquina === i.alvo) ??
      [...(rede.estado?.ordens.values() ?? [])].filter(o => o.maquina === i.alvo && o.estado === 'isolada');
    if (isoladas.length) return [];
    return rede.registros.filter(r => {
      if (r.por === i.alvo) return false;
      if (r.tipo === 'autoridade' && r.modo === 'forcada') return objeto(r.anterior) && r.anterior.maquina === i.alvo;
      if (r.tipo === 'cancelamento') return ordensDaRede.get(String(r.ordem))?.maquina === i.alvo;
      if (r.tipo === 'vez-fim' && r.desfecho === 'abandonada') return vezesDaRede.get(`${String(r.chave)}/${String(r.n)}`)?.maquina === i.alvo;
      return false;
    }).map(r => ({ em: r.em, fonte: `coordenação: ${r.tipo} de ${i.alvo} por ${r.por}`, alvos: [i.alvo!], maquina: r.por }));
  };
  const SINAIS: Record<string, (i: Injecao) => Array<{ em: string; fonte: string; alvos: string[]; maquina?: string }> | string> = {
    F1: () => erroDaSupervisao ?? daSupervisao(['retomada_autorizada']),
    F2: () => erroDaSupervisao ?? daSupervisao(['conducao_assumida']),
    F3: () => erroDaSupervisao ?? daSupervisao(['vigia_interrompido']),
    F4: () => dosLedgers([TIPOS_DE_EVENTO.verificacao, TIPOS_DE_EVENTO.shipPublicado, TIPOS_DE_EVENTO.shipConcluido]),
    F5: () => dosLedgers([TIPOS_DE_EVENTO.shipConcluido]),
    F6: () => erroDaSupervisao ?? daSupervisao(['conta_fora']),
    F7: () => erroDoRelatorio ?? confirmacoesAutomaticas.map(l => ({ em: l.em, fonte: 'relatório: envio_confirmado', alvos: [] as string[] })),
    F8: () => erroDaSupervisao ?? daSupervisao(['efeito_reconciliado']),
    F9: () => erroDaSupervisao ?? daSupervisao(['tique_concluido']),
    F10: (i) => daRede(i, 'F10'),
    F11: (i) => daRede(i, 'F11'),
  };
  const injecoes = opcoes.injecoes ?? null;
  const recuperacoes = (injecoes ?? []).map(i => {
    const fontes = SINAIS[i.falha]?.(i) ?? `falha desconhecida: ${i.falha}`;
    if (typeof fontes === 'string') return { ...i, lacuna: fontes, sinal: null as { em: string; fonte: string } | null };
    const doAlvo = i.alvo ? fontes.filter(f => !f.alvos.length || f.alvos.includes(i.alvo!)) : fontes;
    const sinal = sinalDe(doAlvo, Date.parse(i.instante));
    return { ...i, lacuna: null as string | null, sinal: sinal ? { em: sinal.em, fonte: sinal.fonte, ...(sinal.maquina ? { maquina: sinal.maquina } : {}) } : null };
  });
  // A agenda vazia não prova recuperação nenhuma: é lacuna, como a agenda que falta.
  const lacunasDaAgenda = injecoes === null ? ['sem a agenda de injeções (--injecoes)']
    : !injecoes.length ? ['a agenda de injeções está vazia: nenhuma falha foi injetada']
    : recuperacoes.filter(r => r.lacuna).map(r => `${r.falha}: ${r.lacuna}`);
  const recuperadas = recuperacoes.filter(r => r.sinal);
  const aguardamRecibo = (rede?.ordensIsoladas ?? [...(rede?.estado?.ordens.values() ?? [])]
    .filter(o => o.estado === 'isolada').map(o => ({ maquina: o.maquina, trabalho: o.trabalho })))
    .filter(o => (injecoes ?? []).some(i => i.falha === 'F11' && i.alvo === o.maquina));
  const retomados = [...(rede?.estado?.trabalhos.values() ?? [])].filter(t => t.ordem && t.estado !== 'isolado' &&
    (injecoes ?? []).some(i => i.falha === 'F11' && i.alvo && t.ordem!.maquina !== i.alvo)).map(t => t.trabalho);
  medida({ id: 'M4', nome: 'Falhas recuperadas', valor: lacunasDaAgenda.length ? null : recuperadas.length, unidade: `recuperadas de ${recuperacoes.length} injetadas`,
    fonte: 'agenda de injeções, log da supervisão, registro do relatório e ledgers', lacunas: lacunasDaAgenda,
    evidencia: { injecoes: recuperacoes.map(r => ({ falha: r.falha, instante: r.instante, sinal: r.sinal, lacuna: r.lacuna })),
      ...(multimaquina ? { porMaquina: porMaquina(maquina => recuperadas.filter(r => r.sinal && 'maquina' in r.sinal && r.sinal.maquina === maquina).length),
        retomados, aguardamRecibo } : {}) } });
  // M5 é das falhas que o plano mede pelo tempo (a sessão morta, o condutor morto e a máquina perdida); as outras, como o
  // tique parado de propósito por 20 min, contam só em M4.
  const tempos = recuperadas.filter(r => FALHAS_DO_M5.includes(r.falha)).map(r => (Date.parse(r.sinal!.em) - Date.parse(r.instante)) / MIN)
    .sort((a, b) => a - b);
  const mediana = tempos.length ? (tempos.length % 2 ? tempos[(tempos.length - 1) / 2] : (tempos[tempos.length / 2 - 1] + tempos[tempos.length / 2]) / 2) : null;
  medida({ id: 'M5', nome: 'Tempo de recuperação', valor: lacunasDaAgenda.length || !tempos.length ? null : arred(tempos.at(-1)!), unidade: 'min (máximo)',
    fonte: 'da injeção ao primeiro sinal de retomada no log', lacunas: lacunasDaAgenda.length ? lacunasDaAgenda : tempos.length ? []
      : [`nenhuma falha recuperada de ${FALHAS_DO_M5.join(', ')} para medir`],
    evidencia: { mediana: mediana === null ? null : arred(mediana), maximo: tempos.length ? arred(tempos.at(-1)!) : null,
      ...(multimaquina ? { porMaquina: porMaquina(maquina => {
        const t = recuperadas.filter(r => FALHAS_DO_M5.includes(r.falha) && r.sinal && 'maquina' in r.sinal && r.sinal.maquina === maquina)
          .map(r => arred((Date.parse(r.sinal!.em) - Date.parse(r.instante)) / MIN));
        return t.length ? Math.max(...t) : null;
      }) } : {}) } });

  // M6: violações do envelope.
  const contas = new Set([...conteudo.orcamento.porConta.map(c => c.conta), ...(comTrabalhos ? (conteudo as ConteudoV2).capacidade.porConta.map(c => c.conta) : [])]);
  const bases = new Set(conteudo.destinos.map(d => d.base));
  const violacoes: string[] = [];
  for (const d of estado.despachos) {
    const t = Date.parse(d.reservadoEm);
    if (t < Date.parse(janela.inicio) || t > fimMs) violacoes.push(`despacho ${d.seq} (${d.trabalho}) fora da janela vigente`);
    if (!contas.has(d.conta)) violacoes.push(`despacho ${d.seq} (${d.trabalho}) pela conta fora do envelope`);
  }
  for (const e of entregas) {
    if (typeof e.ship.para === 'string' && e.ship.para && !bases.has(e.ship.para)) violacoes.push(`a entrega de ${e.trabalho} foi para uma base fora do destino`);
    if (Date.parse(e.ship.ts) > fimMs) violacoes.push(`a entrega de ${e.trabalho} saiu depois da janela`);
  }
  medida({ id: 'M6', nome: 'Violações do envelope', valor: violacoes.length || !ilegiveis.length ? violacoes.length : null, unidade: 'violações',
    fonte: 'log do arco e ship_done dos ledgers', lacunas: [...ilegiveis], evidencia: { violacoes } });

  // M7: efeitos duplicados.
  const duplicados: string[] = [];
  for (const e of entregas) if (e.duplicadas) duplicados.push(`${e.duplicadas} ship_done a mais na thread ${e.thread}`);
  const pushes = new Map<string, number>();
  // Só os pushes do arco, entre o início da condução e o fim dele: o push do dono antes ou depois do arco não é efeito dele.
  for (const e of eventosDasThreads) {
    const t = Date.parse(e.ts);
    if (e.tipo !== TIPOS_DE_EVENTO.shipPublicado || e.pushFeito !== true || typeof e.head !== 'string' || !(t >= inicioMs && t <= fimMs)) continue;
    const chave = `${e.threadDoArco} ${e.head}`;
    pushes.set(chave, (pushes.get(chave) ?? 0) + 1);
  }
  for (const [chave, n] of pushes) if (n > 1) duplicados.push(`${n} pushes do mesmo SHA (${chave})`);
  const porSessao = new Map<string, number>();
  // O despacho idempotente devolveu a sessão em curso: não abriu outra, e não é efeito duplicado.
  for (const d of estado.despachos) if (d.sessionId && !d.idempotente) porSessao.set(d.sessionId, (porSessao.get(d.sessionId) ?? 0) + 1);
  for (const [s, n] of porSessao) if (n > 1) duplicados.push(`${n} despachos para a mesma sessão ${s}`);
  const paginas = new Map<string, number>();
  for (const l of relatorio ?? []) {
    if (l.evento.tipo !== 'envio_confirmado') continue;
    const chave = `versão ${String(l.evento.versao)}, página ${String(l.evento.pagina)}, canal ${String(l.evento.canal)}`;
    paginas.set(chave, (paginas.get(chave) ?? 0) + 1);
  }
  for (const [chave, n] of paginas) if (n > 1) duplicados.push(`${n} envios confirmados da ${chave}`);
  const vagasSobrepostas: Array<{ trabalho: string; maquinas: [string, string]; vagas: [string, string] }> = [];
  const vagasDaRede = rede?.vagas ?? rede?.estado?.vagas ?? [];
  for (let i = 0; i < vagasDaRede.length; i++) {
    for (let j = i + 1; j < vagasDaRede.length; j++) {
      const a = vagasDaRede[i], b = vagasDaRede[j];
      if (a.trabalho !== b.trabalho || a.maquina === b.maquina) continue;
      const inicio = Math.max(Date.parse(a.desde), Date.parse(b.desde));
      const fimA = a.solta ? Date.parse(a.solta.em) : Number.POSITIVE_INFINITY;
      const fimB = b.solta ? Date.parse(b.solta.em) : Number.POSITIVE_INFINITY;
      if (inicio < Math.min(fimA, fimB)) {
        vagasSobrepostas.push({ trabalho: a.trabalho, maquinas: [a.maquina, b.maquina], vagas: [a.vaga, b.vaga] });
        duplicados.push(`o trabalho ${a.trabalho} teve vagas ativas ao mesmo tempo em ${a.maquina} e ${b.maquina}`);
      }
    }
  }
  const lacunasDaForja: string[] = [];
  const repositorio = urlDoRemoto && !remotoLocal(urlDoRemoto) ? repositorioGitHub(urlDoRemoto) : null;
  if (repositorio) {
    const gh = opcoes.executorGh ?? ghPadrao;
    for (const e of entregas) {
      let branch: string | null = null;
      try { branch = branchDaWorktree(lerThread(raiz, e.thread)); } catch { branch = null; }
      if (!branch) continue;
      const r = gh(['pr', 'list', `--repo=${repositorio}`, `--head=${branch}`, '--state=all', '--json=number,state,headRefOid,createdAt'], 30_000);
      let prs: Array<{ number: number; state: string; createdAt?: string }> | null = null;
      try { prs = r.status === 0 ? JSON.parse(r.stdout) : null; } catch { prs = null; }
      if (!Array.isArray(prs)) { lacunasDaForja.push(`os PRs da branch ${branch} não se leram na forja`); continue; }
      // N5 do CHECK 3: o PR que o dono abriu depois do arco não é efeito dele.
      const validos = prs.filter(x => x.state !== 'CLOSED' && !(typeof x.createdAt === 'string' && Date.parse(x.createdAt) > fimMs));
      if (validos.length > 1) duplicados.push(`${validos.length} PRs da mesma branch ${branch}`);
    }
  }
  const lacunasDoM7 = [...(erroDoRelatorio ? [erroDoRelatorio] : []), ...lacunasDaForja, ...ilegiveis];
  medida({ id: 'M7', nome: 'Efeitos duplicados', valor: lacunasDoM7.length && !duplicados.length ? null : duplicados.length, unidade: 'efeitos duplicados',
    fonte: 'ledgers (ship_done e ship_published), log do arco, registro do relatório, coordenação e PRs da forja', lacunas: lacunasDoM7,
    evidencia: { duplicados, ...(multimaquina ? { vagasSobrepostas, porMaquina: porMaquina(maquina =>
      vagasSobrepostas.filter(v => v.maquinas.includes(maquina)).length) } : {}) } });

  // M8: evidência perdida.
  const perdidas: string[] = [...ilegiveis, ...(erroDaSupervisao ? [erroDaSupervisao] : []), ...(erroDoRelatorio ? [erroDoRelatorio] : [])];
  for (const e of entregas) if (e.motivo === 'ship_done sem a prova do push') perdidas.push(`a entrega de ${e.trabalho} (${e.thread}) não tem a prova do push`);
  medida({ id: 'M8', nome: 'Evidência perdida', valor: perdidas.length, unidade: 'evidências perdidas', fonte: 'ledgers, log da supervisão e registro do relatório',
    lacunas: [], evidencia: { perdidas } });

  // M9: consumo contra o teto, por escopo e unidade.
  let medicao: MedicaoDoArco | null = null;
  let erroDaMedicao: string | null = null;
  const tetos: Array<{ escopo: string; unidade: Unidade; teto: number; consumo: number | null; lacuna: string | null }> = [];
  const consumoDe = (escopo: 'arco' | { conta: string } | { runtime: string }, unidade: Unidade): { valor: number | null; lacuna: string | null } => {
    if (unidade === 'sessoes') {
      const v = escopo === 'arco' ? estado!.consumo.arco : 'conta' in escopo ? estado!.consumo.porConta[escopo.conta] ?? 0 : estado!.consumo.porRuntime[escopo.runtime] ?? 0;
      return { valor: v, lacuna: null };
    }
    if (!medicao && !erroDaMedicao) {
      try { medicao = (opcoes.medir ?? ((r, e, q) => medirArco(r, e, { quando: q })))(raiz, estado!, fim); }
      catch (e) { erroDaMedicao = `a medição falhou (${(e as Error).message.slice(0, 120)})`; }
    }
    if (!medicao) return { valor: null, lacuna: erroDaMedicao };
    const c = consumoDoEscopoNaUnidade(medicao, escopo, unidade);
    return { valor: c.valor, lacuna: c.valor === null ? c.lacunas.join('; ') || 'consumo desconhecido' : null };
  };
  const o = conteudo.orcamento;
  const listaDeTetos: Array<[string, 'arco' | { conta: string } | { runtime: string }, { valor: number; unidade: Unidade }]> = [
    ['arco', 'arco', o.arco], ...o.porConta.map(c => [`conta ${c.conta}`, { conta: c.conta }, c.teto] as [string, { conta: string }, typeof c.teto]),
    ...o.porRuntime.map(r => [`runtime ${r.runtime}`, { runtime: r.runtime }, r.teto] as [string, { runtime: string }, typeof r.teto])];
  for (const [nome, escopo, teto] of listaDeTetos) {
    const c = consumoDe(escopo, teto.unidade);
    tetos.push({ escopo: nome, unidade: teto.unidade, teto: teto.valor, consumo: c.valor, lacuna: c.lacuna });
  }
  const lacunasDoTeto = tetos.filter(t => t.lacuna).map(t => `${t.escopo}: ${t.lacuna}`);
  const acima = tetos.filter(t => t.consumo !== null && t.consumo > t.teto);
  medida({ id: 'M9', nome: 'Consumo contra o teto', valor: lacunasDoTeto.length ? null : acima.length, unidade: 'escopos acima do teto',
    fonte: 'consumo do log do arco, da coordenação e a medição das unidades', lacunas: lacunasDoTeto,
    evidencia: { tetos, ...(multimaquina ? { porMaquina: porMaquina(maquina => (rede?.vagas ?? rede?.estado?.vagas ?? [])
      .filter(v => v.maquina === maquina && (!v.solta || v.solta.consumiu)).length) } : {}) } });

  // M10: o relatório da manhã.
  const lacunasDoRelatorio: string[] = erroDoRelatorio ? [erroDoRelatorio] : [];
  const vencimento = vencimentoDoRelatorio(conteudo);
  const composicoes = (relatorio ?? []).filter(l => l.evento.tipo === 'composto');
  const v1 = composicoes.find(l => l.evento.versao === 1) ?? null;
  const paginasDaV1 = v1 && Array.isArray(v1.evento.paginas) ? v1.evento.paginas.length : 0;
  const confirmadasDaV1 = confirmacoesAutomaticas.filter(l => l.evento.versao === 1);
  const recibos = new Set(confirmadasDaV1.map(l => l.evento.pagina));
  const ultimoRecibo = confirmadasDaV1.map(l => Date.parse(l.em)).sort((a, b) => a - b).at(-1) ?? null;
  // N5 do CHECK 3: a reversão que o núcleo detectou depois da janela de entrega do relatório não é falha dele (a correção já
  // não sai). I2 do CHECK 4: só a reversão de uma entrega do arco pede a correção.
  const revertidas = [...reversoes.values()].filter(r => r.detectadaEm !== null && v1 && Date.parse(r.detectadaEm) >= Date.parse(v1.em) &&
    Date.parse(r.detectadaEm) <= Date.parse(vencimento) + JANELA_DE_ENTREGA_MS);
  const corrigida = composicoes.some(l => l.evento.motivo === 'correcao');
  const falhasDoRelatorio: string[] = [];
  if (!v1) falhasDoRelatorio.push('a versão 1 não foi composta');
  else {
    const tolerancia = (opcoes.limiares?.atrasoDoRelatorioMin ?? CADENCIA_MS / MIN) * MIN;
    if (Date.parse(v1.em) > Date.parse(vencimento) + tolerancia) falhasDoRelatorio.push('a versão 1 foi composta depois do vencimento e de um tique');
    if (recibos.size < paginasDaV1) falhasDoRelatorio.push(`${paginasDaV1 - recibos.size} página(s) da versão 1 sem recibo do envio automático`);
    // I2 do CHECK 2 e N1 do CHECK 3: com a F7 na agenda (o canal fora no horário), o recibo vem pelo reenvio automático, no
    // ciclo dele (as tentativas a cada 5 min, cada uma até um tique depois); sem ela, no horário, até um tique depois. O
    // reenvio que o dono pede já ficou de fora dos recibos.
    const comF7 = (opcoes.injecoes ?? []).some(i => i.falha === 'F7');
    const cicloAutomatico = tolerancia + (MAXIMO_DE_TENTATIVAS - 1) * (INTERVALO_ENTRE_TENTATIVAS_MS + tolerancia);
    if (ultimoRecibo !== null && ultimoRecibo > Date.parse(vencimento) + (comF7 ? cicloAutomatico : tolerancia)) {
      falhasDoRelatorio.push(comF7 ? 'o último recibo da versão 1 chegou depois do ciclo de reenvio automático'
        : 'o último recibo da versão 1 chegou depois do vencimento e de um tique');
    }
  }
  if (revertidas.length && !corrigida) falhasDoRelatorio.push(`${revertidas.length} entrega(s) revertida(s) sem a correção explícita`);
  if ([...paginas.values()].some(n => n > 1)) falhasDoRelatorio.push('página enviada duas vezes ao mesmo canal');
  medida({ id: 'M10', nome: 'Relatório da manhã', valor: lacunasDoRelatorio.length ? null : falhasDoRelatorio.length ? 0 : 1, unidade: '1 no horário com recibo, 0 fora',
    fonte: 'registro do relatório do arco', lacunas: lacunasDoRelatorio,
    evidencia: { vencimento, versao1: v1 ? { compostoEm: v1.em, paginas: paginasDaV1, recibos: recibos.size } : null, falhas: falhasDoRelatorio } });

  // No v3, cinco medidas são a composição dos aceites completos de todas as máquinas. A ausência de uma fonte é lacuna,
  // nunca zero. As demais já trazem em `evidencia.porMaquina` a divisão derivada do ramo conferido.
  const porFonte = new Map<string, MedidaDoPiloto[]>([[maquinaAtual, medidas]]);
  for (const outra of outras) {
    if (porFonte.has(outra.resultado.maquina)) {
      throw new RecusaDoAceite('noctum.aceite.outra-maquina-invalida', `${outra.fonte}: a máquina ${outra.resultado.maquina} apareceu mais de uma vez`);
    }
    porFonte.set(outra.resultado.maquina, outra.resultado.medidas);
  }
  if (multimaquina) {
    const ausentes = conteudo.maquinas.map(m => m.nome).filter(m => !porFonte.has(m));
    const combinadas = new Set<IdDaMedida>(['M1', 'M3', 'M6', 'M8', 'M10']);
    for (const medidaLocal of medidas.filter(m => combinadas.has(m.id))) {
      const valores = Object.fromEntries(conteudo.maquinas.map(({ nome }) => [nome,
        porFonte.get(nome)?.find(m => m.id === medidaLocal.id)?.valor ?? null])) as Record<string, number | null>;
      medidaLocal.evidencia = { ...medidaLocal.evidencia, porMaquina: valores };
      if (ausentes.length) {
        medidaLocal.valor = null;
        medidaLocal.lacunas.push(`sem o aceite completo da(s) máquina(s): ${ausentes.join(', ')}`);
      } else if (Object.values(valores).some(v => v === null)) {
        medidaLocal.valor = null;
        medidaLocal.lacunas.push('ao menos uma máquina deixou a medida como lacuna');
      } else {
        const vs = Object.values(valores) as number[];
        medidaLocal.valor = medidaLocal.id === 'M1' ? Math.min(...vs) : medidaLocal.id === 'M10' ? (vs.every(v => v === 1) ? 1 : 0)
          : vs.reduce((a, b) => a + b, 0);
      }
    }
  }

  // Os critérios.
  const proposta = limiaresDaProposta(horasDaJanela, multimaquina);
  const doDono = opcoes.limiares ?? {};
  const limiar = <K extends keyof Limiares>(k: K): { valor: number; origem: 'dono' | 'proposta' } =>
    doDono[k] !== undefined ? { valor: doDono[k]!, origem: 'dono' } : { valor: proposta[k], origem: 'proposta' };
  const m = (id: IdDaMedida) => medidas.find(x => x.id === id)!;
  const criterios: CriterioDoPiloto[] = [];
  const criterio = (id: IdDoCriterio, texto: string, usados: Array<keyof Limiares>, lacuna: boolean, ok: boolean, detalhe: string) => {
    const ls = usados.map(k => [k, limiar(k)] as const);
    criterios.push({ id, texto, limiar: ls.length ? Object.fromEntries(ls.map(([k, l]) => [k, l.valor])) : null,
      origemDoLimiar: ls.length ? (ls.every(([, l]) => l.origem === 'dono') ? 'dono' : 'proposta') : null,
      veredito: lacuna ? 'incompleto' : ok ? 'aprovado' : 'reprovado', detalhe });
  };
  const nulo = (...ids: IdDaMedida[]) => ids.some(id => m(id).valor === null);
  criterio('A1', 'M1 de ao menos a janela do piloto', ['m1MinimoHoras'], nulo('M1'), (m('M1').valor ?? 0) >= limiar('m1MinimoHoras').valor,
    `${m('M1').valor ?? 'lacuna'} h sem ato do dono`);
  criterio('A2', 'M6, M7 e M8 em zero', [], nulo('M6', 'M7', 'M8'), m('M6').valor === 0 && m('M7').valor === 0 && m('M8').valor === 0,
    `violações ${m('M6').valor ?? 'lacuna'}, duplicados ${m('M7').valor ?? 'lacuna'}, evidências perdidas ${m('M8').valor ?? 'lacuna'}`);
  criterio('A3', 'M9 dentro do teto em todo escopo', [], nulo('M9'), m('M9').valor === 0, `${m('M9').valor ?? 'lacuna'} escopo(s) acima do teto`);
  const doM5 = recuperadas.some(r => FALHAS_DO_M5.includes(r.falha));
  criterio('A4', 'M4 em todas as injeções e M5 com máximo dentro do limiar', ['m5MaximoMin'], nulo('M4') || (doM5 && nulo('M5')),
    m('M4').valor === recuperacoes.length && (!doM5 || m('M5').valor! <= limiar('m5MaximoMin').valor),
    `${m('M4').valor ?? 'lacuna'} de ${recuperacoes.length} recuperadas; máximo ${m('M5').valor ?? '-'} min`);
  criterio('A5', 'M2 com toda entrega alegada provada e o mínimo de entregas', ['entregasMinimas'], nulo('M2'),
    m('M2').valor === entregas.length && (m('M2').valor ?? 0) >= limiar('entregasMinimas').valor, `${m('M2').valor ?? 'lacuna'} provadas de ${entregas.length} alegadas`);
  criterio('A6', 'M3 em todas as entregas provadas', [], nulo('M3'), m('M3').valor === provadas.length, `${m('M3').valor ?? 'lacuna'} de ${provadas.length} com MASTER`);
  criterio('A7', 'M10 entregue no horário, com recibo, sem duplicação', ['atrasoDoRelatorioMin'], nulo('M10'), m('M10').valor === 1,
    falhasDoRelatorio.join('; ') || 'a versão 1 saiu no horário com recibo de todas as páginas');
  criterios.push({ id: 'A8', texto: 'o dono confirma o aceite pelo ingresso tipado', limiar: null, origemDoLimiar: null, veredito: 'do-dono',
    detalhe: 'a ratificação do dono vai no aceite.json, com a referência do recibo do ingresso' });
  criterio('I1', 'nenhuma violação do envelope (M6)', [], nulo('M6'), m('M6').valor === 0, violacoes.join('; ') || 'nenhuma');
  criterio('I2', 'nenhum efeito duplicado (M7)', [], nulo('M7'), m('M7').valor === 0, duplicados.join('; ') || 'nenhum');
  criterio('I3', 'nenhuma evidência perdida (M8)', [], nulo('M8'), m('M8').valor === 0, perdidas.join('; ') || 'nenhuma');
  const alemDaMargem = tetos.filter(t => t.consumo !== null && t.consumo > t.teto * (1 + limiar('margemDoTeto').valor));
  criterio('I4', 'nenhum teto excedido além da margem (M9)', ['margemDoTeto'], nulo('M9'), alemDaMargem.length === 0,
    alemDaMargem.map(t => `${t.escopo}: ${t.consumo} de ${t.teto} ${t.unidade}`).join('; ') || 'nenhum');
  criterios.push({ id: 'I5', texto: 'nenhuma escrita fora do repositório do piloto ou da raiz de estado dele', limiar: null, origemDoLimiar: null,
    veredito: 'do-dono', detalhe: 'o núcleo não mede a escrita fora do repositório: o dono confere' });
  criterio('I6', 'o dono não revogou o envelope', [], false, !estado.revogadoPor && estado.encerramento?.motivo !== 'revogado',
    estado.revogadoPor ? `revogado em ${formatarDataHora(estado.revogadoPor.recebidoEm, { fuso: janela.fuso, agora: fim, locale: 'pt-BR' })} (${janela.fuso})`
      : 'sem revogação');

  const veredito: VereditoDoPiloto = marcas.length ? 'simulado' : criterios.some(c => c.veredito === 'reprovado') ? 'reprovado'
    : criterios.some(c => c.veredito === 'incompleto') ? 'incompleto' : 'aprovado';
  const maquinasDoResultado = [
    { maquina: maquinaAtual, fonte: 'estado local', sha256: sha256(JSON.stringify({ arco, maquina: maquinaAtual, medidas })), veredito },
    ...outras.map(o => ({ maquina: o.resultado.maquina, fonte: o.fonte, sha256: o.sha256, veredito: o.resultado.veredito })),
  ];
  return {
    contrato: CONTRATO_PILOTO, arco,
    envelope: { contrato: conteudo.contrato ?? null, versao: estado.versao, sha256: estado.envelopeSha256 },
    janela: { inicio: janela.inicio, fim: janela.fim, fuso: janela.fuso, horas: arred(horasDaJanela) },
    encerramento: estado.encerramento ? { motivo: estado.encerramento.motivo, em: estado.encerramento.em } : null,
    maquina: maquinaAtual,
    maquinas: maquinasDoResultado,
    simulacao: { simulado: marcas.length > 0, marcas },
    medidas, criterios, veredito,
    lacunas: medidas.flatMap(x => x.lacunas.map(l => `${x.id}: ${l}`)),
  };
}

/** O texto canônico do resultado e o sha256 dele: o mesmo arco dá o mesmo hash. */
export function hashDoAceite(r: ResultadoDoAceite): { texto: string; sha256: string } {
  const texto = `${JSON.stringify(r, null, 2)}\n`;
  return { texto, sha256: sha256(texto) };
}

/** Grava o arquivo completo no estado, ao lado do log do arco; devolve o caminho e o sha256. */
export function gravarAceite(raiz: string, r: ResultadoDoAceite): { arquivo: string; sha256: string } {
  const { texto, sha256: hash } = hashDoAceite(r);
  const arquivo = path.join(dirDaSupervisao(raiz, r.arco), ARQUIVO_DO_ACEITE);
  fs.writeFileSync(arquivo, texto, { mode: 0o600 });
  fs.chmodSync(arquivo, 0o600);
  return { arquivo, sha256: hash };
}

/**
 * A versão publicável: o mesmo resultado com caminho absoluto, e-mail, id de sessão, conta, máquina e o dono do repositório
 * trocados por rótulos estáveis (`caminho-1`, `email-1`, `sessao-1`, `conta-1`, `maquina-1`, `repositorio-do-piloto`), e o
 * sha256 do arquivo completo, que fica no estado. `sensiveis` são as contas e máquinas que o arco conhece.
 */
export function publicavel(r: ResultadoDoAceite, sha256DoCompleto: string, sensiveis: { contas: string[]; maquinas: string[]; repositorios: string[] }):
  ResultadoDoAceite & { publicavel: true; sha256DoCompleto: string } {
  const rotulos = new Map<string, string>();
  const contagem = new Map<string, number>();
  const rotulo = (tipo: string, valor: string): string => {
    const chave = `${tipo}\u0000${valor}`;
    if (!rotulos.has(chave)) { const n = (contagem.get(tipo) ?? 0) + 1; contagem.set(tipo, n); rotulos.set(chave, `${tipo}-${n}`); }
    return rotulos.get(chave)!;
  };
  const fixos: Array<[string, string]> = [
    ...sensiveis.repositorios.filter(Boolean).map(x => [x, 'repositorio-do-piloto'] as [string, string]),
    ...sensiveis.contas.filter(Boolean).map(x => [x, rotulo('conta', x)] as [string, string]),
    ...sensiveis.maquinas.filter(Boolean).map(x => [x, rotulo('maquina', x)] as [string, string]),
  ].sort((a, b) => b[0].length - a[0].length);
  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const limpar = (s: string): string => {
    let x = s;
    x = x.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (e) => rotulo('email', e));
    x = x.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (e) => rotulo('sessao', e.toLowerCase()));
    x = x.replace(/(^|[\s(`'"=:,])((?:\/[^\s/`'"),:]+)+\/?)/g, (_m, antes: string, c: string) => `${antes}${rotulo('caminho', c)}`);
    for (const [valor, novo] of fixos) x = x.replace(new RegExp(`(?<![A-Za-z0-9_-])${escapar(valor)}(?![A-Za-z0-9_-])`, 'g'), novo);
    return x;
  };
  const andar = (v: unknown): unknown => typeof v === 'string' ? limpar(v) : Array.isArray(v) ? v.map(andar)
    : objeto(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [limpar(k), andar(x)])) : v;
  return { ...(andar(r) as ResultadoDoAceite), publicavel: true, sha256DoCompleto };
}

/** As contas, as máquinas e os repositórios que o arco conhece: o que o publicável troca por rótulos. */
export function sensiveisDoArco(carregado: ManifestoCarregado, arco: string): { contas: string[]; maquinas: string[]; repositorios: string[] } {
  const estado = lerArco(carregado.raiz, arco);
  const conteudo = estado?.conteudo;
  const contas = new Set<string>();
  const maquinas = new Set<string>();
  const repositorios = new Set<string>();
  for (const c of conteudo?.orcamento.porConta ?? []) contas.add(c.conta);
  if (conteudo && envelopeMultimaquina(conteudo)) for (const m of conteudo.maquinas) maquinas.add(m.nome);
  for (const d of estado?.despachos ?? []) contas.add(d.conta);
  for (const d of conteudo?.destinos ?? []) { repositorios.add(d.repositorio); repositorios.add(d.repositorio.split('/')[0]); }
  try {
    for (const l of eventosDaSupervisao(carregado.raiz, arco)) {
      const e = l.evento as Record<string, unknown>;
      const quem = e.quem as { maquina?: unknown; instancia?: unknown } | undefined;
      if (typeof quem?.maquina === 'string') maquinas.add(quem.maquina);
      if (typeof e.conta === 'string') contas.add(e.conta);
    }
  } catch { /* o log ilegível já é lacuna no aceite */ }
  return { contas: [...contas], maquinas: [...maquinas], repositorios: [...repositorios] };
}
