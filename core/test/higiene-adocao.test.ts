import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { planejar, devolverVagas } from '../src/board';
import { avaliarOcupacao } from '../src/ocupacao';
import { comporPulse } from '../src/pulse';
import { montarMonitor } from '../src/orquestracao';
import { varrerSessoes } from '../src/hitl';
import { registrar, lerLedger } from '../src/ledger';

test('adoção não agenda GOAL nem ocupa vaga; pulse preserva HITL vivo e incerto, sem escalar história morta', () => {
  const p = projetoTemporario('higiene-adocao');
  try {
    const estados = ['failed', 'blocked', 'blocked', 'blocked', 'working', 'done', 'novo-estado'];
    const registros = estados.map((state, i) => {
      const t = novaThread(p.carregado, { nome: `registro${i}`, modo: 'auto' }).thread;
      t.sessoes.push({ origem: 'adocao', sessionId: `aaaaaaaa-${i}`, runtime: 'claude-bg',
        slug: t.slug, fase: 'GOAL', bloco: 'ad-hoc', adotadaEm: t.criadaEm, cwdOrigem: p.dir, verificada: true });
      if (i % 2 === 0) t.origem = 'adocao'; // Legados e novos usam a mesma regra.
      gravarThread(p.dir, t);
      return { t, state, sessionId: t.sessoes[0].sessionId, cwd: p.dir };
    });
    const real = novaThread(p.carregado, { nome: 'trabalho', modo: 'auto' }).thread;
    const snapshots = registros.map(({ t }) => ['thread.json', 'ledger.jsonl'].map(f =>
      fs.readFileSync(path.join(dirThread(p.dir, t.id), f))));
    const mapa = new Map(registros.map(r => [r.sessionId, r.state]));
    const quando = '2026-10-01T00:00:00Z';
    for (const estadosRuntime of [mapa, null]) {
      const plano = planejar(p.carregado, { estados: estadosRuntime, agora: quando });
      assert.deepEqual(plano.vagas.filter(v => v.situacao === 'pode-avancar').map(v => v.thread), [real.id]);
      assert.equal(plano.emAndamento, 0);
      for (const { t } of registros) {
        const vaga = plano.vagas.find(v => v.thread === t.id)!;
        assert.ok(!/phase run|master|gate approve/.test(vaga.correcao));
        assert.equal(avaliarOcupacao(t, lerLedger(dirThread(p.dir, t.id)), {
          estados: estadosRuntime, agora: quando, staleMin: 1 }).ocupaVaga, false);
      }
      assert.deepEqual(devolverVagas(p.carregado, { estados: estadosRuntime, agora: quando }), []);
    }
    const radar = varrerSessoes({ raiz: p.dir, semLogs: true, agora: quando,
      consulta: { ok: true, sessoes: registros, detalhe: '' } });
    const morta = radar.sessoes.find(s => s.sessionId === registros[1].sessionId)!;
    morta.jobVivo = false; morta.classe = 'abandonada';
    const viva = radar.sessoes.find(s => s.sessionId === registros[2].sessionId)!;
    viva.jobVivo = true; viva.pergunta = 'Autorizar operação?';
    const monitor = montarMonitor(p.carregado, { estados: mapa, agora: quando });
    const pulse = comporPulse(p.carregado, { radar, monitor, batch: [], orfas: [] });
    assert.equal(pulse.acoesAutomaticas.length, 0);
    assert.deepEqual(pulse.precisaDeHumanoAgora.map(i => i.thread).sort(),
      [registros[2].t.id, registros[3].t.id, registros[6].t.id].sort());
    assert.ok(pulse.precisaDeHumanoAgora.some(i => i.pergunta === 'Autorizar operação?'));
    registros.forEach(({ t }, i) => ['thread.json', 'ledger.jsonl'].forEach((f, j) =>
      assert.deepEqual(fs.readFileSync(path.join(dirThread(p.dir, t.id), f)), snapshots[i][j])));

    registrar(dirThread(p.dir, registros[0].t.id), registros[0].t.id, 'gate_blocked', {
      fase: 'GOAL', motivo: 'human.pending', detalhe: 'escalada explícita independente do histórico',
    });
    const escalada = comporPulse(p.carregado, { radar,
      monitor: montarMonitor(p.carregado, { estados: mapa, agora: quando }), batch: [], orfas: [] });
    assert.ok(escalada.precisaDeHumanoAgora.some(i => i.pergunta === 'escalada explícita independente do histórico'));
  } finally { p.limpar(); }
});
