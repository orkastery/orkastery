/**
 * RM-037 (fatia 3, defeito 4), com o MCP real: o `ork_git_commit` recusava com `mcp.git.lease.busy` o
 * arquivo cujo lease vencido era de uma thread ja fechada (a ork-companybrai3, em 29/09). Integracao
 * local, como o `mcp-git.test.ts`: o worker do commit e o sandbox do verify rodam de verdade.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { adicionarClaim } from '../src/claims';
import { adquirir, enfileirar, lerFila, lerLease } from '../src/leases';
import { lerLedger } from '../src/ledger';
import { commitMcp } from '../src/mcp-git';
import { verificarMcp } from '../src/mcp-verify';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

const ARQUIVO = 'docs/compartilhado.md';

async function comHomeIsolado(fn: () => Promise<void>): Promise<void> {
  const home = dirTemporario('rm037-f3-lease-home'), anterior = process.env.HOME, xdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = path.join(home, 'xdg');
  try { await fn(); } finally {
    if (anterior === undefined) delete process.env.HOME; else process.env.HOME = anterior;
    if (xdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = xdg;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function fechar(raiz: string, id: string): void {
  const t = lerThread(raiz, id);
  t.status = 'fechada';
  t.faseAtual = 'MASTER';
  gravarThread(raiz, t);
}

/** A thread viva com worktree e o arquivo pronto para o commit, com a claim que o MCP exige. */
function threadViva(p: ReturnType<typeof projetoTemporario>) {
  const viva = novaThread(p.carregado, { nome: 'thread viva', modo: 'auto', criarWorktree: true }).thread;
  gravarThread(p.dir, viva);
  const wt = viva.worktree as string;
  fs.mkdirSync(path.join(wt, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(wt, ARQUIVO), 'conteudo da thread viva\n');
  adicionarClaim(p.dir, viva.id, { arquivo: ARQUIVO, alegacao: 'o arquivo da thread viva', fase: 'GO', verificar: ['true'] });
  const head = exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim();
  return { viva, wt, pedido: { threadId: viva.id, expectedHead: head, paths: [ARQUIVO], mensagem: 'commit da thread viva' } };
}

test('defeito 4: o commit pelo MCP solta o lease vencido e a fila da thread fechada e commita', () => comHomeIsolado(async () => {
  const p = projetoTemporario('rm037-f3-lease-mcp');
  try {
    const fechada = novaThread(p.carregado, { nome: 'thread fechada', modo: 'auto' }).thread.id;
    adquirir(p.dir, `path:${ARQUIVO}`, { thread: fechada, motivo: 'GO de uma thread que ja fechou', ttlMs: -1 });
    enfileirar(p.dir, `path:${ARQUIVO}`, { thread: fechada, motivo: 'MCP git_commit delimitado', colidiuCom: `path:${ARQUIVO}`, bloqueadaPor: 'ork-x' });
    fechar(p.dir, fechada);
    const { viva, wt, pedido } = threadViva(p);

    const r = await commitMcp(p.dir, pedido);
    assert.equal(r.ok, true, r.erro ?? '');
    assert.match(r.commit!, /^[a-f0-9]{40}$/);
    assert.equal(exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim(), r.commit);
    assert.equal(lerLease(p.dir, `path:${ARQUIVO}`), null, 'o lease da fechada saiu, e o proprio do commit foi solto');
    assert.deepEqual(lerFila(p.dir), []);
    const eventos = lerLedger(dirThread(p.dir, fechada));
    assert.deepEqual(eventos.filter((e) => e.tipo === 'lease_released').map((e) => [e.lease, e.origem, e.pedidaPor]),
      [[`path:${ARQUIVO}`, 'poda', viva.id]]);
    assert.equal(eventos.filter((e) => e.tipo === 'lease_dequeued').length, 1);
  } finally { p.limpar(); }
}));

test('defeito 4: lease vencido de thread aberta segue barrando o commit pelo MCP, preservado', () => comHomeIsolado(async () => {
  const p = projetoTemporario('rm037-f3-lease-mcp-aberta');
  try {
    const aberta = novaThread(p.carregado, { nome: 'thread aberta', modo: 'auto' }).thread.id;
    const lease = adquirir(p.dir, `path:${ARQUIVO}`, { thread: aberta, motivo: 'GO em curso', ttlMs: -1 }).lease;
    const { pedido } = threadViva(p);
    const r = await commitMcp(p.dir, pedido);
    assert.equal(r.ok, false);
    assert.match(String(r.erro), /mcp\.git\.lease\.busy/);
    assert.deepEqual(lerLease(p.dir, `path:${ARQUIVO}`), lease);
  } finally { p.limpar(); }
}));

test('defeito 4: o verify pelo MCP nao trava no main-tree ativo de thread fechada', () => comHomeIsolado(async () => {
  const p = projetoTemporario('rm037-f3-lease-mcp-verify');
  try {
    const fechada = novaThread(p.carregado, { nome: 'ship que caiu', modo: 'auto' }).thread.id;
    adquirir(p.dir, 'main-tree', { thread: fechada, motivo: 'SHIP que caiu antes do fechamento', ttlMs: 60_000 });
    fechar(p.dir, fechada);
    const { viva } = threadViva(p);
    const r = verificarMcp(p.dir, viva.id);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(lerLease(p.dir, 'main-tree'), null);
  } finally { p.limpar(); }
}));
