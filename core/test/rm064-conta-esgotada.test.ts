import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { reconciliarContaEsgotada } from '../src/conta-esgotada';
import { InventarioDeSessoes } from '../src/sessoes-inventario';

const S1 = '11111111-2222-3333-4444-555555555555';
const S2 = '22222222-3333-4444-5555-666666666666';
const EM = '2026-10-14T15:00:00.000Z';

test('RM-064 T2: evento da conta encerra e libera todas as sessões vinculadas em projetos registrados, uma vez', () => {
  const a = projetoTemporario('rm064-conta-a'), b = projetoTemporario('rm064-conta-b');
  const configDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'ork-rm064-conta-'));
  const perfilA = { id: 'claude-a', runtime: 'claude-bg' as const, configDir };
  const perfilB = { id: 'trabalho', runtime: 'claude-bg' as const, configDir };
  try {
    const criar = (p: typeof a, sessionId: string, perfil: typeof perfilA) => {
      const t = novaThread(p.carregado, { nome: `quota-${sessionId.slice(0, 4)}`, modo: 'auto' }).thread;
      t.faseAtual = 'CHECK';
      t.sessoes.push({ slug: t.slug, fase: 'CHECK', bloco: 'full', sessionId, runtime: 'claude-bg',
        despachadaEm: EM, promptPath: 'prompt.md', promptSha256: 'a'.repeat(64), verificada: true });
      gravarThread(p.dir, t);
      registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { fase: 'CHECK', sessionId, runtime: 'claude-bg',
        despachoEm: EM, promptPath: 'prompt.md', promptSha256: 'a'.repeat(64), perfil });
      return t;
    };
    const t1 = criar(a, S1, perfilA), t2 = criar(b, S2, perfilB);
    const inventario: InventarioDeSessoes = { ok: true, escopo: { usuario: 'fixture', global: true, historico: true, raiz: a.dir },
      fontes: [], sessoes: [S1, S2].map((sessionId) => ({ sessionId, id: sessionId.slice(0, 8), cwd: a.dir,
        runtime: 'claude-bg' as const, perfil: 'claude-a', fantasma: false, viva: true, vinculos: [] })),
      total: 2, semThread: 0, ambiguas: 0, fantasmas: 0 };
    const paradas: string[] = [];
    const deps = { inventario: () => inventario, projetos: () => [a.dir, b.dir],
      parar: (sessionId: string) => { paradas.push(sessionId); return { ok: true, detalhe: 'stub confirmou' }; } };
    const entrada = { raiz: a.dir, perfil: perfilA,
      falha: { motivo: 'runtime.quota-exhausted' as const, resetEm: '2026-10-19T01:00:00.000Z', fonte: 'relogio' as const,
        trecho: 'limite semanal' }, esgotadoAte: '2026-10-19T01:00:00.000Z', erroEm: EM, agoraMs: Date.parse(EM) };
    const primeira = reconciliarContaEsgotada(entrada, deps);
    const segunda = reconciliarContaEsgotada(entrada, deps);
    assert.equal(primeira.sessoes.length, 2);
    assert.equal(primeira.completo, true);
    assert.deepEqual(paradas, [S1, S2], 'repetir o mesmo episódio não pede nova parada ao runtime');
    for (const [p, t, s] of [[a, t1, S1], [b, t2, S2]] as const) {
      const eventos = lerLedger(dirThread(p.dir, t.id));
      assert.equal(eventos.filter((e) => e.tipo === 'runtime_account_exhausted').length, 1);
      assert.equal(eventos.filter((e) => e.tipo === 'gate_blocked' && e.motivo === 'runtime.quota-exhausted').length, 1);
      assert.equal(eventos.filter((e) => e.tipo === 'phase_result' && e.sessionId === s).length, 1);
      assert.equal(eventos.find((e) => e.tipo === 'phase_result')?.paradaConfirmada, true);
    }
    assert.ok(segunda.sessoes.every((s) => !s.registrada));
  } finally { a.limpar(); b.limpar(); fs.rmSync(configDir, { recursive: true, force: true }); }
});

