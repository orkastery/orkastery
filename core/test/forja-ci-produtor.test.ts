import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { consultarCi, consultarCiDoRepositorio, ExecutorCi } from '../src/ci';
import { exigirManifesto } from '../src/manifest';
import { exec } from '../src/util';
import { projetoTemporario, shaDaBranch } from './apoio';

const SHA = 'a'.repeat(40);
const run = (id: number, conclusion: string, slug?: string) => ({ id, name: 'ork-verify', status: 'completed', conclusion,
  completed_at: '2026-10-13T10:00:00Z', ...(slug ? { app: { slug } } : {}) });
const st = (id: number, state: string, login: string) => ({ id, context: 'ork-verify', state, updated_at: '2026-10-13T10:05:00Z', creator: { login } });
const forja = (runs: unknown[], statuses: unknown[] = []): ExecutorCi => (e) => ({ ok: true, code: 0, stderr: '',
  stdout: (e.caminho ?? '').includes('/statuses') ? JSON.stringify(statuses) : JSON.stringify({ total_count: runs.length, check_runs: runs }) });
const consultar = (executor: ExecutorCi, produtores?: readonly string[]) =>
  consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor, 'github.com', produtores);

test('check-run verde de app fora da lista não aprova: missing, com o produtor e a lista no detalhe', () => {
  const r = consultar(forja([run(1, 'success', 'outro-app')]));
  assert.equal(r.state, 'missing');
  assert.equal(r.ok, false);
  assert.match(r.detail, /outro-app/);
  assert.match(r.detail, /github-actions/);
});

test('check-run sem app (produtor desconhecido) não aprova', () => {
  assert.equal(consultar(forja([run(1, 'success')])).state, 'missing');
});

test('commit status verde do bot do GitHub Actions aprova sozinho', () => {
  const r = consultar(forja([], [st(1, 'success', 'github-actions[bot]')]));
  assert.equal(r.state, 'success', r.detail);
});

test('status:<login> na lista aceita o status daquela conta; sem ela, não', () => {
  const executor = forja([], [st(1, 'success', 'deploy-bot')]);
  assert.equal(consultar(executor, ['github-actions', 'status:deploy-bot']).state, 'success');
  assert.equal(consultar(executor).state, 'missing');
  assert.match(consultar(executor).detail, /commit status/);
});

test('a lista troca o padrão: circleci aprova, github-actions deixa de aprovar', () => {
  assert.equal(consultar(forja([run(1, 'success', 'circleci')]), ['circleci']).state, 'success');
  assert.equal(consultar(forja([run(1, 'success', 'github-actions')]), ['circleci']).state, 'missing');
});

test('vermelho, pendente e bloqueado de fora da lista ainda contam junto do verde aceito', () => {
  assert.equal(consultar(forja([run(1, 'success', 'github-actions'), run(2, 'failure', 'impostor')])).state, 'failure');
  assert.equal(consultar(forja([run(1, 'success', 'github-actions')], [st(3, 'pending', 'bot')])).state, 'pending');
  assert.equal(consultar(forja([run(1, 'success', 'github-actions'), run(2, 'skipped', 'outro-app')])).state, 'failure');
});

test('verde de fora da lista some do detalhe dos vários produtores', () => {
  const r = consultar(forja([run(1, 'success', 'github-actions'), run(2, 'success', 'outro-app')]));
  assert.equal(r.state, 'success');
});

test('consultarCi usa o ci.produtor do manifesto', () => {
  const p = projetoTemporario('ci-produtor', false);
  try {
    const arquivo = path.join(p.dir, 'orkastery.yaml');
    fs.writeFileSync(arquivo, fs.readFileSync(arquivo, 'utf8').replace('required_for_ship: false', 'required_for_ship: true')
      .replace('  context: ork-verify\n', '  context: ork-verify\n  produtor: [circleci]\n'));
    const carregado = exigirManifesto(p.dir);
    exec('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], p.dir);
    const sha = shaDaBranch(p.dir, 'main');
    assert.equal(consultarCi(carregado, sha, 'origin', forja([run(1, 'success', 'circleci')])).state, 'success');
    assert.equal(consultarCi(carregado, sha, 'origin', forja([run(1, 'success', 'github-actions')])).state, 'missing');
  } finally { p.limpar(); }
});
