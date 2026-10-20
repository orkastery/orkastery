/**
 * RM-037, defeitos de condução de 19 e 20/10/2026, defeito 2: a worktree nova nasce com as dependências.
 *
 * O `git worktree add` traz só o que o git rastreia; o `node_modules` não vinha, e a baseline da thread recusava com
 * `baseline.dependencia-ausente` (código 127 no build). Aqui o projeto de teste imita isso sem rede: o build é
 * `deps/ferramenta`, que o `.gitignore` deixa fora do git, e o preparo declarado em `worktree.dependencias` o cria.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerLedger } from '../src/ledger';
import { comLocale, msg } from '../src/locale';
import { carregarManifesto } from '../src/manifest';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { gravarBaseline, verificar } from '../src/verify';
import { ajustarManifesto, commitar, dirTemporario, ProjetoDeTeste, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const PREPARO = 'mkdir -p deps && ln -sf /bin/true deps/ferramenta';

/** A CLI do HEAD, com HOME proprio e sem as variaveis de quem roda o teste. */
function ork(dir: string, casa: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', ORK_FABRICA_PUBLICAR: '0' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** O projeto cujo build depende do que o git ignora; `preparo` vai a `worktree.dependencias` quando dado. */
function projeto(nome: string, preparo: string | null): ProjetoDeTeste {
  const p = projetoTemporario(nome);
  ajustarManifesto(p, '  # build: nao detectado', '  build: "deps/ferramenta"');
  if (preparo !== null) ajustarManifesto(p, /^( {2}por_thread: .*)$/m, `$1\n  dependencias: "${preparo.replace(/"/g, '\\"')}"`);
  commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'manifesto com o build e o preparo');
  commitar(p.dir, '.gitignore', 'deps/\n', 'o que o git ignora');
  return p;
}

const eventos = (p: ProjetoDeTeste, id: string, tipo: string) => lerLedger(dirThread(p.dir, id)).filter((e) => e.tipo === tipo);
const idDaSaida = (saida: string) => /^\s*id\s+(\S+)$/m.exec(saida)?.[1] ?? '';

test('defeito 2 (19 e 20/10/2026): ork thread new --worktree auto roda worktree.dependencias na worktree nova; a baseline passa', () => {
  const p = projeto('rm037d2010-deps', PREPARO);
  const casa = dirTemporario('rm037d2010-deps-casa');
  try {
    const r = ork(p.dir, casa, 'thread', 'new', 'Dependencias', '--modo', 'auto', '--worktree', 'auto');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`  dependencias  ${PREPARO.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\(worktree\\.dependencias\\) ok em \\d+ s`));
    const id = idDaSaida(r.stdout);
    const wt = lerThread(p.dir, id).worktree!;
    assert.ok(fs.existsSync(path.join(wt, 'deps', 'ferramenta')), 'o preparo rodou dentro da worktree');
    assert.equal(fs.existsSync(path.join(p.dir, 'deps')), false, 'e nao na raiz');
    const [preparo] = eventos(p, id, 'worktree_dependencias');
    assert.equal(preparo.ok, true); assert.equal(preparo.code, 0); assert.equal(preparo.comando, PREPARO); assert.equal(preparo.dir, wt);
    const tipos = lerLedger(dirThread(p.dir, id)).map((e) => e.tipo);
    assert.ok(tipos.indexOf('worktree_created') < tipos.indexOf('worktree_dependencias'), 'o preparo vem depois da worktree');
    assert.equal(exec('git', ['status', '--porcelain'], wt).stdout.trim(), '', 'o que o preparo criou fica fora do git');
    const b = gravarBaseline(p.carregado, id);
    assert.equal(b.comandos.find((c) => c.nome === 'build')?.ok, true, 'sem o preparo, a baseline recusava com o codigo 127');
  } finally { p.limpar(); fs.rmSync(casa, { recursive: true, force: true }); }
});

