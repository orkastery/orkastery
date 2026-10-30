/**
 * RM-072 (D3 a D8, T3 da ork-check5x): o motor do Agile Check no verify. O reaproveitamento do preparo com a guarda do
 * produto (os passos saem so da frente da cadeia de `&&`, e o preparo e refeito quando so o produto mudou), o `build` que
 * sai do preparo, o preparo do Agile com fallback, as lanes no lugar do `verify.test`, o grupo paralelo pelo processo
 * auxiliar, o relatorio das pecas e o Agile sem `check.agile`, que roda os mesmos comandos do Classic. Os nomes comecam
 * por "AGn:".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { adicionarClaim } from '../src/claims';
import { assinaturaDoAmbiente, elosDoComando, executorDaClaimPelasLanes, GuardaDoProduto, hashDoProduto,
  MAXIMO_DE_PREPAROS_REFEITOS, paralelismoDaVarreduraNoGrupo, passosDoComando, PECA_SEM_RELATORIO, RelatorioDoCheck,
  testDasLanes, TETO_DO_RELATORIO_BYTES, tirarPassosDoPreparo, tirarPassosDoPreparoAposLeituras } from '../src/check-agil';
import { argvDoItem, rodarEmParalelo } from '../src/check-paralelo';
import { cargaDoProcLoadavg, paredeAgileSimulada, paredeClassicaSimulada, planejarCpuDoGrupo } from '../src/agendador-cpu';
import { lerLedger } from '../src/ledger';
import { carregarManifesto } from '../src/manifest';
import { dirThread, novaThread } from '../src/thread';
import { gravarBaseline, identidadeDoProduto, semVereditoPorTempo, textoDoVerify, vereditoDaBaseline, verificar,
  ExecutorVerify } from '../src/verify';
import { comLocale } from '../src/locale';
import type { ResultadoDeComando } from '../src/types';
import { exec } from '../src/util';
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
  assert.deepEqual(tirarPassosDoPreparoAposLeituras(
    "grep -q -- '--check classic\\|agile' docs/referencia/cli.md && npm --prefix core run build && npm --prefix core run build:test && node --test x.js", preparo),
  { passos: preparo, resto: "grep -q -- '--check classic\\|agile' docs/referencia/cli.md && node --test x.js" });
  assert.deepEqual(tirarPassosDoPreparoAposLeituras(
    'node edita.js && npm --prefix core run build && node --test x.js', preparo),
  { passos: [], resto: 'node edita.js && npm --prefix core run build && node --test x.js' }, 'comando que pode escrever conserva o build');
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
    assert.equal(r.ok, true, r.motivos.join(',') + JSON.stringify(r.comandos));
    assert.deepEqual(agile.lista, [['preparo', 'echo passo-a && echo passo-b'], ['C1.1', 'echo c1'], ['test', 'echo test']]);
    const exec = r.claims[0].execucoes[0];
    assert.equal(exec.comando, 'echo passo-a && echo passo-b && echo c1', 'o comando gravado e o inteiro');
    assert.equal(exec.comandoExecutado, 'echo c1');
    assert.deepEqual(exec.preparo, { reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] });
    assert.equal(r.comandos[0].nome, 'build');
    assert.deepEqual(r.comandos[0].preparo, { reaproveitado: true, passos: ['echo passo-a'] });
    // A7 do CHECK: o resumo diz o preparo que rodou, nao so os passos tirados.
    assert.equal(r.comandos[0].resumo, 'reaproveitado do preparo desta rodada (echo passo-a && echo passo-b)');
    const e = ultimoVerify(p, t.id);
    assert.deepEqual((e.claims as Array<Record<string, unknown>>)[0].preparo, [{ reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] }]);
    assert.deepEqual((e.comandos as Array<Record<string, unknown>>)[0].preparo, { reaproveitado: true, passos: ['echo passo-a'] });
    const classic = gravador();
    verificar(p.carregado, t.id, { executor: classic.executor, check: 'classic' });
    assert.deepEqual(classic.lista, [['preparo', 'echo passo-a && echo passo-b'], ['C1.1', 'echo passo-a && echo passo-b && echo c1'],
      ['build', 'echo passo-a'], ['test', 'echo test']]);
  } finally { p.limpar(); }
});

test('AG4: produto mudado entre o preparo e a claim faz o preparo rodar de novo antes dela, que reaproveita o preparo novo', () => {
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
    // S-d do CHECK 2: o preparo roda de novo antes da claim, e a guarda nova vale; depois do teto, roda inteira (AG33).
    assert.equal(exec.comandoExecutado, 'echo c2', 'sem os passos do preparo, que rodou de novo antes dela');
    assert.deepEqual(exec.preparo, { reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] });
    const pecas = (ultimoVerify(p, t.id).agile as { pecas: Array<Record<string, unknown>> }).pecas;
    assert.ok(pecas.some((x) => x.peca === 'preparo-refeito' && x.estado === 'agile' && /antes da claim C2\.1/.test(String(x.motivo))),
      JSON.stringify(pecas));
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
    assert.deepEqual((ultimoVerify(p, t.id).agile as Record<string, unknown>).pecas, [{ peca: 'preparo', estado: 'agile' }, PECA_SEM_RELATORIO],
      'com executor injetado, o ledger diz que o ambiente da rodada nao chegou aos comandos');
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
    assert.deepEqual(pecas, [PECA_SEM_RELATORIO,
      { peca: 'grupo', estado: 'fallback', motivo: 'produto-nao-declarado', fallback: 'comandos em serie' },
      { peca: 'lanes', estado: 'fallback', motivo: 'produto-nao-declarado', fallback: 'verify.test' }]);
  } finally { p.limpar(); }
});

test('AG10: o grupo pelo auxiliar real roda ao mesmo tempo, com a saida e a duracao de cada comando', () => {
  const p = projetoTemporario('ag10');
  try {
    // Sentinelas, sem relogio de parede: cada comando marca o inicio, espera, conta quantos outros estao no meio e marca o fim.
    const marca = (n: string): string => `touch ${n}.ini && sleep 1 && k=0 && for f in *.ini; do [ -f \${f%.ini}.fim ] || k=$((k+1)); done && ` +
      `echo $((k-1)) > ${n}.outros && sleep 1 && touch ${n}.fim && echo ${n}`;
    comAgile(p, `  agile:\n    produto:\n      - "README.md"\n    test:\n      a: "${marca('lane-a')}"\n      b: "${marca('lane-b')}"`,
      { scan: marca('varredura') });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), '*.ini\n*.fim\n*.outros\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'paralelo', modo: 'auto' });
    const r = verificar(p.carregado, t.id, { medicaoCpuAgendador: { carga1: 0, stealPct: 0 } });
    assert.equal(r.ok, true, r.motivos.join(',') + JSON.stringify(r.comandos));
    const outros = (n: string): number => Number(fs.readFileSync(path.join(p.dir, `${n}.outros`), 'utf8').trim());
    assert.ok(['lane-a', 'lane-b', 'varredura'].some((n) => outros(n) > 0), 'os tres correram juntos');
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
    const r = verificar(p.carregado, t.id, { medicaoCpuAgendador: { carga1: 0, stealPct: 0 } });
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

test('AG19: os passos do preparo saem so da frente da cadeia; no meio ficam, e o preparo se le pelas aspas', () => {
  const preparo = passosDoComando('npm --prefix core run build && npm --prefix core run build:test');
  const [build, buildTest] = preparo;
  const tirar = (c: string): { passos: string[]; resto: string } => tirarPassosDoPreparo(c, preparo);
  // A1 do CHECK: o que vem antes do passo pode mudar a entrada do build (o mutante que edita o fonte e compila).
  const mutante = `sed -i s/a/b/ core/src/x.ts && ${build} && node --test y.js`;
  assert.deepEqual(tirar(mutante), { passos: [], resto: mutante });
  assert.deepEqual(tirar(`grep -q x f && ${build} && ${buildTest} && z`), { passos: [], resto: `grep -q x f && ${build} && ${buildTest} && z` });
  assert.deepEqual(tirar(`${build} && ${buildTest} && z`), { passos: preparo, resto: 'z' });
  // S8 do CHECK: o preparo com `&&` dentro de aspas nao vira passo falso.
  assert.deepEqual(passosDoComando('node -e "a && b" && npm run build'), ['node -e "a && b"', 'npm run build']);
  assert.deepEqual(elosDoComando('a&&b &&  c'), ['a', 'b', 'c']);
  for (const recusado of ['echo $(date)', 'echo `date`', '(cd x)', '{ x; }', 'echo "${X:-"a && b"}"', "echo $'a\\'b'", 'x # comentario', 'cat <<FIM']) {
    assert.equal(elosDoComando(`${recusado} && b`), null, recusado);
  }
  assert.equal(elosDoComando('echo "aberta && x'), null, 'aspas abertas');
});

test('AG20: a claim com o build depois so de grep reaproveita o preparo, como a da frente', () => {
  const p = projetoTemporario('ag20');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"');
    const { thread: t } = novaThread(p.carregado, { nome: 'meio', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'meio', verificar: ['grep -q x README.md && echo passo-a && echo passo-b && echo c1'] });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'frente', verificar: ['echo passo-a && echo passo-b && echo c2'] });
    const g = gravador();
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.deepEqual(g.lista.slice(1, 3), [['C1.1', 'grep -q x README.md && echo c1'], ['C2.1', 'echo c2']]);
    const [c1, c2] = r.claims.map((c) => c.execucoes[0]);
    assert.equal(c1.comandoExecutado, 'grep -q x README.md && echo c1');
    assert.deepEqual(c1.preparo, { reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] });
    assert.deepEqual(c2.preparo, { reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] });
  } finally { p.limpar(); }
});

test('AG21: a lane de apos_a_varredura entra no grupo depois do security_scan, e o test agregado guarda a ordem do manifesto', () => {
  const p = projetoTemporario('ag21');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      i: "echo i"\n      h: "echo h"\n    apos_a_varredura: ["i"]',
      { scan: 'echo s' });
    const { thread: t } = novaThread(p.carregado, { nome: 'encadeada', modo: 'auto' });
    const g = gravador();
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.equal(r.ok, true, r.motivos.join(',') + JSON.stringify(r.comandos));
    assert.deepEqual(g.lista.slice(1), [['test:h', 'echo h'], ['security_scan', 'echo s'], ['test:i', 'echo i']]);
    assert.deepEqual(r.comandos.map((c) => c.nome), ['build', 'test', 'security_scan']);
    assert.deepEqual(r.comandos[1].lanes?.map((l) => l.lane), ['i', 'h'], 'as lanes na ordem do manifesto');
    // Sem security_scan no manifesto, nada espera.
    const sem = projetoTemporario('ag21-sem');
    try {
      comAgile(sem, '  agile:\n    produto:\n      - "README.md"\n    test:\n      i: "echo i"\n      h: "echo h"\n    apos_a_varredura: ["i"]');
      const { thread: t2 } = novaThread(sem.carregado, { nome: 'sem scan', modo: 'auto' });
      const g2 = gravador();
      verificar(sem.carregado, t2.id, { executor: g2.executor });
      assert.deepEqual(g2.lista.slice(1), [['test:i', 'echo i'], ['test:h', 'echo h']]);
    } finally { sem.limpar(); }
  } finally { p.limpar(); }
});

test('AG22: no auxiliar real, o item com apos so comeca quando o outro termina, e maxParalelo limita quantos rodam juntos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-ag22-'));
  try {
    // Sentinelas, sem relogio: cada item marca o inicio, conta quantos outros estao no meio (inicio sem fim) e marca o fim.
    const item = (nome: string, extra: Partial<{ apos: string[] }> = {}) => ({ nome, cwd: dir, prazoMs: 10000, ...extra,
      comando: `touch ${nome}.ini && sleep 0.2 && n=0 && for f in *.ini; do [ -f "\${f%.ini}.fim" ] || n=$((n+1)); done && ` +
        `echo $((n-1)) > ${nome}.outros && sleep 0.2 && touch ${nome}.fim` });
    const outros = (nome: string): number => Number(fs.readFileSync(path.join(dir, `${nome}.outros`), 'utf8').trim());
    const [a, b] = rodarEmParalelo([item('a'), item('b', { apos: ['a'] })]);
    assert.ok(a.ok && b.ok, `${a.stderr}${b.stderr}`);
    assert.equal(outros('b'), 0, 'b comecou depois do fim de a');
    rodarEmParalelo([item('u0'), item('u1'), item('u2')], process.env, { maxParalelo: 1 });
    assert.deepEqual(['u0', 'u1', 'u2'].map(outros), [0, 0, 0], 'com uma vaga, um por vez');
    rodarEmParalelo([item('j0'), item('j1'), item('j2')]);
    assert.ok(['j0', 'j1', 'j2'].some((n) => outros(n) > 0), 'sem teto, os tres correm juntos');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AG23: check.agile.apos_a_varredura aceita lanes de check.agile.test e recusa o resto', () => {
  const p = projetoTemporario('ag23');
  try {
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\ncheck:\n  agile:\n    test:\n      i: "echo i"\n    apos_a_varredura: ["i", "x", 3]\n');
    const m = carregarManifesto(p.dir)!;
    assert.deepEqual(m.erros, [
      'check.agile.apos_a_varredura: "x" precisa ser uma lane de check.agile.test',
      'check.agile.apos_a_varredura: 3 precisa ser uma lane de check.agile.test',
    ]);
    assert.deepEqual(m.manifesto.check?.agile?.apos_a_varredura, ['i']);
  } finally { p.limpar(); }
});

test('AG24: no grupo real, so a varredura recebe o teto de ferramentas, e a lane encadeada comeca depois dela', () => {
  const p = projetoTemporario('ag24');
  try {
    const arq = (n: string): string => path.join(p.dir, n);
    const grava = (n: string): string => `echo $ORK_CHECK_VARREDURA_PARALELA > ${arq(n)}`;
    // Sentinela, sem relogio: a lane encadeada anota se a varredura ja tinha terminado quando ela comecou.
    const ordem = `if test -f ${arq('s-fim')}; then echo depois > ${arq('i.txt')}; else echo antes > ${arq('i.txt')}; fi`;
    comAgile(p, `  agile:\n    produto:\n      - "README.md"\n    test:\n      h: "${grava('h.txt')}"\n      i: "${ordem}"\n` +
      '    apos_a_varredura: ["i"]', { scan: `${grava('s.txt')} && sleep 0.3 && touch ${arq('s-fim')}` });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), '*.txt\ns-fim\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'grupo real', modo: 'auto' });
    const r = verificar(p.carregado, t.id, {});
    assert.equal(r.ok, true, r.motivos.join(',') + JSON.stringify(r.comandos));
    assert.equal(fs.readFileSync(arq('s.txt'), 'utf8').trim(), String(paralelismoDaVarreduraNoGrupo()));
    assert.equal(fs.readFileSync(arq('h.txt'), 'utf8').trim(), '', 'a lane nao recebe o teto da varredura');
    assert.equal(fs.readFileSync(arq('i.txt'), 'utf8').trim(), 'depois', 'a lane encadeada comecou depois da varredura');
    assert.equal(paralelismoDaVarreduraNoGrupo(7), 2);
    assert.equal(paralelismoDaVarreduraNoGrupo(16), 2);
    assert.equal(paralelismoDaVarreduraNoGrupo(1), 1);
  } finally { p.limpar(); }
});

test('AG25: a peca que dois processos da rodada relatam igual entra uma vez no verify_run', () => {
  const p = projetoTemporario('ag25');
  try {
    const peca = 'echo \'{"tipo":"peca","peca":"cache-semgrep","estado":"fallback","motivo":"m","fallback":"f"}\' >> $ORK_CHECK_RELATORIO';
    comAgile(p, `  agile:\n    produto:\n      - "README.md"\n    test:\n      h: "${peca}"`, { scan: `${peca} && ${peca}` });
    const { thread: t } = novaThread(p.carregado, { nome: 'peca repetida', modo: 'auto' });
    const r = verificar(p.carregado, t.id, {});
    assert.equal(r.ok, true, r.motivos.join(','));
    const pecas = (ultimoVerify(p, t.id).agile as { pecas: Array<Record<string, unknown>> }).pecas;
    assert.equal(pecas.filter((x) => x.peca === 'cache-semgrep').length, 1, JSON.stringify(pecas));
    const texto = textoDoVerify(r);
    assert.equal(texto.split('\n').filter((l) => /^ {2}fallback {4}cache-semgrep:/.test(l)).length, 1, 'uma linha de fallback no texto');
  } finally { p.limpar(); }
});

test('AG26: a claim que muda o produto apos as lanes refaz preparo e grupo sobre o produto final', () => {
  const p = projetoTemporario('ag26');
  try {
    fs.mkdirSync(path.join(p.dir, 'out'));
    fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v1');
    comAgile(p, '  agile:\n    produto:\n      - "out"\n    test:\n      h: "echo h"', { scan: 'echo s' });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), 'out/\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'refaz', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'recompila', verificar: ['echo recompila'] });
    const g = gravador((_nome, comando) => {
      if (comando === 'echo recompila') fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v2');
      return {};
    });
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.equal(r.ok, true, r.motivos.join(','));
    assert.deepEqual(g.lista.map(([n]) => n), ['preparo', 'test:h', 'security_scan', 'C1.1', 'preparo', 'test:h', 'security_scan']);
    const pecas = (ultimoVerify(p, t.id).agile as { pecas: Array<Record<string, unknown>> }).pecas;
    assert.ok(pecas.some((x) => x.peca === 'preparo-refeito' && x.estado === 'agile' && /rodou de novo depois das claims/.test(String(x.motivo))),
      JSON.stringify(pecas));
    assert.ok(pecas.some((x) => x.peca === 'grupo' && x.estado === 'agile') && !pecas.some((x) => x.peca === 'grupo' && x.estado === 'fallback'));
  } finally { p.limpar(); }
});

test('AG27: na juncao das lanes a falha de verdade manda; o relogio sob steal so vale quando toda lane que caiu caiu so nele', () => {
  const base: ResultadoDeComando = { nome: 'x', comando: 'c', ok: true, code: 0, resumo: '', causa: 'exit', prazoMs: 1000, duracaoMs: 1, executado: true };
  const real: ResultadoDeComando = { ...base, ok: false, code: 1, testeQueCaiu: ['quebrou'] };
  const estouro: ResultadoDeComando = { ...base, ok: false, code: 124, causa: 'timeout' };
  const relogio: ResultadoDeComando = { ...base, ok: false, code: 1, relogioSobSteal: ['prazo de 15 s'] };
  const juntar = (a: ResultadoDeComando, b: ResultadoDeComando): ResultadoDeComando =>
    testDasLanes([{ lane: 'a', resultado: a }, { lane: 'b', resultado: b }]);
  const t1 = juntar(estouro, real);
  assert.equal(t1.causa, 'exit');
  assert.equal(t1.code, 1);
  assert.equal(semVereditoPorTempo(t1), false, 'o estouro de uma lane nao esconde a falha de verdade da outra');
  const t2 = juntar(relogio, real);
  assert.equal(t2.relogioSobSteal, undefined);
  assert.equal(semVereditoPorTempo(t2), false, 'o relogio de uma lane nao esconde a falha de verdade da outra');
  const t3 = juntar(relogio, { ...relogio, relogioSobSteal: ['outro'] });
  assert.deepEqual(t3.relogioSobSteal, ['prazo de 15 s', 'outro']);
  assert.equal(semVereditoPorTempo(t3), true);
  const t4 = juntar(estouro, relogio);
  assert.equal(t4.causa, 'timeout');
  assert.equal(semVereditoPorTempo(t4), true);
  assert.equal(juntar(real, { ...real, testeQueCaiu: ['outro'] }).executado, true, 'so falhas de verdade: o test tem veredito');
});

test('AG28: as claims recebem o modo e nunca o relatorio da rodada; a lane recebe os dois', () => {
  const p = projetoTemporario('ag28');
  try {
    const arq = (n: string): string => path.join(p.dir, n);
    comAgile(p, `  agile:\n    produto:\n      - "README.md"\n    test:\n      h: "echo modo=$ORK_CHECK_MODO rel=$ORK_CHECK_RELATORIO > ${arq('lane.txt')}"`);
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), '*.txt\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'ambiente', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'le o ambiente',
      verificar: [`echo "modo=$ORK_CHECK_MODO rel=$ORK_CHECK_RELATORIO" > ${arq('claim.txt')}`] });
    const r = verificar(p.carregado, t.id, {});
    assert.equal(r.ok, true, r.motivos.join(',') + JSON.stringify(r.comandos));
    assert.equal(fs.readFileSync(arq('claim.txt'), 'utf8').trim(), 'modo=agile rel=');
    assert.match(fs.readFileSync(arq('lane.txt'), 'utf8'), /^modo=agile rel=\/.+pecas\.jsonl$/m);
  } finally { p.limpar(); }
});

test('AG29: a baseline do Agile grava as pecas do preparo, do grupo e do relatorio; com executor injetado, a peca relatorio', () => {
  const p = projetoTemporario('ag29');
  try {
    const peca = 'echo \'{"tipo":"peca","peca":"imagem-de-lint","estado":"fallback","motivo":"sem rede","fallback":"eslint do catalogo"}\' >> $ORK_CHECK_RELATORIO';
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    preparo: "echo rapido"', { scan: peca });
    const { thread: t } = novaThread(p.carregado, { nome: 'baseline agil', modo: 'auto' });
    const ultima = (): Array<Record<string, unknown>> =>
      ((lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'baseline_recorded').at(-1)!.agile ?? { pecas: [] }) as
        { pecas: Array<Record<string, unknown>> }).pecas;
    gravarBaseline(p.carregado, t.id);
    assert.ok(ultima().some((x) => x.peca === 'preparo' && x.estado === 'agile'), JSON.stringify(ultima()));
    assert.ok(ultima().some((x) => x.peca === 'imagem-de-lint' && x.estado === 'fallback'));
    gravarBaseline(p.carregado, t.id, gravador().executor);
    assert.ok(ultima().some((x) => x.peca === 'relatorio' && x.estado === 'fallback'), JSON.stringify(ultima()));
  } finally { p.limpar(); }
});

test('AG30: o auxiliar que morre sem gravar o resultado deixa os comandos sem veredito, nunca uma regressao', () => {
  const p = projetoTemporario('ag30');
  try {
    fs.writeFileSync(path.join(p.dir, 'mata.sh'), 'p=$PPID\nwhile [ -n "$p" ] && [ "$p" != 1 ] && ! grep -q check-paralelo /proc/$p/cmdline 2>/dev/null; ' +
      'do p=$(cut -d" " -f4 /proc/$p/stat); done\nkill -9 "$p"\n');
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), 'mata.sh\n');
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      h: "bash mata.sh"', { scan: 'sleep 1 && echo s' });
    const { thread: t } = novaThread(p.carregado, { nome: 'auxiliar morto', modo: 'auto' });
    const r = verificar(p.carregado, t.id, {});
    const teste = r.comandos.find((c) => c.nome === 'test')!;
    assert.equal(teste.executado, false, JSON.stringify(teste));
    assert.ok(r.motivos.includes('verify.sem-veredito'), r.motivos.join(','));
    assert.ok(!r.motivos.includes('verify.regression'));
  } finally { p.limpar(); }
});

test('AG31: falha de verdade numa lane com outra sem veredito: o tempo e a lane que nao rodou deixam o test sem veredito inteiro, o resto da o codigo dela; na baseline e sem-veredito', () => {
  const base: ResultadoDeComando = { nome: 'x', comando: 'c', ok: true, code: 0, resumo: '', causa: 'exit', prazoMs: 1000, duracaoMs: 1, executado: true };
  const real: ResultadoDeComando = { ...base, ok: false, code: 1, testeQueCaiu: ['quebrou'] };
  const semVeredito: ResultadoDeComando[] = [
    { ...base, ok: false, code: 124, causa: 'timeout' },
    { ...base, ok: false, code: 1, relogioSobSteal: ['prazo de 15 s'] },
    { ...base, ok: false, code: 137, causa: 'sinal' },
    { ...base, ok: false, code: 127, causa: 'nao-encontrado' },
    { ...base, ok: false, code: -1, executado: false },
  ];
  for (const outra of semVeredito) {
    const t = testDasLanes([{ lane: 'a', resultado: real }, { lane: 'b', resultado: outra }]);
    // RM-074 (F4): so o tempo e a lane que nao rodou tiram o veredito inteiro; o sinal e o comando ausente dao o codigo deles.
    const inteiro = outra.causa === 'timeout' || !!outra.relogioSobSteal?.length || outra.executado === false;
    assert.equal(t.executado, !inteiro, JSON.stringify(outra));
    if (!inteiro) assert.equal(t.code, outra.code, 'o codigo e o da lane que nao terminou sozinha');
    assert.equal(t.causa, 'exit', 'a causa e a da falha de verdade');
    assert.deepEqual(t.testeQueCaiu, ['quebrou']);
    assert.equal(vereditoDaBaseline(t), 'sem-veredito', JSON.stringify(outra));
  }
  assert.equal(vereditoDaBaseline(testDasLanes([{ lane: 'a', resultado: real }, { lane: 'b', resultado: real }])), 'ja-falhava');
  // N4 do CHECK 3: a lane sai com o codigo de quem nao a deixou terminar (o `timeout` de dentro, o shell, o sinal) com causa
  // `exit`: o test so e `ja-falhava` quando a outra lane tambem seria, e nas duas ordens das lanes.
  for (const code of [1, 2, 123, 124, 125, 126, 127, 128, 137, 143, 160, 255]) {
    for (const causa of ['exit', undefined] as const) {
      const outra: ResultadoDeComando = { ...base, ok: false, code, causa };
      const esperado = vereditoDaBaseline(outra) === 'ja-falhava' ? 'ja-falhava' : 'sem-veredito';
      assert.equal(vereditoDaBaseline(testDasLanes([{ lane: 'a', resultado: real }, { lane: 'b', resultado: outra }])), esperado, `${code} ${causa}`);
      assert.equal(vereditoDaBaseline(testDasLanes([{ lane: 'b', resultado: outra }, { lane: 'a', resultado: real }])), esperado, `${code} ${causa} (ordem)`);
    }
  }
  // N6 do CHECK 4: sem falha de verdade, uma lane so de relogio com qualquer outra caida da `sem-veredito` nas duas ordens;
  // a lane sozinha sem veredito tambem, e o estouro e o relogio sozinhos seguem como sem veredito por tempo.
  const soRelogio: ResultadoDeComando = { ...base, ok: false, code: 1, relogioSobSteal: ['prazo de 15 s'] };
  for (const code of [1, 2, 123, 124, 125, 126, 127, 128, 137, 143, 160, 255]) {
    for (const causa of ['exit', undefined] as const) {
      const outra: ResultadoDeComando = { ...base, ok: false, code, causa };
      assert.equal(vereditoDaBaseline(testDasLanes([{ lane: 'a', resultado: soRelogio }, { lane: 'b', resultado: outra }])), 'sem-veredito', `${code} ${causa}`);
      assert.equal(vereditoDaBaseline(testDasLanes([{ lane: 'b', resultado: outra }, { lane: 'a', resultado: soRelogio }])), 'sem-veredito', `${code} ${causa} (ordem)`);
    }
  }
  const sozinha = testDasLanes([{ lane: 'a', resultado: { ...base, ok: false, code: 124, causa: 'exit' } }, { lane: 'b', resultado: base }]);
  // RM-074 (F4): como o comando unico do Classic, a lane que sai com 124 antes do prazo de fora e comparada com a baseline.
  assert.equal(sozinha.executado, true, 'a lane que sai com 124 antes do prazo de fora tem o codigo dela, como no Classic');
  assert.equal(sozinha.code, 124);
  assert.equal(vereditoDaBaseline(sozinha), 'sem-veredito', 'na baseline o 124 nao e da propria lane');
  const estourou = testDasLanes([{ lane: 'a', resultado: { ...base, ok: false, code: 124, causa: 'timeout' } }, { lane: 'b', resultado: base }]);
  assert.equal(estourou.executado, true);
  assert.equal(semVereditoPorTempo(estourou), true, 'o estouro sozinho segue como sem veredito por tempo');

  // No verify: a baseline com as duas lanes caidas de verdade (`ja-falhava`) nao esconde a lane que agora estourou.
  const p = projetoTemporario('ag31');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      a: "echo a"\n      b: "echo b"');
    const { thread: t } = novaThread(p.carregado, { nome: 'lanes mistas', modo: 'auto' });
    gravarBaseline(p.carregado, t.id, gravador((nome) => (nome.startsWith('test:') ? { ok: false, code: 1 } : {})).executor);
    const r = verificar(p.carregado, t.id, { executor: gravador((nome) => nome === 'test:a' ? { ok: false, code: 1 }
      : nome === 'test:b' ? { ok: false, code: 124, causa: 'timeout' } : {}).executor });
    assert.equal(r.ok, false);
    assert.ok(r.motivos.includes('verify.sem-veredito'), r.motivos.join(','));
  } finally { p.limpar(); }
});

test('AG32: a lane que sai com 127 na baseline e dependencia ausente, como o comando so do Classic, mesmo com outra lane caida de verdade', () => {
  const p = projetoTemporario('ag32');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      a: "echo a"\n      b: "ferramenta-que-nao-existe"');
    const { thread: t } = novaThread(p.carregado, { nome: 'lane sem dependencia', modo: 'auto' });
    const g = gravador((nome) => nome === 'test:b' ? { ok: false, code: 127, causa: 'nao-encontrado' }
      : nome === 'test:a' ? { ok: false, code: 1 } : {});
    assert.throws(() => comLocale('pt-BR', () => gravarBaseline(p.carregado, t.id, g.executor)),
      /baseline\.dependencia-ausente: test:b .*codigo 127.*ferramenta-que-nao-existe/);
  } finally { p.limpar(); }
});

test('AG33: o produto que muda numa claim faz o preparo rodar de novo antes da claim seguinte, que volta a reaproveitar, ate o teto da rodada', () => {
  const p = projetoTemporario('ag33');
  try {
    fs.mkdirSync(path.join(p.dir, 'out'));
    fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v0');
    comAgile(p, '  agile:\n    produto:\n      - "out"\n    test:\n      h: "echo h"', { scan: 'echo s' });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), 'out/\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'refaz antes da claim', modo: 'auto' });
    const n = MAXIMO_DE_PREPAROS_REFEITOS + 2;
    for (let i = 1; i <= n; i++) {
      adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: `mexe ${i}`, verificar: [`echo passo-a && echo passo-b && echo mexe-${i}`] });
    }
    let versao = 0;
    const g = gravador((_nome, comando) => {
      if (/echo mexe-\d+$/.test(comando)) fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), `v${++versao}`);
      return {};
    });
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.equal(r.ok, true, r.motivos.join(','));
    // O preparo do comeco, mais um antes de cada claim seguinte ate o teto e, S-h do CHECK 3, mais um so do grupo: a claim
    // depois do teto roda inteira, e o grupo continua em paralelo.
    assert.equal(g.lista.filter(([nome]) => nome === 'preparo').length, 2 + MAXIMO_DE_PREPAROS_REFEITOS);
    for (let i = 1; i <= MAXIMO_DE_PREPAROS_REFEITOS + 1; i++) {
      assert.deepEqual(r.claims[i - 1].execucoes[0].preparo, { reaproveitado: true, passos: ['echo passo-a', 'echo passo-b'] }, `C${i}`);
    }
    assert.deepEqual(r.claims[n - 1].execucoes[0].preparo, { reaproveitado: false, motivo: 'produto-mudou' });
    const pecas = (ultimoVerify(p, t.id).agile as { pecas: Array<Record<string, unknown>> }).pecas;
    const refeitos = pecas.filter((x) => x.peca === 'preparo-refeito');
    assert.equal(refeitos.length, MAXIMO_DE_PREPAROS_REFEITOS + 1, JSON.stringify(pecas));
    assert.ok(refeitos.every((x) => x.estado === 'agile'));
    assert.match(String(refeitos[0].motivo), /antes da claim C2\.1/);
    assert.match(String(refeitos.at(-1)!.motivo), /depois das claims/);
    assert.ok(pecas.some((x) => x.peca === 'grupo' && x.estado === 'agile') && !pecas.some((x) => x.peca === 'grupo' && x.estado === 'fallback'),
      JSON.stringify(pecas));
  } finally { p.limpar(); }
});

test('AG46: claim node --test reaproveita somente arquivos verdes no mesmo HEAD e ambiente, inclusive com padrao', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-ag34-'));
  try {
    const base = gravador((_nome, comando) => comando.includes('grep -q ausente') ? { ok: false, code: 1 } : {});
    const head = 'a'.repeat(40);
    const ambiente = { LANG: 'C.UTF-8', ORKASTERY_HOME: path.join(dir, 'casa'), FEATURE_X: '1' };
    const evidencias = [{ lane: 'hermetica', head, ambiente: assinaturaDoAmbiente(ambiente), testes: [
      { arquivo: 'a.test.js', nome: 'AG1: primeiro', nesting: 0, estado: 'pass' as const },
      { arquivo: 'a.test.js', nome: 'AG2: segundo', nesting: 0, estado: 'pass' as const },
      { arquivo: 'b.test.js', nome: 'AG9: terceiro', nesting: 0, estado: 'pass' as const },
      { arquivo: 'b.test.js', nome: 'dispensado', nesting: 0, estado: 'skip' as const },
      { arquivo: 'c.test.js', nome: 'c.test.js', nesting: 0, estado: 'fail' as const },
    ] }];
    const executar = executorDaClaimPelasLanes(base.executor, evidencias, { head, ambiente });
    const a = executar('C1.1', "node --test --test-name-pattern='caso A$' core/dist-test/test/a.test.js", dir);
    assert.equal(a.ok, true);
    assert.deepEqual(a.lane?.arquivos, ['a.test.js']);
    assert.deepEqual(a.lane?.nomes, ['a.test.js:/caso A$/']);
    const dois = executar('C2.1', 'node --test core/dist-test/test/a.test.js core/dist-test/test/b.test.js', dir);
    assert.deepEqual(dois.lane?.arquivos, ['a.test.js', 'b.test.js']);
    const fechada = executar('C2.2', "grep -q 'conteudo' README.md && node --test-reporter=tap core/dist-test/test/a.test.js | awk '/^ *not ok/{f++} /# SKIP/{s++} /^ *ok [0-9]+ - AG[0-9]+:/{p++} END{exit !(p>=2 && f==0 && s==0)}' && node --test core/dist-test/test/b.test.js", dir);
    assert.deepEqual(fechada.lane?.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(fechada.lane?.nomes.includes('a.test.js:AG>=2;sem-falha;sem-skip'));
    const grepFalhou = executar('C2.3', "grep -q ausente README.md && node --test core/dist-test/test/a.test.js", dir);
    assert.equal(grepFalhou.ok, false, 'a cadeia conserva o curto-circuito do grep');
    executar('C3.1', 'node --test core/dist-test/test/c.test.js', dir);
    executar('C4.1', 'node --test core/dist-test/test/a.test.js && echo aberto', dir);
    executorDaClaimPelasLanes(base.executor, evidencias, { head, ambiente: { ...ambiente, FEATURE_X: '2' } })(
      'C5.1', 'node --test core/dist-test/test/a.test.js', dir);
    executorDaClaimPelasLanes(base.executor, evidencias, { head: 'b'.repeat(40), ambiente })(
      'C6.1', 'node --test core/dist-test/test/a.test.js', dir);
    executar('C7.1', 'bun --test core/dist-test/test/a.test.js', dir);
    executar('C8.1', 'node --test core/dist-test/test/sub/a.test.js', dir);
    executar('C10.1', "node --test --test-name-pattern='[' core/dist-test/test/a.test.js", dir);
    executar('C11.1', "node --test-reporter=tap core/dist-test/test/b.test.js | awk '/^ *not ok/{f++} /# SKIP/{s++} /^ *ok [0-9]+ - AG[0-9]+:/{p++} END{exit !(p>=1 && f==0 && s==0)}'", dir);
    executar('C12.1', "node --test-reporter=tap core/dist-test/test/a.test.js | awk 'END{exit 0}'", dir);
    const equivalente = gravador();
    executorDaClaimPelasLanes(base.executor, evidencias, { head, ambiente, podeReaproveitar: () => false,
      executorEquivalente: equivalente.executor })(
      'C9.1', 'node --test core/dist-test/test/a.test.js', dir);
    assert.deepEqual(base.lista.map(([nome]) => nome), ['C2.2', 'C2.3', 'C3.1', 'C4.1', 'C5.1', 'C6.1', 'C7.1', 'C8.1', 'C10.1', 'C11.1', 'C12.1'],
      'so o grep da cadeia fechada roda; falha, shell aberto, ambiente ou HEAD diferente, outro runner, subdiretorio, regex invalida, skip auditado, awk aberto e produto mudado executam de verdade');
    assert.deepEqual(equivalente.lista.map(([nome]) => nome), ['C9.1'], 'o fallback node --test usa o ambiente das lanes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AG47: com lanes validas, o Agile roda preparo e lanes antes das claims; o Classic conserva a ordem', () => {
  const p = projetoTemporario('ag35');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      h: "echo h"');
    const { thread: t } = novaThread(p.carregado, { nome: 'ordem lane claim', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'depois da lane', verificar: ['echo claim'] });
    const agile = gravador();
    verificar(p.carregado, t.id, { executor: agile.executor });
    assert.deepEqual(agile.lista.map(([nome]) => nome), ['preparo', 'test:h', 'C1.1']);
    const classic = gravador();
    verificar(p.carregado, t.id, { executor: classic.executor, check: 'classic' });
    assert.deepEqual(classic.lista.map(([nome]) => nome), ['preparo', 'C1.1', 'build', 'test']);
  } finally { p.limpar(); }
});

test('AG34: o preparo refeito que falha fica em fallback no ledger, e o resto da rodada roda inteiro, em serie', () => {
  const p = projetoTemporario('ag34');
  try {
    fs.mkdirSync(path.join(p.dir, 'out'));
    fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v0');
    comAgile(p, '  agile:\n    produto:\n      - "out"\n    test:\n      h: "echo h"', { scan: 'echo s' });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), 'out/\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'refeito falha', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'recompila', verificar: ['echo recompila'] });
    let preparos = 0;
    const g = gravador((nome, comando) => {
      if (comando === 'echo recompila') fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v1');
      if (nome === 'preparo' && ++preparos === 2) return { ok: false, code: 2 };
      return {};
    });
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.equal(r.ok, true, r.motivos.join(','));
    const pecas = (ultimoVerify(p, t.id).agile as { pecas: Array<Record<string, unknown>> }).pecas;
    assert.ok(pecas.some((x) => x.peca === 'preparo-refeito' && x.estado === 'fallback' && /saiu com codigo 2/.test(String(x.motivo))
      && x.fallback === 'os comandos inteiros, em serie'), JSON.stringify(pecas));
    assert.ok(pecas.some((x) => x.peca === 'grupo' && x.estado === 'fallback' && x.motivo === 'preparo-falhou'), JSON.stringify(pecas));
    assert.deepEqual(g.lista.slice(-3).map(([nome]) => nome), ['build', 'test', 'security_scan'], 'em serie, com os comandos do Classic');
  } finally { p.limpar(); }
});

test('AG35: as variaveis de outra rodada nao chegam aos comandos; sem a guarda, o verify.test em serie roda sem o relatorio e a varredura com ele', () => {
  const p = projetoTemporario('ag35');
  const antes = { rel: process.env.ORK_CHECK_RELATORIO, teto: process.env.ORK_CHECK_VARREDURA_PARALELA };
  try {
    const arq = (n: string): string => path.join(p.dir, n);
    const eco = (n: string): string => `echo rel=$ORK_CHECK_RELATORIO teto=$ORK_CHECK_VARREDURA_PARALELA > ${arq(n)}`;
    comAgile(p, '  agile:\n    preparo: "echo agil"', { test: eco('test.txt'), scan: eco('scan.txt') });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), '*.txt\n*.jsonl\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'sem vazamento', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'le o ambiente', verificar: [eco('claim.txt')] });
    process.env.ORK_CHECK_RELATORIO = arq('de-outra-rodada.jsonl');
    process.env.ORK_CHECK_VARREDURA_PARALELA = '1';
    const r = verificar(p.carregado, t.id, {});
    assert.equal(r.ok, true, r.motivos.join(',') + JSON.stringify(r.comandos));
    assert.equal(fs.readFileSync(arq('claim.txt'), 'utf8').trim(), 'rel= teto=');
    assert.equal(fs.readFileSync(arq('test.txt'), 'utf8').trim(), 'rel= teto=', 'o verify.test em serie roda sem o relatorio');
    const scan = fs.readFileSync(arq('scan.txt'), 'utf8');
    assert.match(scan, /^rel=\/.+pecas\.jsonl teto=$/m, 'a varredura em serie tem o relatorio desta rodada e nenhum teto herdado');
    assert.ok(!scan.includes('de-outra-rodada'), scan);
  } finally {
    if (antes.rel === undefined) delete process.env.ORK_CHECK_RELATORIO; else process.env.ORK_CHECK_RELATORIO = antes.rel;
    if (antes.teto === undefined) delete process.env.ORK_CHECK_VARREDURA_PARALELA; else process.env.ORK_CHECK_VARREDURA_PARALELA = antes.teto;
    p.limpar();
  }
});

test('AG37: no grupo paralelo, so a varredura e as lanes recebem o relatorio da rodada; o verify.test sem lanes, nao', () => {
  const p = projetoTemporario('ag37');
  try {
    const arq = (n: string): string => path.join(p.dir, n);
    comAgile(p, '  agile:\n    produto:\n      - "README.md"', { test: `echo rel=$ORK_CHECK_RELATORIO > ${arq('test.txt')}`,
      scan: `echo rel=$ORK_CHECK_RELATORIO > ${arq('scan.txt')}` });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), '*.txt\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'grupo sem relatorio', modo: 'auto' });
    const r = verificar(p.carregado, t.id, {});
    assert.equal(r.ok, true, r.motivos.join(','));
    const pecas = (ultimoVerify(p, t.id).agile as { pecas: Array<Record<string, unknown>> }).pecas;
    assert.ok(pecas.some((x) => x.peca === 'grupo' && x.estado === 'agile'), JSON.stringify(pecas));
    assert.equal(fs.readFileSync(arq('test.txt'), 'utf8').trim(), 'rel=');
    assert.match(fs.readFileSync(arq('scan.txt'), 'utf8'), /^rel=\/.+pecas\.jsonl$/m);
  } finally { p.limpar(); }
});

test('AG38: o preparo refeito que falha antes de uma claim fica em fallback, e a claim roda inteira com o motivo', () => {
  const p = projetoTemporario('ag38');
  try {
    fs.mkdirSync(path.join(p.dir, 'out'));
    fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v0');
    comAgile(p, '  agile:\n    produto:\n      - "out"\n    test:\n      h: "echo h"', { scan: 'echo s' });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), 'out/\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'refeito falha na claim', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'recompila', verificar: ['echo recompila'] });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'depois', verificar: ['echo passo-a && echo passo-b && echo c2'] });
    let preparos = 0;
    const g = gravador((nome, comando) => {
      if (comando === 'echo recompila') fs.writeFileSync(path.join(p.dir, 'out', 'p.js'), 'v1');
      if (nome === 'preparo' && ++preparos === 2) return { ok: false, code: 2 };
      return {};
    });
    const r = verificar(p.carregado, t.id, { executor: g.executor });
    assert.equal(r.ok, true, r.motivos.join(','));
    const exec = r.claims[1].execucoes[0];
    assert.equal(exec.comandoExecutado, undefined, 'rodou inteira');
    assert.deepEqual(exec.preparo, { reaproveitado: false, motivo: 'preparo-falhou' });
    const pecas = (ultimoVerify(p, t.id).agile as { pecas: Array<Record<string, unknown>> }).pecas;
    assert.ok(pecas.some((x) => x.peca === 'preparo-refeito' && x.estado === 'fallback' && /antes da claim C2\.1 e saiu com codigo 2/.test(String(x.motivo))),
      JSON.stringify(pecas));
    assert.equal(preparos, 2, 'sem outro preparo antes do grupo: a guarda diz preparo-falhou, nao produto-mudou');
    assert.ok(pecas.some((x) => x.peca === 'grupo' && x.estado === 'fallback' && x.motivo === 'preparo-falhou'), JSON.stringify(pecas));
  } finally { p.limpar(); }
});

test('AG36: o relatorio da rodada e lido ate o teto, e o corte vira peca em fallback', () => {
  const relatorio = new RelatorioDoCheck();
  try {
    const linha = JSON.stringify({ tipo: 'peca', peca: 'x', estado: 'agile' }) + '\n';
    const n = Math.ceil(TETO_DO_RELATORIO_BYTES / linha.length) + 10;
    fs.writeFileSync(relatorio.arquivo, linha.repeat(n));
    const linhas = relatorio.ler();
    assert.ok(linhas.length < n, 'o que passa do teto fica de fora');
    assert.ok(linhas.length >= Math.floor(TETO_DO_RELATORIO_BYTES / linha.length) - 1);
    assert.deepEqual(linhas.at(-1), { tipo: 'peca', peca: 'relatorio', estado: 'fallback',
      motivo: `o relatorio da rodada passou do teto de ${TETO_DO_RELATORIO_BYTES} bytes (${linha.length * n} bytes)`, fallback: 'so as linhas ate o teto' });
  } finally { relatorio.fechar(); }
});

test('AG39: a lane caida sem veredito fora do tempo deixa o test tao estrito quanto o comando unico do Classic, nem mais nem menos (RM-074 F4)', () => {
  // Cada caso: o que a lane `b` devolve no Agile (com a lane `a` caida de verdade) e o que o comando unico do Classic
  // devolveria terminando do mesmo jeito; a baseline dos dois tem o test caido de verdade (`ja-falhava`) ou passando.
  const casos: Array<{ nome: string; lane: Partial<ResultadoDeComando> }> = [
    { nome: 'sinal', lane: { ok: false, code: 137, causa: 'sinal' } },
    { nome: 'comando ausente', lane: { ok: false, code: 127, causa: 'nao-encontrado' } },
    { nome: '124 antes do prazo', lane: { ok: false, code: 124, causa: 'exit' } },
    { nome: '126 do shell', lane: { ok: false, code: 126, causa: 'exit' } },
    { nome: 'nao rodou', lane: { ok: false, code: -1, causa: 'exit', executado: false } },
  ];
  for (const baselinePassava of [false, true]) {
    for (const caso of casos) {
      const motivos = (agile: boolean): string[] => {
        const p = projetoTemporario(`ag39-${agile ? 'a' : 'c'}`);
        try {
          if (agile) comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      a: "echo a"\n      b: "echo b"');
          else {
            ajustarManifesto(p, '  # test: nao detectado', '  test: "echo test"');
            fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\ncheck:\n  mode: classic\n');
            p.carregado = carregarManifesto(p.dir)!;
          }
          const { thread: t } = novaThread(p.carregado, { nome: 'paridade das lanes', modo: 'auto' });
          const caiu = (nome: string): boolean => nome === 'test' || nome.startsWith('test:');
          gravarBaseline(p.carregado, t.id, gravador((nome) => (caiu(nome) && !baselinePassava ? { ok: false, code: 1 } : {})).executor);
          const r = verificar(p.carregado, t.id, { executor: gravador((nome) => nome === 'test:a' ? { ok: false, code: 1 }
            : nome === 'test:b' || nome === 'test' ? caso.lane : {}).executor });
          return r.motivos.filter((m) => m.startsWith('verify.')).sort();
        } finally { p.limpar(); }
      };
      assert.deepEqual(motivos(true), motivos(false), `${caso.nome}, baseline ${baselinePassava ? 'passava' : 'ja falhava'}`);
    }
  }
});

test('AG40: o texto do gate do test sem veredito diz qual lane ficou sem veredito e por que (RM-074 F4)', () => {
  const p = projetoTemporario('ag40');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      hermetica: "echo h"\n      integracao: "echo i"');
    const { thread: t } = novaThread(p.carregado, { nome: 'texto do gate', modo: 'auto' });
    const gates = (): Array<Record<string, unknown>> => lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'gate_blocked');
    let r = verificar(p.carregado, t.id, { executor: gravador((nome) => nome === 'test:integracao'
      ? { ok: false, code: -1, causa: 'exit', executado: false } : {}).executor });
    assert.ok(r.motivos.includes('verify.sem-veredito'), r.motivos.join(','));
    const semVeredito = gates().filter((g) => g.motivo === 'verify.sem-veredito').at(-1)!;
    assert.equal(semVeredito.detalhe, 'test sem veredito (lane integracao: sem codigo de saida: nao rodou, ou o auxiliar do grupo ' +
      'morreu antes de gravar o resultado)');
    r = verificar(p.carregado, t.id, { executor: gravador((nome) => nome === 'test:hermetica' ? { ok: false, code: 1 }
      : nome === 'test:integracao' ? { ok: false, code: 124, causa: 'timeout' } : {}).executor });
    assert.ok(r.motivos.includes('verify.sem-veredito'), r.motivos.join(','));
    assert.equal(gates().filter((g) => g.motivo === 'verify.sem-veredito').at(-1)!.detalhe,
      'test sem veredito (lane hermetica: caiu com o codigo 1; lane integracao: estourou o prazo)');
    r = verificar(p.carregado, t.id, { executor: gravador((nome) => nome === 'test:integracao'
      ? { ok: false, code: 124, causa: 'timeout' } : {}).executor });
    assert.ok(r.motivos.includes('verify.timeout'), r.motivos.join(','));
    assert.match(String(gates().filter((g) => g.motivo === 'verify.timeout').at(-1)!.detalhe), /: test \(lane integracao: estourou o prazo\)$/);
  } finally { p.limpar(); }
});

test('AG41: com a raiz do estado diferente da worktree de onde o verify roda, a evidencia das lanes vai relativa a raiz do estado (RM-074 F4)', () => {
  const p = projetoTemporario('ag41');
  const wt = `${p.dir}-wt`;
  try {
    const lista = 'echo \'{"tipo":"lista","lane":"h","arquivos":["a.test.js"]}\' >> $ORK_CHECK_RELATORIO';
    comAgile(p, `  agile:\n    produto:\n      - "README.md"\n    test:\n      h: "${lista}"`);
    commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'agile');
    const { thread: t } = novaThread(p.carregado, { nome: 'evidencia na raiz do estado', modo: 'auto' });
    const r0 = exec('git', ['worktree', 'add', '-q', '--detach', wt], p.dir);
    assert.ok(r0.ok, r0.stderr);
    const daWorktree = carregarManifesto(wt)!;
    assert.equal(fs.realpathSync(daWorktree.raiz), fs.realpathSync(wt), 'o verify roda da worktree ligada');
    const r = verificar(daWorktree, t.id, {});
    assert.equal(r.ok, true, r.motivos.join(','));
    const agile = ultimoVerify(p, t.id).agile as Record<string, unknown>;
    const evidencia = String(agile.evidencia);
    assert.match(evidencia, new RegExp(`^\\.orkastery/threads/${t.id}/check/[0-9a-f]{12}-lanes\\.json$`));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.dir, evidencia), 'utf8')).lanes[0].arquivos, ['a.test.js']);
    assert.equal(fs.existsSync(path.join(wt, evidencia)), false, 'nada na worktree de onde rodou');
  } finally {
    exec('git', ['worktree', 'remove', '--force', wt], p.dir);
    fs.rmSync(wt, { recursive: true, force: true });
    p.limpar();
  }
});

test('AG42: no ramo do relogio sob steal a juncao das lanes fica com veredito por tempo (executado verdadeiro); a lane que nao rodou tira o veredito (RM-074 F4)', () => {
  const base: ResultadoDeComando = { nome: 'x', comando: 'c', ok: true, code: 0, resumo: '', causa: 'exit', prazoMs: 1000, duracaoMs: 1, executado: true };
  const relogio: ResultadoDeComando = { ...base, ok: false, code: 1, relogioSobSteal: ['prazo de 15 s'] };
  const estouro: ResultadoDeComando = { ...base, ok: false, code: 124, causa: 'timeout' };
  const naoRodou: ResultadoDeComando = { ...base, ok: false, code: -1, executado: false };
  const juntar = (a: ResultadoDeComando, b: ResultadoDeComando): ResultadoDeComando =>
    testDasLanes([{ lane: 'a', resultado: a }, { lane: 'b', resultado: b }]);
  for (const [nome, t] of [['relogio e relogio', juntar(relogio, { ...relogio, relogioSobSteal: ['outro'] })],
    ['relogio e ok', juntar(relogio, base)], ['ok e relogio', juntar(base, relogio)],
    ['estouro e relogio', juntar(estouro, relogio)], ['relogio e estouro', juntar(relogio, estouro)]] as const) {
    assert.equal(t.executado, true, nome);
    assert.equal(semVereditoPorTempo(t), true, nome);
    assert.equal(vereditoDaBaseline(t), 'sem-veredito', nome);
  }
  for (const t of [juntar(relogio, naoRodou), juntar(naoRodou, relogio)]) assert.equal(t.executado, false);

  // No verify: as duas lanes caidas so no relogio dao `verify.timeout`, nunca sem veredito inteiro nem regressao.
  const p = projetoTemporario('ag42');
  try {
    comAgile(p, '  agile:\n    produto:\n      - "README.md"\n    test:\n      a: "echo a"\n      b: "echo b"');
    const { thread: t } = novaThread(p.carregado, { nome: 'ramo do relogio', modo: 'auto' });
    gravarBaseline(p.carregado, t.id, gravador().executor);
    const r = verificar(p.carregado, t.id, { executor: gravador((nome) => nome.startsWith('test:')
      ? { ok: false, code: 1, relogioSobSteal: [`prazo de ${nome}`] } : {}).executor });
    assert.deepEqual(r.motivos.filter((m) => m.startsWith('verify.')), ['verify.timeout']);
    assert.equal(r.comandos.find((c) => c.nome === 'test')!.executado, true);
  } finally { p.limpar(); }
});

test('AG43: o item do grupo com argv roda sem shell: o argumento chega literal, e sem argv o comando segue no bash -c (RM-074 F4)', () => {
  const literal = `'$(echo injetado)' $HOME; echo "fora"`;
  const comArgv = { nome: 'argv', comando: 'identifica', argv: [process.execPath, '-e', 'process.stdout.write(process.argv[1])', literal],
    cwd: os.tmpdir(), prazoMs: 30_000 };
  assert.deepEqual(argvDoItem(comArgv, true, false), ['/usr/bin/timeout', '--kill-after=15', '30', ...comArgv.argv]);
  assert.deepEqual(argvDoItem(comArgv, false, false), comArgv.argv);
  assert.ok(!argvDoItem(comArgv, true, false).includes('bash'), 'sem shell');
  assert.deepEqual(argvDoItem({ nome: 'c', comando: 'echo x', cwd: os.tmpdir(), prazoMs: 1000 }, false, false), ['bash', '-c', 'echo x']);
  const [r, c] = rodarEmParalelo([comArgv, { nome: 'shell', comando: 'echo $((1 + 1))', cwd: os.tmpdir(), prazoMs: 30_000 }]);
  assert.equal(r.ok, true, r.stderr);
  assert.equal(r.stdout, literal, 'nada expandido nem quebrado pelo shell');
  assert.equal(c.stdout.trim(), '2', 'o item sem argv segue pelo bash -c');
});

test('AG44: sob carga sintetica presa em CPU, o plano cai para o Classic e nunca projeta parede maior', () => {
  const trabalho = { hermetica: 700, varredura: 140, integracao: 70 };
  const saturado = planejarCpuDoGrupo(8, { carga1: 8, stealPct: 12 });
  assert.equal(saturado.ordem, 'classic');
  assert.equal(saturado.cpusHermetica, 7);
  assert.equal(saturado.ferramentasDaVarredura, 7);
  assert.equal(saturado.cpusPorContainer, 1);
  assert.ok(paredeAgileSimulada(saturado, trabalho) <= paredeClassicaSimulada(8, trabalho));
  assert.match(saturado.motivo, /carga 8 em \/proc\/loadavg/);
  assert.match(saturado.motivo, /steal 12% em \/proc\/stat/);

  const livre = planejarCpuDoGrupo(8, { carga1: 2, stealPct: 0 });
  assert.equal(livre.ordem, 'paralela');
  assert.equal(livre.cpusHermetica + livre.cpusDaFatia, 8, 'a soma do grupo cabe na maquina');
  assert.equal(livre.cpusHermetica, 6);
  assert.equal(livre.ferramentasDaVarredura, 2);
  assert.equal(livre.cpusPorContainer, 1);
  assert.equal(cargaDoProcLoadavg('7.25 4.0 3.0 1/2 3\n'), 7.25);
  assert.equal(cargaDoProcLoadavg('invalida'), null);
});

test('AG45: saturacao medida pelo verify ordena hermetica, varredura e integracao e registra a peca no verify_run', () => {
  const p = projetoTemporario('ag40');
  try {
    const arq = (nome: string): string => path.join(p.dir, nome);
    const hermetica = `echo "$ORK_CHECK_CPUS_DA_LANE $ORK_CHECK_CPUS_DOCKER" > ${arq('h.cpu')} && sleep 0.2 && touch ${arq('h.fim')}`;
    const scan = `test -f ${arq('h.fim')} && echo "$ORK_CHECK_VARREDURA_PARALELA $ORK_CHECK_CPUS_DOCKER" > ${arq('s.cpu')} && touch ${arq('s.fim')}`;
    const integracao = `test -f ${arq('h.fim')} && test -f ${arq('s.fim')} && ` +
      `echo "$ORK_CHECK_CPUS_DA_LANE $ORK_CHECK_CPUS_DOCKER" > ${arq('i.cpu')}`;
    comAgile(p, `  agile:\n    produto:\n      - "README.md"\n    test:\n      hermetica: "${hermetica}"\n` +
      `      integracao: "${integracao}"\n    apos_a_varredura: ["integracao"]`, { scan });
    fs.appendFileSync(path.join(p.dir, '.git', 'info', 'exclude'), '*.cpu\n*.fim\n');
    const { thread: t } = novaThread(p.carregado, { nome: 'cpu saturada', modo: 'auto' });
    const r = verificar(p.carregado, t.id, { medicaoCpuAgendador: { carga1: os.availableParallelism(), stealPct: 12 } });
    assert.equal(r.ok, true, r.motivos.join(',') + JSON.stringify(r.comandos));
    const classic = Math.max(1, os.availableParallelism() - 1);
    assert.equal(fs.readFileSync(arq('h.cpu'), 'utf8').trim(), `${classic} 1`);
    assert.equal(fs.readFileSync(arq('s.cpu'), 'utf8').trim(), `${classic} 1`);
    assert.equal(fs.readFileSync(arq('i.cpu'), 'utf8').trim(), `${classic} 1`);
    const pecas = (ultimoVerify(p, t.id).agile as { pecas: Array<Record<string, unknown>> }).pecas;
    const agendador = pecas.find((x) => x.peca === 'agendador-cpu')!;
    assert.equal(agendador.estado, 'fallback');
    assert.match(String(agendador.motivo), /\/proc\/loadavg.*\/proc\/stat.*varredura e integracao depois dela/);
    assert.equal(agendador.fallback, 'ordem do Classic para hermetica, varredura e integracao');
  } finally { p.limpar(); }
});
