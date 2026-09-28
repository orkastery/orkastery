import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetarPergunta } from '../src/adapters/codex-question';
const q = { id: 'deploy', question: 'Qual ambiente?', header: 'Ambiente', isSecret: false, isOther: false,
  options: [{ label: 'Local', description: 'Somente a fixture' }, { label: 'Teste', description: 'Ambiente de teste' }] };
test('F1 SIMULADO: id e conteúdo nativo íntegros, hash muda com texto e opções, campos futuros não propagam', () => {
  const p = projetarPergunta({ isBlocking: true, questions: [{ ...q, futuro: 'não persistir' }] });
  assert.deepEqual(p.options, q.options); assert.equal(p.question, q.question); assert.equal(p.id, q.id);
  assert.ok(!JSON.stringify(p).includes('não persistir'));
  for (const changed of [{ ...q, id: 'outro' }, { ...q, question: 'Aprovar produção?' }, { ...q, options: [{ label: 'Produção', description: 'Outra opção' }] }])
    assert.notEqual(projetarPergunta({ isBlocking: true, questions: [changed] }).sha256, p.sha256);
});
test('F1 SIMULADO: segredo e capacidades não suportadas recusam sem ecoar conteúdo', () => {
  for (const [params, reason] of [
    [{ isBlocking: true, questions: [{ ...q, isSecret: true, question: 'SEGREDO-SIMULADO' }] }, 'secret'],
    [{ isBlocking: false, questions: [q] }, 'nonblocking'], [{ isBlocking: true, questions: [q, q] }, 'multiple'],
    [{ isBlocking: true, questions: [{ ...q, options: [{}] }] }, 'invalid'],
  ] as const) {
    assert.throws(() => projetarPergunta(params), e => e instanceof Error && e.message.endsWith(reason) && !e.message.includes('SEGREDO-SIMULADO'));
  }
});
