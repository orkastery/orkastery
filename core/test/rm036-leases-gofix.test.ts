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
import { montarMonitor } from '../src/orquestracao';
import { ship } from '../src/ship';
import { dirThread } from '../src/thread';
import { lerLedger } from '../src/ledger';

const io = require('node:fs') as typeof fs;
const DONO = 'ork-primeira', OUTRA = 'ork-segunda';

/** Modelo local de flock por inode; a prova com dois processos fica em leases-canonicos. */
function simularFlock(t: TestContext) {
  const processo = require('node:child_process') as typeof import('node:child_process');
  const held = new Map<string, number>(), fechar = io.closeSync, spawn = processo.spawnSync;
  t.mock.method(processo, 'spawnSync', (cmd: string, args: string[], opcoes: any) => {
    if (cmd !== '/usr/bin/flock') return spawn(cmd, args, opcoes);
    assert.deepEqual(args, ['--exclusive', '--nonblock', '3']);
    const fd = opcoes.stdio[3], stat = fs.fstatSync(fd), chave = `${stat.dev}:${stat.ino}`;
    if (held.has(chave)) return { status: 1 };
    held.set(chave, fd);
    return { status: 0 };
  });
  t.mock.method(io, 'closeSync', (fd: number) => {
    for (const [chave, dono] of held) if (dono === fd) held.delete(chave);
    return fechar(fd);
  });
  t.after(() => assert.equal(held.size, 0, 'descritores e travas liberados'));
}

function semFlock(t: TestContext) {
  const processo = require('node:child_process') as typeof import('node:child_process'), spawn = processo.spawnSync;
  t.mock.method(processo, 'spawnSync', (...args: unknown[]) => args[0] === '/usr/bin/flock'
    ? { status: null, error: Object.assign(new Error('flock ausente'), { code: 'ENOENT' }) }
    : Reflect.apply(spawn, processo, args));
}

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

for (const sufixo of ['$(id)', '`id`', ';id', '|id', ' com espaco', "'aspas'", '"aspas"', '\ncontrole', 'a'.repeat(200)]) {
  test(`rm036 gofix: B2 nome hostil ${JSON.stringify(sufixo)} nunca vira comando legado`, (t) => {
    const c = cenario(t), nome = `path:core/${sufixo}`;
    for (const conteudo of [vivo(nome), {}]) {
      c.gravar(conteudo, nome);
      assert.deepEqual(leases.listarLeases(c.raiz), []);
      assert.doesNotMatch(leases.tabelaDeLeases(c.raiz), /ork lease release/);
      const r = leases.adquirirRegiao(c.raiz, 'path:core/**', { thread: OUTRA, motivo: 'GO' });
      assert.equal(r.ok, true);
      assert.equal(r.correcao, '');
      assert.deepEqual(leases.lerFila(c.raiz), []);
      leases.liberar(c.raiz, 'path:core/**', OUTRA);
    }
  });
}

test('rm036 gofix: B2 diagnostico legado nunca sugere release canonico', (t) => {
  const c = cenario(t);
  for (const arquivo of ['%6dain-tree.json', 'main%2dtree.json', 'erro%ZZ.json']) {
    fs.writeFileSync(path.join(c.legado, arquivo), '{}');
  }
  assert.doesNotMatch(leases.tabelaDeLeases(c.raiz), /ork lease release/);
  c.gravar({}, 'path:core/**');
  assert.doesNotMatch(leases.tabelaDeLeases(c.raiz), /ork lease release/);
});

