import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario, commitar } from './apoio';
import { novaThread } from '../src/thread';
import { adquirirRegiao } from '../src/leases';
import { prepararAtivacao, ativarEscrita, desativarEscrita, hashAtivacao, lerAtivacao, exigirAtivacao, diagnosticarAtivacao } from '../src/write-activation';

export function aceiteSintetico(c: ReturnType<typeof projetoTemporario>['carregado'], id: string, perfil: 'fabrica'|'integral'='fabrica') {
  const plano=prepararAtivacao(c,[id],['pulse','memory'],perfil),planoJson=JSON.stringify(plano)+'\n';
  const planoSha256=hashAtivacao(planoJson);
  const aceiteJson=JSON.stringify({schema:'ork.write-acceptance/v1',aprovado:true,fase:'CHECK',revisor:'fixture-reviewer',
    planoSha256,head:plano.head,tenant:plano.tenant,perfil})+'\n';
  return {planoJson,planoSha256,aceiteJson,aceiteSha256:hashAtivacao(aceiteJson),operadora:id,por:'fixture-executor'};
}

test('ativacao exige escopo, hashes, aceite e leases; disable preserva recibos e dados', t => {
  const p=projetoTemporario('write-activation');t.after(p.limpar);
  const id=novaThread(p.carregado,{nome:'synthetic',modo:'auto'}).thread.id;
  assert.equal(lerAtivacao(p.carregado).ativa,false);
  const op=aceiteSintetico(p.carregado,id);
  assert.equal(lerAtivacao(p.carregado).ativa,false,'preparar nao ativa');
  assert.throws(()=>ativarEscrita(p.carregado,{...op,planoSha256:'0'.repeat(64)}),/hash-mismatch/);
  const badAceite=JSON.stringify({...JSON.parse(op.aceiteJson),aprovado:false});
  assert.throws(()=>ativarEscrita(p.carregado,{...op,aceiteJson:badAceite,aceiteSha256:hashAtivacao(badAceite)}),/acceptance-required/);
  assert.throws(()=>ativarEscrita(p.carregado,op),/lease-required/);
  for(const nome of ['path:.orkastery/monitor','worktree-write:'+id]) assert.equal(adquirirRegiao(p.dir,nome,{thread:id,motivo:'synthetic test'}).ok,true);
  const active=ativarEscrita(p.carregado,op);assert.equal(active.ativa,true);
  const original=fs.readFileSync(active.recibo);
  fs.appendFileSync(active.recibo,' ');
  assert.throws(()=>lerAtivacao(p.carregado),/receipt-invalid/);
  fs.writeFileSync(active.recibo,original);
  const tenant=p.carregado.manifesto.memory.tenant;p.carregado.manifesto.memory.tenant='another-tenant';
  assert.throws(()=>lerAtivacao(p.carregado),/plan-context/);p.carregado.manifesto.memory.tenant=tenant;
  assert.equal(exigirAtivacao(p.carregado,id,'memory').perfil,'fabrica');
  assert.throws(()=>exigirAtivacao(p.carregado,'outside','memory'),/scope-denied/);
  assert.throws(()=>ativarEscrita(p.carregado,op),/state-conflict/);
  const state=path.join(p.dir,'.orkastery/monitor/write-activation.json');
  const before=fs.readFileSync(state);
  assert.throws(()=>desativarEscrita(p.carregado,id,'fixture','0'.repeat(64)),/state-conflict/);
  const off=desativarEscrita(p.carregado,id,'fixture',hashAtivacao(before));assert.equal(off.ativa,false);
  assert.equal(lerAtivacao(p.carregado).ativa,false);assert.deepEqual(fs.readFileSync(active.recibo),original);
  assert.equal(fs.readdirSync(path.dirname(active.recibo)).length,2);
});

