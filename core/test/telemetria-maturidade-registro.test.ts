import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CONTRATO_SDLC_ANALYTICS, REGISTRO_DE_INDICADORES_AGENTICOS,
  definicaoDoIndicador } from '../src/telemetria-maturidade-registro';

test('registro é único, versionado e reserva taxas somente para A1 e A2', () => {
  assert.equal(REGISTRO_DE_INDICADORES_AGENTICOS.length, 6);
  assert.equal(new Set(REGISTRO_DE_INDICADORES_AGENTICOS.map((item) => item.id)).size, 6);
  assert.deepEqual(REGISTRO_DE_INDICADORES_AGENTICOS.filter((item) => item.tipo === 'razao').map((item) => item.id),
    ['agent.merge_receipt_coverage', 'agent.first_truth_sustained']);
  assert.equal(definicaoDoIndicador('agent.check_rework')?.formula.operador, 'contagem_distinta');
});

test('nomes públicos ficam concentrados no contrato sem identidade paralela', () => {
  assert.deepEqual(CONTRATO_SDLC_ANALYTICS.eventos,
    { deployment: 'orkastery.sdlc.deployment.v1', incident: 'orkastery.sdlc.incident.v1' });
  assert.equal(CONTRATO_SDLC_ANALYTICS.atributos.incidentId, 'orkastery.incident.id');
  assert.equal(CONTRATO_SDLC_ANALYTICS.atributos.incidentState, 'orkastery.incident.state');
  assert.equal(CONTRATO_SDLC_ANALYTICS.atributos.incidentRecoveryDeploymentId,
    'orkastery.incident.recovery.deployment.id');
  const serializado = JSON.stringify(CONTRATO_SDLC_ANALYTICS);
  assert.equal(serializado.includes('orkastery.maestro.id'), false);
  assert.equal(serializado.includes('orkastery.team.id'), false);
});
