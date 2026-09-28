/** Git real em fixtures locais; nenhum modelo, push ou configuração global. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, dirTemporario } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { adicionarClaim } from '../src/claims';
import { auditarEstado, comEstadoParaGit } from '../src/estado-thread';
import { adquirirRegiao, lerLease, liberar } from '../src/leases';
import { exec } from '../src/util';
import { lerLedger } from '../src/ledger';
import { ambienteGitMcp, commitMcp, PedidoCommitMcp, estadoGitMcp } from '../src/mcp-git';

test('Git MCP: ambiente mínimo elimina overrides Git do ingresso',()=>{
  const env=ambienteGitMcp({HOME:'/fixture',USER:'teste',GIT_PAGER:'cat',GIT_DIR:'/fora',
    GIT_WORK_TREE:'/fora',GIT_CONFIG_COUNT:'1',GIT_SSH_COMMAND:'COMANDO_NAO_EXECUTAR'});
  assert.equal(env.HOME,'/fixture');assert.equal(env.USER,'teste');
  assert.deepEqual(Object.keys(env).filter(chave=>chave.startsWith('GIT_')),[]);
});

async function fixture(fn: (f: {raiz:string; wt:string; id:string; pedido:PedidoCommitMcp; git:(args:string[])=>string})=>Promise<void>) {
  const home=dirTemporario('mcp-git-home'),anterior=process.env.HOME,xdg=process.env.XDG_CONFIG_HOME;
  process.env.HOME=home;process.env.XDG_CONFIG_HOME=path.join(home,'xdg');
  const p=projetoTemporario('mcp-git');
  try {
    const t=novaThread(p.carregado,{nome:'commit delimitado',modo:'auto',criarWorktree:true}).thread;
    // Auto mantém a fase inicial enquanto o bloco único contém GO.
    gravarThread(p.dir,t);
    const wt=t.worktree!,git=(args:string[])=>{const r=exec('/usr/bin/git',args,wt);assert.equal(r.ok,true,r.stderr);return r.stdout;};
    const arquivo="produto com ' aspas.txt";
    fs.writeFileSync(path.join(wt,arquivo),'conteudo autorizado\n');
    adicionarClaim(p.dir,t.id,{arquivo,alegacao:'fixture de commit delimitado',fase:'PLAN',verificar:['node -e "process.exit(0)"']});
    const pedido={threadId:t.id,expectedHead:git(['rev-parse','HEAD']).trim(),paths:[arquivo],mensagem:'commit da fixture'};
    await fn({raiz:p.dir,wt,id:t.id,pedido,git});
  } finally {p.limpar();if(anterior===undefined)delete process.env.HOME;else process.env.HOME=anterior;
    if(xdg===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=xdg;fs.rmSync(home,{recursive:true,force:true});}
}

test('Git MCP: commit passivo exato audita estado e libera somente leases próprios',async()=>fixture(async f=>{
  const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,true,r.erro??'');assert.equal(r.estadoAuditado,true);
  assert.match(r.commit!,/^[a-f0-9]{40}$/);assert.notEqual(r.commit,f.pedido.expectedHead);
  assert.equal(f.git(['rev-parse','HEAD^']).trim(),f.pedido.expectedHead);
  assert.deepEqual(f.git(['diff-tree','--no-commit-id','--name-only','-r','-z',r.commit!]).split('\0').filter(Boolean),f.pedido.paths);
  assert.equal(auditarEstado(f.raiz,f.id,f.wt).nivel,'ok');
  const eventos=lerLedger(dirThread(f.raiz,f.id));
  assert.equal(eventos.filter(e=>e.tipo==='mcp_git_committed').length,1);
  assert.equal(eventos.filter(e=>e.tipo==='artifact_delivered' || e.tipo==='ship_done').length,0);
  assert.equal(lerLease(f.raiz,`worktree-write:${f.id}`),null);
  assert.equal(lerLease(f.raiz,'path:'+f.pedido.paths[0]),null);
}));

test('Git MCP: hooks obrigatórios recusados antes do efeito, sem alterar nem remover hook',async()=>fixture(async f=>{
  const hook=path.join(f.raiz,'.git/hooks/pre-commit'),sentinela=path.join(f.raiz,'hook-executado');
  const body='#!/bin/sh\nprintf executado > "'+sentinela+'"\n';fs.writeFileSync(hook,body,{mode:0o700});
  const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/execution-profile.unsupported/);
  assert.equal(fs.readFileSync(hook,'utf8'),body);assert.equal(fs.existsSync(sentinela),false);
  assert.equal(f.git(['rev-parse','HEAD']).trim(),f.pedido.expectedHead);
  assert.equal(f.git(['diff','--cached','--name-only']).trim(),'');
  assert.equal(auditarEstado(f.raiz,f.id,f.wt).nivel,'ok');
}));

for(const chave of ['core.fsmonitor','core.hooksPath','gc.recentObjectsHook','alias.commit']) {
  test(`Git MCP: configuração executável ${chave} permanece mas não executa`,async()=>fixture(async f=>{
    const valor='COMANDO_NAO_EXECUTAR_FIXTURE';f.git(['config',chave,valor]);
    const config=fs.readFileSync(path.join(f.raiz,'.git/config'));
    const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/execution-profile.unsupported/);
    assert.deepEqual(fs.readFileSync(path.join(f.raiz,'.git/config')),config);
    assert.equal(f.git(['rev-parse','HEAD']).trim(),f.pedido.expectedHead);
  }));
}

test('Git MCP: HEAD stale e índice alheio recusados sem apagar staging',async()=>fixture(async f=>{
  let r=await commitMcp(f.raiz,{...f.pedido,expectedHead:'0'.repeat(40)});assert.equal(r.ok,false);assert.match(r.erro!,/head.stale/);
  fs.writeFileSync(path.join(f.wt,'alheio.txt'),'nao incluir');f.git(['add','--','alheio.txt']);
  const antes=f.git(['diff','--cached','--binary']);r=await commitMcp(f.raiz,f.pedido);
  assert.equal(r.ok,false);assert.match(r.erro!,/index.not-empty/);assert.equal(f.git(['diff','--cached','--binary']),antes);
}));

test('Git MCP: lease anterior da mesma thread é preservado byte a byte',async()=>fixture(async f=>{
  const nome=`worktree-write:${f.id}`;
  assert.equal(adquirirRegiao(f.raiz,nome,{thread:f.id,motivo:'fixture anterior',ttlMs:120000}).ok,true);
  const antes=lerLease(f.raiz,nome);
  try {const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/lease.busy/);assert.deepEqual(lerLease(f.raiz,nome),antes);}
  finally {liberar(f.raiz,nome,f.id);}
}));

test('Git MCP: traversal, pathspec mágico, symlink e path sem claim não viram commit',async()=>fixture(async f=>{
  for(const file of ['../fora','.git/config','/tmp/fora'])await assert.rejects(commitMcp(f.raiz,{...f.pedido,paths:[file]}),/path.invalid/);
  const outro=path.join(f.raiz,'sentinela');fs.writeFileSync(outro,'imutavel');
  fs.symlinkSync(outro,path.join(f.wt,'link'));adicionarClaim(f.raiz,f.id,{arquivo:'link',alegacao:'fixture',fase:'GO',verificar:['true']});
  let r=await commitMcp(f.raiz,{...f.pedido,paths:['link']});assert.equal(r.ok,false);assert.match(r.erro!,/path.symlink/);
  assert.equal(fs.readFileSync(outro,'utf8'),'imutavel');
  fs.writeFileSync(path.join(f.wt,'sem-claim'),'sem permissao');r=await commitMcp(f.raiz,{...f.pedido,paths:['sem-claim']});assert.equal(r.ok,false);assert.match(r.erro!,/claim.missing/);
  const magico=':(glob)*';fs.writeFileSync(path.join(f.wt,magico),'arquivo literal');
  adicionarClaim(f.raiz,f.id,{arquivo:magico,alegacao:'fixture literal',fase:'GO',verificar:['true']});
  r=await commitMcp(f.raiz,{...f.pedido,paths:[magico]});assert.equal(r.ok,true,r.erro??'');
  assert.deepEqual(f.git(['diff-tree','--no-commit-id','--name-only','-r','-z',r.commit!]).split('\0').filter(Boolean),[magico]);
}));

test('Git MCP: cancelar antes do início não toca HEAD nem índice',async()=>fixture(async f=>{
  const c=new AbortController();c.abort();const r=await commitMcp(f.raiz,f.pedido,c.signal);
  assert.equal(r.ok,false);assert.match(r.erro!,/cancelled/);assert.equal(f.git(['rev-parse','HEAD']).trim(),f.pedido.expectedHead);
  assert.equal(f.git(['diff','--cached','--name-only']).trim(),'');
}));

for(const nome of ['thread.json','ledger.jsonl','claims.jsonl']) {
  test(`Git MCP: estado ${nome} vinculado é recusado antes da API`,async()=>fixture(async f=>{
    const original=path.join(dirThread(f.raiz,f.id),nome),fora=path.join(f.raiz,'estado-alheio');
    const bytes=fs.readFileSync(original);fs.renameSync(original,fora);fs.symlinkSync(fora,original);
    const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,false);
    assert.deepEqual(fs.readFileSync(fora),bytes);assert.equal(f.git(['rev-parse','HEAD']).trim(),f.pedido.expectedHead);
  }));
}

for(const relativo of ['.git/info/exclude','.git/objects','.orkastery/state-backups']) {
  test(`Git MCP: metadado ${relativo} não redireciona escrita`,async()=>fixture(async f=>{
    const local=path.join(f.raiz,relativo),fora=path.join(f.raiz,'metadado-alheio');
    if(fs.existsSync(local))fs.renameSync(local,fora);else fs.mkdirSync(fora);
    fs.symlinkSync(fora,local);
    const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,false);assert.equal(r.commit,null);
    assert.equal(fs.lstatSync(local).isSymbolicLink(),true);
  }));
}


test('Git MCP: definição de filtro inerte permanece e commit passivo funciona',async()=>fixture(async f=>{
  f.git(['config','filter.fixture.clean','COMANDO_NAO_EXECUTAR_FIXTURE']);
  const antes=fs.readFileSync(path.join(f.raiz,'.git/config'));
  const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,true,r.erro??'');
  assert.deepEqual(fs.readFileSync(path.join(f.raiz,'.git/config')),antes);
}));

for(const alcance of ['selecionado','outro-rastreado','estado']) {
  test(`Git MCP: filtro efetivo em ${alcance} recusa antes de executar helper`,async()=>fixture(async f=>{
    const sentinela=path.join(f.raiz,'filtro-executado');
    // O driver teria um efeito observável se add/refresh/checkout o executasse.
    f.git(['config','filter.fixture.clean',`touch '${sentinela}'; cat`]);
    f.git(['config','filter.fixture.smudge',`touch '${sentinela}'; cat`]);
    let alvo=f.pedido.paths[0];
    if(alcance==='outro-rastreado') {
      alvo='outro.txt';fs.writeFileSync(path.join(f.wt,alvo),'alheio');
      f.git(['add','--',alvo]);f.git(['commit','-m','base alheia','--',alvo]);
      f.pedido.expectedHead=f.git(['rev-parse','HEAD']).trim();
    }
    if(alcance==='estado') {
      alvo=`.orkastery/threads/${f.id}/thread.json`;
      const bytes=fs.readFileSync(path.join(dirThread(f.raiz,f.id),'thread.json'));
      comEstadoParaGit(f.raiz,f.id,f.wt,()=>{
        fs.writeFileSync(path.join(f.wt,alvo),bytes);
        f.git(['add','-f','--',alvo]);f.git(['commit','-m','snapshot legado de estado','--',alvo]);
      });
      f.pedido.expectedHead=f.git(['rev-parse','HEAD']).trim();
    }
    // '*' abrange também o nome com espaços da seleção; nenhuma expansão shell.
    const regra=alcance==='selecionado'?'*':alvo;
    fs.writeFileSync(path.join(f.wt,'.gitattributes'),regra+' filter=fixture\n');
    const config=fs.readFileSync(path.join(f.raiz,'.git/config'));
    const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/filtro efetivo/);
    assert.equal(fs.existsSync(sentinela),false);assert.deepEqual(fs.readFileSync(path.join(f.raiz,'.git/config')),config);
    assert.equal(f.git(['rev-parse','HEAD']).trim(),f.pedido.expectedHead);
    assert.equal(f.git(['diff','--cached','--name-only']).trim(),'');
  }));
}


test('Git MCP: credential helpers definidos ficam inertes no commit local',async()=>fixture(async f=>{
  const sentinela=path.join(f.raiz,'credential-executado');
  for(const chave of ['credential.helper','credential.https://github.com.helper'])f.git(['config',chave,`!touch '${sentinela}'`]);
  const config=fs.readFileSync(path.join(f.raiz,'.git/config'));
  const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,true,r.erro??'');
  assert.equal(fs.existsSync(sentinela),false);assert.deepEqual(fs.readFileSync(path.join(f.raiz,'.git/config')),config);
}));


test('Git MCP: gitlink no índice recusa antes de entrar em submódulo',async()=>fixture(async f=>{
  f.git(['update-index','--add','--cacheinfo','160000,'+f.pedido.expectedHead+',submodulo']);
  const antes=f.git(['ls-files','--stage','-z']);
  const r=await commitMcp(f.raiz,f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/gitlinks/);
  assert.equal(f.git(['ls-files','--stage','-z']),antes);assert.equal(f.git(['rev-parse','HEAD']).trim(),f.pedido.expectedHead);
}));


test('Git MCP: consulta HEADs reais sem modificar indice, estado ou refs',async()=>fixture(async f=>{
  const index=path.resolve(f.wt,f.git(['rev-parse','--git-path','index']).trim());
  const files=[index,path.join(dirThread(f.raiz,f.id),'thread.json'),path.join(dirThread(f.raiz,f.id),'ledger.jsonl'),path.join(f.raiz,'.git/config')];
  const before=files.map(file=>fs.readFileSync(file));
  const r=estadoGitMcp(f.raiz,f.id);
  assert.equal(r.source.head,f.pedido.expectedHead);assert.equal(r.destination.head,f.pedido.expectedHead);
  assert.equal(r.scope,'local-only');assert.equal(r.threadId,f.id);
  assert.deepEqual(files.map(file=>fs.readFileSync(file)),before);
  const committed=await commitMcp(f.raiz,f.pedido);assert.equal(committed.ok,true,committed.erro??'');
  const next=estadoGitMcp(f.raiz,f.id);assert.equal(next.source.head,committed.commit);assert.equal(next.destination.head,r.destination.head);
  f.git(['checkout','--detach']);assert.throws(()=>estadoGitMcp(f.raiz,f.id),/mcp.git/);
}));

test('Git MCP: consulta recusa marcador Git redirecionado e ID externo',async()=>fixture(async f=>{
  const marker=path.join(f.wt,'.git'),before=fs.readFileSync(marker);
  assert.throws(()=>estadoGitMcp(f.raiz,'../fora'),/request.invalid/);
  fs.unlinkSync(marker);fs.symlinkSync(path.join(f.raiz,'.git/HEAD'),marker);
  try {assert.throws(()=>estadoGitMcp(f.raiz,f.id),/path.symlink/);}
  finally {fs.unlinkSync(marker);fs.writeFileSync(marker,before);}
}));

test('Git MCP: thread #Fast nao commita contrato publico; a mesma thread commita arquivo comum',async()=>{
  // I-42 (D7): a fronteira e do ciclo sem PLAN nem CHECK, nao do arquivo. A recusa sai antes
  // de qualquer efeito: HEAD, indice e leases ficam como estavam.
  const home=dirTemporario('mcp-git-fast-home'),anterior=process.env.HOME,xdg=process.env.XDG_CONFIG_HOME;
  process.env.HOME=home;process.env.XDG_CONFIG_HOME=path.join(home,'xdg');
  const p=projetoTemporario('mcp-git-fast');
  try {
    const t=novaThread(p.carregado,{nome:'ajuste rapido',modo:'fast',criarWorktree:true}).thread;
    const wt=t.worktree!,git=(args:string[])=>{const r=exec('/usr/bin/git',args,wt);assert.equal(r.ok,true,r.stderr);return r.stdout;};
    const contrato='core/src/types.ts',comum='docs/nota.md';
    for(const [arquivo,conteudo] of [[contrato,'export type X = 1;\n'],[comum,'nota\n']]) {
      fs.mkdirSync(path.dirname(path.join(wt,arquivo)),{recursive:true});fs.writeFileSync(path.join(wt,arquivo),conteudo);
      adicionarClaim(p.dir,t.id,{arquivo,alegacao:`fixture ${arquivo}`,verificar:['node -e "process.exit(0)"']});
    }
    const head=git(['rev-parse','HEAD']).trim();
    const barrado=await commitMcp(p.dir,{threadId:t.id,expectedHead:head,paths:[contrato],mensagem:'mexe no contrato'});
    assert.equal(barrado.ok,false);assert.equal(barrado.erro,'mcp.git.contract.protected');
    assert.equal(git(['rev-parse','HEAD']).trim(),head);
    assert.equal(git(['diff','--cached','--name-only']).trim(),'');
    assert.equal(lerLease(p.dir,`worktree-write:${t.id}`),null);
    const ok=await commitMcp(p.dir,{threadId:t.id,expectedHead:head,paths:[comum],mensagem:'nota comum'});
    assert.equal(ok.ok,true,ok.erro??'');
  } finally {p.limpar();if(anterior===undefined)delete process.env.HOME;else process.env.HOME=anterior;
    if(xdg===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=xdg;fs.rmSync(home,{recursive:true,force:true});}
});
