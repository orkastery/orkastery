/** Clientes e escolhas exclusivamente SINTÉTICOS; nenhum veredito do dono real. */
import { test } from 'node:test';
import './sem-aviso-mocktimers';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { criarIngressoLocal, RespostaElicitation } from '../src/hitl-local';
import { abrirPedidoGate, responderGateLocal } from '../src/hitl-gates';
import { aprovacoesHumanas } from '../src/gates';
import { novaThread, dirThread, gravarThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { projetoTemporario } from './apoio';
import { autorizacaoDePush } from '../src/ship';
import { Fase } from '../src/types';
import { inventariarGatesHumanos } from '../src/memoria-humana';

function fixture(motivo = 'human.pending', quando?: string, fase: Fase = 'GOAL') {
  const p = projetoTemporario('hitl-local');
  const { thread } = novaThread(p.carregado, { nome: 'decisao sintetica MCP', modo: motivo === 'human.pending' ? 'classic' : 'auto' });
  thread.faseAtual = fase; gravarThread(p.dir, thread);
  registrar(dirThread(p.dir, thread.id), thread.id, motivo === 'human.pending' ? 'phase_result' : 'gate_blocked', { fase, motivo });
  const pedido = abrirPedidoGate(p.dir, thread.id, motivo, quando);
  return { p, thread, pedido };
}
const origem = { host: 'codex' as const, connectionId: 'FIXTURE_CLIENT_CONNECTION' };

test('cliente sintético: elicitation exata registra origem local e repetição apenas consulta', async () => {
  const { p, thread, pedido } = fixture(); let chamadas = 0;
  const ingresso = criarIngressoLocal(p.dir, origem, async recebido => {
    chamadas++; assert.deepEqual(recebido, pedido);
    return { action: 'accept', content: { opcao: '1' } };
  });
  try {
    const r = await ingresso.solicitar(thread.id, pedido.id);
    assert.equal(r.estado, 'aprovado'); assert.equal(r.repetida, false);
    assert.equal(r.publicacaoMemoria?.estado,'pendente');
    assert.equal((await ingresso.solicitar(thread.id, pedido.id)).repetida, true);
    const outro = criarIngressoLocal(p.dir, { ...origem, connectionId: 'OTHER_FIXTURE' }, async () => { throw new Error('não deve solicitar de novo'); });
    assert.equal((await outro.solicitar(thread.id, pedido.id)).repetida, true); outro.fechar();
    const gates = aprovacoesHumanas(p.dir, thread.id);
    assert.equal(gates.length, 1); assert.equal(chamadas, 1);
    assert.equal(gates[0].origem, 'mcp-local'); assert.equal(gates[0].source, 'human');
    assert.equal(gates[0].autorizadoPor, 'mcp-local:codex'); assert.equal(gates[0].conexao, origem.connectionId);
    assert.equal(gates[0].prova, undefined); assert.equal(gates[0].resposta, undefined);
    assert.match(String(gates[0].recibo), /^[a-f0-9]{64}$/);
    assert.match(String(gates[0].evidencia),/hitl-ingress-local/);assert.match(String(gates[0].evidenciaSha256),/^[a-f0-9]{64}$/);
    const recibo=fs.readFileSync(path.join(p.dir,String(gates[0].evidencia)),'utf8');
    assert.ok(!recibo.includes('"opcao":"1"'));assert.match(recibo,/"opcao":1/);
    assert.equal(inventariarGatesHumanos(p.carregado,thread.id).filter(g=>g.elegivel).length,1);
    assert.equal(autorizacaoDePush(p.dir, thread, { para: 'main' }).autorizado, false, 'aprovar objetivo não autoriza push Classic');
    registrar(dirThread(p.dir,thread.id),thread.id,'human_gate',{...gates[0],
      pedidoId:'00000000-0000-4000-8000-999999999999'});
    const inventario=inventariarGatesHumanos(p.carregado,thread.id);
    assert.equal(inventario.length,2);assert.equal(inventario.filter(g=>g.elegivel).length,1,
      'reutilizar recibo assinado em evento forjado não autentica outra decisão');
  } finally { ingresso.fechar(); p.limpar(); }
});

test('recibo local de recusa não pode ser reescrito no ledger como aprovação', async () => {
  const { p, thread, pedido } = fixture();
  const ingresso = criarIngressoLocal(p.dir, origem, async () => ({ action: 'accept', content: { opcao: '2' } }));
  try {
    const resposta = await ingresso.solicitar(thread.id, pedido.id);
    assert.equal(resposta.estado, 'recusado');
    assert.equal('evento' in resposta, false, 'a API MCP não expõe o evento interno em vereditos não aprovados');
    const arquivo = path.join(dirThread(p.dir, thread.id), 'ledger.jsonl');
    const linhas = fs.readFileSync(arquivo, 'utf8').trimEnd().split('\n');
    const i = linhas.findIndex(l => JSON.parse(l).tipo === 'human_gate');
    const gate = JSON.parse(linhas[i]); gate.estado = 'aprovado'; linhas[i] = JSON.stringify(gate);
    fs.writeFileSync(arquivo, linhas.join('\n') + '\n');
    const inventario = inventariarGatesHumanos(p.carregado, thread.id);
    assert.equal(inventario.length, 1);
    assert.equal(inventario[0].elegivel, false, 'estado invertido diverge do pedido e do recibo assinado');
  } finally { ingresso.fechar(); p.limpar(); }
});

test('gate local de evidências autoriza somente a transição prevista e recibos incompletos não contam', async () => {
  const { p, thread, pedido } = fixture('human.pending', undefined, 'CHECK');
  const ingresso = criarIngressoLocal(p.dir, origem, async () => ({ action: 'accept', content: { opcao: '1' } }));
  try {
    assert.equal(autorizacaoDePush(p.dir, thread, { para: 'main' }).autorizado, false);
    registrar(dirThread(p.dir, thread.id), thread.id, 'human_gate', { estado: 'aprovado', contrato: 'ork.hitl/v1',
      pedidoId: 'SIMULADO_INCOMPLETO', recibo: 'sem-prova', origem: 'mcp-local', source: 'human', sobre: 'push' });
    assert.equal(autorizacaoDePush(p.dir, thread, { para: 'main' }).autorizado, false);
    await ingresso.solicitar(thread.id, pedido.id);
    const r = autorizacaoDePush(p.dir, thread, { para: 'main' });
    assert.equal(r.autorizado, true); assert.equal(r.tipo, 'humano-antecipado');
    assert.equal(aprovacoesHumanas(p.dir, thread.id).length, 1);
  } finally { ingresso.fechar(); p.limpar(); }
});

test('argumentos JSON não são atestados locais e não registram gate', () => {
  const { p, thread, pedido } = fixture();
  try {
    for (const token of [null, '1', {}, { aprovado: true, opcao: '1', origem: 'mcp-local' }]) {
      assert.throws(() => responderGateLocal(p.dir, thread.id, pedido.id, token), /atestado-invalido/);
    }
    assert.equal(aprovacoesHumanas(p.dir, thread.id).length, 0);
  } finally { p.limpar(); }
});

test('evidência local recusa diretório redirecionado por symlink antes de registrar o gate', async () => {
  const { p, thread, pedido } = fixture();
  const externo = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-hitl-local-external-'));
  const pasta = path.join(dirThread(p.dir, thread.id), 'hitl-ingress-local');
  fs.symlinkSync(externo, pasta, 'dir');
  const ingresso = criarIngressoLocal(p.dir, origem, async () => ({ action: 'accept', content: { opcao: '1' } }));
  try {
    await assert.rejects(ingresso.solicitar(thread.id, pedido.id), /evidencia-invalida/);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter(e => e.tipo === 'human_gate').length, 0);
    assert.deepEqual(fs.readdirSync(externo), []);
  } finally {
    ingresso.fechar();
    fs.unlinkSync(pasta);
    fs.rmSync(externo, { recursive: true, force: true });
    p.limpar();
  }
});

