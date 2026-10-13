/**
 * RM-008 (fases pelo tipo): o POSTMORTEM conta o CHECK e o SHIP que o ledger registrou.
 *
 * O `verify_run` e o `ship_done` sao gravados sem o campo `fase`, e o `fasesPercorridas` so contava
 * evento com fase. Dos 35 POSTMORTEM de 03/10/2026, so 1 listou o CHECK e 2 o SHIP; o da
 * `ork-rm037testesi` dizia GOAL, GO e MASTER com 6 `verify_run` e 1 `ship_done` no ledger.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import * as fs from 'node:fs';
import { aceitarPorOmissao, caminhoPostmortem, fasesPercorridas } from '../src/master';
import { Postmortem } from '../src/types';
import { dirThread, novaThread } from '../src/thread';

test('RM-008 fases pelo tipo: verify_run e ship_done sem fase entram como CHECK e SHIP, na ordem', () => {
  const p = projetoTemporario('rm008-fases-tipo');
  try {
    const t = novaThread(p.carregado, { nome: 'fases', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, TIPOS_DE_EVENTO.claimRegistrada, { fase: 'GO', id: 'C1' });
    registrar(dir, t.id, TIPOS_DE_EVENTO.verificacao, { veredito: 'VERDADE SUSTENTADA' });
    registrar(dir, t.id, TIPOS_DE_EVENTO.verificacao, { veredito: 'VERDADE SUSTENTADA' });
    registrar(dir, t.id, TIPOS_DE_EVENTO.shipConcluido, {
      de: 'ork/x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true,
    });
    const fases = fasesPercorridas(p.dir, t.id);
    assert.deepEqual(fases.map((f) => f.fase), ['GO', 'CHECK', 'SHIP']);
    assert.equal(fases.find((f) => f.fase === 'CHECK')?.eventos, 2);
    assert.equal(fases.find((f) => f.fase === 'SHIP')?.eventos, 1);

    // O POSTMORTEM do aceite por omissao leva as mesmas fases, e o MASTER no fim.
    aceitarPorOmissao(p.dir, t.id);
    const post = JSON.parse(fs.readFileSync(caminhoPostmortem(p.dir, t.id), 'utf8')) as Postmortem;
    assert.deepEqual(post.fasesPercorridas.map((f) => f.fase), ['GO', 'CHECK', 'SHIP', 'MASTER']);
  } finally { p.limpar(); }
});

test('RM-008 fases pelo tipo: o campo fase do evento vence o tipo, e tipo sem tabela fica de fora', () => {
  const p = projetoTemporario('rm008-fases-campo');
  try {
    const t = novaThread(p.carregado, { nome: 'campo', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, TIPOS_DE_EVENTO.verificacao, { fase: 'GO', veredito: 'x' });
    registrar(dir, t.id, TIPOS_DE_EVENTO.reverifyConcluido, {});
    registrar(dir, t.id, TIPOS_DE_EVENTO.shipIniciado, {});
    registrar(dir, t.id, TIPOS_DE_EVENTO.shipBloqueado, { motivo: 'x' });
    registrar(dir, t.id, TIPOS_DE_EVENTO.worktreeCriada, {});
    const fases = fasesPercorridas(p.dir, t.id);
    assert.deepEqual(fases.map((f) => [f.fase, f.eventos]), [['GO', 1], ['CHECK', 1], ['SHIP', 2]]);
  } finally { p.limpar(); }
});
