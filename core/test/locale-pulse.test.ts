/**
 * RM-061, fatia F2b: `ork pulse` em texto, em ingles. O cabecalho, as filas, a opcao, a recomendacao, a
 * resposta, a conducao, a linha do condutor, o HITL de conducao e as acoes automaticas saem pelo catalogo; a
 * pergunta que o pulse monta e o detalhe do runtime nascem em pt-BR (o `--json` os guarda) e saem remontados.
 * O `--json` nao muda com a lingua. Os nomes comecam por "locale en F2b pulse:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cenario, cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';
import { ativarLocale, ligarRemontagem, textoDoCatalogo } from '../src/locale';
import { definirFusoDoDono } from '../src/horario';
import { ItemPulse, Pulse, textoDoPulse } from '../src/pulse';

function entregue(c: Cenario): void {
  assert.equal(ork(c, PT, false, 'thread', 'new', 'Entregue', '--modo', 'auto', '--sem-worktree').status, 0);
  const sha256 = createHash('sha256').update(fs.readFileSync(path.join(c.dir, 'README.md'))).digest('hex');
  assert.equal(ork(c, PT, false, 'thread', 'entrega', 'loc-entregue', '--arquivo', 'README.md', '--sha256', sha256, '--por', 'teste').status, 0);
}

test('locale en F2b pulse: o pulse do CLI sai em ingles e o --json nao muda', () => {
  const c = cenario('pulse-en');
  try {
    entregue(c);
    const r = ork(c, EN, false, 'pulse', '--sem-runtime');
    assert.equal(r.status, 0, r.stderr);
    const l = r.stdout.split('\n');
    assert.match(l[0], /^Pulse \(ork\.pulse\/v1\) \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(America\/New_York, E[SD]T\)$/);
    assert.deepEqual(l.slice(1), ['Needs a human now: 0', '1 delivery(ies) without a score, accepted by default with a record',
      '[incomplete query] runtime not queried because of --sem-runtime', '', 'Pending automatic actions: 1',
      'loc-entregue: master.score-pendente; ork master --aceitar-omissao', '']);
    const semData = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>').replace(/"paradaHaMin": \d+/g, '');
    const pt = ork(c, PT, false, 'pulse', '--sem-runtime', '--json'), en = ork(c, EN, false, 'pulse', '--sem-runtime', '--json');
    assert.equal(semData(en.stdout), semData(pt.stdout));
    assert.match(en.stdout, /"detalhe": "runtime não consultado por --sem-runtime"/);
    // pulse cadencia segue pt-BR.
    const cpt = ork(c, PT, false, 'pulse', 'cadencia'), cen = ork(c, EN, false, 'pulse', 'cadencia');
    assert.equal(cen.stdout, cpt.stdout);
    assert.equal(cen.stderr, cpt.stderr);
  } finally { c.limpar(); }
});

test('locale en F2b pulse: todas as secoes do texto em ingles, com a pergunta do pulse remontada', () => {
  const T0 = '2025-09-19T18:16:00.000Z', T1 = '2025-09-19T18:21:30.000Z';
  definirFusoDoDono('America/New_York');
  ligarRemontagem(true);
  try {
    ativarLocale('pt-BR');
    const semHeartbeat = textoDoCatalogo((m) => m.pulse.semHeartbeat('GO', T0));
    const semRuntime = textoDoCatalogo((m) => m.pulse.semRuntime);
    ativarLocale('en');
    const item = (extra: Partial<ItemPulse>): ItemPulse => ({ id: 'x', classe: 'thread', motivo: 'runtime.silencio', thread: 'loc-x',
      fase: 'GO', sessionId: null, desdeEm: T0, paradaHaMin: 5, impacto: 3, pergunta: semHeartbeat, opcoes: [], recomendacao: 'ork retry run loc-x',
      comandoResposta: 'ork retry plan loc-x', evidencia: [], fontes: [], contextoLogs: [], ...extra });
    const p: Pulse = { contrato: 'ork.pulse/v1' as Pulse['contrato'], consultadoEm: T1, runtime: { ok: false, detalhe: `${semRuntime}; prs.nao-lidos: gh` },
      precisaDeHumanoAgora: [item({ opcoes: ['a. go on'], contextoLogs: ['tail'], paradaHaMin: null }), item({ paradaHaMin: 0 })],
      acoesAutomaticas: [item({ motivo: 'master.score-pendente', comandoResposta: 'ork master --aceitar-omissao' })],
      resumo: { humanos: 2, automaticas: 1, scores: 0, fasesOrfas: 1 },
      conducoes: [{ thread: 'loc-x', linha: 'conducted now by cli, session 11111111, phase GO, since 2025-09-19 14:16' }],
      paradoNoCondutor: [{ thread: 'loc-z', caso: 'pr-verde', desdeEm: T0, paradoHaMin: 30, proximoPasso: 'mergear o PR #12', evidencia: [],
        branch: null, pr: 12, sessionId: null } as never],
      hitlDeConducao: { abertas: [{ thread: 'loc-y', pedidoId: 'p', fase: 'PLAN', desdeEm: T0, paradaHaMin: 12 }],
        seteDias: { medianaRespostaMs: 180_000, dentroDaMeta: true, respondidos: 4 } as never, acimaDaMeta: true },
    };
    const texto = textoDoPulse(p);
    const l = texto.split('\n');
    assert.equal(l[1], 'Needs a human now: 2');
    assert.equal(l[3], '[incomplete query] runtime not queried because of --sem-runtime; prs.nao-lidos: gh');
    assert.equal(l[5], 'loc-x [thread] unknown min');
    assert.match(l[6], /^Phase GO with no heartbeat since 2025-09-19 \d{2}:\d{2}\.$/);
    assert.deepEqual(l.slice(7, 11), ['  option: a. go on', 'Recommendation: ork retry run loc-x', 'Reply: ork retry plan loc-x', '  log: tail']);
    assert.equal(l[12], 'loc-x [thread] less than 1 min');
    assert.ok(texto.includes('\nConducted now: 1\nloc-x: conducted now by cli'), texto);
    assert.ok(texto.includes('\nParked at the conductor: 1\nloc-z parked at the conductor since 14:16: mergear o PR #12\n'), texto);
    assert.ok(texto.includes('\nConduction HITL: 1 open; 7-day median 3.0 min (within the 5 min target, 4 answer(s))\n' +
      'loc-y (PLAN) stopped for 12min, since 14:16\n'), texto);
    assert.ok(texto.endsWith('\nPending automatic actions: 1\nloc-x: master.score-pendente; ork master --aceitar-omissao'), texto);
    // O proximo passo do condutor e dado da familia de entregas (G5): segue como o modulo escreve.
    assert.deepEqual(linhasEmPortugues(texto, ['mergear o PR']), []);
  } finally { ligarRemontagem(false); ativarLocale(undefined); definirFusoDoDono(undefined); }
});
