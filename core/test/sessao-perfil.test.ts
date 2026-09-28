/**
 * I-33 (T4, D4): o perfil do despacho fica no registro da sessao (phase_dispatch,
 * session_sensor_registered, thread.json e phase_result) e o watcher codex e o liveness
 * resolvem por ele, nunca pelo env do processo. O processo `ork` destes testes roda na conta
 * B; a sessao e da conta A, e so a leitura pela conta A enxerga a fonte.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { identidadeProcesso } from '../src/adapters/codex-runner';
import { lerLedger, registrar } from '../src/ledger';
import { detectarFasesOrfas } from '../src/liveness';
import { rodarFase, SessaoComPerfil } from '../src/phase';
import { adicionarPerfil, lerPerfis, marcarFalhaDePerfil } from '../src/runtime-profiles';
import { observarSessao, validarFonteWatcher } from '../src/session-watcher';
import { dirThread, gravarThread, lerThread, listarIds, novaThread } from '../src/thread';

const SESSAO = '33333333-4444-5555-6666-777777777777';
const linha = (e: unknown) => JSON.stringify(e) + '\n';

/** `claude` por conta, como em despacho-perfil: `agents` so lista a sessao para a conta que despachou. */
const SCRIPT_CLAUDE = `#!/bin/sh
DIR="$ORK_PERFIL_STUB_DIR"
echo "$1 $CLAUDE_CONFIG_DIR" >> "$DIR/envs"
if [ "$1" = "auth" ]; then printf '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","configDirectory":"%s"}\\n' "$CLAUDE_CONFIG_DIR"; exit 0; fi
if [ "$1" = "agents" ]; then
  if [ -f "$DIR/conta" ] && [ "$(cat "$DIR/conta")" = "$CLAUDE_CONFIG_DIR" ]; then
    printf '[{"id":"33333333","sessionId":"${SESSAO}","name":"x","cwd":"%s","kind":"background","state":"working","pid":%s}]\\n' "$(cat "$DIR/cwd")" "$PPID"
  else echo '[]'; fi
  exit 0
fi
printf '%s' "$CLAUDE_CONFIG_DIR" > "$DIR/conta"
pwd > "$DIR/cwd"
echo "Background agent started: ${SESSAO}"
exit 0
`;

function contaB(dir: string): () => void {
  const anterior = { PATH: process.env.PATH, STUB: process.env.ORK_PERFIL_STUB_DIR, CLAUDE: process.env.CLAUDE_CONFIG_DIR,
    CODEX: process.env.CODEX_HOME };
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), SCRIPT_CLAUDE, { mode: 0o755 });
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.ORK_PERFIL_STUB_DIR = bin;
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'conta-b');
  process.env.CODEX_HOME = path.join(dir, 'codex-b');
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  return () => { volta('PATH', anterior.PATH); volta('ORK_PERFIL_STUB_DIR', anterior.STUB);
    volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE); volta('CODEX_HOME', anterior.CODEX); };
}

const envs = (dir: string) => {
  const f = path.join(dir, 'bin', 'envs');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : [];
};

