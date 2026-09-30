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
import { listarReservas, pegarItem, PRAZO_DO_FECHAMENTO_MS, redeDoFechamento, reservasOrfas, soltarItem, soltarReservaDaThread, soltarReservasOrfas } from '../src/roadmap-reservas';
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

test('defeito 3 (A5 do CHECK 1): a soltura compara a thread; reserva que mudou de dono fica como esta', () => {
  const p = projetoComRoadmap('rm037noite-reserva-compara');
  try {
    const t = threadNoItem(p, 'dona', 'RM-001');
    const r = soltarItem(p.dir, 'RM-001', { threadEsperada: 'ork-outra' });
    assert.equal(r.acao, 'nada');
    assert.deepEqual(itens(p.dir), [['RM-001', t.id]]);
    assert.equal(pegarItem(p.dir, 'RM-001', { thread: 'ork-outra', threadEsperada: 'ork-terceira' }).acao, 'nada');
    assert.deepEqual(itens(p.dir), [['RM-001', t.id]]);
    assert.equal(soltarItem(p.dir, 'RM-001', { threadEsperada: t.id }).acao, 'soltou');
  } finally { p.limpar(); }
});

test('defeito 3 (A3 do CHECK 1): o fechamento nao fica parado na rede: prazo curto e git sem pergunta', () => {
  assert.equal(PRAZO_DO_FECHAMENTO_MS, 15000);
  const p = projetoComRoadmap('rm037noite-reserva-rede-lenta');
  try {
    const rede = redeDoFechamento(p.dir);
    assert.equal(rede.timeoutMs, 15000);
    assert.equal(rede.env?.GIT_TERMINAL_PROMPT, '0');
    if (!process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH) assert.equal(rede.env?.GIT_SSH_COMMAND, 'ssh -o BatchMode=yes');
    // Aviso N1 do CHECK 2: quem configurou o proprio ssh (varias contas, chave por repositorio) fica com ele.
    exec('git', ['config', 'core.sshCommand', 'ssh -i ~/.ssh/outra-conta'], p.dir);
    assert.equal(redeDoFechamento(p.dir).env?.GIT_SSH_COMMAND, undefined);
    assert.equal(redeDoFechamento(p.dir).env?.GIT_TERMINAL_PROMPT, '0');
    exec('git', ['config', '--unset', 'core.sshCommand'], p.dir);
    const t = threadNoItem(p, 'rede lenta', 'RM-001');
    const tt = lerThread(p.dir, t.id); tt.status = 'fechada'; gravarThread(p.dir, tt);
    // Um remoto ssh que nunca responde: o transporte e um `sleep` mais longo que o prazo.
    exec('git', ['remote', 'set-url', 'origin', 'ssh://git@exemplo.invalid/projeto.git'], p.dir);
    const inicio = Date.now();
    const r = soltarReservaDaThread(p.dir, t.id, { rede: { timeoutMs: 1500, env: { GIT_SSH_COMMAND: 'sleep 20' } } });
    assert.ok(Date.now() - inicio < 10000, `levou ${Date.now() - inicio} ms`);
    assert.deepEqual(r.map((x) => [x.item, x.acao]), [['RM-001', 'pendente']]);
  } finally { p.limpar(); }
});

test('defeito 3 (sugestoes 1 e 2 do CHECK 1): toda reserva da thread sai, e uma orfa que falha nao para as outras', () => {
  const p = projetoComRoadmap('rm037noite-reserva-varias');
  try {
    commitar(p.dir, 'docs/roadmap/RM-003-terceiro.md', '# RM-003\n', 'roadmap: RM-003');
    exec('git', ['push', '-q', 'origin', 'main'], p.dir);
    const t = novaThread(p.carregado, { nome: 'dois itens', modo: 'auto', roadmap: 'RM-001' }).thread;
    pegarItem(p.dir, 'RM-001', { thread: t.id });
    pegarItem(p.dir, 'RM-002', { thread: t.id });
    fecharAdministrativamente(p.dir, t.id, FECHAR);
    assert.deepEqual(itens(p.dir), [], 'as duas reservas da thread sairam');

    const velha = novaThread(p.carregado, { nome: 'fechada antes', modo: 'auto', roadmap: 'RM-002' }).thread;
    const sumiu = novaThread(p.carregado, { nome: 'item que saiu', modo: 'auto', roadmap: 'RM-003' }).thread;
    pegarItem(p.dir, 'RM-002', { thread: velha.id });
    pegarItem(p.dir, 'RM-003', { thread: sumiu.id });
    for (const id of [velha.id, sumiu.id]) { const x = lerThread(p.dir, id); x.status = 'fechada'; gravarThread(p.dir, x); }
    // O RM-003 sai do roadmap (arvore, main e origin/main): soltar recusa com roadmap.item.
    exec('git', ['rm', '-q', 'docs/roadmap/RM-003-terceiro.md'], p.dir);
    exec('git', ['commit', '-q', '-m', 'roadmap: RM-003 sai'], p.dir);
    exec('git', ['push', '-q', 'origin', 'main'], p.dir);
    const soltas = soltarReservasOrfas(p.dir);
    assert.deepEqual(soltas.map((x) => [x.item, x.acao]).sort(), [['RM-002', 'solta'], ['RM-003', 'pendente']]);
    assert.equal(lerLedger(dirThread(p.dir, sumiu.id)).find((e) => e.tipo === 'roadmap_reserva_pendente')?.item, 'RM-003');
  } finally { p.limpar(); }
});
