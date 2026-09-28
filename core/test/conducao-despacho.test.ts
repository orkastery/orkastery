/**
 * I-36 (RM-036, P2 a P4): o despacho de fase sob a conducao da thread.
 *
 * O `ork phase run` toma o lease de execucao, e ele passa a ser da SESSAO despachada: o lock HITL
 * cobre so o ato de despachar, e em 19/09/2026 as duas sessoes rodaram juntas depois dele. A mesma
 * fase com o mesmo prompt devolve a sessao em andamento sem chamar o adapter; outro pedido recebe
 * a recusa tipada, com os cinco campos de quem conduz e as tres acoes.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { conducaoDaThread, nomeDaConducao } from '../src/conducao';
import { lerLease } from '../src/leases';
import { lerLedger, registrar } from '../src/ledger';
import { configuracaoServidorMcp } from '../src/mcp-install';
import { rodarFase } from '../src/phase';
import { canalDaSessao, dirThread, lerThread, novaThread } from '../src/thread';
import { SessaoDaThread } from '../src/types';
import { projetoTemporario, runtimeFalso } from './apoio';

test('o despacho grava canal e correlacao, e a conducao passa a ser da sessao (T7, T10, CS6)', (t) => {
  const p = projetoTemporario('conducao-despacho');
  const runtime = runtimeFalso('conducao-despacho');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'despacho', modo: 'auto' });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente a fatia 1', canal: 'hermes', correlacao: 'telegram:7049:123' });
  assert.equal(r.sessionId, runtime.sessionId);
  const despacho = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'phase_dispatch')!;
  assert.equal(despacho.canal, 'hermes');
  assert.equal(despacho.correlacao, 'telegram:7049:123');
  const sessao = lerThread(p.dir, thread.id).sessoes[0];
  assert.equal(sessao.canal, 'hermes');
  assert.equal(canalDaSessao(sessao), 'hermes');
  const c = conducaoDaThread(p.dir, thread.id)!;
  assert.equal(c.sessao, runtime.sessionId);
  assert.equal(c.canal, 'hermes');
  assert.equal(c.fase, 'GO');
  assert.equal(c.promptSha256, r.promptSha256);
  assert.equal(c.dono.tipo, 'sessao');
  assert.equal(lerLease(p.dir, nomeDaConducao(thread.id))!.conducao!.identidade, (despacho.identidade as { dispatchId: string }).dispatchId,
    'o lease e o despacho carregam a mesma identidade');
});

test('mesma fase e mesmo prompt nao abrem sessao nova nem gastam cota (T14, CS4)', (t) => {
  const p = projetoTemporario('conducao-idempotente');
  const runtime = runtimeFalso('conducao-idempotente');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'idempotente', modo: 'auto' });
  const primeiro = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'claude-code' });
  const repetido = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  assert.equal(repetido.idempotente, true);
  assert.equal(repetido.sessionId, primeiro.sessionId);
  assert.equal(repetido.bloqueado, false);
  assert.equal(runtime.chamadas().length, 1, 'uma chamada de despacho para dois pedidos iguais');
  const eventos = lerLedger(dirThread(p.dir, thread.id));
  assert.equal(eventos.filter((e) => e.tipo === 'phase_dispatch').length, 1);
  assert.equal(eventos.filter((e) => e.tipo === 'despacho_idempotente').length, 1);
});

test('outro pedido recebe conducao.em-andamento com os cinco campos e as tres acoes; o ensaio diz o mesmo (T12, CS3)', (t) => {
  const p = projetoTemporario('conducao-recusa');
  const runtime = runtimeFalso('conducao-recusa');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'recusa', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  const segundo = rodarFase(p.carregado, thread.id, { fase: 'CHECK', prompt: 'verifique', canal: 'claude-code' });
  assert.equal(segundo.bloqueado, true);
  assert.equal(segundo.motivo, 'conducao.em-andamento');
  const recusa = segundo.recusa!;
  for (const campo of ['canal', 'sessao', 'fase', 'desde', 'promptSha256'] as const) assert.ok(recusa.conducao?.[campo], `falta ${campo}`);
  assert.equal(recusa.conducao?.canal, 'hermes');
  assert.equal(recusa.conducao?.fase, 'GO');
  assert.deepEqual(recusa.acoes.map((a) => a.acao), ['esperar', 'acompanhar', 'assumir']);
  for (const a of recusa.acoes) assert.ok(a.comando.includes(thread.id), a.comando);
  assert.match(recusa.acoes[0].comando, /ork phase run .* CHECK .*--esperar 30/);
  assert.match(recusa.texto, /Quem conduz: canal hermes, sessao 11111111, fase GO, desde /);
  assert.equal(runtime.chamadas().length, 1, 'o segundo pedido nao chegou ao runtime');
  const ensaio = rodarFase(p.carregado, thread.id, { fase: 'CHECK', prompt: 'verifique', canal: 'claude-code', dryRun: true });
  assert.equal(ensaio.motivo, 'conducao.em-andamento');
  assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'conducao_recusada').length, 1,
    'o ensaio nao grava nada');
});

test('fim da sessao libera a conducao: pela prova da I-34 no ledger ou pelo runtime (T7, D7)', (t) => {
  const p = projetoTemporario('conducao-fim');
  const runtime = runtimeFalso('conducao-fim');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'fim', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  // O observador grava o resultado da fase: a sessao acabou, a conducao sai da leitura.
  registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'GO', sessionId: runtime.sessionId, classificacao: 'fase_concluida',
    estado: 'concluida', ok: true });
  assert.equal(conducaoDaThread(p.dir, thread.id), null);
  const check = rodarFase(p.carregado, thread.id, { fase: 'CHECK', prompt: 'verifique', canal: 'claude-code' });
  assert.equal(check.bloqueado, false);
  const liberada = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'conducao_liberada')!;
  assert.equal(liberada.motivo, 'sessao-encerrada');
  assert.match(String(liberada.prova), /ledger: phase_result/);
  // Sem resultado no ledger, o runtime dizendo que a sessao terminou tambem prova.
  runtime.estadoDaSessao('done');
  const ship = rodarFase(p.carregado, thread.id, { fase: 'SHIP', prompt: 'entregue', canal: 'cli' });
  assert.equal(ship.bloqueado, false);
  const orfa = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'conducao_orfa_liberada')!;
  assert.match(String(orfa.prova), /runtime claude-bg: estado done/);
  assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'phase_result').length, 1,
    'liberar a conducao nunca grava resultado de fase');
});

test('sessao antiga sem canal le como desconhecido, e o MCP da sessao filha leva a identidade do despacho (T10, D4)', () => {
  const antiga = { slug: 'ork-x-go', fase: 'GO', bloco: 'GO', sessionId: 'abc', runtime: 'claude-bg', verificada: true,
    despachadaEm: '2026-09-19T22:41:58.000Z', promptPath: 'p.md', promptSha256: 'a'.repeat(64) } as SessaoDaThread;
  assert.equal(canalDaSessao(antiga), 'desconhecido', 'inventar `cli` no historico seria falsificar o ledger');
  const id = '11111111-2222-4333-8444-555555555555';
  const servidor = configuracaoServidorMcp('/projeto', 'claude-code', 'ork-x', 'github-ssh', 'worktree', id);
  assert.deepEqual(servidor.args.slice(-4), ['--thread', 'ork-x', '--dispatch', id]);
  assert.throws(() => configuracaoServidorMcp('/projeto', 'claude-code', undefined, 'github-ssh', 'interactive', id), /mcp\.install\.dispatch\.invalid/);
});

test('sessao blocked esperando alguem nao executa: o despacho seguinte da mesma fase a sucede; o resto espera', (t) => {
  const p = projetoTemporario('conducao-sucessora');
  const runtime = runtimeFalso('conducao-sucessora');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'sucessora', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  runtime.estadoDaSessao('blocked');
  const outraFase = rodarFase(p.carregado, thread.id, { fase: 'CHECK', prompt: 'verifique', canal: 'cli' });
  assert.equal(outraFase.motivo, 'conducao.em-andamento', 'fase diferente continua esperando a sessao bloqueada');
  const sucessora = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'retome daqui', canal: 'cli' });
  assert.equal(sucessora.bloqueado, false, sucessora.erro);
  const liberada = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'conducao_liberada')!;
  assert.equal(liberada.motivo, 'sessao-bloqueada-sucedida');
  assert.match(String(liberada.prova), /estado blocked/);
  assert.equal(conducaoDaThread(p.dir, thread.id)?.canal, 'cli', 'a conducao agora e da sucessora');
});
