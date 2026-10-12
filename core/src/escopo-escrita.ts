import * as fs from 'node:fs';
import * as path from 'node:path';
import { estadoCanonico } from './estado-thread';

/** Autorizar leitura de um tenant nao autoriza escrever em suas threads. */
export const THREADS_PROTEGIDAS: ReadonlySet<string> = new Set([
  'ork-grandeevoluc', 'ork-jornadasdpa', 'ork-renarrativac',
]);

export function validarThreadDeEscrita(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
    throw new Error('scope.thread.invalid');
  }
  if (THREADS_PROTEGIDAS.has(id.toLowerCase())) throw new Error('scope.thread.protected');
}

export function exigirEscopoDeEscrita(threads: readonly string[] | undefined): ReadonlySet<string> {
  if (!Array.isArray(threads) || threads.length === 0) throw new Error('scope.write.required');
  threads.forEach(validarThreadDeEscrita);
  return new Set(threads);
}

/** Um nome autorizado nao pode ser alias de outra thread ou de estado externo. */
export function validarDiretorioDeThread(raiz: string, id: string): void {
  validarThreadDeEscrita(id);
  let dir: string;
  // RM-047: o estadoCanonico já recusa link (estado.link); aqui a recusa mantém o código do escopo.
  try { dir = estadoCanonico(raiz, id); } catch (e) {
    if ((e as Error).message.startsWith('estado.link')) throw new Error('scope.thread.alias');
    throw e;
  }
  for (const candidato of [path.dirname(path.dirname(dir)), path.dirname(dir), dir]) {
    const stat = fs.lstatSync(candidato, { throwIfNoEntry: false });
    if (!stat) throw new Error('scope.thread.missing');
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('scope.thread.alias');
  }
}
