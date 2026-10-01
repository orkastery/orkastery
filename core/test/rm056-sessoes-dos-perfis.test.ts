/**
 * RM-056 (C4, C5, C6, D4, D5, D7): as sessoes de cada perfil. O stub do `claude` responde o
 * `agents` pela conta do ambiente (`$CLAUDE_CONFIG_DIR/agents.json`), como o runtime real: so
 * consultando com o diretorio do perfil a sessao aparece. O codex le o `CODEX_HOME` do perfil.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';
import { estadosDeSessao, planejar } from '../src/board';
import { registrar } from '../src/ledger';
import { adicionarPerfil } from '../src/runtime-profiles';
import { contasDeSessoes, ehFantasma } from '../src/sessoes-contas';
import { inventariarSessoes } from '../src/sessoes-inventario';
import { textoDoInventario } from '../src/sessoes';
import { dirThread, novaThread } from '../src/thread';

const UUID = (n: number) => `56565656-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SCRIPT = `#!/bin/sh
if [ "$1" = "agents" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/agents.json" ]; then cat "$CLAUDE_CONFIG_DIR/agents.json"; else echo '[]'; fi
  exit 0
fi
exit 0
`;

interface Cenario { p: ProjetoDeTeste; contas: Record<string, string>; restaurar: () => void }

/** Conta do processo, dois perfis claude-bg (a, b) e um codex (x), cada um com as sessoes dadas. */
function cenario(nome: string, sessoes: { processo?: object[]; a?: object[]; b?: object[] }): Cenario {
  const p = projetoTemporario(nome);
  const bin = dirTemporario(`${nome}-bin`);
  fs.writeFileSync(path.join(bin, 'claude'), SCRIPT, { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, CLAUDE: process.env.CLAUDE_CONFIG_DIR, CODEX: process.env.CODEX_HOME };
  const contas: Record<string, string> = {};
  for (const id of ['processo', 'a', 'b', 'x', 'codex-processo']) {
    contas[id] = path.join(p.dir, 'contas', id);
    fs.mkdirSync(contas[id], { recursive: true });
  }
  for (const id of ['processo', 'a', 'b'] as const) {
    if (sessoes[id]) fs.writeFileSync(path.join(contas[id], 'agents.json'), JSON.stringify(sessoes[id]));
  }
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.CLAUDE_CONFIG_DIR = contas.processo;
  process.env.CODEX_HOME = contas['codex-processo'];
  adicionarPerfil(p.dir, { id: 'a', runtime: 'claude-bg', dir: contas.a });
  adicionarPerfil(p.dir, { id: 'b', runtime: 'claude-bg', dir: contas.b });
  adicionarPerfil(p.dir, { id: 'x', runtime: 'codex', dir: contas.x });
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  return { p, contas, restaurar: () => {
    volta('PATH', anterior.PATH); volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE); volta('CODEX_HOME', anterior.CODEX);
    fs.rmSync(bin, { recursive: true, force: true }); p.limpar();
  } };
}

/** Rollout codex com cabecalho e sem evento terminal, escrito agora. */
function rolloutCodex(casa: string, id: string, cwd: string): void {
  const dir = path.join(casa, 'sessions', '2026', '10', '01');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `rollout-${id}.jsonl`),
    JSON.stringify({ type: 'session_meta', payload: { id, cwd } }) + '\n' +
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n');
}

