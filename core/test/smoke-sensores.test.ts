import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sandboxGit } from '../src/sandbox';
const { ambiente, avaliarClaude, avaliarCodex } = require(path.resolve(__dirname, '../../scripts/smoke-sensores.cjs'));
const runtime = require(path.resolve(__dirname, '../../scripts/smoke-runtime.cjs'));

test('harness recusa replay de hook sem prompt, permissão executada e latência excessiva', () => {
  const prova = { promptReal: true, toolName: 'Bash', hookEvent: 'PermissionRequest', sessionId: 'fixture',
    hookEm: '2026-09-08T00:00:00.000Z', promptEm: '2026-09-08T00:00:00.100Z', ferramentaExecutada: false };
  const evento = { tipo: 'sessao_bloqueada', sensor: 'permission_request', sessionId: 'fixture', recebidoEm: '2026-09-08T00:00:00.050Z' };
  assert.equal(avaliarClaude(prova, evento), true); // Somente contrato de validação, nunca prova de runtime.
  for (const alteracao of [{ promptReal: false }, { promptEm: null }, { ferramentaExecutada: true }, { sessionId: 'outra' }]) {
    assert.equal(avaliarClaude({ ...prova, ...alteracao }, evento), false);
  }
  assert.equal(avaliarClaude(prova, { ...evento, recebidoEm: '2026-09-08T00:00:05.000Z' }), false);
  assert.equal(avaliarClaude(prova, null), false);
});

test('harness Codex exige registro e watcher automáticos, close real do controller e usage', () => {
  const resultado = { classificacao: 'fase_concluida', ok: true, exitCode: 0, exitCodeFonte: 'controller.close', tokens: { disponivel: true, input: 4, output: 2 } };
  const gatilho = { registroAutomatico: true, watcherAutomatico: true, observacaoManual: false, rolloutConfirmado: true };
  assert.equal(avaliarCodex(resultado, 'fixture', 'fixture', gatilho), true);
  assert.equal(avaliarCodex(resultado, null, 'fixture', gatilho), false);
  // Recibo de supervisor deixa de ser origem válida neste transporte.
  for (const alteracao of [{ exitCode: null }, { exitCode: 1 }, { exitCodeFonte: 'supervisor.close' },
    { tokens: { disponivel: false } }, { classificacao: 'human.pending' }]) {
    assert.equal(avaliarCodex({ ...resultado, ...alteracao }, 'fixture', 'fixture', gatilho), false);
  }
  for (const alteracao of [{ registroAutomatico: false }, { watcherAutomatico: false },
    { observacaoManual: true }, { rolloutConfirmado: false }]) {
    assert.equal(avaliarCodex(resultado, 'fixture', 'fixture', { ...gatilho, ...alteracao }), false);
  }
  assert.equal(avaliarCodex(resultado, 'fixture', 'fixture', undefined), false);
});

