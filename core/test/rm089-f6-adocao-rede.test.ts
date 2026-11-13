import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adotar } from '../src/adocao';
import { fotografarConflitoDaAdocao } from '../src/rede-empresa-conflito';
import type { ResultadoPreflightEmpresa } from '../src/rede-empresa-preflight';
import { projetoComOrigemAdotavel } from './rm089-f6-forja-simulada';

const conflito: ResultadoPreflightEmpresa = { estado: 'conflito', consultivo: true, conflitos: [{
  a: { inscricaoId: 'a', builder: 'a', threadRef: 'ork-a' },
  b: { inscricaoId: 'b', builder: 'b', threadRef: 'ork-b' }, projectKey: 'github:time/projeto',
  regioes: [{ a: 'core/**', b: 'core/src/**' }], fontes: ['caminho'],
}], ordemSugerida: [{ inscricaoId: 'a', threadRef: 'ork-a', builder: 'a', primeiraAparicao: null }],
lacunas: [], performance: { estado: 'unavailable' }, cobertura: 'completa',
fotografia: { ponta: 'abc', publicacoes: 2, trabalhos: 2, caminhos: 2, commitsLidos: 1, fonte: 'rede-coletiva' } };

test('fotografia F3 permanece consultiva e a reserva é vinculada antes da adoção', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao-rede');
  try {
    const chamadas: string[] = [];
    const r = adotar(p.carregado, { ref: p.origem, roadmap: 'RM-089', nome: 'externa', modo: 'auto', perfilCheck: 'check' }, {
      coordenar: (criar) => { chamadas.push('reserva'); const thread = criar('op-1234567890abcdef');
        chamadas.push('vinculo'); return { thread, operationId: 'op-1234567890abcdef' }; },
      fotografar: () => conflito,
    });
    assert.deepEqual(chamadas, ['reserva', 'vinculo']);
    assert.equal(r.thread.adocao?.operacaoReserva, 'op-1234567890abcdef');
    assert.deepEqual(r.thread.adocao?.fotografiaF3, fotografarConflitoDaAdocao(conflito));
    assert.equal(r.thread.adocao?.fotografiaF3?.consultivo, true);
    assert.equal(r.thread.adocao?.estado, 'preparada', 'conflito consultivo não bloqueia sem policy versionada');
  } finally { p.limpar(); }
});