test('C4: inventario le a conta do processo e cada perfil, com o id do perfil e sem o diretorio', () => {
  const vivo = process.pid;
  const c = cenario('rm056-inv', {
    processo: [],
    a: [{ sessionId: UUID(1), cwd: '/srv/x', state: 'working', pid: vivo }],
    b: [{ sessionId: UUID(2), cwd: '/srv/y', state: 'working', pid: vivo },
      { sessionId: UUID(3), cwd: '/srv/y', state: 'blocked' }],
  });
  try {
    rolloutCodex(c.contas.x, UUID(4), '/srv/z');
    const r = inventariarSessoes(c.p.dir, { global: true });
    const porId = new Map(r.sessoes.map(s => [s.sessionId, s]));
    assert.equal(porId.get(UUID(1))?.perfil, 'a');
    assert.equal(porId.get(UUID(2))?.perfil, 'b');
    assert.equal(porId.get(UUID(4))?.perfil, 'x');
    assert.equal(porId.get(UUID(4))?.runtime, 'codex');
    assert.equal(porId.get(UUID(4))?.viva, true, 'rollout aberto e recente e sessao viva');
    // C6: blocked sem pid e fantasma; com pid vivo, nao.
    assert.equal(porId.get(UUID(3))?.fantasma, true);
    assert.equal(porId.get(UUID(2))?.fantasma, false);
    assert.equal(r.fantasmas, 1);
    const texto = textoDoInventario(r);
    assert.match(texto, /PERFIL/);
    assert.match(texto, /blocked \(fantasma\)/);
    assert.match(texto, /limpar-fantasmas/);
    for (const id of ['a', 'b', 'x']) assert.equal(texto.includes(c.contas[id]), false, `o texto nao expoe a pasta do perfil ${id}`);
    // Uma consulta por conta: processo, a, b (claude) e x, processo (codex).
    assert.equal(r.fontes.filter(f => f.origem.startsWith('claude agents')).length, 3);
  } finally { c.restaurar(); }
});

test('C4: perfil na mesma pasta da conta do processo e consultado uma vez, com o id do perfil', () => {
  const c = cenario('rm056-dedup', { a: [{ sessionId: UUID(5), cwd: '/srv/x', state: 'working', pid: process.pid }] });
  try {
    process.env.CLAUDE_CONFIG_DIR = c.contas.a;
    const { contas } = contasDeSessoes(c.p.dir);
    const claude = contas.filter(k => k.runtime === 'claude-bg');
    assert.deepEqual(claude.map(k => k.perfil?.id ?? null), ['a', 'b']);
    const r = inventariarSessoes(c.p.dir, { global: true });
    assert.deepEqual(r.sessoes.map(s => [s.sessionId, s.perfil]), [[UUID(5), 'a']]);
  } finally { c.restaurar(); }
});

test('C5: escalonador conta como em andamento a sessao working de um perfil e ignora o fantasma', () => {
  const c = cenario('rm056-board', {
    b: [{ sessionId: UUID(6), cwd: '/srv/y', state: 'working', pid: process.pid },
      { sessionId: UUID(7), cwd: '/srv/y', state: 'blocked' }],
  });
  try {
    const estados = estadosDeSessao(c.p.dir, 30);
    assert.equal(estados?.get(UUID(6)), 'working');
    assert.equal(estados?.get(UUID(7)), 'fantasma', 'fantasma nao e working nem blocked');
    const viva = novaThread(c.p.carregado, { nome: 'viva', modo: 'auto' }).thread;
    registrar(dirThread(c.p.dir, viva.id), viva.id, 'phase_dispatch', { fase: 'GO', sessionId: UUID(6), runtime: 'claude-bg' });
    const fantasma = novaThread(c.p.carregado, { nome: 'fantasma', modo: 'auto' }).thread;
    registrar(dirThread(c.p.dir, fantasma.id), fantasma.id, 'phase_dispatch', { fase: 'GO', sessionId: UUID(7), runtime: 'claude-bg' });
    // Sem `estados`, o escalonador consulta o runtime: e o caminho do `ork board plan`.
    const plano = planejar(c.p.carregado);
    assert.equal(plano.emAndamento, 1, 'antes da RM-056 o board via 0: a sessao do perfil b nao aparecia');
    const vaga = (id: string) => plano.vagas.find(v => v.thread === id);
    assert.match(vaga(viva.id)?.detalhe ?? '', /trabalhando no runtime/);
    assert.notEqual(vaga(fantasma.id)?.motivo, 'human.pending', 'o fantasma nao vira pausa humana');
  } finally { c.restaurar(); }
});

test('D5: fantasma e so claude-bg nao terminal sem processo', () => {
  const morto = () => false, vivo = () => true;
  assert.equal(ehFantasma('claude-bg', { sessionId: UUID(8), state: 'blocked' }, morto), true);
  assert.equal(ehFantasma('claude-bg', { sessionId: UUID(8), state: 'working', pid: 1 }, vivo), false);
  assert.equal(ehFantasma('claude-bg', { sessionId: UUID(8), state: 'done' }, morto), false, 'terminal nao e fantasma');
  assert.equal(ehFantasma('codex', { sessionId: UUID(8), state: 'unknown' }, morto), false, 'codex nao expoe pid');
});
