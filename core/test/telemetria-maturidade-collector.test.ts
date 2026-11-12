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

interface RegistroCollector { eventName: string; resource: Record<string, string>; attributes: Record<string, string> }

function condicoesDora(arquivo: string): string[] {
  const linhas = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', arquivo), 'utf8').split('\n');
  const inicio = linhas.findIndex((linha) => linha.trim() === 'filter/dora:');
  const fim = linhas.findIndex((linha, indice) => indice > inicio && linha.trim() === 'transform/dora-sanitize:');
  assert.equal(inicio >= 0 && fim > inicio, true, arquivo);
  return linhas.slice(inicio, fim).map((linha) => linha.trim()).filter((linha) => linha.startsWith("- '") && linha.endsWith("'"))
    .map((linha) => linha.slice(3, -1));
}

function avaliarCondicaoOttl(expressao: string, registroAtual: RegistroCollector): boolean {
  const tokens = expressao.match(/"(?:\\.|[^"])*"|!=|==|<=|>=|[()<>]|\b(?:and|or|nil|Len)\b|log\.event_name|log\.attributes(?:\["[^"]+"\])?|resource\.attributes(?:\["[^"]+"\])?|\d+/g) ?? [];
  assert.equal(tokens.join('').replaceAll(' ', ''), expressao.replaceAll(/\s/g, ''), `OTTL não interpretado: ${expressao}`);
  let posicao = 0;
  const primario = (): unknown => {
    const token = tokens[posicao++];
    if (token === '(') { const valor = ou(); assert.equal(tokens[posicao++], ')'); return valor; }
    if (token === 'Len') { assert.equal(tokens[posicao++], '('); const valor = primario(); assert.equal(tokens[posicao++], ')');
      return valor && typeof valor === 'object' ? Object.keys(valor).length : 0; }
    if (token === 'nil') return null;
    if (/^\d+$/.test(token)) return Number(token);
    if (token.startsWith('"')) return JSON.parse(token) as string;
    if (token === 'log.event_name') return registroAtual.eventName;
    const atributo = token.match(/^(log|resource)\.attributes\["([^"]+)"\]$/);
    if (atributo) return (atributo[1] === 'log' ? registroAtual.attributes : registroAtual.resource)[atributo[2]] ?? null;
    if (token === 'log.attributes') return registroAtual.attributes;
    if (token === 'resource.attributes') return registroAtual.resource;
    throw new Error(`token OTTL inesperado: ${token}`);
  };
  const comparar = (): boolean => {
    const esquerda = primario(), operador = tokens[posicao];
    if (!['==', '!=', '<', '>', '<=', '>='].includes(operador)) return Boolean(esquerda);
    posicao += 1;
    const direita = primario();
    if (operador === '==') return esquerda === direita;
    if (operador === '!=') return esquerda !== direita;
    if (typeof esquerda !== 'number' || typeof direita !== 'number') return false;
    if (operador === '<') return esquerda < direita;
    if (operador === '>') return esquerda > direita;
    if (operador === '<=') return esquerda <= direita;
    return esquerda >= direita;
  };
  const e = (): boolean => { let valor = comparar(); while (tokens[posicao] === 'and') {
    posicao += 1; const direita = comparar(); valor = valor && direita; } return valor; };
  const ou = (): boolean => { let valor = e(); while (tokens[posicao] === 'or') {
    posicao += 1; const direita = e(); valor = valor || direita; } return valor; };
  const resultado = ou();
  assert.equal(posicao, tokens.length, `OTTL incompleto: ${expressao}`);
  return resultado;
}

function collectorDescarta(arquivo: string, registroAtual: RegistroCollector): boolean {
  return condicoesDora(arquivo).some((condicao) => avaliarCondicaoOttl(condicao, registroAtual));
}

test('A3 aplica as condições dos dois Collectors e fecha opened e resolved contra atributos desconhecidos', () => {
  const comuns = { [C.atributos.uid]: 'uid', [C.atributos.threadId]: 'ork-a' };
  const resource = { [C.atributos.serviceName]: 'api', [C.atributos.environment]: C.valores.production };
  const deploy = { eventName: C.eventos.deployment, resource, attributes: { ...comuns,
    [C.atributos.deploymentId]: 'dep', [C.atributos.deploymentStatus]: C.valores.succeeded,
    [C.atributos.pipelineName]: 'release', [C.atributos.pipelineRunId]: 'run',
    [C.atributos.pipelineResult]: C.valores.success, [C.atributos.pipelineTaskType]: C.valores.deploy,
    [C.atributos.revision]: 'rev' } };
  const incidente = { ...comuns, [C.atributos.incidentId]: 'inc',
    [C.atributos.incidentDeploymentId]: 'dep' };
  const opened = { eventName: C.eventos.incident, resource, attributes: { ...incidente,
    [C.atributos.incidentState]: C.valores.opened, 'error.type': 'erro' } };
  const resolved = { eventName: C.eventos.incident, resource, attributes: { ...incidente,
    [C.atributos.incidentState]: C.valores.resolved } };
  const resolvedComRecovery = { ...resolved, attributes: { ...resolved.attributes,
    [C.atributos.incidentRecoveryDeploymentId]: 'recovery' } };
  for (const arquivo of arquivos) {
    for (const valido of [deploy, opened, resolved, resolvedComRecovery]) {
      assert.equal(collectorDescarta(arquivo, valido), false, `${arquivo}: registro válido`);
    }
    for (const valido of [deploy, opened, resolved, resolvedComRecovery]) {
      const invalido = { ...valido, attributes: { ...valido.attributes, 'campo.desconhecido': 'recusado' } };
      assert.equal(collectorDescarta(arquivo, invalido), true, `${arquivo}: campo desconhecido`);
    }
    assert.equal(collectorDescarta(arquivo, { ...resolved,
      resource: { ...resolved.resource, 'recurso.desconhecido': 'recusado' } }), true, `${arquivo}: recurso desconhecido`);
  }
});

test('pipeline original recusa DORA e preserva os fatos analíticos publicados', () => {
  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', arquivo), 'utf8');
    assert.match(texto, /log\.event_name == "orkastery\.sdlc\.deployment\.v1" or log\.event_name == "orkastery\.sdlc\.incident\.v1"/);
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
