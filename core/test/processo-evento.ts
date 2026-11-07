import { spawn } from 'node:child_process';
import { esperarEventoAssincrono } from './espera-evento';

export interface ResultadoProcessoPorEvento {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  erro?: Error;
}

/** Executa uma fixture e aguarda o evento terminal do processo, sem transformar um teto de parede em veredito. */
export async function executarProcessoPorEvento(comando: string, argumentos: readonly string[], opcoes: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  descricao: string;
}): Promise<ResultadoProcessoPorEvento> {
  const filho = spawn(comando, argumentos, { cwd: opcoes.cwd, env: opcoes.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  let terminal: ResultadoProcessoPorEvento | null = null;
  filho.stdout.setEncoding('utf8'); filho.stdout.on('data', (parte: string) => { stdout += parte; });
  filho.stderr.setEncoding('utf8'); filho.stderr.on('data', (parte: string) => { stderr += parte; });
  filho.once('error', (erro) => { terminal = { status: null, signal: null, stdout, stderr, erro }; });
  filho.once('close', (status, signal) => { terminal = { status, signal, stdout, stderr }; });
  filho.stdin.end(opcoes.input);
  return esperarEventoAssincrono(() => terminal, opcoes.descricao);
}
