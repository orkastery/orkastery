/**
 * RM-037, defeitos de condução de 19 e 20/10/2026, defeito 4: a sessão que terminou não segura a condução.
 *
 * Em 20/10/2026 uma sessão claude-bg de GOAL+PLAN+GO deu a resposta final (Stop correlacionado às 04:12:22Z) e ficou
 * `working` no `claude agents --json`, ociosa no prompt (`status: idle`): o Claude Code só a encerrou (`done`) às 05:12:25Z,
 * pela regra dele de 60 min ociosa (`bg retire <id>: idle-prompt, idle 60m`). Sem `phase_result`, o despacho do CHECK foi
 * recusado (`conducao.em-andamento`) até a condutora assumir à mão. Aqui: `working`/`idle` vivo depois do Stop, sem
 * atividade e sem bloqueio pendente, vira fim do turno passado `OCIOSA_DEPOIS_DO_STOP_MS`, pela prova do `ork`; a espera por
 * tarefa em segundo plano (`busy`) continua trabalhando.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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
import { projetoTemporario } from './apoio';

const sid = '11111111-2222-3333-4444-555555555555';
const inicio = Date.parse('2026-09-01T00:00:00.000Z');
const hora = (seg: number) => new Date(inicio + seg * 1000).toISOString();
const depois = inicio + 24 * 3600000;
const OCIOSA = OCIOSA_DEPOIS_DO_STOP_MS / 1000;
const ociosa: Partial<RegistroAgenteClaude> = { state: 'working', status: 'idle', pid: process.pid };

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
  const evento = (tipo: string, seg: number) =>
    ingerirEvento(p.dir, sid, tipo, JSON.stringify({ observedAt: hora(seg), eventId: `${tipo}-${seg}` }), depois);
  const resultados = () => lerLedger(dir).filter((e) => e.tipo === 'phase_result');
  const gravarArtefato = (arquivo = 'goal.md') => {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', arquivo), '# objetivo\n');
  };
  // O lease de execucao que a sessao despachada segura (a conducao da thread).
  const lease: Lease = { nome: `exec:${t.id}`, thread: t.id, motivo: 'conducao', pid: process.pid, adquiridoEm: hora(0),
    expiraEm: hora(12 * 3600), conducao: { contrato: 'ork.conducao/v1', canal: 'cli', correlacao: null, operacao: 'phase.run', fase,
      promptSha256: null, identidade: 'despacho-de-teste', dono: { tipo: 'sessao', sessionId: sid, runtime: 'claude-bg', perfil: null,
        maquina: 'teste' } } };
  const conduzida = () => conducaoDosDados(lease, lerLedger(dir)) !== null;
  return { ...p, t, observar, evento, resultados, gravarArtefato, conduzida };
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
    assert.match(String(pr.fonte), /ociosa no prompt \(working\/idle\) por 5 min, sem tarefa em segundo plano; docs\/goal\.md gravado/);
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

test('defeito 4: busy (tarefa em segundo plano), status ausente, sem Stop ou com atividade depois dele continuam esperando', () => {
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
