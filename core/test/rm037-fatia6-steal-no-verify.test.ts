/**
 * RM-037 (fatia 6): o `ork verify` mede o steal de `/proc/stat` durante a rodada, grava a medida no
 * `verify_run` e trata a reprovacao de teste com relogio sob steal acima de 40% como `verify.timeout`
 * (o retry reexecuta), nunca como regressao.
 *
 * Em 23 e 24/09/2026 a VPS perdeu de 67% a 92% da CPU para o hipervisor (sar), e a mesma suite levou de
 * 24 a 30 min em vez de 3,4 min. Antes desta fatia nenhum codigo de steal existia em `core/src`: o teste
 * que estourava o proprio prazo sob steal saia como `verify.regression` e abria GO-FIX contra codigo que
 * nao tinha mudado. As saidas abaixo sao as reais do `node --test` 24 (reporter `spec`, o padrao fora de
 * TTY, e `--test-reporter=tap`), capturadas em 03/10/2026; o `/proc/stat` e injetado com o steal da VPS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim, lerClaims } from '../src/claims';
import { lerLedger } from '../src/ledger';
import { falhasDeTeste, testesQueCairam } from '../src/redacao-saida';
import { amostraDoProcStat, LIMIAR_STEAL_PCT, stealDaJanela } from '../src/steal';
import { dirThread, novaThread } from '../src/thread';
import { gravarBaseline, textoDoVerify, verificar } from '../src/verify';
import { ajustarManifesto, projetoTemporario } from './apoio';

/** Reporter `spec` do node 24: um teste que estoura o proprio prazo e uma asercao que reprova. */
const SPEC_RELOGIO = [
  '▶ grupo', '  ✖ lento (50.87263ms)', '✖ grupo (52.593644ms)', 'ℹ tests 2', 'ℹ fail 1', '',
  '✖ failing tests:', '',
  'test at a.test.js:3:11', '✖ lento (50.87263ms)', "  'test timed out after 50ms'", '',
  'test at b.test.js:3:5', '✖ filho (50.915793ms)', "  'test did not finish before its parent and was cancelled'", '',
].join('\n');
const SPEC_ASSERCAO = [
  '✖ failing tests:', '',
  'test at a.test.js:4:11', '✖ afirma (0.838711ms)', '  AssertionError [ERR_ASSERTION]: 1 == 2',
  '      at TestContext.<anonymous> (a.test.js:4:39)', '',
].join('\n');
const TAP_MISTO = [
  'TAP version 13', '# Subtest: grupo', '    # Subtest: lento', '    not ok 1 - lento', '      ---',
  "      failureType: 'testTimeoutFailure'", "      error: 'test timed out after 50ms'", '      ...',
  '    # Subtest: afirma', '    not ok 2 - afirma', '      ---', "      failureType: 'testCodeFailure'", "      error: '1 == 2'",
  '      ...', '    1..2', 'not ok 1 - grupo', '  ---', "  failureType: 'subtestsFailed'", "  error: '2 subtests failed'", '  ...',
].join('\n');

/** `/proc/stat` cuja janela entre duas leituras tem `pct`% de steal (a VPS de 23/09 teve 67% a 92%). */
function procStatComSteal(pct: number): () => string {
  let n = 0;
  return () => {
    n++;
    const steal = n * pct;
    const idle = n * (100 - pct);
    return `cpu  1000 0 500 ${2_000_000 + idle} 0 0 0 ${steal} 0 0\ncpu0 1 0 1 1 0 0 0 0 0 0\n`;
  };
}

