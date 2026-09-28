/**
 * I-45: pulse enxuto. Em 24/09/2026 a varredura levou 9 min 30 s contra um teto de 240 s, e a fila
 * tinha 92 itens "precisa de humano agora", dos quais 2 eram do dono. Estes testes fixam as tres
 * pecas da correcao: o cache das sessoes encerradas, o orcamento de telas e as faixas da fila.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerSessoesEncerradas, varrerSessoes } from '../src/hitl';
import { rodarFase } from '../src/phase';
import { comporPulse } from '../src/pulse';
import { montarMonitor } from '../src/orquestracao';
import { novaThread, gravarThread, dirThread, lerThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { SessaoDaThread } from '../src/types';
import { commitar, projetoTemporario, runtimeFalso } from './apoio';

function projetoComSessao(nome: string) {
  const runtime = runtimeFalso(nome);
  const p = projetoTemporario(nome);
  const { thread } = novaThread(p.carregado, { nome: 'radar enxuto', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: 'trabalhe' });
  return { runtime, p, thread, limpar: () => { runtime.restaurar(); p.limpar(); } };
}

test('I-45: sessão com job ausente de thread fechada vai para o cache e não paga outra leitura', (t) => {
  const { runtime, p, thread, limpar } = projetoComSessao('pulse-enxuto-cache');
  t.after(limpar);
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(null); // o stub responde "job not found", como o runtime real
  // O runtime real informa um inicio fixo por instancia; o stub, sem isto, informa o relogio.
  fs.writeFileSync(path.join(runtime.dir, 'started'), '1790000000000');

  // Thread aberta: a sessao pode ser retomada, entao nada entra no cache.
  assert.equal(varrerSessoes({ raiz: p.dir }).sessoes[0].classe, 'abandonada');
  assert.equal(lerSessoesEncerradas(p.dir).size, 0);

  const fechada = lerThread(p.dir, thread.id);
  fechada.status = 'fechada';
  gravarThread(p.dir, fechada);
  const primeiro = varrerSessoes({ raiz: p.dir });
  assert.equal(primeiro.sessoes[0].classe, 'abandonada');
  assert.ok([...lerSessoesEncerradas(p.dir).keys()].some(k => k.startsWith(`${runtime.sessionId}|`)), 'o fato negativo e gravado na hora');

  // Se a tela fosse lida de novo, agora ela mostraria uma pergunta viva. Job ausente nao volta.
  runtime.telaDaSessao('Do you want to proceed?\n❯ 1. Yes\n  2. No');
  const segundo = varrerSessoes({ raiz: p.dir });
  assert.equal(segundo.sessoes[0].classe, 'abandonada');
  assert.equal(segundo.sessoes[0].jobVivo, false);
  assert.match(segundo.sessoes[0].detalhe, /job ausente ja confirmado numa varredura anterior/);
});

test('I-45: orçamento de telas esgotado adia a leitura sem esconder a sessão nem gravar cache', (t) => {
  const { runtime, p, limpar } = projetoComSessao('pulse-enxuto-orcamento');
  t.after(limpar);
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(null);

  const r = varrerSessoes({ raiz: p.dir, orcamentoLogsMs: -1 });
  assert.equal(r.telasAdiadas, 1);
  assert.equal(r.sessoes[0].classe, 'hitl', 'sem ler a tela, continua um HITL possivel');
  assert.equal(r.sessoes[0].jobVivo, null);
  assert.equal(r.sessoes[0].precisaDeHumano, true);
  assert.equal(lerSessoesEncerradas(p.dir).size, 0, 'nada foi confirmado, nada entra no cache');
});

test('I-45: a fila só pede o dono quando alguém pode receber a resposta', () => {
  const p = projetoTemporario('pulse-enxuto-faixas');
  try {
    const sessao = (sessionId: string, fase: 'GO' | 'SHIP') => ({ sessionId, runtime: 'claude-bg', slug: 'x', fase,
      bloco: 'full', verificada: true, despachadaEm: '2026-09-20T12:00:00Z', promptPath: 'p', promptSha256: 's' } as SessaoDaThread);
    const aberta = novaThread(p.carregado, { nome: 'aberta', modo: 'auto' }).thread;
    aberta.sessoes.push(sessao('a1a1a1a1-0000-0000-0000-000000000001', 'GO'),
      sessao('a2a2a2a2-0000-0000-0000-000000000002', 'GO'), sessao('a3a3a3a3-0000-0000-0000-000000000003', 'GO'));
    gravarThread(p.dir, aberta);
    const fechada = novaThread(p.carregado, { nome: 'fechada', modo: 'auto' }).thread;
    fechada.sessoes.push(sessao('f1f1f1f1-0000-0000-0000-000000000001', 'GO'), sessao('f2f2f2f2-0000-0000-0000-000000000002', 'GO'));
    fechada.status = 'fechada';
    gravarThread(p.dir, fechada);

    const estados: Record<string, string> = {
      'a1a1a1a1-0000-0000-0000-000000000001': 'blocked', // morta (marcada abaixo)
      'a2a2a2a2-0000-0000-0000-000000000002': 'failed', // terminal
      'a3a3a3a3-0000-0000-0000-000000000003': 'novo-estado', // incerta
      'f1f1f1f1-0000-0000-0000-000000000001': 'novo-estado',
      'f2f2f2f2-0000-0000-0000-000000000002': 'blocked',
      'n1n1n1n1-0000-0000-0000-000000000001': 'blocked', // sem thread, morta
      'n2n2n2n2-0000-0000-0000-000000000002': 'blocked', // sem thread, viva com pergunta
      'n3n3n3n3-0000-0000-0000-000000000003': 'failed', // sem thread, terminal
      'n4n4n4n4-0000-0000-0000-000000000004': 'blocked', // sem thread, tela nao lida: incerta, visivel
    };
    const sessoes = Object.entries(estados).map(([sessionId, state]) => ({ sessionId, id: sessionId.slice(0, 8),
      kind: 'background', name: sessionId.slice(0, 8), state, cwd: p.dir, startedAt: Date.parse('2026-09-20T12:00:00Z') }));
    const radar = varrerSessoes({ raiz: p.dir, semLogs: true, agora: '2026-09-25T00:00:00Z', consulta: { ok: true, sessoes, detalhe: '' } });
    const por = (prefixo: string) => radar.sessoes.find(s => s.sessionId.startsWith(prefixo))!;
    for (const morta of ['a1a1', 'f2f2', 'n1n1']) { por(morta).jobVivo = false; por(morta).classe = 'abandonada'; }
    por('n2n2').jobVivo = true; por('n2n2').pergunta = 'Autorizar operação?';

    registrar(dirThread(p.dir, aberta.id), aberta.id, 'gate_blocked', { fase: 'SHIP', motivo: 'vaga.stale', detalhe: 'vaga parada' });
    const monitor = montarMonitor(p.carregado, { agora: '2026-09-25T00:00:00Z' });
    const pulse = comporPulse(p.carregado, { radar, monitor, batch: [], orfas: [] });

    const ids = (itens: { sessionId: string | null; motivo: string }[]) =>
      itens.map(i => i.sessionId ? i.sessionId.slice(0, 4) : i.motivo).sort();
    assert.deepEqual(ids(pulse.precisaDeHumanoAgora), ['a3a3', 'n2n2', 'n4n4'], 'viva, incerta em thread aberta ou incerta sem thread');
    assert.deepEqual(ids(pulse.acoesAutomaticas), ['a1a1', 'a2a2', 'vaga.stale'], 'morta ou terminal em thread aberta, e vaga parada');
    assert.equal(lerThread(p.dir, fechada.id).status, 'fechada');
  } finally { p.limpar(); }
});

test('I-45: verificação reprovada de thread já mesclada na base não fica com o dono', () => {
  const p = projetoTemporario('pulse-enxuto-mesclada');
  try {
    const mesclada = novaThread(p.carregado, { nome: 'mesclada', modo: 'auto' }).thread;
    const pendente = novaThread(p.carregado, { nome: 'pendente', modo: 'auto' }).thread;
    for (const t of [mesclada, pendente]) {
      registrar(dirThread(p.dir, t.id), t.id, 'gate_blocked', { fase: 'CHECK', motivo: 'claims.failed', detalhe: 'C1 reprovou' });
    }
    commitar(p.dir, 'entrega.txt', 'x\n', `ship(${mesclada.id}): merge de ork/${mesclada.id}-full em main`);
    const monitor = montarMonitor(p.carregado, { agora: '2026-09-25T00:00:00Z' });
    const radar = varrerSessoes({ raiz: p.dir, semLogs: true, agora: '2026-09-25T00:00:00Z', consulta: { ok: true, sessoes: [], detalhe: '' } });
    const pulse = comporPulse(p.carregado, { radar, monitor, batch: [], orfas: [] });
    assert.deepEqual(pulse.precisaDeHumanoAgora.filter(i => i.motivo === 'claims.failed').map(i => i.thread), [pendente.id]);
  } finally { p.limpar(); }
});