test('defeito 2: o preparo que falha nao desfaz a thread; o ledger guarda o codigo e a saida, e o aviso e a recusa dizem o comando', () => {
  const falha = 'echo cache-vazio-e-sem-rede >&2; exit 3';
  const p = projeto('rm037d2010-deps-falha', falha);
  const casa = dirTemporario('rm037d2010-deps-falha-casa');
  try {
    const r = ork(p.dir, casa, 'thread', 'new', 'Dependencias que falham', '--modo', 'auto', '--worktree', 'auto');
    assert.equal(r.status, 0, 'a thread nasce mesmo com o preparo falhando');
    const id = idDaSaida(r.stdout);
    const wt = lerThread(p.dir, id).worktree!;
    assert.ok(fs.existsSync(wt));
    assert.ok(r.stderr.includes('Aviso: o preparo das dependencias da worktree (worktree.dependencias) saiu com codigo 3: ' +
      `cache-vazio-e-sem-rede. A thread e a worktree ficam; antes do build e da baseline, rode na worktree: cd ${wt} && ${falha}`), r.stderr);
    const [preparo] = eventos(p, id, 'worktree_dependencias');
    assert.equal(preparo.ok, false); assert.equal(preparo.code, 3);
    assert.match(String(preparo.trecho), /cache-vazio-e-sem-rede/);
    assert.throws(() => gravarBaseline(p.carregado, id),
      new RegExp('baseline\\.dependencia-ausente: build nao executou porque o comando nao existe \\(codigo 127\\): deps/ferramenta; ' +
        'rode na worktree da thread o preparo do manifesto \\(worktree\\.dependencias\\): echo cache-vazio-e-sem-rede >&2; exit 3'));
  } finally { p.limpar(); fs.rmSync(casa, { recursive: true, force: true }); }
});

test('defeito 2: sem a chave nada roda nem se grava, e a recusa da baseline diz como declarar o preparo', () => {
  const p = projeto('rm037d2010-deps-sem', null);
  try {
    const criada = novaThread(p.carregado, { nome: 'sem preparo', modo: 'auto', criarWorktree: true });
    assert.equal(criada.dependencias ?? null, null);
    assert.equal(eventos(p, criada.thread.id, 'worktree_dependencias').length, 0);
    assert.equal(fs.existsSync(path.join(criada.thread.worktree!, 'deps')), false);
    assert.throws(() => gravarBaseline(p.carregado, criada.thread.id),
      /baseline\.dependencia-ausente: build nao executou .*; instale ou prepare as dependencias antes de gravar a baseline; para o ork preparar toda worktree nova, declare o comando em worktree\.dependencias no manifesto/);
  } finally { p.limpar(); }
});

test('defeito 2: ork worktree ensure recria a worktree sem o que o git ignora e roda o preparo de novo', () => {
  const p = projeto('rm037d2010-deps-ensure', PREPARO);
  const casa = dirTemporario('rm037d2010-deps-ensure-casa');
  try {
    const { thread, dependencias } = novaThread(p.carregado, { nome: 'ensure', modo: 'auto', criarWorktree: true });
    assert.equal(dependencias?.ok, true);
    const wt = thread.worktree!;
    assert.ok(exec('git', ['worktree', 'remove', '--force', wt], p.dir).ok);
    const r = ork(p.dir, casa, 'worktree', 'ensure', thread.id);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /  dependencias  mkdir -p deps && ln -sf \/bin\/true deps\/ferramenta \(worktree\.dependencias\) ok em \d+ s/);
    assert.ok(fs.existsSync(path.join(wt, 'deps', 'ferramenta')));
    assert.equal(eventos(p, thread.id, 'worktree_dependencias').length, 2, 'uma na criacao, outra na recriacao');
    // Com a worktree de pe, o ensure so confere: nada roda de novo.
    assert.equal(ork(p.dir, casa, 'worktree', 'ensure', thread.id).status, 0);
    assert.equal(eventos(p, thread.id, 'worktree_dependencias').length, 2);
  } finally { p.limpar(); fs.rmSync(casa, { recursive: true, force: true }); }
});

