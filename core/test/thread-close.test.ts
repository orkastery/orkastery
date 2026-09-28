import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, lerThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { fecharAdministrativamente, exigirEntrega, registrarArtefato } from '../src/thread-close';

for (const motivo of ['orfa', 'engano', 'superada']) test(`fechamento ${motivo} é tipado e idempotente sem MASTER`, () => {
  const p = projetoTemporario('fechar-admin');
  try {
    const t = novaThread(p.carregado, { nome: motivo, modo: 'auto' }).thread;
    assert.throws(() => exigirEntrega(p.dir, t.id), /exige entrega/);
    const opts = { motivo, por: 'Codex', justificativa: 'encerramento administrativo autorizado' };
    fecharAdministrativamente(p.dir, t.id, opts); fecharAdministrativamente(p.dir, t.id, opts);
    assert.equal(lerThread(p.dir, t.id).status, 'fechada');
    assert.equal(lerThread(p.dir, t.id).score ?? null, null);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'thread_closed_admin').length, 1);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'master_done').length, 0);
    assert.throws(() => exigirEntrega(p.dir, t.id), /administrativamente/);
  } finally { p.limpar(); }
});

test('motivo inválido e entrega prévia impedem fechamento administrativo', () => {
  const p = projetoTemporario('fechar-recusa');
  try {
    const t = novaThread(p.carregado, { nome: 'entrega', modo: 'auto' }).thread;
    assert.throws(() => fecharAdministrativamente(p.dir, t.id, { motivo: 'outro', por: 'Codex', justificativa: 'teste' }), /motivo/);
    registrar(dirThread(p.dir, t.id), t.id, 'ship_done', { mergeSha: 'a'.repeat(40) });
    assert.throws(() => fecharAdministrativamente(p.dir, t.id, { motivo: 'orfa', por: 'Codex', justificativa: 'teste' }), /exige MASTER/);
    assert.equal(exigirEntrega(p.dir, t.id).tipo, 'ship');
  } finally { p.limpar(); }
});

test('artefato é revalidado por hash e recusa fuga por caminho ou symlink', () => {
  const p = projetoTemporario('prova-artefato');
  try {
    const t = novaThread(p.carregado, { nome: 'relatório', modo: 'auto' }).thread;
    const sha = createHash('sha256').update('entrega').digest('hex');
    fs.writeFileSync(path.join(p.dir, 'relatorio.txt'), 'entrega');
    assert.throws(() => registrarArtefato(p.dir, t.id, 'relatorio.txt', '0'.repeat(64), 'Codex'), /hash/);
    registrarArtefato(p.dir, t.id, 'relatorio.txt', sha, 'Codex');
    assert.equal(exigirEntrega(p.dir, t.id).tipo, 'artefato');
    fs.writeFileSync(path.join(p.dir, 'relatorio.txt'), 'alterado');
    assert.throws(() => exigirEntrega(p.dir, t.id), /exige entrega/);
    fs.symlinkSync('/etc/hosts', path.join(p.dir, 'fora'));
    assert.throws(() => registrarArtefato(p.dir, t.id, 'fora', sha, 'Codex'), /dentro do projeto/);
  } finally { p.limpar(); }
});
