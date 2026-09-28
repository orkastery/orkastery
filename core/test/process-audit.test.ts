import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { proporMaster, registrarMaster } from '../src/master';
import { auditarProcesso } from '../src/process-audit';
import { lerBoard } from '../src/divida';
import { packAtivo } from '../src/auditoria';

test('process nascente materializa PR1 PR2 PR3 em warn, sem duplicar o board', () => {
  const p = projetoTemporario('process-nascente');
  try {
    const a = novaThread(p.carregado, { nome: 'sem MASTER', modo: 'auto' }).thread;
    const b = novaThread(p.carregado, { nome: 'gate repetido', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, a.id), a.id, 'ship_done', {});
    for (const t of [a, b]) registrar(dirThread(p.dir, t.id), t.id, 'gate_blocked', { motivo: 'claims.failed' });
    assert.equal(packAtivo('process', 'nascente'), true);
    const r = auditarProcesso(p.carregado, true);
    assert.equal(r.postura, 'warn');
    assert.deepEqual(r.achados.map(a => a.regra).sort(), ['PR1', 'PR2', 'PR3']);
    assert.equal(lerBoard(p.dir).length, 3);
    auditarProcesso(p.carregado, true);
    assert.equal(lerBoard(p.dir).length, 3);
    const c = novaThread(p.carregado, { nome: 'nova recorrência', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, c.id), c.id, 'gate_blocked', { motivo: 'claims.failed' });
    auditarProcesso(p.carregado, true);
    const pr3 = lerBoard(p.dir).filter(a => a.regra === 'PR3');
    assert.equal(pr3.length, 1, 'nova ocorrência atualiza o mesmo item');
    assert.ok(pr3[0].descricao.includes(c.id));
    assert.equal(lerBoard(p.dir).length, 3);
    const cli = path.resolve(__dirname, '../../dist/index.js');
    execFileSync(process.execPath, [cli, 'audit', 'process', '--exigir-achado', r.achados[0].chave], { cwd: p.dir });
    proporMaster(p.dir, a.id, { score: 4, justificativa: 'entrega verificada', por: 'Codex' });
    assert.equal(auditarProcesso(p.carregado).achados.some(a => a.regra === 'PR1'), false);
    assert.equal(auditarProcesso(p.carregado).achados.some(a => a.regra === 'PR2'), true);
    registrarMaster(p.dir, a.id, { score: 4, justificativa: 'revisão humana', por: 'Julio' });
    assert.deepEqual(auditarProcesso(p.carregado).achados.map(a => a.regra), ['PR3']);
  } finally { p.limpar(); }
});
