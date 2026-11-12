import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { calcularMaturidade, EventoAnalitico } from '../src/telemetria-maturidade';
import { MEDIDAS_DORA, renderizarTargetsAgenticos } from '../src/telemetria-maturidade-grafana';
import { CONTRATO_SDLC_ANALYTICS as C,
  REGISTRO_DE_INDICADORES_AGENTICOS } from '../src/telemetria-maturidade-registro';
import { mapearResultadoDaMaturidade, montarExportLogsServiceRequest } from '../src/telemetria';

const arquivo = path.resolve(__dirname, '../../../templates/telemetria/grafana/dashboards/orkastery-maturidade-maestro.json');
const modelo = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { dashboard: { panels: Array<Record<string, unknown>>;
  templating: { list: Array<Record<string, unknown>> } } };

const contexto = { serviceVersion: 'teste', instrumentacaoVersion: 'teste', pseudonimo: 'hash',
  serviceNamespace: 'time', redigir: (texto: string) => ({ ok: true, texto }), observadoEmNano: () => 1n };
const janela = { desde: '2026-11-01T00:00:00.000Z', ate: '2026-12-01T00:00:00.000Z' };
const fatos: EventoAnalitico[] = [
  { tipo: 'thread_created', ts: '2026-11-10T12:00:00.000Z', thread: 'ork-a',
    eventId: 'thread-a', modo: '#Auto' },
  { tipo: 'autonomous_decision', ts: '2026-11-10T12:01:00.000Z', thread: 'ork-a', fase: 'GO',
    eventId: 'decision-a', pedido: { id: 'd1' }, quemDecidiu: 'sessão', evidencia: 'medição', razao: 'critério' },
];

function listaDaAllowlist(linha: string): string[] {
  return JSON.parse(linha.slice(linha.indexOf('['), linha.lastIndexOf(']') + 1)) as string[];
}

function schemaEmitido(): { campos: Set<string>; indicadores: Set<string> } {
  const resultado = calcularMaturidade(fatos, janela);
  const registros = mapearResultadoDaMaturidade(resultado, contexto);
  const payload = montarExportLogsServiceRequest(registros, contexto);
  const collector = fs.readFileSync(path.resolve(__dirname,
    '../../../templates/telemetria/collector-loki.yaml'), 'utf8');
  const linhaLog = collector.split('\n').find((linha) => linha.includes('keep_keys(log.attributes'))!;
  const linhaRecurso = collector.split('\n').find((linha) => linha.includes('keep_keys(resource.attributes'))!;
  const permitidos = new Set([...listaDaAllowlist(linhaLog), ...listaDaAllowlist(linhaRecurso)]);
  const campos = new Set<string>(['event_name']);
  const indicadores = new Set<string>();
  for (const registro of registros) for (const atributo of registro.attributes) {
    if (!permitidos.has(atributo.key)) continue;
    campos.add(atributo.key.replaceAll('.', '_'));
    if (atributo.key === C.atributosResultado.indicadorId && 'stringValue' in atributo.value) {
      indicadores.add(atributo.value.stringValue);
    }
  }
  for (const atributo of payload.resourceLogs[0].resource.attributes) {
    if (permitidos.has(atributo.key)) campos.add(atributo.key.replaceAll('.', '_'));
  }
  return { campos, indicadores };
}

function camposConsultados(expr: string): string[] {
  const campos = new Set<string>();
  for (const trecho of expr.matchAll(/\b([a-z][a-z0-9_]*)\s*(?:=~|!=|=)/g)) campos.add(trecho[1]);
  for (const trecho of expr.matchAll(/\bsum by \(([^)]+)\)/g)) {
    for (const campo of trecho[1].split(',').map((item) => item.trim())) campos.add(campo);
  }
  for (const trecho of expr.matchAll(/\bunwrap\s+([a-z][a-z0-9_]*)/g)) campos.add(trecho[1]);
  return [...campos];
}

test('A2 e A4 comparam sem normalização cada target agêntico com o renderizador e o resultado emitido', () => {
  const renderizados = renderizarTargetsAgenticos();
  const { campos, indicadores } = schemaEmitido();
  for (const definicao of REGISTRO_DE_INDICADORES_AGENTICOS) {
    const painel = modelo.dashboard.panels.find((item) =>
      typeof item.description === 'string' && item.description.includes(`${definicao.id}/${definicao.versao}`));
    assert.ok(painel, definicao.id);
    assert.deepEqual(painel.targets, renderizados[definicao.id], definicao.id);
    assert.equal(indicadores.has(definicao.id), true, `${definicao.id}: resultado não emitido`);
    for (const target of painel.targets as Array<{ expr: string }>) {
      assert.equal(target.expr.includes(C.propostas.eventoResultado.recomendado.replaceAll('.', '\\.')), true);
      assert.equal(target.expr.includes('orkastery\\.ledger'), false);
      for (const campo of camposConsultados(target.expr)) {
        assert.equal(campos.has(campo), true, `${definicao.id}: ${campo} não existe no resultado emitido`);
      }
    }
  }
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
