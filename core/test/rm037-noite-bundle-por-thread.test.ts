/**
 * RM-037 (rm037noite, defeito 1): o `.ork-ci/bundle.json` era o mesmo caminho em toda thread, e toda PR
 * conflitava com todas as outras: depois de cada merge, a proxima branch pedia merge da main, `ork ci
 * prepare` e CI de novo. Agora cada thread grava `.ork-ci/<thread>.json` e o CI acha o dela pelo nome
 * da branch.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { arquivoDoBundle, bundleDaBranch, executarCiDaBranch, prepararBundleCi } from '../src/ci';
import { adicionarClaim } from '../src/claims';
import { novaThread } from '../src/thread';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const RAIZ_DO_REPO = path.resolve(__dirname, '../../..');

function bundleNoDisco(dir: string, nome: string, thread: string, branch?: string, verificar = 'test -f README.md'): void {
  fs.mkdirSync(path.join(dir, '.ork-ci'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ork-ci', nome), JSON.stringify({
    schema: 'ork.ci-bundle/v1', thread, ...(branch ? { branch } : {}), base: 'main',
    claims: [{ id: 'C1', thread, fase: 'GO', arquivo: 'README.md', alegacao: `claim de ${thread}`, negativa: false,
      verificar: [verificar], criadoEm: new Date().toISOString(), estado: 'pendente' }],
    commands: [{ name: 'fixture', command: 'true' }],
  }) + '\n');
}

test('defeito 1: cada thread grava o proprio .ork-ci/<thread>.json, com a branch, e ninguem toca o bundle.json', () => {
  const p = projetoTemporario('rm037noite-bundle-prepare');
  try {
    const a = novaThread(p.carregado, { nome: 'primeira', modo: 'auto' }).thread;
    const b = novaThread(p.carregado, { nome: 'segunda', modo: 'auto' }).thread;
    adicionarClaim(p.dir, a.id, { arquivo: 'README.md', alegacao: 'o readme existe', verificar: ['test -f README.md'] });
    const arquivoA = prepararBundleCi(p.carregado, a.id);
    const arquivoB = prepararBundleCi(p.carregado, b.id);
    assert.equal(arquivoA, path.join(p.dir, '.ork-ci', `${a.id}.json`));
    assert.equal(arquivoB, path.join(p.dir, '.ork-ci', `${b.id}.json`));
    assert.deepEqual(fs.readdirSync(path.join(p.dir, '.ork-ci')).sort(), [`${a.id}.json`, `${b.id}.json`].sort());
    const bundleA = JSON.parse(fs.readFileSync(arquivoA, 'utf8'));
    assert.equal(bundleA.thread, a.id);
    assert.equal(bundleA.branch, `ork/${a.slug}`);
    assert.deepEqual(bundleA.claims.map((c: { id: string }) => c.id), ['C1']);
    assert.throws(() => arquivoDoBundle('../fora'), /ci\.bundle: "\.\.\/fora" nao e id de thread/);
  } finally { p.limpar(); }
});

test('defeito 1: o CI acha o bundle pela branch; o legado so vale quando a thread dele bate', () => {
  const p = projetoTemporario('rm037noite-bundle-branch');
  try {
    bundleNoDisco(p.dir, 'ork-ab.json', 'ork-ab', 'ork/ork-ab-full');
    bundleNoDisco(p.dir, 'ork-a.json', 'ork-a');
    // O legado de uma PR aberta antes da mudanca: sem `branch`, com a thread dela.
    bundleNoDisco(p.dir, 'bundle.json', 'ork-velha');
    // Arquivo com nome de outra thread nao vale: o nome tem de ser o da thread (ou o legado).
    bundleNoDisco(p.dir, 'ork-intrusa.json', 'ork-outra', 'ork/ork-outra-full');

    assert.equal(bundleDaBranch(p.dir, 'ork/ork-ab-full')?.arquivo, '.ork-ci/ork-ab.json');
    assert.equal(bundleDaBranch(p.dir, 'ork/ork-a-full')?.arquivo, '.ork-ci/ork-a.json', 'ork-a nao leva a branch da ork-ab');
    assert.equal(bundleDaBranch(p.dir, 'ork/ork-velha-goal')?.arquivo, '.ork-ci/bundle.json');
    assert.equal(bundleDaBranch(p.dir, 'ork/ork-outra-full'), null);
    assert.equal(bundleDaBranch(p.dir, 'main'), null, 'a main nao pega o bundle da ultima entrega');
  } finally { p.limpar(); }
});

test('defeito 1: branch de thread sem bundle reprova; a main roda so os comandos do manifesto', () => {
  const p = projetoTemporario('rm037noite-bundle-run');
  try {
    bundleNoDisco(p.dir, 'ork-velha.json', 'ork-velha', 'ork/ork-velha-full', 'false');
    const semThread = { ...p.carregado, manifesto: { ...p.carregado.manifesto,
      ci: { ...p.carregado.manifesto.ci, command: 'test -f README.md' }, verify: { ...p.carregado.manifesto.verify, preparo: undefined } } };
    assert.throws(() => executarCiDaBranch(semThread, 'ork/ork-sem-bundle-full'),
      /^Error: ci\.bundle\.ausente: a branch ork\/ork-sem-bundle-full e de thread e nao tem bundle em \.ork-ci\//);
    const main = executarCiDaBranch(semThread, 'main');
    assert.equal(main.ok, true);
    assert.equal(main.thread, null);
    assert.equal(main.bundle, null);
    assert.deepEqual(main.claims, [], 'na main nenhuma claim de thread velha roda');
    assert.equal(main.commands.length, 1);
    assert.equal(main.commands[0].ok, true, 'o comando do manifesto rodou');
    const velha = executarCiDaBranch(semThread, 'ork/ork-velha-full');
    assert.equal(velha.bundle, '.ork-ci/ork-velha.json');
    assert.equal(velha.ok, false, 'a claim da thread reprova e o CI reprova');

    // O CLI: `ork ci run --branch` sai 1 com o bundle reprovado e 0 na main.
    const cli = (branch: string) => spawnSync(process.execPath, [CLI, 'ci', 'run', '--branch', branch],
      { cwd: p.dir, encoding: 'utf8', env: { ...process.env, ORK_FABRICA_PUBLICAR: '0' } });
    const reprovado = cli('ork/ork-velha-full');
    assert.equal(reprovado.status, 1, reprovado.stderr);
    assert.equal(JSON.parse(reprovado.stdout).bundle, '.ork-ci/ork-velha.json');
  } finally { p.limpar(); }
});

test('defeito 1: o workflow do CI passa a branch, nao o caminho unico', () => {
  const workflow = fs.readFileSync(path.join(RAIZ_DO_REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /ci run --branch "\$\{GITHUB_HEAD_REF:-\$GITHUB_REF_NAME\}"/);
  assert.doesNotMatch(workflow, /--bundle \.ork-ci\/bundle\.json/);
});
