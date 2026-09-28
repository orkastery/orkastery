/**
 * GO-FIX e CHECK-REVERIFY automatizados (bloco B3).
 *
 * O criterio de sucesso do bloco: "um CHECK com CHANGES NEEDED tipo B dispara GO-FIX com
 * spec exata e CHECK-REVERIFY com veredito por fix, tudo sem toque humano ate o veredito
 * final". Os testes aqui perseguem exatamente isso, e mais duas guardas do metodo:
 *   - reexecucao PARCIAL depois de tipo B e recusada (DoD 10);
 *   - estourado o limite de escalacao, o veredito sobe para humano em QUALQUER modo.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim } from '../src/claims';
import { abrirRodada, derivarCorrecoes, reverificar, tipoDoMotivo, ultimaRodada } from '../src/fix';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { gravarBaseline, verificar } from '../src/verify';
import { ajustarManifesto, commitar, projetoTemporario } from './apoio';

/** Nenhuma autorizacao humana foi registrada no ledger desta thread. */
function toqueHumano(dir: string, threadId: string): number {
  return lerLedger(dirThread(dir, threadId)).filter(
    (e) => e.tipo === 'human_gate' && e.estado === 'aprovado'
  ).length;
}

test('a classificacao A/B sai do motivo tipado, com o padrao conservador', () => {
  // O nucleo nao sabe medir "uma linha ou equivalente", entao ele nao finge saber:
  // so a alegacao sem comando nasce tipo A, porque a correcao E anexar o comando.
  assert.equal(tipoDoMotivo('claims.unverifiable'), 'A');
  for (const motivo of ['claims.failed', 'verify.regression', 'verify.failed', 'artifact.missing'] as const) {
    assert.equal(tipoDoMotivo(motivo), 'B', `${motivo} devolve a tarefa ao GO`);
  }
});

test('CHECK com CHANGES NEEDED tipo B abre GO-FIX com spec exata e fecha sem humano', (t) => {
  const p = projetoTemporario('b3-gofix');
  t.after(p.limpar);

  // `#Auto`: o sub-loop inteiro tem que andar sozinho ate o veredito final.
  const { thread } = novaThread(p.carregado, { nome: 'go fix auto', modo: 'auto' });
  adicionarClaim(p.dir, thread.id, {
    arquivo: 'alvo.txt',
    alegacao: 'o arquivo alvo.txt existe no HEAD',
    verificar: ['test -f alvo.txt'],
    fase: 'GO',
  });

  // O arquivo NAO existe: o CHECK reprova por claims.failed.
  const check = verificar(p.carregado, thread.id);
  assert.equal(check.ok, false);
  assert.deepEqual(check.motivos, ['claims.failed']);

  const rodada = abrirRodada(p.carregado, thread.id);
  assert.equal(rodada.veredito, 'PRECISA DE MUDANCA');
  assert.equal(rodada.rodada, 1);
  assert.equal(rodada.correcoes.length, 1);
  assert.equal(rodada.temTipoB, true);

  const fx = rodada.correcoes[0];
  assert.equal(fx.id, 'FX1');
  assert.equal(fx.tipo, 'B');
  assert.equal(fx.origem, 'claims.failed');
  assert.equal(fx.alvo, 'claim C1');
  assert.deepEqual(fx.verificar, ['test -f alvo.txt'], 'o julgamento do fix e o comando da claim');
  assert.match(fx.spec, /alvo\.txt/, 'a spec cita o artefato exato');
  assert.match(fx.spec, /REPROVOU na reexecucao no HEAD real/);
  assert.match(fx.evidencia, /saiu com codigo/, 'a evidencia e a saida real, nao um relato');

  // A spec despachada ao GO-FIX carrega o comando que vai julgar cada correcao.
  assert.match(rodada.spec, /FX1 \(tipo B, motivo tipado claims\.failed\)/);
  assert.match(rodada.spec, /como sera julgado: test -f alvo\.txt/);
  assert.match(rodada.spec, /reexecucao COMPLETA/);
  assert.match(rodada.spec, /fraude de gate/);

  // Guarda do metodo: parcial depois de tipo B nao e CHECK.
  assert.throws(
    () => reverificar(p.carregado, thread.id, { parcial: true }),
    /tipo B/,
    'reverify parcial e recusado quando ha correcao tipo B'
  );

  // O GO-FIX corrige o artefato. Agora o CHECK-REVERIFY julga fix a fix.
  commitar(p.dir, 'alvo.txt', 'existo agora\n', 'FX1: cria o alvo que a claim alega');
  const r = reverificar(p.carregado, thread.id);
  assert.equal(r.cobertura, 'completa');
  assert.equal(r.vereditos.length, 1);
  assert.equal(r.vereditos[0].correcao.id, 'FX1');
  assert.equal(r.vereditos[0].aprovada, true);
  assert.equal(r.vereditos[0].execucoes.length, 1);
  assert.equal(r.vereditos[0].execucoes[0].ok, true);
  assert.ok(r.verify, 'a rodada com tipo B roda o verify completo');
  assert.equal(r.verify.ok, true);
  assert.equal(r.veredito, 'PASSOU');
  assert.equal(r.escalado, false);

  // Nada de humano no caminho todo.
  assert.equal(toqueHumano(p.dir, thread.id), 0, 'o sub-loop fechou sem toque humano');

  const ledger = lerLedger(dirThread(p.dir, thread.id));
  const aberto = ledger.find((e) => e.tipo === 'go_fix_opened');
  assert.ok(aberto);
  assert.equal(aberto.reexecucaoCompletaObrigatoria, true);
  const reverify = ledger.find((e) => e.tipo === 'check_reverify');
  assert.ok(reverify);
  assert.equal(reverify.veredito, 'PASSOU');
  assert.equal(reverify.cobertura, 'completa');
  const vereditos = reverify.vereditos as {
    correcao: string;
    tipo: string;
    origem: string;
    aprovada: boolean;
    detalhe: string;
  }[];
  assert.equal(vereditos.length, 1);
  assert.equal(vereditos[0].correcao, 'FX1');
  assert.equal(vereditos[0].tipo, 'B');
  assert.equal(vereditos[0].origem, 'claims.failed');
  assert.equal(vereditos[0].aprovada, true);
  assert.match(vereditos[0].detalhe, /reexecutado\(s\) com sucesso no HEAD real/);
});

