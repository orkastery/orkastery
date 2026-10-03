/**
 * RM-038 (fatia de correcao): o universo do indice e o mesmo da busca, definido num lugar so.
 *
 * Hermetico: dublê de memoria, ponte falsa em node para o transporte e embedder de teste. A parte
 * que fala com a biblioteca OrkMind de verdade esta em rm038-universo-ponte.test.ts.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { carregarManifesto, ManifestoCarregado } from '../src/manifest';
import { abrirMemoria } from '../src/memoria';
import { COLECOES_DO_ORK, DriverCliOrkMind, DriverEmMemoria, pertenceAoUniverso } from '../src/orkmind';
import { conferirUniverso, FonteDoUniverso, universoDaBusca } from '../src/indice-vetorial';
import { EntradaDeMemoria, ForaDaBusca } from '../src/types';

const T = 'fabrica';

function entrada(id: string, collection = 'decision', project: string[] = [T], content = `comum ${id}`): EntradaDeMemoria {
  return { id, collection, content, tags: { project }, priority: 'medium', mandatory: false,
    scope: 'project', source: 'agent', metadata: {}, criadaEm: '2026-10-02T00:00:00Z' };
}

/** Tenant em todas as colecoes do ork, mais o que nunca entra no universo. */
function povoado(): DriverEmMemoria {
  const d = new DriverEmMemoria([
    entrada('d2'), entrada('d1'), entrada('r1', 'rule'), entrada('l1', 'learning'), entrada('h1', 'handoff'),
    entrada('m1', 'roadmap'), entrada('inj', 'learning'), entrada('exp', 'roadmap'), entrada('ses', 'session'),
    entrada('alheia', 'decision', ['outro-produto']), entrada('vizinha', 'rule', [`${T}-x`]),
  ]);
  d.marcarForaDaBusca('inj', 'injecao');
  d.marcarForaDaBusca('exp', 'expiradas');
  return d;
}
const IDS_DO_UNIVERSO = ['d1', 'd2', 'h1', 'l1', 'm1', 'r1'];

function fonteFixa(entradas: EntradaDeMemoria[], foraDaBusca: ForaDaBusca | null = null) {
  const pedidos: string[] = [];
  const fonte: FonteDoUniverso = { universo: (tenant) => { pedidos.push(tenant); return { entradas, foraDaBusca }; } };
  return { fonte, pedidos };
}

