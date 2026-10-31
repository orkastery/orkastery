/**
 * RM-072 (D11, D12, T6 da ork-check5x): a imagem de lint pre-montada e o binario nativo primeiro, so no Agile Check. A
 * imagem sai uma vez, do digest e do `install` do catalogo; o `eslint` do Agile roda o mesmo script com o `node_modules`
 * da imagem, sem `npm install` e sem rede; build que falha cai para o `eslint` do catalogo; o binario nativo na versao do
 * catalogo roda no lugar do Docker, e o Classic segue Docker primeiro. Os nomes comecam por "SLn:".
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { dirTemporario } from './apoio';
import { installFakeTools, type FakeTools } from './security-scan-docker-falso';
import { PRAZO_DO_BUILD_DA_IMAGEM_MS, prazoDoBuildDaImagem, runScanAgil } from '../src/security-scan/agil';
import { argvDoItem, rodarEmParalelo, type ItemParalelo } from '../src/check-paralelo';
import { dockerfileDeLint, eslintComImagem, tagDaImagemDeLint } from '../src/security-scan/imagem-de-lint';
import { runScan } from '../src/security-scan/run';
import { loadTools } from '../src/security-scan/tools';
import { repositorioSecurityScan } from './security-scan-repo-fixture';

const ESLINT = loadTools().find(t => t.name === 'eslint')!;

let cache: string;
let fake: FakeTools | undefined;
const salvos: Record<string, string | undefined> = {};
const CHAVES = ['XDG_CACHE_HOME', 'ORK_FAKE_DOCKER_BUILD', 'ORK_FAKE_DOCKER_BUILD_STDERR', 'ORK_FAKE_DOCKER_BUILD_SLEEP_MS',
  'ORK_FAKE_NATIVE_WRONG_VERSION', 'ORK_CHECK_RELATORIO', 'ORK_CHECK_CPUS_DA_LANE', 'ORK_CHECK_CPUS_DOCKER'];
const limpar: string[] = [];

beforeEach(() => {
  for (const k of CHAVES) { salvos[k] = process.env[k]; delete process.env[k]; }
  cache = dirTemporario('scan-agil-lint-cache');
  process.env.XDG_CACHE_HOME = cache;
});
afterEach(() => {
  fake?.restore();
  fake = undefined;
  for (const k of CHAVES) { if (salvos[k] === undefined) delete process.env[k]; else process.env[k] = salvos[k]; }
  for (const d of [cache, ...limpar.splice(0)]) fs.rmSync(d, { recursive: true, force: true });
});

function repo(nome: string): { dir: string; base: string } {
  const r = repositorioSecurityScan(nome);
  limpar.push(r.dir);
  return { dir: r.dir, base: r.base };
}
const runsDo = (ferramenta: string) => fake!.calls().filter(c => c.args[0] === 'run' && c.args.some(a => a.startsWith(`ork-security-scan-${ferramenta}-`)));

test('SL1: a imagem de lint sai uma vez, do digest e do install do catalogo, e a segunda rodada nao monta de novo', () => {
  fake = installFakeTools(['docker']);
  const r = repo('sl1');
  runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const builds = () => fake!.calls().filter(c => c.args[0] === 'build');
  assert.equal(builds().length, 1);
  assert.deepEqual(builds()[0].args, ['build', '--quiet', '-t', tagDaImagemDeLint(ESLINT), '-']);
  const dockerfile = fs.readFileSync(path.join(fake!.dir, 'ultimo-dockerfile'), 'utf8');
  assert.equal(dockerfile, dockerfileDeLint(ESLINT));
  assert.ok(dockerfile.startsWith(`FROM ${ESLINT.image}\n`), 'o digest do node do catalogo');
  for (const pacote of ESLINT.install!) assert.ok(dockerfile.includes(pacote), pacote);
  assert.ok(dockerfile.includes('--ignore-scripts'));
  runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.equal(builds().length, 1, 'a imagem ja existe na segunda rodada');
});

test('SL2: o eslint do Agile roda na imagem local, sem npm install e sem rede, com o resto dos argumentos do catalogo', () => {
  fake = installFakeTools(['docker']);
  const r = repo('sl2');
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const run = runsDo('eslint')[0].args;
  const tag = tagDaImagemDeLint(ESLINT);
  assert.ok(run.includes(tag));
  assert.equal(run[run.indexOf('--network') + 1], 'none');
  const script = run[run.indexOf(tag) + 2];
  assert.ok(!script.includes('npm install'), 'sem npm install');
  assert.ok(script.includes('ln -s /opt/lint/node_modules /tmp/lint/node_modules'));
  assert.equal(script, ESLINT.args[2].replace('npm install --prefix /tmp/lint --ignore-scripts --no-audit --no-fund --no-save {install} >&2',
    'ln -s /opt/lint/node_modules /tmp/lint/node_modules'), 'o mesmo script, so a instalacao trocada');
  const eslint = agile.tools.find(t => t.name === 'eslint')!;
  assert.equal(eslint.state, 'ran');
  assert.equal(eslint.version, ESLINT.version);
  assert.deepEqual(agile.check!.pecas.find(p => p.peca === 'imagem-de-lint'), { peca: 'imagem-de-lint', estado: 'agile' });
});

test('SL3: build que falha cai para o eslint do catalogo (npm install no container), com a peca e o motivo', () => {
  fake = installFakeTools(['docker']);
  process.env.ORK_FAKE_DOCKER_BUILD = 'fails';
  const r = repo('sl3');
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const run = runsDo('eslint')[0].args;
  assert.ok(run.includes(ESLINT.image), 'a imagem do catalogo');
  assert.ok(run.some(a => a.includes('npm install --prefix /tmp/lint')), 'com o npm install do catalogo');
  const peca = agile.check!.pecas.find(p => p.peca === 'imagem-de-lint')!;
  assert.equal(peca.estado, 'fallback');
  assert.match(peca.motivo!, /^docker build saiu 1: npm ERR! network unreachable$/);
  assert.equal(peca.fallback, 'eslint do catalogo, com npm install no container');
  assert.equal(agile.tools.find(t => t.name === 'eslint')!.state, 'ran');
});

test('SL8: o motivo da peca imagem-de-lint chega ao relatorio sem o login da URL do registro (RM-074 F4)', () => {
  fake = installFakeTools(['docker']);
  process.env.ORK_FAKE_DOCKER_BUILD = 'fails';
  process.env.ORK_FAKE_DOCKER_BUILD_STDERR = 'npm ERR! 401 https://usuario:senha-do-registro@registro.exemplo/npm/eslint fora do ar';
  const r = repo('sl8');
  const relatorio = path.join(cache, 'relatorio-do-check.jsonl');
  process.env.ORK_CHECK_RELATORIO = relatorio;
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const peca = agile.check!.pecas.find(p => p.peca === 'imagem-de-lint')!;
  assert.equal(peca.estado, 'fallback');
  assert.ok(!peca.motivo!.includes('senha-do-registro'), peca.motivo);
  assert.equal(peca.motivo, 'docker build saiu 1: npm ERR! 401 https://[credencial redigida]@registro.exemplo/npm/eslint fora do ar');
  // O relatorio da rodada e o que o verify leva ao `verify_run` do ledger.
  const linhas = fs.readFileSync(relatorio, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { peca?: string; motivo?: string });
  assert.equal(linhas.find((l) => l.peca === 'imagem-de-lint')?.motivo, peca.motivo);
  assert.ok(!fs.readFileSync(relatorio, 'utf8').includes('senha-do-registro'));
});

test('SL9: o build da imagem de lint tem o teto de 180 s e o prazo que resta da ferramenta, o menor dos dois (RM-074 F4)', () => {
  assert.equal(PRAZO_DO_BUILD_DA_IMAGEM_MS, 180_000);
  assert.equal(prazoDoBuildDaImagem(900_000), 180_000, 'o teto vale com prazo de sobra');
  assert.equal(prazoDoBuildDaImagem(180_001), 180_000);
  assert.equal(prazoDoBuildDaImagem(45_000), 45_000, 'abaixo do teto, o prazo que resta');
  // O build lento e cortado pelo prazo da rodada, nao espera o sono do docker: o eslint cai para o catalogo, com o motivo.
  fake = installFakeTools(['docker']);
  process.env.ORK_FAKE_DOCKER_BUILD_SLEEP_MS = '20000';
  const r = repo('sl9');
  const inicio = Date.now();
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base, deadlineMs: 3000 });
  const peca = agile.check!.pecas.find(p => p.peca === 'imagem-de-lint')!;
  assert.equal(peca.estado, 'fallback');
  assert.match(peca.motivo!, /^docker build ETIMEDOUT/);
  assert.ok(Date.now() - inicio < 20_000, 'o build foi cortado antes do sono do docker');
});

test('SL10: o teto dos trabalhadores e contado depois do build da imagem de lint (RM-074 F4)', () => {
  fake = installFakeTools(['docker']);
  // O sono do build e maior que o caminho da rodada ate ele (as arvores e a sonda dos nativos), para o prazo contado antes
  // do build passar do teto abaixo com folga.
  const sono = 5000;
  process.env.ORK_FAKE_DOCKER_BUILD_SLEEP_MS = String(sono);
  const r = repo('sl10');
  const pedidos: ItemParalelo[][] = [];
  const deadlineMs = 400_000;
  const inicio = Date.now();
  runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base, deadlineMs }, (itens, ambiente, opcoes) => {
    pedidos.push(itens);
    return rodarEmParalelo(itens, ambiente, opcoes);
  });
  const antesDoGrupo = Date.now() - inicio;
  assert.equal(pedidos.length, 1);
  assert.ok(antesDoGrupo >= sono, `o build dormiu antes do grupo (${antesDoGrupo} ms)`);
  // O prazo de cada trabalhador e o que resta da rodada depois do build, mais a folga de 60 s; contado antes do build,
  // passaria deste teto pelo tempo do build.
  for (const item of pedidos[0]) assert.ok(item.prazoMs <= deadlineMs + 60_000 - sono, `${item.nome}: ${item.prazoMs}`);
});

test('SL11: o trabalhador nativo usa o cache por usuario do Trivy, nunca o /tmp compartilhado do catalogo (RM-074 F4)', () => {
  fake = installFakeTools(['docker', 'trivy']);
  const r = repo('sl11');
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  const trivy = agile.tools.find(t => t.name === 'trivy-vuln')!;
  assert.equal(trivy.executor, 'native');
  const chamadas = fake!.calls().filter(c => c.as === 'trivy' && c.args.includes('--cache-dir'));
  assert.ok(chamadas.length > 0, 'o trivy nativo varreu');
  const doUsuario = path.join(cache, 'orkastery', 'security-scan', 'cache');
  for (const c of chamadas) {
    const dir = c.args[c.args.indexOf('--cache-dir') + 1];
    assert.ok(dir.startsWith(doUsuario + path.sep), `o cache do usuario (XDG_CACHE_HOME), nao ${dir}`);
    assert.ok(!c.args.includes('/tmp/trivy-cache'));
  }
});

test('SL12: o trabalhador da varredura roda pelo argv, sem string de shell, e varre igual (RM-074 F4)', () => {
  fake = installFakeTools(['docker']);
  const r = repo('sl12');
  const pedidos: ItemParalelo[] = [];
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base }, (itens, ambiente, opcoes) => {
    pedidos.push(...itens);
    return rodarEmParalelo(itens, ambiente, opcoes);
  });
  assert.ok(pedidos.length > 0);
  const trabalhador = path.resolve(__dirname, '..', 'src', 'security-scan', 'trabalhador.js');
  for (const item of pedidos) {
    assert.deepEqual(item.argv?.slice(0, 2), [process.execPath, trabalhador], item.nome);
    assert.equal(item.argv!.length, 3, item.nome);
    assert.ok(!argvDoItem(item, true, false).includes('bash') && !argvDoItem(item, true, false).includes('-c'), `${item.nome}: sem shell`);
  }
  assert.ok(agile.tools.length > 0 && agile.tools.every(t => t.state === 'ran'), JSON.stringify(agile.tools.map(t => [t.name, t.state, t.reason])));
});

test('SL4: com o binario nativo na versao do catalogo, o Agile roda o nativo em vez do Docker', () => {
  fake = installFakeTools(['docker', 'zizmor']);
  const r = repo('sl4');
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.equal(agile.tools.find(t => t.name === 'zizmor')!.executor, 'native');
  assert.equal(runsDo('zizmor').length, 0, 'nenhum container do zizmor');
  assert.ok(fake!.calls().some(c => c.as === 'zizmor' && c.args.includes('--format')), 'o nativo varreu');
  assert.equal(agile.tools.find(t => t.name === 'gitleaks')!.executor, 'docker', 'quem nao tem o nativo segue no Docker');
  const peca = agile.check!.pecas.find(p => p.peca === 'binarios-nativos')!;
  assert.equal(peca.estado, 'agile');
  assert.match(peca.motivo!, /^nativos: zizmor; sem binario: /);
});

test('SL5: binario nativo com outra versao nao entra: o Docker roda, e a peca diz que faltou', () => {
  fake = installFakeTools(['docker', 'zizmor']);
  process.env.ORK_FAKE_NATIVE_WRONG_VERSION = 'zizmor';
  const r = repo('sl5');
  const agile = runScanAgil({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.equal(agile.tools.find(t => t.name === 'zizmor')!.executor, 'docker');
  assert.ok(runsDo('zizmor').length > 0);
  const peca = agile.check!.pecas.find(p => p.peca === 'binarios-nativos')!;
  assert.equal(peca.estado, 'fallback');
  assert.match(peca.motivo!, /zizmor/);
  assert.equal(peca.fallback, 'Docker, como no Classic');
});

test('SL6: o Classic segue Docker primeiro, mesmo com o binario nativo na maquina', () => {
  fake = installFakeTools(['docker', 'zizmor']);
  const r = repo('sl6');
  const classic = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.equal(classic.tools.find(t => t.name === 'zizmor')!.executor, 'docker');
  assert.ok(runsDo('zizmor').length > 0);
  assert.equal(fake!.calls().filter(c => c.args[0] === 'build').length, 0, 'o Classic nao monta imagem');
  assert.ok(runsDo('eslint').every(c => c.args.includes(ESLINT.image)), 'o eslint do Classic e o do catalogo');
});

test('SL7: a tag muda com o install e a versao, e catalogo sem o trecho esperado nao troca o eslint', () => {
  const outra = { ...ESLINT, install: [...ESLINT.install!, 'extra@1.0.0'] };
  assert.notEqual(tagDaImagemDeLint(outra), tagDaImagemDeLint(ESLINT));
  assert.notEqual(tagDaImagemDeLint({ ...ESLINT, version: '99.0.0' }), tagDaImagemDeLint(ESLINT));
  assert.match(tagDaImagemDeLint(ESLINT), /^orkastery-eslint-agil:[0-9a-f]{16}$/);
  assert.equal(eslintComImagem({ ...ESLINT, args: ['sh', '-c', 'eslint .', 'sh'] }, 'x:y'), null);
});
