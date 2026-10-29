/**
 * RM-072 (D9, D10, T5 da ork-check5x): a varredura do Agile Check. Com o falso Docker dos testes: os mesmos achados do
 * Classic por impressao digital; as ferramentas ao mesmo tempo; o cache persistente do Trivy montado so no Agile; o
 * relatorio da base reaproveitado na segunda rodada; o modo pela ordem `--check`, `ORK_CHECK_MODO`, manifesto, padrao;
 * as pecas no relatorio e no `ORK_CHECK_RELATORIO`. Os nomes comecam por "SAn:".
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { dirTemporario } from './apoio';
import { installFakeTools, type FakeTools } from './security-scan-docker-falso';
import { estourouNoAgile, motivoSemCredencial, resultadoDoTrabalhador, runScanAgil } from '../src/security-scan/agil';
import { runScan } from '../src/security-scan/run';
import { loadTools } from '../src/security-scan/tools';
import { comCacheNoHost } from '../src/security-scan/trabalhador';
import type { ScanReport } from '../src/security-scan/types';

const FIXTURE_JS = path.resolve(__dirname, '..', '..', '..', 'eval', 'fixtures', 'security-scan', 'js');
const CLI = path.resolve(__dirname, '..', '..', 'dist', 'index.js');

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

interface Repo { dir: string; base: string; head: string; limpar: () => void }

/** A main limpa e a feat com a fixture vulneravel (e o `.fake-case` que faz o falso Docker responder com as gravacoes). */
function repositorio(nome: string): Repo {
  const dir = dirTemporario(nome);
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "clean-js", "version": "1.0.0", "private": true, "license": "MIT" }\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{ "name": "clean-js", "version": "1.0.0", "lockfileVersion": 3, ' +
    '"requires": true, "packages": { "": { "name": "clean-js", "version": "1.0.0" } } }\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'feat');
  fs.cpSync(FIXTURE_JS, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.fake-case'), 'js\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'head');
  return { dir, base, head: git(dir, 'rev-parse', 'HEAD'), limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Os achados como conjunto comparavel: impressao digital, estado e ferramenta, em ordem. */
const achados = (r: ScanReport): string[] => r.findings.map(f => `${f.tool}|${f.fingerprint}|${f.status}`).sort();
const estados = (r: ScanReport): string[] => r.tools.map(t => `${t.name}:${t.state}:${t.reason ?? ''}`);

let cache: string;
let fake: FakeTools | undefined;
const salvos: Record<string, string | undefined> = {};
const CHAVES = ['XDG_CACHE_HOME', 'ORK_FAKE_DOCKER_SLEEP_MS', 'ORK_FAKE_DOCKER_FAIL', 'ORK_CHECK_RELATORIO', 'ORK_CHECK_MODO',
  'ORK_CHECK_VARREDURA_PARALELA', 'ORK_CHECK_CPUS_DA_LANE', 'ORK_CHECK_CPUS_DOCKER', 'ORK_FAKE_DOCKER_FAIL_COM_CACHE'];
const limpezas: Array<() => void> = [];

beforeEach(() => {
  for (const k of CHAVES) { salvos[k] = process.env[k]; delete process.env[k]; }
  cache = dirTemporario('scan-agil-cache');
  process.env.XDG_CACHE_HOME = cache;
  fake = installFakeTools(['docker']);
});
afterEach(() => {
  fake?.restore();
  for (const k of CHAVES) { if (salvos[k] === undefined) delete process.env[k]; else process.env[k] = salvos[k]; }
  fs.rmSync(cache, { recursive: true, force: true });
  while (limpezas.length) limpezas.pop()!();
});

function repo(nome: string): Repo { const r = repositorio(nome); limpezas.push(r.limpar); return r; }

function picoDeExecucoes(eventos: ReturnType<FakeTools['intervals']>): number {
  const ativas = new Set<string>();
  let pico = 0;
  for (const evento of eventos) {
    if (evento.event === 'inicio') {
      assert.equal(ativas.has(evento.execution), false, `execução ${evento.execution} iniciou duas vezes`);
      ativas.add(evento.execution);
      pico = Math.max(pico, ativas.size);
    } else {
      assert.equal(ativas.delete(evento.execution), true, `execução ${evento.execution} terminou sem início`);
    }
  }
  assert.equal(ativas.size, 0, 'toda execução terminou');
  return pico;
}

test('SA1: o Agile da os mesmos achados e os mesmos estados do Classic, por impressao digital, na ordem do catalogo', () => {
  const r = repo('sa1');
  const classic = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.ok(classic.findings.length > 0, 'a fixture tem achado');
  assert.deepEqual(achados(agile), achados(classic));
  assert.deepEqual(estados(agile), estados(classic));
  assert.deepEqual(agile.tools.map(t => t.counts), classic.tools.map(t => t.counts));
  assert.equal(classic.check, undefined, 'o relatorio do Classic segue sem o bloco check');
  assert.equal(agile.check?.modo, 'agile');
});

test('SA2: as ferramentas rodam ao mesmo tempo no Agile e uma por vez no Classic', () => {
  const r = repo('sa2');
  process.env.ORK_FAKE_DOCKER_SLEEP_MS = '400';
  let marco = fake!.intervals().length;
  runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const classic = fake!.intervals().slice(marco);
  fs.rmSync(path.join(cache, 'orkastery'), { recursive: true, force: true });
  marco = fake!.intervals().length;
  runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const agile = fake!.intervals().slice(marco);
  assert.equal(picoDeExecucoes(classic), 1, 'Classic nunca tem mais de uma ferramenta em execução');
  assert.ok(picoDeExecucoes(agile) > 1, 'Agile tem mais de uma ferramenta em execução');
});

test('SA3: o cache persistente do Trivy so e montado no Agile, um por ferramenta, no /tmp/trivy-cache do catalogo', () => {
  const r = repo('sa3');
  runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const doClassic = fake!.calls().filter(c => c.args[0] === 'run');
  assert.ok(doClassic.every(c => !c.args.some(a => a.endsWith(':/tmp/trivy-cache'))), 'Classic sem montagem de cache');
  const n = doClassic.length;
  runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const doAgile = fake!.calls().slice().filter(c => c.args[0] === 'run').slice(n);
  for (const ferramenta of ['trivy-vuln', 'trivy-config', 'trivy-license']) {
    const run = doAgile.find(c => c.args.some(a => a.startsWith(`ork-security-scan-${ferramenta}-`)))!;
    assert.ok(run.args.includes(`${path.join(cache, 'orkastery', 'security-scan', 'cache', ferramenta)}:/tmp/trivy-cache`), ferramenta);
    assert.ok(fs.statSync(path.join(cache, 'orkastery', 'security-scan', 'cache', ferramenta)).isDirectory());
  }
  assert.ok(doAgile.filter(c => c.args.some(a => /^ork-security-scan-(gitleaks|semgrep|eslint)-/.test(a)))
    .every(c => !c.args.some(a => a.endsWith(':/tmp/trivy-cache'))), 'so o Trivy monta o cache do Trivy');
});

test('SA4: a segunda rodada com a mesma base reaproveita o relatorio da base e da o mesmo resultado', () => {
  const r = repo('sa4');
  const primeira = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const n = fake!.calls().length;
  const segunda = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const runsDaSegunda = fake!.calls().slice(n).filter(c => c.args[0] === 'run');
  assert.deepEqual(achados(segunda), achados(primeira));
  // Na segunda, so a HEAD e varrida: nenhuma montagem da arvore da base (a segunda arvore do retrato).
  const arvores = new Set(runsDaSegunda.map(c => c.args[c.args.indexOf('-v') + 1].split(':')[0]));
  assert.equal(arvores.size, 1, `so a arvore do HEAD: ${[...arvores].join(', ')}`);
});

test('SA5: falha de uma ferramenta sai igual nos dois modos (failed com o mesmo motivo), sem derrubar as outras', () => {
  const r = repo('sa5');
  process.env.ORK_FAKE_DOCKER_FAIL = 'semgrep';
  const classic = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.deepEqual(estados(agile), estados(classic));
  assert.match(estados(agile).find(e => e.startsWith('semgrep:'))!, /^semgrep:failed:exit-2/);
  assert.deepEqual(achados(agile), achados(classic));
});

test('SA6: o ork security-scan escolhe o modo por --check, depois ORK_CHECK_MODO, depois check.mode, depois o padrao', () => {
  const r = repo('sa6');
  const env = { ...process.env, ORKASTERY_HOME: path.join(r.dir, '.casa') };
  assert.equal(spawnSync(process.execPath, [CLI, 'init', '--name', 'sa', '--abbrev', 'sa'], { cwd: r.dir, env, encoding: 'utf8' }).status, 0);
  const modo = (extra: string[], ambiente: Record<string, string> = {}): string | null => {
    const s = spawnSync(process.execPath, [CLI, 'security-scan', '--base', r.base, '--json', ...extra], { cwd: r.dir, env: { ...env, ...ambiente },
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.ok(s.status === 0 || s.status === 1, s.stderr);
    return (JSON.parse(s.stdout) as ScanReport).check?.modo ?? null;
  };
  assert.equal(modo([]), 'agile', 'padrao');
  assert.equal(modo(['--check', 'classic']), null, 'a opcao');
  assert.equal(modo([], { ORK_CHECK_MODO: 'classic' }), null, 'o ambiente do verify');
  assert.equal(modo(['--check', 'agile'], { ORK_CHECK_MODO: 'classic' }), 'agile', 'a opcao vence o ambiente');
  fs.appendFileSync(path.join(r.dir, 'orkastery.yaml'), '\ncheck:\n  mode: classic\n');
  assert.equal(modo([]), null, 'o manifesto');
  assert.equal(modo([], { ORK_CHECK_MODO: 'agile' }), 'agile', 'o ambiente vence o manifesto');
  const ruim = spawnSync(process.execPath, [CLI, 'security-scan', '--check', 'rapido'], { cwd: r.dir, env, encoding: 'utf8' });
  assert.equal(ruim.status, 2);
  assert.match(ruim.stderr, /--check/);
});

test('SA7: as pecas do Agile vao ao relatorio (check.pecas) e ao ORK_CHECK_RELATORIO do verify', () => {
  const r = repo('sa7');
  const relatorio = path.join(cache, 'relatorio.jsonl');
  fs.writeFileSync(relatorio, '');
  process.env.ORK_CHECK_RELATORIO = relatorio;
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const pecas = agile.check!.pecas.map(p => `${p.peca}:${p.estado}`);
  assert.deepEqual(pecas, ['varredura-paralela:agile', 'cache-semgrep:fallback', 'binarios-nativos:fallback', 'semgrep-prazo-por-regra:agile',
    'cache-trivy-vuln:agile', 'cache-trivy-config:agile', 'imagem-de-lint:agile', 'cache-trivy-license:agile']);
  assert.equal(agile.check!.pecas.find(p => p.peca === 'cache-semgrep')!.fallback, 'regras do registro a cada rodada, como no Classic');
  const linhas = fs.readFileSync(relatorio, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(linhas.map(l => `${String(l.tipo)}:${String(l.peca)}:${String(l.estado)}`), pecas.map(p => `peca:${p}`));
});

test('SA8: sem diretorio de cache, o Trivy do Agile cai para o cache efemero do catalogo e a peca diz por que', () => {
  const r = repo('sa8');
  fs.mkdirSync(path.join(cache, 'orkastery', 'security-scan'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'orkastery', 'security-scan', 'cache'), 'arquivo no lugar da pasta');
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const trivy = agile.check!.pecas.find(p => p.peca === 'cache-trivy-vuln')!;
  assert.equal(trivy.estado, 'fallback');
  assert.equal(trivy.fallback, 'cache efemero do catalogo');
  assert.equal(agile.tools.find(t => t.name === 'trivy-vuln')!.state, 'ran');
});

test('SA9: o Semgrep do Agile roda com 30 s por regra (o padrao dele e 5 s), e o do Classic sem a opcao', () => {
  const r = repo('sa9');
  runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const semgrep = () => fake!.calls().filter(c => c.args[0] === 'run' && c.args.some(a => a.startsWith('ork-security-scan-semgrep-')));
  const doClassic = semgrep();
  assert.ok(doClassic.length > 0 && doClassic.every(c => !c.args.includes('--timeout')));
  runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const doAgile = semgrep().slice(doClassic.length);
  assert.ok(doAgile.length > 0);
  for (const c of doAgile) {
    const i = c.args.indexOf('--timeout');
    assert.ok(i > 0, 'com --timeout');
    assert.equal(c.args[i + 1], '30');
    assert.equal(c.args.length - i, 3, 'antes do diretorio da stack, o ultimo argumento');
  }
});

test('SA10: com ORK_CHECK_VARREDURA_PARALELA (o grupo do verify), a varredura roda no maximo essas ferramentas juntas e a peca diz o teto', () => {
  const r = repo('sa10');
  process.env.ORK_FAKE_DOCKER_SLEEP_MS = '150';
  process.env.ORK_CHECK_VARREDURA_PARALELA = '1';
  const t0 = Date.now();
  const umaPorVez = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const ms = Date.now() - t0;
  assert.ok(ms >= 18 * 150, `uma ferramenta por vez (HEAD e base de cada uma): ${ms} ms`);
  assert.deepEqual(umaPorVez.check!.pecas[0], { peca: 'varredura-paralela', estado: 'agile',
    motivo: 'ate 1 ferramenta(s) ao mesmo tempo, ao lado das lanes do verify' });
  assert.ok(umaPorVez.tools.every(t => t.state === 'ran'), umaPorVez.tools.map(t => `${t.name}:${t.state}`).join(','));
  delete process.env.ORK_CHECK_VARREDURA_PARALELA;
  fs.rmSync(path.join(cache, 'orkastery'), { recursive: true, force: true });
  const sozinha = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.deepEqual(sozinha.check!.pecas[0], { peca: 'varredura-paralela', estado: 'agile' }, 'sozinha, todas juntas e sem teto');
  assert.deepEqual(sozinha.findings.map(f => f.fingerprint).sort(), umaPorVez.findings.map(f => f.fingerprint).sort());
});

test('SA11: a ferramenta que cai so no Agile (o cache do Trivy disputado) roda pelo caminho do Classic, com a peca em fallback', () => {
  const r = repo('sa11');
  const classic = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  fs.rmSync(path.join(cache, 'orkastery'), { recursive: true, force: true });
  process.env.ORK_FAKE_DOCKER_FAIL_COM_CACHE = 'trivy-vuln';
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const vuln = agile.tools.find(t => t.name === 'trivy-vuln')!;
  assert.equal(vuln.state, 'ran', JSON.stringify(vuln));
  const peca = agile.check!.pecas.find(p => p.peca === 'classic-trivy-vuln');
  assert.ok(peca && peca.estado === 'fallback' && peca.fallback === 'a ferramenta pelo caminho do Classic', JSON.stringify(agile.check!.pecas));
  // N2 do CHECK 2: a mensagem real do Trivy termina em `timeout` e nao e estouro do prazo; a nova tentativa roda igual.
  assert.match(String(peca!.motivo), /^no Agile: exit-1: .*cache may be in use by another process: timeout$/);
  assert.deepEqual(agile.findings.map(f => f.fingerprint).sort(), classic.findings.map(f => f.fingerprint).sort(), 'a mesma cobertura do Classic');
});

test('SA13: o estouro que nao repete pelo Classic e o tipado da rodada ou o trabalhador cortado no prazo, nunca o texto do stderr', () => {
  assert.equal(estourouNoAgile('timeout'), true);
  assert.equal(estourouNoAgile('base-timeout'), true);
  assert.equal(estourouNoAgile('exit-1: FATAL init error: cache may be in use by another process: timeout'), false);
  assert.equal(estourouNoAgile('agile-worker-1: timeout ao ler'), false);
  assert.equal(estourouNoAgile(undefined), false);
  assert.equal(estourouNoAgile('agile-worker-124', { duracaoMs: 61_000, prazoMs: 60_000 }), true);
  assert.equal(estourouNoAgile('agile-worker-1: timeout', { duracaoMs: 900, prazoMs: 60_000 }), false);
});

test('SA14: o trabalhador sem relatorio vira falha dele, estourada so pelo prazo, e o motivo vai ao ledger sem credencial de URL', () => {
  const vuln = loadTools().find(x => x.name === 'trivy-vuln')!;
  const segredo = loadTools().find(x => x.category === 'secret')!;
  const relatorio = (reason: string): string => JSON.stringify({ run: { name: vuln.name, category: vuln.category, version: vuln.version,
    executor: 'docker', state: 'failed', reason, counts: {} }, head: [], base: [] });
  // Com relatorio, vale o motivo tipado dele.
  assert.equal(resultadoDoTrabalhador(vuln, { stdout: relatorio('timeout'), stderr: '', code: 0, duracaoMs: 10 }, 60_000).estourou, true);
  assert.equal(resultadoDoTrabalhador(vuln, { stdout: relatorio('exit-1: cache may be in use by another process: timeout'), stderr: '',
    code: 0, duracaoMs: 10 }, 60_000).estourou, false);
  // Sem relatorio: o trabalhador cortado no prazo estourou; o que morreu antes nao.
  const cortado = resultadoDoTrabalhador(vuln, { stdout: '', stderr: 'algo\n', code: 124, duracaoMs: 60_000 }, 60_000);
  assert.equal(cortado.estourou, true);
  assert.equal(cortado.r.run.state, 'failed');
  assert.equal(cortado.r.run.reason, 'agile-worker-124: algo');
  const morto = resultadoDoTrabalhador(vuln, { stdout: '', stderr: 'boom: timeout\n', code: 1, duracaoMs: 900 }, 60_000);
  assert.equal(morto.estourou, false, 'o texto do stderr nao decide');
  // O detector de segredo nunca leva o stderr ao motivo.
  assert.equal(resultadoDoTrabalhador(segredo, { stdout: '', stderr: 'chave=abc\n', code: 1, duracaoMs: 900 }, 60_000).r.run.reason,
    'agile-worker-1');
  // S-k do CHECK 3 e N7 do CHECK 4: nenhum login de URL chega ao ledger, venha a URL inteira, cortada antes do texto
  // chegar (o motivo do Classic vem cortado em 200 sem redigir) ou cortada pelo teto da peca.
  const longo = `falhou ao baixar ${'x'.repeat(120)} https://usuario:senha-longa@registro.exemplo/banco`;
  const r = resultadoDoTrabalhador(vuln, { stdout: '', stderr: `${longo}\n`, code: 1, duracaoMs: 900 }, 60_000).r.run.reason ?? '';
  assert.ok(!r.includes('senha') && !r.includes('usuario'), r);
  const prefixo = 'no Agile: exit-1: erro em';
  // Inteira no meio do texto: o redator tira o login e o resto fica.
  assert.equal(motivoSemCredencial(`${prefixo} https://usuario:senha@host/x ao baixar`, 200), `${prefixo} https://[credencial redigida]@host/x ao baixar`);
  // Cortada antes do `@`: sem barra, com barra ou interrogacao no login, com dois `@` cortada entre eles, com espaco no fim.
  for (const cortada of ['https://usuario:senha-cortad', 'https://usuario:wJalrXUtnFEMI/K7MD', 'https://usuario:ab?cd#e',
    'https://joao@empresa.exemplo:senh', 'postgres://dono:segredo-cortad ']) {
    assert.equal(motivoSemCredencial(`${prefixo} ${cortada}`, 200), `${prefixo} <url cortada>`, cortada);
  }
  // A URL inteira no fim tambem sai (a troca e a favor de nao vazar login), e o texto sem URL fica igual.
  assert.equal(motivoSemCredencial(`${prefixo} https://usuario:senha@host/x`, 200), `${prefixo} <url cortada>`);
  assert.equal(motivoSemCredencial('no Agile: exit-1: erro comum, sem url', 200), 'no Agile: exit-1: erro comum, sem url');
  // O teto da peca corta no meio do login da URL do meio: em qualquer ordem entre redigir e cortar, nada do login sobra.
  const noMeio = `${'x'.repeat(150)} https://usuario:senha-longa@host/caminho e mais texto`;
  for (const teto of [155, 160, 165, 170, 175, 180]) {
    const m = motivoSemCredencial(noMeio, teto);
    assert.ok(m.length <= teto && !/usuario|senha/.test(m), `${teto}: ${m}`);
  }
  assert.ok(motivoSemCredencial(`${'a'.repeat(196)} x://`, 200).length <= 200, 'a marca nunca passa do teto');
});

test('SA12: o binario nativo do Agile usa o cache por usuario que o Docker monta, nao o /tmp compartilhado do catalogo', () => {
  const t = loadTools().find(x => x.name === 'trivy-vuln')!;
  assert.ok(t.args.includes('/tmp/trivy-cache'), 'o catalogo usa o /tmp no container');
  const host = path.join(cache, 'orkastery', 'security-scan', 'cache', 'trivy-vuln');
  const nativo = comCacheNoHost({ ...t, cacheMounts: [{ host, container: '/tmp/trivy-cache' }] });
  assert.ok(nativo.args.includes(host) && !nativo.args.includes('/tmp/trivy-cache'), nativo.args.join(' '));
  assert.equal(comCacheNoHost(t), t, 'sem montagem de cache, nada muda');
});