test('RM-064 T2: parada não comprovada não libera condução nem abre redespacho', () => {
  const p = projetoTemporario('rm064-conta-falha');
  const configDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'ork-rm064-conta-'));
  const perfil = { id: 'claude-a', runtime: 'claude-bg' as const, configDir };
  try {
    const t = novaThread(p.carregado, { nome: 'quota-falha', modo: 'auto' }).thread;
    t.sessoes.push({ slug: t.slug, fase: 'GO', bloco: 'full', sessionId: S1, runtime: 'claude-bg', despachadaEm: EM,
      promptPath: 'prompt.md', promptSha256: 'a'.repeat(64), verificada: true });
    gravarThread(p.dir, t);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { fase: 'GO', sessionId: S1, runtime: 'claude-bg',
      despachoEm: EM, promptPath: 'prompt.md', promptSha256: 'a'.repeat(64), perfil });
    const inventario = { ok: true, escopo: { usuario: 'fixture', global: true, historico: true, raiz: p.dir }, fontes: [],
      sessoes: [{ sessionId: S1, cwd: p.dir, runtime: 'claude-bg' as const, perfil: 'claude-a', fantasma: false, viva: true, vinculos: [] }],
      total: 1, semThread: 0, ambiguas: 0, fantasmas: 0 } satisfies InventarioDeSessoes;
    const r = reconciliarContaEsgotada({ raiz: p.dir, perfil,
      falha: { motivo: 'runtime.quota-exhausted', resetEm: null, fonte: 'sem-horario', trecho: 'limite' },
      esgotadoAte: '2026-10-15T15:00:00.000Z', erroEm: EM },
    { inventario: () => inventario, projetos: () => [p.dir], parar: () => ({ ok: false, detalhe: 'stub recusou' }) });
    assert.equal(r.completo, false);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some((e) => e.tipo === 'phase_result'), false);
  } finally { p.limpar(); fs.rmSync(configDir, { recursive: true, force: true }); }
});

test('RM-064 T2: sessão Codex viva é interrompida pelo vínculo canônico da thread', () => {
  const p = projetoTemporario('rm064-conta-codex');
  const codexHome = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'ork-rm064-codex-'));
  const perfil = { id: 'codex-a', runtime: 'codex' as const, codexHome };
  try {
    const t = novaThread(p.carregado, { nome: 'quota-codex', modo: 'auto' }).thread;
    t.sessoes.push({ slug: t.slug, fase: 'CHECK', bloco: 'full', sessionId: S1, runtime: 'codex', despachadaEm: EM,
      promptPath: 'prompt.md', promptSha256: 'b'.repeat(64), verificada: true, controlador: path.join(codexHome, 'controller') });
    gravarThread(p.dir, t);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { fase: 'CHECK', sessionId: S1, runtime: 'codex',
      despachoEm: EM, promptPath: 'prompt.md', promptSha256: 'b'.repeat(64), perfil,
      controlador: path.join(codexHome, 'controller') });
    const inventario = { ok: true, escopo: { usuario: 'fixture', global: true, historico: true, raiz: p.dir }, fontes: [],
      sessoes: [{ sessionId: S1, cwd: p.dir, runtime: 'codex' as const, perfil: 'codex-a', fantasma: false, viva: true, vinculos: [] }],
      total: 1, semThread: 0, ambiguas: 0, fantasmas: 0 } satisfies InventarioDeSessoes;
    const vinculos: Array<{ raiz: string; thread: string }> = [];
    const r = reconciliarContaEsgotada({ raiz: p.dir, perfil,
      falha: { motivo: 'runtime.quota-exhausted', resetEm: '2026-10-19T01:00:00.000Z', fonte: 'relogio', trecho: 'limite' },
      esgotadoAte: '2026-10-19T01:00:00.000Z', erroEm: EM },
    { inventario: () => inventario, projetos: () => [p.dir], parar: (_s, _id, _perfil, vinculo) => {
      if (vinculo) vinculos.push(vinculo); return { ok: true, detalhe: 'controller stub confirmou' };
    } });
    assert.equal(r.completo, true);
    assert.equal(vinculos.length, 1);
    assert.deepEqual({ raiz: vinculos[0].raiz, thread: vinculos[0].thread }, { raiz: p.dir, thread: t.id });
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some((e) => e.tipo === 'phase_result' && e.paradaConfirmada === true), true);
  } finally { p.limpar(); fs.rmSync(codexHome, { recursive: true, force: true }); }
});
