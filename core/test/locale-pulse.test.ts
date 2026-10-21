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
import { Cenario, cenario, EN, linhasEmPortugues, ork, PT, relogioFixo } from './locale-apoio';
import { ativarLocale, ligarRemontagem, remontar, textoDoCatalogo } from '../src/locale';
import { recomendarPara } from '../src/hitl';
import { planejar } from '../src/board';
import { definirFusoDoDono } from '../src/horario';
import { ItemPulse, Pulse, textoDoPulse } from '../src/pulse';
import { registrar } from '../src/ledger';
import { gravarThread, lerThread } from '../src/thread';
import { enfileirar } from '../src/ratelimit';
import { exigirManifesto } from '../src/manifest';

function entregue(c: Cenario): void {
  assert.equal(ork(c, PT, false, 'thread', 'new', 'Entregue', '--modo', 'auto', '--sem-worktree').status, 0);
  const sha256 = createHash('sha256').update(fs.readFileSync(path.join(c.dir, 'README.md'))).digest('hex');
  assert.equal(ork(c, PT, false, 'thread', 'entrega', 'loc-entregue', '--arquivo', 'README.md', '--sha256', sha256, '--por', 'teste').status, 0);
}

/**
 * O que muda com o relogio no `--json` do pulse: o ISO, os minutos parados e a falta relativa do pedido da fila de
 * rate limit ("libera em 633079h03", de `faltaPara`), que muda quando o minuto vira entre as duas leituras. RM-037
 * (ork-rm037esperas): a comparacao que so tirava o ISO e o `paradaHaMin` derrubou o Node 22 do CI num PR sem relacao.
 */
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const semRelogio = (t: string) => t.replace(ISO, '<ISO>').replace(/"paradaHaMin": \d+/g, '')
  .replace(/libera (?:em \d+(?:h\d{2}| min)|ja liberou)/g, 'libera <FALTA>');

