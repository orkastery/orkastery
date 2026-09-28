import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, lerThread, gravarThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { migrarMaster } from '../src/master-migracao';
import { registrarMaster, pendentesDeScore } from '../src/master';

test('migração preserva originais, zero humano e ledger; dry-run não escreve e repetição é vazia', () => {
  const p = projetoTemporario('master-migrar');
  try {
    const a = novaThread(p.carregado, { nome: 'orfa', modo: 'auto' }).thread;
    const b = novaThread(p.carregado, { nome: 'agente', modo: 'auto' }).thread;
    const h = novaThread(p.carregado, { nome: 'humano zero', modo: 'auto' }).thread;
    for (const t of [b, h]) registrar(dirThread(p.dir, t.id), t.id, 'ship_done', { mergeSha: 'a'.repeat(40) });
    for (const t of [a, b]) {
      t.status = 'fechada';
      t.score = { valor: t.id === a.id ? 0 : 4, justificativa: t.id === a.id ? 'Encerramento de thread órfã de teste' : 'entrega testada',
        avaliadoPor: t.id === a.id ? 'Julio' : 'Codex', avaliadoEm: new Date().toISOString(), regime: 'batch' };
      gravarThread(p.dir, t);
      registrar(dirThread(p.dir, t.id), t.id, 'master_done', { score: t.score.valor, autorizadoPor: t.score.avaliadoPor });
    }
    registrarMaster(p.dir, h.id, { score: 0, justificativa: 'não satisfez a expectativa', classes: ['erro-de-spec'], por: 'julio' });
    const antes = new Map([a, b, h].map(t => [t.id, fs.readFileSync(path.join(dirThread(p.dir, t.id), 'ledger.jsonl'), 'utf8')]));
    const dry = migrarMaster(p.dir, { dryRun: true, por: 'Codex' });
    assert.equal(dry.correcoes.length, 2);
    assert.equal(fs.existsSync(path.join(dirThread(p.dir, a.id), 'migracao-master-v1')), false);
    for (const t of [a, b, h]) assert.equal(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'ledger.jsonl'), 'utf8'), antes.get(t.id));
    migrarMaster(p.dir, { por: 'Codex' });
    assert.equal(lerThread(p.dir, a.id).fechamentoAdmin?.motivo, 'orfa');
    assert.equal(lerThread(p.dir, b.id).score, null);
    assert.equal(lerThread(p.dir, b.id).score_proposto?.propostoPor, 'Codex');
    assert.equal(lerThread(p.dir, h.id).score?.valor, 0);
    assert.equal(pendentesDeScore(p.dir).length, 1);
    for (const t of [a, b]) {
      assert.equal(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'migracao-master-v1/ledger.jsonl'), 'utf8'), antes.get(t.id));
      assert.ok(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'ledger.jsonl'), 'utf8').startsWith(antes.get(t.id)!));
      assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'master_done').length, 1);
    }
    assert.equal(migrarMaster(p.dir, { por: 'Codex' }).correcoes.length, 0);
  } finally { p.limpar(); }
});


test('migração adia thread ativa em CHECK e preserva seus arquivos byte a byte', () => {
  const p = projetoTemporario('master-migracao-ativa');
  try {
    const t = novaThread(p.carregado, { nome: 'ativa', modo: 'auto' }).thread;
    t.faseAtual = 'CHECK'; t.status = 'aberta';
    t.score = { valor: 4, justificativa: 'proposta legada', avaliadoPor: 'Codex', avaliadoEm: new Date().toISOString(), regime: 'batch' };
    gravarThread(p.dir, t); registrar(dirThread(p.dir, t.id), t.id, 'ship_done', {});
    const dir = dirThread(p.dir, t.id), arquivos = ['thread.json', 'ledger.jsonl'];
    const antes = arquivos.map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const dryRun of [true, false]) {
      const r = migrarMaster(p.dir, { dryRun, por: 'Codex' });
      assert.deepEqual(r.adiadas, [t.id]); assert.equal(r.correcoes.length, 0);
      assert.deepEqual(arquivos.map(f => fs.readFileSync(path.join(dir, f), 'utf8')), antes);
      assert.equal(fs.existsSync(path.join(dir, 'migracao-master-v1')), false);
    }
  } finally { p.limpar(); }
});


test('JSON legado inválido reprova o lote antes de criar backups ou corrigir a primeira thread', () => {
  const p = projetoTemporario('master-json-invalido');
  try {
    const ts = ['a', 'z'].map(nome => novaThread(p.carregado, { nome, modo: 'auto' }).thread);
    for (const t of ts) {
      t.status = 'fechada'; t.faseAtual = 'MASTER';
      t.score = { valor: 4, justificativa: 'legado sem ratificação', avaliadoPor: 'Codex', avaliadoEm: new Date().toISOString(), regime: 'batch' };
      gravarThread(p.dir, t);
    }
    const file = path.join(dirThread(p.dir, ts[1].id), 'master-log.json');
    fs.writeFileSync(file, '{inválido');
    for (const dryRun of [true, false]) {
      assert.throws(() => migrarMaster(p.dir, { dryRun, por: 'Codex' }), e => String(e).includes(file));
      for (const t of ts) {
        assert.equal(lerThread(p.dir, t.id).score?.valor, 4);
        assert.equal(fs.existsSync(path.join(dirThread(p.dir, t.id), 'migracao-master-v1')), false);
        assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'master_migrated'), false);
      }
    }
  } finally { p.limpar(); }
});
