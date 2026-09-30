/**
 * I-53 (RM-037, P6): o lint do comando de claim. As regras sao as do PLAN da I-37 (D14 a D17),
 * com os falsos positivos que a medida de 1.4 encontrou virando casos que NAO podem casar.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analisarComando } from '../src/claim-lint';
import { adicionarClaim, caminhoClaims, lerClaims, montarClaim } from '../src/claims';
import { lintDoBundle, prepararBundleCi } from '../src/ci';
import { TESTES_DE_INTEGRACAO_LOCAL } from '../src/integracoes-locais';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

const regras = (c: string) => analisarComando(c).map((a) => a.regra);

test('(a) suite inteira do npm: casa so o npm test sem subcomando e sem arquivo depois de --', () => {
  for (const c of ['npm test', 'npm run test', 'npm --prefix core test', 'cd core && npm test',
    'npm --prefix core run test -- --watch', 'npm test --silent']) {
    assert.deepEqual(regras(c), ['suite-inteira'], c);
  }
  for (const c of ['npm --prefix core run test:ci', 'npm test -- core/test/x.test.ts', 'npm run test -- src/a.test.js',
    'npm --prefix core run build:test && node --test core/dist-test/test/x.test.js', 'node --test core/dist-test/test/x.test.js',
    'npm run testar']) {
    assert.deepEqual(regras(c), [], c);
  }
  assert.match(analisarComando('npm test')[0].correcao, /npm --prefix core run test:ci/);
});

test('(b1) SHA intermediario so em comando git, e nunca como argumento de merge-base --is-ancestor', () => {
  assert.deepEqual(regras('git diff 1b16a4a HEAD -- core/src'), ['sha-intermediario']);
  assert.deepEqual(regras('git show a8d81bf:core/src/x.ts | grep -q foo'), ['sha-intermediario']);
  assert.deepEqual(regras('git merge-base --is-ancestor 1b16a4a HEAD'), []);
  assert.deepEqual(regras('git log --oneline -1'), []);
  assert.deepEqual(regras('grep -q 1b16a4a arquivo.txt'), [], 'sem git, hash e so texto');
  assert.deepEqual(regras('git diff deadbee HEAD'), [], 'sem digito nao e hash de commit');
});

test('(b2) contagem de commits so quando comparada a um numero', () => {
  assert.deepEqual(regras('test "$(git rev-list --count main..HEAD)" -eq 3'), ['contagem-de-commits']);
  assert.deepEqual(regras('git log --oneline main..HEAD | wc -l | grep -qx 2'), ['contagem-de-commits']);
  assert.deepEqual(regras('git rev-list --count HEAD'), []);
});

test('toda claim nova nasce com o lint; a anexacao refaz o lint so de quem nasceu com ele', () => {
  const limpa = montarClaim({ id: 'C1', dono: 'ork-x', fase: 'GO', arquivo: 'a', alegacao: 'x', verificar: ['node --test a.test.js'] });
  assert.deepEqual(limpa.lint, []);
  const suja = montarClaim({ id: 'C2', dono: 'ork-x', fase: 'GO', arquivo: 'a', alegacao: 'x', verificar: ['npm test'] });
  assert.deepEqual(suja.lint?.map((a) => a.regra), ['suite-inteira']);
});

test('ci prepare recusa a suite inteira em claim nascida sob a regra; claim antiga so avisa, no terminal e no ledger', () => {
  const p = projetoTemporario('claim-lint-ci');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'lint', modo: 'auto' });
    const nova = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'tudo verde', verificar: ['npm --prefix core test'] });
    assert.throws(() => prepararBundleCi(p.carregado, thread.id),
      (e: Error) => e.message.startsWith('claims.lint: o bundle nao foi gerado') && e.message.includes(`${nova.id} roda a suite inteira`));
    assert.equal(fs.existsSync(path.join(p.dir, '.ork-ci')), false, 'nenhum bundle, nem o da thread');
    const evento = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'claim_lint').at(-1)!;
    assert.equal((evento.recusas as string[]).length, 1);

    // A mesma claim gravada antes do lint (sem o campo) nao pode ser reprovada pela regra nova.
    const antigas = lerClaims(p.dir, thread.id).map(({ lint: _lint, ...resto }) => resto);
    fs.writeFileSync(caminhoClaims(p.dir, thread.id), antigas.map((c) => JSON.stringify(c)).join('\n') + '\n');
    const avisos: string[] = [];
    const arquivo = prepararBundleCi(p.carregado, thread.id, { aoAvisar: (l) => avisos.push(l) });
    assert.equal(fs.existsSync(arquivo), true);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /roda a suite inteira .*claim anterior ao lint: so aviso/);
    assert.deepEqual(lintDoBundle(lerClaims(p.dir, thread.id)).recusas, []);
  } finally { p.limpar(); }
});

test('CLI: claims add avisa na hora e diz que o ci prepare recusa', () => {
  const p = projetoTemporario('claim-lint-cli');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'lint cli', modo: 'auto' });
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/index.js'), 'claims', 'add', thread.id, 'README.md',
      '--claim', 'tudo verde', '--verificar', 'npm test'], { cwd: p.dir, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /AVISO: C1 roda a suite inteira \(npm test\); use `npm --prefix core run test:ci`.*O `ci prepare` recusa esta claim\./);
  } finally { p.limpar(); }
});

test('D17: a lista de integracoes locais tem uma fonte so, lida pelo ci.ts e pelo script do test:ci', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/test-ci.js'), 'utf8');
  assert.match(script, /require\('\.\.\/dist\/integracoes-locais\.js'\)/);
  assert.doesNotMatch(script, /'orkmind-transport\.test\.js'/, 'o script nao repete a lista');
  const testes = fs.readdirSync(path.resolve(__dirname, '../../test'));
  for (const nome of TESTES_DE_INTEGRACAO_LOCAL) assert.ok(testes.includes(nome.replace(/\.js$/, '.ts')), nome);
});
