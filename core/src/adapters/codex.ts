/** Runtime Codex governado pelo controller app-server. Assinatura ChatGPT obrigatória.
 * Helpers exec/rollout permanecem para leitura de histórico; não são fallback de despacho.
 */

import { despacharComController, VinculoController } from './codex-controller';
import { ContextoRuntime, validarContextoRuntime } from '../runtime-context';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SinalDeFalhaDeConta, SinalDeRateLimit, SessaoRuntime } from '../types';
import { exec as executar, noPath } from '../util';
import { ambienteDeAssinatura, ENVS_DE_PROVIDER_PAGO } from '../runtime-ambiente';
import { parseFalhaDeConta, parseRateLimit, StatusDeAuth } from './claude-bg';
import { ambienteComPerfil, diretorioEfetivo, PerfilDeDespacho } from '../runtime-profiles';

export const NOME_ADAPTER = 'codex';

/**
 * Variaveis que REDIRECIONAM o codex para um provider pago por token.
 *
 * O despacho usa a sessao autenticada (`codex login`, plano ChatGPT). Uma OPENAI_API_KEY
 * no ambiente pode virar cobranca por token sem ninguem pedir, o mesmo risco do claude-bg,
 * entao o adapter LIMPA essas variaveis do ambiente do filho em vez de confiar que o CLI
 * vai ignora-las.
 */
export const ENVS_REMOVIDAS_DO_DESPACHO = [...ENVS_DE_PROVIDER_PAGO, 'CODEX_API_KEY'] as const;

/**
 * O ambiente do despacho: o do processo, sem as variaveis de provider pago e sem
 * `CODEX_API_KEY`. A lista da higiene de runtime nao cobre a chave especifica do Codex,
 * entao o adapter a remove aqui: a assinatura ChatGPT continua sendo a unica credencial.
 */
export function ambienteDoDespacho(base: NodeJS.ProcessEnv = process.env, perfil?: PerfilDeDespacho | null): NodeJS.ProcessEnv {
  const env = ambienteDeAssinatura(base);
  for (const nome of ENVS_REMOVIDAS_DO_DESPACHO) delete env[nome];
  // I-33 (D2): o `CODEX_HOME` do filho vem do `codexHome` do perfil; sem perfil, o do processo.
  if (perfil && (perfil.runtime !== 'codex' || !perfil.codexHome))
    throw new Error('runtime.profiles.invalid: perfil sem codexHome no despacho codex');
  return ambienteComPerfil(env, perfil);
}

function exec(cmd: string, args: string[], cwd?: string, timeoutMs?: number, ambiente: NodeJS.ProcessEnv = ambienteDoDespacho()) {
  return executar(cmd, args, cwd, timeoutMs, ambiente);
}

/** Modos de sandbox aceitos pelo `codex exec --sandbox`. */
export const SANDBOXES_DO_CODEX = ['read-only', 'workspace-write', 'danger-full-access'] as const;

/** Sandbox padrao do despacho: escreve no workspace, sem rede para o agente. */
export const SANDBOX_PADRAO = 'workspace-write';

export interface DespachoCodexPedido {
  contextoRuntime?: ContextoRuntime;
  vinculo?: VinculoController;
  /** Homologação explícita pode exercitar perguntas bloqueantes em plan. */
  colaboracao?: 'plan' | 'default';
  /** JSON Schema fechado para a resposta final do turno. */
  outputSchema?: Record<string, unknown>;
  /** Quando presente, abre `review/start` contra esta branch em vez de um turno comum. */
  reviewBaseBranch?: string;
  prompt: string;
  /** Nome da sessao no Ork (slug de 3 partes). Vira o nome do log do despacho. */
  nome: string;
  /** Diretorio onde o agente trabalha (raiz do projeto ou worktree da thread). */
  cwd: string;
  model?: string;
  /** Vira `-c model_reasoning_effort=<effort>` (minimal|low|medium|high|xhigh). */
  effort?: string;
  /** Sandbox do `codex exec` (padrao `workspace-write`). */
  sandbox?: string;
  /** Diretorio do log JSONL do despacho (padrao: o proprio cwd). */
  logDir?: string;
  /** Quando true, monta o comando e nao executa nada. */
  dryRun?: boolean;
  /** Espera maxima pelo evento `thread.started`, em ms (padrao 60s). */
  esperaMs?: number;
  /** I-36 (D4): identidade, thread e canal do despacho no ambiente da sessao filha. */
  ambienteExtra?: Record<string, string>;
  /** Limite explícito do turno; ao vencer solicita interrupção nativa e fecha stdin próprio. */
  duracaoMaximaMs?: number;
  /** I-33 (D2): perfil de conta do despacho (`codexHome`); ausente, vale o `CODEX_HOME` do processo. */
  perfil?: PerfilDeDespacho;
}

