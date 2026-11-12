import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { MEDIDAS_DORA, renderizarTargetDora, renderizarTargetsAgenticos } from '../src/telemetria-maturidade-grafana';
import { REGISTRO_DE_INDICADORES_AGENTICOS } from '../src/telemetria-maturidade-registro';

const arquivo = path.resolve(__dirname, '../../../templates/telemetria/grafana/dashboards/orkastery-maturidade-maestro.json');
const modelo = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { dashboard: { panels: Array<Record<string, unknown>>;
  templating: { list: Array<Record<string, unknown>> } } };

test('JSON real contém exatamente os targets gerados pelo registro', () => {
  const targets = modelo.dashboard.panels.flatMap((painel) => Array.isArray(painel.targets)
    ? [{ title: painel.title, targets: painel.targets }] : []);
  const agenticos = renderizarTargetsAgenticos();
  const esperados = [
    ...REGISTRO_DE_INDICADORES_AGENTICOS.map((definicao) => agenticos[definicao.id]),
    ...MEDIDAS_DORA.map((medida) => [renderizarTargetDora(medida)]),
  ];
  assert.equal(targets.length, 11);
  assert.deepEqual(targets.map((item) => item.targets), esperados);
});

test('dashboard separa seis indicadores de cinco medidas DORA', () => {
  const rows = modelo.dashboard.panels.filter((painel) => painel.type === 'row').map((painel) => painel.title);
  assert.deepEqual(rows, ['Indicadores agênticos', 'DORA · separado']);
  assert.equal(REGISTRO_DE_INDICADORES_AGENTICOS.length, 6);
  assert.equal(MEDIDAS_DORA.length, 5);
});

test('dashboard filtra pseudônimo e time sem classificação visual', () => {
  assert.deepEqual(modelo.dashboard.templating.list.map((item) => item.name), ['user_hash', 'service_namespace']);
  const serializado = JSON.stringify(modelo).toLowerCase();
  for (const proibido of ['threshold', 'palette', 'transform', 'score', 'ranking', 'meta', 'good', 'bad']) {
    assert.equal(serializado.includes(proibido), false, proibido);
  }
});
