/**
 * RM-056 (C1, C2, D1): o perfil PEDIDO no despacho. `--perfil` vale no CLI, no MCP e na
 * extensao OpenClaw pelo mesmo caminho do nucleo; inexistente, de outro runtime, esgotado ou sem
 * login recusa antes de abrir sessao, com motivo tipado, e nunca troca de perfil sozinho.
 */
import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimePorConta } from './apoio';
import { lerLedger } from '../src/ledger';
import { perfilPedido, rodarFase } from '../src/phase';
import { POLITICA_DE_RETRY, executarRetry, retomarPorId } from '../src/retry';
import { adicionarPerfil, lerPerfis, marcarFalhaDePerfil } from '../src/runtime-profiles';
import { RUNTIMES } from '../src/runtimes';
import { dirThread, novaThread } from '../src/thread';
import { msg } from '../src/locale';

const PROMPT = 'RM-056: despacho pelo perfil pedido';

test('C1: --perfil despacha pela conta pedida, mesmo com outra antes na ordem do store', () => {
  const p = projetoTemporario('rm056-pedido');
  const claude = runtimePorConta('rm056-pedido');
  try {
    claude.conta(p.dir, 'a');
    const contaB = claude.conta(p.dir, 'b');
    const t = novaThread(p.carregado, { nome: 'pedido', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg', perfil: 'b' });
    assert.equal(r.bloqueado, false, r.erro);
    const despacho = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.deepEqual(despacho?.perfil, { id: 'b', runtime: 'claude-bg', configDir: contaB });
    assert.ok(claude.envs().includes(`--bg ${contaB}`), 'o filho nasceu com o CLAUDE_CONFIG_DIR do perfil b');
    assert.equal(lerPerfis(p.dir).perfis.find(q => q.id === 'a')?.ultimoUso, null, 'o perfil a ficou intocado');
  } finally { claude.restaurar(); p.limpar(); }
});

test('C1: perfil inexistente ou de outro runtime recusa com runtime.profile-invalid, sem sessao', () => {
  const p = projetoTemporario('rm056-invalido');
  const claude = runtimePorConta('rm056-invalido');
  try {
    claude.conta(p.dir, 'a');
    const casa = path.join(p.dir, 'contas', 'cx');
    fs.mkdirSync(casa, { recursive: true });
    adicionarPerfil(p.dir, { id: 'cx', runtime: 'codex', dir: casa });
    const t = novaThread(p.carregado, { nome: 'invalido', modo: 'auto' }).thread;

    const nenhum = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg', perfil: 'zz' });
    assert.equal(nenhum.bloqueado, true);
    assert.equal(nenhum.motivo, 'runtime.profile-invalid');
    assert.match(nenhum.erro ?? '', /"zz" nao existe no store \(perfis do claude-bg: a\)/);

    const outro = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg', perfil: 'cx' });
    assert.equal(outro.motivo, 'runtime.profile-invalid');
    assert.match(outro.erro ?? '', /"cx" e do runtime codex, nao do claude-bg/);

    assert.equal(claude.envs().some(l => l.startsWith('--bg')), false, 'nenhuma sessao aberta');
    const gates = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'gate_blocked');
    assert.deepEqual(gates.map(g => g.motivo), ['runtime.profile-invalid', 'runtime.profile-invalid']);
    assert.equal(POLITICA_DE_RETRY['runtime.profile-invalid'].automatica, false, 'pedido do dono nao se corrige por retry');
  } finally { claude.restaurar(); p.limpar(); }
});

test('C1: perfil pedido esgotado ou sem login recusa pelo motivo da conta e nao cai no proximo', () => {
  const p = projetoTemporario('rm056-conta');
  const claude = runtimePorConta('rm056-conta');
  try {
    claude.conta(p.dir, 'a');
    claude.conta(p.dir, 'b', { logado: false });
    claude.conta(p.dir, 'c');
    const futuro = new Date(Date.now() + 3600_000).toISOString();
    marcarFalhaDePerfil(p.dir, 'a', { estado: 'esgotado', esgotadoAte: futuro, motivo: 'runtime.quota-exhausted', detalhe: 'teste' });
    const t = novaThread(p.carregado, { nome: 'conta', modo: 'auto' }).thread;

    const esgotado = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg', perfil: 'a' });
    assert.equal(esgotado.motivo, 'runtime.quota-exhausted');
    assert.match(esgotado.erro ?? '', /"a" esta esgotado ate/);

    // O preflight de login reprova b: com perfil pedido, recusa em vez de seguir para c.
    const semLogin = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg', perfil: 'b' });
    assert.equal(semLogin.motivo, 'runtime.auth-missing');
    assert.equal(claude.envs().some(l => l.startsWith('--bg')), false, 'nenhuma sessao aberta, nem pelo perfil c');

    // Ja marcado sem-auth no store, a recusa sai sem chamar o CLI.
    const store = lerPerfis(p.dir);
    assert.equal(store.perfis.find(q => q.id === 'b')?.estado, 'sem-auth');
    assert.equal(perfilPedido(store, 'claude-bg', 'b').motivo, 'runtime.auth-missing');
  } finally { claude.restaurar(); p.limpar(); }
});

test('perfil pedido fica no prompt e no gate; retry do bloqueio anterior ao despacho usa a mesma conta', (t) => {
  const p = projetoTemporario('perfil-pedido-retry');
  const claude = runtimePorConta('perfil-pedido-retry');
  const falha = mock.method(RUNTIMES['claude-bg'], 'despachar', () => ({
    ok: false, comando: [], sessionId: null, verificada: false, stdout: '',
    stderr: 'runtime indisponivel antes da sessao (simulado)', erro: 'runtime indisponivel antes da sessao (simulado)',
  }));
  t.after(() => { falha.mock.restore(); claude.restaurar(); p.limpar(); });
  try {
    const solicitado = claude.conta(p.dir, 'solicitado');
    claude.conta(p.dir, 'alternativo');
    const thread = novaThread(p.carregado, { nome: 'perfil pedido retry', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, thread.id);

    const primeira = rodarFase(p.carregado, thread.id,
      { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg', perfil: 'solicitado' });
    assert.equal(primeira.motivo, 'runtime.unavailable');
    const antes = lerLedger(dir);
    const marcador = { id: 'solicitado', runtime: 'claude-bg' };
    assert.deepEqual(antes.find(e => e.tipo === 'phase_prompt_recorded')?.perfilPedido, marcador);
    assert.deepEqual(antes.find(e => e.tipo === 'gate_blocked')?.perfilPedido, marcador);

    falha.mock.restore();
    const retry = executarRetry(p.carregado, thread.id);
    assert.equal(retry.executada, true, retry.detalhe);
    const despacho = lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal((despacho?.perfil as { id?: string } | undefined)?.id, 'solicitado');
    assert.deepEqual(despacho?.perfilPedido, marcador);
    assert.ok(claude.envs().includes(`--bg ${solicitado}`));
    assert.equal(claude.envs().some(l => l.startsWith('--bg ') && !l.endsWith(solicitado)), false,
      'o retry nao usou a conta alternativa');
  } finally {
    falha.mock.restore();
  }
});

test('retry recusa perfil pedido sem login com motivo e correcao bilingues, sem trocar de conta', () => {
  const p = projetoTemporario('perfil-pedido-sem-login');
  const claude = runtimePorConta('perfil-pedido-sem-login');
  try {
    claude.conta(p.dir, 'solicitado', { logado: false });
    claude.conta(p.dir, 'alternativo');
    const thread = novaThread(p.carregado, { nome: 'perfil sem login', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, thread.id);

    const primeira = rodarFase(p.carregado, thread.id,
      { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg', perfil: 'solicitado' });
    assert.equal(primeira.motivo, 'runtime.auth-missing');
    const retry = executarRetry(p.carregado, thread.id);
    assert.equal(retry.executada, false);
    assert.equal(retry.redespacho?.motivo, 'runtime.auth-missing');
    assert.match(retry.detalhe, /Nenhuma outra conta foi usada/);
    const gate = lerLedger(dir).filter(e => e.tipo === 'gate_blocked').at(-1);
    assert.equal(gate?.motivo, 'runtime.auth-missing');
    assert.deepEqual(gate?.perfilPedido, { id: 'solicitado', runtime: 'claude-bg' });
    assert.match(String(gate?.correcao), /ork accounts check solicitado/);
    assert.equal(lerLedger(dir).some(e => e.tipo === 'phase_dispatch'), false);
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'runtime_profile_rotated')
      .some(e => (e.para as { perfil?: string } | null)?.perfil === 'alternativo'), false);

    const pt = msg('pt-BR').retry.perfilPedidoRecusado('solicitado', 'claude-bg', 'runtime.auth-missing', 'sem login');
    const en = msg('en').retry.perfilPedidoRecusado('solicitado', 'claude-bg', 'runtime.auth-missing', 'not signed in');
    assert.match(pt, /perfil pedido/);
    assert.match(en, /requested profile/);
    assert.notEqual(msg('pt-BR').retry.correcaoDoPerfilPedido('solicitado', 'claude-bg', 'runtime.auth-missing', thread.id),
      msg('en').retry.correcaoDoPerfilPedido('solicitado', 'claude-bg', 'runtime.auth-missing', thread.id));
  } finally { claude.restaurar(); p.limpar(); }
});

test('retomada da fila preserva o perfil pedido em vez de escolher outra conta', (t) => {
  const p = projetoTemporario('perfil-pedido-retomada');
  const claude = runtimePorConta('perfil-pedido-retomada');
  const falha = mock.method(RUNTIMES['claude-bg'], 'despachar', () => ({
    ok: false, comando: [], sessionId: null, verificada: false, stdout: '', stderr: 'rate limit simulado',
    erro: 'rate limit simulado', rateLimit: {
      resetEm: new Date(Date.now() + 60_000).toISOString(), fonte: 'iso' as const, trecho: 'rate limit simulado',
    },
  }));
  t.after(() => { falha.mock.restore(); claude.restaurar(); p.limpar(); });
  try {
    const solicitado = claude.conta(p.dir, 'solicitado');
    claude.conta(p.dir, 'alternativo');
    const thread = novaThread(p.carregado, { nome: 'perfil pedido retomada', modo: 'auto' }).thread;
    const primeira = rodarFase(p.carregado, thread.id,
      { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg', perfil: 'solicitado' });
    assert.equal(primeira.motivo, 'runtime.rate-limited');
    assert.ok(primeira.naFila);
    assert.deepEqual((primeira.naFila as { perfilPedido?: unknown }).perfilPedido,
      { id: 'solicitado', runtime: 'claude-bg' });

    falha.mock.restore();
    const retomada = retomarPorId(p.carregado, primeira.naFila!.id, { forcar: true });
    assert.equal(retomada.despachada, true, retomada.detalhe);
    const despacho = lerLedger(dirThread(p.dir, thread.id)).filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal((despacho?.perfil as { id?: string } | undefined)?.id, 'solicitado');
    assert.deepEqual(despacho?.perfilPedido, { id: 'solicitado', runtime: 'claude-bg' });
    assert.ok(claude.envs().includes(`--bg ${solicitado}`));
    assert.equal(claude.envs().some(l => l.startsWith('--bg ') && !l.endsWith(solicitado)), false);
  } finally {
    falha.mock.restore();
  }
});

test('despacho sem --perfil conserva a escolha automatica atual e nao grava perfilPedido', () => {
  const p = projetoTemporario('perfil-automatico');
  const claude = runtimePorConta('perfil-automatico');
  try {
    claude.conta(p.dir, 'indisponivel', { logado: false });
    const disponivel = claude.conta(p.dir, 'disponivel');
    const thread = novaThread(p.carregado, { nome: 'perfil automatico', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, thread.id);

    const resultado = rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg' });
    assert.equal(resultado.bloqueado, false, resultado.erro);
    const eventos = lerLedger(dir);
    assert.equal(eventos.find(e => e.tipo === 'phase_prompt_recorded')?.perfilPedido, undefined);
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal((despacho?.perfil as { id?: string } | undefined)?.id, 'disponivel');
    assert.equal(despacho?.perfilPedido, undefined);
    assert.ok(claude.envs().includes(`--bg ${disponivel}`));
  } finally { claude.restaurar(); p.limpar(); }
});
