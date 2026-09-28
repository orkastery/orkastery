import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adotarSessao, ehRegistroDeAdocao } from '../src/sessoes-adopt';
import { inventariarSessoes } from '../src/sessoes-inventario';
import { listarIds, lerThread, novaThread, gravarThread, dirThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { exportarHandoff } from '../src/handoff';
import { projetoTemporario } from './apoio';
import { spawnSync } from 'node:child_process';

test('adoção idempotente, inequívoca, sem despacho; preserva vínculo de outro projeto', () => {
  const p = projetoTemporario('adopt'), outro = projetoTemporario('origem-adopt');
  const anterior = { ...process.env };
  const id = 'aaaaaaaa-1111-2222-3333-444444444444';
  try {
    process.env.PATH = `${p.dir}:${process.env.PATH}`;
    process.env.CODEX_HOME = p.dir;
    fs.mkdirSync(path.join(p.dir, 'sessions'));
    const responder = (sessoes: unknown[]) => fs.writeFileSync(path.join(p.dir, 'claude'),
      `#!${process.execPath}\nif(process.argv[2]!=='agents')process.exit(9);console.log(${JSON.stringify(JSON.stringify(sessoes))});\n`, { mode: 0o755 });
    responder([{ sessionId: id, cwd: p.dir }]);
    const r = adotarSessao(p.carregado, id.slice(0, 8));
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(r.criada, true);
    const t = lerThread(p.dir, r.vinculo!.thread);
    assert.equal(t.modo, 'auto');
    assert.equal(t.origem, 'adocao');
    assert.equal(ehRegistroDeAdocao(t), true);
    assert.equal(t.sessoes[0].origem, 'adocao');
    assert.equal(t.sessoes[0].promptPath, undefined);
    assert.equal(t.sessoes[0].despachadaEm, undefined);
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.deepEqual(eventos.map(e => e.tipo), ['session_adopted']);
    assert.equal(adotarSessao(p.carregado, id).criada, false);
    assert.equal(listarIds(p.dir).length, 1);
    assert.deepEqual(lerLedger(dirThread(p.dir, t.id)), eventos);
    const handoff = exportarHandoff(p.carregado, t.id).handoff;
    assert.ok(!JSON.stringify(handoff).includes('Prompt da sessao'));
    assert.ok(JSON.stringify(handoff).includes('adotada'));
    assert.equal(inventariarSessoes(p.dir, { global: true, todas: true }).semThread, 0);
    assert.equal(adotarSessao(p.carregado, 'cccccccc').motivo, 'session.missing');
    responder([{ sessionId: id, cwd: p.dir }, { sessionId: 'aaaaaaaa-9999', cwd: p.dir }]);
    assert.equal(adotarSessao(p.carregado, 'aaaaaaaa').motivo, 'session.ambiguous');
    assert.equal(listarIds(p.dir).length, 1);

    const estrangeira = novaThread(outro.carregado, { nome: 'origem', modo: 'auto' }).thread;
    estrangeira.sessoes.push({ sessionId: 'bbbbbbbb-1111', runtime: 'claude-bg', slug: estrangeira.slug,
      fase: 'GO', bloco: 'GO', despachadaEm: new Date().toISOString(), promptPath: 'p.md', promptSha256: '', verificada: true });
    gravarThread(outro.dir, estrangeira);
    responder([{ sessionId: 'bbbbbbbb-1111', cwd: outro.dir }]);
    const antes = fs.readFileSync(path.join(dirThread(outro.dir, estrangeira.id), 'thread.json'));
    const preservada = adotarSessao(p.carregado, 'bbbbbbbb');
    assert.equal(preservada.ok, true, preservada.detalhe);
    assert.equal(preservada.criada, false);
    assert.equal(preservada.vinculo!.raiz, outro.dir);
    assert.deepEqual(fs.readFileSync(path.join(dirThread(outro.dir, estrangeira.id), 'thread.json')), antes);
    assert.equal(listarIds(p.dir).length, 1);
    fs.writeFileSync(path.join(p.dir, '.orkastery/sessions-adopt.lock'), 'outra operação');
    assert.equal(adotarSessao(p.carregado, 'bbbbbbbb').motivo, 'lease.busy');
    assert.equal(fs.readFileSync(path.join(p.dir, '.orkastery/sessions-adopt.lock'), 'utf8'), 'outra operação');
  } finally {
    for (const nome of Object.keys(process.env)) if (!(nome in anterior)) delete process.env[nome];
    Object.assign(process.env, anterior);
    p.limpar(); outro.limpar();
  }
});

test('lock de adoção recupera dono morto, preserva vivo e não presume morte de dono inválido', () => {
  const p = projetoTemporario('adopt-lock');
  const anterior = { ...process.env };
  try {
    process.env.PATH = `${p.dir}:${process.env.PATH}`; process.env.CODEX_HOME = p.dir;
    fs.mkdirSync(path.join(p.dir, 'sessions'));
    fs.writeFileSync(path.join(p.dir, 'claude'), '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
    const lock = path.join(p.dir, '.orkastery/sessions-adopt.lock');
    const morto = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(morto.status, 0);
    assert.throws(() => process.kill(morto.pid, 0), { code: 'ESRCH' });
    for (const conteudo of [JSON.stringify({ pid: process.pid }), '{}', 'invalido']) {
      fs.writeFileSync(lock, conteudo);
      assert.equal(adotarSessao(p.carregado, 'aaaaaaaa').motivo, 'lease.busy');
      assert.equal(fs.readFileSync(lock, 'utf8'), conteudo);
      assert.equal(fs.existsSync(lock + '.guard'), false);
    }
    fs.writeFileSync(lock, JSON.stringify({ pid: morto.pid, criadaEm: '2020-01-01T00:00:00Z' }));
    assert.equal(adotarSessao(p.carregado, 'aaaaaaaa').motivo, 'session.missing');
    assert.equal(fs.existsSync(lock), false);
    assert.equal(fs.existsSync(lock + '.guard'), false);
    fs.mkdirSync(lock + '.guard');
    fs.writeFileSync(path.join(lock + '.guard', 'pid'), String(process.pid));
    assert.equal(adotarSessao(p.carregado, 'aaaaaaaa').motivo, 'lease.busy');
    assert.equal(fs.readFileSync(path.join(lock + '.guard', 'pid'), 'utf8'), String(process.pid));
    fs.writeFileSync(path.join(lock + '.guard', 'pid'), String(morto.pid));
    assert.equal(adotarSessao(p.carregado, 'aaaaaaaa').motivo, 'session.missing');
    assert.equal(fs.existsSync(lock + '.guard'), false);
  } finally {
    for (const nome of Object.keys(process.env)) if (!(nome in anterior)) delete process.env[nome];
    Object.assign(process.env, anterior); p.limpar();
  }
});

test('58 registros legados são classificados sem migrar histórico; trabalho com despacho continua trabalho', () => {
  const p = projetoTemporario('adopt-legado');
  try {
    for (let i = 0; i < 58; i++) {
      const t = novaThread(p.carregado, { nome: `legado${i}`, modo: 'auto' }).thread;
      t.sessoes.push({ origem: 'adocao', sessionId: `aaaaaaaa-${String(i).padStart(8, '0')}`,
        runtime: 'claude-bg', slug: t.slug, fase: 'GOAL', bloco: 'ad-hoc',
        adotadaEm: t.criadaEm, cwdOrigem: p.dir, verificada: true });
      gravarThread(p.dir, t);
      const dir = dirThread(p.dir, t.id), arquivo = path.join(dir, 'thread.json');
      const antes = fs.readFileSync(arquivo), ledger = fs.readFileSync(path.join(dir, 'ledger.jsonl'));
      assert.equal(ehRegistroDeAdocao(lerThread(p.dir, t.id)), true);
      assert.equal(ehRegistroDeAdocao(lerThread(p.dir, t.id)), true);
      assert.deepEqual(fs.readFileSync(arquivo), antes);
      assert.deepEqual(fs.readFileSync(path.join(dir, 'ledger.jsonl')), ledger);
      assert.equal(t.status, 'aberta'); assert.equal(t.score, null);
    }
    assert.equal(listarIds(p.dir).length, 58);
    const real = novaThread(p.carregado, { nome: 'trabalho', modo: 'auto' }).thread;
    assert.equal(ehRegistroDeAdocao(real), false);
    real.origem = 'adocao';
    real.sessoes.push({ sessionId: 'bbbbbbbb', runtime: 'claude-bg', slug: real.slug, fase: 'GO',
      bloco: 'GO', despachadaEm: real.criadaEm, promptPath: 'p.md', promptSha256: '', verificada: true });
    assert.equal(ehRegistroDeAdocao(real), false);
  } finally { p.limpar(); }
});
