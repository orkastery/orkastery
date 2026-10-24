/**
 * RM-072 (D3 a D8, T3 da ork-check5x): o motor do Agile Check no verify. O reaproveitamento do preparo com a guarda do
 * produto (os passos saem da frente e, desde a T8, do meio da cadeia de `&&`), o `build` que sai do preparo, o preparo do
 * Agile com fallback, as lanes no lugar do `verify.test`, o grupo paralelo pelo processo auxiliar, o relatorio das pecas e
 * o Agile sem `check.agile`, que roda os mesmos comandos do Classic. Os nomes comecam por "AGn:".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { adicionarClaim } from '../src/claims';
import { elosDoComando, GuardaDoProduto, hashDoProduto, passosDoComando, testDasLanes, tirarPassosDoPreparo } from '../src/check-agil';
import { rodarEmParalelo } from '../src/check-paralelo';
import { lerLedger } from '../src/ledger';
import { carregarManifesto } from '../src/manifest';
import { dirThread, novaThread } from '../src/thread';
import { gravarBaseline, identidadeDoProduto, textoDoVerify, verificar, ExecutorVerify } from '../src/verify';
import { comLocale } from '../src/locale';
import type { ResultadoDeComando } from '../src/types';
import { ajustarManifesto, commitar, projetoTemporario } from './apoio';

type Projeto = ReturnType<typeof projetoTemporario>;

/** O executor que so registra o que rodaria e responde ok (ou o que `responder` disser). */
function gravador(responder: (nome: string, comando: string) => Partial<ResultadoDeComando> = () => ({})):
  { executor: ExecutorVerify; lista: Array<[string, string]> } {
  const lista: Array<[string, string]> = [];
  return {
    lista,
    executor: (nome, comando) => {
      lista.push([nome, comando]);
      return { nome, comando, ok: true, code: 0, resumo: '', causa: 'exit', prazoMs: 1000, duracaoMs: 1, executado: true, ...responder(nome, comando) };
    },
  };
}

/** O manifesto com preparo de dois passos, build igual ao primeiro passo e o bloco `check` pedido. */
function comAgile(p: Projeto, agile: string, verify: { test?: string; scan?: string } = {}): void {
  ajustarManifesto(p, '  # build: nao detectado', '  build: "echo passo-a"');
  ajustarManifesto(p, '  # test: nao detectado', `  test: "${verify.test ?? 'echo test'}"\n  preparo: "echo passo-a && echo passo-b"` +
    (verify.scan ? `\n  security_scan: "${verify.scan}"` : ''));
  fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), `\ncheck:\n  mode: agile\n${agile}\n`);
  p.carregado = carregarManifesto(p.dir)!;
  assert.deepEqual(p.carregado.erros, []);
}

function ultimoVerify(p: Projeto, id: string): Record<string, unknown> {
  return lerLedger(dirThread(p.dir, id)).filter((e) => e.tipo === 'verify_run').at(-1)!;
}

test('AG1: os passos do preparo saem da frente do comando so na forma exata, e o resto fica intacto', () => {
  const preparo = passosDoComando('npm --prefix core run build && npm --prefix core run build:test');
  assert.deepEqual(preparo, ['npm --prefix core run build', 'npm --prefix core run build:test']);
  assert.deepEqual(tirarPassosDoPreparo('npm --prefix core run build && npm --prefix core run build:test && node --test x.js', preparo),
    { passos: preparo, resto: 'node --test x.js' });
  assert.deepEqual(tirarPassosDoPreparo('npm --prefix core run build && node --test "a && b"', preparo),
    { passos: ['npm --prefix core run build'], resto: 'node --test "a && b"' });
  assert.deepEqual(tirarPassosDoPreparo('npm --prefix core run build:test', preparo), { passos: ['npm --prefix core run build:test'], resto: '' });
  assert.deepEqual(tirarPassosDoPreparo('npm  --prefix core run build && x', preparo), { passos: [], resto: 'npm  --prefix core run build && x' });
  assert.deepEqual(tirarPassosDoPreparo('node --test x.js', preparo), { passos: [], resto: 'node --test x.js' });
});