test('o steal da janela sai da linha agregada cpu: steal sobre a soma dos oito primeiros campos', () => {
  const real = 'cpu  8626523 3167709 4853577 2613999067 140705 0 90587 0 0 0\ncpu0 575711 200619 327094 162989489 9608 0 24884 0 0 0\n';
  assert.deepEqual(amostraDoProcStat(real), { steal: 0, total: 8626523 + 3167709 + 4853577 + 2613999067 + 140705 + 90587 });
  const a = amostraDoProcStat('cpu  100 0 100 700 0 0 0 100 50 0');
  const b = amostraDoProcStat('cpu  110 0 110 720 0 0 0 160 80 0');
  assert.equal(stealDaJanela(a, b), 60, 'guest ja esta em user: 60 de steal em 100 jiffies');
  assert.equal(stealDaJanela(a, a), null, 'janela vazia nao tem medida');
  assert.equal(amostraDoProcStat(null), null, 'sem /proc/stat nao ha medida');
  assert.equal(amostraDoProcStat('cpu  1 2 3 4 5 6 7'), null, 'kernel sem a coluna de steal nao tem medida');
  assert.equal(LIMIAR_STEAL_PCT, 40);
});

test('os testes que cairam, com a natureza da falha, no spec e no TAP do node 24', () => {
  assert.deepEqual(falhasDeTeste(SPEC_RELOGIO), [{ nome: 'lento', relogio: true }, { nome: 'filho', relogio: true }]);
  assert.deepEqual(falhasDeTeste(SPEC_ASSERCAO), [{ nome: 'afirma', relogio: false }]);
  assert.deepEqual(falhasDeTeste(TAP_MISTO), [{ nome: 'lento', relogio: true }, { nome: 'afirma', relogio: false }],
    'o agregado subtestsFailed nao e falha por si');
  // Antes da fatia 6, o reporter spec (padrao do node 24 fora de TTY) nao dava nome nenhum ao ledger.
  assert.deepEqual(testesQueCairam(SPEC_RELOGIO), ['lento', 'filho']);
});

/** Projeto com o `test` do manifesto passando enquanto `passa.flag` existir, e falhando com `saida.txt`. */
function projetoComTeste(nome: string, saida: string) {
  const p = projetoTemporario(nome);
  ajustarManifesto(p, '  # test: nao detectado', '  test: "test -f passa.flag || { cat saida.txt; exit 1; }"');
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const cwd = t.worktree ?? p.dir;
  fs.writeFileSync(path.join(cwd, 'saida.txt'), saida, 'utf8');
  fs.writeFileSync(path.join(cwd, 'passa.flag'), '', 'utf8');
  gravarBaseline(p.carregado, t.id);
  fs.rmSync(path.join(cwd, 'passa.flag'));
  return { p, t, cwd };
}

function ultimoVerifyRun(dir: string, thread: string): Record<string, unknown> {
  return lerLedger(dirThread(dir, thread)).filter((e) => e.tipo === 'verify_run').at(-1) as Record<string, unknown>;
}

