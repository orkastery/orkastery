/**
 * RM-008 (classe pelo gate): sem `--classe`, o MASTER infere a classe de falha pelo motivo tipado.
 *
 * Em 03/10/2026, 8 POSTMORTEMs fecharam pelo aceite por omissao com `classesDeFalha: ["outra"]`
 * (ork-provadeativa, ork-rm047remotod, ork-rm052projeto, ork-rm053network, ork-rm054fatia3s,
 * ork-rm054roadmap, ork-rm057fatia2c e ork-rm057fatia3t), embora cada gate tivesse motivo tipado
 * (`claims.failed`, `verify.failed`, `runtime.unavailable`). "outra" e a classe que o `ork licoes`
 * ignora, entao o loop de aprendizado nao via nenhuma dessas falhas.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPorOmissao, CLASSE_DO_MOTIVO, CLASSES_DE_FALHA, classesPelosGates, lerMasterLog, registrarMaster } from '../src/master';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { dirThread, novaThread } from '../src/thread';
import { ClasseDeFalha } from '../src/types';

function entregueCom(p: ReturnType<typeof projetoTemporario>, nome: string, motivos: string[]): string {
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', slug: 'x' });
  for (const motivo of motivos) registrar(dir, t.id, TIPOS_DE_EVENTO.gateBloqueado, { motivo, detalhe: 'teste' });
  registrar(dir, t.id, TIPOS_DE_EVENTO.shipConcluido, {
    fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true,
  });
  return t.id;
}

test('RM-008 classe pelo gate: cada motivo da tabela vira a classe dele no MASTER sem --classe', () => {
  const p = projetoTemporario('rm008-classe-tabela');
  try {
    for (const [motivo, classe] of Object.entries(CLASSE_DO_MOTIVO)) {
      const id = entregueCom(p, `t-${motivo.replace(/[^a-z]/g, '')}`, [motivo]);
      const r = registrarMaster(p.dir, id, { score: 4, justificativa: 'teste da tabela', por: 'julio' });
      assert.deepEqual(r.masterLog.classesDeFalha, [classe], motivo);
      assert.equal(r.classesInferidas, true);
      assert.ok(r.avisos.some((a) => a.includes(motivo) && a.includes(`"${classe}"`)), `o aviso cita ${motivo} e ${classe}`);
    }
  } finally { p.limpar(); }
});

function classesDoAceite(raiz: string, id: string): ClasseDeFalha[] {
  aceitarPorOmissao(raiz, id);
  return lerMasterLog(raiz, id)?.classesDeFalha ?? [];
}

test('RM-008 classe pelo gate: o aceite por omissao dos casos de 03/10 deixa de gravar so "outra"', () => {
  const p = projetoTemporario('rm008-classe-omissao');
  try {
    const claims = entregueCom(p, 'claims', ['claims.failed']);
    const verify = entregueCom(p, 'verify', ['verify.failed']);
    const runtime = entregueCom(p, 'runtime', ['runtime.unavailable']);
    assert.deepEqual(classesDoAceite(p.dir, claims), ['processo']);
    assert.deepEqual(classesDoAceite(p.dir, verify), ['processo']);
    // Falha de infraestrutura nao cabe em classe fixa: segue "outra", com a justificativa.
    assert.deepEqual(classesDoAceite(p.dir, runtime), ['outra']);
  } finally { p.limpar(); }
});

test('RM-008 classe pelo gate: motivos misturados juntam as classes na ordem canonica; --classe vence', () => {
  assert.deepEqual(classesPelosGates(['lease.busy', 'claims.failed', 'runtime.silencio', 'claims.failed']),
    ['conflito', 'processo', 'outra']);
  assert.deepEqual(classesPelosGates(['runtime.rate-limited']), ['rate-limit']);
  assert.deepEqual(classesPelosGates([]), ['sem-falha']);
  const p = projetoTemporario('rm008-classe-explicita');
  try {
    const id = entregueCom(p, 'explicita', ['claims.failed']);
    const r = registrarMaster(p.dir, id, { score: 3, justificativa: 'o plano errou', por: 'julio', classes: ['erro-de-spec'] });
    assert.deepEqual(r.masterLog.classesDeFalha, ['erro-de-spec']);
    assert.equal(r.classesInferidas, false);
  } finally { p.limpar(); }
});

test('RM-008 classe pelo gate: a tabela so usa motivos do catalogo e classes fixas, sem string livre', () => {
  for (const [motivo, classe] of Object.entries(CLASSE_DO_MOTIVO)) {
    assert.ok(motivo in DESCRICAO_DO_MOTIVO, `${motivo} existe no catalogo do gate`);
    assert.ok((classe as ClasseDeFalha) in CLASSES_DE_FALHA, `${classe} e classe fixa`);
    assert.notEqual(classe, 'outra', 'motivo na tabela nunca aponta para "outra"');
  }
  assert.equal('human.pending' in CLASSE_DO_MOTIVO, false, 'espera humana nao e falha');
});
