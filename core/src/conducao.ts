/**
 * I-36 (RM-036): conducao multicanal do Maestro no nucleo.
 *
 * Existe UM Maestro, o dono, e varios canais por onde ele conduz a mesma fabrica: o Claude Code,
 * o Hermes, o OpenClaw, o Codex, o MCP e o CLI. Um pedido vindo de outro canal e o mesmo dono
 * chegando por outra porta, e nunca um intruso a ser derrubado. O que o nucleo garante e que dois
 * pedidos nunca EXECUTEM juntos na mesma worktree: em 19/09/2026 duas sessoes de canais diferentes
 * rodaram build e teste ao mesmo tempo na worktree da mesma thread, o `verify` gravou `code: -1`
 * como reprovacao, e o unico jeito de destravar foi matar a sessao do outro canal.
 *
 * O recurso e o lease `exec:<thread>`, no estado canonico do projeto (D1). Quem conduz fica nele:
 * canal, sessao ou processo, fase, desde quando e o sha do prompt. O segundo pedido e recusado na
 * hora com `conducao.em-andamento` e as tres acoes (esperar, acompanhar, assumir), com `--esperar`
 * como opcao (D2, decisao do dono em 27/09/2026). Vida se prova pelo kernel ou pelo runtime, nunca
 * por PID ou prazo sozinhos (D7): liberar pelo prazo o que ainda roda e exatamente o incidente.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { estadoProcesso, identidadeProcesso, IdentidadeProcesso } from './adapters/codex-runner';
import { conducaoDoLease, quemConduz, linhaDeConducao, NOME_DA_OPERACAO } from './conducao-texto';

export { conducaoDoLease } from './conducao-texto';
import { caminhoLease, expirado, lerLease, regravarLease } from './leases';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { nomeDaMaquina } from './maquina';
import { dirThread, lerThread } from './thread';
import { formatarDataHoraRotulada } from './horario';
import { exec, agora } from './util';
import { ENV_IDENTIDADE_DE_DESPACHO, ENV_THREAD_DO_DESPACHO } from './runtime-ambiente';
import {
  CanalDeConducao, ConducaoAtual, DadosDaConducao, DonoDaConducao, EventoLedger, Fase, Lease, OperacaoDeConducao,
} from './types';

// ---------------------------------------------------------------------------
// Canais (D5, D6): registro fechado, declarado pela borda.
// ---------------------------------------------------------------------------

/** O registro fechado de canais: de onde o pedido chega e como a borda o declara. */
export const CANAIS_DE_CONDUCAO: Readonly<Record<CanalDeConducao, { origem: string; declaracao: string }>> = {
  'claude-code': {
    origem: 'sessao interativa do Claude Code',
    declaracao: 'servidor MCP iniciado com --host claude-code; no CLI, a variavel CLAUDECODE=1 que o proprio Claude Code exporta',
  },
  hermes: {
    origem: 'assistente Hermes',
    declaracao: 'HERMES_HOME, definido pelo servico do gateway, ou --canal hermes nos binarios do adaptador',
  },
  openclaw: {
    origem: 'plugin OpenClaw',
    declaracao: 'ORK_CANAL=openclaw no ambiente que o adaptador monta para cada chamada do ork',
  },
  codex: {
    origem: 'sessao do Codex',
    declaracao: 'servidor MCP iniciado com --host codex',
  },
  mcp: {
    origem: 'cliente MCP sem host homologado',
    declaracao: 'reservado: o servidor MCP atual exige host homologado e declara o canal dele',
  },
  cli: {
    origem: 'terminal, ork chamado direto',
    declaracao: 'padrao de quem nao declara canal',
  },
};

/** Codigo tipado da recusa de canal fora do registro. */
export const ERRO_CANAL_DESCONHECIDO = 'conducao.canal-desconhecido';

/** Canal fora do registro e recusado com motivo tipado, nunca adivinhado (T9). */
export function validarCanal(bruto: string): CanalDeConducao {
  const canal = bruto.trim();
  if (!Object.hasOwn(CANAIS_DE_CONDUCAO, canal)) {
    throw new Error(`${ERRO_CANAL_DESCONHECIDO}: "${bruto}" nao e um canal de conducao homologado ` +
      `(${Object.keys(CANAIS_DE_CONDUCAO).join(', ')})`);
  }
  return canal as CanalDeConducao;
}

/** Variavel com que um host ou adaptador declara o proprio canal. */
export const ENV_CANAL = 'ORK_CANAL';

/**
 * O canal deste processo (D6): `--canal`, depois `ORK_CANAL`, depois o que o proprio host exporta
 * (`CLAUDECODE=1` do Claude Code, `HERMES_HOME` do gateway do Hermes), e por fim `cli`. O canal
 * descreve a porta e nao concede autoridade: nenhum gate e nenhuma permissao dependem dele.
 */
export function canalDoProcesso(explicito?: string | null, ambiente: NodeJS.ProcessEnv = process.env): CanalDeConducao {
  if (typeof explicito === 'string' && explicito.trim() !== '') return validarCanal(explicito);
  const declarado = (ambiente[ENV_CANAL] ?? '').trim();
  if (declarado) return validarCanal(declarado);
  if (ambiente.CLAUDECODE === '1') return 'claude-code';
  if ((ambiente.HERMES_HOME ?? '').trim()) return 'hermes';
  return 'cli';
}

// ---------------------------------------------------------------------------
// Identidade de despacho (D4): a reentrada da sessao que ja conduz.
// ---------------------------------------------------------------------------

/** Identidade do despacho no ambiente da sessao filha, para as chamadas do CLI de dentro dela. */
export { ENV_IDENTIDADE_DE_DESPACHO, ENV_THREAD_DO_DESPACHO };

/** O que o despacho poe no ambiente da sessao filha: identidade, thread e canal de origem. */
export function ambienteDaConducao(identidade: string, threadId: string, canal: CanalDeConducao): Record<string, string> {
  return { [ENV_IDENTIDADE_DE_DESPACHO]: identidade, [ENV_THREAD_DO_DESPACHO]: threadId, [ENV_CANAL]: canal };
}

/** Variavel que o Claude Code poe em cada sessao, com o UUID dela; nao vem do daemon. */
export const ENV_SESSAO_CLAUDE = 'CLAUDE_CODE_SESSION_ID';

/**
 * A identidade de despacho deste processo, quando ela e desta thread.
 *
 * RM-037 (defeitosdeco D-4): dentro de uma sessao Claude Code, o ambiente pode trazer o par de OUTRO
 * despacho (o daemon do `claude --bg` guardava o do primeiro despacho da conta e o passava as sessoes
 * reserva). Com `raiz`, a sessao se reconhece pelo ledger: vale o ultimo `phase_dispatch` desta thread
 * com o `sessionId` dela. O par do ambiente so vale se bater com esse despacho; par que aponta para um
 * despacho claude-bg de outra sessao e recusado, para nunca reentrar a conducao de quem nao e. Fora de
 * sessao Claude, ou com despacho codex (processo proprio por despacho), vale o ambiente, como antes.
 */