test('rm036 gofix: B2 comandos de fila e monitor protegem argumentos com aspas simples', (t) => {
  const c = cenario(t), nome = "path:core/$(id)`id`;id|id com 'aspas'";
  const literal = "'path:core/$(id)`id`;id|id com '\\''aspas'\\'''";
  // A fila canonica antiga tambem pode conter nomes fora do conjunto aceito para legado.
  leases.regravarLease(c.raiz, vivo(nome));
  const r = leases.adquirirRegiao(c.raiz, 'path:core/**', { thread: OUTRA, motivo: 'GO' });
  assert.equal(r.correcao.split('ork lease release ')[1], `${literal} --forcar`);
  // O ramo de EEXIST (sem colisao de outra thread) tambem precisa citar o nome.
  leases.sairDaFila(c.raiz, 'path:core/**', OUTRA);
  const mesmo = leases.adquirirRegiao(c.raiz, nome, { thread: DONO, motivo: 'reentrada' });
  assert.equal(mesmo.correcao.split('ork lease release ')[1], `${literal} --forcar`);
  fs.writeFileSync(path.join(c.raiz, 'orkastery.yaml'), 'project:\n  name: fixture\n  abbrev: ork\n');
  const thread: Thread = { id: DONO, slug: 'ork-primeira-full', nome: 'fixture', assunto: 'primeira',
    modo: 'auto', fases: ['GO'], blocos: [{ fases: ['GO'], pausa: false, pausaSobre: '', slugFases: 'go' }],
    faseAtual: 'GO', status: 'aberta', criadaEm: vivo().adquiridoEm, atualizadaEm: vivo().adquiridoEm,
    projeto: { name: 'fixture', abbrev: 'ork' }, base: { branch: 'main', commit: 'desconhecido' },
    worktree: c.wt, sessoes: [], decisoes: [], claims: [], leases: [], baseline: null };
  gravarThread(c.raiz, thread);
  const monitor = montarMonitor(exigirManifesto(c.raiz), { estados: new Map() });
  const parada = monitor.linhas.find((l) => l.thread === DONO)?.impedimentos.find((p) => p.motivo === 'lease.busy');
  assert.ok(parada);
  assert.equal(parada.correcao.split('ork lease release ')[1], `${literal} --thread '${DONO}'), ou reduza a regiao pedida`);
  // A propria copia legada gera uma correcao separada, sem entrar na fila.
  c.gravar(vivo('board:card+1'), 'board:card+1');
  const proprio = leases.adquirirRegiao(c.raiz, 'board:card+1', { thread: DONO, motivo: 'GO' });
  assert.doesNotMatch(proprio.correcao, /ork lease release/);
  assert.match(proprio.correcao, /fim da janela/);
});

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
  'prazo maior que 30 min e tolerancia': (l: Lease) => ({ ...l, expiraEm: new Date(Date.parse(l.adquiridoEm) + leases.TTL_PADRAO_MS + 1_001).toISOString() }),
  'inicio futuro': (l: Lease) => ({ ...l, adquiridoEm: new Date(Date.now() + 60_000).toISOString() }),
  'prazo invertido': (l: Lease) => ({ ...l, expiraEm: l.adquiridoEm }),
  'pid invalido': (l: Lease) => ({ ...l, pid: 'INJETADO' }),
})) {
  test(`rm036 gofix: legado falso ${caso} nao bloqueia e permanece intacto`, (t) => {
    const c = cenario(t);
    const arquivo = c.gravar(alterar(vivo()));
    assert.deepEqual(leases.listarLeases(c.raiz), []);
    assert.deepEqual(leases.leasesColidentes(c.raiz, 'main-tree'), []);
    const lista = leases.tabelaDeLeases(c.raiz);
    assert.match(lista, /main-tree\.json INVALIDO ou ILEGIVEL/);
    assert.doesNotMatch(lista, /INJETADO/);
    assert.equal(leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'MCP', retomarVencido: false }).ok, true);
    assert.equal(leases.liberar(c.raiz, 'main-tree', OUTRA, true).ok, true);
    assert.equal(fs.existsSync(arquivo), true, 'o legado permanece intacto');
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
  assert.equal(fs.existsSync(arquivo), true, 'adquirir preserva o legado vencido');
});

