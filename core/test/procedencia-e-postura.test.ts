/**
 * RM-047 (fronteira de confiança, P1 e P2): o que vem com o repositório não escolhe a postura de
 * sandbox, o diretório nem o executável desta máquina.
 *
 * Este arquivo usa só a API que já existia antes da correção (despacho, retomada, verify, prova do
 * GO, pulse e digest), para que o mesmo teste rode contra o código anterior e reprove nele.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { ambienteDoIngresso, pulseCom, QUANDO, threadsNoGate } from './apoio-pulse';
import { dirTemporario } from '../src/sandbox';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { hashDoPrompt, rodarFase } from '../src/phase';
import { redespachar } from '../src/retry';
import { cwdDaThread } from '../src/verify';
import { garantirWorktree } from '../src/worktree';
import { provaDoOrk } from '../src/session-watcher-claude';
import { varrerPulse } from '../src/pulse-delivery';
import { enviarDigest } from '../src/master-digest';
import { registrar } from '../src/ledger';
import { EventoLedger } from '../src/types';
import { exec } from '../src/util';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const ork = (dir: string, ...args: string[]) => {
  const env = { ...process.env };
  delete env.ORK_PROJETO;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env });
};

/** O manifesto do repositório pede o sandbox desligado, como um clone de terceiro poderia pedir. */
function projetoQueAfrouxa(nome: string): ProjetoDeTeste {
  const p = projetoTemporario(nome);
  const manifesto = path.join(p.dir, 'orkastery.yaml');
  fs.writeFileSync(manifesto, fs.readFileSync(manifesto, 'utf8').replace('sandbox: workspace-write', 'sandbox: danger-full-access'));
  p.carregado.manifesto.runtime.sandbox = 'danger-full-access';
  return p;
}

/** Um repositório git de fora, com dois commits e a árvore limpa. */
function repositorioAlheio(nome: string): { dir: string; pai: string; filho: string } {
  const dir = dirTemporario(nome);
  exec('git', ['init', '-b', 'main'], dir);
  for (const [k, v] of [['user.email', 'alheio@example.invalid'], ['user.name', 'Alheio'], ['commit.gpgsign', 'false']]) exec('git', ['config', k, v], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); exec('git', ['add', 'a.txt'], dir); exec('git', ['commit', '-m', 'pai'], dir);
  const pai = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
  fs.writeFileSync(path.join(dir, 'a.txt'), '2\n'); exec('git', ['commit', '-am', 'filho'], dir);
  return { dir, pai, filho: exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim() };
}

/** Versiona um arquivo de estado, como faria um repositório que commita o `.orkastery/`. */
function versionar(dir: string, relativo: string): void {
  const r = exec('git', ['add', '-f', '--', relativo], dir);
  assert.equal(r.ok, true, r.stderr);
  assert.equal(exec('git', ['commit', '-q', '-m', `versiona ${relativo}`], dir).ok, true);
}

test('P1: phase run recusa o sandbox afrouxado pelo manifesto sem a confirmação local, e diz o comando', () => {
  const p = projetoQueAfrouxa('p1-phase-run');
  try {
    const t = novaThread(p.carregado, { nome: 'p1 despacho', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'x', dryRun: true, runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(r.bloqueado, true, 'o despacho codex com danger-full-access do manifesto não sai');
    assert.equal(r.motivo, 'policy.violation');
    assert.match(String(r.erro), /^runtime\.sandbox-nao-confirmado: /);
    assert.ok(String(r.erro).includes('ork setup sandbox confirmar danger-full-access'), 'a recusa diz o comando que confirma');
    assert.deepEqual(r.comando, [], 'nada foi montado para o runtime');

    // O claude-bg não recebe a postura de sandbox do manifesto: segue como antes.
    const c = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'x', dryRun: true, runtime: 'claude-bg', model: 'modelo-SIMULADO' });
    assert.notEqual(c.motivo, 'policy.violation', String(c.erro));
  } finally { p.limpar(); }
});

