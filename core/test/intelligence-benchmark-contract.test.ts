/**
 * I-31 KG1 (T2): conformidade do contrato `ork.graph-benchmark/v1`.
 *
 * Dois grupos, cada um com casos positivos e negativos: "KG1 measurement" (formato do registro,
 * origem e unidade das medidas, pares, retries e warm-up) e "KG1 verdict" (avaliacao pura). Os
 * casos negativos moram no corpus, com o esperado escrito a mao; aqui ficam os que calculam.
 * Tudo e sintetico: nenhum numero daqui e medida de economia.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  BENCHMARK_SCHEMA, ORIGENS_DE_CONSUMO_MEDIDO, avaliarBenchmark, benchmarkSchema, mediana, validarBenchmark,
  type RegistroDeBenchmark,
} from '../src/intelligence-benchmark-contract';

const RAIZ = path.resolve(__dirname, '../../..');
const corpus = JSON.parse(fs.readFileSync(path.join(RAIZ, 'core/test/fixtures/graph-benchmark-v1.json'), 'utf8'));
const REGISTRO: RegistroDeBenchmark = corpus.record;

type Operacao = { op: 'add' | 'replace' | 'remove'; path: string; value?: unknown };

/** Subconjunto do JSON Patch (RFC 6902) que o corpus usa: add, replace e remove. */
function aplicar(base: unknown, patch: readonly Operacao[]): unknown {
  const alvo = structuredClone(base);
  for (const o of patch) {
    const partes = o.path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    const ultima = partes.pop() as string;
    let pai = alvo as Record<string, unknown> | unknown[];
    for (const p of partes) pai = (pai as Record<string, unknown>)[p] as Record<string, unknown>;
    if (Array.isArray(pai)) {
      const i = ultima === '-' ? pai.length : Number(ultima);
      if (o.op === 'remove') pai.splice(i, 1);
      else pai.splice(i, o.op === 'add' ? 0 : 1, structuredClone(o.value));
    } else if (o.op === 'remove') delete pai[ultima];
    else pai[ultima] = structuredClone(o.value);
  }
  return alvo;
}

const comCodigo = (codigo: string) => (e: unknown): boolean => e instanceof Error && e.message.split(' ')[0] === codigo;
const naoAquecimento = (r: RegistroDeBenchmark) => r.runs.filter((x) => !x.warmup);

const invalidos = corpus.invalid as { name: string; code: string; patch: Operacao[] }[];
test('KG1 measurement: o corpus traz casos negativos do grupo', () => {
  assert.ok(invalidos.length >= 10);
  assert.equal(new Set(invalidos.map((c) => c.name)).size, invalidos.length);
});
for (const c of invalidos) {
  test(`KG1 measurement: recusa ${c.name} com ${c.code}`, () => {
    assert.throws(() => validarBenchmark(aplicar(REGISTRO, c.patch)), comCodigo(c.code));
  });
}

const vereditos = corpus.verdicts as { name: string; resultado: string; motivos: string[]; patch: Operacao[] }[];
test('KG1 verdict: o corpus traz casos negativos do grupo', () => {
  assert.ok(vereditos.length >= 10);
  assert.ok(vereditos.every((c) => c.resultado === 'fail' || c.resultado === 'inconclusive'));
});
for (const c of vereditos) {
  test(`KG1 verdict: ${c.name} da ${c.resultado} (${c.motivos.join(', ')})`, () => {
    const v = avaliarBenchmark(aplicar(REGISTRO, c.patch));
    assert.equal(v.resultado, c.resultado);
    assert.deepEqual(v.motivos, c.motivos);
    assert.equal(v.publicavel, false);
  });
}

// ---------------------------------------------------------------- KG1 measurement

test('KG1 measurement: registro sintetico completo e valido, com retry, warm-up e custo ausente explicito', () => {
  assert.equal(corpus.data_class, 'synthetic');
  assert.equal(REGISTRO.schema, BENCHMARK_SCHEMA);
  assert.equal(REGISTRO.data_class, 'synthetic');
  assert.deepEqual(validarBenchmark(REGISTRO), REGISTRO);
  assert.ok(REGISTRO.runs.some((r) => r.attempt === 2) && REGISTRO.runs.some((r) => r.outcome === 'timeout'));
  assert.equal(REGISTRO.runs.filter((r) => r.warmup).length, 2 * REGISTRO.protocol.warmup_runs_per_arm);
  for (const r of REGISTRO.runs) {
    assert.equal(r.metrics.cost.value, null);
    assert.equal(r.metrics.cost.source, 'unavailable');
    assert.ok(r.metrics.cost.unavailable_reason);
  }
});

