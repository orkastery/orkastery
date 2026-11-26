import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
const childProcess: typeof import('node:child_process') = require('node:child_process');
import { checarShellDoVerify, checarTravaPortatil, sondarTravaDoNucleo } from '../src/doctor';
import { comLocale, nomeDoCheck } from '../src/locale';
import { tomarConducao } from '../src/conducao';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

test('doctor bloqueia quando a trava portátil não pode ser exercitada', () => {
  assert.equal(checarTravaPortatil().nivel, 'ok');
  const falha = checarTravaPortatil(() => { throw Error('fixture'); });
  assert.equal(falha.nivel, 'fail'); assert.match(falha.detalhe, /fixture/); assert.ok(falha.correcao);
  const semFlock = checarTravaPortatil(() => sondarTravaDoNucleo('linux', () => false));
  assert.equal(semFlock.nivel, 'fail'); assert.match(semFlock.detalhe, /flock ausente/);
  assert.match(semFlock.correcao ?? '', /instale \/usr\/bin\/flock/);
  assert.equal(checarTravaPortatil(() => sondarTravaDoNucleo('darwin')).nivel, 'ok');
});

test('sonda Linux executa o flock antes de declarar a trava pronta', () => {
  const chamada = mock.method(childProcess, 'spawnSync', () => ({ pid: 1, output: [null, Buffer.alloc(0), Buffer.alloc(0)],
    stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 17, signal: null, error: undefined }));
  try {
    assert.throws(() => sondarTravaDoNucleo('linux', () => true), /flock saiu 17/);
    assert.equal(chamada.mock.callCount(), 1);
  } finally { chamada.mock.restore(); }
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

test('tomarConducao no Linux sem flock falha fechada com a causa do mecanismo ausente',
  { skip: process.platform !== 'linux' }, (t) => {
  const p = projetoTemporario('conducao-sem-flock');
  const thread = novaThread(p.carregado, { nome: 'Condução sem flock', modo: 'fast' }).thread;
  const sistema = require('node:fs') as typeof import('node:fs');
  const existe = sistema.existsSync.bind(sistema);
  t.mock.method(sistema, 'existsSync', (arquivo: import('node:fs').PathLike) =>
    String(arquivo) === '/usr/bin/flock' ? false : existe(arquivo));
  try {
    assert.throws(() => tomarConducao(p.dir, thread.id,
      { canal: 'cli', operacao: 'verify', prazoMs: 60_000 }),
    /runtime\.unavailable: condução sem \/usr\/bin\/flock em linux/);
  } finally { p.limpar(); }
});