test('CLI plan/status nao ativam e plano de HEAD ou tenant diferente e recusado sem estado novo', t => {
  const p=projetoTemporario('activation-cli');t.after(p.limpar);
  const id=novaThread(p.carregado,{nome:'synthetic',modo:'auto'}).thread.id;
  const cli=path.resolve(__dirname,'../src/index.js'),file=path.join(p.dir,'plan.json');
  const r=spawnSync(process.execPath,[cli,'activation','plan','--escopo',id,'--alvos','pulse,memory','--perfil','fabrica','--saida',file],
    {cwd:p.dir,encoding:'utf8',env:{PATH:process.env.PATH,HOME:p.dir},timeout:10000});
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).ativa,false);
  assert.equal(hashAtivacao(fs.readFileSync(file)),JSON.parse(r.stdout).sha256);
  assert.equal(lerAtivacao(p.carregado).ativa,false);
  const op=aceiteSintetico(p.carregado,id);
  commitar(p.dir,'new.txt','new code','synthetic rebuild publication');
  assert.throws(()=>ativarEscrita(p.carregado,op),/plan-context/);
  assert.equal(lerAtivacao(p.carregado).ativa,false);
  assert.throws(()=>prepararAtivacao(p.carregado,['ork-grandeevoluc'],['memory'],'fabrica'),/protected/);
});

test('troca dos bytes do runtime instalado invalida plano no mesmo HEAD do projeto', t => {
  const p=projetoTemporario('activation-runtime');t.after(p.limpar);
  const id=novaThread(p.carregado,{nome:'synthetic',modo:'auto'}).thread.id;
  const runtime=path.join(p.dir,'runtime');fs.mkdirSync(runtime);
  fs.symlinkSync(path.resolve(__dirname,'../../node_modules'),path.join(runtime,'node_modules'),'dir');
  const core=path.resolve(__dirname,'../src');fs.cpSync(core,path.join(runtime,'dist'),{recursive:true});
  fs.cpSync(path.resolve(__dirname,'../../assets'),path.join(runtime,'assets'),{recursive:true});
  fs.cpSync(path.resolve(__dirname,'../../../monitor'),path.join(runtime,'monitor'),{recursive:true});
  fs.cpSync(path.resolve(__dirname,'../../schemas'),path.join(runtime,'schemas'),{recursive:true});
  const api=require(path.join(runtime,'dist/write-activation.js'));
  const plano=api.prepararAtivacao(p.carregado,[id],['memory'],'fabrica');
  const before=api.hashRuntimeAtivacao();fs.appendFileSync(path.join(runtime,'assets/orkmind_bridge.py'),'\n# synthetic installed code change\n');
  assert.notEqual(api.hashRuntimeAtivacao(),before);
  const planoJson=JSON.stringify(plano)+'\n',planoSha256=hashAtivacao(planoJson);
  const aceiteJson=JSON.stringify({schema:'ork.write-acceptance/v1',aprovado:true,fase:'CHECK',revisor:'fixture-reviewer',planoSha256,
    head:plano.head,tenant:plano.tenant,perfil:'fabrica'})+'\n';
  assert.throws(()=>api.ativarEscrita(p.carregado,{planoJson,planoSha256,aceiteJson,aceiteSha256:hashAtivacao(aceiteJson),operadora:id,por:'fixture'}),/plan-context/);
  assert.equal(api.lerAtivacao(p.carregado).ativa,false);
});

/** Copia isolada do runtime instalado; nenhuma escrita na arvore da worktree. */
function runtimeIsolado(dir: string) {
  const runtime=path.join(dir,'runtime');fs.mkdirSync(runtime,{recursive:true});
  fs.symlinkSync(path.resolve(__dirname,'../../node_modules'),path.join(runtime,'node_modules'),'dir');
  fs.cpSync(path.resolve(__dirname,'../src'),path.join(runtime,'dist'),{recursive:true});
  fs.cpSync(path.resolve(__dirname,'../../assets'),path.join(runtime,'assets'),{recursive:true});
  fs.cpSync(path.resolve(__dirname,'../../../monitor'),path.join(runtime,'monitor'),{recursive:true});
  fs.cpSync(path.resolve(__dirname,'../../schemas'),path.join(runtime,'schemas'),{recursive:true});
  return {runtime,api:require(path.join(runtime,'dist/write-activation.js'))};
}

