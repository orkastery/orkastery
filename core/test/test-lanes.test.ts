/**
 * RM-072 (fatia 1 do Agile, T4 da ork-check5x): as lanes de teste deste projeto (`scripts/test-lanes.cjs`). A uniao das
 * lanes e o glob do `npm test`, sem arquivo nas duas; a hermetica e o conjunto do `test:ci`; a de integracao e a lista
 * unica do nucleo; a ordem segue a ultima duracao medida; o orcamento acusa sem reprovar; a lista e as duracoes vao ao
 * relatorio do CHECK. Os nomes comecam por "TLn:".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TESTES_DE_INTEGRACAO_LOCAL } from '../src/integracoes-locais';

const CORE = path.resolve(__dirname, '../..');
const SCRIPT = path.join(CORE, 'scripts', 'test-lanes.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lanes = require(SCRIPT) as {
  listasDasLanes: (dir?: string, integracao?: ReadonlySet<string>) => { todos: string[]; hermetica: string[]; integracao: string[] };
  ordenarPorDuracao: (arquivos: string[], duracoes: Record<string, number>) => string[];
  lerDuracoesDoReporter: (arquivo: string) => Record<string, number>;
  REPORTER: string;
  globDoNpmTest: () => string[];
  concorrenciaDaLane: (lane: string, cpus?: number) => number;
};

test('TL1: a uniao das lanes e todo arquivo de teste compilado, sem arquivo nas duas', () => {
  const l = lanes.listasDasLanes();
  assert.deepEqual([...l.hermetica, ...l.integracao].sort(), l.todos);
  assert.equal(l.hermetica.filter((n) => l.integracao.includes(n)).length, 0);
  assert.deepEqual(l.integracao, [...TESTES_DE_INTEGRACAO_LOCAL].sort());
  assert.ok(l.hermetica.length >= 100);
});

test('TL2: a lane hermetica e o conjunto do test:ci (o glob menos as integracoes locais)', () => {
  const dir = path.join(CORE, 'dist-test', 'test');
  const doCi = fs.readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort().filter((n) => !TESTES_DE_INTEGRACAO_LOCAL.has(n));
  assert.deepEqual(lanes.listasDasLanes().hermetica, doCi);
});

test('TL3: a uniao das lanes e exatamente o glob que o npm test expande', () => {
  const l = lanes.listasDasLanes();
  assert.deepEqual([...l.hermetica, ...l.integracao].sort(), lanes.globDoNpmTest());
  const r = spawnSync(process.execPath, [SCRIPT, '--conferir'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^lanes conferidas: \d+ arquivos no glob do npm test = \d+ na hermetica \+ \d+ na integracao\n$/);
});

test('TL4: arquivo de integracao que nao existe mais reprova, em vez de sumir da lane', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-tl4-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.test.js'), '');
    assert.throws(() => lanes.listasDasLanes(dir, new Set(['sumiu.test.js'])), /lane de integracao obsoleta: sumiu\.test\.js/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TL5: a ordem e do mais longo para o mais curto, com o arquivo sem medida antes e empate em ordem alfabetica', () => {
  assert.deepEqual(lanes.ordenarPorDuracao(['a.test.js', 'b.test.js', 'c.test.js', 'novo.test.js', 'd.test.js'],
    { 'a.test.js': 10, 'b.test.js': 300, 'c.test.js': 10, 'd.test.js': 50 }),
  ['novo.test.js', 'b.test.js', 'd.test.js', 'a.test.js', 'c.test.js']);
});

test('TL6: o reporter de duracoes soma, por arquivo, os testes de nivel zero dele (o TAP nao diz o arquivo de quem passa)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-tl6-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.test.js'), "const { test } = require('node:test');\n" +
      "test('um', async () => { await new Promise((r) => setTimeout(r, 150)); });\ntest('dois', async () => { await new Promise((r) => setTimeout(r, 150)); });\n");
    fs.writeFileSync(path.join(dir, 'b.test.js'), "const { describe, it } = require('node:test');\ndescribe('s', () => { it('x', () => {}); });\n");
    const saida = path.join(dir, 'duracoes.json');
    // Sob `node --test` com varios arquivos, o pai marca este processo com NODE_TEST_CONTEXT, e o neto ignoraria o reporter.
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', `--test-reporter=${lanes.REPORTER}`, `--test-reporter-destination=${saida}`,
      path.join(dir, 'a.test.js'), path.join(dir, 'b.test.js')], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    const d = lanes.lerDuracoesDoReporter(saida);
    assert.deepEqual(Object.keys(d).sort(), ['a.test.js', 'b.test.js']);
    assert.ok(d['a.test.js'] >= 290, `a soma os dois testes de 150 ms: ${d['a.test.js']}`);
    assert.ok(d['b.test.js'] < 200);
    assert.deepEqual(lanes.lerDuracoesDoReporter(path.join(dir, 'nao-existe.json')), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TL7: a lane roda os arquivos pela duracao guardada, conta a lista e acusa quem passa do orcamento sem reprovar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-tl7-'));
  try {
    const testes = path.join(dir, 'testes');
    fs.mkdirSync(testes);
    fs.writeFileSync(path.join(testes, 'lento.test.js'),
      "const { test } = require('node:test'); test('lento', async () => { await new Promise((r) => setTimeout(r, 400)); });\n");
    fs.writeFileSync(path.join(testes, 'rapido.test.js'), "const { test } = require('node:test'); test('rapido', () => {});\n");
    fs.writeFileSync(path.join(testes, 'integra.test.js'), "const { test } = require('node:test'); test('integra', () => {});\n");
    const relatorio = path.join(dir, 'relatorio.jsonl');
    const env = { ...process.env, ORK_LANES_DIR: testes, ORK_LANES_INTEGRACAO: 'integra.test.js', ORK_CHECK_ORCAMENTO_MS: '200',
      ORK_CHECK_RELATORIO: relatorio, XDG_CACHE_HOME: path.join(dir, 'cache') };
    const r = spawnSync(process.execPath, [SCRIPT, 'hermetica'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /^# tests 2$/m, 'a hermetica roda so os dois que nao sao de integracao');
    const linhas = fs.readFileSync(relatorio, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.deepEqual(linhas.find((l) => l.tipo === 'lista'), { tipo: 'lista', lane: 'hermetica', arquivos: ['lento.test.js', 'rapido.test.js'] });
    const duracoes = linhas.find((l) => l.tipo === 'duracoes')!;
    assert.equal(duracoes.orcamentoMs, 200);
    assert.deepEqual((duracoes.acima as Array<{ arquivo: string }>).map((a) => a.arquivo), ['lento.test.js']);
    const guardadas = JSON.parse(fs.readFileSync(path.join(dir, 'cache', 'orkastery', 'check', 'duracoes-hermetica.json'), 'utf8')) as Record<string, number>;
    assert.ok(guardadas['lento.test.js'] > guardadas['rapido.test.js']);
    assert.ok(fs.existsSync(path.join(dir, 'cache', 'orkastery', 'check', 'compile-cache')), 'o cache de compilacao do Node');
    const integra = spawnSync(process.execPath, [SCRIPT, 'integracao'], { encoding: 'utf8', env });
    assert.equal(integra.status, 0, integra.stderr);
    assert.match(integra.stdout, /^# tests 1$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TL8: teste que falha numa lane faz a lane sair diferente de zero, com o TAP inteiro na saida', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-tl8-'));
  try {
    fs.writeFileSync(path.join(dir, 'cai.test.js'), "const { test } = require('node:test'); test('cai', () => { throw new Error('x'); });\n");
    const env: NodeJS.ProcessEnv = { ...process.env, ORK_LANES_DIR: dir, ORK_LANES_INTEGRACAO: '', XDG_CACHE_HOME: path.join(dir, 'cache') };
    delete env.ORK_CHECK_RELATORIO;
    const r = spawnSync(process.execPath, [SCRIPT, 'hermetica'], { encoding: 'utf8', env });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /^not ok 1 - cai$/m);
    assert.match(r.stdout, /location: '.*cai\.test\.js:1:\d+'/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TL9: a hermetica roda as CPUs menos duas (no minimo um arquivo), a integracao dois por vez, e nenhuma muda a prioridade', () => {
  assert.equal(lanes.concorrenciaDaLane('hermetica', 7), 5);
  assert.equal(lanes.concorrenciaDaLane('hermetica', 2), 1);
  assert.equal(lanes.concorrenciaDaLane('integracao', 7), 2);
  const texto = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(texto, /`--test-concurrency=\$\{concorrenciaDaLane\(lane\)\}`/, 'as duas lanes passam a concorrencia ao node --test');
  assert.doesNotMatch(texto, /setPriority/, 'o nice baixava so o processo do teste, nunca os containers dele');
});

test('TL10: o teste da lane nao herda o modo nem o relatorio da rodada, herda o resto (ORK_TESTE_EXIGE_AMBIENTE) e a lane grava a lista', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-tl10-'));
  try {
    const visto = path.join(dir, 'visto.json');
    fs.writeFileSync(path.join(dir, 've.test.js'), "const { test } = require('node:test'); test('ve', () => { require('fs').writeFileSync(" +
      `${JSON.stringify(visto)}, JSON.stringify({ modo: process.env.ORK_CHECK_MODO ?? null, relatorio: process.env.ORK_CHECK_RELATORIO ?? null, ` +
      `exige: process.env.ORK_TESTE_EXIGE_AMBIENTE ?? null })); });\n`);
    const relatorio = path.join(dir, 'relatorio.jsonl');
    const env = { ...process.env, ORK_LANES_DIR: dir, ORK_LANES_INTEGRACAO: '', XDG_CACHE_HOME: path.join(dir, 'cache'),
      ORK_CHECK_MODO: 'agile', ORK_CHECK_RELATORIO: relatorio, ORK_TESTE_EXIGE_AMBIENTE: '1' };
    const r = spawnSync(process.execPath, [SCRIPT, 'hermetica'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(visto, 'utf8')), { modo: null, relatorio: null, exige: '1' },
      'quem exporta ORK_TESTE_EXIGE_AMBIENTE exige as dependencias nos dois modos, como no npm test');
    assert.ok(fs.readFileSync(relatorio, 'utf8').split('\n').filter(Boolean).some((l) => (JSON.parse(l) as { tipo: string }).tipo === 'lista'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
