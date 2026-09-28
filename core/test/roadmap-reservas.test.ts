/**
 * I-47: reservas de item do roadmap entre maquinas.
 *
 * Duas "maquinas" sao dois clones do mesmo remoto bare, com identidades diferentes. Tudo e git
 * de verdade: fetch, commit-tree e push sem forca. Nenhum teste toca o remoto do Orkastery.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BRANCH_DE_RESERVAS,
  listarReservas,
  painelEmMarkdown,
  pegarItem,
  soltarItem,
  textoDasReservas,
} from '../src/roadmap-reservas';
import { exec } from '../src/util';
import { commitar, dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const A = { maquina: 'pc-a' };
const B = { maquina: 'pc-b' };

/** O projeto com dois itens no roadmap, publicado no remoto, e um segundo clone (a maquina B). */
function duasMaquinas(nome: string) {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, 'docs/roadmap/RM-001-primeiro.md', '# RM-001\n', 'roadmap: RM-001');
  commitar(p.dir, 'docs/roadmap/RM-002-segundo.md', '# RM-002\n', 'roadmap: RM-002');
  // O manifesto que o `ork init` gerou vai junto: a outra maquina clona um projeto do ork.
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-q', '-m', 'manifesto do projeto'], p.dir);
  exec('git', ['push', '-q', 'origin', 'main'], p.dir);
  const b = path.join(dirTemporario(`${nome}-b`), 'clone');
  exec('git', ['clone', '-q', p.remoto as string, b]);
  exec('git', ['config', 'user.email', 'b@orkastery.local'], b);
  exec('git', ['config', 'user.name', 'Builder B'], b);
  exec('git', ['config', 'commit.gpgsign', 'false'], b);
  return {
    a: p.dir,
    b,
    remoto: p.remoto as string,
    limpar: () => { p.limpar(); fs.rmSync(path.dirname(b), { recursive: true, force: true }); },
  };
}

