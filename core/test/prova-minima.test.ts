/**
 * I-42 (D4, D5, T8): a prova minima de um ciclo sem CHECK.
 *
 * O mapa de teste focado, o limite de comandos por claim (que vale so no ciclo sem CHECK)
 * e o evento de ausencia declarada.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { adicionarClaim, anexarComando } from '../src/claims';
import { lerLedger, TIPOS_DE_EVENTO } from '../src/ledger';
import {
  cicloSemCheck,
  comandoDoTesteFocado,
  LIMITE_DE_COMANDOS_SEM_CHECK,
  registrarProvaAusente,
  testeFocado,
  validarProvaSemCheck,
} from '../src/prova-minima';
import { dirThread, novaThread } from '../src/thread';
import { ajustarManifesto, projetoTemporario } from './apoio';

const RAIZ_DO_REPO = path.resolve(__dirname, '..', '..', '..');

test('o mapa de teste focado: homonimo, o proprio teste, e nada quando nao ha', () => {
  assert.equal(testeFocado(RAIZ_DO_REPO, 'core/src/modos.ts'), 'core/test/modos.test.ts');
  assert.equal(testeFocado(RAIZ_DO_REPO, 'core/src/claims.ts'), null, 'claims.ts nao tem homonimo');
  assert.equal(testeFocado(RAIZ_DO_REPO, 'core/test/ship.test.ts'), 'core/test/ship.test.ts');
  assert.equal(testeFocado(RAIZ_DO_REPO, 'docs/roadmap/README.md'), null);
  assert.equal(testeFocado(RAIZ_DO_REPO, 'core/src/adapters/codex.ts'), null, 'so o primeiro nivel de core/src');
  assert.equal(
    comandoDoTesteFocado('core/test/modos.test.ts'),
    'npm --prefix core run build:test && node --test core/dist-test/test/modos.test.js'
  );
});

test('o degrau 2 recusa mais comandos que o teto e a suite inteira do manifesto', () => {
  const suite = 'npm --prefix core test';
  assert.doesNotThrow(() => validarProvaSemCheck(['grep -F x a.md', 'node --test b.test.js'], suite));
  assert.throws(
    () => validarProvaSemCheck(['a', 'b', 'c'].slice(0, LIMITE_DE_COMANDOS_SEM_CHECK + 1), suite),
    /claims\.custo: ciclo sem CHECK aceita ate 2 comandos/
  );
  assert.throws(() => validarProvaSemCheck([`cd x && ${suite}`], suite), /nao roda a suite inteira/);
  assert.doesNotThrow(() => validarProvaSemCheck(['npm --prefix core run build:test'], undefined));
});

test('o limite vale so no ciclo sem CHECK: #Fast recusa, #Classic aceita a mesma claim', () => {
  const p = projetoTemporario('prova-minima-claims');
  try {
    ajustarManifesto(p, '  # test: nao detectado', '  test: "npm test"');
    const fast = novaThread(p.carregado, { nome: 'ajuste rapido', modo: 'fast' }).thread;
    const classic = novaThread(p.carregado, { nome: 'ajuste com plano', modo: 'classic' }).thread;
    assert.equal(cicloSemCheck(fast), true);
    assert.equal(cicloSemCheck(classic), false);

    const tres = { arquivo: 'README.md', alegacao: 'o texto mudou', verificar: ['true', 'true', 'true'] };
    assert.throws(() => adicionarClaim(p.dir, fast.id, tres), /claims\.custo/);
    assert.equal(adicionarClaim(p.dir, classic.id, tres).verificar.length, 3);

    const suite = { arquivo: 'README.md', alegacao: 'tudo verde', verificar: ['npm test'] };
    assert.throws(() => adicionarClaim(p.dir, fast.id, suite), /suite inteira/);
    assert.equal(adicionarClaim(p.dir, classic.id, suite).verificar.length, 1);

    // Anexar comando tambem respeita o teto: a terceira linha e recusada.
    const c = adicionarClaim(p.dir, fast.id, { arquivo: 'README.md', alegacao: 'o titulo mudou', verificar: ['grep -F titulo README.md'] });
    anexarComando(p.dir, fast.id, c.id, 'test -s README.md');
    assert.throws(() => anexarComando(p.dir, fast.id, c.id, 'true'), /claims\.custo/);
  } finally {
    p.limpar();
  }
});

test('o degrau 3 grava prova_ausente com caminhos e motivo, e recusa ausencia sem motivo', () => {
  const p = projetoTemporario('prova-minima-ausente');
  try {
    const fast = novaThread(p.carregado, { nome: 'ajuste de texto', modo: 'fast' }).thread;
    assert.throws(() => registrarProvaAusente(p.dir, fast.id, { paths: ['docs/a.md'], motivo: '  ' }), /motivo e obrigatorio/);
    assert.throws(() => registrarProvaAusente(p.dir, fast.id, { paths: [], motivo: 'texto' }), /caminhos/);
    registrarProvaAusente(p.dir, fast.id, { paths: ['docs/a.md'], motivo: 'so texto, sem comando honesto', commit: 'abc1234' });
    const evento = lerLedger(dirThread(p.dir, fast.id)).find((e) => e.tipo === TIPOS_DE_EVENTO.provaAusente);
    assert.equal(TIPOS_DE_EVENTO.provaAusente, 'prova_ausente');
    assert.deepEqual(evento?.paths, ['docs/a.md']);
    assert.equal(evento?.motivo, 'so texto, sem comando honesto');
    assert.equal(evento?.commit, 'abc1234');
  } finally {
    p.limpar();
  }
});
