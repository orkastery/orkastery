/**
 * I-33 (N6 do CHECK-REVERIFY 8924757a, P8 do GOAL): sem perfil configurado nada muda. A recusa do
 * despacho com o texto legado do limite de uso ("Claude AI usage limit reached|<epoch>"), que a
 * leitura da baseline ja tratava como rate limit, vai direto para a fila duravel do B3, sem gate da
 * conta e sem `ork retry run`. Com perfil, o mesmo texto segue a D16: esgotamento, perfil fora do
 * rodizio ate o prazo dito. As fixtures B3 originais seguem em `ratelimit.test.ts` e
 * `orquestracao.test.ts`, iguais as da baseline.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimePorConta } from './apoio';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { aguardando } from '../src/ratelimit';
import { lerPerfis } from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';

test('N6 sem perfis: "Claude AI usage limit reached|<epoch>" na recusa do despacho vai direto a fila do B3, como na baseline', () => {
  const p = projetoTemporario('n6-sem-perfis');
  const claude = runtimePorConta('n6');
  try {
    const epoch = Math.floor((Date.now() + 3 * 3600e3) / 1000);
    const contaDoProcesso = process.env.CLAUDE_CONFIG_DIR as string;
    fs.mkdirSync(contaDoProcesso, { recursive: true });
    fs.writeFileSync(path.join(contaDoProcesso, '.stub-falha'), `Claude AI usage limit reached|${epoch}\n`);
    const t = novaThread(p.carregado, { nome: 'n6', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'implemente a fatia 1' });
    assert.equal(r.motivo, 'runtime.rate-limited');
    assert.ok(r.naFila, 'o despacho morto entrou na fila duravel no proprio phase run');
    assert.equal(r.naFila?.liberaEm, new Date(epoch * 1000).toISOString());
    assert.equal(aguardando(p.dir).length, 1);
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.equal(eventos.some(e => e.tipo === 'gate_blocked' && e.motivo === 'runtime.quota-exhausted'), false, 'sem gate da conta');
    assert.equal(eventos.filter(e => e.tipo === 'rate_limit_queued').length, 1);
    assert.equal(lerPerfis(p.dir).perfis.length, 0, 'nenhum perfil criado ou marcado');
  } finally { p.limpar(); claude.restaurar(); }
});

test('N6 com perfis: o mesmo texto segue a D16, esgotamento com o perfil fora do rodizio ate o prazo dito (positivo)', () => {
  const p = projetoTemporario('n6-com-perfis');
  const claude = runtimePorConta('n6p');
  try {
    const epoch = Math.floor((Date.now() + 3 * 3600e3) / 1000);
    claude.conta(p.dir, 'a', { falha: `Claude AI usage limit reached|${epoch}\n` });
    claude.conta(p.dir, 'b');
    const t = novaThread(p.carregado, { nome: 'n6p', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'implemente a fatia 1' });
    assert.equal(r.motivo, 'runtime.quota-exhausted');
    assert.equal(r.naFila ?? null, null);
    const a = lerPerfis(p.dir).perfis.find(q => q.id === 'a')!;
    assert.deepEqual([a.estado, a.esgotadoAte], ['esgotado', new Date(epoch * 1000).toISOString()]);
    assert.equal(aguardando(p.dir).length, 0);
  } finally { p.limpar(); claude.restaurar(); }
});
