/**
 * RM-037, defeitos de condução de 19 e 20/10/2026, defeito 2: o preparo das dependências da worktree nova.
 *
 * O `git worktree add` traz só o que o git rastreia: o `node_modules` (e o resto que o `.gitignore` deixa de fora) não
 * vem, e a baseline da thread recusava com `baseline.dependencia-ausente` (código 127 no build). O comando é o que o dono
 * declarou em `worktree.dependencias`; roda dentro da worktree nova, depois da trava de criação de threads (que segura
 * outros `ork thread new` por segundos, não por minutos), e aparece na saída e no ledger: nada de rede escondida. Roda
 * pelo mesmo executor do verify, com o `timeout(1)` sobre o grupo de processos e sem `ORK_HITL_*`. A falha não desfaz a
 * worktree nem a thread: quem a criou diz o comando exato para repetir.
 */
import { ResultadoDeComando } from './types';

/** O preparo que passa disto (a rede lenta, o cache vazio) estoura, e a worktree fica como o git a deixou. */
export const PRAZO_DAS_DEPENDENCIAS_MS = 10 * 60 * 1000;

export interface PreparoDasDependencias {
  comando: string;
  ok: boolean;
  code: number;
  causa: ResultadoDeComando['causa'] | null;
  prazoMs: number;
  duracaoMs: number;
  /** A saída de quem falhou, já redigida pelo executor do verify; vazio no sucesso. */
  trecho: string;
}

/**
 * Quem roda o preparo no lugar do executor do verify: o da operacao que o pediu (RM-037, CHECK 3 da ork-rm037defeit2),
 * como o do sandbox do `ork_verify` do MCP, com o prazo e o confinamento dele.
 */
export type ExecutorDoPreparo = (nome: string, comando: string, cwd: string) => ResultadoDeComando;

/** Roda `comando` dentro de `dir`, a worktree que acabou de nascer. */
export function prepararDependencias(dir: string, comando: string, prazoMs = PRAZO_DAS_DEPENDENCIAS_MS,
  executor?: ExecutorDoPreparo): PreparoDasDependencias {
  // Carregado na hora: o verify importa o modulo das threads, que importa este.
  const { executar } = require('./verify') as typeof import('./verify');
  const r = executor ? executor('dependencias', comando, dir) : executar('dependencias', comando, dir, prazoMs);
  return { comando, ok: r.ok, code: r.code, causa: r.causa ?? null, prazoMs, duracaoMs: r.duracaoMs ?? 0,
    trecho: r.ok ? '' : (r.trecho ?? r.resumo) };
}

/** O evento `worktree_dependencias` do ledger da thread. */
export function eventoDoPreparo(dir: string, p: PreparoDasDependencias): Record<string, unknown> {
  return { dir, comando: p.comando, ok: p.ok, code: p.code, causa: p.causa, prazoMs: p.prazoMs, duracaoMs: p.duracaoMs,
    ...(p.ok ? {} : { trecho: p.trecho }), fonte: 'worktree.dependencias do manifesto' };
}

/** A ultima linha util da saida de quem falhou, para caber na linha do aviso. */
export function ultimaLinhaDoPreparo(p: PreparoDasDependencias): string {
  return p.trecho.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)?.slice(0, 240) ?? '';
}
