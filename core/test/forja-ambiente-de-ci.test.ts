import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { adicionarClaim } from '../src/claims';
import { executarCi } from '../src/ci';
import { ambienteDeCi } from '../src/forja/ambiente-de-ci';
import { novaThread } from '../src/thread';
import { envPtBr, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const GITLAB = { GITLAB_CI: 'true', CI_PROJECT_PATH: 'grupo/sub/projeto', CI_COMMIT_BRANCH: 'ork/ork-a-full',
  CI_JOB_URL: 'https://gitlab.empresa.com/grupo/sub/projeto/-/jobs/7' };

test('GitLab CI: projeto com subgrupo, branch do MR antes da do push, página do job; tag sem branch', () => {
  assert.deepEqual(ambienteDeCi(GITLAB), { tipo: 'gitlab', produtor: 'gitlab-ci', repository: 'grupo/sub/projeto', branch: 'ork/ork-a-full',
    url: 'https://gitlab.empresa.com/grupo/sub/projeto/-/jobs/7' });
  assert.equal(ambienteDeCi({ ...GITLAB, CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'ork/ork-b-full', CI_MERGE_REQUEST_EVENT_TYPE: 'merged_result' })?.branch,
    'ork/ork-b-full');
  assert.equal(ambienteDeCi({ GITLAB_CI: 'true', CI_COMMIT_TAG: 'v1.0.0', CI_COMMIT_REF_NAME: 'v1.0.0' })?.branch, null);
});

test('GitHub Actions: repositório, branch do PR antes da do push, página do run; tag sem branch', () => {
  const gh = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '42',
    GITHUB_REF_NAME: 'main', GITHUB_REF_TYPE: 'branch' };
  assert.deepEqual(ambienteDeCi(gh), { tipo: 'github', produtor: 'github-actions', repository: 'o/r', branch: 'main',
    url: 'https://github.com/o/r/actions/runs/42' });
  assert.equal(ambienteDeCi({ ...gh, GITHUB_HEAD_REF: 'ork/ork-a-full' })?.branch, 'ork/ork-a-full');
  assert.equal(ambienteDeCi({ ...gh, GITHUB_HEAD_REF: '', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1' })?.branch, null);
});

test('fora de runner, null; valor de várias linhas ou fora da forma vale como ausente', () => {
  assert.equal(ambienteDeCi({}), null);
  assert.equal(ambienteDeCi({ GITHUB_REPOSITORY: 'o/r' }), null, 'sem GITHUB_ACTIONS=true não é runner');
  const torto = ambienteDeCi({ GITLAB_CI: 'true', CI_PROJECT_PATH: 'so-o-nome', CI_COMMIT_BRANCH: 'a\nb', CI_JOB_URL: 'javascript:x' });
  assert.deepEqual([torto?.repository, torto?.branch, torto?.url], [null, null, null]);
});

test('executarCi: o retrato v2 do runner diz a forja, o projeto, a fonte e o produtor; fora de runner, nada disso', () => {
  const p = projetoTemporario('ci-ambiente');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'ci ambiente', modo: 'auto' });
    adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'o README existe', verificar: ['test -f README.md'], fase: 'GO' });
    const r = executarCi(p.carregado, thread.id, GITLAB).status;
    assert.deepEqual([r.schema, r.provider, r.repository, r.fonte, r.produtor, r.url],
      ['ork.ci-status/v2', 'gitlab', 'grupo/sub/projeto', 'pipeline-job', 'gitlab-ci', 'https://gitlab.empresa.com/grupo/sub/projeto/-/jobs/7']);
    const fora = executarCi(p.carregado, thread.id, {}).status;
    assert.deepEqual([fora.provider, fora.repository, fora.fonte, fora.produtor, fora.url], [null, null, null, null, null]);
  } finally { p.limpar(); }
});

test('ork ci run sem thread nem --branch: no runner, a branch do runner; fora dele, a linha de uso', () => {
  const p = projetoTemporario('ci-run-ambiente');
  try {
    const env = envPtBr();
    for (const nome of Object.keys(env)) if (/^(GITHUB_|GITLAB_|CI_)/.test(nome) || nome === 'CI') delete env[nome];
    for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO']) delete env[nome];
    const rodar = (extra: Record<string, string>) => spawnSync(process.execPath, [CLI, 'ci', 'run'],
      { cwd: p.dir, encoding: 'utf8', env: { ...env, ORK_FABRICA_PUBLICAR: '0', ...extra } });
    const fora = rodar({});
    assert.equal(fora.status, 2);
    assert.match(fora.stderr, /uso: ork ci run/);
    const noRunner = rodar({ GITLAB_CI: 'true', CI_COMMIT_BRANCH: 'ork/ork-sem-bundle' });
    assert.notEqual(noRunner.status, 0);
    assert.match(`${noRunner.stdout}${noRunner.stderr}`, /ci\.bundle\.ausente: a branch ork\/ork-sem-bundle/);
  } finally { p.limpar(); }
});
