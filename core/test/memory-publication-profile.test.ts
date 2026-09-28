import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, gravarThread } from '../src/thread';
import { alvoDoPedido } from '../src/hitl-contract';
import { registrar } from '../src/ledger';
import { exigirManifesto } from '../src/manifest';
import { abrirMemoria, gravarPolicies, publicar } from '../src/memoria';
import { DriverEmMemoria } from '../src/orkmind';
import { exportarHandoff } from '../src/handoff';
import { adquirirRegiao } from '../src/leases';
import { hashAtivacao } from '../src/write-activation';
import { usingFixture, pythonFixture, fixtureEnv, assets } from './native-fixture';
import { abrirPedidoGate, RespostaHumana } from '../src/hitl-gates';
import { evidenciaDoIngresso, gravarIngresso } from '../src/hitl-ingress-receipt';

const fixtureDatabase = `
import asyncio,json,sys,uuid
sys.path.insert(0,sys.argv[1])
from orkmind_fixture import connect_fixture,fixture_dsn
from orkmind.core.config import OrkMindConfig
from orkmind.core.models import MemoryEntry
from orkmind.core.injection import compute_content_hash
from orkmind.store.factory import create_store
import psycopg
async def run():
 boot,r=await connect_fixture(sys.argv[2]);data=json.load(sys.stdin);op=data['op'];schema=data.get('schema','run_'+uuid.uuid4().hex)
 assert __import__('re').fullmatch('run_[a-f0-9]{32}',schema)
 dsn=psycopg.conninfo.make_conninfo(fixture_dsn(r),options=f'-c search_path={schema},public')
 try:
  if op=='setup':
   await boot.execute(psycopg.sql.SQL('CREATE SCHEMA {}').format(psycopg.sql.Identifier(schema)))
   store=create_store(OrkMindConfig(database_url=dsn,embedding_provider=''))
   try:
    await store.inner.initialize()
    for request in data['policies']:
     await store.store(MemoryEntry(**{**request,'metadata':{}},scope='project',mandatory=False,visibility='private',author_id=None,content_hash=compute_content_hash(request['content'])))
   finally:await store.close()
   print(json.dumps({'schema':schema,'dsn':dsn}))
  elif op=='cleanup':
   await boot.execute(psycopg.sql.SQL('DROP SCHEMA {} CASCADE').format(psycopg.sql.Identifier(schema)))
   print('{}')
  else:
   conn=await psycopg.AsyncConnection.connect(dsn,autocommit=True)
   try:
    if op=='state':tables=('memories','memory_versions')
    else:
     rows=await (await conn.execute("SELECT tablename FROM pg_tables WHERE schemaname=%s ORDER BY tablename",(schema,))).fetchall()
     tables=tuple(r[0] for r in rows)
     assert tables,'estado integral exige tabelas do schema da execucao'
    result={table:[row[0] for row in await (await conn.execute(psycopg.sql.SQL('SELECT to_jsonb(t) FROM {} t ORDER BY to_jsonb(t)::text').format(psycopg.sql.Identifier(table)))).fetchall()] for table in tables}
    print(json.dumps(result))
   finally:await conn.close()
 finally:await boot.close()
asyncio.run(run())
`;

