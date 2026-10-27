/**
 * RM-072 (D13, T7 da ork-check5x): `osv-scanner` e `oxlint` num catalogo so do Agile Check, atras de
 * `check.agile.osv_scanner` e `check.agile.oxlint`, desligados por padrao. Os normalizadores leem as saidas reais
 * gravadas uma vez (aparadas so nos campos que eles nao leem); ligada, a chave do `osv-scanner` troca `trivy-vuln` e
 * `npm-audit`, e a do `oxlint` acrescenta o primeiro passe antes do `eslint`; desligadas, a lista e a do catalogo; e o
 * script de paridade aponta achado novo e desaparecido. Os nomes comecam por "SFn:".
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { dirTemporario } from './apoio';
import { installFakeTools, type FakeTools } from './security-scan-docker-falso';
import { runScanAgil } from '../src/security-scan/agil';
import { osvScanner } from '../src/security-scan/normalize/osv-scanner';
import { oxlint } from '../src/security-scan/normalize/oxlint';
import { runScan } from '../src/security-scan/run';
import type { ScanReport } from '../src/security-scan/types';

const GRAVADAS = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'security-scan');
const FIXTURE_JS = path.resolve(__dirname, '..', '..', '..', 'eval', 'fixtures', 'security-scan', 'js');
const PARIDADE = path.resolve(__dirname, '..', '..', 'scripts', 'check-paridade-scan.cjs');
const CLI = path.resolve(__dirname, '..', '..', 'dist', 'index.js');
const gravada = (nome: string): string => fs.readFileSync(path.join(GRAVADAS, nome), 'utf8');

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

function repositorio(nome: string): { dir: string; base: string } {
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
  return { dir, base };
}

let cache: string;
let fake: FakeTools | undefined;
const salvos: Record<string, string | undefined> = {};
const limpar: string[] = [];
beforeEach(() => {
  // ORK_CHECK_MODO vem do verify que roda a suite (classic no npm test do Classic) e mudaria o modo padrao do SF7.
  for (const k of ['XDG_CACHE_HOME', 'ORK_CHECK_RELATORIO', 'ORK_CHECK_MODO']) { salvos[k] = process.env[k]; delete process.env[k]; }
  cache = dirTemporario('scan-agil-flags-cache');
  process.env.XDG_CACHE_HOME = cache;
  fake = installFakeTools(['docker']);
});
afterEach(() => {
  fake?.restore();
  for (const [k, v] of Object.entries(salvos)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const d of [cache, ...limpar.splice(0)]) fs.rmSync(d, { recursive: true, force: true });
});
function repo(nome: string): { dir: string; base: string } { const r = repositorio(nome); limpar.push(r.dir); return r; }

test('SF1: o normalizador do osv-scanner da um achado por grupo de aliases, com a severidade do CVSS do grupo', () => {
  const achados = osvScanner(gravada('osv-scanner.js.json'), { root: '/src', stackDir: '.' });
  const grupos = (JSON.parse(gravada('osv-scanner.js.json')) as { results: Array<{ packages: Array<{ groups: unknown[] }> }> })
    .results.flatMap(r => r.packages.flatMap(p => p.groups)).length;
  assert.equal(achados.length, grupos);
  const lodash = achados.find(a => a.snippet === 'lodash' && a.rule === 'GHSA-35jh-r3h4-6jhm')!;
  assert.equal(lodash.severity, 'high', 'max_severity 7.2');
  assert.equal(lodash.file, 'package-lock.json');
  assert.equal(lodash.category, 'dependency');
  assert.ok(achados.every(a => a.tool === 'osv-scanner'));
  assert.deepEqual(osvScanner(gravada('osv-scanner.empty.json'), { root: '/src', stackDir: '.' }), []);
});

test('SF2: o normalizador do oxlint le os diagnosticos com a regra, a linha e o arquivo relativo a stack', () => {
  const achados = oxlint(gravada('oxlint.js.json'), { root: '/src', stackDir: '.' });
  assert.deepEqual(achados.map(a => [a.rule, a.file, a.severity]), [['eslint(no-eval)', 'src/server.js', 'low']]);
  assert.equal(typeof achados[0].line, 'number');
  assert.equal(oxlint(gravada('oxlint.js.json'), { root: '/src', stackDir: 'web' })[0].file, 'web/src/server.js');
  assert.deepEqual(oxlint(gravada('oxlint.empty.json'), { root: '/src', stackDir: '.' }), []);
});

test('SF3: com osv_scanner ligado, o osv-scanner entra no lugar do trivy-vuln e o npm-audit sai, com a peca', () => {
  const r = repo('sf3');
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base, agile: { osv_scanner: true } });
  const nomes = agile.tools.map(t => t.name);
  assert.deepEqual(nomes, ['gitleaks', 'semgrep', 'osv-scanner', 'trivy-config', 'zizmor', 'actionlint', 'eslint', 'trivy-license']);
  assert.equal(agile.tools.find(t => t.name === 'osv-scanner')!.state, 'ran');
  assert.ok(agile.findings.some(f => f.tool === 'osv-scanner'));
  assert.ok(agile.check!.pecas.some(p => p.peca === 'osv-scanner' && p.estado === 'agile'));
});

test('SF4: com oxlint ligado, o primeiro passe roda antes do eslint, e o eslint continua', () => {
  const r = repo('sf4');
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base, agile: { oxlint: true } });
  const nomes = agile.tools.map(t => t.name);
  assert.ok(nomes.indexOf('oxlint') >= 0 && nomes.indexOf('oxlint') === nomes.indexOf('eslint') - 1, nomes.join(','));
  assert.equal(agile.tools.find(t => t.name === 'eslint')!.state, 'ran');
  assert.ok(agile.findings.some(f => f.tool === 'oxlint' && f.rule === 'eslint(no-eval)'));
  assert.ok(agile.check!.pecas.some(p => p.peca === 'oxlint' && p.estado === 'agile'));
});

test('SF5: desligadas (o padrao), as ferramentas do Agile sao as do Classic, na mesma ordem', () => {
  const r = repo('sf5');
  const classic = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.deepEqual(agile.tools.map(t => t.name), classic.tools.map(t => t.name));
  assert.ok(!agile.check!.pecas.some(p => p.peca === 'osv-scanner' || p.peca === 'oxlint'));
});

test('SF6: o script de paridade aponta achado novo e desaparecido, e compara dependencias sem o nome da ferramenta', () => {
  const r = repo('sf6');
  const classic = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const comOsv = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base, agile: { osv_scanner: true } });
  const escrever = (nome: string, rel: ScanReport): string => { const f = path.join(cache, nome); fs.writeFileSync(f, JSON.stringify(rel)); return f; };
  const a = escrever('a.json', classic);
  const igual = spawnSync(process.execPath, [PARIDADE, a, escrever('b.json', classic)], { encoding: 'utf8' });
  assert.equal(igual.status, 0, igual.stdout);
  assert.equal(JSON.parse(igual.stdout).paridade, true);
  const semUm = escrever('c.json', { ...classic, findings: classic.findings.slice(1) });
  const falta = spawnSync(process.execPath, [PARIDADE, a, semUm], { encoding: 'utf8' });
  assert.equal(falta.status, 1);
  assert.equal(JSON.parse(falta.stdout).desaparecidos, 1);
  const troca = spawnSync(process.execPath, [PARIDADE, a, escrever('d.json', comOsv), '--dependencias'], { encoding: 'utf8' });
  const resumo = JSON.parse(troca.stdout) as { paridade: boolean; novos: number; desaparecidos: number; dependencias: { paridade: boolean } };
  assert.equal(resumo.paridade, false, 'trocar ferramenta muda a impressao digital por construcao');
  assert.ok(resumo.novos > 0 && resumo.desaparecidos > 0);
  assert.equal(troca.status, resumo.dependencias.paridade ? 0 : 1);
});

test('SF7: o ork security-scan le check.agile.osv_scanner do manifesto e roda o osv-scanner no Agile', () => {
  const r = repo('sf7');
  const env = { ...process.env, ORKASTERY_HOME: path.join(r.dir, '.casa') };
  assert.equal(spawnSync(process.execPath, [CLI, 'init', '--name', 'sf', '--abbrev', 'sf'], { cwd: r.dir, env, encoding: 'utf8' }).status, 0);
  fs.appendFileSync(path.join(r.dir, 'orkastery.yaml'), '\ncheck:\n  agile:\n    osv_scanner: true\n');
  const s = spawnSync(process.execPath, [CLI, 'security-scan', '--base', r.base, '--json'], { cwd: r.dir, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.ok(s.status === 0 || s.status === 1, s.stderr);
  const rel = JSON.parse(s.stdout) as ScanReport;
  assert.ok(rel.tools.some(t => t.name === 'osv-scanner'));
  assert.ok(!rel.tools.some(t => t.name === 'npm-audit'));
  const classic = spawnSync(process.execPath, [CLI, 'security-scan', '--base', r.base, '--json', '--check', 'classic'], { cwd: r.dir, env,
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.ok(!(JSON.parse(classic.stdout) as ScanReport).tools.some(t => t.name === 'osv-scanner'), 'o Classic nunca le o catalogo do Agile');
});