test('AG2: o hash do produto muda com conteudo, permissao e arquivo que some; a guarda diz cada motivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-ag2-'));
  try {
    fs.mkdirSync(path.join(dir, 'out', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'out', 'a.js'), 'a');
    fs.writeFileSync(path.join(dir, 'out', 'sub', 'b.js'), 'b');
    const h1 = hashDoProduto(dir, ['out']);
    assert.equal(hashDoProduto(dir, ['out']), h1, 'estavel');
    fs.chmodSync(path.join(dir, 'out', 'a.js'), 0o755);
    const h2 = hashDoProduto(dir, ['out']);
    assert.notEqual(h2, h1, 'permissao de execucao conta');
    fs.writeFileSync(path.join(dir, 'out', 'sub', 'b.js'), 'B');
    assert.notEqual(hashDoProduto(dir, ['out']), h2, 'conteudo conta');
    assert.notEqual(hashDoProduto(dir, ['out', 'nao-existe']), hashDoProduto(dir, ['out']), 'caminho ausente conta');
    let identidade = 'i1';
    const guarda = new GuardaDoProduto(dir, ['out'], () => identidade, null);
    assert.equal(guarda.conferir(), null);
    identidade = 'i2';
    assert.equal(guarda.conferir(), 'arvore-mudou');
    identidade = 'i1';
    fs.writeFileSync(path.join(dir, 'out', 'a.js'), 'mudou');
    assert.equal(guarda.conferir(), 'produto-mudou');
    assert.equal(new GuardaDoProduto(dir, undefined, () => 'i', null).conferir(), 'produto-nao-declarado');
    assert.equal(new GuardaDoProduto(dir, ['out'], () => 'i', 'preparo-falhou').conferir(), 'preparo-falhou');
    assert.equal(new GuardaDoProduto(dir, ['out'], () => 'i', 'sem-preparo').conferir(), 'sem-preparo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AG3: com a guarda valendo, a claim roda sem os passos do preparo e o build sai do preparo; no Classic, tudo inteiro', () => {
  const p = projetoTemporario('ag3');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"');
    const { thread: t } = novaThread(p.carregado, { nome: 'reaproveita', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'com preparo', verificar: ['echo passo-a && echo passo-b && echo c1'] });
    const agile = gravador();
    const r = verificar(p.carregado, t.id, { executor: agile.executor });
    assert.equal(r.ok, true, r.motivos.join(','));
    assert.deepEqual(agile.lista, [['preparo', 'echo passo-a && echo passo-b'], ['C1.1', 'echo c1'], ['test', 'echo test']]);
    const exec = r.claims[0].execucoes[0];
    assert.equal(exec.comando, 'echo passo-a && echo passo-b && echo c1', 'o comando gravado e o inteiro');
    assert.equal(exec.comandoExecutado, 'echo c1');
    assert.deepEqual(exec.preparo, { reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] });
    assert.equal(r.comandos[0].nome, 'build');
    assert.deepEqual(r.comandos[0].preparo, { reaproveitado: true, passos: ['echo passo-a'] });
    const e = ultimoVerify(p, t.id);
    assert.deepEqual((e.claims as Array<Record<string, unknown>>)[0].preparo, [{ reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] }]);
    assert.deepEqual((e.comandos as Array<Record<string, unknown>>)[0].preparo, { reaproveitado: true, passos: ['echo passo-a'] });
    const classic = gravador();
    verificar(p.carregado, t.id, { executor: classic.executor, check: 'classic' });
    assert.deepEqual(classic.lista, [['preparo', 'echo passo-a && echo passo-b'], ['C1.1', 'echo passo-a && echo passo-b && echo c1'],
      ['build', 'echo passo-a'], ['test', 'echo test']]);
  } finally { p.limpar(); }
});

