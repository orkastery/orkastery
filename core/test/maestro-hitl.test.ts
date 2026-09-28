import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { criarIngressoLocal } from '../src/hitl-local';
import { apresentarDecisao } from '../src/hitl-presentation';
import { PedidoHitl } from '../src/hitl-contract';
import { criarServidorMcp } from '../src/mcp-server';
import { registrarPedidoHitl } from '../src/hitl-gates';
import { lerLedger } from '../src/ledger';
import { novaThread, dirThread } from '../src/thread';
import { projetoTemporario } from './apoio';

function question(thread: string): PedidoHitl {
  return { contrato:'ork.hitl/v1', id:'e4fc66d8-2eb6-4126-9d12-5aee923151eb', thread,
    fase:'GOAL', modo:'classic', alvo:{tipo:'gate',sobre:'premissas'}, motivo:'human.pending',
    pergunta:'Aceitar as premissas revisadas?', recomendacao:'Confira o escopo e escolha Aprovar se estiver de acordo.',
    opcoes:[{numero:1,texto:'Aprovar',acao:'aprovar'},{numero:2,texto:'Esperar',acao:'esperar'}],
    criadoEm:new Date().toISOString(),prazo:new Date(Date.now()+60000).toISOString(),
    acaoPadraoAoExpirar:'esperar',respostaAceita:{tipo:'opcao',maxCaracteres:100},profundidade:'detalhada' };
}
test('apresentação sempre recomenda, conserva escolhas e esconde IDs internos', () => {
  const q=question('ork-fixture'), before=structuredClone(q), view=apresentarDecisao(q);
  assert.match(view.mensagem,/• Recomendo:/); assert.match(view.mensagem,/digite o número/);
  assert.ok(!view.mensagem.includes(q.id)); assert.ok(!view.mensagem.includes(q.thread));
  assert.deepEqual(view.escolhas,[{const:'1',title:'Aprovar'},{const:'2',title:'Esperar'}]);
  assert.deepEqual(q,before);
  q.alvo={tipo:'session',sessionId:q.id,runtime:'codex'}; q.respostaAceita.tipo='texto';
  assert.match(apresentarDecisao(q).mensagem,/texto “2”/);
  assert.throws(()=>apresentarDecisao({...q,recomendacao:''}));
});
test('diálogo nativo oferece rótulos sem resposta padrão; cancel não aprova e replay não elicita novamente', async () => {
  const p=projetoTemporario('maestro-hitl');
  const t=novaThread(p.carregado,{nome:'Usabilidade',modo:'classic'}).thread,q=question(t.id);
  registrarPedidoHitl(p.dir,q);
  const server=criarServidorMcp({projeto:p.dir,host:'codex'}),client=new Client({name:'fixture',version:'1'},{capabilities:{elicitation:{form:{}}}});
  const [ct,st]=InMemoryTransport.createLinkedPair();let calls=0,accept=false;
  client.setRequestHandler(ElicitRequestSchema,async req=>{
    calls++; assert.equal(req.params.mode,'form');
    if(req.params.mode!=='form')throw Error('form esperado');
    assert.ok(!req.params.message.includes(q.id));assert.ok(req.params.message.includes(q.recomendacao));
    const field=req.params.requestedSchema.properties.opcao;
    assert.deepEqual('oneOf' in field && field.oneOf,[{const:'1',title:'Aprovar'},{const:'2',title:'Esperar'}]);
    assert.ok(!('default' in field));
    return accept?{action:'accept',content:{opcao:'1'}}:{action:'cancel'};
  });
  try {
    await server.connect(st);await client.connect(ct);
    const call=()=>client.callTool({name:'ork_request_decision',arguments:{threadId:t.id,pedidoId:q.id}});
    assert.ok(!(await call()).isError);assert.ok(!lerLedger(dirThread(p.dir,t.id)).some(e=>e.tipo==='human_gate'));
    accept=true;assert.ok(!(await call()).isError);assert.ok(!(await call()).isError);
    assert.equal(calls,2);assert.equal(lerLedger(dirThread(p.dir,t.id)).filter(e=>e.tipo==='human_gate').length,1);
  } finally {await client.close();await server.close();p.limpar();}
});


test('seleção real impede duas conexões; cancelamento libera troca sem dupla aprovação', async () => {
  const p = projetoTemporario('maestro-channel-selection');
  const t = novaThread(p.carregado, { nome: 'Canal', modo: 'classic' }).thread, q = question(t.id);
  registrarPedidoHitl(p.dir, q);
  let release!: (value: { action: 'cancel' }) => void;
  const a = criarIngressoLocal(p.dir, { host: 'codex', connectionId: 'connection-a' }, () => new Promise(resolve => { release = resolve; }));
  const b = criarIngressoLocal(p.dir, { host: 'claude-code', connectionId: 'connection-b' }, async () => ({ action: 'accept', content: { opcao: '1' } }));
  try {
    const pending = a.solicitar(t.id, q.id);
    await assert.rejects(() => b.solicitar(t.id, q.id), /channel.in-use/);
    release({ action: 'cancel' }); await pending;
    assert.equal((await b.solicitar(t.id, q.id)).estado, 'aprovado');
    assert.equal((await a.solicitar(t.id, q.id)).repetida, true);
    const events = lerLedger(dirThread(p.dir, t.id));
    assert.equal(events.filter(e => e.tipo === 'human_gate').length, 1);
    assert.deepEqual(events.filter(e => e.tipo === 'hitl_channel_selected').map(e => e.canal), ['codex', 'claude-code']);
  } finally { a.fechar(); b.fechar(); p.limpar(); }
});
