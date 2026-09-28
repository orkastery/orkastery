/** Testes do bloco B2: `ork board --all` e o escalonador por maquina. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import {
  devolverVagas,
  perfisDetectados,
  planejar,
  textoDoBoard,
  textoDoPlano,
  textoDoReap,
  threadsDeTodosOsPerfis,
} from '../src/board';
import { adquirirRegiao } from '../src/leases';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { registrarMaster } from '../src/master';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';

/** Tres threads em modos diferentes, criadas em ordem estavel. */
function tresThreads(p: ReturnType<typeof projetoTemporario>) {
  const a = novaThread(p.carregado, { nome: 'Checkout', modo: 'classic' }).thread;
  const b = novaThread(p.carregado, { nome: 'Auditoria', modo: 'auto' }).thread;
  const c = novaThread(p.carregado, { nome: 'Pagamentos', modo: 'maestro' }).thread;
  return { a, b, c };
}

test('board --all lista 3 threads com slug, modo e fase de todos os perfis', () => {
  const p = projetoTemporario('board-all');
  const { a, b, c } = tresThreads(p);

  const itens = threadsDeTodosOsPerfis(p.carregado, true);
  assert.equal(itens.length, 3);
  assert.equal(itens.every((i) => i.perfil === p.carregado.manifesto.board.default), true);

  const texto = textoDoBoard(p.carregado, true);
  for (const t of [a, b, c]) {
    assert.match(texto, new RegExp(t.id), `board mostra a thread ${t.id}`);
    assert.match(texto, new RegExp(t.slug.replace(/\./g, '\\.')), `board mostra o slug ${t.slug}`);
  }
  assert.match(texto, /#Maestro/);
  assert.match(texto, /#Auto/);
  assert.match(texto, /#Classic/);
  assert.match(texto, /GOAL/);
  assert.match(texto, /PERFIL/);
  assert.match(texto, /Escalonador por maquina/);
  p.limpar();
});

test('board --all soma os perfis extras de .orkastery/perfis', () => {
  const p = projetoTemporario('board-perfis');
  novaThread(p.carregado, { nome: 'Principal', modo: 'classic' });

  // Um segundo perfil, com seu proprio .orkastery/threads.
  const outro = path.join(p.dir, '.orkastery', 'perfis', 'pesquisa');
  const dirThreadOutro = path.join(outro, '.orkastery', 'threads', 'ork-estudo');
  fs.mkdirSync(dirThreadOutro, { recursive: true });
  const base = lerThread(p.dir, 'ork-principal');
  fs.writeFileSync(
    path.join(dirThreadOutro, 'thread.json'),
    JSON.stringify({ ...base, id: 'ork-estudo', slug: 'ork-estudo-full', modo: 'auto' }, null, 2)
  );

  const perfis = perfisDetectados(p.carregado);
  assert.equal(perfis.length, 2);
  assert.deepEqual(perfis.map((x) => x.nome).sort(), ['default', 'pesquisa']);

  const todos = threadsDeTodosOsPerfis(p.carregado, true);
  assert.equal(todos.length, 2);
  const soLocal = threadsDeTodosOsPerfis(p.carregado, false);
  assert.equal(soLocal.length, 1, 'sem --all fica so o perfil atual');
  assert.match(textoDoBoard(p.carregado, true), /ork-estudo/);
  p.limpar();
});

test('escalonador respeita max_parallel_threads e poe a excedente em espera', () => {
  const p = projetoTemporario('board-plan');
  const { a, b, c } = tresThreads(p);
  assert.equal(p.carregado.manifesto.concurrency.max_parallel_threads, 3);

  // Aperta o limite da maquina para 2 e replaneja.
  const manifesto = { ...p.carregado, manifesto: { ...p.carregado.manifesto } };
  manifesto.manifesto.concurrency = { ...manifesto.manifesto.concurrency, max_parallel_threads: 2 };
  const plano = planejar(manifesto);
  assert.equal(plano.maxParalelas, 2);
  const situacao = new Map(plano.vagas.map((v) => [v.thread, v]));
  assert.equal(situacao.get(a.id)?.situacao, 'pode-avancar');
  assert.equal(situacao.get(b.id)?.situacao, 'pode-avancar');
  assert.equal(situacao.get(c.id)?.situacao, 'espera');
  assert.equal(situacao.get(c.id)?.motivo, 'concurrency.limite');
  assert.match(situacao.get(c.id)?.correcao ?? '', /max_parallel_threads/);
  assert.match(textoDoPlano(plano), /Merge queue/);
  p.limpar();
});

test('escalonador marca em-andamento quem segura lease e espera quem esta na fila', () => {
  const p = projetoTemporario('board-lease');
  const { a, b, c } = tresThreads(p);

  adquirirRegiao(p.dir, 'path:core/src/**', { thread: a.id, motivo: 'GO no nucleo' });
  const barrada = adquirirRegiao(p.dir, 'path:core/src/board.ts', { thread: b.id, motivo: 'GO' });
  assert.equal(barrada.esperando, true);

  const plano = planejar(p.carregado);
  const situacao = new Map(plano.vagas.map((v) => [v.thread, v]));
  assert.equal(situacao.get(a.id)?.situacao, 'em-andamento');
  assert.deepEqual(situacao.get(a.id)?.leases, ['path:core/src/**']);
  assert.equal(situacao.get(b.id)?.situacao, 'espera');
  assert.equal(situacao.get(b.id)?.motivo, 'lease.busy');
  assert.match(situacao.get(b.id)?.detalhe ?? '', new RegExp(a.id));
  assert.equal(situacao.get(c.id)?.situacao, 'pode-avancar');
  assert.equal(plano.emAndamento, 1);
  assert.equal(plano.filaDeRegiao.length, 1);
  p.limpar();
});

test('escalonador separa thread pausada de thread fechada e cobra o score que falta', () => {
  const p = projetoTemporario('board-estados');
  const { a, b, c } = tresThreads(p);

  const pausada = lerThread(p.dir, a.id);
  pausada.status = 'pausada';
  gravarThread(p.dir, pausada);
  registrar(dirThread(p.dir, b.id), b.id, 'ship_done', { mergeSha: 'a'.repeat(40), pushVerificado: true });
  registrarMaster(p.dir, b.id, { por: 'julio', score: 5, justificativa: 'entrega limpa', classes: ['sem-falha'] });
  const semScore = lerThread(p.dir, c.id);
  semScore.status = 'fechada';
  gravarThread(p.dir, semScore);

  const plano = planejar(p.carregado);
  const situacao = new Map(plano.vagas.map((v) => [v.thread, v]));
  assert.equal(situacao.get(a.id)?.situacao, 'pausada');
  assert.equal(situacao.get(a.id)?.motivo, 'human.pending');
  assert.equal(situacao.get(b.id)?.situacao, 'fechada');
  assert.match(situacao.get(b.id)?.detalhe ?? '', /score 5\/5/);
  assert.equal(situacao.get(c.id)?.situacao, 'fechada');
  assert.match(situacao.get(c.id)?.correcao ?? '', /ork master/);
  assert.equal(plano.emAndamento, 0, 'thread pausada nao ocupa vaga da maquina');
  p.limpar();
});

// ---------------------------------------------------------------------------
// Correcao do escalonador (09/2026): vaga por ESTADO REAL, nao por thread aberta.
// ---------------------------------------------------------------------------

const SESSAO_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const SESSAO_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const SESSAO_C = 'cccccccc-1111-2222-3333-444444444444';

/** Instante N horas depois de agora, para simular o tempo passando sem sleep. */
function horasDepois(horas: number): string {
  return new Date(Date.now() + horas * 3600 * 1000).toISOString();
}

/** Fixa a ordem FIFO das threads reescrevendo criadaEm com segundos crescentes. */
function fixarOrdem(raiz: string, ids: string[]): void {
  const base = Date.parse('2026-09-06T10:00:00.000Z');
  ids.forEach((id, i) => {
    const t = lerThread(raiz, id);
    t.criadaEm = new Date(base + i * 1000).toISOString();
    gravarThread(raiz, t);
  });
}

test('cenario do bug: threads orfas presas nao seguram as vagas das prontas', () => {
  const p = projetoTemporario('board-orfas');

  // As 3 orfas do incidente: pausa humana aberta, claims.failed aberto e stale.
  const humana = novaThread(p.carregado, { nome: 'Smoke humana', modo: 'classic' }).thread;
  const falhada = novaThread(p.carregado, { nome: 'Claims falhos', modo: 'auto' }).thread;
  const morta = novaThread(p.carregado, { nome: 'Auto demo', modo: 'auto' }).thread;
  // E 4 demandas legitimas prontas para rodar.
  const prontas = ['Site um', 'Site dois', 'Site tres', 'Site quatro'].map(
    (nome) => novaThread(p.carregado, { nome, modo: 'auto' }).thread
  );
  fixarOrdem(p.dir, [humana.id, falhada.id, morta.id, ...prontas.map((t) => t.id)]);

  registrar(dirThread(p.dir, humana.id), humana.id, TIPOS_DE_EVENTO.pausaHumana, {
    estado: 'prevista ao fim do bloco',
    fase: 'PLAN',
    sessionId: SESSAO_A,
  });
  registrar(dirThread(p.dir, falhada.id), falhada.id, TIPOS_DE_EVENTO.gateBloqueado, {
    motivo: 'claims.failed',
    fase: 'GO',
    gate: 'phase.dispatch',
    sessionId: SESSAO_B,
  });
  registrar(dirThread(p.dir, morta.id), morta.id, TIPOS_DE_EVENTO.faseDespachada, {
    fase: 'GO',
    sessionId: SESSAO_C,
  });

  // 5 horas depois, runtime consultado e SEM nenhuma sessao viva: max=3.
  const apertado = { ...p.carregado, manifesto: { ...p.carregado.manifesto } };
  apertado.manifesto.concurrency = { max_parallel_threads: 3, stale_after_min: 240 };
  const plano = planejar(apertado, { agora: horasDepois(5), estados: new Map() });
  const vaga = new Map(plano.vagas.map((v) => [v.thread, v]));

  assert.equal(plano.emAndamento, 0, 'nenhuma thread executa de verdade');
  assert.equal(vaga.get(humana.id)?.situacao, 'pausada');
  assert.equal(vaga.get(humana.id)?.motivo, 'human.pending');
  assert.equal(vaga.get(falhada.id)?.situacao, 'espera');
  assert.equal(vaga.get(falhada.id)?.motivo, 'claims.failed');
  assert.equal(vaga.get(morta.id)?.situacao, 'espera');
  assert.equal(vaga.get(morta.id)?.motivo, 'vaga.stale');

  // As prontas herdam as 3 vagas em FIFO; a quarta espera pelo limite, que segue valendo.
  assert.equal(vaga.get(prontas[0].id)?.situacao, 'pode-avancar');
  assert.equal(vaga.get(prontas[1].id)?.situacao, 'pode-avancar');
  assert.equal(vaga.get(prontas[2].id)?.situacao, 'pode-avancar');
  assert.equal(vaga.get(prontas[3].id)?.situacao, 'espera');
  assert.equal(vaga.get(prontas[3].id)?.motivo, 'concurrency.limite');
  const ocupando = plano.vagas.filter(
    (v) => v.situacao === 'em-andamento' || v.situacao === 'pode-avancar'
  );
  assert.equal(ocupando.length <= 3, true, 'nunca ha mais ocupacao que max_parallel_threads');
  assert.match(textoDoPlano(plano), /procura ativa/);
  p.limpar();
});

test('stale timeout: sessao working segura a vaga, sessao morta devolve depois do limite', () => {
  const p = projetoTemporario('board-stale');
  const viva = novaThread(p.carregado, { nome: 'Viva', modo: 'auto' }).thread;
  const morta = novaThread(p.carregado, { nome: 'Morta', modo: 'auto' }).thread;
  const pronta = novaThread(p.carregado, { nome: 'Pronta', modo: 'auto' }).thread;
  fixarOrdem(p.dir, [viva.id, morta.id, pronta.id]);
  registrar(dirThread(p.dir, viva.id), viva.id, TIPOS_DE_EVENTO.faseDespachada, {
    fase: 'GO',
    sessionId: SESSAO_A,
  });
  registrar(dirThread(p.dir, morta.id), morta.id, TIPOS_DE_EVENTO.faseDespachada, {
    fase: 'GO',
    sessionId: SESSAO_B,
  });

  const apertado = { ...p.carregado, manifesto: { ...p.carregado.manifesto } };
  apertado.manifesto.concurrency = { max_parallel_threads: 2, stale_after_min: 60 };

  // 2 horas depois (stale_after_min=60 ja estourou), a sessao da Viva segue working.
  const estados = new Map([[SESSAO_A, 'working']]);
  const plano = planejar(apertado, { agora: horasDepois(2), estados });
  const vaga = new Map(plano.vagas.map((v) => [v.thread, v]));
  assert.equal(vaga.get(viva.id)?.situacao, 'em-andamento', 'working ignora o stale timeout');
  assert.equal(plano.emAndamento, 1);
  assert.equal(vaga.get(morta.id)?.situacao, 'espera');
  assert.equal(vaga.get(morta.id)?.motivo, 'vaga.stale');
  assert.match(vaga.get(morta.id)?.detalhe ?? '', /stale_after_min/);
  assert.match(vaga.get(morta.id)?.correcao ?? '', /ork phase run/);
  assert.equal(vaga.get(pronta.id)?.situacao, 'pode-avancar', 'a vaga da morta foi devolvida');

  // Antes do timeout a mesma thread morta ainda nao e stale: fica pronta em FIFO.
  const cedo = planejar(apertado, { agora: horasDepois(0.5), estados });
  const vagaCedo = new Map(cedo.vagas.map((v) => [v.thread, v]));
  assert.equal(vagaCedo.get(morta.id)?.situacao, 'pode-avancar');
  p.limpar();
});

test('pausa humana aberta nao ocupa vaga, mas sessao ainda working segue ocupando', () => {
  const p = projetoTemporario('board-humana');
  const t = novaThread(p.carregado, { nome: 'Espera humano', modo: 'classic' }).thread;
  registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.pausaHumana, {
    estado: 'prevista ao fim do bloco',
    fase: 'PLAN',
    sessionId: SESSAO_A,
  });

  // A sessao do bloco ainda trabalha: a pausa nao chegou e a vaga e dela.
  const trabalhando = planejar(p.carregado, {
    agora: horasDepois(0),
    estados: new Map([[SESSAO_A, 'working']]),
  });
  assert.equal(trabalhando.vagas[0].situacao, 'em-andamento');
  assert.equal(trabalhando.emAndamento, 1);

  // A sessao terminou: esperar veredito humano nao ocupa vaga da maquina.
  const esperando = planejar(p.carregado, { agora: horasDepois(0), estados: new Map() });
  assert.equal(esperando.vagas[0].situacao, 'pausada');
  assert.equal(esperando.vagas[0].motivo, 'human.pending');
  assert.equal(esperando.emAndamento, 0);
  assert.match(esperando.vagas[0].correcao, /ork gate approve/);

  // Sessao BLOQUEADA em HITL e a pausa ja chegada: tambem nao ocupa.
  const bloqueada = planejar(p.carregado, {
    agora: horasDepois(0),
    estados: new Map([[SESSAO_A, 'blocked']]),
  });
  assert.equal(bloqueada.vagas[0].situacao, 'pausada');
  assert.equal(bloqueada.emAndamento, 0);
  p.limpar();
});

test('board reap grava slot_released idempotente e o stale nao rejuvenesce com o proprio reap', () => {
  const p = projetoTemporario('board-reap');
  const presa = novaThread(p.carregado, { nome: 'Presa', modo: 'auto' }).thread;
  const pronta = novaThread(p.carregado, { nome: 'Prontinha', modo: 'auto' }).thread;
  fixarOrdem(p.dir, [presa.id, pronta.id]);
  registrar(dirThread(p.dir, presa.id), presa.id, TIPOS_DE_EVENTO.faseDespachada, {
    fase: 'GO',
    sessionId: SESSAO_A,
  });

  const quando = horasDepois(5);
  const opcoes = { agora: quando, estados: new Map<string, string>(), por: 'teste-reap' };
  const devolvidas = devolverVagas(p.carregado, opcoes);
  assert.equal(devolvidas.length, 1);
  assert.equal(devolvidas[0].thread, presa.id);
  assert.equal(devolvidas[0].motivo, 'vaga.stale');
  assert.equal(devolvidas[0].registrada, true);
  assert.match(textoDoReap(devolvidas), /slot_released gravado/);

  const eventos = lerLedger(dirThread(p.dir, presa.id));
  const liberadas = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.vagaLiberada);
  assert.equal(liberadas.length, 1);
  assert.equal(liberadas[0].quem, 'teste-reap');
  assert.equal(liberadas[0].motivo, 'vaga.stale');
  assert.match(String(liberadas[0].razao ?? ''), /procura ativa/);
  assert.match(String(liberadas[0].evidencia ?? ''), /ledger parado desde/);

  // Rodar de novo nao grava linha nova: idempotencia enquanto nada destravar.
  const denovo = devolverVagas(p.carregado, opcoes);
  assert.equal(denovo.length, 1);
  assert.equal(denovo[0].registrada, false);
  assert.equal(
    lerLedger(dirThread(p.dir, presa.id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.vagaLiberada)
      .length,
    1
  );

  // O slot_released NAO conta como atividade: a thread continua stale no plano.
  const plano = planejar(p.carregado, { agora: quando, estados: new Map() });
  const vaga = new Map(plano.vagas.map((v) => [v.thread, v]));
  assert.equal(vaga.get(presa.id)?.motivo, 'vaga.stale');
  assert.equal(vaga.get(pronta.id)?.situacao, 'pode-avancar');

  // Um novo despacho destrava; se a thread travar de novo, o reap registra de novo.
  registrar(dirThread(p.dir, presa.id), presa.id, TIPOS_DE_EVENTO.faseDespachada, {
    fase: 'CHECK',
    sessionId: SESSAO_B,
  });
  assert.equal(devolverVagas(p.carregado, { ...opcoes, agora: horasDepois(10) }).length, 1);
  assert.equal(
    lerLedger(dirThread(p.dir, presa.id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.vagaLiberada)
      .length,
    2,
    'depois do destravamento a nova devolucao vira novo evento'
  );
  p.limpar();
});