test('perfil fabrica no CLI e PostgreSQL: C1..C4, ativacao explicita, legado intacto e sync integral honestamente falho', t => {
  const p=projetoTemporario('native-profile');t.after(p.limpar);
  const ingressKey='chave-sintetica-perfil-nativo-00000000',oldIngressKey=process.env.ORK_HITL_INGRESS_KEY;
  process.env.ORK_HITL_INGRESS_KEY=ingressKey;
  t.after(()=>oldIngressKey===undefined?delete process.env.ORK_HITL_INGRESS_KEY:process.env.ORK_HITL_INGRESS_KEY=oldIngressKey);
  const thread=novaThread(p.carregado,{nome:'synthetic-profile',modo:'classic'}).thread;
  thread.decisoes.push({id:'D1',texto:'Decisao sintetica de teste',locked:true,decididaEm:'2026-01-01T00:00:00Z',decididaPor:'fixture-executor'});
  gravarThread(p.dir,thread);
  const threadDir=dirThread(p.dir,thread.id);
  const recebidoEm='2026-09-12T20:00:00.000Z';
  registrar(threadDir,thread.id,'phase_result',{fase:'GOAL'});
  const pedido=abrirPedidoGate(p.dir,thread.id,'human.pending',recebidoEm),pedidoId=pedido.id;
  const resposta:RespostaHumana={resposta:'1',origem:'telegram',por:'telegram:42',mensagem:'telegram:-7:fixture',recebidoEm,
    prova:createHash('sha256').update('prova-sintetica-perfil-nativo').digest('hex')};
  gravarIngresso(p.dir,thread.id,pedidoId,resposta,recebidoEm);
  const evidencia=evidenciaDoIngresso(p.dir,thread.id,pedidoId,resposta),alvo=alvoDoPedido(pedido);
  registrar(threadDir,thread.id,'human_gate',{estado:'aprovado',source:'human',origem:'telegram',autorizadoPor:resposta.por,
    contrato:pedido.contrato,pedidoId,mensagem:resposta.mensagem,recebidoEm,recibo:createHash('sha256').update(resposta.prova).digest('hex'),
    sobre:alvo?.tipo==='gate'?alvo.sobre:'',fase:pedido.fase,opcao:1,evidencia:evidencia.arquivo,evidenciaSha256:evidencia.sha256});
  const handoff=exportarHandoff(p.carregado,thread.id,{proximaFase:'GOAL'});
  const original=fs.readFileSync(handoff.caminhoHistorico);
  const manifest=path.join(p.dir,'orkastery.yaml');
  fs.writeFileSync(manifest,fs.readFileSync(manifest,'utf8').replace('mode: files','mode: orkmind')
    .replace('database_url_env: ""','database_url_env: SYNTHETIC_NATIVE_FIXTURE'));
  p.carregado=exigirManifesto(p.dir);
  const capture=new DriverEmMemoria(),policies: any[]=[],add=capture.adicionar.bind(capture);
  capture.adicionar=e=>{policies.push(e);return add(e);};gravarPolicies(abrirMemoria(p.carregado,{driver:capture}),p.carregado.manifesto);
  usingFixture(receipt => {
    const db=(op: Record<string,unknown>): any => {
      const r=spawnSync(pythonFixture(),['-c',fixtureDatabase,assets,receipt],{input:JSON.stringify(op),encoding:'utf8',env:fixtureEnv(),timeout:20000});
      assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
    };
    const setup=db({op:'setup',policies});
    const env={...fixtureEnv(),LANG:'C.UTF-8',SYNTHETIC_NATIVE_FIXTURE:setup.dsn,ORK_HITL_INGRESS_KEY:ingressKey};
    const cli=(args: string[])=>spawnSync(process.execPath,[path.resolve(__dirname,'../src/index.js'),...args],{cwd:p.dir,env,encoding:'utf8',timeout:60000});
    const state=()=>db({op:'state',schema:setup.schema});
    /** Estado integral: todas as tabelas do schema desta execucao, nao apenas as duas conferidas antes. */
    const integral=()=>db({op:'integral',schema:setup.schema});
    const oldEnv=process.env.SYNTHETIC_NATIVE_FIXTURE;process.env.SYNTHETIC_NATIVE_FIXTURE=setup.dsn;
    try {
      const before=state();assert.equal(before.memories.length,3);
      const status=cli(['memory','status','--json']);assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).efetivo,'orkmind');
      const inactive=publicar(p.carregado,thread.id);assert.equal(inactive.publicacao?.estado,'pendente');assert.equal(inactive.falhas,1);
      exportarHandoff(p.carregado,thread.id,{proximaFase:'GOAL'});
      assert.deepEqual(state(),before,'abrir/publicar/exportar sem ativacao nao escreve no store');
      const denied=cli(['memory','sync',thread.id,'--perfil','fabrica','--json']);assert.equal(denied.status,1);assert.match(denied.stderr,/write.activation.inactive/);
      for(const nome of ['path:.orkastery/monitor','worktree-write:'+thread.id]) assert.equal(adquirirRegiao(p.dir,nome,{thread:thread.id,motivo:'synthetic activation test'}).ok,true);
      let sequence=0;
      const enable=(perfil: 'fabrica'|'integral')=>{
        const file=path.join(p.dir,`activation-${++sequence}.json`),accept=path.join(p.dir,`accept-${sequence}.json`);
        const plan=cli(['activation','plan','--escopo',thread.id,'--alvos','pulse,memory','--perfil',perfil,'--saida',file]);
        assert.equal(plan.status,0,plan.stderr);const info=JSON.parse(plan.stdout),body=JSON.parse(fs.readFileSync(file,'utf8'));
        const acceptance=JSON.stringify({schema:'ork.write-acceptance/v1',aprovado:true,fase:'CHECK',revisor:'synthetic-reviewer',
          planoSha256:info.sha256,head:body.head,tenant:body.tenant,perfil})+'\n';
        fs.writeFileSync(accept,acceptance,{mode:0o600});
        const r=cli(['activation','enable','--plano',file,'--plano-sha256',info.sha256,'--aceite',accept,'--aceite-sha256',hashAtivacao(acceptance),'--operadora',thread.id,'--por','synthetic-executor']);
        assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
      };
      const active=enable('fabrica');
      const sync=cli(['memory','sync',thread.id,'--perfil','fabrica','--json']);assert.equal(sync.status,0,sync.stderr+sync.stdout);
      const result=JSON.parse(sync.stdout);assert.deepEqual(result.colecoesForaDoPerfil,['rule','learning','roadmap']);
      assert.equal(result.policies.gravadas.length,0);assert.match(result.policies.detalhe,/fora do perfil/);
      assert.equal(result.humanos.elegiveis,1);assert.ok(result.handoff.ok);assert.equal(result.falhas,0);
      const saved=state();assert.deepEqual(saved.memories.filter((e:any)=>e.collection==='rule'),before.memories);
      assert.ok(saved.memories.some((e:any)=>e.collection==='decision'&&e.source==='human'&&e.metadata.proveniencia.confirmado));
      assert.ok(saved.memories.some((e:any)=>e.collection==='semantic_log'));
      const repeat=cli(['memory','sync',thread.id,'--perfil','fabrica','--json']);assert.equal(repeat.status,0,repeat.stderr);
      assert.deepEqual(state(),saved,'sync repetido preserva dados e versoes');
      const antesDaMigracao=integral();
      const migration=cli(['memory','migrate','--operadora',thread.id,'--escopo',thread.id,'--json']);assert.equal(migration.status,0,migration.stderr+migration.stdout);
      const migrated=JSON.parse(migration.stdout);assert.ok(migrated.resultados.length>0);
      assert.ok(migrated.resultados.every((r:any)=>r.readback.originalIntegral));
      const entreMigracoes=integral();
      const linhasDe=(estado: any,identidade: string)=>estado.memories.filter((e:any)=>e.metadata?.orkastery_identity===identidade);
      assert.ok(entreMigracoes.memories.length>antesDaMigracao.memories.length,'a primeira migracao publica pacote novo');
      for(const r of migrated.resultados) {
        const antes=linhasDe(antesDaMigracao,r.identidade),depois=linhasDe(entreMigracoes,r.identidade);
        assert.ok(depois.length>0,'identidade migrada esta no store apos a primeira migracao');
        // O sync do perfil ja publicou o handoff desta thread; a migracao encontra a identidade e
        // deduplica em vez de reescrever. Identidade nova aparece; identidade ja publicada nao muda.
        if(antes.length) assert.deepEqual(depois,antes,'identidade ja publicada pelo sync nao e duplicada nem alterada pela migracao');
      }
      assert.ok(migrated.resultados.some((r:any)=>linhasDe(antesDaMigracao,r.identidade).length===0),
        'ao menos uma identidade e publicada pela propria migracao, entao a comparacao seguinte nao e vazia');
      const again=cli(['memory','migrate','--operadora',thread.id,'--escopo',thread.id,'--json']);assert.equal(again.status,0,again.stderr);
      assert.equal(JSON.parse(again.stdout).replay,false,'nova operacao ainda relata suas tentativas');
      const depoisDaSegunda=integral();
      assert.deepEqual(Object.keys(depoisDaSegunda).sort(),Object.keys(entreMigracoes).sort());
      assert.deepEqual(depoisDaSegunda,entreMigracoes,
        'segunda migracao nao duplica, nao perde e nao altera conteudo em nenhuma tabela do store');
      for(const r of migrated.resultados) assert.deepEqual(linhasDe(depoisDaSegunda,r.identidade),linhasDe(entreMigracoes,r.identidade),
        'cada identidade G3 conserva exatamente as mesmas linhas apos a segunda migracao');
      const terceira=cli(['memory','migrate','--operadora',thread.id,'--escopo',thread.id,'--json']);
      assert.equal(terceira.status,0,terceira.stderr);
      assert.ok(JSON.parse(terceira.stdout).resultados.every((r:any)=>r.replay||r.readback?.originalIntegral),
        'readback do original continua integro nas repeticoes');
      assert.deepEqual(integral(),entreMigracoes,'terceira migracao tambem preserva o estado integral');
      assert.deepEqual(fs.readFileSync(handoff.caminhoHistorico),original);
      exportarHandoff(p.carregado,thread.id,{proximaFase:'GOAL'});
      const recall=cli(['recall',thread.id,'--fase','GOAL','--json']);assert.equal(recall.status,0,recall.stderr);
      assert.ok(JSON.parse(recall.stdout).resolvidos.some((r:any)=>r.via==='orkmind'),'recall recupera conteudo nativo por tags');
      const outside=novaThread(p.carregado,{nome:'outside',modo:'auto'}).thread.id;
      assert.equal(publicar(p.carregado,outside).publicacao?.estado,'pendente');
      const fullDenied=cli(['memory','sync',thread.id,'--json']);assert.equal(fullDenied.status,1);assert.match(fullDenied.stderr,/profile-denied/);
      enable('integral');
      const full=cli(['memory','sync',thread.id,'--json']);assert.equal(full.status,1,full.stderr+full.stdout);
      const fullResult=JSON.parse(full.stdout);assert.equal(fullResult.policies.falhas,3);
      assert.ok(fullResult.policies.gravadas.every((r:any)=>r.detalhe==='memory.legacy.provenance-collision'));
      assert.deepEqual(state().memories.filter((e:any)=>e.collection==='rule'),before.memories);
      const receiptBytes=fs.readFileSync(active.recibo),beforeDisable=state();
      const activationStatus=JSON.parse(cli(['activation','status']).stdout);
      const off=cli(['activation','disable','--operadora',thread.id,'--por','synthetic-executor','--estado-sha256',activationStatus.estadoSha256]);assert.equal(off.status,0,off.stderr);
      assert.equal(publicar(p.carregado,thread.id).publicacao?.estado,'pendente');
      assert.deepEqual(state(),beforeDisable);assert.deepEqual(fs.readFileSync(active.recibo),receiptBytes);
      console.log('NATIVE_PROFILE: tenant, G3, human provenance, migration readback, recall, explicit activation and durable disable; orphan rules unchanged');
    } finally {
      if(oldEnv===undefined)delete process.env.SYNTHETIC_NATIVE_FIXTURE;else process.env.SYNTHETIC_NATIVE_FIXTURE=oldEnv;
      db({op:'cleanup',schema:setup.schema});
    }
  });
});
