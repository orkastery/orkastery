import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ambienteDeCi } from '../src/forja/ambiente-de-ci';

const RAIZ = path.resolve(__dirname, '../../..');
const MODELO = path.join(RAIZ, 'templates/gitlab/ork-verify.yml');
const COMPONENTE = path.join(RAIZ, 'templates/ork-verify/template.yml');
const RODAR = 'ork ci run --branch "${CI_MERGE_REQUEST_SOURCE_BRANCH_NAME:-$CI_COMMIT_REF_NAME}"';
const PROIBIDOS = [/CI_JOB_TOKEN/, /\/statuses/, /allow_failure/, /PRIVATE-TOKEN/, /@latest/, /--force/];
const yaml = require('js-yaml') as { loadAll(texto: string): unknown[] };
type Mapa = Record<string, unknown>;
const mapa = (valor: unknown): Mapa => valor as Mapa;

function documentos(arquivo: string): Mapa[] {
  return yaml.loadAll(fs.readFileSync(arquivo, 'utf8'))
    .filter((valor): valor is Mapa => !!valor && typeof valor === 'object');
}

function script(job: Mapa): string {
  assert.ok(Array.isArray(job.script), 'o job declara script');
  return job.script.join('\n');
}

test('modelo: replay anterior sem opt-in e preparo protegido sem OIDC', () => {
  const t = fs.readFileSync(MODELO, 'utf8');
  const jobs = documentos(MODELO)[0];
  const preparo = mapa(jobs['ork-cliente-protegido']);
  const final = mapa(jobs['ork-verify']);
  const comandos = script(final);
  assert.equal(mapa(final.variables).GIT_DEPTH, '0');
  assert.match(comandos, new RegExp(RODAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const versao = /ORK_VERSAO="\$\{ORK_VERSAO:-([0-9]+\.[0-9]+\.[0-9]+)\}"/.exec(comandos)?.[1];
  assert.ok(versao, 'o replay sem opt-in fixa a versão padrão');
  assert.match(comandos, /"@orkastery\/cli@\$\{ORK_VERSAO\}"/);
  assert.match(comandos, /unset ORK_FABRICA_ID_TOKEN[\s\S]*npm install --global --ignore-scripts/);
  assert.equal('id_tokens' in preparo, false, 'o preparo do cliente não recebe OIDC');
  assert.match(script(preparo), /CI_JOB_TOKEN/);
  assert.equal(mapa(mapa(final.id_tokens).ORK_FABRICA_ID_TOKEN).aud, 'urn:orkastery:fabrica:ci');
  assert.equal('workflow' in jobs, false, 'workflow:rules fica no .gitlab-ci.yml do projeto, não num include');
  assert.match(t, /^#\s+workflow:$/m);
  assert.match(t, /CI_OPEN_MERGE_REQUESTS/);
  for (const p of PROIBIDOS) assert.doesNotMatch(comandos, p);
});

test('componente: opt-in explícito, preparo sem OIDC e replay anterior no mesmo job', () => {
  const [cabecalho, jobs] = documentos(COMPONENTE);
  const inputs = mapa(mapa(cabecalho.spec).inputs);
  for (const entrada of ['contexto', 'stage', 'imagem', 'versao_do_ork', 'transporte_habilitado', 'sha256_do_ork']) {
    assert.ok(entrada in inputs, `entrada ${entrada}`);
  }
  assert.equal(mapa(inputs.contexto).default, 'ork-verify');
  assert.equal(mapa(inputs.transporte_habilitado).default, false);
  const comandosDoModelo = script(mapa(documentos(MODELO)[0]['ork-verify']));
  const versaoDoModelo = /ORK_VERSAO="\$\{ORK_VERSAO:-([0-9]+\.[0-9]+\.[0-9]+)\}"/.exec(comandosDoModelo)?.[1];
  assert.equal(mapa(inputs.versao_do_ork).default, versaoDoModelo);
  const preparo = mapa(jobs['$[[ inputs.contexto ]]-preparar-cliente']);
  const final = mapa(jobs['$[[ inputs.contexto ]]']);
  const comandos = script(final);
  assert.equal('id_tokens' in preparo, false);
  assert.match(comandos, new RegExp(RODAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(comandos, /"@orkastery\/cli@\$\[\[ inputs\.versao_do_ork \]\]"/);
  assert.match(comandos, /unset ORK_FABRICA_ID_TOKEN[\s\S]*npm install --global --ignore-scripts/);
  assert.equal('workflow' in jobs, false);
  for (const p of PROIBIDOS) assert.doesNotMatch(comandos, p);
});

test('a branch que o modelo passa é a que o ambienteDeCi lê', () => {
  const mr = ambienteDeCi({ GITLAB_CI: 'true', CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'ork/ork-a',
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'release', CI_COMMIT_BRANCH: 'outra' });
  assert.equal(mr?.branch, 'ork/ork-a');
  assert.equal(mr?.targetBranch, 'release');
  assert.equal(ambienteDeCi({ GITLAB_CI: 'true', CI_COMMIT_BRANCH: 'main' })?.branch, 'main');
});