for (const ilegivel of [false, true]) {
  test(`rm036 gofix: legado ${ilegivel ? 'ilegivel' : 'corrompido'} aparece sem bloquear e permanece intacto`, (t) => {
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
    assert.equal(fs.existsSync(arquivo), true, 'o legado permanece intacto');
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

for (const semRegistro of [false, true]) {
  test(`rm036 gofix: A1 primeira consulta sem legado inicia janela (sem registro: ${semRegistro})`, (t) => {
    const c = cenario(t);
    fs.rmdirSync(c.legado);
    if (semRegistro) fs.renameSync(path.dirname(c.registro), path.join(c.base, 'registro-salvo'));
    assert.deepEqual(leases.listarLeases(c.raiz), []);
    const marcador = path.join(leases.dirLeases(c.raiz), '.legado');
    assert.equal(fs.existsSync(marcador), true, 'primeira consulta marca mesmo sem worktrees ou legado');
    const passado = new Date(Date.now() - leases.TTL_PADRAO_MS - 1_000);
    fs.utimesSync(marcador, passado, passado);
    const carimbo = fs.statSync(marcador).mtimeMs;
    if (semRegistro) fs.renameSync(path.join(c.base, 'registro-salvo'), path.dirname(c.registro));
    fs.mkdirSync(c.legado, { recursive: true });
    c.gravar(vivo());
    assert.deepEqual(leases.leasesColidentes(c.raiz, 'main-tree'), [], 'preflight de verify e ship ignora legado tardio');
    assert.equal(leases.adquirir(c.wt, 'main-tree', { thread: OUTRA, motivo: 'ship', retomarVencido: false }).ok, true);
    assert.equal(fs.statSync(marcador).mtimeMs, carimbo, 'arquivo hostil nao reabre a janela');
  });
}

test('rm036 gofix: A2 prazo legado tolera ate 1 s entre leituras do relogio', (t) => {
  const c = cenario(t), l = vivo();
  for (const delta of [0, 1, 999, 1_000, 1_001]) {
    c.gravar({ ...l, expiraEm: new Date(Date.parse(l.adquiridoEm) + leases.TTL_PADRAO_MS + delta).toISOString() });
    assert.equal(leases.leasesColidentes(c.raiz, 'main-tree').length, delta <= 1_000 ? 1 : 0, `tolerancia ${delta} ms`);
  }
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

for (const operacao of ['liberar', 'soltarDaThread'] as const) {
  for (const troca of ['arquivo', 'link-arquivo', 'link-diretorio'] as const) {
    test(`rm036 gofix: A3 ${operacao} preserva substituicao por ${troca} apos leitura`, (t) => {
      const c = cenario(t), arquivo = c.gravar(vivo());
      const salvo = path.join(c.base, 'original'), outro = path.join(c.base, 'outro');
      const ler = io.readFileSync;
      let trocou = false, leituras = 0;
      t.mock.method(io, 'readFileSync', (p: fs.PathOrFileDescriptor, ...args: unknown[]) => {
        const resultado = Reflect.apply(ler, io, [p, ...args]);
        if (typeof p === 'number' && String(resultado).includes('"motivo":"legado"')) {
          leituras++;
          // soltarDaThread rele o lease depois da listagem; trocar apos essa releitura.
          if (!trocou && leituras === (operacao === 'liberar' ? 1 : 2)) {
            trocou = true;
            if (troca === 'link-diretorio') {
              fs.renameSync(c.legado, salvo);
              fs.mkdirSync(outro);
              fs.writeFileSync(path.join(outro, 'main-tree.json'), JSON.stringify(vivo('main-tree', OUTRA)));
              fs.symlinkSync(outro, c.legado);
            } else {
              fs.renameSync(arquivo, salvo);
              if (troca === 'arquivo') fs.writeFileSync(arquivo, JSON.stringify(vivo('main-tree', OUTRA)));
              else {
                fs.writeFileSync(outro, JSON.stringify(vivo('main-tree', OUTRA)));
                fs.symlinkSync(outro, arquivo);
              }
            }
          }
        }
        return resultado;
      });
      if (operacao === 'liberar') {
        const r = leases.liberar(c.raiz, 'main-tree', DONO, true);
        assert.equal(r.ok, false);
        assert.doesNotMatch(r.detalhe, /liberado|legado ignorado/);
      }
      else assert.deepEqual(leases.soltarDaThread(c.raiz, DONO).leases, []);
      assert.equal(trocou, true, 'corrida ocorreu depois da leitura');
      assert.equal(JSON.parse(ler(arquivo, 'utf8')).thread, OUTRA, 'substituicao preservada');
      if (troca.startsWith('link')) assert.equal(fs.lstatSync(troca === 'link-diretorio' ? c.legado : arquivo).isSymbolicLink(), true);
    });
  }
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
  assert.equal(legado.motivo, '(legado)');
  assert.equal(legado.conducao, undefined);
  leases.regravarLease(c.raiz, { ...vivo('service:5173'), thread: 'ork-um\r\u001b', motivo: l.motivo });
  fs.writeFileSync(leases.caminhoLease(c.raiz, 'board:card-1'), JSON.stringify({ ...vivo('board:card-1'),
    adquiridoEm: 'data\u001b', expiraEm: 'data\u0007', pid: 'pid\rINJETADO' }));
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
  const canonico = leases.caminhoLease(c.raiz, nome), stat = io.lstatSync;
  let corrida = false;
  t.mock.method(io, 'lstatSync', (p: fs.PathLike, ...args: unknown[]) => {
    const resultado = Reflect.apply(stat, io, [p, ...args]);
    if (String(p) === canonico && !corrida) {
      corrida = true;
      fs.unlinkSync(canonico);
    }
    return resultado;
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
  assert.equal(leases.liberar(c.raiz, nome, DONO).ok, false, 'nao confunde legado proprio com canonico ausente na leitura');
  assert.equal(JSON.parse(ler(canonico, 'utf8')).thread, OUTRA, 'nao apaga a nova dona canonica');
});

test('rm036 gofix: R3 diagnostico de legado vazio preserva vencedor canonico', (t) => {
  const c = cenario(t), arquivo = c.gravar({});
  leases.regravarLease(c.raiz, vivo('main-tree', OUTRA));
  const antes = fs.readFileSync(leases.caminhoLease(c.raiz, 'main-tree'), 'utf8');
  assert.doesNotMatch(leases.tabelaDeLeases(c.raiz), /ork lease release/);
  assert.equal(leases.liberar(c.raiz, 'main-tree', DONO).ok, false);
  assert.equal(leases.adquirir(c.raiz, 'main-tree', { thread: DONO, motivo: 'GO' }).ok, false);
  assert.deepEqual(leases.soltarDaThread(c.raiz, DONO).leases, []);
  assert.equal(fs.readFileSync(leases.caminhoLease(c.raiz, 'main-tree'), 'utf8'), antes);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), '{}');
});

test('rm036 gofix: R3 release separa origens e marca legado por dev ino', (t) => {
  const c = cenario(t), arquivo = c.gravar(vivo());
  const antes = fs.readFileSync(arquivo, 'utf8'), inode = fs.statSync(arquivo);
  leases.regravarLease(c.raiz, vivo('main-tree', OUTRA));
  assert.equal(leases.liberar(c.raiz, 'main-tree', OUTRA, true).ok, true);
  assert.equal(leases.leasesColidentes(c.raiz, 'main-tree').length, 1, 'release canonico nao descarta legado');
  assert.equal(leases.liberar(c.raiz, 'main-tree', OUTRA).ok, false);
  const r = leases.liberar(c.raiz, 'main-tree', DONO);
  assert.equal(r.ok, true);
  assert.match(r.detalhe, /legado ignorado/);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), antes);
  assert.equal(fs.statSync(arquivo).ino, inode.ino);
  assert.equal(fs.existsSync(path.join(leases.dirLeases(c.raiz), `.legado-ignorado-${inode.dev}-${inode.ino}`)), true);
  assert.equal(leases.leasesColidentes(c.raiz, 'main-tree').length, 0);
  assert.equal(leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'GO' }).ok, true);
  // Outra copia no mesmo path continua sendo reconhecida, apesar da marca antiga.
  fs.renameSync(arquivo, path.join(c.base, 'inode-antigo'));
  c.gravar(vivo());
  assert.equal(leases.leasesColidentes(c.raiz, 'main-tree', OUTRA).length, 1);
});

