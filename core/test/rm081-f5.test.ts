/** RM-081 F5: selecao nativa por mudancas somente na rodada morna do Agile. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto, NOME_MANIFESTO } from '../src/manifest';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

function comCheck(p: ProjetoDeTeste, check: string) {
  const arquivo = path.join(p.dir, NOME_MANIFESTO);
  fs.appendFileSync(arquivo, `\n${check}\n`);
  return carregarManifesto(p.dir)!;
}

test('RM081 F5 M1: lane declara selecao por base ou arquivos e texto legado fica igual', () => {
  const p = projetoTemporario('rm081-f5-manifesto');
  try {
    const legado = comCheck(p, [
      'check:',
      '  agile:',
      '    test:',
      '      legado: "npm test"',
      '      vitest:',
      '        comando: "vitest run"',
      '        junit: reports/vitest.xml',
      '        selecao:',
      '          comando: "vitest run --changed {base}"',
      '          mapeia: [src/**, test/**]',
      '          configuracao: [vitest.config.ts]',
      '      jest:',
      '        comando: "jest"',
      '        junit: reports/jest.xml',
      '        selecao:',
      '          comando: "jest --findRelatedTests {arquivos}"',
      '          mapeia: [src/**, test/**]',
    ].join('\n'));
    assert.deepEqual(legado.erros, []);
    assert.equal(legado.manifesto.check?.agile?.test?.legado, 'npm test');
    assert.deepEqual(legado.manifesto.check?.agile?.selecao, {
      vitest: { comando: 'vitest run --changed {base}', mapeia: ['src/**', 'test/**'],
        configuracao: ['vitest.config.ts'] },
      jest: { comando: 'jest --findRelatedTests {arquivos}', mapeia: ['src/**', 'test/**'] },
    });
  } finally { p.limpar(); }
});

test('RM081 F5 M2: declaracao sem garantia e legivel para cair na suite inteira', () => {
  const p = projetoTemporario('rm081-f5-sem-garantia');
  try {
    const lido = comCheck(p, [
      'check:',
      '  agile:',
      '    test:',
      '      runner:',
      '        comando: "runner completo"',
      '        junit: reports/runner.xml',
      '        selecao:',
      '          comando: "runner relacionado {arquivos}"',
    ].join('\n'));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.manifesto.check?.agile?.selecao?.runner,
      { comando: 'runner relacionado {arquivos}', mapeia: [] });
  } finally { p.limpar(); }
});

test('RM081 F5 M3: manifesto recusa marcador ambiguo, caminho inseguro e chave desconhecida', () => {
  const casos = [
    ['marcador', 'comando: "runner {base} {arquivos}"', /exatamente um marcador/],
    ['absoluto', 'comando: "runner {base}"\nmapeia: [/src/**]', /dentro da worktree/],
    ['estado', 'comando: "runner {base}"\nmapeia: [.orkastery/**]', /fora de .orkastery e .git/],
    ['extra', 'comando: "runner {base}"\nmapeia: [src/**]\nrunner: outro', /runner desconhecida/],
  ] as const;
  for (const [nome, selecao, esperado] of casos) {
    const p = projetoTemporario(`rm081-f5-${nome}`);
    try {
      const lido = comCheck(p, [
        'check:',
        '  agile:',
        '    test:',
        '      runner:',
        '        comando: "runner completo"',
        '        junit: reports/runner.xml',
        '        selecao:',
        ...selecao.split('\n').map((linha) => `          ${linha}`),
      ].join('\n'));
      assert.ok(lido.erros.some((erro) => esperado.test(erro)), `${nome}: ${lido.erros.join(' | ')}`);
    } finally { p.limpar(); }
  }
});

test('RM081 F5 M4: selecao existe somente em lane do Agile', () => {
  const p = projetoTemporario('rm081-f5-fora-da-lane');
  try {
    const arquivo = path.join(p.dir, NOME_MANIFESTO);
    const bruto = fs.readFileSync(arquivo, 'utf8');
    const novo = bruto.replace(/^verify:\n(?:[ \t].*\n|\n)*?(?=\S)/m, [
      'verify:',
      '  test:',
      '    comando: npm test',
      '    junit: reports/test.xml',
      '    selecao:',
      '      comando: "npm test --changed {base}"',
      '      mapeia: [src/**]',
      '',
    ].join('\n'));
    assert.notEqual(novo, bruto);
    fs.writeFileSync(arquivo, novo);
    const lido = carregarManifesto(p.dir)!;
    assert.ok(lido.erros.some((erro) => /verify\.test\.selecao desconhecida/.test(erro)), lido.erros.join(' | '));
  } finally { p.limpar(); }
});
