/** GO-FIX do CHECK 1: legado hostil e corridas, em fixtures locais sem subprocessos. */
import { strict as assert } from 'node:assert';
import { test, TestContext } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as leases from '../src/leases';
import { Lease } from '../src/types';

const io = require('node:fs') as typeof fs;
const DONO = 'ork-primeira', OUTRA = 'ork-segunda';

/** O par de arquivos do Git que registra uma linked worktree, sem executar Git. */
function cenario(t: TestContext) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm036-fix-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const raiz = path.join(base, 'projeto'), wt = path.join(base, 'worktree');
  const registro = path.join(raiz, '.git', 'worktrees', 'thread');
  const legado = path.join(wt, '.orkastery', 'leases');
  fs.mkdirSync(registro, { recursive: true });
  fs.mkdirSync(legado, { recursive: true });
  fs.writeFileSync(path.join(registro, 'gitdir'), path.join(wt, '.git') + '\n');
  fs.writeFileSync(path.join(registro, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${registro}\n`);
  const gravar = (lease: unknown, nome = 'main-tree') => {
    const arquivo = path.join(legado, `${encodeURIComponent(nome)}.json`);
    fs.writeFileSync(arquivo, JSON.stringify(lease));
    return arquivo;
  };
  return { base, raiz, wt, registro, legado, gravar };
}

function vivo(nome = 'main-tree', thread = DONO): Lease {
  const inicio = Date.now() - 60_000;
  return { nome, thread, motivo: 'legado', pid: 4242,
    adquiridoEm: new Date(inicio).toISOString(), expiraEm: new Date(inicio + 20 * 60_000).toISOString() };
}

test('rm036 gofix: legado valido barra o MCP mas nao prova posse canonica', (t) => {
  const c = cenario(t);
  c.gravar(vivo());
  assert.equal(leases.lerLease(c.raiz, 'main-tree'), null, 'ativacao nao aceita prova legada');
  assert.equal(leases.lerLease(c.wt, 'main-tree'), null);
  assert.equal(leases.leasesColidentes(c.raiz, 'main-tree').length, 1, 'preflight sem thread ve o legado vivo');
  const r = leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'MCP', retomarVencido: false });
  assert.equal(r.ok, false);
  assert.equal(r.ocupadoPor?.thread, DONO);
  assert.equal(fs.existsSync(leases.caminhoLease(c.raiz, 'main-tree')), false);
});

for (const [caso, alterar] of Object.entries({
  'nome divergente': (l: Lease) => ({ ...l, nome: 'path:core/**' }),
  'thread com controle': (l: Lease) => ({ ...l, thread: 'ork-um\nINJETADO' }),
  'thread como caminho': (l: Lease) => ({ ...l, thread: '../ork-um' }),
  'data nao ISO': (l: Lease) => ({ ...l, adquiridoEm: new Date(l.adquiridoEm).toUTCString() }),
  'prazo maior que 30 min': (l: Lease) => ({ ...l, expiraEm: new Date(Date.parse(l.adquiridoEm) + leases.TTL_PADRAO_MS + 1).toISOString() }),
  'inicio futuro': (l: Lease) => ({ ...l, adquiridoEm: new Date(Date.now() + 60_000).toISOString() }),
  'prazo invertido': (l: Lease) => ({ ...l, expiraEm: l.adquiridoEm }),
  'pid invalido': (l: Lease) => ({ ...l, pid: 'INJETADO' }),
})) {
  test(`rm036 gofix: legado falso ${caso} nao bloqueia e sai com forcar`, (t) => {
    const c = cenario(t);
    const arquivo = c.gravar(alterar(vivo()));
    assert.deepEqual(leases.listarLeases(c.raiz), []);
    assert.deepEqual(leases.leasesColidentes(c.raiz, 'main-tree'), []);
    const lista = leases.tabelaDeLeases(c.raiz);
    assert.match(lista, /main-tree\.json INVALIDO ou ILEGIVEL/);
    assert.doesNotMatch(lista, /INJETADO/);
    assert.equal(leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'MCP', retomarVencido: false }).ok, true);
    assert.equal(leases.liberar(c.raiz, 'main-tree', OUTRA, true).ok, true);
    assert.equal(fs.existsSync(arquivo), false);
  });
}

test('rm036 gofix: legado vencido nao bloqueia com retomada canonica desligada', (t) => {
  const c = cenario(t), l = vivo();
  l.adquiridoEm = new Date(Date.now() - 25 * 60_000).toISOString();
  l.expiraEm = new Date(Date.now() - 5 * 60_000).toISOString();
  const arquivo = c.gravar(l);
  const r = leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'MCP', retomarVencido: false });
  assert.equal(r.ok, true);
  assert.equal(r.tomadoDeVencido, true);
  assert.equal(fs.existsSync(arquivo), false);
});

for (const ilegivel of [false, true]) {
  test(`rm036 gofix: legado ${ilegivel ? 'ilegivel' : 'corrompido'} aparece sem bloquear e sai com forcar`, (t) => {
    const c = cenario(t), arquivo = c.gravar(vivo());
    if (ilegivel) {
      const abrir = io.openSync;
      t.mock.method(io, 'openSync', (p: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
        if (String(p) === arquivo) throw Object.assign(new Error('leitura negada'), { code: 'EACCES' });
        return abrir(p, flags, mode);
      });
    } else fs.writeFileSync(arquivo, '{');
    assert.deepEqual(leases.leasesColidentes(c.raiz, 'main-tree'), []);
    assert.match(leases.tabelaDeLeases(c.raiz), /main-tree\.json INVALIDO ou ILEGIVEL/);
    assert.equal(leases.liberar(c.raiz, 'main-tree', DONO).ok, false, 'sem posse, exige forcar');
    assert.equal(leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'MCP', retomarVencido: false }).ok, true);
    assert.equal(leases.liberar(c.raiz, 'main-tree', OUTRA, true).ok, true);
    assert.equal(fs.existsSync(arquivo), false);
  });
}

test('rm036 gofix: legado limita a janela e nao renova nem varre depois de 30 min', (t) => {
  const c = cenario(t);
  c.gravar(vivo());
  assert.deepEqual(leases.dirsLegadosDeLeases(c.raiz), [c.legado]);
  const marcador = path.join(leases.dirLeases(c.raiz), '.legado');
  const inicio = fs.statSync(marcador).mtimeMs;
  assert.deepEqual(leases.dirsLegadosDeLeases(c.wt), [c.legado]);
  assert.equal(fs.statSync(marcador).mtimeMs, inicio, 'a segunda leitura nao renova');
  const passado = new Date(Date.now() - leases.TTL_PADRAO_MS - 1_000);
  fs.utimesSync(marcador, passado, passado);
  const carimboVencido = fs.statSync(marcador).mtimeMs;
  const readdir = io.readdirSync;
  t.mock.method(io, 'readdirSync', (dir: fs.PathLike, ...args: unknown[]) => {
    assert.notEqual(String(dir), path.dirname(c.registro), 'apos janela nao varre registros');
    return Reflect.apply(readdir, io, [dir, ...args]);
  });
  assert.deepEqual(leases.dirsLegadosDeLeases(c.raiz), []);
  assert.deepEqual(leases.listarLeases(c.raiz), []);
  assert.equal(leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'MCP', retomarVencido: false }).ok, true);
  assert.equal(fs.statSync(marcador).mtimeMs, carimboVencido);
});

for (const camada of ['arquivo', 'leases', '.orkastery']) {
  test(`rm036 gofix: legado ignora link simbolico em ${camada} sem apagar alvo`, (t) => {
    const c = cenario(t), arquivo = c.gravar(vivo());
    const origem = camada === 'arquivo' ? arquivo : camada === 'leases' ? c.legado : path.dirname(c.legado);
    const alvo = path.join(c.base, 'fora');
    fs.renameSync(origem, alvo);
    fs.symlinkSync(alvo, origem);
    assert.deepEqual(leases.leasesColidentes(c.raiz, 'main-tree'), []);
    assert.equal(leases.liberar(c.raiz, 'main-tree', OUTRA, true).ok, true);
    assert.equal(fs.lstatSync(origem).isSymbolicLink(), true);
    const conteudo = camada === 'arquivo' ? alvo : path.join(alvo, camada === 'leases' ? '' : 'leases', 'main-tree.json');
    assert.equal(JSON.parse(fs.readFileSync(conteudo, 'utf8')).thread, DONO);
  });
}

test('rm036 gofix: vinculo de volta da worktree deve conferir com o registro', (t) => {
  const c = cenario(t), arquivo = c.gravar(vivo());
  fs.writeFileSync(path.join(c.wt, '.git'), 'gitdir: ../outro-clone/.git/worktrees/thread\n');
  assert.deepEqual(leases.dirsLegadosDeLeases(c.raiz), []);
  assert.deepEqual(leases.leasesColidentes(c.raiz, 'main-tree'), []);
  leases.liberar(c.raiz, 'main-tree', OUTRA, true);
  assert.equal(fs.existsSync(arquivo), true, 'registro obsoleto nao autoriza unlink em outro clone');
});

test('rm036 gofix: texto legado e lista de leases e fila saem sem controles', (t) => {
  const c = cenario(t), l = vivo();
  l.motivo = 'motivo\n\u001b[2J\u202einjetado';
  c.gravar({ ...l, conducao: { thread: 'INJETADO' } });
  const legado = leases.listarLeases(c.raiz)[0];
  assert.equal(legado.motivo, 'motivo[2Jinjetado');
  assert.equal(legado.conducao, undefined);
  leases.regravarLease(c.raiz, { ...vivo('service:5173'), thread: 'ork-um\r\u001b', motivo: l.motivo });
  fs.writeFileSync(leases.caminhoFila(c.raiz), JSON.stringify([{ nome: 'path:core/**', tipo: 'path',
    thread: 'ork-fila\u001b', motivo: '', desdeEm: l.adquiridoEm,
    colidiuCom: 'path:core/**\u0007', bloqueadaPor: 'ork-um\u202e' }]));
  const texto = leases.tabelaDeLeases(c.raiz);
  assert.doesNotMatch(texto.replace(/\n/g, ''), /[\p{Cc}\p{Cf}]/u);
});

test('rm036 gofix: liberar nao usa legado quando o canonico desaparece durante a leitura', (t) => {
  const c = cenario(t), nome = 'main-tree';
  c.gravar(vivo(nome, DONO));
  leases.regravarLease(c.raiz, vivo(nome, OUTRA));
  const canonico = leases.caminhoLease(c.raiz, nome), existe = io.existsSync;
  let corrida = false;
  t.mock.method(io, 'existsSync', (p: fs.PathLike) => {
    if (String(p) === canonico && !corrida) {
      corrida = true;
      fs.unlinkSync(canonico);
      return true;
    }
    return existe(p);
  });
  const ler = io.readFileSync;
  t.mock.method(io, 'readFileSync', (p: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (String(p) === canonico) {
      // Uma nova dona aparece depois da tentativa de leitura que recebeu ENOENT.
      leases.regravarLease(c.raiz, vivo(nome, OUTRA));
      throw Object.assign(new Error('arquivo ausente na leitura'), { code: 'ENOENT' });
    }
    return Reflect.apply(ler, io, [p, ...args]);
  });
  assert.equal(leases.liberar(c.raiz, nome, DONO).ok, true, 'solta somente o proprio legado');
  assert.equal(JSON.parse(ler(canonico, 'utf8')).thread, OUTRA, 'nao apaga a nova dona canonica');
});
