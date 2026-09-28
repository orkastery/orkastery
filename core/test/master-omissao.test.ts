/**
 * I-43 (D3, T8): a aceitacao por omissao, e por que ela nao e silencio.
 *
 * A fila de ratificacao tinha 13 entradas em 20/09/2026, e nao por falta de lembrete:
 * lembrete nao converte em nota. A saida e ACEITACAO POR DEFAULT, mas R4 do GOAL diz o
 * risco em uma linha: se entregue e aceito, uma entrega ruim some. E some sem deixar
 * rastro de que sumiu, o que seria PIOR que o regime anterior, porque a fila ao menos
 * deixava as 13 visiveis.
 *
 * Entao a aceitacao precisa produzir registro, e este arquivo cobra os tres rastros:
 * o evento no ledger com os INSUMOS, o score distinguivel de nota humana, e a nota
 * humana posterior sobrescrevendo sem apagar o registro da omissao.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { commitar, projetoTemporario } from './apoio';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import {
  aceitarPorOmissao,
  aceitosPorOmissao,
  AUTOR_DA_OMISSAO,
  indiceDaThread,
  lerMasterLog,
  registrarMaster,
  tabelaDeEntregas,
} from '../src/master';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

/** Uma thread que entregou de verdade, do ponto de vista do ledger. */
function entregou(p: ReturnType<typeof projetoTemporario>, nome: string, tropecos = 0) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', slug: 'x' });
  for (let i = 0; i < tropecos; i++) registrar(dir, thread.id, TIPOS_DE_EVENTO.fixAberto, { fase: 'GO', rodada: i + 1 });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, {
    fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true,
  });
  return thread;
}

test('o aceite por omissao grava o evento com o indice, os INSUMOS e quem decidiu', () => {
  const p = projetoTemporario('omissao-evento');
  try {
    const t = entregou(p, 'entrega', 2);
    const r = aceitarPorOmissao(p.dir, t.id);

    // O indice veio do ledger, nao de alguem: 5 - 0.5*2 = 4.
    assert.equal(r.indice.valor, 4);
    assert.equal(r.indice.derivado, true);
    assert.equal(r.decididoPor, AUTOR_DA_OMISSAO);

    const evento = lerLedger(dirThread(p.dir, t.id)).find((e) => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao);
    assert.ok(evento, 'o aceite precisa deixar evento no ledger');
    assert.equal(evento!.indice, 4);
    assert.equal(evento!.decididoPor, AUTOR_DA_OMISSAO);

    // Os INSUMOS vao junto: numero sem origem no ledger e numero inventado.
    const insumos = evento!.insumos as { evento: string; ocorrencias: number }[];
    assert.equal(insumos.length, 1);
    assert.equal(insumos[0].evento, TIPOS_DE_EVENTO.fixAberto);
    assert.equal(insumos[0].ocorrencias, 2);
  } finally { p.limpar(); }
});

test('o score gravado por omissao e distinguivel de nota humana, a olho e por codigo', () => {
  const p = projetoTemporario('omissao-score');
  try {
    const t = entregou(p, 'entrega');
    aceitarPorOmissao(p.dir, t.id);

    const fechada = lerThread(p.dir, t.id);
    assert.ok(fechada.score, 'a aceitacao grava score');
    // Por codigo: o regime diz o que aconteceu.
    assert.equal(fechada.score!.regime, 'omissao');
    // A olho: a autoria nao e um nome de gente.
    assert.equal(fechada.score!.avaliadoPor, AUTOR_DA_OMISSAO);
    assert.match(fechada.score!.justificativa, /Aceita por omissao/);
    // E o indice fica gravado junto, para nao ser preciso recalcular para saber.
    assert.equal(fechada.score!.indice, 5);
  } finally { p.limpar(); }
});

