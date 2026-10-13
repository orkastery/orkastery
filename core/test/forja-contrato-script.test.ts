import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/forja-contrato.cjs');
const SHA = 'a'.repeat(40);
const GH_TOKEN = 'ghp_' + 'a'.repeat(36);

/** Regra da CLI falsa: o trecho `padrao` casa em "$*" (os argumentos da chamada). */
type Regra = { padrao: string; corpo?: unknown; stderr?: string; codigo?: number };

/**
 * CLI falsa no PATH. Escolhe a resposta pelo caminho da API ("$*"): cada regra vira um `case`.
 * Corpos e erros vao para arquivos, para nao haver citacao de shell no conteudo.
 */
function cliFalso(bin: string, cli: string, regras: Regra[]): void {
  const dados = path.join(bin, `${cli}-dados`);
  fs.mkdirSync(dados, { recursive: true });
  const linhas = ['#!/bin/sh', 'case "$*" in'];
  regras.forEach((r, i) => {
    if (r.stderr !== undefined) {
      const f = path.join(dados, `${i}.txt`);
      fs.writeFileSync(f, r.stderr);
      linhas.push(`  *${r.padrao}*) cat '${f}' >&2; exit ${r.codigo ?? 1} ;;`);
    } else {
      const f = path.join(dados, `${i}.json`);
      fs.writeFileSync(f, JSON.stringify(r.corpo ?? {}));
      linhas.push(`  *${r.padrao}*) cat '${f}'; exit ${r.codigo ?? 0} ;;`);
    }
  });
  linhas.push("  *) printf '%s' '{}' ;;", 'esac');
  fs.writeFileSync(path.join(bin, cli), linhas.join('\n') + '\n', { mode: 0o755 });
}

function sandbox(): { bin: string; saida: string } {
  return {
    bin: fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bin-')),
    saida: fs.mkdtempSync(path.join(os.tmpdir(), 'forja-saida-')),
  };
}

function rodar(bin: string, args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

const argsGithub = (saida: string) => ['--forja', 'github', '--host', 'github.com', '--repo', 'o/r', '--sha', SHA, '--saida', saida];
const argsGitlab = (saida: string) => ['--forja', 'gitlab', '--host', 'gitlab.example.com', '--repo', 'grupo/proj', '--sha', SHA, '--saida', saida];

test('grava cada caso com o corpo redigido e o comando sem token', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo: { total_count: 1, check_runs: [{ name: 'ork-verify', output: { text: GH_TOKEN } }] } }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  const arquivo = path.join(saida, 'check-runs.json');
  const gravado = fs.readFileSync(arquivo, 'utf8');
  assert.doesNotMatch(gravado, /ghp_a{36}/);
  assert.match(gravado, /\[redigido\]/);
  assert.equal((fs.statSync(arquivo).mode & 0o777), 0o600);
});

test('recusa forja desconhecida sem gravar nada', () => {
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-saida-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--forja', 'gitea', '--host', 'h', '--repo', 'o/r', '--sha', SHA,
    '--saida', saida], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.deepEqual(fs.readdirSync(saida), []);
});

test('caminho de erro: CLI que sai com erro grava status e erro redigidos, com saida 1', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', codigo: 1,
    stderr: `gh: falha com ${GH_TOKEN} e https://u:senha@h.example/o/r.git` }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 1, r.stderr);
  const arquivo = path.join(saida, 'check-runs.json');
  const gravado = fs.readFileSync(arquivo, 'utf8');
  const caso = JSON.parse(gravado);
  assert.notEqual(caso.status, 0);
  assert.equal(typeof caso.erro, 'string');
  assert.match(caso.erro, /\[redigido\]/);
  assert.doesNotMatch(gravado, /ghp_a{36}/);
  assert.doesNotMatch(gravado, /senha/);
  assert.equal((fs.statSync(arquivo).mode & 0o777), 0o600);
});

