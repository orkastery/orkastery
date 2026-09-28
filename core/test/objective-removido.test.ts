/**
 * I-43 (D4, T11): o Objective Envelope sai do produto.
 *
 * O que ele era, medido e nao suposto: um envelope em disco (`obj-i27gatedomae`) em
 * `awaiting_approval` desde 17/09, com tres threads de ZERO sessoes, descrevendo um
 * gate que nao bloqueava nada. A unica consulta do produto ao envelope estava em
 * `phase.ts` e dependia de `thread.creationOrigin`; das 137 threads do projeto, ZERO
 * tinham `creationOrigin`. O ramo nunca disparou para thread nenhuma, e a "unica pausa
 * planejada do #Maestro" nao bloqueava nem as tres threads que ela mesma criou.
 *
 * As DUAS VIGAS sairam vivas antes (T9 e T10), e e isso que torna esta remocao honesta
 * em vez de uma aposta. Este arquivo cobra as duas coisas juntas: o que saiu, e o que
 * ficou no lugar.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { estadoParaDespacho } from '../src/phase';
import { CANARIOS } from '../src/canarios';
import { lerThread, novaThread } from '../src/thread';

const CLI = path.resolve(__dirname, '../src/index.js');
function ork(cwd: string, args: string[]): { saida: string; codigo: number } {
  try {
    return { saida: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }), codigo: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { saida: (err.stdout ?? '') + (err.stderr ?? ''), codigo: err.status ?? 1 };
  }
}

test('`ork objective` sai com codigo != 0 e recusa TIPADA em todo subcomando', () => {
  const p = projetoTemporario('objective-removido');
  try {
    for (const sub of ['list', 'new', 'status', 'approve', 'revise', 'validate', 'message', 'stop']) {
      const r = ork(p.dir, ['objective', sub]);
      assert.notEqual(r.codigo, 0, `objective ${sub} deveria recusar`);
      assert.match(r.saida, /objective\.aposentado/, r.saida);
      // Sumir em silencio seria o mesmo pecado da #TAG aposentada virando default:
      // a recusa precisa dizer para ONDE ir.
      assert.match(r.saida, /--exige-runtime-diferente/, r.saida);
      assert.match(r.saida, /--done/, r.saida);
    }
  } finally { p.limpar(); }
});

test('thread sem creationOrigin despacha normalmente depois da remocao', () => {
  const p = projetoTemporario('objective-despacho');
  try {
    // Era o ramo morto: ele so podia disparar com `creationOrigin`, e nenhuma das 137
    // threads do projeto tinha. Agora `estadoParaDespacho` so confere ESTADO.
    const { thread } = novaThread(p.carregado, { nome: 'comum', modo: 'auto' });
    assert.equal(lerThread(p.dir, thread.id).creationOrigin ?? null, null);
    assert.equal(estadoParaDespacho(p.dir, lerThread(p.dir, thread.id)), null);
  } finally { p.limpar(); }
});

test('D9 CANCELADA: o canario FICA, porque o sujeito dele continua vivo', () => {
  const ids = CANARIOS.map((c) => c.id);

  // D9 mandava tirar `fx-objective-oscillation`, justificando que "sem envelope nao ha
  // revisao nem objetivo: a propriedade deixa de existir junto com o mecanismo".
  //
  // A premissa NAO se sustentou na execucao. O que saiu foi o COMANDO `ork objective`;
  // o modulo `objective.ts` FICA, porque `creation-operation.ts`, `portfolio-context.ts`
  // e `maestro-sources.ts` dependem dele, e `createObjective`/`reviseObjective`
  // continuam exportados. O canario continua tendo sujeito: ele exercita a guarda de
  // oscilacao de codigo VIVO.
  //
  // Tira-lo seria remover cobertura de codigo que permanece, que e o oposto do que a
  // I-43 existe para fazer. A remocao foi cancelada com motivo escrito, e este teste
  // trava a decisao para ela nao ser desfeita por distracao.
  assert.ok(ids.includes('fx-objective-oscillation'),
    'o canario fica enquanto createObjective/reviseObjective existirem');

  // As vigas que SAIRAM VIVAS tem canario proprio, e e isso que libera a remocao do
  // comando.
  assert.ok(ids.includes('fx-check-runtime-cruzado'), 'a viga (a) precisa de canario');
  assert.ok(ids.includes('fx-donewhen-executavel'), 'a viga (b) precisa de canario');
});

test('as duas vigas continuam existindo, agora como propriedade de thread comum', () => {
  const p = projetoTemporario('objective-vigas');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'com vigas', modo: 'auto',
      exigeRuntimeDiferente: true,
      doneWhen: [{ criterio: 'o README existe', comando: 'test -f README.md' }] });
    const t = lerThread(p.dir, thread.id);
    // Elas moram na THREAD, e nao num envelope a parte que ninguem abre.
    assert.equal(t.exigeRuntimeDiferente, true);
    assert.equal(t.doneWhen?.length, 1);
    assert.equal(t.doneWhen?.[0].comando, 'test -f README.md');
  } finally { p.limpar(); }
});