export interface DespachoCodexResultado {
  controlador?: string;
  ok: boolean;
  comando: string[];
  /** O `thread_id` do evento `thread.started` do stream `--json`. */
  sessionId: string | null;
  /** Rollout da sessao encontrado em `$CODEX_HOME/sessions` (re-verificacao externa). */
  verificada: boolean;
  stdout: string;
  stderr: string;
  erro?: string;
  rateLimit?: SinalDeRateLimit | null;
  /** I-33 (D1): cota esgotada ou auth ausente da conta ChatGPT do perfil. */
  falhaDeConta?: SinalDeFalhaDeConta | null;
  /** Caminho do log JSONL onde o despacho desanexado escreve os eventos. */
  logPath?: string;
  processoPath?: string;
  reciboPath?: string;
}

/** O runtime esta disponivel nesta maquina? */
export function disponivel(): string | null {
  return noPath('codex');
}

/** Versao do runtime, para o `ork doctor`. */
export function versao(): string | null {
  const r = exec('codex', ['--version'], undefined, 30000);
  return r.ok ? r.stdout.trim() : null;
}

/**
 * Raiz do estado do Codex: o `codexHome` do perfil da sessao (I-33, D4) ou, sem perfil, o
 * `CODEX_HOME` do processo com fallback `~/.codex`.
 */
export function casaDoCodex(perfil?: PerfilDeDespacho | null): string {
  return diretorioEfetivo('codex', perfil);
}

/**
 * I-33 (D7, D13): `codex login status` com o env do perfil. Aprova so o login da ASSINATURA
 * ("Logged in using ChatGPT"); login por API key sai 0 mas cobra por token: `pago`, nunca despacha,
 * e o trecho mascarado da chave nao vai ao detalhe. O `ork` nunca abre nada dentro do
 * `CODEX_HOME`: quem responde e o CLI.
 */
export function conferirAuth(perfil?: PerfilDeDespacho | null): StatusDeAuth {
  let ambiente: NodeJS.ProcessEnv;
  try { ambiente = ambienteDoDespacho(process.env, perfil); } catch (e) { return { ok: false, detalhe: (e as Error).message }; }
  const r = exec('codex', ['login', 'status'], undefined, 30000, ambiente);
  // A14: sem codigo de saida (timeout, sinal ou binario ausente), a conferencia e inconclusiva.
  if (r.code === -1) return { ok: false, transitorio: true, detalhe: 'codex login status sem resposta (timeout, sinal ou binario ausente)' };
  const linha = (r.stdout + '\n' + r.stderr).split('\n').map(l => l.trim()).find(l => l !== '') ?? '';
  const trecho = linha.replace(/\p{Cc}/gu, '').slice(0, 120);
  if (!r.ok) return { ok: false, detalhe: `codex login status saiu ${r.code}${trecho ? `: ${trecho}` : ''}` };
  if (/logged in using chatgpt/i.test(trecho)) return { ok: true, detalhe: 'codex login status: Logged in using ChatGPT' };
  return { ok: false, pago: true, detalhe: /api key/i.test(trecho) ? 'codex login status: login por API key (provider pago)'
    : 'codex login status: login sem assinatura ChatGPT comprovada (tratado como provider pago)' };
}

