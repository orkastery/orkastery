/**
 * Locks dos monitores do projeto (`.orkastery/monitor/`).
 *
 * `adquirirLockMonitor` morava em `pulse-delivery.ts`. I-41 (GO-FIX 1) o trouxe para ca porque o
 * receptor do pulse (`pulse-resposta.ts`) tambem precisa dele, e `pulse-delivery` importa o
 * receptor: um ciclo de modulos em tempo de execucao so aparece como `undefined is not a function`.
 * `pulse-delivery` continua reexportando o nome, para quem ja o importava de la.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Lock compartilhado pelos monitores. ESRCH comprova que o dono morreu. */
export function adquirirLockMonitor(lock: string): { ok: true; liberar: () => void } | { ok: false; ativo: boolean; detalhe: string } {
  const pidFile = path.join(lock, 'pid');
  try {
    try { fs.mkdirSync(lock); }
    catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== 'EEXIST') throw erro;
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`lock sem proprietário válido: ${lock}`);
      try { process.kill(pid, 0); return { ok: false, ativo: true, detalhe: 'varredura já em andamento' }; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
      fs.unlinkSync(pidFile); fs.rmdirSync(lock); fs.mkdirSync(lock);
    }
    fs.writeFileSync(pidFile, String(process.pid), { flag: 'wx' });
    return { ok: true, liberar: () => {
      if (fs.readFileSync(pidFile, 'utf8') !== String(process.pid)) throw new Error(`lock mudou de proprietário: ${lock}`);
      fs.unlinkSync(pidFile); fs.rmdirSync(lock);
    } };
  } catch (e) { return { ok: false, ativo: false, detalhe: `lock ocupado ou ilegível em ${lock}: ${(e as Error).message}` }; }
}

const pausa = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * I-41 (GO-FIX 1): o estado da conversa do pulse (consentimento aberto e lote servido) tem dois
 * escritores: a varredura, que abre o pedido do resumo, e o receptor, que grava o sim e o lote.
 * Sem este lock, um sim chegando no meio de uma varredura podia ser sobrescrito por ela. A espera
 * e curta e limitada: nenhum dos dois segura o lock enquanto fala com o transporte.
 */
export function comLockDaConversa<T>(dir: string, executar: () => T, esperaMs = 5000): T {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'pulse-conversa.lock');
  const limite = Date.now() + esperaMs;
  for (;;) {
    const trava = adquirirLockMonitor(lock);
    if (trava.ok) {
      try { return executar(); } finally { trava.liberar(); }
    }
    if (Date.now() >= limite) throw new Error(`conversa do pulse ocupada: ${trava.detalhe}`);
    pausa(50);
  }
}