export function identidadeDoAmbiente(threadId: string, ambiente: NodeJS.ProcessEnv = process.env, raiz?: string): string | null {
  const id = (ambiente[ENV_IDENTIDADE_DE_DESPACHO] ?? '').trim();
  const thread = (ambiente[ENV_THREAD_DO_DESPACHO] ?? '').trim();
  const doAmbiente = /^[a-f0-9-]{36}$/.test(id) && thread === threadId ? id : null;
  const sessao = (ambiente[ENV_SESSAO_CLAUDE] ?? '').trim();
  if (!raiz || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessao)) return doAmbiente;
  let eventos: ReturnType<typeof lerLedger>;
  try { eventos = lerLedger(dirThread(raiz, threadId)); } catch { return doAmbiente; }
  const despachoId = (e: Record<string, unknown>) => (e.identidade as { dispatchId?: unknown } | undefined)?.dispatchId;
  const despachos = eventos.filter(e => e.tipo === TIPOS_DE_EVENTO.faseDespachada);
  const doPar = doAmbiente ? despachos.filter(e => despachoId(e) === doAmbiente).at(-1) : undefined;
  // GO-FIX (R2 do CHECK): o codex despachado de dentro de uma sessao Claude herda o
  // CLAUDE_CODE_SESSION_ID dela, mas o par do ambiente e do proprio processo codex, por despacho.
  if (doPar?.runtime === 'codex') return doAmbiente;
  const daSessao = despachos.filter(e => e.sessionId === sessao && typeof despachoId(e) === 'string').at(-1);
  if (daSessao) return String(despachoId(daSessao));
  if (!doAmbiente) return null;
  if (doPar && (doPar.runtime ?? 'claude-bg') === 'claude-bg' && typeof doPar.sessionId === 'string' && doPar.sessionId !== sessao) return null;
  return doAmbiente;
}

// ---------------------------------------------------------------------------
// Prazos (D3): derivados do teto real da operacao; metadado, nunca prova.
// ---------------------------------------------------------------------------

/** Folga sobre o teto: o `timeout(1)` ainda da 15 s de `--kill-after` depois do prazo. */
export const MARGEM_DO_PRAZO_MS = 60_000;
/** Sessao despachada sem limite de duracao no setup do bloco. */
export const PRAZO_DE_SESSAO_PADRAO_MS = 12 * 60 * 60 * 1000;
/** Reserva de quem assumiu a conducao: curta, porque nao e execucao. */
export const PRAZO_DA_RESERVA_MS = 15 * 60 * 1000;
/** Espera padrao de `--esperar` sem valor. */
export const ESPERA_PADRAO_MS = 30 * 60 * 1000;

/** O prazo do lease de uma verificacao: o teto de cada comando vezes quantos rodam, com folga. */
export function prazoDaVerificacao(prazoPorComandoMs: number, comandos: number): number {
  return prazoPorComandoMs * Math.max(1, comandos) + MARGEM_DO_PRAZO_MS;
}

// ---------------------------------------------------------------------------
// Leitura unica (T2, D9).
// ---------------------------------------------------------------------------

/** Nome canonico do lease de execucao da thread. */
export function nomeDaConducao(threadId: string): string {
  return `exec:${threadId}`;
}

/** Estados em que o runtime ja deu a sessao por encerrada. */
const TERMINAIS = ['done', 'completed', 'exited', 'stopped', 'failed'];

/**
 * O evento que prova que a sessao dona do lease acabou: o resultado da fase dela (a prova da I-34
 * que o observador grava), a morte registrada, a superacao, ou a thread fechada. So conta evento
 * posterior ao inicio da conducao.
 */
export function fimDaSessao(eventos: readonly EventoLedger[], lease: Lease): EventoLedger | null {
  const dono = lease.conducao?.dono;
  if (!dono || dono.tipo !== 'sessao') return null;
  const desde = Date.parse(lease.adquiridoEm);
  return eventos.find((e) => Date.parse(e.ts) >= desde && (
    (['phase_result', 'sessao_morta', 'session_superseded'].includes(e.tipo) && e.sessionId === dono.sessionId) ||
    ['thread_closed_admin', 'master_done'].includes(e.tipo))) ?? null;
}

export type VidaDoDono = 'vivo' | 'morto' | 'desconhecido';

/**
 * A leitura pura, para quem so tem os dados (o snapshot do Maestro le por um leitor confinado).
 * Sessao encerrada no ledger e reserva vencida saem da leitura; processo sem prova de vida so sai
 * quando a prova de processo diz `morto`.
 */
export function conducaoDosDados(lease: Lease | null, eventos: readonly EventoLedger[],
  opcoes: { agora?: Date; vidaDoProcesso?: VidaDoDono } = {}): ConducaoAtual | null {
  if (!lease) return null;
  const atual = conducaoDoLease(lease);
  if (!atual) return null;
  if (atual.dono.tipo === 'reserva') return expirado(lease, opcoes.agora) ? null : atual;
  if (atual.dono.tipo === 'processo') return opcoes.vidaDoProcesso === 'morto' ? null : atual;
  return fimDaSessao(eventos, lease) ? null : atual;
}

/**
 * "Quem conduz agora" (T2): a UNICA fonte. Thread status, board, monitor, pulse e os hosts leem
 * daqui, e nenhuma superficie recalcula. Nao escreve nada: liberar e trabalho de quem toma.
 */
export function conducaoDaThread(raiz: string, threadId: string, opcoes: { agora?: Date } = {}): ConducaoAtual | null {
  const lease = lerLease(raiz, nomeDaConducao(threadId));
  if (!lease?.conducao) return null;
  const vida = lease.conducao.dono.tipo === 'processo' ? vidaDoProcesso(raiz, threadId, lease) : undefined;
  let eventos: EventoLedger[] = [];
  try { eventos = lease.conducao.dono.tipo === 'sessao' ? lerLedger(dirThread(raiz, threadId)) : []; }
  catch { /* ledger ilegivel nao prova fim de sessao */ }
  let fechada = false;
  try { fechada = lerThread(raiz, threadId).status === 'fechada'; } catch { /* thread ilegivel segue como esta */ }
  if (fechada && lease.conducao.dono.tipo !== 'processo') return null;
  return conducaoDosDados(lease, eventos, { agora: opcoes.agora, vidaDoProcesso: vida });
}

// ---------------------------------------------------------------------------
// Exclusao do kernel (D7).
// ---------------------------------------------------------------------------

const FLOCK = '/usr/bin/flock';
const pausa = new Int32Array(new SharedArrayBuffer(4));

/** Espera sincrona sem ocupar CPU. */
export function dormir(ms: number): void {
  if (ms > 0) Atomics.wait(pausa, 0, 0, Math.ceil(ms));
}

/** Arquivo da trava de kernel da thread: nunca apagado, como o lock HITL. */
function caminhoDaTrava(raiz: string, threadId: string): string {
  return path.join(dirThread(raiz, threadId), '.conducao.lock');
}

function kernelDisponivel(): boolean {
  return process.platform === 'linux' && fs.existsSync(FLOCK);
}

/**
 * Tenta a trava exclusiva do kernel. O `flock` ajudante tranca a descricao de arquivo que este
 * processo segura; ao sair, a trava continua do processo, e morre com ele. Devolve o descritor, ou
 * null quando outro processo vivo segura a trava.
 */
function tentarTrava(raiz: string, threadId: string): number | null {
  const arquivo = caminhoDaTrava(raiz, threadId);
  const fd = fs.openSync(arquivo, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  if (!kernelDisponivel()) return fd;
  const r = spawnSync(FLOCK, ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 5000 });
  if (r.status === 0 && !r.error) return fd;
  fs.closeSync(fd);
  return null;
}

