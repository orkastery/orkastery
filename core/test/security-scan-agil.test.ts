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
import { runScanAgil } from '../src/security-scan/agil';
import { runScan } from '../src/security-scan/run';
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
const CHAVES = ['XDG_CACHE_HOME', 'ORK_FAKE_DOCKER_SLEEP_MS', 'ORK_FAKE_DOCKER_FAIL', 'ORK_CHECK_RELATORIO', 'ORK_CHECK_MODO'];
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
  const t0 = Date.now();
  runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const classic = Date.now() - t0;
  fs.rmSync(path.join(cache, 'orkastery'), { recursive: true, force: true });
  const t1 = Date.now();
  runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const agile = Date.now() - t1;
  assert.ok(classic >= 18 * 400, `Classic em serie: ${classic} ms`);
  assert.ok(agile < classic / 2, `Agile em paralelo (${agile} ms) contra o Classic (${classic} ms)`);
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
  assert.deepEqual(pecas, ['varredura-paralela:agile', 'cache-semgrep:fallback', 'binarios-nativos:fallback', 'cache-trivy-vuln:agile',
    'cache-trivy-config:agile', 'imagem-de-lint:agile', 'cache-trivy-license:agile']);
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
