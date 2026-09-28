/**
 * I-33 (T5, D4 e D11): teste dedicado do risco R2. A sessao e despachada com o perfil A e o
 * processo `ork` roda na conta B. O stub do `claude` so lista a sessao para a conta que a
 * despachou, entao cada leitura pela conta errada vira "sessao ausente": o observador destacado,
 * o `ork sessions watch` e o `ork_observe` so classificam o estado real se consultarem pela
 * conta A. A prova e a captura do env de cada chamada. Junto, a precedencia da D11: sem Stop, a
 * falha de conta na transcricao do perfil e o motivo; com Stop, vale a prova da I-34.
 */
import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { projetoTemporario } from './apoio';
import * as util from '../src/util';
import { lerLedger, registrar } from '../src/ledger';
import { criarServidorMcp } from '../src/mcp-server';
import { rodarFase } from '../src/phase';
import { adicionarPerfil } from '../src/runtime-profiles';
import { observarSessao } from '../src/session-watcher';
import { dirThread, gravarThread, novaThread } from '../src/thread';

const SESSAO = '55555555-6666-7777-8888-999999999999';

const SCRIPT_CLAUDE = `#!/bin/sh
DIR="$ORK_PERFIL_STUB_DIR"
echo "$1 $CLAUDE_CONFIG_DIR" >> "$DIR/envs"
if [ "$1" = "auth" ]; then printf '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","configDirectory":"%s"}\\n' "$CLAUDE_CONFIG_DIR"; exit 0; fi
if [ "$1" = "agents" ]; then
  ESTADO=working; [ -f "$DIR/state" ] && ESTADO="$(cat "$DIR/state")"
  if [ -f "$DIR/conta" ] && [ "$(cat "$DIR/conta")" = "$CLAUDE_CONFIG_DIR" ]; then
    printf '[{"id":"55555555","sessionId":"${SESSAO}","name":"x","cwd":"%s","kind":"background","state":"%s","pid":%s}]\\n' "$(cat "$DIR/cwd")" "$ESTADO" "$PPID"
  else echo '[]'; fi
  exit 0
fi
printf '%s' "$CLAUDE_CONFIG_DIR" > "$DIR/conta"
pwd > "$DIR/cwd"
echo "Background agent started: ${SESSAO}"
exit 0
`;

interface Cenario { p: ReturnType<typeof projetoTemporario>; bin: string; contaA: string; envs: () => string[]; limpar: () => void }

function cenario(nome: string): Cenario {
  const p = projetoTemporario(nome);
  const bin = path.join(p.dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), SCRIPT_CLAUDE, { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, STUB: process.env.ORK_PERFIL_STUB_DIR, CLAUDE: process.env.CLAUDE_CONFIG_DIR };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.ORK_PERFIL_STUB_DIR = bin;
  process.env.CLAUDE_CONFIG_DIR = path.join(p.dir, 'conta-b');
  const contaA = path.join(p.dir, 'conta-a');
  adicionarPerfil(p.dir, { id: 'a', runtime: 'claude-bg', dir: contaA });
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  return { p, bin, contaA,
    envs: () => fs.existsSync(path.join(bin, 'envs')) ? fs.readFileSync(path.join(bin, 'envs'), 'utf8').trim().split('\n') : [],
    limpar: () => { p.limpar(); volta('PATH', anterior.PATH); volta('ORK_PERFIL_STUB_DIR', anterior.STUB); volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE); } };
}

/** Sessao claude-bg da conta A registrada sem watcher destacado, para o `ork sessions watch` observar sozinho. */
function sessaoDaContaA(c: Cenario, estado: string) {
  const t = novaThread(c.p.carregado, { nome: 'observa', modo: 'auto' }).thread;
  const despachadaEm = new Date(Date.now() - 1000).toISOString();
  t.sessoes.push({ sessionId: SESSAO, slug: t.slug, fase: 'GOAL', bloco: 'GOAL', runtime: 'claude-bg', despachadaEm,
    promptPath: '', promptSha256: '', verificada: true });
  gravarThread(c.p.dir, t);
  const dir = dirThread(c.p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GOAL', sessionId: SESSAO, runtime: 'claude-bg', cwd: c.p.dir,
    perfil: { id: 'a', runtime: 'claude-bg', configDir: c.contaA } });
  fs.writeFileSync(path.join(c.bin, 'conta'), c.contaA);
  fs.writeFileSync(path.join(c.bin, 'cwd'), c.p.dir + '\n');
  fs.writeFileSync(path.join(c.bin, 'state'), estado);
  return { t, dir, despachadaEm };
}