test('P1: a confirmação local pelo setup libera a postura nesta máquina, e versionada no git não vale', () => {
  const p = projetoQueAfrouxa('p1-confirmacao');
  try {
    const t = novaThread(p.carregado, { nome: 'p1 confirmada', modo: 'auto' }).thread;
    const conf = ork(p.dir, 'setup', 'sandbox', 'confirmar', 'danger-full-access', '--por', 'teste');
    assert.equal(conf.status, 0, conf.stderr + conf.stdout);
    const arquivo = path.join(p.dir, '.orkastery', 'private', 'postura-local.json');
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'x', dryRun: true, runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.ok(!/runtime\.sandbox-nao-confirmado/.test(String(r.erro)), String(r.erro));
    assert.notEqual(r.motivo, 'policy.violation');

    // A mesma confirmação, vinda no índice do git, é estado do repositório e não da máquina.
    versionar(p.dir, '.orkastery/private/postura-local.json');
    const v = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'x', dryRun: true, runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(v.motivo, 'policy.violation');
    assert.match(String(v.erro), /runtime\.sandbox-nao-confirmado: .*versionado no git/);
  } finally { p.limpar(); }
});

test('P1: confirmar outra postura não libera danger-full-access, e revogar volta a recusar', () => {
  const p = projetoQueAfrouxa('p1-outra-postura');
  try {
    const t = novaThread(p.carregado, { nome: 'p1 outra', modo: 'auto' }).thread;
    assert.equal(ork(p.dir, 'setup', 'sandbox', 'confirmar', 'workspace-write').status, 0);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'x', dryRun: true, runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.match(String(r.erro), /^runtime\.sandbox-nao-confirmado: .*confirmou workspace-write/);
    assert.equal(ork(p.dir, 'setup', 'sandbox', 'confirmar', 'danger-full-access').status, 0);
    assert.equal(ork(p.dir, 'setup', 'sandbox', 'revogar').status, 0);
    const s = ork(p.dir, 'setup', 'sandbox', '--json');
    assert.equal(s.status, 0, s.stderr);
    assert.deepEqual(JSON.parse(s.stdout), { manifesto: 'danger-full-access', afrouxa: true, confirmadaNestaMaquina: null, despachoCodex: 'recusado' });
  } finally { p.limpar(); }
});

test('P1: a retomada (retry) recusa a mesma postura sem a confirmação local', () => {
  const p = projetoQueAfrouxa('p1-retry');
  try {
    const t = novaThread(p.carregado, { nome: 'p1 retomada', modo: 'auto' }).thread;
    const texto = 'prompt gravado SIMULADO\n';
    const rel = path.relative(p.dir, path.join(dirThread(p.dir, t.id), 'prompts', 'retomada.md'));
    fs.mkdirSync(path.dirname(path.join(p.dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(p.dir, rel), texto);
    const r = redespachar(p.carregado, lerThread(p.dir, t.id), 'GO', rel, hashDoPrompt(texto),
      { runtime: 'codex', model: 'modelo-SIMULADO', dryRun: true });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'policy.violation');
    assert.match(r.detalhe, /^runtime\.sandbox-nao-confirmado: /);
  } finally { p.limpar(); }
});

test('P2: o verify só roda na worktree registrada; diretório que o git não registra é recusado', () => {
  const p = projetoTemporario('p2-cwd-verify');
  const alheio = repositorioAlheio('p2-alheio-verify');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 verify', modo: 'auto' }).thread;
    const w = garantirWorktree(p.carregado, t.id);
    assert.equal(w.ok, true, w.detalhe);
    assert.equal(cwdDaThread(p.dir, lerThread(p.dir, t.id)), w.dir, 'a worktree registrada continua valendo');
    const thread = lerThread(p.dir, t.id);
    thread.worktree = alheio.dir;
    gravarThread(p.dir, thread);
    assert.throws(() => cwdDaThread(p.dir, lerThread(p.dir, t.id)), /^Error: estado\.worktree-nao-registrada: /);
  } finally { p.limpar(); fs.rmSync(alheio.dir, { recursive: true, force: true }); }
});

test('P2: thread.json versionado no git não escolhe o cwd do verify nem do despacho', () => {
  const p = projetoTemporario('p2-thread-versionada');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 versionada', modo: 'auto' }).thread;
    assert.equal(garantirWorktree(p.carregado, t.id).ok, true);
    versionar(p.dir, `.orkastery/threads/${t.id}/thread.json`);
    assert.throws(() => cwdDaThread(p.dir, lerThread(p.dir, t.id)), /^Error: estado\.rastreado: /);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'x', dryRun: true, runtime: 'claude-bg', model: 'modelo-SIMULADO' });
    assert.equal(r.bloqueado, true);
    assert.equal(r.motivo, 'tree.blocked');
    assert.match(String(r.erro), /^estado\.rastreado: /);
  } finally { p.limpar(); }
});

