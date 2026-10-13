import type { ExecutorGitHub } from '../../entrega-pr';
import type { ExecutorDoGh, PrDaForja } from '../../parado-no-condutor';
import type { PedidoMesclado } from '../contrato';
import { deFora } from '../texto';

const SHA = /^[0-9a-f]{40}$/, BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
function lerJson<T>(r: ReturnType<ExecutorGitHub>): T | null {
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout) as T; } catch { return null; }
}

export function pedidoMescladoGithub(e: { repo: string; numero: number; executor: ExecutorGitHub }): PedidoMesclado | null {
  const pr = lerJson<{ merged?: boolean; merge_commit_sha?: string | null; html_url?: string; title?: string | null; body?: string | null;
    base?: { ref?: string }; head?: { sha?: string; ref?: string } }>(e.executor(`repos/${e.repo}/pulls/${e.numero}`));
  if (!pr) return null;
  return {
    numero: e.numero, mesclado: pr.merged === true,
    mergeSha: typeof pr.merge_commit_sha === 'string' && SHA.test(pr.merge_commit_sha) ? pr.merge_commit_sha : null,
    headSha: typeof pr.head?.sha === 'string' && SHA.test(pr.head.sha) ? pr.head.sha : null,
    base: typeof pr.base?.ref === 'string' && BRANCH.test(pr.base.ref) ? pr.base.ref : null,
    branch: typeof pr.head?.ref === 'string' ? pr.head.ref : null,
    titulo: typeof pr.title === 'string' ? pr.title : null, corpo: typeof pr.body === 'string' ? pr.body : null,
    url: typeof pr.html_url === 'string' ? pr.html_url : null,
  };
}

export function branchPadraoGithub(e: { repo: string; executor: ExecutorGitHub }): string | null {
  const r = lerJson<{ default_branch?: string }>(e.executor(`repos/${e.repo}`));
  return r ? (r.default_branch ?? '') : null;
}

export function pontaDaBranchGithub(e: { repo: string; branch: string; executor: ExecutorGitHub }): string | null {
  const r = lerJson<{ commit?: { sha?: string } }>(e.executor(`repos/${e.repo}/branches/${encodeURIComponent(e.branch)}`));
  return typeof r?.commit?.sha === 'string' && SHA.test(r.commit.sha) ? r.commit.sha : null;
}

export function compararGithub(e: { repo: string; de: string; ate: string; executor: ExecutorGitHub }): string | null {
  const r = lerJson<{ status?: string }>(e.executor(`repos/${e.repo}/compare/${e.de}...${e.ate}`));
  return r ? String(r.status) : null;
}

/** Os campos do `gh pr list` de uma branch: os do `prDaForja`, com o estado de merge do PR aberto. */
const CAMPOS_DA_BRANCH = 'number,state,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,url,createdAt,mergedAt,mergeable';

/** Os PRs de uma branch, da base do projeto, do mais novo para o mais velho. */
export function pedidosDaBranchGithub(e: { host: string; repositorio: string; base: string; branch: string; executor: ExecutorDoGh;
  prazoMs: number }): { prs: PrDaForja[]; erro: string | null } {
  const r = e.executor(['pr', 'list', `--repo=${e.host}/${e.repositorio}`, `--head=${e.branch}`, '--state=all', '--limit=10',
    `--json=${CAMPOS_DA_BRANCH}`], e.prazoMs);
  if (r.status !== 0) return { prs: [], erro: deFora(r.stderr || r.stdout || `codigo ${r.status ?? '-'}`) };
  try {
    const lista = JSON.parse(r.stdout) as unknown;
    if (!Array.isArray(lista)) throw new Error('a resposta nao e uma lista');
    // Carga tardia: o parado-no-condutor chega a este módulo pelo entrega-pr; importar no topo fecharia um ciclo de carga.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prDaForja } = require('../../parado-no-condutor') as typeof import('../../parado-no-condutor');
    const prs = lista.map((p) => prDaForja(p, e.base)).filter((p): p is PrDaForja => !!p && p.branch === e.branch);
    return { prs: prs.sort((a, b) => b.numero - a.numero), erro: null };
  } catch (err) {
    return { prs: [], erro: deFora((err as Error).message) };
  }
}

/** Abre o PR da branch na base. */
export function abrirPedidoGithub(e: { host: string; repositorio: string; base: string; branch: string; titulo: string; corpo: string;
  executor: ExecutorDoGh; prazoMs: number }): { status: number | null; stdout: string; stderr: string } {
  return e.executor(['pr', 'create', `--repo=${e.host}/${e.repositorio}`, `--base=${e.base}`, `--head=${e.branch}`, `--title=${e.titulo}`,
    `--body=${e.corpo}`], e.prazoMs);
}
