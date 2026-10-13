/**
 * Spec do suporte a GitLab, secao 9.1: o unico ponto que roda a CLI da forja. Sem shell e sem token: a CLI usa
 * a autenticacao que ja tem. Na fatia 1 cada consumidor mantem o prazo, o teto e o ambiente de antes.
 */
import { spawnSync } from 'node:child_process';
import { acharBinario } from '../rede-forja';
import type { SaidaDoExecutor } from './contrato';

export interface ChamadaDaCli {
  cmd: 'gh' | 'glab'; args: readonly string[]; entrada?: string; prazoMs: number;
  /** O teto de saida de cada consumidor de hoje (fatia 1 mantem o valor; a fatia 2 unifica). */
  maxBuffer: number;
  /** Variaveis apagadas do ambiente herdado (o pulse apaga GH_HOST, GH_REPO e GH_FORCE_TTY). */
  apagar?: readonly string[];
  /** Variaveis acrescentadas ao ambiente herdado. */
  acrescentar?: Readonly<Record<string, string>>;
  /** false: spawna o nome cru, resolvido so pelo PATH (os consumidores que sempre foram assim). Padrao: true. */
  procurarBinario?: boolean;
}

/** A saida do executor, mais a mensagem inteira do erro de spawn (o pulse a mostra no lugar do stderr). */
export interface SaidaDaCli extends SaidaDoExecutor { mensagemDoErro?: string }

export function rodarCli(c: ChamadaDaCli): SaidaDaCli {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(c.acrescentar ?? {}) };
  for (const nome of c.apagar ?? []) delete env[nome];
  const r = spawnSync((c.procurarBinario === false ? null : acharBinario(c.cmd, { env })) ?? c.cmd, [...c.args], {
    input: c.entrada, encoding: 'utf8', timeout: c.prazoMs, maxBuffer: c.maxBuffer, env,
  });
  return { status: r.status, stdout: (r.stdout ?? '').toString(), stderr: (r.stderr ?? '').toString(), sinal: r.signal ?? null,
    ...(r.error ? { erro: (r.error as NodeJS.ErrnoException).code ?? r.error.message, mensagemDoErro: r.error.message } : {}) };
}
