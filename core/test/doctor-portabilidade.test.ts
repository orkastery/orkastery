import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checarShellDoVerify, checarTravaPortatil } from '../src/doctor';
import { comLocale, nomeDoCheck } from '../src/locale';

test('doctor bloqueia quando a trava portátil não pode ser exercitada', () => {
  assert.equal(checarTravaPortatil().nivel, 'ok');
  const falha = checarTravaPortatil(() => { throw Error('fixture'); });
  assert.equal(falha.nivel, 'fail'); assert.match(falha.detalhe, /fixture/); assert.ok(falha.correcao);
});

test('doctor bloqueia shell ausente, avisa Bash antigo e aprova Bash atual', () => {
  assert.equal(checarShellDoVerify(() => null).nivel, 'fail');
  const antigo = checarShellDoVerify(() => ({ caminho: '/bin/bash', versao: '3.2.57' }));
  assert.equal(antigo.nivel, 'warn'); assert.match(antigo.detalhe, /3\.2\.57/);
  const atual = checarShellDoVerify(() => ({ caminho: '/bin/bash', versao: '5.2.0' }));
  assert.equal(atual.nivel, 'ok'); assert.match(atual.detalhe, /\/bin\/bash/);
});

test('nomes dos checks novos têm paridade em inglês', () => {
  comLocale('en', () => {
    assert.equal(nomeDoCheck('trava portátil'), 'portable lock');
    assert.equal(nomeDoCheck('shell do verify'), 'verify shell');
  });
});
