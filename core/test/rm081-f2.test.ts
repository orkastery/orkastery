/** RM-081 F2: testes de relogio declarados por comando JUnit e protegidos sob steal. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerLedger } from '../src/ledger';
import { comLocale } from '../src/locale';
import { carregarManifesto, NOME_MANIFESTO } from '../src/manifest';
import { dirThread, novaThread } from '../src/thread';
import { MarcacaoDeRelogio, ResultadoDeComando } from '../src/types';
import { gravarBaseline, textoDoVerify, verificar } from '../src/verify';
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

function resultado(nome: string, comando: string, ok: boolean): ResultadoDeComando {
  return { nome, comando, ok, code: ok ? 0 : 1, resumo: '', causa: 'exit', executado: true, duracaoMs: 1 };
}

function xml(falhas: readonly string[]): string {
  const nomes = [...new Set(['mede tempo', 'afirma comum', ...falhas])];
  return `<testsuite>${nomes.map((nome) => `<testcase classname="runner" name="${nome}">` +
    (falhas.includes(nome) ? '<failure/>' : '') + '</testcase>').join('')}</testsuite>`;
}

/** Janela sintetica com a mesma porcentagem em todas as leituras do verify e do comando. */
function procStatComSteal(pct: number): () => string {
  let n = 0;
  return () => {
    n++;
    return `cpu  1000 0 500 ${2_000_000 + n * (100 - pct)} 0 0 0 ${n * pct} 0 0\n`;
  };
}

function cenarioClassic(nome: string, pct: number, falhas: string[], retesteOk = true,
  comFiltro = true, marcacao: MarcacaoDeRelogio = { nome: ['tempo$'] }):
  { p: ProjetoDeTeste; thread: string; comandos: string[]; r: ReturnType<typeof verificar> } {
  const p = projetoTemporario(nome);
  fs.mkdirSync(path.join(p.dir, 'reports'));
  p.carregado.manifesto.verify = { test: 'runner completo', junit: { test: 'reports/junit.xml' },
    ...(comFiltro ? { filtro: { test: 'runner parcial {testes}' } } : {}),
    relogio: { test: marcacao } };
  p.carregado.manifesto.check = { mode: 'classic' };
  const thread = novaThread(p.carregado, { nome, modo: 'auto' }).thread.id;
  gravarBaseline(p.carregado, thread, (n, comando) => {
    fs.writeFileSync(path.join(p.dir, 'reports/junit.xml'), xml([]));
    return resultado(n, comando, true);
  }, {}, 'cli', procStatComSteal(0), 'classic');
  const comandos: string[] = [];
  const r = verificar(p.carregado, thread, { check: 'classic', lerProcStat: procStatComSteal(pct),
    executor: (n, comando) => {
      comandos.push(comando);
      const segunda = comandos.length > 1;
      const destaPassagem = segunda ? (retesteOk ? [] : ['mede tempo']) : falhas;
      fs.writeFileSync(path.join(p.dir, 'reports/junit.xml'), xml(destaPassagem));
      return resultado(n, comando, destaPassagem.length === 0);
    } });
  return { p, thread, comandos, r };
}

test('RM081 F2 M3: marcador e tag declaram um comando JUnit dedicado em execucao', () => {
  for (const marcacao of [{ marcador: 'desempenho' }, { tag: '@tempo' }] as MarcacaoDeRelogio[]) {
    const c = cenarioClassic(`rm081-f2-dedicado-${Object.keys(marcacao)[0]}`, 70,
      ['afirma comum'], true, true, marcacao);
    try {
      assert.deepEqual(c.comandos, ['runner completo', "runner parcial 'runner :: afirma comum'"]);
      assert.deepEqual(c.r.estouros[0].relogioSobSteal, ['runner :: afirma comum']);
      assert.equal(c.r.estouros[0].retesteDeRelogio?.estado, 'passou');
    } finally { c.p.limpar(); }
  }
});

test('RM081 F2 V1: steal alto protege somente marcados e a segunda rodada usa o filtro existente sem ficar verde', () => {
  const c = cenarioClassic('rm081-f2-protegido', 70, ['mede tempo']);
  try {
    assert.deepEqual(c.comandos, ['runner completo', "runner parcial 'runner :: mede tempo'"]);
    assert.equal(c.r.ok, false, 'a segunda rodada verde nao promove o primeiro resultado a verde');
    assert.deepEqual(c.r.motivos, ['verify.timeout']);
    assert.deepEqual(c.r.estouros[0].relogioSobSteal, ['runner :: mede tempo']);
    assert.deepEqual(c.r.estouros[0].retesteDeRelogio,
      { testes: ['runner :: mede tempo'], estado: 'passou', code: 0 });
  } finally { c.p.limpar(); }
});