test('hash do runtime cobre alteracao, inclusao e remocao em subdiretorio aninhado', t => {
  const p=projetoTemporario('activation-runtime-recursivo');t.after(p.limpar);
  const id=novaThread(p.carregado,{nome:'synthetic',modo:'auto'}).thread.id;
  const {runtime,api}=runtimeIsolado(p.dir);
  const adapters=path.join(runtime,'dist/adapters');fs.mkdirSync(adapters,{recursive:true});
  const existente=path.join(adapters,'codex.js');fs.writeFileSync(existente,'// adaptador sintetico\n');
  const plano=api.prepararAtivacao(p.carregado,[id],['memory'],'fabrica');
  const base=api.hashRuntimeAtivacao();
  assert.equal(api.hashRuntimeAtivacao(),base,'hash deterministico entre duas leituras iguais');

  fs.appendFileSync(existente,'// alteracao sintetica em nivel aninhado\n');
  const alterado=api.hashRuntimeAtivacao();
  assert.notEqual(alterado,base,'alterar core/dist/adapters muda o hash do runtime');

  const novo=path.join(adapters,'sintetico.js');fs.writeFileSync(novo,'// adaptador novo sintetico\n');
  const incluido=api.hashRuntimeAtivacao();
  assert.notEqual(incluido,alterado,'incluir arquivo aninhado muda o hash do runtime');
  fs.unlinkSync(novo);
  assert.equal(api.hashRuntimeAtivacao(),alterado,'remover o arquivo novo restaura exatamente o hash anterior');

  fs.unlinkSync(existente);
  const removido=api.hashRuntimeAtivacao();
  assert.notEqual(removido,alterado,'remover arquivo aninhado muda o hash do runtime');
  assert.notEqual(removido,base);

  const profundo=path.join(runtime,'dist/adapters/interno');fs.mkdirSync(profundo,{recursive:true});
  fs.writeFileSync(path.join(profundo,'codex.js'),'// adaptador sintetico\n');
  const movido=api.hashRuntimeAtivacao();
  assert.notEqual(movido,base,'mesmo conteudo em caminho diferente nao reproduz o hash original');

  const planoJson=JSON.stringify(plano)+'\n',planoSha256=hashAtivacao(planoJson);
  const aceiteJson=JSON.stringify({schema:'ork.write-acceptance/v1',aprovado:true,fase:'CHECK',revisor:'fixture-reviewer',
    planoSha256,head:plano.head,tenant:plano.tenant,perfil:'fabrica'})+'\n';
  assert.throws(()=>api.ativarEscrita(p.carregado,{planoJson,planoSha256,aceiteJson,
    aceiteSha256:hashAtivacao(aceiteJson),operadora:id,por:'fixture'}),/plan-context/,
    'mudanca aninhada invalida o aceite com o HEAD do projeto parado');
  assert.equal(api.lerAtivacao(p.carregado).ativa,false);

  fs.symlinkSync('/etc/hostname',path.join(adapters,'link.js'));
  assert.throws(()=>api.hashRuntimeAtivacao(),/runtime-invalid/,'link simbolico no runtime recusa em vez de ser ignorado');
  fs.unlinkSync(path.join(adapters,'link.js'));
  const semExtensao=path.join(runtime,'dist/adapters-externo');
  fs.symlinkSync(path.resolve(__dirname,'../src'),semExtensao);
  assert.throws(()=>api.hashRuntimeAtivacao(),/runtime-invalid/,
    'link com nome de diretorio e sem extensao tambem recusa, nao e ignorado pelo filtro de extensao');
  fs.unlinkSync(semExtensao);
  fs.symlinkSync(path.join(runtime,'assets/orkmind_bridge.py'),path.join(runtime,'dist/ponte-sem-extensao'));
  assert.throws(()=>api.hashRuntimeAtivacao(),/runtime-invalid/,'link para arquivo, sem extensao, tambem recusa');
  fs.unlinkSync(path.join(runtime,'dist/ponte-sem-extensao'));
  assert.equal(api.hashRuntimeAtivacao(),movido,'remover os links restaura exatamente o hash anterior');

  let fundo=path.join(runtime,'dist');
  for(let nivel=0;nivel<9;nivel++){fundo=path.join(fundo,'n'+nivel);fs.mkdirSync(fundo);}
  fs.writeFileSync(path.join(fundo,'fundo.js'),'// profundo demais\n');
  assert.throws(()=>api.hashRuntimeAtivacao(),/runtime-invalid/,'profundidade acima do limite recusa em vez de truncar');
});

