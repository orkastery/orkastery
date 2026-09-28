/** Linux flock(2): o descritor do dono mantém a exclusão, inclusive após o helper sair. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Reserva por apresentação. Só o kernel prova abandono; PID e prazo não liberam. */
export function reservarDialogoHitl(dir: string, requestId: string, connectionId: string, recuperar = false): () => void {
  if (process.platform !== 'linux' || !/^[a-f0-9-]{36}$/.test(requestId)) throw Error('hitl.channel.recovery-unproven');
  const file = path.join(dir, `.hitl-dialogue-${requestId}.lock`);
  const flags = fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK |
    (recuperar ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL);
  let fd: number;
  try { fd = fs.openSync(file, flags, 0o600); } catch { throw Error('hitl.channel.recovery-unproven'); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600 || st.nlink !== 1 || st.size > 1024)
      throw Error('hitl.channel.recovery-unproven');
    const r = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd], timeout: 2000 });
    if (r.status !== 0 || r.error) throw Error('hitl.channel.in-use: apresentação ainda reservada pelo kernel');
    const current = fs.lstatSync(file);
    if (current.ino !== st.ino || current.dev !== st.dev || current.isSymbolicLink()) throw Error('hitl.channel.recovery-unproven');
    const metadata = JSON.stringify({ contrato: 'ork.hitl-dialogue/v1', requestId, connectionId });
    if (recuperar) {
      if (fs.readFileSync(fd, 'utf8') !== metadata) throw Error('hitl.channel.recovery-unproven');
    } else { fs.writeFileSync(fd, metadata); fs.fsyncSync(fd); }
    return () => fs.closeSync(fd); // o inode permanece; nunca libera uma reserva por unlink
  } catch (e) { fs.closeSync(fd); throw e; }
}
export function comLockInspecionavel<T>(dir: string, operacao: string, executar: () => T): T {
  if (process.platform !== 'linux') throw new Error('runtime.unavailable: lock HITL exige flock Linux');
  // Mesmo inode/nome do protocolo legado: writer wx antigo também recusa enquanto existir.
  const file = path.join(dir, '.hitl.lock');
  let fd: number, criado = false;
  try { fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); criado = true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid?.() || st.mode & 0o077 || st.nlink !== 1) throw new Error('HITL lock exige arquivo privado do uid');
    const r = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd], timeout: 2000 });
    if (r.status !== 0) throw new Error('HITL ocupado; exclusão do kernel não adquirida');
    // fd 3 no helper é dup do mesmo open file description. Fechar o helper não libera fd no dono.
    const atual = fs.lstatSync(file);
    if (atual.ino !== st.ino || atual.dev !== st.dev || atual.isSymbolicLink()) throw new Error('HITL lock mudou durante aquisição');
    let anterior: unknown = null;
    const raw = fs.readFileSync(fd, 'utf8');
    if (!criado) {
      let v: any; try { v = JSON.parse(raw); } catch { /* legado ambíguo permanece preservado */ }
      if (v?.contrato !== 'ork.hitl-lock/v1') throw new Error('HITL ocupado; lock legado exige inspeção e migração coordenada');
      anterior = { token: v.token, dono: v.dono, estado: v.estado };
    }
    const stat = fs.readFileSync('/proc/self/stat', 'utf8');
    const info = { contrato: 'ork.hitl-lock/v1', token: randomUUID(), operacao, estado: 'ocupado', adquiridoEm: new Date().toISOString(),
      dono: { pid: process.pid, uid: process.getuid!(), bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
        inicio: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], executavel: fs.readlinkSync('/proc/self/exe'), cwd: process.cwd() },
      anterior, evidencia: 'flock exclusivo adquirido pelo kernel; PID/TTL são somente metadados' };
    const salvar = () => { fs.ftruncateSync(fd, 0); fs.writeSync(fd, JSON.stringify(info), 0, 'utf8'); fs.fsyncSync(fd); };
    salvar();
    try { return executar(); }
    finally { info.estado = 'liberado'; salvar(); }
  } finally { fs.closeSync(fd); } // não unlink, não sinal, não TTL
}
