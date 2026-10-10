/**
 * I-38 (T5, C21): busca por significado, dentro do tenant, sem misturar espacos vetoriais.
 *
 * Hermetico: dublê de memoria e um embedder CONCEITUAL de teste (palavras do mesmo tema caem no
 * mesmo eixo), o bastante para provar a cadeia, a fusao e a fronteira sem modelo nem rede.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DriverEmMemoria, filtrarPorTags, PedidoDeEmbedding, RespostaDeEmbedding, vetorDeDuble } from '../src/orkmind';
import { indexar, universoDaBusca } from '../src/indice-vetorial';
import { buscarPorSignificado, cosseno, fundirRrf, OpcoesDaBusca, RRF_K } from '../src/busca-semantica';
import { ConfigDeEmbedding, ConsultaPorTag, EntradaDeMemoria } from '../src/types';
import { projetoTemporario } from './apoio';

const CONFIG: ConfigDeEmbedding = { provider: 'openrouter', model: 'org/primario', dim: 16,
  api_key_env: 'TESTE_BUSCA_KEY', fallback_model: '', max_tokens_por_execucao: 1_000_000 };

/** Eixos de tema: o que o FTS por palavra nao liga, o embedder de teste liga. */
const TEMAS: Record<string, number> = {
  rotacao: 0, trocar: 0, conta: 0, cota: 0, acaba: 0, esgotada: 0, perfil: 0,
  memoria: 1, sessoes: 1, esquecimento: 1, handoff: 1, ponteiros: 1,
  chave: 2, segredo: 2, prompt: 2,
};

function conceitual(p: PedidoDeEmbedding): RespostaDeEmbedding {
  return { alvo: p.alvo, modelo: p.modelo, dim: p.dim, vetores: p.textos.map(t => {
    const v = new Array<number>(p.dim).fill(0);
    for (const w of t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) ?? []) {
      if (w in TEMAS) v[TEMAS[w]] += 1;
    }
    const n = Math.hypot(...v);
    return n === 0 ? vetorDeDuble(t, p.dim) : v.map(x => x / n);
  }) };
}

function entrada(id: string, content: string, project = 'fabrica', collection = 'decision'): EntradaDeMemoria {
  return { id, collection, content, tags: { project: [project] }, priority: 'medium', mandatory: false,
    scope: 'project', source: 'agent', metadata: {}, criadaEm: '2026-09-29T00:00:00Z' };
}

const MEMORIA = () => [
  entrada('rot', 'Rotacao de perfil quando a cota da assinatura esgotada'),
  entrada('mem', 'Handoff preserva ponteiros entre sessoes', 'fabrica', 'handoff'),
  entrada('seg', 'Nenhuma chave vai para o prompt', 'fabrica', 'rule'),
  entrada('alheia', 'Rotacao de conta de outro produto quando a cota acaba', 'outro-produto'),
];

