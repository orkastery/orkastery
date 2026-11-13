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
  for (const definicao of REGISTRO_DE_INDICADORES_AGENTICOS) {
    assert.deepEqual(definicao.execucao.predicados.eventos, definicao.fontes, definicao.id);
    assert.equal(definicao.execucao.populacao.unidade, definicao.execucao.confirmacao.unidade,
      `${definicao.id}: população e confirmação precisam da mesma unidade`);
    assert.deepEqual(definicao.execucao.lacunas, definicao.lacunas, definicao.id);
    assert.deepEqual(definicao.execucao.agrupamentos, definicao.agrupamentos, definicao.id);
  }
});

test('nomes públicos ficam concentrados no contrato sem identidade paralela', () => {
  assert.deepEqual(CONTRATO_SDLC_ANALYTICS.eventos,
    { deployment: 'orkastery.sdlc.deployment.v1', incident: 'orkastery.sdlc.incident.v1',
      resultado: 'orkastery.sdlc.analytics.result.v1' });
  assert.equal(CONTRATO_SDLC_ANALYTICS.atributos.incidentId, 'orkastery.incident.id');
  assert.equal(CONTRATO_SDLC_ANALYTICS.atributos.incidentState, 'orkastery.incident.state');
  assert.equal(CONTRATO_SDLC_ANALYTICS.atributos.incidentRecoveryDeploymentId,
    'orkastery.incident.recovery.deployment.id');
  const serializado = JSON.stringify(CONTRATO_SDLC_ANALYTICS);
  assert.equal(serializado.includes('orkastery.maestro.id'), false);
  assert.equal(serializado.includes('orkastery.team.id'), false);
});

test('evento de resultado e atributos de incidente usam somente os nomes ratificados', () => {
  assert.equal(CONTRATO_SDLC_ANALYTICS.eventos.resultado, 'orkastery.sdlc.analytics.result.v1');
  const serializado = JSON.stringify(CONTRATO_SDLC_ANALYTICS);
  assert.equal(serializado.includes('ratificacao_pendente'), false);
  assert.equal(serializado.includes('orkastery.sdlc.indicator.result.v1'), false);
  assert.equal(serializado.includes('orkastery.sdlc.analytics.snapshot.v1'), false);
  assert.equal(new Set(Object.values(CONTRATO_SDLC_ANALYTICS.atributosResultado)).size,
    Object.keys(CONTRATO_SDLC_ANALYTICS.atributosResultado).length);
});
