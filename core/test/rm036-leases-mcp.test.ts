/** R5: a fila do main-tree nao interrompe claims/documentos de outras threads. */
import { test, TestContext } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { adquirir, caminhoLease, lerLease, regravarLease } from '../src/leases';
import { adicionarClaimMcp, escreverArtefatoMcp, lerArtefatoMcp, listarClaimsMcp } from '../src/mcp-artifacts';
import { metadadosGitMcp } from '../src/mcp-git';
import { gravarThread } from '../src/thread';
import { Thread } from '../src/types';

function fixture(t: TestContext) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm036-mcp-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  fs.writeFileSync(path.join(raiz, 'orkastery.yaml'), 'project:\n  name: fixture\n  abbrev: ork\n');
  const id = 'ork-documentos', agora = new Date().toISOString();
  const thread: Thread = { id, slug: id, nome: 'fixture', assunto: 'documentos', modo: 'auto',
    fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'],
    blocos: [{ fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'], pausa: false, pausaSobre: '', slugFases: 'full' }], faseAtual: 'GOAL', status: 'aberta',
    criadaEm: agora, atualizadaEm: agora, projeto: { name: 'fixture', abbrev: 'ork' },
    base: { branch: 'main', commit: 'fixture' }, worktree: null, sessoes: [], decisoes: [], claims: [], leases: [], baseline: null };
  gravarThread(raiz, thread);
  const arquivo = caminhoLease(raiz, 'main-tree'), fila = `${arquivo}.retomadas`;
  regravarLease(raiz, { nome: 'main-tree', thread: 'ork-antiga', motivo: 'fixture', pid: process.pid,
    adquiridoEm: agora, expiraEm: new Date(Date.now() - 1_000).toISOString() });
  const escrever = (texto: string) => {
    const anterior = lerArtefatoMcp(raiz, id, 'goal');
    const doc = escreverArtefatoMcp(raiz, id, 'goal', texto, anterior.sha256);
    assert.equal(doc.reciboOficial, false);
    assert.equal(lerArtefatoMcp(raiz, id, 'goal').conteudo, texto);
    const claim = adicionarClaimMcp(raiz, id, { arquivo: 'core/src/leases.ts', alegacao: texto, verificar: ['true'] });
    assert.equal(claim.estado, 'pendente');
    assert.equal(listarClaimsMcp(raiz, id).at(-1)?.id, claim.id);
  };
  return { raiz, id, arquivo, fila, escrever };
}

for (const transporte of ['flock', 'portatil']) {
  test(`rm036 mcp: R5 claim e documento durante e depois da retomada ${transporte}`, (t) => {
    const c = fixture(t), cp = require('node:child_process'), spawn = cp.spawnSync;
    const inode = fs.statSync(c.arquivo).ino;
    let chamadas = 0;
    t.mock.method(cp, 'spawnSync', (cmd: string, args: string[], opts: any) => {
      if (cmd === '/usr/bin/flock' && fs.fstatSync(opts.stdio[3]).ino === inode) {
        chamadas++;
        if (transporte === 'portatil') return { status: null, error: Object.assign(Error('ausente'), { code: 'ENOENT' }) };
      }
      return spawn(cmd, args, opts);
    });
    const io = require('node:fs'), apagar = io.unlinkSync;
    let durante = false;
    t.mock.method(io, 'unlinkSync', (p: fs.PathLike) => {
      if (String(p) === c.arquivo && !durante) {
        assert.equal(fs.readdirSync(c.fila).length, 1);
        c.escrever('Durante a retomada');
        durante = true;
      }
      return apagar(p);
    });
    const r = adquirir(c.raiz, 'main-tree', { thread: 'ork-nova', motivo: 'retomar' });
    assert.equal(r.ok, true);
    assert.equal(r.tomadoDeVencido, true);
    assert.equal(durante, true);
    assert.equal(chamadas, 1);
    assert.equal(fs.existsSync(c.fila), false, 'pasta vazia removida');
    c.escrever('Depois da retomada');
    assert.equal(listarClaimsMcp(c.raiz, c.id).length, 2);
    assert.equal(lerLease(c.raiz, 'main-tree')?.thread, 'ork-nova');
  });
}

test('rm036 mcp: R5 pasta vazia da versao anterior e temporario regular sao aceitos', (t) => {
  const c = fixture(t);
  fs.mkdirSync(c.fila);
  c.escrever('Fila antiga vazia');
  fs.writeFileSync(path.join(c.fila, `${process.pid}-00000000-0000-4000-8000-000000000000.json.tmp`), '');
  c.escrever('Publicacao em curso');
});

for (const tipo of ['pasta-arbitraria', 'fila-symlink', 'candidato-symlink', 'candidato-hardlink', 'subpasta', 'nome-invalido']) {
  test(`rm036 mcp: R5 recusa ${tipo} sem escrever fora da fila`, (t) => {
    const c = fixture(t), alvo = path.join(c.raiz, 'sentinela');
    fs.writeFileSync(alvo, 'intacto');
    fs.mkdirSync(c.fila);
    const candidato = path.join(c.fila, `${process.pid}-00000000-0000-4000-8000-000000000000.json`);
    if (tipo === 'pasta-arbitraria') fs.renameSync(c.fila, path.join(path.dirname(c.fila), 'arbitraria'));
    if (tipo === 'fila-symlink') {
      // Fora de leases: a recusa deve vir do link, nao de uma pasta irma arbitraria.
      const real = path.join(c.raiz, 'fila-real');
      fs.renameSync(c.fila, real);
      fs.symlinkSync(real, c.fila);
    }
    if (tipo === 'candidato-symlink') fs.symlinkSync(alvo, candidato);
    if (tipo === 'candidato-hardlink') fs.linkSync(alvo, candidato);
    if (tipo === 'subpasta') fs.mkdirSync(candidato);
    if (tipo === 'nome-invalido') fs.writeFileSync(path.join(c.fila, 'intruso'), '');
    assert.throws(() => c.escrever('recusado'), /mcp.state.unsafe/);
    assert.equal(fs.readFileSync(alvo, 'utf8'), 'intacto');
    assert.equal(listarClaimsMcp(c.raiz, c.id).length, 0);
    assert.equal(lerArtefatoMcp(c.raiz, c.id, 'goal').conteudo, null);
  });
}

// Commit e SHIP usam esta mesma varredura; as corridas nao dependem de subprocessos.
for (const caso of ['fila-lstat', 'candidato-lstat', 'fila-readdir']) {
  test(`rm036 mcp: R6 metadados toleram ENOENT transitorio em ${caso}`, (t) => {
    const c = fixture(t), pastaLeases = path.dirname(c.fila);
    fs.mkdirSync(c.fila);
    const entrada = caso === 'candidato-lstat'
      ? path.join(c.fila, `${process.pid}-00000000-0000-4000-8000-000000000000.json`) : c.fila;
    if (caso === 'candidato-lstat') fs.writeFileSync(entrada, '{}');
    const io = require('node:fs') as typeof fs;
    const metodo = caso === 'fila-readdir' ? 'readdirSync' : 'lstatSync', original = io[metodo];
    let removeu = false;
    t.mock.method(io, metodo, (...args: unknown[]) => {
      if (String(args[0]) === entrada && !removeu) {
        // A entrada ja foi enumerada; desaparece antes da consulta seguinte.
        removeu = true;
        if (caso === 'candidato-lstat') fs.unlinkSync(entrada);
        else fs.rmdirSync(entrada);
      }
      return Reflect.apply(original, io, args);
    });
    assert.doesNotThrow(() => metadadosGitMcp(path.dirname(pastaLeases), pastaLeases));
    assert.equal(removeu, true, 'interceptou a janela real da varredura');
    assert.equal(fs.existsSync(entrada), false);
    assert.equal(lerLease(c.raiz, 'main-tree')?.thread, 'ork-antiga');
    // Tolerar desaparecimento nao autoriza um link que continua presente.
    fs.symlinkSync(c.raiz, path.join(pastaLeases, 'link-inseguro'));
    assert.throws(() => metadadosGitMcp(path.dirname(pastaLeases), pastaLeases), /metadata.unsafe: link simbolico/);
  });
}

for (const metodo of ['lstatSync', 'readdirSync'] as const) {
  test(`rm036 mcp: R6 metadados preservam EACCES em ${metodo}`, (t) => {
    const c = fixture(t), pastaLeases = path.dirname(c.fila);
    fs.mkdirSync(c.fila);
    const io = require('node:fs') as typeof fs, original = io[metodo];
    const negado = Object.assign(Error('leitura negada'), { code: 'EACCES' });
    let consultas = 0;
    t.mock.method(io, metodo, (...args: unknown[]) => {
      if (String(args[0]) === c.fila) { consultas++; throw negado; }
      return Reflect.apply(original, io, args);
    });
    assert.throws(() => metadadosGitMcp(path.dirname(pastaLeases), pastaLeases), (e: unknown) => e === negado);
    assert.equal(consultas, 1);
    assert.equal(fs.existsSync(c.fila), true);
  });
}

/** Nome real, nunca um mock da decodificacao do readdir. Nem todo filesystem admite esses bytes. */
function criarNomeForaDeUtf8(t: Pick<TestContext, 'skip'>, dir: string, pasta: boolean): Buffer | null {
  const alvo = Buffer.concat([Buffer.from(path.join(dir, 'invalido-')), Buffer.from([0xff]),
    Buffer.from(pasta ? '.json.retomadas' : '.json')]);
  try {
    if (pasta) fs.mkdirSync(alvo);
    else fs.writeFileSync(alvo, '{}');
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    if (!['EINVAL', 'EILSEQ', 'ENOTSUP', 'EOPNOTSUPP'].includes(codigo ?? '')) throw e;
    t.skip(`sistema de arquivos recusou criar nome fora de UTF-8 (${codigo})`);
    return null;
  }
  assert.equal(fs.readdirSync(dir, { encoding: 'buffer' }).some((nome) => nome.equals(alvo.subarray(Buffer.byteLength(dir + path.sep)))), true);
  assert.equal(fs.lstatSync(alvo).isDirectory(), pasta, 'entrada real existe com os bytes originais');
  return alvo;
}

for (const pasta of [false, true]) {
  test(`rm036 mcp: R8 fixture sem pasta-mae falha sem skip (${pasta ? 'pasta' : 'arquivo'})`, (t) => {
    const c = fixture(t);
    let pulos = 0;
    // Um observador separado impede que a regressao pule este proprio teste.
    const contexto = { skip: () => { pulos++; } };
    assert.throws(() => criarNomeForaDeUtf8(contexto, path.join(c.raiz, 'ausente'), pasta), { code: 'ENOENT' });
    assert.equal(pulos, 0, 'ENOENT da fixture nunca indica filesystem incompativel');
  });
}

for (const tipo of ['arquivo', 'subarvore']) {
  test(`rm036 mcp: R7 metadados recusam ${tipo} fora de UTF-8 antes de lstat`, (t) => {
    const c = fixture(t), pastaLeases = path.dirname(c.fila);
    const alvo = criarNomeForaDeUtf8(t, pastaLeases, tipo === 'subarvore');
    if (!alvo) return;
    if (tipo === 'subarvore') {
      fs.symlinkSync(c.raiz, Buffer.concat([alvo, Buffer.from(path.sep + 'link-inseguro')]));
    }
    assert.throws(() => metadadosGitMcp(path.dirname(pastaLeases), pastaLeases), /metadata.unsafe: nome fora de UTF-8/);
    assert.equal(fs.lstatSync(alvo).isDirectory(), tipo === 'subarvore');
    assert.equal(lerLease(c.raiz, 'main-tree')?.thread, 'ork-antiga');
  });
}

for (const tipo of ['lease', 'fila', 'candidato']) {
  for (const operacao of ['documento', 'claim']) {
    test(`rm036 mcp: R7 ${operacao} recusa ${tipo} fora de UTF-8 sem escrita`, (t) => {
      const c = fixture(t);
      if (tipo === 'candidato') fs.mkdirSync(c.fila);
      const alvo = criarNomeForaDeUtf8(t, tipo === 'candidato' ? c.fila : path.dirname(c.fila), tipo === 'fila');
      if (!alvo) return;
      const escrever = () => operacao === 'documento'
        ? escreverArtefatoMcp(c.raiz, c.id, 'goal', 'recusado', null)
        : adicionarClaimMcp(c.raiz, c.id, { arquivo: 'core/src/leases.ts', alegacao: 'recusado', verificar: ['true'] });
      assert.throws(escrever, /mcp.state.unsafe: nome fora de UTF-8/);
      assert.equal(fs.existsSync(alvo), true, 'nome ilegivel nao foi removido');
      assert.equal(listarClaimsMcp(c.raiz, c.id).length, 0);
      assert.equal(lerArtefatoMcp(c.raiz, c.id, 'goal').conteudo, null);
    });
  }
}

test('rm036 mcp: R7 UTF-8 valido com U+FFFD literal continua conferido e aceito', (t) => {
  const c = fixture(t), pastaLeases = path.dirname(c.fila);
  const valido = path.join(pastaLeases, 'utf8-\ufffd');
  fs.writeFileSync(valido, 'regular');
  assert.doesNotThrow(() => metadadosGitMcp(path.dirname(pastaLeases), pastaLeases));
  c.escrever('UTF-8 sem perda');
  assert.equal(listarClaimsMcp(c.raiz, c.id).length, 1);
  fs.unlinkSync(valido);
  fs.symlinkSync(c.raiz, valido);
  assert.throws(() => metadadosGitMcp(path.dirname(pastaLeases), pastaLeases), /metadata.unsafe: link simbolico/);
  assert.throws(() => c.escrever('link recusado'), /mcp.state.unsafe/);
  assert.equal(listarClaimsMcp(c.raiz, c.id).length, 1);
  assert.equal(lerArtefatoMcp(c.raiz, c.id, 'goal').conteudo, 'UTF-8 sem perda');
});