/** As paradas do cenario: a pausa prevista ao fim do bloco, a thread pausada, o gate sem detalhe e a fila de rate limit. */
function paradasComFila(c: Cenario): void {
  for (const nome of ['Classica', 'Pausada', 'Aberta']) {
    assert.equal(ork(c, PT, false, 'thread', 'new', nome, '--modo', 'classic', '--sem-worktree').status, 0);
  }
  registrar(path.join(c.dir, '.orkastery', 'threads', 'loc-classica'), 'loc-classica', 'human_gate',
    { fase: 'GOAL', slug: 'loc-classica-goal', sessionId: '11111111-2222-3333-4444-555555555555', previstaSobre: 'objetivo',
      estado: 'prevista ao fim do bloco' });
  gravarThread(c.dir, { ...lerThread(c.dir, 'loc-pausada'), status: 'pausada' });
  registrar(path.join(c.dir, '.orkastery', 'threads', 'loc-aberta'), 'loc-aberta', 'gate_blocked',
    { gate: 'verify', motivo: 'verify.failed', fase: 'GO', modo: 'classic' });
  enfileirar(exigirManifesto(c.dir), { thread: 'loc-aberta', fase: 'GO', slug: 'loc-aberta-full', promptPath: 'prompt.md',
    promptSha256: '0'.repeat(64), cwd: c.dir, model: null, effort: null,
    sinal: { resetEm: '2099-01-01T00:00:00.000Z', fonte: 'epoch', trecho: 'SIMULADO' }, detalhe: 'rate limit SIMULADO' });
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
      '[incomplete query] runtime not queried because of `--sem-runtime`', '', 'Pending automatic actions: 1',
      'loc-entregue: master.score-pendente; ork master --aceitar-omissao', '']);
    const pt = ork(c, PT, false, 'pulse', '--sem-runtime', '--json'), en = ork(c, EN, false, 'pulse', '--sem-runtime', '--json');
    assert.equal(semRelogio(en.stdout), semRelogio(pt.stdout));
    assert.match(en.stdout, /"detalhe": "runtime não consultado por --sem-runtime"/);
    // A F3d levou `pulse cadencia` a lista (decisao registrada no GO-FIX 1): o texto segue o locale e nada se grava.
    const cpt = ork(c, PT, false, 'pulse', 'cadencia'), cen = ork(c, EN, false, 'pulse', 'cadencia');
    assert.match(cpt.stdout, /^Pulse de hora em hora \(#OrkPulseOn-60m\)\. /);
    assert.match(cen.stdout, /^Pulse hourly \(#OrkPulseOn-60m\)\. /);
    assert.deepEqual(linhasEmPortugues(cen.stdout), [], cen.stdout);
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
    assert.equal(l[3], '[incomplete query] runtime not queried because of `--sem-runtime`; prs.nao-lidos: gh');
    assert.equal(l[5], 'loc-x [thread] unknown min');
    assert.match(l[6], /^Phase GO with no heartbeat since 2025-09-19 \d{2}:\d{2}\.$/);
    assert.deepEqual(l.slice(7, 11), ['  option: a. go on', 'Recommendation: ork retry run loc-x', 'Reply: ork retry plan loc-x', '  log: tail']);
    assert.equal(l[12], 'loc-x [thread] less than 1 min');
    assert.ok(texto.includes('\nConducted now: 1\nloc-x: conducted now by cli'), texto);
    assert.ok(texto.includes('\nWaiting on the conductor: 1\nloc-z waiting on the conductor since 14:16: mergear o PR #12\n'), texto);
    assert.ok(texto.includes('\nConduction HITL: 1 open; 7-day median 3.0 min (within the 5 min target, 4 answer(s))\n' +
      'loc-y (PLAN) stopped for 12min, since 14:16\n'), texto);
    assert.ok(texto.endsWith('\nPending automatic actions: 1\nloc-x: master.score-pendente; ork master --aceitar-omissao'), texto);
    // O proximo passo do condutor e dado da familia de entregas (G5): segue como o modulo escreve.
    assert.deepEqual(linhasEmPortugues(texto, ['mergear o PR']), []);
  } finally { ligarRemontagem(false); ativarLocale(undefined); definirFusoDoDono(undefined); }
});

test('locale en F2b pulse: a pausa #Classic, a thread pausada, a fila, o gate sem detalhe e o claude fora do PATH saem em ingles', () => {
  const c = cenario('pulse-paradas-en');
  try {
    // Sem o `claude` no PATH, a consulta do runtime falha e o motivo sai pelo catalogo.
    const semClaude = ork(c, EN, false, 'pulse');
    assert.equal(semClaude.status, 1, semClaude.stderr);
    assert.equal(semClaude.stdout.split('\n')[3], '[incomplete query] `claude` binary not on PATH');
    // A pausa prevista ao fim do bloco, a thread carimbada como pausada, o gate sem detalhe e a fila de rate limit.
    paradasComFila(c);
    const r = ork(c, EN, false, 'pulse', '--sem-runtime');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.split('\n')[1], 'Needs a human now: 3');
    for (const linha of ['a verification command failed (no baseline to tell existing debt apart)',
      'block closed at GOAL: waiting for the human verdict on goal', 'thread marked as paused in phase GOAL',
      'loc-aberta: runtime.rate-limited; ork retry resume --id R1']) {
      assert.ok(r.stdout.includes(`\n${linha}\n`), `${linha}\n${r.stdout}`);
    }
    assert.deepEqual(linhasEmPortugues(r.stdout), []);
    // Controle do detector: o mesmo pulse em pt-BR e acusado; o --json nao muda.
    assert.ok(linhasEmPortugues(ork(c, PT, false, 'pulse', '--sem-runtime').stdout).length >= 3, 'o detector acha o pt-BR');
    assert.equal(semRelogio(ork(c, EN, false, 'pulse', '--sem-runtime', '--json').stdout),
      semRelogio(ork(c, PT, false, 'pulse', '--sem-runtime', '--json').stdout));
  } finally { c.limpar(); }
});

