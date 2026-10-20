/**
 * RM-037, defeitos de condução de 19 e 20/10/2026, defeito 1: a baseline com o prazo do verify.
 *
 * Em 20/10/2026 as baselines desta fábrica gravaram `test` com `code: -1`, `causa: timeout` e `prazoMs: 600000`, com o
 * manifesto dando 2400 s ao `test`, e o verify seguinte classificou a falha de `test` como pré-existente: uma regressão
 * real passaria como dívida anterior. Aqui: a baseline aplica o prazo do manifesto por comando, o mesmo do verify, e o
 * comando sem veredito na baseline (estouro, relógio sob steal, comando que não rodou) nunca vale como "já falhava".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportarHandoff } from '../src/handoff';
import { lerLedger } from '../src/ledger';
import { comLocale } from '../src/locale';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { ResultadoDeComando } from '../src/types';
import { ExecutorVerify, gravarBaseline, linhasDaBaseline, textoDoVerify, verificar, vereditoDaBaseline } from '../src/verify';
import { ajustarManifesto, dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

/** O resultado que um executor injetado devolve, sem rodar nada. */
function resultado(nome: string, comando: string, extra: Partial<ResultadoDeComando> = {}): ResultadoDeComando {
  return { nome, comando, ok: true, code: 0, resumo: '', causa: 'exit', executado: true, ...extra };
}

/** A suíte que passou do prazo na VPS, sem esperar 40 minutos: o `test` estoura, o resto passa. */
const estouraNoTest: ExecutorVerify = (nome, comando) => nome === 'test'
  ? resultado(nome, comando, { ok: false, code: -1, causa: 'timeout', prazoMs: 2400000, duracaoMs: 2400117 })
  : resultado(nome, comando);

test('defeito 1 (19 e 20/10/2026): a baseline aplica o prazo do manifesto por comando, o mesmo do verify', () => {
  const p = projetoTemporario('rm037d2010-prazo');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'prazo da baseline', modo: 'auto' });
    p.carregado.manifesto.verify = { build: 'true', test: 'sleep 3', timeout_ms: 7000, timeout_ms_por_comando: { test: 1000 } };
    const b = gravarBaseline(p.carregado, thread.id);
    const t = b.comandos.find((c) => c.nome === 'test')!;
    const build = b.comandos.find((c) => c.nome === 'build')!;
    assert.equal(t.prazoMs, 1000, 'o test usa verify.timeout_ms_por_comando, e nao o teto padrao de 600 s');
    assert.equal(t.causa, 'timeout');
    assert.equal(t.ok, false);
    assert.equal(build.prazoMs, 7000, 'o build usa verify.timeout_ms');
    assert.equal(build.ok, true);
    assert.equal(vereditoDaBaseline(t), 'sem-veredito');
    const evento = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'baseline_recorded')!;
    assert.deepEqual(evento.semVeredito, ['test']);
    const noLedger = (evento.comandos as Array<Record<string, unknown>>).find((c) => c.nome === 'test')!;
    assert.equal(noLedger.causa, 'timeout');
    assert.equal(noLedger.prazoMs, 1000);
  } finally { p.limpar(); }
});

test('defeito 1: o comando que estourou na baseline nunca vale como "ja falhava"; a falha atual sai como falha sem baseline', () => {
  const p = projetoTemporario('rm037d2010-estouro');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'estouro na baseline', modo: 'auto' });
    p.carregado.manifesto.verify = { build: 'true', test: 'false' };
    gravarBaseline(p.carregado, thread.id, estouraNoTest);
    const r = verificar(p.carregado, thread.id);
    assert.deepEqual(r.preExistentes.map((c) => c.nome), [], 'a falha de test nao passa por divida anterior');
    assert.deepEqual(r.falhasSemBaseline.map((c) => c.nome), ['test']);
    assert.ok(r.motivos.includes('verify.failed'));
    assert.equal(r.ok, false);
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter((e) => e.tipo === 'verify_run').at(-1)!.baselineSemVeredito, ['test']);
    const gate = eventos.find((e) => e.tipo === 'gate_blocked' && e.motivo === 'verify.failed')!;
    assert.match(String(gate.detalhe), /falha sem baseline em: test; a baseline nao teve veredito de test/);
    assert.match(comLocale('pt-BR', () => textoDoVerify(r)), /sem baseline\s+test: false \(a baseline nao teve veredito dele\)/);
  } finally { p.limpar(); }
});