test('AG4: produto mudado entre o preparo e a claim recompila (comando inteiro) e grava o motivo', () => {
  const p = projetoTemporario('ag4');
  try {
    fs.mkdirSync(path.join(p.dir, 'out'));
    fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v1');
    comAgile(p, '  agile:\n    produto:\n      - "out"');
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), 'out/\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'muda', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'mexe no produto', verificar: [`echo v2 > ${path.join(p.dir, 'out', 'p.js')}`] });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'depois', verificar: ['echo passo-a && echo passo-b && echo c2'] });
    const real: ExecutorVerify = (nome, comando, cwd) => {
      if (comando.startsWith('echo v2')) fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v2');
      return { nome, comando, ok: true, code: 0, resumo: '', causa: 'exit', prazoMs: 1000, duracaoMs: 1, executado: true, ...(cwd ? {} : {}) };
    };
    const r = verificar(p.carregado, t.id, { executor: real });
    const exec = r.claims[1].execucoes[0];
    assert.equal(exec.comandoExecutado, undefined, 'rodou inteiro');
    assert.deepEqual(exec.preparo, { reaproveitado: false, motivo: 'produto-mudou' });
  } finally { p.limpar(); }
});

test('AG5: sem check.agile.produto, nada e reaproveitado: claim e build rodam inteiros, com o motivo', () => {
  const p = projetoTemporario('ag5');
  try {
    comAgile(p, '  agile:\n    preparo: "echo passo-a && echo passo-b"');
    const { thread: t } = novaThread(p.carregado, { nome: 'sem produto', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'com preparo', verificar: ['echo passo-a && echo c1'] });
    const g = gravador();
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.deepEqual(g.lista.map(([n, c]) => `${n}=${c}`), ['preparo=echo passo-a && echo passo-b', 'C1.1=echo passo-a && echo c1',
      'build=echo passo-a', 'test=echo test']);
    assert.deepEqual(r.claims[0].execucoes[0].preparo, { reaproveitado: false, motivo: 'produto-nao-declarado' });
  } finally { p.limpar(); }
});

test('AG6: preparo que falha nao deixa nada ser reaproveitado; o motivo e preparo-falhou', () => {
  const p = projetoTemporario('ag6');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"');
    const { thread: t } = novaThread(p.carregado, { nome: 'preparo falha', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'com preparo', verificar: ['echo passo-a && echo passo-b && echo c1'] });
    const g = gravador((nome) => (nome === 'preparo' ? { ok: false, code: 2 } : {}));
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.equal(r.claims[0].execucoes[0].comando, 'echo passo-a && echo passo-b && echo c1');
    assert.deepEqual(r.claims[0].execucoes[0].preparo, { reaproveitado: false, motivo: 'preparo-falhou' });
    assert.ok(g.lista.some(([n]) => n === 'build'), 'o build roda');
  } finally { p.limpar(); }
});

test('AG7: o preparo do Agile que passa e o usado; o que falha cai para o verify.preparo, com a peca no ledger', () => {
  const p = projetoTemporario('ag7');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    preparo: "echo rapido"');
    const { thread: t } = novaThread(p.carregado, { nome: 'preparo agil', modo: 'auto' });
    const passa = gravador();
    verificar(p.carregado, t.id, { executor: passa.executor });
    assert.deepEqual(passa.lista[0], ['preparo', 'echo rapido']);
    assert.deepEqual((ultimoVerify(p, t.id).agile as Record<string, unknown>).pecas, [{ peca: 'preparo', estado: 'agile' }]);
    const falha = gravador((_nome, comando) => (comando === 'echo rapido' ? { ok: false, code: 127, causa: 'nao-encontrado' } : {}));
    const r = verificar(p.carregado, t.id, { executor: falha.executor });
    assert.deepEqual(falha.lista.slice(0, 2), [['preparo', 'echo rapido'], ['preparo', 'echo passo-a && echo passo-b']]);
    assert.equal(r.preparo?.resultado.comando, 'echo passo-a && echo passo-b');
    const pecas = (ultimoVerify(p, t.id).agile as Record<string, unknown>).pecas as Array<Record<string, unknown>>;
    assert.deepEqual(pecas[0], { peca: 'preparo', estado: 'fallback', motivo: 'saiu com codigo 127: echo rapido', fallback: 'verify.preparo' });
  } finally { p.limpar(); }
});

