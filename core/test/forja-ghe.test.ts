import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ajustarManifesto, projetoTemporario, shaDaBranch } from './apoio';
import { consultarCi } from '../src/ci';
import { exec } from '../src/util';

const verde = JSON.stringify({ check_runs: [{ name: 'ork-verify', status: 'completed', conclusion: 'success' }] });

function consultar(url: string) {
  const p = projetoTemporario('ci-ghe', false);
  ajustarManifesto(p, 'required_for_ship: false', 'required_for_ship: true');
  p.carregado.manifesto.ci.required_for_ship = true;
  exec('git', ['remote', 'add', 'origin', url], p.carregado.raiz);
  const sha = shaDaBranch(p.carregado.raiz, 'main');
  let host: string | undefined;
  const r = consultarCi(p.carregado, sha, 'origin', (e) => { if (e.caminho?.includes('/statuses')) return { ok: true, code: 0, stderr: '', stdout: '[]' }; host = e.host; return { ok: true, code: 0, stderr: '', stdout: verde }; }, () => true);
  p.limpar();
  return { host, r };
}

test('remoto GitHub Enterprise com porta consulta o host certo', () => {
  const { host, r } = consultar('https://ghe.empresa.com:8443/o/r.git');
  assert.equal(host, 'ghe.empresa.com:8443');
  assert.equal(r.state, 'success');
});

test('remoto ssh.github.com (SSH pela 443) consulta o github.com', () => {
  const { host, r } = consultar('ssh://git@ssh.github.com:443/o/r.git');
  assert.equal(host, 'github.com');
  assert.equal(r.state, 'success');
});

function consultarComLogin(url: string, login: (h: string) => boolean) {
  const p = projetoTemporario('ci-ghe2', false);
  ajustarManifesto(p, 'required_for_ship: false', 'required_for_ship: true');
  p.carregado.manifesto.ci.required_for_ship = true;
  exec('git', ['remote', 'add', 'origin', url], p.carregado.raiz);
  const sha = shaDaBranch(p.carregado.raiz, 'main');
  const hosts: Array<string | undefined> = [];
  const perguntados: string[] = [];
  const r = consultarCi(p.carregado, sha, 'origin', (e) => { if (e.caminho?.includes('/statuses')) return { ok: true, code: 0, stderr: '', stdout: '[]' }; hosts.push(e.host); return { ok: true, code: 0, stderr: '', stdout: verde }; },
    (h) => { perguntados.push(h); return login(h); });
  p.limpar();
  return { hosts, perguntados, r };
}

test('GHE com login no host: host passado e sucesso', () => {
  const { hosts, perguntados, r } = consultarComLogin('https://ghe.empresa.com:8443/o/r.git', () => true);
  assert.deepEqual(hosts, ['ghe.empresa.com:8443']);
  assert.deepEqual(perguntados, ['ghe.empresa.com:8443']);
  assert.equal(r.state, 'success');
});

test('GHE sem login no host: unavailable e o executor nunca roda', () => {
  const { hosts, r } = consultarComLogin('https://ghe.empresa.com/o/r.git', () => false);
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /ghe\.empresa\.com/);
  assert.deepEqual(hosts, []);
});

test('porta fora da faixa: unavailable, sem cair no github.com', () => {
  const { hosts, perguntados, r } = consultarComLogin('https://ghe.empresa.com:99999/o/r.git', () => true);
  assert.equal(r.state, 'unavailable');
  assert.deepEqual(hosts, []);
  assert.deepEqual(perguntados, []);
});

test('remoto GitLab continua ciRemotoNaoGithub', () => {
  const { hosts, r } = consultarComLogin('https://gitlab.com/o/r.git', () => true);
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /GitHub/);
  assert.deepEqual(hosts, []);
});

test('github.com nao pergunta login', () => {
  const { perguntados, r } = consultarComLogin('https://github.com/o/r.git', () => false);
  assert.equal(r.state, 'success');
  assert.deepEqual(perguntados, []);
});
