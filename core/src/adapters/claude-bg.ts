/**
 * Adapter de runtime `claude-bg`: despacha fases como BACKGROUND AGENT do Claude Code.
 *
 * Mecanismo validado em producao (02/09) e os dois pitfalls que ele evita:
 *   - `claude -p` e efemero e invisivel no app e no `claude agents`. NUNCA usar.
 *   - `claude remote-control --spawn=session` trava sem registrar a sessao. NUNCA usar.
 * O que vale: `claude --bg "<prompt>" --name <slug>` rodando com cwd no diretorio do projeto,
 * o que deixa a sessao visivel no app Claude e no `claude agents --json`.
 */

import { SessaoRuntime, SinalDeFalhaDeConta, SinalDeRateLimit } from '../types';
import { exec as executar, noPath } from '../util';
import { ambienteDeAssinatura } from '../runtime-ambiente';
import * as path from 'node:path';
import { ContextoRuntime, validarContextoRuntime } from '../runtime-context';
import { ambienteComPerfil, diretorioEfetivo, PerfilDeDespacho } from '../runtime-profiles';

function exec(cmd: string, args: string[], cwd?: string, timeoutMs?: number, ambiente: NodeJS.ProcessEnv = ambienteDeAssinatura()) {
  return executar(cmd, args, cwd, timeoutMs, ambiente);
}

/**
 * I-33 (D2): ambiente do filho com o `CLAUDE_CONFIG_DIR` do perfil sobre a assinatura
 * higienizada (sem provider pago). Sem perfil, o ambiente do processo, como antes da I-33.
 * A mesma conta despacha, reverifica, consulta, le logs e para a sessao.
 */
export function ambienteDoPerfil(perfil?: PerfilDeDespacho | null): NodeJS.ProcessEnv {
  if (perfil && (perfil.runtime !== 'claude-bg' || !perfil.configDir))
    throw new Error('runtime.profiles.invalid: perfil sem CLAUDE_CONFIG_DIR no despacho claude-bg');
  return ambienteComPerfil(ambienteDeAssinatura(), perfil);
}

export const NOME_ADAPTER = 'claude-bg';

/** RM-037 (defeitosdeco D-4): o ambiente do `claude --bg` sem canal nem chave do contexto do despacho. */
export function semContextoDeDespacho(base: NodeJS.ProcessEnv, contexto?: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ORK_CANAL;
  for (const chave of Object.keys(contexto ?? {})) delete env[chave];
  return env;
}

/** Consultas do perfil interactive; gates e respostas humanas nunca recebem grant. */
const CONSULTAS_MCP = [
  'mcp__orkastery__ork_thread_status',
  'mcp__orkastery__ork_phase_list',
  'mcp__orkastery__ork_hitl_pending',
  'mcp__orkastery__ork_observe',
  'mcp__orkastery__ork_artifact_read',
  'mcp__orkastery__ork_claims_list',
] as const;
const MUTACOES_WORKTREE = [
  'mcp__orkastery__ork_artifact_write', 'mcp__orkastery__ork_claim_add',
  'mcp__orkastery__ork_git_commit', 'mcp__orkastery__ork_verify', 'mcp__orkastery__ork_ship',
] as const;

/** Regras nativas de arquivo, nao sandbox de processos. Edit tambem cobre Write. */
function permissoesDaWorktree(cwd: string, permiteEditarProduto: boolean): { allow: string[]; deny: string[] } {
  if (!path.isAbsolute(cwd) || cwd === '/' || path.normalize(cwd) !== cwd || !/^[A-Za-z0-9_./-]+$/.test(cwd))
    throw Error('runtime.context.permissions: worktree contem caracteres ambiguos para regras nativas; use caminho sem glob, espacos ou delimitadores');
  const absoluto = '/' + cwd; // Claude exige // para caminho absoluto.
  const deny: string[] = [];
  for (const nome of ['.git', '.orkastery', '.claude', '.codex', '.agents', '.env', '.env*']) {
    for (const prefixo of [`${absoluto}/${nome}`, `${absoluto}/**/${nome}`])
      deny.push(`Edit(${prefixo})`, `Edit(${prefixo}/**)`);
  }
  return { allow: [...CONSULTAS_MCP, 'mcp__orkastery__ork_git_status', ...MUTACOES_WORKTREE, ...(permiteEditarProduto ? [`Edit(${absoluto}/**)`] : [])], deny };
}

export interface DespachoPedido {
  contextoRuntime?: ContextoRuntime;
  colaboracao?: 'plan' | 'default';
  prompt: string;
  /** Vira `--name`, entao o slug de 3 partes aparece no app e no `claude agents`. */
  nome: string;
  /** Diretorio onde a sessao roda (raiz do projeto ou worktree da thread). */
  cwd: string;
  model?: string;
  effort?: string;
  /** Quando true, monta o comando e nao executa nada. */
  dryRun?: boolean;
  /** I-33 (D2): perfil de conta do despacho; ausente, vale o ambiente do processo. */
  perfil?: PerfilDeDespacho;
  /** I-36 (D4): identidade, thread e canal do despacho no ambiente da sessao filha. */
  ambienteExtra?: Record<string, string>;
}

export interface DespachoResultado {
  ok: boolean;
  comando: string[];
  sessionId: string | null;
  /** Sessao encontrada no `claude agents --json` apos o despacho (re-verificacao). */
  verificada: boolean;
  stdout: string;
  stderr: string;
  erro?: string;
  /** Bloco B3: rate limit reconhecido na saida real, com o horario de reset quando ha. */
  rateLimit?: SinalDeRateLimit | null;
  /** I-33 (D1): cota esgotada ou auth ausente da conta, mais especifica que o rate limit. */
  falhaDeConta?: SinalDeFalhaDeConta | null;
}

/** O runtime esta disponivel nesta maquina? */
export function disponivel(): string | null {
  return noPath('claude');
}

/** Versao do runtime, para o `ork doctor`. */
export function versao(): string | null {
  const r = exec('claude', ['--version'], undefined, 30000);
  return r.ok ? r.stdout.trim() : null;
}

/** Ferramentas de arquivo negadas no PLAN: o plano sai pelo núcleo, não pelo disco. */
const ESCRITA_DE_ARQUIVO = ['Edit', 'Write', 'NotebookEdit'] as const;

