/**
 * RM-037 (fatia 5, A3): o CHECK que termina em `done` sem o veredito, no #Auto, e do condutor.
 *
 * O observador grava `human.pending` quando o CHECK encerra o turno (Stop e terminal `done`) com o `docs/check.md`
 * sem exatamente um veredito legivel. Ate esta fatia isso ficava com o dono: "Esperando voce" no pulse, "espera
 * voce" no retrato da maquina. Nos dois casos reais (ork-i35horariodo em 20/09 e ork-pacotedeexpe em 30/09/2026, as
 * duas #Auto) ninguem perguntou nada ao dono, e o condutor seguiu sozinho minutos depois. Agora, no #Auto, a thread
 * sai do dono e a linha "parado no condutor" diz o passo: redespachar o CHECK. Fora do #Auto, nada muda. Os campos e
 * os textos sao os do `phase_result` real da ork-pacotedeexpe; ids, pid e sensor sao SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { retratoDaMaquina } from '../src/fabrica-estado';
import { lerLedger, registrar } from '../src/ledger';
import { entregasDoProjeto, esperaDoCondutor, pendenciaDoDono } from '../src/parado-no-condutor';
import { montarPulse, textoDoPulse } from '../src/pulse';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { ModoVivo } from '../src/types';
import { exec } from '../src/util';

const SEM_VEREDITO = 'docs/check.md gravado sem exatamente um veredito legível';
const DESPACHO = '2026-09-30T02:30:51.855Z';
const STOP = '2026-09-30T04:08:25.353Z';
const QUANDO = '2026-09-30T04:50:00.000Z'; // 41 min depois do Stop
const SENSOR = '9'.repeat(64);

const git = (dir: string, ...args: string[]) => {
  const r = exec('git', args, dir);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** Uma thread com a branch `ork/<slug>` e um commit de produto, sem push: a entrega ainda nao foi a lugar nenhum. */
function threadComProduto(p: ReturnType<typeof projetoTemporario>, nome: string, modo: ModoVivo) {
  const { thread: t } = novaThread(p.carregado, { nome, modo });
  const branch = `ork/${t.slug}`;
  git(p.dir, 'branch', branch, 'main');
  git(p.dir, 'checkout', '-q', branch);
  fs.writeFileSync(path.join(p.dir, `${t.slug}.txt`), `produto SIMULADO ${randomUUID()}\n`);
  git(p.dir, 'add', '--', `${t.slug}.txt`);
  git(p.dir, 'commit', '-q', '-m', `produto de ${t.slug}`);
  git(p.dir, 'checkout', '-q', 'main');
  return { t, dir: dirThread(p.dir, t.id) };
}

