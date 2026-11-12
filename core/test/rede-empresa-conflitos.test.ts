import assert from 'node:assert/strict';
import test from 'node:test';
import { analisarConflitosColetivos, intersecaoDeGlobs, type TrabalhoColetivo } from '../src/rede-empresa-conflitos';

const casos: Array<[string, string, string]> = [
  ['**/*.ts', 'docs/**', 'intersecta'], ['core/src/a/*.ts', 'core/src/a/*.md', 'disjunta'],
  ['core/src/**', 'core/test/**', 'disjunta'], ['core/src/a.ts', 'core/src/*.ts', 'intersecta'],
  ['**', 'docs/?uide.md', 'intersecta'], ['a/*/c', 'a/**/c', 'intersecta'], ['a/[bc].ts', 'a/b.ts', 'inconclusiva'],
];
for (const [a, b, estado] of casos) test(`interseção ${a} × ${b}`, () => {
  assert.equal(intersecaoDeGlobs(a, b).estado, estado); assert.equal(intersecaoDeGlobs(b, a).estado, estado);
});

const trabalho = (inscricaoId: string, accountId: number, threadRef: string, ordinal: number,
  caminhos: string[], itemId = 'RM-089'): TrabalhoColetivo => ({ inscricaoId, accountId, builder: `builder-${accountId}`, threadRef,
  projectKey: 'github:github.com/time/projeto', itemId, caminhos: caminhos.map((padrao) => ({ padrao, fontes: ['plan'] })),
  primeiraAparicao: { ordinal, commit: `c${ordinal}` }, instanteLocal: { valor: '2026-11-12T00:00:00.000Z', fonte: 'auto-relato-autenticado' } });

test('conflito por item e caminho não depende da ordem de entrada nem do relógio local', () => {
  const a = trabalho('inscricao-b', 42, 'thread-z', 2, ['core/src/**']);
  const b = { ...trabalho('inscricao-a', 41, 'thread-a', 1, ['core/src/*.ts']),
    instanteLocal: { valor: '2099-01-01T00:00:00.000Z', fonte: 'auto-relato-autenticado' as const } };
  const primeiro = analisarConflitosColetivos([a, b]), segundo = analisarConflitosColetivos([b, a]);
  assert.equal(primeiro.estado, 'conflito');
  assert.deepEqual(primeiro.ordemSugerida, segundo.ordemSugerida);
  assert.deepEqual(primeiro.ordemSugerida.map((x) => x.threadRef), ['thread-a', 'thread-z']);
  assert.deepEqual(primeiro.conflitos[0].fontes, ['item', 'caminho']);
});

test('mesmo commit desempata por inscrição e thread; padrão inválido deixa o resultado inconclusivo', () => {
  const b = trabalho('inscricao-b', 42, 'thread-b', 1, ['core/{src,test}/**'], 'RM-090');
  const a = trabalho('inscricao-a', 41, 'thread-z', 1, ['docs/**'], 'RM-091');
  const r = analisarConflitosColetivos([b, a]);
  assert.equal(r.estado, 'inconclusivo');
  assert.deepEqual(r.ordemSugerida.map((x) => x.inscricaoId), ['inscricao-a', 'inscricao-b']);
  assert.match(r.lacunas[0], /padrao\.nao-suportado/);
});
