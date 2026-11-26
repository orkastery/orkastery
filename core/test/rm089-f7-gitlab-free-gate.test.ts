import assert from 'node:assert/strict';
import test from 'node:test';
import { avaliarGateGitlabFree, statusPositivoAutorizaGateGitlab,
  type EntradaGitlabFree } from '../src/ci-fabrica-gitlab';
import { caminhoDoMrDaFabricaGitlab, caminhoDosMembrosEfetivosGitlab } from '../src/forja/gitlab/consultas';

const H = 'a'.repeat(40), V = 'b'.repeat(40), D = 'c'.repeat(40);
const base = (): EntradaGitlabFree => ({ nivel: 'exigir', projeto: 'grupo/projeto', iid: 7, origem: 'feature',
  destino: 'main', head: H, headRelido: H, projetoOrigem: 1, projetoDestino: 1, estado: 'opened', divergencia: 0,
  destinoProtegido: true, mergeNivel: 40, pushNivel: 0, forcePush: false, contaDaFabrica: 42,
  escopoDoToken: ['api'], contaRestritaAosProjetos: true, membrosCompletos: true,
  membros: [{ id: 42, nivel: 40 }], comparacaoCompleta: true, compareTimeout: false, baseDeMerge: V,
  commitDoVerify: V, destinoNaPrimeiraLeitura: D, destinoAntesDoEfeito: D, limiteDeOwnerDeclarado: true });

test('C128 relê MR com divergência, membros efetivos e mescla com sha', () => {
  assert.match(caminhoDoMrDaFabricaGitlab('grupo/projeto', 7), /include_diverged_commits_count=true/);
  assert.match(caminhoDosMembrosEfetivosGitlab('grupo/projeto'), /members\/all/);
  const r = avaliarGateGitlabFree(base());
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.pedidoDeMerge?.corpo, { sha: H });
});

test('commit status positivo nunca autoriza', () => assert.equal(statusPositivoAutorizaGateGitlab(), false));

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
    (e: EntradaGitlabFree) => { e.projetoOrigem = 2; },
    (e: EntradaGitlabFree) => { e.contaRestritaAosProjetos = false; },
    (e: EntradaGitlabFree) => { e.compareTimeout = true; },
  ];
  for (const mudar of casos) { const e = base(); mudar(e); assert.equal(avaliarGateGitlabFree(e).ok, false); }
});

test('observar e avisar não mesclam e recusa do merge em exigir tem código próprio', () => {
  for (const nivel of ['observar', 'avisar'] as const) { const e = base(); e.nivel = nivel;
    const r = avaliarGateGitlabFree(e); assert.equal(r.ok, true); if (r.ok) assert.equal(r.mesclar, false); }
  const e = base(); e.mergeAceito = false;
  const r = avaliarGateGitlabFree(e); assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.codigo, 'ci.fabrica.publicacao-recusada');
});
