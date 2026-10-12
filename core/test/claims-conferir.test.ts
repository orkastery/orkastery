/**
 * RM-059 (T0.10): `ork claims conferir` reexecuta so o que foi pedido, no sandbox do verify, sob a
 * conducao da thread e sem gravar recibo. O sandbox entra injetado (a suite hermetica do CI nao tem
 * o codex); a prova com o sandbox de verdade e a conferencia da propria thread, na maquina local.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { commitar, projetoTemporario } from './apoio';
import { adicionarClaim, caminhoClaims, retirarClaim } from '../src/claims';
import { exigirManifesto } from '../src/manifest';
import {
  conferirClaims, ErroDeConferencia, FabricaDeExecutor, idsDeClaims, PRAZO_PADRAO_MS, textoDaConferencia, verifyDaTarefa,
} from '../src/claims-conferir';
import { conducaoDaThread, dormir, ErroDeConducao } from '../src/conducao';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { ResultadoDeComando } from '../src/types';

const CLI = path.resolve(__dirname, '../../dist/index.js');

interface Chamada { nome: string; comando: string; timeoutMs: number }

/** Um sandbox falso: registra cada comando e o prazo, e responde pelo `resposta`. */
function sandboxFalso(resposta: (comando: string) => Partial<ResultadoDeComando> = () => ({})) {
  const chamadas: Chamada[] = [];
  let abertos = 0;
  const fabrica: FabricaDeExecutor = (_worktree, timeoutMs) => {
    abertos++;
    return {
      executar: (nome, comando) => {
        chamadas.push({ nome, comando, timeoutMs });
        return { nome, comando, ok: true, code: 0, resumo: 'saida do comando', ...resposta(comando) };
      },
      fechar: () => { abertos--; },
    };
  };
  return { fabrica, chamadas, abertos: () => abertos };
}

function preparar(nome: string) {
  const p = projetoTemporario(nome);
  const { thread } = novaThread(p.carregado, { nome: 'conferir', modo: 'auto' });
  const claim = (alegacao: string, verificar: string[]) =>
    adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao, verificar, semProvaLocal: true }).id;
  const ids = [claim('o README existe', ['test -f README.md']), claim('o README fala de teste', ['grep -q teste README.md', 'true']),
    claim('esta reprova', ['false'])];
  const estado = () => ({
    ledger: fs.readFileSync(path.join(dirThread(p.dir, thread.id), 'ledger.jsonl'), 'utf8'),
    claims: fs.readFileSync(caminhoClaims(p.dir, thread.id), 'utf8'),
  });
  return { p, thread, ids, estado };
}

function comPlano(dir: string, thread: string, texto: string) {
  fs.mkdirSync(path.join(dirThread(dir, thread), 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dirThread(dir, thread), 'docs', 'plan.md'), texto);
}

test('S1 so as claims pedidas rodam, na ordem pedida, e nada e gravado no ledger nem no claims.jsonl', () => {
  const f = preparar('conferir-so-pedidas');
  try {
    const antes = f.estado();
    const s = sandboxFalso((comando) => (comando === 'false' ? { ok: false, code: 1, resumo: 'falhou de proposito' } : {}));
    const r = conferirClaims(f.p.carregado, f.thread.id, { claims: [f.ids[2], f.ids[0]], fabrica: s.fabrica });
    assert.deepEqual(s.chamadas.map((c) => c.comando), ['false', 'test -f README.md']);
    assert.deepEqual(s.chamadas.map((c) => c.nome), [`${f.ids[2]}.1`, `${f.ids[0]}.1`]);
    assert.equal(s.abertos(), 0, 'todo sandbox aberto foi fechado');
    assert.deepEqual(f.estado(), antes, 'ledger e claims.jsonl intactos');
    assert.equal(r.formato, 'ork.claims-conferencia/v1');
    assert.equal(r.reciboOficial, false);
    assert.equal(r.executor, 'codex-sandbox');
    assert.equal(r.prazoTotalMs, PRAZO_PADRAO_MS);
    assert.deepEqual(r.alvo, { tipo: 'claims', ids: [f.ids[2], f.ids[0]] });
    assert.deepEqual(r.itens.map((i) => [i.id, i.verificado, i.motivo]), [[f.ids[2], false, 'claims.failed'], [f.ids[0], true, null]]);
    assert.equal(r.itens[0].execucoes[0].fim, 'falhou de proposito');
    assert.equal(r.ok, false);
    assert.deepEqual(r.motivos, ['claims.failed']);
    assert.match(r.commit, /^[0-9a-f]{40}$/);
    assert.equal(conducaoDaThread(f.p.dir, f.thread.id), null, 'a conducao tomada para conferir foi devolvida');
    assert.match(textoDaConferencia(r), new RegExp(`${f.ids[2]} {2}NAO PASSOU \\(claims\\.failed\\)`));
  } finally { f.p.limpar(); }
});