test('rm036 gofix: R3 liberar nao anuncia sucesso quando unlink falha', (t) => {
  const c = cenario(t);
  leases.regravarLease(c.raiz, vivo());
  leases.enfileirar(c.raiz, 'main-tree', { thread: DONO, motivo: 'GO', colidiuCom: 'main-tree', bloqueadaPor: OUTRA });
  const apagar = io.unlinkSync;
  t.mock.method(io, 'unlinkSync', (p: fs.PathLike) => {
    if (String(p) === leases.caminhoLease(c.raiz, 'main-tree')) throw Object.assign(new Error('negado'), { code: 'EACCES' });
    return apagar(p);
  });
  const r = leases.liberar(c.raiz, 'main-tree', DONO);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.detalhe, /liberado/);
  assert.equal(leases.lerLease(c.raiz, 'main-tree')?.thread, DONO);
  assert.equal(leases.lerFila(c.raiz).length, 1);
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
    simularFlock(t);
    const c = cenario(t), nome = 'main-tree', arquivo = leases.caminhoLease(c.raiz, nome);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, conteudo);
    const carimbo = fs.statSync(arquivo).mtimeMs;
    let avancar = 4_999;
    t.mock.method(Date, 'now', () => carimbo + avancar);
    assert.equal(leases.adquirir(c.raiz, nome, { thread: OUTRA, motivo: 'cedo' }).ok, false);
    assert.equal(fs.readFileSync(arquivo, 'utf8'), conteudo);
    avancar = 5_001;
    const retomada = leases.adquirir(c.raiz, nome, { thread: OUTRA, motivo: 'apos prazo' });
    assert.equal(retomada.ok, true);
    assert.equal(retomada.tomadoDeVencido, true);
    assert.equal(leases.lerLease(c.raiz, nome)?.thread, OUTRA);
  });
}

for (const corrompido of [false, true]) {
  test(`rm036 gofix: A4 corrida de retomada ${corrompido ? 'corrompida' : 'vencida'} tem um vencedor`, (t) => {
    simularFlock(t);
    const c = cenario(t), nome = 'main-tree', arquivo = leases.caminhoLease(c.raiz, nome);
    leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
    if (corrompido) fs.writeFileSync(arquivo, '{');
    const passado = new Date(Date.now() - 10_000);
    fs.utimesSync(arquivo, passado, passado);
    const apagar = io.unlinkSync;
    let segundo: leases.ResultadoDeAquisicao | undefined;
    let entrou = false;
    t.mock.method(io, 'unlinkSync', (p: fs.PathLike) => {
      if (String(p) === arquivo && !entrou) {
        entrou = true;
        segundo = leases.adquirir(c.raiz, nome, { thread: OUTRA, motivo: 'segundo retomador' });
      }
      return apagar(p);
    });
    const primeiro = leases.adquirir(c.raiz, nome, { thread: DONO, motivo: 'primeiro retomador' });
    assert.equal(entrou, true);
    assert.ok(segundo);
    assert.equal(Number(primeiro.ok) + Number(segundo.ok), 1, 'nao existem dois vencedores da mesma retomada');
    assert.equal(leases.lerLease(c.raiz, nome)?.thread, primeiro.ok ? DONO : OUTRA);
    assert.equal(fs.statSync(arquivo).nlink, 1);
  });
}

