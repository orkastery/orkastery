import { strict as assert } from 'node:assert';
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

test('fato analítico preserva UID, pseudônimo e campos fechados do recibo', () => {
  const registro = mapearEventoDoLedger(evento('verify_run', { veredito: 'verde', parcial: false,
    receiptPolicyVersion: 'v1', recibo: { contrato: 'ork.recibo-prova/v1', head: 'abc' } }), contexto).registro!;
  const a = attrs(registro);
  assert.deepEqual(a[C.atributos.uid], { stringValue: 'uid-verify_run' });
  assert.deepEqual(a[C.atributos.userHash], { stringValue: 'hash-estavel' });
  assert.deepEqual(a['orkastery.receipt.contract'], { stringValue: 'ork.recibo-prova/v1' });
  assert.deepEqual(a['orkastery.receipt.partial'], { boolValue: false });
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
  assert.deepEqual(attrs(registro)[C.atributos.teamSourceState], { stringValue: C.valores.teamSourceMissing });
  const serializado = JSON.stringify(payload);
  assert.equal(serializado.includes('orkastery.maestro.id'), false);
  assert.equal(serializado.includes('orkastery.team.id'), false);
  assert.equal(serializado.includes(C.atributos.serviceNamespace), false);
});

test('achados e rodada são projetados sem copiar parecer livre', () => {
  const registro = mapearEventoDoLedger(evento('go_fix_opened', { rodada: 'r1',
    parecer: { achados: [{ id: 'B1', detalhe: 'não exportar' }] } }), contexto).registro!;
  assert.deepEqual(attrs(registro)['orkastery.finding.id'], { arrayValue: { values: [{ stringValue: 'B1' }] } });
  assert.deepEqual(attrs(registro)['orkastery.go_fix.round'], { stringValue: 'r1' });
  assert.equal(JSON.stringify(registro).includes('não exportar'), false);
});