test('status diagnostica contexto invalido, entrega o hash do estado e permite rollback pela CLI', t => {
  const p=projetoTemporario('activation-rollback');t.after(p.limpar);
  const id=novaThread(p.carregado,{nome:'synthetic',modo:'auto'}).thread.id;
  const cli=path.resolve(__dirname,'../src/index.js');
  const ork=(args: string[])=>spawnSync(process.execPath,[cli,...args],
    {cwd:p.dir,encoding:'utf8',env:{PATH:process.env.PATH,HOME:p.dir},timeout:20000});
  const inativo=ork(['activation','status']);
  assert.equal(inativo.status,0,inativo.stderr);
  assert.equal(JSON.parse(inativo.stdout).motivo,'write.activation.inactive');

  for(const nome of ['path:.orkastery/monitor','worktree-write:'+id]) assert.equal(adquirirRegiao(p.dir,nome,{thread:id,motivo:'synthetic test'}).ok,true);
  const active=ativarEscrita(p.carregado,aceiteSintetico(p.carregado,id));
  const recibos=path.dirname(active.recibo),bytesRecibo=fs.readFileSync(active.recibo);
  const ativo=JSON.parse(ork(['activation','status']).stdout);
  assert.equal(ativo.ativa,true);assert.equal(ativo.motivo,'write.activation.enabled');

  commitar(p.dir,'novo.txt','codigo novo','synthetic rebuild publication');
  const aposHead=ork(['activation','status']);
  assert.equal(aposHead.status,0,aposHead.stderr);
  const diagnostico=JSON.parse(aposHead.stdout);
  assert.equal(diagnostico.ativa,false);
  assert.equal(diagnostico.motivo,'write.activation.plan-context');
  assert.equal(diagnostico.plano,null);
  assert.equal(diagnostico.estadoSha256,hashAtivacao(fs.readFileSync(path.join(p.dir,'.orkastery/monitor/write-activation.json'))));
  assert.throws(()=>exigirAtivacao(p.carregado,id,'memory'),/plan-context/,'escrita continua recusada no estado diagnosticado');
  assert.deepEqual(fs.readFileSync(active.recibo),bytesRecibo);

  const tenant=p.carregado.manifesto.memory.tenant;p.carregado.manifesto.memory.tenant='outro-tenant';
  const drift=diagnosticarAtivacao(p.carregado);
  assert.equal(drift.ativa,false);assert.equal(drift.motivo,'write.activation.plan-context');
  assert.equal(drift.estadoSha256,diagnostico.estadoSha256,'manifesto alterado nao muda o hash do estado privado');
  p.carregado.manifesto.memory.tenant=tenant;

  const conflito=ork(['activation','disable','--operadora',id,'--por','executor','--estado-sha256','0'.repeat(64)]);
  assert.equal(conflito.status,1);assert.match(conflito.stderr,/state-conflict/);
  const off=ork(['activation','disable','--operadora',id,'--por','executor','--estado-sha256',diagnostico.estadoSha256]);
  assert.equal(off.status,0,off.stderr);
  const repetido=ork(['activation','disable','--operadora',id,'--por','executor','--estado-sha256',diagnostico.estadoSha256]);
  assert.equal(repetido.status,1,'CAS concorrente recusa o hash ja consumido');
  assert.match(repetido.stderr,/state-conflict/);

  const depois=ork(['activation','status']);
  assert.equal(depois.status,0,depois.stderr);
  assert.equal(JSON.parse(depois.stdout).ativa,false);
  assert.equal(JSON.parse(depois.stdout).motivo,'write.activation.disabled');
  assert.deepEqual(fs.readFileSync(active.recibo),bytesRecibo,'disable preserva o recibo anterior byte a byte');
  assert.equal(fs.readdirSync(recibos).length,2,'recibo compensatorio e acrescentado, nada e apagado');

  const estado=path.join(p.dir,'.orkastery/monitor/write-activation.json');
  const corpo=fs.readFileSync(estado);fs.unlinkSync(estado);
  fs.symlinkSync(path.join(p.dir,'ausente.json'),estado);
  const inseguro=ork(['activation','status']);
  assert.equal(inseguro.status,1);
  assert.match(inseguro.stderr,/write.activation.artifact-invalid/);
  assert.equal(inseguro.stdout,'','estado inseguro nao imprime corpo algum');
  fs.unlinkSync(estado);fs.writeFileSync(estado,corpo,{mode:0o644});
  const modo=ork(['activation','status']);
  assert.equal(modo.status,1);assert.match(modo.stderr,/write.activation.artifact-invalid/);
  assert.equal(modo.stdout,'');
});