function ork(dir: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('o primeiro pega; o segundo ve com quem esta e e recusado; outro item segue livre', () => {
  const m = duasMaquinas('reservas-basico');
  try {
    const r = pegarItem(m.a, 'rm-001', { ...A, nota: 'comecando pelo contrato' });
    assert.equal(r.acao, 'pegou');
    assert.equal(r.item, 'RM-001');
    assert.equal(r.reserva?.por, 'Teste Orkastery');
    assert.match(r.commit ?? '', /^[a-f0-9]{40}$/);

    const vistoPorB = listarReservas(m.b);
    assert.equal(vistoPorB.atualizado, true);
    assert.deepEqual(vistoPorB.reservas.map((x) => [x.item, x.por, x.maquina]), [['RM-001', 'Teste Orkastery', 'pc-a']]);
    assert.throws(() => pegarItem(m.b, 'RM-001', B),
      (e: Error) => /^roadmap\.reservado: RM-001 esta com Teste Orkastery em pc-a/.test(e.message));
    assert.equal(pegarItem(m.b, 'RM-002', B).acao, 'pegou');

    // O painel da branch lista os dois, e nada foi criado na arvore nem nas branches locais.
    const painel = exec('git', ['show', `origin/${BRANCH_DE_RESERVAS}:RESERVAS.md`], m.a);
    assert.equal(exec('git', ['fetch', '-q', 'origin', `+refs/heads/${BRANCH_DE_RESERVAS}:refs/remotes/origin/${BRANCH_DE_RESERVAS}`], m.a).ok, true);
    const painelAtual = exec('git', ['show', `origin/${BRANCH_DE_RESERVAS}:RESERVAS.md`], m.a).stdout;
    assert.ok(painel.ok);
    assert.match(painelAtual, /\| RM-001 \| Teste Orkastery \| pc-a \|/);
    assert.match(painelAtual, /\| RM-002 \| Builder B \| pc-b \|/);
    for (const dir of [m.a, m.b]) {
      assert.equal(exec('git', ['status', '--porcelain'], dir).stdout.trim(), '', `arvore intacta em ${dir}`);
      assert.equal(exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH_DE_RESERVAS}`], dir).ok, false);
    }
  } finally { m.limpar(); }
});

test('renovar mantem o desde; soltar libera; soltar a de outro exige --forcar com motivo', () => {
  const m = duasMaquinas('reservas-ciclo');
  try {
    const primeira = pegarItem(m.a, 'RM-001', { ...A, agora: '2026-09-27T09:00:00.000Z' });
    const renovada = pegarItem(m.a, 'RM-001', { ...A, thread: 'ork-exemplo', agora: '2026-09-27T10:00:00.000Z' });
    assert.equal(renovada.acao, 'renovou');
    assert.equal(renovada.reserva?.desdeEm, primeira.reserva?.desdeEm);
    assert.equal(renovada.reserva?.thread, 'ork-exemplo');
    assert.equal(renovada.reserva?.atualizadaEm, '2026-09-27T10:00:00.000Z');

    assert.throws(() => soltarItem(m.b, 'RM-001', B), /roadmap\.reservado/);
    assert.throws(() => soltarItem(m.b, 'RM-001', { ...B, forcar: true }), /roadmap\.forcar: --forcar exige --motivo/);
    assert.equal(soltarItem(m.a, 'RM-001', A).acao, 'soltou');
    assert.equal(soltarItem(m.a, 'RM-001', A).acao, 'nada', 'soltar o que esta livre e idempotente');
    assert.deepEqual(listarReservas(m.b).reservas, []);
    assert.equal(pegarItem(m.b, 'RM-001', B).acao, 'pegou');
  } finally { m.limpar(); }
});

test('tomar a reserva de outra maquina fica registrado com de quem e por que', () => {
  const m = duasMaquinas('reservas-tomada');
  try {
    pegarItem(m.a, 'RM-002', A);
    const tomada = pegarItem(m.b, 'RM-002', { ...B, forcar: true, motivo: 'pc-a desligado desde sexta' });
    assert.equal(tomada.acao, 'tomou');
    assert.deepEqual(tomada.reserva?.tomadaDe, { por: 'Teste Orkastery', maquina: 'pc-a', motivo: 'pc-a desligado desde sexta' });
    const log = exec('git', ['log', '-1', '--format=%s', tomada.commit as string], m.b).stdout;
    assert.match(log, /RM-002 tomada por Builder B em pc-b \(de Teste Orkastery em pc-a\): pc-a desligado desde sexta/);
  } finally { m.limpar(); }
});

test('corrida: o push que chega depois e recusado, relido, e vira roadmap.reservado', () => {
  const m = duasMaquinas('reservas-corrida');
  try {
    pegarItem(m.b, 'RM-002', B); // a branch ja existe: a corrida e sobre uma ponta, nao sobre o nascimento
    // Entre o fetch e o push de B, a maquina A reserva o mesmo item (hook pre-push de B, uma vez so).
    const marca = path.join(path.dirname(m.b), 'corrida-feita');
    const hook = path.join(m.b, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(hook, `#!/bin/sh\n[ -f "${marca}" ] && exit 0\ntouch "${marca}"\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\n` +
      `cd "${m.a}" && ORK_MAQUINA=pc-a "${process.execPath}" "${CLI}" roadmap pegar RM-001 >/dev/null\n`, { mode: 0o755 });
    assert.throws(() => pegarItem(m.b, 'RM-001', B),
      (e: Error) => /^roadmap\.reservado: RM-001 esta com Teste Orkastery em pc-a/.test(e.message));
    assert.ok(fs.existsSync(marca), 'a outra maquina reservou no meio do push');
    const dono = listarReservas(m.a).reservas.find((r) => r.item === 'RM-001');
    assert.equal(dono?.maquina, 'pc-a');
  } finally { m.limpar(); }
});

test('item inexistente e sem remoto recusam com motivo tipado', () => {
  const m = duasMaquinas('reservas-recusas');
  try {
    assert.throws(() => pegarItem(m.a, 'RM-999', A), /roadmap\.item: RM-999 nao existe em docs\/roadmap/);
    assert.throws(() => pegarItem(m.a, 'item-livre', A), /roadmap\.item: "item-livre" nao e um item do roadmap/);
    exec('git', ['remote', 'remove', 'origin'], m.b);
    assert.throws(() => pegarItem(m.b, 'RM-001', B), /roadmap\.sem-remoto/);
    assert.equal(listarReservas(m.b).atualizado, false);
  } finally { m.limpar(); }
});

test('ork thread new --roadmap reserva antes de criar, e a outra maquina nao cria thread no mesmo item', () => {
  const m = duasMaquinas('reservas-thread');
  try {
    const criada = ork(m.a, ['thread', 'new', 'contrato do item', '--modo', 'auto', '--roadmap', 'RM-001'], { ORK_MAQUINA: 'pc-a' });
    assert.equal(criada.status, 0, criada.stderr);
    assert.match(criada.stdout, /roadmap: RM-001 reservado para esta maquina \(pc-a\)/);
    const reserva = listarReservas(m.b).reservas[0];
    assert.equal(reserva.item, 'RM-001');
    assert.match(reserva.thread ?? '', /^ork-/);

    const recusada = ork(m.b, ['thread', 'new', 'mesmo item', '--modo', 'auto', '--roadmap', 'RM-001'], { ORK_MAQUINA: 'pc-b' });
    assert.notEqual(recusada.status, 0);
    assert.match(recusada.stderr, /roadmap\.reservado: RM-001 esta com Teste Orkastery em pc-a/);
    assert.equal(fs.existsSync(path.join(m.b, '.orkastery', 'threads')), false, 'nenhuma thread criada em B');

    const lista = ork(m.b, ['roadmap', 'reservas', '--json']);
    assert.equal(lista.status, 0, lista.stderr);
    assert.equal((JSON.parse(lista.stdout) as { reservas: unknown[] }).reservas.length, 1);
  } finally { m.limpar(); }
});

test('os textos para pessoas mostram o horario no fuso do dono, nunca ISO', () => {
  const reserva = { contrato: 'ork.roadmap-reserva/v1' as const, item: 'RM-042', por: 'Dono', maquina: 'pc-casa',
    thread: 'ork-exemplo', nota: null, desdeEm: '2026-09-27T12:30:00.000Z', atualizadaEm: '2026-09-27T12:30:00.000Z' };
  for (const texto of [painelEmMarkdown([reserva]), textoDasReservas({ reservas: [reserva], atualizado: true, ponta: null })]) {
    assert.doesNotMatch(texto, /\d{4}-\d{2}-\d{2}T/);
    assert.match(texto, /27\/09/);
  }
  assert.match(painelEmMarkdown([]), /Nenhum item reservado\./);
});