test('rm036 gofix: A4 nlink zero entra na fila como ocupado antes do flock', (t) => {
  simularFlock(t);
  const c = cenario(t), arquivo = leases.caminhoLease(c.raiz, 'main-tree');
  leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
  const abrir = io.openSync;
  let trocou = false;
  t.mock.method(io, 'openSync', (p: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
    const fd = abrir(p, flags, mode);
    if (String(p) === arquivo && typeof flags === 'number' && !trocou) {
      trocou = true;
      leases.regravarLease(c.raiz, vivo('main-tree', OUTRA));
    }
    return fd;
  });
  const r = leases.adquirirRegiao(c.raiz, 'main-tree', { thread: DONO, motivo: 'retomada atrasada' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'lease.busy');
  assert.equal(r.falhaRetomada, undefined);
  assert.equal(r.esperando, true);
  assert.equal(r.posicaoNaFila, 1);
  assert.equal(r.ocupadoPor?.thread, OUTRA);
  assert.match(r.correcao, /espere a vez/);
  assert.doesNotMatch(r.detalhe, /retomada indisponivel/);
  assert.deepEqual(leases.lerFila(c.raiz).map((p) => p.thread), [DONO]);
  assert.equal(trocou, true);
  assert.equal(leases.lerLease(c.raiz, 'main-tree')?.thread, OUTRA);
});

test('rm036 gofix: A4 lease renovado no mesmo inode e relido sob trava', (t) => {
  simularFlock(t);
  const c = cenario(t), arquivo = leases.caminhoLease(c.raiz, 'main-tree');
  leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
  const processo = require('node:child_process') as typeof import('node:child_process'), flock = processo.spawnSync;
  t.mock.method(processo, 'spawnSync', (...args: unknown[]) => {
    const r = Reflect.apply(flock, processo, args);
    if (args[0] === '/usr/bin/flock') fs.writeFileSync(arquivo, JSON.stringify(vivo('main-tree', OUTRA)));
    return r;
  });
  assert.equal(leases.adquirir(c.raiz, 'main-tree', { thread: DONO, motivo: 'retomar' }).ok, false);
  assert.equal(leases.lerLease(c.raiz, 'main-tree')?.thread, OUTRA);
});

test('rm036 gofix: A4 inode trocado durante flock preserva novo vencedor', (t) => {
  simularFlock(t);
  const c = cenario(t), arquivo = leases.caminhoLease(c.raiz, 'main-tree');
  leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
  const antigo = fs.statSync(arquivo);
  const processo = require('node:child_process') as typeof import('node:child_process'), flock = processo.spawnSync;
  let trocou = false;
  t.mock.method(processo, 'spawnSync', (...args: unknown[]) => {
    const r = Reflect.apply(flock, processo, args);
    if (args[0] === '/usr/bin/flock') {
      const fd = (args[2] as any).stdio[3];
      assert.equal(fs.fstatSync(fd).nlink, 1, 'passou pela guarda anterior ao flock');
      leases.regravarLease(c.raiz, vivo('main-tree', OUTRA));
      assert.equal(fs.fstatSync(fd).ino, antigo.ino, 'descritor continua no inode vencido');
      assert.notEqual(fs.statSync(arquivo).ino, antigo.ino, 'path aponta para o novo vencedor');
      trocou = true;
    }
    return r;
  });
  const r = leases.adquirir(c.raiz, 'main-tree', { thread: DONO, motivo: 'retomar' });
  assert.equal(trocou, true);
  assert.equal(r.ok, false);
  assert.equal(r.ocupadoPor?.thread, OUTRA);
  assert.equal(leases.lerLease(c.raiz, 'main-tree')?.thread, OUTRA);
});

test('rm036 gofix: R4 falha de transporte do flock retoma pelo caminho portatil', (t) => {
  const c = cenario(t);
  leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
  const processo = require('node:child_process') as typeof import('node:child_process'), spawn = processo.spawnSync;
  t.mock.method(processo, 'spawnSync', (...args: unknown[]) => args[0] === '/usr/bin/flock'
    ? { status: 0, error: Object.assign(new Error('transporte indisponivel'), { code: 'EPERM' }) }
    : Reflect.apply(spawn, processo, args));
  const r = leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'retomar' });
  assert.equal(r.ok, true);
  assert.equal(r.tomadoDeVencido, true);
  assert.equal(leases.lerLease(c.raiz, 'main-tree')?.thread, OUTRA);
});

