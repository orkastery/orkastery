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
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirTemporario, projetoTemporario } from './apoio';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { LIMITE_MORTE_MS, observarSessao, reconciliarSessaoSemWatcher, validarFonteWatcher } from '../src/session-watcher';
import { classificarSessaoGrok, HEARTBEAT_GROK_MS } from '../src/session-watcher-grok';
import { estadoProcesso, identidadeProcesso, IdentidadeProcesso } from '../src/adapters/codex-runner';
import { montarComando } from '../src/adapters/grok';
import { ParserGrok } from '../src/adapters/grok-events';
import { Fase } from '../src/types';

const RAIZ = path.resolve(__dirname, '../../..');
const SID = '0193c4a2-7b1e-7c3d-9f00-1234567890ab';
const inicio = Date.parse('2026-10-25T12:00:00.000Z');

function fixture(nome: string): string {
  return fs.readFileSync(path.join(RAIZ, 'core/test/fixtures/grok', nome), 'utf8').replaceAll('<SESSAO>', SID);
}

interface Opcoes { fase?: Fase; filhoVivo?: boolean; supervisorVivo?: boolean; runtime?: string; registroGrok?: boolean;
  /** O `--cwd` do comando do despacho, quando difere do cwd da fixture (aspas da retomada). */
  comandoCwd?: string;
  /** Um processo de verdade no papel do supervisor, que o caso mata no meio da observação. */
  supervisor?: IdentidadeProcesso;
  /** RM-067 (F4b): o comando do despacho leva a regra de uma ferramenta do MCP do ork, como o despacho com o contexto. */
  comMcp?: boolean }

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
    supervisor: o.supervisor ?? (o.supervisorVivo ? vivo : morto), filho: o.filhoVivo ? vivo : morto };
  fs.writeFileSync(`${log}.process.json`, JSON.stringify(processo));
  const comando = [...montarComando({ prompt: '<prompt:abcd1234>', nome: t.slug, cwd: o.comandoCwd ?? p.dir, model: 'grok-modelo', effort: 'high',
    sandbox: 'workspace-write', sessionId: SID }), ...(o.comMcp ? ['--allow', 'MCPTool(orkastery__ork_thread_status)'] : [])];
  registrar(dir, t.id, 'phase_dispatch', { fase, slug: t.slug, runtime: 'grok', model: 'grok-modelo', effort: 'high', cwd: p.dir,
    sessionId: SID, comando });
  if (o.registroGrok !== false) {
    registrar(dir, t.id, 'session_sensor_registered', { fase, sessionId: SID, despachoEm: despachadaEm, grok: 'streaming-json',
      logPath: log, processoPath: `${log}.process.json`, reciboPath: `${log}.exit.json`, cwd: p.dir, grokHome: casa,
      ...(fase === 'PLAN' ? { artefato: { arquivo: 'docs/plan.md', sha256: null } } : {}),
      ...(fase === 'CHECK' ? { artefato: { arquivo: 'docs/check.md', sha256: null } } : {}), ...(fase === 'GO' ? { head: null } : {}) });
  }
  const recibo = (exitCode: number | null, signal: string | null = null, erro: string | null = null) =>
    fs.writeFileSync(`${log}.exit.json`, JSON.stringify({
      ...processo, terminadoEm: new Date(inicio + 100).toISOString(), exitCode, signal, duracaoMs: 100, erro }));
  return {
    p, t, dir, log, casa, comando, recibo,
    stream: (texto: string, ms?: number) => {
      fs.appendFileSync(log, texto);
      if (ms !== undefined) fs.utimesSync(log, (inicio + ms) / 1000, (inicio + ms) / 1000);
    },
    sessaoNoDisco: (linhas = 1, ms?: number) => {
      const pasta = path.join(casa, 'sessions', '-grupo', SID);
      fs.mkdirSync(pasta, { recursive: true });
      const updates = path.join(pasta, 'updates.jsonl');
      fs.appendFileSync(updates, '{"sessionUpdate":"x"}\n'.repeat(linhas));
      if (ms !== undefined) fs.utimesSync(updates, (inicio + ms) / 1000, (inicio + ms) / 1000);
    },
    plano: () => { fs.mkdirSync(path.join(dir, 'docs'), { recursive: true }); fs.writeFileSync(path.join(dir, 'docs/plan.md'), '# plano\n'); },
    parecer: () => { fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'docs/check.md'), '# parecer\n\nVeredito: PASSOU\n'); },
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
    c.stream(fixture('cortado.jsonl'), 1000);
    c.sessaoNoDisco(1, 1000);
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
    c.stream(fixture('cortado.jsonl'), 1000);
    const r = c.observar(1000);
    assert.equal(r.concluido, false);
    assert.equal(r.espera, 'sessão trabalhando');
    c.stream(`${JSON.stringify({ type: 'text', data: 'mais texto' })}\n`, 1000 + HEARTBEAT_GROK_MS - 1);
    c.observar(1000 + HEARTBEAT_GROK_MS - 1);
    c.sessaoNoDisco(1, 1000 + HEARTBEAT_GROK_MS);
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

