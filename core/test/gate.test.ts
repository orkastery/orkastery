/**
 * Testes do gate de tokens (`ork gate next`).
 *
 * O que estes testes protegem e a HONESTIDADE DE MEDICAO: sem fonte que saiba medir, o
 * gate diz `unavailable` e nao rotaciona; com medida acima do limiar, rotaciona e ja
 * entrega o slug da proxima sessao.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerLedger } from '../src/ledger';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { gateDeTokens, JANELA_NOMINAL_PADRAO, medirOcupacao, passoEhPesado } from '../src/tokens';
import { SessaoDaThread } from '../src/types';
import { projetoTemporario } from './apoio';

function registrarSessao(dir: string, threadId: string, slug: string, fase: SessaoDaThread['fase']) {
  const thread = lerThread(dir, threadId);
  thread.sessoes.push({
    slug,
    fase,
    bloco: 'GO-CHECK',
    sessionId: '00000000-0000-4000-8000-000000000000',
    runtime: 'claude-bg',
    despachadaEm: new Date().toISOString(),
    promptPath: 'x.md',
    promptSha256: 'y',
    verificada: true,
  });
  gravarThread(dir, thread);
}

test('sem fonte que saiba medir, o gate declara unavailable e NAO rotaciona', () => {
  const projeto = projetoTemporario('gate-unavailable');
  const { thread } = novaThread(projeto.carregado, { nome: 'medida', modo: 'classic' });

  const v = gateDeTokens(projeto.carregado, thread.id, { proximo: 'GO' });

  assert.equal(v.medida.ocupacao, null);
  assert.equal(v.medida.fonte, 'unavailable');
  assert.equal(v.veredito, 'same-session');
  assert.equal(v.decididoPor, 'ausencia-de-medida');
  assert.equal(v.slugSugerido, null);
  assert.match(v.razao, /nao e medivel/);
  // O proximo passo continua sendo classificado como pesado: o que falta e a medida.
  assert.equal(v.passoPesado, true);

  const evento = lerLedger(dirThread(projeto.dir, thread.id)).find((e) => e.tipo === 'token_gate');
  assert.ok(evento, 'o gate documenta a decisao no ledger mesmo sem medida');
  assert.equal(evento.fonte, 'unavailable');
  assert.equal(evento.ocupacao, null);
  assert.equal(evento.veredito, 'same-session');
  assert.equal(evento.decididoPor, 'ausencia-de-medida');

  // E o veredito fica gravado no proprio thread.json.
  assert.equal(lerThread(projeto.dir, thread.id).ultimoTokenGate?.medida.fonte, 'unavailable');

  projeto.limpar();
});

test('acima de force_rotate_above rotaciona sempre, com sufixo no slug da nova sessao', () => {
  const projeto = projetoTemporario('gate-force');
  const { thread } = novaThread(projeto.carregado, { nome: 'rotacao', modo: 'classic' });
  // A thread ja abriu uma sessao para o bloco GO-CHECK: a nova entra com sufixo.
  registrarSessao(projeto.dir, thread.id, 'ork-rotacao-f34', 'GO');

  const v = gateDeTokens(projeto.carregado, thread.id, { proximo: 'CHECK', ocupacao: 0.92 });

  assert.equal(v.veredito, 'new-session');
  assert.equal(v.decididoPor, 'medicao');
  assert.equal(v.medida.fonte, 'informada');
  assert.equal(v.medida.ocupacao, 0.92);
  assert.equal(v.slugSugerido, 'ork-rotacao-f34-2');
  assert.match(v.razao, /force_rotate_above/);

  const evento = lerLedger(dirThread(projeto.dir, thread.id)).find((e) => e.tipo === 'token_gate');
  assert.equal(evento?.slugSugerido, 'ork-rotacao-f34-2');
  assert.equal(evento?.veredito, 'new-session');

  projeto.limpar();
});

test('entre rotate_above e force_rotate_above so rotaciona quando o proximo passo e pesado', () => {
  const projeto = projetoTemporario('gate-limiar');
  const { thread } = novaThread(projeto.carregado, { nome: 'limiar', modo: 'classic' });

  const leve = gateDeTokens(projeto.carregado, thread.id, { proximo: 'MASTER', ocupacao: 0.75 });
  assert.equal(leve.veredito, 'same-session');
  assert.equal(leve.passoPesado, false);
  assert.match(leve.razao, /nao e pesado/);

  const pesado = gateDeTokens(projeto.carregado, thread.id, { proximo: 'GO', ocupacao: 0.75 });
  assert.equal(pesado.veredito, 'new-session');
  assert.equal(pesado.passoPesado, true);
  assert.equal(pesado.slugSugerido, 'ork-limiar-f34');

  // Refazer uma fase reprovada tambem conta como passo pesado.
  const refazendo = gateDeTokens(projeto.carregado, thread.id, {
    proximo: 'SHIP',
    ocupacao: 0.75,
    refazer: true,
  });
  assert.equal(refazendo.veredito, 'new-session');
  assert.match(refazendo.razao, /refazer fase reprovada/);

  const baixa = gateDeTokens(projeto.carregado, thread.id, { proximo: 'GO', ocupacao: 0.4 });
  assert.equal(baixa.veredito, 'same-session');
  assert.match(baixa.razao, /abaixo de rotate_above/);

  projeto.limpar();
});

test('a estimativa por transcript declara o metodo e a janela usada', () => {
  const projeto = projetoTemporario('gate-estimado');
  const { thread } = novaThread(projeto.carregado, { nome: 'estimado', modo: 'auto' });
  const transcript = path.join(projeto.dir, 'transcript.txt');
  // Metade da janela nominal, em bytes: 4 bytes por token.
  fs.writeFileSync(transcript, 'x'.repeat((JANELA_NOMINAL_PADRAO * 4) / 2), 'utf8');

  const medida = medirOcupacao(lerThread(projeto.dir, thread.id), { transcript });
  assert.equal(medida.fonte, 'estimated');
  assert.ok(medida.ocupacao !== null && Math.abs(medida.ocupacao - 0.5) < 0.001);
  assert.match(medida.detalhe, /estimativa por tamanho/);
  assert.match(medida.detalhe, new RegExp(String(JANELA_NOMINAL_PADRAO)));

  // Transcript declarado que nao existe vira `unavailable`, nao vira zero.
  const semArquivo = medirOcupacao(lerThread(projeto.dir, thread.id), {
    transcript: path.join(projeto.dir, 'nao-existe.txt'),
  });
  assert.equal(semArquivo.fonte, 'unavailable');
  assert.equal(semArquivo.ocupacao, null);

  projeto.limpar();
});

test('a classificacao de passo pesado segue a visao: GO, CHECK e refazer', () => {
  assert.equal(passoEhPesado('GO', false), true);
  assert.equal(passoEhPesado('CHECK', false), true);
  assert.equal(passoEhPesado('GOAL', false), false);
  assert.equal(passoEhPesado('MASTER', false), false);
  assert.equal(passoEhPesado('MASTER', true), true);
  assert.equal(passoEhPesado(null, false), false);
});
