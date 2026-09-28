/** Dono exclusivo do stdin app-server. IPC local autenticado pelo uid/diretório 0700. */
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { projetarPergunta } from './codex-question';
import { validarContextoRuntime } from '../runtime-context';
import { conferirDiretorio, EstadoController, BootstrapController, erroNativoDoTurno, identidadeDoProcesso } from './codex-controller';
import type { DespachoCodexPedido } from './codex';
import type { ConfirmacaoSessao, EntregaSessao, IdentidadeSessao } from '../hitl-sessions';

function gravar(nome: string, valor: unknown): void {
  const tmp = `${nome}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(valor), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, nome);
}
async function cliente(): Promise<void> {
  conferirDiretorio(process.cwd());
  const entrada = fs.readFileSync(0, 'utf8');
  const socket = net.createConnection('control.sock');
  socket.setTimeout(11000, () => socket.destroy(new Error('timeout')));
  socket.once('connect', () => socket.end(entrada + '\n'));
  socket.on('data', b => process.stdout.write(b));
  socket.on('error', () => { process.exitCode = 1; });
}
async function servidor(): Promise<void> {
  conferirDiretorio(process.cwd());
  const bootstrap: BootstrapController = JSON.parse(fs.readFileSync(0, 'utf8'));
  const pedido: DespachoCodexPedido = bootstrap.pedido;
  const state: EstadoController = { instancia: bootstrap.instancia, processoController: identidadeDoProcesso(process.pid), vinculo: pedido.vinculo!, cwd: pedido.cwd,
    sessionId: '', pid: process.pid, estado: 'starting' };
  const salvar = () => gravar('state.json', state);
  salvar();
  const child = spawn('codex', ['app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"'],
    { cwd: pedido.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  state.runtimePid = child.pid;
  // PID vem do ChildProcess criado aqui; starttime evita confundir reutilização de PID.
  if (child.pid && process.platform === 'linux') {
    try { state.processoRuntime = identidadeDoProcesso(child.pid); state.runtimeInicio = state.processoRuntime.inicio; } catch { /* falha de spawn será registrada pelo evento close */ }
  }
  salvar();
  child.stdin.on('error', () => {});
  child.stderr.resume(); // nunca persistir stderr potencialmente sensível
  let seq = 0, vivo = true, pergunta: any = null, intencao: Omit<EntregaSessao, 'resposta'> | null = null;
  const chamadas = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const send = (v: unknown) => { if (!vivo) throw new Error('runtime encerrado'); child.stdin.write(JSON.stringify(v) + '\n'); };
  const rpc = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    const id = ++seq, timeout = setTimeout(() => { chamadas.delete(id); reject(new Error('runtime.unavailable: timeout nativo')); }, 8000);
    chamadas.set(id, { resolve: v => { clearTimeout(timeout); resolve(v); }, reject: e => { clearTimeout(timeout); reject(e); } });
    send({ id, method, params });
  });
  const aguardar = async (condicao: () => boolean) => {
    const fim = Date.now() + 8000;
    while (!condicao() && vivo && Date.now() < fim) await new Promise(r => setTimeout(r, 20));
    if (!condicao()) throw new Error('runtime.unavailable: confirmação nativa ausente');
  };
  let encerrando = false;
  const encerrar = async (motivo: string) => {
    if (encerrando || !vivo) return; encerrando = true;
    state.encerramentoSolicitado = motivo; state.estado = 'unavailable'; salvar();
    try { if (state.sessionId && state.turno && !state.terminal) await rpc('turn/interrupt', { threadId: state.sessionId, turnId: state.turno }); }
    catch { /* EOF próprio abaixo; sem confirmação nativa não inventar terminal */ }
    finally { child.stdin.end(); }
  };
  const inicio = performance.now();
  const vigia = setInterval(() => {
    let stop: any; try { stop = JSON.parse(fs.readFileSync('stop-request.json', 'utf8')); } catch { /* não solicitado */ }
    if (stop?.instancia === state.instancia) void encerrar('dispatch.cancelled');
    else if (!state.pronto && Date.now() >= Date.parse(bootstrap.prazoInicial)) void encerrar('dispatch.timeout');
    else if (performance.now() - inicio >= bootstrap.duracaoMaximaMs) void encerrar('turn.timeout');
  }, 50);
  const recusarPedido = (codigo: string, method: string) => {
    state.estado = 'unavailable'; state.limitacao = { motivo: 'runtime.unavailable', codigo, metodo: method };
    delete state.perguntaNativa; delete state.bloqueio; pergunta = null; salvar();
    // Interrupção da MESMA thread/turno, sem responder/aprovar a ferramenta nativa.
    void rpc('turn/interrupt', { threadId: state.sessionId, turnId: state.turno }).catch(() => {
      state.erro = 'runtime.unavailable: interrupção de capacidade não suportada não confirmada'; salvar(); child.stdin.end();
    });
  };
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let v: any; try { v = JSON.parse(line); } catch { return; }
    if (!v.method && chamadas.has(v.id)) {
      const p = chamadas.get(v.id)!; chamadas.delete(v.id);
      v.error ? p.reject(new Error('runtime.unavailable: RPC nativo recusado')) : p.resolve(v.result); return;
    }
    const p = v.params;
    if (p?.threadId !== state.sessionId || v.method === 'item/tool/requestUserInput' && p.turnId !== state.turno) {
      if (v.id !== undefined && v.method) recusarPedido('request.uncorrelated', 'request/unsupported');
      return;
    }
    if (v.method === 'turn/started') { state.turno = p.turn.id; state.estado = 'working'; }
    if (v.method === 'item/tool/requestUserInput' && p.turnId === state.turno) {
      try {
        state.perguntaNativa = projetarPergunta(p);
        pergunta = v; state.estado = 'blocked'; state.bloqueio = JSON.stringify([p.turnId, v.id, p.itemId, state.perguntaNativa.sha256]);
      } catch (e) { recusarPedido((e as Error).message.replace('runtime.unavailable: ', ''), v.method); }
    }
    if (v.id !== undefined && v.method !== 'item/tool/requestUserInput') recusarPedido('request.unsupported', v.method);
    if (v.method === 'serverRequest/resolved' && pergunta && p.requestId === pergunta.id) {
      if (intencao) {
        const ack: ConfirmacaoSessao = { ...intencao, estado: 'recebida' };
        gravar(`receipt-${intencao.envioId}.json`, ack);
        gravar(`native-${intencao.envioId}.json`, { metodo: v.method, requestId: p.requestId, threadId: p.threadId, turnId: state.turno, itemId: pergunta.params.itemId });
      }
      pergunta = null; intencao = null; state.estado = 'working'; delete state.bloqueio; delete state.perguntaNativa;
    }
    if (v.method === 'turn/completed' && p.turn.id === state.turno) {
      // I-33 (D12): o erro nativo do turno (so presente em `failed`) vai ao estado, limitado e sem
      // controle, para o observador classificar cota ou login perdido pelo proprio runtime.
      const erro = erroNativoDoTurno(p.turn.error);
      state.terminal = { metodo: 'turn/completed', threadId: p.threadId, turnId: p.turn.id, status: p.turn.status,
        ...(erro ? { erro } : {}) };
      state.estado = state.limitacao ? 'unavailable' : p.turn.status === 'interrupted' ? 'stopped' : p.turn.status === 'completed' ? 'completed' : 'failed';
      delete state.bloqueio; delete state.perguntaNativa; pergunta = null;
      setTimeout(() => child.stdin.end(), 250).unref();
    }
    salvar();
  });
  let ocupado = false;
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    let texto = '';
    socket.setTimeout(11000, () => socket.destroy());
    socket.on('data', b => { texto += b; if (texto.length > 24000) socket.destroy(); });
    socket.on('end', async () => {
      if (ocupado) { socket.end(JSON.stringify({ ok: false, erro: 'runtime.unavailable: controller ocupado' })); return; }
      ocupado = true;
      try {
        const r = JSON.parse(texto);
        if (r.instancia !== state.instancia) throw new Error('runtime.unavailable: instância divergente');
        let resultado: unknown;
        if (r.operacao === 'consultar') {
          const lido = await rpc('thread/read', { threadId: state.sessionId, includeTurns: false });
          if (lido.thread.id !== state.sessionId || lido.thread.cwd !== state.cwd || lido.thread.path !== state.rollout) throw new Error('runtime.unavailable: identidade nativa divergente');
          resultado = state;
        } else if (r.operacao === 'enviar') {
          const e = r.dados as EntregaSessao;
          const identidade = e.sessao;
          if (e.contrato !== 'ork.session-answer/v1' || e.thread !== state.vinculo.thread || e.fase !== state.vinculo.fase ||
            identidade.sessionId !== state.sessionId || identidade.runtime !== 'codex' || identidade.cwd !== state.cwd ||
            identidade.instancia !== state.instancia || identidade.bloqueio !== state.bloqueio || !pergunta ||
            pergunta.params.turnId !== state.turno || pergunta.params.questions.length !== 1 ||
            !/^[a-f0-9-]{36}$/.test(e.envioId) || typeof e.resposta !== 'string' || e.resposta.length > 4096) throw new Error('runtime.unavailable: entrega não corresponde ao prompt nativo');
          const arquivo = `intent-${e.envioId}.json`;
          if (intencao || fs.existsSync(arquivo)) throw new Error('runtime.unavailable: envio já iniciado; somente consultar recibo');
          const { resposta, ...semTexto } = e; intencao = semTexto;
          gravar(arquivo, intencao); // antes de qualquer escrita no transporte
          const q = pergunta.params.questions[0];
          send({ id: pergunta.id, result: { answers: { [q.id]: { answers: [resposta] } } } });
          await aguardar(() => fs.existsSync(`receipt-${e.envioId}.json`)); resultado = true;
        } else if (r.operacao === 'parar') {
          const s = r.dados as IdentidadeSessao;
          if (!pergunta || state.estado !== 'blocked' || s.sessionId !== state.sessionId || s.instancia !== state.instancia ||
            s.cwd !== state.cwd || s.bloqueio !== state.bloqueio) throw new Error('runtime.unavailable: sessão não está bloqueada nesta instância');
          await rpc('turn/interrupt', { threadId: state.sessionId, turnId: state.turno });
          await aguardar(() => state.estado === 'stopped'); resultado = true;
        } else throw new Error('runtime.unavailable: operação desconhecida');
        socket.end(JSON.stringify({ ok: true, resultado }));
      } catch (e) { socket.end(JSON.stringify({ ok: false, erro: (e as Error).message })); }
      finally { ocupado = false; }
    });
    socket.on('error', () => {});
  });
  child.on('close', (code, signal) => { vivo = false; clearInterval(vigia);
    for (const p of chamadas.values()) p.reject(new Error('runtime.unavailable: processo encerrado')); chamadas.clear();
    state.processoEncerrado = { em: new Date().toISOString(), code, signal };  if (!state.terminal) { state.estado = 'unavailable'; state.erro ??= 'runtime.unavailable: processo encerrou sem confirmação'; }
    salvar(); server.close(); });
  child.on('error', () => { if (child.pid === undefined) state.runtimeNaoIniciado = true; state.erro = 'runtime.unavailable: falha ao iniciar app-server'; salvar(); server.close(); });
  try {
    if (pedido.contextoRuntime && (pedido.contextoRuntime.host !== 'codex' || pedido.contextoRuntime.threadId !== pedido.vinculo?.thread))
      throw new Error('runtime.context.scope: contexto difere do vinculo do worker');
    const contexto = pedido.contextoRuntime ? validarContextoRuntime(pedido.contextoRuntime, pedido.cwd) : undefined;
    await rpc('initialize', { clientInfo: { name: 'ork_controller', version: '1' }, capabilities: { experimentalApi: true } });
    // O launcher pode passar por env/node via exec mantendo o mesmo processo.
    // Só fixar o executável após a resposta do app-server, sem aceitar outro PID/origem.
    const inicial = state.processoRuntime;
    const pronto = child.pid ? identidadeDoProcesso(child.pid) : undefined;
    if (!inicial || !pronto || ['pid', 'uid', 'inicio', 'bootId', 'cwd'].some(
      chave => inicial[chave as keyof typeof inicial] !== pronto[chave as keyof typeof pronto]))
      throw new Error('runtime.unavailable: identidade do runtime mudou durante initialize');
    state.processoRuntime = pronto; salvar();
    send({ method: 'initialized' });
    const auth = await rpc('account/read', { refreshToken: false });
    if (auth.account?.type !== 'chatgpt') throw new Error('runtime.unavailable: assinatura ChatGPT não comprovada; API paga recusada');
    if (contexto) {
      await rpc('skills/extraRoots/set', { extraRoots: [contexto.instalacao] });
      const lista = await rpc('skills/list', { cwds: [pedido.cwd], forceReload: true });
      const entradas = Array.isArray(lista?.data) ? lista.data.filter((e: any) => e.cwd === pedido.cwd) : [];
      if (entradas.length !== 1 || !Array.isArray(entradas[0].skills) || !Array.isArray(entradas[0].errors) || entradas[0].errors.length ||
          !entradas[0].skills.some((skill: any) => skill.name === 'orkastery-bootstrap' && skill.path === contexto.bootstrap && skill.enabled === true))
        throw new Error('runtime.context.discovery: bootstrap instalado nao confirmado no cwd da fase');
    }
    const t = await rpc('thread/start', { cwd: pedido.cwd, model: pedido.model, modelProvider: 'openai',
      sandbox: pedido.sandbox ?? 'workspace-write', approvalPolicy: 'never',
      config: { ...(pedido.effort ? { model_reasoning_effort: pedido.effort } : {}),
        ...(contexto ? { mcp_servers: { orkastery: contexto.servidor } } : {}) } });
    if (t.thread.cwd !== pedido.cwd || !t.thread.path || !/^[a-f0-9-]{36}$/.test(t.thread.id)) throw new Error('runtime.unavailable: despacho sem identidade');
    state.sessionId = t.thread.id; state.rollout = t.thread.path;
    const observado = await rpc('thread/read', { threadId: state.sessionId, includeTurns: false });
    if (observado.thread.id !== state.sessionId || observado.thread.cwd !== state.cwd || observado.thread.path !== state.rollout) throw new Error('runtime.unavailable: despacho não confirmado');
    if (contexto) {
      const status = await rpc('mcpServerStatus/list', { threadId: state.sessionId, limit: 100, detail: 'toolsAndAuthOnly' });
      const mcp = Array.isArray(status?.data) ? status.data.filter((s: any) => s.name === 'orkastery') : [];
      const nomes = mcp.length === 1 && mcp[0].tools && typeof mcp[0].tools === 'object'
        ? Object.values(mcp[0].tools).map((tool: any) => tool?.name) : [];
      if (!['ork_thread_status', 'ork_observe'].every(nome => nomes.includes(nome)))
        throw new Error('runtime.context.discovery: ferramentas MCP do projeto nao confirmadas');
      gravar('runtime-context.json', { projeto: contexto.projeto, instalacao: contexto.instalacao,
        bootstrap: contexto.bootstrap, cwd: pedido.cwd, sessionId: state.sessionId, ferramentas: nomes });
    }
    await new Promise<void>(resolve => server.listen('control.sock', () => { fs.chmodSync('control.sock', 0o600); resolve(); }));
    const sandboxPolicy = pedido.sandbox === 'read-only' ? { type: 'readOnly' } : pedido.sandbox === 'danger-full-access'
      ? { type: 'dangerFullAccess' } : { type: 'workspaceWrite', writableRoots: [pedido.cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
    const reviewBase = pedido.reviewBaseBranch;
    if (reviewBase !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(reviewBase) || reviewBase.includes('..') || reviewBase.endsWith('/')))
      throw new Error('runtime.unavailable: branch base invalida para review');
    const turn = reviewBase
      ? await rpc('review/start', { threadId: state.sessionId, target: { type: 'baseBranch', branch: reviewBase }, delivery: 'inline' })
      : await rpc('turn/start', { threadId: state.sessionId, model: pedido.model ?? t.model, approvalPolicy: 'never', sandboxPolicy,
        input: [{ type: 'text', text: pedido.prompt, text_elements: [] }], effort: pedido.effort,
        ...(pedido.outputSchema ? { outputSchema: pedido.outputSchema } : {}),
        ...(pedido.colaboracao ? { collaborationMode: { mode: pedido.colaboracao, settings: { model: t.model, reasoning_effort: pedido.effort ?? null, developer_instructions: null } } } : {}) });
    if (reviewBase && (!turn?.turn?.id || typeof turn.turn.id !== 'string'))
      throw new Error('runtime.unavailable: review nativo sem identidade de turno');
    if (reviewBase && turn.reviewThreadId !== state.sessionId)
      throw new Error('runtime.unavailable: review inline mudou a identidade da thread');
    state.turno = turn.turn.id; state.pronto = true; salvar();
  } catch (e) { state.estado = 'unavailable'; state.erro = (e as Error).message; salvar(); child.stdin.end(); server.close(); }
}
if (require.main === module) {
  (process.argv[2] === '--rpc' ? cliente() : servidor()).catch(() => { process.exitCode = 1; });
}