test('cancelar e recusar formulário não se transformam em opções do pedido', async () => {
  for (const action of ['cancel', 'decline'] as const) {
    const { p, thread, pedido } = fixture();
    const ingresso = criarIngressoLocal(p.dir, origem, async () => ({ action }));
    try {
      assert.equal((await ingresso.solicitar(thread.id, pedido.id)).estado, 'pendente');
      assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter(e => e.tipo === 'human_gate').length, 0);
    } finally { ingresso.fechar(); p.limpar(); }
  }
});

test('fechar conexão cancela espera mesmo se cliente não responde; resposta tardia não aprova', async () => {
  const { p, thread, pedido } = fixture(); let responder!: (r: RespostaElicitation) => void;
  const ingresso = criarIngressoLocal(p.dir, origem, async () => new Promise(resolve => { responder = resolve; }));
  try {
    const promessa = ingresso.solicitar(thread.id, pedido.id);
    ingresso.fechar();
    assert.equal((await promessa).estado, 'pendente');
    responder({ action: 'accept', content: { opcao: '1' } }); await Promise.resolve();
    assert.equal(aprovacoesHumanas(p.dir, thread.id).length, 0);
    await assert.rejects(ingresso.solicitar(thread.id, pedido.id), /conexao-fechada/);
  } finally { ingresso.fechar(); p.limpar(); }
});

