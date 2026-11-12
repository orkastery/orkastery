import assert from 'node:assert/strict';
import test from 'node:test';
import { respostaDoStatusMcp } from '../src/mcp-server';
import type { ResultadoPreflightEmpresa } from '../src/rede-empresa-preflight';
import type { Thread } from '../src/types';

const thread = { id: 'ork-exemplo', slug: 'ork-exemplo-full', nome: 'exemplo', assunto: 'exemplo', modo: 'auto',
  fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'], blocos: [{ fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'],
    pausa: false, pausaSobre: '', slugFases: 'full' }], faseAtual: 'GO', status: 'aberta', criadaEm: '2026-11-12T00:00:00.000Z',
  atualizadaEm: '2026-11-12T00:00:00.000Z', projeto: { name: 'projeto', abbrev: 'prj' },
  base: { branch: 'prj/ork-exemplo-full', commit: 'a'.repeat(40) }, worktree: null, sessoes: [], decisoes: [], claims: [], leases: [],
  baseline: null, variante: null, score: null } as Thread;
const preflight: ResultadoPreflightEmpresa = { estado: 'conflito', consultivo: true, conflitos: [{
  a: { inscricaoId: 'a', builder: 'builder-a', threadRef: 'thread-a' }, b: { inscricaoId: 'b', builder: 'builder-b', threadRef: 'thread-b' },
  projectKey: 'github:github.com/time/projeto', itemId: 'RM-089', regioes: [], fontes: ['item'] }], ordemSugerida: [], lacunas: [],
  performance: { estado: 'unavailable' }, cobertura: 'completa',
  fotografia: { ponta: 'c1', publicacoes: 2, trabalhos: 2, caminhos: 0, commitsLidos: 1, fonte: 'rede-coletiva' } };

test('ork_thread_status devolve o preflight consultável antes do ork_ship', () => {
  const resposta = respostaDoStatusMcp(thread, null, [], preflight);
  assert.equal(resposta.preflightEmpresa, preflight);
  assert.match(resposta.resumo, /Preflight coletivo: 1 conflito/);
});

test('sem inscrição o contrato anterior do MCP permanece sem preflight', () => {
  const resposta = respostaDoStatusMcp(thread, null, [], null);
  assert.equal('preflightEmpresa' in resposta, false);
  assert.doesNotMatch(resposta.resumo, /Preflight coletivo/);
});