/** Somente metadados do cabeçalho e eventos terminais; prompts nunca saem do leitor. */
export function consultarRollouts(todas = false, casa = casaDoCodex()): {
  ok: boolean; sessoes: SessaoRuntime[]; fontes: string[]; detalhe: string;
  resultadosFontes: { origem: string; ok: boolean; detalhe: string }[];
} {
  const fontes = [path.join(casa, 'sessions'), ...(todas ? [path.join(casa, 'archived_sessions')] : [])];
  const resultadosFontes: { origem: string; ok: boolean; detalhe: string }[] = [];
  const sessoes: SessaoRuntime[] = [];
  const ids = new Set<string>();
  for (const dirFonte of fontes) {
    const fonte = { origem: dirFonte, ok: true, detalhe: '' };
    resultadosFontes.push(fonte);
    const falhar = (origem: string, detalhe: string): void => {
      fonte.ok = false;
      fonte.detalhe = 'inventário parcial; fonte contém erro de diretório, leitura ou metadados';
      if (origem === dirFonte) fonte.detalhe = detalhe;
      else resultadosFontes.push({ origem, ok: false, detalhe });
    };
    const visitar = (dir: string): void => {
      let entradas: fs.Dirent[];
      try {
        if (!fs.lstatSync(dir).isDirectory()) throw new Error('diretório inválido');
        entradas = fs.readdirSync(dir, { withFileTypes: true });
      } catch { falhar(dir, 'diretório inacessível ou inválido'); return; }
      for (const entrada of entradas) {
        const arquivo = path.join(dir, entrada.name);
        if (entrada.isSymbolicLink()) { falhar(arquivo, 'link inesperado'); continue; }
        if (entrada.isDirectory()) { visitar(arquivo); continue; }
        if (!entrada.isFile() || !entrada.name.endsWith('.jsonl')) continue;
        try {
          const fd = fs.openSync(arquivo, 'r');
          let primeira: string, cauda: string, atividadeEm: number;
          try {
            const st = fs.fstatSync(fd), tamanho = st.size;
            atividadeEm = st.mtimeMs;
            const cab = Buffer.alloc(Math.min(tamanho, 65536));
            fs.readSync(fd, cab, 0, cab.length, 0);
            primeira = cab.toString('utf8').split('\n')[0];
            const fim = Buffer.alloc(Math.min(tamanho, 131072));
            fs.readSync(fd, fim, 0, fim.length, tamanho - fim.length);
            cauda = fim.toString('utf8');
          } finally { fs.closeSync(fd); }
          const meta = JSON.parse(primeira);
          const p = meta.payload;
          if (meta.type !== 'session_meta' || !p || typeof p.id !== 'string' ||
            !/^[a-f0-9-]{8,}$/i.test(p.id) || typeof p.cwd !== 'string' || !path.isAbsolute(p.cwd) ||
            ids.has(p.id)) throw new Error('metadados inválidos ou duplicados');
          ids.add(p.id);
          // Ausência de evento terminal é desconhecimento, não prova de processo vivo.
          let state = 'unknown';
          for (const linha of cauda.split('\n')) {
            try {
              const e = JSON.parse(linha);
              if (e.type === 'event_msg' && e.payload?.type === 'task_started') state = 'unknown';
              if (e.type === 'event_msg' && ['task_complete', 'task_aborted'].includes(e.payload?.type)) state = 'completed';
            } catch { /* primeira/última linha do recorte pode estar parcial */ }
          }
          if (todas || state !== 'completed') sessoes.push({ sessionId: p.id, cwd: p.cwd, state, kind: 'codex-rollout', atividadeEm });
        } catch { falhar(arquivo, 'leitura ou metadados inválidos ou duplicados'); }
      }
    };
    // O runtime é opcional: somente ENOENT antes da consulta prova fonte ausente.
    // Erros durante a visita (inclusive desaparecimento) continuam invalidando a fonte.
    try { fs.lstatSync(dirFonte); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        fonte.detalhe = 'diretório opcional ausente'; continue;
      }
      falhar(dirFonte, 'diretório inacessível ou inválido'); continue;
    }
    visitar(dirFonte);
  }
  const ok = resultadosFontes.every(f => f.ok);
  return { ok, sessoes, fontes, resultadosFontes,
    detalhe: ok ? '' : 'inventário Codex incompleto: consulte as fontes com erro' };
}

