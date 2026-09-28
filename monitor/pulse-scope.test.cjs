/** T24: launcher e nucleo reais, estado e transporte em fixtures temporarias. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lerEscopo } = require('./pulse-scope.cjs');
const repo = path.resolve(__dirname, '..');

function temporario(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-pulse-scope-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function monitor(dir) {
  fs.mkdirSync(path.join(dir, 'monitor'), { recursive: true });
  fs.cpSync(path.join(repo, 'core/dist'), path.join(dir, 'core/dist'), { recursive: true });
  fs.cpSync(path.join(repo, 'core/assets'), path.join(dir, 'core/assets'), { recursive: true });
  fs.symlinkSync(path.join(repo, 'core/node_modules'), path.join(dir, 'core/node_modules'), 'dir');
  for (const file of ['varredura-pulse.sh', 'pulse-scope.cjs']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(dir, 'monitor', file));
  }
}
function configurar(dir, threads) {
  fs.writeFileSync(path.join(dir, 'monitor/pulse-write-scope.json'), JSON.stringify({ versao: 1, threads }));
}
function ambiente(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  return { PATH: '/usr/bin:/bin', ORK_PULSE_RUNTIME_BIN: bin, HOME: path.join(dir, 'home'),
    CODEX_HOME: path.join(dir, 'codex'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude'),
    NODE_PATH: path.join(repo, 'core/node_modules') };
}
function rodar(dir, env) {
  return spawnSync('/bin/bash', [path.join(dir, 'monitor/varredura-pulse.sh')],
    { cwd: dir, env, encoding: 'utf8', timeout: 30000 });
}
function bytes(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? Object.entries(bytes(p)).map(([k, v]) => [e.name + '/' + k, v])
      : [[e.name, fs.readFileSync(p).toString('base64')]];
  }));
}

test('configuracao explicita rejeita entradas ambiguas e alias sem ler destinos', t => {
  const dir = temporario(t), file = path.join(dir, 'scope.json');
  for (const config of [{}, { versao: 1, threads: [] }, { versao: 1, threads: ['ABC'] },
    { versao: 1, threads: ['a', 'a'] }, { versao: 1, threads: ['../alheia'] }]) {
    fs.writeFileSync(file, JSON.stringify(config));
    assert.throws(() => lerEscopo(file), /pulse.scope.invalid/);
  }
  fs.writeFileSync(file, JSON.stringify({ versao: 1, threads: ['ork-fixture'] }));
  assert.equal(lerEscopo(file), 'ork-fixture');
  const alias = path.join(dir, 'alias');
  fs.symlinkSync(path.join(dir, 'destino-inexistente'), alias);
  assert.throws(() => lerEscopo(alias), /pulse.scope.special-file/);
});

function ativar(alvo, threads, runtime = alvo) {
  const api = require(path.join(runtime, 'core/dist/write-activation.js'));
  const c = require(path.join(runtime, 'core/dist/manifest.js')).exigirManifesto(alvo);
  const leases = require(path.join(runtime, 'core/dist/leases.js'));
  for (const nome of ['path:.orkastery/monitor', 'worktree-write:' + threads[0]])
    assert.equal(leases.adquirirRegiao(alvo, nome, { thread: threads[0], motivo: 'synthetic pulse activation' }).ok, true);
  const plano = api.prepararAtivacao(c, threads, ['pulse'], 'fabrica');
  const planoJson = JSON.stringify(plano) + '\n', planoSha256 = api.hashAtivacao(planoJson);
  const aceiteJson = JSON.stringify({ schema: 'ork.write-acceptance/v1', aprovado: true, fase: 'CHECK',
    revisor: 'synthetic-reviewer', planoSha256, head: plano.head, tenant: plano.tenant, perfil: 'fabrica' }) + '\n';
  api.ativarEscrita(c, { planoJson, planoSha256, aceiteJson, aceiteSha256: api.hashAtivacao(aceiteJson),
    operadora: threads[0], por: 'synthetic-executor' });
  return { api, c };
}

test('launcher usa arquivo do projeto alvo; config legada e rebuild nao ativam; aceite explicito ativa', t => {
  const { projetoTemporario } = require('../core/dist-test/test/apoio.js');
  const { novaThread } = require('../core/dist-test/src/thread.js');
  const source = projetoTemporario('pulse-source'), target = projetoTemporario('pulse-target');
  t.after(source.limpar); t.after(target.limpar);
  const dir = source.dir, alvo = target.dir; monitor(dir); monitor(alvo);
  const id = novaThread(target.carregado, { nome: 'alvo', modo: 'auto' }).thread.id;
  fs.writeFileSync(path.join(dir, 'core/dist/pulse-delivery.js'),
    'console.log(JSON.stringify({escopo:process.env.ORK_PULSE_WRITE_SCOPE,raiz:process.argv[2]}))');
  configurar(dir, ['ork-biblioteca']); configurar(alvo, [id]);
  const env = { ...ambiente(dir), ORK_PULSE_PROJECT: alvo };
  const inactive = rodar(dir, env);
  assert.equal(inactive.status, 0, inactive.stderr);
  assert.deepEqual(JSON.parse(inactive.stdout), { escopo: '', raiz: alvo });
  ativar(alvo, [id], dir);
  const r = rodar(dir, env);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { escopo: id, raiz: alvo });
  const conflito = rodar(dir, { ...env, ORK_PULSE_WRITE_SCOPE: 'ork-outro' });
  assert.equal(conflito.status, 1);
  assert.match(conflito.stderr, /pulse.scope.conflict/);
  assert.equal(conflito.stdout, '');
});

test('launcher com nucleo real carimba autorizada, conserva bytes alheios, entrega alertas e deduplica', t => {
  const { projetoTemporario } = require('../core/dist-test/test/apoio.js');
  const { novaThread, dirThread, gravarThread } = require('../core/dist-test/src/thread.js');
  const { registrar } = require('../core/dist-test/src/ledger.js');
  const p = projetoTemporario('launcher-escopo-real'); t.after(p.limpar);
  monitor(p.dir);
  fs.cpSync(path.join(repo, 'core/dist'), path.join(p.dir, 'core/dist'), { recursive: true });
  const permitida = novaThread(p.carregado, { nome: 'permitida', modo: 'auto' }).thread;
  const observada = novaThread(p.carregado, { nome: 'observada', modo: 'auto' }).thread;
  const sessoes = [permitida, observada].map((thread, i) => ({
    id: `1111111${i}`, sessionId: `1111111${i}-2222-3333-4444-555555555555`,
    name: thread.slug, cwd: p.dir, kind: 'background', state: 'blocked', startedAt: Date.now() }));
  for (const thread of [permitida, observada]) {
    thread.sessoes.push({ fase: 'GO', runtime: 'claude-bg', slug: thread.slug,
      sessionId: sessoes[thread === permitida ? 0 : 1].sessionId, despachadaEm: '2020-01-01T00:00:00Z' });
    gravarThread(p.dir, thread);
    registrar(dirThread(p.dir, thread.id), thread.id, 'phase_dispatch', {
      fase: 'GO', runtime: 'claude-bg', sessionId: sessoes[thread === permitida ? 0 : 1].sessionId,
      ts: '2020-01-01T00:00:00Z' });
    registrar(dirThread(p.dir, thread.id), thread.id, 'gate_blocked', {
      fase: 'GO', motivo: 'human.pending', detalhe: 'alerta da fixture', ts: '2020-01-01T00:00:00Z' });
  }
  configurar(p.dir, [permitida.id]);
  const env = ambiente(p.dir);
  fs.writeFileSync(path.join(env.ORK_PULSE_RUNTIME_BIN, 'claude'),
    `#!${process.execPath}\nif(process.argv[2]==='agents') console.log(${JSON.stringify(JSON.stringify(sessoes))});\n` +
    `else if(process.argv[2]==='logs') console.log('Aprovar a execucao?\\n1. Sim\\n2. Nao');\nelse process.exitCode=1;\n`,
    { mode: 0o755 });
  const estado = path.join(p.dir, '.orkastery/monitor'); fs.mkdirSync(estado, { recursive: true });
  const recibos = path.join(p.dir, 'recibos.jsonl');
  fs.writeFileSync(path.join(estado, 'pulse-host.json'), JSON.stringify({ executavel: process.execPath,
    argumentos: ['-e', 'require("fs").appendFileSync(process.argv[1],JSON.stringify(process.argv[2])+"\\n")', recibos, '{{mensagem}}'] }));
  const alheioAntes = bytes(dirThread(p.dir, observada.id));
  const ledgerAntes = fs.readFileSync(path.join(dirThread(p.dir, permitida.id), 'ledger.jsonl'));
  const observer = rodar(p.dir, env);
  assert.equal(observer.status, 0, observer.stderr);
  assert.ok(JSON.parse(observer.stdout).enviadas > 0, 'alertas I01 continuam antes da ativacao');
  assert.deepEqual(fs.readFileSync(path.join(dirThread(p.dir, permitida.id), 'ledger.jsonl')), ledgerAntes);
  assert.deepEqual(bytes(dirThread(p.dir, observada.id)), alheioAntes);
  const activation = ativar(p.dir, [permitida.id]);
  const primeira = rodar(p.dir, env);
  assert.equal(primeira.status, 0, primeira.stderr + primeira.stdout);
  // O primeiro carimbo muda desdeEm: essa mudanca pode gerar uma novidade legitima.
  const mensagens = fs.readFileSync(recibos, 'utf8').trim().split('\n');
  assert.equal(new Set(mensagens).size, mensagens.length, 'mensagens identicas nao sao reenviadas');
  assert.ok(fs.readFileSync(recibos, 'utf8').includes(observada.id), 'alerta alheio permanece visivel');
  assert.notDeepEqual(fs.readFileSync(path.join(dirThread(p.dir, permitida.id), 'ledger.jsonl')), ledgerAntes);
  assert.match(fs.readFileSync(path.join(dirThread(p.dir, permitida.id), 'ledger.jsonl'), 'utf8'), /sessao_bloqueada/);
  assert.deepEqual(bytes(dirThread(p.dir, observada.id)), alheioAntes);
  const entregues = fs.readFileSync(recibos);
  const segunda = rodar(p.dir, env);
  assert.equal(segunda.status, 0, segunda.stderr + segunda.stdout);
  assert.equal(JSON.parse(segunda.stdout).enviadas, 0);
  assert.deepEqual(fs.readFileSync(recibos), entregues);
  assert.deepEqual(bytes(dirThread(p.dir, observada.id)), alheioAntes);
  const ownBeforeRebuild = bytes(dirThread(p.dir, permitida.id));
  fs.appendFileSync(path.join(p.dir, 'core/dist/pulse-delivery.js'), '\n// synthetic new published runtime\n');
  const rebuilt = rodar(p.dir, env);
  assert.equal(rebuilt.status, 0, rebuilt.stderr); assert.match(rebuilt.stderr, /activation.pending|activation-pending/);
  assert.deepEqual(bytes(dirThread(p.dir, permitida.id)), ownBeforeRebuild, 'runtime novo exige aceite novo');
  const statePath = path.join(p.dir, '.orkastery/monitor/write-activation.json');
  const receiptDir = path.join(p.dir, '.orkastery/monitor/write-activation-receipts');
  const receiptsBefore = bytes(receiptDir);
  activation.api.desativarEscrita(activation.c, permitida.id, 'synthetic-executor', activation.api.hashAtivacao(fs.readFileSync(statePath)));
  assert.equal(rodar(p.dir, env).status, 0);
  for (const [file, body] of Object.entries(receiptsBefore)) assert.equal(bytes(receiptDir)[file], body);
  assert.deepEqual(bytes(dirThread(p.dir, permitida.id)), ownBeforeRebuild);
  assert.deepEqual(fs.readFileSync(recibos), entregues);
});