test('defeito 2: o manifesto aceita worktree.dependencias so como texto; vazio e o mesmo que nenhum', () => {
  const p = projetoTemporario('rm037d2010-deps-manifesto');
  try {
    const yaml = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(yaml, 'utf8');
    const com = (valor: string) => {
      fs.writeFileSync(yaml, original.replace(/^( {2}por_thread: .*)$/m, `$1\n  dependencias: ${valor}`));
      return carregarManifesto(p.dir)!;
    };
    assert.equal(com('"npm ci --prefer-offline"').manifesto.worktree.dependencias, 'npm ci --prefer-offline');
    assert.equal(com('"   "').manifesto.worktree.dependencias, undefined);
    assert.equal(com('"   "').erros.length, 0);
    const lista = com('[1, 2]');
    assert.ok(lista.erros.some((e) => e.startsWith('worktree.dependencias precisa ser o comando, em texto')), lista.erros.join('; '));
  } finally { p.limpar(); }
});

test('defeito 2: as linhas do preparo nas duas linguas, com o comando exato e o diretorio', () => {
  const linhas = () => {
    const m = msg().worktree;
    return [m.dependenciasProntas(PREPARO, 9), m.dependenciasFalharam('npm ci', 3, false, '/tmp/wt', 'sem rede'),
      m.dependenciasFalharam('npm ci', -1, true, '/tmp/wt', '')];
  };
  assert.deepEqual(comLocale('pt-BR', linhas), [
    `  dependencias  ${PREPARO} (worktree.dependencias) ok em 9 s`,
    'Aviso: o preparo das dependencias da worktree (worktree.dependencias) saiu com codigo 3: sem rede. A thread e a worktree ' +
      'ficam; antes do build e da baseline, rode na worktree: cd /tmp/wt && npm ci',
    'Aviso: o preparo das dependencias da worktree (worktree.dependencias) estourou o prazo. A thread e a worktree ficam; antes ' +
      'do build e da baseline, rode na worktree: cd /tmp/wt && npm ci',
  ]);
  assert.deepEqual(comLocale('en', linhas), [
    `  dependencies  ${PREPARO} (\`worktree.dependencias\`) ok in 9 s`,
    'Warning: preparing the worktree dependencies (`worktree.dependencias`) exited with code 3: sem rede. The thread and the ' +
      'worktree stay; before the build and the baseline, run in the worktree: `cd /tmp/wt && npm ci`',
    'Warning: preparing the worktree dependencies (`worktree.dependencias`) ran past its deadline. The thread and the worktree ' +
      'stay; before the build and the baseline, run in the worktree: `cd /tmp/wt && npm ci`',
  ]);
});

/**
 * CHECK 3 da ork-rm037defeit2, achado 2: o passo do arco #Noctum abre a thread segurando a trava de despacho, e o preparo
 * (até 10 min) não pode rodar ali. A criação com `adiarDependencias` só anota o preparo como pendente; a baseline e o verify
 * o rodam antes do primeiro comando, na fila pesada que eles já seguram, e nunca rodam sem ele.
 */
test('defeito 2 (CHECK 3): a thread aberta com o preparo adiado nao roda nada; a baseline roda o preparo antes dos comandos e passa', () => {
  const p = projeto('rm037d2010-deps-adiado', PREPARO);
  try {
    const criada = novaThread(p.carregado, { nome: 'adiado', modo: 'auto', criarWorktree: true, adiarDependencias: true });
    const id = criada.thread.id, wt = criada.thread.worktree!;
    assert.equal(criada.dependencias ?? null, null, 'nada rodou na criacao');
    assert.equal(fs.existsSync(path.join(wt, 'deps')), false);
    const [pendente] = eventos(p, id, 'worktree_dependencias_pendentes');
    assert.equal(pendente.dir, wt); assert.equal(pendente.comando, PREPARO);
    assert.equal(eventos(p, id, 'worktree_dependencias').length, 0);
    const b = gravarBaseline(p.carregado, id);
    assert.equal(b.comandos.find((c) => c.nome === 'build')?.ok, true, 'sem o preparo, o build saia 127');
    assert.ok(fs.existsSync(path.join(wt, 'deps', 'ferramenta')), 'o preparo rodou dentro da worktree');
    const tipos = lerLedger(dirThread(p.dir, id)).map((e) => e.tipo);
    assert.ok(tipos.indexOf('worktree_dependencias_pendentes') < tipos.indexOf('worktree_dependencias') &&
      tipos.indexOf('worktree_dependencias') < tipos.indexOf('baseline_recorded'), tipos.join(' '));
    const [preparo] = eventos(p, id, 'worktree_dependencias');
    assert.equal(preparo.ok, true); assert.equal(preparo.dir, wt);
    // Com o preparo ok, nada fica pendente: a baseline seguinte e o verify nao o repetem.
    gravarBaseline(p.carregado, id);
    verificar(p.carregado, id);
    assert.equal(eventos(p, id, 'worktree_dependencias').length, 1);
  } finally { p.limpar(); }
});

