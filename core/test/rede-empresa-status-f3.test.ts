import assert from 'node:assert/strict';
import test from 'node:test';
import { textoDoPreflightEmpresa } from '../src/rede-empresa-status';
import type { ResultadoPreflightEmpresa } from '../src/rede-empresa-preflight';

const base: ResultadoPreflightEmpresa = { estado: 'inconclusivo', consultivo: true, conflitos: [], ordemSugerida: [],
  lacunas: ['historia.rasa'], performance: { estado: 'unavailable' }, cobertura: 'incompleta',
  fotografia: { ponta: 'c1', publicacoes: 1, trabalhos: 1, caminhos: 1, commitsLidos: 0, fonte: 'rede-coletiva' } };

test('status em pt-BR e inglês distingue conflito, completo e lacuna com fonte e ação', () => {
  assert.match(textoDoPreflightEmpresa(base, 'pt-BR'), /inconclusivo.*historia\.rasa.*Ação/);
  assert.match(textoDoPreflightEmpresa(base, 'en'), /inconclusive.*historia\.rasa.*Action/);
  const conflito: ResultadoPreflightEmpresa = { ...base, estado: 'conflito', conflitos: [{
    a: { inscricaoId: 'a', builder: 'a', threadRef: 'a' },
    b: { inscricaoId: 'b', builder: 'b', threadRef: 'b' }, projectKey: 'p', regioes: [], fontes: ['item'] }] };
  assert.match(textoDoPreflightEmpresa(conflito, 'pt-BR'), /1 conflito.*ordem sugerida.*consultiva/);
  assert.match(textoDoPreflightEmpresa(conflito, 'en'), /1 conflict.*Suggested order.*advisory/);
  const completo: ResultadoPreflightEmpresa = { ...base, estado: 'sem-conflito', lacunas: [], cobertura: 'completa' };
  assert.match(textoDoPreflightEmpresa(completo, 'pt-BR'), /nenhum conflito.*fotografia completa/);
  assert.match(textoDoPreflightEmpresa(completo, 'en'), /no conflict.*complete snapshot/);
});

test('a análise é explicitamente consultiva e performance fica indisponível sem medição', () => {
  assert.equal(base.consultivo, true); assert.deepEqual(base.performance, { estado: 'unavailable' });
});