test('AG8: lanes no lugar do verify.test; o test agregado fica ok so com todas ok e a baseline compara pelo nome', () => {
  const p = projetoTemporario('ag8');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      hermetica: "echo h"\n      integracao: "echo i"');
    const { thread: t } = novaThread(p.carregado, { nome: 'lanes', modo: 'auto' });
    const verde = gravador();
    gravarBaseline(p.carregado, t.id, verde.executor);
    assert.deepEqual(verde.lista, [['preparo', 'echo passo-a && echo passo-b'], ['test:hermetica', 'echo h'], ['test:integracao', 'echo i']]);
    const vermelho = gravador((nome) => (nome === 'test:integracao' ? { ok: false, code: 1, testeQueCaiu: ['x falha'] } : {}));
    const r = verificar(p.carregado, t.id, { executor: vermelho.executor });
    const t1 = r.comandos.find((c) => c.nome === 'test')!;
    assert.equal(t1.ok, false);
    assert.deepEqual(t1.testeQueCaiu, ['x falha']);
    assert.deepEqual(t1.lanes?.map((l) => [l.lane, l.ok]), [['hermetica', true], ['integracao', false]]);
    assert.deepEqual(r.regressoes.map((c) => c.nome), ['test'], 'passava na baseline (lanes verdes) e falha agora');
    const e = ultimoVerify(p, t.id);
    assert.deepEqual((e.comandos as Array<Record<string, unknown>>).map((c) => c.nome), ['build', 'test']);
  } finally { p.limpar(); }
});

test('AG9: lanes sem a guarda caem para o verify.test, em serie, com as pecas em fallback', () => {
  const p = projetoTemporario('ag9');
  try {
    comAgile(p, '  agile:\n    test:\n      hermetica: "echo h"', { scan: 'echo scan' });
    const { thread: t } = novaThread(p.carregado, { nome: 'sem guarda', modo: 'auto' });
    const g = gravador();
    verificar(p.carregado, t.id, { executor: g.executor });
    assert.deepEqual(g.lista.slice(1), [['build', 'echo passo-a'], ['test', 'echo test'], ['security_scan', 'echo scan']]);
    const pecas = (ultimoVerify(p, t.id).agile as Record<string, unknown>).pecas as Array<Record<string, unknown>>;
    assert.deepEqual(pecas, [
      { peca: 'grupo', estado: 'fallback', motivo: 'produto-nao-declarado', fallback: 'comandos em serie' },
      { peca: 'lanes', estado: 'fallback', motivo: 'produto-nao-declarado', fallback: 'verify.test' }]);
  } finally { p.limpar(); }
});

test('AG10: o grupo pelo auxiliar real roda ao mesmo tempo, com a saida e a duracao de cada comando', () => {
  const p = projetoTemporario('ag10');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      a: "sleep 2 && echo lane-a"\n      b: "sleep 2 && echo lane-b"',
      { scan: 'sleep 2 && echo varredura' });
    const { thread: t } = novaThread(p.carregado, { nome: 'paralelo', modo: 'auto' });
    const inicio = Date.now();
    const r = verificar(p.carregado, t.id, {});
    const parede = Date.now() - inicio;
    assert.equal(r.ok, true, r.motivos.join(','));
    assert.ok(parede < 5500, `tres comandos de 2 s em paralelo (${parede} ms)`);
    const teste = r.comandos.find((c) => c.nome === 'test')!;
    assert.ok((teste.duracaoMs ?? 0) >= 1900);
    assert.deepEqual(teste.lanes?.map((l) => l.lane), ['a', 'b']);
    const scan = r.comandos.find((c) => c.nome === 'security_scan')!;
    assert.match(scan.resumo, /varredura/);
    assert.ok((scan.duracaoMs ?? 0) >= 1900);
    const agile = ultimoVerify(p, t.id).agile as Record<string, unknown>;
    assert.equal((agile.grupo as Record<string, unknown>).paralelo, true);
  } finally { p.limpar(); }
});

test('AG11: no grupo, cada comando tem o proprio prazo: o que estoura sai como timeout e os outros terminam', () => {
  const r = rodarEmParalelo([
    { nome: 'curto', comando: 'echo pronto', cwd: os.tmpdir(), prazoMs: 30_000 },
    { nome: 'longo', comando: 'sleep 30', cwd: os.tmpdir(), prazoMs: 1_000 },
  ]);
  assert.equal(r[0].ok, true);
  assert.match(r[0].stdout, /pronto/);
  assert.equal(r[1].ok, false);
  assert.equal(r[1].code, 124, 'o timeout(1) mata no prazo');
  assert.ok(r[1].duracaoMs >= 900 && r[1].duracaoMs < 20_000, String(r[1].duracaoMs));
});

