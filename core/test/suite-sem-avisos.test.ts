/**
 * A6 do backlog autonomo 2: a suite e a instalacao sem os avisos que sao deste repositorio.
 *
 * Os runs 37105111708 e 37105690427 repetiam dois avisos daqui (os das actions ficam fora):
 * - `ExperimentalWarning: The MockTimers API is an experimental feature`, 3 vezes por job no Node 20 e
 *   22, de `hitl-local`, `maestro-performance` e `maestro-authority`;
 * - `npm warn EBADENGINE`: `markdownlint-cli2@0.23.3` e `markdownlint@0.41.1` pediam Node 22, e o
 *   `core/package.json` declara `node >=20`, que a matriz do CI roda.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CORE = path.resolve(__dirname, '../..');
const FONTES_DE_TESTE = path.join(CORE, 'test');

test('o silenciador cala so o aviso do MockTimers; outro aviso, mesmo experimental, continua saindo', () => {
  const helper = path.join(__dirname, 'sem-aviso-mocktimers.js');
  assert.ok(fs.existsSync(helper), 'o helper compilado existe');
  const script = [
    `require(${JSON.stringify(helper)});`,
    "const { mock } = require('node:test');",
    "mock.timers.enable({ apis: ['setTimeout'] }); mock.timers.reset();",
    "process.emitWarning('outro aviso que importa', 'ExperimentalWarning');",
  ].join('\n');
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /MockTimers API is an experimental/);
  assert.match(r.stderr, /ExperimentalWarning: outro aviso que importa/);
});

test('todo arquivo de teste que usa mock.timers importa o silenciador antes', () => {
  const usam = fs.readdirSync(FONTES_DE_TESTE).filter((n) => n.endsWith('.test.ts') && n !== 'suite-sem-avisos.test.ts')
    .filter((n) => /\bmock\.timers\b/.test(fs.readFileSync(path.join(FONTES_DE_TESTE, n), 'utf8')));
  assert.ok(usam.length >= 3, `achou: ${usam.join(', ')}`);
  const sem = usam.filter((n) => !/^import '\.\/sem-aviso-mocktimers';$/m.test(fs.readFileSync(path.join(FONTES_DE_TESTE, n), 'utf8')));
  assert.deepEqual(sem, [], 'sem o import, o Node 20 e 22 do CI imprimem o ExperimentalWarning');
});

/** O menor major que cada alternativa de `engines.node` aceita (`>=20`, `^20.19.0 || >=22`, `20 || 22`). */
function menorMajorAceito(engines: string): number | null {
  const majors = engines.split('||').map((alt) => {
    const m = alt.trim().match(/^(?:>=?|\^|~)?\s*v?(\d+)/);
    return m ? Number(m[1]) : null;
  }).filter((n): n is number => n !== null);
  return majors.length ? Math.min(...majors) : null;
}

test('nenhum pacote do lock do nucleo pede Node acima do que o core/package.json declara (sem EBADENGINE no Node 20)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8')) as { engines: { node: string } };
  const minimo = menorMajorAceito(pkg.engines.node);
  assert.equal(minimo, 20, 'o nucleo declara node >=20');
  const lock = JSON.parse(fs.readFileSync(path.join(CORE, 'package-lock.json'), 'utf8')) as
    { packages: Record<string, { engines?: { node?: string } | string[] }> };
  const acima = Object.entries(lock.packages)
    .map(([nome, p]) => [nome, p.engines && !Array.isArray(p.engines) ? p.engines.node : undefined] as const)
    .filter(([, e]) => typeof e === 'string' && (menorMajorAceito(e) ?? 0) > (minimo as number))
    .map(([nome, e]) => `${nome} (${e})`);
  assert.deepEqual(acima, []);
});

test('a regra do engines: o menor major de cada forma', () => {
  assert.equal(menorMajorAceito('>=20'), 20);
  assert.equal(menorMajorAceito('>=22'), 22);
  assert.equal(menorMajorAceito('^20.19.0 || >=22.12.0'), 20);
  assert.equal(menorMajorAceito('>= 18.18'), 18);
  assert.equal(menorMajorAceito('*'), null);
});
