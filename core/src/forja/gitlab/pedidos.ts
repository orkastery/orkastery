/**
 * Os merge requests do GitLab na forma neutra da porta: os da branch e a abertura do MR. Tudo pela API REST v4 com a
 * CLI logada (`ChamadorDaApi`): o corpo da criacao vai pelo stdin, nunca pelo argv, e nunca arma o merge automatico
 * (`merge_when_pipeline_succeeds`, `auto_merge`): o ork nao mescla. O projeto e o caminho completo, com subgrupos.
 */
import type { PrDaForja } from '../../parado-no-condutor';
import type { ChamadorDaApi } from '../api';
import type { PedidoMesclado } from '../contrato';
import { deFora } from '../texto';

const SHA = /^[0-9a-f]{40}$/, BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;

/** O projeto na API: o caminho completo codificado (`projects/grupo%2Fsub%2Fprojeto`). */
export const projetoNaApi = (repo: string): string => `projects/${encodeURIComponent(repo)}`;

/** O estado do MR, no REST e no GraphQL. `locked` e o merge em curso: o MR ainda nao entrou na base. */
export const ESTADOS_DO_MR: Readonly<Record<string, PrDaForja['estado'] | undefined>> = { opened: 'aberto', locked: 'aberto', merged: 'mesclado', closed: 'fechado' };
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
  const estado = ESTADOS_DO_MR[String(m.state)];
  // As versoes antigas so tem `work_in_progress`.
  const rascunho = typeof m.draft === 'boolean' ? m.draft : m.work_in_progress;
  if (typeof m.iid !== 'number' || !Number.isSafeInteger(m.iid) || m.iid < 1 || typeof m.sha !== 'string' || !SHA.test(m.sha) || !estado ||
      typeof rascunho !== 'boolean' || !Number.isSafeInteger(m.source_project_id) || !Number.isSafeInteger(m.target_project_id)) {
    throw new Error('MR fora do formato');
  }
  if (m.source_project_id !== m.target_project_id || m.target_branch !== base || typeof m.source_branch !== 'string' ||
      !BRANCH.test(m.source_branch)) return null;
  const url = typeof m.web_url === 'string' && /^https?:\/\/\S+$/.test(m.web_url) ? m.web_url.slice(0, 300) : null;
  const conflito = estado !== 'aberto' ? undefined : m.has_conflicts === true ? true
    : m.has_conflicts === false && !EM_CALCULO.has(String(m.detailed_merge_status)) ? false : null;
  return { numero: m.iid, branch: m.source_branch, head: m.sha, estado, rascunho, url, criadoEm: instante(m.created_at),
    mescladoEm: instante(m.merged_at), checks: [], ...(conflito !== undefined ? { conflito } : {}) };
}

/** O caminho da lista de MRs de uma branch na API, como a leitura o pede. */
export function caminhoDosMrsDaBranch(repo: string, branch: string): string {
  const consulta = new URLSearchParams({ source_branch: branch, state: 'all', per_page: '100' });
  return `${projetoNaApi(repo)}/merge_requests?${consulta.toString()}`;
}

