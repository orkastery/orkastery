/**
 * A CI de um commit no GitLab. O check exigido e lido dos commit statuses do commit, filtrados pelo nome e com as
 * reexecucoes (`all=true`). So um job real de pipeline do projeto e `pipeline-job` (produtor `gitlab-ci`): o status
 * traz o `pipeline_id`, e um job com o mesmo id e o mesmo nome esta na lista de jobs dessa pipeline (status e job sao
 * a mesma linha no GitLab). O `pipeline_id` sozinho nao prova nada: um `POST /statuses` com nome novo entra na
 * pipeline real (pelo `pipeline_id` ou pelo `ref` do MR) e um com `ref` de branch cria uma pipeline `external`; nos
 * dois casos o status e um job `external`, que a lista de jobs nao traz. Ele fica `commit-status`, com o usuario que o
 * criou como produtor.
 *
 * Resultado mesclado e merge train (EE) testam um commit temporario, nao o head. Sem job do check no head, numa
 * instancia que pode te-los (edicao EE ou desconhecida, com a opcao ligada no projeto), a leitura procura a pipeline do
 * pedido cujo commit tem o head como pai (o `CI_MERGE_REQUEST_SOURCE_BRANCH_SHA` que o job recebe); o vinculo e lido
 * do proprio commit, pela API. Pipeline candidata sem esse pai marca `mescladoSemVinculo`.
 *
 * Qualquer erro de leitura, pagina a mais ou item fora do esquema sai como erro, nunca como lista curta.
 */
import { z } from 'zod';
import type { EntradaDoEstadoDeCi } from '../adaptador';
import { paginarPelaApi, type ChamadorDaApi } from '../api';
import type { CheckNoCommit, ChecksDoCommit, ErroDaForja, FonteDoCheck, Resultado } from '../contrato';
import { estadoDoCheck } from '../estado';
import { projetoNaApi } from './pedidos';

const INSTANTES = { created_at: z.string().nullish(), started_at: z.string().nullish(), finished_at: z.string().nullish() };
const STATUS = z.object({ id: z.number().int(), name: z.string(), status: z.string(), target_url: z.string().nullish(),
  pipeline_id: z.number().int().nullish(), author: z.object({ username: z.string() }).passthrough().nullish(), ...INSTANTES }).passthrough();
const JOB = z.object({ id: z.number().int(), name: z.string(), status: z.string(), web_url: z.string().nullish(),
  pipeline: z.object({ id: z.number().int(), project_id: z.number().int().nullish() }).passthrough(), ...INSTANTES }).passthrough();
const PROJETO = z.object({ id: z.number().int(), merge_pipelines_enabled: z.boolean().nullish(), merge_trains_enabled: z.boolean().nullish() })
  .passthrough();
const PEDIDO = z.object({ iid: z.number().int(), sha: z.string().nullish() }).passthrough();
/** O sha completo: o que entra no caminho da API, de fora ou da resposta, tem esta forma. */
const SHA = /^[0-9a-f]{40}$/;
const PIPELINE = z.object({ id: z.number().int(), project_id: z.number().int().nullish(), sha: z.string().regex(SHA), ref: z.string() }).passthrough();
const COMMIT = z.object({ id: z.string(), parent_ids: z.array(z.string()) }).passthrough();

type Job = z.infer<typeof JOB>;
type Instantes = { status: string; created_at?: string | null; started_at?: string | null; finished_at?: string | null };

/** As pipelines distintas que a leitura confere por commit (e por pedido, no resultado mesclado). */
export const MAX_PIPELINES = 10;

const falha = (codigo: ErroDaForja['codigo'], detalhe: string): { ok: false; erro: ErroDaForja } => ({ ok: false, erro: { codigo, detalhe } });

/** Uma lista paginada, cada item no esquema; item fora dele e `forja.resposta-invalida`. */
function lista<T>(api: ChamadorDaApi, caminho: string, esquema: z.ZodType<T, z.ZodTypeDef, unknown>): Resultado<T[]> {
  const lido = paginarPelaApi(api, { caminho });
  if (!lido.ok) return lido;
  const itens = z.array(esquema).safeParse(lido.valor.itens);
  return itens.success ? { ok: true, valor: itens.data } : falha('forja.resposta-invalida', caminho.split('?')[0]);
}

/** Um objeto, no esquema. */
function um<T>(api: ChamadorDaApi, caminho: string, esquema: z.ZodType<T, z.ZodTypeDef, unknown>): Resultado<T> {
  const r = api({ metodo: 'GET', caminho });
  if (!r.ok) return r;
  const lido = esquema.safeParse(r.valor.corpo);
  return lido.success ? { ok: true, valor: lido.data } : falha('forja.resposta-invalida', caminho);
}

/** A data que escolhe o mais novo de um produtor: `null` enquanto pendente; sem data nenhuma, `''` (a mais velha). */
function concluidoEm(fonte: FonteDoCheck, s: Instantes): string | null {
  if (estadoDoCheck(fonte, s.status, null) === 'pendente') return null;
  return s.finished_at ?? s.started_at ?? s.created_at ?? '';
}

