/** RM-088: regra SemVer, classificação hermética do npm e contrato do workflow de publicação. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';

const SCRIPT = path.resolve(__dirname, '../../scripts/decidir-publicacao-npm.cjs');
const RAIZ_DO_REPO = path.resolve(__dirname, '../../..');
const regra = require(SCRIPT) as {
  analisarSemver: (v: string) => unknown;
  compararSemver: (a: string, b: string) => number;
  prepararCandidata: (tag: string, pacote: string) => unknown;
  decidirPublicacao: (e: { versaoTag: string; versaoPacote: string; registro: Registro }) => Decisao;
  classificarSucessoDaConsulta: (s: string) => Registro;
  consultarRegistro: (executor: Executor) => Registro;
  executar: (o: { env: Record<string, string>; raiz: string; executor: Executor }) => { status: number; decisao: Decisao };
};

type Registro = { tipo: 'latest'; versao: string } | { tipo: 'pacote-ausente' | 'sem-latest' | 'inacessivel' };
type Decisao = { acao: 'publicar'; distTag: string; versao: string; motivo: string };
type Resultado = { status: number; stdout: string; stderr: string };
type Executor = (comando: string, argumentos: string[]) => Resultado;

const latest = (versao: string): Registro => ({ tipo: 'latest', versao });
const decidir = (versao: string, registro: Registro): Decisao => regra.decidirPublicacao({ versaoTag: `v${versao}`, versaoPacote: versao, registro });
const motivo = (fn: () => unknown, esperado: RegExp): void => assert.throws(fn, esperado);

test('PN1: estável maior usa latest, igual falha e menor usa previous', () => {
  assert.equal(decidir('0.6.9', latest('0.6.8')).distTag, 'latest');
  motivo(() => decidir('0.6.8', latest('0.6.8')), /^Error: publicacao\.versao-ja-publicada:/);
  assert.equal(decidir('0.6.7', latest('0.6.8')).distTag, 'previous');
  assert.equal(decidir('1.10.0', latest('1.9.0')).distTag, 'latest');
});

test('PN2: pré-release usa rc ou beta, seja maior, menor ou primeira publicação', () => {
  assert.equal(decidir('0.7.0-rc.1', latest('0.6.9')).distTag, 'rc');
  assert.equal(decidir('0.6.9-beta.2', latest('0.7.0')).distTag, 'beta');
  assert.equal(decidir('0.1.0-rc.1', { tipo: 'pacote-ausente' }).distTag, 'rc');
  assert.equal(decidir('0.1.0', { tipo: 'pacote-ausente' }).distTag, 'latest');
});

test('PN3: latest e previous ficam reservadas, e tags numéricas, x e prefixos inseguros falham', () => {
  for (const versao of ['2.0.0-latest.1', '1.0.0-previous.1', '1.0.0-x.1', '1.0.0-X.1', '1.0.0-1',
    '1.0.0-1rc', '1.0.0-v1', '1.0.0-Vnext']) {
    motivo(() => decidir(versao, latest('1.0.0')), /^Error: publicacao\.dist-tag-invalida:/);
  }
});

test('PN4: dist-tag inválida e divergência tag/pacote são recusadas antes do executor', () => {
  motivo(() => regra.prepararCandidata('v2.0.0-latest.1', '2.0.0-latest.1'), /^Error: publicacao\.dist-tag-invalida:/);
  motivo(() => regra.prepararCandidata('v0.6.9', '0.6.8'), /^Error: publicacao\.versao-tag-diverge:/);
});

test('PN5: precedência cobre estável, numérico, alfanumérico, quantidade e build metadata', () => {
  assert.ok(regra.compararSemver('1.0.0-rc.1', '1.0.0') < 0);
  assert.ok(regra.compararSemver('1.0.0-1', '1.0.0-alpha') < 0);
  assert.ok(regra.compararSemver('1.0.0-alpha', '1.0.0-alpha.1') < 0);
  assert.ok(regra.compararSemver('1.0.0-beta.2', '1.0.0-beta.11') < 0);
  assert.equal(regra.compararSemver('1.0.0+build.1', '1.0.0+build.2'), 0);
});

test('PN6: inteiros acima de MAX_SAFE_INTEGER são comparados sem perda', () => {
  assert.ok(regra.compararSemver('9007199254740993.0.0', '9007199254740992.0.0') > 0);
  assert.ok(regra.compararSemver('1.0.0-9007199254740993', '1.0.0-9007199254740992') > 0);
});

test('PN7: zeros à esquerda falham no core e na pré-release numérica, mas passam no build', () => {
  for (const versao of ['01.0.0', '1.00.0', '1.0.01', '1.0.0-01']) {
    motivo(() => regra.analisarSemver(versao), /^Error: publicacao\.semver-invalida:/);
  }
  assert.doesNotThrow(() => regra.analisarSemver('1.0.0+build.01'));
});

test('PN8: latest inválida ou pré-release, pacote sem latest e registry inacessível falham fechados', () => {
  motivo(() => decidir('1.0.0', latest('invalida')), /^Error: publicacao\.semver-invalida:/);
  motivo(() => decidir('1.0.0', latest('1.0.0-rc.1')), /^Error: publicacao\.latest-pre-release:/);
  motivo(() => decidir('1.0.0', { tipo: 'sem-latest' }), /^Error: publicacao\.latest-ausente:/);
  motivo(() => decidir('1.0.0', { tipo: 'inacessivel' }), /^Error: publicacao\.registro-inacessivel:/);
});

test('PN9: sucesso do npm 11 e npm 12 aceita só string SemVer ou array unitário', () => {
  assert.deepEqual(regra.classificarSucessoDaConsulta('"1.2.3"\n'), latest('1.2.3'));
  assert.deepEqual(regra.classificarSucessoDaConsulta('["1.2.3"]\n'), latest('1.2.3'));
  assert.deepEqual(regra.classificarSucessoDaConsulta(''), { tipo: 'sem-latest' });
  assert.deepEqual(regra.classificarSucessoDaConsulta('null\n'), { tipo: 'sem-latest' });
});

test('PN10: formas de sucesso desconhecidas viram consulta-invalida', () => {
  for (const saida of ['[]', '["1.2.3","1.2.4"]', '{}', '{"versao":"1.2.3"}', '12', '"não-semver"', 'texto']) {
    motivo(() => regra.classificarSucessoDaConsulta(saida), /^Error: publicacao\.consulta-invalida:/);
  }
});

test('PN11: executor falso classifica E404 mais ping verde como pacote ausente', () => {
  const chamadas: string[][] = [];
  const respostas: Resultado[] = [
    { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: '' },
    { status: 0, stdout: '{}', stderr: '' },
  ];
  const executor: Executor = (comando, argumentos) => { chamadas.push([comando, ...argumentos]); return respostas.shift()!; };
  assert.deepEqual(regra.consultarRegistro(executor), { tipo: 'pacote-ausente' });
  assert.deepEqual(chamadas, [
    ['npm', 'view', '@orkastery/cli', 'dist-tags.latest', '--json', '--registry=https://registry.npmjs.org'],
    ['npm', 'ping', '--registry=https://registry.npmjs.org'],
  ]);
});

test('PN12: E404 com ping vermelho e erros não E404 ou não estruturados falham sem segunda interpretação', () => {
  const resultado = (status: number, stdout: string, stderr = ''): Resultado => ({ status, stdout, stderr });
  for (const respostas of [
    [resultado(1, JSON.stringify({ error: { code: 'E404' } })), resultado(1, '', 'fora')],
    [resultado(1, JSON.stringify({ error: { code: 'E401' } }))],
    [resultado(1, '', 'npm error humano')],
  ]) {
    let i = 0;
    assert.deepEqual(regra.consultarRegistro(() => respostas[i++]), { tipo: 'inacessivel' });
  }
});

test('PN13: a CLI valida a dist-tag antes da consulta e só então grava tag no GITHUB_OUTPUT', () => {
  const raiz = dirTemporario('rm088-cli');
  try {
    fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ version: '2.0.0-latest.1' }));
    const saida = path.join(raiz, 'github-output');
    let chamadas = 0;
    motivo(() => regra.executar({ env: { GITHUB_REF_NAME: 'v2.0.0-latest.1', GITHUB_OUTPUT: saida }, raiz,
      executor: () => { chamadas += 1; return { status: 0, stdout: '"1.0.0"', stderr: '' }; } }),
    /^Error: publicacao\.dist-tag-invalida:/);
    assert.equal(chamadas, 0);
    assert.equal(fs.existsSync(saida), false);
    fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ version: '2.0.0-rc.1' }));
    const r = regra.executar({ env: { GITHUB_REF_NAME: 'v2.0.0-rc.1', GITHUB_OUTPUT: saida }, raiz,
      executor: () => ({ status: 0, stdout: '["1.0.0"]', stderr: '' }) });
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(saida, 'utf8'), 'tag=rc\n');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('PN14: workflow preserva as guardas e publica somente com a saída validada da RM-088', () => {
  const workflow = fs.readFileSync(path.join(RAIZ_DO_REPO, '.github/workflows/publicar.yml'), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  publicar:'));
  const noctum = job.indexOf('run: node core/scripts/checar-release-noctum.cjs');
  const decisao = job.indexOf('id: decidir-publicacao');
  const comandoDaDecisao = job.indexOf('run: node core/scripts/decidir-publicacao-npm.cjs');
  const publish = job.indexOf('run: npm publish --access public --tag "${{ steps.decidir-publicacao.outputs.tag }}"');
  assert.ok(noctum > 0 && decisao > noctum && comandoDaDecisao > decisao && publish > comandoDaDecisao,
    'a decisão fica entre #Noctum e publish');
  assert.equal(job.split('id: decidir-publicacao').length - 1, 1, 'o id da decisão é único');
  assert.equal(job.split('run: node core/scripts/decidir-publicacao-npm.cjs').length - 1, 1, 'o adaptador é chamado uma vez');
  assert.equal(job.split('npm publish').length - 1, 1, 'há um único publish');
  assert.doesNotMatch(job, /run: npm publish --access public\s*$/m, 'não existe publish sem --tag');
  assert.doesNotMatch(job.slice(comandoDaDecisao, publish), /latest|\|\||\?\?/, 'não existe fallback para latest');
  assert.match(workflow, /tags: \['v\*'\]/, 'o gatilho v* permanece');
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: write/, 'o Trusted Publishing permanece');
  assert.match(job, /needs: provar-grafo/, 'a prova do grafo permanece como dependência');
  assert.match(job, /registry-url: 'https:\/\/registry\.npmjs\.org'/, 'o registry permanece');
  assert.match(job, /run: npm install -g npm@latest/, 'npm@latest permanece');
  assert.match(job, /run: git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/, 'a tag continua presa à main');
  assert.match(job, /run: node core\/dist\/index\.js eval --so-cenarios/, 'os cenários permanecem');
  assert.match(job.slice(publish), /working-directory: core/, 'o publish continua no core');
});
