/** Sem host real: estados, pedidos e respostas SIMULADOS em repositórios isolados. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { profundidadeDoModo } from '../src/hitl-contract';
import { projetoTemporario, commitar } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { apresentarHitl } from '../src/hitl-presentation';
import { abrirPedidoGate } from '../src/hitl-gates';
import { montarPulse } from '../src/pulse';
import { mensagemPulse, varrerPulse } from '../src/pulse-delivery';
import { formatarDataHora } from '../src/horario';
import { prazoDoPedido } from '../src/hitl-contract';

test('profundidade traz artefato, claims, riscos e diff redigidos sem sair do domicílio', () => {
  const p = projetoTemporario('hitl-depth');
  try {
    for (const modo of ['classic', 'maestro'] as const) {
      const t = novaThread(p.carregado, { nome: modo, modo }).thread;
      const dir = dirThread(p.dir, t.id);
      fs.writeFileSync(path.join(dir, 'GOAL.md'), '# Objetivo\nRisco: teste SIMULADO\npassword=segredo-simulado\n');
      commitar(p.dir, 'core/src/produto.txt', `produto ${modo}\n`, `fixture ${modo}`);
      const a = apresentarHitl(p.dir, t.id);
      assert.equal(a.profundidade, profundidadeDoModo(modo));
      assert.ok(!JSON.stringify(a).includes('segredo-simulado'));
      if (modo === 'maestro') assert.equal(a.artefato, '');
      else { assert.match(a.artefato, /Objetivo/); assert.match(a.diff, /produto.txt/); }
      assert.match(a.riscos, /SIMULADO/);
      fs.unlinkSync(path.join(dir, 'GOAL.md'));
      fs.symlinkSync(path.join(p.dir, 'README.md'), path.join(dir, 'GOAL.md'));
      assert.ok(!apresentarHitl(p.dir, t.id).artefato.includes('# projeto'));
    }
  } finally { p.limpar(); }
});

test('Auto/Maestro não herdam previsão indevida; gate tipado continua interrompendo', () => {
  const p = projetoTemporario('hitl-quiet');
  try {
    for (const modo of ['auto', 'maestro'] as const) {
      const t = novaThread(p.carregado, { nome: modo, modo }).thread;
      registrar(dirThread(p.dir, t.id), t.id, 'human_gate', { fase: 'GOAL', estado: 'prevista ao fim do bloco' });
    }
    const consultar = () => montarPulse(p.carregado, { consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' } });
    assert.equal(consultar().resumo.humanos, 0);
    const t = novaThread(p.carregado, { nome: 'policy', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'gate_blocked', { fase: 'GOAL', motivo: 'policy.violation', detalhe: 'bloqueio SIMULADO' });
    assert.ok(consultar().precisaDeHumanoAgora.some(i => i.thread === t.id && i.motivo === 'policy.violation'));
  } finally { p.limpar(); }
});

test('pulse prepara pedido e conteúdo inline por leitura pura e só envia novidade', () => {
  const p = projetoTemporario('hitl-pedido');
  try {
    const t = novaThread(p.carregado, { nome: 'look', modo: 'classic' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
    registrar(dir, t.id, 'gate_blocked', { fase: 'GOAL', motivo: 'human.pending' });
    fs.writeFileSync(path.join(dir, 'GOAL.md'), '# Artefato SIMULADO\nRisco: limite local\n');
    const pedido = abrirPedidoGate(p.dir, t.id), antes = lerLedger(dir);
    const consultar = () => montarPulse(p.carregado, { consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' } });
    const item = consultar().precisaDeHumanoAgora.find(i => i.thread === t.id)!;
    assert.equal(item.pedido?.id, pedido.id);
    const texto = mensagemPulse(item);
    // I-35: o prazo chega ao dono no fuso dele; o ISO fica só no pedido assinado.
    // I-41: o pedido do gate agora e v2, entao o prazo sai pelo leitor e a chave que o dono
    // digita e a letra. O que o teste prova nao muda: o prazo chega no fuso do dono e o ISO
    // assinado nao vaza para a mensagem.
    const prazo = prazoDoPedido(pedido)!;
    for (const trecho of [pedido.id, formatarDataHora(prazo), 'Artefato SIMULADO', 'Claims:', 'Riscos:', 'Diff:', 'a.']) assert.ok(texto.includes(trecho), trecho);
    assert.ok(!texto.includes(prazo));
    assert.ok(texto.length <= 3900);
    let chamadas = 0;
    const enviar = () => { chamadas++; return true; };
    assert.equal(varrerPulse({ raiz: p.dir, consultar, enviar }).enviadas, 1);
    assert.equal(varrerPulse({ raiz: p.dir, consultar, enviar }).enviadas, 0);
    assert.equal(chamadas, 1); assert.deepEqual(lerLedger(dir), antes);
  } finally { p.limpar(); }
});