test('troca dos bytes do runtime instalado sai como diagnostico, nao como estado ilegivel', t => {
  const p=projetoTemporario('activation-runtime-status');t.after(p.limpar);
  const id=novaThread(p.carregado,{nome:'synthetic',modo:'auto'}).thread.id;
  const {runtime,api}=runtimeIsolado(p.dir);
  for(const nome of ['path:.orkastery/monitor','worktree-write:'+id]) assert.equal(adquirirRegiao(p.dir,nome,{thread:id,motivo:'synthetic test'}).ok,true);
  const plano=api.prepararAtivacao(p.carregado,[id],['pulse','memory'],'fabrica');
  const planoJson=JSON.stringify(plano)+'\n',planoSha256=hashAtivacao(planoJson);
  const aceiteJson=JSON.stringify({schema:'ork.write-acceptance/v1',aprovado:true,fase:'CHECK',revisor:'fixture-reviewer',
    planoSha256,head:plano.head,tenant:plano.tenant,perfil:'fabrica'})+'\n';
  const active=api.ativarEscrita(p.carregado,{planoJson,planoSha256,aceiteJson,aceiteSha256:hashAtivacao(aceiteJson),operadora:id,por:'fixture'});
  assert.equal(api.diagnosticarAtivacao(p.carregado).ativa,true);
  fs.appendFileSync(path.join(runtime,'dist/adapters/claude-bg.js'),'\n// troca sintetica do pacote instalado\n');
  const diagnostico=api.diagnosticarAtivacao(p.carregado);
  assert.equal(diagnostico.ativa,false);
  assert.equal(diagnostico.motivo,'write.activation.plan-context');
  assert.ok(/^[a-f0-9]{64}$/.test(diagnostico.estadoSha256));
  assert.throws(()=>api.exigirAtivacao(p.carregado,id,'pulse'),/plan-context/);
  const off=api.desativarEscrita(p.carregado,id,'fixture',diagnostico.estadoSha256);
  assert.equal(off.ativa,false);
  assert.equal(api.diagnosticarAtivacao(p.carregado).motivo,'write.activation.disabled');
  assert.equal(fs.readdirSync(path.dirname(active.recibo)).length,2);
});
