/**
 * RM-037, defeitos de condução de 19 e 20/10/2026, defeito 4: a sessão que terminou não segura a condução.
 *
 * Em 20/10/2026 uma sessão claude-bg de GOAL+PLAN+GO deu a resposta final (Stop correlacionado às 04:12:22Z) e ficou
 * `working` no `claude agents --json`, ociosa no prompt (`status: idle`): o Claude Code só a encerrou (`done`) às 05:12:25Z,
 * pela regra dele de 60 min ociosa (`bg retire <id>: idle-prompt, idle 60m`). Sem `phase_result`, o despacho do CHECK foi
 * recusado (`conducao.em-andamento`) até a condutora assumir à mão. Aqui: `working`/`idle` vivo depois do Stop, sem
 * atividade e sem bloqueio pendente, vira fim do turno passado `OCIOSA_DEPOIS_DO_STOP_MS`, pela prova do `ork`.
 *
 * CHECK 3 da ork-rm037defeit2: o `status: idle` também é o da sessão com só um despertar agendado (`CronCreate`), que volta a
 * escrever quando ele dispara (medido no Claude Code 2.1.304). A ociosidade só encerra o turno depois do Stop que disse zero
 * tarefa em segundo plano e zero despertar: as contagens que o hook tira de `background_tasks` e `session_crons`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { conducaoDosDados } from '../src/conducao';
import { lerLedger, registrar } from '../src/ledger';
import { ingerirEvento } from '../src/session-events';
import { observarSessao } from '../src/session-watcher';
import { fonteClaudeDoDespacho, OCIOSA_DEPOIS_DO_STOP_MS } from '../src/session-watcher-claude';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { ConsultaAgentesNativos, RegistroAgenteClaude } from '../src/adapters/claude-bg';
import { Fase, Lease } from '../src/types';
import { dirTemporario, projetoTemporario } from './apoio';

const sid = '11111111-2222-3333-4444-555555555555';
const inicio = Date.parse('2026-09-01T00:00:00.000Z');
const hora = (seg: number) => new Date(inicio + seg * 1000).toISOString();
const depois = inicio + 24 * 3600000;
const OCIOSA = OCIOSA_DEPOIS_DO_STOP_MS / 1000;
const ociosa: Partial<RegistroAgenteClaude> = { state: 'working', status: 'idle', pid: process.pid };
/** O Stop do Claude Code 2.1.304 sem nada pendente: o hook manda as duas contagens zeradas. */
const NADA_PENDENTE = { backgroundTasks: 0, sessionCrons: 0 };
const HOOK = path.resolve(__dirname, '../../../adapters/claude-code/hooks/ork-sensor.js');
const CLI = path.resolve(__dirname, '../../dist/index.js');