test('AG12: com executor injetado, os comandos do grupo passam um por vez, na ordem canonica', () => {
  const p = projetoTemporario('ag12');
  try {
    ajustarManifesto(p, '  # typecheck: nao detectado', '  typecheck: "echo tc"');
    comAgile(p, '  agile:\n    produto:\n      - "README.md"', { scan: 'echo scan' });
    const { thread: t } = novaThread(p.carregado, { nome: 'injetado', modo: 'auto' });
    const g = gravador();
    verificar(p.carregado, t.id, { executor: g.executor });
    assert.deepEqual(g.lista.map(([n]) => n), ['preparo', 'typecheck', 'test', 'security_scan'], 'build saiu do preparo');
  } finally { p.limpar(); }
});

test('AG13: sem check.agile, o Agile roda os mesmos comandos do Classic, na mesma ordem', () => {
  const p = projetoTemporario('ag13');
  try {
    ajustarManifesto(p, '  # typecheck: nao detectado', '  typecheck: "echo tc"');
    ajustarManifesto(p, '  # build: nao detectado', '  build: "echo b"');
    ajustarManifesto(p, '  # test: nao detectado', '  test: "echo t"\n  security_scan: "echo s"\n  preparo: "echo prep"');
    const { thread: t } = novaThread(p.carregado, { nome: 'sem bloco', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'x', verificar: ['echo prep && echo c'] });
    const agile = gravador(), classic = gravador();
    verificar(p.carregado, t.id, { executor: agile.executor });
    verificar(p.carregado, t.id, { executor: classic.executor, check: 'classic' });
    assert.deepEqual(agile.lista, classic.lista);
    assert.deepEqual(agile.lista.map(([n]) => n), ['preparo', 'C1.1', 'typecheck', 'build', 'test', 'security_scan']);
  } finally { p.limpar(); }
});

test('AG14: o relatorio das pecas chega ao verify_run: pecas, lanes com contagem e sha256, e a lista inteira em arquivo', () => {
  const p = projetoTemporario('ag14');
  try {
    const lista = 'echo \'{"tipo":"lista","lane":"h","arquivos":["b.test.js","a.test.js"]}\' >> $ORK_CHECK_RELATORIO';
    const peca = 'echo \'{"tipo":"peca","peca":"imagem-de-lint","estado":"fallback","motivo":"sem rede","fallback":"eslint do catalogo"}\' >> $ORK_CHECK_RELATORIO';
    comAgile(p, `  agile:\n    produto:\n      - "README.md"\n    test:\n      h: "${lista}"`, { scan: peca });
    const { thread: t } = novaThread(p.carregado, { nome: 'relatorio', modo: 'auto' });
    const r = verificar(p.carregado, t.id, {});
    assert.equal(r.ok, true, r.motivos.join(',') + JSON.stringify(r.comandos));
    const agile = ultimoVerify(p, t.id).agile as Record<string, unknown>;
    const lanes = agile.lanes as Array<Record<string, unknown>>;
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0].lane, 'h');
    assert.equal(lanes[0].arquivos, 2);
    assert.match(String(lanes[0].sha256), /^[0-9a-f]{64}$/);
    const evidencia = path.join(p.dir, String(agile.evidencia));
    assert.deepEqual(JSON.parse(fs.readFileSync(evidencia, 'utf8')).lanes[0].arquivos, ['a.test.js', 'b.test.js']);
    assert.ok((agile.pecas as Array<Record<string, unknown>>).some((x) => x.peca === 'imagem-de-lint' && x.estado === 'fallback'
      && x.fallback === 'eslint do catalogo'));
  } finally { p.limpar(); }
});