/** Monta a linha de comando exata do despacho (usada tambem pelo `--dry-run`). */
export function montarComando(pedido: DespachoPedido): string[] {
  const args = ['--bg', pedido.prompt, '--name', pedido.nome];
  // I-34 (D6): plan mode em `--bg` desabilita ExitPlanMode, grava o plano em ~/.claude/plans
  // e bloqueia ork_artifact_write. O PLAN roda como sessão comum, sem escrita de arquivo e
  // com o artefato gravado pelo núcleo; o agente `ork-plan` não lista ferramentas MCP.
  const plano = pedido.colaboracao === 'plan';
  if (pedido.model) args.push('--model', pedido.model);
  if (pedido.effort) args.push('--effort', pedido.effort);
  // RM-037 (defeitosdeco D-4): o contexto do despacho (identidade, thread, canal) chega POR SESSAO.
  // O `claude --bg` entrega a sessao a um processo reserva do daemon da conta, e o daemon guarda o
  // ambiente de quem o iniciou: pelo ambiente, a sessao nascia com a identidade de outro despacho.
  // Medido em 28/09/2026 (2.1.284): o `env` de `--settings` chega ao Bash da sessao e vence o herdado.
  const doDespacho = pedido.ambienteExtra ?? {};
  if (Object.keys(doDespacho).length) args.push('--settings', JSON.stringify({ env: doDespacho }));
  if (pedido.contextoRuntime) {
    if (pedido.contextoRuntime.host !== 'claude-code') throw Error('runtime.context.invalid: host Claude esperado');
    const contexto = validarContextoRuntime(pedido.contextoRuntime, pedido.cwd);
    // Somente o servidor gerado: nao mesclar MCP de outros escopos nesta sessao filha.
    const permissoes = contexto.permissoesFilho === 'worktree'
      ? permissoesDaWorktree(pedido.cwd, contexto.permiteEditarProduto && !plano) : null;
    // PLAN não implementa: nem commit, nem claim, nem verify, nem ship, em nenhum perfil.
    const allow = plano ? [...CONSULTAS_MCP, 'mcp__orkastery__ork_artifact_write'] : permissoes?.allow ?? [...CONSULTAS_MCP];
    const deny = [...(plano ? ESCRITA_DE_ARQUIVO : []), ...(permissoes?.deny ?? [])];
    args.push('--plugin-dir', contexto.instalacao, '--strict-mcp-config',
      '--mcp-config', JSON.stringify({ mcpServers: { orkastery: contexto.servidor } }),
      '--allowedTools', allow.join(','));
    if (deny.length) args.push('--disallowedTools', deny.join(','));
  } else if (plano) args.push('--disallowedTools', ESCRITA_DE_ARQUIVO.join(','));
  return ['claude', ...args];
}

/**
 * Extrai o identificador da sessao da saida do `claude --bg`.
 * Aceita UUID completo ou o id curto que o CLI imprime.
 */
export function extrairSessionId(saida: string): string | null {
  const uuid = saida.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const curto = saida.match(/\b[0-9a-f]{8}\b/i);
  return curto ? curto[0] : null;
}

/**
 * Lista as sessoes vivas do runtime. Fonte da verdade externa, nunca self-report.
 *
 * O filtro por diretorio e feito aqui, e nao pelo `--cwd` do `claude agents`: medido
 * em 02/09/2026 na versao 2.1.259, `claude agents --json --cwd <raiz>` devolve lista
 * vazia mesmo com sessoes vivas naquele diretorio.
 */
export function listarSessoes(cwd?: string, todas = false, ambiente: NodeJS.ProcessEnv = ambienteDeAssinatura()): SessaoRuntime[] {
  return consultarSessoes(cwd, todas, ambiente).sessoes;
}

export interface ConsultaDeSessoes { ok: boolean; sessoes: SessaoRuntime[]; detalhe: string }

/** Falha de consulta não pode ser confundida com uma máquina sem sessões. */
export function consultarSessoes(cwd?: string, todas = false, ambiente: NodeJS.ProcessEnv = ambienteDeAssinatura()): ConsultaDeSessoes {
  const args = ['agents', '--json'];
  if (todas) args.push('--all');
  const r = exec('claude', args, undefined, 60000, ambiente);
  if (!r.ok) return { ok: false, sessoes: [], detalhe: `claude agents falhou (código ${r.code})` };
  let dados: SessaoRuntime[];
  try {
    const bruto = JSON.parse(r.stdout) as SessaoRuntime[];
    if (!Array.isArray(bruto) || bruto.some(s => !s || typeof s !== 'object' ||
      typeof s.sessionId !== 'string' || !/^[a-f0-9-]{8,}$/i.test(s.sessionId) ||
      typeof s.cwd !== 'string' || !path.isAbsolute(s.cwd) ||
      (s.state !== undefined && typeof s.state !== 'string') ||
      (s.status !== undefined && typeof s.status !== 'string')) ||
      new Set(bruto.map(s => s.sessionId)).size !== bruto.length) throw new Error('formato inválido');
    dados = bruto;
  } catch {
    return { ok: false, sessoes: [], detalhe: 'claude agents respondeu JSON inválido' };
  }
  if (!cwd) return { ok: true, sessoes: dados, detalhe: '' };
  const raiz = cwd.replace(/\/$/, '');
  return { ok: true, sessoes: dados.filter((s) => s.cwd === raiz || (s.cwd ?? '').startsWith(raiz + '/')), detalhe: '' };
}

/** Registro nativo com os campos que só existem enquanto o processo vive (`pid`, `status`). */
export interface RegistroAgenteClaude {
  sessionId: string; cwd: string; id?: string; name?: string; kind?: string;
  state?: string; status?: string; pid?: number; startedAt?: number;
}
export interface ConsultaAgentesNativos { ok: boolean; registros: RegistroAgenteClaude[]; detalhe: string; consultadoEm: string }

const UUID_CLAUDE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LIMITE_CONSULTA_BYTES = 1024 * 1024;