test('phase run com perfil grava o perfil no despacho, no sensor e na sessao, e despacha pela conta A', () => {
  const p = projetoTemporario('sessao-perfil');
  const restaurar = contaB(p.dir);
  try {
    const contaA = path.join(p.dir, 'conta-a');
    adicionarPerfil(p.dir, { id: 'a', runtime: 'claude-bg', dir: contaA });
    const t = novaThread(p.carregado, { nome: 'perfil', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.bloqueado, false, r.erro);
    assert.equal(r.sessionId, SESSAO);
    assert.equal(r.verificada, true, 'reverificado pela conta A');
    assert.deepEqual(envs(p.dir).filter(l => !l.startsWith('auth ')).slice(0, 2), [`--bg ${contaA}`, `agents ${contaA}`]);
    const perfil = { id: 'a', runtime: 'claude-bg', configDir: contaA };
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.deepEqual(eventos.find(e => e.tipo === 'phase_dispatch')?.perfil, perfil);
    assert.deepEqual(eventos.find(e => e.tipo === 'session_sensor_registered')?.perfil, perfil);
    const sessao = lerThread(p.dir, t.id).sessoes.at(-1) as SessaoComPerfil;
    assert.deepEqual(sessao.perfil, perfil);
    assert.equal(lerPerfis(p.dir).perfis[0].ultimoUso, sessao.despachadaEm);
  } finally { p.limpar(); restaurar(); }
});

test('sem perfil o despacho segue a conta do processo e o ledger nao ganha perfil (P8)', () => {
  const p = projetoTemporario('sessao-sem-perfil');
  const restaurar = contaB(p.dir);
  try {
    const t = novaThread(p.carregado, { nome: 'semperfil', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.verificada, true);
    assert.equal(envs(p.dir)[0], `--bg ${path.join(p.dir, 'conta-b')}`);
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.equal(eventos.some(e => e.perfil !== undefined), false);
  } finally { p.limpar(); restaurar(); }
});

test('perfil explicito vence a ordem; nenhum disponivel bloqueia sem despachar pela conta errada', () => {
  const p = projetoTemporario('sessao-perfil-escolha');
  const restaurar = contaB(p.dir);
  try {
    adicionarPerfil(p.dir, { id: 'a', runtime: 'claude-bg', dir: path.join(p.dir, 'conta-a') });
    adicionarPerfil(p.dir, { id: 'b2', runtime: 'claude-bg', dir: path.join(p.dir, 'conta-b2') });
    const t = novaThread(p.carregado, { nome: 'escolha', modo: 'auto' }).thread;
    const ensaio = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg', perfil: 'b2', dryRun: true });
    assert.equal(ensaio.bloqueado, false);
    marcarFalhaDePerfil(p.dir, 'a', { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: 'Not logged in' });
    marcarFalhaDePerfil(p.dir, 'b2', { estado: 'esgotado', esgotadoAte: '2099-01-01T00:00:00.000Z',
      motivo: 'runtime.quota-exhausted', detalhe: 'out of credits' });
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.bloqueado, true);
    assert.equal(r.sessionId, null);
    assert.match(r.erro ?? '', /nenhum perfil disponivel/);
    assert.deepEqual(envs(p.dir), [], 'nada foi executado');
    const explicito = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg', perfil: 'b2' });
    assert.match(explicito.erro ?? '', /esgotado/);
  } finally { p.limpar(); restaurar(); }
});

function fixtureCodex(nome: string, perfilDo: (dir: string) => unknown) {
  const p = projetoTemporario(nome);
  const restaurar = contaB(p.dir);
  const perfil = perfilDo(p.dir);
  const sid = '44444444-5555-6666-7777-888888888888', inicio = Date.parse('2026-09-01T00:00:00.000Z');
  const t = novaThread(p.carregado, { nome: 'codex', modo: 'auto' }).thread;
  t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex', despachadaEm: new Date(inicio).toISOString(),
    promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id), log = path.join(dir, 'sessoes', 'fixture.codex.jsonl');
  fs.mkdirSync(path.dirname(log));
  fs.writeFileSync(log, linha({ type: 'thread.started', thread_id: sid }));
  fs.utimesSync(log, inicio / 1000, inicio / 1000);
  const processo = { schema: 'ork.codex-process/v1', iniciadoEm: new Date(inicio).toISOString(),
    supervisor: identidadeProcesso(process.pid), filho: { ...identidadeProcesso(process.pid), inicio: '0' } };
  fs.writeFileSync(log + '.process.json', JSON.stringify(processo));
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: sid, runtime: 'codex', ...(perfil ? { perfil } : {}) });
  registrar(dir, t.id, 'session_sensor_registered', { sessionId: sid, despachoEm: t.sessoes[0].despachadaEm,
    logPath: log, processoPath: log + '.process.json', reciboPath: log + '.exit.json', ...(perfil ? { perfil } : {}) });
  const receipt = () => fs.writeFileSync(log + '.exit.json', JSON.stringify({ ...processo,
    terminadoEm: new Date(inicio + 100).toISOString(), exitCode: 0, signal: null, duracaoMs: 100, erro: null }));
  return { p, t, sid, inicio, dir, log, receipt, limpar: () => { p.limpar(); restaurar(); } };
}

