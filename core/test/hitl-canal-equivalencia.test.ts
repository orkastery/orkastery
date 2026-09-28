/** D12: os quatro canais precisam produzir recibo distinguivel. Tudo aqui e SIMULADO. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  abrirPedidoGate, assinaturaDaResposta, canalDoEnvelope, contratoDaResposta, responderGate, RespostaHumana,
} from '../src/hitl-gates';
import { validarEvidenciaDoIngresso } from '../src/hitl-ingress-receipt';
import { canalDaResposta } from '../src/hitl-canais';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { projetoTemporario } from './apoio';

const quando = '2026-09-16T01:00:00.000Z';
// FX1: uma chave POR CANAL. A global fica so para o envelope v1, que nao declara canal.
const chave = 'chave-exclusivamente-simulada-nos-testes-000';
const CHAVES: Record<string, string> = {
  '': chave,
  hermes: 'chave-SIMULADA-exclusiva-do-canal-hermes-0000',
  openclaw: 'chave-SIMULADA-exclusiva-do-canal-openclaw-00',
};

function ambiente() {
  const nomes = ['ORK_HITL_INGRESS_KEY', 'ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_INGRESS_KEY_OPENCLAW',
    'ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY = chave;
  process.env.ORK_HITL_INGRESS_KEY_HERMES = CHAVES.hermes;
  process.env.ORK_HITL_INGRESS_KEY_OPENCLAW = CHAVES.openclaw;
  process.env.ORK_HITL_OPENCLAW_ACCOUNT = CONTA;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

// FX5: so o OpenClaw tem conta homologada; nos demais canais declarar conta e recusado.
const CONTA = 'conta-SIMULADA-do-openclaw';
function envelope(thread: string, pedido: string, alteracao: Partial<RespostaHumana> = {}): RespostaHumana {
  const base = { resposta: '1', origem: 'telegram' as const, por: 'telegram:42',
    mensagem: 'telegram:-7:1', recebidoEm: quando, ...alteracao };
  const r = base.canal === 'openclaw' && base.conta === undefined ? { ...base, conta: CONTA } : base;
  return { ...r, prova: assinaturaDaResposta(thread, pedido, r, CHAVES[r.canal ?? ''] ?? chave) };
}

/** Uma thread nova por caso: mensagem do Telegram nao se repete entre pedidos. */
function gatePronto(p: ReturnType<typeof projetoTemporario>, nome: string) {
  const { thread: t } = novaThread(p.carregado, { nome, modo: 'classic' });
  registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
  return { t, pedido: abrirPedidoGate(p.dir, t.id, undefined, quando) };
}

const humanGate = (p: ReturnType<typeof projetoTemporario>, id: string) =>
  lerLedger(dirThread(p.dir, id)).find(e => e.tipo === 'human_gate')!;

test('D12: Hermes e OpenClaw deixam de produzir o mesmo recibo', () => {
  const p = projetoTemporario('canal-equivalencia'), restaurar = ambiente();
  try {
    const recibos = new Map<string, Record<string, unknown>>();
    for (const canal of ['hermes', 'openclaw'] as const) {
      const { t, pedido } = gatePronto(p, `gate ${canal}`);
      const r = envelope(t.id, pedido.id, { canal, mensagem: `telegram:-7:${canal}` });
      assert.equal(contratoDaResposta(r), 'ork.hitl-answer/v2');
      assert.equal(responderGate(p.dir, t.id, pedido.id, r, quando).estado, 'aprovado');
      const e = humanGate(p, t.id);
      assert.equal(e.canal, canal);
      assert.equal(e.contratoResposta, 'ork.hitl-answer/v2');
      // O corpo da resposta continua fora do recibo, como antes de D12.
      assert.equal(e.resposta, undefined);
      assert.equal(e.prova, undefined);
      assert.deepEqual(canalDaResposta(e), { canal, equivalencia: 'completa', motivo: '' });
      assert.equal(validarEvidenciaDoIngresso(p.dir, String(t.id), e), true);
      recibos.set(canal, e);
    }
    // O defeito que D12 conserta: antes, estes dois eventos eram indistinguiveis.
    const [h, o] = [recibos.get('hermes')!, recibos.get('openclaw')!];
    assert.notEqual(h.canal, o.canal);
    assert.equal(h.origem, o.origem);
    assert.equal(h.autorizadoPor, o.autorizadoPor);
  } finally { restaurar(); p.limpar(); }
});