const doJob = (j: Job): CheckNoCommit => ({ nome: j.name, fonte: 'pipeline-job', produtor: 'gitlab-ci', status: j.status, conclusao: null,
  url: j.web_url ?? null, concluidoEm: concluidoEm('pipeline-job', j), ordem: j.id });

const jobsDaPipeline = (api: ChamadorDaApi, projeto: string, pipeline: number): Resultado<Job[]> =>
  lista(api, `${projeto}/pipelines/${pipeline}/jobs?include_retried=true`, JOB);

export function estadoDeCiGitlab(e: EntradaDoEstadoDeCi): Resultado<ChecksDoCommit> {
  if (!SHA.test(e.sha)) return falha('forja.pedido-recusado', 'o sha do commit não tem 40 caracteres hexadecimais minúsculos');
  const projeto = projetoNaApi(e.repo);
  const lidos = lista(e.api, `${projeto}/repository/commits/${e.sha}/statuses?name=${encodeURIComponent(e.context)}&all=true`, STATUS);
  if (!lidos.ok) return lidos;
  const doNome = lidos.valor.filter((s) => s.name === e.context);
  const pipelines = [...new Set(doNome.flatMap((s) => (typeof s.pipeline_id === 'number' ? [s.pipeline_id] : [])))].sort((a, b) => a - b);
  if (pipelines.length > MAX_PIPELINES) return falha('forja.incompleto', `${e.context}: ${pipelines.length} pipelines > ${MAX_PIPELINES}`);
  // O job real de cada status: mesma pipeline, mesmo id e mesmo nome. A lista e a do projeto pedido; pipeline de outro
  // projeto nao esta nela (404, que sai como erro).
  const reais = new Map<string, Job>();
  for (const pipeline of pipelines) {
    const jobs = jobsDaPipeline(e.api, projeto, pipeline);
    if (!jobs.ok) return jobs;
    for (const j of jobs.valor) if (j.name === e.context && j.pipeline.id === pipeline) reais.set(`${pipeline}:${j.id}`, j);
  }
  const checks = doNome.map((s): CheckNoCommit => {
    const job = typeof s.pipeline_id === 'number' ? reais.get(`${s.pipeline_id}:${s.id}`) : undefined;
    if (job) return doJob(job);
    return { nome: s.name, fonte: 'commit-status', produtor: s.author?.username ?? null, status: s.status, conclusao: null,
      url: s.target_url ?? null, concluidoEm: concluidoEm('commit-status', s), ordem: s.id };
  });
  if (checks.some((c) => c.fonte === 'pipeline-job')) return { ok: true, valor: { checks, mescladoSemVinculo: false } };
  const mesclado = doResultadoMesclado(e, projeto);
  if (!mesclado.ok) return mesclado;
  return { ok: true, valor: { checks: [...checks, ...mesclado.valor.checks], mescladoSemVinculo: mesclado.valor.mescladoSemVinculo } };
}

/** Os jobs do check na pipeline de resultado mesclado do pedido ligada ao head pelo pai do commit dela. */
function doResultadoMesclado(e: EntradaDoEstadoDeCi, projeto: string): Resultado<ChecksDoCommit> {
  const nada: Resultado<ChecksDoCommit> = { ok: true, valor: { checks: [], mescladoSemVinculo: false } };
  if (e.edicao === 'ce') return nada;
  const opcoes = um(e.api, projeto, PROJETO);
  if (!opcoes.ok) return opcoes;
  if (opcoes.valor.merge_pipelines_enabled !== true && opcoes.valor.merge_trains_enabled !== true) return nada;
  const id = opcoes.valor.id;
  const pedidos = lista(e.api, `${projeto}/repository/commits/${e.sha}/merge_requests`, PEDIDO);
  if (!pedidos.ok) return pedidos;
  let semVinculo = false;
  for (const pedido of pedidos.valor.filter((p) => p.sha === e.sha)) {
    const doPedido = lista(e.api, `${projeto}/merge_requests/${pedido.iid}/pipelines`, PIPELINE);
    if (!doPedido.ok) return doPedido;
    const ref = new RegExp(`^refs/merge-requests/${pedido.iid}/(?:merge|train)$`);
    // So a pipeline do proprio projeto: a de um fork roda o codigo e a CI de outro projeto.
    const candidatas = doPedido.valor.filter((p) => p.project_id === id && p.sha !== e.sha && ref.test(p.ref))
      .sort((a, b) => b.id - a.id).slice(0, MAX_PIPELINES);
    for (const p of candidatas) {
      const commit = um(e.api, `${projeto}/repository/commits/${p.sha}`, COMMIT);
      if (!commit.ok) return commit;
      if (!commit.valor.parent_ids.includes(e.sha)) { semVinculo = true; continue; }
      const jobs = jobsDaPipeline(e.api, projeto, p.id);
      if (!jobs.ok) return jobs;
      const doCheck = jobs.valor.filter((j) => j.name === e.context && j.pipeline.id === p.id && j.pipeline.project_id === id);
      if (doCheck.length) return { ok: true, valor: { checks: doCheck.map(doJob), mescladoSemVinculo: false } };
    }
  }
  return { ok: true, valor: { checks: [], mescladoSemVinculo: semVinculo } };
}
