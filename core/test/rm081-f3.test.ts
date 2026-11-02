/** RM-081 F3: a rodada de correcao filtra nomes, mas a entrega continua exigindo a suite inteira. */
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

test('RM081 F3 M1: manifesto aceita filtro nominal no verify e na lane e preserva texto legado', () => {
  const p = projetoTemporario('rm081-f3-manifesto');
  try {
    const legado = comVerify(p, '  test: "npm test"');
    assert.deepEqual(legado.erros, []);
    assert.equal(legado.manifesto.verify.test, 'npm test');
    assert.equal(legado.manifesto.verify.filtro, undefined);

    const novo = comVerify(p, [
      '  test:',
      '    comando: "pytest --junitxml reports/pytest.xml"',
      '    junit: reports/pytest.xml',
      '    filtro: "pytest --junitxml reports/pytest.xml {testes}"',
    ].join('\n'), [
      'check:',
      '  agile:',
      '    test:',
      '      navegador:',
      '        comando: "playwright test --reporter=junit"',
      '        junit: reports/playwright.xml',
      '        filtro: "playwright test --reporter=junit --grep {testes}"',
      '',
    ].join('\n'));
    assert.deepEqual(novo.erros, []);
    assert.deepEqual(novo.manifesto.verify.filtro, { test: 'pytest --junitxml reports/pytest.xml {testes}' });
    assert.deepEqual(novo.manifesto.check?.agile?.filtro,
      { navegador: 'playwright test --reporter=junit --grep {testes}' });
  } finally { p.limpar(); }
});

test('RM081 F3 M2: manifesto recusa filtro sem JUnit, vazio ou sem marcador unico', () => {
  const casos = [
    ['sem-junit', '  test:\n    comando: "pytest"\n    filtro: "pytest {testes}"', /verify\.test\.junit precisa/],
    ['vazio', '  test:\n    comando: "pytest"\n    junit: reports/x.xml\n    filtro: ""', /filtro precisa/],
    ['sem-marcador', '  test:\n    comando: "pytest"\n    junit: reports/x.xml\n    filtro: "pytest"', /marcador \{testes\}/],
    ['repetido', '  test:\n    comando: "pytest"\n    junit: reports/x.xml\n    filtro: "pytest {testes} {testes}"', /exatamente uma vez/],
  ] as const;
  for (const [nome, yaml, esperado] of casos) {
    const p = projetoTemporario(`rm081-f3-${nome}`);
    try {
      const lido = comVerify(p, yaml);
      assert.ok(lido.erros.some((e) => esperado.test(e)), lido.erros.join(' | '));
    } finally { p.limpar(); }
  }
});
