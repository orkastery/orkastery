import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_COMMITS_HISTORIA_EMPRESA } from '../src/rede-empresa-contrato';
import { lerHistoriaDaEmpresa, type PontaDaRedeEmpresa, type RegistroDaHistoriaEmpresa } from '../src/rede-empresa-transporte';

const registros = (n: number): RegistroDaHistoriaEmpresa[] => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`,
  primeiroPai: i ? `c${i}` : null, ordinal: i + 1, documentos: [] }));
const ponta = (resultado: ReturnType<typeof lerHistoriaDaEmpresa> | null): PontaDaRedeEmpresa => ({ id: 'c2', atualizada: true,
  ler: () => null, historicoPrimeiroPai: () => resultado ?? { estado: 'completa', ponta: 'c2', registros: registros(2) } });

test('a mesma ponta completa preserva ordinais da raiz à ponta', () => {
  const a = lerHistoriaDaEmpresa(ponta(null)), b = lerHistoriaDaEmpresa(ponta(null));
  assert.deepEqual(a, b); assert.deepEqual(a.registros.map((r) => [r.id, r.ordinal]), [['c1', 1], ['c2', 2]]);
});

test('teto exato passa e histórias rasas, truncadas, não lineares ou excedentes são inconclusivas', () => {
  const exata = lerHistoriaDaEmpresa(ponta({ estado: 'completa', ponta: 'c2000', registros: registros(MAX_COMMITS_HISTORIA_EMPRESA) }));
  assert.equal(exata.estado, 'completa');
  for (const lacuna of ['historia.rasa', 'historia.truncada', 'historia.nao-linear', 'historia.excedeu-teto'] as const) {
    const r = lerHistoriaDaEmpresa(ponta({ estado: 'inconclusiva', ponta: 'c2', lacuna, registros: [] }));
    assert.deepEqual([r.estado, r.estado === 'inconclusiva' && r.lacuna], ['inconclusiva', lacuna]);
  }
});

test('porta sem história nunca conclui ausência de conflito', () => {
  const r = lerHistoriaDaEmpresa({ id: 'c1', atualizada: true, ler: () => null });
  assert.deepEqual([r.estado, r.estado === 'inconclusiva' && r.lacuna], ['inconclusiva', 'historia.indisponivel']);
});
