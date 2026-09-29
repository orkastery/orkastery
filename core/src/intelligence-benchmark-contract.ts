/**
 * I-31 KG1 (D1, D6 a D8, D10): contrato `ork.graph-benchmark/v1` do experimento A/B do grafo.
 *
 * A e o fluxo de leitura existente, B e o mesmo fluxo com o grafo deterministico; o resto do
 * par fica fixo no protocolo. Validacao do registro e avaliacao do resultado sao funcoes
 * separadas: estrutura invalida e erro de contrato, e so um registro valido recebe veredito.
 * Modulo puro (D10): nao executa modelo, nao le telemetria nem arquivo. Avalia o que recebe.
 * O KG1 nao traz medicao real: registro sintetico nunca e publicavel como economia medida.
 */
import { z } from 'zod';
import { GRAFO_SCHEMA, canonico, compararUtf8, sha256DoCanonico } from './intelligence-graph-contract';

export const BENCHMARK_SCHEMA = 'ork.graph-benchmark/v1' as const;
export const PROTOCOLO_KG1 = 'kg1-ab/1' as const;

/** D7: de onde veio a medida. So as duas primeiras demonstram consumo. */
export const ORIGENS_DE_MEDIDA = ['runtime_reported', 'tokenizer_exact', 'estimated', 'unavailable'] as const;
export const ORIGENS_DE_CONSUMO_MEDIDO: readonly OrigemDeMedida[] = ['runtime_reported', 'tokenizer_exact'];
export type OrigemDeMedida = typeof ORIGENS_DE_MEDIDA[number];
export const DESFECHOS = ['completed', 'task-failed', 'timeout', 'cancelled', 'error', 'instrumentation-failed'] as const;
export type Desfecho = typeof DESFECHOS[number];
/** Desfechos que admitem nova tentativa; a tentativa conta no consumo do par. */
export const DESFECHOS_COM_RETRY: readonly Desfecho[] = ['task-failed', 'timeout', 'error', 'instrumentation-failed'];
export const METRICAS_REQUERIVEIS = ['logical_total_tokens', 'residual_context_tokens', 'tool_calls', 'latency_ms', 'cost', 'index_preparation'] as const;
export type MetricaRequerivel = typeof METRICAS_REQUERIVEIS[number];
export const METODO_DE_LATENCIA = 'monotonic-clock' as const;

/** D8: motivos de `fail` (rigor violado ou mediana sem ganho com dados completos). */
export const MOTIVOS_DE_FALHA = [
  'fato-perdido', 'claim-nao-preservada', 'verify-falhou', 'verify-nao-preservado', 'aresta-falsa',
  'tarefa-nao-concluida', 'mediana-nao-menor',
] as const;
/** D8: motivos de `inconclusive` (dado, controle ou auditoria insuficiente). */
export const MOTIVOS_DE_LACUNA = [
  'amostra-incompleta', 'aquecimento-divergente', 'controles-divergentes', 'pergunta-divergente', 'ordem-divergente', 'falha-de-instrumentacao',
  'tarefa-cancelada', 'metrica-primaria-ausente', 'metrica-primaria-sem-consumo-medido', 'origens-nao-equivalentes',
  'metrica-requerida-ausente', 'metrica-requerida-estimada', 'auditoria-incompleta',
] as const;
export type MotivoDeFalha = typeof MOTIVOS_DE_FALHA[number];
export type MotivoDeLacuna = typeof MOTIVOS_DE_LACUNA[number];