test('GW13: com saida diferente de zero e sem error, o end cancelado e interrupcao e o end valido vai ao humano; o error vence o end', () => {
  const casos: Array<[string, string, number | null, string | null, string, string]> = [
    ['cancel-1', fixture('cancelado.jsonl'), 1, null, 'human.pending', 'end com stopReason cancelled e saida 1'],
    ['fim-1', fixture('fim-normal.jsonl'), 1, null, 'human.pending', 'saida 1 depois do end com stopReason end_turn, sem o objeto error'],
    ['kill', fixture('cortado.jsonl'), null, 'SIGKILL', 'runtime.unavailable', 'saida SIGKILL sem o objeto error no stream'],
    ['erro-e-cancel', `${fixture('erro-login.jsonl')}${fixture('cancelado.jsonl')}`, 1, null, 'runtime.auth-missing',
      'saida 1 com o objeto error do runtime'],
  ];
  for (const [nome, stream, codigo, sinal, motivo, fonte] of casos) {
    const c = cenario(nome);
    try {
      c.stream(stream);
      c.recibo(codigo, sinal);
      c.observar(1000);
      const [res] = c.resultados();
      assert.equal(res.motivo, motivo, nome);
      assert.ok(String(res.fonte).startsWith(fonte), `${nome}: ${String(res.fonte)}`);
      if (motivo === 'human.pending') assert.deepEqual((res.retomada as { comando: string[] }).comando, RETOMADA(c.comando), nome);
    } finally { c.limpar(); }
  }
});

test('GW14: o recibo com o erro de spawn (codigo negativo do Node) vira runtime.unavailable tipado, sem derrubar o observador', () => {
  const c = cenario('spawn');
  const torto = cenario('spawn-torto');
  try {
    c.recibo(-2, null, 'ENOENT');
    assert.equal(c.observar(1000).classificacao, 'gate_blocked');
    const [res] = c.resultados();
    assert.equal(res.motivo, 'runtime.unavailable');
    assert.equal(res.fonte, 'o supervisor não iniciou o grok (ENOENT)');
    torto.recibo(-2);
    assert.throws(() => torto.observar(1000), /recibo de processo inválido/, 'codigo negativo sem erro de spawn segue invalido');
  } finally { c.limpar(); torto.limpar(); }
});

test('GW15: o evento da classificacao gravado antes de uma queda nao se repete, e o phase_result sai uma vez', () => {
  const c = cenario('queda');
  try {
    const despachoEm = new Date(inicio).toISOString();
    const id = `grok:${createHash('sha256').update(`${SID}|${despachoEm}`).digest('hex')}`;
    registrar(c.dir, c.t.id, 'gate_blocked', { fase: 'PLAN', sessionId: SID, despachoEm, sensorResultId: id, motivo: 'runtime.unavailable' });
    c.stream(fixture('erro-rede.jsonl'));
    c.recibo(1);
    c.observar(1000);
    assert.equal(c.eventos().filter((e) => e.tipo === 'gate_blocked' && e.sensorResultId === id).length, 1);
    assert.equal(c.resultados().length, 1);
    // A chave montada aqui é a do observador; se ela mudar, o evento gravado antes deixa de casar e o caso não testaria nada.
    assert.equal(c.resultados()[0].sensorResultId, id);
  } finally { c.limpar(); }
});

