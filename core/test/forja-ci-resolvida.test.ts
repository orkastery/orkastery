import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { consultarCi } from '../src/ci';
import type { SondasDaForja } from '../src/forja/resolver';
import { exigirManifesto } from '../src/manifest';
import { exec } from '../src/util';
import { loginDoGh } from '../src/ci';
import { cliFalsa, login, ok } from './forja-cli-falsa';
import { projetoTemporario, shaDaBranch } from './apoio';

const VERDE = JSON.stringify({ check_runs: [{ id: 1, name: 'ork-verify', status: 'completed', conclusion: 'success',
  completed_at: '2026-10-13T10:00:00Z', app: { slug: 'github-actions' } }] });
const NUNCA: SondasDaForja = { github: () => { throw new Error('sondou o github'); }, gitlab: () => { throw new Error('sondou o gitlab'); } };

function consultar(url: string, opcoes: { bloco?: string; sondas?: SondasDaForja; login?: (h: string) => boolean; repetir?: SondasDaForja } = {}) {
  const p = projetoTemporario('ci-resolvida', false);
  try {
    const arquivo = path.join(p.dir, 'orkastery.yaml');
    const texto = fs.readFileSync(arquivo, 'utf8').replace('required_for_ship: false', 'required_for_ship: true');
    fs.writeFileSync(arquivo, opcoes.bloco ? `${texto}\n${opcoes.bloco}\n` : texto);
    const carregado = exigirManifesto(p.dir);
    exec('git', ['remote', 'add', 'origin', url], p.dir);
    const chamadas: Array<{ host?: string; repository: string }> = [];
    const r = consultarCi(carregado, shaDaBranch(p.dir, 'main'), 'origin', (e) => {
      chamadas.push({ host: e.host, repository: e.repository });
      return { ok: true, code: 0, stderr: '', stdout: (e.caminho ?? '').includes('/statuses') ? '[]' : VERDE };
    }, opcoes.login ?? (() => true), opcoes.sondas ?? NUNCA);
    // A segunda consulta no mesmo projeto, com outras sondas: prova o cache do tipo sondado.
    const repetida = opcoes.repetir ? consultarCi(carregado, shaDaBranch(p.dir, 'main'), 'origin',
      (e) => ({ ok: true, code: 0, stderr: '', stdout: (e.caminho ?? '').includes('/statuses') ? '[]' : VERDE }), () => true, opcoes.repetir) : null;
    return { r, chamadas, repetida };
  } finally { p.limpar(); }
}

test('host com "github" no nome que só o glab reconhece não tem a CI consultada como GitHub', () => {
  const { r, chamadas } = consultar('https://github.empresa.com/o/r.git', { sondas: { github: () => 'sem-login', gitlab: () => 'responde' } });
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /GitHub/);
  assert.deepEqual(chamadas, []);
});

test('host próprio declarado github no manifesto é consultado sem sondar', () => {
  const { r, chamadas } = consultar('https://git.empresa.com/o/r.git', { bloco: 'forja:\n  tipo: github' });
  assert.equal(r.state, 'success', r.detail);
  assert.deepEqual(chamadas.map((c) => c.host), ['git.empresa.com', 'git.empresa.com']);
});

test('GitHub Enterprise sem bloco, reconhecido pela sonda do gh com login: a CI do host certo', () => {
  const { r, chamadas } = consultar('https://ghe.empresa.com:8443/o/r.git', { sondas: { github: () => 'responde', gitlab: () => 'sem-login' } });
  assert.equal(r.state, 'success', r.detail);
  assert.equal(chamadas[0].host, 'ghe.empresa.com:8443');
});

test('o tipo sondado fica no cache da raiz: a segunda consulta não sonda', () => {
  const { r, repetida } = consultar('https://ghe.empresa.com/o/r.git', { sondas: { github: () => 'responde', gitlab: () => 'sem-login' }, repetir: NUNCA });
  assert.equal(r.state, 'success', r.detail);
  assert.equal(repetida?.state, 'success', repetida?.detail);
});

test('host desconhecido sem login em nenhuma CLI: indisponível, com forja.desconhecida e o pedido de declarar forja.tipo', () => {
  const { r, chamadas } = consultar('https://git.empresa.com/o/r.git', { sondas: { github: () => 'sem-login', gitlab: () => 'sem-login' } });
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /forja\.desconhecida/);
  assert.match(r.detail, /forja\.tipo/);
  assert.deepEqual(chamadas, []);
});

test('duas CLIs reconhecem o host: forja.ambigua, nada consultado', () => {
  const { r, chamadas } = consultar('https://git.empresa.com/o/r.git', { sondas: { github: () => 'responde', gitlab: () => 'responde' } });
  assert.match(r.detail, /forja\.ambigua/);
  assert.deepEqual(chamadas, []);
});

test('manifesto gitlab com remoto github.com: remoto divergente, nada consultado', () => {
  const { r, chamadas } = consultar('https://github.com/o/r.git', { bloco: 'forja:\n  tipo: gitlab' });
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /forja\.remoto-divergente/);
  assert.deepEqual(chamadas, []);
});

test('github.com continua sem sondar e sem perguntar o login', () => {
  const perguntados: string[] = [];
  const { r } = consultar('git@github.com:o/r.git', { login: (h) => { perguntados.push(h); return false; } });
  assert.equal(r.state, 'success', r.detail);
  assert.deepEqual(perguntados, []);
});

test('login com porta: o login do github.com não vale para o GHE com porta, e a CI não é consultada', () => {
  const soGithub = cliFalsa([{ quando: login, responde: ok('github.com\n  \u2713 Logged in to github.com account u (keyring)\n') }]);
  const { r, chamadas } = consultar('https://ghe.empresa.com:8443/o/r.git', { login: (h) => loginDoGh(h, soGithub.rodar), sondas: { github: () => 'responde', gitlab: () => 'sem-login' } });
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /ghe\.empresa\.com:8443/);
  assert.deepEqual(chamadas, []);
});

test('login com porta: a linha do host:porta exato libera a consulta', () => {
  const ghe = cliFalsa([{ quando: login, responde: ok('ghe.empresa.com:8443\n  \u2713 Logged in to ghe.empresa.com:8443 account u (keyring)\n') }]);
  const { r, chamadas } = consultar('https://ghe.empresa.com:8443/o/r.git', { login: (h) => loginDoGh(h, ghe.rodar), sondas: { github: () => 'responde', gitlab: () => 'sem-login' } });
  assert.equal(r.state, 'success', r.detail);
  assert.equal(chamadas[0].host, 'ghe.empresa.com:8443');
  assert.equal(ghe.chamadas[0].acrescentar?.GH_HOST, 'ghe.empresa.com:8443');
});
