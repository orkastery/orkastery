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
import { performance } from 'node:perf_hooks';
import { carregarManifesto, ManifestoCarregado } from '../src/manifest';
import { abrirMemoria, estadoDeEmbeddings, textoDoEstado } from '../src/memoria';
import { COLECOES_DO_ORK, ConfigDoDriver, configDoManifesto, DriverCliOrkMind, DriverEmMemoria, entradaDoJson, PedidoDeEmbedding, pertenceAoUniverso } from '../src/orkmind';
import { conferirUniverso, FonteDoUniverso, indexar, textoDoIndice, universoDaBusca } from '../src/indice-vetorial';
import { buscarPorSignificado, OpcoesDaBusca } from '../src/busca-semantica';
import { motivoDiferimentoCi } from '../src/ci';
import { ConfigDeEmbedding, EntradaDeMemoria, ForaDaBusca, UniversoDaBusca } from '../src/types';
import { projetoTemporario } from './apoio';
import { main } from '../src/index';
import { fixarProjetoAlvo } from '../src/projeto-alvo';

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
function ponteFalsa(corpo: string, config: Partial<ConfigDoDriver> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm038-ponte-'));
  const runner = path.join(dir, 'python');
  fs.writeFileSync(runner, `#!${process.execPath}\n${corpo}`, { mode: 0o755 });
  const cli = path.join(dir, 'orkmind');
  fs.writeFileSync(cli, `#!${runner}\n`, { mode: 0o755 });
  return { driver: new DriverCliOrkMind({ cli, dsn: 'dsn-de-teste-rm038', variavel: 'TESTE_RM038_DSN', timeoutMs: 5000, ...config }),
    limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const responder = (resposta: unknown) => `console.log(${JSON.stringify(JSON.stringify(resposta))});`;
const json = (e: EntradaDeMemoria) => ({ id: e.id, collection: e.collection, content: e.content, tags: e.tags,
  injection_risk: e.injection_risk, expires_at: e.expires_at });

test('rm038 universo: manifesto configura prazo proprio positivo com padrao de 90 segundos', () => {
  const m = manifesto();
  try {
    assert.equal(m.carregado.manifesto.memory.universo_timeout_ms, 90_000);
    assert.equal(configDoManifesto(m.carregado.manifesto).universoTimeoutMs, 90_000);
    const arquivo = path.join(m.raiz, 'orkastery.yaml');
    const original = fs.readFileSync(arquivo, 'utf8');
    fs.writeFileSync(arquivo, original + '  universo_timeout_ms: 240000\n');
    const configurado = carregarManifesto(m.raiz)!;
    assert.deepEqual(configurado.erros, []);
    assert.equal(configDoManifesto(configurado.manifesto).universoTimeoutMs, 240_000);
    assert.equal(configDoManifesto(configurado.manifesto).timeoutMs, 15_000);
    for (const invalido of ['0', '-1', '1.5', '"90000"', 'null', '9007199254740992']) {
      fs.writeFileSync(arquivo, original + `  universo_timeout_ms: ${invalido}\n`);
      assert.ok(carregarManifesto(m.raiz)!.erros.some(e => e.startsWith('memory.universo_timeout_ms:')), invalido);
    }
  } finally { m.limpar(); }
});

test('rm038 universo: transporte aplica prazo exclusivo e mede latencia monotonica no resultado', (t) => {
  const chamadas: { op: string; timeout: number }[] = [];
  t.mock.method(require('node:child_process'), 'spawnSync', (_cmd: string, _args: string[], o: { input: string; timeout: number }) => {
    const { op } = JSON.parse(o.input);
    chamadas.push({ op, timeout: o.timeout });
    return { status: 0, stdout: JSON.stringify(op === 'universo' ? { entradas: [], foraDaBusca: null } : []) };
  });
  let tempo = 100;
  t.mock.method(performance, 'now', () => { const antes = tempo; tempo += 37.5; return antes; });
  const padrao = ponteFalsa('', { timeoutMs: 17 });
  const configurado = ponteFalsa('', { timeoutMs: 17, universoTimeoutMs: 240_000 });
  const m = manifesto();
  try {
    assert.equal(padrao.driver.universo(T).latenciaMs, 37.5);
    const u = universoDaBusca(configurado.driver, T);
    assert.equal(u.latenciaMs, 37.5);
    const indice = indexar({ raiz: m.raiz, tenant: T, dsn: '', config: CONFIG, alvo: 'primario', universo: u,
      dryRun: true, chavePresente: true });
    assert.equal(indice.latenciaUniversoMs, 37.5);
    const estado = estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, T, '', { universo: u, env: {} });
    assert.equal(estado.universo?.latenciaMs, 37.5);
    configurado.driver.exportar('decision');
    assert.deepEqual(chamadas, [{ op: 'universo', timeout: 90_000 }, { op: 'universo', timeout: 240_000 },
      { op: 'export', timeout: 17 }]);
  } finally { padrao.limpar(); configurado.limpar(); m.limpar(); }
});

test('rm038 universo: prazo proprio espera a ponte e prazo esgotado falha tipado', () => {
  const corpo = `setTimeout(() => { ${responder({ entradas: [], foraDaBusca: null })} }, 150);`;
  const suficiente = ponteFalsa(corpo, { timeoutMs: 1, universoTimeoutMs: 2000 });
  const curto = ponteFalsa(corpo, { timeoutMs: 2000, universoTimeoutMs: 1 });
  try {
    assert.ok(suficiente.driver.universo(T).latenciaMs >= 150);
    assert.throws(() => curto.driver.universo(T), /^Error: memory\.transport\.timeout$/);
  } finally { suficiente.limpar(); curto.limpar(); }
});

test('rm038 universo: cli retorna 1 com motivo em texto e json sem confundir universo vazio com falha', (t) => {
  const m = manifesto();
  const cwd = process.cwd();
  const memoria = abrirMemoria(m.carregado, { driver: new DriverEmMemoria([]) });
  let falha = '';
  memoria.universo = () => {
    if (falha) throw Error(falha);
    return { entradas: [], foraDaBusca: null };
  };
  t.mock.method(require('../src/memoria'), 'abrirMemoria', () => memoria);
  const fts = t.mock.method(DriverCliOrkMind.prototype, 'buscarTexto', () => []);
  const embed = t.mock.method(DriverCliOrkMind.prototype, 'embeddar', () => { throw Error('embed indevido'); });
  const linhas: string[] = [];
  t.mock.method(console, 'log', (s: string) => linhas.push(s));
  try {
    process.chdir(m.raiz);
    for (const formato of [[], ['--json']]) {
      const args = ['memory', 'search', '--texto', 'comum', '--modo', 'fts', ...formato];
      falha = '';
      linhas.length = 0;
      assert.equal(main(args), 0, 'universo vazio foi lido e nao e falha');
      const chamadasAntes = fts.mock.callCount();
      for (const motivo of ['memory.query.window-saturated', 'memory.query.scope-violation', 'memory.transport.timeout']) {
        falha = motivo;
        linhas.length = 0;
        assert.equal(main(args), 1, motivo);
        if (formato.length) {
          const r = JSON.parse(linhas.join('\n'));
          assert.equal(r.motivo, motivo);
          assert.deepEqual(r.resultados, []);
        } else assert.ok(linhas.some(s => s.includes(`motivo: ${motivo}`)));
        assert.equal(fts.mock.callCount(), chamadasAntes, 'sem universo nada chega ao FTS');
        assert.equal(embed.mock.callCount(), 0);
      }
    }
  } finally { fixarProjetoAlvo(null); process.chdir(cwd); m.limpar(); }
});

test('rm038 universo: normalizacao preserva governanca e predicado recusa injecao e expiracao', () => {
  const agora = Date.parse('2030-01-01T00:00:00Z');
  const inj = entradaDoJson(json({ ...entrada('inj'), injection_risk: true, expires_at: null }))!;
  assert.equal(inj.injection_risk, true);
  assert.equal(inj.expires_at, null);
  assert.equal(pertenceAoUniverso(inj, T, agora), false);
  for (const expires_at of ['2029-12-31T23:59:59Z', '2030-01-01T00:00:00Z', 'invalida']) {
    const e = entradaDoJson(json({ ...entrada('exp'), injection_risk: false, expires_at }))!;
    assert.equal(e.injection_risk, false);
    assert.equal(e.expires_at, expires_at);
    assert.equal(pertenceAoUniverso(e, T, agora), false, expires_at);
  }
  for (const expires_at of [undefined, null, '2030-01-01T00:00:01Z', '2030-01-01T00:00:01', '2029-12-31T21:00:01-03:00']) {
    assert.equal(pertenceAoUniverso({ ...entrada('ativa'), expires_at }, T, agora), true, String(expires_at));
  }
  for (const campos of [{ injection_risk: 'true' }, { expires_at: 42 }]) {
    assert.equal(entradaDoJson({ ...json(entrada('invalida')), ...campos }), null);
  }
});

for (const duranteLeitura of [true, false]) {
  test(`rm038 universo: instante da leitura preservado com expiracao ${duranteLeitura ? 'durante a leitura' : 'entre os alvos'}`, (t) => {
    const m = manifesto();
    t.after(m.limpar);
    const inicio = Date.parse('2030-01-01T00:00:00Z');
    let agora = inicio;
    t.mock.method(Date, 'now', () => agora);
    const e = { ...entrada('temporaria'), expires_at: new Date(inicio + 1000).toISOString() };
    const fonte: FonteDoUniverso = { universo: () => {
      if (duranteLeitura) agora += 2000;
      return { entradas: [e], foraDaBusca: null };
    } };
    let u!: UniversoDaBusca;
    assert.doesNotThrow(() => { u = universoDaBusca(fonte, T); });
    assert.equal(u.lidoEm, inicio);
    const config = { ...CONFIG, fallback_model: 'org/local' };
    const hub = path.join(m.raiz, 'hub');
    const modelo = path.join(hub, 'models--org--local');
    const ref = 'a'.repeat(40);
    fs.mkdirSync(path.join(modelo, 'refs'), { recursive: true });
    fs.mkdirSync(path.join(modelo, 'snapshots', ref), { recursive: true });
    fs.writeFileSync(path.join(modelo, 'refs', 'main'), ref);
    fs.writeFileSync(path.join(modelo, 'snapshots', ref, 'config.json'), JSON.stringify({ hidden_size: 32 }));
    const d = new DriverEmMemoria([]);
    const embeddar = (p: PedidoDeEmbedding) => { agora += 2000; return d.embeddar(p); };
    // Como --modelo todos: uma leitura, primario seguido do fallback, sem renovar o instante.
    for (const alvo of ['primario', 'fallback'] as const) {
      assert.doesNotThrow(() => {
        const r = indexar({ raiz: m.raiz, tenant: T, dsn: '', config, alvo, universo: u,
          dryRun: false, chavePresente: true, embeddar, env: { HF_HUB_CACHE: hub } });
        assert.equal(r.motivo, null);
        assert.equal(r.embedados, 1, alvo);
      });
    }
    assert.equal(pertenceAoUniverso(e, T), false, 'o relogio ja passou da expiracao');
    assert.doesNotThrow(() => {
      const busca = buscarPorSignificado({ raiz: m.raiz, tenant: T, dsn: '', config, universo: u,
        texto: 'comum', modo: 'vetor', limite: 5, chavePresente: true, fallbackUsavel: false,
        timeoutMs: 15000, embeddar });
      assert.deepEqual(busca.resultados.map(r => r.id), ['temporaria']);
      const status = estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, T, '', { universo: u, env: {} });
      assert.equal(status.entradas, 1);
    });
    // Uma leitura nova julga pelo instante novo: o carimbo nao libera entradas ja expiradas.
    assert.throws(() => universoDaBusca(fonte, T), /memory\.query\.scope-violation/);
  });
}

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
    ['injecao', { entradas: [json({ ...entrada('inj'), injection_risk: true })], foraDaBusca: null }, /^memory\.query\.scope-violation$/],
    ['expirada', { entradas: [json({ ...entrada('exp'), expires_at: '2000-01-01T00:00:00Z' })], foraDaBusca: null }, /^memory\.query\.scope-violation$/],
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
    assert.match(texto, /fora da busca\s+1 com injection_risk e 1 expirada\(s\) \(governanca da biblioteca\), 1 em outras colecoes \(fora da busca do ork\); nada disso vai ao embed/);
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
    for (const ruim of [entrada('alheia', 'decision', ['outro-produto']),
      { ...entrada('inj'), injection_risk: true }, { ...entrada('exp'), expires_at: '2000-01-01T00:00:00Z' }]) {
      const contaminado: UniversoDaBusca = { ...u, entradas: [...u.entradas, ruim] };
      assert.throws(() => indexar({ raiz, tenant: T, dsn: '', config: CONFIG, alvo: 'primario', universo: contaminado, dryRun: false,
        chavePresente: true, embeddar: p => d.embeddar(p) }), /memory\.query\.scope-violation/);
      assert.equal(d.pedidosDeEmbedding.length, 0);
    }
    assert.throws(() => indexar({ raiz, tenant: 'outro', dsn: '', config: CONFIG, alvo: 'primario', universo: u, dryRun: false,
      chavePresente: true, embeddar: p => d.embeddar(p) }), /memory\.query\.scope-violation/);
    // Universo vazio de outro tenant: sem a conferencia, o indexar esvaziaria o indice do outro.
    assert.throws(() => indexar({ raiz, tenant: 'outro', dsn: '', config: CONFIG, alvo: 'primario',
      universo: universoDaBusca(fonteFixa([]).fonte, T), dryRun: false, chavePresente: true, embeddar: p => d.embeddar(p) }),
      /memory\.query\.scope-violation/);
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
    // A cobertura e contra a colecao buscada, nao contra o universo inteiro.
    assert.deepEqual(so.coberturaDoIndice, { coerentes: 2, universo: 2 });
    assert.doesNotMatch(so.detalhe, /o indice cobre/);
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
    assert.match(r.detalhe, /vetor: o indice cobre 6 de 7 entrada\(s\) que a busca enxerga: rode ork memory index/);
    const fts = buscarPorSignificado(c.opcoes({ modo: 'fts', buscarTexto: () => ['fantasma'] }));
    assert.equal(fts.origem, 'fts', 'id descartado nao e falha do FTS');
    assert.equal(fts.motivo, null);
    const antes = c.d.pedidosDeEmbedding.length;
    const contaminado: UniversoDaBusca = { ...c.u, entradas: [...c.u.entradas, entrada('alheia', 'decision', ['outro-produto'])] };
    assert.throws(() => buscarPorSignificado(c.opcoes({ universo: contaminado })), /memory\.query\.scope-violation/);
    assert.throws(() => buscarPorSignificado(c.opcoes({ tenant: 'outro' })), /memory\.query\.scope-violation/);
    // Universo vazio de outro tenant: so a conferencia do tenant do universo segura.
    const vazio = universoDaBusca(fonteFixa([]).fonte, T);
    assert.throws(() => buscarPorSignificado(c.opcoes({ tenant: 'outro', universo: vazio })), /memory\.query\.scope-violation/);
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
      assert.match(texto, /fora da busca\s+1 com injection_risk e 1 expirada\(s\) \(governanca da biblioteca\), 1 em outras colecoes \(fora da busca do ork\); nada disso vai ao embed/);
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
    const contaminado = { ...universoDaBusca(fonteFixa([entrada('d1')]).fonte, T), entradas: [entrada('d1'), entrada('x', 'decision', ['outro'])] };
    assert.throws(() => estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, T, '', { universo: contaminado, env: {} }),
      /memory\.query\.scope-violation/);
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
  assert.ok(Number.isFinite(s.latenciaUniversoMs) && s.latenciaUniversoMs > 0);
  const texto = orkCli(p.dir, ['memory', 'index', '--dry-run']);
  assert.match(texto.saida, /universo da busca\s+3 entrada\(s\): decision 1, handoff 1, rule 1, learning 0, roadmap 0/);
  assert.match(texto.saida, /fora da busca\s+5 com injection_risk e 0 expirada\(s\) \(governanca da biblioteca\), 13 em outras colecoes \(fora da busca do ork\)/);
  const status = JSON.parse(orkCli(p.dir, ['memory', 'status', '--json']).saida);
  const e = status.embeddings ?? status.estado?.embeddings;
  assert.equal(e.entradas, 3);
  assert.deepEqual(e.universo.foraDaBusca, { injecao: 5, expiradas: 0, outrasColecoes: 13 });
  assert.ok(Number.isFinite(e.universo.latenciaMs) && e.universo.latenciaMs > 0);
  assert.equal(e.aviso, 'o indice cobre 0 de 3 entrada(s) que a busca enxerga: rode ork memory index');
  const buscaCli = orkCli(p.dir, ['memory', 'search', '--texto', 'comum', '--modo', 'fts', '--json']);
  assert.equal(buscaCli.codigo, 0, buscaCli.saida);
  const busca = JSON.parse(buscaCli.saida);
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
  const buscaSemCli = orkCli(p.dir, ['memory', 'search', '--texto', 'comum', '--json']);
  assert.equal(buscaSemCli.codigo, 1, buscaSemCli.saida);
  const buscaSem = JSON.parse(buscaSemCli.saida);
  assert.equal(buscaSem.motivo, 'memory.query.window-saturated');
  assert.deepEqual(buscaSem.resultados, []);
  const buscaSemTexto = orkCli(p.dir, ['memory', 'search', '--texto', 'comum']);
  assert.equal(buscaSemTexto.codigo, 1, buscaSemTexto.saida);
  assert.match(buscaSemTexto.saida, /motivo: memory\.query\.window-saturated/);
});