/** Os MRs de uma branch na base, do mais novo para o mais velho; `erro` com o codigo `forja.*` quando a leitura falha. */
export function pedidosDaBranchGitlab(e: { repositorio: string; base: string; branch: string; prazoMs: number; api?: ChamadorDaApi }):
  { prs: PrDaForja[]; erro: string | null } {
  if (!e.api) return { prs: [], erro: 'forja.sem-capacidade: pedidosDaBranch sem a API do GitLab' };
  const r = e.api({ metodo: 'GET', caminho: caminhoDosMrsDaBranch(e.repositorio, e.branch), prazoMs: e.prazoMs });
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
 * Abre o MR da branch na base. Escrita: nunca se repete sozinha (quem chamou rele a lista). O status e o stderr
 * seguem o `gh pr create` (0, ou 1 com o codigo `forja.*` no stderr); o stdout e o JSON do MR criado.
 */
export function abrirPedidoGitlab(e: { repositorio: string; base: string; branch: string; titulo: string; corpo: string; prazoMs: number;
  api?: ChamadorDaApi }): { status: number | null; stdout: string; stderr: string } {
  if (!e.api) return { status: 1, stdout: '', stderr: 'forja.sem-capacidade: abrirPedido sem a API do GitLab' };
  const r = e.api({ metodo: 'POST', caminho: `${projetoNaApi(e.repositorio)}/merge_requests`, prazoMs: e.prazoMs,
    corpo: { source_branch: e.branch, target_branch: e.base, title: e.titulo, description: e.corpo } });
  return r.ok ? { status: 0, stdout: JSON.stringify(r.valor.corpo), stderr: '' }
    : { status: 1, stdout: '', stderr: deFora(`${r.erro.codigo}: ${r.erro.detalhe}`, 300) };
}

/** O corpo de um GET que deu certo, quando e objeto; `null` sem a API, com erro ou fora do formato. */
function lerObjeto<T>(api: ChamadorDaApi | undefined, caminho: string): T | null {
  if (!api) return null;
  const r = api({ metodo: 'GET', caminho });
  return r.ok && r.valor.corpo !== null && typeof r.valor.corpo === 'object' && !Array.isArray(r.valor.corpo) ? (r.valor.corpo as T) : null;
}

const sha = (v: unknown): string | null => (typeof v === 'string' && SHA.test(v) ? v : null);

/**
 * O MR da entrega externa, pelo `iid`; `null` quando a consulta falha. O merge e o commit de merge (metodos `merge` e
 * `rebase_merge`), o do squash (`ff` com squash) ou o proprio head (`ff` sem squash: o head entra na base sem commit
 * novo, e o `ship(<thread>)` nunca chega a ela; e por isso que essa entrega vem por aqui).
 */
export function pedidoMescladoGitlab(e: { repo: string; numero: number; api?: ChamadorDaApi }): PedidoMesclado | null {
  const mr = lerObjeto<Record<string, unknown>>(e.api, `${projetoNaApi(e.repo)}/merge_requests/${e.numero}`);
  if (!mr) return null;
  const mesclado = mr.state === 'merged';
  const headSha = sha(mr.sha);
  return {
    numero: e.numero, mesclado, headSha,
    mergeSha: sha(mr.merge_commit_sha) ?? sha(mr.squash_commit_sha) ?? (mesclado ? headSha : null),
    base: typeof mr.target_branch === 'string' && BRANCH.test(mr.target_branch) ? mr.target_branch : null,
    branch: typeof mr.source_branch === 'string' ? mr.source_branch : null,
    titulo: typeof mr.title === 'string' ? mr.title : null, corpo: typeof mr.description === 'string' ? mr.description : null,
    url: typeof mr.web_url === 'string' && /^https?:\/\/\S+$/.test(mr.web_url) ? mr.web_url : null,
  };
}

/** A branch padrao do projeto; `''` se a resposta nao a traz; `null` quando a consulta falha. */
export function branchPadraoGitlab(e: { repo: string; api?: ChamadorDaApi }): string | null {
  const p = lerObjeto<{ default_branch?: unknown }>(e.api, projetoNaApi(e.repo));
  return p ? (typeof p.default_branch === 'string' ? p.default_branch : '') : null;
}

/** O sha da ponta da branch (`commit.id` no GitLab); `null` quando a consulta falha ou nao ha sha valido. */
export function pontaDaBranchGitlab(e: { repo: string; branch: string; api?: ChamadorDaApi }): string | null {
  const b = lerObjeto<{ commit?: { id?: unknown } }>(e.api, `${projetoNaApi(e.repo)}/repository/branches/${encodeURIComponent(e.branch)}`);
  return sha(b?.commit?.id);
}

/**
 * A ponta `ate` contem o merge `de`? Pela base de mesclagem (`straight=false`): os commits de `de` que a base de
 * mesclagem com `ate` nao tem. Nenhum: `ahead`; algum: `diverged` (o GitLab nao separa `behind`). `null` sem leitura.
 */
export function compararGitlab(e: { repo: string; de: string; ate: string; api?: ChamadorDaApi }): string | null {
  if (!sha(e.de) || !sha(e.ate)) return null;
  if (e.de === e.ate) return 'identical';
  const consulta = new URLSearchParams({ from: e.ate, to: e.de, straight: 'false' });
  const r = lerObjeto<{ commits?: unknown; compare_timeout?: unknown }>(e.api, `${projetoNaApi(e.repo)}/repository/compare?${consulta.toString()}`);
  if (!r || r.compare_timeout === true || !Array.isArray(r.commits)) return null;
  return r.commits.length === 0 ? 'ahead' : 'diverged';
}