/**
 * I-34 (D5): fonte nativa da conclusão claude-bg. Sem `--cwd`: medido em 19/09/2026 na
 * versão 2.1.278, `--cwd <worktree>` devolveu `[]` com a sessão viva ali. `--all` traz
 * sessões de todos os projetos, então só `sessionId` UUID e `cwd` absoluto são exigidos por
 * registro: campo de tipo inesperado vira ausente (estado ausente não conclui nada) e registro
 * sem identidade é descartado. `sessionId` duplicado invalida a consulta inteira.
 */
export function consultarAgentesNativos(agoraMs?: number, ambiente: NodeJS.ProcessEnv = ambienteDeAssinatura()): ConsultaAgentesNativos {
  // I-33 (D4): o registro nativo e da conta; o observador passa o env do perfil da sessao.
  const consultadoEm = new Date(agoraMs ?? Date.now()).toISOString();
  const falha = (detalhe: string): ConsultaAgentesNativos => ({ ok: false, registros: [], detalhe, consultadoEm });
  const r = exec('claude', ['agents', '--json', '--all'], undefined, 60000, ambiente);
  if (!r.ok) return falha(`claude agents falhou (código ${r.code})`);
  if (Buffer.byteLength(r.stdout) > LIMITE_CONSULTA_BYTES) return falha('claude agents excedeu 1 MiB');
  const texto = (v: unknown) => typeof v === 'string' ? v : undefined;
  let bruto: unknown;
  try { bruto = JSON.parse(r.stdout); } catch { return falha('claude agents respondeu JSON inválido'); }
  if (!Array.isArray(bruto)) return falha('claude agents respondeu JSON inválido');
  const registros: RegistroAgenteClaude[] = [];
  let descartados = 0;
  for (const s of bruto as Record<string, unknown>[]) {
    if (!s || typeof s !== 'object' || Array.isArray(s) || typeof s.sessionId !== 'string' || !UUID_CLAUDE.test(s.sessionId) ||
        typeof s.cwd !== 'string' || !path.isAbsolute(s.cwd)) { descartados++; continue; }
    registros.push({ sessionId: s.sessionId, cwd: s.cwd, id: texto(s.id), name: texto(s.name), kind: texto(s.kind),
      state: texto(s.state), status: texto(s.status),
      pid: Number.isSafeInteger(s.pid) && (s.pid as number) > 0 ? s.pid as number : undefined,
      startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : undefined });
  }
  if (new Set(registros.map(s => s.sessionId)).size !== registros.length) return falha('claude agents repetiu sessionId');
  return { ok: true, registros, detalhe: descartados ? `${descartados} registro(s) sem identidade descartado(s)` : '', consultadoEm };
}

/** Procura uma sessao pelo id curto, id completo ou nome. */
export function acharSessao(chave: string, sessoes?: SessaoRuntime[]): SessaoRuntime | null {
  const lista = sessoes ?? listarSessoes(undefined, true);
  return (
    lista.find((s) => s.sessionId === chave || s.id === chave || s.name === chave) ??
    lista.find((s) => s.sessionId?.startsWith(chave)) ??
    null
  );
}

/**
 * Despacha a fase e RE-VERIFICA no runtime que a sessao existe de fato.
 * Nao confiar no self-report do despacho e a regra 4 da paridade.
 */