/**
 * Prova de vida de um dono processo. No Linux, a trava do kernel: se ela esta livre, o dono nao
 * existe mais (morreu, ou a maquina reiniciou). Fora do Linux, sem kernel lock, vale a identidade do
 * processo (pid e instante de inicio), ou `desconhecido`.
 */
export function vidaDoProcesso(raiz: string, threadId: string, lease: Lease): VidaDoDono {
  const dono = lease.conducao?.dono;
  if (!dono || dono.tipo !== 'processo') return 'desconhecido';
  if (dono.maquina !== nomeDaMaquina()) return 'desconhecido';
  if (!kernelDisponivel()) {
    try { process.kill(dono.pid, 0); } catch { return 'morto'; }
    const atual = identidadeProcesso(dono.pid);
    return atual && atual.inicio === dono.inicio ? 'vivo' : 'desconhecido';
  }
  let fd: number | null = null;
  try { fd = tentarTrava(raiz, threadId); } catch { return 'desconhecido'; }
  if (fd === null) return 'vivo';
  fs.closeSync(fd);
  return 'morto';
}

// ---------------------------------------------------------------------------
// Tomada, reentrada, renovacao, conversao e liberacao.
// ---------------------------------------------------------------------------

/** O que o pedido de conducao declara. */
export interface PedidoDeConducao {
  canal: CanalDeConducao;
  correlacao?: string | null;
  operacao: OperacaoDeConducao;
  fase?: Fase | null;
  promptSha256?: string | null;
  /** Identidade de despacho: prova a reentrada da sessao que ja conduz (D4). */
  identidade?: string | null;
  prazoMs: number;
  /** Consultar o runtime para provar fim de sessao (default: sim). */
  consultarRuntime?: boolean;
  /** Testes: a consulta do runtime, no lugar do controle nativo. */
  consultarSessao?: ConsultaDeSessao;
}

/** Resposta de uma consulta ao runtime sobre UMA sessao. */
export type ConsultaDeSessao = (dono: Extract<DonoDaConducao, { tipo: 'sessao' }>, raiz: string, threadId: string) =>
  { ok: boolean; estado: string | null; detalhe: string };

export interface ConducaoTomada {
  ok: true;
  reentrada: boolean;
  identidade: string;
  /** Renova o prazo quando o que falta nao cobre o proximo comando (D3). */
  renovar(prazoDoProximoMs: number, agoraMs?: number): void;
  /** A conducao passa a ser da sessao despachada (T7): o lease sobrevive ao processo. */
  converterEmSessao(dados: { sessionId: string; runtime: string; perfil: string | null; prazoMs: number }): void;
  liberar(): void;
  /**
   * RM-037 (rm037defeito, A-1 do CHECK 3): toda saida que nao virou sessao (sem vaga, sem baseline, falha de
   * contexto, de perfil ou do adapter, rate limit) devolve o lease que a tomada consumiu: a reserva do mesmo
   * canal ou a sessao `blocked` sucedida. Sem isso a reserva do dono sumia, e a sessao bloqueada, se
   * respondida, voltava a rodar sem lease. Sem lease consumido, e o mesmo que `liberar`.
   */
  devolver(): void;
  /**
   * RM-037 (R5-B1 do CHECK 5): a sucessao que a tomada fez ainda vale? A tomada retida para a baseline decide
   * a sucessao da sessao `blocked` e so despacha a sucessora minutos depois, com o lock HITL livre no meio: o
   * dono pode ter respondido a sessao antiga. Chamado sob o lock HITL, antes de tocar a worktree, pergunta ao
   * runtime de novo. Sem sessao sucedida, vale.
   */
  sucessaoAindaVale(): boolean;
}

export interface ConducaoOcupada {
  ok: false;
  /** Mesma fase e mesmo prompt de quem conduz: o pedido ja esta sendo atendido (T14). */
  idempotente: boolean;
  atual: ConducaoAtual | null;
}

export type TomadaDeConducao = ConducaoTomada | ConducaoOcupada;

interface EmCurso { identidade: string; profundidade: number; lease: Lease; fd: number; convertida: boolean; substituido?: Lease;
  /** A consulta ao runtime do pedido que tomou (os testes injetam); sem ela, o controle nativo. */
  consultarSessao?: ConsultaDeSessao;
  /** O descritor ja foi fechado: fechar de novo poderia fechar outro arquivo que reusou o numero. */
  encerrada?: boolean }

/** Fecha a tomada uma vez so (RM-037, CHECK 4): liberar e devolver podem ser chamados mais de uma vez. */
function encerrar(k: string, estado: EmCurso): void {
  if (estado.encerrada) return;
  estado.encerrada = true;
  if (emCurso.get(k) === estado) emCurso.delete(k);
  try { fs.closeSync(estado.fd); } catch { /* ja fechado */ }
}
/** Conducoes que ESTE processo segura, pela chave canonica: a reentrada no mesmo processo. */
const emCurso = new Map<string, EmCurso>();

function chave(raiz: string, threadId: string): string {
  return `${caminhoLease(raiz, nomeDaConducao(threadId))}`;
}

/** A consulta padrao: o controle nativo do runtime (claude-bg ou o controller do codex). */
const consultaNativa: ConsultaDeSessao = (dono, raiz, threadId) => {
  try {
    // Carregado na hora: o modulo de sessoes puxa o HITL inteiro, que nao pertence a leitura.
    const { controleNativo } = require('./hitl-sessions') as typeof import('./hitl-sessions');
    const r = controleNativo(dono.runtime, raiz, threadId, dono.sessionId).consultar();
    if (!r.ok) return { ok: false, estado: null, detalhe: 'o runtime nao respondeu a consulta' };
    const achadas = r.sessoes.filter((s) => s.sessionId === dono.sessionId);
    return { ok: true, estado: achadas[0]?.estado ?? null, detalhe: achadas.length ? `estado ${achadas[0].estado}` : 'sessao ausente' };
  } catch (e) { return { ok: false, estado: null, detalhe: (e as Error).message }; }
};

/**
 * A sessao dona acabou? Primeiro o ledger (a prova da I-34, barata); depois, se pedido, o runtime.
 * Sessao ausente so prova fim quando a consulta foi feita na conta dela (sem perfil, a do processo).
 * O estado visto no runtime volta junto: sessao `blocked` espera alguem e nao executa nada.
 */
function situacaoDaSessao(raiz: string, threadId: string, lease: Lease, pedido: Pick<PedidoDeConducao, 'consultarRuntime' | 'consultarSessao'>):
  { fim: { motivo: 'sessao-encerrada' | 'sessao-orfa'; prova: string; provaEm?: string } | null; estadoNoRuntime: string | null } {
  let estadoNoRuntime: string | null = null;
  const fim = provaDeFimDaSessao(raiz, threadId, lease, pedido, (estado) => { estadoNoRuntime = estado; });
  return { fim, estadoNoRuntime };
}

