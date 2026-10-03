/**
 * RM-057 (fatia 3): o tempo parado por HITL de conducao chega ao `ork pulse` e ao `ork roadmap status`:
 * as perguntas abertas com ha quanto tempo cada uma para a thread, uma linha no resumo do pulse so
 * quando passa da meta de 5 min e a mediana dos ultimos 7 dias. Horas no fuso do dono (RM-035).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { CONTRATO_HITL_V2, PerguntaAoDono } from '../src/hitl-contract';
import { esperasDeHitl, hitlDeConducaoAgora, JANELA_DA_MEDIANA_MS, linhaDoHitlAcimaDaMeta } from '../src/hitl-tempo-parado';
import { resumirHitl, textoDoResumo } from '../src/hitl-resumo';
import { definirFusoDoDono } from '../src/horario';
import { registrar } from '../src/ledger';
import { montarPulse, textoDoPulse } from '../src/pulse';
import { montarStatusDoRoadmap, textoDoStatusDoRoadmap } from '../src/roadmap-status';
import { dirThread, novaThread } from '../src/thread';
import { EventoLedger } from '../src/types';

const BASE = Date.parse('2026-10-03T10:00:00.000Z');
const min = (n: number) => new Date(BASE + n * 60_000).toISOString();
const MIN = 60_000;

function pergunta(id: string, criadoEm: string, extra: Partial<PerguntaAoDono> = {}): PerguntaAoDono {
  return {
    contrato: CONTRATO_HITL_V2, id, thread: 'ork-t', fase: 'GO', modo: 'auto', criadoEm, profundidade: 'resumo',
    classe: 'pergunta', alvo: { tipo: 'gate', sobre: `premissas-${id}` }, motivo: 'human.pending',
    pergunta: 'Qual é o veredito?', corpo: ['Fase GO'], tipoDeResposta: 'objetiva', irreversivel: false, codigo: 'K3F9',
    alternativas: [
      { letra: 'a', texto: 'Aprovar', acao: 'aprovar', consequencia: 'segue', recomendada: true, porque: 'verify verde' },
      { letra: 'b', texto: 'Revisar', acao: 'recusar', consequencia: 'volta' },
      { letra: 'c', texto: 'Esperar', acao: 'esperar', consequencia: 'fica' },
    ],
    prazo: min(600), acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, ...extra,
  };
}
const pedido = (p: PerguntaAoDono): EventoLedger =>
  ({ ts: p.criadoEm, thread: 'ork-t', tipo: 'hitl_requested', pedido: p } as unknown as EventoLedger);
const ev = (tipo: string, ts: string, extra: Record<string, unknown> = {}): EventoLedger =>
  ({ ts, thread: 'ork-t', tipo, ...extra } as unknown as EventoLedger);

test('as abertas saem com há quanto tempo param, da mais antiga para a mais nova; a respondida não', () => {
  const eventos = [
    pedido(pergunta('nova', min(50))),
    pedido(pergunta('velha', min(0))),
    pedido(pergunta('resp', min(10))), ev('human_gate', min(12), { pedidoId: 'resp' }),
    // seguir a recomendada com prazo no futuro: ainda espera agora
    pedido(pergunta('segue', min(55), { prazo: min(90), acaoPadraoAoExpirar: 'seguir-recomendada' })),
  ];
  const h = hitlDeConducaoAgora(esperasDeHitl('ork-t', eventos), min(60));
  assert.deepEqual(h.abertas.map(a => [a.pedidoId, a.paradaHaMin, a.desdeEm]),
    [['velha', 60, min(0)], ['nova', 10, min(50)], ['segue', 5, min(55)]]);
  assert.equal(h.seteDias.respondidos, 1);
  assert.equal(h.seteDias.medianaRespostaMs, 2 * MIN);
  assert.equal(h.acimaDaMeta, true, 'a aberta de 60 min passou da meta');
});

test('acima da meta: aberta além de 5 min ou mediana de 7 dias acima; abaixo, nenhuma linha', () => {
  const dentro = hitlDeConducaoAgora(esperasDeHitl('ork-t', [
    pedido(pergunta('r', min(0))), ev('human_gate', min(3), { pedidoId: 'r' }), pedido(pergunta('a', min(57))),
  ]), min(60));
  assert.equal(dentro.acimaDaMeta, false);
  assert.equal(linhaDoHitlAcimaDaMeta(dentro, { agora: min(60) }), null);
  assert.equal(linhaDoHitlAcimaDaMeta(undefined, { agora: min(60) }), null);

  const mediana = hitlDeConducaoAgora(esperasDeHitl('ork-t', [pedido(pergunta('r', min(0))), ev('human_gate', min(20), { pedidoId: 'r' })]), min(60));
  assert.equal(mediana.abertas.length, 0);
  assert.equal(mediana.acimaDaMeta, true);
  assert.equal(linhaDoHitlAcimaDaMeta(mediana, { agora: min(60) }),
    'HITL de condução acima da meta de 5 min: nenhuma pergunta de condução aberta; mediana de 7 dias 20.0 min (acima da meta de 5 min, 1 resposta(s)).');
});

test('a mediana é dos últimos 7 dias: resposta mais velha não entra', () => {
  const velho = new Date(BASE - JANELA_DA_MEDIANA_MS - 60 * MIN).toISOString();
  const resposta = new Date(BASE - JANELA_DA_MEDIANA_MS - 30 * MIN).toISOString();
  const h = hitlDeConducaoAgora(esperasDeHitl('ork-t', [
    pedido(pergunta('velho', velho)), ev('human_gate', resposta, { pedidoId: 'velho' }),
    pedido(pergunta('r', min(0))), ev('human_gate', min(1), { pedidoId: 'r' }),
  ]), min(60));
  assert.equal(h.seteDias.respondidos, 1);
  assert.equal(h.seteDias.medianaRespostaMs, 1 * MIN);
  assert.equal(h.acimaDaMeta, false);
});

test('o resumo do pulse ganha a linha só acima da meta, nos dois canais, com a hora no fuso do dono', () => {
  definirFusoDoDono('America/Sao_Paulo');
  try {
    const acima = hitlDeConducaoAgora(esperasDeHitl('ork-t', [pedido(pergunta('p', min(0)))]), min(12));
    const r = resumirHitl([], { quando: min(12), hitlDeConducao: acima });
    const telegram = textoDoResumo(r, { canal: 'telegram' });
    assert.match(telegram, /⏳ HITL de condução acima da meta de 5 min: 1 pergunta\(s\) de condução aberta\(s\), a mais antiga ork-t \(GO\) parada há 12min, desde 07:00; mediana de 7 dias sem resposta medida\./);
    assert.match(textoDoResumo(r, { canal: 'terminal' }), /\n {2}HITL de condução acima da meta de 5 min: 1 pergunta/);
    assert.doesNotMatch(telegram, /10:00/, 'nenhuma hora em UTC ao dono');

    const abaixo = hitlDeConducaoAgora(esperasDeHitl('ork-t', [pedido(pergunta('p', min(0)))]), min(3));
    const semLinha = resumirHitl([], { quando: min(3), hitlDeConducao: abaixo });
    assert.equal(semLinha.hitlDeConducao, undefined);
    assert.doesNotMatch(textoDoResumo(semLinha, { canal: 'telegram' }), /HITL de condução/);
  } finally { definirFusoDoDono(undefined); }
});

test('ork pulse e ork roadmap status trazem as abertas com há quanto tempo e a mediana de 7 dias', () => {
  definirFusoDoDono('America/Sao_Paulo');
  const p = projetoTemporario('rm057-fatia3');
  try {
    // sem pergunta de condução: os dois saem como antes, sem o campo
    const antes = montarPulse(p.carregado, { quando: min(0), consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' } });
    assert.equal(antes.hitlDeConducao, undefined);
    assert.doesNotMatch(textoDoPulse(antes), /HITL de condução/);
    assert.equal(montarStatusDoRoadmap(p.dir, { quando: min(0), projeto: 'orkastery' }).hitlDeConducao, undefined);

    const t = novaThread(p.carregado, { nome: 'parado', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'hitl_requested', { ts: min(-30), fase: 'GO', pedido: pergunta('r1', min(-30), { thread: t.id }) });
    registrar(dir, t.id, 'human_gate', { ts: min(-22), fase: 'GO', pedidoId: 'r1', estado: 'aprovado' });
    registrar(dir, t.id, 'hitl_requested', { ts: min(0), fase: 'GO', pedido: pergunta('p1', min(0), { thread: t.id, alvo: { tipo: 'gate', sobre: 'outra' } }) });

    const pulse = montarPulse(p.carregado, { quando: min(12), consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' } });
    const h = pulse.hitlDeConducao!;
    assert.ok(h, 'o pulse traz hitlDeConducao');
    assert.deepEqual(h.abertas.map(a => [a.thread, a.pedidoId, a.paradaHaMin]), [[t.id, 'p1', 12]]);
    assert.equal(h.seteDias.medianaRespostaMs, 8 * MIN);
    assert.equal(h.acimaDaMeta, true);
    const texto = textoDoPulse(pulse);
    assert.match(texto, /HITL de condução: 1 aberta\(s\); mediana de 7 dias 8\.0 min \(acima da meta de 5 min, 1 resposta\(s\)\)/);
    assert.ok(texto.includes(`${t.id} (GO) parada há 12min, desde 07:00`), texto);

    const status = montarStatusDoRoadmap(p.dir, { quando: min(12), projeto: 'orkastery' });
    assert.deepEqual(status.hitlDeConducao?.abertas.map(a => a.pedidoId), ['p1']);
    const linhas = textoDoStatusDoRoadmap(status);
    assert.match(linhas, /O que precisa de você\n[\s\S]*• HITL de condução: 1 aberta\(s\); mediana de 7 dias 8\.0 min/);
    assert.ok(linhas.includes(`  ${t.id} (GO) parada há 12min, desde 07:00.`), linhas);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});
