/**
 * I-43 (D4, viga a): quem VALIDA nao pode ser quem EXECUTOU.
 *
 * Esta regra era a unica coisa do produto que dizia isso, e estava presa dentro do
 * Objective Envelope: `objective.ts:104` a cobrava na CRIACAO do envelope, e nenhuma
 * thread comum tinha a propriedade (`validationRuntimes` nao aparecia em nenhum outro
 * arquivo). Ou seja: a regra existia e nunca alcancou trabalho real.
 *
 * O regime que ela combate esta medido: das 137 threads, 16 registram sessoes de GO e
 * de CHECK, e em 11 delas o CHECK rodou apenas em runtime que o GO tambem usou. As
 * quatro threads mais recentes sao todas `claude-bg` conferindo `claude-bg`.
 *
 * Ela sai viva da remocao do envelope como propriedade de thread comum, cobrada no
 * MESMO portao por onde todo despacho ja passa.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { runtimeCruzadoParaDespacho } from '../src/phase';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { POLITICA_DE_RETRY } from '../src/retry';
import { gravarThread, lerThread, novaThread } from '../src/thread';
import { Fase, Thread } from '../src/types';

/** Uma thread com uma sessao de GO ja registrada no runtime informado. */
function comGoEm(p: ReturnType<typeof projetoTemporario>, nome: string, runtime: string, exige: boolean): Thread {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto', exigeRuntimeDiferente: exige });
  const t = lerThread(p.dir, thread.id);
  t.faseAtual = 'CHECK';
  t.sessoes.push({ sessionId: '11111111-2222-3333-4444-555555555555', slug: t.slug, fase: 'GO',
    bloco: 'GO', runtime, despachadaEm: '2026-09-20T12:00:00.000Z',
    promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  return lerThread(p.dir, t.id);
}

test('a thread que EXIGE recusa o CHECK no runtime que fez o GO', () => {
  const p = projetoTemporario('cruzado-recusa');
  try {
    const t = comGoEm(p, 'exigente', 'claude-bg', true);
    const erro = runtimeCruzadoParaDespacho(t, 'CHECK', 'claude-bg');
    assert.ok(erro, 'claude-bg conferindo claude-bg precisa ser recusado');
    assert.match(erro!, /^runtime\.autoconferencia:/, 'a recusa e TIPADA');
    assert.match(erro!, /claude-bg/, 'a recusa nomeia o runtime do GO');
    assert.match(erro!, /outro runtime/, 'a recusa diz o que destrava');
  } finally { p.limpar(); }
});

test('a MESMA thread aceita o CHECK em outro runtime', () => {
  const p = projetoTemporario('cruzado-aceita');
  try {
    const t = comGoEm(p, 'exigente', 'claude-bg', true);
    assert.equal(runtimeCruzadoParaDespacho(t, 'CHECK', 'codex'), null);
  } finally { p.limpar(); }
});

test('a regra NAO vaza para quem nao pediu por ela', () => {
  const p = projetoTemporario('cruzado-solta');
  try {
    // Sem a exigencia, nada muda: o despacho segue como sempre seguiu.
    const solta = comGoEm(p, 'solta', 'claude-bg', false);
    assert.equal(runtimeCruzadoParaDespacho(solta, 'CHECK', 'claude-bg'), null);

    // E ela vale no CHECK e so no CHECK, porque e sobre VALIDACAO.
    const exigente = comGoEm(p, 'exigente', 'claude-bg', true);
    for (const fase of ['GOAL', 'PLAN', 'GO', 'SHIP', 'MASTER'] as Fase[]) {
      assert.equal(runtimeCruzadoParaDespacho(exigente, fase, 'claude-bg'), null, `vazou para ${fase}`);
    }
  } finally { p.limpar(); }
});

test('sem sessao de GO registrada nao ha o que cruzar, e o despacho passa', () => {
  const p = projetoTemporario('cruzado-sem-go');
  try {
    // Barrar aqui seria inventar impedimento sobre um GO que nao aconteceu.
    const { thread } = novaThread(p.carregado, { nome: 'nova', modo: 'auto', exigeRuntimeDiferente: true });
    assert.equal(runtimeCruzadoParaDespacho(thread, 'CHECK', 'claude-bg'), null);
  } finally { p.limpar(); }
});

test('o motivo e do CATALOGO, com descricao e politica de retry declaradas', () => {
  // Motivo sem descricao e sem politica e motivo que so aparece como string solta.
  assert.equal(typeof DESCRICAO_DO_MOTIVO['runtime.autoconferencia'], 'string');
  const politica = POLITICA_DE_RETRY['runtime.autoconferencia'];
  assert.equal(politica.motivo, 'runtime.autoconferencia');
  assert.equal(politica.automatica, false, 'a maquina nao escolhe runtime sozinha');
  // `escalar-humano` e nao `sem-retry`: `sem-retry` e reservado a violacao de custo,
  // e o bloco B3 guarda essa exclusividade.
  assert.equal(politica.acao, 'escalar-humano');
});

test('a exigencia fica GRAVADA na thread e aparece no resumo', () => {
  const p = projetoTemporario('cruzado-gravado');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'exigente', modo: 'auto', exigeRuntimeDiferente: true });
    assert.equal(lerThread(p.dir, thread.id).exigeRuntimeDiferente, true, 'a propriedade e da THREAD, nao de um envelope a parte');

    // Sem a flag, o campo nem existe: quem nao pediu nao carrega a propriedade.
    const { thread: solta } = novaThread(p.carregado, { nome: 'solta', modo: 'auto' });
    assert.equal(lerThread(p.dir, solta.id).exigeRuntimeDiferente, undefined);
  } finally { p.limpar(); }
});
