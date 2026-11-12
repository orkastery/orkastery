import assert from 'node:assert/strict';
import test from 'node:test';
import { respostaDoStatusDaThread } from '../src/index';
import { resumoDaThread } from '../src/thread';
import type { Thread } from '../src/types';
import type { ResultadoPreflightEmpresa } from '../src/rede-empresa-preflight';

const thread: Thread = { id: 'ork-exemplo', slug: 'ork-exemplo-full', nome: 'exemplo', assunto: 'exemplo', modo: 'auto',
  fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'], blocos: [{ fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'],
    pausa: false, pausaSobre: '', slugFases: 'full' }], faseAtual: 'GO', status: 'aberta', criadaEm: '2026-11-12T00:00:00.000Z',
  atualizadaEm: '2026-11-12T00:00:00.000Z', projeto: { name: 'projeto', abbrev: 'prj' },
  base: { branch: 'prj/ork-exemplo-full', commit: 'a'.repeat(40) }, worktree: null, sessoes: [], decisoes: [], claims: [], leases: [],
  baseline: null, variante: null, score: null };
const preflight: ResultadoPreflightEmpresa = { estado: 'inconclusivo', consultivo: true, conflitos: [], ordemSugerida: [],
  lacunas: ['historia.rasa'], performance: { estado: 'unavailable' }, cobertura: 'incompleta',
  fotografia: { ponta: 'c1', publicacoes: 1, trabalhos: 1, caminhos: 1, commitsLidos: 0, fonte: 'rede-coletiva' } };

test('thread status acrescenta o preflight no JSON e no texto antes do ork_ship', () => {
  const json = respostaDoStatusDaThread(thread, [], preflight) as { preflightEmpresa?: ResultadoPreflightEmpresa };
  assert.equal(json.preflightEmpresa, preflight);
  assert.match(resumoDaThread(thread, null, [], 'Preflight coletivo inconclusivo (historia.rasa).'), /Preflight coletivo inconclusivo/);
});

test('sem inscrição coletiva a saída anterior não ganha campo nem linha', () => {
  const json = respostaDoStatusDaThread(thread, [], null) as Record<string, unknown>;
  assert.equal('preflightEmpresa' in json, false);
  assert.doesNotMatch(resumoDaThread(thread, null, []), /Preflight coletivo/);
});