/**
 * A sonda deterministica do sandbox: roda `true` dentro do sandbox do Codex, SEM LLM.
 *
 * Numa maquina sa ela sai 0. Onde o bubblewrap nao consegue criar user namespace
 * (Ubuntu com `apparmor_restrict_unprivileged_userns=1` e sem o pacote bubblewrap do
 * sistema), ela sai != 0 com o erro real do bwrap, e o despacho sandboxado viraria
 * narrativa sem execucao. E por isso que ela e check de `ork doctor`, nao detalhe.
 */
export function sondarSandbox(): { ok: boolean; detalhe: string } {
  const r = exec('codex', ['sandbox', 'true'], undefined, 30000);
  const saida = (r.stdout + ' ' + r.stderr).trim();
  return {
    ok: r.ok,
    detalhe: r.ok ? 'codex sandbox true saiu 0' : saida.slice(0, 200) || `exit ${r.code}`,
  };
}

/** Monta a linha de comando exata do despacho (usada tambem pelo `--dry-run`). */
export function montarComando(pedido: DespachoCodexPedido): string[] {
  const args = [
    'exec',
    '--sandbox',
    pedido.sandbox ?? SANDBOX_PADRAO,
    // Headless de verdade: sem TTY nao ha quem aprove, entao pedir aprovacao e travar.
    '-c',
    'approval_policy=never',
    '--skip-git-repo-check',
    '-C',
    pedido.cwd,
    '--json',
  ];
  if (pedido.model) args.push('-m', pedido.model);
  if (pedido.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(pedido.effort)}`);
  args.push(pedido.prompt);
  return ['codex', ...args];
}

/** Extrai o `thread_id` do evento `thread.started` do stream JSONL. */
export function extrairThreadId(saida: string): string | null {
  for (const linha of saida.split('\n')) {
    if (!linha.includes('thread.started')) continue;
    try {
      const evento = JSON.parse(linha) as { type?: string; thread_id?: string };
      if (evento.type === 'thread.started' && typeof evento.thread_id === 'string') {
        return evento.thread_id;
      }
    } catch {
      /* linha parcial ainda sendo escrita nao invalida a espera */
    }
  }
  return null;
}

/**
 * Procura o rollout da sessao no estado do proprio Codex.
 *
 * O Codex grava `sessions/AAAA/MM/DD/rollout-<ts>-<thread_id>.jsonl` (medido na 0.153.4).
 * So os dias mais recentes sao varridos: um despacho de agora nao mora num rollout de
 * semanas atras, e varrer o historico inteiro pune quem usa o runtime ha meses.
 */
export function acharRollout(threadId: string, dias = 3, casa: string = casaDoCodex()): string | null {
  const raiz = path.join(casa, 'sessions');
  if (!fs.existsSync(raiz)) return null;
  const diasRecentes: string[] = [];
  const anos = fs.readdirSync(raiz).sort().reverse();
  for (const ano of anos) {
    const dirAno = path.join(raiz, ano);
    if (!fs.statSync(dirAno).isDirectory()) continue;
    for (const mes of fs.readdirSync(dirAno).sort().reverse()) {
      const dirMes = path.join(dirAno, mes);
      if (!fs.statSync(dirMes).isDirectory()) continue;
      for (const dia of fs.readdirSync(dirMes).sort().reverse()) {
        diasRecentes.push(path.join(dirMes, dia));
        if (diasRecentes.length >= dias) break;
      }
      if (diasRecentes.length >= dias) break;
    }
    if (diasRecentes.length >= dias) break;
  }
  for (const dir of diasRecentes) {
    if (!fs.statSync(dir).isDirectory()) continue;
    const achado = fs.readdirSync(dir).find((f) => f.startsWith('rollout-') && f.endsWith(`-${threadId}.jsonl`));
    if (achado) return path.join(dir, achado);
  }
  return null;
}

/**
 * Rate limit na saida real do Codex.
 *
 * Reusa o reconhecimento do claude-bg (frases genericas + horario de reset) e acrescenta
 * as frases proprias do plano ChatGPT. Frase reconhecida sem horario volta `sem-horario`:
 * a janela padrao e decisao da fila do B3, nunca chute do adapter.
 */
const FRASES_DO_CODEX: readonly RegExp[] = [
  /hit your usage limit/i,
  /usage limit(?:s)? (?:reached|exceeded)/i,
  /plan limit/i,
];

export function parseRateLimitCodex(saida: string, agoraMs = Date.now()): SinalDeRateLimit | null {
  const generico = parseRateLimit(saida, agoraMs);
  if (generico) return generico;
  const frase = FRASES_DO_CODEX.find((r) => r.test(saida ?? ''));
  if (!frase) return null;
  const linha = (saida ?? '').split('\n').find((l) => frase.test(l)) ?? saida;
  return { resetEm: null, fonte: 'sem-horario', trecho: linha.trim().slice(0, 200) };
}

/**
 * O ambiente do filho do despacho: o do processo, sem provider pago, com o contexto da condução POR
 * CIMA. RM-052 (fatia 2, D2): a ordem importa, porque e o extra que neutraliza o `ORK_PROJETO` e o
 * modo host herdados de quem despachou.
 */
export function ambienteDoFilho(pedido: Pick<DespachoCodexPedido, 'perfil' | 'ambienteExtra'>,
    base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...ambienteDoDespacho(base, pedido.perfil), ...(pedido.ambienteExtra ?? {}) };
}

/** Despacho governado exige vínculo: nenhum fallback implícito para codex exec. */
export function despachar(pedido: DespachoCodexPedido): DespachoCodexResultado {
  if (!pedido.vinculo) return { ok: false, comando: [], sessionId: null, verificada: false, stdout: '', stderr: '',
    erro: 'runtime.unavailable: despacho Codex exige vínculo de thread/fase/prompt; transporte legado recusado' };
  if (pedido.contextoRuntime) {
    try {
      if (pedido.contextoRuntime.host !== 'codex') throw Error('runtime.context.invalid: host Codex esperado');
      if (pedido.contextoRuntime.threadId !== pedido.vinculo.thread) throw Error('runtime.context.scope: thread do contexto difere do despacho');
      validarContextoRuntime(pedido.contextoRuntime, pedido.cwd);
    } catch (e) { return { ok: false, comando: [], sessionId: null, verificada: false, stdout: '', stderr: '', erro: (e as Error).message }; }
  }
  let ambiente: NodeJS.ProcessEnv;
  try { ambiente = ambienteDoFilho(pedido); }
  catch (e) { return { ok: false, comando: [], sessionId: null, verificada: false, stdout: '', stderr: '', erro: (e as Error).message }; }
  const r = despacharComController(pedido, ambiente);
  if (r.ok) return r;
  // I-33 (D1): o incidente de 18/09 ("Your workspace is out of credits", usage_limit_exceeded)
  // deixa de ser `runtime.unavailable` generico quando a frase aparece na falha do despacho.
  const falhaDeConta = parseFalhaDeConta([r.erro ?? '', r.stderr].join('\n'));
  return falhaDeConta ? { ...r, falhaDeConta, erro: `${falhaDeConta.motivo}: ${falhaDeConta.trecho}` } : r;
}

/** Le os eventos ja escritos no log de um despacho (texto cru do stream `--json`). */
export function logs(logPath: string, linhas = 60): { ok: boolean; texto: string } {
  if (!fs.existsSync(logPath)) return { ok: false, texto: `log nao encontrado: ${logPath}` };
  const uteis = fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  return { ok: true, texto: uteis.slice(-linhas).join('\n') };
}
