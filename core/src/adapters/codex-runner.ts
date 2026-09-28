/** D4: supervisor independente do dispatcher, recibo derivado de close/error reais. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export interface IdentidadeProcesso { pid: number; inicio: string; boot: string }
export interface ProcessoCodex {
  schema: 'ork.codex-process/v1'; iniciadoEm: string;
  supervisor: IdentidadeProcesso | null; filho: IdentidadeProcesso | null;
}
export interface ReciboCodex extends ProcessoCodex {
  terminadoEm: string; exitCode: number | null; signal: string | null;
  duracaoMs: number; erro: string | null;
}
export function identidadeProcesso(pid: number): IdentidadeProcesso | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const campos = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const inicio = campos[19];
    if (!/^\d+$/.test(inicio)) return null;
    return { pid, inicio, boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() };
  } catch { return null; }
}
export function estadoProcesso(id: IdentidadeProcesso | null): 'vivo' | 'ausente' | 'desconhecido' {
  if (!id || !Number.isSafeInteger(id.pid) || id.pid <= 0 || !id.inicio || !id.boot) return 'desconhecido';
  const atual = identidadeProcesso(id.pid);
  if (!atual) {
    try { process.kill(id.pid, 0); return 'desconhecido'; }
    catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH' ? 'ausente' : 'desconhecido'; }
  }
  if (atual.inicio !== id.inicio || atual.boot !== id.boot) return 'ausente';
  try {
    const stat = fs.readFileSync(`/proc/${id.pid}/stat`, 'utf8');
    if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')) return 'ausente';
  } catch { return 'desconhecido'; }
  return 'vivo';
}
export function gravarAtomico(file: string, valor: unknown): void {
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(valor) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}

export function iniciarSupervisor(comando: string[], cwd: string, logPath: string, env: NodeJS.ProcessEnv): {
  processoPath: string; reciboPath: string;
} {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  // FD anônimo: o pedido não fica em argv, nem em um arquivo de configuração persistente.
  const tmp = `${logPath}.${randomUUID()}.launch`;
  fs.writeFileSync(tmp, JSON.stringify({ comando, cwd, logPath }), { flag: 'wx', mode: 0o600 });
  const input = fs.openSync(tmp, 'r'); fs.unlinkSync(tmp);
  try {
    const child = spawn(process.execPath, [__filename, '--run'], {
      cwd, env, detached: true, stdio: [input, 'ignore', 'ignore'],
    });
    child.on('error', () => { /* ausência de metadados reprova o timeout do dispatcher */ });
    child.unref();
  } finally { fs.closeSync(input); }
  return { processoPath: logPath + '.process.json', reciboPath: logPath + '.exit.json' };
}

function supervisionar(): void {
  const pedido = JSON.parse(fs.readFileSync(0, 'utf8')) as { comando: string[]; cwd: string; logPath: string };
  const start = Date.now();
  const dados: ProcessoCodex = { schema: 'ork.codex-process/v1', iniciadoEm: new Date(start).toISOString(),
    supervisor: identidadeProcesso(process.pid), filho: null };
  const out = fs.openSync(pedido.logPath, 'ax', 0o600);
  const err = fs.openSync(pedido.logPath + '.stderr', 'ax', 0o600);
  let erro: string | null = null;
  const filho = spawn(pedido.comando[0], pedido.comando.slice(1), { cwd: pedido.cwd, stdio: ['ignore', out, err], env: process.env });
  fs.closeSync(out); fs.closeSync(err);
  dados.filho = filho.pid ? identidadeProcesso(filho.pid) : null;
  gravarAtomico(pedido.logPath + '.process.json', dados);
  filho.once('error', e => { erro = (e as NodeJS.ErrnoException).code ?? 'spawn.error'; });
  filho.once('close', (code, signal) => {
    const recibo: ReciboCodex = { ...dados, terminadoEm: new Date().toISOString(), exitCode: code,
      signal, duracaoMs: Date.now() - start, erro };
    gravarAtomico(pedido.logPath + '.exit.json', recibo);
  });
  // Parada controlada é encaminhada; SIGKILL do supervisor nunca fabrica recibo.
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) process.on(sinal, () => { filho.kill(sinal); });
}
if (require.main === module && process.argv[2] === '--run') supervisionar();
