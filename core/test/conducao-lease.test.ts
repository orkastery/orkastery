/**
 * I-36 (RM-036, P1 e P3): o lease de execucao `exec:<thread>`, a leitura unica de quem conduz, o
 * prazo derivado da operacao com renovacao provada, e o registro fechado de canais.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import {
  caminhoLease, dirLeasesDeExecucao, FAMILIAS_DE_LEASE, leasesColidem, lerLease, listarLeases, nomeDeLease, regravarLease, tipoDoLease,
} from '../src/leases';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { POLITICA_DE_RETRY } from '../src/retry';
import {
  CANAIS_DE_CONDUCAO, canalDoProcesso, conducaoDaThread, ERRO_CANAL_DESCONHECIDO, MARGEM_DO_PRAZO_MS, nomeDaConducao,
  prazoDaVerificacao, tomarConducao, validarCanal,
} from '../src/conducao';
import { lerLedger } from '../src/ledger';
import { nomeDaMaquina } from '../src/maquina';
import { dirThread, novaThread } from '../src/thread';
import { CanalDeConducao, Lease } from '../src/types';
import { projetoTemporario } from './apoio';

test('a familia exec tem nome canonico, colide so dentro dela, e o motivo tipado existe no gate e no retry', () => {
  assert.equal(nomeDeLease('exec', 'ork-x'), 'exec:ork-x');
  assert.equal(nomeDaConducao('ork-x'), 'exec:ork-x');
  assert.equal(tipoDoLease('exec:ork-x'), 'exec');
  assert.match(FAMILIAS_DE_LEASE.exec, /EXECUCAO/);
  assert.equal(leasesColidem('exec:ork-x', 'exec:ork-x'), true);
  assert.equal(leasesColidem('exec:ork-x', 'exec:ork-y'), false);
  assert.equal(leasesColidem('exec:ork-x', 'worktree-write:ork-x'), false, 'execucao e escrita sao dois recursos (D1)');
  assert.match(DESCRICAO_DO_MOTIVO['conducao.em-andamento'], /esperar, acompanhar, assumir/);
  assert.equal(POLITICA_DE_RETRY['conducao.em-andamento'].acao, 'esperar-janela');
  assert.equal(POLITICA_DE_RETRY['conducao.em-andamento'].automatica, true);
});

test('sem lease a leitura e null; com lease ativo, o objeto completo; liberado, null de novo', () => {
  const p = projetoTemporario('conducao-leitura');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'leitura', modo: 'auto' });
    assert.equal(conducaoDaThread(p.dir, thread.id), null);
    const t = tomarConducao(p.dir, thread.id, { canal: 'hermes', correlacao: 'telegram:1:2', operacao: 'verify', prazoMs: 60_000 });
    assert.equal(t.ok, true);
    const c = conducaoDaThread(p.dir, thread.id);
    assert.ok(c);
    assert.equal(c.canal, 'hermes');
    assert.equal(c.operacao, 'verify');
    assert.equal(c.sessao, null);
    assert.equal(c.dono.tipo, 'processo');
    assert.equal(c.thread, thread.id);
    assert.ok(fs.existsSync(caminhoLease(p.dir, nomeDaConducao(thread.id))));
    assert.equal(caminhoLease(p.dir, nomeDaConducao(thread.id)).startsWith(dirLeasesDeExecucao(p.dir)), true);
    assert.ok(listarLeases(p.dir).some((l) => l.nome === nomeDaConducao(thread.id)), 'aparece no `ork lease list`');
    if (t.ok) t.liberar();
    assert.equal(conducaoDaThread(p.dir, thread.id), null);
    assert.equal(lerLease(p.dir, nomeDaConducao(thread.id)), null);
  } finally { p.limpar(); }
});

test('prazo vencido nao e prova (D7): dono vivo segue conduzindo; dono morto sai da leitura', () => {
  const p = projetoTemporario('conducao-prazo');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'prazo', modo: 'auto' });
    const t = tomarConducao(p.dir, thread.id, { canal: 'cli', operacao: 'verify', prazoMs: -60_000 });
    assert.equal(t.ok, true);
    assert.ok(conducaoDaThread(p.dir, thread.id), 'a trava do kernel ainda e deste processo: a conducao vale mesmo vencida');
    if (t.ok) t.liberar();
    // Dono que nao segura a trava (morreu, ou a maquina reiniciou): sai da leitura.
    const morto: Lease = {
      nome: nomeDaConducao(thread.id), thread: thread.id, motivo: 'ork verify pelo canal cli', pid: 999_999_999,
      adquiridoEm: new Date().toISOString(), expiraEm: new Date(Date.now() + 3_600_000).toISOString(),
      conducao: { contrato: 'ork.conducao/v1', canal: 'cli', correlacao: null, operacao: 'verify', fase: null, promptSha256: null,
        identidade: '00000000-0000-4000-8000-000000000000',
        dono: { tipo: 'processo', pid: 999_999_999, inicio: '1', bootId: 'outro-boot', maquina: nomeDaMaquina() } },
    };
    regravarLease(p.dir, morto);
    assert.equal(conducaoDaThread(p.dir, thread.id), null, 'trava livre prova que o dono nao existe mais');
  } finally { p.limpar(); }
});

test('o prazo vem do teto da operacao e e renovado com a operacao viva, com evento, sem perder o lease (D3)', () => {
  assert.equal(prazoDaVerificacao(600_000, 3), 3 * 600_000 + MARGEM_DO_PRAZO_MS);
  const p = projetoTemporario('conducao-renova');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'renova', modo: 'auto' });
    const inicio = Date.now();
    const t = tomarConducao(p.dir, thread.id, { canal: 'cli', operacao: 'verify', prazoMs: 60_000 });
    assert.equal(t.ok, true);
    if (!t.ok) return;
    // Um comando de verify de 10 min comecando 11 min depois: o que falta nao cobre, renova.
    const onzeMin = inicio + 11 * 60_000;
    t.renovar(10 * 60_000, onzeMin);
    const lease = lerLease(p.dir, nomeDaConducao(thread.id))!;
    assert.ok(Date.parse(lease.expiraEm) >= onzeMin + 10 * 60_000, 'o prazo cobre o proximo comando inteiro');
    assert.equal(lease.conducao?.renovacoes, 1);
    // Com folga suficiente, nao renova e nao grava nada.
    t.renovar(60_000, onzeMin + 1000);
    const renovacoes = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'conducao_renovada');
    assert.equal(renovacoes.length, 1);
    assert.equal(renovacoes[0].canal, 'cli');
    assert.ok(conducaoDaThread(p.dir, thread.id), 'renovar nao solta a conducao');
    t.liberar();
  } finally { p.limpar(); }
});

test('o registro de canais e fechado: os seis canais, e canal fora dele e recusado com motivo tipado', () => {
  // Exaustividade em tempo de compilacao: canal novo no tipo sem entrada aqui nao compila.
  const todos: Record<CanalDeConducao, true> = { 'claude-code': true, hermes: true, openclaw: true, codex: true, mcp: true, cli: true };
  assert.deepEqual(Object.keys(CANAIS_DE_CONDUCAO).sort(), Object.keys(todos).sort());
  assert.throws(() => validarCanal('telegram'), new RegExp(ERRO_CANAL_DESCONHECIDO));
  assert.equal(canalDoProcesso(undefined, {}), 'cli');
  assert.equal(canalDoProcesso(undefined, { ORK_CANAL: 'openclaw' }), 'openclaw');
  assert.equal(canalDoProcesso(undefined, { CLAUDECODE: '1' }), 'claude-code');
  assert.equal(canalDoProcesso(undefined, { HERMES_HOME: '/srv/hermes' }), 'hermes');
  assert.equal(canalDoProcesso('codex', { ORK_CANAL: 'hermes' }), 'codex', '--canal vence o ambiente');
  assert.throws(() => canalDoProcesso(undefined, { ORK_CANAL: 'zap' }), /conducao\.canal-desconhecido/);
});
