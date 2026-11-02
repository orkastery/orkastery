/** RM-081 F2: testes de relogio declarados por comando JUnit e protegidos sob steal. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto, NOME_MANIFESTO } from '../src/manifest';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

function comVerify(p: ProjetoDeTeste, linhas: string, check = '') {
  const arquivo = path.join(p.dir, NOME_MANIFESTO);
  const bruto = fs.readFileSync(arquivo, 'utf8');
  const novo = bruto.replace(/^verify:\n(?:[ \t].*\n|\n)*?(?=\S)/m, `verify:\n${linhas}\n\n`) + check;
  assert.notEqual(novo, bruto);
  fs.writeFileSync(arquivo, novo);
  return carregarManifesto(p.dir)!;
}

test('RM081 F2 M1: manifesto marca relogio por nome, marcador ou tag e preserva texto legado', () => {
  const p = projetoTemporario('rm081-f2-manifesto');
  try {
    const legado = comVerify(p, '  test: "npm test"');
    assert.deepEqual(legado.erros, []);
    assert.equal(legado.manifesto.verify.relogio, undefined);

    const novo = comVerify(p, [
      '  test:',
      '    comando: "vitest run --reporter=junit"',
      '    junit: reports/vitest.xml',
      '    filtro: "vitest run --reporter=junit {testes}"',
      '    relogio:',
      '      nome: ["tempo$", "latencia"]',
    ].join('\n'), [
      'check:',
      '  agile:',
      '    test:',
      '      python:',
      '        comando: "pytest -m desempenho --junitxml reports/pytest.xml"',
      '        junit: reports/pytest.xml',
      '        relogio:',
      '          marcador: desempenho',
      '      navegador:',
      '        comando: "playwright test --grep @tempo --reporter=junit"',
      '        junit: reports/playwright.xml',
      '        relogio:',
      '          tag: "@tempo"',
      '',
    ].join('\n'));
    assert.deepEqual(novo.erros, []);
    assert.deepEqual(novo.manifesto.verify.relogio, { test: { nome: ['tempo$', 'latencia'] } });
    assert.deepEqual(novo.manifesto.check?.agile?.relogio,
      { python: { marcador: 'desempenho' }, navegador: { tag: '@tempo' } });
  } finally { p.limpar(); }
});

test('RM081 F2 M2: manifesto recusa marcacao ambigua, vazia, desconhecida ou com regex invalida', () => {
  const casos = [
    ['vazia', '    relogio: {}', /exatamente uma/],
    ['ambigua', '    relogio:\n      marcador: lento\n      tag: "@lento"', /exatamente uma/],
    ['regex', '    relogio:\n      nome: "["', /expressao regular invalida/],
    ['tag-vazia', '    relogio:\n      tag: ""', /texto nao vazio/],
    ['extra', '    relogio:\n      runner: pytest', /runner desconhecida/],
  ] as const;
  for (const [nome, relogio, esperado] of casos) {
    const p = projetoTemporario(`rm081-f2-${nome}`);
    try {
      const lido = comVerify(p, [
        '  test:',
        '    comando: "runner"',
        '    junit: reports/x.xml',
        relogio,
      ].join('\n'));
      assert.ok(lido.erros.some((e) => esperado.test(e)), lido.erros.join(' | '));
    } finally { p.limpar(); }
  }
});
