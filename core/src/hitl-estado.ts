import { exigirEscopoDeEscrita } from './escopo-escrita';
/** D2: observação de bloqueio, nunca idade da sessão disfarçada de espera. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dirThread } from './thread';
import { EventoLedger, SessaoNoRadar } from './types';

export function ledgerDeSessao(raiz: string, s: SessaoNoRadar, casa?: string): string {
  return s.thread && raiz
    ? path.join(dirThread(raiz, s.thread.id), 'ledger.jsonl')
    : path.join(casa ?? process.env.ORKASTERY_HOME ?? path.join(os.homedir(), '.orkastery'), 'sessoes.jsonl');
}

function ler(file: string): EventoLedger[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as EventoLedger);
}

function adquirirLock(lock: string): void {
  try { fs.mkdirSync(lock); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const dono = path.join(lock, 'pid');
    if (fs.existsSync(dono)) {
      const pid = Number(fs.readFileSync(dono, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`registro HITL com dono inválido: ${lock}`);
      try { process.kill(pid, 0); throw new Error(`registro HITL ocupado: ${lock}`); }
      catch (erro) { if ((erro as NodeJS.ErrnoException).code !== 'ESRCH') throw erro; }
    } else if (Date.now() - fs.statSync(lock).mtimeMs < 60000) {
      // Janela entre mkdir e a escrita do dono. Lock legado antigo pode ser recuperado.
      throw new Error(`registro HITL ocupado: ${lock}`);
    }
    // A criação seguinte continua exclusiva; concorrente que perder tenta na próxima varredura.
    fs.rmSync(dono, { force: true });
    fs.rmdirSync(lock);
    fs.mkdirSync(lock);
  }
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid), { flag: 'wx' });
}

function liberarLock(lock: string): void {
  const dono = path.join(lock, 'pid');
  if (!fs.existsSync(dono) || fs.readFileSync(dono, 'utf8') !== String(process.pid)) return;
  fs.unlinkSync(dono);
  fs.rmdirSync(lock);
}

export function carimbarSessoes(sessoes: SessaoNoRadar[], opcoes: {
  raiz: string; quando: string; registrar?: boolean; casa?: string;
  escopo?: readonly string[]; registrarMaquina?: boolean;
}): void {
  const autorizadas = opcoes.registrar && !(opcoes.registrarMaquina && !opcoes.escopo)
    ? exigirEscopoDeEscrita(opcoes.escopo) : new Set<string>();
  const grupos = new Map<string, SessaoNoRadar[]>();
  for (const s of sessoes) {
    const file = ledgerDeSessao(opcoes.raiz, s, opcoes.casa);
    grupos.set(file, [...(grupos.get(file) ?? []), s]);
  }
  for (const [file, grupo] of grupos) {
    const escrever = opcoes.registrar === true && grupo.every(s => s.thread
      ? autorizadas.has(s.thread.id) : opcoes.registrarMaquina === true);
    const lock = file + '.hitl-lock';
    if (escrever) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      adquirirLock(lock);
    }
    try {
      const eventos = ler(file);
      for (const s of grupo) {
        let ultimo = eventos.filter(e => e.sessionId === s.sessionId &&
          ['sessao_bloqueada', 'sessao_destravada'].includes(e.tipo)).at(-1);
        const bloqueada = s.classe === 'hitl';
        const destravada = ['trabalhando', 'concluida', 'interrompida', 'abandonada', 'falha'].includes(s.classe);
        if (escrever && s.sessionId &&
            ((bloqueada && ultimo?.tipo !== 'sessao_bloqueada') ||
             (destravada && ultimo?.tipo === 'sessao_bloqueada'))) {
          ultimo = { ts: opcoes.quando, thread: s.thread?.id ?? '',
            tipo: bloqueada ? 'sessao_bloqueada' : 'sessao_destravada', sessionId: s.sessionId,
            fase: s.thread?.fase ?? null, tipoDeHitl: s.tipoDeHitl, pergunta: s.pergunta,
            fonte: 'ork sessions hitl --registrar', estadoRuntime: s.estadoBruto };
          fs.appendFileSync(file, JSON.stringify(ultimo) + '\n', { mode: 0o600 });
          eventos.push(ultimo);
        }
        s.bloqueadaDesdeEm = bloqueada && ultimo?.tipo === 'sessao_bloqueada' ? ultimo.ts : null;
        s.paradaHaMin = s.bloqueadaDesdeEm
          ? Math.max(0, Math.floor((Date.parse(opcoes.quando) - Date.parse(s.bloqueadaDesdeEm)) / 60000)) : null;
      }
    } finally { if (escrever) liberarLock(lock); }
  }
}
