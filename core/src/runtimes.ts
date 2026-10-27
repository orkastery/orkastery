/**
 * Registro dos runtimes de despacho homologados.
 *
 * O nucleo despacha fase por um runtime adapter resolvido POR NOME, e este arquivo e o
 * domicilio unico dessa resolucao (decisao D1 da thread ork-homologarcod). Dois runtimes
 * homologados:
 *
 *   claude-bg  o PADRAO, mais maduro: `claude --bg`, sessao visivel no app e em
 *              `claude agents --json` (homologado em 02/09/2026).
 *   codex      o segundo runtime: `codex exec` headless desanexado, sessao verificada no
 *              rollout que o proprio Codex grava (homologado em 06/09/2026).
 *   grok       RM-067 (F1 e F2): o Grok Build headless, `grok -p` com `streaming-json`, sessao
 *              verificada na pasta que o proprio runtime grava. So por pedido explicito
 *              (`--runtime grok`): nunca padrao de bloco nem alvo de fallback (D1 da ork-grokbuild).
 *
 * Paridade sem downgrade: o contrato do claude-bg nao muda com a chegada do codex, e todo
 * runtime novo entra por aqui com o MESMO contrato de despacho (dry-run, rate limit
 * reconhecido, re-verificacao externa, nunca self-report).
 */

import * as claudeBg from './adapters/claude-bg';
import * as codex from './adapters/codex';
import * as grok from './adapters/grok';
import type { ContextoRuntime } from './runtime-context';
import { prepararRecibosParaDespacho } from './hitl-ingress-receipt';
import type { PerfilDeDespacho } from './runtime-profiles';
import { ErroDoCatalogo } from './locale';

/** Pedido de despacho comum aos runtimes (os campos extras sao ignorados por quem nao usa). */
export interface PedidoDeDespacho {
  contextoRuntime?: ContextoRuntime;
  vinculo?: codex.DespachoCodexPedido['vinculo'];
  /** Perfil nativo do turno. PLAN usa o modo de planejamento dos dois runtimes. */
  colaboracao?: 'plan' | 'default';
  /** Schema fechado da resposta final, consumido pelo app-server Codex. */
  outputSchema?: Record<string, unknown>;
  /** CHECK nativo do Codex contra a base confiavel da thread. */
  reviewBaseBranch?: string;
  prompt: string;
  /** Nome/slug da sessao, visivel no runtime (`--name` no claude, nome do log no codex). */
  nome: string;
  cwd: string;
  model?: string;
  effort?: string;
  dryRun?: boolean;
  /** Sandbox do codex (`read-only` | `workspace-write` | `danger-full-access`). */
  sandbox?: string;
  /** Diretorio dos logs de despacho do codex (padrao: o proprio cwd). */
  logDir?: string;
  /** Limite temporal do bloco quando o transporte consegue interromper o turno. */
  duracaoMaximaMs?: number;
  /**
   * I-33 (D2): perfil de conta do despacho. O adapter monta o env do filho a partir dele
   * (claude-bg: `CLAUDE_CONFIG_DIR`; codex: `CODEX_HOME`) e reverifica pela mesma conta.
   * Ausente, o despacho usa o ambiente do processo, exatamente como antes (P8).
   */
  perfil?: PerfilDeDespacho;
  /**
   * I-36 (D4): variaveis que o despacho acrescenta ao ambiente da sessao filha: a identidade do
   * despacho, a thread e o canal de origem. E por elas que o CLI de dentro da sessao reentra na
   * conducao que ela mesma segura. Nenhuma concede autoridade.
   */
  ambienteExtra?: Record<string, string>;
}

/** Resultado de despacho comum aos runtimes. */
export interface ResultadoDeDespacho extends claudeBg.DespachoResultado {
  controlador?: string;
  /** Log JSONL do despacho desanexado (so o codex escreve um). */
  logPath?: string;
  processoPath?: string;
  reciboPath?: string;
}