test('a nota humana posterior SOBRESCREVE, e o evento de omissao PERMANECE', () => {
  const p = projetoTemporario('omissao-sobrescreve');
  try {
    const t = entregou(p, 'entrega', 4);
    aceitarPorOmissao(p.dir, t.id);
    assert.equal(lerThread(p.dir, t.id).score!.regime, 'omissao');

    // O dono reclama depois. Reclamar continua possivel para sempre.
    registrarMaster(p.dir, t.id, {
      score: 1,
      justificativa: 'a entrega nao resolvia o problema; refiz na mao',
      classes: ['scope-creep'],
      por: 'julio',
      refazer: true,
    });

    const depois = lerThread(p.dir, t.id);
    assert.equal(depois.score!.valor, 1, 'a nota humana e a que vale');
    assert.equal(depois.score!.avaliadoPor, 'julio');
    assert.notEqual(depois.score!.regime, 'omissao', 'deixou de ser omissao');

    // E o registro de que a entrega PASSOU SEM REVISAO continua sendo verdade.
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.equal(eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao).length, 1,
      'o ledger e append-only: a omissao aconteceu e nao se apaga');
  } finally { p.limpar(); }
});

test('a visao de entregas mostra o indice e lista o que passou sem o dono olhar', () => {
  const p = projetoTemporario('omissao-visao');
  try {
    const a = entregou(p, 'com tropeco', 3);
    entregou(p, 'sem tropeco');

    // Antes de aceitar: as duas aparecem com o indice ja derivado.
    const antes = tabelaDeEntregas(p.dir);
    assert.match(antes, /indice ja derivado do ledger/);
    assert.match(antes, /nao foi digitado por ninguem/);
    assert.match(antes, /go_fix_opened x3/);
    assert.match(antes, /sem tropeco/);
    assert.match(antes, /ENTREGUE E ACEITO/);

    // Depois de aceitar uma: ela vai para a secao do que passou sem revisao.
    aceitarPorOmissao(p.dir, a.id);
    const depois = tabelaDeEntregas(p.dir);
    assert.match(depois, /Aceitas por omissao \(1\)/);
    assert.match(depois, /o que passou sem voce olhar/);
    assert.match(depois, /A nota humana sobrescreve/);

    // GO-FIX 1 (A4): a coluna "ACEITA EM" saia em ISO cru, contra a regra da I-35 de que
    // toda superficie humana passa por `core/src/horario.ts`. O fuso aparece uma vez.
    assert.doesNotMatch(depois, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'nenhum ISO cru na tabela');
    assert.match(depois, /\d{2}\/\d{2} \d{2}:\d{2}/, 'a data aceita sai formatada');
    // A legenda diz "Horarios de Brasilia." no fuso do dono e "Horarios em <fuso>." em
    // qualquer outro; exigir so a primeira forma amarrava o teste ao fuso da maquina e
    // reprovava no runner, que roda sem owner.timezone. A afirmacao real e que ela aparece
    // UMA vez, e agora e isso que se conta.
    assert.equal((depois.match(/Hor[aá]rios (de|em) /g) || []).length, 1, 'e o fuso aparece uma vez');

    const lista = aceitosPorOmissao(p.dir);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].thread, a.id);
    assert.equal(lista[0].indice.valor, 3.5, '5 - 1.5, ja no piso de GO-FIX');
  } finally { p.limpar(); }
});

/**
 * GO-FIX 1 (A1): a reversao da entrega alcanca o score SEM depender de um ship seguinte.
 *
 * O CHECK de 20/09/2026 reproduziu o buraco com `git revert` de verdade: o unico escritor
 * de `rollback_done` rodava no comeco de um `ork ship` SEGUINTE da mesma thread, e depois
 * do MASTER nao ha ship seguinte. A entrega desfeita saia como 5 de 5 "sem tropeco", e a
 * justificativa gravada pelo proprio nucleo dizia "sem reversao" sobre ela. Em 20 das 27
 * threads entregues do projeto a janela do ship seguinte nunca chegou a abrir.
 *
 * Este teste e o mesmo cenario, no mesmo caminho de produto, e ele so passa enquanto a
 * deteccao rodar onde o indice e calculado.
 */
