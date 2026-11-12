import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { mapearEventoDoLedger, montarExportLogsServiceRequest, OtlpAnyValue } from '../src/telemetria';
import { CONTRATO_SDLC_ANALYTICS as C } from '../src/telemetria-maturidade-registro';
import type { EventoLedger } from '../src/types';

const contexto = { serviceVersion: 'teste', instrumentacaoVersion: 'teste', pseudonimo: 'hash-estavel',
  serviceNamespace: 'time-da-politica', redigir: (texto: string) => ({ ok: true, texto }),
  observadoEmNano: () => 1n };

function attrs(registro: { attributes: Array<{ key: string; value: OtlpAnyValue }> }): Record<string, OtlpAnyValue> {
  return Object.fromEntries(registro.attributes.map((item) => [item.key, item.value]));
}

function evento(tipo: string, extras: Record<string, unknown> = {}): EventoLedger {
  return { tipo, ts: '2026-11-10T12:00:00.000Z', thread: 'ork-a', eventId: `uid-${tipo}`, ...extras };
}

test('fato analítico preserva UID e pseudônimo com atributos oficiais de CI e VCS', () => {
  const registro = mapearEventoDoLedger(evento('verify_run', { commit: 'abc', veredito: 'verdade sustentada', parcial: false,
    receiptPolicyVersion: 'v1', recibo: { contrato: 'ork.recibo-prova/v1', head: 'abc' } }), contexto).registro!;
  const a = attrs(registro);
  assert.deepEqual(a[C.atributos.uid], { stringValue: 'uid-verify_run' });
  assert.deepEqual(a[C.atributos.userHash], { stringValue: 'hash-estavel' });
  assert.deepEqual(a['cicd.pipeline.result'], { stringValue: 'verdade sustentada' });
  assert.deepEqual(a['vcs.ref.head.revision'], { stringValue: 'abc' });
});

test('time entra somente pelo recurso da política e payload não o sobrescreve', () => {
  const registro = mapearEventoDoLedger(evento('ship_done', {
    'service.namespace': 'time-forjado', 'user.hash': 'pessoa-forjada', pushVerificado: true }), contexto).registro!;
  const payload = montarExportLogsServiceRequest([registro], contexto);
  const recurso = Object.fromEntries(payload.resourceLogs[0].resource.attributes.map((item) => [item.key, item.value]));
  assert.deepEqual(recurso[C.atributos.serviceNamespace], { stringValue: 'time-da-politica' });
  assert.deepEqual(attrs(registro)[C.atributos.userHash], { stringValue: 'hash-estavel' });
  assert.equal(JSON.stringify(payload).includes('time-forjado'), false);
  assert.equal(JSON.stringify(payload).includes('pessoa-forjada'), false);
});

test('ausência de time é lacuna explícita sem identidade paralela', () => {
  const semTime = { ...contexto, serviceNamespace: undefined };
  const registro = mapearEventoDoLedger(evento('thread_created', { modo: '#Auto' }), semTime).registro!;
  const payload = montarExportLogsServiceRequest([registro], semTime);
  const recurso = Object.fromEntries(payload.resourceLogs[0].resource.attributes.map((item) => [item.key, item.value]));
  assert.deepEqual(recurso[C.atributos.serviceNamespace], { stringValue: C.valores.teamSourceMissing });
  const serializado = JSON.stringify(payload);
  assert.equal(serializado.includes('orkastery.maestro.id'), false);
  assert.equal(serializado.includes('orkastery.team.id'), false);
  assert.equal(serializado.includes('orkastery.team.id'), false);
});

test('rodada usa o atributo oficial de pipeline sem copiar correções livres', () => {
  const registro = mapearEventoDoLedger(evento('go_fix_opened', { rodada: 1,
    correcoes: [{ id: 'B1', detalhe: 'não exportar' }] }), contexto).registro!;
  assert.deepEqual(attrs(registro)['cicd.pipeline.run.id'], { stringValue: '1' });
  assert.equal(JSON.stringify(registro).includes('não exportar'), false);
  assert.equal(JSON.stringify(registro).includes('B1'), false);
});

test('B5 remove os treze nomes públicos não autorizados da projeção e dos modelos', () => {
  const nomes = [
    ['team', 'source', 'state'], ['receipt', 'contract'], ['receipt', 'verdict'], ['receipt', 'partial'],
    ['receipt', 'head'], ['receipt', 'policy', 'version'], ['push', 'verified'], ['go_fix', 'round'],
    ['finding', 'id'], ['decision', 'reverts'], ['policy', 'name'], ['policy', 'reason'], ['policy', 'writer'],
  ].map((partes) => `orkastery.${partes.join('.')}`);
  const registros = [
    mapearEventoDoLedger(evento('verify_run', { veredito: 'verdade sustentada', parcial: false,
      receiptPolicyVersion: 'v1', recibo: { contrato: 'ork.recibo-prova/v1', head: 'abc' } }), contexto).registro!,
    mapearEventoDoLedger(evento('go_fix_opened', { rodada: 1, correcoes: [{ id: 'B1' }] }), contexto).registro!,
    mapearEventoDoLedger(evento('ship_unscanned_authorized', { por: 'dono', categorias: ['sast'], sha: 'abc' }), contexto).registro!,
  ];
  const raiz = path.resolve(__dirname, '../../..');
  const superficie = [JSON.stringify(C), JSON.stringify(montarExportLogsServiceRequest(registros, contexto)),
    fs.readFileSync(path.join(raiz, 'templates/telemetria/collector-loki.yaml'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'templates/telemetria/collector-otlp.yaml'), 'utf8')].join('\n');
  for (const nome of nomes) assert.equal(superficie.includes(nome), false, nome);
});