test('P2: a prova do GO não roda git num cwd do ledger fora das worktrees registradas', () => {
  const p = projetoTemporario('p2-prova-ledger');
  const alheio = repositorioAlheio('p2-alheio-prova');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 prova', modo: 'auto' }).thread;
    const despachadaEm = new Date(Date.now() - 60_000).toISOString();
    const sessao = { sessionId: '00000000-0000-4000-8000-0000000000a1', fase: 'GO' as const, despachadaEm };
    registrar(dirThread(p.dir, t.id), t.id, 'mcp_git_committed', { commit: alheio.filho });
    const eventos = JSON.parse('[' + fs.readFileSync(path.join(dirThread(p.dir, t.id), 'ledger.jsonl'), 'utf8')
      .trim().split('\n').join(',') + ']') as EventoLedger[];
    const prova = provaDoOrk(p.dir, t.id, sessao, eventos, { cwd: alheio.dir, head: alheio.pai });
    assert.equal(prova.ok, false, 'o commit do repositório alheio não prova o GO');
    assert.match(prova.fonte, /fora das worktrees registradas/);
  } finally { p.limpar(); fs.rmSync(alheio.dir, { recursive: true, force: true }); }
});

test('P2: pulse-host.json versionado no git não escolhe o executável do transporte', () => {
  const p = projetoTemporario('p2-pulse-host');
  const restaurar = ambienteDoIngresso();
  const marca = path.join(dirTemporario('p2-marca-pulse'), 'executou');
  try {
    const itens = threadsNoGate(p, 1);
    const host = path.join(p.dir, '.orkastery', 'monitor', 'pulse-host.json');
    fs.mkdirSync(path.dirname(host), { recursive: true });
    fs.writeFileSync(host, JSON.stringify({ executavel: process.execPath,
      argumentos: ['-e', `require('fs').writeFileSync(${JSON.stringify(marca)}, 'x')`, '{{mensagem}}'] }));
    versionar(p.dir, '.orkastery/monitor/pulse-host.json');
    const r = varrerPulse({ raiz: p.dir, consultar: () => pulseCom(itens, QUANDO), quando: QUANDO });
    assert.equal(fs.existsSync(marca), false, 'o executável do arquivo versionado não rodou');
    assert.equal(r.code, 1);
    assert.match(r.detalhe, /^transporte\.rastreado: /);

    // O mesmo arquivo, local e fora do índice, continua sendo o transporte desta máquina.
    exec('git', ['rm', '-q', '--cached', '--', '.orkastery/monitor/pulse-host.json'], p.dir);
    const local = varrerPulse({ raiz: p.dir, consultar: () => pulseCom(itens, QUANDO), quando: QUANDO });
    assert.equal(local.code, 0, local.detalhe);
    assert.equal(fs.existsSync(marca), true);
  } finally { restaurar(); p.limpar(); fs.rmSync(path.dirname(marca), { recursive: true, force: true }); }
});

test('P2: master-host.json versionado no git não escolhe o executável do digest', () => {
  const p = projetoTemporario('p2-master-host');
  const marca = path.join(dirTemporario('p2-marca-digest'), 'executou');
  try {
    const host = path.join(p.dir, '.orkastery', 'monitor', 'master-host.json');
    fs.mkdirSync(path.dirname(host), { recursive: true });
    fs.writeFileSync(host, JSON.stringify({ executavel: process.execPath,
      argumentos: ['-e', `require('fs').writeFileSync(${JSON.stringify(marca)}, 'x')`] }));
    versionar(p.dir, '.orkastery/monitor/master-host.json');
    const r = enviarDigest({ raiz: p.dir, quando: '2026-09-11T12:00:00Z' });
    assert.equal(fs.existsSync(marca), false);
    assert.equal(r.code, 1);
    assert.match(r.detalhe, /^transporte\.rastreado: /);
  } finally { p.limpar(); fs.rmSync(path.dirname(marca), { recursive: true, force: true }); }
});
