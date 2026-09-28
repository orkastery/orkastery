/**
 * I-36 (RM-036, P5): handoff explicito e recuperacao de conducao orfa.
 *
 * Em 19/09/2026 o unico jeito de destravar foi matar a sessao do outro canal por fora. Aqui o
 * handoff encerra a sessao pelo controle homologado do runtime, registra quem assumiu, de qual canal
 * e por que, e reserva a vez para esse canal. E a conducao sem dono vivo sai sozinha, com prova, sem
 * concluir fase nenhuma.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { assumirConducao, ControleDoHandoff, conducaoDaThread, liberarSeOrfa, nomeDaConducao, tomarConducao } from '../src/conducao';
import { lerLease, regravarLease } from '../src/leases';
import { lerLedger } from '../src/ledger';
import { nomeDaMaquina } from '../src/maquina';
import { rodarFase } from '../src/phase';
import { dirThread, novaThread } from '../src/thread';
import { projetoTemporario, runtimeFalso } from './apoio';

/** Controle simulado do runtime: a sessao trabalha ate receber o pedido de parar. */
function controleSimulado(): { controle: ControleDoHandoff; parou: () => boolean } {
  let parada = false;
  return {
    controle: (_runtime, _raiz, _thread, sessionId) => ({
      consultar: () => ({ ok: true, sessoes: [{ sessionId, estado: parada ? 'stopped' : 'working' }] }),
      parar: () => { parada = true; return true; },
    }),
    parou: () => parada,
  };
}

test('assumir encerra pelo runtime, registra quem, de qual canal e por que, e reserva a vez para o canal (T15, CS8)', (t) => {
  const p = projetoTemporario('conducao-assumir');
  const runtime = runtimeFalso('conducao-assumir');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'assumir', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  const simulado = controleSimulado();
  const r = assumirConducao(p.dir, thread.id, { por: 'julio', motivo: 'retomar pelo terminal', canal: 'claude-code',
    controle: simulado.controle });
  assert.equal(r.ok, true, r.detalhe);
  assert.equal(simulado.parou(), true, 'a sessao foi encerrada pelo controle do runtime, nao por sinal');
  assert.equal(r.anterior?.canal, 'hermes');
  const evento = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'conducao_assumida')!;
  assert.equal(evento.por, 'julio');
  assert.equal(evento.canal, 'claude-code');
  assert.equal(evento.motivo, 'retomar pelo terminal');
  assert.equal((evento.anterior as { canal: string; fase: string }).canal, 'hermes');
  assert.equal((evento.anterior as { canal: string; fase: string }).fase, 'GO');
  assert.match(String(evento.mecanismo), /parar pelo runtime claude-bg/);
  assert.ok((evento.worktree as { head: string | null }).head, 'o estado da worktree vai junto para quem assume');
  // A reserva segura a vez para o canal de quem assumiu.
  const reserva = conducaoDaThread(p.dir, thread.id)!;
  assert.equal(reserva.dono.tipo, 'reserva');
  assert.equal(reserva.canal, 'claude-code');
  runtime.estadoDaSessao('done');
  const deOutro = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'outro pedido', canal: 'hermes' });
  assert.equal(deOutro.motivo, 'conducao.em-andamento', 'outro canal nao passa na frente de quem assumiu');
  const doMesmo = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'continue daqui', canal: 'claude-code' });
  assert.equal(doMesmo.bloqueado, false, doMesmo.erro);
  assert.equal(conducaoDaThread(p.dir, thread.id)?.canal, 'claude-code');
});

test('assumir sem motivo e recusado, e processo local vivo nao recebe sinal (D8)', async () => {
  const p = projetoTemporario('conducao-assumir-processo');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'processo', modo: 'auto' });
    assert.throws(() => assumirConducao(p.dir, thread.id, { por: 'julio', motivo: ' ', canal: 'cli' }), /--motivo/);
    // Um processo vivo segura a conducao: o handoff recusa e o processo continua de pe.
    const modulo = path.resolve(__dirname, '../src/conducao.js');
    const filho = spawn(process.execPath, ['-e', `
      const c = require(${JSON.stringify(modulo)});
      const t = c.tomarConducao(${JSON.stringify(p.dir)}, ${JSON.stringify(thread.id)}, { canal: 'cli', operacao: 'verify', prazoMs: 60000 });
      if (!t.ok) process.exit(2);
      process.stdout.write('tomou\\n');
      setTimeout(() => { t.liberar(); process.exit(0); }, 3000);
    `], { stdio: ['ignore', 'pipe', 'inherit'] });
    await once(filho.stdout, 'data');
    const r = assumirConducao(p.dir, thread.id, { por: 'julio', motivo: 'destravar', canal: 'claude-code' });
    assert.equal(r.ok, false);
    assert.match(r.detalhe, /nao envia sinal/);
    assert.equal(filho.exitCode, null, 'o processo seguiu vivo');
    const [codigo] = await once(filho, 'exit');
    assert.equal(codigo, 0);
    assert.equal(conducaoDaThread(p.dir, thread.id), null);
  } finally { p.limpar(); }
});

test('conducao orfa sai com evento tipado e prova, sem intervencao, e nunca conclui fase (T16, CS9)', () => {
  const p = projetoTemporario('conducao-orfa');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'orfa', modo: 'auto' });
    const lease = {
      nome: nomeDaConducao(thread.id), thread: thread.id, motivo: 'ork verify pelo canal hermes', pid: 999_999_999,
      adquiridoEm: new Date(Date.now() - 60_000).toISOString(), expiraEm: new Date(Date.now() + 3_600_000).toISOString(),
      conducao: { contrato: 'ork.conducao/v1' as const, canal: 'hermes' as const, correlacao: null, operacao: 'verify' as const, fase: null,
        promptSha256: null, identidade: '00000000-0000-4000-8000-000000000000',
        dono: { tipo: 'processo' as const, pid: 999_999_999, inicio: '1', bootId: 'boot-anterior', maquina: nomeDaMaquina() } },
    };
    regravarLease(p.dir, lease);
    const r = liberarSeOrfa(p.dir, thread.id);
    assert.equal(r.liberada, true, r.detalhe);
    assert.equal(lerLease(p.dir, nomeDaConducao(thread.id)), null);
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    const orfa = eventos.find((e) => e.tipo === 'conducao_orfa_liberada')!;
    assert.equal(orfa.motivo, 'processo-morto');
    assert.match(String(orfa.prova), /trava do kernel livre/);
    assert.equal((orfa.anterior as { canal: string }).canal, 'hermes');
    assert.equal(eventos.some((e) => e.tipo === 'phase_result' || e.classificacao === 'fase_concluida'), false,
      'a liberacao nao grava resultado de fase: so a prova da I-34 conclui');
    // A tomada seguinte tambem recupera sozinha, sem ninguem chamar nada antes.
    regravarLease(p.dir, lease);
    const t = tomarConducao(p.dir, thread.id, { canal: 'cli', operacao: 'verify', prazoMs: 60_000 });
    assert.equal(t.ok, true);
    if (t.ok) t.liberar();
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'conducao_orfa_liberada').length, 2);
  } finally { p.limpar(); }
});
