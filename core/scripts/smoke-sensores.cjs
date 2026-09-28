'use strict';
// T9: execução explícita dos runtimes em sandbox. Importar não dispara sessão.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const core = path.resolve(__dirname, '..'), dist = path.join(core, 'dist');
const LIMITE_MS = 90000;
function ambiente(base = process.env) {
  const env = { ...base };
  for (const k of Object.keys(env)) if (/^(ANTHROPIC_|OPENAI_|AZURE_OPENAI_|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY))/.test(k)) delete env[k];
  delete env.CLAUDECODE;
  return env;
}
function avaliarClaude(prova, evento) {
  const hook = Date.parse(prova.hookEm), recebido = Date.parse(evento?.recebidoEm), prompt = Date.parse(prova.promptEm);
  return prova.promptReal === true && prova.toolName === 'Bash' && prova.hookEvent === 'PermissionRequest' &&
    evento?.tipo === 'sessao_bloqueada' && evento.sensor === 'permission_request' && evento.sessionId === prova.sessionId &&
    Number.isFinite(hook) && Number.isFinite(prompt) && Number.isFinite(recebido) &&
    recebido >= hook && recebido - hook < 5000 && Math.abs(prompt - hook) < 5000 && prova.ferramentaExecutada === false;
}
function avaliarCodex(resultado, arquivo, marcador, gatilho) {
  // A origem válida deste transporte é o close real do controller, nunca um recibo de supervisor.
  return resultado?.classificacao === 'fase_concluida' && resultado.ok === true && resultado.exitCode === 0 &&
    resultado.exitCodeFonte === 'controller.close' && resultado.tokens?.disponivel === true &&
    resultado.tokens.input > 0 && resultado.tokens.output > 0 && arquivo === marcador &&
    gatilho?.registroAutomatico === true && gatilho.watcherAutomatico === true &&
    gatilho.observacaoManual === false && gatilho.rolloutConfirmado === true;
}
const PYTHON = String.raw`
import pexpect, json, sys, time, re, os, datetime
c=json.loads(sys.argv[1]); texto=''; promptEm=None; trust=False
def agora(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
p=pexpect.spawn('claude',c['args'],cwd=c['cwd'],encoding='utf-8',timeout=1,dimensions=(42,160),env=os.environ.copy())
inicio=time.monotonic()
try:
  while time.monotonic()-inicio < 75:
    try: texto += p.read_nonblocking(8192,timeout=0.2)
    except pexpect.TIMEOUT: pass
    except pexpect.EOF: break
    texto=texto[-65536:]
    limpo=re.sub(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))','',texto)
    if not trust and 'Yes, I trust this folder' in limpo:
      p.send('y\r'); trust=True; continue
    if os.path.exists(c['marker']) and re.search(r'Do you want to proceed|Allow this|Allow Claude|Yes, allow|Permission Required: Bash|Run this command',limpo,re.I):
      promptEm=agora(); break
finally:
  p.sendcontrol('c'); time.sleep(0.2); p.sendcontrol('c'); time.sleep(0.2)
  p.terminate(force=True); p.close()
marker=json.load(open(c['marker'])) if os.path.exists(c['marker']) else {}
print(json.dumps(dict(marker,promptReal=promptEm is not None,promptEm=promptEm,trustAccepted=trust,
  terminal=limpo[-12000:] if 'limpo' in locals() else '',exitCode=p.exitstatus,signal=p.signalstatus)))
`;