export interface RuntimeAdapter {
  nome: string;
  /** De onde vem a prova de que a sessao existe (vai ao evento `phase_dispatch_verified`). */
  fonteVerificacao: string;
  disponivel(): string | null;
  versao(): string | null;
  montarComando(pedido: PedidoDeDespacho): string[];
  despachar(pedido: PedidoDeDespacho): ResultadoDeDespacho;
}

export const RUNTIME_PADRAO = 'claude-bg';

/** Phase e retry atravessam o mesmo preparo, antes de retirar segredos do filho. */
function comRecibosPublicos(p: PedidoDeDespacho, dispatch: (p: PedidoDeDespacho) => ResultadoDeDespacho): ResultadoDeDespacho {
  if (!p.dryRun && p.vinculo) {
    try { prepararRecibosParaDespacho(p.contextoRuntime?.projeto ?? p.cwd, p.vinculo.thread); }
    catch { return { ok: false, comando: [], sessionId: null, verificada: false,
      stdout: '', stderr: '', erro: 'hitl.receipt.prepare-unavailable: despacho não iniciado' }; }
  }
  return dispatch(p);
}

export const RUNTIMES: Readonly<Record<string, RuntimeAdapter>> = {
  'claude-bg': {
    nome: claudeBg.NOME_ADAPTER,
    fonteVerificacao: 'claude agents --json',
    disponivel: claudeBg.disponivel,
    versao: claudeBg.versao,
    montarComando: (p) => claudeBg.montarComando(p),
    despachar: (p) => comRecibosPublicos(p, claudeBg.despachar),
  },
  codex: {
    nome: codex.NOME_ADAPTER,
    fonteVerificacao: 'rollout do codex em $CODEX_HOME/sessions',
    disponivel: codex.disponivel,
    versao: codex.versao,
    montarComando: (p) => codex.montarComando(p),
    despachar: (p) => comRecibosPublicos(p, codex.despachar),
  },
  grok: {
    nome: grok.NOME_ADAPTER,
    fonteVerificacao: grok.FONTE_VERIFICACAO,
    disponivel: () => grok.disponivel(),
    versao: grok.versao,
    montarComando: (p) => grok.montarComando(p),
    despachar: (p) => comRecibosPublicos(p, grok.despachar),
  },
};

/**
 * Os runtimes de bloco, na ordem de maturidade (o padrao primeiro): os unicos que o setup aceita
 * como runtime ou fallback de bloco e o manifesto aceita em `runtime.adapter`.
 */
export const ORDEM_DOS_RUNTIMES: readonly string[] = ['claude-bg', 'codex'];

/**
 * RM-067 (D1 da ork-grokbuild): homologados so para despacho explicito (`ork phase run --runtime`). Resolvem por nome,
 * mas nao sao padrao de bloco, nem fallback, nem `runtime.adapter`.
 */
export const RUNTIMES_SO_POR_PEDIDO: readonly string[] = ['grok'];

/** O nome e de um runtime homologado (resolve por nome no despacho)? */
export function runtimeConhecido(nome: string): boolean {
  return Object.prototype.hasOwnProperty.call(RUNTIMES, nome);
}

/** O runtime pode ser runtime de bloco, fallback ou `runtime.adapter` do manifesto? */
export function runtimeDeBloco(nome: string): boolean {
  return ORDEM_DOS_RUNTIMES.includes(nome);
}

/** Resolve o adapter pelo nome, com erro tipado quando o runtime nao existe. */
export function resolverRuntime(nome: string): RuntimeAdapter {
  const adapter = runtimeConhecido(nome) ? RUNTIMES[nome] : undefined;
  if (!adapter) {
    throw new ErroDoCatalogo((m) => m.phase.runtimeDesconhecido(nome, [...ORDEM_DOS_RUNTIMES, ...RUNTIMES_SO_POR_PEDIDO].join(', ')));
  }
  return adapter;
}
