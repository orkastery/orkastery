/** GO-FIX do CHECK 1: legado hostil e corridas, em fixtures locais sem subprocessos. */
import { strict as assert } from 'node:assert';
import { test, TestContext } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as leases from '../src/leases';
import { Lease, Thread } from '../src/types';
import { planejar } from '../src/board';
import { exigirManifesto } from '../src/manifest';
import { gravarThread } from '../src/thread';

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
  let varreduras = 0;
  t.mock.method(io, 'readdirSync', (dir: fs.PathLike, ...args: unknown[]) => {
    if (String(dir) === path.dirname(c.registro)) varreduras++;
    return Reflect.apply(readdir, io, [dir, ...args]);
  });
  assert.deepEqual(leases.dirsLegadosDeLeases(c.raiz), []);
  assert.deepEqual(leases.listarLeases(c.raiz), []);
  assert.equal(leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'MCP', retomarVencido: false }).ok, true);
  assert.equal(varreduras, 0, 'apos janela nao varre registros');
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

test('rm036 gofix: fila legada envenenada nao e lida nem incorporada', (t) => {
  const c = cenario(t), arquivo = path.join(c.legado, 'fila.json');
  const veneno = JSON.stringify([{ nome: 'main-tree', tipo: 'main-tree', thread: 'ork-falsa\nINJETADO',
    desdeEm: '2000-01-01T00:00:00.000Z', motivo: '', bloqueadaPor: 'falsa', colidiuCom: 'main-tree' }]);
  fs.writeFileSync(arquivo, veneno);
  const ler = io.readFileSync;
  let leituras = 0;
  t.mock.method(io, 'readFileSync', (p: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (String(p) === arquivo) leituras++;
    return Reflect.apply(ler, io, [p, ...args]);
  });
  assert.deepEqual(leases.lerFila(c.raiz), []);
  assert.equal(leases.adquirirRegiao(c.raiz, 'main-tree', { thread: DONO, motivo: 'GO' }).ok, true);
  const r = leases.adquirirRegiao(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'GO' });
  assert.equal(r.posicaoNaFila, 1);
  assert.deepEqual(leases.lerFila(c.raiz).map((p) => p.thread), [OUTRA]);
  assert.equal(ler(arquivo, 'utf8'), veneno);
  assert.doesNotMatch(leases.tabelaDeLeases(c.raiz), /INJETADO|ork-falsa/);
  assert.equal(leituras, 0, 'nao le fila legada');
});

test('rm036 gofix: propria copia legada nao enfileira atras de si nem de outra espera', (t) => {
  const c = cenario(t);
  c.gravar(vivo());
  leases.enfileirar(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'aguarda', colidiuCom: 'main-tree', bloqueadaPor: DONO });
  // Simula uma autoespera deixada pela versao da rodada 1.
  leases.enfileirar(c.raiz, 'main-tree', { thread: DONO, motivo: 'reentrada', colidiuCom: 'main-tree', bloqueadaPor: DONO });
  const r = leases.adquirirRegiao(c.raiz, 'main-tree', { thread: DONO, motivo: 'GO' });
  assert.equal(r.ok, false);
  assert.equal(r.esperando, false);
  assert.equal(r.posicaoNaFila, 0);
  assert.equal(r.ocupadoPor?.thread, DONO);
  assert.deepEqual(leases.lerFila(c.raiz).map((p) => p.thread), [OUTRA]);
  assert.equal(leases.liberar(c.raiz, 'main-tree', DONO).ok, true);
  assert.equal(leases.adquirirRegiao(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'GO' }).ok, true);
});

test('rm036 gofix: fila atomica preserva leitores durante escrita parcial', (t) => {
  const c = cenario(t), nome = 'main-tree';
  leases.enfileirar(c.raiz, nome, { thread: DONO, motivo: 'um', colidiuCom: nome, bloqueadaPor: OUTRA });
  const antes = leases.lerFila(c.raiz), escrever = io.writeFileSync;
  let durante = 0;
  t.mock.method(io, 'writeFileSync', (p: fs.PathOrFileDescriptor, data: string, ...args: unknown[]) => {
    if (String(p).startsWith(leases.caminhoFila(c.raiz))) {
      Reflect.apply(escrever, io, [p, data.slice(0, 10), ...args]);
      assert.deepEqual(leases.lerFila(c.raiz), antes, 'leitor ve a fila antiga inteira ate o rename');
      durante++;
    }
    return Reflect.apply(escrever, io, [p, data, ...args]);
  });
  leases.enfileirar(c.raiz, nome, { thread: OUTRA, motivo: 'dois', colidiuCom: nome, bloqueadaPor: DONO });
  assert.equal(durante, 1, 'interceptou a escrita real');
  assert.deepEqual(leases.lerFila(c.raiz).map((p) => p.thread), [DONO, OUTRA]);
  assert.deepEqual(fs.readdirSync(leases.dirLeases(c.raiz)).filter((n) => n.endsWith('.tmp')), []);
});

