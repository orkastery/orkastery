/**
 * RM-057 (fatia 2): o tempo parado por HITL de conducao sai do ledger, a regra chega aos prompts do
 * OpenClaw e do Hermes, e o canario do incidente de 01/10 prova que o pedido colado com autorizacao
 * explicita segue sem parar.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { CONTRATO_HITL_V2, PerguntaAoDono } from '../src/hitl-contract';
import { esperasDeHitl, META_DA_MEDIANA_DE_RESPOSTA_MS, resumirTempoParado } from '../src/hitl-tempo-parado';
import { coletarEstatisticas, linhaDoHitlDeConducao, textoDasEstatisticas } from '../src/ledger-stats';
import { registrar } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { EventoLedger } from '../src/types';

const min = (n: number) => new Date(Date.parse('2026-10-03T10:00:00.000Z') + n * 60_000).toISOString();
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

const pedido = (p: PerguntaAoDono, ts = p.criadoEm): EventoLedger =>
  ({ ts, thread: 'ork-t', tipo: 'hitl_requested', pedido: p } as unknown as EventoLedger);
const ev = (tipo: string, ts: string, extra: Record<string, unknown> = {}): EventoLedger =>
  ({ ts, thread: 'ork-t', tipo, ...extra } as unknown as EventoLedger);

test('a espera vai do pedido à primeira resposta, e a mediana compara com a meta de 5 min', () => {
  const eventos = [
    pedido(pergunta('p1', min(0))), ev('human_gate', min(2), { pedidoId: 'p1' }), ev('human_gate', min(50), { pedidoId: 'p1' }),
    pedido(pergunta('p2', min(10))), ev('session_answered', min(14), { pedidoId: 'p2' }),
    pedido(pergunta('p3', min(20))), ev('human_gate', min(80), { pedidoId: 'p3' }),
  ];
  const esperas = esperasDeHitl('ork-t', eventos);
  assert.deepEqual(esperas.map(e => [e.pedidoId, e.fim, (e.fimMs! - e.inicioMs) / MIN]), [['p1', 'respondido', 2], ['p2', 'respondido', 4], ['p3', 'respondido', 60]]);
  const r = resumirTempoParado(esperas, Date.parse(min(0)), Date.parse(min(120)));
  assert.equal(r.pedidos, 3);
  assert.equal(r.respondidos, 3);
  assert.equal(r.paradoMs, 66 * MIN);
  assert.equal(r.medianaRespostaMs, 4 * MIN);
  assert.equal(r.maiorRespostaMs, 60 * MIN);
  assert.equal(r.metaMedianaMs, META_DA_MEDIANA_DE_RESPOSTA_MS);
  assert.equal(r.dentroDaMeta, true);
});

test('decisão informada e v1 não são HITL de condução; sem pergunta, zero parado e mediana nula', () => {
  const decidido = { contrato: CONTRATO_HITL_V2, classe: 'decidido', id: 'd1', criadoEm: min(0) };
  const v1 = { contrato: 'ork.hitl/v1', id: 'v1', criadoEm: min(0) };
  const eventos = [ev('hitl_requested', min(0), { pedido: decidido }), ev('hitl_requested', min(0), { pedido: v1 })];
  const r = resumirTempoParado(esperasDeHitl('ork-t', eventos), Date.parse(min(0)), Date.parse(min(60)));
  assert.deepEqual({ pedidos: r.pedidos, parado: r.paradoMs, mediana: r.medianaRespostaMs, meta: r.dentroDaMeta }, { pedidos: 0, parado: 0, mediana: null, meta: null });
});

test('a pergunta sem resposta corre até o fim do período; a substituída, a vencida que segue e a da thread fechada param de contar', () => {
  const eventos = [
    pedido(pergunta('aberta', min(0))),
    pedido(pergunta('velha', min(0), { alvo: { tipo: 'gate', sobre: 'x' } })),
    pedido(pergunta('nova', min(30), { alvo: { tipo: 'gate', sobre: 'x' } })), ev('human_gate', min(31), { pedidoId: 'nova' }),
    pedido(pergunta('segue', min(0), { prazo: min(10), acaoPadraoAoExpirar: 'seguir-recomendada' })),
  ];
  const esperas = esperasDeHitl('ork-t', eventos);
  const fim = Object.fromEntries(esperas.map(e => [e.pedidoId, e.fim]));
  assert.deepEqual(fim, { aberta: 'aberto', velha: 'substituido', nova: 'respondido', segue: 'seguiu-recomendada' });
  const r = resumirTempoParado(esperas, Date.parse(min(0)), Date.parse(min(60)));
  assert.equal(r.paradoMs, (60 + 30 + 1 + 10) * MIN);
  assert.deepEqual({ resp: r.respondidos, sem: r.semResposta, abertos: r.abertos }, { resp: 1, sem: 2, abertos: 1 });

  const fechada = esperasDeHitl('ork-t', [pedido(pergunta('p', min(0))), ev('master_done', min(7))]);
  assert.deepEqual([fechada[0].fim, (fechada[0].fimMs! - fechada[0].inicioMs) / MIN], ['encerrado', 7]);
});

test('o período recorta o tempo parado; a resposta fora do período não entra na mediana', () => {
  const eventos = [pedido(pergunta('p1', min(0))), ev('human_gate', min(100), { pedidoId: 'p1' })];
  const r = resumirTempoParado(esperasDeHitl('ork-t', eventos), Date.parse(min(30)), Date.parse(min(60)));
  assert.equal(r.paradoMs, 30 * MIN);
  assert.equal(r.pedidos, 0, 'aberta antes do período');
  assert.equal(r.abertos, 1);
  assert.equal(r.medianaRespostaMs, null);
});

test('resposta em texto conta à parte: pela dependência técnica ou fora da exceção', () => {
  const texto = { tipoDeResposta: 'aberta' as const, respostaAceita: { tipo: 'texto' as const, maxCaracteres: 500 } };
  const eventos = [
    pedido(pergunta('dep', min(0), { ...texto, dependenciaTecnica: { comando: 'gh auth login', porque: 'login interativo' } })),
    pedido(pergunta('livre', min(1), { ...texto, alvo: { tipo: 'gate', sobre: 'livre' } })),
    pedido(pergunta('sel', min(2))),
  ];
  const r = resumirTempoParado(esperasDeHitl('ork-t', eventos), Date.parse(min(0)), Date.parse(min(10)));
  assert.deepEqual(r.emTexto, { comDependenciaTecnica: 1, foraDaExcecao: 1 });
  assert.equal(r.pedidos, 3);
});

test('ork ledger stats traz hitlDeConducao no JSON e a linha com a meta no texto', () => {
  const p = projetoTemporario('rm057-stats');
  try {
    const t = novaThread(p.carregado, { nome: 'parado', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'hitl_requested', { ts: min(0), fase: 'GO', pedido: pergunta('p1', min(0)) });
    registrar(dir, t.id, 'human_gate', { ts: min(12), fase: 'GO', pedidoId: 'p1', estado: 'aprovado' });
    const r = coletarEstatisticas(p.dir, { desde: min(-1), ate: min(60), thread: t.id });
    assert.equal(r.hitlDeConducao.pedidos, 1);
    assert.equal(r.hitlDeConducao.medianaRespostaMs, 12 * MIN);
    assert.equal(r.hitlDeConducao.dentroDaMeta, false);
    const texto = textoDasEstatisticas(r);
    assert.ok(texto.includes(linhaDoHitlDeConducao(r.hitlDeConducao)));
    assert.match(texto, /HITL de conducao 1 pergunta\(s\); parado 0\.20 h; mediana 12\.0 min \(acima da meta de 5 min\)/);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// A regra nos prompts dos adaptadores: OpenClaw e Hermes nesta fatia; Claude Code e Codex na fatia 1.
// ---------------------------------------------------------------------------

const catalogo = path.resolve(__dirname, '../../..');
const ler = (rel: string) => fs.readFileSync(path.join(catalogo, rel), 'utf8');
const umaLinha = (s: string) => s.replace(/\s+/g, ' ');

function regraDaFatia1(): string {
  const md = ler('adapters/claude-code/commands/ork.md');
  const i = md.indexOf('HITL de condução é seleção (RM-057)');
  assert.ok(i >= 0);
  return umaLinha(md.slice(i, md.indexOf('comando exato.', i) + 'comando exato.'.length));
}

test('a skill do Hermes diz a regra do HITL de condução com a frase dos outros adaptadores, e as letras vão até e', () => {
  const skill = ler('adapters/hermes/skills/orkastery-devmaster/SKILL.md');
  assert.ok(umaLinha(skill).includes(regraDaFatia1()));
  assert.doesNotMatch(skill, /objetivas a–d/);
  assert.match(skill, /de 3 a 5 alternativas a–e e uma "Recomendação"/);
});

test('o OpenClaw diz a regra nas descrições de três tools, no src e no dist commitado', () => {
  const regra = regraDaFatia1();
  for (const rel of ['adapters/openclaw/src/index.ts', 'adapters/openclaw/dist/index.js']) {
    const texto = ler(rel);
    const m = /const REGRA_HITL_DE_CONDUCAO =([\s\S]*?);\n/.exec(texto);
    assert.ok(m, rel);
    const frase = [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]).join('');
    assert.equal(umaLinha(frase), regra, rel);
    assert.equal((texto.match(/\+ REGRA_HITL_DE_CONDUCAO|^\s*REGRA_HITL_DE_CONDUCAO,/gm) ?? []).length, 3, rel);
  }
  assert.ok(umaLinha(ler('adapters/openclaw/README.md')).includes('o pedido que ele colou com autorização explícita vale como instrução dele'));
});