/** A sessão claude-bg despachada no instante 0, com o observador lendo o runtime simulado. */
function fixture(fase: Fase = 'GOAL') {
  const p = projetoTemporario('rm037d2010-ociosa');
  const t = novaThread(p.carregado, { nome: 'sessao ociosa', modo: 'auto' }).thread;
  t.sessoes.push({ sessionId: sid, slug: t.slug, fase, bloco: fase, runtime: 'claude-bg', despachadaEm: hora(0),
    promptPath: '', promptSha256: '', verificada: true });
  t.faseAtual = fase;
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase, sessionId: sid, runtime: 'claude-bg', cwd: p.dir });
  registrar(dir, t.id, 'session_sensor_registered', { fase, sessionId: sid, despachoEm: hora(0), ...fonteClaudeDoDespacho(p.dir, t.id, fase, p.dir) });
  const nativa = (registro: Partial<RegistroAgenteClaude>) => (): ConsultaAgentesNativos =>
    ({ ok: true, registros: [{ sessionId: sid, cwd: p.dir, ...registro }], detalhe: '', consultadoEm: hora(1) });
  const observar = (seg: number, registro: Partial<RegistroAgenteClaude>) =>
    observarSessao(p.carregado, sid, { agoraMs: inicio + seg * 1000, consultaClaude: nativa(registro) });
  // O Stop vai com as contagens do hook (zeradas, salvo quando o caso diz outras); os outros sensores, sem elas.
  const evento = (tipo: string, seg: number, contagens: Record<string, number> = tipo === 'stop' ? NADA_PENDENTE : {}) =>
    ingerirEvento(p.dir, sid, tipo, JSON.stringify({ observedAt: hora(seg), eventId: `${tipo}-${seg}`, ...contagens }), depois);
  const ledger = () => lerLedger(dir);
  const resultados = () => ledger().filter((e) => e.tipo === 'phase_result');
  const gravarArtefato = (arquivo = 'goal.md') => {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', arquivo), '# objetivo\n');
  };
  // O lease de execucao que a sessao despachada segura (a conducao da thread).
  const lease: Lease = { nome: `exec:${t.id}`, thread: t.id, motivo: 'conducao', pid: process.pid, adquiridoEm: hora(0),
    expiraEm: hora(12 * 3600), conducao: { contrato: 'ork.conducao/v1', canal: 'cli', correlacao: null, operacao: 'phase.run', fase,
      promptSha256: null, identidade: 'despacho-de-teste', dono: { tipo: 'sessao', sessionId: sid, runtime: 'claude-bg', perfil: null,
        maquina: 'teste' } } };
  const conduzida = () => conducaoDosDados(lease, ledger()) !== null;
  return { ...p, t, observar, evento, ledger, resultados, gravarArtefato, conduzida };
}

test('defeito 4 (19 e 20/10/2026): working/idle vivo depois do Stop vira fim do turno pela prova do ork, passado o prazo; a conducao sai', () => {
  const f = fixture();
  try {
    f.gravarArtefato();
    f.evento('heartbeat', 10); f.evento('stop', 20);
    assert.equal(f.observar(30, ociosa).concluido, false, 'a primeira leitura ociosa so comeca a contagem');
    assert.equal(f.observar(30 + OCIOSA - 1, ociosa).concluido, false);
    assert.equal(f.conduzida(), true, 'antes do prazo a sessao ainda conduz');
    const r = f.observar(30 + OCIOSA, ociosa);
    assert.equal(r.concluido, true);
    assert.equal(r.classificacao, 'fase_concluida');
    const [pr] = f.resultados();
    assert.equal(pr.estadoNativo, 'working'); assert.equal(pr.statusNativo, 'idle');
    assert.equal(pr.conclusaoNativa, false, 'o runtime nao disse done');
    assert.match(String(pr.fonte),
      /ociosa no prompt \(working\/idle\) por 5 min, sem tarefa em segundo plano nem despertar agendado no Stop; docs\/goal\.md gravado/);
    assert.equal(f.conduzida(), false, 'o phase_result solta a conducao: o despacho seguinte passa');
    assert.equal(f.observar(30 + OCIOSA + 60, ociosa).concluido, true);
    assert.equal(f.resultados().length, 1, 'uma vez so');
  } finally { f.limpar(); }
});

test('defeito 4: sem a prova do ork a ociosidade depois do Stop vira human.pending (no PLAN, artifact.missing), nunca reexecucao', () => {
  for (const [fase, motivo] of [['GOAL', 'human.pending'], ['PLAN', 'artifact.missing']] as [Fase, string][]) {
    const f = fixture(fase);
    try {
      f.evento('stop', 20);
      f.observar(30, ociosa);
      const r = f.observar(30 + OCIOSA, ociosa);
      assert.equal(r.classificacao, 'gate_blocked', fase);
      const [pr] = f.resultados();
      assert.equal(pr.motivo, motivo, fase);
      assert.match(String(pr.diagnostico), /sem prova do ork/, fase);
    } finally { f.limpar(); }
  }
});

