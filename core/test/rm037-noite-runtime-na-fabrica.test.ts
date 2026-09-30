/**
 * RM-037 (rm037noite, defeito 4): o `ork/fabrica-estado` mostrava maquina, fase e item, mas nao o
 * runtime nem o modelo de cada thread, e o dono pediu isso no status. O retrato passa a levar o trio
 * do ultimo `phase_dispatch` (runtime, modelo e esforco), e o texto, o `FABRICA.md` e o panorama da
 * rede mostram. Retrato publicado antes, sem os campos, continua valido.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { despachoDaThread, estadoValido, painelDaFabricaEmMarkdown, retratoDaMaquina, runtimeDaThread, textoDaFabrica,
  EstadoDaMaquina } from '../src/fabrica-estado';
import { registrar } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { montarPanoramaDaRede, textoDoPanoramaDaRede } from '../src/network-roadmap';

test('defeito 4: o retrato leva runtime, modelo e esforco do ultimo despacho de cada thread', () => {
  const p = projetoTemporario('rm037noite-fabrica-runtime');
  try {
    const despachada = novaThread(p.carregado, { nome: 'despachada', modo: 'auto' }).thread;
    const nova = novaThread(p.carregado, { nome: 'sem despacho', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, despachada.id);
    registrar(dir, despachada.id, 'phase_dispatch', { fase: 'GOAL', runtime: 'codex', model: 'gpt-5.5', effort: 'high' });
    // O ultimo despacho e o que vale: o GO saiu no claude-bg.
    registrar(dir, despachada.id, 'phase_dispatch', { fase: 'GO', runtime: 'claude-bg', model: 'opus', effort: 'xhigh' });

    const retrato = retratoDaMaquina(p.carregado, { maquina: 'vps', agora: '2026-09-30T03:00:00.000Z' });
    const porId = new Map(retrato.threads.map((t) => [t.id, t]));
    assert.deepEqual([porId.get(despachada.id)?.runtime, porId.get(despachada.id)?.modelo, porId.get(despachada.id)?.esforco],
      ['claude-bg', 'opus', 'xhigh']);
    assert.deepEqual([porId.get(nova.id)?.runtime, porId.get(nova.id)?.modelo, porId.get(nova.id)?.esforco], [null, null, null]);
    assert.equal(estadoValido(retrato), true);

    const texto = textoDaFabrica({ maquinas: [retrato], atualizado: true, ponta: null }, 'vps');
    assert.match(texto, /THREAD\s+MODO\s+FASE\s+RUNTIME\s+ITEM/);
    assert.match(texto, new RegExp(`${despachada.id}\\s+#Auto\\s+GOAL\\s+claude-bg opus/xhigh`));
    assert.match(texto, new RegExp(`${nova.id}\\s+#Auto\\s+GOAL\\s+-\\s`));

    const md = painelDaFabricaEmMarkdown([retrato]);
    assert.match(md, /\| Máquina \| Thread \| Modo \| Fase \| Runtime \| Item \|/);
    assert.match(md, new RegExp(`\\| vps \\| ${despachada.id} \\| #Auto \\| GOAL \\| claude-bg opus/xhigh \\|`));
    assert.match(md, new RegExp(`\\| vps \\| ${nova.id} \\| #Auto \\| GOAL \\| sem despacho \\|`));
    assert.match(painelDaFabricaEmMarkdown([{ ...retrato, threads: [] }]), /\| . \| nenhuma thread ativa \| . \| . \|  \| . \| . \| . \|/);
  } finally { p.limpar(); }
});

test('defeito 4: retrato antigo, sem os campos, continua valido e aparece sem runtime', () => {
  const antigo: EstadoDaMaquina = {
    contrato: 'ork.fabrica-maquina/v1', maquina: 'srv', por: 'Julio', projeto: 'orkastery', versaoOrk: '0.4.3',
    publicadoEm: '2026-09-29T23:39:00.000Z',
    threads: [{ id: 'ork-antiga', nome: 'antiga', modo: '#Auto', fase: 'GO', status: 'aberta', roadmap: 'RM-055', branch: null,
      atualizadaEm: null, entregue: null, esperaVoce: false, pergunta: null, paradaDesde: null }],
  };
  assert.equal(estadoValido(antigo), true);
  assert.equal(runtimeDaThread(antigo.threads[0]), '-');
  assert.match(textoDaFabrica({ maquinas: [antigo], atualizado: true, ponta: null }, 'vps'), /ork-antiga\s+#Auto\s+GO\s+-\s+RM-055/);
});

test('defeito 4: ledger sem despacho ou ilegivel da tudo null, nunca um runtime inventado', () => {
  const p = projetoTemporario('rm037noite-fabrica-sem-ledger');
  try {
    assert.deepEqual(despachoDaThread(dirThread(p.dir, 'ork-inexistente')), { runtime: null, modelo: null, esforco: null });
    const t = novaThread(p.carregado, { nome: 'so criada', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { fase: 'GOAL', runtime: '', model: 42 });
    assert.deepEqual(despachoDaThread(dirThread(p.dir, t.id)), { runtime: null, modelo: null, esforco: null });
  } finally { p.limpar(); }
});

test('defeito 4: o panorama da rede mostra o runtime e o modelo na linha da thread', () => {
  const p = projetoTemporario('rm037noite-rede-runtime', true);
  const registro = path.join(dirTemporario('rm037noite-rede-usuario'), 'projetos.json');
  try {
    const t = novaThread(p.carregado, { nome: 'na rede', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { fase: 'GOAL', runtime: 'claude-bg', model: 'opus', effort: 'xhigh' });
    const panorama = montarPanoramaDaRede({ cwd: p.dir, quando: '2026-09-30T03:00:00.000Z', maquina: 'pc-a', registro });
    const ativas = panorama.projetos[0].maquinas?.flatMap((m) => m.ativas) ?? [];
    assert.equal(ativas.find((x) => x.id === t.id)?.modelo, 'opus');
    assert.match(textoDoPanoramaDaRede(panorama), new RegExp(`${t.id} · #Auto · GOAL · sem item · claude-bg opus/xhigh`));
  } finally {
    p.limpar();
    fs.rmSync(path.dirname(registro), { recursive: true, force: true });
  }
});
