import assert from 'node:assert/strict';
import test from 'node:test';
import { anexarPreflightAoResultadoCi } from '../src/ci';
import { ambienteDeCi } from '../src/forja/ambiente-de-ci';
import { CREDENCIAL_DE_LEITURA_DA_REDE, preflightNaoRealizado } from '../src/rede-empresa-preflight';
import { textoDoPreflightEmpresa } from '../src/locale-network-empresa';

test('sem credencial a checagem coletiva não é realizada e o resultado do CI não muda', () => {
  const preflight = preflightNaoRealizado('ci.credencial-ausente');
  const antes = { schema: 'ork.ci-run/v1', ok: true, commands: [], log: 'verde' };
  const depois = anexarPreflightAoResultadoCi(antes, preflight);
  assert.equal(depois.ok, true); assert.equal(depois.preflightEmpresa?.estado, 'nao-realizado');
  assert.match(textoDoPreflightEmpresa(preflight, 'pt-BR'), /Checagem coletiva não realizada.*resultado do CI não muda/);
});

test('PR de fork é identificado sem ler ou expor a credencial', () => {
  const gh = ambienteDeCi({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'time/projeto', GITHUB_HEAD_REPOSITORY: 'outra/projeto',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'mudanca', GITHUB_BASE_REF: 'main',
    [CREDENCIAL_DE_LEITURA_DA_REDE]: 'segredo-que-nao-sai' });
  assert.deepEqual([gh?.pullRequest, gh?.fork], [true, true]);
  const texto = JSON.stringify(anexarPreflightAoResultadoCi({ ok: true }, preflightNaoRealizado('ci.pr-de-fork')));
  assert.doesNotMatch(texto, /segredo-que-nao-sai|ORK_REDE_EMPRESA_READ_TOKEN|Authorization/);
});

test('sem inscrição o resultado anterior permanece sem campo coletivo', () => {
  const resultado = anexarPreflightAoResultadoCi({ ok: false, error: 'falha existente' }, null);
  assert.deepEqual(resultado, { ok: false, error: 'falha existente' });
});
