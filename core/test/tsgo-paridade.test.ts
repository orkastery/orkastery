/**
 * RM-072 (D14, T8 da ork-check5x): o `tsgo` (o TypeScript 7 nativo, pacote `@typescript/native-preview`) no preparo do
 * Agile Check deste projeto. O `tsc` do Classic segue o 5.9.3 no mesmo binario; o contrato de paridade passa numa arvore
 * pequena e cai com diagnostico a mais, a menos e emit com token diferente; o preparo usa o `tsgo` so na arvore fria, roda
 * o preparo do Classic quando o estado incremental do `tsc` existe, e a peca chega ao `verify_run`. Os nomes comecam por
 * "TGn:".
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { lerLedger } from '../src/ledger';
import { carregarManifesto } from '../src/manifest';
import { dirThread, novaThread } from '../src/thread';
import { verificar } from '../src/verify';
import { ajustarManifesto, dirTemporario, projetoTemporario } from './apoio';

const CORE = path.resolve(__dirname, '..', '..');
const PARIDADE = path.join(CORE, 'scripts', 'tsgo-paridade.cjs');
const PREPARO = path.join(CORE, 'scripts', 'preparo-tsgo.cjs');
const TSCONFIGS = ['tsconfig.json', 'tsconfig.test.json', 'tsconfig.tsgo.json', 'tsconfig.tsgo.test.json'];

interface ResultadoDaParidade {
  paridade: boolean;
  tsc: string;
  typecheck: { paridade: boolean; limpo: { tsc: string[]; tsgo: string[] }; mutantes: { tsc: string[]; tsgo: string[] }; acusadosTsc: number };
  emit: { paridade: boolean; dist: { arquivos: number }; distTest: { arquivos: number } };
}

interface ComparacaoDoEmit {
  arquivos: number;
  bytesIguais: number;
  tokensIguais: number;
  diferentes: Array<{ arquivo: string; tsgo: string | null; tsc: string | null }>;
  soNoTsgo: string[];
  soNoTsc: string[];
}

/**
 * Uma arvore pequena com as tsconfig de verdade do core, um src com `index.ts`, um test e os scripts de build do core. O
 * `node_modules` e o do core por link; `semTsgo` liga cada pacote menos o `@typescript` (o `tsgo`).
 */
const modelosDeArvore = new Map<boolean, string>();

function modeloDeArvore(semTsgo: boolean): string {
  const existente = modelosDeArvore.get(semTsgo);
  if (existente) return existente;
  const dir = dirTemporario(`tg-modelo-${semTsgo ? 'sem' : 'com'}-tsgo`);
  for (const f of TSCONFIGS) fs.copyFileSync(path.join(CORE, f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), '#!/usr/bin/env node\nimport { soma } from \'./util\';\nconsole.log(soma(1, 2));\n');
  fs.writeFileSync(path.join(dir, 'src', 'util.ts'), 'export function soma(a: number, b: number): number {\n  return a + b;\n}\n');
  fs.writeFileSync(path.join(dir, 'test', 'util.test.ts'), 'import { soma } from \'../src/util\';\nif (soma(1, 2) !== 3) throw new Error(\'soma\');\n');
  const scripts = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8')).scripts as Record<string, string>;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'arvore', private: true,
    scripts: { build: scripts.build, 'build:test': scripts['build:test'] } }));
  const nm = path.join(CORE, 'node_modules');
  if (semTsgo) {
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    for (const e of fs.readdirSync(nm).filter((n) => !n.startsWith('.') && n !== '@typescript')) {
      fs.symlinkSync(path.join(nm, e), path.join(dir, 'node_modules', e));
    }
    fs.symlinkSync('../typescript/bin/tsc', path.join(dir, 'node_modules', '.bin', 'tsc'));
  } else {
    fs.symlinkSync(nm, path.join(dir, 'node_modules'));
  }
  modelosDeArvore.set(semTsgo, dir);
  process.once('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function arvore(nome: string, opcoes: { semTsgo?: boolean } = {}): string {
  const dir = dirTemporario(nome);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(modeloDeArvore(opcoes.semTsgo === true), dir, { recursive: true });
  return dir;
}

function paridadeNa(dir: string): { status: number | null; saida: string; r: ResultadoDaParidade } {
  const saida = path.join(dir, 'paridade.json');
  const p = spawnSync(process.execPath, [PARIDADE, '--saida', saida], { env: { ...process.env, ORK_TSGO_CORE: dir }, encoding: 'utf8' });
  return { status: p.status, saida: p.stdout + p.stderr, r: JSON.parse(fs.readFileSync(saida, 'utf8')) as ResultadoDaParidade };
}

