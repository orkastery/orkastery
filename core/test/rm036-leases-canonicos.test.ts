/**
 * RM-036 (fatia de leases, thread ork-rm036leasesd): todas as familias de lease moram no estado
 * canonico do projeto, como o `exec:` da I-36.
 *
 * O defeito: o `ork` acha a raiz subindo do cwd, e a worktree tem o proprio manifesto. Com os leases
 * em `.orkastery/leases` do checkout de quem chamava, um `ork` da raiz e outro da worktree pegavam o
 * mesmo lease ao mesmo tempo (no HEAD 66b7ee3d, duas threads com o `main-tree`). Cada caso aqui roda o
 * CLI do HEAD em processos filhos, um com cwd na raiz e outro na worktree, num projeto com o manifesto
 * commitado, como o repositorio real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { caminhoFila, caminhoLease, dirLeases, dirsLegadosDeLeases, lerFila, lerLease, listarLeases } from '../src/leases';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { Lease, PedidoNaFila } from '../src/types';
import { commitar, dirTemporario, projetoTemporario, ProjetoDeTeste, shaDaBranch } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

/** O ambiente dos filhos: o do teste (o apoio isola usuario e contas), sem cor e sem o despacho de quem roda. */
function ambiente(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const nome of ['FORCE_COLOR', 'ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDE_CODE_SESSION_ID']) delete env[nome];
  return env;
}

interface Saida { codigo: number | null; stdout: string; stderr: string }