test('watcher codex procura o rollout no CODEX_HOME do perfil e o phase_result carrega o perfil', () => {
  const h = fixtureCodex('sessao-perfil-codex', dir => ({ id: 'x', runtime: 'codex', codexHome: path.join(dir, 'codex-a') }));
  try {
    const perfil = { id: 'x', runtime: 'codex', codexHome: path.join(h.p.dir, 'codex-a') };
    // Rollout com o nome da sessao, mas de outra identidade: so e lido (e rejeitado) se a busca for na conta A.
    const pasta = path.join(perfil.codexHome, 'sessions', '2026', '09', '01');
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, `rollout-ts-${h.sid}.jsonl`), linha({ type: 'session_meta', payload: { id: 'outra' } }));
    fs.appendFileSync(h.log, linha({ type: 'turn.completed' })); h.receipt();
    const r = observarSessao(h.p.carregado, h.sid, { agoraMs: h.inicio + 1000 });
    assert.equal(r.classificacao, 'fase_concluida');
    const eventos = lerLedger(h.dir);
    assert.equal(eventos.filter(e => e.tipo === 'session_watcher_source_rejected').length, 1, 'rollout da conta A foi encontrado');
    assert.deepEqual(eventos.find(e => e.tipo === 'phase_result')?.perfil, perfil);
  } finally { h.limpar(); }
});

test('perfil do sensor divergente do despacho reprova a fonte antes de observar', () => {
  const f = fixtureCodex('sessao-perfil-diverge', () => ({ id: 'x', runtime: 'codex', codexHome: '/srv/codex-x' }));
  try {
    registrar(f.dir, f.t.id, 'session_sensor_registered', { sessionId: f.sid, despachoEm: f.t.sessoes[0].despachadaEm,
      logPath: f.log, processoPath: f.log + '.process.json', reciboPath: f.log + '.exit.json',
      perfil: { id: 'x', runtime: 'codex', codexHome: '/srv/codex-outro' } });
    assert.throws(() => validarFonteWatcher(f.p.dir, f.sid), /diverge/);
  } finally { f.limpar(); }
});

test('liveness le a transcricao no CLAUDE_CONFIG_DIR do perfil, nao no do processo', () => {
  const p = projetoTemporario('sessao-perfil-liveness');
  const restaurar = contaB(p.dir);
  try {
    const hora = (min: number) => new Date(Date.UTC(2026, 8, 7, 10, min)).toISOString();
    const t = novaThread(p.carregado, { nome: 'vida', modo: 'auto' }).thread;
    const contaA = path.join(p.dir, 'conta-a');
    const projeto = path.join(contaA, 'projects', 'projeto-abreviado');
    fs.mkdirSync(projeto, { recursive: true });
    fs.writeFileSync(path.join(projeto, `${SESSAO}.jsonl`), JSON.stringify({ timestamp: hora(8), type: 'assistant' }) + '\n');
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { ts: hora(0), fase: 'CHECK', sessionId: SESSAO, runtime: 'claude-bg',
      perfil: { id: 'a', runtime: 'claude-bg', configDir: contaA } });
    assert.equal(detectarFasesOrfas(p.carregado, { quando: hora(12) }).length, 0, 'heartbeat da conta A adia o silencio');
    assert.equal(detectarFasesOrfas(p.carregado, { quando: hora(19), escopo: listarIds(p.dir) }).length, 1);
  } finally { p.limpar(); restaurar(); }
});