test('rm036 gofix: falha do rename da fila conserva estado anterior e limpa temporario', (t) => {
  const c = cenario(t), nome = 'main-tree';
  leases.enfileirar(c.raiz, nome, { thread: DONO, motivo: 'um', colidiuCom: nome, bloqueadaPor: OUTRA });
  const antes = fs.readFileSync(leases.caminhoFila(c.raiz), 'utf8');
  t.mock.method(io, 'renameSync', () => { throw new Error('rename indisponivel'); });
  assert.throws(() => leases.enfileirar(c.raiz, nome, { thread: OUTRA, motivo: 'dois', colidiuCom: nome, bloqueadaPor: DONO }),
    /rename indisponivel/);
  assert.equal(fs.readFileSync(leases.caminhoFila(c.raiz), 'utf8'), antes);
  assert.deepEqual(fs.readdirSync(leases.dirLeases(c.raiz)).filter((n) => n.endsWith('.tmp')), []);
});

test('rm036 gofix: arquivo recem-criado entre wx e JSON tem somente um vencedor', (t) => {
  const c = cenario(t), nome = 'main-tree', arquivo = leases.caminhoLease(c.raiz, nome);
  const escrever = io.writeFileSync;
  let naJanela = false;
  t.mock.method(io, 'writeFileSync', (p: fs.PathOrFileDescriptor, data: string, options: fs.WriteFileOptions) => {
    if (String(p) !== arquivo || naJanela) return escrever(p, data, options);
    naJanela = true;
    const fd = fs.openSync(arquivo, 'wx');
    try {
      const rival = leases.adquirir(c.raiz, nome, { thread: OUTRA, motivo: 'durante escrita' });
      assert.equal(rival.ok, false, 'rival nao apaga o arquivo ainda vazio criado por wx');
      escrever(fd, data, options);
    } finally { fs.closeSync(fd); }
  });
  assert.equal(leases.adquirir(c.raiz, nome, { thread: DONO, motivo: 'primeira escrita' }).ok, true);
  assert.equal(naJanela, true);
  assert.equal(leases.lerLease(c.raiz, nome)?.thread, DONO);
  assert.equal(fs.statSync(arquivo).nlink, 1, 'sem hard link que o ship recusaria');
});

for (const conteudo of ['', '{']) {
  test(`rm036 gofix: arquivo recem-criado ${conteudo ? 'ilegivel' : 'vazio'} so e retomado depois de 5 s`, (t) => {
    const c = cenario(t), nome = 'main-tree', arquivo = leases.caminhoLease(c.raiz, nome);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, conteudo);
    const carimbo = fs.statSync(arquivo).mtimeMs;
    t.mock.method(Date, 'now', () => carimbo + 4_999);
    assert.equal(leases.adquirir(c.raiz, nome, { thread: OUTRA, motivo: 'cedo' }).ok, false);
    assert.equal(fs.readFileSync(arquivo, 'utf8'), conteudo);
    t.mock.method(Date, 'now', () => carimbo + 5_001);
    const retomada = leases.adquirir(c.raiz, nome, { thread: OUTRA, motivo: 'apos prazo' });
    assert.equal(retomada.ok, true);
    assert.equal(retomada.tomadoDeVencido, true);
    assert.equal(leases.lerLease(c.raiz, nome)?.thread, OUTRA);
  });
}

test('rm036 gofix: leasesDaThread e planejar tiram nomes repetidos e preferem o canonico', (t) => {
  const c = cenario(t), nome = 'path:core/**';
  c.gravar(vivo(nome), nome);
  leases.regravarLease(c.raiz, { ...vivo(nome), motivo: 'canonico' });
  const daThread = leases.leasesDaThread(c.raiz, DONO);
  assert.equal(daThread.length, 1);
  assert.equal(daThread[0].motivo, 'canonico');
  fs.writeFileSync(path.join(c.raiz, 'orkastery.yaml'), 'project:\n  name: fixture\n  abbrev: ork\n');
  const carregado = exigirManifesto(c.raiz);
  const thread: Thread = { id: DONO, slug: 'ork-primeira-full', nome: 'fixture', assunto: 'primeira',
    modo: 'auto', fases: ['GO'], blocos: [], faseAtual: 'GO', status: 'aberta',
    criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(),
    projeto: { name: 'fixture', abbrev: 'ork' }, base: { branch: 'main', commit: 'desconhecido' },
    worktree: c.wt, sessoes: [], decisoes: [], claims: [], leases: [], baseline: null };
  for (const origem of [undefined, 'adocao'] as const) {
    thread.origem = origem;
    gravarThread(c.raiz, thread);
    const plano = planejar(carregado, { estados: new Map() });
    const vaga = plano.vagas.find((v) => v.thread === DONO);
    assert.deepEqual(vaga?.leases, [nome], `nomes unicos na passada ${origem ? 'de espera' : 'em andamento'}`);
    assert.equal((vaga?.detalhe.match(/path:core\/\*\*/g) ?? []).length, origem ? 0 : 1);
  }
});
