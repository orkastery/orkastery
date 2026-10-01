/**
 * RM-056 (C1, C2, D1): o perfil PEDIDO no despacho. `--perfil` vale no CLI, no MCP e na
 * extensao OpenClaw pelo mesmo caminho do nucleo; inexistente, de outro runtime, esgotado ou sem
 * login recusa antes de abrir sessao, com motivo tipado, e nunca troca de perfil sozinho.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimePorConta } from './apoio';
import { lerLedger } from '../src/ledger';
import { perfilPedido, rodarFase } from '../src/phase';
import { POLITICA_DE_RETRY } from '../src/retry';
import { adicionarPerfil, lerPerfis, marcarFalhaDePerfil } from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';

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
