import assert from 'node:assert/strict';
import test from 'node:test';
import { avaliarGateGitlabFree, type EntradaGitlabFree } from '../src/ci-fabrica-gitlab';
import { caminhoDoMrDaFabricaGitlab, caminhoDosMembrosEfetivosGitlab } from '../src/forja/gitlab/consultas';

const H = 'a'.repeat(40), V = 'b'.repeat(40), D = 'c'.repeat(40);
const base = (): EntradaGitlabFree => ({ nivel: 'exigir', projeto: 'grupo/projeto', iid: 7, origem: 'feature',
  destino: 'main', head: H, headRelido: H, projetoOrigem: 1, projetoDestino: 1, estado: 'opened', divergencia: 0,
  destinoProtegido: true, mergeNivel: 40, pushNivel: 0, forcePush: false, contaDaFabrica: 42,
  escopoDoToken: ['api'], contaRestritaAosProjetos: true, membrosCompletos: true,
  membros: [{ id: 42, nivel: 40 }], comparacaoCompleta: true, compareTimeout: false, baseDeMerge: V,
  commitDoVerify: V, destinoNaPrimeiraLeitura: D, destinoAntesDoEfeito: D,
  statusDoCommit: null, statusExterno: null });

test('C128 relê MR com divergência, membros efetivos e mescla com sha', () => {
  assert.match(caminhoDoMrDaFabricaGitlab('grupo/projeto', 7), /include_diverged_commits_count=true/);
  assert.match(caminhoDosMembrosEfetivosGitlab('grupo/projeto'), /members\/all/);
  const r = avaliarGateGitlabFree(base());
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.pedidoDeMerge?.corpo, { sha: H });
  const corrida = base(); let leituras = 0;
  Object.defineProperty(corrida, 'head', { get: () => (++leituras < 3 ? H : 'd'.repeat(40)) });
  const relido = avaliarGateGitlabFree(corrida);
  assert.equal(relido.ok, true);
  if (relido.ok) assert.deepEqual(relido.pedidoDeMerge?.corpo, { sha: H });
});

test('commit status e external status check positivos não autorizam o gate', () => {
  const e = base(); e.statusDoCommit = 'success'; e.statusExterno = 'passed'; e.divergencia = 1;
  const r = avaliarGateGitlabFree(e); assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.codigo, 'ci.fabrica.prova-ausente');
});

test('status positivo não substitui token api nem proteção da branch', () => {
  const semEscopo = base(); semEscopo.statusDoCommit = 'success'; semEscopo.escopoDoToken = [];
  assert.equal(avaliarGateGitlabFree(semEscopo).ok, false);
  const semProtecao = base(); semProtecao.statusExterno = 'passed'; semProtecao.destinoProtegido = false;
  assert.equal(avaliarGateGitlabFree(semProtecao).ok, false);
});

test('outro Maintainer efetivo só diagnostica em todos os níveis e Owner fica como limite declarado', () => {
  for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
    const e = base(); e.nivel = nivel; e.membros.push({ id: 9, nivel: 40 }, { id: 10, nivel: 50 });
    const r = avaliarGateGitlabFree(e);
    assert.equal(r.ok, true);
    if (r.ok) { assert.deepEqual(r.diagnosticos, ['ci.fabrica.maintainer-adicional']);
      assert.equal(r.mesclar, nivel === 'exigir'); }
  }
});

test('MR atrás do destino, corrida do destino, lista truncada, fork e conta ampla falham fechado', () => {
  const casos = [
    (e: EntradaGitlabFree) => { e.divergencia = 1; },
    (e: EntradaGitlabFree) => { e.destinoAntesDoEfeito = 'd'.repeat(40); },
    (e: EntradaGitlabFree) => { e.membrosCompletos = false; },
    (e: EntradaGitlabFree) => { e.comparacaoCompleta = false; },
    (e: EntradaGitlabFree) => { e.projetoOrigem = 2; },
    (e: EntradaGitlabFree) => { e.contaRestritaAosProjetos = false; },
    (e: EntradaGitlabFree) => { e.compareTimeout = true; },
  ];
  for (const mudar of casos) { const e = base(); mudar(e); assert.equal(avaliarGateGitlabFree(e).ok, false); }
});

test('proteção exige a conta da fábrica como Maintainer, merge restrito e push fechado sem force', () => {
  const casos = [
    (e: EntradaGitlabFree) => { e.membros = [{ id: e.contaDaFabrica, nivel: 30 }]; },
    (e: EntradaGitlabFree) => { e.mergeNivel = 30; },
    (e: EntradaGitlabFree) => { e.pushNivel = 30; },
    (e: EntradaGitlabFree) => { e.forcePush = true; },
    (e: EntradaGitlabFree) => { e.estado = 'closed'; },
  ];
  for (const mudar of casos) {
    const e = base(); mudar(e);
    assert.equal(avaliarGateGitlabFree(e).ok, false);
  }
});

test('atraso, fork e compare_timeout usam prova ausente, não regra do destino', () => {
  for (const mudar of [(e: EntradaGitlabFree) => { e.divergencia = 1; },
    (e: EntradaGitlabFree) => { e.projetoOrigem = 2; }, (e: EntradaGitlabFree) => { e.compareTimeout = true; }]) {
    const e = base(); mudar(e); const r = avaliarGateGitlabFree(e);
    assert.equal(r.ok, false); if (!r.ok) assert.equal(r.codigo, 'ci.fabrica.prova-ausente');
  }
});

test('observar e avisar não mesclam e recusa do merge em exigir tem código próprio', () => {
  for (const nivel of ['observar', 'avisar'] as const) { const e = base(); e.nivel = nivel;
    const r = avaliarGateGitlabFree(e); assert.equal(r.ok, true); if (r.ok) assert.equal(r.mesclar, false); }
  const e = base(); e.mergeAceito = false;
  const r = avaliarGateGitlabFree(e); assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.codigo, 'ci.fabrica.publicacao-recusada');
});