test('defeito 2 (CHECK 3): o preparo adiado que falha recusa a baseline e o verify antes do primeiro comando; o seguinte repete o preparo', () => {
  const falha = 'test -f liberado || { echo cache-vazio-e-sem-rede >&2; exit 3; }; mkdir -p deps && ln -sf /bin/true deps/ferramenta';
  const p = projeto('rm037d2010-deps-adiado-falha', falha);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'adiado que falha', modo: 'auto', criarWorktree: true, adiarDependencias: true });
    const wt = thread.worktree!;
    assert.throws(() => gravarBaseline(p.carregado, thread.id), (e: Error) => {
      assert.equal(e.message, 'baseline.dependencia-ausente: o preparo adiado da worktree (worktree.dependencias) saiu com codigo 3: ' +
        `cache-vazio-e-sem-rede; a baseline nao foi gravada sem as dependencias. Rode na worktree cd ${wt} && ${falha}; ` +
        'a proxima baseline repete o preparo antes dos comandos');
      return true;
    });
    assert.equal(eventos(p, thread.id, 'baseline_recorded').length, 0, 'nenhuma baseline sobre a worktree sem dependencias');
    assert.throws(() => verificar(p.carregado, thread.id), /verify\.dependencia-ausente: o preparo adiado da worktree \(worktree\.dependencias\) saiu com codigo 3/);
    assert.equal(eventos(p, thread.id, 'verify_run').length, 0, 'nenhum verify sobre a worktree sem dependencias');
    assert.deepEqual(eventos(p, thread.id, 'worktree_dependencias').map((e) => [e.ok, e.code]), [[false, 3], [false, 3]]);
    // A causa resolvida na worktree: a baseline seguinte repete o preparo e grava.
    fs.writeFileSync(path.join(wt, 'liberado'), '');
    const b = gravarBaseline(p.carregado, thread.id);
    assert.equal(b.comandos.find((c) => c.nome === 'build')?.ok, true);
    assert.deepEqual(eventos(p, thread.id, 'worktree_dependencias').map((e) => e.ok), [false, false, true]);
  } finally { p.limpar(); }
});

test('defeito 2 (CHECK 3): a recusa do preparo adiado nas duas linguas, com o codigo ou o estouro e o comando exato', () => {
  const linhas = () => {
    const m = msg().verify;
    return [m.dependenciasPendentesFalharam('baseline', 'npm ci', 3, false, '/tmp/wt', 'sem rede'),
      m.dependenciasPendentesFalharam('verify', 'npm ci', -1, true, '/tmp/wt', '')];
  };
  assert.deepEqual(comLocale('pt-BR', linhas), [
    'baseline.dependencia-ausente: o preparo adiado da worktree (worktree.dependencias) saiu com codigo 3: sem rede; a baseline ' +
      'nao foi gravada sem as dependencias. Rode na worktree cd /tmp/wt && npm ci; a proxima baseline repete o preparo antes dos comandos',
    'verify.dependencia-ausente: o preparo adiado da worktree (worktree.dependencias) estourou o prazo; o verify nao rodou sem as ' +
      'dependencias. Rode na worktree cd /tmp/wt && npm ci; o proximo verify repete o preparo antes dos comandos',
  ]);
  assert.deepEqual(comLocale('en', linhas), [
    'baseline.missing-dependency: the deferred worktree preparation (`worktree.dependencias`) exited with code 3: sem rede; the ' +
      'baseline was not recorded without the dependencies. Run in the worktree `cd /tmp/wt && npm ci`; the next baseline repeats ' +
      'the preparation before the commands',
    'verify.missing-dependency: the deferred worktree preparation (`worktree.dependencias`) ran past its deadline; verify did not ' +
      'run without the dependencies. Run in the worktree `cd /tmp/wt && npm ci`; the next verify repeats the preparation before ' +
      'the commands',
  ]);
});