test('defeito 4: busy (consulta ou subagente), status ausente, sem Stop ou com atividade depois dele continuam esperando', () => {
  const casos: { nome: string; preparar: (f: ReturnType<typeof fixture>) => void; registro: Partial<RegistroAgenteClaude> }[] = [
    { nome: 'busy depois do Stop', preparar: (f) => { f.evento('stop', 20); }, registro: { state: 'working', status: 'busy', pid: process.pid } },
    { nome: 'status ausente', preparar: (f) => { f.evento('stop', 20); }, registro: { state: 'working', pid: process.pid } },
    { nome: 'sem Stop', preparar: (f) => { f.evento('heartbeat', 20); }, registro: ociosa },
    { nome: 'heartbeat depois do Stop', preparar: (f) => { f.evento('stop', 20); f.evento('heartbeat', 25); }, registro: ociosa },
    { nome: 'permissao pedida depois do Stop', preparar: (f) => { f.evento('stop', 20); f.evento('permission_request', 25); },
      registro: ociosa },
  ];
  for (const caso of casos) {
    const f = fixture();
    try {
      f.gravarArtefato(); caso.preparar(f);
      assert.equal(f.observar(30, caso.registro).concluido, false, caso.nome);
      assert.equal(f.observar(3600, caso.registro).concluido, false, caso.nome);
      assert.equal(f.resultados().length, 0, caso.nome);
      assert.equal(f.conduzida(), true, caso.nome);
    } finally { f.limpar(); }
  }
});

/**
 * CHECK 3 da ork-rm037defeit2: o `status` que o Claude Code 2.1.304 dá à sessão que encerrou o turno com Bash em segundo
 * plano é `shell`, e não `busy` (medido na própria sessão do CHECK: `working`, `tempo: idle`, `status: shell` enquanto o
 * Bash rodava); `waiting` é a pergunta ou a permissão aberta. Nenhum dos dois é a ociosidade que solta a condução.
 */
test('defeito 4 (CHECK 3): shell (Bash em segundo plano) e waiting depois do Stop continuam esperando', () => {
  for (const status of ['shell', 'waiting']) {
    const f = fixture();
    try {
      f.gravarArtefato(); f.evento('stop', 20);
      const registro: Partial<RegistroAgenteClaude> = { state: 'working', status, pid: process.pid };
      assert.equal(f.observar(30, registro).concluido, false, status);
      assert.equal(f.observar(3600, registro).concluido, false, status);
      assert.equal(f.resultados().length, 0, status);
      assert.equal(f.conduzida(), true, status);
    } finally { f.limpar(); }
  }
});

/**
 * CHECK 3 da ork-rm037defeit2, achado 1: com só um `CronCreate` pendente a sessão ficou `working`/`idle` por 4 min depois do
 * Stop e voltou (`busy`) quando o despertar disparou. A ociosidade desse Stop nunca encerra o turno; o Stop do turno seguinte,
 * sem nada pendente, sim.
 */
test('defeito 4 (CHECK 3): o Stop com despertar agendado ou tarefa em segundo plano nao deixa a ociosidade encerrar o turno', () => {
  for (const contagens of [{ backgroundTasks: 0, sessionCrons: 1 }, { backgroundTasks: 1, sessionCrons: 0 }, { backgroundTasks: 2, sessionCrons: 3 }]) {
    const nome = JSON.stringify(contagens);
    const f = fixture();
    try {
      f.gravarArtefato(); f.evento('stop', 20, contagens);
      const espera = f.observar(30, ociosa);
      assert.equal(espera.concluido, false, nome);
      assert.match(String(espera.espera), new RegExp(`o Stop registrou ${contagens.backgroundTasks} tarefa\\(s\\) em segundo plano e ` +
        `${contagens.sessionCrons} despertar\\(es\\) agendado\\(s\\); a ociosidade não encerra o turno`), nome);
      assert.equal(f.observar(30 + OCIOSA, ociosa).concluido, false, nome);
      assert.equal(f.observar(3600, ociosa).concluido, false, `${nome}: nem depois de uma hora ociosa`);
      assert.equal(f.resultados().length, 0, nome);
      assert.equal(f.conduzida(), true, `${nome}: a sessao que vai acordar segue conduzindo`);
      // O despertar dispara: a sessao trabalha de novo e encerra o turno sem nada pendente.
      f.evento('heartbeat', 3700); f.evento('stop', 3800);
      assert.equal(f.observar(3810, ociosa).concluido, false, nome);
      const r = f.observar(3810 + OCIOSA, ociosa);
      assert.equal(r.classificacao, 'fase_concluida', nome);
      assert.equal(f.conduzida(), false, nome);
    } finally { f.limpar(); }
  }
});