async function executar(runtime) {
  if (!['claude', 'codex'].includes(runtime)) throw new Error('use --runtime claude|codex');
  if (process.getuid?.() === 0) throw new Error('root exige escalação tipada; execute como usuário');
  const inicioTotal = performance.now(), deadline = inicioTotal + LIMITE_MS;
  const RESERVA_LIMPEZA_MS = 25000;
  const restante = () => Math.max(0, deadline - performance.now());
  const prazo = (maximo, reserva = RESERVA_LIMPEZA_MS) => {
    const disponivel = Math.floor(restante() - reserva);
    if (disponivel <= 0) throw new Error('runtime.unavailable: orcamento total esgotado');
    return Math.min(maximo, disponivel);
  };
  const { sandboxGit } = require(path.join(dist, 'sandbox'));
  const { novaThread, gravarThread, dirThread } = require(path.join(dist, 'thread'));
  const { lerLedger } = require(path.join(dist, 'ledger'));
  const { exigirManifesto } = require(path.join(dist, 'manifest'));
  const { prepararRuntime, arquivosRuntime } = require('./smoke-runtime.cjs');
  const configurado = exigirManifesto(process.cwd());
  const sandbox = configurado.manifesto.runtime.sandbox;
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(sandbox)) throw new Error('Sandbox configurado inválido');
  const s = sandboxGit('smoke-sensores-' + runtime), start = new Date().toISOString();
  s.carregado.manifesto.runtime.sandbox = sandbox;
  const t = novaThread(s.carregado, { nome: 'smoke', modo: 'auto' }).thread;
  const dir = dirThread(s.dir, t.id);
  const registrarSessao = sid => {
    t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: runtime === 'claude' ? 'claude-bg' : 'codex',
      despachadaEm: start, promptPath: '', promptSha256: '', verificada: true }); gravarThread(s.dir, t);
  };
  let controlador = null, isolado = null, report = null, watcherPid = null;
  let despachoTentado = false, captura = null, erroOriginal = null;
  const anterior = process.env;
  try {
    prazo(5000);
    isolado = await prepararRuntime(runtime, path.join(s.dir, '.runtime'));
    const env = isolado.env;
    process.env = env;
    const versao = cp.spawnSync(runtime, ['--version'], { cwd: s.dir, env, encoding: 'utf8', timeout: prazo(10000) });
    if (versao.status !== 0) throw new Error(runtime + ' indisponível');
    if (runtime === 'claude') {
      const auth = cp.spawnSync('claude', ['auth', 'status', '--json'], { cwd: s.dir, env, encoding: 'utf8', timeout: prazo(10000) });
      const authInfo = auth.status === 0 ? JSON.parse(auth.stdout) : {};
      if (!authInfo.loggedIn || authInfo.authMethod !== 'oauth_token' || authInfo.apiKeySource) throw new Error('Claude sem OAuth de assinatura; nenhum fallback pago');
      const sid = randomUUID(); registrarSessao(sid);
      const marker = path.join(s.dir, 'hook-marker.json'), wrapper = path.join(s.dir, 'observe-hook.cjs');
      const sensor = path.resolve(core, '../adapters/claude-code/hooks/ork-sensor.js');
      fs.writeFileSync(wrapper, `const fs=require('fs'),cp=require('child_process');const input=fs.readFileSync(0,'utf8'),h=JSON.parse(input);fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({hookEm:new Date().toISOString(),hookEvent:h.hook_event_name,toolName:h.tool_name,sessionId:h.session_id}));const r=cp.spawnSync(process.execPath,[${JSON.stringify(sensor)}],{input,encoding:'utf8',env:process.env});if(r.stderr)process.stderr.write(r.stderr);process.exitCode=r.status??1;`);
      const settings = path.join(s.dir, 'smoke-settings.json');
      fs.writeFileSync(settings, JSON.stringify({ permissions: { defaultMode: 'default', ask: ['Bash'] },
        hooks: { PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node ' + wrapper, timeout: 5 }] }] } }));
      const args = ['--session-id', sid, '--setting-sources', '', '--settings', settings, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--tools', 'Bash', '--permission-mode', 'default', '--model', 'opus', '--effort', 'low', '--disable-slash-commands', '--no-chrome', '--ax-screen-reader',
        'Teste isolado: use a ferramenta Bash exatamente uma vez para executar printf ORK_SMOKE > permission-proof.txt. Não leia nada fora deste diretório e não use serviços externos.'];
      const r = cp.spawnSync('python3', ['-c', PYTHON, JSON.stringify({ args, cwd: s.dir, marker })], {
        env: { ...env, ORK_SENSOR_CLI: path.join(dist, 'index.js') }, encoding: 'utf8', timeout: prazo(LIMITE_MS), maxBuffer: 1024 * 1024 });
      if (r.status !== 0) throw new Error('PTY Claude indisponível: ' + (r.error?.code || r.stderr.slice(-500)));
      const prova = JSON.parse(r.stdout); prova.ferramentaExecutada = fs.existsSync(path.join(s.dir, 'permission-proof.txt'));
      const evento = lerLedger(dir).find(e => e.tipo === 'sessao_bloqueada');
      return report = { runtime, versao: versao.stdout.trim(), tipoProva: 'runtime-real', start, end: new Date().toISOString(),
        authMethod: authInfo.authMethod, isolamento: isolado.prova,
        argv: ['claude', ...args], cwd: s.dir, prova, evento: evento ?? null, ok: avaliarClaude(prova, evento),
        latenciaIngestaoMs: evento && prova.hookEm ? Date.parse(evento.recebidoEm) - Date.parse(prova.hookEm) : null };
    }
    const { registrarFonteController, lerSnapshotController } = require(path.join(dist, 'adapters/codex-controller-sensor'));
    const { rodarFase } = require(path.join(dist, 'phase'));
    const auth = cp.spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: prazo(10000) });
    if (auth.status !== 0 || !/Logged in using ChatGPT/.test(auth.stdout + auth.stderr)) throw new Error('Codex sem autenticação ChatGPT; nenhum fallback pago');
    const marcador = 'ORK_SMOKE_' + randomUUID();
    const pedido = 'Teste isolado. Execute com ferramenta de shell: printf ' + marcador + ' > codex-proof.txt . Depois responda apenas Concluído. Não leia arquivos fora deste diretório, não use serviços externos.';
    t.faseAtual = 'GO'; gravarThread(s.dir, t);
    // Gatilho governado: a própria fase registra a fonte e inicia o observador. Nada manual aqui.
    // Controller tem bootstrap de 30s e prontidao de 5s; reservar mais 5s para o despacho local.
    if (restante() < 40000 + RESERVA_LIMPEZA_MS) throw new Error('runtime.unavailable: orcamento insuficiente para despacho e cleanup');
    despachoTentado = true;
    const despacho = rodarFase(s.carregado, t.id, { fase: 'GO', runtime: 'codex', model: 'gpt-6-astra', prompt: pedido });
    // Capturar referencias mesmo no bootstrap falho, ANTES de qualquer throw.
    controlador = despacho.controlador ?? null;
    const doDespachoInicial = lerLedger(dir).filter(e => e.sessionId === despacho.sessionId);
    const fonteInicial = doDespachoInicial.find(e => e.tipo === 'session_sensor_registered');
    const watcherInicial = doDespachoInicial.find(e => e.tipo === 'session_watcher_started');
    controlador = fonteInicial?.controlador ?? doDespachoInicial.find(e => e.tipo === 'phase_dispatch')?.controlador ?? controlador;
    if (controlador) {
      const launch = JSON.parse(fs.readFileSync(path.join(controlador, 'launch.json'), 'utf8'));
      captura = { controlador, instancia: launch.instancia, vinculo: launch.vinculo,
        watcher: watcherInicial?.identidade ?? null, watcherPid: watcherInicial?.pid ?? null };
    }
    if (!despacho.sessionId) throw new Error(despacho.erro || despacho.motivo || 'Codex não iniciou');
    const doDespacho = (tipo) => lerLedger(dir).find(e => e.tipo === tipo && e.sessionId === despacho.sessionId);
    const registro = doDespacho('session_sensor_registered'), arranque = doDespacho('session_watcher_started');
    controlador = registro?.controlador ?? despacho.controlador ?? controlador;
    watcherPid = arranque?.pid ?? null;
    if (!registro || !arranque) throw new Error('runtime.unavailable: registro ou arranque automático ausente');
    const fim = deadline - RESERVA_LIMPEZA_MS;
    while (!doDespacho('phase_result') && performance.now() < fim) await new Promise(r => setTimeout(r, 200));
    const resultado = doDespacho('phase_result');
    if (!resultado) throw new Error('runtime.unavailable: observação automática excedeu orcamento total de ' + LIMITE_MS + ' ms');
    // thread.started pode preceder a criação do rollout. A prova é refeita no término.
    prazo(1);
    if (!registro?.controlador || !registro.despachoEm || !captura) throw new Error('runtime.unavailable: registro validado ausente');
    const chave = createHash('sha256').update(despacho.sessionId + '|' + registro.despachoEm).digest('hex');
    const fixacao = path.join(dir, 'sessoes', `watcher-source-${chave}.json`);
    if (!fs.existsSync(fixacao)) throw new Error('runtime.unavailable: fonte persistida ausente');
    const fonte = registrarFonteController(registro.controlador, { dirSessoes: path.join(dir, 'sessoes'),
      sessionId: despacho.sessionId, cwd: s.dir, despachoEm: registro.despachoEm, vinculo: captura.vinculo, fixacao });
    const snapshot = lerSnapshotController(fonte);
    const rolloutFinal = snapshot.rollout;
    if (rolloutFinal !== fonte.rollout || snapshot.fonte.rollout !== fonte.rollout)
      throw new Error('runtime.unavailable: rollout divergente da fonte fixada');
    const file = path.join(s.dir, 'codex-proof.txt'), arquivo = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const rolloutIsolado = rolloutFinal !== null && path.relative(env.CODEX_HOME, rolloutFinal).startsWith('sessions' + path.sep);
    if (!rolloutIsolado) throw new Error('runtime.unavailable: rollout fora da tentativa');
    const fd = fs.openSync(rolloutFinal, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let eventosRollout;
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.ino !== fonte.rolloutIno || st.dev !== fonte.rolloutDev || st.size > 64 * 1024 * 1024)
        throw new Error('runtime.unavailable: descritor divergente ou rollout excessivo');
      eventosRollout = fs.readFileSync(fd, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    } finally { fs.closeSync(fd); }
    const meta = eventosRollout.find(e => e.type === 'session_meta')?.payload;
    const correlacionado = meta?.id === despacho.sessionId && meta.cwd === s.dir &&
      typeof resultado.turnId === 'string' && resultado.turnId.length > 0 && snapshot.turno === resultado.turnId &&
      snapshot.terminalNativo?.turnId === resultado.turnId && snapshot.terminalNativo?.threadId === despacho.sessionId &&
      snapshot.terminalNativo?.status === 'completed' && snapshot.fechamento?.exitCode === 0;
    const contextos = eventosRollout.filter(e => e.type === 'turn_context');
    const politicasNativas = contextos.map(e => ({ sandbox: e.payload?.sandbox_policy, approval: e.payload?.approval_policy }));
    const sandboxConfirmado = politicasNativas.length > 0 && politicasNativas.every(p => p.sandbox?.type === sandbox);
    const gatilho = {
      registroAutomatico: !!registro && typeof registro.controlador === 'string' && registro.logPath === undefined,
      watcherAutomatico: Number.isSafeInteger(watcherPid) && watcherPid > 0,
      observacaoManual: false, rolloutConfirmado: rolloutIsolado && correlacionado,
      controlador, watcherPid, fixacao, registroEm: registro?.ts ?? null, arranqueEm: arranque?.ts ?? null,
    };
    return report = { runtime, versao: versao.stdout.trim(), tipoProva: 'runtime-real', start, end: new Date().toISOString(),
      sandboxConfigurado: sandbox, politicasNativas, sandboxConfirmado, isolamento: isolado.prova, rolloutIsolado,
      argv: despacho.comando, cwd: s.dir, sessionId: despacho.sessionId, rolloutVerificadoNoInicio: despacho.verificada,
      rolloutVerificado: rolloutFinal !== null, rolloutPath: rolloutFinal, gatilho, resultado,
      provaComando: arquivo === marcador,
      ok: rolloutIsolado && sandboxConfirmado && avaliarCodex(resultado, arquivo, marcador, gatilho) };
  } catch (error) {
    erroOriginal = error;
    error.isolamento = isolado?.prova;
    throw error;
  } finally {
    try {
      const { encerrarController, processoTerminou } = require(path.join(dist, 'adapters/codex-controller'));
      const { estadoProcesso } = require(path.join(dist, 'adapters/codex-runner'));
      const encerramento = { controlador, ok: !despachoTentado, captura, controllerTerminal: false,
        runtimeTerminal: false, observadorEncerrado: false, motivo: null };
      if (controlador && captura) {
        try {
          const encerrado = encerrarController(controlador, captura.vinculo, captura.instancia, prazo(15000, 5000));
          encerramento.evidencia = encerrado;
          encerramento.controllerTerminal = encerrado.ok === true && processoTerminou(encerrado.processoController);
          encerramento.runtimeTerminal = encerrado.ok === true && (processoTerminou(encerrado.processoRuntime) ||
            encerrado.runtimeNaoIniciado === true);
          // Identidade capturada pelo arranque TC5; PID + signal 0 nao prova termino.
          const watcher = captura.watcher;
          if (watcher && watcher.pid === captura.watcherPid) {
            for (let n = 0; n < 100 && restante() > 5000; n++) {
              if (estadoProcesso(watcher) === 'ausente') { encerramento.observadorEncerrado = true; break; }
              await new Promise(r => setTimeout(r, 100));
            }
          }
          encerramento.ok = encerramento.controllerTerminal && encerramento.runtimeTerminal &&
            encerramento.observadorEncerrado && report !== null;
        } catch { encerramento.motivo = 'encerramento nao comprovado'; }
      }
      if (despachoTentado && !encerramento.ok) {
        encerramento.motivo ??= 'runtime.unavailable: identidades terminais ou relatorio ausentes';
      }
      if (report) { report.encerramento = encerramento;
        report.observadorEncerrado = encerramento.observadorEncerrado;
        report.ok = report.ok && encerramento.ok; }
      if (erroOriginal) erroOriginal.encerramento = encerramento;
      if (isolado) isolado.prova.arquivos = arquivosRuntime(isolado.prova.raiz);
      if (report) {
        const sid = report.sessionId || report.prova.sessionId;
        report.isolamento.sessaoNativaIsolada = isolado.prova.arquivos.some(f => f.path.endsWith(sid + '.jsonl'));
        report.ok = report.ok && report.isolamento.sessaoNativaIsolada;
      }
      // Falha sem report conserva a evidencia mesmo se os processos ja terminaram.
      if (restante() <= 5000) { encerramento.ok = false; encerramento.motivo = 'runtime.unavailable: orcamento total esgotado no cleanup'; if (report) report.ok = false; }
      if (encerramento.ok) s.limpar();
      const limpeza = { alvoCriado: s.dir, removido: !fs.existsSync(s.dir),
        preservado: !encerramento.ok, motivo: encerramento.motivo };
      if (isolado) isolado.prova.limpeza = limpeza;
      if (report) report.limpeza = limpeza;
      if (erroOriginal) erroOriginal.limpeza = limpeza;
    } finally {
      try { await isolado?.fechar(); } finally {
        process.env = anterior;
        const orcamento = { limiteMs: LIMITE_MS, duracaoMs: performance.now() - inicioTotal,
          excedido: performance.now() > deadline, inclui: ['setup', 'auth', 'despacho', 'observacao', 'cleanup'] };
        if (report) { report.orcamento = orcamento; report.ok = report.ok && !orcamento.excedido; }
        if (erroOriginal) erroOriginal.orcamento = orcamento;
      }
    }
  }
}
module.exports = { ambiente, avaliarClaude, avaliarCodex, executar };
if (require.main === module) {
  const args = process.argv.slice(2), runtime = args[args.indexOf('--runtime') + 1];
  executar(runtime).then(r => { console.log(JSON.stringify(r, null, 2)); process.exitCode = r.ok ? 0 : 1; })
    .catch(e => { console.log(JSON.stringify({ runtime, ok: false, tipoProva: 'runtime-real', estado: 'unavailable', erro: e.message, isolamento: e.isolamento, encerramento: e.encerramento, limpeza: e.limpeza, orcamento: e.orcamento })); process.exitCode = 1; });
}
