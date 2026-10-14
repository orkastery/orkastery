/**
 * O unico ponto que roda a CLI da forja. Sem shell e sem token: a CLI usa a autenticacao que ja tem. Cada consumidor
 * diz o prazo, o teto de saida e o ambiente; a CI e a entrega externa usam 32 MiB, como a leitura da forja, e o gh
 * e achado pelo `acharBinario` salvo nos consumidores que pedem `procurarBinario: false`.
 */
import { spawnSync } from 'node:child_process';
import { acharBinario } from '../rede-forja';
import type { SaidaDoExecutor } from './contrato';

export interface ChamadaDaCli {
  cmd: 'gh' | 'glab'; args: readonly string[]; entrada?: string; prazoMs: number;
  /** O teto de saida do processo (`maxBuffer` do spawn); a CI, a entrega externa e a leitura da forja usam 32 MiB. */
  maxBuffer: number;
  /** Variaveis apagadas do ambiente herdado (o pulse apaga GH_HOST, GH_REPO e GH_FORCE_TTY). */
  apagar?: readonly string[];
  /** Variaveis acrescentadas ao ambiente herdado. */
  acrescentar?: Readonly<Record<string, string>>;
  /** false: spawna o nome cru, resolvido so pelo PATH (os consumidores que sempre foram assim). Padrao: true. */
  procurarBinario?: boolean;
  /** O diretorio do processo; sem ele, o do `ork`. A API usa um neutro: o `glab` le o host do remoto do cwd. */
  cwd?: string;
  /** true: so passa o que a CLI precisa (PATH, HOME, locale, proxy, keyring e as variaveis da propria CLI). */
  reduzido?: boolean;
}

/** A saida do executor, mais a mensagem inteira do erro de spawn (o pulse a mostra no lugar do stderr). */
export interface SaidaDaCli extends SaidaDoExecutor { mensagemDoErro?: string }

/** O que a CLI da forja le do ambiente: o resto (chaves de outros servicos, `NODE_OPTIONS`) nao chega a ela. */
const VARIAVEIS_DA_CLI = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_MESSAGES', 'TMPDIR', 'XDG_CONFIG_HOME',
  'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'ORK_BINARIOS_EXTRA', 'NO_COLOR']);
const PREFIXOS_DA_CLI = ['GH_', 'GLAB_', 'GITLAB_', 'GITHUB_'];

/** O ambiente reduzido: os tokens que a CLI le do ambiente passam sem o `ork` le-los. */
export function ambienteReduzido(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const saida: NodeJS.ProcessEnv = {};
  for (const [nome, valor] of Object.entries(env)) {
    if (valor !== undefined && (VARIAVEIS_DA_CLI.has(nome) || PREFIXOS_DA_CLI.some((p) => nome.startsWith(p)))) saida[nome] = valor;
  }
  return saida;
}

export function rodarCli(c: ChamadaDaCli): SaidaDaCli {
  const env: NodeJS.ProcessEnv = { ...(c.reduzido ? ambienteReduzido(process.env) : process.env), ...(c.acrescentar ?? {}) };
  for (const nome of c.apagar ?? []) delete env[nome];
  const r = spawnSync((c.procurarBinario === false ? null : acharBinario(c.cmd, { env })) ?? c.cmd, [...c.args], {
    cwd: c.cwd, input: c.entrada, encoding: 'utf8', timeout: c.prazoMs, maxBuffer: c.maxBuffer, env,
  });
  return { status: r.status, stdout: (r.stdout ?? '').toString(), stderr: (r.stderr ?? '').toString(), sinal: r.signal ?? null,
    ...(r.error ? { erro: (r.error as NodeJS.ErrnoException).code ?? r.error.message, mensagemDoErro: r.error.message } : {}) };
}
