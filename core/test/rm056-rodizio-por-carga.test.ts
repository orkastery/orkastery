/**
 * RM-056 (C3, D2, D3): o rodizio por carga, opt-in no manifesto. Com dois perfis livres, dois
 * despachos seguidos vao a perfis diferentes; sem a chave, a escolha e a de antes (os dois no
 * primeiro do store, a evidencia 1 do pedido).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste, runtimePorConta } from './apoio';
import { exigirManifesto } from '../src/manifest';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import {
  lerPerfis, politicaDeRotacao, POLITICA_PADRAO, proximoPerfilDisponivel, proximoPerfilPorCarga, StoreDePerfis,
} from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';

const PROMPT = 'RM-056: despacho distribuido por carga';

function manifesto(p: ProjetoDeTeste, linhas: string): void {
  fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), `\n${linhas}\n`);
  p.carregado = exigirManifesto(p.dir);
}

function perfilDoDespacho(p: ProjetoDeTeste, thread: string): unknown {
  return (lerLedger(dirThread(p.dir, thread)).filter(e => e.tipo === 'phase_dispatch').at(-1)?.perfil as { id?: string })?.id;
}

function doisDespachos(p: ProjetoDeTeste): [unknown, unknown] {
  const t1 = novaThread(p.carregado, { nome: 'um', modo: 'auto' }).thread;
  const t2 = novaThread(p.carregado, { nome: 'dois', modo: 'auto' }).thread;
  const r1 = rodarFase(p.carregado, t1.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg' });
  assert.equal(r1.bloqueado, false, r1.erro);
  const r2 = rodarFase(p.carregado, t2.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'claude-bg' });
  assert.equal(r2.bloqueado, false, r2.erro);
  return [perfilDoDespacho(p, t1.id), perfilDoDespacho(p, t2.id)];
}

test('C3: com distribuir: carga, dois despachos seguidos vao a perfis diferentes', () => {
  const p = projetoTemporario('rm056-carga');
  const claude = runtimePorConta('rm056-carga');
  try {
    manifesto(p, 'concurrency:\n  max_parallel_threads: 4\nruntime_profiles:\n  distribuir: carga');
    assert.equal(p.carregado.manifesto.runtime_profiles.distribuir, 'carga');
    claude.conta(p.dir, 'a');
    claude.conta(p.dir, 'b');
    assert.deepEqual(doisDespachos(p), ['a', 'b']);
    assert.ok(lerPerfis(p.dir).perfis.every(q => q.ultimoUso !== null), 'as duas contas trabalharam');
  } finally { claude.restaurar(); p.limpar(); }
});

test('C3: sem a chave, a escolha continua a de antes: os dois despachos no primeiro perfil do store', () => {
  const p = projetoTemporario('rm056-ordem');
  const claude = runtimePorConta('rm056-ordem');
  try {
    manifesto(p, 'concurrency:\n  max_parallel_threads: 4');
    assert.equal(p.carregado.manifesto.runtime_profiles.distribuir, 'ordem');
    claude.conta(p.dir, 'a');
    claude.conta(p.dir, 'b');
    assert.deepEqual(doisDespachos(p), ['a', 'a']);
  } finally { claude.restaurar(); p.limpar(); }
});

test('D2: valor desconhecido de distribuir vale ordem, com aviso', () => {
  const p = projetoTemporario('rm056-aviso');
  try {
    manifesto(p, 'runtime_profiles:\n  distribuir: aleatorio');
    assert.equal(p.carregado.manifesto.runtime_profiles.distribuir, 'ordem');
    assert.ok(p.carregado.avisos.some(a => /runtime_profiles\.distribuir aceita ordem ou carga/.test(a)));
    assert.equal(politicaDeRotacao(p.carregado.manifesto).distribuir, undefined);
  } finally { p.limpar(); }
});

test('D3: menor carga vence; empate pelo uso mais antigo; a retencao da politica continua valendo', () => {
  const perfil = (id: string, extra: Record<string, unknown> = {}) => ({ id, runtime: 'codex' as const, codexHome: `/contas/${id}`,
    estado: 'ativo' as const, esgotadoAte: null, ultimaFalha: null, ultimoUso: null, criadoEm: '2026-10-01T00:00:00.000Z', ...extra });
  const store: StoreDePerfis = { contrato: 'ork.runtime-profiles/v1', perfis: [
    perfil('codex-a', { ultimoUso: '2026-10-01T05:00:00.000Z' }), perfil('codex-b', { ultimoUso: '2026-10-01T04:00:00.000Z' }),
    perfil('codex-c', { estado: 'sem-auth' }),
  ] };
  const carga = { ...POLITICA_PADRAO, distribuir: 'carga' as const };
  assert.equal(proximoPerfilPorCarga(store, 'codex', carga, new Map([['codex-a', 2], ['codex-b', 0]]))?.id, 'codex-b');
  assert.equal(proximoPerfilPorCarga(store, 'codex', carga, new Map([['codex-a', 0], ['codex-b', 3]]))?.id, 'codex-a');
  assert.equal(proximoPerfilPorCarga(store, 'codex', carga, new Map())?.id, 'codex-b', 'empate: o uso mais antigo');
  assert.equal(proximoPerfilPorCarga(store, 'codex', carga, new Map(), { excluir: ['codex-b'] })?.id, 'codex-a');
  // Sem auth nunca recebe, mesmo com carga zero; e a ordem do store segue sendo a de antes.
  assert.notEqual(proximoPerfilPorCarga(store, 'codex', carga, new Map([['codex-a', 5], ['codex-b', 5]]))?.id, 'codex-c');
  assert.equal(proximoPerfilDisponivel(store, 'codex', POLITICA_PADRAO)?.id, 'codex-a');
  // Troca por cota desligada e o primeiro esgotado: o runtime fica retido, como na D14.
  const futuro = new Date(Date.now() + 3600_000).toISOString();
  const retido: StoreDePerfis = { ...store, perfis: [perfil('codex-a', { estado: 'esgotado', esgotadoAte: futuro }), perfil('codex-b')] };
  assert.equal(proximoPerfilPorCarga(retido, 'codex', { ...carga, mesmoRuntimePorCota: false }, new Map()), null);
});