function provaDeFimDaSessao(raiz: string, threadId: string, lease: Lease, pedido: Pick<PedidoDeConducao, 'consultarRuntime' | 'consultarSessao'>,
  anotarEstado: (estado: string | null) => void = () => undefined):
  { motivo: 'sessao-encerrada' | 'sessao-orfa'; prova: string; provaEm?: string } | null {
  const dono = lease.conducao?.dono;
  if (!dono || dono.tipo !== 'sessao') return null;
  let eventos: EventoLedger[] = [];
  try { eventos = lerLedger(dirThread(raiz, threadId)); } catch { /* sem ledger, so o runtime prova */ }
  const fim = fimDaSessao(eventos, lease);
  if (fim) return { motivo: 'sessao-encerrada', prova: `ledger: ${fim.tipo}${fim.eventId ? ` ${String(fim.eventId)}` : ''}`, provaEm: fim.ts };
  try { if (lerThread(raiz, threadId).status === 'fechada') return { motivo: 'sessao-encerrada', prova: 'thread fechada' }; }
  catch { /* thread ilegivel nao prova nada */ }
  if (pedido.consultarRuntime === false) return null;
  const r = (pedido.consultarSessao ?? consultaNativa)(dono, raiz, threadId);
  if (!r.ok) return null;
  anotarEstado(r.estado);
  if (r.estado && TERMINAIS.includes(r.estado)) return { motivo: 'sessao-orfa', prova: `runtime ${dono.runtime}: ${r.detalhe}` };
  if (r.estado === null && !dono.perfil) return { motivo: 'sessao-orfa', prova: `runtime ${dono.runtime}: ${r.detalhe}` };
  return null;
}

function dadosDoPedido(pedido: PedidoDeConducao, identidade: string, dono: DonoDaConducao): DadosDaConducao {
  return {
    contrato: 'ork.conducao/v1',
    canal: pedido.canal,
    correlacao: pedido.correlacao ?? null,
    operacao: pedido.operacao,
    fase: pedido.fase ?? null,
    promptSha256: pedido.promptSha256 ?? null,
    identidade,
    dono,
  };
}

function donoProcesso(): DonoDaConducao {
  const id = process.platform === 'linux' ? identidadeProcesso(process.pid) : null;
  return { tipo: 'processo', pid: process.pid, inicio: id?.inicio ?? '', bootId: id?.boot ?? '', maquina: nomeDaMaquina() };
}

/** Grava a liberacao com a prova e apaga o lease (quem chama segura a trava do kernel). */
function liberarComProva(raiz: string, threadId: string, lease: Lease, tipo: string, dados: Record<string, unknown>): void {
  try { fs.unlinkSync(caminhoLease(raiz, lease.nome)); } catch { /* ja saiu */ }
  const anterior = conducaoDoLease(lease);
  registrar(dirThread(raiz, threadId), threadId, tipo, {
    lease: lease.nome,
    anterior: anterior ? { canal: anterior.canal, sessao: anterior.sessao, fase: anterior.fase, desde: anterior.desde,
      operacao: anterior.operacao, dono: anterior.dono, promptSha256: anterior.promptSha256 } : null,
    ...dados,
  });
}

/**
 * Com a trava do kernel na mao: o lease que estiver ai ainda vale? Dono processo nao vale (a trava
 * estava livre, entao ele morreu). Dono sessao vale ate a prova de fim. Reserva vale no prazo, e para
 * o mesmo canal vira a conducao dele.
 */
function avaliarComTrava(raiz: string, threadId: string, pedido: PedidoDeConducao,
  opcoes: { usarReserva: boolean } = { usarReserva: true }, saida: { substituido?: Lease } = {}): ConducaoOcupada | null {
  const lease = lerLease(raiz, nomeDaConducao(threadId));
  if (!lease) return null;
  const atual = conducaoDoLease(lease);
  if (!atual) {
    liberarComProva(raiz, threadId, lease, TIPOS_DE_EVENTO.conducaoOrfaLiberada,
      { motivo: 'lease-invalido', prova: 'lease exec sem dados de conducao validos' });
    return null;
  }
  if (atual.dono.tipo === 'processo') {
    const d = atual.dono;
    // Sem kernel lock (fora do Linux), segurar a "trava" nao prova nada: vale a identidade do processo.
    if (!kernelDisponivel() && vidaDoProcesso(raiz, threadId, lease) !== 'morto') return { ok: false, idempotente: false, atual };
    liberarComProva(raiz, threadId, lease, TIPOS_DE_EVENTO.conducaoOrfaLiberada, {
      motivo: 'processo-morto',
      prova: kernelDisponivel()
        ? `trava do kernel livre: o processo ${d.pid} (boot ${d.bootId.slice(0, 8) || '?'}) nao a segura mais`
        : `processo ${d.pid} ausente`,
    });
    return null;
  }
  if (atual.dono.tipo === 'reserva') {
    if (expirado(lease)) {
      liberarComProva(raiz, threadId, lease, TIPOS_DE_EVENTO.conducaoLiberada,
        { motivo: 'reserva-vencida', prova: `reserva de ${atual.dono.por} venceu em ${formatarDataHoraRotulada(lease.expiraEm)}` });
      return null;
    }
    if (opcoes.usarReserva && atual.canal === pedido.canal) {
      saida.substituido = lease;
      liberarComProva(raiz, threadId, lease, TIPOS_DE_EVENTO.conducaoLiberada,
        { motivo: 'reserva-usada', prova: `pedido do mesmo canal ${pedido.canal} de quem assumiu` });
      return null;
    }
    return { ok: false, idempotente: false, atual };
  }
  const { fim, estadoNoRuntime } = situacaoDaSessao(raiz, threadId, lease, pedido);
  if (fim) {
    liberarComProva(raiz, threadId, lease, fim.motivo === 'sessao-encerrada'
      ? TIPOS_DE_EVENTO.conducaoLiberada : TIPOS_DE_EVENTO.conducaoOrfaLiberada, fim);
    return null;
  }
  const despacho = pedido.operacao === 'phase.run' || pedido.operacao === 'retry.run';
  const mesmaFase = atual.fase === (pedido.fase ?? null);
  const mesmoPedido = despacho && mesmaFase && !!pedido.promptSha256 && atual.promptSha256 === pedido.promptSha256;
  // A sucessora (fluxo de superacao das sessoes HITL): a sessao `blocked` espera alguem e nao executa;
  // o despacho seguinte da MESMA fase a sucede, e a superacao a encerra pelo controle do runtime.
  if (despacho && mesmaFase && !mesmoPedido && estadoNoRuntime === 'blocked') {
    saida.substituido = lease;
    liberarComProva(raiz, threadId, lease, TIPOS_DE_EVENTO.conducaoLiberada, {
      motivo: 'sessao-bloqueada-sucedida',
      prova: `runtime ${atual.dono.tipo === 'sessao' ? atual.dono.runtime : '?'}: estado blocked; o despacho seguinte da fase ${atual.fase} a sucede`,
    });
    return null;
  }
  return { ok: false, idempotente: mesmoPedido, atual };
}

/**
 * Toma a conducao da thread para esta operacao, ou diz quem a segura.
 *
 * Reentra quando este mesmo processo ja conduz, ou quando a identidade de despacho do pedido e a de
 * quem conduz (a sessao de CHECK que roda `ork verify` dentro da propria fase, R3). Sem reentrada, a
 * trava do kernel serializa a decisao e o lease registra quem conduz.
 */
