/** F2: binário receptor SIMULADO observa o caminho vivo, sem API ou configuração real. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { projetoTemporario, semAutoridadeHitlNoAmbiente } from './apoio';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp, configuracaoServidorMcp, TOOLS_FILHO_CODEX } from '../src/mcp-install';
import { contextoDoProjeto } from '../src/runtime-context';
import { novaThread } from '../src/thread';
import { encerrarController, lerEstadoController } from '../src/adapters/codex-controller';

// I-35 (GO-FIX 1): a entrada MCP comparada aqui e a de um host sem credencial HITL
// provisionada; sem isto o veredito muda conforme o shell de quem roda.
semAutoridadeHitlNoAmbiente();

for (const sandbox of [undefined, 'read-only', 'workspace-write', 'danger-full-access']) {
  test(`F2 SIMULADO: thread/start e turn/start recebem política, sandbox ${sandbox ?? 'default'}, modelo e esforço`, () => {
    const f = controllerSimulado(); let r: ReturnType<typeof f.dispatch> | undefined;
    try {
      r = f.dispatch({ model: 'modelo-escolhido-SIMULADO', effort: 'high', sandbox, colaboracao: 'plan' });
      assert.equal(r.ok, true, r.erro);
      const calls = fs.readFileSync(path.join(f.runtimeHome, 'params.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
      assert.deepEqual(calls.map(c => c.method), ['thread/start', 'turn/start']);
      const [thread, turn] = calls.map(c => c.params);
      assert.equal(thread.approvalPolicy, 'never'); assert.equal(turn.approvalPolicy, 'never');
      assert.equal(thread.sandbox, sandbox ?? 'workspace-write');
      assert.deepEqual(turn.sandboxPolicy, sandbox === 'read-only' ? { type: 'readOnly' } : sandbox === 'danger-full-access'
        ? { type: 'dangerFullAccess' } : { type: 'workspaceWrite', writableRoots: [f.dir], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false });
      assert.equal(thread.model, 'modelo-escolhido-SIMULADO'); assert.equal(turn.model, thread.model);
      assert.equal(thread.config.model_reasoning_effort, 'high'); assert.equal(turn.effort, 'high');
      assert.equal(thread.modelProvider, 'openai'); assert.equal(turn.threadId, r.sessionId);
      assert.equal(turn.collaborationMode.settings.reasoning_effort, 'high');
      // A colaboração mantém o modelo escolhido no caminho vivo.
      assert.equal(turn.collaborationMode.settings.model, 'modelo-escolhido-SIMULADO');
    } finally {
      if (r?.ok) { const ctl = f.controle(r); esperarCondicao(() => ctl.consultar().sessoes[0]?.estado === 'blocked'); ctl.parar(ctl.consultar().sessoes[0]); }
      f.restaurar();
    }
  });
}

test('GO Codex entrega schema fechado e CHECK usa review nativo contra a base', () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  for (const pedido of [{ outputSchema: schema }, { reviewBaseBranch: 'main' }]) {
    const f = controllerSimulado(); let r: ReturnType<typeof f.dispatch> | undefined;
    try {
      r = f.dispatch(pedido);
      assert.equal(r.ok, true, r.erro);
      const calls = fs.readFileSync(path.join(f.runtimeHome, 'params.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
      const final = calls.at(-1);
      if ('outputSchema' in pedido) {
        assert.equal(final.method, 'turn/start');
        assert.deepEqual(final.params.outputSchema, schema);
      } else {
        assert.equal(final.method, 'review/start');
        assert.deepEqual(final.params.target, { type: 'baseBranch', branch: 'main' });
        assert.equal(final.params.delivery, 'inline');
      }
    } finally {
      if (r?.ok) { const ctl = f.controle(r); esperarCondicao(() => ctl.consultar().sessoes[0]?.estado === 'blocked'); ctl.parar(ctl.consultar().sessoes[0]); }
      f.restaurar();
    }
  }
});

test('review Codex recusa branch ambigua antes do RPC nativo', () => {
  const f = controllerSimulado();
  try {
    const r = f.dispatch({ reviewBaseBranch: '../main' });
    assert.equal(r.ok, false);
    assert.match(r.erro!, /branch base invalida/);
  } finally { f.restaurar(); }
});

for (const cenario of ['contexto-ok', 'skills-missing', 'mcp-missing']) {
  test(`contexto ${cenario} SIMULADO: descoberta antes do turno e politica preservada`, () => {
    const p = projetoTemporario('ctx-controller');
    instalarAdaptador('codex', { projeto: p.dir }); instalarMcp({ projeto: p.dir, host: 'codex' });
    const thread = novaThread(p.carregado, { nome: 'ctxcontroller', modo: 'auto' }).thread;
    const contextoRuntime = contextoDoProjeto(p.dir, 'codex', p.dir, thread.id)!;
    const f = controllerSimulado(p.dir, { cenario }); let r: ReturnType<typeof f.dispatch> | undefined;
    try {
      r = f.dispatch({ contextoRuntime, vinculo: { ...f.vinculo, thread: contextoRuntime.threadId }, model: 'modelo-SIMULADO', effort: 'high' });
      assert.equal(r.ok, cenario === 'contexto-ok', r.erro);
      const calls = fs.readFileSync(path.join(f.runtimeHome, 'params.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
      const methods = calls.map(c => c.method);
      assert.deepEqual(methods.slice(0, 2), ['skills/extraRoots/set', 'skills/list']);
      if (cenario !== 'contexto-ok') {
        assert.equal(methods.includes('turn/start'), false);
        assert.match(r.erro!, /runtime.context.discovery/);
        assert.ok(r.controlador);
        esperarCondicao(()=>!!lerEstadoController(r!.controlador!).processoEncerrado);
        assert.match(lerEstadoController(r.controlador!).erro!, /runtime.context.discovery/);
      } else {
        const thread = calls.find(c => c.method === 'thread/start').params;
        const turn = calls.find(c => c.method === 'turn/start').params;
        assert.deepEqual(thread.config.mcp_servers, { orkastery: configuracaoServidorMcp(p.dir, 'codex', contextoRuntime.threadId) });
        assert.equal(thread.approvalPolicy, 'never'); assert.equal(turn.approvalPolicy, 'never');
        assert.equal(thread.sandbox, 'workspace-write'); assert.equal(turn.sandboxPolicy.networkAccess, false);
        assert.deepEqual(turn.sandboxPolicy.writableRoots, [p.dir]);
        assert.ok(methods.indexOf('mcpServerStatus/list') < methods.indexOf('turn/start'));
        assert.equal(fs.existsSync(path.join(r.controlador!, 'runtime-context.json')), true);
      }
    } finally {
      if (r?.controlador) {
        const state = lerEstadoController(r.controlador);
        assert.equal(encerrarController(r.controlador, state.vinculo, state.instancia).ok, true);
      }
      f.restaurar(); p.limpar();
    }
  });
}

test('C40 controller SIMULADO recebe cinco grants exatos somente em worktree vinculada',()=>{
  const p=projetoTemporario('ctx-controller-c40');
  let f:ReturnType<typeof controllerSimulado>|undefined,r:ReturnType<ReturnType<typeof controllerSimulado>['dispatch']>|undefined;
  try{
    instalarAdaptador('codex',{projeto:p.dir});instalarMcp({projeto:p.dir,host:'codex',permissoesFilho:'worktree',permissoesDono:'orchestrate'});
    const t=novaThread(p.carregado,{nome:'child-c40',modo:'auto',criarWorktree:true}).thread;
    const contextoRuntime=contextoDoProjeto(p.dir,'codex',t.worktree!,t.id)!;
    f=controllerSimulado(t.worktree!,{cenario:'contexto-ok'});
    r=f.dispatch({contextoRuntime,vinculo:{...f.vinculo,thread:t.id},model:'modelo-SIMULADO'});
    assert.equal(r.ok,true,r.erro);
    const calls=fs.readFileSync(path.join(f.runtimeHome,'params.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
    const start=calls.find(x=>x.method==='thread/start').params,turn=calls.find(x=>x.method==='turn/start').params;
    assert.deepEqual(start.config.mcp_servers.orkastery,{...configuracaoServidorMcp(p.dir,'codex',t.id,'github-ssh','worktree'),tools:Object.fromEntries(TOOLS_FILHO_CODEX.map(n=>[n,{approval_mode:'approve'}]))});
    assert.equal(start.approvalPolicy,'never');assert.equal(turn.approvalPolicy,'never');
    assert.equal(start.sandbox,'workspace-write');assert.equal(turn.sandboxPolicy.networkAccess,false);
    assert.deepEqual(turn.sandboxPolicy.writableRoots,[t.worktree]);
  }finally{
    if(r?.controlador){const state=lerEstadoController(r.controlador);assert.equal(encerrarController(r.controlador,state.vinculo,state.instancia).ok,true);}
    f?.restaurar();p.limpar();
  }
});
