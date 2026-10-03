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
import { execFileSync } from 'node:child_process';
import { carregarManifesto, ManifestoCarregado } from '../src/manifest';
import { abrirMemoria, estadoDeEmbeddings, textoDoEstado } from '../src/memoria';
import { COLECOES_DO_ORK, DriverCliOrkMind, DriverEmMemoria, PedidoDeEmbedding, pertenceAoUniverso } from '../src/orkmind';
import { conferirUniverso, FonteDoUniverso, indexar, textoDoIndice, universoDaBusca } from '../src/indice-vetorial';
import { buscarPorSignificado, OpcoesDaBusca } from '../src/busca-semantica';
import { ConfigDeEmbedding, EntradaDeMemoria, ForaDaBusca, UniversoDaBusca } from '../src/types';
import { projetoTemporario } from './apoio';

const T = 'fabrica';
const CONFIG: ConfigDeEmbedding = { provider: 'openrouter', model: 'org/primario', dim: 32,
  api_key_env: 'TESTE_RM038_KEY', fallback_model: '', max_tokens_por_execucao: 1_000_000 };

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

function comChave<R>(f: () => R): R {
  const antes = process.env.TESTE_RM038_KEY;
  process.env.TESTE_RM038_KEY = ['chave', 'de', 'teste', 'rm038', 'nunca', 'impressa'].join('-');
  try { return f(); } finally { if (antes === undefined) delete process.env.TESTE_RM038_KEY; else process.env.TESTE_RM038_KEY = antes; }
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

test('rm038 universo: indice embeda so o universo e traz colecoes e fora da busca no relatorio', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm038-indice-'));
  const d = povoado();
  try {
    const u = universoDaBusca(d, T);
    const seco = indexar({ raiz, tenant: T, dsn: '', config: CONFIG, alvo: 'primario', universo: u, dryRun: true, chavePresente: true });
    assert.equal(seco.chamadasAoProvider, 0);
    assert.deepEqual(seco.porColecao, { decision: 2, handoff: 1, rule: 1, learning: 1, roadmap: 1 });
    assert.deepEqual(seco.foraDaBusca, { injecao: 1, expiradas: 1, outrasColecoes: 1 });
    const texto = textoDoIndice(seco);
    assert.match(texto, /universo da busca\s+6 entrada\(s\): decision 2, handoff 1, rule 1, learning 1, roadmap 1; coerentes 0/);
    assert.match(texto, /fora da busca\s+1 com injection_risk, 1 expirada\(s\), 1 em colecoes fora do ork/);
    const r = indexar({ raiz, tenant: T, dsn: '', config: CONFIG, alvo: 'primario', universo: u, dryRun: false, chavePresente: true,
      embeddar: p => d.embeddar(p) });
    assert.equal(r.embedados, 6);
    const enviados = d.pedidosDeEmbedding.flatMap(p => p.textos);
    assert.deepEqual([...enviados].sort(), IDS_DO_UNIVERSO.map(id => `comum ${id}`));
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('rm038 universo: indice recusa entrada alheia antes de qualquer pedido de embed', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm038-indice-'));
  const d = povoado();
  try {
    const u = universoDaBusca(d, T);
    const contaminado: UniversoDaBusca = { ...u, entradas: [...u.entradas, entrada('alheia', 'decision', ['outro-produto'])] };
    assert.throws(() => indexar({ raiz, tenant: T, dsn: '', config: CONFIG, alvo: 'primario', universo: contaminado, dryRun: false,
      chavePresente: true, embeddar: p => d.embeddar(p) }), /memory\.query\.scope-violation/);
    assert.throws(() => indexar({ raiz, tenant: 'outro', dsn: '', config: CONFIG, alvo: 'primario', universo: u, dryRun: false,
      chavePresente: true, embeddar: p => d.embeddar(p) }), /memory\.query\.scope-violation/);
    assert.equal(d.pedidosDeEmbedding.length, 0);
    assert.ok(!fs.existsSync(path.join(raiz, '.orkastery')), 'nada gravado');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

function cenarioDeBusca() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm038-busca-'));
  const d = povoado();
  const u = universoDaBusca(d, T);
  const embeddar = (p: PedidoDeEmbedding) => d.embeddar(p);
  indexar({ raiz, tenant: T, dsn: '', config: CONFIG, alvo: 'primario', universo: u, dryRun: false, chavePresente: true, embeddar });
  const opcoes = (o: Partial<OpcoesDaBusca> = {}): OpcoesDaBusca => ({ raiz, tenant: T, dsn: '', config: CONFIG, universo: u,
    texto: 'comum', modo: 'hibrido', limite: 50, chavePresente: true, fallbackUsavel: false, timeoutMs: 15000, embeddar,
    buscarTexto: (t, q) => d.buscarTexto(t, q), ...o });
  return { raiz, d, u, opcoes, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

test('rm038 universo: busca usa o universo inteiro, restringe a colecao e declara o FTS fora do universo', () => {
  const c = cenarioDeBusca();
  try {
    const tudo = buscarPorSignificado(c.opcoes());
    assert.deepEqual([...new Set(tudo.resultados.map(r => r.id))].sort(), IDS_DO_UNIVERSO);
    assert.equal(tudo.ftsForaDoUniverso, 0);
    assert.deepEqual(tudo.coberturaDoIndice, { coerentes: 6, universo: 6 });
    assert.doesNotMatch(tudo.detalhe, /fora do universo|o indice cobre/);
    const so = buscarPorSignificado(c.opcoes({ colecao: 'decision', buscarTexto: () => ['r1', 'fantasma', 'd1', 'inj'] }));
    assert.ok(so.resultados.length > 0 && so.resultados.every(r => r.collection === 'decision'));
    assert.deepEqual(so.listas.fts, ['d1']);
    assert.equal(so.ftsForaDoUniverso, 2, 'r1 e da colecao nao pedida; fantasma e inj estao fora do universo');
    assert.match(so.detalhe, /fts: 2 id\(s\) fora do universo da busca descartado\(s\)/);
    assert.equal(so.origem, 'primario');
  } finally { c.limpar(); }
});

test('rm038 universo: busca avisa quando o indice cobre menos que o universo e recusa entrada alheia', () => {
  const c = cenarioDeBusca();
  try {
    const maior: UniversoDaBusca = { ...c.u, entradas: [...c.u.entradas, entrada('d3')],
      porColecao: { ...c.u.porColecao, decision: c.u.porColecao.decision + 1 } };
    const r = buscarPorSignificado(c.opcoes({ universo: maior, modo: 'vetor' }));
    assert.equal(r.origem, 'primario');
    assert.deepEqual(r.coberturaDoIndice, { coerentes: 6, universo: 7 });
    assert.match(r.detalhe, /vetor: o indice cobre 6 de 7 entrada\(s\) do universo da busca; rode ork memory index/);
    const fts = buscarPorSignificado(c.opcoes({ modo: 'fts', buscarTexto: () => ['fantasma'] }));
    assert.equal(fts.origem, 'fts', 'id descartado nao e falha do FTS');
    assert.equal(fts.motivo, null);
    const antes = c.d.pedidosDeEmbedding.length;
    const contaminado: UniversoDaBusca = { ...c.u, entradas: [...c.u.entradas, entrada('alheia', 'decision', ['outro-produto'])] };
    assert.throws(() => buscarPorSignificado(c.opcoes({ universo: contaminado })), /memory\.query\.scope-violation/);
    assert.throws(() => buscarPorSignificado(c.opcoes({ tenant: 'outro' })), /memory\.query\.scope-violation/);
    assert.equal(c.d.pedidosDeEmbedding.length, antes, 'nenhuma consulta embedada com universo contaminado');
  } finally { c.limpar(); }
});

test('rm038 universo: status mostra o universo por colecao, fora da busca e avisa a cobertura menor', () => {
  const m = manifesto();
  const d = povoado();
  try {
    comChave(() => {
      const antes = abrirMemoria(m.carregado, { driver: d, embeddings: 'detalhado' }).estado;
      const e = antes.embeddings!;
      assert.equal(e.entradas, 6);
      assert.equal(e.cobertura, 0);
      assert.equal(e.falhaDoUniverso, null);
      assert.deepEqual(e.universo, { porColecao: { decision: 2, handoff: 1, rule: 1, learning: 1, roadmap: 1 },
        foraDaBusca: { injecao: 1, expiradas: 1, outrasColecoes: 1 } });
      assert.equal(e.aviso, 'o indice cobre 0 de 6 entrada(s) que a busca enxerga: rode ork memory index');
      const texto = textoDoEstado(antes);
      assert.match(texto, /universo da busca\s+6 entrada\(s\) do tenant: decision 2, handoff 1, rule 1, learning 1, roadmap 1/);
      assert.match(texto, /fora da busca\s+1 com injection_risk, 1 expirada\(s\), 1 em colecoes fora do ork/);
      assert.match(texto, /cobertura\s+0% de 6 entrada\(s\) do universo da busca/);
      assert.match(texto, /\n  aviso\s+o indice cobre 0 de 6/);
      indexar({ raiz: m.raiz, tenant: T, dsn: '', config: m.carregado.manifesto.memory.embedding!, alvo: 'primario',
        universo: universoDaBusca(abrirMemoria(m.carregado, { driver: d }), T), dryRun: false, chavePresente: true,
        embeddar: p => d.embeddar(p) });
      const depois = abrirMemoria(m.carregado, { driver: d, embeddings: 'detalhado' }).estado;
      assert.equal(depois.embeddings!.cobertura, 1);
      assert.equal(depois.embeddings!.aviso, null);
      assert.doesNotMatch(textoDoEstado(depois), /\n  aviso\s/);
    });
  } finally { m.limpar(); }
});

test('rm038 universo: status sem universo lido traz o motivo tipado e nunca cobertura inventada', () => {
  const m = manifesto();
  const d = povoado();
  d.universo = () => { throw new Error('memory.query.window-saturated'); };
  try {
    comChave(() => {
      const estado = abrirMemoria(m.carregado, { driver: d, embeddings: 'detalhado' }).estado;
      const e = estado.embeddings!;
      assert.equal(e.falhaDoUniverso, 'memory.query.window-saturated');
      assert.equal(e.entradas, null);
      assert.equal(e.cobertura, null);
      assert.equal(e.universo, null);
      assert.equal(e.aviso, null);
      assert.match(textoDoEstado(estado), /universo da busca\s+nao lido \(memory\.query\.window-saturated\); cobertura nao calculada/);
      assert.doesNotMatch(textoDoEstado(estado), /cobertura\s+\d/);
    });
    const semContagem = estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, T, '',
      { universo: universoDaBusca(fonteFixa([entrada('d1')], null).fonte, T), env: {} });
    assert.equal(semContagem.universo!.foraDaBusca, null);
    const linhas = textoDoEstado({ ...abrirMemoria(m.carregado, { driver: povoado() }).estado, embeddings: semContagem });
    assert.match(linhas, /fora da busca\s+nao medido nesta base/);
    assert.throws(() => estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, T, '',
      { universo: { ...universoDaBusca(fonteFixa([entrada('d1')]).fonte, T), tenant: 'outro' }, env: {} }), /memory\.query\.scope-violation/);
  } finally { m.limpar(); }
});

// ---------------------------------------------------------------------------------------------
// Pelo binario do HEAD, com uma ponte falsa em node no lugar do Python (sem base e sem rede).
// ---------------------------------------------------------------------------------------------
const ORK = path.resolve(__dirname, '../../dist/index.js');

function projetoComPonteFalsa(nome: string) {
  const p = projetoTemporario(nome);
  const dados = [entrada('d1', 'decision', ['orkastery']), entrada('r1', 'rule', ['orkastery']),
    entrada('h1', 'handoff', ['orkastery']), entrada('alheia', 'decision', ['outro-produto'])]
    .map(e => ({ ...e, created_at: e.criadaEm }));
  fs.writeFileSync(path.join(p.dir, 'dados.json'), JSON.stringify(dados));
  const runner = path.join(p.dir, 'python-falso');
  fs.writeFileSync(runner, `#!${process.execPath}
const fs=require('fs'),path=require('path');
const q=JSON.parse(fs.readFileSync(0,'utf8'));
fs.appendFileSync(path.join(__dirname,'chamadas.log'), q.op+'\\n');
const dados=JSON.parse(fs.readFileSync(path.join(__dirname,'dados.json'),'utf8'));
const ork=['decision','handoff','rule','learning','roadmap'];
const doUniverso=dados.filter(e=>ork.includes(e.collection)&&e.tags.project.includes(q.tenant));
if (q.op==='health') console.log(JSON.stringify({contagens:{decision:2,rule:1,handoff:1},orkmind:'teste',fallback:{dependencias:false}}));
else if (q.op==='universo' && fs.existsSync(path.join(__dirname,'saturar'))) { console.log(JSON.stringify({error:'memory.query.window-saturated'})); process.exit(1); }
else if (q.op==='universo') console.log(JSON.stringify({entradas:doUniverso,foraDaBusca:{injecao:5,expiradas:0,outrasColecoes:13}}));
else if (q.op==='fts') console.log(JSON.stringify({ids:['r1','fantasma','d1']}));
else if (q.op==='export') console.log(JSON.stringify(dados.filter(e=>e.collection===q.collection)));
else { console.log(JSON.stringify({error:'memory.bridge.failed'})); process.exit(1); }
`, { mode: 0o755 });
  const cli = path.join(p.dir, 'orkmind-falso');
  fs.writeFileSync(cli, `#!${runner}\n`, { mode: 0o755 });
  const caminho = path.join(p.dir, 'orkastery.yaml');
  fs.writeFileSync(caminho, fs.readFileSync(caminho, 'utf8')
    .replace(/^  mode: files$/m, '  mode: orkmind')
    .replace(/^  database_url_env: ""$/m, '  database_url_env: "TESTE_RM038_DSN"')
    .replace(/^  cli: orkmind$/m, `  cli: ${cli}`)
    .replace(/^  timeout_ms: 15000$/m, `  timeout_ms: 15000
  embedding:
    provider: openrouter
    model: "org/primario"
    dim: 32
    api_key_env: "TESTE_RM038_KEY"`));
  return p;
}

function orkCli(cwd: string, args: string[]): { saida: string; codigo: number } {
  try {
    return { saida: execFileSync(process.execPath, [ORK, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TESTE_RM038_DSN: 'postgresql://leitor:senha@db.local:5432/memoria' } }),
      codigo: 0 };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string; stderr?: string };
    return { saida: (erro.stdout ?? '') + (erro.stderr ?? ''), codigo: erro.status ?? -1 };
  }
}

test('rm038 universo: cli do HEAD mostra o universo da busca, declara o FTS fora dele e falha alto sem universo', (t) => {
  const p = projetoComPonteFalsa('rm038-cli');
  t.after(p.limpar);
  const seco = orkCli(p.dir, ['memory', 'index', '--dry-run', '--json']);
  assert.equal(seco.codigo, 0, seco.saida);
  const s = JSON.parse(seco.saida);
  assert.equal(s.universo, 3, 'a alheia fica fora do universo');
  assert.deepEqual(s.porColecao, { decision: 1, handoff: 1, rule: 1, learning: 0, roadmap: 0 });
  assert.deepEqual(s.foraDaBusca, { injecao: 5, expiradas: 0, outrasColecoes: 13 });
  const texto = orkCli(p.dir, ['memory', 'index', '--dry-run']);
  assert.match(texto.saida, /universo da busca\s+3 entrada\(s\): decision 1, handoff 1, rule 1, learning 0, roadmap 0/);
  assert.match(texto.saida, /fora da busca\s+5 com injection_risk, 0 expirada\(s\), 13 em colecoes fora do ork/);
  const status = JSON.parse(orkCli(p.dir, ['memory', 'status', '--json']).saida);
  const e = status.embeddings ?? status.estado?.embeddings;
  assert.equal(e.entradas, 3);
  assert.deepEqual(e.universo.foraDaBusca, { injecao: 5, expiradas: 0, outrasColecoes: 13 });
  assert.equal(e.aviso, 'o indice cobre 0 de 3 entrada(s) que a busca enxerga: rode ork memory index');
  const busca = JSON.parse(orkCli(p.dir, ['memory', 'search', '--texto', 'comum', '--modo', 'fts', '--json']).saida);
  assert.deepEqual(busca.listas.fts, ['r1', 'd1']);
  assert.equal(busca.ftsForaDoUniverso, 1);
  assert.match(busca.detalhe, /fts: 1 id\(s\) fora do universo da busca descartado\(s\)/);
  fs.writeFileSync(path.join(p.dir, 'saturar'), '');
  const saturado = orkCli(p.dir, ['memory', 'index', '--json']);
  assert.equal(saturado.codigo, 1);
  assert.equal(JSON.parse(saturado.saida).motivo, 'memory.query.window-saturated');
  assert.doesNotMatch(fs.readFileSync(path.join(p.dir, 'chamadas.log'), 'utf8'), /embed/);
  const semUniverso = JSON.parse(orkCli(p.dir, ['memory', 'status', '--json']).saida);
  assert.equal((semUniverso.embeddings ?? semUniverso.estado?.embeddings).falhaDoUniverso, 'memory.query.window-saturated');
  const buscaSem = JSON.parse(orkCli(p.dir, ['memory', 'search', '--texto', 'comum', '--json']).saida);
  assert.equal(buscaSem.motivo, 'memory.query.window-saturated');
  assert.deepEqual(buscaSem.resultados, []);
});
