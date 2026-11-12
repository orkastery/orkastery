import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { anexarPreflightAoResultadoCi } from '../src/ci';
import { ambienteDeCi } from '../src/forja/ambiente-de-ci';
import { preflightNaoRealizado } from '../src/rede-empresa-preflight';
import { textoDoPreflightEmpresa } from '../src/locale-network-empresa';

test('sem credencial a checagem coletiva não é realizada e o resultado do CI não muda', () => {
  const preflight = preflightNaoRealizado('ci.credencial-ausente');
  const antes = { schema: 'ork.ci-run/v1', ok: true, commands: [], log: 'verde' };
  const depois = anexarPreflightAoResultadoCi(antes, preflight);
  assert.equal(depois.ok, true); assert.equal(depois.preflightEmpresa?.estado, 'nao-realizado');
  assert.match(textoDoPreflightEmpresa(preflight, 'pt-BR'), /Checagem coletiva não realizada.*resultado do CI não muda/);
});

test('GitHub classifica fork pela carga oficial e não confunde carga ausente ou ilegível com mesmo repositório', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-evento-pr-'));
  const evento = (nome: string, head: string, base = 'time/projeto') => {
    const arquivo = path.join(dir, nome);
    fs.writeFileSync(arquivo, JSON.stringify({ pull_request: { head: { repo: { full_name: head } },
      base: { repo: { full_name: base } } } }));
    return arquivo;
  };
  const env = (arquivo: string, nome = 'pull_request') => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'time/projeto',
    GITHUB_EVENT_NAME: nome, GITHUB_EVENT_PATH: arquivo, GITHUB_HEAD_REF: 'mudanca', GITHUB_BASE_REF: 'main' });
  try {
    assert.equal(ambienteDeCi(env(evento('fork.json', 'outra/projeto')))?.fork, true);
    assert.equal(ambienteDeCi(env(evento('mesmo.json', 'time/projeto')))?.fork, false);
    assert.equal(ambienteDeCi(env(path.join(dir, 'ausente.json')))?.fork, null);
    const ilegivel = path.join(dir, 'ilegivel.json'); fs.writeFileSync(ilegivel, '{');
    assert.equal(ambienteDeCi(env(ilegivel))?.fork, null);
    assert.equal(ambienteDeCi(env(evento('target.json', 'outra/projeto'), 'pull_request_target'))?.fork, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('GitLab classifica fork pelas variáveis oficiais do merge request', () => {
  const base = { GITLAB_CI: 'true', CI_PROJECT_ID: '41', CI_PROJECT_PATH: 'time/projeto',
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main', CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'mudanca' };
  assert.equal(ambienteDeCi({ ...base, CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '42',
    CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: 'outra/projeto' })?.fork, true);
  assert.equal(ambienteDeCi({ ...base, CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '41',
    CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: 'time/projeto' })?.fork, false);
  assert.equal(ambienteDeCi(base)?.fork, null);
});

test('resultado não realizado de fork não expõe a credencial', () => {
  const texto = JSON.stringify(anexarPreflightAoResultadoCi({ ok: true }, preflightNaoRealizado('ci.pr-de-fork')));
  assert.doesNotMatch(texto, /segredo-que-nao-sai|ORK_REDE_EMPRESA_READ_TOKEN|Authorization/);
});

test('sem inscrição o resultado anterior permanece sem campo coletivo', () => {
  const resultado = anexarPreflightAoResultadoCi({ ok: false, error: 'falha existente' }, null);
  assert.deepEqual(resultado, { ok: false, error: 'falha existente' });
});