test('locale en F2b pulse: o --json nao muda com a lingua nem quando o minuto vira entre as duas leituras (RM-037)', () => {
  const c = cenario('pulse-virada-en');
  try {
    paradasComFila(c);
    // A proxima virada de minuto, sempre depois do cenario montado: o ingles le 100 ms antes e o pt-BR 100 ms depois,
    // cada um com o relogio do processo filho fixo (`relogio-fixo.ts`). Sem esperar o relogio de verdade.
    const virada = Math.ceil(Date.now() / 60_000) * 60_000 + 60_000;
    const antes = new Date(virada - 100).toISOString(), depois = new Date(virada + 100).toISOString();
    const en = ork(c, { ...EN, ...relogioFixo(antes) }, false, 'pulse', '--sem-runtime', '--json');
    const pt = ork(c, { ...PT, ...relogioFixo(depois) }, false, 'pulse', '--sem-runtime', '--json');
    assert.equal(en.status, 0, en.stderr);
    assert.equal(pt.status, 0, pt.stderr);
    assert.ok(en.stdout.includes(`"consultadoEm": "${antes}"`), 'o relogio do filho ficou fixo');
    assert.ok(pt.stdout.includes(`"consultadoEm": "${depois}"`), 'o relogio do filho ficou fixo');
    // Controle: a falta do pedido R1 mudou de minuto entre as leituras, e a comparacao de antes, que so tirava o ISO
    // e o `paradaHaMin`, reprova, como no CI.
    const falta = (t: string) => /libera em (\d+h\d{2})/.exec(t)?.[1] ?? null;
    assert.ok(falta(en.stdout) !== null && falta(pt.stdout) !== null, en.stdout);
    assert.notEqual(falta(en.stdout), falta(pt.stdout));
    const deAntes = (t: string) => t.replace(ISO, '<ISO>').replace(/"paradaHaMin": \d+/g, '');
    assert.notEqual(deAntes(en.stdout), deAntes(pt.stdout));
    // A comparacao sem o trecho que varia passa.
    assert.equal(semRelogio(en.stdout), semRelogio(pt.stdout));
  } finally { c.limpar(); }
});