test('D12: envelope v1 continua valendo e nao ganha canal por inferencia', () => {
  const p = projetoTemporario('canal-legado'), restaurar = ambiente();
  try {
    const { t, pedido } = gatePronto(p, 'gate legado');
    const r = envelope(t.id, pedido.id);
    assert.equal(r.canal, undefined);
    assert.equal(contratoDaResposta(r), 'ork.hitl-answer/v1');
    assert.equal(responderGate(p.dir, t.id, pedido.id, r, quando).estado, 'aprovado');
    const e = humanGate(p, t.id);
    assert.equal(e.canal, null);
    assert.equal(e.contratoResposta, 'ork.hitl-answer/v1');
    assert.equal(e.origem, 'telegram');
    assert.equal(validarEvidenciaDoIngresso(p.dir, String(t.id), e), true);
    const lido = canalDaResposta(e);
    assert.equal(lido.canal, null);
    assert.equal(lido.equivalencia, 'legado');
  } finally { restaurar(); p.limpar(); }
});

test('D12: canal fora do registro, apelido e transporte errado sao recusados', () => {
  const p = projetoTemporario('canal-recusas'), restaurar = ambiente();
  try {
    const { t, pedido } = gatePronto(p, 'gate recusas');
    for (const canal of ['codex', 'claude-code'] as const) {
      assert.throws(() => responderGate(p.dir, t.id, pedido.id,
        envelope(t.id, pedido.id, { canal, mensagem: `telegram:-7:${canal}` }), quando),
        /transporte-divergente/);
    }
    for (const apelido of ['open-claw', 'claude', 'claudecode']) {
      assert.throws(() => responderGate(p.dir, t.id, pedido.id,
        envelope(t.id, pedido.id, { canal: apelido as 'hermes', mensagem: 'telegram:-7:apelido' }), quando),
        /hitl\.canal\./);
    }
    for (const invalido of ['telegram', 'mcp-local', 'inventado', '']) {
      assert.throws(() => responderGate(p.dir, t.id, pedido.id,
        envelope(t.id, pedido.id, { canal: invalido as 'hermes', mensagem: 'telegram:-7:x' }), quando),
        /hitl\.canal\.desconhecido/);
    }
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'human_gate').length, 0);
  } finally { restaurar(); p.limpar(); }
});

test('D12: assinatura de uma versao nao autentica a outra, nem canal trocado', () => {
  const p = projetoTemporario('canal-assinatura'), restaurar = ambiente();
  try {
    const { t, pedido } = gatePronto(p, 'gate assinatura');
    // v1 assinado, apresentado como v2: o canal nao estava no corpo assinado.
    const semCanal = envelope(t.id, pedido.id, { mensagem: 'telegram:-7:a' });
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...semCanal, canal: 'hermes' }, quando), /não autenticada/);
    // v2 assinado por hermes, apresentado como openclaw. FX5: a troca nem chega a
    // assinatura, porque o OpenClaw tem conta homologada e este envelope nao a prova.
    const comCanal = envelope(t.id, pedido.id, { canal: 'hermes', mensagem: 'telegram:-7:b' });
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...comCanal, canal: 'openclaw' }, quando), /conta-divergente/);
    // Com a conta certa colada por cima, a troca reprova pela assinatura, como antes.
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...comCanal, canal: 'openclaw', conta: CONTA }, quando), /não autenticada/);
    // E o inverso: v2 assinado por openclaw, apresentado como hermes.
    const doOpenclaw = envelope(t.id, pedido.id, { canal: 'openclaw', mensagem: 'telegram:-7:i' });
    const { conta: _semConta, ...comoHermes } = doOpenclaw;
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...comoHermes, canal: 'hermes' } as RespostaHumana, quando), /não autenticada/);
    // v2 assinado, apresentado sem canal.
    const { canal: _canal, ...semDeclaracao } = comCanal;
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      semDeclaracao as RespostaHumana, quando), /não autenticada/);
    assert.notEqual(assinaturaDaResposta(t.id, pedido.id, { ...semCanal, canal: 'hermes' }, chave),
      assinaturaDaResposta(t.id, pedido.id, semCanal, chave));
    // FX1: a chave de um canal nao autentica o outro, mesmo com o envelope inteiro correto.
    const comprometido = { resposta: '1', origem: 'telegram' as const, canal: 'openclaw' as const,
      conta: CONTA, por: 'telegram:42', mensagem: 'telegram:-7:c', recebidoEm: quando };
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...comprometido, prova: assinaturaDaResposta(t.id, pedido.id, comprometido, CHAVES.hermes) }, quando),
      /não autenticada/);
    // A chave global tambem nao serve para um envelope v2.
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...comprometido, mensagem: 'telegram:-7:d', prova: assinaturaDaResposta(t.id, pedido.id,
        { ...comprometido, mensagem: 'telegram:-7:d' }, chave) }, quando), /não autenticada/);
    // FX5: a conta tambem mudou o corpo assinado; um v2 sem ela nao autentica.
    const { conta: _conta, ...semConta } = comprometido;
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...semConta, mensagem: 'telegram:-7:e', prova: assinaturaDaResposta(t.id, pedido.id,
        { ...semConta, mensagem: 'telegram:-7:e' }, CHAVES.openclaw) }, quando), /conta-divergente/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'human_gate').length, 0);
  } finally { restaurar(); p.limpar(); }
});