export function despachar(pedido: DespachoPedido): DespachoResultado {
  const comando = montarComando(pedido);
  let ambiente: NodeJS.ProcessEnv;
  // D-4: nada do contexto do despacho vai ao ambiente do processo `claude`, para um daemon novo nunca
  // nascer com ele; a identidade herdada ja sai em `ambienteDeAssinatura`, e o canal sai aqui.
  try { ambiente = semContextoDeDespacho(ambienteDoPerfil(pedido.perfil), pedido.ambienteExtra); }
  catch (e) { return { ok: false, comando, sessionId: null, verificada: false, stdout: '', stderr: '', erro: (e as Error).message }; }
  if (pedido.dryRun) {
    return { ok: true, comando, sessionId: null, verificada: false, stdout: '', stderr: '' };
  }
  if (!disponivel()) {
    return {
      ok: false,
      comando,
      sessionId: null,
      verificada: false,
      stdout: '',
      stderr: '',
      erro: 'binario `claude` nao encontrado no PATH',
    };
  }
  const r = exec(comando[0], comando.slice(1), pedido.cwd, 180000, ambiente);
  const saida = r.stdout + '\n' + r.stderr;
  const sessionId = extrairSessionId(saida);
  if (!r.ok || !sessionId) {
    // Bloco B3: rate limit nao e "runtime indisponivel". Ele tem horario de reset, e por
    // isso volta tipado daqui para virar pedido na fila duravel em vez de falha seca.
    // I-33 (D1): falha da CONTA vem antes, porque e mais especifica e pede outro perfil.
    // N6 (P8): sem perfil nada muda; o esgotamento que a leitura da baseline ja lia como rate limit
    // ("Claude AI usage limit reached|<epoch>") segue direto para a fila do B3, como antes da I-33.
    const lida = parseFalhaDeConta(saida);
    const legado = parseRateLimit(saida);
    const falhaDeConta = lida?.motivo === 'runtime.quota-exhausted' && !pedido.perfil && legado ? null : lida;
    const rateLimit = falhaDeConta ? null : legado;
    return {
      ok: false,
      comando,
      sessionId,
      verificada: false,
      stdout: r.stdout,
      stderr: r.stderr,
      rateLimit,
      falhaDeConta,
      erro: falhaDeConta
        ? `${falhaDeConta.motivo}: ${falhaDeConta.trecho}`
        : rateLimit
          ? `limite de uso do runtime atingido: ${rateLimit.trecho}`
          : `despacho falhou (code ${r.code})`,
    };
  }
  // I-33 (D4): a reverificacao consulta a MESMA conta que despachou.
  const sessoes = listarSessoes(undefined, true, ambiente);
  const achada = acharSessao(sessionId, sessoes);
  const verificada = achada !== null || acharSessao(pedido.nome, sessoes) !== null;
  return {
    ok: true,
    comando,
    sessionId: achada?.sessionId ?? sessionId,
    verificada,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

/**
 * O texto diz que o limite de uso da assinatura foi atingido?
 *
 * Reconhecimento por FRASE do runtime, nao por codigo de saida: o `claude --bg` sai com
 * codigo generico e a unica evidencia do rate limit e o texto no stderr.
 */
const FRASES_DE_RATE_LIMIT: readonly RegExp[] = [
  /usage limit reached/i,
  /\brate[ _-]?limit(?:ed|s)?\b/i,
  /too many requests/i,
  /\b429\b/,
  /quota exceeded/i,
  /out of (?:usage|weekly|session) limit/i,
];

/**
 * Padroes de horario de reset, do mais preciso para o menos.
 *
 * A ordem importa: epoch e ISO sao horario ABSOLUTO dito pelo runtime; relogio e
 * duracao precisam da hora de agora para virar carimbo. Nenhum deles inventa nada.
 */
function casarEpoch(texto: string): { resetEm: string; trecho: string } | null {
  // Formato real do CLI: `Claude AI usage limit reached|1757012400`.
  const m = texto.match(/(?:limit reached|reset[^\n|]*)\|\s*(\d{10,13})\b/i);
  if (!m) return null;
  const bruto = Number(m[1]);
  const ms = m[1].length >= 13 ? bruto : bruto * 1000;
  return { resetEm: new Date(ms).toISOString(), trecho: m[0].trim() };
}

function casarIso(texto: string): { resetEm: string; trecho: string } | null {
  const m = texto.match(
    /(?:reset|available|try again|retry)[^\n]{0,40}?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)/i
  );
  if (!m) return null;
  const data = new Date(m[1].replace(' ', 'T'));
  if (isNaN(data.getTime())) return null;
  return { resetEm: data.toISOString(), trecho: m[0].trim() };
}

/** N5: uma parte da duracao (`4 days`, `3h`, `20m`, `1.5s`, `20ms`), com a unidade fechada sem exigir `\b`. */
const PARTE_DA_DURACAO = /(\d+(?:\.\d+)?)\s*(milliseconds?|ms|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi;

function segundosDaUnidade(unidade: string): number {
  const u = unidade.toLowerCase();
  if (u === 'ms' || u.startsWith('milli')) return 0.001;
  if (u.startsWith('d')) return 86400;
  if (u.startsWith('h')) return 3600;
  if (u.startsWith('m')) return 60;
  return 1;
}

function casarDuracao(texto: string, agoraMs: number): { resetEm: string; trecho: string } | null {
  const m = texto.match(
    // A unidade aceita plural (`25 minutes`) e, desde o N5, dias e partes compostas nas formas reais
    // dos runtimes: `4 days 3 hours`, `2d 5h 30m` (Claude Code), `1m30s` e `20ms` (API da OpenAI).
    /(?:try again|retry|reset[a-z]*|available|wait)[^\n]{0,20}?\bin\b\s*((?:\d+(?:\.\d+)?\s*(?:milliseconds?|ms|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])[\s,]*(?:and\s+)?)+)|retry[- ]after[:\s]+(\d+)/i
  );
  if (!m) return null;
  if (m[2] !== undefined) {
    // `Retry-After: 3600` e sempre em segundos.
    return {
      resetEm: new Date(agoraMs + Number(m[2]) * 1000).toISOString(),
      trecho: m[0].trim(),
    };
  }
  let segundos = 0;
  for (const parte of m[1].matchAll(PARTE_DA_DURACAO)) segundos += Number(parte[1]) * segundosDaUnidade(parte[2]);
  return { resetEm: new Date(agoraMs + Math.round(segundos * 1000)).toISOString(), trecho: m[0].trim().replace(/[\s,]+$/, '') };
}

const MESES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * N5: data e hora de relogio local nas formas reais. Codex: `or try again at Sep 22nd, 2026 3:05 PM`
 * (`%b %-d` com sufixo ordinal, `, %Y %-I:%M %p`). Claude Code, quando o reset passa de 24 h:
 * `resets Sep 22, 3pm (<nome IANA do fuso>)` e, em outro ano, `resets Sep 22, 2027, 3:05pm`. Sem ano,
 * vale o ano corrente, ou o seguinte quando a data ja ficou mais de um dia para tras. O fuso entre
 * parenteses nao entra na regex nem no calculo (a hora e lida no relogio desta maquina), e por isso
 * fica como placeholder: o nome literal de fuso mora so em `core/src/horario.ts` (I-35).
 */
function casarData(texto: string, agoraMs: number): { resetEm: string; trecho: string } | null {
  const m = texto.match(
    /(?:try again at|reset[a-z]*(?:\s+at)?)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(?:(\d{4}),?\s*)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?![a-z0-9])/i
  );
  if (!m) return null;
  const mes = MESES.indexOf(m[1].toLowerCase());
  const dia = Number(m[2]);
  let hora = Number(m[4]);
  const minuto = Number(m[5] ?? '0');
  const sufixo = (m[6] ?? '').toLowerCase().replace(/\./g, '');
  if (sufixo === 'pm' && hora < 12) hora += 12;
  if (sufixo === 'am' && hora === 12) hora = 0;
  if (dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null;
  const base = new Date(agoraMs);
  const ano = m[3] !== undefined ? Number(m[3]) : base.getFullYear();
  const alvo = new Date(ano, mes, dia, hora, minuto, 0, 0);
  if (alvo.getMonth() !== mes) return null;
  if (m[3] === undefined && alvo.getTime() < agoraMs - 24 * 3600 * 1000) alvo.setFullYear(ano + 1);
  return { resetEm: alvo.toISOString(), trecho: m[0].trim() };
}

function casarRelogio(texto: string, agoraMs: number): { resetEm: string; trecho: string } | null {
  // N5: o codex diz so a hora quando o reset e no mesmo dia (`or try again at 3:05 PM`).
  const m = texto.match(/(?:reset[a-z]*\s*(?:at|em|as)?|try again at)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let hora = Number(m[1]);
  const minuto = Number(m[2] ?? '0');
  const sufixo = (m[3] ?? '').toLowerCase();
  if (sufixo === 'pm' && hora < 12) hora += 12;
  if (sufixo === 'am' && hora === 12) hora = 0;
  if (hora > 23 || minuto > 59) return null;
  // Proxima ocorrencia daquela hora de relogio a partir de agora, no fuso da maquina.
  const base = new Date(agoraMs);
  const alvo = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hora, minuto, 0, 0);
  if (alvo.getTime() <= agoraMs) alvo.setDate(alvo.getDate() + 1);
  return { resetEm: alvo.toISOString(), trecho: m[0].trim() };
}

/**
 * Extrai o sinal de rate limit da saida real do runtime (stdout + stderr).
 *
 * Devolve `null` quando o texto nao fala de limite de uso. Quando fala mas NAO diz a
 * hora, devolve `resetEm: null` com fonte `sem-horario`: quem decide a janela padrao e
 * a fila do B3, com a estimativa declarada. Chutar um horario aqui seria o mesmo defeito
 * de inventar ocupacao de janela no gate de tokens.
 */
export function parseRateLimit(saida: string, agoraMs = Date.now()): SinalDeRateLimit | null {
  const texto = saida ?? '';
  const frase = FRASES_DE_RATE_LIMIT.find((r) => r.test(texto));
  if (!frase) return null;

  const epoch = casarEpoch(texto);
  if (epoch) return { resetEm: epoch.resetEm, fonte: 'epoch', trecho: epoch.trecho };
  const iso = casarIso(texto);
  if (iso) return { resetEm: iso.resetEm, fonte: 'iso', trecho: iso.trecho };
  const data = casarData(texto, agoraMs);
  if (data) return { resetEm: data.resetEm, fonte: 'relogio', trecho: data.trecho };
  const duracao = casarDuracao(texto, agoraMs);
  if (duracao) return { resetEm: duracao.resetEm, fonte: 'duracao', trecho: duracao.trecho };
  const relogio = casarRelogio(texto, agoraMs);
  if (relogio) return { resetEm: relogio.resetEm, fonte: 'relogio', trecho: relogio.trecho };

  const linha = texto.split('\n').find((l) => frase.test(l)) ?? texto;
  return { resetEm: null, fonte: 'sem-horario', trecho: linha.trim().slice(0, 200) };
}

/**
 * I-33 (D1): falha da CONTA na saida real do runtime, reconhecida por frase, nunca por codigo de
 * saida. Auth ausente vem primeiro: sem login, nada mais da saida importa. Cota esgotada usa os
 * mesmos padroes de horario do rate limit; sem horario, `resetEm` fica `null` e o prazo e da
 * janela padrao do manifesto, declarado como estimado por quem marca o perfil. O que e cota
 * esgotada e o que e rate limit comum sai do criterio unico da D16 (`naturezaDoLimite`).
 */
const FRASES_DE_AUTH_AUSENTE: readonly RegExp[] = [
  /\bnot logged in\b/i,
  /please run \/login/i,
  /oauth token (?:has )?expired/i,
  /\bauthentication_error\b/i,
  // D15 (A6): o erro real do Claude Code quando o refresh do OAuth falha (codigo e frase).
  /\bauthentication_failed\b/i,
  /oauth session expired/i,
  /\btoken_expired\b/i,
  /refresh[_ ]token[^\n]{0,40}\b(?:expired|revoked|invalid|reused)\b/i,
  /\b401\b[^\n]{0,40}unauthori[sz]ed|unauthori[sz]ed[^\n]{0,40}\b401\b/i,
];

/**
 * A11: mencao ampla ao comando de login do codex. Aparece tambem em dica e em texto de ajuda, entao
 * so vale como auth ausente quando o mesmo texto nao traz frase de cota: a cota, mais especifica, vence.
 */
const FRASES_AMPLAS_DE_AUTH: readonly RegExp[] = [/\bcodex login\b/i];

/**
 * RM-037 (defeitosdeco D-6): modelo inexistente ou sem acesso na conta. Medido na transcricao da
 * sessao af32834f (28/09/2026, `fable-5-1` num perfil de conta sem esse modelo): `error: "model_not_found"` e o texto
 * "There's an issue with the selected model (fable-5-1). It may not exist or you may not have access
 * to it". Frase de sobrecarga ("model is overloaded") nao entra: e falha transitoria da infra.
 */
const FRASES_DE_MODELO_INACESSIVEL: readonly RegExp[] = [/\bmodel_not_found\b/i, /issue with the selected model/i];

/**
 * I-33 (D16): CRITERIO UNICO entre ESGOTAMENTO da conta e RATE LIMIT comum. Decisao do dono em
 * 19/09/2026 (opcao a do A3 do CHECK aa279e17): esgotamento de cota, credito ou limite do plano
 * tira o perfil do rodizio e o MESMO prompt pode seguir no proximo perfil ativo do mesmo runtime;
 * rate limit comum de curta janela NUNCA troca de perfil, espera a janela. Todo classificador de
 * falha da conta passa por aqui: despacho claude-bg e codex, transcricao do Claude Code e erro
 * terminal do turno codex (`parseFalhaDeConta`). Regras, na ordem, pela frase do runtime:
 *
 * 1. `esgotamento-explicito`: o provedor diz que a conta ficou sem cota, credito ou saldo
 *    (`usage_limit_exceeded`, `insufficient_quota`, "out of credits", "spend cap"). Esgotamento,
 *    com ou sem prazo, mesmo que a resposta venha como HTTP 429.
 * 2. `janela-curta`: o provedor diz que o limite e temporario e nao e a cota ("not your usage
 *    limit", "Request rejected (429)", "Too Many Requests", `rate_limit_exceeded`,
 *    `rate_limit_error`, overloaded, 529, requisicoes ou tokens por minuto). Rate limit.
 * 3. `limite-do-plano`: frase da janela da assinatura ("usage limit reached", "You've hit your
 *    ... limit", "You've reached your ... limit", "plan limit"). Esgotamento quando o prazo dito
 *    esta a `JANELA_CURTA_MAX_MS` ou mais, ou quando o runtime nao diz prazo futuro (a janela do
 *    plano e de horas ou dias por construcao); rate limit quando o prazo dito e mais curto.
 * 4. `generico`: qualquer outro sinal de limite reconhecido por `parseRateLimit` (`429`, "rate
 *    limit", `rate_limit`, "too many requests", "quota exceeded"). Rate limit: na duvida, nao troca
 *    de perfil. O Retry-After so conta junto de um desses sinais, como prazo.
 */
export const JANELA_CURTA_MAX_MS = 15 * 60 * 1000;

export type NaturezaDoLimite = 'esgotamento' | 'rate-limit';
export type RegraDoLimite = 'esgotamento-explicito' | 'janela-curta' | 'limite-do-plano' | 'generico';
export interface LimiteClassificado {
  natureza: NaturezaDoLimite;
  regra: RegraDoLimite;
  resetEm: string | null;
  fonte: SinalDeFalhaDeConta['fonte'];
  trecho: string;
}

const FRASES_DE_ESGOTAMENTO: readonly RegExp[] = [
  /\busage_limit_exceeded\b/i,
  /\busage_limit_reached\b/i,
  /\bout of credits\b/i,
  /\binsufficient_quota\b/i,
  /exceeded your current quota/i,
  /credit balance is too low/i,
  // Codigo de erro de API do Claude Code quando a conta fica sem credito (I-33, D12).
  /\bbilling_error\b/i,
  /\bspend (?:cap|limit)\b/i,
  /\bworkspace credit limit\b/i,
  /\bout of extra usage\b/i,
  /\brequires usage credits\b/i,
];

const FRASES_DE_JANELA_CURTA: readonly RegExp[] = [
  /not your usage limit/i,
  /temporarily limiting requests/i,
  /request rejected \(429\)/i,
  /temporary capacity issue/i,
  /too many requests/i,
  /\brate_limit_exceeded\b/i,
  /\brate_limit_error\b/i,
  /\bserver_overloaded\b/i,
  /\boverloaded(?:_error)?\b/i,
  /\b529\b/,
  /experiencing high load/i,
  /\b(?:requests|tokens) per min(?:ute)?\b/i,
];

const FRASES_DO_LIMITE_DO_PLANO: readonly RegExp[] = [
  /usage limits? (?:reached|exceeded)/i,
  /\bhit your (?:[a-z0-9-]+ )?(?:usage )?limit\b/i,
  /\breached your (?:[a-z0-9-]+ )?(?:usage )?limit\b/i,
  /\bplan limit\b/i,
  /out of (?:usage|weekly|session) limit/i,
];

/** N4: a linha da frase, limitada a 200 caracteres; em linha longa, a janela comeca perto da frase. */
function trechoDa(texto: string, frase: RegExp): string {
  const linha = (texto.split('\n').find((l) => frase.test(l)) ?? texto).trim();
  if (linha.length <= 200) return linha;
  const inicio = Math.max(0, (linha.match(frase)?.index ?? 0) - 40);
  return linha.slice(inicio, inicio + 200).trim();
}

/** Horario de volta dito pelo runtime, do padrao mais preciso para o menos; nenhum inventado. */
function resetDito(texto: string, agoraMs: number): { resetEm: string | null; fonte: SinalDeFalhaDeConta['fonte'] } {
  // N5: data e hora de relogio local (`Sep 22nd, 2026 3:05 PM`) e relogio; a fonte das duas e `relogio`.
  const padroes = [['epoch', casarEpoch(texto)], ['iso', casarIso(texto)], ['relogio', casarData(texto, agoraMs)],
    ['duracao', casarDuracao(texto, agoraMs)], ['relogio', casarRelogio(texto, agoraMs)]] as const;
  const achado = padroes.find(([, r]) => r !== null);
  return achado ? { resetEm: achado[1]!.resetEm, fonte: achado[0] } : { resetEm: null, fonte: 'sem-horario' };
}

/** D16: a natureza do limite na saida do runtime, pelas quatro regras acima; `null` sem sinal de limite. */
export function naturezaDoLimite(saida: string, agoraMs = Date.now()): LimiteClassificado | null {
  const texto = saida ?? '';
  const explicito = FRASES_DE_ESGOTAMENTO.find((r) => r.test(texto));
  if (explicito) return { natureza: 'esgotamento', regra: 'esgotamento-explicito', ...resetDito(texto, agoraMs), trecho: trechoDa(texto, explicito) };
  const curta = FRASES_DE_JANELA_CURTA.find((r) => r.test(texto));
  if (curta) return { natureza: 'rate-limit', regra: 'janela-curta', ...resetDito(texto, agoraMs), trecho: trechoDa(texto, curta) };
  const plano = FRASES_DO_LIMITE_DO_PLANO.find((r) => r.test(texto));
  if (plano) {
    const reset = resetDito(texto, agoraMs);
    const horizonte = reset.resetEm === null ? null : Date.parse(reset.resetEm) - agoraMs;
    const curto = horizonte !== null && horizonte > 0 && horizonte < JANELA_CURTA_MAX_MS;
    return { natureza: curto ? 'rate-limit' : 'esgotamento', regra: 'limite-do-plano', ...reset, trecho: trechoDa(texto, plano) };
  }
  const generico = parseRateLimit(texto, agoraMs);
  return generico ? { natureza: 'rate-limit', regra: 'generico', resetEm: generico.resetEm, fonte: generico.fonte, trecho: generico.trecho }
    : null;
}

export function parseFalhaDeConta(saida: string, agoraMs = Date.now()): SinalDeFalhaDeConta | null {
  const texto = saida ?? '';
  const modelo = FRASES_DE_MODELO_INACESSIVEL.find((r) => r.test(texto));
  if (modelo) return { motivo: 'runtime.model-unavailable', resetEm: null, fonte: 'sem-horario', trecho: trechoDa(texto, modelo) };
  const auth = FRASES_DE_AUTH_AUSENTE.find((r) => r.test(texto));
  if (auth) return { motivo: 'runtime.auth-missing', resetEm: null, fonte: 'sem-horario', trecho: trechoDa(texto, auth) };
  const limite = naturezaDoLimite(texto, agoraMs);
  if (limite?.natureza === 'esgotamento') {
    return { motivo: 'runtime.quota-exhausted', resetEm: limite.resetEm, fonte: limite.fonte, trecho: limite.trecho };
  }
  const ampla = FRASES_AMPLAS_DE_AUTH.find((r) => r.test(texto));
  return ampla ? { motivo: 'runtime.auth-missing', resetEm: null, fonte: 'sem-horario', trecho: trechoDa(texto, ampla) } : null;
}

/** D7: resultado da conferencia de login feita pelo proprio CLI com o env do perfil. */
export interface StatusDeAuth {
  ok: boolean; detalhe: string;
  /** I-33 (D13): ha login, mas por provider pago (API key, helper, Console ou nuvem): nunca despacha. */
  pago?: boolean;
  /**
   * A14: a conferencia nao concluiu (timeout, sinal, binario ausente, resposta ilegivel). Nao prova
   * login perdido: o perfil fica fora so deste despacho e e conferido de novo no proximo.
   */
  transitorio?: boolean;
}

/** Campo textual do `auth status`, sem controle e curto, para o detalhe legivel. */
const campoDeAuth = (v: unknown): string => typeof v === 'string' ? v.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 32) : '';

