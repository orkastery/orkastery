// core/src/forja/cache.ts
/**
 * O cache da forja: um arquivo JSON por raiz do estado (`.orkastery/cache/forja.json`) com o que vale 24 h, a versao do
 * servidor e o tipo sondado de um host. Arquivo ilegivel e entrada vencida (ou datada no futuro alem da folga do
 * relogio) sao ignorados; escrita que falha tambem: o cache e conveniencia, e sem ele a leitura consulta de novo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from '../estado-thread';
import { dirEstado } from '../manifest';

export const VALIDADE_DO_CACHE_MS = 24 * 60 * 60 * 1000;
const ARQUIVO = 'forja.json';
const FOLGA_DO_RELOGIO_MS = 5 * 60 * 1000;

/** O diretorio do cache da raiz (a da arvore principal, tambem numa worktree); `null` sem estado legivel. */
export function dirDoCacheDaForja(raiz: string): string | null {
  try { return path.join(dirEstado(raizDoEstado(raiz)), 'cache'); } catch { return null; }
}

function todos(dir: string): Record<string, unknown> {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, ARQUIVO), 'utf8')) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : {};
  } catch { return {}; }
}

/** A entrada da chave gravada ha menos de 24 h, ou `null`. */
export function lerDoCache(dir: string | null, chave: string, agoraMs: number): Record<string, unknown> | null {
  if (!dir) return null;
  const e = todos(dir)[chave];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const t = Date.parse(String((e as Record<string, unknown>).lidoEm));
  return Number.isFinite(t) && t <= agoraMs + FOLGA_DO_RELOGIO_MS && agoraMs - t < VALIDADE_DO_CACHE_MS ? e as Record<string, unknown> : null;
}

/** Grava a entrada com `lidoEm`; pasta 700 e arquivo 600, os modos do estado do projeto. */
export function gravarNoCache(dir: string | null, chave: string, valor: Record<string, unknown>, agoraMs: number): void {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, ARQUIVO),
      `${JSON.stringify({ ...todos(dir), [chave]: { ...valor, lidoEm: new Date(agoraMs).toISOString() } }, null, 2)}\n`, { mode: 0o600 });
  } catch { /* sem escrita, a proxima leitura consulta de novo */ }
}
