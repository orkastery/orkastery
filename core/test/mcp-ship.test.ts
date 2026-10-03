/** Apenas bare local físico; nenhuma chamada GitHub/modelo. VERIFY usa sandbox oficial. */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {projetoTemporario,dirTemporario,commitar} from './apoio';
import {novaThread,dirThread} from '../src/thread';
import {adicionarClaim} from '../src/claims';
import {lerLedger} from '../src/ledger';
import {adquirirRegiao,lerLease,liberar,caminhoLease} from '../src/leases';
import {exec} from '../src/util';
import {criarPerfilShipMcp,shipMcp,PedidoShipMcp,PerfilShipMcp} from '../src/mcp-ship';
import { semCodexSandbox } from './ambiente-de-teste';
async function fixture(fn:(f:{raiz:string;wt:string;remoto:string;id:string;pedido:PedidoShipMcp;git:(args:string[],cwd?:string)=>string})=>Promise<void>) {
  const home=dirTemporario('mcp-ship-home'),antes=process.env.HOME,xdg=process.env.XDG_CONFIG_HOME;
  process.env.HOME=home;process.env.XDG_CONFIG_HOME=path.join(home,'xdg');const p=projetoTemporario('mcp-ship',true);
  try {
    const t=novaThread(p.carregado,{nome:'SHIP delimitado',modo:'auto',criarWorktree:true}).thread,wt=t.worktree!;
    const sha=commitar(wt,'entrega.md','entrega da fixture','entrega');
    adicionarClaim(p.dir,t.id,{arquivo:'entrega.md',alegacao:'entrega da fixture',fase:'PLAN',verificar:['test -f entrega.md']});
    const git=(args:string[],cwd=p.dir)=>{const r=exec('/usr/bin/git',args,cwd);assert.equal(r.ok,true,r.stderr);return r.stdout;};
    await fn({raiz:p.dir,wt,remoto:p.remoto!,id:t.id,pedido:{threadId:t.id,expectedSource:sha,expectedDestination:git(['rev-parse','main']).trim()},git});
  } finally {p.limpar();if(antes===undefined)delete process.env.HOME;else process.env.HOME=antes;
    if(xdg===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=xdg;fs.rmSync(home,{recursive:true,force:true});}
}

test('SHIP MCP: API integral verifica em sandbox, mergeia e prova push no bare fixado', { skip: semCodexSandbox() },async()=>fixture(async f=>{
  const perfil=criarPerfilShipMcp(f.raiz,'bare-local');const r=await shipMcp(perfil,f.pedido);
  assert.equal(r.ok,true,r.erro??r.resultado?.detalhe);assert.equal(r.resultado!.pushVerificado,true);
  const remoto=f.git(['ls-remote','origin','refs/heads/main']).trim().split(/\s/)[0];assert.equal(remoto,r.resultado!.mergeSha);
  assert.equal(lerLedger(dirThread(f.raiz,f.id)).filter(e=>e.tipo==='ship_done').length,1);
  for(const nome of ['main-tree',`worktree-write:${f.id}`,`path:.orkastery/threads/${f.id}`])assert.equal(lerLease(f.raiz,nome),null);
  const replay=await shipMcp(perfil,f.pedido);assert.equal(replay.ok,false);
}));

test('SHIP MCP: capacidade não fabricável, argumentos fechados e cancelamento prévio sem efeito',async()=>fixture(async f=>{
  await assert.rejects(shipMcp({transporte:'bare-local',destino:'main'} as PerfilShipMcp,f.pedido),/profile.invalid/);
  const perfil=criarPerfilShipMcp(f.raiz,'bare-local');
  await assert.rejects(shipMcp(perfil,{...f.pedido,remoto:'evil'} as PedidoShipMcp),/request.invalid/);
  const c=new AbortController();c.abort();assert.equal((await shipMcp(perfil,f.pedido,c.signal)).ok,false);
  assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
}));

for(const chave of ['core.sshCommand','remote.origin.pushurl','url.ext::evil.insteadOf']) {
  test(`SHIP MCP: transporte ${chave} recusado antes da rede`,async()=>fixture(async f=>{
    f.git(['config',chave,'INERTE_NAO_EXECUTAR']);assert.throws(()=>criarPerfilShipMcp(f.raiz,'bare-local'),/mcp.ship./);
    assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
  }));
}

test('SHIP MCP: URL alterada após startup recusa sem merge',async()=>fixture(async f=>{
  const perfil=criarPerfilShipMcp(f.raiz,'bare-local');f.git(['remote','set-url','origin','https://github.com/owner/repo.git']);
  const r=await shipMcp(perfil,f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/transport.changed/);
  assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
  assert.throws(()=>criarPerfilShipMcp(f.raiz),/transport.unsupported/);
}));

for(const remoto of [false,true]) {
  test(`SHIP MCP: hook ${remoto?'remoto':'local'} preservado e recusado sem efeito`,async()=>fixture(async f=>{
    const sentinela=path.join(f.raiz,'hook-executado'),hook=path.join(remoto?f.remoto:path.join(f.raiz,'.git'),'hooks',remoto?'pre-receive':'pre-merge-commit');
    const body=`#!/bin/sh\ntouch '${sentinela}'\n`;fs.writeFileSync(hook,body,{mode:0o700});
    if(remoto)assert.throws(()=>criarPerfilShipMcp(f.raiz,'bare-local'),/hooks/);
    else {const r=await shipMcp(criarPerfilShipMcp(f.raiz,'bare-local'),f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/hooks/);}
    assert.equal(fs.readFileSync(hook,'utf8'),body);assert.equal(fs.existsSync(sentinela),false);
    assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
  }));
}

test('SHIP MCP: atributos entrantes divergentes recusados antes de merge/filtro',async()=>fixture(async f=>{
  const sentinel=path.join(f.raiz,'filtro-executado');
  // Definição depois do commit de fixture: preparação não executa driver.
  f.pedido.expectedSource=commitar(f.wt,'.gitattributes','*.md filter=fixture\n','atributos entrantes');
  f.git(['config','filter.fixture.clean',`touch '${sentinel}'; cat`]);f.git(['config','filter.fixture.smudge',`touch '${sentinel}'; cat`]);
  const r=await shipMcp(criarPerfilShipMcp(f.raiz,'bare-local'),f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/attributes|filtro efetivo/);
  assert.equal(fs.existsSync(sentinel),false);assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
}));

test('SHIP MCP: mutação de atributos durante VERIFY é recusada antes do merge',async()=>fixture(async f=>{
  f.git(['config','filter.fixture.clean','COMANDO_NAO_EXECUTAR']);
  adicionarClaim(f.raiz,f.id,{arquivo:'entrega.md',alegacao:'contraprova pós verify',fase:'GO',verificar:[`printf '* filter=fixture\\n' > .gitattributes`]});
  const r=await shipMcp(criarPerfilShipMcp(f.raiz,'bare-local'),f.pedido);assert.equal(r.ok,false);
  assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
  assert.equal(lerLedger(dirThread(f.raiz,f.id)).some(e=>e.tipo==='ship_done'),false);
}));

for(const tipo of ['existente','corrompida']) {
  test(`SHIP MCP: main-tree ${tipo} preservada`,async()=>fixture(async f=>{
    const perfil=criarPerfilShipMcp(f.raiz,'bare-local');
    if(tipo==='existente')assert.equal(adquirirRegiao(f.raiz,'main-tree',{thread:f.id,motivo:'anterior',ttlMs:120000}).ok,true);
    else {fs.mkdirSync(path.dirname(caminhoLease(f.raiz,'main-tree')),{recursive:true});fs.writeFileSync(caminhoLease(f.raiz,'main-tree'),'CORROMPIDA');}
    const antes=fs.readFileSync(caminhoLease(f.raiz,'main-tree'));
    try {const r=await shipMcp(perfil,f.pedido);assert.equal(r.ok,false);assert.deepEqual(fs.readFileSync(caminhoLease(f.raiz,'main-tree')),antes);}
    finally {if(tipo==='existente')liberar(f.raiz,'main-tree',f.id);}
  }));
}


test('SHIP MCP: cancelar VERIFY encerra descendentes antes de retornar incompleto', { skip: semCodexSandbox() },async()=>fixture(async f=>{
  adicionarClaim(f.raiz,f.id,{arquivo:'entrega.md',alegacao:'contraprova de cleanup',fase:'GO',verificar:[
    'echo $$ > pid-fixture; while :; do date +%s%N > heartbeat-fixture; sleep .05; done'
  ]});
  const c=new AbortController(),run=shipMcp(criarPerfilShipMcp(f.raiz,'bare-local'),f.pedido,c.signal);
  const file=path.join(f.wt,'heartbeat-fixture'),inicio=Date.now();
  while(!fs.existsSync(file) && Date.now()-inicio<20000)await new Promise(r=>setTimeout(r,25));
  const iniciou=fs.existsSync(file);c.abort();const r=await run;
  assert.equal(iniciou,true,'o comando sandbox deve iniciar para exercitar cleanup');assert.equal(r.ok,false);
  const antes=fs.readFileSync(file,'utf8');await new Promise(r=>setTimeout(r,200));assert.equal(fs.readFileSync(file,'utf8'),antes);
  assert.equal(r.cleanupConfirmado,true,'subreaper deve confirmar ausência de descendentes; PID interno não é PID do host');
  assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
}));


for(const alvo of ['fonte','destino','verify']) {
  test(`SHIP MCP: tracked dirty em ${alvo} recusa antes de merge/push`, { skip: alvo==='verify' && semCodexSandbox() },async()=>fixture(async f=>{
    if(alvo==='verify')adicionarClaim(f.raiz,f.id,{arquivo:'entrega.md',alegacao:'contraprova de HEAD/conteudo',fase:'GO',verificar:['printf alterado >> entrega.md']});
    else fs.appendFileSync(path.join(alvo==='fonte'?f.wt:f.raiz,alvo==='fonte'?'entrega.md':'README.md'),'alterado');
    const r=await shipMcp(criarPerfilShipMcp(f.raiz,'bare-local'),f.pedido);assert.equal(r.ok,false);
    assert.match(r.erro??r.resultado?.detalhe??'',/tracked.dirty/);
    assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
    assert.equal(f.git(['ls-remote','origin','refs/heads/main']).trim().split(/\s/)[0],f.pedido.expectedDestination);
    assert.equal(lerLedger(dirThread(f.raiz,f.id)).some(e=>e.tipo==='ship_done'),false);
  }));
}


test('SHIP MCP: gitlink entrante recusa antes de diff/checkout/merge',async()=>fixture(async f=>{
  f.git(['update-index','--add','--cacheinfo','160000,'+f.pedido.expectedSource+',submodulo'],f.wt);
  f.git(['commit','-m','gitlink da contraprova'],f.wt);f.pedido.expectedSource=f.git(['rev-parse','HEAD'],f.wt).trim();
  const r=await shipMcp(criarPerfilShipMcp(f.raiz,'bare-local'),f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/gitlink/);
  assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
  assert.equal(f.git(['ls-remote','origin','refs/heads/main']).trim().split(/\s/)[0],f.pedido.expectedDestination);
}));


for(const depois of [false,true]) {
  test(`SHIP MCP: duas URLs origin ${depois?'após startup':'no startup'} recusadas sem tocar bares`,async()=>fixture(async f=>{
    const segundo=dirTemporario('mcp-ship-origin-segundo');
    try {
      f.git(['init','--bare','-b','main',segundo]);
      f.git(['push',segundo,'refs/heads/main:refs/heads/main']);
      const antes1=f.git(['rev-parse','refs/heads/main'],f.remoto).trim();
      const antes2=f.git(['rev-parse','refs/heads/main'],segundo).trim();
      const perfil=depois?criarPerfilShipMcp(f.raiz,'bare-local'):null;
      f.git(['config','--add','remote.origin.url',segundo]);
      const config=fs.readFileSync(path.join(f.raiz,'.git/config'));
      if(perfil) {
        const r=await shipMcp(perfil,f.pedido);assert.equal(r.ok,false);assert.match(r.erro!,/transport.urls/);
      } else assert.throws(()=>criarPerfilShipMcp(f.raiz,'bare-local'),/transport.urls/);
      assert.equal(f.git(['rev-parse','refs/heads/main'],f.remoto).trim(),antes1);
      assert.equal(f.git(['rev-parse','refs/heads/main'],segundo).trim(),antes2);
      assert.equal(f.git(['rev-parse','main']).trim(),f.pedido.expectedDestination);
      assert.deepEqual(fs.readFileSync(path.join(f.raiz,'.git/config')),config);
      assert.equal(lerLedger(dirThread(f.raiz,f.id)).some(e=>e.tipo==='ship_done'),false);
    } finally {fs.rmSync(segundo,{recursive:true,force:true});}
  }));
}
