/** Testes do bloco B2: modulo MASTER, POSTMORTEM tipado, MASTER log e batch scoring. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { projetoTemporario } from './apoio';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import {
  CONTRATO_MASTER_LOG,
  caminhoMasterLog,
  caminhoPostmortem,
  lerMasterLog,
  ORDEM_DAS_CLASSES,
  parseClasse,
  pendentesDeScore,
  registrarMaster,
  tabelaDeEntregas,
  validarMasterLog,
} from '../src/master';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { MasterLog } from '../src/types';

/** Simula uma thread que ja entregou: o ship_done que o `ork ship` grava de verdade. */
function fingirEntrega(dir: string, id: string): void {
  registrar(dirThread(dir, id), id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', slug: 'x' });
  registrar(dirThread(dir, id), id, TIPOS_DE_EVENTO.shipConcluido, {
    fase: 'SHIP',
    de: 'ork/x',
    para: 'main',
    mergeSha: 'a'.repeat(40),
    pushVerificado: true,
  });
}

test('master recusa score sem justificativa e score fora de 0 a 5', () => {
  const p = projetoTemporario('master-recusa');
  const { thread } = novaThread(p.carregado, { nome: 'Recusa', modo: 'classic' });

  assert.throws(
    () => registrarMaster(p.dir, thread.id, { score: 4, justificativa: '' }),
    /score sem justificativa/
  );
  assert.throws(
    () => registrarMaster(p.dir, thread.id, { score: 4, justificativa: '   ' }),
    /score sem justificativa/
  );
  assert.throws(
    () => registrarMaster(p.dir, thread.id, { score: 6, justificativa: 'entregou tudo' }),
    /score invalido/
  );
  assert.throws(
    () => registrarMaster(p.dir, thread.id, { score: 3.5, justificativa: 'entregou tudo' }),
    /score invalido/
  );

  // Nada foi gravado: a thread continua aberta e sem POSTMORTEM.
  assert.equal(fs.existsSync(caminhoPostmortem(p.dir, thread.id)), false);
  assert.equal(lerThread(p.dir, thread.id).status, 'aberta');
  p.limpar();
});

test('master aceita score 0-5 com justificativa, grava POSTMORTEM e MASTER log valido', () => {
  const p = projetoTemporario('master-ok');
  const { thread } = novaThread(p.carregado, { nome: 'Entrega', modo: 'classic' });
  // I-43: nenhum modo VIVO pausa no MASTER (em `#Classic` ele vive no bloco
  // SHIP-MASTER, que nao pausa). O regime `pausa` e propriedade da THREAD, entao ela
  // declara o bloco; o caminho continua coberto em vez de sumir com o modo.
  thread.blocos = [{ fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP'], pausa: false, pausaSobre: '', slugFases: 'f12345' },
    { fases: ['MASTER'], pausa: true, pausaSobre: 'score', slugFases: 'master' }];
  gravarThread(p.dir, thread);
  fingirEntrega(p.dir, thread.id);

  const r = registrarMaster(p.dir, thread.id, {
    score: 4,
    justificativa: 'entregou o combinado, com uma ressincronizacao de base no meio',
    classes: ['base-avancou'],
    por: 'julio',
  });

  assert.equal(r.masterLog.score, 4);
  assert.equal(r.masterLog.contrato, CONTRATO_MASTER_LOG);
  assert.deepEqual(r.masterLog.classesDeFalha, ['base-avancou']);
  assert.equal(r.masterLog.avaliadoPor, 'julio');
  assert.equal(r.classesInferidas, false);
  assert.deepEqual(validarMasterLog(r.masterLog), [], 'MASTER log valido pelo contrato congelado');

  // Os dois arquivos existem e o que esta em disco tambem passa no contrato.
  assert.ok(fs.existsSync(caminhoPostmortem(p.dir, thread.id)));
  assert.ok(fs.existsSync(caminhoMasterLog(p.dir, thread.id)));
  const emDisco = lerMasterLog(p.dir, thread.id) as MasterLog;
  assert.deepEqual(validarMasterLog(emDisco), []);
  assert.equal(emDisco.thread, thread.id);
  assert.equal(emDisco.slug, thread.slug);
  assert.equal(emDisco.evidencia.postmortem, `.orkastery/threads/${thread.id}/POSTMORTEM.json`);

  // O POSTMORTEM reconstroi as fases pelo LEDGER e carrega a entrega provada.
  assert.deepEqual(r.postmortem.fasesPercorridas.map((f) => f.fase), ['GO', 'SHIP']);
  assert.equal(r.postmortem.entregas.length, 1);
  assert.equal(r.postmortem.entregas[0].pushVerificado, true);
  assert.equal(r.postmortem.score.regime, 'pausa', 'o bloco MASTER declarado pausa');

  // A thread fecha e o ledger registra o master_done.
  const fechada = lerThread(p.dir, thread.id);
  assert.equal(fechada.status, 'fechada');
  assert.equal(fechada.faseAtual, 'MASTER');
  assert.equal(fechada.score?.valor, 4);
  const eventos = lerLedger(dirThread(p.dir, thread.id));
  assert.equal(eventos.filter((e) => e.tipo === 'postmortem_recorded').length, 1);
  const master = eventos.filter((e) => e.tipo === 'master_done');
  assert.equal(master.length, 1);
  assert.equal(master[0].score, 4);

  // Score ja dado nao e sobrescrito sem --refazer.
  assert.throws(
    () => registrarMaster(p.dir, thread.id, { score: 2, justificativa: 'mudei de ideia' }),
    /ja tem score 4\/5/
  );
  const refeito = registrarMaster(p.dir, thread.id, {
    score: 2,
    justificativa: 'revi a entrega e ela deixou divida',
    classes: ['processo'],
    refazer: true, por: 'julio',
  });
  assert.equal(refeito.masterLog.score, 2);
  p.limpar();
});

test('score 0 com justificativa e aceito: o extremo da escala tambem vale', () => {
  const p = projetoTemporario('master-zero');
  const { thread } = novaThread(p.carregado, { nome: 'Zero', modo: 'auto' });
  fingirEntrega(p.dir, thread.id);
  const r = registrarMaster(p.dir, thread.id, {
    por: 'julio',
    score: 0,
    justificativa: 'a entrega verificada não atendeu à expectativa humana',
    classes: ['erro-de-spec', 'processo'],
  });
  assert.equal(r.masterLog.score, 0);
  assert.deepEqual(r.masterLog.classesDeFalha, ['erro-de-spec', 'processo']);
  assert.equal(r.postmortem.score.regime, 'batch', '#Auto entrega sem pausa: score em batch');
  assert.deepEqual(validarMasterLog(r.masterLog), []);
  p.limpar();
});

test('classes de falha sao fixas e o acento do pedido do builder e normalizado', () => {
  assert.equal(parseClasse('base-avancou'), 'base-avancou');
  assert.equal(parseClasse('base-avançou'), 'base-avancou');
  assert.equal(parseClasse('Scope Creep'), 'scope-creep');
  assert.equal(parseClasse('inventada'), null);
  assert.equal(ORDEM_DAS_CLASSES.length, 9);

  const base = {
    contrato: CONTRATO_MASTER_LOG,
    versao: 1,
    thread: 'ork-x',
    slug: 'ork-x-full',
    projeto: { name: 'p', abbrev: 'ork' },
    modo: 'auto',
    tag: '#Auto',
    variante: null,
    fases: ['GOAL'],
    score: 3,
    justificativa: 'ok',
    avaliadoPor: 'julio',
    avaliadoEm: new Date().toISOString(),
    classesDeFalha: ['sem-falha'],
    resumo: 'resumo',
    base: { branch: 'main', commit: 'abc' },
    worktree: null,
    evidencia: { ledger: 'l', postmortem: 'p', eventos: 1, sessoes: 0, claims: 0 },
  };
  assert.deepEqual(validarMasterLog(base), []);
  assert.ok(validarMasterLog({ ...base, classesDeFalha: ['inventada'] })[0].includes('catalogo fixo'));
  assert.ok(validarMasterLog({ ...base, score: 9 })[0].includes('inteiro de 0 a 5'));
  assert.ok(validarMasterLog({ ...base, fases: ['F7'] })[0].includes('fora do ciclo canonico'));
  assert.ok(validarMasterLog({ ...base, contrato: 'outro' })[0].includes('contrato'));
});

test('master --batch lista as threads entregues sem score e some com elas depois do score', () => {
  const p = projetoTemporario('master-batch');
  const a = novaThread(p.carregado, { nome: 'Auto Um', modo: 'auto' }).thread;
  const b = novaThread(p.carregado, { nome: 'Maestro Dois', modo: 'maestro' }).thread;
  const c = novaThread(p.carregado, { nome: 'Aberta Tres', modo: 'classic' }).thread;
  fingirEntrega(p.dir, a.id);
  fingirEntrega(p.dir, b.id);

  const pendentes = pendentesDeScore(p.dir);
  assert.equal(pendentes.length, 2, 'so as que entregaram entram na visao de entregas');
  assert.deepEqual(pendentes.map((x) => x.thread.id).sort(), [a.id, b.id].sort());
  assert.deepEqual(pendentes.map((x) => x.regime), ['batch', 'batch']);
  assert.equal(pendentes.every((x) => x.entregou), true);

  const texto = tabelaDeEntregas(p.dir);
  assert.match(texto, new RegExp(a.id));
  assert.match(texto, new RegExp(b.id));
  assert.doesNotMatch(texto, new RegExp(c.id));
  assert.match(texto, /ork master .* --score <0-5> --justificativa/);
  // I-43: o que era "fila esperando o humano" passa a trazer o indice ja derivado.
  assert.match(texto, /indice ja derivado do ledger/);
  assert.match(texto, /ENTREGUE E ACEITO/);
  assert.doesNotMatch(texto, /Fila de score/);

  // Com --todas, a thread que ainda nao entregou tambem aparece.
  assert.match(tabelaDeEntregas(p.dir, true), new RegExp(c.id));

  registrarMaster(p.dir, a.id, { score: 5, justificativa: 'entrega limpa', classes: ['sem-falha'], por: 'julio' });
  const depois = pendentesDeScore(p.dir);
  assert.equal(depois.length, 1);
  assert.equal(depois[0].thread.id, b.id);
  p.limpar();
});

test('sem --classe o ork infere a classe do ledger e avisa o humano', () => {
  const p = projetoTemporario('master-infere');
  const limpa = novaThread(p.carregado, { nome: 'Limpa', modo: 'auto' }).thread;
  const suja = novaThread(p.carregado, { nome: 'Suja', modo: 'auto' }).thread;
  registrar(dirThread(p.dir, suja.id), suja.id, TIPOS_DE_EVENTO.gateBloqueado, {
    motivo: 'claims.failed',
    detalhe: 'alegacao negativa sem comando',
  });

  fingirEntrega(p.dir, limpa.id);
  fingirEntrega(p.dir, suja.id);
  const semGate = registrarMaster(p.dir, limpa.id, { score: 5, justificativa: 'sem incidente', por: 'julio' });
  assert.equal(semGate.classesInferidas, true);
  assert.deepEqual(semGate.masterLog.classesDeFalha, ['sem-falha']);

  const comGate = registrarMaster(p.dir, suja.id, { score: 3, justificativa: 'reprovou no gate', por: 'julio' });
  assert.equal(comGate.classesInferidas, true);
  assert.deepEqual(comGate.masterLog.classesDeFalha, ['outra']);
  assert.equal(comGate.postmortem.gatesBloqueados.length, 1);
  assert.match(comGate.avisos[0], /--classe/);
  p.limpar();
});