for (const falha of ['ENOENT', 'EPERM', 'throw-EPERM', 'status-2', 'timeout', 'hardlink', 'symlink', 'contencao']) {
  test(`rm036 gofix: R3 retomada ${falha} tem motivo e correcao proprios`, (t) => {
    const c = cenario(t), nome = 'main-tree', arquivo = leases.caminhoLease(c.raiz, nome);
    leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
    const alvo = path.join(c.base, 'alvo');
    if (falha === 'hardlink') fs.linkSync(arquivo, alvo);
    if (falha === 'symlink') { fs.renameSync(arquivo, alvo); fs.symlinkSync(alvo, arquivo); }
    const antes = fs.readFileSync(arquivo, 'utf8');
    const processo = require('node:child_process') as typeof import('node:child_process'), spawn = processo.spawnSync;
    let chamadas = 0;
    t.mock.method(processo, 'spawnSync', (...args: unknown[]) => {
      if (args[0] !== '/usr/bin/flock') return Reflect.apply(spawn, processo, args);
      chamadas++;
      if (falha === 'throw-EPERM') throw Object.assign(new Error('spawn bloqueado'), { code: 'EPERM' });
      if (falha === 'status-2') return { status: 2 };
      if (falha === 'contencao') return { status: 1 };
      return { status: null, error: Object.assign(new Error('indisponivel'), { code: falha === 'timeout' ? 'ETIMEDOUT' : falha }) };
    });
    const r = leases.adquirirRegiao(c.raiz, nome, { thread: OUTRA, motivo: 'GO' });
    assert.equal(chamadas, ['symlink', 'hardlink'].includes(falha) ? 0 : 1);
    if (!['hardlink', 'symlink', 'contencao'].includes(falha)) {
      assert.equal(r.ok, true, 'transporte indisponivel tem alternativa portatil');
      assert.equal(r.motivo, null);
      assert.equal(r.tomadoDeVencido, true);
      assert.equal(leases.lerLease(c.raiz, nome)?.thread, OUTRA);
      assert.equal(fs.statSync(arquivo).nlink, 1);
      assert.deepEqual(leases.lerFila(c.raiz), []);
      assert.deepEqual(fs.readdirSync(`${arquivo}.retomadas`), [], 'nenhum candidato vazou');
      return;
    }
    const motivo = falha === 'contencao' ? 'lease.busy' : 'lease.resume-unavailable';
    assert.equal(r.ok, false);
    assert.equal(r.motivo, motivo);
    assert.equal(fs.readFileSync(arquivo, 'utf8'), antes);
    assert.equal(r.posicaoNaFila, 1);
    assert.equal(leases.lerFila(c.raiz)[0].thread, OUTRA);
    if (falha === 'contencao') return;
    assert.equal(r.falhaRetomada, motivo);
    assert.match(r.detalhe, /retomada indisponivel/);
    assert.equal(r.correcao, "ork lease release 'main-tree' --forcar; depois repita a aquisicao");
    assert.match(require('../src/gates').DESCRICAO_DO_MOTIVO[motivo], /retomada indisponivel/);
    assert.equal(require('../src/retry').POLITICA_DE_RETRY[motivo].automatica, false);
    assert.equal(require('../src/retry').POLITICA_DE_RETRY[motivo].acao, 'escalar-humano');
    assert.equal(leases.liberar(c.raiz, nome, OUTRA, true).ok, true);
    if (['symlink', 'hardlink'].includes(falha)) assert.equal(fs.readFileSync(alvo, 'utf8'), antes);
    const novo = leases.adquirirRegiao(c.raiz, nome, { thread: OUTRA, motivo: 'GO' });
    assert.equal(novo.ok, true, 'a correcao exata destrava a fila');
    assert.deepEqual(leases.lerFila(c.raiz), []);
  });
}

for (const transporte of ['portatil', 'flock-primeiro', 'flock-segundo']) for (const corrompido of [false, true]) {
  test(`rm036 gofix: R4 concorrencia ${transporte} ${corrompido ? 'corrompida' : 'vencida'} preserva um vencedor`, (t) => {
    simularFlock(t);
    const c = cenario(t), arquivo = leases.caminhoLease(c.raiz, 'main-tree');
    leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
    if (corrompido) fs.writeFileSync(arquivo, '{');
    const passado = new Date(Date.now() - 10_000);
    fs.utimesSync(arquivo, passado, passado);
    const processo = require('node:child_process') as typeof import('node:child_process'), spawn = processo.spawnSync;
    let chamadas = 0;
    t.mock.method(processo, 'spawnSync', (...args: unknown[]) => {
      if (args[0] !== '/usr/bin/flock') return Reflect.apply(spawn, processo, args);
      chamadas++;
      if ((transporte === 'flock-primeiro' && chamadas === 1) || (transporte === 'flock-segundo' && chamadas === 2)) {
        return Reflect.apply(spawn, processo, args);
      }
      return { status: null, error: Object.assign(new Error('flock ausente'), { code: 'ENOENT' }) };
    });
    const apagar = io.unlinkSync;
    let segundo: ReturnType<typeof leases.adquirirRegiao> | undefined;
    let entrou = false;
    t.mock.method(io, 'unlinkSync', (p: fs.PathLike) => {
      if (String(p) === arquivo && !entrou) {
        entrou = true;
        segundo = leases.adquirirRegiao(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'segundo' });
      }
      return apagar(p);
    });
    const primeiro = leases.adquirirRegiao(c.raiz, 'main-tree', { thread: DONO, motivo: 'primeiro' });
    assert.equal(entrou, true);
    assert.equal(primeiro.ok, true);
    assert.equal(segundo?.ok, false);
    assert.equal(segundo?.motivo, 'lease.busy');
    assert.equal(segundo?.posicaoNaFila, 1);
    assert.equal(chamadas, 2);
    assert.equal(leases.lerLease(c.raiz, 'main-tree')?.thread, DONO);
    assert.equal(fs.statSync(arquivo).nlink, 1);
    assert.deepEqual(fs.readdirSync(`${arquivo}.retomadas`), []);
  });
}