test('regressao contra a baseline vira correcao tipo B com o alvo e a baseline citados', (t) => {
  const p = projetoTemporario('b3-regressao');
  t.after(p.limpar);
  ajustarManifesto(p, /^verify:$/m, 'verify:\n  test: "test -f alvo.txt"');

  const { thread } = novaThread(p.carregado, { nome: 'regressao b3', modo: 'maestro' });
  commitar(p.dir, 'alvo.txt', 'estado bom\n', 'estado bom antes do GO');
  const baseline = gravarBaseline(p.carregado, thread.id);
  assert.equal(baseline.comandos.find((c) => c.nome === 'test')?.ok, true);

  // O GO quebrou o que passava: isso e regressao desta thread, nao divida pre-existente.
  fs.rmSync(path.join(p.dir, 'alvo.txt'));

  const rodada = abrirRodada(p.carregado, thread.id);
  assert.equal(rodada.correcoes.length, 1);
  const fx = rodada.correcoes[0];
  assert.equal(fx.tipo, 'B');
  assert.equal(fx.origem, 'verify.regression');
  assert.equal(fx.alvo, 'comando test');
  assert.match(fx.spec, /REGRESSAO/);
  assert.match(fx.spec, new RegExp(baseline.commit.slice(0, 8)), 'a spec cita a baseline comparada');
  assert.deepEqual(fx.verificar, ['test -f alvo.txt']);

  // Ainda quebrado: veredito por fix REPROVADO, e a rodada pede outra volta.
  const reprovado = reverificar(p.carregado, thread.id);
  assert.equal(reprovado.vereditos[0].aprovada, false);
  assert.equal(reprovado.veredito, 'PRECISA DE MUDANCA');
  assert.equal(reprovado.escalado, false);
  assert.equal(toqueHumano(p.dir, thread.id), 0, '#Maestro atravessa o gate reprovado sozinho');
});

