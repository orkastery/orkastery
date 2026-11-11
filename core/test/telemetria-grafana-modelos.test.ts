import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const RAIZ = path.resolve(__dirname, '../../..');
const DIRETORIO = path.join(RAIZ, 'templates/telemetria/grafana');
const ARQUIVOS = ['orkastery-conducao.json', 'orkastery-prompts.json', 'orkastery-exportacao.json'] as const;
type Alvo = { datasource?: { uid?: string }; expr?: string };
type Painel = { datasource?: { uid?: string }; targets?: Alvo[] };
type Dashboard = { uid?: string; title?: string; panels?: Painel[];
  templating?: { list?: Array<{ name?: string; query?: string; type?: string }> } };

function lerDashboard(arquivo: typeof ARQUIVOS[number]): { bruto: string; dashboard: Dashboard } {
  const bruto = fs.readFileSync(path.join(DIRETORIO, 'dashboards', arquivo), 'utf8');
  return { bruto, dashboard: JSON.parse(bruto) as Dashboard };
}

const dashboards = ARQUIVOS.map(lerDashboard);
const alvos = dashboards.flatMap(({ dashboard }) => dashboard.panels ?? []).flatMap((painel) => painel.targets ?? []);

test('dashboards são JSON provisionável com UID estável e datasource selecionável', () => {
  const esperados = [
    ['orkastery-conducao', 'DS_LOKI', 'loki'],
    ['orkastery-prompts', 'DS_LOKI', 'loki'],
    ['orkastery-exportacao', 'DS_PROMETHEUS', 'prometheus'],
  ];
  for (const [{ dashboard }, [uid, nome, query]] of dashboards.map((item, indice) => [item, esperados[indice]] as const)) {
    assert.equal(dashboard.uid, uid);
    const variavel = dashboard.templating?.list?.find((item) => item.name === nome);
    assert.deepEqual([variavel?.type, variavel?.query], ['datasource', query]);
    for (const painel of dashboard.panels ?? []) {
      assert.equal(painel.datasource?.uid, `\${${nome}}`);
      for (const alvo of painel.targets ?? []) assert.equal(alvo.datasource?.uid, `\${${nome}}`);
    }
  }
  const provider = fs.readFileSync(path.join(DIRETORIO, 'provisioning/dashboards/orkastery.yaml'), 'utf8');
  assert.match(provider, /path: \$\{ORK_GRAFANA_DASHBOARDS_PATH\}/);
  assert.doesNotMatch(provider, /https?:\/\//iu);
});

test('consultas LogQL partem somente da label indexada de serviço e usam atributos reais', () => {
  const logql = alvos.map((alvo) => alvo.expr ?? '').filter((expr) => expr.startsWith('{'));
  assert.ok(logql.length > 0);
  const usados = new Set<string>();
  for (const expr of logql) {
    assert.ok(expr.startsWith('{service_name="orkastery"}'), expr);
    assert.equal(/^\{([^}]*)\}/.exec(expr)?.[1], 'service_name="orkastery"', expr);
    usados.add('service_name');
    for (const match of expr.matchAll(/\{\{\.([a-z][a-z0-9_]*)\}\}/g)) usados.add(match[1]);
    for (const match of expr.matchAll(/\|\s*([a-z][a-z0-9_]*)\s*(?:!?=|=~)/g)) usados.add(match[1]);
  }

  const fonte = ['core/src/telemetria.ts', 'core/src/telemetria-exportador.ts']
    .map((arquivo) => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8')).join('\n');
  const atributos = new Set<string>();
  for (const match of fonte.matchAll(/attr(?:String|Int)\('([^']+)'|key: '([^']+)'/g)) {
    atributos.add((match[1] ?? match[2]).replaceAll('.', '_'));
  }
  // Campo intrínseco do LogRecord normalizado pelo Loki:
  // https://grafana.com/docs/loki/latest/send-data/otel/
  const CAMPOS_INTRINSECOS_LOKI = new Set(['event_name']);
  for (const usado of usados) {
    assert.ok(atributos.has(usado) || CAMPOS_INTRINSECOS_LOKI.has(usado), `atributo sem fonte: ${usado}`);
  }
});

test('conteúdo permitido e lacuna usam consultas separadas sem expor conteúdo recusado', () => {
  const prompt = dashboards.find(({ dashboard }) => dashboard.uid === 'orkastery-prompts')!.dashboard;
  const expressoes = (prompt.panels ?? []).flatMap((painel) => painel.targets ?? []).map((alvo) => alvo.expr ?? '');
  const conteudo = expressoes.find((expr) => expr.includes('gen_ai_input_messages!=""'));
  const lacuna = expressoes.find((expr) => expr.includes('orkastery_prompt_content_state="gap"'));
  assert.ok(conteudo?.includes('event_name="gen_ai_client_inference_operation_details"'));
  assert.ok(conteudo?.includes('{{.gen_ai_input_messages}}'));
  assert.ok(lacuna?.includes('{{.orkastery_prompt_gap_reason}}'));
  assert.equal(lacuna?.includes('gen_ai_input_messages'), false);
});

test('dashboard de exportação usa somente métricas internas oficiais do Collector', () => {
  // https://opentelemetry.io/docs/collector/internal-telemetry/
  const METRICAS_INTERNAS = new Set([
    'otelcol_receiver_accepted_log_records',
    'otelcol_receiver_refused_log_records',
    'otelcol_exporter_sent_log_records',
    'otelcol_exporter_send_failed_log_records',
    'otelcol_exporter_enqueue_failed_log_records',
    'otelcol_exporter_queue_size',
    'otelcol_exporter_queue_capacity',
  ]);
  const metricas = alvos.flatMap((alvo) => [...(alvo.expr ?? '').matchAll(/\botelcol_[a-z0-9_]+\b/g)].map((m) => m[0]));
  assert.deepEqual(new Set(metricas), METRICAS_INTERNAS);
});

test('modelos não inventam metas, cores, endpoint ou placeholders de F3/F5', () => {
  for (const { bruto } of dashboards) {
    assert.doesNotMatch(bruto, /"thresholds"/u);
    assert.doesNotMatch(bruto, /#[0-9a-f]{3,8}\b/iu);
    assert.doesNotMatch(bruto, /https?:\/\//iu);
  }
  for (const ausente of ['orkastery-correlacao-runtime.json', 'orkastery-maturidade-maestro.json']) {
    assert.equal(fs.existsSync(path.join(DIRETORIO, 'dashboards', ausente)), false);
  }
});