/**
 * I-33 (D7, D13): `claude auth status --json` com o env do perfil. Aprova so login de ASSINATURA:
 * `loggedIn: true`, `authMethod` `claude.ai`, sem `apiKeySource` e com provider `firstParty`.
 * API key, `api_key_helper`, Console ou provider de nuvem cobram por token: `pago`, nunca despacha.
 * O `configDirectory` informado precisa ser o do perfil, prova de que o env foi aplicado. O `ork`
 * nunca abre nada dentro do diretorio: quem responde e o CLI.
 */
export function conferirAuth(perfil?: PerfilDeDespacho | null): StatusDeAuth {
  let ambiente: NodeJS.ProcessEnv;
  try { ambiente = ambienteDoPerfil(perfil); } catch (e) { return { ok: false, detalhe: (e as Error).message }; }
  const r = exec('claude', ['auth', 'status', '--json'], undefined, 30000, ambiente);
  // A14: sem codigo de saida (timeout, sinal ou binario ausente) ou sem JSON, a conferencia e inconclusiva.
  if (r.code === -1) return { ok: false, transitorio: true, detalhe: 'claude auth status sem resposta (timeout, sinal ou binario ausente)' };
  let dados: { loggedIn?: unknown; authMethod?: unknown; configDirectory?: unknown; apiKeySource?: unknown; apiProvider?: unknown };
  try { dados = JSON.parse(r.stdout); } catch { return { ok: false, transitorio: true, detalhe: `claude auth status sem JSON legivel (codigo ${r.code})` }; }
  if (!dados || typeof dados !== 'object') return { ok: false, transitorio: true, detalhe: 'claude auth status sem JSON legivel' };
  if (perfil && typeof dados.configDirectory === 'string' && dados.configDirectory !== perfil.configDir)
    return { ok: false, detalhe: 'claude auth status respondeu por outro diretorio de configuracao; perfil nao aplicado' };
  if (dados.loggedIn !== true) return { ok: false, detalhe: 'claude auth status: loggedIn false' };
  const metodo = campoDeAuth(dados.authMethod), fonte = campoDeAuth(dados.apiKeySource), provedor = campoDeAuth(dados.apiProvider);
  if (metodo !== 'claude.ai' || fonte !== '' || (provedor !== '' && provedor !== 'firstParty')) {
    const partes = [`authMethod ${metodo || 'ausente'}`, ...(fonte ? [`apiKeySource ${fonte}`] : []),
      ...(provedor && provedor !== 'firstParty' ? [`apiProvider ${provedor}`] : [])];
    return { ok: false, pago: true, detalhe: `claude auth status: provider pago (${partes.join(', ')}); so a assinatura claude.ai despacha` };
  }
  return { ok: true, detalhe: `claude auth status: loggedIn (${metodo})` };
}