test('teste com relogio reprovado sob steal de 70% vira verify.timeout, nunca regressao, e a medida vai ao verify_run', () => {
  const { p, t } = projetoComTeste('steal-relogio', SPEC_RELOGIO);
  try {
    const r = verificar(p.carregado, t.id, { lerProcStat: procStatComSteal(70) });
    assert.deepEqual(r.regressoes, [], 'a maquina, e nao o codigo, decidiu o resultado');
    assert.deepEqual(r.estouros.map((c) => c.nome), ['test']);
    assert.deepEqual(r.motivos, ['verify.timeout']);
    assert.deepEqual(r.estouros[0].relogioSobSteal, ['lento', 'filho']);
    assert.equal(r.estouros[0].causa, 'exit', 'a causa gravada continua a real');

    const evento = ultimoVerifyRun(p.dir, t.id);
    const steal = evento.steal as Record<string, unknown>;
    assert.equal(steal.fonte, '/proc/stat');
    assert.equal(steal.medido, true);
    assert.equal(steal.rodadaPct, 70);
    assert.equal(steal.limiarPct, 40);
    assert.equal((steal.porComando as Record<string, number>).test, 70);
    assert.deepEqual(steal.relogioSobSteal, ['test']);
    const comando = (evento.comandos as Record<string, unknown>[])[0];
    assert.equal(comando.stealPct, 70);
    assert.deepEqual(comando.relogioSobSteal, ['lento', 'filho']);
    assert.deepEqual(evento.regressoes, []);
    assert.equal(evento.veredito, 'reprovado', 'sem veredito nao e verdade sustentada: o retry reexecuta');
    assert.match(textoDoVerify(r), /steal\s+70% na rodada/);
    assert.match(textoDoVerify(r), /RELOGIO SOB STEAL \(70% de steal/);
  } finally {
    p.limpar();
  }
});

test('o limiar e estrito, e o steal baixo deixa a mesma reprovacao como regressao', () => {
  for (const pct of [30, 40]) {
    const { p, t } = projetoComTeste(`steal-baixo-${pct}`, SPEC_RELOGIO);
    try {
      const r = verificar(p.carregado, t.id, { lerProcStat: procStatComSteal(pct) });
      assert.deepEqual(r.regressoes.map((c) => c.nome), ['test'], `steal de ${pct}%`);
      assert.ok(r.motivos.includes('verify.regression'));
      assert.equal(((ultimoVerifyRun(p.dir, t.id).steal as Record<string, unknown>).porComando as Record<string, number>).test, pct);
    } finally {
      p.limpar();
    }
  }
});

test('asercao que reprova sob steal alto continua regressao: o steal so desculpa o relogio', () => {
  const { p, t } = projetoComTeste('steal-assercao', SPEC_ASSERCAO);
  try {
    const r = verificar(p.carregado, t.id, { lerProcStat: procStatComSteal(90) });
    assert.deepEqual(r.regressoes.map((c) => c.nome), ['test']);
    assert.ok(!r.motivos.includes('verify.timeout'));
  } finally {
    p.limpar();
  }
  const misto = projetoComTeste('steal-misto', TAP_MISTO);
  try {
    const r = verificar(misto.p.carregado, misto.t.id, { lerProcStat: procStatComSteal(90) });
    assert.deepEqual(r.regressoes.map((c) => c.nome), ['test'], 'um teste de relogio e uma asercao: regressao');
  } finally {
    misto.p.limpar();
  }
});

test('sem /proc/stat nao ha medida e nada e atenuado', () => {
  const { p, t } = projetoComTeste('steal-sem-proc', SPEC_RELOGIO);
  try {
    const r = verificar(p.carregado, t.id, { lerProcStat: () => null });
    assert.deepEqual(r.regressoes.map((c) => c.nome), ['test']);
    const steal = ultimoVerifyRun(p.dir, t.id).steal as Record<string, unknown>;
    assert.deepEqual([steal.medido, steal.rodadaPct], [false, null]);
    assert.match(textoDoVerify(r), /steal\s+nao medido/);
  } finally {
    p.limpar();
  }
});

test('claim que reprova so no relogio sob steal sai verify.timeout e nao e carimbada reprovada', () => {
  const p = projetoTemporario('steal-claim');
  try {
    const t = novaThread(p.carregado, { nome: 'steal-claim', modo: 'auto' }).thread;
    const cwd = t.worktree ?? p.dir;
    fs.writeFileSync(path.join(cwd, 'saida.txt'), SPEC_RELOGIO, 'utf8');
    const c = adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'o teste de relogio passa',
      verificar: ['cat saida.txt; exit 1'] });
    const r = verificar(p.carregado, t.id, { soClaims: true, lerProcStat: procStatComSteal(80) });
    const resultado = r.claims.find((x) => x.claim.id === c.id)!;
    assert.equal(resultado.motivo, 'verify.timeout');
    assert.match(resultado.detalhe, /relogio sob steal de 80% \(acima de 40%\): lento, filho/);
    assert.notEqual(lerClaims(p.dir, t.id).find((x) => x.id === c.id)?.estado, 'reprovado');
    const claimNoLedger = (ultimoVerifyRun(p.dir, t.id).claims as Record<string, Record<string, unknown>>[])[0];
    assert.equal(claimNoLedger.execucao.stealPct, 80);

    const baixo = verificar(p.carregado, t.id, { soClaims: true, lerProcStat: procStatComSteal(10) });
    assert.equal(baixo.claims[0].motivo, 'claims.failed', 'sem steal alto a mesma saida reprova a alegacao');
  } finally {
    p.limpar();
  }
});
