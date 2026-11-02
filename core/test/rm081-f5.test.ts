/** RM-081 F5: selecao nativa por mudancas somente na rodada morna do Agile. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONTRATO_DA_SELECAO, planejarSelecaoNativa } from '../src/check-selecao';
import { carregarManifesto, NOME_MANIFESTO } from '../src/manifest';
import { EventoLedger, Manifesto } from '../src/types';
import { exec } from '../src/util';
import { commitar, projetoTemporario, ProjetoDeTeste } from './apoio';

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

function manifestoComSelecao(p: ProjetoDeTeste): Manifesto {
  const branch = exec('git', ['switch', '-c', 'ork-rm081-f5'], p.dir);
  assert.equal(branch.ok, true, branch.stderr);
  p.carregado.manifesto.worktree.base_branch = 'main';
  p.carregado.manifesto.check = { mode: 'agile', agile: { test: { runner: 'runner completo' },
    selecao: { runner: { comando: 'runner relacionado {arquivos}', mapeia: ['src/**', 'test/**'],
      configuracao: ['runner.config.ts'] } } } };
  return p.carregado.manifesto;
}

function commitarArvore(p: ProjetoDeTeste, mensagem: string): string {
  exec('git', ['add', '--all'], p.dir);
  const r = exec('git', ['commit', '-m', mensagem], p.dir);
  assert.equal(r.ok, true, r.stderr);
  return exec('git', ['rev-parse', 'HEAD'], p.dir).stdout.trim();
}

function rodadaVerde(head: string, cache: unknown): EventoLedger {
  return { tipo: 'verify_run', thread: 'ork-rm081-f5', ts: '2026-11-02T00:00:00.000Z', commit: head,
    veredito: 'verdade sustentada', selecao: cache } as EventoLedger;
}

test('RM081 F5 P1: rodada fria e Classic nunca selecionam', () => {
  const p = projetoTemporario('rm081-f5-fria');
  try {
    const manifesto = manifestoComSelecao(p);
    const head = commitarArvore(p, 'manifesto');
    const base = exec('git', ['merge-base', head, 'main'], p.dir).stdout.trim();
    const fria = planejarSelecaoNativa(p.dir, manifesto, [], head, 'agile');
    assert.deepEqual(fria.lanes.runner, { modo: 'inteira', motivo: 'rodada-fria' });
    assert.deepEqual(fria.cache, { contrato: CONTRATO_DA_SELECAO, base, head });
    assert.deepEqual(planejarSelecaoNativa(p.dir, manifesto, [], head, 'classic'), { lanes: {}, cache: null });
  } finally { p.limpar(); }
});

test('RM081 F5 P2: rodada morna seleciona somente mudancas mapeadas e escapa os arquivos', () => {
  const p = projetoTemporario('rm081-f5-morna');
  try {
    const manifesto = manifestoComSelecao(p);
    const anterior = commitarArvore(p, 'manifesto');
    const fria = planejarSelecaoNativa(p.dir, manifesto, [], anterior, 'agile');
    const atual = commitar(p.dir, "src/a'b.ts", 'export const valor = 1;\n', 'produto');
    const morna = planejarSelecaoNativa(p.dir, manifesto, [rodadaVerde(anterior, fria.cache)], atual, 'agile');
    assert.deepEqual(morna.lanes.runner, { modo: 'selecionada', motivo: 'selecionada', arquivos: ["src/a'b.ts"],
      base: anterior, comando: `runner relacionado 'src/a'"'"'b.ts'` });
  } finally { p.limpar(); }
});

test('RM081 F5 P3: manifesto, lockfile, configuracao e fora do mapeamento caem para a suite inteira', () => {
  const casos = [
    ['manifesto', NOME_MANIFESTO, 'manifesto-mudou'],
    ['lockfile', 'package-lock.json', 'lockfile-mudou'],
    ['configuracao', 'runner.config.ts', 'configuracao-mudou'],
    ['fora', 'docs/guia.md', 'fora-do-mapeamento'],
  ] as const;
  for (const [nome, arquivo, motivo] of casos) {
    const p = projetoTemporario(`rm081-f5-queda-${nome}`);
    try {
      const manifesto = manifestoComSelecao(p);
      const anterior = commitarArvore(p, 'manifesto');
      const fria = planejarSelecaoNativa(p.dir, manifesto, [], anterior, 'agile');
      const conteudo = arquivo === NOME_MANIFESTO ? fs.readFileSync(path.join(p.dir, arquivo), 'utf8') + '\n# mudanca\n' : 'mudanca\n';
      const atual = commitar(p.dir, arquivo, conteudo, nome);
      const plano = planejarSelecaoNativa(p.dir, manifesto, [rodadaVerde(anterior, fria.cache)], atual, 'agile');
      assert.deepEqual(plano.lanes.runner, { modo: 'inteira', motivo, arquivos: [arquivo] });
    } finally { p.limpar(); }
  }
});

test('RM081 F5 P4: cache ausente, vermelho, malformado ou de outra base nunca seleciona', () => {
  const p = projetoTemporario('rm081-f5-cache-invalido');
  try {
    const manifesto = manifestoComSelecao(p);
    const anterior = commitarArvore(p, 'manifesto');
    const atual = commitar(p.dir, 'src/produto.ts', 'export {};\n', 'produto');
    const ausente = planejarSelecaoNativa(p.dir, manifesto, [rodadaVerde(anterior, undefined)], atual, 'agile');
    assert.equal(ausente.lanes.runner.motivo, 'cache-ausente');
    const malformado = { contrato: CONTRATO_DA_SELECAO, base: anterior, head: 'invalido' };
    assert.equal(planejarSelecaoNativa(p.dir, manifesto, [rodadaVerde(anterior, malformado)], atual, 'agile')
      .lanes.runner.motivo, 'cache-invalido');
    const fria = planejarSelecaoNativa(p.dir, manifesto, [], anterior, 'agile');
    const vermelho = { ...rodadaVerde(anterior, fria.cache), veredito: 'reprovado' } as EventoLedger;
    assert.equal(planejarSelecaoNativa(p.dir, manifesto, [vermelho], atual, 'agile').lanes.runner.motivo,
      'cache-invalido');
    const outraBase = { ...fria.cache!, base: 'f'.repeat(40) };
    assert.equal(planejarSelecaoNativa(p.dir, manifesto, [rodadaVerde(anterior, outraBase)], atual, 'agile')
      .lanes.runner.motivo, 'base-mudou');
  } finally { p.limpar(); }
});

test('RM081 F5 P5: runner sem mapeamento declarado e diff vazio conservam a suite inteira', () => {
  const p = projetoTemporario('rm081-f5-sem-garantia-runtime');
  try {
    const manifesto = manifestoComSelecao(p);
    manifesto.check!.agile!.selecao!.runner.mapeia = [];
    const head = commitarArvore(p, 'manifesto');
    const cache = planejarSelecaoNativa(p.dir, manifesto, [], head, 'agile').cache!;
    assert.equal(planejarSelecaoNativa(p.dir, manifesto, [rodadaVerde(head, cache)], head, 'agile')
      .lanes.runner.motivo, 'runner-sem-garantia');
    manifesto.check!.agile!.selecao!.runner.mapeia = ['src/**'];
    assert.equal(planejarSelecaoNativa(p.dir, manifesto, [rodadaVerde(head, cache)], head, 'agile')
      .lanes.runner.motivo, 'sem-mudancas');
  } finally { p.limpar(); }
});