export function tomarConducao(raiz: string, threadId: string, pedido: PedidoDeConducao): TomadaDeConducao {
  const k = chave(raiz, threadId);
  const propria = emCurso.get(k);
  if (propria && !propria.convertida) {
    propria.profundidade++;
    // R5-S2 do CHECK 5: a reentrada renova o lease de quem a segura (a baseline dentro da tomada retida).
    return reentrada(propria.identidade, () => { propria.profundidade--; },
      (prazo, agoraMs = Date.now()) => renovar(raiz, threadId, propria, prazo, agoraMs));
  }
  const existente = lerLease(raiz, nomeDaConducao(threadId));
  if (pedido.identidade && existente?.conducao?.identidade === pedido.identidade) {
    return reentrada(pedido.identidade, () => undefined);
  }
  let fd: number | null = null;
  for (let tentativa = 0; tentativa < 3 && fd === null; tentativa++) {
    fd = tentarTrava(raiz, threadId);
    if (fd === null) dormir(150);
  }
  if (fd === null) {
    // Um processo vivo segura a trava: ou conduz, ou esta gravando o lease agora mesmo.
    let atual: ConducaoAtual | null = null;
    for (let i = 0; i < 5 && !atual; i++) {
      const lease = lerLease(raiz, nomeDaConducao(threadId));
      atual = lease ? conducaoDoLease(lease) : null;
      if (!atual) dormir(200);
    }
    return { ok: false, idempotente: false, atual };
  }
  try {
    const saida: { substituido?: Lease } = {};
    const ocupada = avaliarComTrava(raiz, threadId, pedido, undefined, saida);
    if (ocupada) { fs.closeSync(fd); return ocupada; }
    const identidade = pedido.identidade ?? randomUUID();
    const lease: Lease = {
      nome: nomeDaConducao(threadId),
      thread: threadId,
      motivo: `${NOME_DA_OPERACAO[pedido.operacao]} pelo canal ${pedido.canal}`,
      pid: process.pid,
      adquiridoEm: agora(),
      expiraEm: new Date(Date.now() + pedido.prazoMs).toISOString(),
      conducao: dadosDoPedido(pedido, identidade, donoProcesso()),
    };
    regravarLease(raiz, lease);
    const estado: EmCurso = { identidade, profundidade: 0, lease, fd, convertida: false, ...(saida.substituido ? { substituido: saida.substituido } : {}),
      ...(pedido.consultarSessao ? { consultarSessao: pedido.consultarSessao } : {}) };
    emCurso.set(k, estado);
    return {
      ok: true,
      reentrada: false,
      identidade,
      renovar: (prazoDoProximoMs, agoraMs = Date.now()) => renovar(raiz, threadId, estado, prazoDoProximoMs, agoraMs),
      converterEmSessao: (dados) => converter(raiz, k, estado, dados),
      liberar: () => liberarPropria(raiz, k, estado),
      devolver: () => devolverPropria(raiz, threadId, k, estado),
      sucessaoAindaVale: () => sucessaoAindaVale(raiz, threadId, estado),
    };
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* ja fechado */ }
    throw e;
  }
}

function reentrada(identidade: string, sair: () => void,
  renovarExterno: (prazoDoProximoMs: number, agoraMs?: number) => void = () => undefined): ConducaoTomada {
  let saiu = false;
  return {
    ok: true, reentrada: true, identidade,
    renovar: renovarExterno,
    converterEmSessao: () => undefined,
    liberar: () => { if (!saiu) { saiu = true; sair(); } },
    devolver: () => { if (!saiu) { saiu = true; sair(); } },
    sucessaoAindaVale: () => true,
  };
}

/** Ver `ConducaoTomada.sucessaoAindaVale`. Sessao sucedida que voltou a trabalhar derruba a sucessao. */
function sucessaoAindaVale(raiz: string, threadId: string, estado: EmCurso): boolean {
  // S2 do CHECK 6: tomada ja encerrada nao converte mais em sessao; despachar com ela deixaria a sessao sem lease.
  if (estado.encerrada) return false;
  const dono = estado.substituido?.conducao?.dono;
  if (!dono || dono.tipo !== 'sessao' || estado.convertida) return true;
  const r = (estado.consultarSessao ?? consultaNativa)(dono, raiz, threadId);
  // Sem resposta do runtime nao ha prova de que ela segue parada: a sucessao nao vale.
  if (!r.ok) return false;
  // S1 do CHECK 6: a sessao que sumiu do runtime, sem perfil, acabou; a mesma prova de `provaDeFimDaSessao`.
  if (r.estado === null) return !dono.perfil;
  return r.estado === 'blocked' || TERMINAIS.includes(r.estado);
}

function renovar(raiz: string, threadId: string, estado: EmCurso, prazoDoProximoMs: number, agoraMs: number): void {
  if (estado.convertida || estado.encerrada) return;
  const falta = Date.parse(estado.lease.expiraEm) - agoraMs;
  if (falta >= prazoDoProximoMs + MARGEM_DO_PRAZO_MS) return;
  const c = estado.lease.conducao!;
  const renovacoes = (c.renovacoes ?? 0) + 1;
  estado.lease = { ...estado.lease, expiraEm: new Date(agoraMs + prazoDoProximoMs + MARGEM_DO_PRAZO_MS).toISOString(),
    conducao: { ...c, renovacoes, renovadoEm: new Date(agoraMs).toISOString() } };
  regravarLease(raiz, estado.lease);
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.conducaoRenovada, {
    lease: estado.lease.nome, operacao: c.operacao, canal: c.canal, expiraEm: estado.lease.expiraEm, renovacoes,
    razao: 'o prazo que faltava nao cobria o proximo comando: renovado com a operacao viva',
  });
}

function converter(raiz: string, k: string, estado: EmCurso,
  dados: { sessionId: string; runtime: string; perfil: string | null; prazoMs: number }): void {
  if (estado.convertida || estado.encerrada) return;
  const c = estado.lease.conducao!;
  estado.lease = {
    ...estado.lease,
    expiraEm: new Date(Date.now() + dados.prazoMs).toISOString(),
    conducao: { ...c, dono: { tipo: 'sessao', sessionId: dados.sessionId, runtime: dados.runtime, perfil: dados.perfil,
      maquina: nomeDaMaquina() } },
  };
  regravarLease(raiz, estado.lease);
  estado.convertida = true;
  encerrar(k, estado);
}

function devolverPropria(raiz: string, threadId: string, k: string, estado: EmCurso): void {
  const anterior = estado.substituido;
  if (estado.convertida || estado.encerrada || estado.profundidade > 0 || !anterior) { liberarPropria(raiz, k, estado); return; }
  const atual = lerLease(raiz, estado.lease.nome);
  // So devolve por cima do proprio lease: outro dono que tenha chegado depois nunca e sobrescrito.
  if (atual?.conducao?.identidade === estado.identidade && atual.conducao.dono.tipo === 'processo') {
    regravarLease(raiz, anterior);
    const devolvida = conducaoDoLease(anterior);
    registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.conducaoDevolvida, {
      lease: anterior.nome,
      devolvida: devolvida ? { canal: devolvida.canal, sessao: devolvida.sessao, fase: devolvida.fase, desde: devolvida.desde,
        operacao: devolvida.operacao, dono: devolvida.dono } : null,
      razao: 'o pedido foi recusado antes de virar sessao: o lease que a tomada consumiu volta a quem o tinha',
    });
  }
  encerrar(k, estado);
}

function liberarPropria(raiz: string, k: string, estado: EmCurso): void {
  if (estado.convertida || estado.encerrada) return;
  if (estado.profundidade > 0) { estado.profundidade--; return; }
  const atual = lerLease(raiz, estado.lease.nome);
  if (atual?.conducao?.identidade === estado.identidade && atual.conducao.dono.tipo === 'processo') {
    try { fs.unlinkSync(caminhoLease(raiz, estado.lease.nome)); } catch { /* ja saiu */ }
  }
  encerrar(k, estado);
}