test('GW16: a batida sem watcher observa a sessao grok pelo mesmo observador e, sem a fonte, para depois do limite', () => {
  const c = cenario('batida');
  const semFonte = cenario('batida-sem-fonte', { registroGrok: false });
  try {
    c.stream(fixture('fim-normal.jsonl'));
    c.plano();
    c.recibo(0);
    const r = reconciliarSessaoSemWatcher(c.p.carregado, c.t.id, inicio + 1000);
    assert.equal(r.estado, 'concluida', r.detalhe);
    const [res] = c.resultados();
    assert.equal(res.runtime, 'grok');
    assert.equal(res.classificacao, 'fase_concluida');
    // O erro do watcher é gravado com o relógio real; o prazo conta dele ou do despacho fixo, o que vier depois, e assim
    // o caso não depende de a máquina estar adiante da data do despacho.
    const parada = reconciliarSessaoSemWatcher(semFonte.p.carregado, semFonte.t.id, Math.max(Date.now(), inicio) + LIMITE_MORTE_MS + 60000);
    assert.equal(parada.estado, 'parada', parada.detalhe);
    const [res2] = semFonte.resultados();
    assert.equal(res2.motivo, 'runtime.unavailable');
    assert.equal(res2.runtime, 'grok');
  } finally { c.limpar(); semFonte.limpar(); }
});

test('GW17: a retomada no detalhe sai pronta para colar, com aspas no caminho que tem espaco', () => {
  const c = cenario('aspas', { comandoCwd: '/srv/minha worktree' });
  try {
    c.stream(fixture('cortado.jsonl'));
    c.recibo(143);
    c.observar(1000);
    const [res] = c.resultados();
    const comando = (res.retomada as { comando: string[] }).comando;
    assert.equal(comando[comando.indexOf('--cwd') + 1], '/srv/minha worktree');
    assert.ok(String(res.detalhe).includes("--cwd '/srv/minha worktree'"), String(res.detalhe));
  } finally { c.limpar(); }
});

/**
 * Um `sleep` no papel do supervisor. Morto no meio da observação, vira zumbi, e a prova de vida já o lê ausente. O prazo
 * longo é folga para a montagem sob carga; o `limpar` sempre o encerra.
 */
function supervisorDescartavel() {
  const filho = spawn('sleep', ['600'], { stdio: 'ignore' });
  const id = identidadeProcesso(filho.pid!)!;
  return {
    id,
    matar: () => {
      process.kill(id.pid, 'SIGKILL');
      const limite = Date.now() + 5000;
      while (estadoProcesso(id) !== 'ausente' && Date.now() < limite) { /* o zumbi aparece em microssegundos */ }
      return estadoProcesso(id) === 'ausente';
    },
    limpar: () => { try { process.kill(id.pid, 'SIGKILL'); } catch { /* já saiu */ } },
  };
}

/**
 * Roda `acao` uma vez, no instante em que o supervisor termina: logo antes de a observação abrir `alvo`, ou logo depois,
 * quando a abertura falhou ou já leu o que havia.
 */
function comGancho<T>(alvo: string, quando: 'antes' | 'depois', acao: () => void, corpo: () => T): T {
  const fsReal = createRequire(__filename)('node:fs') as typeof fs;
  const abrir = fsReal.openSync as (...a: unknown[]) => number;
  let feito = false;
  fsReal.openSync = ((arquivo: fs.PathLike, ...resto: unknown[]) => {
    if (feito || String(arquivo) !== alvo) return abrir(arquivo, ...resto);
    feito = true;
    if (quando === 'antes') { acao(); return abrir(arquivo, ...resto); }
    try { return abrir(arquivo, ...resto); } finally { acao(); }
  }) as typeof fs.openSync;
  try { return corpo(); } finally { fsReal.openSync = abrir as typeof fs.openSync; }
}

