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
import { spawn, spawnSync } from 'node:child_process';
import { TESTES_DE_INTEGRACAO_LOCAL } from '../src/integracoes-locais';
import { assinaturaDoAmbiente as assinaturaDoVerify } from '../src/check-agil';

const CORE = path.resolve(__dirname, '../..');
const SCRIPT = path.join(CORE, 'scripts', 'test-lanes.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lanes = require(SCRIPT) as {
  listasDasLanes: (dir?: string, integracao?: ReadonlySet<string>) => { todos: string[]; hermetica: string[]; integracao: string[] };
  ordenarPorDuracao: (arquivos: string[], duracoes: Record<string, number>) => string[];
  lerDuracoesDoReporter: (arquivo: string) => Record<string, number>;
  lerResultadosDoReporter: (arquivo: string) => Array<{ arquivo: string; nome: string; nesting: number; estado: string }>;
  assinaturaDoAmbiente: (env: NodeJS.ProcessEnv) => string;
  REPORTER: string;
  globDoNpmTest: () => string[];
  concorrenciaDaLane: (lane: string, cpus?: number, limiteDoGrupo?: number) => number;
  planoDoPool: (lane: string, cpus?: number, env?: NodeJS.ProcessEnv) => { inicial: number; final: number; sinal: string } | null;
  ENV_CPUS_APOS_RESERVA: string;
  ENV_SINAL_DA_RESERVA: string;
  selecionarTemporario: (opcoes?: Record<string, unknown>) => { diretorio: string; estado: 'agile' | 'fallback'; motivo: string };
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
    const resultados = lanes.lerResultadosDoReporter(saida);
    assert.ok(resultados.some((t) => t.arquivo === 'a.test.js' && t.estado === 'pass'));
    assert.ok(resultados.some((t) => t.arquivo === 'b.test.js' && t.estado === 'pass'));
    assert.deepEqual(lanes.lerDuracoesDoReporter(path.join(dir, 'nao-existe.json')), {});
    assert.deepEqual(lanes.lerResultadosDoReporter(path.join(dir, 'nao-existe.json')), []);
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
    const resultados = linhas.find((l) => l.tipo === 'resultados')!;
    assert.equal(resultados.lane, 'hermetica');
    assert.match(String(resultados.head), /^[0-9a-f]{40}$/);
    assert.match(String(resultados.ambiente), /^[0-9a-f]{64}$/);
    assert.deepEqual((resultados.testes as Array<{ arquivo: string; estado: string }>).map((t) => [t.arquivo, t.estado]).sort(),
      [['lento.test.js', 'pass'], ['rapido.test.js', 'pass']]);
    const guardadas = JSON.parse(fs.readFileSync(path.join(dir, 'cache', 'orkastery', 'check', 'duracoes-hermetica.json'), 'utf8')) as Record<string, number>;
    assert.ok(guardadas['lento.test.js'] > guardadas['rapido.test.js']);
    assert.ok(fs.existsSync(path.join(dir, 'cache', 'orkastery', 'check', 'compile-cache')), 'o cache de compilacao do Node');
    const integra = spawnSync(process.execPath, [SCRIPT, 'integracao'], { encoding: 'utf8', env });
    assert.equal(integra.status, 0, integra.stderr);
    assert.match(integra.stdout, /^# tests 1$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TL11: a assinatura ignora transporte do runner, mas muda com ambiente funcional', () => {
  const base = { LANG: 'C.UTF-8', ORKASTERY_HOME: '/tmp/casa', FEATURE_X: '1' };
  assert.equal(lanes.assinaturaDoAmbiente(base), lanes.assinaturaDoAmbiente({ ...base,
    ORK_CHECK_RELATORIO: '/tmp/relatorio', ORK_CHECK_CPUS_DA_LANE: '5', npm_lifecycle_event: 'test:hermetica',
    NODE_COMPILE_CACHE: '/tmp/cache', PWD: '/outra' }));
  assert.equal(lanes.assinaturaDoAmbiente(base), assinaturaDoVerify(base), 'a lane e o verify assinam o mesmo contrato');
  assert.notEqual(lanes.assinaturaDoAmbiente(base), lanes.assinaturaDoAmbiente({ ...base, ORK_CHECK_MODO: 'agile' }),
    'o modo muda o comportamento de testes e nao pode sumir da assinatura');
  assert.notEqual(lanes.assinaturaDoAmbiente(base), lanes.assinaturaDoAmbiente({ ...base, FEATURE_X: '2' }));
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
  // O contrato base e conferido sem plano, mesmo quando o processo que executa este arquivo herdou o plano saturado.
  assert.equal(lanes.concorrenciaDaLane('hermetica', 7, Number.NaN), 5);
  assert.equal(lanes.concorrenciaDaLane('hermetica', 2, Number.NaN), 1);
  assert.equal(lanes.concorrenciaDaLane('integracao', 7, Number.NaN), 2);
  assert.equal(lanes.concorrenciaDaLane('hermetica', 8, 6), 6, 'o plano paralelo reserva duas CPUs');
  assert.equal(lanes.concorrenciaDaLane('hermetica', 8, 7), 7, 'o fallback usa CPUs menos uma');
  assert.equal(lanes.concorrenciaDaLane('integracao', 8, 7), 7, 'depois da hermetica, a integracao usa a fatia Classic');
  assert.deepEqual(lanes.planoDoPool('hermetica', 8, { ORK_CHECK_CPUS_DA_LANE: '6',
    [lanes.ENV_CPUS_APOS_RESERVA]: '8', [lanes.ENV_SINAL_DA_RESERVA]: '/tmp/sinal' }),
  { inicial: 6, final: 8, sinal: '/tmp/sinal' }, 'a hermetica devolve a reserva ate a CPU da maquina');
  assert.equal(lanes.planoDoPool('integracao', 8, { ORK_CHECK_CPUS_DA_LANE: '2',
    [lanes.ENV_CPUS_APOS_RESERVA]: '8', [lanes.ENV_SINAL_DA_RESERVA]: '/tmp/sinal' }), null, 'a integracao nunca abre o pool');
  const texto = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(texto, /function rodarPoolDeArquivos/, 'a hermetica tem o pool dinamico por arquivo');
  assert.match(texto, /`--test-concurrency=\$\{concorrenciaDaLane\(lane\)\}`/, 'sem sinal, as lanes preservam o runner atual');
  assert.doesNotMatch(texto, /setPriority/, 'o nice baixava so o processo do teste, nunca os containers dele');
});