test('ramo GitLab: usa o glab e grava os casos com o contrato do roteiro', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'glab', [{ padrao: 'metadata', corpo: { version: '17.0.0', enterprise: false } }]);
  const r = rodar(bin, argsGitlab(saida));
  assert.equal(r.status, 0, r.stderr);
  const caso = JSON.parse(fs.readFileSync(path.join(saida, 'metadata.json'), 'utf8'));
  assert.equal(caso.forja, 'gitlab');
  assert.equal(caso.host, 'gitlab.example.com');
  assert.equal(caso.comando[0], 'glab');
  assert.equal(caso.status, 0);
  assert.equal(caso.corpo.version, '17.0.0');
  assert.ok(fs.existsSync(path.join(saida, 'projeto.json')));
});

test('redige cada familia de segredo num corpo gravado e preserva URL com porta e e-mail', () => {
  const { bin, saida } = sandbox();
  const corpo = {
    gl: 'glpat-abcdefghijklmnop',
    gl_roteavel: 'glpat-abcdefgh.01.ijklmnop',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJhc2lnbmF0dXJh',
    url_cred: 'https://user:senha@host.example.com/repo.git',
    url_porta: 'https://host:8443',
    email: 'a@b',
    nested: { lista: [GH_TOKEN] },
  };
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  const gravado = fs.readFileSync(path.join(saida, 'check-runs.json'), 'utf8');
  for (const segredo of ['abcdefghijklmnop', 'ijklmnop', 'eyJhbGci', 'senha', 'ghp_a', 'user:']) {
    assert.doesNotMatch(gravado, new RegExp(segredo), `vazou: ${segredo}`);
  }
  const lido = JSON.parse(gravado).corpo;
  assert.equal(lido.gl, '[redigido]');
  assert.equal(lido.gl_roteavel, '[redigido]');
  assert.equal(lido.jwt, '[redigido]');
  assert.equal(lido.url_cred, 'https://[redigido]@host.example.com/repo.git');
  assert.equal(lido.url_porta, 'https://host:8443');
  assert.equal(lido.email, 'a@b');
  assert.equal(lido.nested.lista[0], '[redigido]');
});

test('comando gravado nao contem token', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo: {} }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  const caso = JSON.parse(fs.readFileSync(path.join(saida, 'check-runs.json'), 'utf8'));
  assert.ok(Array.isArray(caso.comando));
  for (const arg of caso.comando) assert.doesNotMatch(arg, /ghp_|glpat-|eyJ|senha/);
});

test('arquivo de caso existente com modo 644 fica com 600', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo: { ok: true } }]);
  const arquivo = path.join(saida, 'check-runs.json');
  fs.writeFileSync(arquivo, 'antigo', { mode: 0o644 });
  fs.chmodSync(arquivo, 0o644);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  assert.equal((fs.statSync(arquivo).mode & 0o777), 0o600);
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).corpo.ok, true);
});

test('GitLab: redige runners_token (chave *_token) e token de runner glrt- em qualquer chave', () => {
  const { bin, saida } = sandbox();
  const runner = 'GR1348941' + 'x'.repeat(20);
  const novo = 'glrt-' + 'y'.repeat(24);
  cliFalso(bin, 'glab', [{ padrao: 'projects/grupo%2Fproj', corpo: { id: 7, runners_token: runner, access_token: 'qualquer', nota: novo,
    expires_at: '2026-10-14', ativo: true } }]);
  const r = rodar(bin, argsGitlab(saida));
  assert.equal(r.status, 0, r.stderr);
  const gravado = fs.readFileSync(path.join(saida, 'projeto.json'), 'utf8');
  assert.doesNotMatch(gravado, /GR1348941/);
  assert.doesNotMatch(gravado, /glrt-/);
  assert.doesNotMatch(gravado, /qualquer/);
  const corpo = JSON.parse(gravado).corpo;
  assert.equal(corpo.runners_token, '[redigido]');
  assert.equal(corpo.access_token, '[redigido]');
  assert.equal(corpo.nota, '[redigido]');
  assert.equal(corpo.id, 7);
  assert.equal(corpo.expires_at, '2026-10-14');
  assert.equal(corpo.ativo, true);
});