test('rm038 universo: ci adia a prova na base e o teste da ponte, e roda o teste hermetico', () => {
  const p = projetoTemporario('rm038-ci');
  try {
    const base = { id: 'C1', thread: 'ork-rm038', fase: 'GOAL' as const, arquivo: 'README.md', alegacao: 'prova',
      negativa: false, criadoEm: new Date().toISOString(), estado: 'pendente' as const };
    for (const comando of [
      "npm --prefix core run build > /dev/null && node core/scripts/prova-universo-da-busca.cjs | grep -qF 'invariantes ok'",
      'node core/scripts/prova-universo-da-busca.cjs thread',
      'node --test core/dist-test/test/rm038-universo-ponte.test.js',
      "node --test --test-name-pattern='rm038 ponte: fts' core/dist-test/test/rm038-universo-ponte.test.js",
    ]) assert.equal(motivoDiferimentoCi({ ...base, verificar: [comando] }, p.dir), 'local-integration-required', comando);
    assert.equal(motivoDiferimentoCi({ ...base, verificar: ['node --test core/dist-test/test/rm038-universo.test.js'] }, p.dir), null);
  } finally { p.limpar(); }
});

test('rm038 universo: status e busca nao mandam reindexar o que o indice nunca embeda', () => {
  const m = manifesto();
  // Padrao de segredo montado em tempo de execucao: o indice recusa o texto e nunca o embeda.
  const segredo = entrada('seg', 'rule', [T], 'chave ' + 'sk-' + 'or-v1-' + 'a'.repeat(40));
  const d = new DriverEmMemoria([entrada('d1'), entrada('r1', 'rule'), segredo]);
  try {
    comChave(() => {
      const u = universoDaBusca(abrirMemoria(m.carregado, { driver: d }), T);
      const r = indexar({ raiz: m.raiz, tenant: T, dsn: '', config: m.carregado.manifesto.memory.embedding!, alvo: 'primario',
        universo: u, dryRun: false, chavePresente: true, embeddar: p => d.embeddar(p) });
      assert.equal(r.recusados, 1);
      assert.equal(r.embedados, 2);
      const e = abrirMemoria(m.carregado, { driver: d, embeddings: 'detalhado' }).estado.embeddings!;
      assert.equal(e.aviso, 'o indice cobre 2 de 3 entrada(s) que a busca enxerga; 1 fica(m) fora do indice por desenho ' +
        '(vazia, acima de 24000 caracteres ou com padrao de segredo)');
      assert.doesNotMatch(e.aviso!, /rode ork memory index/);
      const busca = buscarPorSignificado({ raiz: m.raiz, tenant: T, dsn: '', config: m.carregado.manifesto.memory.embedding!,
        universo: u, texto: 'comum', modo: 'vetor', limite: 10, chavePresente: true, fallbackUsavel: false, timeoutMs: 15000,
        embeddar: p => d.embeddar(p) });
      assert.match(busca.detalhe, /vetor: o indice cobre 2 de 3 entrada\(s\) que a busca enxerga; 1 fica\(m\) fora do indice por desenho/);
    });
  } finally { m.limpar(); }
});
