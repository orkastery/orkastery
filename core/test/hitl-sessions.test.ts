/** C3 integral em software. Runtime e envelope SIMULADOS; homologação real é separada. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { assinaturaDaResposta, comLockHitl } from '../src/hitl-gates';
import { abrirPedidoSessao, controleNativo, responderSessao, superarSessao } from '../src/hitl-sessions';
import { redespachar } from '../src/retry';
import { rodarFase } from '../src/phase';
import { varrerSessoes } from '../src/hitl';

test('C3 SIMULADO: despacho -> prompt exato -> resposta autenticada -> recibo/replay -> superação -> radar', () => {
  const p = projetoTemporario('hitl-sessions-integral'); const fake = controllerSimulado(p.dir);
  const nomes = ['ORK_HITL_INGRESS_KEY', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  const chave = 'segredo-SIMULADO-integracao-C3-00000000';
  [chave, '42', '-7'].forEach((v, i) => { process.env[nomes[i]] = v; });
  const t = novaThread(p.carregado, { nome: 'C3 integral', modo: 'auto' }).thread;
  t.faseAtual = 'GO'; gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id), prompt = path.join(dir, 'prompt-simulado.md');
  fs.writeFileSync(prompt, fake.prompt); const sha = createHash('sha256').update(fake.prompt).digest('hex');
  let sid: string | null = null;
  try {
    comLockHitl(p.dir, t.id, () => {
      assert.throws(() => redespachar(p.carregado, t, 'GO', prompt, sha, { runtime: 'codex', model: 'modelo-SIMULADO' }), /ocupado/);
      assert.throws(() => rodarFase(p.carregado, t.id, { fase: 'GO', prompt: fake.prompt, runtime: 'codex', model: 'modelo-SIMULADO' }), /ocupado/);
    });
    const despacho = redespachar(p.carregado, t, 'GO', prompt, sha, { runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(despacho.ok, true, despacho.detalhe); sid = despacho.sessionId!;
    const registrado = lerThread(p.dir, t.id).sessoes[0];
    assert.ok(registrado.controlador); assert.equal(registrado.promptSha256, sha);
    const ctl = controleNativo('codex', p.dir, t.id, sid);
    esperarCondicao(() => ctl.consultar().sessoes[0]?.estado === 'blocked');
    const radar = () => varrerSessoes({ raiz: p.dir, casa: path.join(p.dir, 'casa'), registrar: false,
      consulta: { ok: true, sessoes: [], detalhe: 'Claude SIMULADO vazio' }, soParadas: true });
    assert.equal(radar().sessoes[0].sessionId, sid);
    const pedido = abrirPedidoSessao(p.dir, t.id, sid, { fase: 'GO', runtime: 'codex', pergunta: 'Marcador SIMULADO?' });
    const r = { resposta: 'C3-SIMULADA-ç', origem: 'telegram' as const, por: 'telegram:42', mensagem: 'telegram:-7:8', recebidoEm: new Date().toISOString() };
    const envelope = { ...r, prova: assinaturaDaResposta(t.id, pedido.id, r, chave) };
    assert.throws(() => responderSessao(p.dir, t.id, pedido.id, { ...envelope, prova: '0'.repeat(64) }), /autenticada/);
    assert.equal(responderSessao(p.dir, t.id, pedido.id, envelope).repetida, false);
    assert.equal(responderSessao(p.dir, t.id, pedido.id, envelope).repetida, true);
    assert.equal(fs.readFileSync(path.join(fake.runtimeHome, 'recebido.jsonl'), 'utf8').trim().split('\n').length, 1);
    esperarCondicao(() => ctl.consultar().sessoes[0]?.estado === 'blocked');
    // Sucessora criada pelo mesmo caminho de despacho, em outro processo/UUID da fixture.
    const prompt2 = path.join(dir, 'sucessora.md'); fs.writeFileSync(prompt2, 'FINALIZAR-SIMULADO');
    const sha2 = createHash('sha256').update('FINALIZAR-SIMULADO').digest('hex');
    const sucessora = redespachar(p.carregado, lerThread(p.dir, t.id), 'GO', prompt2, sha2, { runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(sucessora.ok, true, sucessora.detalhe); assert.notEqual(sucessora.sessionId, sid);
    const ctl2 = controleNativo('codex', p.dir, t.id, sucessora.sessionId!);
    esperarCondicao(() => ctl2.consultar().sessoes[0]?.estado === 'completed');
    assert.equal(superarSessao(p.dir, t.id, sid, 'GO', 'codex').repetida, false);
    assert.equal(superarSessao(p.dir, t.id, sid, 'GO', 'codex').repetida, true);
    assert.equal(radar().sessoes.length, 0);
    const eventos = lerLedger(dir);
    assert.equal(eventos.filter(e => e.tipo === 'session_answered').length, 1);
    assert.equal(eventos.filter(e => e.tipo === 'session_superseded').length, 1);
    assert.equal(eventos.filter(e => e.tipo === 'human_gate').length, 0);
    assert.ok(!fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').includes(r.resposta));
  } finally {
    if (sid) { const ctl = controleNativo('codex', p.dir, t.id, sid); const s = ctl.consultar().sessoes[0]; if (s?.estado === 'blocked') ctl.parar(s); }
    fake.restaurar(); nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
  }
});
