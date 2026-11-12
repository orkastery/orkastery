import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calcularDora, RegistroDora, ShipEntregue } from '../src/telemetria-maturidade-dora';
import { CONTRATO_SDLC_ANALYTICS as C } from '../src/telemetria-maturidade-registro';

const ships: ShipEntregue[] = [{ thread: 'ork-a', mergeSha: 'rev-a', pushVerificado: true,
  revisaoEm: '2026-11-10T10:00:00.000Z' }];
let uid = 0;
function deploy(sobrescrever: Partial<RegistroDora> = {}): RegistroDora {
  uid += 1;
  return { eventName: C.eventos.deployment, timestamp: '2026-11-10T12:00:00.000Z',
    resource: { [C.atributos.serviceName]: 'api', [C.atributos.serviceNamespace]: 'time-a',
      [C.atributos.environment]: C.valores.production },
    attributes: { [C.atributos.uid]: `uid-${uid}`, [C.atributos.threadId]: 'ork-a',
      [C.atributos.deploymentId]: 'dep-a', [C.atributos.deploymentStatus]: C.valores.succeeded,
      [C.atributos.pipelineName]: 'release', [C.atributos.pipelineRunId]: 'run-a',
      [C.atributos.pipelineResult]: C.valores.success, [C.atributos.pipelineTaskType]: C.valores.deploy,
      [C.atributos.revision]: 'rev-a' }, ...sobrescrever };
}

function incident(state: 'opened' | 'resolved', extras: Record<string, string> = {}): RegistroDora {
  uid += 1;
  return { eventName: C.eventos.incident,
    timestamp: state === 'opened' ? '2026-11-10T13:00:00.000Z' : '2026-11-10T14:00:00.000Z',
    resource: { [C.atributos.serviceName]: 'api', [C.atributos.serviceNamespace]: 'time-a',
      [C.atributos.environment]: C.valores.production },
    attributes: { [C.atributos.uid]: `uid-${uid}`, [C.atributos.threadId]: 'ork-a',
      [C.atributos.incidentId]: 'inc-a', [C.atributos.incidentState]: state,
      [C.atributos.incidentDeploymentId]: 'dep-a', ...(state === 'opened' ? { 'error.type': 'erro' } : {}),
      ...extras } };
}

test('DORA confirma cinco medidas somente com correlação explícita', () => {
  uid = 0;
  const recovery = deploy({ attributes: { ...deploy().attributes, [C.atributos.uid]: 'uid-recovery',
    [C.atributos.deploymentId]: 'dep-recovery' } });
  const resultado = calcularDora([deploy(), recovery, incident('opened'), incident('resolved',
    { [C.atributos.incidentRecoveryDeploymentId]: 'dep-recovery' })], ships);
  assert.deepEqual(resultado.medidas.map((item) => item.estado), Array(5).fill('confirmado'));
  assert.equal(resultado.medidas[0].valor, 2);
  assert.equal(resultado.medidas[2].valor, 0.5);
  assert.equal(resultado.medidas[3].valor, 3_600_000);
  assert.equal(resultado.medidas[4].valor, 0.5);
});

test('thread ou revisão divergente não se correlaciona por proximidade de horário', () => {
  uid = 0;
  const registro = deploy();
  registro.attributes[C.atributos.revision] = 'outra-revisao';
  const resultado = calcularDora([registro], ships);
  assert.equal(resultado.medidas[0].estado, 'não confirmado');
  assert.deepEqual(resultado.medidas[0].lacunas, ['thread_ou_revisao_divergente']);
});

test('UID repetido é deduplicado e conteúdo divergente fecha a entrada', () => {
  uid = 0;
  const primeiro = deploy(), repetido = { ...primeiro, resource: { ...primeiro.resource } };
  const divergente = { ...primeiro, attributes: { ...primeiro.attributes, [C.atributos.deploymentId]: 'outro' } };
  const deduplicado = calcularDora([primeiro, repetido], ships);
  assert.equal(deduplicado.medidas[0].valor, 1);
  const fechado = calcularDora([primeiro, divergente], ships);
  assert.equal(fechado.medidas[0].lacunas.includes('uid_divergente'), true);
});

test('ausência de evento ou vínculo deixa apenas a medida afetada não confirmada', () => {
  uid = 0;
  const resultado = calcularDora([deploy()], ships);
  assert.equal(resultado.medidas[0].estado, 'confirmado');
  assert.equal(resultado.medidas[1].estado, 'confirmado');
  assert.deepEqual(resultado.medidas.slice(2).map((item) => item.estado),
    ['não confirmado', 'não confirmado', 'não confirmado']);
});

test('payload não cria vínculo por horário e incidente exige deployment confirmado', () => {
  uid = 0;
  const resultado = calcularDora([incident('opened')], ships);
  assert.equal(resultado.medidas[2].estado, 'não confirmado');
  assert.equal(resultado.medidas[2].lacunas.includes('incident_deployment_divergente'), true);
});
