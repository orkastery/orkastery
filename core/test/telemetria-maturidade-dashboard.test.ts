import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { MEDIDAS_DORA } from '../src/telemetria-maturidade-grafana';
import { REGISTRO_DE_INDICADORES_AGENTICOS } from '../src/telemetria-maturidade-registro';
import { mapearEventoDoLedger, montarExportLogsServiceRequest } from '../src/telemetria';
import type { EventoLedger } from '../src/types';

const arquivo = path.resolve(__dirname, '../../../templates/telemetria/grafana/dashboards/orkastery-maturidade-maestro.json');
const modelo = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { dashboard: { panels: Array<Record<string, unknown>>;
  templating: { list: Array<Record<string, unknown>> } } };

function schemaEmitido(): Set<string> {
  const contexto = { serviceVersion: 'teste', instrumentacaoVersion: 'teste', pseudonimo: 'hash',
    serviceNamespace: 'time', redigir: (texto: string) => ({ ok: true, texto }), observadoEmNano: () => 1n };
  const tipos: Array<[string, Record<string, unknown>]> = [
    ['thread_created', { modo: '#Auto' }],
    ['verify_run', { commit: 'abc', veredito: 'verdade sustentada' }],
    ['go_fix_opened', { rodada: 1 }],
    ['check_reverify', { fase: 'CHECK', resultado: 'PASSOU' }],
    ['autonomous_decision', { fase: 'GO', pedido: { id: 'd1' } }],
    ['hitl_requested', { fase: 'GO', pedido: { id: 'p1' } }],
    ['ship_unscanned_authorized', {}],
    ['ship_done', { mergeSha: 'def', pushVerificado: true, modo: '#Auto' }],
  ];
  const registros = tipos.map(([tipo, extras], indice) => mapearEventoDoLedger({ tipo,
    ts: '2026-11-10T12:00:00.000Z', thread: 'ork-a', eventId: `uid-${indice}`, ...extras } as EventoLedger,
  contexto).registro!).filter(Boolean);
  const payload = montarExportLogsServiceRequest(registros, contexto);
  const modeloCollector = fs.readFileSync(path.resolve(__dirname,
    '../../../templates/telemetria/collector-loki.yaml'), 'utf8');
  const linhaLog = modeloCollector.split('\n').find((linha) => linha.includes('keep_keys(log.attributes'))!;
  const linhaRecurso = modeloCollector.split('\n').find((linha) => linha.includes('keep_keys(resource.attributes'))!;
  const lista = (linha: string): string[] => JSON.parse(linha.slice(linha.indexOf('['), linha.lastIndexOf(']') + 1));
  const permitidos = new Set([...lista(linhaLog), ...lista(linhaRecurso)]);
  const emitidos = new Set<string>(['event_name']);
  for (const registro of registros) for (const atributo of registro.attributes) {
    if (permitidos.has(atributo.key)) emitidos.add(atributo.key.replaceAll('.', '_'));
  }
  for (const atributo of payload.resourceLogs[0].resource.attributes) {
    if (permitidos.has(atributo.key)) emitidos.add(atributo.key.replaceAll('.', '_'));
  }
  return emitidos;
}

function camposConsultados(expr: string): string[] {
  const campos = new Set<string>();
  for (const trecho of expr.matchAll(/\b([a-z][a-z0-9_]*)\s*(?:=~|!=|=)/g)) campos.add(trecho[1]);
  for (const trecho of expr.matchAll(/\b(?:sum|count) by \(([^)]+)\)/g)) {
    for (const campo of trecho[1].split(',').map((item) => item.trim())) campos.add(campo);
  }
  return [...campos];
}

test('B2 targets do JSON real consultam somente o schema emitido pelo mapper e Collector', () => {
  const targets = modelo.dashboard.panels.flatMap((painel) => Array.isArray(painel.targets)
    ? [{ title: painel.title, targets: painel.targets }] : []);
  const schema = schemaEmitido();
  assert.equal(targets.length, 11);
  for (const painel of targets) for (const target of painel.targets as Array<{ expr: string }>) {
    for (const campo of camposConsultados(target.expr)) assert.equal(schema.has(campo), true,
      `${painel.title}: ${campo} não existe no schema emitido`);
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
