/**
 * Os merge requests do GitLab na forma neutra da porta: os da branch e a abertura do MR. Tudo pela API REST v4 com a
 * CLI logada (`ChamadorDaApi`): o corpo da criacao vai pelo stdin, nunca pelo argv, e nunca arma o merge automatico
 * (`merge_when_pipeline_succeeds`, `auto_merge`): o ork nao mescla. O projeto e o caminho completo, com subgrupos.
 */
import type { PrDaForja } from '../../parado-no-condutor';
import type { ChamadorDaApi } from '../api';
import { deFora } from '../texto';

const SHA = /^[0-9a-f]{40}$/, BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;

/** O projeto na API: o caminho completo codificado (`projects/grupo%2Fsub%2Fprojeto`). */
export const projetoNaApi = (repo: string): string => `projects/${encodeURIComponent(repo)}`;

/** `locked` e o merge em curso: o MR ainda nao entrou na base. */
const ESTADOS: Readonly<Record<string, PrDaForja['estado'] | undefined>> = { opened: 'aberto', locked: 'aberto', merged: 'mesclado', closed: 'fechado' };
/** O GitLab ainda calcula a mesclabilidade: o conflito nao e conhecido. */
const EM_CALCULO = new Set(['unchecked', 'checking', 'preparing', 'approvals_syncing']);

function instante(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Um MR da resposta, ou `null` quando nao e desta base nem deste projeto: de fork (outro projeto de origem), de outra
 * base ou de branch que nao e nome de branch. Formato errado lanca: a leitura inteira vira "nao lida". Os checks ficam
 * vazios: a lista nao traz o job do head.
 */
export function prDoMr(bruto: unknown, base: string): PrDaForja | null {
  if (!bruto || typeof bruto !== 'object') throw new Error('MR fora do formato');
  const m = bruto as Record<string, unknown>;
  const estado = ESTADOS[String(m.state)];
  // As versoes antigas so tem `work_in_progress`.
  const rascunho = typeof m.draft === 'boolean' ? m.draft : m.work_in_progress;
  if (typeof m.iid !== 'number' || !Number.isSafeInteger(m.iid) || m.iid < 1 || typeof m.sha !== 'string' || !SHA.test(m.sha) || !estado ||
      typeof rascunho !== 'boolean') throw new Error('MR fora do formato');
  if (m.source_project_id !== m.target_project_id || m.target_branch !== base || typeof m.source_branch !== 'string' ||
      !BRANCH.test(m.source_branch)) return null;
  const url = typeof m.web_url === 'string' && /^https?:\/\/\S+$/.test(m.web_url) ? m.web_url.slice(0, 300) : null;
  const conflito = estado !== 'aberto' ? undefined : m.has_conflicts === true ? true
    : m.has_conflicts === false && !EM_CALCULO.has(String(m.detailed_merge_status)) ? false : null;
  return { numero: m.iid, branch: m.source_branch, head: m.sha, estado, rascunho, url, criadoEm: instante(m.created_at),
    mescladoEm: instante(m.merged_at), checks: [], ...(conflito !== undefined ? { conflito } : {}) };
}

/** Os MRs de uma branch na base, do mais novo para o mais velho; `erro` com o codigo `forja.*` quando a leitura falha. */
export function pedidosDaBranchGitlab(e: { repositorio: string; base: string; branch: string; prazoMs: number; api?: ChamadorDaApi }):
  { prs: PrDaForja[]; erro: string | null } {
  if (!e.api) return { prs: [], erro: 'forja.sem-capacidade: pedidosDaBranch sem a API do GitLab' };
  const consulta = new URLSearchParams({ source_branch: e.branch, state: 'all', per_page: '100' });
  const r = e.api({ metodo: 'GET', caminho: `${projetoNaApi(e.repositorio)}/merge_requests?${consulta.toString()}`, prazoMs: e.prazoMs });
  if (!r.ok) return { prs: [], erro: deFora(`${r.erro.codigo}: ${r.erro.detalhe}`) };
  // Mais de 100 MRs da mesma branch: a lista nao foi lida inteira, e nunca vira a lista curta.
  if (r.valor.cabecalhos['x-next-page']) return { prs: [], erro: deFora(`forja.incompleto: ${e.branch} > 100`) };
  if (!Array.isArray(r.valor.corpo)) return { prs: [], erro: 'forja.resposta-invalida: a resposta nao e uma lista' };
  try {
    const prs = r.valor.corpo.map((x) => prDoMr(x, e.base)).filter((p): p is PrDaForja => !!p && p.branch === e.branch);
    return { prs: prs.sort((a, b) => b.numero - a.numero), erro: null };
  } catch (err) {
    return { prs: [], erro: deFora(`forja.resposta-invalida: ${(err as Error).message}`) };
  }
}

/**
 * Abre o MR da branch na base. Escrita: nunca se repete sozinha (quem chamou rele a lista). A saida tem a forma da
 * do `gh pr create`: status 0 com o MR criado, ou 1 com o codigo `forja.*` no stderr.
 */
export function abrirPedidoGitlab(e: { repositorio: string; base: string; branch: string; titulo: string; corpo: string; prazoMs: number;
  api?: ChamadorDaApi }): { status: number | null; stdout: string; stderr: string } {
  if (!e.api) return { status: 1, stdout: '', stderr: 'forja.sem-capacidade: abrirPedido sem a API do GitLab' };
  const r = e.api({ metodo: 'POST', caminho: `${projetoNaApi(e.repositorio)}/merge_requests`, prazoMs: e.prazoMs,
    corpo: { source_branch: e.branch, target_branch: e.base, title: e.titulo, description: e.corpo } });
  return r.ok ? { status: 0, stdout: JSON.stringify(r.valor.corpo), stderr: '' }
    : { status: 1, stdout: '', stderr: deFora(`${r.erro.codigo}: ${r.erro.detalhe}`, 300) };
}