test('defeito 1: baseline antiga com -1 sem causa, comando que nao rodou e relogio sob steal ficam sem veredito; falha comum segue pre-existente', () => {
  assert.equal(vereditoDaBaseline(resultado('test', 'x', { ok: false, code: -1, causa: undefined })), 'sem-veredito');
  assert.equal(vereditoDaBaseline(resultado('test', 'x', { ok: false, code: 1, executado: false })), 'sem-veredito');
  assert.equal(vereditoDaBaseline(resultado('test', 'x', { ok: false, code: 1, relogioSobSteal: ['espera o relogio'] })), 'sem-veredito');
  assert.equal(vereditoDaBaseline(resultado('test', 'x', { ok: false, code: 1 })), 'ja-falhava');
  assert.equal(vereditoDaBaseline(resultado('test', 'x')), 'passava');
  const p = projetoTemporario('rm037d2010-antiga');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'baseline antiga', modo: 'auto' });
    p.carregado.manifesto.verify = { build: 'false', test: 'false' };
    // Baseline de antes da I-37, sem `causa`: o estouro saia como `code: -1`.
    const t = lerThread(p.dir, thread.id);
    t.baseline = { commit: 'a'.repeat(40), gravadaEm: '2026-09-20T00:00:00.000Z', comandos: [
      { nome: 'build', comando: 'false', ok: false, code: 1, resumo: '' },
      { nome: 'test', comando: 'false', ok: false, code: -1, resumo: '' },
    ] };
    gravarThread(p.dir, t);
    const r = verificar(p.carregado, thread.id);
    assert.deepEqual(r.preExistentes.map((c) => c.nome), ['build'], 'a falha com veredito continua divida anterior');
    assert.deepEqual(r.falhasSemBaseline.map((c) => c.nome), ['test']);
  } finally { p.limpar(); }
});

test('defeito 1: ork verify --baseline diz sem veredito, o motivo e como regravar; o handoff tambem', () => {
  const p = projetoTemporario('rm037d2010-cli');
  const casa = dirTemporario('rm037d2010-cli-casa');
  try {
    ajustarManifesto(p, '  # test: nao detectado', '  test: "sleep 3"\n  timeout_ms_por_comando:\n    test: 1000');
    const { thread } = novaThread(p.carregado, { nome: 'baseline pelo cli', modo: 'auto' });
    const r = spawnSync(process.execPath, [CLI, 'verify', thread.id, '--baseline'], { cwd: p.dir, encoding: 'utf8', timeout: 120000,
      env: { HOME: casa, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /test\s+SEM VEREDITO, ESTOUROU O PRAZO \(1 s, rodou \d+ s\): nao vale como "ja falhava"\s+sleep 3/);
    assert.ok(r.stdout.includes(`sem veredito na baseline: test; no verify, a falha deles sai como falha sem baseline (verify.failed), ` +
      `nunca como pre-existente. Grave de novo com ork verify ${thread.id} --baseline`), r.stdout);
    assert.doesNotMatch(r.stdout, /ja falhava \(codigo -1\)/);
    const { handoff } = exportarHandoff(p.carregado, thread.id);
    const item = handoff.inline.find((i) => i.titulo === 'Baseline gravada antes do GO');
    assert.ok(item, 'o handoff traz a baseline');
    assert.match(item!.conteudo, /test: sem veredito \(estouro, relogio sob steal ou nao rodou: nao vale como ja falhava\)/);
  } finally { p.limpar(); fs.rmSync(casa, { recursive: true, force: true }); }
});

test('defeito 1: as linhas da baseline nas duas linguas; passava e ja falhava saem como antes', () => {
  const b = { commit: 'b'.repeat(40), gravadaEm: '2026-10-20T03:14:58.585Z', comandos: [
    resultado('build', 'npm --prefix core run build'),
    resultado('lint', 'npm run lint', { ok: false, code: 1 }),
    resultado('test', 'npm --prefix core test', { ok: false, code: -1, causa: 'timeout', prazoMs: 600000, duracaoMs: 600208 }),
  ] };
  const pt = comLocale('pt-BR', () => linhasDaBaseline(b, 'ork-exemplo'));
  assert.equal(pt[0], '  build      passava  npm --prefix core run build');
  assert.equal(pt[1], '  lint       ja falhava (codigo 1)  npm run lint');
  assert.equal(pt[2], '  test       SEM VEREDITO, ESTOUROU O PRAZO (600 s, rodou 600 s): nao vale como "ja falhava"  npm --prefix core test');
  assert.match(pt[3], /^ {2}sem veredito na baseline: test; /);
  assert.equal(pt.length, 4);
  const en = comLocale('en', () => linhasDaBaseline(b, 'ork-exemplo'));
  assert.equal(en[0], '  build      passed  npm --prefix core run build');
  assert.equal(en[1], '  lint       already failing (exit 1)  npm run lint');
  assert.equal(en[2], '  test       NO VERDICT, TIMED OUT (600 s, ran 600 s): does not count as "already failing"  npm --prefix core test');
  assert.match(en[3], /^ {2}no verdict in the baseline: test; .*`ork verify ork-exemplo --baseline`/);
});