test('S2 o prazo de cada comando nunca passa do que resta do prazo total, e o que nao cabe nao roda', () => {
  const f = preparar('conferir-prazo');
  try {
    const s = sandboxFalso(() => ({}));
    // O primeiro comando leva o prazo inteiro (10 s menos a reserva de 5 s), sem gastar CPU.
    const fabrica: FabricaDeExecutor = (w, t) => {
      const e = s.fabrica(w, t);
      return { ...e, executar: (n, c, d) => { if (s.chamadas.length === 0) dormir(5_200); return e.executar(n, c, d); } };
    };
    const r = conferirClaims(f.p.carregado, f.thread.id, { claims: [f.ids[0], f.ids[1]], prazoMs: 10_000, fabrica });
    assert.ok(s.chamadas[0].timeoutMs <= 10_000 - 5_000, `prazo do primeiro: ${s.chamadas[0].timeoutMs}`);
    assert.equal(s.chamadas.length, 1, 'depois de esgotar o prazo, nenhum comando roda');
    assert.equal(r.itens[1].motivo, 'verify.sem-veredito');
    assert.equal(r.itens[1].execucoes[0].executado, false);
    assert.equal(r.ok, false);
  } finally { f.p.limpar(); }
});

test('S3 recusas tipadas antes de executar: claim desconhecida, retirada, repetida, prazo fora da faixa, pedido duplo e thread fechada', () => {
  const f = preparar('conferir-recusas');
  try {
    retirarClaim(f.p.dir, f.thread.id, f.ids[1], 'retirada no teste');
    const s = sandboxFalso();
    const erro = (pedido: Parameters<typeof conferirClaims>[2], motivo: RegExp) =>
      assert.throws(() => conferirClaims(f.p.carregado, f.thread.id, { ...pedido, fabrica: s.fabrica }),
        (e: Error) => e instanceof ErroDeConferencia && motivo.test(e.message), String(motivo));
    erro({ claims: ['C99'] }, /claims\.conferir\.desconhecida: C99 nao existe/);
    erro({ claims: [f.ids[1]] }, /claims\.conferir\.retirada: .*retirada no teste/);
    erro({ claims: [f.ids[0]], prazoMs: 5_000 }, /claims\.conferir\.prazo/);
    erro({ claims: [f.ids[0]], prazoMs: 601_000 }, /claims\.conferir\.prazo/);
    erro({ claims: [f.ids[0]], tarefa: 'T1' }, /claims\.conferir\.uso/);
    erro({}, /claims\.conferir\.uso/);
    assert.throws(() => idsDeClaims('C1, c1'), /claims\.conferir\.repetida: C1/);
    assert.throws(() => idsDeClaims('C1,X2'), /claims\.conferir\.uso: id de claim invalido: X2/);
    assert.deepEqual(idsDeClaims(' c3 ,C7'), ['C3', 'C7']);
    gravarThread(f.p.dir, { ...lerThread(f.p.dir, f.thread.id), status: 'fechada' });
    erro({ claims: [f.ids[0]] }, /claims\.conferir\.thread-fechada/);
    assert.equal(s.chamadas.length, 0, 'nenhuma recusa executou comando');
  } finally { f.p.limpar(); }
});