function cenario(extra: Partial<OpcoesDaBusca> = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-busca-'));
  const driver = new DriverEmMemoria(MEMORIA());
  // A busca por tag (export governado filtrado pelo ork) segue como era: o universo vem da operacao `universo`.
  const fonte = { buscar: (q: ConsultaPorTag) => filtrarPorTags(driver.exportar(q.collection!), q) };
  const universo = universoDaBusca(driver, 'fabrica');
  const indexarCom = (config: ConfigDeEmbedding, alvo: 'primario' | 'fallback', env?: NodeJS.ProcessEnv) =>
    indexar({ raiz, tenant: 'fabrica', dsn: '', config, alvo, universo, dryRun: false, chavePresente: true, embeddar: conceitual, env });
  const opcoes = (o: Partial<OpcoesDaBusca> = {}): OpcoesDaBusca => ({ raiz, tenant: 'fabrica', dsn: '', config: CONFIG,
    universo, texto: 'trocar de conta quando acaba a cota', modo: 'hibrido', limite: 10, chavePresente: true,
    fallbackUsavel: true, timeoutMs: 15000, embeddar: conceitual, buscarTexto: (t, q) => driver.buscarTexto(t, q), ...extra, ...o });
  return { raiz, driver, fonte, universo, indexarCom, opcoes, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

function cacheLocal(modelo: string, dim: number): { env: NodeJS.ProcessEnv; limpar: () => void } {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-busca-hf-'));
  const repo = path.join(cache, `models--${modelo.replace('/', '--')}`);
  const ref = 'c'.repeat(40);
  fs.mkdirSync(path.join(repo, 'refs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'snapshots', ref), { recursive: true });
  fs.writeFileSync(path.join(repo, 'refs', 'main'), ref);
  fs.writeFileSync(path.join(repo, 'snapshots', ref, 'config.json'), JSON.stringify({ hidden_size: dim }));
  return { env: { HF_HUB_CACHE: cache }, limpar: () => fs.rmSync(cache, { recursive: true, force: true }) };
}

test('RRF com k = 60 ordena como esperado num caso pequeno fixo', () => {
  assert.equal(RRF_K, 60);
  const s = fundirRrf([['a', 'b', 'c'], ['c', 'a']]);
  assert.equal(s.get('a'), 1 / 61 + 1 / 62);
  assert.equal(s.get('b'), 1 / 62);
  assert.equal(s.get('c'), 1 / 63 + 1 / 61);
  assert.deepEqual([...s].sort((x, y) => y[1] - x[1]).map(([id]) => id), ['a', 'c', 'b']);
  assert.equal(cosseno([1, 0], [0, 1]), 0);
  assert.equal(cosseno([1, 1], [2, 2]), 1);
});

test('a semantica acha pela parafrase o que o FTS da mesma frase nao acha', () => {
  const c = cenario();
  try {
    assert.equal(c.indexarCom(CONFIG, 'primario').embedados, 3);
    const r = buscarPorSignificado(c.opcoes());
    assert.equal(r.deterministico, false);
    assert.equal(r.origem, 'primario');
    assert.equal(r.motivo, null);
    assert.deepEqual(r.listas.fts, [], 'o FTS da parafrase nao acha nada');
    assert.equal(r.resultados[0].id, 'rot');
    assert.deepEqual(r.resultados[0].fontes, ['vetor']);
    assert.ok(r.resultados[0].similaridade! > 0.9);
  } finally { c.limpar(); }
});

test('resultado nunca traz entrada de outro tenant, nem vinda do FTS nem do universo', () => {
  const c = cenario();
  try {
    c.indexarCom(CONFIG, 'primario');
    const alheia = MEMORIA()[3];
    // RM-038: id alheio vindo do FTS e descartado e declarado; entrada alheia no universo e violacao.
    const r = buscarPorSignificado(c.opcoes({ buscarTexto: () => ['alheia', 'rot'], texto: 'rotacao conta cota' }));
    const ids = [...r.resultados.map(e => e.id), ...r.listas.fts, ...r.listas.vetor];
    assert.ok(!ids.includes('alheia'));
    assert.ok(ids.includes('rot'));
    assert.equal(r.ftsForaDoUniverso, 1);
    assert.match(r.detalhe, /fts: 1 id\(s\) fora do universo da busca descartado\(s\)/);
    assert.throws(() => buscarPorSignificado(c.opcoes({ universo: { ...c.universo, entradas: [...c.universo.entradas, alheia] } })),
      /memory\.query\.scope-violation/);
  } finally { c.limpar(); }
});

test('espaco vetorial divergente e recusado: nunca compara consulta e indice de modelos diferentes', () => {
  const c = cenario();
  try {
    c.indexarCom(CONFIG, 'primario');
    const outraDim = buscarPorSignificado(c.opcoes({ embeddar: p => conceitual({ ...p, dim: 8 }) }));
    assert.equal(outraDim.motivo, 'embeddings.espaco-vetorial-divergente');
    assert.deepEqual(outraDim.listas.vetor, []);
    const outroModelo = buscarPorSignificado(c.opcoes({ embeddar: p => ({ ...conceitual(p), modelo: 'org/outro' }) }));
    assert.equal(outroModelo.motivo, 'embeddings.espaco-vetorial-divergente');
    const arquivo = path.join(c.raiz, '.orkastery/memoria/vetores/fabrica/org__primario-16.json');
    const adulterado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    adulterado.modelo = 'org/intruso';
    fs.writeFileSync(arquivo, JSON.stringify(adulterado));
    const arquivoAlheio = buscarPorSignificado(c.opcoes());
    assert.equal(arquivoAlheio.motivo, 'embeddings.espaco-vetorial-divergente');
    assert.equal(arquivoAlheio.origem, 'fts', 'sem vetor coerente cai para fts');
  } finally { c.limpar(); }
});

test('sem embedding cai para fts com motivo tipado e resultado nao deterministico', () => {
  const c = cenario();
  try {
    const nenhum = buscarPorSignificado(c.opcoes({ config: { ...CONFIG, provider: 'none' }, texto: 'handoff ponteiros' }));
    assert.equal(nenhum.origem, 'fts');
    assert.equal(nenhum.motivo, 'embeddings.nao-configurado');
    assert.deepEqual(nenhum.resultados.map(e => e.id), ['mem']);
    assert.equal(nenhum.deterministico, false);
    const semChave = buscarPorSignificado(c.opcoes({ chavePresente: false }));
    assert.equal(semChave.origem, 'fts');
    assert.equal(semChave.motivo, 'embeddings.chave-ausente');
    const semIndice = buscarPorSignificado(c.opcoes());
    assert.equal(semIndice.motivo, 'embeddings.indice-ausente');
    assert.equal(semIndice.origem, 'fts');
  } finally { c.limpar(); }
});

test('sem a chave usa o fallback local quando o indice dele existe, com origem declarada', () => {
  const hf = cacheLocal('org/local', 48);
  const c = cenario({ env: hf.env });
  try {
    const config = { ...CONFIG, fallback_model: 'org/local' };
    assert.equal(c.indexarCom(config, 'fallback', hf.env).dim, 48);
    const r = buscarPorSignificado(c.opcoes({ config, chavePresente: false }));
    assert.equal(r.origem, 'fallback');
    assert.equal(r.modeloUsado, 'org/local');
    assert.equal(r.motivo, 'embeddings.chave-ausente');
    assert.equal(r.resultados[0].id, 'rot');
    const semDependencias = buscarPorSignificado(c.opcoes({ config, chavePresente: false, fallbackUsavel: false }));
    assert.equal(semDependencias.origem, 'fts');
  } finally { c.limpar(); hf.limpar(); }
});

test('primario com falha cai para o fallback, e o motivo do primario fica declarado', () => {
  const hf = cacheLocal('org/local', 48);
  const c = cenario({ env: hf.env });
  try {
    const config = { ...CONFIG, fallback_model: 'org/local' };
    c.indexarCom(config, 'primario');
    c.indexarCom(config, 'fallback', hf.env);
    const r = buscarPorSignificado(c.opcoes({ config, embeddar: p => {
      if (p.alvo === 'primario') throw new Error('embeddings.timeout');
      return conceitual(p);
    } }));
    assert.equal(r.origem, 'fallback');
    assert.equal(r.motivo, 'embeddings.timeout');
    assert.match(r.detalhe, /primario: embeddings.timeout/);
  } finally { c.limpar(); hf.limpar(); }
});

test('modo vetor e modo fts isolam os lados; hibrido marca as duas fontes', () => {
  const c = cenario();
  try {
    c.indexarCom(CONFIG, 'primario');
    const texto = 'rotacao perfil cota';
    const vetor = buscarPorSignificado(c.opcoes({ modo: 'vetor', texto }));
    assert.deepEqual(vetor.listas.fts, []);
    assert.ok(vetor.listas.vetor.length > 0);
    const fts = buscarPorSignificado(c.opcoes({ modo: 'fts', texto }));
    assert.deepEqual(fts.listas.vetor, []);
    assert.equal(fts.origem, 'fts');
    assert.equal(fts.motivo, null);
    const hibrido = buscarPorSignificado(c.opcoes({ texto }));
    assert.deepEqual(hibrido.resultados[0].fontes, ['vetor', 'fts']);
    assert.equal(hibrido.resultados[0].score, Math.round((1 / 61 + 1 / 61) * 1e6) / 1e6);
  } finally { c.limpar(); }
});

test('a busca por tag nao muda com indice e busca semantica', () => {
  const c = cenario();
  try {
    const consulta = { tags: { project: ['fabrica'] } };
    const antes = JSON.stringify(c.fonte.buscar({ collection: 'decision', ...consulta }));
    c.indexarCom(CONFIG, 'primario');
    buscarPorSignificado(c.opcoes());
    assert.equal(JSON.stringify(c.fonte.buscar({ collection: 'decision', ...consulta })), antes);
  } finally { c.limpar(); }
});

// ---------------------------------------------------------------------------
// Pelo binario, com um OrkMind falso (script node no lugar do Python).
// ---------------------------------------------------------------------------
const ORK = path.resolve(__dirname, '../../dist/index.js');
const DUBLE = path.resolve(__dirname, '../../dist/orkmind.js');

function projetoComOrkmindFalso(nome: string, embedderConceitual = false) {
  const p = projetoTemporario(nome);
  const dados = MEMORIA().map(e => ({ ...e, tags: { project: [e.tags.project[0] === 'fabrica' ? 'orkastery' : 'alheio'] }, created_at: e.criadaEm }));
  fs.writeFileSync(path.join(p.dir, 'dados.json'), JSON.stringify(dados));
  const runner = path.join(p.dir, 'python-falso');
  fs.writeFileSync(runner, `#!${process.execPath}
const fs=require('fs'),path=require('path');
const q=JSON.parse(fs.readFileSync(0,'utf8'));
const dados=JSON.parse(fs.readFileSync(path.join(__dirname,'dados.json'),'utf8'));
const cont={}; for (const e of dados) cont[e.collection]=(cont[e.collection]||0)+1;
const d=new (require(${JSON.stringify(DUBLE)}).DriverEmMemoria)(dados.map(e=>({...e,criadaEm:e.created_at})));
if (q.op==='health') console.log(JSON.stringify({contagens:cont,orkmind:'teste',fallback:{dependencias:false}}));
else if (q.op==='export') console.log(JSON.stringify(dados.filter(e=>e.collection===q.collection)));
else if (q.op==='fts') console.log(JSON.stringify({ids:d.buscarTexto(q.tenant,q.texto)}));
else if (q.op==='universo') console.log(JSON.stringify(d.universo(q.tenant)));
else if (q.op==='embed' && ${embedderConceitual}) { const temas=${JSON.stringify(TEMAS)};
  console.log(JSON.stringify({alvo:q.alvo,modelo:q.modelo,dim:q.dim,vetores:q.textos.map(t=>{const v=Array(q.dim).fill(0);
    for (const w of t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]+/g)||[]) if (w in temas) v[temas[w]]+=1;
    const n=Math.hypot(...v); return n===0?v.map((_,i)=>i===q.dim-1?1:0):v.map(x=>x/n);})})); }
else if (q.op==='embed') console.log(JSON.stringify(d.embeddar({papel:q.papel,alvo:q.alvo,modelo:q.modelo,dim:q.dim,textos:q.textos})));
else { console.log(JSON.stringify({error:'memory.bridge.failed'})); process.exit(1); }
`, { mode: 0o755 });
  const cli = path.join(p.dir, 'orkmind-falso');
  fs.writeFileSync(cli, `#!${runner}\n`, { mode: 0o755 });
  const caminho = path.join(p.dir, 'orkastery.yaml');
  fs.writeFileSync(caminho, fs.readFileSync(caminho, 'utf8')
    .replace(/^  mode: files$/m, '  mode: orkmind')
    .replace(/^  database_url_env: ""$/m, '  database_url_env: "TESTE_BUSCA_DSN"')
    .replace(/^  cli: orkmind$/m, `  cli: ${cli}`)
    .replace(/^  timeout_ms: 15000$/m, `  timeout_ms: 15000
  embedding:
    provider: openrouter
    model: "org/primario"
    dim: 32
    api_key_env: "TESTE_BUSCA_KEY"`));
  return p;
}

function ork(cwd: string, args: string[], env: Record<string, string>): { saida: string; codigo: number } {
  try {
    return { saida: execFileSync(process.execPath, [ORK, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } }), codigo: 0 };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string; stderr?: string };
    return { saida: (erro.stdout ?? '') + (erro.stderr ?? ''), codigo: erro.status ?? -1 };
  }
}

test('ork memory search --texto pelo binario: cai para fts sem chave e usa o primario com indice', (t) => {
  const p = projetoComOrkmindFalso('i38-busca-cli');
  t.after(p.limpar);
  const env = { TESTE_BUSCA_DSN: 'postgresql://leitor:senha@db.local:5432/memoria' };
  const semChave = ork(p.dir, ['memory', 'search', '--texto', 'handoff ponteiros', '--json'], env);
  assert.equal(semChave.codigo, 0, semChave.saida);
  const r1 = JSON.parse(semChave.saida);
  assert.equal(r1.deterministico, false);
  assert.equal(r1.origem, 'fts');
  assert.equal(r1.motivo, 'embeddings.chave-ausente');
  assert.deepEqual(r1.resultados.map((e: { id: string }) => e.id), ['mem']);
  const comChave = { ...env, TESTE_BUSCA_KEY: ['chave', 'de', 'teste', 'da', 'busca'].join('-') };
  assert.equal(ork(p.dir, ['memory', 'index', '--json'], comChave).codigo, 0);
  const r2 = JSON.parse(ork(p.dir, ['memory', 'search', '--texto', 'rotacao perfil cota', '--json'], comChave).saida);
  assert.equal(r2.origem, 'primario');
  assert.equal(r2.modeloUsado, 'org/primario');
  assert.ok(!r2.resultados.some((e: { id: string }) => e.id === 'alheia'), 'outro tenant nunca volta');
  const texto = ork(p.dir, ['memory', 'search', '--texto', 'rotacao perfil cota'], comChave);
  assert.match(texto.saida, /NAO deterministica/);
});

test('--texto nao combina com --tags nem --thread, e a ajuda anuncia a busca', () => {
  const p = projetoComOrkmindFalso('i38-busca-cli-uso');
  try {
    for (const extra of [['--tags', '{"project":["orkastery"]}'], ['--thread', 'ork-x'], ['--janela', '5']]) {
      const r = ork(p.dir, ['memory', 'search', '--texto', 'qualquer', ...extra], {});
      assert.equal(r.codigo, 2);
      assert.match(r.saida, /memory.search.texto-exclusivo/);
    }
    assert.equal(ork(p.dir, ['memory', 'search', '--texto', 'x', '--modo', 'magico'], {}).codigo, 2);
    assert.match(ork(p.dir, ['--help'], {}).saida, /memory search --texto/);
  } finally { p.limpar(); }
});

test('prova do C4: o script imprime os tres conjuntos e a exclusiva da busca semantica', (t) => {
  const p = projetoComOrkmindFalso('i38-prova', true);
  t.after(p.limpar);
  const script = path.resolve(__dirname, '../../scripts/prova-busca-semantica.sh');
  const env = { TESTE_BUSCA_DSN: 'postgresql://leitor:senha@db.local:5432/memoria',
    TESTE_BUSCA_KEY: ['chave', 'de', 'teste', 'da', 'prova'].join('-') };
  const rodar = (args: string[]) => {
    try {
      return { saida: execFileSync('bash', [script, ...args], { cwd: p.dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } }), codigo: 0 };
    } catch (e) {
      const erro = e as { status?: number; stdout?: string; stderr?: string };
      return { saida: (erro.stdout ?? '') + (erro.stderr ?? ''), codigo: erro.status ?? -1 };
    }
  };
  const semIndice = rodar([]);
  assert.equal(semIndice.codigo, 1, 'sem indice nao ha exclusiva, e a prova reprova');
  assert.doesNotMatch(semIndice.saida, /exclusiva da busca semantica/);
  // Diagnostico da RM-038 (10/10): sem indice nao ha ranking vetorial nem cobertura a mostrar.
  assert.match(semIndice.saida, /posicao dos alvos\s+\(sem ranking vetorial: origem nenhum\)/);
  assert.match(semIndice.saida, /cobertura do indice\s+\(nao informada\)/);
  assert.equal(ork(p.dir, ['memory', 'index', '--json'], env).codigo, 0);
  const r = rodar(['rotacao|trocar de conta quando acaba a cota']);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /alvo \(FTS do termo\)\s+decision\/rot/);
  assert.match(r.saida, /tag equivalente\s+\(nenhuma\)/);
  assert.match(r.saida, /FTS da parafrase\s+\(nenhuma\)/);
  assert.match(r.saida, /semantica top 5\s+decision\/rot.*\[origem primario org\/primario\]/);
  assert.match(r.saida, /exclusiva da busca semantica: decision\/rot/);
  assert.match(r.saida, /posicao dos alvos\s+decision\/rot na posicao 1 \(similaridade (?:1|0\.\d+)\)/);
  assert.match(r.saida, /cobertura do indice\s+3 de 3 entrada\(s\) da busca com vetor coerente/);
  assert.doesNotMatch(r.saida, /alheia/);
  assert.equal(rodar(['sem-separador']).codigo, 2);
});
