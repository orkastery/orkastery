import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { CARDINALIDADES_DORA, RegistroDora, validarFormaDoRegistroDora } from '../src/telemetria-maturidade-dora';
import { CONTRATO_SDLC_ANALYTICS as C } from '../src/telemetria-maturidade-registro';

const raiz = path.resolve(__dirname, '../../..');
const arquivos = ['collector-loki.yaml', 'collector-otlp.yaml'];

for (const arquivo of arquivos) test(`${arquivo} mantém pipeline DORA separada e fechada`, () => {
  const texto = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', arquivo), 'utf8');
  assert.match(texto, /logs\/orkastery:[\s\S]*logs\/dora:/);
  assert.match(texto, /logs\/dora:[\s\S]*filter\/dora, transform\/dora-sanitize, transform\/dora-policy/);
  assert.match(texto, /orkastery\.sdlc\.deployment\.v1/);
  assert.match(texto, /orkastery\.sdlc\.incident\.v1/);
  assert.match(texto, /Len\(log\.attributes\) != 9/);
  assert.match(texto, /Len\(resource\.attributes\) != 2/);
  assert.match(texto, /log\.attributes\["user\.hash"\] != nil or resource\.attributes\["service\.namespace"\] != nil/);
  assert.match(texto, /ORK_DORA_USER_HASH/);
  assert.match(texto, /ORK_DORA_SERVICE_NAMESPACE/);
  assert.match(texto, /team_source_missing/);
});

function registro(eventName: string, attributes: Record<string, string>): RegistroDora {
  return { eventName, timestamp: '2026-11-10T12:00:00.000Z',
    resource: { [C.atributos.serviceName]: 'api', [C.atributos.environment]: C.valores.production }, attributes };
}

test('B4 schema comportamental aceita as cardinalidades exatas e rejeita variantes', () => {
  const comuns = { [C.atributos.uid]: 'uid', [C.atributos.threadId]: 'ork-a' };
  const deploy = registro(C.eventos.deployment, { ...comuns, [C.atributos.deploymentId]: 'dep',
    [C.atributos.deploymentStatus]: C.valores.succeeded, [C.atributos.pipelineName]: 'release',
    [C.atributos.pipelineRunId]: 'run', [C.atributos.pipelineResult]: C.valores.success,
    [C.atributos.pipelineTaskType]: C.valores.deploy, [C.atributos.revision]: 'rev' });
  assert.deepEqual(validarFormaDoRegistroDora(deploy), []);
  assert.equal(Object.keys(deploy.attributes).length, CARDINALIDADES_DORA.deployment);
  assert.equal(validarFormaDoRegistroDora({ ...deploy,
    attributes: { ...deploy.attributes, extra: 'recusado' } }).includes('deployment_campo_desconhecido'), true);

  const incidente = { ...comuns, [C.atributos.incidentId]: 'inc',
    [C.atributos.incidentDeploymentId]: 'dep' };
  const opened = registro(C.eventos.incident, { ...incidente, [C.atributos.incidentState]: C.valores.opened,
    'error.type': 'erro' });
  const resolved = registro(C.eventos.incident, { ...incidente, [C.atributos.incidentState]: C.valores.resolved });
  assert.deepEqual(validarFormaDoRegistroDora(opened), []);
  assert.deepEqual(validarFormaDoRegistroDora(resolved), []);
  assert.equal(Object.keys(opened.attributes).length, CARDINALIDADES_DORA.incidentOpened);
  assert.equal(Object.keys(resolved.attributes).length, CARDINALIDADES_DORA.incidentResolvedMin);
  const semErro = { ...opened, attributes: { ...opened.attributes } };
  delete semErro.attributes['error.type'];
  assert.equal(validarFormaDoRegistroDora(semErro).includes('error_type_ausente'), true);
  assert.equal(validarFormaDoRegistroDora({ ...resolved,
    attributes: { ...resolved.attributes, extra: 'recusado' } }).includes('incident_campo_desconhecido'), true);
});

test('B4 os dois modelos usam as cardinalidades do schema comportamental', () => {
  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', arquivo), 'utf8');
    assert.equal(texto.includes(`Len(log.attributes) != ${CARDINALIDADES_DORA.deployment}`), true, arquivo);
    assert.equal(texto.includes(`Len(log.attributes) != ${CARDINALIDADES_DORA.incidentOpened}`), true, arquivo);
    assert.equal(texto.includes(`Len(log.attributes) < ${CARDINALIDADES_DORA.incidentResolvedMin}`), true, arquivo);
    assert.equal(texto.includes(`Len(log.attributes) > ${CARDINALIDADES_DORA.incidentResolvedMax}`), true, arquivo);
  }
});

test('pipeline original recusa DORA e preserva os fatos analíticos publicados', () => {
  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', arquivo), 'utf8');
    assert.match(texto, /IsMatch\(log\.event_name, "\^orkastery\\\\\.sdlc/);
    for (const atributo of ['vcs.ref.head.revision', 'cicd.pipeline.name',
      'cicd.pipeline.run.id', 'cicd.pipeline.result', 'service.namespace']) {
      assert.equal(texto.includes(`"${atributo}"`), true, atributo);
    }
  }
});

test('README exige overlay privado e não promete validação operacional hermética', () => {
  const texto = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', 'README.md'), 'utf8');
  assert.match(texto, /overlay privado com TLS e autenticação/);
  assert.match(texto, /conferência externa fica fora do gate hermético/);
  assert.match(texto, /proximidade de horário não cria vínculo/);
});