test('S4 sem sandbox a conferencia recusa antes de tomar a conducao, sem fallback', () => {
  const f = preparar('conferir-sem-sandbox');
  try {
    const antes = f.estado();
    const fabrica: FabricaDeExecutor = () => { throw new Error('executor VERIFY sandbox disponível somente em Linux'); };
    assert.throws(() => conferirClaims(f.p.carregado, f.thread.id, { claims: [f.ids[0]], fabrica }),
      (e: Error) => e instanceof ErroDeConferencia && /claims\.conferir\.sandbox-indisponivel: .*sem fallback/.test(e.message));
    assert.deepEqual(f.estado(), antes);
    assert.equal(conducaoDaThread(f.p.dir, f.thread.id), null);
  } finally { f.p.limpar(); }
});

test('S5 --tarefa le o verify da tarefa nos formatos de plano em uso, e recusa o que nao da para rodar', () => {
  const formatos: Array<[string, string, string]> = [
    ['### T1: checador\n\n- **touch_paths:** `a`\n- **verify:** `npm test && node x.js`\n', 'T1', 'npm test && node x.js'],
    ['#### T0.1 Provar\n\n- **touch_paths:** `a`\n- **verify:** `test -s a.md`\n#### T0.2 Outra\n- **verify:** `false`\n', 'T0.1', 'test -s a.md'],
    ['## T1. Classificacao\n\n- touch_paths: `a`\n- verify: `node --test t.js`\n', 'T1', 'node --test t.js'],
    ['### T1 sem dois pontos\n* **verify**: `echo ok`\n', 't1', 'echo ok'],
  ];
  for (const [plano, tarefa, comando] of formatos) {
    assert.deepEqual(verifyDaTarefa(plano, tarefa), { tarefa: tarefa.toUpperCase(), comando }, plano.split('\n')[0]);
  }
  assert.deepEqual(verifyDaTarefa('### T2.1 x\n- **verify:** `a`\n### T2.10 y\n- **verify:** `b`\n', '2.10'), { tarefa: 'T2.10', comando: 'b' });
  assert.throws(() => verifyDaTarefa('### T1 x\n- **verify:** `a`\n', 'T2'), /claims\.conferir\.tarefa-ausente/);
  assert.throws(() => verifyDaTarefa('### T1 x\n- **verify:** `a`\n### T1 de novo\n', 'T1'), /claims\.conferir\.tarefa-repetida/);
  assert.throws(() => verifyDaTarefa('### T1 x\n- **touch_paths:** `a`\n### T2\n- **verify:** `b`\n', 'T1'), /claims\.conferir\.tarefa-sem-verify/);
  assert.throws(() => verifyDaTarefa('### T1 x\n- **verify:** `a`\n- **verify:** `b`\n', 'T1'), /claims\.conferir\.tarefa-ambigua/);
  assert.throws(() => verifyDaTarefa('### T1 x\n- **verify:** claims C5 a C7 (secao 4).\n', 'T1'), /claims\.conferir\.tarefa-sem-comando/);
  assert.throws(() => verifyDaTarefa('### T1 x\n', 'Tx'), /claims\.conferir\.uso: tarefa invalida/);
});

test('S6 --tarefa roda o verify da tarefa do plano da thread e diz o sha256 do plano que leu', () => {
  const f = preparar('conferir-tarefa');
  try {
    const s = sandboxFalso();
    assert.throws(() => conferirClaims(f.p.carregado, f.thread.id, { tarefa: 'T1', fabrica: s.fabrica }), /claims\.conferir\.plano-ausente/);
    const plano = '# PLAN\n\n### T1: algo\n\n- **verify:** `test -f README.md`\n';
    comPlano(f.p.dir, f.thread.id, plano);
    const r = conferirClaims(f.p.carregado, f.thread.id, { tarefa: 'T1', fabrica: s.fabrica });
    assert.deepEqual(s.chamadas.map((c) => [c.nome, c.comando]), [['T1.1', 'test -f README.md']]);
    assert.equal(r.alvo.tipo, 'tarefa');
    if (r.alvo.tipo === 'tarefa') {
      assert.equal(r.alvo.comando, 'test -f README.md');
      assert.equal(r.alvo.plano.sha256, createHash('sha256').update(plano).digest('hex'));
    }
    assert.equal(r.ok, true);
  } finally { f.p.limpar(); }
});

