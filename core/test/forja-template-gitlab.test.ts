import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ambienteDeCi } from '../src/forja/ambiente-de-ci';

const RAIZ = path.resolve(__dirname, '../../..');
const MODELO = path.join(RAIZ, 'templates/gitlab/ork-verify.yml');
const COMPONENTE = path.join(RAIZ, 'templates/ork-verify/template.yml');
const RODAR = 'ork ci run --branch "${CI_MERGE_REQUEST_SOURCE_BRANCH_NAME:-$CI_COMMIT_REF_NAME}"';
const semComentario = (t: string) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const PROIBIDOS = [/CI_JOB_TOKEN/, /\/statuses/, /allow_failure/, /PRIVATE-TOKEN/, /@latest/, /--force/];

test('modelo: job ork-verify, histórico inteiro, a branch do MR ou do push, versão fixada e nenhum token', () => {
  const t = fs.readFileSync(MODELO, 'utf8');
  const c = semComentario(t);
  assert.match(c, /^ork-verify:$/m);
  assert.ok(c.includes(`- ${RODAR}`));
  assert.match(c, /GIT_DEPTH: "0"/);
  assert.match(c, /ORK_VERSAO: "\d+\.\d+\.\d+"/);
  assert.match(c, /"@orkastery\/cli@\$\{ORK_VERSAO\}"/);
  assert.doesNotMatch(c, /^workflow:/m, 'workflow:rules fica no .gitlab-ci.yml do projeto, não num include');
  assert.match(t, /^#\s+workflow:$/m);
  assert.match(t, /CI_OPEN_MERGE_REQUESTS/);
  for (const p of PROIBIDOS) assert.doesNotMatch(c, p);
});

test('componente: spec com as entradas, o mesmo job e a mesma versão do modelo', () => {
  const t = fs.readFileSync(COMPONENTE, 'utf8');
  const [cabecalho, corpo] = t.split(/^---$/m);
  assert.ok(corpo, 'o componente separa o spec do job por ---');
  assert.match(cabecalho, /^spec:\n {2}inputs:$/m);
  for (const entrada of ['contexto', 'stage', 'imagem', 'versao_do_ork']) assert.match(cabecalho, new RegExp(`^ {4}${entrada}:$`, 'm'));
  assert.match(cabecalho, /default: ork-verify/);
  const versaoDoModelo = /ORK_VERSAO: "(\d+\.\d+\.\d+)"/.exec(fs.readFileSync(MODELO, 'utf8'))![1];
  assert.match(cabecalho, new RegExp(`default: "${versaoDoModelo.replace(/\./g, '\\.')}"`));
  const c = semComentario(corpo);
  assert.match(c, /^"\$\[\[ inputs\.contexto \]\]":$/m);
  assert.ok(c.includes(`- ${RODAR}`));
  assert.match(c, /"@orkastery\/cli@\$\[\[ inputs\.versao_do_ork \]\]"/);
  assert.doesNotMatch(c, /^workflow:/m);
  for (const p of PROIBIDOS) assert.doesNotMatch(c, p);
});

test('a branch que o modelo passa é a que o ambienteDeCi lê', () => {
  assert.equal(ambienteDeCi({ GITLAB_CI: 'true', CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'ork/ork-a', CI_COMMIT_BRANCH: 'outra' })?.branch, 'ork/ork-a');
  assert.equal(ambienteDeCi({ GITLAB_CI: 'true', CI_COMMIT_BRANCH: 'main' })?.branch, 'main');
});
