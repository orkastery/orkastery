/** RM-081 F1: JUnit declarado por comando/lane, sem quebrar o texto legado. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerJUnitXml, LIMITE_JUNIT_BYTES } from '../src/junit';
import { carregarManifesto, NOME_MANIFESTO } from '../src/manifest';
import { novaThread } from '../src/thread';
import { ResultadoDeComando } from '../src/types';
import { testDasLanes } from '../src/check-agil';
import { comandoNoLedger, executorComJUnit, gravarBaseline, verificar } from '../src/verify';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures/junit');
const fixture = (nome: string) => lerJUnitXml(fs.readFileSync(path.join(FIXTURES, `${nome}.xml`), 'utf8'));

function xmlDosCasos(casos: Array<{ nome: string; estado?: 'failure' | 'error' | 'skipped' }>): string {
  return `<testsuite name="suite">${casos.map((c) => `<testcase classname="runner" name="${c.nome}" time="0.001">` +
    (c.estado ? `<${c.estado}/>` : '') + '</testcase>').join('')}</testsuite>`;
}

function resultado(nome: string, comando: string, ok = false): ResultadoDeComando {
  return { nome, comando, ok, code: ok ? 0 : 1, resumo: '', causa: 'exit', executado: true,
    ...(ok ? {} : { testeQueCaiu: ['fallback da saida'], falhasDeTeste: [{ nome: 'fallback da saida', relogio: false }] }) };
}

function comVerify(p: ProjetoDeTeste, linhas: string, check = '') {
  const arquivo = path.join(p.dir, NOME_MANIFESTO);
  const bruto = fs.readFileSync(arquivo, 'utf8');
  const novo = bruto.replace(/^verify:\n(?:[ \t].*\n|\n)*?(?=\S)/m, `verify:\n${linhas}\n\n`) + check;
  assert.notEqual(novo, bruto);
  fs.writeFileSync(arquivo, novo);
  return carregarManifesto(p.dir)!;
}

test('RM081 M1: o manifesto preserva texto e aceita comando com junit no verify e nas lanes', () => {
  const p = projetoTemporario('rm081-manifesto');
  try {
    const legado = comVerify(p, '  test: "npm test"');
    assert.deepEqual(legado.erros, []);
    assert.equal(legado.manifesto.verify.test, 'npm test');
    assert.equal(legado.manifesto.verify.junit, undefined);

    const novo = comVerify(p, [
      '  test:',
      '    comando: "pytest --junitxml reports/pytest.xml"',
      '    junit: reports/pytest.xml',
    ].join('\n'), [
      'check:',
      '  agile:',
      '    test:',
      '      navegador:',
      '        comando: "npx playwright test --reporter=junit"',
      '        junit: reports/playwright.xml',
      '',
    ].join('\n'));
    assert.deepEqual(novo.erros, []);
    assert.equal(novo.manifesto.verify.test, 'pytest --junitxml reports/pytest.xml');
    assert.deepEqual(novo.manifesto.verify.junit, { test: 'reports/pytest.xml' });
    assert.deepEqual(novo.manifesto.check?.agile?.test, { navegador: 'npx playwright test --reporter=junit' });
    assert.deepEqual(novo.manifesto.check?.agile?.junit, { navegador: 'reports/playwright.xml' });
  } finally { p.limpar(); }
});

test('RM081 M2: o manifesto recusa objeto incompleto, chave extra e caminho que sai da worktree', () => {
  const casos = [
    ['sem-junit', '  test:\n    comando: "pytest"', /verify\.test\.junit precisa/],
    ['sem-comando', '  test:\n    junit: reports/x.xml', /verify\.test\.comando precisa/],
    ['absoluto', '  test:\n    comando: "pytest"\n    junit: /tmp/x.xml', /caminho relativo dentro da worktree/],
    ['travessia', '  test:\n    comando: "pytest"\n    junit: ../x.xml', /caminho relativo dentro da worktree/],
    ['extra', '  test:\n    comando: "pytest"\n    junit: reports/x.xml\n    runner: pytest', /runner desconhecida/],
  ] as const;
  for (const [nome, yaml, esperado] of casos) {
    const p = projetoTemporario(`rm081-${nome}`);
    try {
      const lido = comVerify(p, yaml);
      assert.ok(lido.erros.some((e) => esperado.test(e)), lido.erros.join(' | '));
    } finally { p.limpar(); }
  }
});

test('RM081 P1: o parser normaliza identidade, estado, escapes e duracao', () => {
  const relatorio = lerJUnitXml(`<?xml version="1.0" encoding="UTF-8"?>
<testsuites><testsuite name="suite">
  <testcase classname="modulo.Teste" name="passa &amp; segue" time="0.125"/>
  <testcase file="tests/test_api.py" name="falha" time="1.5"><failure message="x"/></testcase>
  <testcase classname="pacote" name="erro" time="0.01"><error/></testcase>
  <testcase name="pulado"><skipped/></testcase>
</testsuite></testsuites>`);
  assert.deepEqual(relatorio.casos, [
    { nome: 'modulo.Teste :: passa & segue', estado: 'passou', duracaoMs: 125 },
    { nome: 'tests/test_api.py :: falha', estado: 'falhou', duracaoMs: 1500 },
    { nome: 'pacote :: erro', estado: 'erro', duracaoMs: 10 },
    { nome: 'pulado', estado: 'pulado', duracaoMs: 0 },
  ]);
  assert.deepEqual({ testes: relatorio.testes, falhas: relatorio.falhas, erros: relatorio.erros,
    pulados: relatorio.pulados, duracaoMs: relatorio.duracaoMs },
  { testes: 4, falhas: 1, erros: 1, pulados: 1, duracaoMs: 1635 });
});

test('RM081 F1: fixtures reais de pytest, Vitest e Jest preservam a forma de cada runner', () => {
  const pytest = fixture('pytest');
  assert.deepEqual([pytest.testes, pytest.falhas, pytest.erros, pytest.pulados, pytest.duracaoMs], [4, 1, 1, 1, 314]);
  assert.deepEqual(pytest.casos.map((c) => [c.nome, c.estado]), [
    ['tests.test_api.TestUsuario :: test_lista', 'passou'],
    ['tests.test_api.TestUsuario :: test_cria', 'falhou'],
    ['tests.test_banco :: test_conecta', 'erro'],
    ['tests.test_opcional :: test_recurso', 'pulado'],
  ]);

  const vitest = fixture('vitest');
  assert.deepEqual([vitest.testes, vitest.falhas, vitest.erros, vitest.pulados, vitest.duracaoMs], [3, 1, 0, 1, 46]);
  assert.equal(vitest.casos[0].nome, 'src/painel.test.ts :: painel > mostra o resumo');

  const jest = fixture('jest');
  assert.deepEqual([jest.testes, jest.falhas, jest.erros, jest.pulados, jest.duracaoMs], [3, 1, 0, 1, 55]);
  assert.equal(jest.casos[1].nome, 'servico consulta :: propaga a falha');
});

test('RM081 F2: fixtures reais de Playwright e gotestsum preservam nomes e duracoes', () => {
  const playwright = fixture('playwright');
  assert.deepEqual([playwright.testes, playwright.falhas, playwright.erros, playwright.pulados, playwright.duracaoMs],
    [3, 1, 0, 1, 1725]);
  assert.deepEqual(playwright.casos.map((c) => c.nome), [
    'acesso.spec.ts :: abre a página', 'acesso.spec.ts :: exibe a validação', 'acesso.spec.ts :: cenário móvel',
  ]);

  const go = fixture('gotestsum');
  assert.deepEqual([go.testes, go.falhas, go.erros, go.pulados, go.duracaoMs], [3, 1, 0, 1, 72]);
  assert.deepEqual(go.casos.map((c) => [c.nome, c.estado]), [
    ['servico :: TestConsulta', 'passou'], ['servico :: TestAtualiza', 'falhou'], ['servico :: TestOpcional', 'pulado'],
  ]);
});

test('RM081 P2: XML malformado, DTD e entidade desconhecida sao recusados', () => {
  assert.throws(() => lerJUnitXml('<testsuite><testcase name="x"></testsuite>'), /nao corresponde/);
  assert.throws(() => lerJUnitXml('<!DOCTYPE testsuite><testsuite/>'), /DTD nao aceita/);
  assert.throws(() => lerJUnitXml('<testsuite><testcase name="x &privada;"/></testsuite>'), /entidade/);
  assert.throws(() => lerJUnitXml('<testsuite><testcase name="x"><failure>&privada;</failure></testcase></testsuite>'), /entidade/);
  assert.throws(() => lerJUnitXml('<testsuite><testcase name="x"><failure>texto & cru</failure></testcase></testsuite>'), /entidade/);
  assert.throws(() => lerJUnitXml('<testsuite><testcase name="x\u0001"><failure/></testcase></testsuite>'), /controle/);
  assert.throws(() => lerJUnitXml('<testsuite><testcase name="x" time="1e308"/></testsuite>'), /duracao/);
  assert.throws(() => lerJUnitXml('<testsuite><testcase name="a" time="5e12"/><testcase name="b" time="5e12"/></testsuite>'),
    /duracao somada/);
});

test('RM081 P3: relatorio com nome truncavel ou credencial nao entra no ledger', () => {
  const longo = 'x'.repeat(250);
  const segredo = ['sk', 'A'.repeat(40)].join('-');
  assert.equal(lerJUnitXml(`<testsuite><testcase name="${longo}"/></testsuite>`).testes, 1,
    'caso aprovado nao leva nome ao ledger e nao invalida o relatorio');
  assert.throws(() => lerJUnitXml(`<testsuite><testcase name="${longo}"><failure/></testcase></testsuite>`),
    /persistida com seguranca/);
  assert.throws(() => lerJUnitXml(`<testsuite><testcase name="${segredo}"><failure/></testcase></testsuite>`),
    /persistida com seguranca/);
  const espaco = lerJUnitXml('<testsuite><testcase classname="arquivo" name="linha\nforjada"><failure/></testcase></testsuite>');
  assert.equal(espaco.casos[0].nome, 'arquivo :: linha forjada', 'whitespace de atributo segue a normalizacao XML');
});

test('RM081 R1: o relatorio velho e removido antes do comando e o novo fornece todos os nomes', () => {
  const p = projetoTemporario('rm081-relatorio-novo');
  try {
    const caminho = 'reports/junit.xml';
    const arquivo = path.join(p.dir, caminho);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, xmlDosCasos([{ nome: 'velho', estado: 'failure' }]));
    p.carregado.manifesto.verify.junit = { test: caminho };
    const nomes = Array.from({ length: 12 }, (_, i) => ({ nome: `falha-${i + 1}`, estado: 'failure' as const }));
    const executar = executorComJUnit((nome, comando) => {
      assert.equal(fs.existsSync(arquivo), false, 'o arquivo da rodada anterior saiu antes do comando');
      fs.writeFileSync(arquivo, xmlDosCasos(nomes));
      return resultado(nome, comando);
    }, p.carregado.manifesto);
    const r = executar('test', 'runner', p.dir);
    assert.equal(r.ok, false, 'o XML nao muda o codigo de saida');
    assert.equal(r.junit?.estado, 'lido');
    assert.deepEqual(r.testeQueCaiu, nomes.map((c) => `runner :: ${c.nome}`), 'JUnit nao tem teto de dez nomes');
    assert.deepEqual(r.junit, { caminho, estado: 'lido', testes: 12, falhas: 12, erros: 0, pulados: 0, duracaoMs: 12 });
  } finally { p.limpar(); }
});

test('RM081 R2: ausente e XML invalido preservam codigo e fallback, com motivo de descarte', () => {
  const p = projetoTemporario('rm081-relatorio-descartado');
  try {
    const caminho = 'reports/junit.xml';
    fs.mkdirSync(path.join(p.dir, 'reports'));
    p.carregado.manifesto.verify.junit = { test: caminho };
    const ausente = executorComJUnit((nome, comando) => resultado(nome, comando), p.carregado.manifesto)('test', 'runner', p.dir);
    assert.equal(ausente.ok, false);
    assert.equal(ausente.junit?.estado, 'ausente');
    assert.deepEqual(ausente.testeQueCaiu, ['fallback da saida']);

    const invalido = executorComJUnit((nome, comando) => {
      fs.writeFileSync(path.join(p.dir, caminho), '<testsuite><testcase name="x"></testsuite>');
      return resultado(nome, comando);
    }, p.carregado.manifesto)('test', 'runner', p.dir);
    assert.equal(invalido.ok, false);
    assert.equal(invalido.junit?.estado, 'invalido');
    assert.equal(invalido.junit?.motivo, 'o relatorio nao contem XML JUnit valido');
    assert.doesNotMatch(invalido.junit?.motivo ?? '', /testcase|name/,
      'conteudo controlado pelo relatorio nao entra no ledger');
    assert.deepEqual(invalido.testeQueCaiu, ['fallback da saida']);
  } finally { p.limpar(); }
});

test('RM081 R3: erro do runner entra em testeQueCaiu e nunca conta como passou', () => {
  const p = projetoTemporario('rm081-erro');
  try {
    const caminho = 'junit.xml';
    p.carregado.manifesto.verify.junit = { test: caminho };
    const r = executorComJUnit((nome, comando) => {
      fs.writeFileSync(path.join(p.dir, caminho), xmlDosCasos([{ nome: 'quebrou no preparo', estado: 'error' }]));
      return resultado(nome, comando);
    }, p.carregado.manifesto)('test', 'runner', p.dir);
    assert.deepEqual(r.testeQueCaiu, ['runner :: quebrou no preparo'], JSON.stringify(r));
    assert.deepEqual(r.junit, { caminho, estado: 'lido', testes: 1, falhas: 0, erros: 1, pulados: 0, duracaoMs: 1 });
  } finally { p.limpar(); }
});

test('RM081 R3c: relatorio vermelho nao muda comando verde', () => {
  const p = projetoTemporario('rm081-codigo-autoridade');
  try {
    const caminho = 'junit.xml';
    p.carregado.manifesto.verify.junit = { test: caminho };
    const r = executorComJUnit((nome, comando) => {
      fs.writeFileSync(path.join(p.dir, caminho), xmlDosCasos([{ nome: 'falha reportada', estado: 'failure' }]));
      return resultado(nome, comando, true);
    }, p.carregado.manifesto)('test', 'runner', p.dir);
    assert.equal(r.ok, true, 'o codigo de saida continua sendo a autoridade do veredito');
    assert.equal(r.junit?.estado, 'lido');
    assert.equal(r.junit?.falhas, 1);
    assert.equal(r.testeQueCaiu, undefined, 'um XML vermelho nao reprova comando verde');
  } finally { p.limpar(); }
});

test('RM081 R3d: relatorio acima do teto e descartado e removido', () => {
  const p = projetoTemporario('rm081-relatorio-grande');
  try {
    const caminho = 'junit.xml';
    const arquivo = path.join(p.dir, caminho);
    p.carregado.manifesto.verify.junit = { test: caminho };
    const r = executorComJUnit((nome, comando) => {
      fs.writeFileSync(arquivo, Buffer.alloc(LIMITE_JUNIT_BYTES + 1, 0x20));
      return resultado(nome, comando);
    }, p.carregado.manifesto)('test', 'runner', p.dir);
    assert.equal(r.junit?.estado, 'invalido');
    assert.match(r.junit?.motivo ?? '', /excede/);
    assert.deepEqual(r.testeQueCaiu, ['fallback da saida']);
    assert.equal(fs.existsSync(arquivo), false, 'relatorio grande nao permanece na worktree');
  } finally { p.limpar(); }
});

test('RM081 R3b: arquivo com data de outra rodada e link simbolico nao servem como evidencia', () => {
  const p = projetoTemporario('rm081-relatorio-inseguro');
  const externo = path.join(path.dirname(p.dir), `${path.basename(p.dir)}-externo.xml`);
  const diretorioExterno = path.join(path.dirname(p.dir), `${path.basename(p.dir)}-externo`);
  try {
    p.carregado.manifesto.verify.junit = { test: 'junit.xml' };
    const antigo = executorComJUnit((nome, comando) => {
      const arquivo = path.join(p.dir, 'junit.xml');
      fs.writeFileSync(arquivo, xmlDosCasos([{ nome: 'antigo', estado: 'failure' }]));
      fs.utimesSync(arquivo, new Date(0), new Date(0));
      return resultado(nome, comando);
    }, p.carregado.manifesto)('test', 'runner', p.dir);
    assert.equal(antigo.junit?.estado, 'outra-rodada');
    assert.deepEqual(antigo.testeQueCaiu, ['fallback da saida']);
    assert.equal(fs.existsSync(path.join(p.dir, 'junit.xml')), false, 'relatorio descartado continua efemero');

    fs.writeFileSync(externo, xmlDosCasos([{ nome: 'fora', estado: 'failure' }]));
    const inseguro = executorComJUnit((nome, comando) => {
      fs.symlinkSync(externo, path.join(p.dir, 'junit.xml'));
      return resultado(nome, comando);
    }, p.carregado.manifesto)('test', 'runner', p.dir);
    assert.equal(inseguro.junit?.estado, 'inseguro');
    assert.match(inseguro.junit?.motivo ?? '', /arquivo regular/);
    assert.equal(fs.existsSync(path.join(p.dir, 'junit.xml')), false, 'link descartado nao permanece na worktree');

    p.carregado.manifesto.verify.junit = { test: 'reports/junit.xml' };
    fs.mkdirSync(diretorioExterno);
    const fora = path.join(diretorioExterno, 'junit.xml');
    fs.writeFileSync(fora, xmlDosCasos([{ nome: 'fora', estado: 'failure' }]));
    const paiTrocado = executorComJUnit((nome, comando) => {
      fs.symlinkSync(diretorioExterno, path.join(p.dir, 'reports'));
      return resultado(nome, comando);
    }, p.carregado.manifesto)('test', 'runner', p.dir);
    assert.equal(paiTrocado.junit?.estado, 'inseguro');
    assert.equal(fs.existsSync(fora), true, 'limpeza ancorada nunca remove o arquivo fora da worktree');
  } finally {
    fs.rmSync(externo, { force: true });
    fs.rmSync(diretorioExterno, { recursive: true, force: true });
    p.limpar();
  }
});

test('RM081 R4: a baseline compara nominalmente qualquer executor que escreva JUnit', () => {
  const p = projetoTemporario('rm081-baseline-junit');
  try {
    const caminho = 'reports/pytest.xml';
    fs.mkdirSync(path.join(p.dir, 'reports'));
    p.carregado.manifesto.verify = { test: 'pytest', junit: { test: caminho } };
    const { thread } = novaThread(p.carregado, { nome: 'baseline junit', modo: 'auto' });
    const com = (casos: Array<{ nome: string; estado?: 'failure' }>) => (nome: string, comando: string) => {
      fs.writeFileSync(path.join(p.dir, caminho), xmlDosCasos(casos));
      return resultado(nome, comando);
    };
    const baseline = gravarBaseline(p.carregado, thread.id, com([{ nome: 'A', estado: 'failure' }]));
    assert.equal(baseline.comandos[0].junit?.estado, 'lido', JSON.stringify(baseline.comandos[0]));
    const r = verificar(p.carregado, thread.id, { executor: com([
      { nome: 'A', estado: 'failure' }, { nome: 'B', estado: 'failure' },
    ]) });
    assert.deepEqual(r.comparacoes[0], { comando: 'test', granularidade: 'teste',
      regressoes: ['runner :: B'], preExistentes: ['runner :: A'], corrigidos: [] });
    assert.equal(r.ok, false);
  } finally { p.limpar(); }
});

test('RM081 L1: o ledger guarda estatisticas no sucesso, na falha, no comando e por lane', () => {
  const evidencia = (caminho: string, testes: number) => ({ caminho, estado: 'lido' as const,
    testes, falhas: testes, erros: 0, pulados: 0, duracaoMs: testes });
  const lane = (nome: string, inicio: number): ResultadoDeComando => ({ nome, comando: `runner ${nome}`, ok: false,
    code: 1, resumo: '', causa: 'exit', executado: true, duracaoMs: 10,
    testeQueCaiu: Array.from({ length: 6 }, (_, i) => `${nome}-${inicio + i}`), junit: evidencia(`${nome}.xml`, 6) });
  const agregado = testDasLanes([
    { lane: 'a', resultado: lane('a', 1) }, { lane: 'b', resultado: lane('b', 7) },
  ]);
  assert.equal(agregado.testeQueCaiu?.length, 12, 'o agregado JUnit nao corta em dez');
  assert.deepEqual(agregado.junit, { caminho: 'a.xml;b.xml', estado: 'lido',
    testes: 12, falhas: 12, erros: 0, pulados: 0, duracaoMs: 12 });
  const recibo = comandoNoLedger(agregado);
  assert.deepEqual(recibo.junit, agregado.junit);
  assert.deepEqual((recibo.lanes as Array<Record<string, unknown>>).map((l) => l.junit),
    [evidencia('a.xml', 6), evidencia('b.xml', 6)]);

  const sucesso = comandoNoLedger({ ...resultado('test', 'runner', true), junit: evidencia('ok.xml', 3) });
  assert.deepEqual(sucesso.junit, evidencia('ok.xml', 3), 'comando verde tambem leva as contagens');
});

test('RM081 L2: sem relatorio o Agile conserva o teto legado de dez nomes', () => {
  const semJUnit = (nome: string, inicio: number): ResultadoDeComando => ({ nome, comando: nome, ok: false, code: 1,
    resumo: '', causa: 'exit', executado: true, testeQueCaiu: Array.from({ length: 6 }, (_, i) => `${nome}-${inicio + i}`) });
  const agregado = testDasLanes([
    { lane: 'a', resultado: semJUnit('a', 1) }, { lane: 'b', resultado: semJUnit('b', 7) },
  ]);
  assert.equal(agregado.testeQueCaiu?.length, 10);
  assert.equal(agregado.junit, undefined);
});

test('RM081 L3: lanes declaradas escrevem e preservam JUnit no Agile', () => {
  const p = projetoTemporario('rm081-lanes-junit');
  try {
    p.carregado.manifesto.verify = { test: 'runner completo', preparo: 'prepara' };
    p.carregado.manifesto.check = { mode: 'agile', agile: { produto: ['README.md'],
      test: { a: 'runner a', b: 'runner b' }, junit: { a: 'reports/a.xml', b: 'reports/b.xml' } } };
    fs.mkdirSync(path.join(p.dir, 'reports'));
    const { thread } = novaThread(p.carregado, { nome: 'lanes junit', modo: 'auto' });
    const executor = (nome: string, comando: string): ResultadoDeComando => {
      if (nome.startsWith('test:')) {
        const lane = nome.slice('test:'.length);
        const casos = Array.from({ length: 6 }, (_, i) => ({ nome: `${lane}-${i + 1}`, estado: 'failure' as const }));
        fs.writeFileSync(path.join(p.dir, `reports/${lane}.xml`), xmlDosCasos(casos));
        return resultado(nome, comando);
      }
      return resultado(nome, comando, true);
    };
    const r = verificar(p.carregado, thread.id, { executor });
    const teste = r.comandos.find((c) => c.nome === 'test')!;
    assert.equal(teste.testeQueCaiu?.length, 12, JSON.stringify({ comandos: r.comandos, agile: r.agile, preparo: r.preparo }));
    assert.deepEqual(teste.lanes?.map((l) => l.junit?.estado), ['lido', 'lido']);
    assert.deepEqual(teste.junit, { caminho: 'reports/a.xml;reports/b.xml', estado: 'lido',
      testes: 12, falhas: 12, erros: 0, pulados: 0, duracaoMs: 12 });
  } finally { p.limpar(); }
});