test('S6b da worktree da thread (manifesto lido nela), --tarefa e --claims leem o estado do checkout principal', () => {
  const p = projetoTemporario('conferir-da-worktree');
  try {
    commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'manifesto');
    const { thread } = novaThread(p.carregado, { nome: 'da worktree', modo: 'auto', criarWorktree: true });
    const id = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'o README existe', verificar: ['test -f README.md'], semProvaLocal: true }).id;
    comPlano(p.dir, thread.id, '### T1 algo\n- **verify:** `test -f README.md`\n');
    const daWorktree = exigirManifesto(thread.worktree!);
    assert.equal(fs.realpathSync(daWorktree.raiz), fs.realpathSync(thread.worktree!), 'o manifesto veio da worktree');
    const s = sandboxFalso();
    assert.equal(conferirClaims(daWorktree, thread.id, { tarefa: 'T1', fabrica: s.fabrica }).ok, true);
    assert.equal(conferirClaims(daWorktree, thread.id, { claims: [id], fabrica: s.fabrica }).ok, true);
    assert.deepEqual(s.chamadas.map((c) => c.comando), ['test -f README.md', 'test -f README.md']);
  } finally { p.limpar(); }
});

test('S7 com outra sessao conduzindo, a conferencia recusa pela conducao e nada executa', async () => {
  const f = preparar('conferir-conducao');
  try {
    adicionarClaim(f.p.dir, f.thread.id, { arquivo: 'README.md', alegacao: 'leva tempo', verificar: ['sleep 4'], semProvaLocal: true });
    const filho = spawn(process.execPath, [CLI, 'verify', f.thread.id, '--so-claims'],
      { cwd: f.p.dir, env: { ...process.env, ORK_CANAL: 'claude-code' }, stdio: 'ignore' });
    const fim = Date.now() + 20_000;
    while (!conducaoDaThread(f.p.dir, f.thread.id)) {
      if (Date.now() > fim) throw new Error('o verify do filho nao tomou a conducao');
      await new Promise((r) => setTimeout(r, 50));
    }
    const s = sandboxFalso();
    assert.throws(() => conferirClaims(f.p.carregado, f.thread.id, { claims: [f.ids[0]], fabrica: s.fabrica, canal: 'cli' }),
      (e: Error) => e instanceof ErroDeConducao);
    assert.equal(s.chamadas.length, 0);
    await new Promise((r) => filho.once('exit', r));
  } finally { f.p.limpar(); }
});

test('S8 o CLI recusa uso errado e claim desconhecida com saida 2, antes de qualquer sandbox', () => {
  const f = preparar('conferir-cli');
  try {
    const rodar = (...args: string[]) => spawnSync(process.execPath, [CLI, 'claims', 'conferir', ...args], { cwd: f.p.dir, encoding: 'utf8' });
    assert.equal(rodar(f.thread.id).status, 2);
    assert.equal(rodar(f.thread.id, '--claims', 'C1', '--tarefa', 'T1').status, 2);
    assert.equal(rodar(f.thread.id, '--claims').status, 2);
    const desconhecida = rodar(f.thread.id, '--claims', 'C99', '--json');
    assert.equal(desconhecida.status, 2);
    assert.deepEqual(JSON.parse(desconhecida.stdout), {
      formato: 'ork.claims-conferencia/v1', thread: f.thread.id, ok: false,
      erro: `claims.conferir.desconhecida: C99 nao existe na thread ${f.thread.id}`,
    });
  } finally { f.p.limpar(); }
});
