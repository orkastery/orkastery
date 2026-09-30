/**
 * RM-037 (rm037noite, defeito 3): RM-008, 043, 044, 046, 047 e 048 seguiam reservadas para threads
 * ja fechadas. Fechar a thread solta a reserva do item dela (ou a passa para outra thread aberta do
 * mesmo item), e o `ork roadmap reservas` marca e solta a orfa que ficou de antes, com registro.
 * Tudo e git de verdade contra um remoto bare temporario.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { commitar, projetoTemporario } from './apoio';
import { listarReservas, pegarItem, reservasOrfas, soltarReservasOrfas } from '../src/roadmap-reservas';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { fecharAdministrativamente } from '../src/thread-close';
import { exec } from '../src/util';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const FECHAR = { motivo: 'orfa', por: 'Julio', justificativa: 'thread abandonada no teste' };

function projetoComRoadmap(nome: string) {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, 'docs/roadmap/RM-001-primeiro.md', '# RM-001\n', 'roadmap: RM-001');
  commitar(p.dir, 'docs/roadmap/RM-002-segundo.md', '# RM-002\n', 'roadmap: RM-002');
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-q', '-m', 'manifesto do projeto'], p.dir);
  exec('git', ['push', '-q', 'origin', 'main'], p.dir);
  return p;
}

function threadNoItem(p: ReturnType<typeof projetoComRoadmap>, nome: string, item: string, reservar = true) {
  const t = novaThread(p.carregado, { nome, modo: 'auto', roadmap: item }).thread;
  if (reservar) pegarItem(p.dir, item, { thread: t.id });
  return t;
}

const itens = (dir: string) => listarReservas(dir).reservas.map((r) => [r.item, r.thread]);

test('defeito 3: thread close solta a reserva do item da thread, com registro no ledger', () => {
  const p = projetoComRoadmap('rm037noite-reserva-close');
  try {
    const t = threadNoItem(p, 'dona do item', 'RM-001');
    assert.deepEqual(itens(p.dir), [['RM-001', t.id]]);
    fecharAdministrativamente(p.dir, t.id, FECHAR);
    assert.deepEqual(itens(p.dir), [], 'a reserva saiu do remoto');
    const ev = lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'roadmap_reserva_liberada');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].item, 'RM-001');
    assert.equal(ev[0].acao, 'solta');
    assert.equal(ev[0].origem, 'fechamento');
    assert.match(String(ev[0].commit), /^[a-f0-9]{40}$/);
  } finally { p.limpar(); }
});

test('defeito 3: com outra thread aberta no mesmo item, a reserva passa para ela em vez de sair', () => {
  const p = projetoComRoadmap('rm037noite-reserva-sucessora');
  try {
    const primeira = threadNoItem(p, 'fatia 1', 'RM-002');
    const segunda = threadNoItem(p, 'fatia 2', 'RM-002', false);
    fecharAdministrativamente(p.dir, primeira.id, FECHAR);
    assert.deepEqual(itens(p.dir), [['RM-002', segunda.id]]);
    const ev = lerLedger(dirThread(p.dir, primeira.id)).find((e) => e.tipo === 'roadmap_reserva_liberada');
    assert.equal(ev?.acao, 'reapontada');
    assert.equal(ev?.para, segunda.id);
    fecharAdministrativamente(p.dir, segunda.id, FECHAR);
    assert.deepEqual(itens(p.dir), []);
  } finally { p.limpar(); }
});

test('defeito 3: sem rede o fechamento segue, a pendencia vai ao ledger e o --soltar-orfas resolve depois', () => {
  const p = projetoComRoadmap('rm037noite-reserva-sem-rede');
  try {
    const t = threadNoItem(p, 'fecha offline', 'RM-001');
    exec('git', ['remote', 'set-url', 'origin', path.join(p.dir, 'remoto-que-nao-existe')], p.dir);
    fecharAdministrativamente(p.dir, t.id, FECHAR);
    assert.equal(lerThread(p.dir, t.id).status, 'fechada', 'a falta de rede nao derruba o fechamento');
    const pendente = lerLedger(dirThread(p.dir, t.id)).find((e) => e.tipo === 'roadmap_reserva_pendente');
    assert.equal(pendente?.item, 'RM-001');
    assert.equal(pendente?.correcao, 'ork roadmap reservas --soltar-orfas');

    exec('git', ['remote', 'set-url', 'origin', p.remoto as string], p.dir);
    const orfas = reservasOrfas(p.dir, listarReservas(p.dir).reservas);
    assert.deepEqual(orfas.map((o) => [o.reserva.item, o.reserva.thread, o.sucessora]), [['RM-001', t.id, null]]);
    const texto = spawnSync(process.execPath, [CLI, 'roadmap', 'reservas'],
      { cwd: p.dir, encoding: 'utf8', env: { ...process.env, ORK_FABRICA_PUBLICAR: '0' } });
    assert.equal(texto.status, 0, texto.stderr);
    assert.match(texto.stdout, /RM-001 .* ÓRFÃ: thread fechada/);
    assert.match(texto.stdout, /Para soltar: ork roadmap reservas --soltar-orfas/);

    const soltas = soltarReservasOrfas(p.dir);
    assert.deepEqual(soltas.map((s) => [s.item, s.acao]), [['RM-001', 'solta']]);
    assert.deepEqual(itens(p.dir), []);
    const ev = lerLedger(dirThread(p.dir, t.id)).find((e) => e.tipo === 'roadmap_reserva_liberada');
    assert.equal(ev?.origem, 'orfas');
  } finally { p.limpar(); }
});

test('defeito 3: a orfa de antes (thread ja fechada, reserva viva) aparece e sai; a de outra maquina fica', () => {
  const p = projetoComRoadmap('rm037noite-reserva-antiga');
  try {
    const antiga = threadNoItem(p, 'fechada antes da correcao', 'RM-001');
    const alheia = novaThread(p.carregado, { nome: 'de outra maquina', modo: 'auto', roadmap: 'RM-002' }).thread;
    pegarItem(p.dir, 'RM-002', { thread: alheia.id, maquina: 'outra-maquina' });
    // Fechada pelo `ork` de antes: status gravado, reserva intocada.
    for (const id of [antiga.id, alheia.id]) { const t = lerThread(p.dir, id); t.status = 'fechada'; gravarThread(p.dir, t); }
    const orfas = reservasOrfas(p.dir, listarReservas(p.dir).reservas);
    assert.deepEqual(orfas.map((o) => o.reserva.item), ['RM-001'], 'a reserva de outra maquina nao e desta');
    const cli = spawnSync(process.execPath, [CLI, 'roadmap', 'reservas', '--soltar-orfas', '--json'],
      { cwd: p.dir, encoding: 'utf8', env: { ...process.env, ORK_FABRICA_PUBLICAR: '0' } });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout).map((s: { item: string; acao: string }) => [s.item, s.acao]), [['RM-001', 'solta']]);
    assert.deepEqual(itens(p.dir), [['RM-002', alheia.id]]);
  } finally { p.limpar(); }
});