test('AG15: o test das lanes junta a evidencia de quem caiu e a pior causa', () => {
  const ok = (lane: string): { lane: string; resultado: ResultadoDeComando } =>
    ({ lane, resultado: { nome: `test:${lane}`, comando: `run ${lane}`, ok: true, code: 0, resumo: 'ok', causa: 'exit', duracaoMs: 10, executado: true } });
  const caiu: { lane: string; resultado: ResultadoDeComando } = { lane: 'b', resultado: { nome: 'test:b', comando: 'run b', ok: false, code: -1,
    resumo: 'estourou', causa: 'timeout', duracaoMs: 99, executado: true, testeQueCaiu: ['t1'], trecho: 'saida' } };
  const t = testDasLanes([ok('a'), caiu]);
  assert.equal(t.nome, 'test');
  assert.equal(t.ok, false);
  assert.equal(t.code, -1);
  assert.equal(t.causa, 'timeout');
  assert.equal(t.duracaoMs, 99);
  assert.deepEqual(t.testeQueCaiu, ['t1']);
  assert.equal(t.comando, 'a: run a; b: run b');
  assert.ok(t.resumo.includes('[b] estourou'));
});

test('AG16: a identidade do produto e a do verify (mesma funcao), para a guarda e o fim da rodada concordarem', () => {
  const p = projetoTemporario('ag16');
  try {
    const antes = identidadeDoProduto(p.dir);
    commitar(p.dir, 'novo.txt', 'x\n', 'muda o HEAD');
    assert.notEqual(identidadeDoProduto(p.dir), antes);
  } finally { p.limpar(); }
});

test('AG17: check.agile valida cada chave: caminho fora da raiz, lane com nome ruim e tipo errado sao erro; chave desconhecida avisa', () => {
  const p = projetoTemporario('ag17');
  try {
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\ncheck:\n  mode: agile\n  agile:\n    produto:\n      - "/abs"\n      - "../fora"\n' +
      '      - ".orkastery/x"\n      - "core/dist/"\n    preparo: 3\n    test:\n      "Lane Ruim": "echo x"\n      boa: "echo y"\n    oxlint: "sim"\n    outra: 1\n');
    const m = carregarManifesto(p.dir)!;
    assert.deepEqual(m.erros, [
      'check.agile.produto: "/abs" precisa ser um caminho relativo dentro da raiz, fora de .orkastery e .git',
      'check.agile.produto: "../fora" precisa ser um caminho relativo dentro da raiz, fora de .orkastery e .git',
      'check.agile.produto: ".orkastery/x" precisa ser um caminho relativo dentro da raiz, fora de .orkastery e .git',
      'check.agile.preparo precisa ser o comando, em texto (recebido 3)',
      'check.agile.test.Lane Ruim: nome de lane aceita [a-z0-9-], ate 32 caracteres',
      'check.agile.oxlint precisa ser true ou false (recebido "sim")',
    ]);
    assert.ok(m.avisos.some((a) => /^check\.agile\.outra desconhecida/.test(a)), m.avisos.join('; '));
    assert.deepEqual(m.manifesto.check?.agile, { produto: ['core/dist'], test: { boa: 'echo y' } });
  } finally { p.limpar(); }
});

test('AG18: o texto do verify diz o reaproveitamento, o grupo e cada peca em fallback, nas duas linguas', () => {
  const p = projetoTemporario('ag18');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    preparo: "echo rapido"\n    test:\n      h: "echo h"', { scan: 'echo s' });
    const { thread: t } = novaThread(p.carregado, { nome: 'texto agil', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'x', verificar: ['echo passo-a && echo passo-b && echo c'] });
    const g = gravador((_nome, comando) => (comando === 'echo rapido' ? { ok: false, code: 127, causa: 'nao-encontrado' } : {}));
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    const texto = textoDoVerify(r);
    assert.match(texto, /\n {2}agile {7}1 comando\(s\) de claim contra o produto do preparo, 0 inteiro\(s\); grupo em paralelo com as lanes h\n/);
    assert.match(texto, /\n {2}fallback {4}preparo: saiu com codigo 127: echo rapido; rodou verify\.preparo\n/);
    const ingles = comLocale('en', () => textoDoVerify(r));
    assert.match(ingles, /\n {2}agile {7}1 claim command\(s\) against the prepared product, 0 in full; parallel group with lanes h\n/);
    assert.match(ingles, /\n {2}fallback {4}preparo: saiu com codigo 127: echo rapido; ran verify\.preparo\n/);
  } finally { p.limpar(); }
});

