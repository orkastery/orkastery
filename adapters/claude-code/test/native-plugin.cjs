#!/usr/bin/env node
'use strict';
// Integração com Claude instalado. Nenhum fake de Claude, hook ou evento de sessão.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '../../..');
const { projetoTemporario, commitar } = require(path.join(repo, 'core/dist-test/test/apoio'));
const { novaThread, gravarThread, dirThread } = require(path.join(repo, 'core/dist/thread'));
const { lerLedger } = require(path.join(repo, 'core/dist/ledger'));
const { instalarAdaptador } = require(path.join(repo, 'core/dist/hosts'));
const { skillsDoCatalogo } = require(path.join(repo, 'core/dist/catalogo'));
const { ambienteIsolado, arquivosRuntime } = require(path.join(repo, 'core/scripts/smoke-runtime.cjs'));
const catalogo = skillsDoCatalogo(repo).map(s => './' + path.dirname(s.relativo)).sort();
const comandos = fs.readdirSync(path.join(repo, 'adapters/claude-code/commands')).filter(f => f.endsWith('.md')).length;
const report = { version: 1, startedAt: new Date().toISOString(), commands: [], assertions: [], smoke: [] };
const projects = [];
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const check = (name, fn) => { fn(); report.assertions.push(name); };
const fixture = name => { const p = projetoTemporario(name); projects.push(p); return p; };
const p = fixture('native-plugin');
const unrelated = fixture('native-unrelated');
const runtimeRoot = path.join(p.dir, '.runtime');
const env = ambienteIsolado(runtimeRoot);
const config = env.CLAUDE_CONFIG_DIR;
function command(bin, args, cwd, timeout = 20000) {
  const start = new Date().toISOString();
  const r = cp.spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  report.commands.push({ argv: [bin, ...args], cwd, start, end: new Date().toISOString(),
    exitCode: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, error: r.error?.code });
  assert.equal(r.status, 0, `${bin} ${args[0]}: ${r.stderr || r.error?.code}`);
  return r.stdout;
}
const claude = (args, cwd = p.dir) => command('claude', args, cwd);
function startup(cwd, label, expected) {
  const log = path.join(p.dir, `${label}.debug.log`);
  claude(['--init-only', '--debug-file', log, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], cwd);
  const debug = fs.readFileSync(log, 'utf8');
  report.commands.at(-1).loaderOutput = debug.split('\n').filter(line =>
    /Registered \d+ hooks from|Total plugin (agents|skills|commands) loaded:|Plugin loading errors|Hook load failed|Duplicate hooks/.test(line));
  check(label, () => {
    assert.doesNotMatch(debug, /Plugin loading errors|Hook load failed|Duplicate hooks/);
    assert.match(debug, new RegExp(`Registered ${expected ? 6 : 0} hooks from ${expected ? 1 : 0} plugins`));
    for (const [kind, count] of [['agents', 6], ['skills', catalogo.length], ['commands', comandos]]) {
      assert.match(debug, new RegExp(`Total plugin ${kind} loaded: ${expected ? count : 0}\\b`));
    }
  });
}
function install(cwd, scope, source) {
  claude(['plugin', 'marketplace', 'add', source, '--scope', scope], cwd);
  claude(['plugin', 'install', 'orkastery@orkastery', '--scope', scope], cwd);
  const list = JSON.parse(claude(['plugin', 'list', '--json'], cwd));
  check(`native-install-${scope}-${cwd}`, () => {
    const entry = list.find(e => e.id === 'orkastery@orkastery' && e.projectPath === cwd && e.scope === scope);
    assert.ok(entry?.enabled, JSON.stringify(list));
    assert.deepEqual(entry.errors || [], []);
  });
  const details = claude(['plugin', 'details', 'orkastery'], cwd);
  check(`inventory-${cwd}`, () => {
    assert.match(details, new RegExp(`Skills \\(${catalogo.length + comandos}\\)`));
    assert.ok(details.includes('onboarding'), 'I15 precisa ser exposta no inventário nativo');
    assert.match(details, /Agents \(6\)/);
    assert.match(details, /Hooks \(6\)/);
    for (const name of ['ork-goal', 'ork-plan', 'ork-go', 'ork-check', 'ork-ship', 'ork-master']) assert.ok(details.includes(name));
  });
}
async function main() {
  assert.notEqual(process.getuid?.(), 0, 'A prova exige usuário comum');
  report.cliVersion = claude(['--version']).trim();
  commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'fixture manifesto');
  const t = novaThread(p.carregado, { nome: 'native-enabled', modo: 'auto', criarWorktree: true }).thread;
  const excluded = novaThread(p.carregado, { nome: 'native-excluded', modo: 'auto', criarWorktree: true }).thread;
  const settings = path.join(p.dir, '.claude/settings.json');
  fs.writeFileSync(settings, JSON.stringify({ env: { NATIVE_FIXTURE_KEEP: 'preserve' }, permissions: { deny: ['Read(./fixture-private)'] } }));
  const installed = instalarAdaptador('claude-code', { projeto: p.dir, catalogo: repo });
  assert.ok(installed.ok);
  report.install = { api: 'core/dist/hosts.js#instalarAdaptador (ork adapter install)', destino: installed.destino,
    files: installed.arquivos.length, receiptSha256: sha(path.join(installed.destino, 'INSTALADO.json')) };
  claude(['plugin', 'validate', installed.destino]);
  const manifest = JSON.parse(fs.readFileSync(path.join(installed.destino, '.claude-plugin/plugin.json')));
  check('complete-manifest', () => {
    assert.deepEqual([...manifest.skills].sort(), catalogo);
    assert.ok(manifest.skills.includes('./skills/core/onboarding'));
    assert.equal(manifest.agents, undefined);
    assert.equal(manifest.hooks, undefined);
    assert.equal(fs.readdirSync(path.join(installed.destino, 'agents')).filter(f => f.endsWith('.md')).length, 6);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(installed.destino, 'hooks/hooks.json'))).hooks).length, 6);
  });
  report.catalogo = { skills: catalogo, comandos, agentes: 6, hooks: 6 };
  install(p.dir, 'project', installed.destino);
  check('project-settings-preserved', () => {
    const after = JSON.parse(fs.readFileSync(settings));
    assert.equal(after.env.NATIVE_FIXTURE_KEEP, 'preserve');
    assert.deepEqual(after.permissions.deny, ['Read(./fixture-private)']);
  });
  startup(p.dir, 'project-native-loader', true);
  // plugin list pode reportar registros de outra raiz: é o startup que decide.
  claude(['plugin', 'list', '--json'], t.worktree);
  startup(t.worktree, 'unconfigured-ork-worktree', false);
  startup(unrelated.dir, 'unrelated-project', false);
  // --scope local herda a main nas linked worktrees; não serve para exclusão.
  const originalSettings = sha(settings);
  startup(excluded.worktree, 'excluded-ork-worktree', false);
  install(t.worktree, 'project', installed.destino);
  check('worktree-install-preserves-main-settings', () => assert.equal(sha(settings), originalSettings));
  startup(t.worktree, 'project-ork-worktree-loader', true);
  startup(excluded.worktree, 'excluded-after-worktree-install', false);
  startup(unrelated.dir, 'unrelated-after-worktree-install', false);
  if (process.argv.includes('--smoke')) {
    for (const [label, cwd] of [['project', p.dir], ['worktree', t.worktree]]) {
      const sid = randomUUID();
      t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'claude-bg',
        despachadaEm: new Date().toISOString(), promptPath: '', promptSha256: '', verificada: true });
      gravarThread(p.dir, t);
      const state = dirThread(p.dir, t.id);
      const spec = { root: p.dir, cwd, sessionId: sid, ledger: path.join(state, 'ledger.jsonl'), config,
        cli: path.join(repo, 'core/dist/index.js'), debug: path.join(p.dir, `${label}-session.debug.log`) };
      const result = JSON.parse(command('python3', [path.join(__dirname, 'native-session.py'), JSON.stringify(spec)], cwd, 90000));
      report.smoke.push({ label, ...result });
      const event = lerLedger(state).find(e => e.sessionId === sid && e.tipo === 'sessao_bloqueada');
      check(`native-PermissionRequest-${label}`, () => {
        assert.equal(result.ok, true);
        assert.ok(event, 'Sensor nativo deve ingerir evento na thread da fixture');
        assert.equal(event.thread, t.id);
        assert.equal(fs.existsSync(path.join(cwd, 'native-permission-proof.txt')), false);
      });
      report.smoke.at(-1).evento = event;
    }
  }
  check('no-global-enable', () => {
    const userSettings = path.join(config, 'settings.json');
    const global = fs.existsSync(userSettings) ? JSON.parse(fs.readFileSync(userSettings)) : {};
    assert.ok(!global.enabledPlugins?.['orkastery@orkastery']);
    assert.ok(!global.extraKnownMarketplaces?.orkastery);
  });
  report.isolamento = { raiz: runtimeRoot, home: env.HOME, config, arquivos: arquivosRuntime(runtimeRoot) };
  if (process.argv.includes('--smoke')) check('native-sessions-isolated', () => {
    for (const result of report.smoke) assert.ok(report.isolamento.arquivos.some(f => f.path.endsWith(result.sessionId + '.jsonl')),
      'Transcript nativo precisa existir somente na home isolada: ' + result.sessionId);
  });
  report.ok = true;
}
main().catch(error => { report.ok = false; report.error = error.message; process.exitCode = 1; })
  .finally(() => {
    report.endedAt = new Date().toISOString();
    report.limpeza = projects.map(project => ({ alvoCriado: project.dir, removido: false }));
    for (const project of projects.reverse()) project.limpar();
    for (const item of report.limpeza) item.removido = !fs.existsSync(item.alvoCriado);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  });
