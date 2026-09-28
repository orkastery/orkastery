/**
 * O MODELO como fato verificavel do despacho.
 *
 * O `ork` sempre soube qual modelo mandou para o runtime adapter, mas o ledger nao
 * guardava. Isso deixava "essa fase rodou em opus" como self-report do agente, que e
 * exatamente a categoria de alegacao que o produto recusa em todo o resto. Estes testes
 * provam o caminho REAL: o par modelo/esforco resolvido uma vez, despachado, e carimbado
 * no evento do ledger que `ork phase list` le de volta.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { lerLedger } from '../src/ledger';
import { resolverDespacho, rodarFase, tabelaDoLedger } from '../src/phase';
import { dirThread, novaThread } from '../src/thread';
import { ajustarManifesto, projetoTemporario, runtimeFalso } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');

test('a regra do esforco: so o modelo assume high, o esforco informado manda', () => {
  const p = projetoTemporario('despacho-regra');
  const manifesto = p.carregado.manifesto;

  // Sem nada no pedido, vale o manifesto inteiro (runtime incluso: o trio e o fato).
  assert.deepEqual(resolverDespacho(manifesto, {}), {
    runtime: 'claude-bg',
    model: 'opus',
    effort: 'high',
  });

  // O manifesto com esforco proprio continua mandando quando o pedido nao fala nada.
  ajustarManifesto(p, /^  effort: high$/m, '  effort: medium');
  const outro = p.carregado.manifesto;
  assert.deepEqual(resolverDespacho(outro, {}), {
    runtime: 'claude-bg',
    model: 'opus',
    effort: 'medium',
  });

  // Pedido com SO o modelo: o esforco assume `high` em vez de herdar `medium`.
  assert.deepEqual(resolverDespacho(outro, { model: 'fable' }), {
    runtime: 'claude-bg',
    model: 'fable',
    effort: 'high',
  });

  // Pedido com esforco explicito: o parametro manda, com ou sem modelo junto.
  assert.deepEqual(resolverDespacho(outro, { effort: 'eco' }), {
    runtime: 'claude-bg',
    model: 'opus',
    effort: 'eco',
  });
  assert.deepEqual(resolverDespacho(outro, { model: 'fable', effort: 'eco' }), {
    runtime: 'claude-bg',
    model: 'fable',
    effort: 'eco',
  });

  p.limpar();
});

test('o padrao de despacho do manifesto novo e opus/high', () => {
  const p = projetoTemporario('despacho-padrao');
  assert.equal(p.carregado.manifesto.runtime.model, 'opus');
  assert.equal(p.carregado.manifesto.runtime.effort, 'high');
  p.limpar();
});

test('o despacho carimba modelo e esforco no ledger, e `phase list` le de volta', (t) => {
  const p = projetoTemporario('despacho-ledger');
  const runtime = runtimeFalso('despacho-ledger');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'modelo no ledger', modo: 'auto' });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente a fatia 1' });

  assert.equal(r.sessionId, runtime.sessionId);
  assert.equal(r.model, 'opus', 'o padrao do manifesto foi o modelo efetivo');
  assert.equal(r.effort, 'high');

  const eventos = lerLedger(dirThread(p.dir, thread.id));
  const despacho = eventos.find((e) => e.tipo === 'phase_dispatch');
  assert.ok(despacho, 'o despacho ficou no ledger');
  assert.equal(despacho.model, 'opus', 'o modelo e FATO no evento, nao relato do agente');
  assert.equal(despacho.effort, 'high');

  // O mesmo par aparece no comando que foi montado: ledger e runtime nao divergem.
  assert.ok(r.comando.includes('opus'), `o comando despachado nao cita o modelo: ${r.comando.join(' ')}`);

  const tabela = tabelaDoLedger(p.dir, thread.id);
  assert.ok(tabela.includes('modelo opus/high'), `phase list nao mostra o modelo:\n${tabela}`);

  // I-36: o CHECK so sai depois que a sessao do GO termina; duas conducoes na mesma worktree sao recusadas.
  runtime.estadoDaSessao('done');
  // Um segundo despacho com --model e sem --effort: o esforco assume high pela regra.
  const forcado = rodarFase(p.carregado, thread.id, {
    fase: 'CHECK',
    prompt: 'verifique a fatia 1',
    model: 'fable',
  });
  assert.equal(forcado.model, 'fable');
  assert.equal(forcado.effort, 'high');
  const doCheck = lerLedger(dirThread(p.dir, thread.id)).filter(
    (e) => e.tipo === 'phase_dispatch' && e.fase === 'CHECK'
  );
  assert.equal(doCheck.length, 1);
  assert.equal(doCheck[0].model, 'fable');
  assert.equal(doCheck[0].effort, 'high');
});

test('o despacho que FALHA tambem carimba o modelo no ledger', (t) => {
  const p = projetoTemporario('despacho-falha');
  const runtime = runtimeFalso('despacho-falha');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'falha com modelo', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit('Claude AI usage limit reached|1757012400\n');

  const r = rodarFase(p.carregado, thread.id, {
    fase: 'GO',
    prompt: 'implemente a fatia 1',
    effort: 'eco',
  });
  assert.equal(r.sessionId, null);
  assert.equal(r.model, 'opus');
  assert.equal(r.effort, 'eco', 'o esforco informado manda mesmo no despacho que morreu');

  const falha = lerLedger(dirThread(p.dir, thread.id)).find(
    (e) => e.tipo === 'phase_dispatch_failed'
  );
  assert.ok(falha);
  assert.equal(falha.model, 'opus');
  assert.equal(falha.effort, 'eco');
});

test('o ensaio devolve o par resolvido e continua sem tocar no ledger', () => {
  const p = projetoTemporario('despacho-ensaio');
  const { thread } = novaThread(p.carregado, { nome: 'ensaio de modelo', modo: 'auto' });

  const r = rodarFase(p.carregado, thread.id, {
    fase: 'GOAL',
    prompt: 'mapear o objetivo',
    model: 'fable',
    dryRun: true,
  });
  assert.equal(r.dryRun, true);
  assert.equal(r.model, 'fable');
  assert.equal(r.effort, 'high');

  // A garantia do B0 continua de pe: `--dry-run` nao escreve evento nenhum.
  assert.deepEqual(
    lerLedger(dirThread(p.dir, thread.id)).map((e) => e.tipo),
    ['thread_created']
  );

  const saida = execFileSync(
    process.execPath,
    [ORK, 'phase', 'run', thread.id, 'GOAL', '--prompt', 'mapear o objetivo', '--model', 'fable', '--dry-run'],
    { cwd: p.dir, encoding: 'utf8' }
  );
  assert.ok(saida.includes('modelo/esforco : fable/high'), saida);

  p.limpar();
});