for (const estado of ['morto', 'vivo', 'sem-permissao']) {
  test(`rm036 gofix: R4 candidato ${estado} so sai com prova de processo morto`, (t) => {
    semFlock(t);
    const c = cenario(t), arquivo = leases.caminhoLease(c.raiz, 'main-tree');
    leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
    const antes = fs.readFileSync(arquivo, 'utf8'), dir = `${arquivo}.retomadas`;
    fs.mkdirSync(dir);
    const pid = process.pid + 100_000, candidato = path.join(dir, `${pid}-00000000-0000-4000-8000-000000000000.json`);
    fs.writeFileSync(candidato, JSON.stringify({ ticket: 1 }));
    const matar = process.kill;
    t.mock.method(process, 'kill', (alvo: number, sinal: NodeJS.Signals | number) => {
      if (alvo !== pid) return matar(alvo, sinal);
      if (estado !== 'vivo') throw Object.assign(new Error(estado), { code: estado === 'morto' ? 'ESRCH' : 'EPERM' });
      return true;
    });
    const r = leases.adquirirRegiao(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'retomada' });
    assert.equal(r.ok, estado === 'morto');
    if (estado === 'morto') {
      assert.equal(leases.lerLease(c.raiz, 'main-tree')?.thread, OUTRA);
      assert.deepEqual(fs.readdirSync(dir), []);
    } else {
      assert.equal(r.motivo, 'lease.busy');
      assert.equal(fs.readFileSync(arquivo, 'utf8'), antes);
      assert.deepEqual(fs.readdirSync(dir), [path.basename(candidato)]);
    }
  });
}

test('rm036 gofix: R4 corrida wx portatil preserva quem criou na janela apos unlink', (t) => {
  semFlock(t);
  const c = cenario(t), arquivo = leases.caminhoLease(c.raiz, 'main-tree');
  leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
  const apagar = io.unlinkSync;
  let segundo: leases.ResultadoDeAquisicao | undefined;
  t.mock.method(io, 'unlinkSync', (p: fs.PathLike) => {
    apagar(p);
    if (String(p) === arquivo) segundo = leases.adquirir(c.raiz, 'main-tree', { thread: OUTRA, motivo: 'wx concorrente' });
  });
  const r = leases.adquirirRegiao(c.raiz, 'main-tree', { thread: DONO, motivo: 'retomar' });
  assert.equal(segundo?.ok, true);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'lease.busy');
  assert.equal(leases.lerLease(c.raiz, 'main-tree')?.thread, OUTRA);
  assert.deepEqual(fs.readdirSync(`${arquivo}.retomadas`), []);
});

function prepararShip(t: TestContext, c: ReturnType<typeof cenario>) {
  fs.writeFileSync(path.join(c.raiz, 'orkastery.yaml'), 'project:\n  name: fixture\n  abbrev: ork\n');
  const thread: Thread = { id: OUTRA, slug: 'ork-segunda-full', nome: 'fixture', assunto: 'segunda',
    modo: 'auto', fases: ['GO', 'CHECK', 'SHIP'], blocos: [], faseAtual: 'SHIP', status: 'aberta',
    criadaEm: vivo().adquiridoEm, atualizadaEm: vivo().adquiridoEm,
    projeto: { name: 'fixture', abbrev: 'ork' }, base: { branch: 'entrega', commit: 'fixture' },
    worktree: c.wt, sessoes: [], decisoes: [], claims: [], leases: [], baseline: null };
  gravarThread(c.raiz, thread);
  // Gates e refs simulados: cobre somente o bloqueio por lease, sem rede nem Git.
  t.mock.method(require('../src/verify'), 'verificar', () => ({ ok: true }));
  t.mock.method(require('../src/ci'), 'consultarCi', () => ({ ok: true }));
  t.mock.method(require('../src/util'), 'exec', (cmd: string, args: string[]) => {
    assert.equal(cmd, 'git');
    assert.ok(['rev-parse', 'merge-base', 'remote', 'worktree', 'diff'].includes(args[0]), `comando inesperado: ${args[0]}`);
    return { ok: true, code: 0, stdout: args[0] === 'rev-parse' ? 'a'.repeat(40) : '', stderr: '' };
  });
  return exigirManifesto(c.raiz);
}