test('GW18: o supervisor que termina no meio da observacao nunca fecha a fase sem a saida: vida, recibo e stream nessa ordem', () => {
  // GO-FIX 2 (N1) e GO-FIX 3: o supervisor grava o recibo e sai logo depois de a observação procurar o recibo e não o
  // achar. Com a vida lida antes do recibo, esta volta ainda o vê vivo e espera; a seguinte acha o recibo e fecha com a
  // saída 0. Lida a vida depois do recibo, em qualquer ponto, ela já sai ausente e a fase fecharia sem a saída.
  let sup: ReturnType<typeof supervisorDescartavel> | undefined;
  let c: ReturnType<typeof cenario> | undefined;
  try {
    const s = sup = supervisorDescartavel();
    const k = c = cenario('vida-antes', { supervisor: s.id });
    k.stream(fixture('fim-normal.jsonl'));
    k.plano();
    let morto = false;
    const r = comGancho(`${k.log}.exit.json`, 'depois', () => { k.recibo(0); morto = s.matar(); }, () => k.observar(1000));
    assert.equal(morto, true, 'o supervisor saiu dentro da observacao');
    assert.equal(r.concluido, false, 'sem o recibo lido, a volta espera');
    assert.equal(r.espera, 'processo do grok encerrado; aguardando o recibo do supervisor');
    assert.equal(k.observar(2000).classificacao, 'fase_concluida');
    const [res] = k.resultados();
    assert.equal(res.exitCode, 0);
    assert.equal(res.exitCodeFonte, 'supervisor.close');
    assert.equal(res.ok, true);
  } finally { sup?.limpar(); c?.limpar(); }
  // GO-FIX 1 (A2): o grok grava o `end` e sai, e o supervisor grava o recibo enquanto a observação abre o recibo. Com o
  // recibo lido antes do stream, o `end` entra na mesma volta, e a saída 0 não vira "sem o evento end".
  let sup2: ReturnType<typeof supervisorDescartavel> | undefined;
  let d: ReturnType<typeof cenario> | undefined;
  try {
    const s = sup2 = supervisorDescartavel();
    const k = d = cenario('recibo-antes', { supervisor: s.id });
    const linhas = fixture('fim-normal.jsonl').split('\n').filter(Boolean);
    k.stream(linhas.slice(0, -1).map((l) => `${l}\n`).join(''));
    k.plano();
    let morto = false;
    const r = comGancho(`${k.log}.exit.json`, 'antes', () => { k.stream(`${linhas.at(-1)}\n`); k.recibo(0); morto = s.matar(); },
      () => k.observar(1000));
    assert.equal(morto, true, 'o supervisor saiu dentro da observacao');
    assert.equal(r.classificacao, 'fase_concluida');
    const [res] = k.resultados();
    assert.equal(res.stopReason, 'end_turn');
    assert.equal(res.exitCode, 0);
    assert.equal(res.ok, true);
  } finally { sup2?.limpar(); d?.limpar(); }
});

test('GW19: o evento do nucleo gravado entre a primeira leitura do ledger e o recibo adia a decisao, e a volta seguinte conclui pela prova', () => {
  // RM-067 (F4b, G8): com o MCP, o `ship_done` (como o commit ou o verify) chega pelo nucleo ate o fim da sessao. Aqui ele
  // entra no instante em que a observacao abre o recibo, depois da primeira leitura do ledger: a prova refeita sob o lock
  // muda, e a decisao fica para a volta seguinte, que conclui. Sem a reconferencia, esta volta gravaria human.pending.
  const c = cenario('prova-sob-lock', { fase: 'SHIP' });
  try {
    c.stream(fixture('fim-normal.jsonl'));
    c.sessaoNoDisco();
    c.recibo(0);
    const r1 = comGancho(`${c.log}.exit.json`, 'antes',
      () => { registrar(c.dir, c.t.id, 'ship_done', { fase: 'SHIP', origem: 'mcp.ship' }); }, () => c.observar(1000));
    assert.equal(r1.concluido, false, 'a prova mudou sob o lock: nada gravado nesta volta');
    assert.match(String(r1.espera), /reavaliar na próxima volta/);
    assert.equal(c.resultados().length, 0);
    const r2 = c.observar(2000);
    assert.equal(r2.classificacao, 'fase_concluida');
    const [res] = c.resultados();
    assert.equal((res.provaOrk as { ok: boolean }).ok, true);
    assert.match((res.provaOrk as { fonte: string }).fonte, /ship_done registrado no intervalo do despacho/);
    c.observar(3000);
    assert.equal(c.resultados().length, 1, 'um unico phase_result');
  } finally { c.limpar(); }
});