/** Transcricao que o proprio Claude Code grava no diretorio do perfil, com o erro de API. */
function transcricaoComErro(c: Cenario, texto: string): void {
  const pasta = path.join(c.contaA, 'projects', c.p.dir.replace(/[^a-zA-Z0-9-]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${SESSAO}.jsonl`), [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'trabalhando; out of credits nao e erro aqui' }] } }),
    JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: texto }] } }),
  ].join('\n') + '\n');
}

test('observador destacado do phase run consulta o claude agents pela conta do perfil', async () => {
  const c = cenario('observador-perfil-destacado');
  try {
    const t = novaThread(c.p.carregado, { nome: 'destacado', modo: 'auto' }).thread;
    const r = rodarFase(c.p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.verificada, true, r.erro);
    const prazo = Date.now() + 10000;
    while (c.envs().filter(l => l.startsWith('agents ')).length < 2 && Date.now() < prazo) await new Promise(f => setTimeout(f, 50));
    const agents = c.envs().filter(l => l.startsWith('agents '));
    assert.ok(agents.length >= 2, `o observador destacado nao consultou: ${c.envs().join(' | ')}`);
    assert.deepEqual([...new Set(agents)], [`agents ${c.contaA}`], 'nenhuma consulta pela conta do processo');
    assert.ok(lerLedger(dirThread(c.p.dir, t.id)).some(e => e.tipo === 'session_watcher_started'));
  } finally { c.limpar(); }
});

test('ork sessions watch: failed sem Stop com out of credits na transcricao do perfil vira runtime.quota-exhausted', () => {
  const c = cenario('observador-perfil-cota');
  try {
    const { dir } = sessaoDaContaA(c, 'failed');
    transcricaoComErro(c, 'API Error: Your workspace is out of credits');
    const r = observarSessao(c.p.carregado, SESSAO);
    assert.equal(r.concluido, true);
    assert.equal(r.classificacao, 'gate_blocked');
    const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result');
    assert.equal(resultado?.motivo, 'runtime.quota-exhausted');
    assert.deepEqual(resultado?.perfil, { id: 'a', runtime: 'claude-bg', configDir: c.contaA });
    assert.equal((resultado?.falhaDeConta as { motivo: string }).motivo, 'runtime.quota-exhausted');
    assert.equal(lerLedger(dir).find(e => e.tipo === 'gate_blocked')?.motivo, 'runtime.quota-exhausted');
    assert.deepEqual([...new Set(c.envs())], [`agents ${c.contaA}`], 'a leitura pela conta B diria sessao ausente');
  } finally { c.limpar(); }
});

test('ork sessions watch: sem evidencia na transcricao, failed sem Stop continua runtime.unavailable', () => {
  const c = cenario('observador-perfil-sem-evidencia');
  try {
    const { dir } = sessaoDaContaA(c, 'failed');
    observarSessao(c.p.carregado, SESSAO);
    const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result');
    assert.equal(resultado?.motivo, 'runtime.unavailable');
    assert.equal(resultado?.falhaDeConta, undefined);
  } finally { c.limpar(); }
});

test('D11a: com Stop correlacionado a cota na transcricao nunca reclassifica; o humano decide', () => {
  const c = cenario('observador-perfil-stop');
  try {
    const { t, dir, despachadaEm } = sessaoDaContaA(c, 'failed');
    transcricaoComErro(c, 'API Error: Your workspace is out of credits');
    registrar(dir, t.id, 'runtime_stop', { fase: 'GOAL', sessionId: SESSAO, runtime: 'claude-bg', despachoEm: despachadaEm,
      fonte: 'ork sessions event', sensor: 'stop', sensorEventId: 'a'.repeat(64) });
    observarSessao(c.p.carregado, SESSAO);
    const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result');
    assert.equal(resultado?.motivo, 'human.pending');
    assert.equal(resultado?.falhaDeConta, undefined);
  } finally { c.limpar(); }
});

test('ork_observe consulta cada sessao claude-bg pela sua conta e declara a falha de conta da transcricao', async () => {
  const c = cenario('observador-perfil-mcp');
  const original = util.exec;
  const chamadas: string[] = [];
  const stub = mock.method(util, 'exec', (cmd: string, args: string[], cwd?: string, timeout?: number, env?: NodeJS.ProcessEnv) => {
    if (cmd !== 'claude') return original(cmd, args, cwd, timeout, env);
    chamadas.push(String(env?.CLAUDE_CONFIG_DIR));
    const lista = env?.CLAUDE_CONFIG_DIR === c.contaA ? [{ sessionId: SESSAO, cwd: c.p.dir, state: 'failed', pid: process.pid }] : [];
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify(lista) };
  });
  const server = criarServidorMcp({ projeto: c.p.dir, host: 'codex' });
  const client = new Client({ name: 'observador-perfil', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    const { t, dir } = sessaoDaContaA(c, 'failed');
    // Segunda sessao, sem perfil: consultada pela conta do processo.
    const outra = '66666666-7777-8888-9999-aaaaaaaaaaaa';
    const fresca = JSON.parse(fs.readFileSync(path.join(dir, 'thread.json'), 'utf8'));
    fresca.sessoes.push({ ...fresca.sessoes[0], sessionId: outra });
    fs.writeFileSync(path.join(dir, 'thread.json'), JSON.stringify(fresca));
    registrar(dir, t.id, 'phase_dispatch', { fase: 'GOAL', sessionId: outra, runtime: 'claude-bg', cwd: c.p.dir });
    transcricaoComErro(c, 'Credit balance is too low');
    await server.connect(st); await client.connect(ct);
    const r = await client.callTool({ name: 'ork_observe', arguments: { threadId: t.id } });
    const texto = (r.content as { type: string; text: string }[]).filter(x => x.type === 'text').map(x => x.text).join('');
    assert.notEqual(r.isError, true, texto);
    const nativas = JSON.parse(texto).nativas as { sessionId: string; perfil?: string; disponivel: boolean; turno?: { conclusaoDeFase: string } }[];
    assert.deepEqual(chamadas.sort(), [path.join(c.p.dir, 'conta-b'), c.contaA].sort(), 'uma consulta por conta');
    const daContaA = nativas.find(n => n.sessionId === SESSAO);
    assert.equal(daContaA?.perfil, 'a');
    assert.equal(daContaA?.disponivel, true);
    assert.equal(daContaA?.turno?.conclusaoDeFase, 'gate_blocked:runtime.quota-exhausted');
    assert.equal(nativas.find(n => n.sessionId === outra)?.disponivel, false);
  } finally { stub.mock.restore(); await client.close(); await server.close(); c.limpar(); }
});