const MAX = Number.MAX_SAFE_INTEGER;
const inteiro = z.number().int().min(0).max(MAX);
const positivo = z.number().int().min(1).max(100_000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const texto = z.string().min(1).max(512);
const instante = z.string().datetime({ offset: true });
const idDeAresta = z.string().regex(/^edge-[a-f0-9]{64}$/);
const idDeSnapshot = z.string().regex(/^snap-[a-f0-9]{64}$/);
const referencia = z.object({ ref: texto, sha256 }).strict();

const baseDaMedida = {
  value: z.number().finite().min(0).nullable(),
  source: z.enum(ORIGENS_DE_MEDIDA),
  method: texto,
  method_version: texto,
  evidence_ref: referencia.nullable(),
  unavailable_reason: texto.nullable(),
};
export const medidaDeTokensSchema = z.object({ ...baseDaMedida, unit: z.literal('tokens') }).strict();
export const medidaDeChamadasSchema = z.object({ ...baseDaMedida, unit: z.literal('calls') }).strict();
export const medidaDeLatenciaSchema = z.object({ ...baseDaMedida, unit: z.literal('ms') }).strict();
/** D7: contexto residual com a janela e o ponto de leitura. */
export const medidaDeContextoSchema = z.object({
  ...baseDaMedida, unit: z.literal('tokens'), window_tokens: inteiro.nullable(), read_point: z.enum(['task-end']),
}).strict();
/** D7: custo com moeda, natureza e tabela; assinatura nao atribuivel e `null` com motivo. */
export const medidaDeCustoSchema = z.object({
  ...baseDaMedida, unit: z.string().regex(/^[A-Z]{3}$/),
  cost_kind: z.enum(['paid', 'marginal', 'attributed']).nullable(),
  rate_card: z.object({ id, version: texto }).strict().nullable(),
}).strict();

export const metricasSchema = z.object({
  logical_total_tokens: medidaDeTokensSchema,
  input_total_tokens: medidaDeTokensSchema,
  output_total_tokens: medidaDeTokensSchema,
  cached_input_tokens: medidaDeTokensSchema,
  reasoning_tokens: medidaDeTokensSchema,
  residual_context_tokens: medidaDeContextoSchema,
  tool_calls: medidaDeChamadasSchema,
  latency_ms: medidaDeLatenciaSchema,
  cost: medidaDeCustoSchema,
}).strict();

/** Uma requisicao ao modelo, em delta: telemetria cumulativa chega aqui ja convertida. */
export const requisicaoSchema = z.object({
  request_id: id, input_total_tokens: inteiro, output_total_tokens: inteiro, cached_input_tokens: inteiro, reasoning_tokens: inteiro,
}).strict();

/** D6: tudo o que fica igual nos dois bracos do par. */
export const controlesSchema = z.object({
  model: texto, model_revision: texto, provider: texto, runtime: texto, runtime_version: texto, effort: texto,
  sampling: z.object({
    temperature: z.number().finite().min(0).max(10).nullable(),
    top_p: z.number().finite().min(0).max(1).nullable(),
    seed: z.number().int().min(0).max(MAX).nullable(),
    seed_unavailable_reason: texto.nullable(),
  }).strict(),
  base_prompt_hash: sha256, tools_hash: sha256, stop_rules_hash: sha256,
  budget: z.object({ max_total_tokens: inteiro, max_context_tokens: inteiro, max_wall_ms: inteiro }).strict(),
  snapshot_id: idDeSnapshot,
  tenant_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  acl_policy_hash: sha256,
}).strict();

export const tarefaSchema = z.object({
  task_id: id, question_hash: sha256,
  mandatory_fact_ids: z.array(id).min(1).max(1000),
  claim_ids: z.array(id).max(1000),
  verifiers: z.array(z.object({ verify_id: id, command_hash: sha256 }).strict()).max(1000),
}).strict();

export const parSchema = z.object({ pair_id: id, task_id: id, repetition: positivo, order: z.enum(['AB', 'BA']) }).strict();

/** D6: fixado antes da primeira execucao. */
export const protocoloSchema = z.object({
  protocol_version: z.literal(PROTOCOLO_KG1),
  corpus: z.object({ corpus_id: id, corpus_version: texto, corpus_hash: sha256 }).strict(),
  tasks: z.array(tarefaSchema).min(1).max(1000),
  repetitions_per_task: positivo,
  pairs: z.array(parSchema).min(1).max(100_000),
  order_seed: texto,
  controls: controlesSchema,
  treatment: z.object({
    graph_schema: z.literal(GRAFO_SCHEMA), graph_digest: sha256, snapshot_id: idDeSnapshot, edge_count: inteiro,
    /** D8: digest do conjunto de `edge_id` do grafo, que ancora o universo da auditoria. */
    edge_set_digest: sha256,
  }).strict(),
  environment_hash: sha256,
  cache_policy: z.enum(['cold', 'warm']),
  warmup_runs_per_arm: z.number().int().min(0).max(100),
  retry_policy: z.object({ max_attempts: z.number().int().min(1).max(100) }).strict(),
  tool_call_convention: z.enum(['model-requested', 'executed']),
  latency_boundary: z.literal('end-to-end'),
  primary_metric: z.literal('logical_total_tokens'),
  required_metrics: z.array(z.enum(METRICAS_REQUERIVEIS)).min(1).max(METRICAS_REQUERIVEIS.length),
}).strict();

/** D8: auditoria de arestas do grafo usado pelo braco B. */
export const auditoriaSchema = z.object({
  graph_digest: sha256,
  universe_edge_ids: z.array(idDeAresta).max(500_000),
  examined: z.array(z.object({
    edge_id: idDeAresta, result: z.enum(['supported', 'false', 'unverified']), source_refs: z.array(referencia).max(64),
  }).strict()).max(500_000),
  method: texto,
  method_version: texto,
}).strict();

export const execucaoSchema = z.object({
  run_id: id, session_id: id, pair_id: id.nullable(), arm: z.enum(['A', 'B']), task_id: id,
  repetition: positivo.nullable(), attempt: z.number().int().min(1).max(100), warmup: z.boolean(),
  started_at: instante, ended_at: instante, outcome: z.enum(DESFECHOS),
  controls: controlesSchema, question_hash: sha256,
  metrics: metricasSchema,
  requests: z.array(requisicaoSchema).max(10_000),
  mandatory_fact_results: z.array(z.object({ fact_id: id, result: z.enum(['present', 'missing']) }).strict()).max(1000),
  claim_results: z.array(z.object({ claim_id: id, result: z.enum(['verified', 'failed', 'removed']) }).strict()).max(1000),
  verify_results: z.array(z.object({
    verify_id: id, command_hash: sha256, exit_code: z.number().int().nullable(), result: z.enum(['pass', 'fail']),
  }).strict()).max(1000),
  edge_audit: auditoriaSchema.nullable(),
  artifacts: z.array(referencia).max(1000),
}).strict();

export const benchmarkSchema = z.object({
  schema: z.literal(BENCHMARK_SCHEMA),
  experiment_id: id,
  data_class: z.enum(['synthetic', 'measured']),
  status: z.enum(['not-run', 'partial', 'complete']),
  protocol: protocoloSchema,
  /** D6: preparo do indice fica separado da consulta, nunca escondido nela. */
  index_preparation: z.object({
    scenario: z.enum(['cold', 'warm']), amortization_hypothesis: texto,
    logical_total_tokens: medidaDeTokensSchema, latency_ms: medidaDeLatenciaSchema, cost: medidaDeCustoSchema,
  }).strict(),
  runs: z.array(execucaoSchema).max(200_000),
  receipts_review: z.object({ state: z.enum(['pending', 'reviewed']), receipt_ref: referencia.nullable() }).strict(),
  evidence_refs: z.array(referencia).max(10_000),
}).strict();

export type RegistroDeBenchmark = z.infer<typeof benchmarkSchema>;
export type Execucao = z.infer<typeof execucaoSchema>;
export type Protocolo = z.infer<typeof protocoloSchema>;
type Medida = z.infer<typeof medidaDeTokensSchema> | z.infer<typeof medidaDeChamadasSchema> | z.infer<typeof medidaDeLatenciaSchema>
  | z.infer<typeof medidaDeContextoSchema> | z.infer<typeof medidaDeCustoSchema>;

/** D8: digest do conjunto de arestas, na ordem dos bytes UTF-8, para ancorar a auditoria ao grafo. */
export const digestDoConjuntoDeArestas = (ids: readonly string[]): string => sha256DoCanonico([...ids].sort(compararUtf8));

function falha(codigo: string, onde?: string): never {
  throw new Error(onde ? `${codigo} em ${onde}` : codigo);
}

function semRepeticao(valores: readonly string[], codigo: string, onde: string): Set<string> {
  const s = new Set(valores);
  if (s.size !== valores.length) falha(codigo, onde);
  return s;
}

/** D7: ausente e explicito. Nunca zero no lugar de desconhecido, nunca valor sem evidencia. */
function conferirMedida(m: Medida, inteira: boolean, onde: string): void {
  const ausente = m.value === null;
  if (ausente !== (m.source === 'unavailable') || ausente !== (m.unavailable_reason !== null)) falha('benchmark.metrica.ausencia-inconsistente', onde);
  if (ausente) return;
  if (m.evidence_ref === null) falha('benchmark.metrica.sem-evidencia', onde);
  if (inteira && !Number.isSafeInteger(m.value)) falha('benchmark.metrica.nao-inteiro', onde);
}

function conferirCusto(m: z.infer<typeof medidaDeCustoSchema>, onde: string): void {
  conferirMedida(m, false, onde);
  if (m.value === null) {
    if (m.cost_kind !== null) falha('benchmark.metrica.custo-sem-origem', onde);
    return;
  }
  if (m.cost_kind === null || (m.source !== 'runtime_reported' && m.rate_card === null)) falha('benchmark.metrica.custo-sem-origem', onde);
}

function conferirLatencia(m: z.infer<typeof medidaDeLatenciaSchema>, onde: string): void {
  conferirMedida(m, false, onde);
  if (m.value !== null && m.method !== METODO_DE_LATENCIA) falha('benchmark.metrica.latencia-sem-relogio-monotonico', onde);
  // Tokenizador nao mede tempo: latencia medida vem do executor.
  if (m.source === 'tokenizer_exact') falha('benchmark.metrica.origem-invalida', onde);
}

/** Custo por tabela herda a origem dos tokens que ele multiplica. */
function conferirOrigemDoCusto(custo: z.infer<typeof medidaDeCustoSchema>, tokens: z.infer<typeof medidaDeTokensSchema>, onde: string): void {
  if (custo.value !== null && custo.rate_card !== null && ORIGENS_DE_CONSUMO_MEDIDO.includes(custo.source) && custo.source !== tokens.source) {
    falha('benchmark.metrica.origem-invalida', onde);
  }
}

function conferirSeed(c: Execucao['controls'], onde: string): void {
  if ((c.sampling.seed === null) === (c.sampling.seed_unavailable_reason === null)) falha('benchmark.controle.seed-sem-motivo', onde);
}

const TOKENS = ['input_total_tokens', 'output_total_tokens', 'cached_input_tokens', 'reasoning_tokens'] as const;
type Requisicao = z.infer<typeof requisicaoSchema>;
/** O que cada medida de tokens soma nas requisicoes; o total logico e entrada mais saida. */
const PARCELAS: Record<'logical_total_tokens' | typeof TOKENS[number], (q: Requisicao) => number> = {
  logical_total_tokens: (q) => q.input_total_tokens + q.output_total_tokens,
  input_total_tokens: (q) => q.input_total_tokens,
  output_total_tokens: (q) => q.output_total_tokens,
  cached_input_tokens: (q) => q.cached_input_tokens,
  reasoning_tokens: (q) => q.reasoning_tokens,
};

/** D7: subconjuntos reportados, nunca somados duas vezes; requisicao contada uma vez so. */
function conferirTokens(r: Execucao, requisicoes: Set<string>, onde: string): void {
  const m = r.metrics;
  for (const k of ['logical_total_tokens', ...TOKENS] as const) conferirMedida(m[k], true, `${onde}.metrics.${k}`);
  const [total, entrada, saida, cache, raciocinio] = [m.logical_total_tokens, ...TOKENS.map((k) => m[k])].map((x) => x.value);
  if (total !== null && entrada !== null && saida !== null && total !== entrada + saida) falha('benchmark.metrica.total-inconsistente', onde);
  if ((cache !== null && entrada !== null && cache > entrada) || (raciocinio !== null && saida !== null && raciocinio > saida)) {
    falha('benchmark.metrica.subconjunto-inconsistente', onde);
  }
  r.requests.forEach((q, i) => {
    if (requisicoes.has(q.request_id)) falha('benchmark.metrica.requisicao-recontada', `${onde}.requests.${i}`);
    requisicoes.add(q.request_id);
    if (q.cached_input_tokens > q.input_total_tokens || q.reasoning_tokens > q.output_total_tokens) {
      falha('benchmark.metrica.subconjunto-inconsistente', `${onde}.requests.${i}`);
    }
  });
  // A metrica primaria tambem se concilia: total declarado sem as requisicoes que o somam nao vale.
  // So a tentativa nao concluida que caiu antes da primeira requisicao mede zero sem requisicoes.
  const caiuAntes = r.outcome !== 'completed' && r.requests.length === 0;
  for (const k of ['logical_total_tokens', ...TOKENS] as const) {
    const medida = m[k];
    if (medida.value === null) continue;
    if ((ORIGENS_DE_CONSUMO_MEDIDO as readonly string[]).includes(medida.source) && r.requests.length === 0 && !(caiuAntes && medida.value === 0)) {
      falha('benchmark.metrica.sem-requisicoes', onde);
    }
    if (r.requests.length && medida.value !== r.requests.reduce((s, q) => s + PARCELAS[k](q), 0)) falha('benchmark.metrica.requisicoes-divergentes', onde);
  }
  // Sem requisicao ao modelo nao ha chamada de ferramenta pedida por ele.
  if (r.requests.length === 0 && m.tool_calls.value !== null && m.tool_calls.value > 0) falha('benchmark.metrica.chamadas-sem-requisicao', onde);
}

function conferirProtocolo(p: Protocolo): void {
  conferirSeed(p.controls, 'protocol.controls');
  if (p.treatment.snapshot_id !== p.controls.snapshot_id) falha('benchmark.protocolo.tratamento-divergente');
  semRepeticao(p.tasks.map((t) => t.task_id), 'benchmark.protocolo.tarefa-duplicada', 'protocol.tasks');
  p.tasks.forEach((t, i) => {
    const onde = `protocol.tasks.${i}`;
    semRepeticao(t.mandatory_fact_ids, 'benchmark.protocolo.id-duplicado', onde);
    semRepeticao(t.claim_ids, 'benchmark.protocolo.id-duplicado', onde);
    semRepeticao(t.verifiers.map((v) => v.verify_id), 'benchmark.protocolo.id-duplicado', onde);
  });
  semRepeticao(p.pairs.map((q) => q.pair_id), 'benchmark.protocolo.par-duplicado', 'protocol.pairs');
  const tarefas = new Set(p.tasks.map((t) => t.task_id)), repeticoes = new Set<string>(), ordens = new Map<string, number>();
  p.pairs.forEach((q, i) => {
    const onde = `protocol.pairs.${i}`;
    if (!tarefas.has(q.task_id)) falha('benchmark.protocolo.tarefa-ausente', onde);
    const chave = canonico([q.task_id, q.repetition]);
    if (q.repetition > p.repetitions_per_task || repeticoes.has(chave)) falha('benchmark.protocolo.repeticao-invalida', onde);
    repeticoes.add(chave);
    ordens.set(q.task_id, (ordens.get(q.task_id) ?? 0) + (q.order === 'AB' ? 1 : -1));
  });
  if (p.pairs.length !== p.tasks.length * p.repetitions_per_task) falha('benchmark.protocolo.amostra-inconsistente');
  // D6: ordem AB/BA balanceada por tarefa, segundo a seed registrada.
  if ([...ordens.values()].some((saldo) => Math.abs(saldo) > 1)) falha('benchmark.protocolo.ordem-desbalanceada');
  semRepeticao(p.required_metrics, 'benchmark.protocolo.id-duplicado', 'protocol.required_metrics');
  if (!p.required_metrics.includes('logical_total_tokens')) falha('benchmark.protocolo.metrica-primaria-ausente');
}

function conferirAuditoria(r: Execucao, p: Protocolo, onde: string): void {
  const a = r.edge_audit;
  if (a === null) return;
  if (r.arm === 'A') falha('benchmark.auditoria.braco-a', onde);
  if (a.graph_digest !== p.treatment.graph_digest) falha('benchmark.auditoria.grafo-divergente', onde);
  const universo = semRepeticao(a.universe_edge_ids, 'benchmark.auditoria.duplicada', onde);
  semRepeticao(a.examined.map((e) => e.edge_id), 'benchmark.auditoria.duplicada', onde);
  for (const e of a.examined) {
    if (!universo.has(e.edge_id)) falha('benchmark.auditoria.fora-do-universo', onde);
    if (e.result !== 'unverified' && e.source_refs.length === 0) falha('benchmark.auditoria.sem-fonte', onde);
  }
}

function conferirResultados(r: Execucao, t: z.infer<typeof tarefaSchema>, onde: string): void {
  const grupos: [string[], string[]][] = [
    [r.mandatory_fact_results.map((x) => x.fact_id), t.mandatory_fact_ids],
    [r.claim_results.map((x) => x.claim_id), t.claim_ids],
    [r.verify_results.map((x) => x.verify_id), t.verifiers.map((v) => v.verify_id)],
  ];
  for (const [registrados, previstos] of grupos) {
    const s = semRepeticao(registrados, 'benchmark.run.resultado-duplicado', onde), esperado = new Set(previstos);
    if ([...s].some((x) => !esperado.has(x))) falha('benchmark.run.resultado-desconhecido', onde);
    if (r.outcome === 'completed' && s.size !== esperado.size) falha('benchmark.run.resultados-incompletos', onde);
  }
  for (const v of r.verify_results) {
    if ((v.result === 'pass') !== (v.exit_code === 0)) falha('benchmark.run.verify-inconsistente', onde);
  }
}

/** Chave do braco de um par. */
const chaveDoBraco = (pairId: string, arm: 'A' | 'B'): string => `${pairId}\u0000${arm}`;

/**
 * Validacao estrutural e semantica pura do registro. Devolve o registro ou lanca `benchmark.*`.
 * Nao julga o experimento: isso e `avaliarBenchmark`.
 */
export function validarBenchmark(entrada: unknown): RegistroDeBenchmark {
  if (entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada) && 'schema' in entrada &&
      (entrada as { schema: unknown }).schema !== BENCHMARK_SCHEMA) falha('benchmark.versao.incompativel');
  const parse = benchmarkSchema.safeParse(entrada);
  if (!parse.success) falha('benchmark.estrutura.invalida', parse.error.issues[0]?.path.join('.') || 'raiz');
  const b = parse.data, p = b.protocol;
  conferirProtocolo(p);
  if (b.index_preparation.scenario !== p.cache_policy) falha('benchmark.preparo.cenario-divergente');
  conferirMedida(b.index_preparation.logical_total_tokens, true, 'index_preparation.logical_total_tokens');
  conferirLatencia(b.index_preparation.latency_ms, 'index_preparation.latency_ms');
  conferirCusto(b.index_preparation.cost, 'index_preparation.cost');
  conferirOrigemDoCusto(b.index_preparation.cost, b.index_preparation.logical_total_tokens, 'index_preparation.cost');
  if (b.receipts_review.state === 'reviewed' && b.receipts_review.receipt_ref === null) falha('benchmark.revisao.sem-recibo');

  const tarefas = new Map(p.tasks.map((t) => [t.task_id, t])), pares = new Map(p.pairs.map((q) => [q.pair_id, q]));
  semRepeticao(b.runs.map((r) => r.run_id), 'benchmark.run.duplicado', 'runs');
  semRepeticao(b.runs.map((r) => r.session_id), 'benchmark.run.sessao-compartilhada', 'runs');
  const requisicoes = new Set<string>(), tentativas = new Map<string, Execucao[]>(), aquecimento = { A: 0, B: 0 };
  b.runs.forEach((r, i) => {
    const onde = `runs.${i}`;
    if (Date.parse(r.ended_at) < Date.parse(r.started_at)) falha('benchmark.run.tempo-invertido', onde);
    const t = tarefas.get(r.task_id);
    if (!t) falha('benchmark.run.tarefa-ausente', onde);
    conferirSeed(r.controls, `${onde}.controls`);
    conferirTokens(r, requisicoes, onde);
    conferirMedida(r.metrics.residual_context_tokens, true, `${onde}.metrics.residual_context_tokens`);
    const contexto = r.metrics.residual_context_tokens;
    if (contexto.value !== null && (contexto.window_tokens === null || contexto.value > contexto.window_tokens)) {
      falha('benchmark.metrica.contexto-sem-janela', onde);
    }
    conferirMedida(r.metrics.tool_calls, true, `${onde}.metrics.tool_calls`);
    if (r.metrics.tool_calls.source === 'tokenizer_exact') falha('benchmark.metrica.origem-invalida', `${onde}.metrics.tool_calls`);
    conferirLatencia(r.metrics.latency_ms, `${onde}.metrics.latency_ms`);
    conferirCusto(r.metrics.cost, `${onde}.metrics.cost`);
    conferirOrigemDoCusto(r.metrics.cost, r.metrics.logical_total_tokens, `${onde}.metrics.cost`);
    conferirAuditoria(r, p, onde);
    if (r.warmup) {
      if (r.pair_id !== null || r.repetition !== null) falha('benchmark.warmup.com-par', onde);
      aquecimento[r.arm]++;
      return;
    }
    const par = r.pair_id === null ? undefined : pares.get(r.pair_id);
    if (!par) falha('benchmark.run.par-desconhecido', onde);
    if (par.task_id !== r.task_id || par.repetition !== r.repetition) falha('benchmark.run.tarefa-divergente', onde);
    conferirResultados(r, t, onde);
    const chave = chaveDoBraco(par.pair_id, r.arm), lista = tentativas.get(chave) ?? [];
    if (lista.some((x) => x.attempt === r.attempt)) falha('benchmark.run.duplicado', onde);
    lista.push(r);
    tentativas.set(chave, lista);
  });
  // D6: retry e registro, nunca descarte; tentativas contiguas ate o limite do protocolo.
  for (const lista of tentativas.values()) {
    lista.sort((x, y) => x.attempt - y.attempt);
    lista.forEach((r, i) => {
      if (r.attempt !== i + 1) falha('benchmark.run.tentativa-fora-de-ordem', `run ${r.run_id}`);
      if (i < lista.length - 1 && !DESFECHOS_COM_RETRY.includes(r.outcome)) falha('benchmark.run.tentativa-apos-conclusao', `run ${r.run_id}`);
    });
    if (lista.length > p.retry_policy.max_attempts) falha('benchmark.run.tentativas-excedidas', `run ${lista[0].run_id}`);
  }
  const semRuns = b.runs.length === 0;
  if (semRuns !== (b.status === 'not-run')) falha('benchmark.status.inconsistente');
  if (b.status === 'complete') {
    if (p.pairs.some((q) => !tentativas.has(chaveDoBraco(q.pair_id, 'A')) || !tentativas.has(chaveDoBraco(q.pair_id, 'B')))) {
      falha('benchmark.status.inconsistente');
    }
    if (aquecimento.A !== p.warmup_runs_per_arm || aquecimento.B !== p.warmup_runs_per_arm) falha('benchmark.warmup.desigual');
  }
  return b;
}