test('AG19: os passos do preparo saem tambem do meio da cadeia de && de nivel de topo, e so de la', () => {
  const preparo = passosDoComando('npm --prefix core run build && npm --prefix core run build:test');
  const [build, buildTest] = preparo;
  const tirar = (c: string): { passos: string[]; resto: string } => tirarPassosDoPreparo(c, preparo);
  assert.deepEqual(tirar(`grep -q x f && ${build} && ${buildTest} && node --test y.js`), { passos: preparo, resto: 'grep -q x f && node --test y.js' });
  assert.deepEqual(tirar(`node -e "a && ${build}" && ${buildTest} && z`), { passos: [buildTest], resto: `node -e "a && ${build}" && z` },
    'dentro de aspas nao e elo');
  assert.deepEqual(tirar(`awk '/x/{f++} END{exit f}' f && ${build} && z`), { passos: [build], resto: "awk '/x/{f++} END{exit f}' f && z" },
    'chave dentro de aspas simples nao atrapalha');
  assert.deepEqual(tirar(`a || b && ${build} && c`), { passos: [build], resto: 'a || b && c' }, '(a || b) && build && c vale (a || b) && c');
  assert.deepEqual(tirar(`a || ${build} && c`), { passos: [], resto: `a || ${build} && c` }, 'passo dentro do braco do || fica');
  assert.deepEqual(tirar(`${build} | tee log && c`), { passos: [], resto: `${build} | tee log && c` }, 'passo com pipe nao e o passo');
  assert.deepEqual(tirar(`${build} > /dev/null && c`), { passos: [], resto: `${build} > /dev/null && c` }, 'com redirecionamento tambem nao');
  assert.deepEqual(tirar(`echo a \\&\\& ${build} && c`), { passos: [], resto: `echo a \\&\\& ${build} && c` }, '&& escapado nao separa');
  // O que o leitor nao acompanha so perde os passos da frente.
  for (const meio of ['echo $(date)', 'echo `date`', '(cd x)', '{ x; }', 'echo "${X:-"a && b"}"', "echo $'a\\'b'", 'x # comentario', 'cat <<FIM']) {
    assert.equal(elosDoComando(`${build} && ${meio} && ${buildTest} && c`), null, meio);
    assert.deepEqual(tirar(`${build} && ${meio} && ${buildTest} && c`), { passos: [build], resto: `${meio} && ${buildTest} && c` }, meio);
  }
  assert.equal(elosDoComando('echo "aberta && x'), null, 'aspas abertas');
  assert.deepEqual(elosDoComando('a&&b &&  c'), ['a', 'b', 'c']);
  assert.deepEqual(tirar(`${build}&&c`), { passos: [build], resto: 'c' });
});

test('AG20: a claim com o build no meio roda sem ele contra o produto do preparo; com o produto mudado, inteira', () => {
  const p = projetoTemporario('ag20');
  try {
    fs.mkdirSync(path.join(p.dir, 'out'));
    fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v1');
    comAgile(p, '  agile:\n    produto:\n      - "out"');
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), 'out/\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'meio', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'meio', verificar: ['grep -q x README.md && echo passo-a && echo passo-b && echo c1'] });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'mexe', verificar: ['echo v2'] });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'depois', verificar: ['grep -q x README.md && echo passo-a && echo c3'] });
    const g = gravador((_nome, comando) => {
      if (comando === 'echo v2') fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v2');
      return {};
    });
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.deepEqual(g.lista.slice(0, 4), [['preparo', 'echo passo-a && echo passo-b'], ['C1.1', 'grep -q x README.md && echo c1'],
      ['C2.1', 'echo v2'], ['C3.1', 'grep -q x README.md && echo passo-a && echo c3']]);
    const [c1, , c3] = r.claims.map((c) => c.execucoes[0]);
    assert.equal(c1.comando, 'grep -q x README.md && echo passo-a && echo passo-b && echo c1', 'o comando gravado e o inteiro');
    assert.equal(c1.comandoExecutado, 'grep -q x README.md && echo c1');
    assert.deepEqual(c1.preparo, { reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] });
    assert.equal(c3.comandoExecutado, undefined, 'rodou inteiro');
    assert.deepEqual(c3.preparo, { reaproveitado: false, motivo: 'produto-mudou' });
  } finally { p.limpar(); }
});
