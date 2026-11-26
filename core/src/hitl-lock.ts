/** Linux flock(2): o descritor do dono mantém a exclusão, inclusive após o helper sair. */
import { adquirirTravaPortatil, comTravaPortatil, ErroDaTravaPortatil } from './trava-portatil';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const interpretarJson = (texto: string): unknown => JSON.parse(texto) as unknown;

interface LockHitlGravado {
  contrato: 'ork.hitl-lock/v1';
  token: unknown;
  dono: unknown;
  estado: unknown;
}

function lockHitlGravado(valor: unknown): LockHitlGravado | null {
  if (!valor || typeof valor !== 'object') return null;
  const candidato = valor as Record<string, unknown>;
  return candidato.contrato === 'ork.hitl-lock/v1'
    ? { contrato: candidato.contrato, token: candidato.token, dono: candidato.dono, estado: candidato.estado }
    : null;
}

/** Reserva por apresentação. Só o kernel prova abandono; PID e prazo não liberam. */
export function reservarDialogoHitl(dir: string, requestId: string, connectionId: string, recuperar = false,
  plataforma = process.platform): () => void {
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw Error('hitl.channel.recovery-unproven');
  const file = path.join(dir, `.hitl-dialogue-${requestId}.lock`);
  if (plataforma === 'darwin') {
    let trava;
    try { trava = adquirirTravaPortatil(file, `hitl-dialogue:${requestId}`, { esperarMs: 0 }); }
    catch { throw Error('hitl.channel.recovery-unproven'); }
    if (!trava) throw Error('hitl.channel.in-use: apresentação ainda reservada');
    try {
      const metadata = JSON.stringify({ contrato: 'ork.hitl-dialogue/v1', requestId, connectionId });
      const flags = fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | (recuperar ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL);
      let fd: number;
      try { fd = fs.openSync(file, flags, 0o600); }
      catch { throw Error('hitl.channel.recovery-unproven'); }
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600 || st.nlink !== 1 || st.size > 1024)
          throw Error('hitl.channel.recovery-unproven');
        if (recuperar) {
          if (fs.readFileSync(fd, 'utf8') !== metadata) throw Error('hitl.channel.recovery-unproven');
        } else { fs.writeFileSync(fd, metadata); fs.fsyncSync(fd); }
      } finally { fs.closeSync(fd); }
      let aberta = true;
      const travaAdquirida = trava;
      return () => { if (aberta) { aberta = false; travaAdquirida.liberar(); } };
    } catch (e) { trava.liberar(); throw e; }
  }
  if (plataforma !== 'linux') throw Error('hitl.channel.recovery-unproven');
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
export function comLockInspecionavel<T>(dir: string, operacao: string, executar: () => T, plataforma = process.platform): T {
  // Mesmo inode/nome do protocolo legado: writer wx antigo também recusa enquanto existir.
  const file = path.join(dir, '.hitl.lock');
  if (plataforma === 'darwin') {
    try {
      return comTravaPortatil(file, `hitl:${operacao}`, () => {
        const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
        try {
          const st = fs.fstatSync(fd);
          if (!st.isFile() || st.uid !== process.getuid?.() || st.mode & 0o077 || st.nlink !== 1)
            throw new Error('HITL lock exige arquivo privado do uid');
          let anterior: unknown = null;
          const raw = fs.readFileSync(fd, 'utf8');
          if (raw !== '') {
            let v: LockHitlGravado | null = null;
            try { v = lockHitlGravado(interpretarJson(raw)); } catch { /* legado ambíguo permanece preservado */ }
            if (!v) throw new Error('HITL ocupado; lock legado exige inspeção e migração coordenada');
            anterior = { token: v.token, dono: v.dono, estado: v.estado };
          }
          const info = { contrato: 'ork.hitl-lock/v1', token: randomUUID(), operacao, estado: 'ocupado', adquiridoEm: new Date().toISOString(),
            dono: { pid: process.pid, uid: process.getuid?.() ?? null }, anterior,
            evidencia: 'trava portátil por candidato e identidade de processo; PID/TTL não transferem propriedade' };
          const salvar = () => { fs.ftruncateSync(fd, 0); fs.writeSync(fd, JSON.stringify(info), 0, 'utf8'); fs.fsyncSync(fd); };
          salvar();
          try { return executar(); }
          finally { info.estado = 'liberado'; salvar(); }
        } finally { fs.closeSync(fd); }
      }, { esperarMs: 0 });
    } catch (e) {
      if (e instanceof ErroDaTravaPortatil && e.codigo === 'trava.portatil.ocupada') throw new Error('HITL ocupado; exclusão portátil não adquirida');
      if (e instanceof ErroDaTravaPortatil) throw new Error(`runtime.unavailable: lock HITL sem trava portátil (${e.codigo})`);
      throw e;
    }
  }
  if (plataforma !== 'linux') throw new Error(`runtime.unavailable: lock HITL sem trava portátil em ${plataforma}`);
  // `O_EXCL` abria uma janela no primeiro uso: o criador já tinha publicado o inode, mas ainda não o havia travado
  // nem inicializado; um concorrente podia abrir o arquivo vazio e classificá-lo como legado. Todos abrem o mesmo
  // inode e só interpretam os bytes depois do `flock`, que serializa criação, recuperação e uso normal.
  const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
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
    if (raw !== '') {
      let v: LockHitlGravado | null = null;
      try { v = lockHitlGravado(interpretarJson(raw)); } catch { /* legado ambíguo permanece preservado */ }
      if (!v) throw new Error('HITL ocupado; lock legado exige inspeção e migração coordenada');
      anterior = { token: v.token, dono: v.dono, estado: v.estado };
    }
    const stat = fs.readFileSync('/proc/self/stat', 'utf8');
    const info = { contrato: 'ork.hitl-lock/v1', token: randomUUID(), operacao, estado: 'ocupado', adquiridoEm: new Date().toISOString(),
      dono: { pid: process.pid, uid: process.getuid?.() ?? null, bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
        inicio: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], executavel: fs.readlinkSync('/proc/self/exe'), cwd: process.cwd() },
      anterior, evidencia: 'flock exclusivo adquirido pelo kernel; PID/TTL são somente metadados' };
    const salvar = () => { fs.ftruncateSync(fd, 0); fs.writeSync(fd, JSON.stringify(info), 0, 'utf8'); fs.fsyncSync(fd); };
    salvar();
    try { return executar(); }
    finally { info.estado = 'liberado'; salvar(); }
  } finally { fs.closeSync(fd); } // não unlink, não sinal, não TTL
}
