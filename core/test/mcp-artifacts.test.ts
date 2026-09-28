import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {projetoTemporario} from './apoio';
import {novaThread,dirThread,gravarThread} from '../src/thread';
import {adquirirRegiao,lerLease} from '../src/leases';
import {lerArtefatoMcp,escreverArtefatoMcp,adicionarClaimMcp,listarClaimsMcp} from '../src/mcp-artifacts';

test('documentos MCP: revisao esperada, autoria agente, bloco e estado oficial preservados',()=>{
  const p=projetoTemporario('mcp-artifacts');
  try {
    const t=novaThread(p.carregado,{nome:'documentos',modo:'classic',criarWorktree:true}).thread;
    const dir=dirThread(p.dir,t.id),before=fs.readFileSync(path.join(dir,'thread.json'));
    const old=lerArtefatoMcp(p.dir,t.id,'goal');
    const r=escreverArtefatoMcp(p.dir,t.id,'goal','# Objetivo\n',old.sha256);
    assert.equal(r.reciboOficial,false);assert.equal(r.autoria,'agente');
    assert.equal(lerArtefatoMcp(p.dir,t.id,'goal').conteudo,'# Objetivo\n');
    assert.deepEqual(fs.readFileSync(path.join(dir,'thread.json')),before);
    assert.throws(()=>escreverArtefatoMcp(p.dir,t.id,'goal','stale',old.sha256),/stale/);
    assert.throws(()=>escreverArtefatoMcp(p.dir,t.id,'plan','prematuro',null),/phase/);
    assert.equal(lerLease(p.dir,`path:.orkastery/threads/${t.id}`),null);
    t.status='fechada';gravarThread(p.dir,t);
    assert.throws(()=>escreverArtefatoMcp(p.dir,t.id,'goal','fechada',r.sha256),/phase/);
  } finally {p.limpar();}
});
test('documentos MCP recusam links, tipos protegidos, tamanho e lease de outra operacao',()=>{
  const p=projetoTemporario('mcp-artifacts-deny');
  try {
    const t=novaThread(p.carregado,{nome:'negativos',modo:'auto'}).thread;
    const docs=path.join(dirThread(p.dir,t.id),'docs'),alvo=path.join(p.dir,'sentinela');fs.writeFileSync(alvo,'intacto');
    fs.mkdirSync(docs,{recursive:true});fs.rmSync(path.join(docs,'goal.md'),{force:true});fs.symlinkSync(alvo,path.join(docs,'goal.md'));
    assert.throws(()=>lerArtefatoMcp(p.dir,t.id,'goal'),/unsafe/);
    assert.throws(()=>escreverArtefatoMcp(p.dir,t.id,'goal','troca',null),/unsafe/);
    assert.equal(fs.readFileSync(alvo,'utf8'),'intacto');
    assert.throws(()=>escreverArtefatoMcp(p.dir,t.id,'ledger' as 'goal','x',null),/kind.invalid/);
    assert.throws(()=>escreverArtefatoMcp(p.dir,t.id,'plan','é'.repeat(70000),null),/too-large/);
    const nome=`path:.orkastery/threads/${t.id}`;
    const lease=adquirirRegiao(p.dir,nome,{thread:'outro',motivo:'fixture'}).lease;
    assert.throws(()=>escreverArtefatoMcp(p.dir,t.id,'plan','x',null),/lease.busy/);
    assert.deepEqual(lerLease(p.dir,nome),lease);
    fs.renameSync(docs,docs+'-real');fs.symlinkSync(p.dir,docs);
    assert.throws(()=>lerArtefatoMcp(p.dir,t.id,'plan'));
  } finally {p.limpar();}
});
test('claims MCP sao dados: shell nao executa e caminhos invalidos nao criam claim',()=>{
  const p=projetoTemporario('mcp-claims');
  try {
    const t=novaThread(p.carregado,{nome:'claims',modo:'auto'}).thread,alvo=path.join(p.dir,'nao-executar');
    const c=adicionarClaimMcp(p.dir,t.id,{arquivo:'sum.cjs',alegacao:'soma correta',verificar:[`touch '${alvo}'`]});
    assert.equal(c.estado,'pendente');assert.ok(!fs.existsSync(alvo));
    assert.equal(listarClaimsMcp(p.dir,t.id).length,1);
    for(const arquivo of ['../outro','/tmp/outro','.git/config','x/../../y'])
      assert.throws(()=>adicionarClaimMcp(p.dir,t.id,{arquivo,alegacao:'x',verificar:[]}),/path.invalid/);
    assert.equal(listarClaimsMcp(p.dir,t.id).length,1);
  } finally {p.limpar();}
});
for(const nome of ['thread.json','ledger.jsonl','claims.jsonl']) for(const tipo of ['symlink','hardlink'])
test(`claims MCP recusam ${tipo} em ${nome} antes de qualquer append`,()=>{
  const p=projetoTemporario('mcp-state-links');
  try {
    const t=novaThread(p.carregado,{nome:'estado',modo:'auto'}).thread,dir=dirThread(p.dir,t.id);
    const alvo=path.join(p.dir,'sentinela'),file=path.join(dir,nome);
    fs.writeFileSync(alvo,fs.existsSync(file)?fs.readFileSync(file):Buffer.from('sentinela\n'));
    const before=fs.readFileSync(alvo);
    fs.rmSync(file,{force:true});
    if(tipo==='symlink') fs.symlinkSync(alvo,file);else fs.linkSync(alvo,file);
    assert.throws(()=>adicionarClaimMcp(p.dir,t.id,{arquivo:'sum.cjs',alegacao:'x',verificar:['true']}),/mcp.state.unsafe/);
    assert.deepEqual(fs.readFileSync(alvo),before);
    if(nome!=='claims.jsonl') assert.equal(fs.existsSync(path.join(dir,'claims.jsonl')),false);
  } finally {p.limpar();}
});
test('MCP escrita recusa diretorio de leases e fila com links antes da aquisicao',()=>{
  const p=projetoTemporario('mcp-lease-links');
  try {
    const t=novaThread(p.carregado,{nome:'leases',modo:'auto'}).thread;
    const leases=path.join(p.dir,'.orkastery','leases'),externo=path.join(p.dir,'externo');
    fs.mkdirSync(externo);fs.rmSync(leases,{recursive:true,force:true});fs.symlinkSync(externo,leases);
    assert.throws(()=>escreverArtefatoMcp(p.dir,t.id,'goal','x',null),/mcp.state.unsafe/);
    assert.deepEqual(fs.readdirSync(externo),[]);
    fs.unlinkSync(leases);fs.mkdirSync(leases);
    const fila=path.join(externo,'fila.json');fs.writeFileSync(fila,'[]');fs.symlinkSync(fila,path.join(leases,'fila.json'));
    assert.throws(()=>adicionarClaimMcp(p.dir,t.id,{arquivo:'sum.cjs',alegacao:'x',verificar:['true']}),/mcp.state.unsafe/);
    assert.equal(fs.readFileSync(fila,'utf8'),'[]');
  } finally {p.limpar();}
});
