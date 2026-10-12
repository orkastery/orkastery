/**
 * RM-008 (03/10/2026): o aceite por omissao com a thread indicada.
 *
 * Na madrugada de 03/10, tres vezes, um condutor rodou `ork master --aceitar-omissao` para fechar a
 * PROPRIA thread, e o comando fechou tambem as entregues de outras frentes paralelas
 * (ork-rm057fatia3t, ork-rm025modocon e outras). A CLI nao deixava indicar a thread: o posicional era
 * ignorado e `--aceitar-omissao <thread>` caia na tabela. Os condutores tiveram de chamar
 * `aceitarPorOmissao(<thread>)` direto no nucleo.
 *
 * Cada teste aqui reprova o codigo anterior: o posicional, o `--thread` e o `--aceitar-omissao=<thread>`
 * fechavam todas (ou nenhuma), o `--dry-run` gravava, e o `registrar-pr` ensinava a forma sem thread.
 * Sem thread, o padrao continua (decisao registrada): drena todas, lista cada uma e avisa o agente.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { commitar, projetoTemporario } from './apoio';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { masterRatificado } from '../src/master';
import { marcaDeHost } from '../src/master-nota';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const MARCAS = ['ORK_CANAL', 'CLAUDECODE', 'HERMES_HOME', 'ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED', 'ORK_PROJETO'];

/** O dono no terminal: sem marca de host no ambiente. */
function terminal(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ORK_FABRICA_PUBLICAR: '0' };
  for (const n of MARCAS) delete env[n];
  return { ...env, ...extra };
}

const ork = (cwd: string, args: string[], env: NodeJS.ProcessEnv = terminal()) =>
  spawnSync(process.execPath, [ORK, ...args], { cwd, encoding: 'utf8', env });

/** Uma thread que entregou de verdade, do ponto de vista do ledger. */
function entregou(p: ReturnType<typeof projetoTemporario>, nome: string) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', slug: 'x' });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, {
    fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true,
  });
  return thread;
}

const aceites = (raiz: string, id: string) =>
  lerLedger(dirThread(raiz, id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao).length;

/** Tres frentes paralelas entregues: a do condutor e duas de outros. */
function tresFrentes(nome: string) {
  const p = projetoTemporario(nome);
  const minha = entregou(p, 'minha frente');
  const outra = entregou(p, 'outra frente');
  const terceira = entregou(p, 'terceira frente');
  return { p, minha, outra, terceira };
}

for (const [rotulo, montar] of [
  ['posicional', (id: string) => ['master', id, '--aceitar-omissao']],
  ['--thread', (id: string) => ['master', '--aceitar-omissao', '--thread', id]],
  ['--aceitar-omissao <thread>', (id: string) => ['master', '--aceitar-omissao', id]],
  ['--aceitar-omissao=<thread>', (id: string) => [`master`, `--aceitar-omissao=${id}`]],
] as const) {
  test(`aceitar por omissao com a thread (${rotulo}) fecha so ela; as outras frentes ficam abertas`, () => {
    const { p, minha, outra, terceira } = tresFrentes(`omissao-alvo-${rotulo.replace(/[^a-z]/g, '')}`);
    try {
      // De dentro de um agente, que e onde o acidente aconteceu.
      const r = ork(p.dir, montar(minha.id), terminal({ CLAUDECODE: '1' }));
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /Aceitas por omissao: 1\./);
      assert.match(r.stdout, new RegExp(`^  ${minha.id}\\s+indice 5/5$`, 'm'));
      assert.equal(masterRatificado(p.dir, minha.id), true, 'a minha fechou');
      assert.equal(aceites(p.dir, outra.id), 0, 'a outra frente nao foi tocada');
      assert.equal(aceites(p.dir, terceira.id), 0, 'a terceira frente nao foi tocada');
      assert.equal(masterRatificado(p.dir, outra.id), false);
      assert.doesNotMatch(r.stderr, /omissao-sem-thread/, 'com a thread, nao ha o que avisar');
    } finally { p.limpar(); }
  });
}

test('--dry-run lista o que seria fechado e nao grava nada, com e sem thread', () => {
  const { p, minha, outra, terceira } = tresFrentes('omissao-alvo-ensaio');
  try {
    const todas = ork(p.dir, ['master', '--aceitar-omissao', '--dry-run']);
    assert.equal(todas.status, 0, todas.stdout + todas.stderr);
    assert.match(todas.stdout, /^Ensaio \(--dry-run\): nada foi gravado\.$/m);
    assert.match(todas.stdout, /Fecharia por omissao: 3\./);
    for (const t of [minha, outra, terceira]) assert.match(todas.stdout, new RegExp(`^  ${t.id}\\s+indice 5/5$`, 'm'));

    const so = ork(p.dir, ['master', minha.id, '--aceitar-omissao', '--dry-run', '--json']);
    assert.equal(so.status, 0, so.stderr);
    const json = JSON.parse(so.stdout) as { dryRun: boolean; fecharia: { thread: string }[] };
    assert.equal(json.dryRun, true);
    assert.deepEqual(json.fecharia.map((f) => f.thread), [minha.id]);

    for (const t of [minha, outra, terceira]) {
      assert.equal(aceites(p.dir, t.id), 0, `o ensaio nao grava aceite em ${t.id}`);
      assert.equal(masterRatificado(p.dir, t.id), false);
    }
  } finally { p.limpar(); }
});

