import type { ExecutorGitHub } from '../../entrega-pr';
import type { PedidoMesclado } from '../contrato';

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