test('defeito 4 (CHECK 3): o Stop sem as contagens (hook ou runtime de antes) nao prova que nada vai voltar; a sessao segue esperando', () => {
  for (const contagens of [{}, { backgroundTasks: 0 }, { sessionCrons: 0 }] as Record<string, number>[]) {
    const nome = JSON.stringify(contagens);
    const f = fixture();
    try {
      f.gravarArtefato(); f.evento('stop', 20, contagens);
      const espera = f.observar(30, ociosa);
      assert.match(String(espera.espera), /o Stop não disse se há tarefa em segundo plano ou despertar agendado/, nome);
      assert.equal(f.observar(30 + OCIOSA, ociosa).concluido, false, nome);
      assert.equal(f.observar(3600, ociosa).concluido, false, nome);
      assert.equal(f.resultados().length, 0, nome);
      assert.equal(f.conduzida(), true, nome);
      // O `done` do runtime continua encerrando o turno, como antes da regra da ociosidade.
      const r = f.observar(3700, { state: 'done', status: 'idle', pid: process.pid });
      assert.equal(r.classificacao, 'fase_concluida', nome);
    } finally { f.limpar(); }
  }
});

test('defeito 4: a contagem recomeca quando a sessao volta a trabalhar, e nunca conta de antes do Stop', () => {
  const f = fixture();
  try {
    f.gravarArtefato(); f.evento('stop', 20);
    f.observar(30, ociosa);
    // A sessao voltou (busy) e ficou ociosa de novo: o prazo conta da nova leitura ociosa.
    f.observar(100, { ...ociosa, status: 'busy' });
    f.observar(130, ociosa);
    assert.equal(f.observar(30 + OCIOSA, ociosa).concluido, false);
    assert.equal(f.observar(130 + OCIOSA, ociosa).concluido, true);
  } finally { f.limpar(); }
  const g = fixture();
  try {
    g.gravarArtefato(); g.evento('stop', 20);
    g.observar(30, ociosa);
    // Atividade e um Stop novo sem leitura no meio (observador parado, a batida da conducao a cada 15 min).
    g.evento('heartbeat', 40); g.evento('stop', 50);
    assert.equal(g.observar(30 + OCIOSA, ociosa).concluido, false, 'o prazo nao conta de antes do Stop novo');
    assert.equal(g.observar(50 + OCIOSA, ociosa).concluido, true);
  } finally { g.limpar(); }
});

test('defeito 4 (CHECK 3): o sensor grava as contagens no runtime_stop e recusa contagem invalida ou fora do stop', () => {
  const f = fixture();
  try {
    f.evento('stop', 20, { backgroundTasks: 2, sessionCrons: 1 });
    const [stop] = f.ledger().filter((e) => e.tipo === 'runtime_stop');
    assert.equal(stop.backgroundTasks, 2); assert.equal(stop.sessionCrons, 1);
    f.evento('stop', 30, {});
    const semContagens = f.ledger().filter((e) => e.tipo === 'runtime_stop').at(-1)!;
    assert.equal('backgroundTasks' in semContagens || 'sessionCrons' in semContagens, false, 'sem as contagens, nada se supoe');
    for (const valor of [-1, 1.5, '1', 10001, null]) {
      assert.throws(() => ingerirEvento(f.dir, sid, 'stop', JSON.stringify({ observedAt: hora(40), sessionCrons: valor }), depois),
        /campo de payload inválido: sessionCrons/, String(valor));
    }
    assert.throws(() => ingerirEvento(f.dir, sid, 'notification', JSON.stringify({ observedAt: hora(40), backgroundTasks: 0 }), depois),
      /contagem de trabalho pendente só vale no stop/);
  } finally { f.limpar(); }
});

