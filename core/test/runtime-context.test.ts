/** Instalacoes reais em fixtures; nenhum modelo, configuracao global ou aprovacao. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, semAutoridadeHitlNoAmbiente } from './apoio';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp, configuracaoServidorMcp, TOOLS_FILHO_CODEX } from '../src/mcp-install';
import { contextoDoProjeto, validarContextoRuntime } from '../src/runtime-context';
import { montarComando } from '../src/adapters/claude-bg';
import { despachar } from '../src/adapters/codex';
import { novaThread, gravarThread } from '../src/thread';
import { rodarFase } from '../src/phase';

// I-35 (GO-FIX 1): a forma da entrada MCP do filho descreve um host sem credencial
// HITL provisionada; sem isto o veredito muda conforme o shell de quem roda.
semAutoridadeHitlNoAmbiente();

test('contexto: legado sem MCP nao exige plugin nem escreve instalacao', () => {
  const p = projetoTemporario('ctx-legacy');
  try {
    assert.equal(contextoDoProjeto(p.dir, 'claude-bg', p.dir), undefined);
    assert.equal(fs.existsSync(path.join(p.dir, '.mcp.json')), false);
    assert.deepEqual(montarComando({ cwd: p.dir, nome: 'legacy', prompt: 'pedido' }), ['claude', '--bg', 'pedido', '--name', 'legacy']);
  } finally { p.limpar(); }
});

test('contexto: Claude recebe MCP estrito da thread e somente seis grants de consulta', () => {
  const p = projetoTemporario('ctx-claude');
  try {
    const instalado = instalarAdaptador('claude-code', { projeto: p.dir });
    instalarMcp({ projeto: p.dir, host: 'claude-code' });
    const t = novaThread(p.carregado, { nome: 'ctx', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    const contexto = contextoDoProjeto(p.dir, 'claude-bg', wt, t.id)!;
    const args = montarComando({ cwd: wt, nome: 'auto', prompt: 'bloco completo', contextoRuntime: contexto, model: 'opus', effort: 'high' });
    assert.equal(args[args.indexOf('--plugin-dir') + 1], instalado.destino);
    assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), { mcpServers: { orkastery: configuracaoServidorMcp(p.dir, 'claude-code', t.id) } });
    assert.equal(args.filter(a => a === '--strict-mcp-config').length, 1);
    assert.equal(args.filter(a => a === '--allowedTools').length, 1);
    const consultas = args[args.indexOf('--allowedTools') + 1].split(',');
    assert.deepEqual(consultas, [
      'mcp__orkastery__ork_thread_status',
      'mcp__orkastery__ork_phase_list',
      'mcp__orkastery__ork_hitl_pending',
      'mcp__orkastery__ork_observe',
      'mcp__orkastery__ork_artifact_read',
      'mcp__orkastery__ork_claims_list',
    ]);
    for (const nome of ['ork_thread_new', 'ork_phase_run', 'ork_gate_request', 'ork_request_decision', 'ork_artifact_write', 'ork_claim_add', 'ork_verify', 'ork_ship'])
      assert.equal(consultas.includes(`mcp__orkastery__${nome}`), false);
    assert.equal(consultas.some(nome => nome.includes('*') || nome.startsWith('Bash')), false);
    const entrada = fs.readFileSync(path.join(instalado.destino, 'commands/ork.md'), 'utf8');
    const grantsOwner = entrada.match(/^allowed-tools: (.+)$/m)![1].split(',').map(nome => nome.trim());
    assert.deepEqual(grantsOwner, ['Bash(ork:*)', 'Read', ...consultas, 'mcp__orkastery__ork_git_status', 'mcp__orkastery__ork_thread_new', 'mcp__orkastery__ork_phase_run', 'mcp__orkastery__ork_preflight']);
    assert.match(entrada, /valem no turno da invocacao/);
    assert.match(entrada, /nao persistem/);
    assert.match(entrada, /select:mcp__orkastery__ork_thread_status,mcp__orkastery__ork_artifact_read/);
    for (const proibido of ['--agent', '--add-dir', '--permission-mode', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--settings']) assert.equal(args.includes(proibido), false);
    assert.equal(fs.existsSync(path.join(wt, '.claude')), false);
  } finally { p.limpar(); }
});

test('contexto: preparo em um host nao impoe runtime, mas exige instalacao do runtime escolhido', () => {
  const p = projetoTemporario('ctx-cross-host');
  try {
    instalarMcp({ projeto: p.dir, host: 'codex' });
    const t = novaThread(p.carregado, { nome: 'ctxcross', modo: 'auto' }).thread;
    assert.throws(() => contextoDoProjeto(p.dir, 'claude-bg', p.dir, t.id));
    instalarAdaptador('claude-code', { projeto: p.dir });
    const c = contextoDoProjeto(p.dir, 'claude-bg', p.dir, t.id)!;
    assert.equal(c.host, 'claude-code');
    assert.deepEqual(validarContextoRuntime(c, p.dir).servidor, configuracaoServidorMcp(p.dir, 'claude-code', t.id));
    assert.equal(fs.existsSync(path.join(p.dir, '.mcp.json')), false);
  } finally { p.limpar(); }
});

test('contexto: bytes divergentes, cwd externo e MCP de outra raiz recusados', () => {
  const p = projetoTemporario('ctx-invalid'), outro = projetoTemporario('ctx-other');
  try {
    const instalado = instalarAdaptador('claude-code', { projeto: p.dir });
    instalarMcp({ projeto: p.dir, host: 'claude-code' });
    const t = novaThread(p.carregado, { nome: 'ctxinvalid', modo: 'auto' }).thread;
    const c = contextoDoProjeto(p.dir, 'claude-bg', p.dir, t.id)!;
    assert.throws(() => validarContextoRuntime(c, outro.dir), /runtime.context.scope/);
    assert.throws(() => montarComando({cwd: outro.dir, nome: 'fora', prompt: 'consulta', contextoRuntime: c}), /runtime.context.scope/);
    assert.throws(() => montarComando({cwd: p.dir, nome: 'outra', prompt: 'consulta', contextoRuntime: {...c, threadId: '../outra'}}), /runtime.context.invalid/);
    const bootstrap = path.join(instalado.destino, 'skills/core/orkastery-bootstrap/SKILL.md');
    const antes = fs.readFileSync(bootstrap); fs.appendFileSync(bootstrap, '\nDIVERGENTE');
    assert.throws(() => validarContextoRuntime(c, p.dir), /bytes instalados divergentes/);
    fs.writeFileSync(bootstrap, antes);
    fs.writeFileSync(path.join(p.dir, '.mcp.json'), JSON.stringify({ mcpServers: { orkastery: configuracaoServidorMcp(outro.dir, 'claude-code') } }));
    assert.throws(() => validarContextoRuntime(c, p.dir), /MCP Orkastery divergente/);
  } finally { p.limpar(); outro.limpar(); }
});

test('contexto: opt-in Codex invalido falha sem criar controller ou iniciar runtime', () => {
  const p = projetoTemporario('ctx-no-spawn');
  try {
    const logDir = path.join(p.dir, 'no-controller');
    const r = despachar({ cwd: p.dir, nome: 'invalid', prompt: 'pedido', logDir,
      vinculo: { thread: 'ork-fixture', fase: 'GO', promptSha256: '0'.repeat(64) },
      contextoRuntime: { projeto: p.dir, host: 'codex', threadId: 'ork-fixture' } });
    assert.equal(r.ok, false); assert.match(r.erro!, /runtime.context.missing/);
    assert.equal(fs.existsSync(logDir), false);
    const divergente = despachar({ cwd: p.dir, nome: 'divergente', prompt: 'pedido', logDir,
      vinculo: { thread: 'ork-outra', fase: 'GO', promptSha256: '0'.repeat(64) },
      contextoRuntime: { projeto: p.dir, host: 'codex', threadId: 'ork-fixture' } });
    assert.equal(divergente.ok, false); assert.match(divergente.erro!, /thread do contexto difere/);
    assert.equal(fs.existsSync(logDir), false);
  } finally { p.limpar(); }
});

test('contexto: phase dry-run leva raiz canonica e plugin a worktree sem instalar nela', () => {
  const p = projetoTemporario('ctx-phase');
  try {
    instalarAdaptador('claude-code', { projeto: p.dir }); instalarMcp({ projeto: p.dir, host: 'claude-code' });
    const t = novaThread(p.carregado, { nome: 'contexto', modo: 'auto', criarWorktree: true }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Objetivo sintetico limitado', dryRun: true });
    assert.equal(r.bloqueado, false, r.erro); assert.equal(r.sessionId, null);
    const config = JSON.parse(r.comando[r.comando.indexOf('--mcp-config') + 1]);
    // I-36 (D4): a sessao filha leva a identidade do despacho, e e por ela que reentra na conducao.
    const args = config.mcpServers.orkastery.args as string[];
    const dispatchId = args[args.indexOf('--dispatch') + 1];
    assert.match(dispatchId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(config.mcpServers.orkastery, configuracaoServidorMcp(p.dir, 'claude-code', t.id, 'github-ssh', 'interactive', dispatchId));
    assert.equal(fs.existsSync(path.join(t.worktree!, '.mcp.json')), false);
    assert.equal(fs.existsSync(path.join(t.worktree!, '.claude/plugins')), false);
  } finally { p.limpar(); }
});


for(const host of ['codex','claude-code'] as const) {
  test(`contexto C31: transporte bare explícito em ${host} propaga ao filho sem argumentos livres`,()=>{
    const p=projetoTemporario('ctx-transport');
    try {
      instalarAdaptador(host,{projeto:p.dir});instalarMcp({projeto:p.dir,host,transporteShip:'bare-local'});
      const t=novaThread(p.carregado,{nome:'transport',modo:'auto',criarWorktree:true}).thread;
      const contexto=contextoDoProjeto(p.dir,host==='codex'?'codex':'claude-bg',t.worktree!,t.id)!;
      assert.equal(contexto.transporteShip,'bare-local');
      assert.deepEqual(validarContextoRuntime(contexto,t.worktree!).servidor,configuracaoServidorMcp(p.dir,host,t.id,'bare-local'));
      assert.throws(()=>validarContextoRuntime({...contexto,transporteShip:'github-ssh'},t.worktree!),/transporte SHIP difere/);
      assert.throws(()=>validarContextoRuntime({...contexto,transporteShip:'https' as 'bare-local'},t.worktree!),/transporte desconhecido/);
    } finally {p.limpar();}
  });
}

test('contexto C31: legado sem flag significa SSH e extras/duplicação/enum inválido recusam',()=>{
  const p=projetoTemporario('ctx-transport-negative');
  try {
    instalarAdaptador('claude-code',{projeto:p.dir});const t=novaThread(p.carregado,{nome:'legacy transport',modo:'auto'}).thread;
    const def=configuracaoServidorMcp(p.dir,'claude-code'),legacy=def.args.slice(0,-2),file=path.join(p.dir,'.mcp.json');
    const escrever=(args:string[])=>fs.writeFileSync(file,JSON.stringify({mcpServers:{orkastery:{command:def.command,args}}}));
    escrever(legacy);const c=contextoDoProjeto(p.dir,'claude-bg',p.dir,t.id)!;
    assert.equal(c.transporteShip,'github-ssh');assert.deepEqual(validarContextoRuntime(c,p.dir).servidor,configuracaoServidorMcp(p.dir,'claude-code',t.id));
    for(const args of [[...legacy,'--ship-transport','https'],[...def.args,'--ship-transport','bare-local'],[...def.args,'--env','FREE=1'],[...legacy,'--ship-transport']]) {
      escrever(args);assert.throws(()=>contextoDoProjeto(p.dir,'claude-bg',p.dir,t.id),/runtime.context.conflict/);
    }
  } finally {p.limpar();}
});

test('contexto C31: perfis de transporte divergentes entre instalações recusam autodetecção',()=>{
  const p=projetoTemporario('ctx-transport-conflict');
  try {
    instalarMcp({projeto:p.dir,host:'codex',transporteShip:'bare-local'});
    instalarMcp({projeto:p.dir,host:'claude-code',transporteShip:'github-ssh'});
    const t=novaThread(p.carregado,{nome:'divergent transport',modo:'auto'}).thread;
    assert.throws(()=>contextoDoProjeto(p.dir,'codex',p.dir,t.id),/transportes SHIP divergentes/);
  } finally {p.limpar();}
});


for(const host of ['codex','claude-code'] as const) {
  test(`contexto C33 ${host}: worktree opt-in só em WT própria, capacidade GO revalidada antes do despacho`,()=>{
    const p=projetoTemporario('ctx-child-permissions');
    try {
      instalarAdaptador(host,{projeto:p.dir});instalarMcp({projeto:p.dir,host,permissoesFilho:'worktree'});
      const t=novaThread(p.carregado,{nome:'ctx child permissions',modo:'auto',criarWorktree:true}).thread,wt=t.worktree!;
      const c=contextoDoProjeto(p.dir,host==='codex'?'codex':'claude-bg',wt,t.id)!;
      assert.equal(c.permissoesFilho,'worktree');
      const validado=validarContextoRuntime(c,wt);
      assert.equal(validado.permissoesFilho,'worktree');
      assert.equal(validado.permiteEditarProduto,true);
      assert.deepEqual(validado.servidor,{...configuracaoServidorMcp(p.dir,host,t.id,'github-ssh','worktree'),...(host==='codex'?{tools:Object.fromEntries(TOOLS_FILHO_CODEX.map(n=>[n,{approval_mode:'approve'}]))}:{})});
      assert.throws(()=>validarContextoRuntime({...c,permissoesFilho:'interactive'},wt),/perfil de filho difere/);
      assert.throws(()=>validarContextoRuntime({...c,permissoesFilho:'auto' as 'worktree'},wt),/perfil de filho desconhecido/);
      t.status='fechada';gravarThread(p.dir,t);
      assert.throws(()=>validarContextoRuntime(c,wt),/runtime.context.worktree/);
    } finally {p.limpar();}
  });
}

for(const caso of ['sem-worktree','raiz','diretorio-nao-registrado','worktree-alheia','symlink']) {
  test(`contexto C33: worktree recusa ${caso}`,()=>{
    const p=projetoTemporario('ctx-child-invalid');
    try {
      instalarAdaptador('claude-code',{projeto:p.dir});instalarMcp({projeto:p.dir,host:'claude-code',permissoesFilho:'worktree'});
      const t=novaThread(p.carregado,{nome:'ctx invalid '+caso,modo:'auto',criarWorktree:caso!=='sem-worktree'}).thread;
      let cwd=t.worktree??p.dir;
      if(caso==='raiz'){t.worktree=p.dir;cwd=p.dir;}
      if(caso==='diretorio-nao-registrado'){cwd=path.join(p.dir,'nao-registrada');fs.mkdirSync(cwd);t.worktree=cwd;}
      if(caso==='worktree-alheia'){const outro=novaThread(p.carregado,{nome:'outro',modo:'auto',criarWorktree:true}).thread;cwd=outro.worktree!;t.worktree=cwd;}
      if(caso==='symlink'){const link=path.join(p.dir,'wt-link');fs.symlinkSync(cwd,link);t.worktree=link;}
      gravarThread(p.dir,t);
      assert.throws(()=>contextoDoProjeto(p.dir,'claude-bg',cwd,t.id),/runtime.context.(worktree|scope)/);
    } finally {p.limpar();}
  });
}

test('contexto C33: legado e C31 permanecem interactive; mudança/duplicação/extras recusam',()=>{
  const p=projetoTemporario('ctx-child-canonical');
  try {
    instalarAdaptador('claude-code',{projeto:p.dir});const t=novaThread(p.carregado,{nome:'ctx canonical',modo:'auto'}).thread;
    const def=configuracaoServidorMcp(p.dir,'claude-code'),file=path.join(p.dir,'.mcp.json');
    const write=(args:string[])=>fs.writeFileSync(file,JSON.stringify({mcpServers:{orkastery:{command:def.command,args}}}));
    for(const args of [def.args.slice(0,-2),def.args,[...def.args,'--child-permissions','interactive']]) {
      write(args);const c=contextoDoProjeto(p.dir,'claude-bg',p.dir,t.id)!;
      assert.equal(c.permissoesFilho,'interactive');assert.equal(validarContextoRuntime(c,p.dir).permissoesFilho,'interactive');
    }
    write(def.args);const c=contextoDoProjeto(p.dir,'claude-bg',p.dir,t.id)!;
    write([...def.args,'--child-permissions','worktree']);
    assert.throws(()=>validarContextoRuntime(c,p.dir),/perfil de filho difere/);
    for(const args of [[...def.args,'--child-permissions','auto'],[...def.args,'--child-permissions'],[...def.args,'--child-permissions','worktree','--child-permissions','interactive'],[...def.args,'--child-permissions','interactive','--env','FREE=1']]) {
      write(args);assert.throws(()=>contextoDoProjeto(p.dir,'claude-bg',p.dir,t.id),/runtime.context.conflict/);
    }
  } finally {p.limpar();}
});

test('contexto C33: hosts com permissões divergentes recusam escolha implícita',()=>{
  const p=projetoTemporario('ctx-child-cross-host');
  try {
    instalarMcp({projeto:p.dir,host:'claude-code',permissoesFilho:'worktree'});instalarMcp({projeto:p.dir,host:'codex'});
    const t=novaThread(p.carregado,{nome:'ctx cross host',modo:'auto',criarWorktree:true}).thread;
    assert.throws(()=>contextoDoProjeto(p.dir,'claude-bg',t.worktree!,t.id),/perfis de filho divergentes/);
  } finally {p.limpar();}
});

for(const policy of ['disabled','enabled-filter','disabled-tool','prompt','default','invalid-list']) {
  test(`C40 contexto Codex worktree recusa politica ${policy} antes do turno`,()=>{
    const p=projetoTemporario('ctx-c40-policy');
    try {
      instalarAdaptador('codex',{projeto:p.dir});
      const r=instalarMcp({projeto:p.dir,host:'codex',permissoesFilho:'worktree'});
      const t=novaThread(p.carregado,{nome:'ctx policy',modo:'auto',criarWorktree:true}).thread;
      const extra:Record<string,string>={disabled:'enabled = false', 'enabled-filter':'enabled_tools = ["ork_thread_status"]', 'disabled-tool':'disabled_tools = ["ork_verify"]',prompt:'[mcp_servers.orkastery.tools.ork_verify]\napproval_mode = "prompt"',default:'default_tools_approval_mode = "prompt"','invalid-list':'disabled_tools = "ork_verify"'};
      fs.appendFileSync(r.arquivo,extra[policy]+'\n');
      const before=fs.readFileSync(r.arquivo);
      assert.throws(()=>contextoDoProjeto(p.dir,'codex',t.worktree!,t.id),/mcp.permissions.conflict/);
      assert.deepEqual(fs.readFileSync(r.arquivo),before);
    }finally{p.limpar();}
  });
}
test('C40 filho Codex preserva filtros/restricoes e nao herda grants do dono',()=>{
  const p=projetoTemporario('ctx-c40-scoped');
  try{
    instalarAdaptador('codex',{projeto:p.dir});
    const r=instalarMcp({projeto:p.dir,host:'codex',permissoesFilho:'worktree',permissoesDono:'orchestrate'});
    // Owner opt-in nao introduz default de servidor; filtro tem de incluir os cinco grants.
    const text=fs.readFileSync(r.arquivo,'utf8').replace('[mcp_servers.orkastery]','[mcp_servers.orkastery]\ndisabled_tools = ["ork_observe"]');
    fs.writeFileSync(r.arquivo,text+'\n[mcp_servers.orkastery.tools.ork_artifact_read]\napproval_mode = "prompt"\n');
    const t=novaThread(p.carregado,{nome:'ctx scoped',modo:'auto',criarWorktree:true}).thread;
    const c=contextoDoProjeto(p.dir,'codex',t.worktree!,t.id)!;
    const server=validarContextoRuntime(c,t.worktree!).servidor;
    assert.deepEqual(server.disabled_tools,['ork_observe']);
    assert.deepEqual(Object.entries(server.tools!).filter(([,v])=>(v as {approval_mode?:string}).approval_mode==='approve').map(([k])=>k).sort(),[...TOOLS_FILHO_CODEX].sort());
    assert.deepEqual(server.tools!.ork_artifact_read,{approval_mode:'prompt'});
    assert.ok(!server.tools!.ork_request_decision && !server.tools!.ork_thread_new);
    assert.ok(!Object.hasOwn(server,'default_tools_approval_mode'));
  }finally{p.limpar();}
});