test('GW20: a retomada pronta para colar leva as duas variaveis do filho na frente, e o retomada.comando segue o argv', () => {
  const c = cenario('retomada-ambiente');
  try {
    c.stream(fixture('cortado.jsonl'));
    c.recibo(143);
    c.observar(1000);
    const [res] = c.resultados();
    assert.match(String(res.detalhe), /; retomada: GROK_CLAUDE_MCPS_ENABLED=0 GROK_CURSOR_MCPS_ENABLED=0 grok -p continue /);
    assert.deepEqual((res.retomada as { comando: string[] }).comando, RETOMADA(c.comando));
  } finally { c.limpar(); }
});

test('GW21: o verify_run gravado entre as leituras do CHECK adia a decisao, e o phase_result leva o verify da prova refeita', () => {
  // RM-067 (F4b, GO-FIX A1): a prova inteira e comparada sob o lock. O texto da prova do CHECK nao muda com o verify, mas o
  // phase_result grava o `verify` dela, que o #Noctum usa como o SHA revisado; sem a comparacao inteira, ele sairia nulo.
  const c = cenario('verify-sob-lock', { fase: 'CHECK' });
  try {
    c.stream(fixture('fim-normal.jsonl'));
    c.sessaoNoDisco();
    c.parecer();
    c.recibo(0);
    const commit = 'a'.repeat(40);
    const r1 = comGancho(`${c.log}.exit.json`, 'antes',
      () => { registrar(c.dir, c.t.id, 'verify_run', { fase: 'CHECK', commit, ok: true }); }, () => c.observar(1000));
    assert.equal(r1.concluido, false, 'a prova mudou sob o lock: nada gravado nesta volta');
    assert.equal(c.resultados().length, 0);
    const r2 = c.observar(2000);
    assert.equal(r2.classificacao, 'fase_concluida');
    const [res] = c.resultados();
    assert.equal((res.provaOrk as { verify: { commit: string } | null }).verify?.commit, commit, 'o verify da prova refeita vai ao resultado');
  } finally { c.limpar(); }
});

test('GW22: com o MCP do ork, a retomada pronta para colar avisa que o servidor terminou com a sessao e que ela parte da config da worktree como esta', () => {
  const comMcp = cenario('retomada-com-mcp', { comMcp: true });
  const semMcp = cenario('retomada-sem-mcp');
  try {
    for (const c of [comMcp, semMcp]) { c.stream(fixture('cortado.jsonl')); c.recibo(143); c.observar(1000); }
    const [com] = comMcp.resultados(), [sem] = semMcp.resultados();
    // GO-FIX N4: o aviso vem antes do comando, que as telas cortam no fim; a regra vai entre aspas simples, pronta para colar.
    // RM-067 (F4c, D10): o servidor do ork terminou com a sessao; a retomada manual roda sem ele, e o ork retry sobe outro.
    assert.match(String(com.detalhe), new RegExp('; o servidor MCP do ork terminou com a sessao, e o token dele so existia no ambiente dela, .* parte do ' +
      '\\.grok/config\\.toml da worktree como a sessao o deixou: .*ork retry, que sobe outro servidor e reescreve a config; ' +
      'retomada: GROK_CLAUDE_MCPS_ENABLED=0 '));
    assert.match(String(com.detalhe), / --allow 'MCPTool\(orkastery__ork_thread_status\)'$/);
    assert.equal(String(sem.detalhe).includes('.grok/config.toml'), false, 'sem o MCP, a retomada nao fala da config');
  } finally { comMcp.limpar(); semMcp.limpar(); }
});