test('D12: canalDoEnvelope e leitura pura e nao aceita apelido', () => {
  assert.equal(canalDoEnvelope({ origem: 'telegram' }), null);
  assert.equal(canalDoEnvelope({ origem: 'telegram', canal: 'hermes' }), 'hermes');
  assert.equal(canalDoEnvelope({ origem: 'telegram', canal: 'openclaw' }), 'openclaw');
  assert.throws(() => canalDoEnvelope({ origem: 'telegram', canal: 'open-claw' as 'openclaw' }), /desconhecido/);
  assert.throws(() => canalDoEnvelope({ origem: 'telegram', canal: 'codex' }), /transporte-divergente/);
});

test('FX5: o recibo duravel do OpenClaw prova a conta autorizada, nao so o transporte', () => {
  const p = projetoTemporario('canal-conta'), restaurar = ambiente();
  try {
    const { t, pedido } = gatePronto(p, 'gate conta');
    // Conta ausente num canal que tem conta: o envelope nao prova de onde a decisao veio.
    const semConta = { resposta: '1', origem: 'telegram' as const, canal: 'openclaw' as const,
      por: 'telegram:42', mensagem: 'telegram:-7:s', recebidoEm: quando };
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...semConta, prova: assinaturaDaResposta(t.id, pedido.id, semConta, CHAVES.openclaw) }, quando),
      /conta-divergente/);
    // Conta fora da allowlist do canal: assinada corretamente e mesmo assim recusada.
    const outraConta = { ...semConta, conta: 'conta-nao-autorizada', mensagem: 'telegram:-7:o' };
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...outraConta, prova: assinaturaDaResposta(t.id, pedido.id, outraConta, CHAVES.openclaw) }, quando),
      /conta-divergente/);
    // Canal sem conta homologada recusa envelope que traga conta, em vez de ignorar.
    const hermesComConta = { ...semConta, canal: 'hermes' as const, conta: CONTA, mensagem: 'telegram:-7:h' };
    assert.throws(() => responderGate(p.dir, t.id, pedido.id,
      { ...hermesComConta, prova: assinaturaDaResposta(t.id, pedido.id, hermesComConta, CHAVES.hermes) }, quando),
      /conta-inesperada/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'human_gate').length, 0);

    // Com a conta certa a decisao entra, e ela fica NO RECIBO e DENTRO do MAC.
    assert.equal(responderGate(p.dir, t.id, pedido.id,
      envelope(t.id, pedido.id, { canal: 'openclaw', mensagem: 'telegram:-7:ok' }), quando).estado, 'aprovado');
    const e = humanGate(p, t.id);
    assert.equal(e.conta, CONTA);
    assert.equal(validarEvidenciaDoIngresso(p.dir, String(t.id), e), true);
    // Trocar a conta no ledger derruba a revalidacao: ela esta dentro do corpo assinado.
    assert.equal(validarEvidenciaDoIngresso(p.dir, String(t.id), { ...e, conta: 'conta-nao-autorizada' }), false);
    // E trocar a conta AUTORIZADA no ambiente tambem: o recibo prova uma conta so.
    process.env.ORK_HITL_OPENCLAW_ACCOUNT = 'outra-conta-autorizada';
    assert.equal(validarEvidenciaDoIngresso(p.dir, String(t.id), e), false);
    process.env.ORK_HITL_OPENCLAW_ACCOUNT = CONTA;
    assert.equal(validarEvidenciaDoIngresso(p.dir, String(t.id), e), true);
  } finally { restaurar(); p.limpar(); }
});
