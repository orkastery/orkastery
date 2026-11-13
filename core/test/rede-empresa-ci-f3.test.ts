import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { anexarPreflightAoResultadoCi } from '../src/ci';
import { ambienteDeCi } from '../src/forja/ambiente-de-ci';
import { gravarAdesaoRedeEmpresa } from '../src/rede-empresa-config';
import { CREDENCIAL_DE_LEITURA_DA_REDE, preflightCiDoProjeto, preflightNaoRealizado } from '../src/rede-empresa-preflight';
import { textoDoPreflightEmpresa } from '../src/locale-network-empresa';
import { projetoTemporario } from './apoio';

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

test('preflightCiDoProjeto leva http.extraHeader somente no ambiente do Git sob a carga oficial do GitHub', () => {
  const p = projetoTemporario('rede-empresa-ci-transporte', true), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-ci-home-'));
  try {
    execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/time/projeto.git'], { cwd: p.dir });
    const ref = (caminho: string) => ({ forja: 'github' as const, host: 'github.com', caminho });
    const env: NodeJS.ProcessEnv = { ORK_USUARIO_DIR: home, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'time/projeto',
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'mudanca', GITHUB_BASE_REF: 'main',
      [CREDENCIAL_DE_LEITURA_DA_REDE]: 'token-de-fixture' };
    gravarAdesaoRedeEmpresa({ inscricaoId: 'inscricao-a', empresa: ref('time/rede'), rede: ref('time/rede'),
      maestroRef: { forja: 'github', host: 'github.com', accountId: 41 }, loginAtual: 'builder', politicaVersao: 'v2',
      projetos: [ref('time/projeto')], estado: 'ativa', ultimaPublicacao: null, pendencia: null }, env);
    const evento = path.join(home, 'evento.json');
    fs.writeFileSync(evento, JSON.stringify({ pull_request: { head: { repo: { full_name: 'time/projeto' } },
      base: { repo: { full_name: 'time/projeto' } } } })); env.GITHUB_EVENT_PATH = evento;
    const fork = ambienteDeCi(env)?.fork;
    assert.equal(fork, false);
    let url = '', opcoes: { env?: NodeJS.ProcessEnv } | undefined;
    const resultado = preflightCiDoProjeto(p.dir, p.carregado.manifesto, env, fork ?? null, {
      prepararCache: (_casa, recebida) => { url = recebida; return path.join(home, 'cache'); },
      portaGit: (_cache, _remoto, rede) => { opcoes = rede; return { ler: () => ({ id: null, atualizada: false,
        ler: () => null }), gravar: () => false }; },
    });
    assert.equal(resultado?.estado, 'inconclusivo');
    assert.equal(opcoes?.env?.GIT_CONFIG_KEY_0, 'http.extraHeader');
    assert.match(opcoes?.env?.GIT_CONFIG_VALUE_0 ?? '', /^Authorization: Basic /);
    assert.equal(opcoes?.env?.[CREDENCIAL_DE_LEITURA_DA_REDE], '');
    assert.doesNotMatch(JSON.stringify({ url, cache: path.join(home, 'cache'), remoto: 'origin' }), /token-de-fixture/);
    let leuCredencial = false;
    const privilegiado = new Proxy(env, { get(alvo, chave, receptor) {
      if (chave === CREDENCIAL_DE_LEITURA_DA_REDE) { leuCredencial = true; throw new Error('credencial lida'); }
      return Reflect.get(alvo, chave, receptor) as unknown;
    } });
    const forkBloqueado = preflightCiDoProjeto(p.dir, p.carregado.manifesto, privilegiado, true, {
      prepararCache: () => { throw new Error('transporte não deve ser preparado'); },
    });
    assert.deepEqual([forkBloqueado?.estado, forkBloqueado?.lacunas, leuCredencial],
      ['nao-realizado', ['ci.pr-de-fork'], false]);
  } finally { p.limpar(); fs.rmSync(home, { recursive: true, force: true }); }
});
