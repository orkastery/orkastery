import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { detectStacks } from '../src/security-scan/detect';
import { init } from '../src/init';
import { exec } from '../src/util';

function repo(nome: string, arquivos: string[]): string {
  const dir = dirTemporario(nome);
  for (const rel of arquivos) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
  }
  return dir;
}

test('detectStacks: package.json na raiz e js', () => {
  assert.deepEqual(detectStacks(repo('sd-js', ['package.json'])), [{ stack: 'js', dir: '.' }]);
});

test('detectStacks: package.json so em subpasta de primeiro nivel', () => {
  assert.deepEqual(detectStacks(repo('sd-sub', ['core/package.json'])), [{ stack: 'js', dir: 'core' }]);
});

test('detectStacks: marcadores de Python', () => {
  for (const f of ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'uv.lock', 'poetry.lock', 'Pipfile.lock']) {
    assert.deepEqual(detectStacks(repo('sd-py', [f])), [{ stack: 'python', dir: '.' }], f);
  }
});

test('detectStacks: go.mod e go; os tres juntos dao tres entradas em ordem fixa', () => {
  assert.deepEqual(detectStacks(repo('sd-go', ['go.mod'])), [{ stack: 'go', dir: '.' }]);
  const d = repo('sd-tres', ['go.mod', 'pyproject.toml', 'package.json']);
  assert.deepEqual(detectStacks(d), [{ stack: 'js', dir: '.' }, { stack: 'python', dir: '.' }, { stack: 'go', dir: '.' }]);
});

test('detectStacks: raiz antes das subpastas, subpastas em ordem de nome, uma entrada por (stack, dir)', () => {
  const d = repo('sd-ordem', ['z/go.mod', 'a/requirements.txt', 'a/uv.lock', 'package.json']);
  assert.deepEqual(detectStacks(d), [
    { stack: 'js', dir: '.' }, { stack: 'python', dir: 'a' }, { stack: 'go', dir: 'z' },
  ]);
});

test('detectStacks: ignora pastas de terceiros e nao desce alem do primeiro nivel', () => {
  const d = repo('sd-ign', [
    'node_modules/x/package.json', 'node_modules/package.json', 'vendor/go.mod', 'dist/package.json',
    '.git/package.json', '.orkastery/go.mod', 'a/b/package.json',
  ]);
  assert.deepEqual(detectStacks(d), []);
});

function repoGit(nome: string, arquivos: string[]): string {
  const dir = repo(nome, arquivos);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  return dir;
}

test('init: repo Go escreve verify.security_scan ativo no orkastery.yaml', () => {
  const dir = repoGit('sd-init-go', ['go.mod']);
  const r = init(dir);
  assert.deepEqual(r.deteccao.stacks, ['go']);
  assert.ok(fs.readFileSync(r.caminho, 'utf8').includes('\n  security_scan: "ork security-scan"\n'));
});

test('init: repo sem stack escreve a linha comentada', () => {
  const dir = repoGit('sd-init-vazio', []);
  const r = init(dir);
  assert.deepEqual(r.deteccao.stacks, []);
  assert.ok(fs.readFileSync(r.caminho, 'utf8').includes('\n  # security_scan: "ork security-scan"\n'));
});

test('init: stacks vem deduplicadas', () => {
  const dir = repoGit('sd-init-dup', ['package.json', 'web/package.json', 'go.mod']);
  assert.deepEqual(init(dir).deteccao.stacks, ['js', 'go']);
});