/**
 * Registra a conducao da sessao de um despacho que nao tomou o lease antes (chamada direta de
 * `concluirDespacho`). So grava quando nao ha conducao nenhuma: nunca escreve por cima de outra.
 */
export function registrarConducaoDaSessao(raiz: string, threadId: string, pedido: PedidoDeConducao,
  sessao: { sessionId: string; runtime: string; perfil: string | null }): boolean {
  const t = tomarConducao(raiz, threadId, { ...pedido, consultarRuntime: false });
  if (!t.ok) return false;
  if (t.reentrada) { t.liberar(); return false; }
  t.converterEmSessao({ ...sessao, prazoMs: pedido.prazoMs });
  return true;
}

// ---------------------------------------------------------------------------
// A resposta util ao segundo pedido (T12, D2).
// ---------------------------------------------------------------------------

export interface AcaoDaRecusa { acao: 'esperar' | 'acompanhar' | 'assumir'; comando: string; explicacao: string }

export interface RecusaDeConducao {
  contrato: 'ork.conducao-recusa/v1';
  motivo: 'conducao.em-andamento';
  thread: string;
  /** Quem conduz. Null so no instante em que outro processo ainda grava o lease. */
  conducao: (ConducaoAtual & { desdeLocal: string; linha: string }) | null;
  pedido: { canal: CanalDeConducao; operacao: OperacaoDeConducao; fase: Fase | null; promptSha256: string | null };
  acoes: AcaoDaRecusa[];
  texto: string;
}

/** O comando exato de repetir o pedido esperando a vez. */
export function comandoDeEsperar(threadId: string, pedido: Pick<PedidoDeConducao, 'operacao' | 'fase'>): string {
  switch (pedido.operacao) {
    case 'phase.run': return `ork phase run ${threadId} ${pedido.fase ?? '<FASE>'} --prompt "<o mesmo pedido>" --esperar 30`;
    case 'retry.run': return `ork retry run ${threadId} --esperar 30`;
    case 'baseline': return `ork verify ${threadId} --baseline --esperar 30`;
    case 'fix.open': return `ork fix open ${threadId} --esperar 30`;
    case 'fix.reverify': return `ork fix reverify ${threadId} --esperar 30`;
    default: return `ork verify ${threadId} --esperar 30`;
  }
}

/** Como acompanhar quem conduz: o status da conducao e, se for sessao, os logs dela. */
function comandoDeAcompanhar(threadId: string, atual: ConducaoAtual | null): string {
  const base = `ork conducao status ${threadId}`;
  return atual?.sessao ? `${base} && ork sessions logs ${atual.sessao.slice(0, 8)}` : base;
}

/**
 * A recusa, em estrutura e em texto. O dono pediu que ela explique sempre, para um humano, o que
 * aconteceu e o que fazer: o texto sai daqui e de lugar nenhum mais, e o JSON e a mesma estrutura.
 */
export function recusaDeConducao(threadId: string, atual: ConducaoAtual | null, pedido: PedidoDeConducao,
  opcoes: { agora?: string } = {}): RecusaDeConducao {
  const conducao = atual
    ? { ...atual, desdeLocal: formatarDataHoraRotulada(atual.desde, opcoes), linha: linhaDeConducao(atual, opcoes) }
    : null;
  const acoes: AcaoDaRecusa[] = [
    { acao: 'esperar', comando: comandoDeEsperar(threadId, pedido),
      explicacao: 'Esperar a vez: repete este pedido e segue sozinho quando a conducao atual terminar (ate 30 min).' },
    { acao: 'acompanhar', comando: comandoDeAcompanhar(threadId, atual),
      explicacao: 'Acompanhar quem conduz, sem mexer em nada.' },
    { acao: 'assumir', comando: `ork conducao assumir ${threadId} --por <voce> --motivo "<por que>"`,
      explicacao: 'Assumir a conducao: encerra a atual pelo proprio runtime e registra no ledger quem assumiu, de qual canal e por que.' },
  ];
  const linhas = [
    `Pedido nao executado: a thread ${threadId} ja esta sendo conduzida agora, e duas execucoes na mesma worktree ` +
      'se corrompem (foi o que aconteceu em 19/09/2026).',
  ];
  if (conducao) {
    linhas.push(`  Quem conduz: canal ${conducao.canal}, ${quemConduz(conducao)}, fase ${conducao.fase ?? '-'}, desde ${conducao.desdeLocal}.`);
    if (conducao.promptSha256) linhas.push(`  Pedido em curso: prompt sha256 ${conducao.promptSha256.slice(0, 12)}.`);
  } else {
    linhas.push('  Outra operacao esta tomando a conducao neste instante; o registro dela ainda nao apareceu.');
  }
  linhas.push(`  Pedido recusado: ${NOME_DA_OPERACAO[pedido.operacao]}${pedido.fase ? ` da fase ${pedido.fase}` : ''}, pelo canal ${pedido.canal}.`);
  linhas.push('O que voce pode fazer:');
  acoes.forEach((a, i) => { linhas.push(`  ${i + 1}. ${a.explicacao}`); linhas.push(`     ${a.comando}`); });
  return {
    contrato: 'ork.conducao-recusa/v1',
    motivo: 'conducao.em-andamento',
    thread: threadId,
    conducao,
    pedido: { canal: pedido.canal, operacao: pedido.operacao, fase: pedido.fase ?? null, promptSha256: pedido.promptSha256 ?? null },
    acoes,
    texto: linhas.join('\n'),
  };
}

/**
 * O pedido repetido (T14): a mesma fase com o mesmo prompt de quem ja conduz. Nada foi despachado,
 * e o texto diz onde acompanhar a sessao que ja atende o pedido.
 */
export function textoDoPedidoRepetido(threadId: string, atual: ConducaoAtual, opcoes: { agora?: string } = {}): string {
  return [
    `Pedido ja em andamento: a fase ${atual.fase ?? '-'} da thread ${threadId} roda com este mesmo prompt ` +
      `(sha256 ${(atual.promptSha256 ?? '').slice(0, 12)}) desde ${formatarDataHoraRotulada(atual.desde, opcoes)}. ` +
      'Nenhuma sessao nova foi aberta e nenhuma cota foi gasta.',
    `  ${linhaDeConducao(atual, opcoes)}`,
    `  acompanhar: ${comandoDeAcompanhar(threadId, atual)}`,
  ].join('\n');
}

/** A recusa tipada como erro, para quem nao tem um resultado estruturado onde devolve-la. */
export class ErroDeConducao extends Error {
  readonly recusa: RecusaDeConducao;
  constructor(recusa: RecusaDeConducao) {
    super(`conducao.em-andamento: ${recusa.texto}`);
    this.name = 'ErroDeConducao';
    this.recusa = recusa;
  }
}

/** Grava a recusa no ledger: o segundo pedido deixa rastro, que era o que faltava em 19/09. */
export function registrarRecusa(raiz: string, recusa: RecusaDeConducao): void {
  try {
    registrar(dirThread(raiz, recusa.thread), recusa.thread, TIPOS_DE_EVENTO.conducaoRecusada, {
      motivo: recusa.motivo,
      pedido: recusa.pedido,
      conducao: recusa.conducao ? { canal: recusa.conducao.canal, sessao: recusa.conducao.sessao, fase: recusa.conducao.fase,
        desde: recusa.conducao.desde, operacao: recusa.conducao.operacao, promptSha256: recusa.conducao.promptSha256 } : null,
    });
  } catch { /* a recusa ao pedido vale mesmo sem o registro */ }
}

