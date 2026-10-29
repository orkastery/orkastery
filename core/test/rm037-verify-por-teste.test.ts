/**
 * RM-037 (29/10/2026): uma regressao nova nao pode se esconder num comando que ja falhava.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lerLedger } from '../src/ledger';
import { comLocale } from '../src/locale';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { ResultadoDeComando } from '../src/types';
import { ExecutorVerify, gravarBaseline, textoDoVerify, verificar } from '../src/verify';
import { projetoTemporario } from './apoio';

function resultado(nome: string, comando: string, nomes: string[] | undefined, ok = false): ResultadoDeComando {
  return {
    nome,
    comando,
    ok,
    code: ok ? 0 : 1,
    resumo: ok ? '' : 'falha simulada',
    causa: 'exit',
    executado: true,
    ...(nomes?.length ? { testeQueCaiu: nomes, falhasDeTeste: nomes.map((teste) => ({ nome: teste, relogio: false })) } : {}),
  };
}

function executor(nomes: string[] | undefined, ok = false): ExecutorVerify {
  return (nome, comando) => resultado(nome, comando, nomes, ok);
}

test('classificação por teste: falha nova bloqueia e cita o nome sem esconder a dívida do mesmo comando', () => {
  const p = projetoTemporario('rm037-verify-nominal');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'verify nominal', modo: 'auto' });
    p.carregado.manifesto.verify = { test: 'teste-simulado' };

    const baseline = gravarBaseline(p.carregado, thread.id, executor(['A: já falhava']));
    assert.deepEqual(baseline.comandos[0].testeQueCaiu, ['A: já falhava']);
    assert.deepEqual(lerThread(p.dir, thread.id).baseline?.comandos[0].testeQueCaiu, ['A: já falhava']);
    const baselineNoLedger = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'baseline_recorded')!;
    const comandoDaBaseline = (baselineNoLedger.comandos as Array<Record<string, unknown>>)[0];
    assert.deepEqual(comandoDaBaseline.testeQueCaiu, ['A: já falhava']);

    const r = verificar(p.carregado, thread.id, { executor: executor(['A: já falhava', 'B: regressão nova']) });
    assert.equal(r.ok, false);
    assert.ok(r.motivos.includes('verify.regression'));
    assert.deepEqual(r.regressoes.map((c) => c.nome), ['test']);
    assert.deepEqual(r.preExistentes.map((c) => c.nome), ['test']);
    assert.deepEqual(r.comparacoes, [{
      comando: 'test', granularidade: 'teste', regressoes: ['B: regressão nova'],
      preExistentes: ['A: já falhava'], corrigidos: [],
    }]);
    assert.match(textoDoVerify(r), /Comparacao teste a teste \(test\): 1 regressao\(oes\), 1 pre-existente\(s\), 0 corrigido\(s\)/);

    const eventos = lerLedger(dirThread(p.dir, thread.id));
    const gate = eventos.filter((e) => e.tipo === 'gate_blocked' && e.motivo === 'verify.regression').at(-1)!;
    assert.match(String(gate.detalhe), /test: B: regressão nova/);
    const rodada = eventos.filter((e) => e.tipo === 'verify_run').at(-1)!;
    assert.deepEqual(rodada.comparacoes, r.comparacoes, 'o diagnostico nominal fica registrado na rodada');
  } finally { p.limpar(); }
});

test('corrigido, instável e renomeado são diferenças exatas dos nomes da baseline', () => {
  const p = projetoTemporario('rm037-verify-diferencas');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'diferencas nominais', modo: 'auto' });
    p.carregado.manifesto.verify = { test: 'teste-simulado' };
    gravarBaseline(p.carregado, thread.id, executor(['A: nome original']));

    const corrigido = verificar(p.carregado, thread.id, { executor: executor(undefined, true) });
    assert.deepEqual(corrigido.comparacoes[0], {
      comando: 'test', granularidade: 'teste', regressoes: [], preExistentes: [], corrigidos: ['A: nome original'],
    });
    assert.match(textoDoVerify(corrigido), /corrigido      A: nome original/);
    assert.equal(corrigido.ok, true);

    const instavel = verificar(p.carregado, thread.id, { executor: executor(['A: nome original']) });
    assert.deepEqual(instavel.comparacoes[0], {
      comando: 'test', granularidade: 'teste', regressoes: [],
      preExistentes: ['A: nome original'], corrigidos: [],
    });
    assert.equal(instavel.ok, true, 'o mesmo teste que cai nos dois lados continua pre-existente');

    const renomeado = verificar(p.carregado, thread.id, { executor: executor(['B: nome novo']) });
    assert.deepEqual(renomeado.comparacoes[0], {
      comando: 'test', granularidade: 'teste', regressoes: ['B: nome novo'],
      preExistentes: [], corrigidos: ['A: nome original'],
    });
    assert.equal(renomeado.ok, false, 'renomear nao mascara a falha nova');
  } finally { p.limpar(); }
});

test('fallback por comando: baseline sem nomes preserva a regra legada e marca a granularidade', () => {
  const p = projetoTemporario('rm037-verify-fallback');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'fallback sem nomes', modo: 'auto' });
    p.carregado.manifesto.verify = { test: 'teste-simulado' };
    gravarBaseline(p.carregado, thread.id, executor(undefined));

    const r = verificar(p.carregado, thread.id, { executor: executor(['B: atual']) });
    assert.equal(r.ok, true, 'a compatibilidade pedida conserva a classificacao legada por comando');
    assert.deepEqual(r.regressoes, []);
    assert.deepEqual(r.preExistentes.map((c) => c.nome), ['test']);
    assert.deepEqual(r.comparacoes, [{
      comando: 'test', granularidade: 'comando', regressoes: [], preExistentes: [], corrigidos: [],
      classificacaoDoComando: 'pre-existente', motivoDoFallback: 'baseline-sem-nomes',
    }]);
    const pt = textoDoVerify(r);
    assert.match(pt, /Comparacao somente por comando \(test\): pre-existente; a baseline nao guardou nomes de testes/);
    assert.doesNotMatch(pt, /0 regressao/);
    const en = comLocale('en', () => textoDoVerify(r));
    assert.match(en, /Command-only comparison \(test\): pre-existing; the baseline did not store test names/);
    assert.doesNotMatch(en, /0 regression/);
  } finally { p.limpar(); }
});

test('baseline verde é conjunto vazio comprovado e os nomes atuais viram regressões', () => {
  const p = projetoTemporario('rm037-verify-base-verde');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'base verde', modo: 'auto' });
    p.carregado.manifesto.verify = { test: 'teste-simulado' };
    gravarBaseline(p.carregado, thread.id, executor(undefined, true));

    const r = verificar(p.carregado, thread.id, { executor: executor(['B: caiu agora']) });
    assert.deepEqual(r.comparacoes[0], {
      comando: 'test', granularidade: 'teste', regressoes: ['B: caiu agora'], preExistentes: [], corrigidos: [],
    });
    assert.ok(r.motivos.includes('verify.regression'));
  } finally { p.limpar(); }
});