test('ramo Codex do harness atravessa rodarFase, sem registro nem observação manuais', () => {
  const fonte = fs.readFileSync(path.resolve(__dirname, '../../scripts/smoke-sensores.cjs'), 'utf8');
  assert.match(fonte, /rodarFase\(s\.carregado, t\.id, \{ fase: 'GO', runtime: 'codex'/);
  assert.equal(/registrar\(dir, t\.id, 'session_sensor_registered'/.test(fonte), false);
  assert.equal(/observarSessao/.test(fonte), false);
  // Transporte exec não volta pela porta dos fundos deste harness.
  assert.equal(/codex\.despachar\(/.test(fonte), false);
  assert.equal(/iniciarSupervisor/.test(fonte), false);
});

test('harness remove credenciais e redirecionadores pagos sem modificar ambiente pai', () => {
  const base = { PATH: '/fixture/bin', ANTHROPIC_API_KEY: 'fixture', ANTHROPIC_BASE_URL: 'fixture', OPENAI_API_KEY: 'fixture',
    OPENAI_BASE_URL: 'fixture', CLAUDE_CODE_USE_BEDROCK: 'fixture', CLAUDECODE: 'fixture' };
  assert.deepEqual(ambiente(base), { PATH: '/fixture/bin' }); assert.equal(base.OPENAI_API_KEY, 'fixture');
});

test('harness passa os três sandboxes e preserva tentativa quando despacho lanca sem referencia', () => {
  const script = path.resolve(__dirname, '../../scripts/smoke-sensores.cjs');
  const helper = path.resolve(__dirname, '../../scripts/smoke-runtime.cjs');
  const adapter = path.resolve(__dirname, '../../dist/adapters/codex.js');
  for (const sandbox of ['read-only', 'workspace-write', 'danger-full-access']) {
    const s = sandboxGit('smoke-contrato');
    try {
      const manifesto = path.join(s.dir, 'orkastery.yaml');
      fs.writeFileSync(manifesto, fs.readFileSync(manifesto, 'utf8').replace('sandbox: workspace-write', 'sandbox: ' + sandbox));
      const code = `
        const cp=require('child_process'),fs=require('fs');const spawn=cp.spawnSync;
        require(${JSON.stringify(helper)}).prepararRuntime=async(runtime,raiz)=>{fs.mkdirSync(raiz);return {env:process.env,prova:{raiz},fechar:async()=>{}};};
        cp.spawnSync=function(bin,args){if(bin==='codex')return {status:0,stdout:args[0]==='login'?'Logged in using ChatGPT':'fixture-contract',stderr:''};return spawn.apply(this,arguments);};
        let pedido; require(${JSON.stringify(adapter)}).despachar=p=>{pedido=p;throw Error('CONTRACT_STOP');};
        require(${JSON.stringify(script)}).executar('codex').catch(e=>{if(e.message!=='CONTRACT_STOP')throw e;
          console.log(JSON.stringify({sandbox:pedido.sandbox,fixtureRemoved:!fs.existsSync(pedido.cwd),runtimeExecutado:false}));
          fs.rmSync(pedido.cwd,{recursive:true,force:true});});
      `;
      const r = spawnSync(process.execPath, ['-e', code], { cwd: s.dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), { sandbox, fixtureRemoved: false, runtimeExecutado: false });
    } finally { s.limpar(); }
  }
});

test('homes e inventário ficam na tentativa; limpeza não segue links nem remove vizinho', () => {
  const s = sandboxGit('smoke-homes');
  try {
    const base = { PATH: process.env.PATH, HOME: '/global', CODEX_HOME: '/global/codex',
      CLAUDE_CONFIG_DIR: '/global/claude', OPENAI_API_KEY: 'fixture', CLAUDE_CODE_OAUTH_TOKEN: 'fixture', NODE_OPTIONS: '--require /global/hook' };
    const dir = path.join(s.dir, 'attempt'), env = runtime.ambienteIsolado(dir, base);
    const neighbor = path.join(s.dir, 'neighbor'); fs.writeFileSync(neighbor, 'preserve');
    for (const key of ['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
      assert.ok(env[key].startsWith(dir + path.sep));
      assert.equal(fs.statSync(env[key]).mode & 0o777, 0o700);
    }
    assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(env.NODE_OPTIONS, undefined); assert.equal(base.HOME, '/global');
    fs.symlinkSync(neighbor, path.join(env.CODEX_HOME, 'auth.json'));
    fs.writeFileSync(path.join(env.CODEX_HOME, 'fixture-session.jsonl'), '{}\n');
    assert.deepEqual(runtime.arquivosRuntime(dir), [{ path: 'codex/fixture-session.jsonl', bytes: 3 }]);
    fs.rmSync(dir, { recursive: true });
    assert.equal(fs.readFileSync(neighbor, 'utf8'), 'preserve');
  } finally { s.limpar(); }
});

test('reuso do cache nativo é selado, não grava credencial na fixture e não altera origem', async () => {
  const s = sandboxGit('smoke-auth-memfd');
  let isolated;
  try {
    const source = path.join(s.dir, 'source'); fs.mkdirSync(source);
    const file = path.join(source, 'auth.json');
    // Dublê de contrato local, sem autenticação e sem chamada de modelo.
    const bytes = JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'fixture-contract-only' } });
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    isolated = await runtime.prepararRuntime('codex', path.join(s.dir, 'attempt'), { PATH: process.env.PATH, CODEX_HOME: source });
    const cache = path.join(isolated.env.CODEX_HOME, 'auth.json');
    assert.ok(fs.lstatSync(cache).isSymbolicLink());
    assert.deepEqual(JSON.parse(fs.readFileSync(cache, 'utf8')), JSON.parse(bytes));
    assert.throws(() => fs.writeFileSync(cache, 'alterar'), /EPERM/);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    assert.equal(isolated.prova.credencialPersistida, false);
    await isolated.fechar();
    assert.equal(fs.existsSync(cache), false, 'o FD deixa de existir ao fechar o dono');
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  } finally { await isolated?.fechar(); s.limpar(); }
});


// Harness inteiro, dependencias sinteticas allowlistadas: nenhum runtime ou sinal real.
async function executarHarnessSimulado(modo: string) {
  const script = path.resolve(__dirname, '../../scripts/smoke-sensores.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-harness-contract-'));
  const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', uuid = '11111111-2222-3333-4444-555555555555';
  const dir = path.join(root, 'thread'), controller = path.join(dir, 'sessoes/controller-fixture');
  const home = path.join(root, 'runtime/codex'), roll = path.join(home, 'sessions', sid + '.jsonl');
  fs.mkdirSync(controller, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(roll), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(controller, 'launch.json'), JSON.stringify({ instancia: uuid,
    vinculo: { thread: 'ork-fixture', fase: 'GO', promptSha256: 'f'.repeat(64) } }));
  fs.writeFileSync(roll, JSON.stringify({ type: 'session_meta', payload: { id: sid, cwd: root } }) + '\n' + JSON.stringify({ type: 'turn_context', payload: {
    sandbox_policy: { type: 'workspace-write' }, approval_policy: 'never' } }) + '\n');
  fs.writeFileSync(path.join(root, 'codex-proof.txt'), 'ORK_SMOKE_' + uuid);
  const despachoEm = '2026-09-09T00:00:00.000Z';
  const pin = path.join(dir, 'sessoes', 'watcher-source-' + createHash('sha256').update(sid + '|' + despachoEm).digest('hex') + '.json');
  if (modo !== 'sem-fixacao') fs.writeFileSync(pin, '{}');
  const identidade = { pid: 12345, inicio: '100', boot: 'boot-fixture' };
  const eventos = [
    { tipo: 'session_sensor_registered', despachoEm, sessionId: sid, controlador: controller, cwd: root },
    { tipo: 'session_watcher_started', sessionId: sid, pid: 12345,
      identidade: modo === 'identidade-ausente' ? null : identidade },
    { tipo: 'phase_result', sessionId: sid, classificacao: 'fase_concluida', ok: true,
      exitCode: 0, exitCodeFonte: 'controller.close', turnId: 'turn-1', tokens: { disponivel: true, input: 20, output: 4 } },
  ];
  let cleanup = 0, close = 0, keeper = 0, clock = 0, report: any, erro: any;
  const ordem: string[] = [];
  const fakeProcess = { getuid: () => 1000, env: { PATH: '/synthetic', CODEX_HOME: home }, cwd: () => root,
    kill: () => { throw new Error('nao usar sinal como prova'); } };
  const deps: Record<string, any> = {
    sandbox: { sandboxGit: () => ({ dir: root, carregado: { manifesto: { runtime: {} } },
      limpar: () => { ordem.push('limpar'); cleanup++; fs.rmSync(root, { recursive: true }); } }) },
    thread: { novaThread: () => ({ thread: { id: 'ork-fixture', sessoes: [] } }), gravarThread: () => {}, dirThread: () => dir },
    ledger: { lerLedger: () => modo === 'timeout' ? eventos.slice(0, 2) : modo === 'sem-registro' ? eventos.slice(1) : eventos },
    manifest: { exigirManifesto: () => ({ manifesto: { runtime: { sandbox: 'workspace-write' } } }) },
    codex: { acharRollout: () => { throw new Error('descoberta paralela proibida'); } },
    'codex-controller-sensor': {
      registrarFonteController: () => ({ rollout: roll, rolloutIno: fs.statSync(roll).ino, rolloutDev: fs.statSync(roll).dev }),
      lerSnapshotController: (fonte: any) => ({ fonte, rollout: modo === 'rollout-alternativo' ? roll + '.outro' : roll,
        turno: modo === 'turno-divergente' ? 'turn-2' : 'turn-1', terminalNativo: { turnId: 'turn-1', threadId: sid, status: 'completed' },
        fechamento: modo === 'sem-close' ? null : { exitCode: 0 } }),
    },
    phase: { rodarFase: () => { if (modo === 'despacho-lento') clock += 70000; return { sessionId: modo === 'bootstrap-falhou' ? null : sid,
      controlador: controller, motivo: 'runtime.unavailable', comando: ['simulado'], verificada: true }; } },
    'codex-controller': {
      encerrarController: () => { if (modo === 'cleanup-lento') clock += 100000; close++; ordem.push('encerrar'); return { ok: true,
        processoController: { nome: 'controller' }, processoRuntime: { nome: 'runtime' } }; },
      processoTerminou: (p: any) => { ordem.push(p?.nome); return modo !== p?.nome + '-vivo'; },
    },
    'codex-runner': { estadoProcesso: (p: any) => {
      assert.equal(p.pid, identidade.pid); assert.equal(p.inicio, identidade.inicio); assert.equal(p.boot, identidade.boot);
      ordem.push('watcher'); return ['watcher-vivo', 'timeout'].includes(modo) ? 'vivo' : modo === 'incerto' ? 'desconhecido' : 'ausente';
    } },
  };
  const fakeRequire = (id: string) => {
    if (id === 'node:fs') return fs;
    if (id === 'node:path') return path;
    if (id === 'node:crypto') return { randomUUID: () => uuid, createHash };
    if (id === 'node:child_process') return { spawnSync: (_bin: string, args: string[], options: any) => {
      assert.ok(options.timeout > 0 && Number.isFinite(options.timeout));
      if (modo === 'auth-lento' && args[0] === 'login') clock += 70000;
      return { status: 0, stdout: args[0] === 'login' ? 'Logged in using ChatGPT' : 'synthetic', stderr: '' }; } };
    if (id === './smoke-runtime.cjs') return {
      prepararRuntime: async () => { if (modo === 'setup-lento') clock += 70000;
        return { env: fakeProcess.env, prova: { raiz: path.join(root, 'runtime') }, fechar: async () => { keeper++; } }; },
      arquivosRuntime: () => [{ path: 'codex/sessions/' + sid + '.jsonl', bytes: 100 }],
    };
    const dep = deps[path.basename(id)]; if (dep) return dep;
    throw new Error('dependencia nao permitida: ' + id);
  };
  class FakeDate extends Date { static override now() { return clock; } }
  const mod = { exports: {} as any };
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), { require: fakeRequire, module: mod, __dirname: path.dirname(script),
    process: fakeProcess, Date: FakeDate, console, performance: { now: () => clock },
    setTimeout: (fn: () => void, ms: number) => { clock += ms; queueMicrotask(fn); return 0; } }, { filename: script });
  try {
    try { report = await mod.exports.executar('codex'); } catch (e) { erro = e; }
    return { report, erro, cleanup, close, keeper, ordem, preservada: fs.existsSync(root) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('TC6: harness inteiro so limpa depois de tres identidades terminais', async () => {
  const r = await executarHarnessSimulado('sucesso');
  assert.equal(r.erro, undefined); assert.equal(r.report.ok, true);
  assert.equal(r.cleanup, 1); assert.equal(r.close, 1); assert.equal(r.keeper, 1);
  for (const prova of ['encerrar', 'controller', 'runtime', 'watcher'])
    assert.ok(r.ordem.indexOf(prova) >= 0 && r.ordem.indexOf(prova) < r.ordem.indexOf('limpar'));
});

test('TC6: processos vivos, identidade incerta e timeout preservam prova', async () => {
  for (const modo of ['watcher-vivo', 'controller-vivo', 'runtime-vivo', 'identidade-ausente', 'incerto', 'timeout']) {
    const r = await executarHarnessSimulado(modo);
    assert.equal(r.cleanup, 0, modo); assert.equal(r.preservada, true, modo);
    assert.equal(r.close, 1, modo); assert.equal(r.keeper, 1, modo);
    const resultado = r.report ?? r.erro;
    assert.equal(resultado.limpeza.preservado, true, modo);
    assert.equal(resultado.encerramento.ok, false, modo);
  }
});

test('TC6: bootstrap falho conserva referencia e tenta encerrar antes de devolver erro', async () => {
  const r = await executarHarnessSimulado('bootstrap-falhou');
  assert.ok(r.erro); assert.equal(r.report, undefined); assert.equal(r.close, 1);
  assert.equal(r.cleanup, 0); assert.equal(r.preservada, true);
  assert.ok(r.erro.encerramento.captura.controlador);
});


test('TC7: fonte unica exige fixacao, registro, turno e close coerentes', async () => {
  for (const modo of ['rollout-alternativo', 'sem-fixacao', 'sem-registro', 'turno-divergente', 'sem-close']) {
    const r = await executarHarnessSimulado(modo);
    assert.notEqual(r.report?.ok, true, modo);
    assert.ok(r.erro || r.report?.gatilho.rolloutConfirmado === false, modo);
  }
});

test('TC7: orcamento unico cobre setup, auth, despacho, espera e cleanup', async () => {
  for (const modo of ['setup-lento', 'auth-lento', 'despacho-lento', 'timeout', 'cleanup-lento']) {
    const r = await executarHarnessSimulado(modo);
    assert.notEqual(r.report?.ok, true, modo);
    const orcamento = (r.report ?? r.erro).orcamento;
    assert.equal(orcamento.limiteMs, 90000, modo);
    assert.ok(orcamento.duracaoMs >= 65000, modo);
    assert.deepEqual(Array.from(orcamento.inclui), ['setup', 'auth', 'despacho', 'observacao', 'cleanup']);
    if (modo === 'cleanup-lento') assert.equal(r.preservada, true);
  }
  const bom = await executarHarnessSimulado('sucesso');
  assert.equal(bom.report.orcamento.excedido, false);
});
