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
  const r = consultarCi(p.carregado, sha, 'origin', (e) => { host = e.host; return { ok: true, code: 0, stderr: '', stdout: verde }; });
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
