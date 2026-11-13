import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { orientacaoDaSessao } from '../src/sessoes';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

test('núcleo orienta sessão fora de thread sem bloquear e reconhece worktree vinculada', () => {
  const p = projetoTemporario('rm089-f6-sessao');
  try {
    const fora = orientacaoDaSessao(p.carregado, { runtime: 'codex', sessionId: 'sessao-nativa', cwd: p.dir });
    assert.deepEqual([fora.estado, fora.bloqueia, fora.threadId], ['fora-de-thread', false, null]);
    assert.deepEqual(fora.acoes.map((a) => a.id), ['thread.new', 'adotar']);
    assert.match(fora.texto ?? '', /fora de uma thread/);

    const thread = novaThread(p.carregado, { nome: 'vinculada', modo: 'auto', criarWorktree: true,
      origemDaWorktree: 'flag' }).thread;
    const vinculada = orientacaoDaSessao(p.carregado, { runtime: 'claude-code', sessionId: 'outra', cwd: thread.worktree! });
    assert.deepEqual([vinculada.estado, vinculada.threadId, vinculada.bloqueia], ['vinculada', thread.id, false]);
    assert.deepEqual(vinculada.acoes, []);
  } finally { p.limpar(); }
});

test('superfície sem identidade ou cwd comprovado permanece não confirmado', () => {
  const p = projetoTemporario('rm089-f6-sessao-nao-confirmada');
  try {
    const r = orientacaoDaSessao(p.carregado, { runtime: 'openclaw', sessionId: '', cwd: p.dir });
    assert.deepEqual([r.estado, r.bloqueia, r.acoes.length], ['nao-confirmado', false, 0]);
  } finally { p.limpar(); }
});

test('os quatro runtimes recebem a mesma decisão e as mesmas ações do núcleo', () => {
  const p = projetoTemporario('rm089-f6-sessao-quatro-runtimes');
  try {
    const respostas = (['claude-code', 'codex', 'hermes', 'openclaw'] as const).map((runtime) =>
      orientacaoDaSessao(p.carregado, { runtime, sessionId: `sessao-${runtime}`, cwd: p.dir }));
    for (const resposta of respostas) {
      assert.equal(resposta.contrato, 'ork.sessao-orientacao/v1');
      assert.equal(resposta.estado, 'fora-de-thread');
      assert.equal(resposta.bloqueia, false);
      assert.deepEqual(resposta.acoes.map((acao) => acao.id), ['thread.new', 'adotar']);
    }
    assert.equal(new Set(respostas.map((resposta) => resposta.texto)).size, 1);
  } finally { p.limpar(); }
});
