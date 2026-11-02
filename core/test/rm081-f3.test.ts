/** RM-081 F3: a rodada de correcao filtra nomes, mas a entrega continua exigindo a suite inteira. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto, NOME_MANIFESTO } from '../src/manifest';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { novaThread } from '../src/thread';
import { dirThread } from '../src/thread';
import { ResultadoDeComando } from '../src/types';
import { comandoComTestesFiltrados, comandoNoLedger, verificar, textoDoVerify } from '../src/verify';
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

function resultado(nome: string, comando: string, ok: boolean): ResultadoDeComando {
  return { nome, comando, ok, code: ok ? 0 : 1, resumo: '', causa: 'exit', executado: true, duracaoMs: 1 };
}

function xml(nome: string, falha: boolean): string {
  return `<testsuite><testcase classname="suite" name="${nome}">${falha ? '<failure/>' : ''}</testcase></testsuite>`;
}

function projetoClassic(nome: string) {
  const p = projetoTemporario(nome);
  const relatorio = 'reports/junit.xml';
  fs.mkdirSync(path.join(p.dir, 'reports'));
  p.carregado.manifesto.verify = { test: 'runner completo', junit: { test: relatorio },
    filtro: { test: 'runner parcial {testes}' } };
  p.carregado.manifesto.check = { mode: 'classic' };
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  return { p, thread, relatorio };
}

function rodadaAnterior(p: ProjetoDeTeste, thread: { id: string }, comando = 'runner completo', nomes = ['suite :: falha']) {
  registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao, {
    commit: 'a'.repeat(40), comandos: [{ nome: 'test', comando, ok: false, code: 1,
      testeQueCaiu: nomes, junit: { caminho: 'reports/junit.xml', estado: 'lido' } }],
  });
}

test('RM081 F3 V1: sem rodada anterior nominal o filtro nao e aplicado', () => {
  const { p, thread, relatorio } = projetoClassic('rm081-f3-sem-anterior');
  try {
    const comandos: string[] = [];
    const r = verificar(p.carregado, thread.id, { executor: (nome, comando) => {
      comandos.push(comando);
      fs.writeFileSync(path.join(p.dir, relatorio), xml('falha', true));
      return resultado(nome, comando, false);
    } });
    assert.deepEqual(comandos, ['runner completo']);
    assert.equal(r.parcial, false);
  } finally { p.limpar(); }
});

test('RM081 F3 V2: parcial vermelha reprova, lista nomes e nao roda a suite inteira', () => {
  const { p, thread, relatorio } = projetoClassic('rm081-f3-parcial-vermelha');
  try {
    rodadaAnterior(p, thread);
    const comandos: string[] = [];
    const r = verificar(p.carregado, thread.id, { executor: (nome, comando) => {
      comandos.push(comando);
      fs.writeFileSync(path.join(p.dir, relatorio), xml('falha', true));
      return resultado(nome, comando, false);
    } });
    assert.deepEqual(comandos, ["runner parcial 'suite :: falha'"]);
    assert.equal(r.ok, false);
    assert.equal(r.parcial, true);
    assert.deepEqual(r.comandos[0].parcial, { testes: ['suite :: falha'] });
    assert.deepEqual((comandoNoLedger(r.comandos[0]).parcial as { testes: string[] }).testes, ['suite :: falha']);
    assert.match(textoDoVerify(r), /rodada PARCIAL; teste\(s\) filtrado\(s\): suite :: falha/);
  } finally { p.limpar(); }
});

test('RM081 F3 V3: parcial verde continua para a suite inteira, que decide o veredito', () => {
  const { p, thread, relatorio } = projetoClassic('rm081-f3-parcial-verde');
  try {
    rodadaAnterior(p, thread);
    const comandos: string[] = [];
    const r = verificar(p.carregado, thread.id, { executor: (nome, comando) => {
      comandos.push(comando);
      const parcial = comando.startsWith('runner parcial');
      fs.writeFileSync(path.join(p.dir, relatorio), xml(parcial ? 'falha' : 'regressao-nova', !parcial));
      return resultado(nome, comando, parcial);
    } });
    assert.deepEqual(comandos, ["runner parcial 'suite :: falha'", 'runner completo']);
    assert.equal(r.parcial, false, 'a suite completa substitui a passagem parcial verde no recibo');
    assert.equal(r.ok, false, 'a falha nova da suite completa manda no veredito');
    assert.deepEqual(r.comandos[0].testeQueCaiu, ['suite :: regressao-nova']);
  } finally { p.limpar(); }
});

test('RM081 F3 V4: nomes viram argumentos shell, sem executar metacaracteres', () => {
  assert.equal(comandoComTestesFiltrados('runner {testes}', ["a'b", '$(efeito)', 'x; y']),
    "runner 'a'\"'\"'b' '$(efeito)' 'x; y'");
});
