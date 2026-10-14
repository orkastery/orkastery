import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dirDoCache, separarRepositorio } from '../src/rede';
import { gitlabSemSuporteNaRede } from '../src/rede-forja';

test('separa dono e nome pelo último /, com subgrupos', () => {
  assert.deepEqual(separarRepositorio('grupo/sub/casa'), ['grupo/sub', 'casa']);
  assert.deepEqual(separarRepositorio('dono/nome'), ['dono', 'nome']);
  assert.deepEqual(separarRepositorio('so-nome'), [null, 'so-nome']);
  assert.deepEqual(separarRepositorio(undefined), [null, null]);
});

test('rede: o subcaminho do GITLAB_HOST só recusa a casa no mesmo host; a CA própria recusa fora do gitlab.com', () => {
  const amb = { env: { GITLAB_HOST: 'https://outro.empresa.com/gitlab' } };
  assert.equal(gitlabSemSuporteNaRede(amb, 'gitlab.empresa.com'), null, 'o GITLAB_HOST é de outra instância');
  assert.equal(gitlabSemSuporteNaRede(amb, 'outro.empresa.com'), 'subcaminho');
  assert.equal(gitlabSemSuporteNaRede(amb), 'subcaminho', 'sem o host da casa, vale o do GITLAB_HOST');
  assert.equal(gitlabSemSuporteNaRede({ env: { GLAB_CA_CERT: '/ca.pem' } }, 'gitlab.empresa.com'), 'ca');
  assert.equal(gitlabSemSuporteNaRede({ env: { GLAB_CA_CERT: '/ca.pem' } }, 'gitlab.com'), null);
});

test('rede: o cache do dono com subgrupo não colide com o do dono de hífen; o do GitHub segue o de sempre', () => {
  const casa = (dono: string) => dirDoCache({ forja: 'gitlab', host: 'gitlab.empresa.com', dono, repositorio: 'rede' });
  assert.notEqual(casa('time/sub'), casa('time-sub'));
  assert.ok(casa('time-sub').endsWith('gitlab-gitlab.empresa.com-time-sub-rede'));
  assert.ok(dirDoCache({ forja: 'github', host: 'github.com', dono: 'dono', repositorio: 'rede' }).endsWith('github-github.com-dono-rede'));
});
