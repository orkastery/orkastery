import assert from 'node:assert/strict';
import test from 'node:test';
import { avaliarGateGitlabPago, type EntradaGitlabPago } from '../src/ci-fabrica-gitlab';
import { caminhoDaRegraProtegidaGitlab, caminhoDasConfiguracoesDeAprovacaoGitlab } from '../src/forja/gitlab/consultas';

const H = 'a'.repeat(40), V = 'b'.repeat(40), D = 'c'.repeat(40);
const base = (): EntradaGitlabPago => ({ nivel: 'exigir', plano: 'premium', projeto: 'grupo/projeto', iid: 7,
  origem: 'feature', destino: 'main', head: H, headRelido: H, projetoOrigem: 1, projetoDestino: 1, estado: 'opened',
  divergencia: 0, destinoProtegido: true, mergeNivel: 40, pushNivel: 0, forcePush: false, contaDaFabrica: 42,
  escopoDoToken: ['api'], contaRestritaAosProjetos: true, membrosCompletos: true, membros: [{ id: 42, nivel: 40 }],
  comparacaoCompleta: true, compareTimeout: false, baseDeMerge: V, commitDoVerify: V,
  destinoNaPrimeiraLeitura: D, destinoAntesDoEfeito: D, statusDoCommit: null, statusExterno: null,
  resetAprovacoesNoPush: true, regraDeAprovacaoEditavelNoMr: false, impedirAprovacaoPeloAutor: true,
  aprovacoesExigidas: 2, aprovacoesValidas: 2, mergeTrainAtivo: false, configuracaoCompleta: true });

test('C113 relê regra protegida e aprovação e mantém merge ligado ao sha', () => {
  assert.match(caminhoDasConfiguracoesDeAprovacaoGitlab('grupo/projeto', 7), /approval_state/);
  assert.match(caminhoDaRegraProtegidaGitlab('grupo/projeto', 'main'), /protected_branches/);
  const r = avaliarGateGitlabPago(base());
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.pedidoDeMerge?.corpo, { sha: H });
});

test('push reseta aprovação e regra não pode ser editada no MR', () => {
  for (const mudar of [(e: EntradaGitlabPago) => { e.resetAprovacoesNoPush = false; },
    (e: EntradaGitlabPago) => { e.regraDeAprovacaoEditavelNoMr = true; },
    (e: EntradaGitlabPago) => { e.aprovacoesValidas = 1; }]) {
    const e = base(); mudar(e); assert.equal(avaliarGateGitlabPago(e).ok, false);
  }
});

test('aprovação não substitui proteção, atualização, HEAD nem vínculo do verify', () => {
  for (const mudar of [(e: EntradaGitlabPago) => { e.pushNivel = 40; },
    (e: EntradaGitlabPago) => { e.divergencia = 1; },
    (e: EntradaGitlabPago) => { e.headRelido = 'd'.repeat(40); },
    (e: EntradaGitlabPago) => { e.baseDeMerge = 'e'.repeat(40); }]) {
    const e = base(); mudar(e); assert.equal(avaliarGateGitlabPago(e).ok, false);
  }
  const status = base(); status.statusExterno = 'passed'; status.divergencia = 1;
  assert.equal(avaliarGateGitlabPago(status).ok, false);
});

test('plano pago preserva as restrições da conta, do merge e do estado do MR', () => {
  const casos = [
    (e: EntradaGitlabPago) => { e.membros = [{ id: e.contaDaFabrica, nivel: 30 }]; },
    (e: EntradaGitlabPago) => { e.mergeNivel = 30; },
    (e: EntradaGitlabPago) => { e.forcePush = true; },
    (e: EntradaGitlabPago) => { e.estado = 'closed'; },
  ];
  for (const mudar of casos) {
    const e = base(); mudar(e);
    assert.equal(avaliarGateGitlabPago(e).ok, false);
  }
});

test('configuração ausente diagnostica em observar e avisar e bloqueia em exigir', () => {
  for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
    const e = base(); e.nivel = nivel; e.configuracaoCompleta = false;
    const r = avaliarGateGitlabPago(e);
    assert.equal(r.ok, nivel !== 'exigir');
    if (r.ok) { assert.equal(r.mesclar, false); assert.deepEqual(r.diagnosticos, ['ci.fabrica.regra-destino-invalida']); }
  }
});

test('merge train sem decisão do SHA temporário é recusado', () => {
  const e = base(); e.plano = 'ultimate'; e.mergeTrainAtivo = true;
  assert.equal(avaliarGateGitlabPago(e).ok, false);
});
