/** RM-061 F3e: snapshots dos resíduos humanos do grafo; códigos e JSON não mudam. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { GRAFO_EN, GRAFO_PT_BR } from '../src/locale-grafo';
import { linhasEmPortugues } from './locale-apoio';

test('locale pt-BR F3e grafo: extração e erro tipado preservam a redação', () => {
  const m = GRAFO_PT_BR.indexar.extracao;
  assert.equal(m.incremental('abc123', 2, 1, 3),
    '  extracao     incremental a partir do indice de abc123: 2 alterado(s), 1 novo(s), 3 removido(s)');
  assert.equal(m.tsParcial(2, m.lista(['a.ts', 'b.ts']), 12, 10),
    'TypeScript parcial, 2 reextraido(s) (a.ts, b.ts) num programa de 12, 10 da base');
  assert.equal(GRAFO_PT_BR.erroTipado('grafo.acesso.negado: quem roda o CLI nao le a raiz do repositorio'),
    'grafo.acesso.negado: quem roda o CLI nao le a raiz do repositorio');
});

test('locale en F3e grafo: extração e detalhes mudam, códigos permanecem', () => {
  const m = GRAFO_EN.indexar.extracao;
  const linhas = [
    m.incremental('abc123', 2, 1, 3),
    m.tsParcial(2, m.lista(['a.ts', 'b.ts']), 12, 10),
    m.markdown(1, m.lista(['README.md']), 4),
    m.completa('o incremental a partir de abc123 falhou e a extracao foi completa'),
    GRAFO_EN.erroTipado('grafo.acesso.negado: quem roda o CLI nao le a raiz do repositorio'),
    GRAFO_EN.erroTipado('grafo.indice.outra-revisao: o HEAD abc123 nao tem indice; o guardado e de outra revisao; rode ork grafo indexar'),
    GRAFO_EN.erroTipado('grafo.consulta.uso: limite precisa ser inteiro de 1 a 10000'),
  ];
  assert.deepEqual(linhasEmPortugues(linhas.join('\n'), ['TypeScript', 'Markdown']), []);
  assert.match(linhas[4], /^grafo\.acesso\.negado: the CLI process/);
  assert.match(linhas[5], /^grafo\.indice\.outra-revisao: HEAD abc123 has no index/);
  assert.match(linhas[6], /^grafo\.consulta\.uso: limite must be an integer/);
});

