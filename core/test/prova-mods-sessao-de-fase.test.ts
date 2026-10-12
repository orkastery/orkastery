import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// RM-059 (T0.1): o script de prova de mod em sessao de fase roda em ensaio sem `claude`, sem credencial
// e sem abrir sessao; o resumo decide o veredito so pelo registro da sonda.
const raizDoRepo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(raizDoRepo, 'core/scripts/prova-mods-sessao-de-fase.cjs');
const prova = require(SCRIPT);

function comPasta(corpo: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-mods-teste-'));
  try { corpo(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('ensaio grava a sonda e imprime o comando exato, sem a identidade do despacho no env', () => {
  comPasta((saida) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--ensaio', '--json', '--saida', saida], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: saida, ORK_DISPATCH_ID: 'd1', ORK_DISPATCH_THREAD: 't1', ORK_CANAL: 'cli', ORK_HITL_SEGREDO: 's' },
    });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.formato, 'ork.prova-mods-sessao-de-fase/v1');
    assert.equal(j.ensaio, true);
    assert.deepEqual(j.comando.slice(0, 2), ['claude', '--bg']);
    const sonda = path.join(saida, 'ork-sonda-fase');
    assert.equal(j.comando[j.comando.indexOf('--plugin-dir') + 1], sonda);
    const settings = JSON.parse(j.comando[j.comando.indexOf('--settings') + 1]);
    assert.match(settings.env.ORK_SONDA_MARCA, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(j.comando[j.comando.indexOf('--allowedTools') + 1], 'Bash(true)');
    assert.deepEqual(j.removidas, ['ORK_CANAL', 'ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_HITL_SEGREDO']);
    const manifesto = JSON.parse(fs.readFileSync(path.join(sonda, '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(manifesto.name, 'ork-sonda-fase');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sonda, 'hooks/hooks.json'), 'utf8')), { modules: ['./register.ts'] });
    const modulo = fs.readFileSync(path.join(sonda, 'hooks/register.ts'), 'utf8');
    for (const evento of ['session.start', 'classic.SessionStart', 'classic.PostToolBatch']) {
      assert.ok(modulo.includes(`on('${evento}'`), `a sonda registra ${evento}`);
    }
    assert.ok(modulo.includes("$.env.get('ORK_SONDA_MARCA')"));
    assert.ok(fs.existsSync(path.join(sonda, 'test/sonda.test.ts')), 'a sonda tem teste do kit');
  });
});

test('o ambiente da sessao perde despacho, canal e ingresso humano e ganha a marca velha', () => {
  const { env, removidas } = prova.ambienteDaSessao({ PATH: '/bin', ORK_DISPATCH_ID: 'a', ORK_CANAL: 'b', ORK_HITL_X: 'c', ORK_PROJETO: 'p' }, 'velha-1');
  assert.deepEqual(removidas, ['ORK_CANAL', 'ORK_DISPATCH_ID', 'ORK_HITL_X']);
  assert.deepEqual(env, { PATH: '/bin', ORK_PROJETO: 'p', ORK_SONDA_MARCA: 'velha-1' });
});

test('o resumo decide o veredito pelo registro da sonda', () => {
  const base = { marca: 'm', marcaVelha: 'velha-m', claudeNoSandbox: null };
  const completo = prova.resumir([
    { evento: 'session.start', marca: 'm', task: ['TaskCreate', 'TaskList'] },
    { evento: 'classic.SessionStart', permissao: 'auto' },
    { evento: 'classic.PostToolBatch', chamadas: 2, permissao: 'auto' },
  ], base);
  assert.deepEqual(completo.carregou, { sessionStart: true, classicSessionStart: true, postToolBatch: true });
  assert.equal(completo.p1Env.ok, true);
  assert.deepEqual(completo.p2Task, { ferramentas: ['TaskCreate', 'TaskList'], ok: true });
  assert.deepEqual(completo.p3Permissao, { modos: ['auto'] });
  assert.deepEqual(completo.p4Sandbox, { claudeNoPath: null, ok: false });
  assert.equal(completo.vereditoSugerido, 'mod carrega em sessao --bg e recebe classic.PostToolBatch');

  const velha = prova.resumir([{ evento: 'session.start', marca: 'velha-m', task: [] }], base);
  assert.equal(velha.p1Env.ok, false);
  assert.equal(velha.p1Env.leuMarcaVelha, true);
  assert.match(velha.vereditoSugerido, /plano B do Freio/);

  assert.match(prova.resumir([], base).vereditoSugerido, /^inconclusivo/);
  assert.match(prova.resumir([{ evento: 'classic.PostToolBatch', chamadas: 1 }], base).vereditoSugerido, /^registro parcial/);
});

test('o claude e procurado so no PATH do sandbox do verify', () => {
  assert.equal(prova.PATH_DO_SANDBOX, '/usr/local/bin:/usr/bin:/bin');
  comPasta((home) => {
    const achado = prova.claudeNoPathDoSandbox(home);
    assert.ok(achado === null || ['/usr/local/bin/', '/usr/bin/', '/bin/'].some((d) => achado.startsWith(d)), String(achado));
  });
});

test('argumentos: opcao desconhecida e prazo fora da faixa sao recusados', () => {
  assert.throws(() => prova.lerArgs(['--abrir']), /opcao desconhecida/);
  assert.throws(() => prova.lerArgs(['--prazo', '5']), /--prazo/);
  assert.throws(() => prova.lerArgs(['--cwd']), /exige valor/);
  assert.equal(prova.lerArgs(['--prazo', '60']).prazo, 60);
  assert.equal(prova.idDaSessao('started 1a2b3c4d-1111-2222-3333-444455556666 in background'), '1a2b3c4d-1111-2222-3333-444455556666');
  assert.equal(prova.idDaSessao('id: 0badc0de'), '0badc0de');
  assert.equal(prova.idDaSessao('nada'), null);
});

test('o texto do script nao traz caminho de maquina nem credencial', () => {
  const texto = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(texto, new RegExp('/hom' + 'e/'));
  assert.doesNotMatch(texto, /sk-ant|ANTHROPIC_API_KEY|apiKeyHelper|CLAUDE_CODE_OAUTH/);
});