/**
 * Comando de anexar a sessao (precisa de TTY, entao o CLI imprime em vez de executar). RM-037
 * (defeitosdeco D-2): sessao de um perfil so e anexada com o `CLAUDE_CONFIG_DIR` daquela conta.
 */
export function comandoAttach(sessionId: string, configDir?: string | null): string {
  if (!configDir) return `claude attach ${sessionId}`;
  const dir = /^[A-Za-z0-9_./-]+$/.test(configDir) ? configDir : `'${configDir.replace(/'/g, `'\\''`)}'`;
  return `CLAUDE_CONFIG_DIR=${dir} claude attach ${sessionId}`;
}

/**
 * Transforma o dump de tela que o `claude logs` devolve em texto legivel.
 *
 * O dump e uma gravacao de terminal: as linhas sao separadas por movimento de cursor,
 * nao por quebra de linha. Por isso o movimento vira quebra ANTES de as demais
 * sequencias ANSI serem removidas, senao a saida inteira colapsa numa linha so.
 */
/**
 * Marcador temporario de um CHA (`ESC[<n>G`), resolvido em espacos no fim da limpeza.
 *
 * Fica fora da faixa de controle que a limpeza apaga (`\u0000-\u001f`), entao ele
 * atravessa os passos seguintes intacto.
 */
const MARCA_DE_COLUNA = '\u0091';

const MARCA_CASADA = new RegExp(`${MARCA_DE_COLUNA}(\\d+)${MARCA_DE_COLUNA}`, 'g');

/**
 * Repoe os espacos que o CHA desenhava, linha a linha.
 *
 * O terminal anda ate a coluna pedida preenchendo com branco; quem le o log so ve a
 * sequencia sumir. Quando a coluna alvo ja passou (o runtime reescrevendo o que estava
 * na tela), um unico espaco separa os pedacos: e melhor errar o alinhamento do que
 * colar duas palavras que nunca foram uma so.
 */
function resolverColunas(texto: string): string {
  if (!texto.includes(MARCA_DE_COLUNA)) return texto;
  return texto
    .split('\n')
    .map((linha) => {
      // `split` com grupo de captura intercala texto e coluna: [txt, col, txt, col, txt].
      const partes = linha.split(MARCA_CASADA);
      let saida = partes[0] ?? '';
      for (let i = 1; i < partes.length; i += 2) {
        const coluna = Number(partes[i]);
        if (Number.isFinite(coluna) && coluna - 1 > saida.length) {
          saida += ' '.repeat(coluna - 1 - saida.length);
        } else if (saida !== '' && !saida.endsWith(' ')) {
          saida += ' ';
        }
        saida += partes[i + 1] ?? '';
      }
      return saida;
    })
    .join('\n');
}

export function limparAnsi(bruto: string): string {
  return resolverColunas(
    bruto
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b\[[0-9;]*[HfABEd]/g, '\n')
      // O CHA (`ESC[<n>G`) posiciona o cursor numa coluna em vez de escrever espacos, e
      // o `claude logs` desenha a tela INTEIRA assim. Engoli-lo junto com o resto das
      // sequencias colava as palavras (`2newMCPserversfoundinthisproject`), o que
      // apagava a pergunta que o radar poe na frente do humano e matava todo o
      // reconhecimento por frase que separa credencial de permissao.
      .replace(/\u001b\[([0-9]*)G/g, (_m, n: string) => `${MARCA_DE_COLUNA}${n || '1'}${MARCA_DE_COLUNA}`)
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b[()][A-Za-z0-9]/g, '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  )
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Le os logs de uma sessao.
 *
 * O `claude logs` aceita o id CURTO da sessao (o campo `id` de `claude agents --json`),
 * nao o UUID completo: passar o UUID responde "No job matching". Por isso a chave e
 * resolvida antes, e a saida (dump de tela com ANSI) e limpa aqui.
 */
export function logs(chave: string, linhas = 60, ambiente: NodeJS.ProcessEnv = ambienteDeAssinatura()): { ok: boolean; texto: string } {
  const sessao = acharSessao(chave, listarSessoes(undefined, true, ambiente));
  return logsDaSessao(sessao?.id ?? (sessao?.sessionId ?? chave).slice(0, 8), linhas, ambiente);
}

/**
 * I-45: a tela de uma sessao cujo id curto o chamador ja tem. `logs` lista todas as sessoes antes
 * de ler (`claude agents --json --all`, 57 s nesta VPS em 25/09/2026) so para achar esse id; o radar
 * ja tem a lista na mao, e pagar a listagem de novo por sessao parada era o grosso da varredura.
 */
export function logsDaSessao(id: string, linhas = 60, ambiente: NodeJS.ProcessEnv = ambienteDeAssinatura()): { ok: boolean; texto: string } {
  const r = exec('claude', ['logs', id], undefined, 60000, ambiente);
  const bruto = limparAnsi(r.ok ? r.stdout : r.stdout + r.stderr);
  const uteis = bruto.split('\n').filter((l) => l.trim() !== '');
  return { ok: r.ok, texto: uteis.slice(-linhas).join('\n') };
}

/** Para uma sessao em background (o `claude stop` tambem trabalha com o id curto). */
export function parar(chave: string, ambiente: NodeJS.ProcessEnv = ambienteDeAssinatura()): { ok: boolean; texto: string } {
  const sessao = acharSessao(chave, listarSessoes(undefined, true, ambiente));
  return pararAchada(sessao ?? { sessionId: chave }, ambiente);
}

/** Para a sessao ja achada numa conta, com o ambiente dessa conta, sem listar de novo. */
export function pararAchada(sessao: Pick<SessaoRuntime, 'sessionId' | 'id'>, ambiente: NodeJS.ProcessEnv = ambienteDeAssinatura()):
    { ok: boolean; texto: string } {
  const r = exec('claude', ['stop', sessao.id ?? sessao.sessionId.slice(0, 8)], undefined, 60000, ambiente);
  return { ok: r.ok, texto: limparAnsi(r.stdout + r.stderr).trim() };
}

/** RM-037 (defeitosdeco D-2): a sessao achada, a conta onde ela esta e o ambiente dessa conta. */
export interface SessaoNaConta { sessao: SessaoRuntime; perfil: PerfilDeDespacho | null; configDir: string; ambiente: NodeJS.ProcessEnv }

/**
 * RM-037 (defeitosdeco D-2): o `claude agents` so lista a sessao para a conta que a despachou, entao
 * uma chave e procurada no ambiente do processo e em cada perfil claude-bg informado, sem repetir
 * diretorio efetivo. Consulta que falha nao vira "nao encontrada": vai para `falhas`.
 */
export function acharSessaoNasContas(chave: string, perfis: readonly PerfilDeDespacho[]): { achadas: SessaoNaConta[]; falhas: string[] } {
  const achadas: SessaoNaConta[] = [], falhas: string[] = [], vistos = new Set<string>();
  // GO-FIX (R5a): cada consulta pode custar dezenas de segundos sob carga. UUID completo e unico em
  // qualquer conta, entao a busca para na primeira que acha; prefixo ou nome consulta todas, para
  // recusar a chave ambigua.
  const unica = UUID_CLAUDE.test(chave);
  for (const perfil of [null, ...perfis.filter(p => p.runtime === 'claude-bg')]) {
    let ambiente: NodeJS.ProcessEnv, configDir: string;
    try { ambiente = ambienteDoPerfil(perfil); configDir = path.resolve(diretorioEfetivo('claude-bg', perfil, ambiente)); }
    catch (e) { falhas.push(`${perfil?.id ?? 'processo'}: ${(e as Error).message}`); continue; }
    if (vistos.has(configDir)) continue;
    vistos.add(configDir);
    const consulta = consultarSessoes(undefined, true, ambiente);
    if (!consulta.ok) { falhas.push(`${perfil?.id ?? 'processo'}: ${consulta.detalhe}`); continue; }
    const sessao = acharSessao(chave, consulta.sessoes);
    if (sessao) achadas.push({ sessao, perfil, configDir, ambiente });
    if (sessao && unica) break;
  }
  return { achadas, falhas };
}

/**
 * Ocupacao da janela de contexto de uma sessao, entre 0 e 1.
 *
 * MEDIDO em 02/09/2026 na versao 2.1.259 do Claude Code: nem `claude agents --json` nem
 * `claude logs` expoem uso de contexto da sessao. Entao este adapter responde `null`, e o
 * gate de tokens declara a fonte como `unavailable`.
 *
 * Retornar um numero estimado aqui seria inventar dado e contaminar uma decisao real de
 * rotacao de sessao. Quando o runtime passar a expor a metrica, e SO aqui que muda: o
 * gate ja sabe reportar `runtime_reported` no dia em que esta funcao devolver um numero.
 */
export function ocupacaoDeContexto(chave: string): number | null {
  void chave;
  return null;
}
