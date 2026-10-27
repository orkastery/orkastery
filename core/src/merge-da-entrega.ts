/**
 * Reconhecimento unico do merge que entrega uma thread na linha de primeiro pai da base.
 *
 * A forja pode preservar o titulo `ship(<thread>)` no assunto ou usar sua mensagem padrao.
 * Nos formatos padrao, a branch e o vinculo: ela precisa ser exatamente a branch registrada
 * para a thread. O fallback pela convencao existe para o `docs verificar` no CI, que nao tem
 * `.orkastery/`, e fecha o id antes de aceitar o sufixo da fase (`ork-abc` nao casa `ork-abcd`).
 */
import { branchValida, shaValido } from './branch-de-estado';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { dirThread } from './thread';
import { exec } from './util';

export interface IdentidadeDaEntrega {
  thread: string;
  /** Branch canonica lida do ledger; `null` somente onde o estado da maquina nao existe. */
  branch: string | null;
}

export interface MergeReconhecido {
  mergeSha: string;
  headSha: string | null;
  em: string | null;
}

/** A branch da thread como foi registrada, preferindo o evento especifico da worktree. */
export function branchRegistradaDaEntrega(raiz: string, thread: string): string | null {
  try {
    const eventos = lerLedger(dirThread(raiz, thread));
    const worktree = [...eventos].reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.worktreeCriada && branchValida(e.branch));
    if (worktree) return String(worktree.branch);
    const criada = [...eventos].reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.threadCriada);
    const base = criada?.base;
    if (base && typeof base === 'object' && !Array.isArray(base)) {
      const branch = (base as Record<string, unknown>).branch;
      if (branchValida(branch)) return branch;
    }
  } catch { /* checkout de CI ou thread sem estado local */ }
  return null;
}

const branchConvencionalDaThread = (branch: string, thread: string): boolean => {
  const prefixo = `ork/${thread}`;
  return branch === prefixo || branch.startsWith(`${prefixo}-`);
};

function threadDoAssunto(assunto: string, entregas: readonly IdentidadeDaEntrega[], base: string): string | null {
  const ship = /^ship\(([^)]+)\)/.exec(assunto);
  if (ship?.[1]) return ship[1];

  const github = /^Merge pull request #[1-9][0-9]* from [^/\s]+\/(\S+)$/.exec(assunto);
  const gitlab = /^Merge branch '(.+)' into '(.+)'$/.exec(assunto);
  const branch = github?.[1] ?? (gitlab?.[2] === base ? gitlab[1] : null);
  if (!branch) return null;
  return entregas.find((entrega) => entrega.branch === null
    ? branchConvencionalDaThread(branch, entrega.thread)
    : branch === entrega.branch)?.thread ?? null;
}

/**
 * Merges das entregas na base, em ordem do git log (mais novo primeiro por omissao).
 *
 * O assunto e lido por `%s`, portanto uma citacao somente no corpo nao entra. `--first-parent`
 * tira commits da branch lateral. O segundo pai continua opcional no retorno para preservar a
 * recusa tipada `entrega.sem-vinculo` de squash/rebase quando a CI e obrigatoria.
 */
export function mergesDasEntregasNaBase(raiz: string, refBase: string, base: string,
  entregas: readonly IdentidadeDaEntrega[], reverse = false): Map<string, MergeReconhecido[]> {
  const saida = new Map(entregas.map((e) => [e.thread, [] as MergeReconhecido[]]));
  if (!branchValida(refBase) || !branchValida(base)) return saida;
  const args = ['log', refBase, '--first-parent', '--format=%H%x09%P%x09%cI%x09%s', ...(reverse ? ['--reverse'] : []), '--'];
  const r = exec('git', args, raiz, 60000);
  if (!r.ok) return saida;

  for (const linha of r.stdout.split('\n')) {
    const [sha, pais, em, assunto] = linha.split('\t');
    if (!shaValido(sha) || typeof assunto !== 'string') continue;
    const thread = threadDoAssunto(assunto, entregas, base);
    if (!thread) continue;
    const segundo = (pais ?? '').split(' ')[1] ?? null;
    const ms = Date.parse(em ?? '');
    const merges = saida.get(thread) ?? [];
    merges.push({
      mergeSha: sha,
      headSha: segundo && shaValido(segundo) ? segundo : null,
      em: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    });
    saida.set(thread, merges);
  }
  return saida;
}
