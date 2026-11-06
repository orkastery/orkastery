import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim, anexarComando, gravarClaim, lerClaims } from '../src/claims';
import { registrar } from '../src/ledger';
import { provasDaEntrega } from '../src/noctum-provas';
import { chaveDoReciboDeProva, mesmaChaveDoRecibo } from '../src/recibo-prova';
import { dirThread } from '../src/thread';
import { ciFalso, concluirRevisao, entregaPronta, FORJA, projetoDaEntrega, sessaoDespachada, threadComWorktree } from './noctum-entrega-apoio';

function fixture(nome: string) {
  const p = projetoDaEntrega(nome);
  const t = threadComWorktree(p, nome);
  const docs = path.join(dirThread(p.dir, t.id), 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'plan.md'), '# PLAN\n\nT1\n');
  adicionarClaim(p.dir, t.id, { arquivo: 'core/src/x.ts', alegacao: 'x devolve o valor', verificar: ['node -e "process.exit(0)"'], semProvaLocal: true });
  return { p, t };
}

test('RM-078 chave: HEAD, id/comandos das claims e bytes do plano invalidam isoladamente', () => {
  const { p, t } = fixture('rm078-chave');
  try {
    const head = 'a'.repeat(40);
    const inicial = chaveDoReciboDeProva(p.dir, t.id, head);
    assert.equal(mesmaChaveDoRecibo(inicial, chaveDoReciboDeProva(p.dir, t.id, head)), true);
    const somenteHead = { ...inicial, head: 'b'.repeat(40) };
    const somenteClaims = { ...inicial, claimsSha256: 'c'.repeat(64) };
    const somentePlano = { ...inicial, planoSha256: 'd'.repeat(64) };
    assert.equal(mesmaChaveDoRecibo(somenteHead, inicial), false, 'recibo difere só no HEAD');
    assert.equal(mesmaChaveDoRecibo(somenteClaims, inicial), false, 'recibo difere só nas claims');
    assert.equal(mesmaChaveDoRecibo(somentePlano, inicial), false, 'recibo difere só no plano');
    assert.equal(mesmaChaveDoRecibo(inicial, chaveDoReciboDeProva(p.dir, t.id, 'b'.repeat(40))), false, 'HEAD');

    adicionarClaim(p.dir, t.id, { arquivo: 'core/src/y.ts', alegacao: 'y devolve o valor',
      verificar: ['node -e "process.exit(0)"'], semProvaLocal: true });
    assert.equal(mesmaChaveDoRecibo(inicial, chaveDoReciboDeProva(p.dir, t.id, head)), false, 'id da claim');

    const depoisDoId = chaveDoReciboDeProva(p.dir, t.id, head);
    anexarComando(p.dir, t.id, 'C1', 'node -e "process.exit(0)"');
    assert.equal(mesmaChaveDoRecibo(depoisDoId, chaveDoReciboDeProva(p.dir, t.id, head)), false, 'comando da claim');

    const depoisDaClaim = chaveDoReciboDeProva(p.dir, t.id, head);
    fs.appendFileSync(path.join(dirThread(p.dir, t.id), 'docs', 'plan.md'), '\nT2\n');
    assert.equal(mesmaChaveDoRecibo(depoisDaClaim, chaveDoReciboDeProva(p.dir, t.id, head)), false, 'plano');
  } finally { p.limpar(); }
});

test('RM-078 chave: dependência externa é explícita e plano ausente não vira equivalência', () => {
  const { p, t } = fixture('rm078-externa');
  try {
    adicionarClaim(p.dir, t.id, { arquivo: 'core/src/y.ts', alegacao: 'y responde', verificar: ['node -e "process.exit(0)"'],
      dependenciasExternas: ['rede'], semProvaLocal: true });
    const comRede = chaveDoReciboDeProva(p.dir, t.id, 'c'.repeat(40));
    assert.deepEqual(comRede.dependenciasExternas, ['rede']);
    fs.rmSync(path.join(dirThread(p.dir, t.id), 'docs', 'plan.md'));
    const semPlano = chaveDoReciboDeProva(p.dir, t.id, 'c'.repeat(40));
    assert.equal(semPlano.planoSha256, null);
    assert.equal(mesmaChaveDoRecibo(semPlano, semPlano), false);
  } finally { p.limpar(); }
});

const motivo = (p: ReturnType<typeof provasDaEntrega>, id: string) => p.provas.find((x) => x.id === id)?.motivo ?? null;

test('RM-078 recibos: GO sem commit conserva verify e revisão; mudança do plano invalida ambos', () => {
  const p = projetoDaEntrega('rm078-reuso');
  try {
    const e = entregaPronta(p, 'rm078reuso');
    const opcoes = { forja: FORJA, executorCi: ciFalso({ [e.fonte]: 'success' as const }) };
    assert.deepEqual([motivo(provasDaEntrega(p.carregado, e.t.id, opcoes), 'verify'),
      motivo(provasDaEntrega(p.carregado, e.t.id, opcoes), 'revisao')], [null, null]);

    const go = sessaoDespachada(p, e.t.id, 'GO');
    registrar(dirThread(p.dir, e.t.id), e.t.id, 'phase_result', { fase: 'GO', sessionId: go.sessionId,
      classificacao: 'fase_concluida', ok: true, resultado: 'go.sem-mudanca' });
    const reutilizado = provasDaEntrega(p.carregado, e.t.id, opcoes);
    assert.deepEqual([motivo(reutilizado, 'verify'), motivo(reutilizado, 'revisao')], [null, null]);

    fs.appendFileSync(path.join(dirThread(p.dir, e.t.id), 'docs', 'plan.md'), '\nTarefa alterada\n');
    const planoMudou = provasDaEntrega(p.carregado, e.t.id, opcoes);
    assert.deepEqual([motivo(planoMudou, 'verify'), motivo(planoMudou, 'revisao')],
      ['noctum.entrega.verify-ausente', 'noctum.entrega.revisao-antiga']);
  } finally { p.limpar(); }
});

test('RM-078 recibos: dependência externa exige verify depois do GO sem commit', () => {
  const p = projetoDaEntrega('rm078-rede');
  try {
    const e = entregaPronta(p, 'rm078rede');
    const claim = lerClaims(p.dir, e.t.id)[0];
    gravarClaim(p.dir, { ...claim, dependenciasExternas: ['rede'] });
    const revisor = sessaoDespachada(p, e.t.id, 'CHECK');
    concluirRevisao(p, e.t.id, revisor, 'PASSOU', e.fonte);
    const opcoes = { forja: FORJA, executorCi: ciFalso({ [e.fonte]: 'success' as const }) };
    assert.equal(motivo(provasDaEntrega(p.carregado, e.t.id, opcoes), 'verify'), null);

    const go = sessaoDespachada(p, e.t.id, 'GO');
    registrar(dirThread(p.dir, e.t.id), e.t.id, 'phase_result', { fase: 'GO', sessionId: go.sessionId,
      classificacao: 'fase_concluida', ok: true, resultado: 'go.sem-mudanca' });
    assert.equal(motivo(provasDaEntrega(p.carregado, e.t.id, opcoes), 'verify'), 'noctum.entrega.verify-ausente');
  } finally { p.limpar(); }
});
