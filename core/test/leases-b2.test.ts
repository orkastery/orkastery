/** Testes do bloco B2: familias de lease, colisao de regiao por glob e fila FIFO. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import {
  adquirirRegiao,
  alvoDoLease,
  caminhoBateComGlob,
  esperandoPor,
  globsColidem,
  LEASE_MAIN_TREE,
  leasesColidem,
  lerFila,
  liberar,
  listarLeases,
  nomeDeLease,
  tabelaDeLeases,
  tipoDoLease,
} from '../src/leases';

test('as 5 familias de lease tem nome canonico e tipo reconhecido', () => {
  assert.equal(nomeDeLease('main-tree'), LEASE_MAIN_TREE);
  assert.equal(nomeDeLease('worktree-write', 'ork-checkout'), 'worktree-write:ork-checkout');
  assert.equal(nomeDeLease('path', 'core/src/**'), 'path:core/src/**');
  assert.equal(nomeDeLease('board', 'CARD-42'), 'board:CARD-42');
  assert.equal(nomeDeLease('service', '5173'), 'service:5173');

  assert.equal(tipoDoLease(LEASE_MAIN_TREE), 'main-tree');
  assert.equal(tipoDoLease('worktree-write:ork-checkout'), 'worktree-write');
  assert.equal(tipoDoLease('path:core/src/**'), 'path');
  assert.equal(tipoDoLease('board:CARD-42'), 'board');
  assert.equal(tipoDoLease('service:5173'), 'service');
  assert.equal(alvoDoLease('path:core/src/**'), 'core/src/**');
  assert.throws(() => nomeDeLease('path', ''), /exige um alvo/);
});

test('colisao de glob: regiao contida colide, regiao irma nao colide', () => {
  assert.equal(caminhoBateComGlob('core/src/master.ts', 'core/src/**'), true);
  assert.equal(caminhoBateComGlob('core/test/x.ts', 'core/src/**'), false);
  assert.equal(globsColidem('core/src/**', 'core/src/master.ts'), true);
  assert.equal(globsColidem('core/**', 'core/src/board.ts'), true);
  assert.equal(globsColidem('core/src/*.ts', 'core/src/board.ts'), true);
  assert.equal(globsColidem('core/src/**', 'core/test/**'), false);
  assert.equal(globsColidem('core/src/a.ts', 'core/src/b.ts'), false);
  assert.equal(globsColidem('core/s', 'core/src/**'), false, 'prefixo parcial nao e colisao');

  // Familias diferentes nunca colidem entre si.
  assert.equal(leasesColidem('path:core/**', 'board:core'), false);
  assert.equal(leasesColidem('service:5173', 'service:5173'), true);
  assert.equal(leasesColidem('service:5173', 'service:5174'), false);
});

test('lease path:<glob> bloqueia a segunda thread na mesma regiao e a poe na fila', () => {
  const p = projetoTemporario('lease-path');
  const primeira = adquirirRegiao(p.dir, 'path:core/src/**', {
    thread: 'ork-alfa',
    motivo: 'GO na regiao do nucleo',
  });
  assert.equal(primeira.ok, true);
  assert.equal(primeira.esperando, false);
  assert.equal(primeira.tipo, 'path');

  // Regiao contida na primeira: colide, mesmo com glob diferente.
  const segunda = adquirirRegiao(p.dir, 'path:core/src/master.ts', {
    thread: 'ork-beta',
    motivo: 'GO no modulo master',
  });
  assert.equal(segunda.ok, false);
  assert.equal(segunda.esperando, true);
  assert.equal(segunda.motivo, 'lease.busy');
  assert.equal(segunda.posicaoNaFila, 1);
  assert.equal(segunda.colidiuCom?.thread, 'ork-alfa');
  assert.match(segunda.correcao, /ork-alfa/);

  // Regiao irma: passa sem esperar.
  const terceira = adquirirRegiao(p.dir, 'path:core/test/**', {
    thread: 'ork-gama',
    motivo: 'GO nos testes',
  });
  assert.equal(terceira.ok, true, 'regiao que nao cruza nao entra na fila');

  const fila = lerFila(p.dir);
  assert.equal(fila.length, 1);
  assert.equal(fila[0].thread, 'ork-beta');
  assert.equal(fila[0].tipo, 'path');
  assert.equal(fila[0].bloqueadaPor, 'ork-alfa');
  assert.match(tabelaDeLeases(p.dir), /Fila por colisao de regiao/);

  // Liberado o lease, a thread da fila entra.
  assert.equal(liberar(p.dir, 'path:core/src/**', 'ork-alfa').ok, true);
  const retomada = adquirirRegiao(p.dir, 'path:core/src/master.ts', {
    thread: 'ork-beta',
    motivo: 'GO no modulo master',
  });
  assert.equal(retomada.ok, true);
  assert.equal(lerFila(p.dir).length, 0, 'quem adquiriu sai da fila');
  p.limpar();
});

test('a fila e FIFO: quem chegou depois nao fura a vez de quem esperava', () => {
  const p = projetoTemporario('lease-fifo');
  adquirirRegiao(p.dir, 'path:app/**', { thread: 'ork-dona', motivo: 'GO' });
  const segunda = adquirirRegiao(p.dir, 'path:app/**', { thread: 'ork-fila1', motivo: 'GO' });
  const terceira = adquirirRegiao(p.dir, 'path:app/**', { thread: 'ork-fila2', motivo: 'GO' });
  assert.equal(segunda.posicaoNaFila, 1);
  assert.equal(terceira.posicaoNaFila, 2);

  liberar(p.dir, 'path:app/**', 'ork-dona');
  // A ultima da fila tenta furar: o `ork` a mantem esperando.
  const fura = adquirirRegiao(p.dir, 'path:app/**', { thread: 'ork-fila2', motivo: 'GO' });
  assert.equal(fura.ok, false);
  assert.equal(fura.motivo, 'lease.busy');
  assert.match(fura.detalhe, /ork-fila1/);

  const daVez = adquirirRegiao(p.dir, 'path:app/**', { thread: 'ork-fila1', motivo: 'GO' });
  assert.equal(daVez.ok, true, 'quem estava na frente leva');
  assert.equal(esperandoPor(p.dir, 'path:app/**').length, 1, 'sobra so a ultima na fila');
  p.limpar();
});

test('o main-tree continua sendo o unico gate de merge e aparece na merge queue', () => {
  const p = projetoTemporario('lease-merge');
  const dona = adquirirRegiao(p.dir, LEASE_MAIN_TREE, { thread: 'ork-um', motivo: 'ship' });
  assert.equal(dona.ok, true);
  const espera = adquirirRegiao(p.dir, LEASE_MAIN_TREE, { thread: 'ork-dois', motivo: 'ship' });
  assert.equal(espera.ok, false);
  assert.equal(espera.motivo, 'lease.busy');
  assert.equal(esperandoPor(p.dir, LEASE_MAIN_TREE).length, 1);

  // Uma regiao de path NAO segura o merge: familias diferentes nao colidem.
  const regiao = adquirirRegiao(p.dir, 'path:core/**', { thread: 'ork-tres', motivo: 'GO' });
  assert.equal(regiao.ok, true);
  assert.equal(listarLeases(p.dir).length, 2);
  assert.match(tabelaDeLeases(p.dir), /Fila de merge/);
  p.limpar();
});