/** Um `ork` do HEAD num processo filho, com o cwd pedido. */
function ork(cwd: string, ...args: string[]): Saida {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: ambiente(), encoding: 'utf8', timeout: 60_000 });
  return { codigo: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** O mesmo, sem esperar: para a corrida e para os pedidos que esperam a vez. */
async function orkEmParalelo(cwd: string, ...args: string[]): Promise<Saida> {
  const filho = spawn(process.execPath, [CLI, ...args], { cwd, env: ambiente(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  filho.stdout.on('data', (b) => { stdout += b; });
  filho.stderr.on('data', (b) => { stderr += b; });
  const [codigo] = await once(filho, 'close');
  return { codigo: codigo as number | null, stdout, stderr };
}

interface Cenario { p: ProjetoDeTeste; raiz: string; wt: string; t1: string; outras: string[] }

/**
 * Projeto com o manifesto commitado (a worktree tem o proprio, e e ele que faz o `ork` da worktree achar
 * a raiz nela), a thread `t1` com worktree e outras threads sem worktree.
 */
function cenario(nome: string, opcoes: { remoto?: boolean; threads?: number } = {}): Cenario {
  const p = projetoTemporario(nome, opcoes.remoto ?? false);
  commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'manifesto');
  const t1 = novaThread(p.carregado, { nome: 'na worktree', modo: 'auto', criarWorktree: true }).thread;
  const outras = Array.from({ length: opcoes.threads ?? 1 },
    (_, i) => novaThread(p.carregado, { nome: `outra ${i + 1}`, modo: 'auto' }).thread.id);
  const wt = t1.worktree as string;
  assert.ok(fs.existsSync(path.join(wt, 'orkastery.yaml')), 'a worktree tem o proprio manifesto');
  return { p, raiz: p.dir, wt, t1: t1.id, outras };
}

/** A pasta de leases que a versao anterior criava dentro da worktree. */
function pastaDaWorktree(wt: string): string {
  return path.join(wt, '.orkastery', 'leases');
}

test('rm036 leases: dominio canonico da raiz e da worktree', () => {
  const c = cenario('rm036-dominio');
  try {
    const canonico = path.join(c.raiz, '.orkastery', 'leases');
    assert.equal(dirLeases(c.raiz), canonico);
    assert.equal(dirLeases(c.wt), canonico, 'chamado da worktree, o domicilio e o da raiz');
    for (const nome of ['main-tree', `worktree-write:${c.t1}`, 'path:core/**', 'board:card-1', 'service:5173', `exec:${c.t1}`]) {
      assert.equal(caminhoLease(c.wt, nome), caminhoLease(c.raiz, nome), nome);
      assert.equal(path.dirname(caminhoLease(c.wt, nome)), canonico, nome);
    }
    assert.equal(caminhoFila(c.wt), path.join(canonico, 'fila.json'));
    // Fora de repositorio git (perfil do board, projeto sem git), a raiz continua sendo a propria.
    const solto = dirTemporario('rm036-sem-git');
    try {
      assert.equal(dirLeases(solto), path.join(solto, '.orkastery', 'leases'));
    } finally { fs.rmSync(solto, { recursive: true, force: true }); }
  } finally { c.p.limpar(); }
});

/** Cada familia: o nome que a raiz pega e um nome que colide, pedido por outra thread. */
const FAMILIAS: { familia: string; pega: (t1: string) => string; colide: (t1: string) => string }[] = [
  { familia: 'main-tree', pega: () => 'main-tree', colide: () => 'main-tree' },
  { familia: 'worktree-write', pega: (t1) => `worktree-write:${t1}`, colide: (t1) => `worktree-write:${t1}` },
  { familia: 'path', pega: () => 'path:core/**', colide: () => 'path:core/src/leases.ts' },
  { familia: 'board', pega: () => 'board:card-7', colide: () => 'board:card-7' },
  { familia: 'service', pega: () => 'service:5173', colide: () => 'service:5173' },
];

for (const f of FAMILIAS) {
  test(`rm036 leases: dois processos ${f.familia}`, () => {
    const c = cenario(`rm036-${f.familia}`);
    try {
      const [t2] = c.outras;
      const nome = f.pega(c.t1), outro = f.colide(c.t1);
      // A raiz pega; a worktree, por outra thread, recusa com o motivo tipado e quem segura.
      const pega = ork(c.raiz, 'lease', 'acquire', nome, '--thread', c.t1);
      assert.equal(pega.codigo, 0, pega.stdout + pega.stderr);
      const recusa = ork(c.wt, 'lease', 'acquire', outro, '--thread', t2);
      assert.equal(recusa.codigo, 1, recusa.stdout + recusa.stderr);
      assert.match(recusa.stderr, /motivo tipado: lease\.busy/);
      assert.match(recusa.stderr, new RegExp(`thread ${c.t1}\\b`));
      assert.equal(fs.existsSync(pastaDaWorktree(c.wt)), false, 'a worktree nao ganha pasta de leases propria');

      // Solto pela worktree (o mesmo arquivo), o sentido contrario: a worktree pega, a raiz recusa.
      const solta = ork(c.wt, 'lease', 'release', nome, '--thread', c.t1);
      assert.equal(solta.codigo, 0, solta.stdout + solta.stderr);
      assert.match(solta.stdout, new RegExp(`liberado; proximo da fila: thread ${t2}\\b`));
      const pegaDaWorktree = ork(c.wt, 'lease', 'acquire', outro, '--thread', t2);
      assert.equal(pegaDaWorktree.codigo, 0, pegaDaWorktree.stdout + pegaDaWorktree.stderr);
      const recusaDaRaiz = ork(c.raiz, 'lease', 'acquire', nome, '--thread', c.t1);
      assert.equal(recusaDaRaiz.codigo, 1, recusaDaRaiz.stdout + recusaDaRaiz.stderr);
      assert.match(recusaDaRaiz.stderr, /motivo tipado: lease\.busy/);
      assert.match(recusaDaRaiz.stderr, new RegExp(`thread ${t2}\\b`));
      assert.equal(lerLease(c.raiz, outro)?.thread, t2);
    } finally { c.p.limpar(); }
  });
}

test('rm036 leases: dois processos ship pela worktree com o main-tree na raiz', () => {
  const c = cenario('rm036-ship', { remoto: true });
  try {
    const [t2] = c.outras;
    commitar(c.wt, 'entrega.md', '# entrega\n', 'feat: entrega da thread');
    const mainAntes = shaDaBranch(c.raiz, 'main');
    // A raiz segura o main-tree, como um ship em curso de outra thread.
    const segura = ork(c.raiz, 'lease', 'acquire', 'main-tree', '--thread', t2, '--motivo', 'ship em curso');
    assert.equal(segura.codigo, 0, segura.stdout + segura.stderr);

    const ship = ork(c.wt, 'ship', c.t1, '--para', 'main');
    assert.equal(ship.codigo, 1, ship.stdout + ship.stderr);
    assert.match(ship.stdout + ship.stderr, /lease\.busy/);
    assert.equal(shaDaBranch(c.raiz, 'main'), mainAntes, 'nada foi mergeado na base');
    const bloqueio = lerLedger(dirThread(c.raiz, c.t1)).filter((e) => e.tipo === 'ship_blocked').at(-1);
    assert.equal(bloqueio?.motivo, 'lease.busy');
    assert.equal(lerLease(c.raiz, 'main-tree')?.thread, t2, 'o main-tree segue com quem o tinha');
    assert.equal(fs.existsSync(pastaDaWorktree(c.wt)), false);
  } finally { c.p.limpar(); }
});

test('rm036 leases: corrida entre raiz e worktree tem um vencedor so', async () => {
  const c = cenario('rm036-corrida', { threads: 6 });
  try {
    const pedidos = c.outras.map(async (thread, i) => {
      const cwd = i % 2 === 0 ? c.raiz : c.wt;
      return { thread, cwd, ...(await orkEmParalelo(cwd, 'lease', 'acquire', 'main-tree', '--thread', thread)) };
    });
    const r = await Promise.all(pedidos);
    const resumo = JSON.stringify(r.map((x) => [x.thread, x.cwd === c.raiz ? 'raiz' : 'worktree', x.codigo]));
    const vencedores = r.filter((x) => x.codigo === 0);
    assert.equal(vencedores.length, 1, resumo);
    for (const x of r.filter((y) => y.codigo !== 0)) {
      assert.equal(x.codigo, 1, resumo);
      assert.match(x.stderr, /motivo tipado: lease\.busy/);
    }
    assert.equal(lerLease(c.raiz, 'main-tree')?.thread, vencedores[0].thread);
    assert.equal(fs.existsSync(pastaDaWorktree(c.wt)), false);
  } finally { c.p.limpar(); }
});

test('rm036 leases: fila unica entre raiz e worktree', () => {
  const c = cenario('rm036-fila', { threads: 2 });
  try {
    const [t2, t3] = c.outras;
    assert.equal(ork(c.raiz, 'lease', 'acquire', 'path:core/**', '--thread', c.t1).codigo, 0);
    const daWorktree = ork(c.wt, 'lease', 'acquire', 'path:core/src/a.ts', '--thread', t2);
    assert.equal(daWorktree.codigo, 1, daWorktree.stdout + daWorktree.stderr);
    assert.match(daWorktree.stderr, /posicao na fila: 1/);
    const daRaiz = ork(c.raiz, 'lease', 'acquire', 'path:core/**', '--thread', t3);
    assert.equal(daRaiz.codigo, 1, daRaiz.stdout + daRaiz.stderr);
    assert.match(daRaiz.stderr, /posicao na fila: 2/);

    const lista = ork(c.raiz, 'lease', 'list');
    assert.equal(lista.codigo, 0, lista.stderr);
    assert.match(lista.stdout, /Fila por colisao de regiao: 2 na espera/);
    const primeiro = lista.stdout.indexOf(`thread ${t2} quer path:core/src/a.ts`);
    const segundo = lista.stdout.indexOf(`thread ${t3} quer path:core/**`);
    assert.ok(primeiro >= 0 && segundo > primeiro, lista.stdout);

    const solta = ork(c.wt, 'lease', 'release', 'path:core/**', '--thread', c.t1);
    assert.equal(solta.codigo, 0, solta.stdout + solta.stderr);
    assert.match(solta.stdout, new RegExp(`proximo da fila: thread ${t2}\\b`));
    assert.equal(fs.existsSync(pastaDaWorktree(c.wt)), false);
  } finally { c.p.limpar(); }
});

// ---------------------------------------------------------------------------
// Legado: o que a versao anterior gravou no `.orkastery/leases` de uma worktree (D2 e D3 do PLAN).
// ---------------------------------------------------------------------------

/** Lease com o prazo em minutos a partir de agora: positivo vivo, negativo vencido. */
function leaseDe(nome: string, thread: string, minutos: number): Lease {
  const agora = Date.now();
  return { nome, thread, motivo: 'gravado pela versao anterior', pid: 4242,
    adquiridoEm: new Date(agora - 60_000).toISOString(), expiraEm: new Date(agora + minutos * 60_000).toISOString() };
}

/** Grava o lease como a versao anterior gravava quando o `ork` rodava na worktree. */
function gravarLegado(wt: string, lease: Lease): string {
  fs.mkdirSync(pastaDaWorktree(wt), { recursive: true });
  const arquivo = path.join(pastaDaWorktree(wt), `${encodeURIComponent(lease.nome)}.json`);
  fs.writeFileSync(arquivo, JSON.stringify(lease, null, 2) + '\n', 'utf8');
  return arquivo;
}

test('rm036 leases: legado vivo vale ate vencer', () => {
  const c = cenario('rm036-legado-vivo');
  try {
    const [t2] = c.outras;
    assert.deepEqual(dirsLegadosDeLeases(c.raiz), [], 'sem pasta na worktree, nada de legado');
    // A propria thread nao ganha a segunda copia: o nome ja esta tomado pelo legado vivo.
    const escrita = `worktree-write:${c.t1}`;
    const arquivo = gravarLegado(c.wt, leaseDe(escrita, c.t1, 20));
    assert.deepEqual(dirsLegadosDeLeases(c.raiz), [pastaDaWorktree(c.wt)]);
    assert.deepEqual(dirsLegadosDeLeases(c.wt), [pastaDaWorktree(c.wt)], 'da worktree, a mesma lista');
    const mesma = ork(c.raiz, 'lease', 'acquire', escrita, '--thread', c.t1);
    assert.equal(mesma.codigo, 1, mesma.stdout + mesma.stderr);
    assert.match(mesma.stderr, /motivo tipado: lease\.busy/);
    assert.equal(fs.existsSync(caminhoLease(c.raiz, escrita)), false, 'nenhuma copia canonica nasceu');
    assert.ok(fs.existsSync(arquivo), 'o legado segue onde estava');
    assert.equal(lerLease(c.raiz, escrita)?.thread, c.t1, 'a leitura acha o legado');

    // Outra thread, pela raiz, numa regiao que cruza a do legado: recusa com quem segura.
    gravarLegado(c.wt, leaseDe('path:docs/**', c.t1, 20));
    const regiao = ork(c.raiz, 'lease', 'acquire', 'path:docs/guias/modos.md', '--thread', t2);
    assert.equal(regiao.codigo, 1, regiao.stdout + regiao.stderr);
    assert.match(regiao.stderr, /motivo tipado: lease\.busy/);
    assert.match(regiao.stderr, new RegExp(`thread ${c.t1}\\b`));

    // O `ork lease list` mostra os dois, marcados como legado.
    const lista = ork(c.wt, 'lease', 'list');
    assert.equal(lista.codigo, 0, lista.stderr);
    assert.match(lista.stdout, new RegExp(`${escrita}.*ativo`));
    assert.match(lista.stdout, /path:docs\/\*\*.*ativo/);
    assert.equal((lista.stdout.match(/legado: /g) ?? []).length, 2, lista.stdout);
  } finally { c.p.limpar(); }
});

test('rm036 leases: legado vencido e tomado sem segunda copia', () => {
  const c = cenario('rm036-legado-vencido');
  try {
    const [t2] = c.outras;
    const nome = 'path:core/**';
    const arquivo = gravarLegado(c.wt, leaseDe(nome, c.t1, -5));
    const r = ork(c.raiz, 'lease', 'acquire', nome, '--thread', t2);
    assert.equal(r.codigo, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /VENCIDO e foi tomado/);
    assert.equal(fs.existsSync(arquivo), false, 'o legado vencido saiu');
    assert.equal(lerLease(c.raiz, nome)?.thread, t2);
    assert.deepEqual(listarLeases(c.raiz).filter((l) => l.nome === nome).map((l) => l.thread), [t2], 'uma copia so, a canonica');
  } finally { c.p.limpar(); }
});

test('rm036 leases: legado solto pela thread ou com --forcar', () => {
  const c = cenario('rm036-legado-solto');
  try {
    const [t2] = c.outras;
    const proprio = gravarLegado(c.wt, leaseDe('path:docs/**', c.t1, 20));
    const solta = ork(c.raiz, 'lease', 'release', 'path:docs/**', '--thread', c.t1);
    assert.equal(solta.codigo, 0, solta.stdout + solta.stderr);
    assert.match(solta.stdout, /lease path:docs\/\*\* liberado/);
    assert.equal(fs.existsSync(proprio), false, 'a thread solta o proprio legado pela raiz');

    const alheio = gravarLegado(c.wt, leaseDe('board:card-3', c.t1, 20));
    const negado = ork(c.raiz, 'lease', 'release', 'board:card-3', '--thread', t2);
    assert.equal(negado.codigo, 1, negado.stdout + negado.stderr);
    assert.match(negado.stdout, new RegExp(`pertence a thread ${c.t1}\\b`));
    assert.ok(fs.existsSync(alheio), 'sem --forcar, o legado de outra thread fica');
    const forcado = ork(c.wt, 'lease', 'release', 'board:card-3', '--forcar');
    assert.equal(forcado.codigo, 0, forcado.stdout + forcado.stderr);
    assert.equal(fs.existsSync(alheio), false, '--forcar tira o legado de outra thread');
  } finally { c.p.limpar(); }
});

test('rm036 leases: fila legada entra na canonica em FIFO', () => {
  const c = cenario('rm036-fila-legada', { threads: 4 });
  try {
    const [t2, t3, t4, t5] = c.outras;
    const base = Date.now() - 600_000;
    const quando = (segundos: number) => new Date(base + segundos * 1000).toISOString();
    const pedido = (thread: string, nome: string, segundos: number): PedidoNaFila => ({ nome, tipo: 'path', thread,
      motivo: 'GO', desdeEm: quando(segundos), colidiuCom: 'path:core/**', bloqueadaPor: c.t1 });
    assert.equal(ork(c.raiz, 'lease', 'acquire', 'path:core/**', '--thread', c.t1).codigo, 0);
    // Canonica: t4 espera desde 20 s. Legada, na worktree: t2 desde 10 s, t3 desde 30 s e t4 de novo, desde 40 s.
    fs.writeFileSync(caminhoFila(c.raiz), JSON.stringify([pedido(t4, 'path:core/b.ts', 20)], null, 2) + '\n');
    const legada = path.join(pastaDaWorktree(c.wt), 'fila.json');
    fs.mkdirSync(path.dirname(legada), { recursive: true });
    fs.writeFileSync(legada, JSON.stringify([pedido(t2, 'path:core/a.ts', 10), pedido(t3, 'path:core/c.ts', 30),
      pedido(t4, 'path:core/b.ts', 40)], null, 2) + '\n');

    // A leitura ja une as duas, em FIFO, sem gravar nada.
    assert.deepEqual(lerFila(c.raiz).map((p) => p.thread), [t2, t4, t3]);
    assert.ok(fs.existsSync(legada), 'ler nao apaga a fila legada');

    // A primeira gravacao: t5 pede pela worktree e entra atras dos tres; a legada sai.
    const r = ork(c.wt, 'lease', 'acquire', 'path:core/**', '--thread', t5);
    assert.equal(r.codigo, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /posicao na fila: 4/);
    assert.equal(fs.existsSync(legada), false, 'a fila legada saiu na primeira gravacao');
    const fila = JSON.parse(fs.readFileSync(caminhoFila(c.raiz), 'utf8')) as PedidoNaFila[];
    assert.deepEqual(fila.map((p) => p.thread), [t2, t4, t3, t5]);
    assert.equal(fila.find((p) => p.thread === t4)?.desdeEm, quando(20), 'fica a espera mais antiga');
    // Gravacao atomica: nenhum temporario fica para tras na pasta.
    assert.deepEqual(fs.readdirSync(dirLeases(c.raiz)).filter((f) => f.endsWith('.tmp')), []);
  } finally { c.p.limpar(); }
});
