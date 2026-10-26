/**
 * RM-067 (F2 da ork-grokbuild, D8 a D13): o observador das sessões `grok`. Cada caso monta a thread com a sessão
 * despachada, o log do stream do supervisor, os recibos e a pasta da sessão num `GROK_HOME` temporário, e observa com o
 * relógio injetado. O fim vem do `end` do stream e do recibo do supervisor; o `end_turn` só conclui com a prova do `ork`;
 * interrupção e fim por limite vão ao humano com a retomada; o stream cortado vira `runtime.unavailable` depois do prazo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { LIMITE_MORTE_MS, observarSessao, validarFonteWatcher } from '../src/session-watcher';
import { classificarSessaoGrok, HEARTBEAT_GROK_MS } from '../src/session-watcher-grok';
import { identidadeProcesso } from '../src/adapters/codex-runner';
import { montarComando } from '../src/adapters/grok';
import { ParserGrok } from '../src/adapters/grok-events';
import { Fase } from '../src/types';

const RAIZ = path.resolve(__dirname, '../../..');
const SID = '0193c4a2-7b1e-7c3d-9f00-1234567890ab';
const inicio = Date.parse('2026-10-25T12:00:00.000Z');

function fixture(nome: string): string {
  return fs.readFileSync(path.join(RAIZ, 'core/test/fixtures/grok', nome), 'utf8').replaceAll('<SESSAO>', SID);
}

interface Opcoes { fase?: Fase; filhoVivo?: boolean; supervisorVivo?: boolean; runtime?: string; registroGrok?: boolean }

function cenario(nome: string, o: Opcoes = {}) {
  const fase = o.fase ?? 'PLAN';
  const p = projetoTemporario(`grok-watch-${nome}`);
  const t = novaThread(p.carregado, { nome: 'grokw', modo: 'auto' }).thread;
  const despachadaEm = new Date(inicio).toISOString();
  t.sessoes.push({ sessionId: SID, slug: t.slug, fase, bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER', runtime: o.runtime ?? 'grok',
    despachadaEm, promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  fs.mkdirSync(path.join(dir, 'sessoes'));
  const log = path.join(dir, 'sessoes', `${SID}.grok.jsonl`);
  fs.writeFileSync(log, '');
  const casa = dirTemporario(`grok-casa-${nome}`);
  const vivo = identidadeProcesso(process.pid)!;
  const morto = { ...vivo, inicio: '0' };
  const processo = { schema: 'ork.codex-process/v1', iniciadoEm: despachadaEm,
    supervisor: o.supervisorVivo ? vivo : morto, filho: o.filhoVivo ? vivo : morto };
  fs.writeFileSync(`${log}.process.json`, JSON.stringify(processo));
  const comando = montarComando({ prompt: '<prompt:abcd1234>', nome: t.slug, cwd: p.dir, model: 'grok-modelo', effort: 'high',
    sandbox: 'workspace-write', sessionId: SID });
  registrar(dir, t.id, 'phase_dispatch', { fase, slug: t.slug, runtime: 'grok', model: 'grok-modelo', effort: 'high', cwd: p.dir,
    sessionId: SID, comando });
  if (o.registroGrok !== false) {
    registrar(dir, t.id, 'session_sensor_registered', { fase, sessionId: SID, despachoEm: despachadaEm, grok: 'streaming-json',
      logPath: log, processoPath: `${log}.process.json`, reciboPath: `${log}.exit.json`, cwd: p.dir, grokHome: casa,
      ...(fase === 'PLAN' ? { artefato: { arquivo: 'docs/plan.md', sha256: null } } : {}), ...(fase === 'GO' ? { head: null } : {}) });
  }
  const recibo = (exitCode: number | null, signal: string | null = null) => fs.writeFileSync(`${log}.exit.json`, JSON.stringify({
    ...processo, terminadoEm: new Date(inicio + 100).toISOString(), exitCode, signal, duracaoMs: 100, erro: null }));
  return {
    p, t, dir, log, casa, comando, recibo,
    stream: (texto: string) => fs.appendFileSync(log, texto),
    sessaoNoDisco: (linhas = 1) => {
      const pasta = path.join(casa, 'sessions', '-grupo', SID);
      fs.mkdirSync(pasta, { recursive: true });
      fs.appendFileSync(path.join(pasta, 'updates.jsonl'), '{"sessionUpdate":"x"}\n'.repeat(linhas));
    },
    plano: () => { fs.mkdirSync(path.join(dir, 'docs'), { recursive: true }); fs.writeFileSync(path.join(dir, 'docs/plan.md'), '# plano\n'); },
    observar: (ms: number) => observarSessao(p.carregado, SID, { agoraMs: inicio + ms }),
    eventos: () => lerLedger(dir),
    resultados: () => lerLedger(dir).filter((e) => e.tipo === 'phase_result'),
    limpar: () => { p.limpar(); fs.rmSync(casa, { recursive: true, force: true }); },
  };
}

const RETOMADA = (comando: string[]) => ['grok', '-p', 'continue', ...comando.slice(3, comando.indexOf('-s')), '-r', SID,
  ...comando.slice(comando.indexOf('-s') + 2)];

test('GW1: o end_turn com saida 0 e a prova do ork vira um unico phase_result fase_concluida, sem duplicar', () => {
  const c = cenario('fim');
  try {
    c.stream(fixture('fim-normal.jsonl'));
    c.sessaoNoDisco();
    c.plano();
    c.recibo(0);
    const r = c.observar(1000);
    assert.equal(r.concluido, true);
    assert.equal(r.classificacao, 'fase_concluida');
    const [res] = c.resultados();
    assert.equal(res.runtime, 'grok');
    assert.equal(res.classificacao, 'fase_concluida');
    assert.equal(res.motivo, null);
    assert.equal(res.stopReason, 'end_turn');
    assert.equal(res.numTurnos, 7);
    assert.equal((res.tokens as { input: number; total: number }).input, 1200);
    assert.equal(res.exitCode, 0);
    assert.equal(res.exitCodeFonte, 'supervisor.close');
    assert.equal(res.ok, true);
    assert.equal(res.conclusaoNativa, true);
    assert.equal((res.provaOrk as { ok: boolean }).ok, true);
    assert.equal(res.sensorResultId, `grok:${String(res.sensorResultId).slice(5)}`);
    assert.ok(c.eventos().some((e) => e.tipo === 'fase_concluida' && e.sessionId === SID));
    c.observar(2000);
    c.observar(3000);
    assert.equal(c.resultados().length, 1, 'um unico phase_result');
  } finally { c.limpar(); }
});

test('GW2: o end_turn sem a prova do ork nao conclui: artifact.missing no PLAN, human.pending no GO e com pausa prevista', () => {
  const plan = cenario('sem-plano');
  const go = cenario('sem-commit', { fase: 'GO' });
  try {
    plan.stream(fixture('fim-normal.jsonl'));
    plan.recibo(0);
    assert.equal(plan.observar(1000).classificacao, 'gate_blocked');
    const [r1] = plan.resultados();
    assert.equal(r1.motivo, 'artifact.missing');
    assert.equal(r1.conclusaoNativa, true, 'o turno terminou: so a prova do ork faltou');
    assert.match(String(r1.diagnostico), /sem prova do ork: docs\/plan\.md nao foi gravado|sem prova do ork: docs\/plan\.md não foi gravado/);
    go.stream(fixture('fim-normal.jsonl'));
    go.recibo(0);
    go.observar(1000);
    const [r2] = go.resultados();
    assert.equal(r2.classificacao, 'gate_blocked');
    assert.equal(r2.motivo, 'human.pending');
    assert.equal(r2.ok, false);
    const parser = new ParserGrok(SID);
    parser.push(fixture('fim-normal.jsonl'));
    const comPausa = classificarSessaoGrok({ estado: parser.estado, recibo: { exitCode: 0, signal: null, erro: null, duracaoMs: 1 },
      filho: 'ausente', supervisor: 'ausente', progressoEm: inicio, agoraMs: inicio + 1, limiteMs: LIMITE_MORTE_MS, pausaAoFim: true,
      prova: () => ({ ok: true, fonte: 'docs/plan.md gravado no intervalo do despacho' }) });
    assert.equal(comPausa.terminal && comPausa.motivo, 'human.pending');
    assert.equal(comPausa.terminal && comPausa.classificacao, 'gate_blocked');
  } finally { plan.limpar(); go.limpar(); }
});

test('GW3: a saida 1 com o error de login vira parada tipada runtime.auth-missing, com o erro do runtime', () => {
  const c = cenario('login');
  try {
    c.stream(fixture('erro-login.jsonl'));
    c.recibo(1);
    assert.equal(c.observar(1000).classificacao, 'gate_blocked');
    const [res] = c.resultados();
    assert.equal(res.motivo, 'runtime.auth-missing');
    assert.equal((res.falhaDeConta as { motivo: string }).motivo, 'runtime.auth-missing');
    assert.equal(res.erroDoRuntime, 'Not logged in: run grok login');
    assert.equal(res.exitCode, 1);
    assert.equal(res.retomada, undefined, 'falha da conta nao e interrupcao');
    assert.ok(c.eventos().some((e) => e.tipo === 'gate_blocked' && e.motivo === 'runtime.auth-missing'));
  } finally { c.limpar(); }
});

test('GW4: a saida 1 com o error de rede ou sem error vira runtime.unavailable', () => {
  const rede = cenario('rede');
  const semErro = cenario('sem-erro');
  try {
    rede.stream(fixture('erro-rede.jsonl'));
    rede.recibo(1);
    rede.observar(1000);
    const [r1] = rede.resultados();
    assert.equal(r1.motivo, 'runtime.unavailable');
    assert.equal(r1.erroDoRuntime, 'network error: connection reset by peer');
    assert.equal(r1.falhaDeConta, undefined);
    semErro.stream(fixture('cortado.jsonl'));
    semErro.recibo(1);
    semErro.observar(1000);
    const [r2] = semErro.resultados();
    assert.equal(r2.motivo, 'runtime.unavailable');
    assert.match(String(r2.fonte), /saida 1 sem o objeto error/);
  } finally { rede.limpar(); semErro.limpar(); }
});

test('GW5: 130, 143, SIGINT, SIGTERM e o end cancelled viram interrupcao para o humano, com a retomada -r <id>', () => {
  const formas: Array<[string, number | null, string | null, string]> = [
    ['i130', 130, null, 'cortado.jsonl'], ['i143', 143, null, 'cortado.jsonl'], ['iint', null, 'SIGINT', 'cortado.jsonl'],
    ['iterm', null, 'SIGTERM', 'cortado.jsonl'], ['icancel', 0, null, 'cancelado.jsonl']];
  for (const [nome, codigo, sinal, stream] of formas) {
    const c = cenario(nome);
    try {
      c.stream(fixture(stream));
      c.recibo(codigo, sinal);
      assert.equal(c.observar(1000).classificacao, 'gate_blocked', nome);
      const [res] = c.resultados();
      assert.equal(res.motivo, 'human.pending', nome);
      assert.deepEqual(res.interrupcao, { codigo, sinal, stopReason: stream === 'cancelado.jsonl' ? 'cancelled' : null }, nome);
      assert.deepEqual((res.retomada as { comando: string[] }).comando, RETOMADA(c.comando), nome);
      assert.match(String(res.detalhe), / -r 0193c4a2-7b1e-7c3d-9f00-1234567890ab /, nome);
      assert.match(String(res.diagnostico), /os arquivos alterados ficam como estao|os arquivos alterados ficam como estão/, nome);
    } finally { c.limpar(); }
  }
});

test('GW6: o fim por limite ou recusa do runtime vai ao humano com o motivo dito e a retomada', () => {
  const limite = cenario('limite');
  const recusa = cenario('recusa');
  try {
    limite.stream(fixture('limite.jsonl'));
    limite.recibo(0);
    limite.observar(1000);
    const [r1] = limite.resultados();
    assert.equal(r1.motivo, 'human.pending');
    assert.equal(r1.stopReason, 'max_turn_requests');
    assert.match(String(r1.diagnostico), /encerrou o turno por max_turn_requests/);
    assert.deepEqual((r1.retomada as { comando: string[] }).comando, RETOMADA(limite.comando));
    recusa.stream(`${JSON.stringify({ type: 'end', stopReason: 'refusal', sessionId: SID, num_turns: 1 })}\n`);
    recusa.recibo(0);
    recusa.observar(1000);
    const [r2] = recusa.resultados();
    assert.equal(r2.motivo, 'human.pending');
    assert.equal(r2.stopReason, 'refusal');
  } finally { limite.limpar(); recusa.limpar(); }
});

test('GW7: o stream cortado sem end, sem recibo e sem processo vira runtime.unavailable so no limite de estabilidade', () => {
  const c = cenario('cortado');
  try {
    c.stream(fixture('cortado.jsonl'));
    c.sessaoNoDisco();
    assert.equal(c.observar(1000).concluido, false);
    assert.equal(c.observar(1000 + LIMITE_MORTE_MS - 1).concluido, false, 'um milissegundo antes do limite');
    assert.equal(c.resultados().length, 0);
    const r = c.observar(1000 + LIMITE_MORTE_MS);
    assert.equal(r.concluido, true);
    assert.equal(r.classificacao, 'gate_blocked');
    const [res] = c.resultados();
    assert.equal(res.motivo, 'runtime.unavailable');
    assert.equal(res.morteLatenciaMs, LIMITE_MORTE_MS);
    assert.equal(res.exitCodeFonte, 'unavailable');
    assert.equal(c.eventos().filter((e) => e.tipo === 'sessao_morta').length, 1);
    c.observar(2000 + LIMITE_MORTE_MS);
    assert.equal(c.resultados().length, 1);
  } finally { c.limpar(); }
});

test('GW8: saida 0 sem end, end de outra sessao, linha invalida e linha final incompleta viram runtime.unavailable', () => {
  const casos: Array<[string, string, RegExp]> = [
    ['sem-end', fixture('cortado.jsonl'), /saida 0 sem o evento end/],
    ['outra', fixture('fim-normal.jsonl').replaceAll(SID, 'outra-sessao-qualquer'), /end sem o id da sessão despachada/],
    ['invalida', `nao e json\n${fixture('fim-normal.jsonl')}`, /linha inválida no stream/],
    ['incompleta', `${fixture('fim-normal.jsonl')}{"type":"text","data":"corta`, /linha inválida no stream/],
  ];
  for (const [nome, stream, fonte] of casos) {
    const c = cenario(nome);
    try {
      c.stream(stream);
      c.plano();
      c.recibo(0);
      assert.equal(c.observar(1000).classificacao, 'gate_blocked', nome);
      const [res] = c.resultados();
      assert.equal(res.motivo, 'runtime.unavailable', nome);
      assert.match(String(res.fonte), fonte, nome);
      assert.equal(res.ok, false, nome);
    } finally { c.limpar(); }
  }
});

test('GW9: o processo vivo sem recibo espera sem resultado, e o progresso vira no maximo um heartbeat por minuto', () => {
  const c = cenario('vivo', { filhoVivo: true, supervisorVivo: true });
  try {
    c.stream(fixture('cortado.jsonl'));
    const r = c.observar(1000);
    assert.equal(r.concluido, false);
    assert.equal(r.espera, 'sessão trabalhando');
    c.stream(`${JSON.stringify({ type: 'text', data: 'mais texto' })}\n`);
    c.observar(1000 + HEARTBEAT_GROK_MS - 1);
    c.sessaoNoDisco();
    c.observar(1000 + HEARTBEAT_GROK_MS);
    const batidas = c.eventos().filter((e) => e.tipo === 'runtime_heartbeat' && e.sessionId === SID);
    assert.equal(batidas.length, 2, 'a primeira e a do minuto seguinte');
    assert.deepEqual(batidas.map((e) => e.ts), [new Date(inicio + 1000).toISOString(), new Date(inicio + 1000 + HEARTBEAT_GROK_MS).toISOString()]);
    assert.equal(c.observar(1000 + 20 * LIMITE_MORTE_MS).concluido, false, 'processo vivo nao morre por silencio');
    assert.equal(c.resultados().length, 0);
  } finally { c.limpar(); }
});

test('GW10: o end visto com o processo e o supervisor ausentes e sem recibo conclui pelo end, sem a saida', () => {
  const c = cenario('sem-recibo');
  try {
    c.stream(fixture('fim-normal.jsonl'));
    c.plano();
    const r = c.observar(1000);
    assert.equal(r.classificacao, 'fase_concluida');
    const [res] = c.resultados();
    assert.equal(res.exitCode, null);
    assert.equal(res.exitCodeFonte, 'unavailable');
    assert.equal(res.conclusaoNativa, false);
    assert.equal(res.ok, false, 'sem a saida 0 o resultado nao e ok');
    const vivo = cenario('supervisor-vivo', { supervisorVivo: true });
    try {
      vivo.stream(fixture('fim-normal.jsonl'));
      assert.equal(vivo.observar(1000).espera, 'processo do grok encerrado; aguardando o recibo do supervisor');
    } finally { vivo.limpar(); }
  } finally { c.limpar(); }
});

test('GW11: o registro do grok so vale em sessao grok, dentro de sessoes e com o cwd do despacho', () => {
  const claude = cenario('fonte-em-claude', { runtime: 'claude-bg' });
  const semFonte = cenario('sem-fonte', { registroGrok: false });
  const c = cenario('fonte');
  try {
    assert.throws(() => validarFonteWatcher(claude.p.dir, SID), /fonte do grok em sessão de outro runtime/);
    registrar(semFonte.dir, semFonte.t.id, 'session_sensor_registered', { fase: 'PLAN', sessionId: SID,
      despachoEm: new Date(inicio).toISOString(), logPath: semFonte.log, processoPath: `${semFonte.log}.process.json`,
      reciboPath: `${semFonte.log}.exit.json` });
    assert.throws(() => validarFonteWatcher(semFonte.p.dir, SID), /sessão grok sem a fonte do grok/);
    const base = { despachoEm: new Date(inicio).toISOString(), grok: 'streaming-json', logPath: c.log,
      processoPath: `${c.log}.process.json`, reciboPath: `${c.log}.exit.json`, grokHome: c.casa };
    assert.throws(() => validarFonteWatcher(c.p.dir, SID, { ...base, cwd: '/srv/outra' } as never), /cwd registrado divergente do despacho/);
    const fora = path.join(c.dir, `${SID}.grok.jsonl`);
    assert.throws(() => validarFonteWatcher(c.p.dir, SID, { ...base, cwd: c.p.dir, logPath: fora, processoPath: `${fora}.process.json`,
      reciboPath: `${fora}.exit.json` } as never), /fora do diretório canônico de sessões/);
    validarFonteWatcher(c.p.dir, SID);
  } finally { claude.limpar(); semFonte.limpar(); c.limpar(); }
});

test('GW12: com o phase_result do despacho gravado por outra fonte, o observador nao grava o segundo', () => {
  const c = cenario('outra-fonte');
  try {
    registrar(c.dir, c.t.id, 'phase_result', { fase: 'PLAN', sessionId: SID, despachoEm: new Date(inicio).toISOString(),
      sensorResultId: 'codex:batida', classificacao: 'gate_blocked', motivo: 'runtime.unavailable', origem: 'conducao.batida' });
    c.stream(fixture('fim-normal.jsonl'));
    c.plano();
    c.recibo(0);
    const r = c.observar(1000);
    assert.equal(r.concluido, true);
    assert.equal(r.classificacao, 'gate_blocked');
    assert.equal(c.resultados().length, 1);
  } finally { c.limpar(); }
});
