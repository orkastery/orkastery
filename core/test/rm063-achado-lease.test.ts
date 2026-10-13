/**
 * RM-063 (fatia 3, achado c): o lease de conducao ficou preso depois que a sessao terminou no runtime, e o condutor
 * precisou do `ork conducao assumir` (a K7 em 12/10 16:57, esta thread em 13/10 00:59). O observador tinha visto o
 * `done` (sem Stop correlacionado), e a consulta da conta do processo nao lista a sessao de outro perfil. Agora o
 * `done` visto pelo observador e a ausencia na conta do perfil da sessao provam o fim, e o lease cai.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimePorConta } from './apoio';
import { conducaoDaThread, registrarConducaoDaSessao, tomarConducao } from '../src/conducao';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';

const SESSAO = 'a117ccf5-56a6-4d62-815f-4ac0d302f311';

function threadConduzidaPelaSessao(nome: string, perfil: string | null) {
  const p = projetoTemporario(nome);
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  assert.equal(registrarConducaoDaSessao(p.dir, thread.id, { canal: 'claude-code', operacao: 'phase.run', fase: 'GO',
    promptSha256: 'c9844faa'.padEnd(64, '0'), prazoMs: 12 * 3600_000 }, { sessionId: SESSAO, runtime: 'claude-bg', perfil }), true);
  return { p, thread, dir: dirThread(p.dir, thread.id) };
}

/** O que o observador gravou em 12/10 19:31: `done` sem Stop correlacionado, conclusao nao inferida. */
function observadorViuDone(dir: string, thread: string): void {
  registrar(dir, thread, 'session_watcher_error', { fase: 'GO', sessionId: SESSAO, motivo: 'runtime.unavailable',
    erro: 'terminal nativo done sem Stop correlacionado além do limite de estabilidade; conclusão não inferida',
    origem: 'sessions.watch', runtime: 'claude-bg', estadoNativo: 'done' });
}

/** A consulta da conta do processo, que nao lista a sessao do perfil: ausente, mas sem prova. */
const ausenteNaContaErrada = () => ({ ok: true, estado: null, detalhe: 'sessao ausente' });

test('achado c: o done visto pelo observador solta o lease da sessao do perfil; o despacho seguinte nao precisa do assumir', () => {
  const { p, thread, dir } = threadConduzidaPelaSessao('rm063-f3-lease-done', 'claude-b');
  try {
    // Antes do done, a sessao conduz: a mesma consulta (ausente na conta do processo) nao prova nada.
    assert.notEqual(conducaoDaThread(p.dir, thread.id), null);
    const antes = tomarConducao(p.dir, thread.id, { canal: 'claude-code', operacao: 'phase.run', fase: 'GO',
      promptSha256: 'e62c774f'.padEnd(64, '0'), prazoMs: 60_000, consultarSessao: ausenteNaContaErrada });
    assert.equal(antes.ok, false, 'sem prova de fim, a conducao segue com a sessao');

    observadorViuDone(dir, thread.id);
    assert.equal(conducaoDaThread(p.dir, thread.id), null, 'a leitura unica ja nao ve conducao');
    const depois = tomarConducao(p.dir, thread.id, { canal: 'claude-code', operacao: 'phase.run', fase: 'GO',
      promptSha256: 'e62c774f'.padEnd(64, '0'), prazoMs: 60_000, consultarSessao: ausenteNaContaErrada });
    assert.equal(depois.ok, true, 'o despacho da fatia seguinte foi recusado com a sessao ja terminada');
    if (depois.ok) depois.liberar();
    const liberada = lerLedger(dir).filter((e) => e.tipo === TIPOS_DE_EVENTO.conducaoLiberada).at(-1);
    assert.match(String(liberada?.prova), /^ledger: session_watcher_error/);
  } finally { p.limpar(); }
});

test('achado c: a sessao que voltou a trabalhar depois do done continua conduzindo', () => {
  const { p, thread, dir } = threadConduzidaPelaSessao('rm063-f3-lease-retomada', 'claude-b');
  try {
    observadorViuDone(dir, thread.id);
    // Alguem retomou a sessao: o Stop de um turno novo dela vem depois do done.
    registrar(dir, thread.id, 'runtime_stop', { fase: 'GO', sessionId: SESSAO });
    assert.notEqual(conducaoDaThread(p.dir, thread.id), null);
    // A contabilidade do proprio ork depois do done nao e trabalho da sessao.
    const { p: q, thread: t2, dir: d2 } = threadConduzidaPelaSessao('rm063-f3-lease-contabilidade', 'claude-b');
    try {
      observadorViuDone(d2, t2.id);
      registrar(d2, t2.id, 'retry_attempt', { fase: 'GO', sessionId: SESSAO, motivo: 'runtime.unavailable' });
      assert.equal(conducaoDaThread(q.dir, t2.id), null);
    } finally { q.limpar(); }
  } finally { p.limpar(); }
});

test('achado c: a sessao ausente da conta do perfil dela prova o fim; viva la, segue conduzindo', (t) => {
  const { p, thread } = threadConduzidaPelaSessao('rm063-f3-lease-conta', 'perfil-b');
  const rt = runtimePorConta('rm063-f3-lease-conta');
  t.after(() => { rt.restaurar(); p.limpar(); });
  const conta = rt.conta(p.dir, 'perfil-b');
  // A sessao viva na conta do perfil: a consulta na conta dela a acha trabalhando.
  fs.writeFileSync(path.join(rt.dir, 'sessao'), SESSAO);
  fs.writeFileSync(path.join(rt.dir, 'conta'), conta);
  fs.writeFileSync(path.join(rt.dir, 'cwd'), p.dir);
  const pedido = { canal: 'claude-code' as const, operacao: 'phase.run' as const, fase: 'GO' as const,
    promptSha256: 'e62c774f'.padEnd(64, '0'), prazoMs: 60_000 };
  const viva = tomarConducao(p.dir, thread.id, pedido);
  assert.equal(viva.ok, false, 'a sessao viva na conta do perfil perdeu a conducao');
  assert.ok(rt.envs().includes(`agents ${conta}`), `a consulta nao foi na conta do perfil: ${rt.envs().join(' | ')}`);
  // Encerrada e limpa do runtime: ausente da conta dela.
  fs.rmSync(path.join(rt.dir, 'conta'));
  const livre = tomarConducao(p.dir, thread.id, pedido);
  assert.equal(livre.ok, true, 'a sessao ausente da conta dela continuou segurando o lease');
  if (livre.ok) livre.liberar();
  const orfa = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.conducaoOrfaLiberada).at(-1);
  assert.match(String(orfa?.prova), /sessao ausente da conta do perfil perfil-b/);
});

test('achado c: sem o perfil no store, a ausencia na conta do processo continua sem provar nada', (t) => {
  const { p, thread } = threadConduzidaPelaSessao('rm063-f3-lease-sem-perfil', 'perfil-sumido');
  const rt = runtimePorConta('rm063-f3-lease-sem-perfil');
  t.after(() => { rt.restaurar(); p.limpar(); });
  const r = tomarConducao(p.dir, thread.id, { canal: 'claude-code', operacao: 'phase.run', fase: 'GO',
    promptSha256: 'e62c774f'.padEnd(64, '0'), prazoMs: 60_000 });
  assert.equal(r.ok, false);
});
