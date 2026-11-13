import assert from 'node:assert/strict';
import test from 'node:test';
import { executarShipAposPreflight } from '../src/ship';
import type { ResultadoPreflightEmpresa } from '../src/rede-empresa-preflight';

const preflight: ResultadoPreflightEmpresa = { estado: 'inconclusivo', consultivo: true, conflitos: [], ordemSugerida: [],
  lacunas: ['historia.rasa'], performance: { estado: 'unavailable' }, cobertura: 'incompleta',
  fotografia: { ponta: 'c1', publicacoes: 1, trabalhos: 1, caminhos: 1, commitsLidos: 0, fonte: 'rede-coletiva' } };

test('CLI imprime o preflight antes de chamar ship e passa a mesma fotografia', () => {
  const ordem: string[] = [];
  const recebido = executarShipAposPreflight(preflight, (p) => { ordem.push('preflight'); assert.equal(p, preflight); },
    (p) => { ordem.push('ship'); return p; });
  assert.deepEqual(ordem, ['preflight', 'ship']); assert.equal(recebido, preflight);
});

test('preflight é consultivo e não muda gate, autorização, merge ou push', () => {
  const estado = { ok: true, autorizado: true, lease: 'main-tree', merge: 'm1', push: 'provado' };
  const depois = executarShipAposPreflight(preflight, () => {}, (p) => ({ ...estado, preflightEmpresa: p }));
  assert.deepEqual({ ok: depois.ok, autorizado: depois.autorizado, lease: depois.lease, merge: depois.merge, push: depois.push }, estado);
  assert.equal(depois.preflightEmpresa, preflight);
});

test('sem inscrição não há linha adicional e ship recebe null', () => {
  let imprimiu = false;
  const recebido = executarShipAposPreflight(null, () => { imprimiu = true; }, (p) => p);
  assert.equal(imprimiu, false); assert.equal(recebido, null);
});