/** D8: mediana por ordenacao numerica; amostra par usa a media dos dois centrais. */
export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b), meio = v.length >> 1;
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

export interface VereditoDoBenchmark {
  resultado: 'not-run' | 'inconclusive' | 'fail' | 'pass';
  /** Motivos de falha primeiro, depois lacunas; `pass` e `not-run` sem motivo de falha. */
  motivos: (MotivoDeFalha | MotivoDeLacuna | 'sem-execucao')[];
  /** So registro medido, completo, aprovado e com recibos revisados pode anunciar economia. */
  publicavel: boolean;
  paresPlanejados: number;
  paresCompletos: number;
  medianaA: number | null;
  medianaB: number | null;
  /** B menos A, em logical_total_tokens por par. */
  delta: number | null;
  porTarefa: { task_id: string; medianaA: number | null; medianaB: number | null; delta: number | null }[];
}

const diferenca = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : b - a);

/**
 * D8: avaliacao pura de um registro valido. Violacao de rigor observada prevalece sobre falta
 * de telemetria; so dado completo e comparavel chega a comparar medianas.
 */
export function avaliarBenchmark(entrada: unknown): VereditoDoBenchmark {
  const b = validarBenchmark(entrada), p = b.protocol;
  const vazio: VereditoDoBenchmark = {
    resultado: 'not-run', motivos: ['sem-execucao'], publicavel: false, paresPlanejados: p.pairs.length, paresCompletos: 0,
    medianaA: null, medianaB: null, delta: null, porTarefa: [],
  };
  if (b.status === 'not-run') return vazio;
  const falhas = new Set<MotivoDeFalha>(), lacunas = new Set<MotivoDeLacuna>();
  const tarefas = new Map(p.tasks.map((t) => [t.task_id, t])), controles = canonico(p.controls);
  // D8: so resultado completo e comparado; D6: aquecimento igual nos dois bracos, pela regra fixada.
  if (b.status !== 'complete') lacunas.add('amostra-incompleta');
  const aquecimentos = (arm: 'A' | 'B') => b.runs.filter((r) => r.warmup && r.arm === arm).length;
  if (aquecimentos('A') !== p.warmup_runs_per_arm || aquecimentos('B') !== p.warmup_runs_per_arm) lacunas.add('aquecimento-divergente');
  // D8: aresta falsa e fato do grafo auditado, venha da tentativa ou do aquecimento que vier.
  if (b.runs.some((r) => r.edge_audit?.examined.some((e) => e.result === 'false'))) falhas.add('aresta-falsa');
  const grupos = new Map<string, Execucao[]>();
  for (const r of b.runs) {
    if (r.warmup || r.pair_id === null) continue;
    const chave = chaveDoBraco(r.pair_id, r.arm), lista = grupos.get(chave) ?? [];
    lista.push(r);
    grupos.set(chave, lista);
  }
  const exigidas = new Set<MetricaRequerivel>(p.required_metrics), origens = new Set<string>();
  const totais = new Map<string, { A: number | null; B: number | null }>();
  for (const par of p.pairs) {
    const tarefa = tarefas.get(par.task_id) as z.infer<typeof tarefaSchema>, comandos = new Map(tarefa.verifiers.map((v) => [v.verify_id, v.command_hash]));
    const total: { A: number | null; B: number | null } = { A: null, B: null }, inicio: { A?: number; B?: number } = {};
    for (const arm of ['A', 'B'] as const) {
      const lista = (grupos.get(chaveDoBraco(par.pair_id, arm)) ?? []).sort((x, y) => x.attempt - y.attempt);
      if (lista.length === 0) {
        lacunas.add('amostra-incompleta');
        continue;
      }
      inicio[arm] = Date.parse(lista[0].started_at);
      let soma: number | null = 0;
      for (const r of lista) {
        if (r.outcome === 'instrumentation-failed') lacunas.add('falha-de-instrumentacao');
        if (canonico(r.controls) !== controles) lacunas.add('controles-divergentes');
        if (r.question_hash !== tarefa.question_hash) lacunas.add('pergunta-divergente');
        if (r.verify_results.some((v) => comandos.get(v.verify_id) !== v.command_hash)) falhas.add('verify-nao-preservado');
        const primaria = r.metrics.logical_total_tokens;
        if (primaria.value === null) {
          lacunas.add('metrica-primaria-ausente');
          soma = null;
        } else {
          // D7: origem equivalente e a mesma fonte, metodo e versao nos dois bracos.
          origens.add(canonico([primaria.source, primaria.method, primaria.method_version]));
          if (!ORIGENS_DE_CONSUMO_MEDIDO.includes(primaria.source)) lacunas.add('metrica-primaria-sem-consumo-medido');
          if (soma !== null) soma += primaria.value;
        }
        const m = r.metrics;
        const requeridas: [MetricaRequerivel, Medida][] = [['residual_context_tokens', m.residual_context_tokens], ['tool_calls', m.tool_calls],
          ['latency_ms', m.latency_ms], ['cost', m.cost]];
        if (requeridas.some(([nome, medida]) => exigidas.has(nome) && medida.value === null)) lacunas.add('metrica-requerida-ausente');
        if (requeridas.some(([nome, medida]) => exigidas.has(nome) && medida.value !== null && !ORIGENS_DE_CONSUMO_MEDIDO.includes(medida.source))) {
          lacunas.add('metrica-requerida-estimada');
        }
      }
      total[arm] = soma;
      const final = lista[lista.length - 1];
      if (final.outcome === 'cancelled') lacunas.add('tarefa-cancelada');
      else if (final.outcome !== 'completed' && final.outcome !== 'instrumentation-failed') falhas.add('tarefa-nao-concluida');
      if (final.outcome === 'completed') {
        if (final.mandatory_fact_results.some((f) => f.result !== 'present')) falhas.add('fato-perdido');
        if (final.claim_results.some((c) => c.result !== 'verified')) falhas.add('claim-nao-preservada');
        if (final.verify_results.some((v) => v.result !== 'pass')) falhas.add('verify-falhou');
      }
      if (arm === 'B') {
        const a = final.edge_audit;
        if (a === null) lacunas.add('auditoria-incompleta');
        else if (a.examined.some((e) => e.result === 'unverified') || a.examined.length !== a.universe_edge_ids.length ||
            a.universe_edge_ids.length !== p.treatment.edge_count ||
            digestDoConjuntoDeArestas(a.universe_edge_ids) !== p.treatment.edge_set_digest) lacunas.add('auditoria-incompleta');
      }
    }
    if (inicio.A !== undefined && inicio.B !== undefined && (par.order === 'AB' ? inicio.A > inicio.B : inicio.B > inicio.A)) {
      lacunas.add('ordem-divergente');
    }
    totais.set(par.pair_id, total);
  }
  if (origens.size > 1) lacunas.add('origens-nao-equivalentes');
  const preparo = b.index_preparation;
  const doPreparo: Medida[] = [
    ...(exigidas.has('index_preparation') ? [preparo.logical_total_tokens, preparo.latency_ms] : []),
    ...(exigidas.has('cost') ? [preparo.cost] : []),
  ];
  if (doPreparo.some((m) => m.value === null)) lacunas.add('metrica-requerida-ausente');
  if (doPreparo.some((m) => m.value !== null && !ORIGENS_DE_CONSUMO_MEDIDO.includes(m.source))) lacunas.add('metrica-requerida-estimada');

  const completos = p.pairs.filter((q) => totais.get(q.pair_id)?.A != null && totais.get(q.pair_id)?.B != null);
  const medianas = (pares: typeof completos) => {
    const a = mediana(pares.map((q) => totais.get(q.pair_id)?.A as number));
    const bb = mediana(pares.map((q) => totais.get(q.pair_id)?.B as number));
    return { medianaA: a, medianaB: bb, delta: diferenca(a, bb) };
  };
  const geral = medianas(completos);
  const porTarefa = p.tasks.map((t) => ({ task_id: t.task_id, ...medianas(completos.filter((q) => q.task_id === t.task_id)) }));
  const base = { paresPlanejados: p.pairs.length, paresCompletos: completos.length, ...geral, porTarefa };
  const motivos = [...MOTIVOS_DE_FALHA.filter((m) => falhas.has(m)), ...MOTIVOS_DE_LACUNA.filter((m) => lacunas.has(m))];
  if (falhas.size) return { ...base, resultado: 'fail', motivos, publicavel: false };
  if (lacunas.size) return { ...base, resultado: 'inconclusive', motivos, publicavel: false };
  if ((geral.medianaB as number) >= (geral.medianaA as number)) return { ...base, resultado: 'fail', motivos: ['mediana-nao-menor'], publicavel: false };
  const publicavel = b.status === 'complete' && b.data_class === 'measured' && b.receipts_review.state === 'reviewed';
  return { ...base, resultado: 'pass', motivos: [], publicavel };
}