/** O despacho do CHECK, o Stop e o resultado que o observador grava, no formato real de 30/09. */
function checkEmDoneSemVeredito(dir: string, id: string, n: number, opcoes: { provou?: boolean; estadoNativo?: string } = {}) {
  const sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const estadoNativo = opcoes.estadoNativo ?? 'done';
  registrar(dir, id, 'phase_dispatch', { ts: '2026-09-30T02:30:51.845Z', fase: 'CHECK', slug: `${id}-full-2`, modo: 'auto',
    bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER', pausaAoFim: false, runtime: 'claude-bg', sessionId });
  registrar(dir, id, 'runtime_stop', { ts: STOP, fase: 'CHECK', sessionId, runtime: 'claude-bg', despachoEm: DESPACHO,
    fonte: 'ork sessions event', sensor: 'stop', sensorEventId: SENSOR, recebidoEm: '2026-09-30T04:08:25.700Z' });
  const provou = opcoes.provou === true;
  const comum = { fase: 'CHECK', sessionId, despachoEm: DESPACHO, sensorResultId: `claude-bg:${'8'.repeat(64)}`,
    classificacao: provou ? 'fase_concluida' : 'gate_blocked', motivo: provou ? null : 'human.pending', runtime: 'claude-bg',
    fonte: provou ? 'terminal nativo done com Stop correlacionado; docs/check.md com o veredito PASSOU'
      : `terminal nativo done com Stop correlacionado; sem prova do ork: ${SEM_VEREDITO}`,
    estadoNativo, statusNativo: 'idle', pidNativo: 4343, exitCode: null, exitCodeFonte: 'unavailable', signal: null, duracaoMs: null,
    duracaoFonte: 'unavailable', ok: provou, estado: provou ? 'concluida' : 'bloqueada', stop: { ts: STOP, sensorEventId: SENSOR },
    artefato: { arquivo: 'docs/check.md', sha256Base: 'a'.repeat(64), sha256Atual: 'b'.repeat(64) },
    provaOrk: provou ? { ok: true, fonte: 'docs/check.md com o veredito PASSOU', veredito: 'PASSOU', verify: null }
      : { ok: false, fonte: SEM_VEREDITO, motivo: 'human.pending', veredito: null, verify: null },
    conclusaoNativa: true, conclusaoNativaAusente: null, diagnostico: provou ? null : `sem prova do ork: ${SEM_VEREDITO}`,
    observadoEm: '2026-09-30T04:08:27.600Z', gate: 'phase.dispatch', origem: 'sessions.watch' };
  if (!provou) registrar(dir, id, 'gate_blocked', { ts: '2026-09-30T04:08:27.650Z', ...comum, detalhe: comum.diagnostico });
  registrar(dir, id, 'phase_result', { ts: '2026-09-30T04:08:27.661Z', ...comum });
  return { sessionId };
}

test('A3: no #Auto, o CHECK em done sem o veredito sai do dono e pede o CHECK de novo, antes da branch sem push', () => {
  const p = projetoTemporario('fatia5-a3-auto', true);
  try {
    const a = threadComProduto(p, 'check sem veredito', 'auto');
    const { sessionId } = checkEmDoneSemVeredito(a.dir, a.t.id, 51);
    const t = lerThread(p.dir, a.t.id), eventos = lerLedger(a.dir);
    assert.equal(pendenciaDoDono(t, eventos, QUANDO), null, 'antes: escalação human.pending');
    assert.deepEqual(esperaDoCondutor(t, eventos, QUANDO), { thread: a.t.id, fase: 'CHECK', sessionId, fimDoTurnoEm: STOP,
      tipo: 'check-sem-veredito', comProva: false });
    const r = entregasDoProjeto(p.carregado, { quando: QUANDO });
    const linha = r.parados.find((x) => x.thread === a.t.id);
    assert.equal(linha?.caso, 'check-sem-veredito', 'a branch tem commit sem push, mas sem o veredito o passo e o CHECK');
    assert.equal(linha?.proximoPasso, `redespachar o CHECK (ork phase run ${a.t.id} CHECK --prompt "<pedido da fase>")`);
    assert.equal(linha?.desdeEm, STOP);
    assert.ok(r.doCondutor.gates.has(`${a.t.id}|CHECK`));
    // As superficies: fora de "Esperando voce" no pulse, com a linha do condutor; fora de "espera voce" no retrato.
    const pulse = montarPulse(p.carregado, { quando: QUANDO, consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' } });
    assert.ok(!pulse.precisaDeHumanoAgora.some((i) => i.thread === a.t.id), JSON.stringify(pulse.precisaDeHumanoAgora.map((i) => i.id)));
    assert.equal(pulse.paradoNoCondutor?.find((x) => x.thread === a.t.id)?.caso, 'check-sem-veredito');
    assert.match(textoDoPulse(pulse), new RegExp(`${a.t.id} parado no condutor desde (?:\\d{2}/\\d{2} )?\\d{2}:\\d{2}: redespachar o CHECK`));
    assert.equal(retratoDaMaquina(p.carregado, { agora: QUANDO, maquina: 'pc-a' }).threads.find((x) => x.id === a.t.id)?.esperaVoce, false);
  } finally { p.limpar(); }
});

test('A3, contraprovas: fora do #Auto segue com o dono; com o veredito nao ha caso; abaixo do limiar nao ha linha', () => {
  const p = projetoTemporario('fatia5-a3-contra', true);
  try {
    for (const [n, modo] of [[61, 'maestro'], [62, 'classic']] as const) {
      const x = threadComProduto(p, `check sem veredito ${modo}`, modo);
      checkEmDoneSemVeredito(x.dir, x.t.id, n);
      const t = lerThread(p.dir, x.t.id), eventos = lerLedger(x.dir);
      assert.equal(pendenciaDoDono(t, eventos, QUANDO), 'escalação human.pending', modo);
      assert.equal(esperaDoCondutor(t, eventos, QUANDO), null, modo);
      assert.ok(!entregasDoProjeto(p.carregado, { quando: QUANDO }).parados.some((l) => l.thread === x.t.id), modo);
      assert.equal(retratoDaMaquina(p.carregado, { agora: QUANDO, maquina: 'pc-a' }).threads.find((y) => y.id === x.t.id)?.esperaVoce,
        true, modo);
    }
    const comVeredito = threadComProduto(p, 'check com veredito', 'auto');
    checkEmDoneSemVeredito(comVeredito.dir, comVeredito.t.id, 63, { provou: true });
    assert.notEqual(entregasDoProjeto(p.carregado, { quando: QUANDO }).parados.find((l) => l.thread === comVeredito.t.id)?.caso,
      'check-sem-veredito');
    // O CHECK em `blocked` com o Stop ja era do condutor (fatia 4) e continua no caso de sempre.
    const emBlocked = threadComProduto(p, 'check em blocked', 'auto');
    checkEmDoneSemVeredito(emBlocked.dir, emBlocked.t.id, 64, { estadoNativo: 'blocked' });
    assert.notEqual(entregasDoProjeto(p.carregado, { quando: QUANDO }).parados.find((l) => l.thread === emBlocked.t.id)?.caso,
      'check-sem-veredito');
    const cedo = threadComProduto(p, 'check sem veredito agora', 'auto');
    checkEmDoneSemVeredito(cedo.dir, cedo.t.id, 65);
    const logo = '2026-09-30T04:20:00.000Z'; // 12 min depois do Stop
    const r = entregasDoProjeto(p.carregado, { quando: logo });
    assert.ok(!r.parados.some((l) => l.thread === cedo.t.id), 'abaixo dos 30 min o condutor pode estar agindo');
    assert.ok(r.doCondutor.gates.has(`${cedo.t.id}|CHECK`), 'mesmo sem a linha, nao e pergunta do dono');
  } finally { p.limpar(); }
});

test('A3: a sessao que voltou a trabalhar depois do resultado, sem Stop novo, fica com o dono', () => {
  const p = projetoTemporario('fatia5-a3-retomada', true);
  try {
    const a = threadComProduto(p, 'check retomado', 'auto');
    const { sessionId } = checkEmDoneSemVeredito(a.dir, a.t.id, 71);
    registrar(a.dir, a.t.id, 'runtime_event', { ts: '2026-09-30T04:15:00.000Z', fase: 'CHECK', sessionId, runtime: 'claude-bg',
      despachoEm: DESPACHO, fonte: 'ork sessions event', sensor: 'heartbeat', sensorEventId: '7'.repeat(64) });
    const t = lerThread(p.dir, a.t.id), eventos = lerLedger(a.dir);
    assert.equal(pendenciaDoDono(t, eventos, QUANDO), 'escalação human.pending');
    assert.ok(!entregasDoProjeto(p.carregado, { quando: QUANDO }).parados.some((l) => l.thread === a.t.id));
  } finally { p.limpar(); }
});