test('TL10: o teste da lane nao herda modo, relatorio nem plano de CPU da rodada, mas herda o ambiente exigido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-tl10-'));
  try {
    const visto = path.join(dir, 'visto.json');
    fs.writeFileSync(path.join(dir, 've.test.js'), "const { test } = require('node:test'); test('ve', () => { require('fs').writeFileSync(" +
      `${JSON.stringify(visto)}, JSON.stringify({ modo: process.env.ORK_CHECK_MODO ?? null, relatorio: process.env.ORK_CHECK_RELATORIO ?? null, ` +
      `cpusDaLane: process.env.ORK_CHECK_CPUS_DA_LANE ?? null, cpusApos: process.env.ORK_CHECK_CPUS_DA_LANE_APOS_RESERVA ?? null, ` +
      `sinal: process.env.ORK_CHECK_RESERVA_DEVOLVIDA ?? null, cpusDocker: process.env.ORK_CHECK_CPUS_DOCKER ?? null, ` +
      `exige: process.env.ORK_TESTE_EXIGE_AMBIENTE ?? null })); });\n`);
    const relatorio = path.join(dir, 'relatorio.jsonl');
    const env = { ...process.env, ORK_LANES_DIR: dir, ORK_LANES_INTEGRACAO: '', XDG_CACHE_HOME: path.join(dir, 'cache'),
      ORK_CHECK_MODO: 'agile', ORK_CHECK_RELATORIO: relatorio, ORK_CHECK_CPUS_DA_LANE: '7',
      ORK_CHECK_CPUS_DA_LANE_APOS_RESERVA: '8', ORK_CHECK_RESERVA_DEVOLVIDA: path.join(dir, 'sinal'), ORK_CHECK_CPUS_DOCKER: '1',
      ORK_TESTE_EXIGE_AMBIENTE: '1' };
    const r = spawnSync(process.execPath, [SCRIPT, 'hermetica'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(visto, 'utf8')),
      { modo: null, relatorio: null, cpusDaLane: null, cpusApos: null, sinal: null, cpusDocker: null, exige: '1' },
      'quem exporta ORK_TESTE_EXIGE_AMBIENTE exige as dependencias nos dois modos, como no npm test');
    assert.ok(fs.readFileSync(relatorio, 'utf8').split('\n').filter(Boolean).some((l) => (JSON.parse(l) as { tipo: string }).tipo === 'lista'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TL12: tmpfs e opt-in, exige memoria e espaco com folga e cai para disco com o motivo', () => {
  const base = { disco: '/disco', candidatos: ['/memoria'], memoriaTotal: 1000, memoriaLivre: 500,
    sondar: () => ({ ok: true, livres: 500 }) };
  assert.deepEqual(lanes.selecionarTemporario(base),
    { diretorio: '/disco', estado: 'fallback', motivo: 'desligado-por-padrao' });
  assert.deepEqual(lanes.selecionarTemporario({ ...base, chave: 'off' }),
    { diretorio: '/disco', estado: 'fallback', motivo: 'chave-off' });
  assert.deepEqual(lanes.selecionarTemporario({ ...base, chave: 'auto' }),
    { diretorio: '/memoria', estado: 'agile', motivo: 'tmpfs-gravavel-com-folga' });
  assert.deepEqual(lanes.selecionarTemporario({ ...base, chave: 'auto', memoriaLivre: 200 }),
    { diretorio: '/disco', estado: 'fallback', motivo: 'memoria-livre-sem-folga' });
  assert.deepEqual(lanes.selecionarTemporario({ ...base, chave: 'auto', sondar: () => ({ ok: false, motivo: 'nao-tmpfs' }) }),
    { diretorio: '/disco', estado: 'fallback', motivo: '/memoria:nao-tmpfs' });
});

test('TL13: o pool LPT abre as vagas devolvidas, preserva TAP, reporter e resultados, e registra a peca', { timeout: 30_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-tl13-'));
  let filho: ReturnType<typeof spawn> | null = null;
  try {
    const testes = path.join(dir, 'testes'), marcas = path.join(dir, 'marcas');
    fs.mkdirSync(testes); fs.mkdirSync(marcas);
    const liberar = path.join(marcas, 'liberar');
    for (const nome of ['a', 'b', 'c', 'd']) {
      fs.writeFileSync(path.join(testes, `${nome}.test.js`),
        `const { test } = require('node:test'); const fs = require('node:fs'); const path = require('node:path');\n` +
        `test('${nome}', async () => { fs.writeFileSync(path.join(process.env.MARCAS, '${nome}.inicio'), ''); ` +
        `while (!fs.existsSync(${JSON.stringify(liberar)})) await new Promise((r) => setTimeout(r, 20)); ` +
        `fs.writeFileSync(path.join(process.env.MARCAS, '${nome}.fim'), ''); });\n`);
    }
    const sinal = path.join(dir, 'reserva.json'), relatorio = path.join(dir, 'relatorio.jsonl');
    const env = { ...process.env, ORK_LANES_DIR: testes, ORK_LANES_INTEGRACAO: '', ORK_CHECK_RELATORIO: relatorio,
      ORK_CHECK_CPUS_DA_LANE: '1', ORK_CHECK_CPUS_DA_LANE_APOS_RESERVA: '3', ORK_CHECK_RESERVA_DEVOLVIDA: sinal,
      XDG_CACHE_HOME: path.join(dir, 'cache'), MARCAS: marcas };
    let stdout = '', stderr = '';
    filho = spawn(process.execPath, [SCRIPT, 'hermetica'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    filho.stdout!.on('data', (d) => { stdout += d; });
    filho.stderr!.on('data', (d) => { stderr += d; });
    const esperar = async (condicao: () => boolean, mensagem: string): Promise<void> => {
      const ate = Date.now() + 10_000;
      while (!condicao() && Date.now() < ate) await new Promise((r) => setTimeout(r, 25));
      assert.ok(condicao(), mensagem);
    };
    const quantos = (sufixo: string) => fs.readdirSync(marcas).filter((n) => n.endsWith(sufixo)).length;
    await esperar(() => quantos('.inicio') === 1, 'a vaga inicial comecou');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(quantos('.inicio'), 1, 'antes do sinal so a cota inicial roda');
    fs.writeFileSync(sinal, JSON.stringify({ em: '2026-10-31T00:00:00.000Z', vagas: 3 }));
    await esperar(() => quantos('.inicio') === 3, 'o sinal abriu as duas vagas devolvidas');
    assert.equal(quantos('.fim'), 0, 'as tres vagas estiveram ocupadas ao mesmo tempo');
    fs.writeFileSync(liberar, '');
    const code = await new Promise<number | null>((resolve) => filho!.once('close', resolve));
    filho = null;
    assert.equal(code, 0, stderr + stdout);
    assert.match(stdout, /^TAP version 13$/m);
    assert.match(stdout, /^1\.\.4$/m);
    assert.match(stdout, /^# tests 4$/m);
    const linhas = fs.readFileSync(relatorio, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.ok(linhas.some((l) => l.peca === 'agendador-cpu' && /passou a 3 vagas/.test(String(l.motivo))), 'a devolucao foi registrada');
    const resultados = linhas.find((l) => l.tipo === 'resultados')!;
    assert.deepEqual((resultados.testes as Array<{ arquivo: string; estado: string }>).map((t) => [t.arquivo, t.estado]).sort(),
      ['a', 'b', 'c', 'd'].map((n) => [`${n}.test.js`, 'pass']));
  } finally {
    filho?.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
