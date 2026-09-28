import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, lerThread, gravarThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { enviarDigest, lerDigest, dirDigest } from '../src/master-digest';
import { auditarMaster } from '../src/master-audit';
import { fecharAdministrativamente } from '../src/thread-close';

test('auditoria exige 100% das fechadas em 30 dias, três classes humanas e quatro recibos consecutivos', () => {
  const p = projetoTemporario('master-kpis');
  try {
    const cli = path.resolve(__dirname, '../../dist/index.js');
    for (const classe of ['sem-falha', 'base-avancou', 'processo']) {
      const t = novaThread(p.carregado, { nome: classe, modo: 'auto' }).thread;
      registrar(dirThread(p.dir, t.id), t.id, 'ship_done', {});
      execFileSync(process.execPath, [cli, 'master', t.id, '--score', '4', '--justificativa', 'revisão humana em teste', '--classe', classe, '--por', 'Julio'], { cwd: p.dir });
      const fechada = lerThread(p.dir, t.id); fechada.atualizadaEm = '2026-09-20T12:00:00Z';
      fs.writeFileSync(path.join(dirThread(p.dir, t.id), 'thread.json'), JSON.stringify(fechada));
    }
    const admin = novaThread(p.carregado, { nome: 'orfa', modo: 'auto' }).thread;
    fecharAdministrativamente(p.dir, admin.id, { motivo: 'orfa', por: 'Codex', justificativa: 'teste encerrado' });
    let numero = 0;
    for (const semana of ['2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02']) {
      assert.equal(enviarDigest({ raiz: p.dir, quando: `${semana}T12:00:00Z`, enviar: () => ({ success: true, message_id: ++numero, platform: 'telegram' }) }).code, 0);
    }
    const quando = '2026-10-02T13:00:00Z';
    const r = auditarMaster(p.dir, quando);
    assert.equal(r.ok, true);
    assert.equal(r.cobertura.percentual, 100);
    assert.equal(r.distribuicao.classes.length, 3);
    const job = lerDigest(p.dir, '2026-09-18');
    job.recibos[0].host.message_id = 0;
    fs.writeFileSync(path.join(dirDigest(p.dir), '2026-09-18.json'), JSON.stringify(job));
    assert.equal(auditarMaster(p.dir, quando).digest.ok, false, 'recibo forjado não conta');
    const falsa = novaThread(p.carregado, { nome: 'fechada sem prova', modo: 'auto' }).thread;
    falsa.status = 'fechada'; gravarThread(p.dir, falsa);
    assert.equal(auditarMaster(p.dir, quando).cobertura.ok, false);
  } finally { p.limpar(); }
});

test('ausência de amostra e de semanas falha honestamente', () => {
  const p = projetoTemporario('master-sem-kpis');
  try {
    const r = auditarMaster(p.dir, '2026-10-02T13:00:00Z');
    assert.equal(r.ok, false);
    assert.equal(r.cobertura.percentual, null);
    assert.equal(r.distribuicao.ok, false);
    assert.equal(r.digest.semanas.filter(s => s.ok).length, 0);
  } finally { p.limpar(); }
});