test('janela local de cinco minutos encerra espera sem resposta', async t => {
  const { p, thread, pedido } = fixture();
  const ingresso = criarIngressoLocal(p.dir, origem, async () => new Promise(() => {}));
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const promessa = ingresso.solicitar(thread.id, pedido.id); t.mock.timers.tick(300001);
    assert.equal((await promessa).estado, 'pendente');
    assert.equal(aprovacoesHumanas(p.dir, thread.id).length, 0);
  } finally { t.mock.timers.reset(); ingresso.fechar(); p.limpar(); }
});

test('cancelamento da chamada não fecha conexão nem aprova resposta tardia', async () => {
  const { p, thread, pedido } = fixture(); const cancel = new AbortController();
  let chamadas = 0;
  const ingresso = criarIngressoLocal(p.dir, origem, async () => {
    if (++chamadas === 1) return new Promise(() => {});
    return { action: 'accept', content: { opcao: '2' } };
  });
  try {
    const pendente = ingresso.solicitar(thread.id, pedido.id, cancel.signal); cancel.abort();
    assert.equal((await pendente).estado, 'pendente');
    assert.equal((await ingresso.solicitar(thread.id, pedido.id)).estado, 'recusado');
    assert.equal(aprovacoesHumanas(p.dir, thread.id).length, 0);
  } finally { ingresso.fechar(); p.limpar(); }
});

test('pedido vencido e contexto alterado não recebem aprovação local', async () => {
  const vencida = fixture('human.pending', '2020-01-01T00:00:00.000Z');
  const i = criarIngressoLocal(vencida.p.dir, origem, async () => { throw new Error('não deve apresentar'); });
  try { await assert.rejects(i.solicitar(vencida.thread.id, vencida.pedido.id), /pedido-expirado/); }
  finally { i.fechar(); vencida.p.limpar(); }
  const { p, thread, pedido } = fixture();
  const ingresso = criarIngressoLocal(p.dir, origem, async () => {
    thread.faseAtual = 'PLAN'; gravarThread(p.dir, thread);
    return { action: 'accept', content: { opcao: '1' } };
  });
  try {
    await assert.rejects(ingresso.solicitar(thread.id, pedido.id), /pedido-antigo/);
    assert.equal(aprovacoesHumanas(p.dir, thread.id).length, 0);
  } finally { ingresso.fechar(); p.limpar(); }
});

test('duas conexões concorrentes têm um único efeito e não mantêm lock enquanto perguntam', async () => {
  const { p, thread, pedido } = fixture();
  let primeira!: (r: RespostaElicitation) => void;
  const a = criarIngressoLocal(p.dir, origem, async () => new Promise(resolve => { primeira = resolve; }));
  const b = criarIngressoLocal(p.dir, { ...origem, connectionId: 'SECOND_FIXTURE' }, async () => ({ action: 'accept', content: { opcao: '2' } }));
  try {
    const pendente = a.solicitar(thread.id, pedido.id);
    await assert.rejects(a.solicitar(thread.id, pedido.id), /solicitacao-em-curso/);
    await assert.rejects(b.solicitar(thread.id, pedido.id), /hitl.channel.in-use/);
    primeira({ action: 'accept', content: { opcao: '1' } });
    const r = await pendente; assert.equal(r.repetida, false); assert.equal(r.estado, 'aprovado');
    const replay = await b.solicitar(thread.id, pedido.id);
    assert.equal(replay.repetida, true); assert.equal(replay.estado, 'aprovado');
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter(e => e.tipo === 'human_gate').length, 1);
  } finally { a.fechar(); b.fechar(); p.limpar(); }
});

test('reconhecimento de escalação não aprova policy e conteúdo extra é recusado', async () => {
  const { p, thread, pedido } = fixture('policy.violation');
  const ingresso = criarIngressoLocal(p.dir, origem, async () => ({ action: 'accept', content: { opcao: '1' } }));
  try {
    assert.equal((await ingresso.solicitar(thread.id, pedido.id)).estado, 'aguardando');
    assert.equal(aprovacoesHumanas(p.dir, thread.id).length, 0);
  } finally { ingresso.fechar(); p.limpar(); }
  const f = fixture();
  const ruim = criarIngressoLocal(f.p.dir, origem, async () => ({ action: 'accept', content: { opcao: '1', aprovado: true } }));
  try { await assert.rejects(ruim.solicitar(f.thread.id, f.pedido.id), /resposta-invalida/); }
  finally { ruim.fechar(); f.p.limpar(); }
});