test('estourado o limite de escalacao, o CHECK-REVERIFY pausa ate o modo #Auto', (t) => {
  const p = projetoTemporario('b3-limite');
  t.after(p.limpar);
  ajustarManifesto(p, /^verify:$/m, 'verify:\n  test: "test -f alvo.txt"');
  ajustarManifesto(p, /  max_tentativas: 3/, '  max_tentativas: 2');

  const { thread } = novaThread(p.carregado, { nome: 'limite auto', modo: 'auto' });

  // Rodada 1: dentro do limite, o sub-loop segue sozinho.
  abrirRodada(p.carregado, thread.id);
  const primeira = reverificar(p.carregado, thread.id);
  assert.equal(primeira.rodada, 1);
  assert.equal(primeira.veredito, 'PRECISA DE MUDANCA');
  assert.equal(primeira.escalado, false);

  // Rodada 2: bate o limite do manifesto e o veredito sobe para humano.
  abrirRodada(p.carregado, thread.id);
  assert.equal(ultimaRodada(p.dir, thread.id), 2);
  const segunda = reverificar(p.carregado, thread.id);
  assert.equal(segunda.rodada, 2);
  assert.equal(segunda.veredito, 'BLOQUEADO');
  assert.equal(segunda.escalado, true);
  assert.match(segunda.razao, /limite de escalacao/);
  assert.match(segunda.razao, /pausa QUALQUER modo/);

  const ledger = lerLedger(dirThread(p.dir, thread.id));
  const bloqueio = ledger.filter((e) => e.tipo === 'gate_blocked' && e.motivo === 'human.pending');
  assert.equal(bloqueio.length, 1);
  assert.equal(bloqueio[0].modo, 'auto', 'a escalacao pausa ate o modo sem pausa nenhuma');
  assert.equal(bloqueio[0].pausaQualquerModo, true);
  assert.ok(ledger.some((e) => e.tipo === 'retry_escalated' && e.origem === 'check.reverify'));

  // As correcoes das duas rodadas ficaram carimbadas com o veredito de cada uma.
  const correcoes = ledger.filter((e) => e.tipo === 'go_fix_opened');
  assert.equal(correcoes.length, 2, 'cada rodada aberta tem o seu evento');
});

test('alegacao sem comando vira correcao tipo A e a rodada aceita reverify parcial', (t) => {
  const p = projetoTemporario('b3-tipo-a');
  t.after(p.limpar);

  const { thread } = novaThread(p.carregado, { nome: 'tipo a', modo: 'auto' });
  adicionarClaim(p.dir, thread.id, {
    arquivo: 'README.md',
    alegacao: 'o README descreve o projeto de teste',
    verificar: [],
    fase: 'GOAL',
  });

  const rodada = abrirRodada(p.carregado, thread.id);
  assert.equal(rodada.correcoes.length, 1);
  assert.equal(rodada.correcoes[0].tipo, 'A');
  assert.equal(rodada.correcoes[0].origem, 'claims.unverifiable');
  assert.equal(rodada.temTipoB, false);
  assert.match(rodada.spec, /Rodada so de tipo A/);
  assert.match(rodada.correcoes[0].spec, /ork claims verificar/);

  // Rodada so de tipo A: parcial e legitima, e ai a correcao sem comando proprio fica
  // aberta em vez de ser aprovada por conveniencia.
  const parcial = reverificar(p.carregado, thread.id, { parcial: true });
  assert.equal(parcial.cobertura, 'parcial');
  assert.equal(parcial.verify, null);
  assert.equal(parcial.vereditos[0].aprovada, false);
  assert.match(parcial.vereditos[0].detalhe, /depende do verify completo/);
});

test('derivarCorrecoes numera FX sem colidir com as correcoes ja gravadas', (t) => {
  const p = projetoTemporario('b3-ids');
  t.after(p.limpar);

  const { thread } = novaThread(p.carregado, { nome: 'ids fx', modo: 'auto' });
  adicionarClaim(p.dir, thread.id, {
    arquivo: 'um.txt',
    alegacao: 'um.txt existe',
    verificar: ['test -f um.txt'],
  });
  adicionarClaim(p.dir, thread.id, {
    arquivo: 'dois.txt',
    alegacao: 'dois.txt existe',
    verificar: ['test -f dois.txt'],
  });

  const resultado = verificar(p.carregado, thread.id);
  const primeiras = derivarCorrecoes(thread, 1, resultado, []);
  assert.deepEqual(primeiras.map((c) => c.id), ['FX1', 'FX2']);
  const seguintes = derivarCorrecoes(thread, 2, resultado, primeiras.map((c) => c.id));
  assert.deepEqual(seguintes.map((c) => c.id), ['FX3', 'FX4']);
  assert.deepEqual(seguintes.map((c) => c.rodada), [2, 2]);
});