/**
 * Roda a operacao de processo sob a conducao da thread (T4, T5). Sem a conducao, nada executa: a
 * recusa sai como `ErroDeConducao`. Com `esperarMs`, espera a vez por sondagem ate o prazo.
 */
export function comConducao<T>(raiz: string, threadId: string, pedido: PedidoDeConducao & { esperarMs?: number },
  executar: (conducao: ConducaoTomada) => T): T {
  const prazo = pedido.esperarMs && pedido.esperarMs > 0 ? Date.now() + pedido.esperarMs : null;
  for (;;) {
    const t = tomarConducao(raiz, threadId, pedido);
    if (t.ok) {
      try { return executar(t); }
      finally { t.liberar(); }
    }
    if (!prazo || Date.now() >= prazo) {
      const recusa = recusaDeConducao(threadId, t.atual, pedido);
      registrarRecusa(raiz, recusa);
      throw new ErroDeConducao(recusa);
    }
    dormir(Math.min(2000, prazo - Date.now()));
  }
}

/** Espera, sem tomar nada, ate nao haver conducao ou acabar o prazo. Devolve se liberou. */
export function esperarConducaoLivre(raiz: string, threadId: string, esperarMs: number): boolean {
  const prazo = Date.now() + esperarMs;
  for (;;) {
    if (!conducaoDaThread(raiz, threadId)) return true;
    if (Date.now() >= prazo) return false;
    dormir(Math.min(2000, prazo - Date.now()));
  }
}

// ---------------------------------------------------------------------------
// Recuperacao de orfa (T16) e handoff (T15).
// ---------------------------------------------------------------------------

/**
 * Libera a conducao que nao tem mais dono vivo, com a prova (D7). Nao conclui fase: a liberacao
 * so apaga o lease e registra; `phase_result` continua sendo gravado so pela prova da I-34.
 */
export function liberarSeOrfa(raiz: string, threadId: string,
  opcoes: Pick<PedidoDeConducao, 'consultarRuntime' | 'consultarSessao'> = {}): { liberada: boolean; detalhe: string } {
  const antes = lerLease(raiz, nomeDaConducao(threadId));
  if (!antes) return { liberada: false, detalhe: 'nenhuma conducao registrada' };
  const fd = tentarTrava(raiz, threadId);
  if (fd === null) return { liberada: false, detalhe: 'um processo vivo segura a conducao' };
  try {
    const ocupada = avaliarComTrava(raiz, threadId, { canal: 'cli', operacao: 'verify', prazoMs: 0, ...opcoes }, { usarReserva: false });
    return ocupada ? { liberada: false, detalhe: 'a conducao tem dono vivo' } : { liberada: true, detalhe: 'conducao sem dono liberada, com prova no ledger' };
  } finally { fs.closeSync(fd); }
}

export interface ResultadoDoHandoff {
  ok: boolean;
  thread: string;
  anterior: ConducaoAtual | null;
  mecanismo: string;
  detalhe: string;
}

/** O estado da worktree no handoff: o que ficou alterado, para quem assume saber. */
function estadoDaWorktree(raiz: string, threadId: string): { head: string | null; alterados: string[] } {
  try {
    const t = lerThread(raiz, threadId);
    const dir = t.worktree ?? raiz;
    const head = exec('git', ['rev-parse', 'HEAD'], dir);
    const st = exec('git', ['status', '--porcelain'], dir);
    return { head: head.ok ? head.stdout.trim() : null, alterados: st.ok ? st.stdout.split('\n').filter(Boolean).slice(0, 40) : [] };
  } catch { return { head: null, alterados: [] }; }
}

/** O controle que encerra a sessao: consultar e parar pelo mecanismo homologado do runtime (D8). */
export type ControleDoHandoff = (runtime: string, raiz: string, threadId: string, sessionId: string) => {
  consultar(): { ok: boolean; sessoes: { sessionId: string; estado: string }[] };
  parar(s: { sessionId: string; estado: string }): boolean;
};

const controleNativoDoHandoff: ControleDoHandoff = (runtime, raiz, threadId, sessionId) => {
  const { controleNativo } = require('./hitl-sessions') as typeof import('./hitl-sessions');
  const ctl = controleNativo(runtime, raiz, threadId, sessionId);
  return {
    consultar: () => ctl.consultar(),
    parar: (s) => ctl.parar(s as Parameters<typeof ctl.parar>[0]),
  };
};

/**
 * A fonte fixada pelo sensor contém a identidade capturada no spawn, não um PID descoberto.
 * Sem as duas ausências provadas, a recuperação continua dependendo do runtime homologado.
 * Quem chama segura a trava da condução; nenhum prazo ou heartbeat autoriza esta soltura.
 */
function morteLocalDoCodex(raiz: string, threadId: string, lease: Lease): Record<string, unknown> | null {
  const dono = lease.conducao?.dono;
  if (dono?.tipo !== 'sessao' || dono.runtime !== 'codex' || dono.maquina !== nomeDaMaquina()) return null;
  try {
    const t = lerThread(raiz, threadId), sessao = t.sessoes.at(-1);
    if (!sessao || sessao.sessionId !== dono.sessionId || sessao.runtime !== 'codex' || !sessao.despachadaEm ||
        sessao.fase !== lease.conducao?.fase || sessao.promptSha256 !== lease.conducao?.promptSha256) return null;
    const dir = dirThread(raiz, threadId), eventos = lerLedger(dir);
    const mesmo = (e: EventoLedger) => e.sessionId === dono.sessionId && e.despachoEm === sessao.despachadaEm;
    const watcher = eventos.filter(e => e.tipo === 'session_watcher_started' && mesmo(e)).at(-1);
    const identidade = watcher?.identidade as IdentidadeProcesso | undefined;
    if (!identidade || watcher?.pid !== identidade.pid || estadoProcesso(identidade) !== 'ausente') return null;
    const registro = eventos.filter(e => e.tipo === 'session_sensor_registered' && mesmo(e)).at(-1);
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === dono.sessionId).at(-1);
    if (!registro || typeof registro.controlador !== 'string' || typeof registro.cwd !== 'string' ||
        registro.logPath || registro.processoPath || registro.reciboPath || registro.nativo ||
        despacho?.controlador !== registro.controlador || despacho.cwd !== registro.cwd ||
        (sessao.controlador && sessao.controlador !== registro.controlador)) return null;
    const chave = createHash('sha256').update(dono.sessionId + '|' + sessao.despachadaEm).digest('hex');
    const fixacao = path.join(dir, 'sessoes', `watcher-source-${chave}.json`);
    // Recuperação não cria uma fonte nova nem depende do state.json mutável de um controller morto.
    if (!fs.existsSync(fixacao)) return null;
    const { registrarFonteController } = require('./adapters/codex-controller-sensor') as typeof import('./adapters/codex-controller-sensor');
    const fonte = registrarFonteController(registro.controlador, { dirSessoes: path.join(dir, 'sessoes'), fixacao,
      sessionId: dono.sessionId, cwd: registro.cwd, despachoEm: sessao.despachadaEm,
      vinculo: { thread: threadId, fase: sessao.fase, promptSha256: sessao.promptSha256 } });
    const controller = fonte.processoController;
    if (!controller || estadoProcesso({ pid: controller.pid, inicio: controller.inicio, boot: controller.bootId }) !== 'ausente') return null;
    return { sessionId: dono.sessionId, despachoEm: sessao.despachadaEm, fase: sessao.fase, runtime: 'codex',
      origem: 'conducao.assumir', motivo: 'watcher-e-controlador-ausentes',
      prova: { fonte: 'session_sensor_registered+controller-source-pin+/proc',
        registroEventId: registro.eventId, watcherEventId: watcher!.eventId,
        watcher: identidade, controlador: { pid: controller.pid, inicio: controller.inicio, boot: controller.bootId,
          uid: controller.uid }, estadoWatcher: 'ausente', estadoControlador: 'ausente' } };
  } catch { return null; } // Fonte ilegível, divergente ou identidade desconhecida nunca prova morte.
}

