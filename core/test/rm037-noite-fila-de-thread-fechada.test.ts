/**
 * RM-037 (rm037noite, defeito 2): a ork-companybrai3, fechada, seguia na frente da fila de
 * `path:docs/roadmap/README.md`, e o `ork_git_commit` da ork-pacotedeexpe recusou com `lease.busy`
 * sem lease ativo nenhum. Fechar a thread tira dela a fila e os leases de escrita; o que ja ficou
 * preso sai quando outra thread pede a regiao, com registro no ledger da thread fechada.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { adquirir, adquirirRegiao, caminhoFila, lerFila, lerLease, listarLeases } from '../src/leases';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { fecharAdministrativamente } from '../src/thread-close';
import { registrarMaster } from '../src/master';
import { liberarAoFechar } from '../src/fechamento';
import { garantirWorktree } from '../src/worktree';

const REGIAO = 'path:docs/roadmap/README.md';

function fechar(dir: string, id: string): void {
  const t = lerThread(dir, id);
  t.status = 'fechada';
  gravarThread(dir, t);
}

test('defeito 2: a fila presa em thread fechada nao barra mais quem pede a regiao, e sai com registro', () => {
  const p = projetoTemporario('rm037noite-fila-presa');
  try {
    const fechada = novaThread(p.carregado, { nome: 'companybrai3', modo: 'auto' }).thread;
    const viva = novaThread(p.carregado, { nome: 'pacotedeexpe', modo: 'auto' }).thread;
    // O estado real de 29/09: a fechada na frente da fila, sem lease nenhum ativo na regiao.
    fs.mkdirSync(path.dirname(caminhoFila(p.dir)), { recursive: true });
    fs.writeFileSync(caminhoFila(p.dir), JSON.stringify([
      { nome: REGIAO, tipo: 'path', thread: fechada.id, motivo: 'GO T4', desdeEm: '2026-09-29T02:24:45.686Z',
        colidiuCom: REGIAO, bloqueadaPor: 'ork-i31kg1contra' },
    ], null, 2));
    fechar(p.dir, fechada.id);

    const r = adquirirRegiao(p.dir, REGIAO, { thread: viva.id, motivo: 'MCP git_commit delimitado' });
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(r.motivo, null);
    assert.equal(lerLease(p.dir, REGIAO)?.thread, viva.id);
    assert.deepEqual(lerFila(p.dir), []);
    const ev = lerLedger(dirThread(p.dir, fechada.id)).filter((e) => e.tipo === 'lease_dequeued');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].lease, REGIAO);
    assert.equal(ev[0].origem, 'poda');
    assert.equal(ev[0].pedidaPor, viva.id);
  } finally { p.limpar(); }
});

test('defeito 2: thread que nao existe nesta maquina segue na fila (so status fechada prova o fim)', () => {
  const p = projetoTemporario('rm037noite-fila-desconhecida');
  try {
    const viva = novaThread(p.carregado, { nome: 'viva', modo: 'auto' }).thread;
    fs.mkdirSync(path.dirname(caminhoFila(p.dir)), { recursive: true });
    fs.writeFileSync(caminhoFila(p.dir), JSON.stringify([
      { nome: REGIAO, tipo: 'path', thread: 'ork-outroperfil', motivo: 'm', desdeEm: '2026-09-29T02:00:00.000Z',
        colidiuCom: REGIAO, bloqueadaPor: 'ork-x' },
    ]));
    const r = adquirirRegiao(p.dir, REGIAO, { thread: viva.id, motivo: 'm' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'lease.busy');
    assert.equal(lerFila(p.dir)[0].thread, 'ork-outroperfil');
  } finally { p.limpar(); }
});

test('defeito 2: lease de escrita de thread fechada tambem sai quando outra pede a regiao', () => {
  const p = projetoTemporario('rm037noite-lease-preso');
  try {
    const fechada = novaThread(p.carregado, { nome: 'dona', modo: 'auto' }).thread;
    const viva = novaThread(p.carregado, { nome: 'quer', modo: 'auto' }).thread;
    assert.equal(adquirir(p.dir, 'path:docs/roadmap/**', { thread: fechada.id, motivo: 'GO' }).ok, true);
    fechar(p.dir, fechada.id);
    const r = adquirirRegiao(p.dir, REGIAO, { thread: viva.id, motivo: 'commit' });
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(lerLease(p.dir, 'path:docs/roadmap/**'), null);
    const ev = lerLedger(dirThread(p.dir, fechada.id)).filter((e) => e.tipo === 'lease_released');
    assert.deepEqual(ev.map((e) => [e.lease, e.origem]), [['path:docs/roadmap/**', 'poda']]);
  } finally { p.limpar(); }
});

test('defeito 2: thread close solta leases de escrita e fila da thread; o exec: fica com a conducao', () => {
  const p = projetoTemporario('rm037noite-close-solta');
  try {
    const t = novaThread(p.carregado, { nome: 'fecha', modo: 'auto' }).thread;
    const outra = novaThread(p.carregado, { nome: 'outra', modo: 'auto' }).thread;
    assert.equal(adquirir(p.dir, 'path:core/src/**', { thread: t.id, motivo: 'GO' }).ok, true);
    assert.equal(adquirir(p.dir, `worktree-write:${t.id}`, { thread: t.id, motivo: 'GO' }).ok, true);
    assert.equal(adquirir(p.dir, `exec:${t.id}`, { thread: t.id, motivo: 'conducao' }).ok, true);
    // Uma espera da thread e uma da outra, na mesma fila.
    assert.equal(adquirir(p.dir, REGIAO, { thread: outra.id, motivo: 'segura' }).ok, true);
    assert.equal(adquirirRegiao(p.dir, REGIAO, { thread: t.id, motivo: 'espera' }).esperando, true);

    fecharAdministrativamente(p.dir, t.id, { motivo: 'orfa', por: 'Julio', justificativa: 'thread abandonada no teste' });

    const restantes = listarLeases(p.dir).map((l) => l.nome).sort();
    assert.deepEqual(restantes, [`exec:${t.id}`, REGIAO].sort());
    assert.equal(lerFila(p.dir).some((x) => x.thread === t.id), false);
    const ev = lerLedger(dirThread(p.dir, t.id));
    assert.deepEqual(ev.filter((e) => e.tipo === 'lease_released').map((e) => [e.lease, e.origem]).sort(),
      [['path:core/src/**', 'fechamento'], [`worktree-write:${t.id}`, 'fechamento']].sort());
    assert.deepEqual(ev.filter((e) => e.tipo === 'lease_dequeued').map((e) => e.lease), [REGIAO]);
  } finally { p.limpar(); }
});

test('defeito 2: o MASTER tambem solta o que a thread segurava', () => {
  const p = projetoTemporario('rm037noite-master-solta');
  try {
    const t = novaThread(p.carregado, { nome: 'entregue', modo: 'auto' }).thread;
    assert.equal(adquirir(p.dir, 'path:docs/**', { thread: t.id, motivo: 'GO' }).ok, true);
    registrar(dirThread(p.dir, t.id), t.id, 'ship_done', { mergeSha: 'a'.repeat(40), pushVerificado: true });
    registrarMaster(p.dir, t.id, { por: 'julio', score: 5, justificativa: 'entrega limpa', classes: ['sem-falha'] });
    assert.equal(lerThread(p.dir, t.id).status, 'fechada');
    assert.equal(lerLease(p.dir, 'path:docs/**'), null);
    assert.deepEqual(lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'lease_released').map((e) => e.lease),
      ['path:docs/**']);
  } finally { p.limpar(); }
});

test('defeito 2 (A1 do CHECK 1): erro de E/S na poda nao derruba o pedido da thread viva nem o fechamento', () => {
  const p = projetoTemporario('rm037noite-poda-sem-escrita');
  try {
    const fechada = novaThread(p.carregado, { nome: 'ledger travado', modo: 'auto' }).thread;
    const viva = novaThread(p.carregado, { nome: 'quer a regiao', modo: 'auto' }).thread;
    fs.mkdirSync(path.dirname(caminhoFila(p.dir)), { recursive: true });
    fs.writeFileSync(caminhoFila(p.dir), JSON.stringify([
      { nome: REGIAO, tipo: 'path', thread: fechada.id, motivo: 'm', desdeEm: '2026-09-29T02:00:00.000Z', colidiuCom: REGIAO, bloqueadaPor: 'x' },
    ]));
    fechar(p.dir, fechada.id);
    // O ledger da thread fechada nao aceita escrita: o registro da poda falha com EACCES.
    const ledger = path.join(dirThread(p.dir, fechada.id), 'ledger.jsonl');
    fs.chmodSync(ledger, 0o444);
    try {
      const r = adquirirRegiao(p.dir, REGIAO, { thread: viva.id, motivo: 'commit' });
      assert.equal(r.ok, true, r.detalhe);
      const solto = liberarAoFechar(p.dir, fechada.id);
      assert.deepEqual(solto.falhas, [], 'nada mais a soltar: a fila ja saiu na poda');
    } finally { fs.chmodSync(ledger, 0o644); }
  } finally { p.limpar(); }
});

test('defeito 2 (sugestao 9 do CHECK 1): o fechamento solta tambem os leases pegos da worktree da thread', () => {
  const p = projetoTemporario('rm037noite-lease-na-worktree');
  try {
    const t = novaThread(p.carregado, { nome: 'pega da worktree', modo: 'auto' }).thread;
    garantirWorktree(p.carregado, t.id);
    const wt = lerThread(p.dir, t.id).worktree as string;
    assert.equal(adquirir(wt, 'path:core/**', { thread: t.id, motivo: 'GO na worktree' }).ok, true);
    const solto = liberarAoFechar(p.dir, t.id);
    assert.deepEqual(solto.leases, ['path:core/**']);
    assert.equal(lerLease(wt, 'path:core/**'), null);
  } finally { p.limpar(); }
});
