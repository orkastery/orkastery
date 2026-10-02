/**
 * RM-037 (fatia 3, defeito 4): o commit pelo MCP recusava com `lease.busy` o lease vencido que a
 * ork-companybrai3, ja fechada, deixou em 29/09, e soltar o lease de outra thread exigia o dono. O
 * fechamento ja solta os leases (RM-037 noite, defeito 2), mas o que ficou de antes, ou de fechamento
 * que falhou, travava as conferencias previas do MCP, que liam o lease antes da poda do `adquirirRegiao`.
 * Este arquivo e hermetico: a poda e a escrita de artefato. O `ork_git_commit` e o `ork_verify` reais
 * estao em `rm037-fatia3-lease-mcp-git.test.ts`, integracao local como o `mcp-git.test.ts`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { adquirir, enfileirar, lerFila, lerLease, podarRegioesDeThreadsFechadas } from '../src/leases';
import { lerLedger } from '../src/ledger';
import { escreverArtefatoMcp, lerArtefatoMcp } from '../src/mcp-artifacts';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';

function fechar(raiz: string, id: string): void {
  const t = lerThread(raiz, id);
  t.status = 'fechada';
  t.faseAtual = 'MASTER';
  gravarThread(raiz, t);
}

test('defeito 4: a poda solta lease e fila de thread fechada, com registro, e deixa o resto como estava', () => {
  const p = projetoTemporario('rm037-f3-poda');
  try {
    const fechada = novaThread(p.carregado, { nome: 'ja fechou', modo: 'auto' }).thread.id;
    const aberta = novaThread(p.carregado, { nome: 'ainda aberta', modo: 'auto' }).thread.id;
    const quem = novaThread(p.carregado, { nome: 'quem pede', modo: 'auto' }).thread.id;
    // Antes do fechamento novo: o lease vencido, o main-tree ativo e a espera na fila ficaram para tras.
    adquirir(p.dir, 'path:docs/compartilhado.md', { thread: fechada, motivo: 'GO antigo', ttlMs: -1 });
    adquirir(p.dir, 'main-tree', { thread: fechada, motivo: 'SHIP que caiu', ttlMs: 60_000 });
    enfileirar(p.dir, 'path:docs/roadmap/README.md', { thread: fechada, motivo: 'indice', colidiuCom: 'path:docs/roadmap/README.md', bloqueadaPor: 'ork-x' });
    fechar(p.dir, fechada);
    // Thread aberta (vencido ou nao) e thread que esta maquina nao conhece seguem barrando.
    adquirir(p.dir, 'path:core/src/a.ts', { thread: aberta, motivo: 'GO em curso', ttlMs: -1 });
    adquirir(p.dir, 'path:core/src/b.ts', { thread: 'ork-de-outra-maquina', motivo: 'outra maquina', ttlMs: 60_000 });

    podarRegioesDeThreadsFechadas(p.dir,
      ['path:docs/compartilhado.md', 'main-tree', 'path:docs/roadmap/README.md', 'path:core/src/a.ts', 'path:core/src/b.ts'], quem);

    assert.equal(lerLease(p.dir, 'path:docs/compartilhado.md'), null);
    assert.equal(lerLease(p.dir, 'main-tree'), null);
    assert.deepEqual(lerFila(p.dir).filter((x) => x.thread === fechada), []);
    assert.equal(lerLease(p.dir, 'path:core/src/a.ts')?.thread, aberta, 'lease vencido de thread aberta nao e orfao');
    assert.equal(lerLease(p.dir, 'path:core/src/b.ts')?.thread, 'ork-de-outra-maquina', 'thread desconhecida nao conta como fechada');
    const eventos = lerLedger(dirThread(p.dir, fechada));
    const soltos = eventos.filter((e) => e.tipo === 'lease_released').map((e) => [e.lease, e.origem, e.pedidaPor]);
    assert.deepEqual(soltos.sort(), [['main-tree', 'poda', quem], ['path:docs/compartilhado.md', 'poda', quem]]);
    assert.deepEqual(eventos.filter((e) => e.tipo === 'lease_dequeued').map((e) => [e.lease, e.origem]),
      [['path:docs/roadmap/README.md', 'poda']]);
  } finally { p.limpar(); }
});

test('defeito 4: a escrita de artefato pelo MCP nao trava no lease de thread fechada que cruza o estado', () => {
  const p = projetoTemporario('rm037-f3-artefato');
  try {
    const fechada = novaThread(p.carregado, { nome: 'ja fechou', modo: 'auto' }).thread.id;
    const viva = novaThread(p.carregado, { nome: 'viva', modo: 'auto' }).thread.id;
    adquirir(p.dir, 'path:.orkastery/**', { thread: fechada, motivo: 'limpeza antiga do estado', ttlMs: 60_000 });
    fechar(p.dir, fechada);
    const r = escreverArtefatoMcp(p.dir, viva, 'goal', '# Objetivo\n', lerArtefatoMcp(p.dir, viva, 'goal').sha256);
    assert.equal(r.reciboOficial, false);
    assert.equal(lerArtefatoMcp(p.dir, viva, 'goal').conteudo, '# Objetivo\n');
    assert.equal(lerLease(p.dir, 'path:.orkastery/**'), null);

    // O lease de thread aberta segue barrando, como antes.
    const outra = novaThread(p.carregado, { nome: 'outra viva', modo: 'auto' }).thread.id;
    adquirir(p.dir, 'path:.orkastery/**', { thread: outra, motivo: 'em curso', ttlMs: 60_000 });
    assert.throws(() => escreverArtefatoMcp(p.dir, viva, 'goal', '# De novo\n', lerArtefatoMcp(p.dir, viva, 'goal').sha256), /lease.busy/);
    assert.equal(lerLease(p.dir, 'path:.orkastery/**')?.thread, outra);
  } finally { p.limpar(); }
});