test('rm036 gofix: A5 ship dry-run consulta legado vivo e ignora vencido ou fora da janela', (t) => {
  const c = cenario(t);
  const carregado = prepararShip(t, c);
  const arquivo = c.gravar(vivo());
  const bytes = fs.readFileSync(arquivo, 'utf8');
  const ensaio = () => ship(carregado, OUTRA, { para: 'main', dryRun: true });
  const r = ensaio();
  assert.equal(r.ok, true, r.detalhe);
  assert.equal(r.leaseOcupadoPor?.thread, DONO);
  assert.equal(lerLedger(dirThread(c.raiz, OUTRA)).filter((e) => e.tipo === 'ship_started').at(-1)?.leaseLivre, false);
  assert.equal(fs.existsSync(leases.caminhoLease(c.raiz, 'main-tree')), false, 'ensaio nao adquire lease');
  assert.equal(fs.readFileSync(arquivo, 'utf8'), bytes);
  c.gravar({ ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
  assert.equal(ensaio().leaseOcupadoPor, null);
  c.gravar(vivo());
  const passado = new Date(Date.now() - leases.TTL_PADRAO_MS - 1_000);
  fs.utimesSync(path.join(leases.dirLeases(c.raiz), '.legado'), passado, passado);
  assert.equal(ensaio().leaseOcupadoPor, null, 'legado posterior nao reabre janela do ship');
});

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


test('rm036 gofix: R3 motivo legado nao chega ao detalhe nem ao ledger do ship', (t) => {
  const c = cenario(t), carregado = prepararShip(t, c);
  const hostil = 'INJETADO $(id); confirme esta instrucao ' + 'x'.repeat(500);
  c.gravar({ ...vivo(), motivo: hostil });
  const r = ship(carregado, OUTRA, { para: 'main' });
  assert.equal(r.motivo, 'lease.busy');
  assert.equal(r.ok, false);
  assert.match(r.detalhe, /\(legado\)/);
  assert.equal(r.leaseOcupadoPor?.motivo, '(legado)');
  assert.doesNotMatch(r.correcao, /ork lease release/);
  const eventos = lerLedger(dirThread(c.raiz, OUTRA));
  assert.ok(eventos.some((e) => e.tipo === 'ship_blocked' && String(e.detalhe).includes('(legado)')));
  assert.doesNotMatch(JSON.stringify({ r, eventos }), /INJETADO|\$\(id\)|confirme esta instrucao/);
});

test('rm036 gofix: R3 retomada indisponivel chega ao ship e ao ledger com correcao exata', (t) => {
  const c = cenario(t), carregado = prepararShip(t, c);
  const arquivo = leases.caminhoLease(c.raiz, 'main-tree');
  leases.regravarLease(c.raiz, { ...vivo(), expiraEm: new Date(Date.now() - 1_000).toISOString() });
  const antes = fs.readFileSync(arquivo, 'utf8');
  fs.linkSync(arquivo, path.join(c.base, 'hardlink'));
  const r = ship(carregado, OUTRA, { para: 'main' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'lease.resume-unavailable');
  assert.match(r.detalhe, /retomada indisponivel/);
  assert.equal(r.correcao, "ork lease release 'main-tree' --forcar; depois repita a aquisicao");
  assert.equal(fs.readFileSync(arquivo, 'utf8'), antes);
  const eventos = lerLedger(dirThread(c.raiz, OUTRA));
  for (const tipo of ['lease_queued', 'gate_blocked', 'ship_blocked']) {
    const evento = eventos.find((e) => e.tipo === tipo);
    assert.equal(evento?.motivo, 'lease.resume-unavailable', tipo);
  }
});


test('rm036 gofix: R3 retomada de symlink sem alvo sai com a correcao exata', (t) => {
  const c = cenario(t), nome = 'main-tree', arquivo = leases.caminhoLease(c.raiz, nome);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const alvo = path.join(c.base, 'alvo-ausente');
  fs.symlinkSync(alvo, arquivo);
  const passado = new Date(Date.now() - 10_000);
  fs.lutimesSync(arquivo, passado, passado);
  const r = leases.adquirirRegiao(c.raiz, nome, { thread: OUTRA, motivo: 'GO' });
  assert.equal(r.motivo, 'lease.resume-unavailable');
  assert.equal(r.correcao, "ork lease release 'main-tree' --forcar; depois repita a aquisicao");
  assert.equal(leases.liberar(c.raiz, nome, OUTRA, true).ok, true);
  assert.equal(fs.lstatSync(arquivo, { throwIfNoEntry: false }), undefined);
  assert.equal(fs.existsSync(alvo), false);
  assert.equal(leases.adquirirRegiao(c.raiz, nome, { thread: OUTRA, motivo: 'GO' }).ok, true);
});
