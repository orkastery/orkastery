/**
 * RM-039 (receita da C5): os ramos de `master.ts` mudados em 03/10 que a suite so exercitava pela
 * CLI (outro processo) ou nao exercitava: o aceite por omissao com a thread no nucleo, a classe do
 * gate sem motivo ou de ensaio, a base trazida para a branch com merge que o git nao conhece, e o
 * validador do MASTER log. Ledger temporario; nenhum merge real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { projetoTemporario } from './apoio';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPendentesPorOmissao, aceitosPorOmissao, AUTOR_DA_OMISSAO, caminhoPostmortem, CONTRATO_MASTER_LOG, entregasParaOmissao,
  masterRatificado, motivoForaDaOmissao, validarMasterLog, validarMasterPendente, VERSAO_MASTER_LOG } from '../src/master';
import { dirThread, novaThread } from '../src/thread';

type Projeto = ReturnType<typeof projetoTemporario>;

function entregue(p: Projeto, nome: string, antes: (dir: string, id: string) => void = () => {}, mergeSha = 'a'.repeat(40)) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', slug: 'x' });
  antes(dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, { fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha, pushVerificado: true });
  return thread;
}

const classes = (p: Projeto, id: string): string[] => JSON.parse(fs.readFileSync(caminhoPostmortem(p.dir, id), 'utf8')).classesDeFalha;

test('C5 master omissao: com a thread so ela entra e fecha; thread inexistente recusa; os motivos de fora', () => {
  const p = projetoTemporario('c5-master-alvo');
  try {
    const minha = entregue(p, 'minha frente'), outra = entregue(p, 'outra frente');
    const { thread: semEntrega } = novaThread(p.carregado, { nome: 'sem entrega', modo: 'auto' });
    assert.deepEqual(entregasParaOmissao(p.dir, minha.id).map((x) => x.thread.id), [minha.id]);
    assert.deepEqual(entregasParaOmissao(p.dir).map((x) => x.thread.id).sort(), [minha.id, outra.id].sort());
    assert.deepEqual(entregasParaOmissao(p.dir, semEntrega.id), [], 'a indicada sem entrega nao vira as outras');
    assert.throws(() => entregasParaOmissao(p.dir, 'ork-nao-existe'));
    assert.equal(motivoForaDaOmissao(p.dir, semEntrega.id)?.motivo, 'sem-entrega');
    assert.equal(motivoForaDaOmissao(p.dir, minha.id), null);

    const aceitos = aceitarPendentesPorOmissao(p.dir, { thread: minha.id });
    assert.deepEqual(aceitos.map((a) => a.thread), [minha.id]);
    assert.equal(masterRatificado(p.dir, minha.id), true);
    assert.equal(masterRatificado(p.dir, outra.id), false, 'a outra frente nao foi tocada');
    assert.equal(motivoForaDaOmissao(p.dir, minha.id)?.motivo, 'ja-fechada');

    // Um aceite antigo sem autor nem hora no ledger sai com os padroes, e o score gravado ao lado.
    registrar(dirThread(p.dir, outra.id), outra.id, TIPOS_DE_EVENTO.aceitePorOmissao, { fase: 'MASTER' });
    const lidos = aceitosPorOmissao(p.dir);
    const daOutra = lidos.find((a) => a.thread === outra.id)!;
    assert.equal(daOutra.decididoPor, AUTOR_DA_OMISSAO);
    assert.equal(daOutra.scoreGravado, null);
    assert.equal(typeof lidos.find((a) => a.thread === minha.id)!.scoreGravado, 'number');
  } finally { p.limpar(); }
});

test('C5 master classes: gate sem motivo e "outra", gate de ensaio nao conta, base trazida junta base-avancou', () => {
  const p = projetoTemporario('c5-master-classes');
  try {
    const semMotivo = entregue(p, 'gate sem motivo', (dir, id) => {
      registrar(dir, id, TIPOS_DE_EVENTO.gateBloqueado, { fase: 'SHIP' });
      registrar(dir, id, TIPOS_DE_EVENTO.gateBloqueado, { fase: 'SHIP', motivo: 'ci.failed', dryRun: true });
    });
    const ensaio = entregue(p, 'so ensaio', (dir, id) => {
      registrar(dir, id, TIPOS_DE_EVENTO.gateBloqueado, { fase: 'SHIP', motivo: 'lease.busy', dryRun: true });
    }, 'nao-e-sha');
    const sincronizada = entregue(p, 'trouxe a base', (dir, id) => {
      registrar(dir, id, TIPOS_DE_EVENTO.worktreeSincronizada, { fase: 'GO' });
      registrar(dir, id, TIPOS_DE_EVENTO.gateBloqueado, { fase: 'SHIP', motivo: 'lease.busy' });
    });
    aceitarPendentesPorOmissao(p.dir);
    assert.deepEqual(classes(p, semMotivo.id), ['outra']);
    assert.deepEqual(classes(p, ensaio.id), ['sem-falha'], 'o gate do --dry-run nao reprova, e o merge que nao e sha nao conta');
    assert.deepEqual(classes(p, sincronizada.id), ['base-avancou', 'conflito']);
  } finally { p.limpar(); }
});

function logValido(): Record<string, unknown> {
  return { contrato: CONTRATO_MASTER_LOG, versao: VERSAO_MASTER_LOG, thread: 'ork-x', slug: 'ork-x-full', modo: 'auto', tag: '#Auto',
    justificativa: 'j', resumo: 'r', fases: ['GOAL', 'MASTER'], classesDeFalha: ['sem-falha'], projeto: { name: 'orkastery', abbrev: 'ork' },
    base: { branch: 'main', commit: 'c' }, evidencia: { ledger: 'l', postmortem: 'p' }, score: 5, avaliadoEm: '2026-10-03T10:00:00Z',
    avaliadoPor: 'Julio' };
}

test('C5 master log: cada campo fora do contrato da o erro dele; nao objeto recusa nos dois validadores', () => {
  assert.deepEqual(validarMasterLog(logValido()), []);
  assert.deepEqual(validarMasterLog(null), ['o MASTER log nao e um objeto']);
  assert.deepEqual(validarMasterPendente('texto'), ['o MASTER log nao e um objeto']);
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ versao: 2 }, /campo "versao" deve ser 1/],
    [{ fases: [] }, /campo "fases" deve listar as fases percorridas/],
    [{ fases: ['GOAL', 'DEPLOY'] }, /fase fora do ciclo canonico: DEPLOY/],
    [{ classesDeFalha: [] }, /deve ter ao menos uma classe fixa/],
    [{ classesDeFalha: ['azar'] }, /classe fora do catalogo fixo: azar/],
    [{ projeto: { name: 'x' } }, /campo "projeto" precisa de name e abbrev/],
    [{ base: null }, /campo "base" precisa de branch e commit/],
    [{ evidencia: { ledger: 'l' } }, /campo "evidencia" precisa apontar/],
    [{ resumo: '  ' }, /campo "resumo" ausente ou vazio/],
  ];
  for (const [mudanca, erro] of casos) {
    const erros = validarMasterLog({ ...logValido(), ...mudanca });
    assert.equal(erros.length, 1, `${JSON.stringify(mudanca)}: ${erros.join('; ')}`);
    assert.match(erros[0], erro);
  }
});
