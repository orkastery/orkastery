/** D9: journal recuperável para fontes em arquivo, sem reescrever o ledger. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const bytesHash = (v: Buffer | string): string => createHash('sha256').update(v).digest('hex');
function processIdentity(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + ':' + fields[19];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw Error('brain.lock.identity-unavailable');
  }
}
/** Bakery lock with unique contender files. Reaping never unlinks a reusable lock name.
 * Atomic publication + ticket order exclude live writers; PID start/boot identity handles reuse.
 * Linux process identity is required; unidentifiable legacy locks fail closed. */
export function withProcessLock<T>(dir: string, busy: string, run: () => T): T {
  if (fs.existsSync(dir) && !fs.lstatSync(dir).isDirectory()) throw Error('brain.lock.recovery-required');
  fs.mkdirSync(dir, { recursive: true });
  const identity = processIdentity(process.pid);
  if (!identity) throw Error('brain.lock.identity-unavailable');
  const name = randomUUID() + '.json', file = path.join(dir, name);
  const owner = { pid: process.pid, identity, ticket: 0 };
  const contenders = (): { name: string; ticket: number }[] => {
    const result: { name: string; ticket: number }[] = [];
    for (const entry of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      let value;
      try { value = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw Error('brain.lock.corrupt'); }
      if (!Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.identity !== 'string' ||
          !Number.isSafeInteger(value.ticket) || value.ticket < 0) throw Error('brain.lock.corrupt');
      if (processIdentity(value.pid) !== value.identity) {
        // UUID names are never reused: a concurrent reaper cannot remove a new owner.
        try { fs.unlinkSync(path.join(dir, entry)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      } else result.push({ name: entry, ticket: value.ticket });
    }
    return result;
  };
  atomicJson(file, owner);
  try {
    owner.ticket = Math.max(0, ...contenders().map(c => c.ticket)) + 1;
    atomicJson(file, owner);
    if (contenders().some(c => c.name !== name && (c.ticket === 0 || c.ticket < owner.ticket ||
        c.ticket === owner.ticket && c.name < name))) throw Error(busy);
    return run();
  } finally { fs.unlinkSync(file); }
}
export function durableAppend(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
}
function syncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function atomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file); syncDirectory(path.dirname(file));
}
export function readJournal(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (!text.endsWith('\n')) throw Error('brain.journal.incomplete');
  try { return text.trimEnd().split('\n').map(l => JSON.parse(l)); } catch { throw Error('brain.journal.corrupt'); }
}
export function recoverPortfolio(file: string): void {
  const journal = file + '.journal.jsonl', entries = readJournal(journal);
  const finished = new Set(entries.filter(e => e.type === 'confirmed' || e.type === 'aborted').map(e => e.id));
  for (const intent of entries.filter(e => e.type === 'intent' && !finished.has(e.id))) {
    const current = fs.existsSync(file) ? bytesHash(fs.readFileSync(file)) : null;
    if (current !== intent.beforeHash && current !== intent.afterHash) throw Error('brain.journal.source-conflict');
    durableAppend(journal, { type: current === intent.afterHash ? 'confirmed' : 'aborted', id: intent.id, recovered: true });
  }
}
export function replaceWithJournal(file: string, value: unknown, fault: (stage: string) => void = () => {}): void {
  const beforeValue = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const beforeHash = fs.existsSync(file) ? bytesHash(fs.readFileSync(file)) : null;
  const afterHash = bytesHash(JSON.stringify(value, null, 2) + '\n'), id = randomUUID();
  durableAppend(file + '.journal.jsonl', { schema: 'ork.brain-source-intent/v1', type: 'intent', id,
    observedAt: new Date().toISOString(), beforeHash, afterHash, beforeValue, value });
  fault('intent'); atomicJson(file, value); fault('source');
  durableAppend(file + '.journal.jsonl', { type: 'confirmed', id }); fault('confirmed');
}
export function portfolioMutation<T>(file: string, run: () => T): T {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withProcessLock(file + '.lock', 'brain.journal.busy', () => { recoverPortfolio(file); return run(); });
}