/**
 * `ork conducao assumir` (T15): encerra a conducao atual pelo mecanismo suportado do runtime, toma
 * uma reserva curta para o canal de quem assumiu e registra quem, de qual canal e por que. Processo
 * local vivo nao e encerrado por sinal (D8): o handoff recusa e diz como esperar.
 */
export function assumirConducao(raiz: string, threadId: string,
  opcoes: { por: string; motivo: string; canal: CanalDeConducao; controle?: ControleDoHandoff; consultarSessao?: ConsultaDeSessao }): ResultadoDoHandoff {
  const por = opcoes.por.trim(), motivo = opcoes.motivo.trim();
  if (!por) throw new Error('conducao.assumir: informe --por <quem assume>');
  if (!motivo) throw new Error('conducao.assumir: informe --motivo; handoff sem razao registrada e o mesmo kill de antes, com outro nome');
  const dir = dirThread(raiz, threadId);
  lerThread(raiz, threadId);
  // A prova local vem antes de qualquer consulta ao runtime; ledger ainda libera sessões terminadas.
  liberarSeOrfa(raiz, threadId, { consultarRuntime: false });
  const fd = tentarTrava(raiz, threadId);
  if (fd === null) {
    const atual = conducaoDaThread(raiz, threadId);
    return { ok: false, thread: threadId, anterior: atual, mecanismo: 'nenhum',
      detalhe: `a conducao atual e um processo local vivo (${atual ? quemConduz(atual) : 'gravando o lease'}), que termina sozinho. ` +
        `O handoff nao envia sinal ao processo: espere com ${atual ? comandoDeEsperar(threadId, { operacao: atual.operacao, fase: atual.fase }) : '--esperar'}, ` +
        'ou encerre-o no canal de onde ele saiu.' };
  }
  try {
    const lease = lerLease(raiz, nomeDaConducao(threadId));
    const anterior = lease ? conducaoDoLease(lease) : null;
    let mecanismo = 'nenhum: nao havia conducao em andamento';
    let prova = 'lease exec ausente';
    if (lease && anterior?.dono.tipo === 'sessao') {
      const dono = anterior.dono;
      const morte = morteLocalDoCodex(raiz, threadId, lease);
      if (morte) {
        registrar(dir, threadId, 'sessao_morta', morte);
        mecanismo = 'recuperação local: watcher e controlador ausentes por identidade';
        prova = 'ledger: sessao_morta com identidades capturadas e ausência conferida no kernel';
      } else {
        const ctl = (opcoes.controle ?? controleNativoDoHandoff)(dono.runtime, raiz, threadId, dono.sessionId);
        const antes = ctl.consultar();
        if (!antes.ok) {
          return { ok: false, thread: threadId, anterior, mecanismo: 'nenhum',
            detalhe: 'runtime.unavailable: nao consegui consultar a sessao no runtime; nada foi encerrado e a conducao segue com ela' };
        }
        const s = antes.sessoes.find((x) => x.sessionId === dono.sessionId);
        if (s && !TERMINAIS.includes(s.estado)) {
          if (!ctl.parar(s)) {
            return { ok: false, thread: threadId, anterior, mecanismo: `parar ${dono.runtime}`,
              detalhe: `runtime.unavailable: o runtime ${dono.runtime} nao confirmou o encerramento; a conducao segue com a sessao ${dono.sessionId.slice(0, 8)}` };
          }
          const depois = ctl.consultar();
          const ainda = depois.ok ? depois.sessoes.find((x) => x.sessionId === dono.sessionId) : s;
          if (!depois.ok || (ainda && !TERMINAIS.includes(ainda.estado))) {
            return { ok: false, thread: threadId, anterior, mecanismo: `parar ${dono.runtime}`,
              detalhe: 'runtime.unavailable: a consulta depois do encerramento nao confirma a sessao parada; o lease foi mantido' };
          }
          mecanismo = `parar pelo runtime ${dono.runtime} (controle homologado)`;
          prova = `runtime: ${s.estado} -> ${ainda?.estado ?? 'ausente'}`;
        } else {
          mecanismo = 'nenhum: a sessao ja tinha terminado';
          prova = `runtime: ${s?.estado ?? 'sessao ausente'}`;
        }
      }
    } else if (lease && anterior?.dono.tipo === 'reserva') {
      mecanismo = `reserva de ${anterior.dono.por} substituida`;
      prova = `reserva do canal ${anterior.canal}`;
    }
    if (lease) { try { fs.unlinkSync(caminhoLease(raiz, lease.nome)); } catch { /* ja saiu */ } }
    const reserva: Lease = {
      nome: nomeDaConducao(threadId), thread: threadId, motivo: `reserva de ${por} ao assumir: ${motivo}`, pid: process.pid,
      adquiridoEm: agora(), expiraEm: new Date(Date.now() + PRAZO_DA_RESERVA_MS).toISOString(),
      conducao: { contrato: 'ork.conducao/v1', canal: opcoes.canal, correlacao: null, operacao: 'handoff', fase: null,
        promptSha256: null, identidade: randomUUID(), dono: { tipo: 'reserva', por, maquina: nomeDaMaquina() } },
    };
    regravarLease(raiz, reserva);
    registrar(dir, threadId, TIPOS_DE_EVENTO.conducaoAssumida, {
      por, canal: opcoes.canal, motivo, mecanismo, prova,
      anterior: anterior ? { canal: anterior.canal, sessao: anterior.sessao, fase: anterior.fase, desde: anterior.desde,
        operacao: anterior.operacao, promptSha256: anterior.promptSha256 } : null,
      reservaAte: reserva.expiraEm,
      worktree: estadoDaWorktree(raiz, threadId),
    });
    return { ok: true, thread: threadId, anterior, mecanismo,
      detalhe: `conducao assumida por ${por} pelo canal ${opcoes.canal}; a proxima operacao desse canal usa a reserva ate ` +
        `${formatarDataHoraRotulada(reserva.expiraEm)}` };
  } finally { fs.closeSync(fd); }
}

/** Texto de `ork conducao status`. */
export function textoDoStatusDaConducao(threadId: string, atual: ConducaoAtual | null): string {
  if (!atual) return `Thread ${threadId}: ninguem conduz agora. Qualquer canal pode despachar ou verificar.`;
  const linhas = [`Thread ${threadId}: ${linhaDeConducao(atual)}`];
  if (atual.promptSha256) linhas.push(`  prompt sha256 ${atual.promptSha256.slice(0, 12)}`);
  linhas.push(`  prazo do lease (metadado, nao prova): ${formatarDataHoraRotulada(atual.expiraEm)}`);
  if (atual.sessao) linhas.push(`  acompanhar: ork sessions logs ${atual.sessao.slice(0, 8)}`);
  linhas.push(`  assumir: ork conducao assumir ${threadId} --por <voce> --motivo "<por que>"`);
  return linhas.join('\n');
}
