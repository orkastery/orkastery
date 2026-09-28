/**
 * I-33 (GO-FIX 1 do CHECK aa279e17, achado A14): falha da CONFERENCIA de login (timeout, sinal,
 * binario ausente, resposta ilegivel) nao prova login perdido. O perfil nao vira `sem-auth`
 * permanente: fica fora so do despacho em curso, com `ultimaFalha` registrada, e o proximo
 * despacho confere de novo. Login ausente de verdade continua `sem-auth`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirTemporario, projetoTemporario, runtimePorConta } from './apoio';
import { conferirAuth as authClaude } from '../src/adapters/claude-bg';
import { conferirAuth as authCodex } from '../src/adapters/codex';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { lerPerfis } from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';

const CLI = path.resolve(__dirname, '../../dist/index.js');

test('A14 conferencia: sem resposta, morte por sinal ou JSON ilegivel sao inconclusivos; login ausente nao', () => {
  const raiz = dirTemporario('a14-conferencia');
  const vazio = dirTemporario('a14-path-vazio');
  const bin = dirTemporario('a14-bin');
  const anterior = process.env.PATH;
  try {
    const perfilClaude = { id: 'a', runtime: 'claude-bg' as const, configDir: path.join(raiz, 'a') };
    const perfilCodex = { id: 'x', runtime: 'codex' as const, codexHome: path.join(raiz, 'x') };
    // Binario ausente: nenhum CLI no PATH.
    process.env.PATH = vazio;
    assert.deepEqual([authClaude(perfilClaude).ok, authClaude(perfilClaude).transitorio], [false, true]);
    assert.deepEqual([authCodex(perfilCodex).ok, authCodex(perfilCodex).transitorio], [false, true]);
    // Morte por sinal e resposta ilegivel.
    process.env.PATH = `${bin}:${anterior ?? ''}`;
    for (const [corpo, esperado] of [
      ['kill -9 $$', true],
      ['echo "resposta ilegivel"; exit 0', true],
      [`printf '{"loggedIn":false}'; exit 1`, undefined],
    ] as const) {
      fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\n${corpo}\n`, { mode: 0o755 });
      const r = authClaude(perfilClaude);
      assert.equal(r.ok, false, corpo);
      assert.equal(r.transitorio, esperado, `${corpo}: ${r.detalhe}`);
    }
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nkill -9 $$\n', { mode: 0o755 });
    assert.equal(authCodex(perfilCodex).transitorio, true);
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\necho "Not logged in"; exit 1\n', { mode: 0o755 });
    assert.deepEqual([authCodex(perfilCodex).ok, authCodex(perfilCodex).transitorio], [false, undefined]);
  } finally {
    process.env.PATH = anterior;
    for (const d of [raiz, vazio, bin]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('A14 despacho: conferencia inconclusiva nao marca sem-auth; o proximo despacho confere de novo e usa o perfil', () => {
  const p = projetoTemporario('a14-despacho');
  const claude = runtimePorConta('a14');
  try {
    const contaA = claude.conta(p.dir, 'a');
    fs.writeFileSync(path.join(contaA, '.stub-auth-lixo'), '');
    const t1 = novaThread(p.carregado, { nome: 'a14-1', modo: 'auto' }).thread;
    const r1 = rodarFase(p.carregado, t1.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.deepEqual([r1.bloqueado, r1.motivo], [true, 'runtime.unavailable'], 'inconclusivo nao e runtime.auth-missing');
    const a = lerPerfis(p.dir).perfis.find(q => q.id === 'a')!;
    assert.equal(a.estado, 'ativo', 'o estado nao vira sem-auth permanente');
    assert.equal(a.ultimaFalha?.motivo, 'runtime.unavailable');
    assert.match(a.ultimaFalha?.detalhe ?? '', /conferencia de login inconclusiva/);
    assert.equal(claude.envs().some(l => l.startsWith('--bg')), false, 'nenhum despacho sem login conferido');
    const rotacao = lerLedger(dirThread(p.dir, t1.id)).find(e => e.tipo === 'runtime_profile_rotated');
    assert.equal(rotacao?.motivo, 'runtime.unavailable');

    // A causa transitoria passou: o proximo despacho confere de novo e usa o perfil.
    fs.rmSync(path.join(contaA, '.stub-auth-lixo'));
    const t2 = novaThread(p.carregado, { nome: 'a14-2', modo: 'auto' }).thread;
    const r2 = rodarFase(p.carregado, t2.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO de novo' });
    assert.equal(r2.verificada, true, r2.erro);
    assert.ok(claude.envs().includes(`--bg ${contaA}`));
  } finally { p.limpar(); claude.restaurar(); }
});

test('A14 accounts check: conferencia inconclusiva sai diferente de zero e mantem o estado do perfil', () => {
  const p = projetoTemporario('a14-cli');
  const claude = runtimePorConta('a14-cli');
  try {
    const contaA = claude.conta(p.dir, 'a');
    fs.writeFileSync(path.join(contaA, '.stub-auth-sinal'), '');
    let saida = '', codigo = 0;
    try { saida = execFileSync(process.execPath, [CLI, 'accounts', 'check'], { cwd: p.dir, encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) { const x = e as { stdout?: string; status?: number }; saida = x.stdout ?? ''; codigo = x.status ?? 1; }
    assert.equal(codigo, 1, saida);
    assert.match(saida, /conferencia de login inconclusiva, estado mantido/);
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'ativo');
  } finally { p.limpar(); claude.restaurar(); }
});