test('entrega revertida no git nao sai 5/5 nem "sem tropeco" pelo caminho do ork master', () => {
  const p = projetoTemporario('omissao-reversao');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'entrega revertida', modo: 'auto' });
    const dir = dirThread(p.dir, thread.id);
    const merge = commitar(p.dir, 'entrega.md', '# entrega\n', 'feat: entrega da thread');
    registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, {
      fase: 'SHIP', de: 'ork/entrega', para: 'main', mergeSha: merge, pushVerificado: true,
    });

    // Sem reversao, o caminho do produto nao inventa tropeco.
    assert.equal(indiceDaThread(p.dir, thread.id).valor, 5);

    // O dono reverte na base, como reverteria de verdade.
    exec('git', ['revert', '--no-edit', merge], p.dir);

    // NINGUEM chama a deteccao: quem pergunta ao git e o proprio `ork master`.
    const tabela = tabelaDeEntregas(p.dir);
    assert.match(tabela, /rollback_done x1/);
    assert.doesNotMatch(tabela, /sem tropeco/);

    const aceite = aceitarPorOmissao(p.dir, thread.id);
    assert.equal(aceite.indice.valor, 2, '5 - 3 de reversao');

    const score = lerThread(p.dir, thread.id).score;
    assert.equal(score?.valor, 2, 'o score gravado e o que o MASTER consome');
    assert.equal(score?.regime, 'omissao');
    assert.ok(!score?.justificativa.includes('sem reversao'),
      'a justificativa nao pode afirmar "sem reversao" numa entrega desfeita');
    assert.match(score?.justificativa ?? '', /rollback_done/);
    assert.equal(lerMasterLog(p.dir, thread.id)?.score, 2, 'o contrato congelado tambem');

    // Idempotente: a deteccao roda em toda consulta e nao pode rebaixar duas vezes.
    tabelaDeEntregas(p.dir);
    assert.equal(indiceDaThread(p.dir, thread.id).valor, 2);
    assert.equal(lerLedger(dir).filter((e) => e.tipo === TIPOS_DE_EVENTO.rollbackConcluido).length, 1);
  } finally { p.limpar(); }
});

/**
 * A reversao que chega DEPOIS do aceite nao reescreve o MASTER log, e nao some.
 *
 * `ork.master-log/v1` e contrato congelado: o que foi gravado fica. O que o CHECK cobrou e
 * que a divergencia apareca em vez de ficar so na tabela ao vivo contra um 5 gravado.
 */
test('entrega que cai depois de aceita aparece com o gravado ao lado do indice de agora', () => {
  const p = projetoTemporario('omissao-queda-tardia');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'cai depois', modo: 'auto' });
    const dir = dirThread(p.dir, thread.id);
    const merge = commitar(p.dir, 'entrega.md', '# entrega\n', 'feat: entrega da thread');
    registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, {
      fase: 'SHIP', de: 'ork/entrega', para: 'main', mergeSha: merge, pushVerificado: true,
    });
    assert.equal(aceitarPorOmissao(p.dir, thread.id).indice.valor, 5);

    exec('git', ['revert', '--no-edit', merge], p.dir);

    const lista = aceitosPorOmissao(p.dir);
    assert.equal(lista[0].indice.valor, 2, 'o indice de agora conhece a reversao');
    assert.equal(lista[0].scoreGravado, 5, 'o gravado fica como estava: contrato congelado');
    assert.equal(lerMasterLog(p.dir, thread.id)?.score, 5);

    const tabela = tabelaDeEntregas(p.dir);
    assert.match(tabela, /cairam DEPOIS de aceitas/);
    assert.match(tabela, new RegExp(thread.id));
  } finally { p.limpar(); }
});