test('RM081 F2 V2: assercao comum sob steal e teste marcado sem steal alto continuam regressao', () => {
  const comum = cenarioClassic('rm081-f2-comum', 80, ['mede tempo', 'afirma comum']);
  try {
    assert.deepEqual(comum.comandos, ['runner completo'], 'falha comum impede qualquer reteste atenuante');
    assert.deepEqual(comum.r.regressoes.map((x) => x.nome), ['test']);
    assert.ok(!comum.r.motivos.includes('verify.timeout'));
  } finally { comum.p.limpar(); }

  const semSteal = cenarioClassic('rm081-f2-sem-steal', 40, ['mede tempo']);
  try {
    assert.deepEqual(semSteal.comandos, ['runner completo']);
    assert.deepEqual(semSteal.r.regressoes.map((x) => x.nome), ['test']);
    assert.ok(!semSteal.r.motivos.includes('verify.timeout'));
  } finally { semSteal.p.limpar(); }
});

test('RM081 F2 L1: ledger e texto pt-BR e ingles dizem nomes, steal e resultado da segunda rodada', () => {
  const c = cenarioClassic('rm081-f2-ledger', 75, ['mede tempo'], false);
  try {
    const evento = lerLedger(dirThread(c.p.dir, c.thread)).filter((e) => e.tipo === 'verify_run').at(-1)!;
    const comando = (evento.comandos as Array<Record<string, unknown>>)[0];
    assert.deepEqual(comando.retesteDeRelogio,
      { testes: ['runner :: mede tempo'], estado: 'reprovou', code: 1 });
    const pt = comLocale('pt-BR', () => textoDoVerify(c.r));
    const en = comLocale('en', () => textoDoVerify(c.r));
    assert.match(pt, /relogio protegido: runner :: mede tempo; steal 75%; segunda rodada reprovou \(codigo 1\)/);
    assert.match(en, /protected clock test\(s\): runner :: mede tempo; 75% steal; second run failed \(exit 1\)/);
    const gate = lerLedger(dirThread(c.p.dir, c.thread)).filter((e) => e.tipo === 'gate_blocked').at(-1)!;
    assert.match(String(gate.detalhe), /runner :: mede tempo; steal 75%; segunda rodada reprovou/);
  } finally { c.p.limpar(); }
});

test('RM081 F2 A1: Agile preserva o reteste por lane e sem a declaracao conserva a falha comum', () => {
  for (const marcado of [true, false]) {
    const p = projetoTemporario(`rm081-f2-agile-${marcado ? 'marcado' : 'legado'}`);
    try {
      fs.writeFileSync(path.join(p.dir, 'produto.txt'), 'produto');
      fs.mkdirSync(path.join(p.dir, 'reports'));
      p.carregado.manifesto.verify = { test: 'runner completo', preparo: 'prepara' };
      p.carregado.manifesto.check = { mode: 'agile', agile: { produto: ['produto.txt'],
        test: { a: 'runner a completo', b: 'runner b completo' },
        junit: { a: 'reports/a.xml', b: 'reports/b.xml' },
        filtro: { a: 'runner a parcial {testes}' },
        ...(marcado ? { relogio: { a: { nome: ['tempo$'] } } } : {}) } };
      const thread = novaThread(p.carregado, { nome: `agile ${marcado}`, modo: 'auto' }).thread.id;
      const comandos: string[] = [];
      const r = verificar(p.carregado, thread, { check: 'agile', lerProcStat: procStatComSteal(80),
        executor: (nome, comando) => {
          comandos.push(comando);
          if (nome === 'test:a') {
            const falhas = comando.includes('parcial') ? [] : ['mede tempo'];
            fs.writeFileSync(path.join(p.dir, 'reports/a.xml'), xml(falhas));
            return resultado(nome, comando, falhas.length === 0);
          }
          if (nome === 'test:b') fs.writeFileSync(path.join(p.dir, 'reports/b.xml'), xml([]));
          return resultado(nome, comando, true);
        } });
      const agregado = r.comandos.find((c) => c.nome === 'test')!;
      if (marcado) {
        assert.deepEqual(comandos, ['prepara', 'runner a completo', "runner a parcial 'runner :: mede tempo'", 'runner b completo']);
        assert.deepEqual(agregado.retesteDeRelogio,
          { testes: ['runner :: mede tempo'], estado: 'passou', code: 0 });
        assert.deepEqual(agregado.lanes?.find((l) => l.lane === 'a')?.retesteDeRelogio,
          { testes: ['runner :: mede tempo'], estado: 'passou', code: 0 });
        assert.deepEqual(r.motivos, ['verify.timeout']);
      } else {
        assert.deepEqual(comandos, ['prepara', 'runner a completo', 'runner b completo']);
        assert.equal(agregado.retesteDeRelogio, undefined);
        assert.deepEqual(r.motivos, ['verify.failed'], 'sem relogio declarado vale o julgamento anterior');
      }
    } finally { p.limpar(); }
  }
});