test('locale en F2b pulse: o impedimento do despacho, as vagas do escalonador e a recomendacao do radar saem em ingles', () => {
  const c = cenario('pulse-impedimento-en');
  try {
    for (const nome of ['Impedida', 'Ativa', 'Esquecida', 'Livre']) {
      assert.equal(ork(c, PT, false, 'thread', 'new', nome, '--modo', 'auto', '--sem-worktree').status, 0);
    }
    // O impedimento do despacho que so o dono resolve (RM-055): as alternativas saem pelo catalogo.
    registrar(path.join(c.dir, '.orkastery', 'threads', 'loc-impedida'), 'loc-impedida', 'gate_blocked',
      { gate: 'dispatch', motivo: 'runtime.workspace-untrusted', fase: 'GO', modo: 'auto', detalhe: 'SIMULADO',
        impedimento: { comando: 'claude', depois: 'SIMULADO', trecho: 'SIMULADO' } });
    const r = ork(c, EN, false, 'pulse', '--sem-runtime');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('\n  option: a. I ran the command\n  option: b. Switch the block runtime\n  option: c. Leave it stopped\n'),
      r.stdout);
    assert.deepEqual(linhasEmPortugues(r.stdout, ['SIMULADO']), []);
    assert.match(ork(c, EN, false, 'pulse', '--sem-runtime', '--json').stdout, /"a\. Rodei o comando"/);
    // As vagas do escalonador (limite 1 com uma sessao trabalhando, e uma parada ha muito tempo) e a recomendacao
    // do radar nascem em pt-BR e saem remontadas, como o pulse faz na acao automatica e na recomendacao.
    const ativa = '22222222-3333-4444-5555-666666666666';
    registrar(path.join(c.dir, '.orkastery', 'threads', 'loc-ativa'), 'loc-ativa', 'phase_dispatch', { fase: 'GOAL', sessionId: ativa });
    registrar(path.join(c.dir, '.orkastery', 'threads', 'loc-esquecida'), 'loc-esquecida', 'phase_dispatch',
      { fase: 'GOAL', sessionId: '33333333-4444-5555-6666-777777777777' });
    ligarRemontagem(true);
    ativarLocale('pt-BR');
    const cm = exigirManifesto(c.dir);
    const vagas = planejar({ ...cm, manifesto: { ...cm.manifesto, concurrency: { ...cm.manifesto.concurrency, max_parallel_threads: 1 } } },
      { agora: '2098-12-31T23:00:00.000Z', estados: new Map([[ativa, 'working']]) }).vagas;
    const correcao = (motivo: string) => vagas.find((v) => v.motivo === motivo)?.correcao ?? '';
    const stale = correcao('vaga.stale'), limite = correcao('concurrency.limite');
    const recomendacao = recomendarPara('falha', null, 'abc12345');
    assert.equal(stale, 'redespache com ork phase run loc-esquecida --fase GOAL, ou feche com ork master loc-esquecida');
    assert.equal(recomendacao, 'leia `ork sessions logs abc12345` e decida entre retomar, corrigir a causa ou abandonar a sessao.');
    ativarLocale('en');
    assert.equal(remontar(stale), 're-dispatch with `ork phase run loc-esquecida --fase GOAL`, or close it with `ork master loc-esquecida`');
    assert.equal(remontar(limite), 'wait for a thread to free its slot, or raise `concurrency.max_parallel_threads` in `orkastery.yaml`');
    assert.equal(remontar(recomendacao), 'read `ork sessions logs abc12345` and decide whether to resume, fix the cause or drop the session.');
  } finally { ligarRemontagem(false); ativarLocale(undefined); c.limpar(); }
});

test('locale en F2b pulse: a classe do item sai pelo id em ingles, e o motivo tipado fica', () => {
  definirFusoDoDono('America/New_York');
  ativarLocale('en');
  try {
    const item = (extra: Partial<ItemPulse>): ItemPulse => ({ id: 'x', classe: 'thread', motivo: 'runtime.silencio', thread: 'loc-x',
      fase: 'GO', sessionId: null, desdeEm: '2025-09-19T18:16:00.000Z', paradaHaMin: 3, impacto: 3, pergunta: 'Q?', opcoes: [],
      recomendacao: 'ork retry plan loc-x', comandoResposta: 'ork retry plan loc-x', evidencia: [], fontes: [], contextoLogs: [], ...extra });
    const texto = textoDoPulse({ contrato: 'ork.pulse/v1' as Pulse['contrato'], consultadoEm: '2025-09-19T18:21:30.000Z',
      runtime: { ok: true, detalhe: '' },
      precisaDeHumanoAgora: [item({ classe: 'falha' }), item({ classe: 'desconhecida' }), item({ classe: 'fase_orfa' }), item({ classe: 'hitl' })],
      acoesAutomaticas: [item({ classe: 'abandonada', motivo: 'abandonada', comandoResposta: 'ork sessions logs abc' }),
        item({ classe: 'hitl', motivo: 'hitl.permissao', comandoResposta: 'claude attach abc' })],
      resumo: { humanos: 4, automaticas: 2, scores: 0, fasesOrfas: 1 } });
    for (const classe of ['failed', 'unknown', 'orphan phase', 'hitl']) assert.ok(texto.includes(`\nloc-x [${classe}] 3 min\n`), `${classe}\n${texto}`);
    assert.ok(texto.endsWith('\nloc-x: abandoned; ork sessions logs abc\nloc-x: hitl.permissao; claude attach abc'), texto);
    assert.deepEqual(linhasEmPortugues(texto, ['Q?']), []);
  } finally { ativarLocale(undefined); definirFusoDoDono(undefined); }
});