test('sem thread, o padrao continua: fecha todas e lista cada uma; de agente com mais de uma, avisa em stderr', () => {
  const { p, minha, outra, terceira } = tresFrentes('omissao-alvo-padrao-agente');
  try {
    const r = ork(p.dir, ['master', '--aceitar-omissao'], terminal({ CLAUDECODE: '1', ORK_DISPATCH_THREAD: minha.id }));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Aceitas por omissao: 3\./);
    for (const t of [minha, outra, terceira]) {
      assert.match(r.stdout, new RegExp(`^  ${t.id}\\s+indice`, 'm'), `a saida lista ${t.id}`);
      assert.equal(masterRatificado(p.dir, t.id), true, 'o padrao nao mudou: todas fecham');
    }
    assert.match(r.stderr, /aviso: master\.omissao-sem-thread: processo de agente \(claude-code\) fechou 3 threads/);
    assert.match(r.stderr, new RegExp(`Para fechar so a sua: ork master ${minha.id} --aceitar-omissao`));
  } finally { p.limpar(); }
});

test('sem thread, do terminal do dono, nao ha aviso; e o --json continua sendo a lista de sempre', () => {
  const { p, minha, outra, terceira } = tresFrentes('omissao-alvo-padrao-dono');
  try {
    const r = ork(p.dir, ['master', '--aceitar-omissao', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), '');
    const lista = JSON.parse(r.stdout) as { thread: string }[];
    assert.ok(Array.isArray(lista));
    assert.deepEqual(lista.map((a) => a.thread).sort(), [minha.id, outra.id, terceira.id].sort());
  } finally { p.limpar(); }
});

test('de agente, sem thread e com uma entrega so, nao avisa: nao havia outra frente para fechar', () => {
  const p = projetoTemporario('omissao-alvo-uma');
  try {
    const t = entregou(p, 'unica');
    const r = ork(p.dir, ['master', '--aceitar-omissao'], terminal({ CLAUDECODE: '1' }));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(masterRatificado(p.dir, t.id), true);
    assert.doesNotMatch(r.stderr, /omissao-sem-thread/);
  } finally { p.limpar(); }
});

test('a thread indicada que nao entregou recusa sem gravar; a ja fechada e idempotente; duas threads recusam', () => {
  const p = projetoTemporario('omissao-alvo-recusas');
  try {
    const crua = novaThread(p.carregado, { nome: 'sem entrega', modo: 'auto' }).thread;
    const outra = entregou(p, 'outra');
    const semEntrega = ork(p.dir, ['master', crua.id, '--aceitar-omissao']);
    assert.equal(semEntrega.status, 1, semEntrega.stdout + semEntrega.stderr);
    assert.match(semEntrega.stderr, new RegExp(`ainda nao entregou.*ork ship registrar-pr ${crua.id}`));
    assert.equal(aceites(p.dir, outra.id), 0, 'recusar a minha nao fecha a dos outros');

    const duas = ork(p.dir, ['master', crua.id, '--aceitar-omissao', '--thread', outra.id]);
    assert.equal(duas.status, 2);
    assert.equal(aceites(p.dir, outra.id), 0);

    const inexistente = ork(p.dir, ['master', 'ork-naoexiste', '--aceitar-omissao']);
    assert.notEqual(inexistente.status, 0);
    assert.match(inexistente.stderr, /nao encontrada/);

    assert.equal(ork(p.dir, ['master', outra.id, '--aceitar-omissao']).status, 0);
    const deNovo = ork(p.dir, ['master', outra.id, '--aceitar-omissao']);
    assert.equal(deNovo.status, 0);
    assert.match(deNovo.stdout, /ja tem MASTER registrado; nada a aceitar/);
    assert.equal(aceites(p.dir, outra.id), 1, 'o segundo aceite nao grava outro evento');
  } finally { p.limpar(); }
});

test('a marca de agente e a mesma do master.prova-de-canal', () => {
  assert.equal(marcaDeHost({}), undefined);
  assert.equal(marcaDeHost({ CLAUDECODE: '1' }), 'claude-code');
  assert.equal(marcaDeHost({ ORK_CANAL: 'cli', CLAUDECODE: '1' }), 'claude-code (CLAUDECODE)');
  assert.match(String(marcaDeHost({ ORK_CANAL: 'cli', ORK_DISPATCH_ID: '11111111-1111-4111-8111-111111111111' })), /ORK_DISPATCH_ID/);
});

test('ship registrar-pr ensina a forma COM a thread', () => {
  const p = projetoTemporario('omissao-alvo-registrar-pr', true);
  try {
    const t = novaThread(p.carregado, { nome: 'entrega por pr', modo: 'auto' }).thread;
    const git = (...a: string[]) => assert.equal(exec('git', a, p.dir).ok, true, a.join(' '));
    git('checkout', '-q', '-b', `ork/${t.slug}`);
    commitar(p.dir, 'entrega.txt', 'entrega\n', 'entrega da thread');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', `ork/${t.slug}`, '-m', `ship(${t.id}): entrega por PR`);
    git('push', '-q', 'origin', 'main');
    const r = ork(p.dir, ['ship', 'registrar-pr', t.id]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^  ork master ${t.id} --aceitar-omissao$`, 'm'));
    assert.doesNotMatch(r.stdout, /ork master --aceitar-omissao/, 'a forma sem thread fechava as frentes alheias');
  } finally { p.limpar(); }
});
