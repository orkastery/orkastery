/**
 * FX2: `retry` e `ship` reconferem o MAC da aprovacao humana.
 *
 * `aprovacoesHumanas` decidia por FORMA: campos presentes e `recibo` com cara de sha256.
 * Quem escrevesse uma linha no `ledger.jsonl` fabricava uma aprovacao que autorizava retry e
 * ship, porque nenhum dos dois chamava `validarEvidenciaDoIngresso`. Cada canal ja sabia
 * revalidar o proprio recibo; ninguem chamava essas funcoes no caminho que autoriza.
 *
 * Tudo aqui e SIMULADO: nao ha Telegram, conexao MCP nem humano.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { abrirPedidoGate, assinaturaDaResposta, responderGate, RespostaHumana } from '../src/hitl-gates';
import { criarIngressoLocal } from '../src/hitl-local';
import { aprovacaoHumanaProvada, aprovacoesHumanas } from '../src/gates';
import { EventoLedger } from '../src/types';

const CHAVE = 'chave-SIMULADA-exclusiva-da-aprovacao-provada';

function ambiente(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  [CHAVE, '42', '-7'].forEach((v, i) => { process.env[nomes[i]] = v; });
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

function gate(p: ProjetoDeTeste, nome: string) {
  const t = novaThread(p.carregado, { nome, modo: 'classic' }).thread;
  registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture SIMULADA' });
  return { t, pedido: abrirPedidoGate(p.dir, t.id) };
}

/** Reescreve a linha do `human_gate` no disco, como faria quem tivesse acesso ao ledger. */
function adulterar(dir: string, mudanca: Record<string, unknown>): EventoLedger {
  const arquivo = path.join(dir, 'ledger.jsonl');
  const linhas = fs.readFileSync(arquivo, 'utf8').trimEnd().split('\n').map(l => JSON.parse(l) as EventoLedger);
  const i = linhas.findIndex(l => l.tipo === 'human_gate');
  linhas[i] = { ...linhas[i], ...mudanca };
  fs.writeFileSync(arquivo, linhas.map(l => JSON.stringify(l)).join('\n') + '\n');
  return linhas[i];
}

test('FX2: aprovacao de telegram com recibo adulterado deixa de autorizar', () => {
  const p = projetoTemporario('aprovacao-telegram'), restaurar = ambiente();
  try {
    const { t, pedido } = gate(p, 'gate telegram');
    const base: Omit<RespostaHumana, 'prova'> = { resposta: '1', origem: 'telegram', canal: 'hermes',
      por: 'telegram:42', mensagem: 'telegram:-7:prova', recebidoEm: new Date().toISOString() };
    responderGate(p.dir, t.id, pedido.id, { ...base, prova: assinaturaDaResposta(t.id, pedido.id, base, CHAVE) });
    const dir = dirThread(p.dir, t.id);
    const original = lerLedger(dir).find(e => e.tipo === 'human_gate')!;
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 1);
    assert.equal(aprovacaoHumanaProvada(p.dir, t.id, original), true);

    // A FORMA continua perfeita em todas as adulteracoes abaixo; so a PROVA cai.
    const conteudoOriginal = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8');
    for (const mudanca of [
      { recibo: 'a'.repeat(64) },
      { autorizadoPor: 'telegram:99' },
      { evidenciaSha256: 'b'.repeat(64) },
      { estado: 'aprovado', opcao: 2 },
      { canal: 'openclaw' },
      { recebidoEm: new Date(Date.now() + 5000).toISOString() },
    ]) {
      const falso = adulterar(dir, mudanca);
      assert.equal(aprovacaoHumanaProvada(p.dir, t.id, falso), false,
        `adulteracao passou: ${JSON.stringify(mudanca)}`);
      assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0, `adulteracao autorizou: ${JSON.stringify(mudanca)}`);
      fs.writeFileSync(path.join(dir, 'ledger.jsonl'), conteudoOriginal);
    }
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 1, 'o recibo intacto continua autorizando');

    // Bytes do ingresso duravel trocados no disco tambem derrubam a autorizacao.
    const evidencia = path.join(dir, 'hitl-ingress', path.basename(String(original.evidencia)));
    const bytes = fs.readFileSync(evidencia, 'utf8');
    const v = JSON.parse(bytes);
    v.dados.respostaSha256 = 'c'.repeat(64);
    fs.writeFileSync(evidencia, JSON.stringify(v), { mode: 0o600 });
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
    fs.writeFileSync(evidencia, bytes, { mode: 0o600 });
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 1);

    // Sem a credencial do canal no ambiente, nao ha como reconferir: nao autoriza.
    delete process.env.ORK_HITL_INGRESS_KEY_HERMES;
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
  } finally { restaurar(); p.limpar(); }
});

test('FX2: aprovacao inteiramente fabricada no ledger nunca autoriza', () => {
  const p = projetoTemporario('aprovacao-fabricada'), restaurar = ambiente();
  try {
    const { t, pedido } = gate(p, 'gate fabricado');
    const dir = dirThread(p.dir, t.id);
    // Uma linha com a forma exata que a checagem anterior aceitava, e nada por tras dela.
    const fabricado = registrar(dir, t.id, 'human_gate', { contrato: 'ork.hitl/v1', pedidoId: pedido.id,
      fase: 'GOAL', sobre: 'premissas', estado: 'aprovado', opcao: 1, origem: 'telegram',
      autorizadoPor: 'telegram:42', mensagem: 'telegram:-7:fabricado', recebidoEm: new Date().toISOString(),
      recibo: 'd'.repeat(64), source: 'human', canal: 'hermes', contratoResposta: 'ork.hitl-answer/v2',
      evidencia: `.orkastery/threads/${t.id}/hitl-ingress/inexistente.json`, evidenciaSha256: 'e'.repeat(64) });
    assert.equal(aprovacaoHumanaProvada(p.dir, t.id, fabricado), false);
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
  } finally { restaurar(); p.limpar(); }
});

test('FX2: aprovacao do canal MCP local tambem e reconferida pelo recibo assinado', async () => {
  const p = projetoTemporario('aprovacao-local');
  try {
    const { t, pedido } = gate(p, 'gate local');
    const i = criarIngressoLocal(p.dir, { host: 'codex', connectionId: 'conn-aprovacao' },
      async () => ({ action: 'accept', content: { opcao: '1' } }));
    await i.solicitar(t.id, pedido.id);
    const dir = dirThread(p.dir, t.id);
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 1);
    const conteudoOriginal = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8');
    for (const mudanca of [{ recibo: 'f'.repeat(64) }, { canal: 'claude-code' },
      { autorizadoPor: 'mcp-local:claude-code' }, { opcao: 2 }]) {
      adulterar(dir, mudanca);
      assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0, `adulteracao autorizou: ${JSON.stringify(mudanca)}`);
      fs.writeFileSync(path.join(dir, 'ledger.jsonl'), conteudoOriginal);
    }
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 1);
  } finally { p.limpar(); }
});