test('KG1 measurement: schema JSON publicado coincide com a geracao do contrato e declara o dialeto', () => {
  const publicado = JSON.parse(fs.readFileSync(path.join(RAIZ, 'core/schemas/graph-benchmark.v1.schema.json'), 'utf8'));
  const converter = zodToJsonSchema as unknown as (schema: unknown, options: object) => unknown;
  assert.deepEqual(converter(benchmarkSchema, { name: 'GraphBenchmark', $refStrategy: 'none' }), publicado);
  assert.equal(publicado.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(publicado.definitions.GraphBenchmark.properties.schema.const, BENCHMARK_SCHEMA);
  assert.equal(publicado.definitions.GraphBenchmark.additionalProperties, false);
});

test('KG1 measurement: consumo medido vem de requisicoes em delta, somadas uma vez', () => {
  const ids = new Set<string>();
  for (const r of REGISTRO.runs) {
    const soma = (k: 'input_total_tokens' | 'output_total_tokens') => r.requests.reduce((s, q) => s + q[k], 0);
    assert.equal(r.metrics.input_total_tokens.value, soma('input_total_tokens'));
    assert.equal(r.metrics.logical_total_tokens.value, soma('input_total_tokens') + soma('output_total_tokens'));
    for (const q of r.requests) {
      assert.ok(!ids.has(q.request_id));
      ids.add(q.request_id);
    }
  }
  assert.deepEqual([...ORIGENS_DE_CONSUMO_MEDIDO], ['runtime_reported', 'tokenizer_exact']);
});

test('KG1 measurement: numero nao finito e recusado mesmo fora do JSON', () => {
  for (const valor of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = structuredClone(REGISTRO);
    r.runs[2].metrics.tool_calls.value = valor;
    assert.throws(() => validarBenchmark(r), comCodigo('benchmark.estrutura.invalida'));
  }
});

// ---------------------------------------------------------------- KG1 verdict

test('KG1 verdict: sem execucao o resultado e not-run, sem mediana', () => {
  assert.deepEqual(avaliarBenchmark(corpus.not_run), {
    resultado: 'not-run', motivos: ['sem-execucao'], publicavel: false, paresPlanejados: 4, paresCompletos: 0,
    medianaA: null, medianaB: null, delta: null, porTarefa: [],
  });
});

test('KG1 verdict: pass sintetico completo com medianas e deltas por tarefa', () => {
  const v = avaliarBenchmark(REGISTRO);
  assert.deepEqual({ resultado: v.resultado, publicavel: v.publicavel, medianaA: v.medianaA, medianaB: v.medianaB, delta: v.delta }, corpus.expected);
  assert.deepEqual(v.motivos, []);
  assert.equal(v.paresCompletos, v.paresPlanejados);
  assert.deepEqual(v.porTarefa, [
    { task_id: 't-impacto', medianaA: 1625, medianaB: 830, delta: -795 },
    { task_id: 't-origem', medianaA: 1225, medianaB: 735, delta: -490 },
  ]);
});

test('KG1 verdict: retry soma no consumo do par; warm-up fica fora dos dois bracos', () => {
  // p-impacto-2 no braco A: 450 tokens da tentativa com timeout + 1350 da concluida.
  const semRetry = structuredClone(REGISTRO);
  semRetry.runs = semRetry.runs.filter((r) => r.run_id !== 'r-impacto-2-a1');
  const r2 = semRetry.runs.find((r) => r.run_id === 'r-impacto-2-a2') as RegistroDeBenchmark['runs'][number];
  r2.attempt = 1;
  assert.equal(avaliarBenchmark(semRetry).porTarefa[0].medianaA, (1450 + 1350) / 2);
  assert.equal(avaliarBenchmark(REGISTRO).porTarefa[0].medianaA, (1450 + 1800) / 2);
  const semAquecimento = structuredClone(REGISTRO);
  semAquecimento.runs = semAquecimento.runs.filter((r) => !r.warmup);
  semAquecimento.protocol.warmup_runs_per_arm = 0;
  const [com, sem] = [avaliarBenchmark(REGISTRO), avaliarBenchmark(semAquecimento)];
  assert.deepEqual([sem.resultado, sem.medianaA, sem.medianaB], [com.resultado, com.medianaA, com.medianaB]);
  const aquecimentoSemLatencia = structuredClone(REGISTRO);
  const w = aquecimentoSemLatencia.runs.find((r) => r.warmup) as RegistroDeBenchmark['runs'][number];
  w.metrics.latency_ms = { ...w.metrics.latency_ms, value: null, source: 'unavailable', evidence_ref: null, unavailable_reason: 'aquecimento' };
  assert.equal(avaliarBenchmark(aquecimentoSemLatencia).resultado, 'pass');
});

test('KG1 verdict: mediana por ordenacao numerica, par e impar', () => {
  assert.equal(mediana([2, 10, 9]), 9);
  assert.equal(mediana([10, 9, 100, 2]), 9.5, 'ordem lexicografica daria (100 + 2) / 2');
  assert.equal(mediana([5]), 5);
  assert.equal(mediana([]), null);
});

test('KG1 verdict: dado sintetico nunca e publicavel como economia medida', () => {
  const revisado = { state: 'reviewed', receipt_ref: { ref: 'recibo-de-revisao', sha256: 'a'.repeat(64) } };
  assert.equal(avaliarBenchmark({ ...REGISTRO, receipts_review: revisado }).publicavel, false);
  assert.equal(avaliarBenchmark({ ...REGISTRO, data_class: 'measured' }).publicavel, false, 'sem revisao dos recibos');
  const medido = avaliarBenchmark({ ...REGISTRO, data_class: 'measured', receipts_review: revisado });
  assert.deepEqual([medido.resultado, medido.publicavel], ['pass', true]);
  assert.ok(naoAquecimento(REGISTRO).every((r) => r.metrics.logical_total_tokens.source === 'runtime_reported'));
});

test('KG1 verdict: avaliacao nao julga registro invalido', () => {
  assert.throws(() => avaliarBenchmark({ ...REGISTRO, status: 'not-run' }), comCodigo('benchmark.status.inconsistente'));
  assert.throws(() => avaliarBenchmark({ ...REGISTRO, schema: 'ork.graph-benchmark/v0' }), comCodigo('benchmark.versao.incompativel'));
});
