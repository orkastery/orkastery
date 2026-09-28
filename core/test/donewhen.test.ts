/**
 * I-43 (D4, viga b): `doneWhen` deixa de ser prosa e vira comando.
 *
 * Dentro do Objective Envelope, `objective.ts:205` despejava os criterios como lista
 * no `SPEC.md` e NENHUM codigo os executava. Os criterios do envelope real eram frases
 * do tipo "D1: ork phase run recusa o despacho quando o objective da thread nao esta
 * approved, com teste que cobre a recusa". Bonito, e impossivel de reprovar.
 *
 * Salvar esta viga nao foi mover codigo, foi criar capacidade: criterio de pronto vira
 * comando, com saida e codigo de retorno, rodado pela MAQUINA QUE JA EXISTE (claims e
 * verify). A alternativa rejeitada em D4 era um executor proprio, que duplicaria
 * timeout, captura de saida e registro de evidencia; duas maquinas de executar comando
 * divergem, e a divergencia aparece como criterio que passa num lugar e falha no outro.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { ARQUIVO_DONEWHEN, lerClaims, registrarCriteriosDePronto } from '../src/claims';
import { novaThread } from '../src/thread';
import { verificar } from '../src/verify';

test('cada criterio vira uma claim DO NUCLEO, distinguivel de auto-relato de agente', () => {
  const p = projetoTemporario('donewhen-claim');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'com criterio', modo: 'auto', doneWhen: [
      { criterio: 'o README existe', comando: 'test -f README.md' },
    ] });

    const novas = registrarCriteriosDePronto(p.dir, thread.id);
    assert.equal(novas.length, 1);
    assert.equal(novas[0].origem, 'nucleo.doneWhen', 'a claim precisa dizer que veio do nucleo');
    assert.equal(novas[0].arquivo, ARQUIVO_DONEWHEN);
    // A claim carrega o TEXTO do criterio: e por isso que o veredito o nomeia sem
    // precisar de nenhum campo extra.
    assert.match(novas[0].alegacao, /o README existe/);
    assert.deepEqual(novas[0].verificar, ['test -f README.md']);
  } finally { p.limpar(); }
});

test('registrar de novo NAO duplica: verify roda em toda fase', () => {
  const p = projetoTemporario('donewhen-idempotente');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'com criterio', modo: 'auto', doneWhen: [
      { criterio: 'o README existe', comando: 'test -f README.md' },
      { criterio: 'a licenca existe', comando: 'test -f README.md' },
    ] });

    assert.equal(registrarCriteriosDePronto(p.dir, thread.id).length, 2);
    // Uma claim por criterio POR RODADA transformaria a lista num acumulador.
    assert.equal(registrarCriteriosDePronto(p.dir, thread.id).length, 0, 'a segunda passada nao cria nada');
    assert.equal(lerClaims(p.dir, thread.id).filter((c) => c.origem === 'nucleo.doneWhen').length, 2);
  } finally { p.limpar(); }
});

test('criterio que o comando NAO sustenta reprova, e o veredito o NOMEIA', () => {
  const p = projetoTemporario('donewhen-reprova');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'promessa', modo: 'auto', doneWhen: [
      { criterio: 'o README existe', comando: 'test -f README.md' },
      { criterio: 'a entrega prometida existe', comando: 'test -f ENTREGA-QUE-NAO-EXISTE.md' },
    ] });

    // O verify registra os criterios sozinho: quem conduz a fase nao precisa lembrar.
    const r = verificar(p.carregado, thread.id, { soClaims: true });
    assert.equal(r.ok, false, 'criterio que nao se sustenta reprova');
    assert.ok(r.motivos.includes('claims.failed'), `motivo tipado: ${r.motivos.join(', ')}`);

    const reprovada = r.claims.find((c) => !c.verificado);
    assert.ok(reprovada, 'precisa haver uma claim reprovada');
    assert.match(reprovada!.claim.alegacao, /a entrega prometida existe/, 'o veredito nomeia o criterio');

    // E o criterio SUSTENTADO continua passando: a regra nao reprova por reprovar.
    const passou = r.claims.find((c) => c.claim.alegacao.includes('o README existe'));
    assert.equal(passou?.verificado, true);
  } finally { p.limpar(); }
});

test('thread sem criterio nenhum nao ganha claim, e o verify nao muda', () => {
  const p = projetoTemporario('donewhen-vazio');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'sem criterio', modo: 'auto' });
    assert.deepEqual(registrarCriteriosDePronto(p.dir, thread.id), []);
    assert.deepEqual(lerClaims(p.dir, thread.id), []);
    assert.equal(verificar(p.carregado, thread.id, { soClaims: true }).ok, true);
  } finally { p.limpar(); }
});