test('defeito 4 (CHECK 3): o hook do Stop conta background_tasks e session_crons do Claude Code; com o ork de antes, o Stop vai sem elas', () => {
  const f = fixture();
  const pasta = dirTemporario('rm037d2010-ociosa-hook');
  try {
    const hook = (entrada: Record<string, unknown>, cli: string) => spawnSync(process.execPath, [HOOK], {
      cwd: f.dir, input: JSON.stringify({ session_id: sid, cwd: f.dir, hook_event_name: 'Stop', stop_hook_active: false, ...entrada }),
      env: { ...process.env, ORK_SENSOR_CLI: cli }, encoding: 'utf8', timeout: 60000,
    });
    const tarefa = { id: 'b1', type: 'monitor', status: 'running', description: 'tarefa SIMULADA' };
    const despertar = { id: 'c1', schedule: '30 10 20 10 *', recurring: false, prompt: 'despertar SIMULADO' };
    for (const [entrada, esperado] of [
      [{ background_tasks: [tarefa], session_crons: [despertar, despertar] }, { backgroundTasks: 1, sessionCrons: 2 }],
      [{ background_tasks: [], session_crons: [] }, { backgroundTasks: 0, sessionCrons: 0 }],
      [{}, {}],
    ] as [Record<string, unknown>, Record<string, number>][]) {
      const r = hook(entrada, CLI);
      assert.equal(r.status, 0); assert.equal(r.stderr, '', JSON.stringify(entrada));
      const stop = f.ledger().filter((e) => e.tipo === 'runtime_stop').at(-1)!;
      assert.deepEqual({ ...(stop.backgroundTasks !== undefined ? { backgroundTasks: stop.backgroundTasks } : {}),
        ...(stop.sessionCrons !== undefined ? { sessionCrons: stop.sessionCrons } : {}) }, esperado, JSON.stringify(entrada));
    }
    // O `ork` de antes recusa o campo novo (o validador so aceitava os cinco campos de texto): o hook manda o Stop sem ele.
    const recebidos = path.join(pasta, 'recebidos.jsonl');
    const antigo = path.join(pasta, 'ork-antigo.cjs');
    fs.writeFileSync(antigo, `#!${process.execPath}\n'use strict';\nconst fs = require('node:fs');\n` +
      `const p = JSON.parse(fs.readFileSync(0, 'utf8'));\n` +
      `for (const k of Object.keys(p)) if (!['observedAt', 'eventId', 'notificationType', 'commit', 'accountFailure'].includes(k)) ` +
      `{ console.error('evento recusado: campo de payload inválido: ' + k); process.exit(1); }\n` +
      `fs.appendFileSync(${JSON.stringify(recebidos)}, JSON.stringify({ args: process.argv.slice(2), p }) + '\\n');\n`, { mode: 0o755 });
    const r = hook({ background_tasks: [tarefa], session_crons: [] }, antigo);
    assert.equal(r.status, 0); assert.equal(r.stderr, '', 'o Stop foi ingerido na segunda tentativa');
    const linhas = fs.readFileSync(recebidos, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(linhas.length, 1);
    assert.deepEqual(linhas[0].args, ['sessions', 'event', '--tipo', 'stop', '--sessao', sid]);
    assert.deepEqual(Object.keys(linhas[0].p).sort(), ['eventId', 'observedAt']);
  } finally { f.limpar(); fs.rmSync(pasta, { recursive: true, force: true }); }
});