function manifesto(): { carregado: ManifestoCarregado; raiz: string; limpar: () => void } {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm038-'));
  fs.writeFileSync(path.join(raiz, 'orkastery.yaml'), `project:
  name: "${T}"
  abbrev: "fab"
memory:
  mode: orkmind
  tenant: ${T}
  database_url_env: "TESTE_RM038_DSN"
  embedding:
    provider: openrouter
    model: "org/primario"
    dim: 32
    api_key_env: "TESTE_RM038_KEY"
`);
  const carregado = carregarManifesto(raiz)!;
  assert.deepEqual(carregado.erros, []);
  return { carregado, raiz, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

/** Ponte falsa em node: o driver de verdade, o processo filho trocado (sem Python e sem base). */
function ponteFalsa(corpo: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm038-ponte-'));
  const runner = path.join(dir, 'python');
  fs.writeFileSync(runner, `#!${process.execPath}\n${corpo}`, { mode: 0o755 });
  const cli = path.join(dir, 'orkmind');
  fs.writeFileSync(cli, `#!${runner}\n`, { mode: 0o755 });
  return { driver: new DriverCliOrkMind({ cli, dsn: 'dsn-de-teste-rm038', variavel: 'TESTE_RM038_DSN', timeoutMs: 5000 }),
    limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const responder = (resposta: unknown) => `console.log(${JSON.stringify(JSON.stringify(resposta))});`;
const json = (e: EntradaDeMemoria) => ({ id: e.id, collection: e.collection, content: e.content, tags: e.tags });

test('rm038 universo: dominio le a fonte uma vez pelo tenant, ordena e conta por colecao', () => {
  const fora = { injecao: 5, expiradas: 0, outrasColecoes: 13 };
  const { fonte, pedidos } = fonteFixa([entrada('r1', 'rule'), entrada('d2'), entrada('d1'), entrada('h1', 'handoff')], fora);
  const u = universoDaBusca(fonte, T);
  assert.deepEqual(pedidos, [T]);
  assert.equal(u.tenant, T);
  assert.deepEqual(u.entradas.map(e => `${e.collection}/${e.id}`), ['decision/d1', 'decision/d2', 'handoff/h1', 'rule/r1']);
  assert.deepEqual(u.porColecao, { decision: 2, handoff: 1, rule: 1, learning: 0, roadmap: 0 });
  assert.deepEqual(Object.keys(u.porColecao), [...COLECOES_DO_ORK]);
  assert.deepEqual(u.foraDaBusca, fora);
  assert.equal(universoDaBusca(fonteFixa([]).fonte, T).foraDaBusca, null);
});

test('rm038 universo: dominio recusa outro tenant, outra colecao e id repetido, nunca descarta em silencio', () => {
  for (const [rotulo, ruim] of [
    ['outro tenant', entrada('x', 'decision', ['outro-produto'])],
    ['tenant parecido', entrada('x', 'decision', [`${T}-x`])],
    ['colecao fora do ork', entrada('x', 'session')],
    ['id repetido', entrada('d1', 'rule')],
  ] as const) {
    assert.throws(() => universoDaBusca(fonteFixa([entrada('d1'), ruim]).fonte, T),
      (e: Error) => e.message === 'memory.query.scope-violation', rotulo);
    assert.throws(() => conferirUniverso([entrada('d1'), ruim], T), /memory\.query\.scope-violation/, rotulo);
  }
  assert.equal(pertenceAoUniverso(entrada('d1'), T), true);
  assert.equal(pertenceAoUniverso({ ...entrada('d1'), tags: {} }, T), false);
});

test('rm038 universo: transporte manda so op e tenant e confere o envelope e cada entrada', () => {
  const pedido = path.join(os.tmpdir(), `ork-rm038-pedido-${process.pid}.json`);
  const p = ponteFalsa(`require('fs').writeFileSync(${JSON.stringify(pedido)}, require('fs').readFileSync(0, 'utf8'));
    ${responder({ entradas: [json(entrada('d1')), json(entrada('r1', 'rule'))], foraDaBusca: { injecao: 1, expiradas: 2, outrasColecoes: 3 } })}`);
  try {
    const r = p.driver.universo(T);
    assert.deepEqual(JSON.parse(fs.readFileSync(pedido, 'utf8')), { op: 'universo', tenant: T });
    assert.deepEqual(r.entradas.map(e => e.id), ['d1', 'r1']);
    assert.deepEqual(r.foraDaBusca, { injecao: 1, expiradas: 2, outrasColecoes: 3 });
  } finally { p.limpar(); fs.rmSync(pedido, { force: true }); }
});

test('rm038 universo: transporte recusa entrada alheia, envelope invalido e repassa a saturacao da ponte', () => {
  const casos: [string, unknown, RegExp][] = [
    ['outro tenant', { entradas: [json(entrada('x', 'decision', ['outro-produto']))], foraDaBusca: null }, /^memory\.query\.scope-violation$/],
    ['outra colecao', { entradas: [json(entrada('x', 'session'))], foraDaBusca: null }, /^memory\.query\.scope-violation$/],
    ['sem entradas', { foraDaBusca: null }, /^memory\.transport\.universo$/],
    ['lista solta', [json(entrada('d1'))], /^memory\.transport\.universo$/],
    ['contagem negativa', { entradas: [], foraDaBusca: { injecao: -1, expiradas: 0, outrasColecoes: 0 } }, /^memory\.transport\.universo$/],
    ['contagem incompleta', { entradas: [], foraDaBusca: { injecao: 1 } }, /^memory\.transport\.universo$/],
    ['entrada sem id', { entradas: [{ collection: 'decision', content: 'x', tags: { project: [T] } }], foraDaBusca: null }, /^memory\.transport\.universo$/],
  ];
  for (const [rotulo, resposta, erro] of casos) {
    const p = ponteFalsa(responder(resposta));
    try { assert.throws(() => p.driver.universo(T), (e: Error) => erro.test(e.message), rotulo); } finally { p.limpar(); }
  }
  for (const codigo of ['memory.query.window-saturated', 'memory.universo.invalid', 'memory.query.scope-violation']) {
    const p = ponteFalsa(`console.log(JSON.stringify({ error: ${JSON.stringify(codigo)} })); process.exit(1);`);
    try { assert.throws(() => p.driver.universo(T), (e: Error) => e.message === codigo, codigo); } finally { p.limpar(); }
  }
  // Pedido invalido nao chega a resolver o executavel: o driver aponta para um caminho que nao existe.
  const ausente = new DriverCliOrkMind({ cli: '/nao-existe/orkmind', dsn: 'dsn', variavel: 'TESTE', timeoutMs: 50 });
  for (const ruim of ['', '   ', 'a\u0000b', 'x'.repeat(129)]) {
    assert.throws(() => ausente.universo(ruim), (e: Error) => e.message === 'memory.universo.invalid', JSON.stringify(ruim));
  }
});

test('rm038 universo: invariante no dublê alinhado, universo igual a leitura por tag e ao FTS do termo comum', () => {
  const m = manifesto();
  const d = povoado();
  try {
    const memoria = abrirMemoria(m.carregado, { driver: d });
    const u = universoDaBusca(memoria, T);
    assert.deepEqual(u.entradas.map(e => e.id).sort(), IDS_DO_UNIVERSO);
    assert.deepEqual(u.foraDaBusca, { injecao: 1, expiradas: 1, outrasColecoes: 1 });
    for (const c of COLECOES_DO_ORK) {
      const porTag = memoria.buscar({ collection: c, tags: { project: [T] } }).map(e => e.id).sort();
      assert.deepEqual(u.entradas.filter(e => e.collection === c).map(e => e.id).sort(), porTag, c);
    }
    assert.deepEqual([...d.buscarTexto(T, 'comum')].sort(), IDS_DO_UNIVERSO);
    assert.ok(!d.buscarTexto(T, 'comum').some(id => ['inj', 'exp', 'ses', 'alheia', 'vizinha'].includes(id)));
    assert.deepEqual(d.buscarTexto('outro-produto', 'comum'), ['alheia']);
    assert.throws(() => memoria.universo('outro-produto'), /memory\.tenant\.mismatch/);
  } finally { m.limpar(); }
});