function preparoNa(dir: string): { status: number | null; stderr: string; pecas: Array<Record<string, unknown>> } {
  const relatorio = path.join(dir, 'relatorio.jsonl');
  fs.writeFileSync(relatorio, '');
  const p = spawnSync(process.execPath, [PREPARO], { env: { ...process.env, ORK_TSGO_CORE: dir, ORK_CHECK_RELATORIO: relatorio },
    encoding: 'utf8' });
  const pecas = fs.readFileSync(relatorio, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  return { status: p.status, stderr: p.stderr, pecas };
}

function npm(dir: string, script: string): void {
  const r = spawnSync('npm', ['run', script], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

const existe = (dir: string, rel: string): boolean => fs.existsSync(path.join(dir, rel));

test('TG1: o tsc do Classic segue o 5.9.3 no mesmo binario, e o tsgo e o pacote fixado na versao exata', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8')) as
    { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.equal(pkg.dependencies.typescript, '5.9.3');
  assert.equal(pkg.devDependencies['@typescript/native-preview'], '7.0.0-dev.20260707.2', 'versao exata, sem faixa');
  assert.equal(fs.realpathSync(path.join(CORE, 'node_modules', '.bin', 'tsc')), fs.realpathSync(path.join(CORE, 'node_modules', 'typescript', 'bin', 'tsc')));
  const tsc = spawnSync(process.execPath, [path.join(CORE, 'node_modules', '.bin', 'tsc'), '--version'], { encoding: 'utf8' });
  assert.equal(tsc.stdout.trim(), 'Version 5.9.3');
  const tsgo = spawnSync(process.execPath, [path.join(CORE, 'node_modules', '.bin', 'tsgo'), '--version'], { encoding: 'utf8' });
  assert.equal(tsgo.stdout.trim(), 'Version 7.0.0-dev.20260707.2');
  assert.equal(pkg.scripts.build, 'tsc --build tsconfig.json && chmod +x dist/index.js', 'o build do Classic nao muda');
  assert.equal(pkg.scripts['build:test'], 'tsc --build tsconfig.test.json');
  assert.equal(pkg.scripts['preparo:tsgo'], 'node scripts/preparo-tsgo.cjs');
  for (const [f, base] of [['tsconfig.tsgo.json', './tsconfig.json'], ['tsconfig.tsgo.test.json', './tsconfig.test.json']]) {
    const json = JSON.parse(fs.readFileSync(path.join(CORE, f), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as
      { extends: string; compilerOptions: Record<string, unknown> };
    assert.equal(json.extends, base, f);
    assert.deepEqual(json.compilerOptions, { moduleResolution: 'bundler', incremental: false, tsBuildInfoFile: null }, f);
  }
});

test('TG2: o contrato passa numa arvore pequena: o mesmo typecheck, os sete mutantes acusados pelos dois e o mesmo emit', () => {
  const dir = arvore('tg2');
  try {
    const { status, saida, r } = paridadeNa(dir);
    assert.equal(status, 0, saida);
    assert.equal(r.paridade, true);
    assert.equal(r.tsc, '5.9.3');
    assert.deepEqual(r.typecheck.limpo, { ...r.typecheck.limpo, tsc: [], tsgo: [] });
    assert.equal(r.typecheck.acusadosTsc, 7);
    assert.deepEqual(r.typecheck.mutantes.tsgo, r.typecheck.mutantes.tsc);
    assert.deepEqual(r.typecheck.mutantes.tsc.map((d) => d.split(':')[2]).sort(),
      ['TS2307', 'TS2322', 'TS2322', 'TS2339', 'TS2554', 'TS6133', 'TS7006']);
    assert.ok(r.emit.dist.arquivos === 2 && r.emit.distTest.arquivos === 3, JSON.stringify(r.emit));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TG3: o contrato cai com diagnostico a menos e a mais no tsgo', () => {
  const menos = arvore('tg3-menos');
  const mais = arvore('tg3-mais');
  try {
    // O tsgo sem noUnusedLocals deixa passar o mutante da variavel sem uso.
    fs.writeFileSync(path.join(menos, 'tsconfig.tsgo.test.json'), JSON.stringify({ extends: './tsconfig.test.json',
      compilerOptions: { moduleResolution: 'bundler', incremental: false, tsBuildInfoFile: null, noUnusedLocals: false } }));
    const a = paridadeNa(menos);
    assert.equal(a.status, 1, a.saida);
    assert.equal(a.r.typecheck.paridade, false);
    assert.ok(a.r.typecheck.mutantes.tsc.some((d) => d.endsWith(':TS6133')) && !a.r.typecheck.mutantes.tsgo.some((d) => d.endsWith(':TS6133')));
    // O tsgo com noImplicitReturns acusa na arvore limpa o que o tsc aceita.
    fs.writeFileSync(path.join(mais, 'src', 'retorno.ts'), 'export function talvez(x: number): number | undefined {\n  if (x) return 1;\n}\n');
    for (const f of ['tsconfig.tsgo.json', 'tsconfig.tsgo.test.json']) {
      fs.writeFileSync(path.join(mais, f), JSON.stringify({ extends: f === 'tsconfig.tsgo.json' ? './tsconfig.json' : './tsconfig.test.json',
        compilerOptions: { moduleResolution: 'bundler', incremental: false, tsBuildInfoFile: null, noImplicitReturns: true } }));
    }
    const b = paridadeNa(mais);
    assert.equal(b.status, 1, b.saida);
    assert.deepEqual(b.r.typecheck.limpo.tsc, []);
    assert.deepEqual(b.r.typecheck.limpo.tsgo, ['src/retorno.ts:1:TS7030']);
    assert.equal(b.r.emit.paridade, false, 'arvore com erro de tipo nao tem emit para comparar');
  } finally {
    fs.rmSync(menos, { recursive: true, force: true });
    fs.rmSync(mais, { recursive: true, force: true });
  }
});

test('TG4: a comparacao do emit separa espaco de token: quebra de linha e comentario passam, token e arquivo de um lado so caem', () => {
  const { compararEmit } = require(PARIDADE) as { compararEmit: (ts: unknown, a: string, b: string) => ComparacaoDoEmit };
  const ts = require(path.join(CORE, 'node_modules', 'typescript')) as unknown;
  const dir = dirTemporario('tg4');
  try {
    const escrever = (lado: string, rel: string, texto: string): void => {
      fs.mkdirSync(path.dirname(path.join(dir, lado, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, lado, rel), texto);
    };
    escrever('tsgo', 'quebra.js', 'const a = 1;\nf(a, "b");\n');
    escrever('tsc', 'quebra.js', 'const a = 1; f(a,\n    "b");\n');
    escrever('tsgo', 'comentario.js', '// x\nh();\n');
    escrever('tsc', 'comentario.js', 'h();\n');
    escrever('tsgo', 'sub/igual.js', '"use strict";\n');
    escrever('tsc', 'sub/igual.js', '"use strict";\n');
    escrever('tsgo', 'token.js', 'g(1);\n');
    escrever('tsc', 'token.js', 'g(2);\n');
    escrever('tsgo', 'so-tsgo.js', 'x();\n');
    escrever('tsc', 'so-tsc.js', 'y();\n');
    const r = compararEmit(ts, path.join(dir, 'tsgo'), path.join(dir, 'tsc'));
    assert.equal(r.arquivos, 5);
    assert.equal(r.bytesIguais, 1);
    assert.equal(r.tokensIguais, 3);
    assert.deepEqual(r.diferentes.map((d) => d.arquivo), ['token.js']);
    assert.ok(r.diferentes[0].tsgo?.endsWith(':1') && r.diferentes[0].tsc?.endsWith(':2'), JSON.stringify(r.diferentes));
    assert.deepEqual(r.soNoTsgo, ['so-tsgo.js']);
    assert.deepEqual(r.soNoTsc, ['so-tsc.js']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TG5: na arvore fria, o preparo emite dist e dist-test com o tsgo, apaga o .tsbuildinfo que sobrou e relata a peca agile', () => {
  const dir = arvore('tg5');
  try {
    npm(dir, 'build');
    assert.ok(existe(dir, 'dist/.tsbuildinfo') && !existe(dir, 'dist-test'), 'meio fria: so o build do src');
    const r = preparoNa(dir);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['dist/index.js', 'dist/util.js', 'dist-test/src/util.js', 'dist-test/test/util.test.js']) assert.ok(existe(dir, f), f);
    assert.ok(!existe(dir, 'dist/.tsbuildinfo') && !existe(dir, 'dist-test/.tsbuildinfo'), 'o proximo tsc --build emite do zero');
    assert.ok(fs.statSync(path.join(dir, 'dist', 'index.js')).mode & 0o111, 'dist/index.js executavel, como no build');
    assert.deepEqual(r.pecas, [{ tipo: 'peca', peca: 'tsgo', estado: 'agile' }]);
    const roda = spawnSync(process.execPath, [path.join(dir, 'dist-test', 'test', 'util.test.js')], { encoding: 'utf8' });
    assert.equal(roda.status, 0, roda.stderr);
    npm(dir, 'build');
    npm(dir, 'build:test');
    assert.ok(existe(dir, 'dist/.tsbuildinfo') && existe(dir, 'dist-test/.tsbuildinfo'), 'o tsc refaz o proprio estado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TG6: com o estado incremental do tsc, o preparo roda o preparo do Classic, mantem o estado e relata a peca em fallback', () => {
  const dir = arvore('tg6', { semTsgo: true });
  try {
    npm(dir, 'build');
    npm(dir, 'build:test');
    const r = preparoNa(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existe(dir, 'dist/.tsbuildinfo') && existe(dir, 'dist-test/.tsbuildinfo'));
    assert.equal(r.pecas.length, 1);
    assert.equal(r.pecas[0].peca, 'tsgo');
    assert.equal(r.pecas[0].estado, 'fallback');
    assert.match(String(r.pecas[0].motivo), /build incremental do tsc presente/);
    assert.equal(r.pecas[0].fallback, 'npm run build && npm run build:test');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TG7: sem o tsgo, a arvore fria sai 127; erro de tipo sai com o codigo do compilador e sem a peca', () => {
  const sem = arvore('tg7-sem', { semTsgo: true });
  const erro = arvore('tg7-erro');
  try {
    const a = preparoNa(sem);
    assert.equal(a.status, 127);
    assert.match(a.stderr, /o tsgo \(@typescript\/native-preview\) nao esta instalado/);
    assert.deepEqual(a.pecas, []);
    fs.writeFileSync(path.join(erro, 'src', 'erro.ts'), 'export const x: number = "y";\n');
    const b = preparoNa(erro);
    assert.ok(b.status !== 0 && b.status !== 127, String(b.status));
    assert.deepEqual(b.pecas, []);
  } finally {
    fs.rmSync(sem, { recursive: true, force: true });
    fs.rmSync(erro, { recursive: true, force: true });
  }
});

test('TG8: no verify do Agile, o preparo com o tsgo e o preparo da rodada, e as pecas preparo e tsgo chegam ao verify_run', () => {
  const dir = arvore('tg8');
  const p = projetoTemporario('tg8-projeto');
  try {
    ajustarManifesto(p, '  # build: nao detectado', '  build: "echo passo-a"');
    ajustarManifesto(p, '  # test: nao detectado', '  test: "echo test"\n  preparo: "echo passo-a"');
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), `\ncheck:\n  mode: agile\n  agile:\n    produto:\n      - "README.md"\n` +
      `    preparo: "ORK_TSGO_CORE=${dir} node ${PREPARO}"\n`);
    p.carregado = carregarManifesto(p.dir)!;
    assert.deepEqual(p.carregado.erros, []);
    const { thread: t } = novaThread(p.carregado, { nome: 'tsgo no preparo', modo: 'auto' });
    const r = verificar(p.carregado, t.id, {});
    assert.equal(r.ok, true, r.motivos.join(','));
    assert.ok(existe(dir, 'dist-test/test/util.test.js'), 'o tsgo emitiu na arvore');
    const e = lerLedger(dirThread(p.dir, t.id)).filter((x) => x.tipo === 'verify_run').at(-1)!;
    const pecas = (e.agile as { pecas: Array<Record<string, unknown>> }).pecas;
    assert.ok(pecas.some((x) => x.peca === 'preparo' && x.estado === 'agile'), JSON.stringify(pecas));
    assert.ok(pecas.some((x) => x.peca === 'tsgo' && x.estado === 'agile'), JSON.stringify(pecas));
  } finally {
    p.limpar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TG9: enquanto o preparo do Agile usar o tsgo, o CI confere a paridade no core inteiro em todo PR, fora da thread de origem (RM-074 F4)', () => {
  const raiz = path.resolve(CORE, '..');
  const manifesto = fs.readFileSync(path.join(raiz, 'orkastery.yaml'), 'utf8');
  assert.match(manifesto, /^ {4}preparo: "npm --prefix core run preparo:tsgo"$/m, 'o preparo do Agile deste projeto usa o tsgo');
  const ci = fs.readFileSync(path.join(raiz, '.github', 'workflows', 'ci.yml'), 'utf8');
  const inicio = ci.indexOf('\n  nucleo:\n');
  assert.ok(inicio >= 0, 'o job nucleo do ci.yml');
  const fim = ci.slice(inicio + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const nucleo = fim < 0 ? ci.slice(inicio) : ci.slice(inicio, inicio + 1 + fim);
  const passo = /\n {6}- name: paridade do tsgo com o tsc\n((?: {8}.*\n)+)/.exec(nucleo);
  assert.ok(passo, 'o passo da paridade no job nucleo, que roda em todo PR');
  assert.match(passo[1], /^ {8}run: node scripts\/tsgo-paridade\.cjs --resumo$/m);
  assert.match(passo[1], /^ {8}working-directory: core$/m);
  assert.ok(nucleo.indexOf('- name: instalar') < nucleo.indexOf('- name: paridade do tsgo com o tsc'), 'depois do npm ci, que traz o tsgo');
  assert.match(ci, /^on:\n(?: {2}.*\n)*? {2}pull_request:/m, 'o ci.yml roda em pull_request');
});
