/**
 * RM-072 (D2 do dono, T1 da ork-check5x): o modo do CHECK. `check.mode` no manifesto (agile ou classic, com o padrao
 * agile), a opcao `--check` do `ork verify` que vence o manifesto, a origem do modo no `verify_run` e no
 * `baseline_recorded`, a medicao (`duracaoMs`) de todo comando, claim e rodada nos dois modos, o modo no ambiente dos
 * comandos, a linha `check` do texto do verify e o ultimo modo no status da thread. Os nomes comecam por "CMn:".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { adicionarClaim } from '../src/claims';
import { lerModo, MODO_PADRAO, NOME_DO_MODO, resolverModo } from '../src/check-modo';
import { lerLedger } from '../src/ledger';
import { carregarManifesto } from '../src/manifest';
import { dirThread, lerThread, novaThread, resumoDaThread } from '../src/thread';
import { gravarBaseline, linhasDaBaseline, textoDoVerify, verificar } from '../src/verify';
import { comLocale } from '../src/locale';
import { ajustarManifesto, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

function comCheck(p: ReturnType<typeof projetoTemporario>, bloco: string): void {
  fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), `\ncheck:\n${bloco}\n`);
}

function arquivoDeEnv(nome: string): { arquivo: string; limpar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ork-${nome}-`));
  return { arquivo: path.join(dir, 'env.txt'), limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('CM1: check.mode aceita agile e classic, sem diferenca de caixa', () => {
  for (const [escrito, esperado] of [['agile', 'agile'], ['classic', 'classic'], [' Classic ', 'classic']] as const) {
    const p = projetoTemporario(`cm1-${esperado}`);
    try {
      comCheck(p, `  mode: "${escrito}"`);
      const m = carregarManifesto(p.dir)!;
      assert.deepEqual(m.erros, []);
      assert.equal(m.manifesto.check?.mode, esperado);
    } finally { p.limpar(); }
  }
});

test('CM2: outro valor torna o manifesto invalido, com os dois valores aceitos na mensagem', () => {
  const p = projetoTemporario('cm2');
  try {
    comCheck(p, '  mode: rapido');
    const m = carregarManifesto(p.dir)!;
    assert.equal(m.erros.length, 1, m.erros.join('; '));
    assert.equal(m.erros[0], 'check.mode invalido: "rapido" (aceitos: agile, classic)');
    assert.equal(m.manifesto.check?.mode, undefined);
  } finally { p.limpar(); }
});

test('CM3: sem check.mode, o padrao e o Agile Check, com origem padrao; a opcao vence o manifesto', () => {
  assert.equal(MODO_PADRAO, 'agile');
  assert.deepEqual(resolverModo(undefined), { modo: 'agile', origem: 'padrao', nome: 'Agile Check' });
  assert.deepEqual(resolverModo('classic'), { modo: 'classic', origem: 'manifesto', nome: 'Classic Check' });
  assert.deepEqual(resolverModo('classic', 'agile'), { modo: 'agile', origem: 'opcao', nome: 'Agile Check' });
  assert.equal(lerModo('AGILE'), 'agile');
  assert.equal(lerModo('agil'), null);
  assert.deepEqual(NOME_DO_MODO, { agile: 'Agile Check', classic: 'Classic Check' });
  const p = projetoTemporario('cm3');
  try {
    assert.equal(p.carregado.manifesto.check, undefined, 'o ork init nao escreve o bloco check');
  } finally { p.limpar(); }
});

test('CM4: o verify_run grava o modo, a origem e o nome; a opcao do verify vence o manifesto', () => {
  const p = projetoTemporario('cm4');
  try {
    comCheck(p, '  mode: classic');
    p.carregado = carregarManifesto(p.dir)!;
    const { thread: t } = novaThread(p.carregado, { nome: 'modo', modo: 'auto' });
    const peloManifesto = verificar(p.carregado, t.id, { soClaims: true });
    const pelaOpcao = verificar(p.carregado, t.id, { soClaims: true, check: 'agile' });
    assert.deepEqual(peloManifesto.check, { modo: 'classic', origem: 'manifesto', nome: 'Classic Check' });
    assert.deepEqual(pelaOpcao.check, { modo: 'agile', origem: 'opcao', nome: 'Agile Check' });
    const eventos = lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'verify_run');
    assert.deepEqual(eventos.map((e) => e.check), [
      { modo: 'classic', origem: 'manifesto', nome: 'Classic Check' },
      { modo: 'agile', origem: 'opcao', nome: 'Agile Check' }]);
  } finally { p.limpar(); }
});

test('CM5: duracaoMs em todo comando (o que passa tambem), em cada claim e na rodada, nos dois modos', () => {
  const p = projetoTemporario('cm5');
  try {
    ajustarManifesto(p, '  # build: nao detectado', '  build: "true"');
    ajustarManifesto(p, '  # test: nao detectado', '  test: "sleep 0.2"');
    const { thread: t } = novaThread(p.carregado, { nome: 'medicao', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'passa', verificar: ['sleep 0.1'] });
    for (const modo of ['classic', 'agile'] as const) {
      const r = verificar(p.carregado, t.id, { check: modo });
      assert.equal(r.ok, true, r.motivos.join(','));
      assert.ok(r.duracaoMs >= 300, `a rodada inteira mede pelo menos claim e test (${r.duracaoMs})`);
    }
    for (const e of lerLedger(dirThread(p.dir, t.id)).filter((x) => x.tipo === 'verify_run')) {
      const comandos = e.comandos as Array<Record<string, unknown>>;
      assert.deepEqual(comandos.map((c) => c.nome), ['build', 'test']);
      for (const c of comandos) assert.equal(typeof c.duracaoMs, 'number', `duracaoMs do ${String(c.nome)} que passou`);
      assert.ok((comandos[1].duracaoMs as number) >= 200);
      const claims = e.claims as Array<Record<string, unknown>>;
      assert.ok((claims[0].duracaoMs as number) >= 100, 'a claim mede a soma dos comandos dela');
      assert.equal(typeof e.duracaoMs, 'number');
      assert.ok((e.duracaoMs as number) >= (comandos[1].duracaoMs as number));
    }
  } finally { p.limpar(); }
});

test('CM6: os comandos da rodada recebem o modo no ambiente (ORK_CHECK_MODO), nos dois modos', () => {
  const p = projetoTemporario('cm6');
  const env = arquivoDeEnv('cm6');
  try {
    ajustarManifesto(p, '  # build: nao detectado', `  build: 'echo "$ORK_CHECK_MODO" >> ${env.arquivo}'`);
    const { thread: t } = novaThread(p.carregado, { nome: 'ambiente', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'le o modo', verificar: [`echo "$ORK_CHECK_MODO" >> ${env.arquivo}`] });
    verificar(p.carregado, t.id, { check: 'classic' });
    verificar(p.carregado, t.id, {});
    assert.deepEqual(fs.readFileSync(env.arquivo, 'utf8').split('\n').filter(Boolean), ['classic', 'classic', 'agile', 'agile']);
  } finally { env.limpar(); p.limpar(); }
});

test('CM7: a baseline grava o modo, a origem e a duracao de cada comando', () => {
  const p = projetoTemporario('cm7');
  try {
    ajustarManifesto(p, '  # build: nao detectado', '  build: "true"');
    const { thread: t } = novaThread(p.carregado, { nome: 'baseline', modo: 'auto' });
    const b = gravarBaseline(p.carregado, t.id, undefined, {}, 'cli', undefined, 'classic');
    assert.deepEqual(b.check, { modo: 'classic', origem: 'opcao' });
    const e = lerLedger(dirThread(p.dir, t.id)).filter((x) => x.tipo === 'baseline_recorded').at(-1)!;
    assert.deepEqual(e.check, { modo: 'classic', origem: 'opcao', nome: 'Classic Check' });
    assert.equal(typeof (e.comandos as Array<Record<string, unknown>>)[0].duracaoMs, 'number');
    const padrao = gravarBaseline(p.carregado, t.id);
    assert.deepEqual(padrao.check, { modo: 'agile', origem: 'padrao' });
    assert.match(linhasDaBaseline(padrao, t.id).join('\n'), /check {6}Agile Check \(padrao: o manifesto nao declara check\.mode\)/);
  } finally { p.limpar(); }
});

test('CM8: o texto do verify diz o modo e a origem, nas duas linguas', () => {
  const p = projetoTemporario('cm8');
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'texto', modo: 'auto' });
    const agile = verificar(p.carregado, t.id, { soClaims: true });
    const classic = verificar(p.carregado, t.id, { soClaims: true, check: 'classic' });
    assert.match(textoDoVerify(agile), /\n {2}check {7}Agile Check \(padrao: o manifesto nao declara check\.mode\)\n/);
    assert.match(textoDoVerify(classic), /\n {2}check {7}Classic Check \(opcao --check classic\)\n/);
    const ingles = comLocale('en', () => textoDoVerify(classic));
    assert.match(ingles, /\n {2}check {7}Classic Check \(option --check classic\)\n/);
  } finally { p.limpar(); }
});

test('CM9: ork verify --check com valor fora da lista sai com 2 e os dois valores; com valor valido, vence o manifesto', () => {
  const p = projetoTemporario('cm9');
  try {
    comCheck(p, '  mode: agile');
    p.carregado = carregarManifesto(p.dir)!;
    const { thread: t } = novaThread(p.carregado, { nome: 'cli', modo: 'auto' });
    const env = { ...process.env, ORKASTERY_HOME: path.join(p.dir, '.casa'), ORK_LOCALE: 'pt-BR' };
    const ruim = spawnSync(process.execPath, [CLI, 'verify', t.id, '--check', 'rapido'], { cwd: p.dir, encoding: 'utf8', env });
    assert.equal(ruim.status, 2, ruim.stderr);
    assert.match(ruim.stderr, /--check invalido: "rapido" \(aceitos: classic, agile\)/);
    const sem = spawnSync(process.execPath, [CLI, 'verify', t.id, '--check'], { cwd: p.dir, encoding: 'utf8', env });
    assert.equal(sem.status, 2, sem.stderr);
    assert.match(sem.stderr, /--check invalido: \(sem valor\) \(aceitos: classic, agile\)/);
    const bom = spawnSync(process.execPath, [CLI, 'verify', t.id, '--check', 'classic', '--so-claims'], { cwd: p.dir, encoding: 'utf8', env });
    assert.equal(bom.status, 0, bom.stderr + bom.stdout);
    assert.match(bom.stdout, /check {7}Classic Check \(opcao --check classic\)/);
    const e = lerLedger(dirThread(p.dir, t.id)).filter((x) => x.tipo === 'verify_run').at(-1)!;
    assert.deepEqual(e.check, { modo: 'classic', origem: 'opcao', nome: 'Classic Check' });
  } finally { p.limpar(); }
});

test('CM10: o uso do ork verify ensina a opcao --check', () => {
  const p = projetoTemporario('cm10');
  try {
    const env = { ...process.env, ORKASTERY_HOME: path.join(p.dir, '.casa'), ORK_LOCALE: 'pt-BR' };
    const r = spawnSync(process.execPath, [CLI, 'verify'], { cwd: p.dir, encoding: 'utf8', env });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /uso: ork verify <thread-id> \[--baseline\] \[--so-claims\] \[--check classic\|agile\]/);
  } finally { p.limpar(); }
});

test('CM11: o status da thread mostra o ultimo modo do CHECK, e so quando houve verify', () => {
  const p = projetoTemporario('cm11');
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'status', modo: 'auto' });
    assert.doesNotMatch(resumoDaThread(lerThread(p.dir, t.id)), /\n {2}check /, 'sem verify, sem linha');
    const r = verificar(p.carregado, t.id, { soClaims: true, check: 'classic' });
    const depois = lerThread(p.dir, t.id);
    assert.deepEqual({ modo: depois.check?.modo, origem: depois.check?.origem, commit: depois.check?.commit },
      { modo: 'classic', origem: 'opcao', commit: r.commit });
    assert.match(resumoDaThread(depois), /\n {2}check {5}Classic Check, pela opcao --check, no verify de .+ \([0-9a-f]{8}\)/);
  } finally { p.limpar(); }
});

test('CM12: check que nao e mapa e chave desconhecida em check: erro e aviso, sem mudar o padrao', () => {
  const p = projetoTemporario('cm12');
  try {
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\ncheck: agile\n');
    const m = carregarManifesto(p.dir)!;
    assert.equal(m.erros.length, 1, m.erros.join('; '));
    assert.match(m.erros[0], /^check precisa ser um mapa/);
  } finally { p.limpar(); }
  const q = projetoTemporario('cm12-aviso');
  try {
    comCheck(q, '  modo: agile');
    const m = carregarManifesto(q.dir)!;
    assert.deepEqual(m.erros, []);
    assert.ok(m.avisos.some((a) => /^check\.modo desconhecida/.test(a)), m.avisos.join('; '));
    assert.equal(m.manifesto.check?.mode, undefined);
  } finally { q.limpar(); }
});
