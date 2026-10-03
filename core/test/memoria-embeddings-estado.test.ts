/**
 * I-38 (T4, C19): estado sondado dos embeddings no `ork memory status`.
 *
 * Hermetico: dublê de memoria, cache do Hugging Face falso em diretorio temporario e chave
 * falsa montada em tempo de execucao. Nenhuma base, rede ou modelo real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { carregarManifesto, ManifestoCarregado } from '../src/manifest';
import { abrirMemoria, estadoDeEmbeddings, sondarEmbeddings, textoDoEstado } from '../src/memoria';
import { DriverEmMemoria } from '../src/orkmind';
import { indexar, universoDaBusca } from '../src/indice-vetorial';
import { EntradaDeMemoria } from '../src/types';

const CHAVE = 'TESTE_ESTADO_EMBEDDING_KEY';
const VALOR = ['valor', 'da', 'chave', 'de', 'teste', 'nunca', 'impresso'].join('-');

function manifesto(embedding: string): { carregado: ManifestoCarregado; limpar: () => void; raiz: string } {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-estado-emb-'));
  fs.writeFileSync(path.join(raiz, 'orkastery.yaml'), `project:
  name: "fabrica"
  abbrev: "fab"
memory:
  mode: orkmind
  tenant: fabrica
  database_url_env: "TESTE_ESTADO_DSN"
${embedding}`);
  const carregado = carregarManifesto(raiz)!;
  assert.deepEqual(carregado.erros, []);
  return { carregado, raiz, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

const BLOCO = (fallback = '') => `  embedding:
    provider: openrouter
    model: "qwen/qwen3-embedding-8b"
    dim: 64
    api_key_env: "${CHAVE}"
${fallback ? `    fallback_model: "${fallback}"\n` : ''}`;

function entradas(): EntradaDeMemoria[] {
  return ['Rotacao de conta por cota esgotada', 'Handoff preserva ponteiros', 'Regra sem chave no prompt'].map((c, i) => ({
    id: `m${i}`, collection: i === 2 ? 'rule' : 'decision', content: c, tags: { project: ['fabrica'] }, priority: 'medium',
    mandatory: false, scope: 'project', source: 'agent', metadata: {}, criadaEm: `2026-09-2${i}` }));
}

/** Cache falso do Hugging Face com um modelo local de `dim` dimensoes. */
function cacheLocal(modelo: string, dim: number): { cache: string; limpar: () => void } {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-estado-hf-'));
  const repo = path.join(cache, `models--${modelo.replace('/', '--')}`);
  const ref = 'b'.repeat(40);
  fs.mkdirSync(path.join(repo, 'refs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'snapshots', ref), { recursive: true });
  fs.writeFileSync(path.join(repo, 'refs', 'main'), ref);
  fs.writeFileSync(path.join(repo, 'snapshots', ref, 'config.json'), JSON.stringify({ hidden_size: dim }));
  return { cache, limpar: () => fs.rmSync(cache, { recursive: true, force: true }) };
}

function comAmbiente<T>(env: Record<string, string | undefined>, f: () => T): T {
  const antes = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return f(); } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('sem a chave o regime segue orkmind e o motivo tipado e embeddings.chave-ausente', () => {
  const m = manifesto(BLOCO());
  try {
    const memoria = comAmbiente({ [CHAVE]: undefined }, () => abrirMemoria(m.carregado, { driver: new DriverEmMemoria(entradas()) }));
    assert.equal(memoria.regime, 'orkmind');
    assert.equal(memoria.estado.efetivo, 'orkmind');
    assert.equal(memoria.estado.motivo, null, 'MotivoDeDegradacao nao ganha membro de embeddings');
    const e = memoria.estado.embeddings!;
    assert.equal(e.motivo, 'embeddings.chave-ausente');
    assert.equal(e.chavePresente, false);
    assert.equal(e.variavelDaChave, CHAVE);
    assert.equal(e.ativo, 'nenhum');
    assert.equal(e.sondado, true);
    assert.equal(e.cobertura, null, 'fora do memory status a cobertura nao e calculada');
  } finally { m.limpar(); }
});

test('provider none da embeddings.nao-configurado e o recall por tag fica identico', () => {
  const m = manifesto('  embedding:\n    provider: none\n');
  const sem = manifesto('');
  try {
    const driver = new DriverEmMemoria(entradas());
    const memoria = abrirMemoria(m.carregado, { driver });
    assert.equal(memoria.estado.embeddings?.motivo, 'embeddings.nao-configurado');
    assert.equal(memoria.estado.embeddings?.configurado, false);
    assert.equal(abrirMemoria(sem.carregado, { driver }).estado.embeddings?.motivo, 'embeddings.nao-configurado');
    const consulta = { tags: { project: ['fabrica'] } };
    assert.deepEqual(memoria.buscar(consulta), abrirMemoria(sem.carregado, { driver }).buscar(consulta));
  } finally { m.limpar(); sem.limpar(); }
});

test('fallback presente e chave ausente da ativo fallback, com dimensao nativa do modelo local', () => {
  const hf = cacheLocal('org/modelo-local', 48);
  const m = manifesto(BLOCO('org/modelo-local'));
  try {
    const driver = new DriverEmMemoria(entradas());
    const e = comAmbiente({ [CHAVE]: undefined, HF_HUB_CACHE: hf.cache }, () => abrirMemoria(m.carregado, { driver }).estado.embeddings!);
    assert.equal(e.ativo, 'fallback');
    assert.equal(e.motivo, 'embeddings.chave-ausente');
    assert.deepEqual(e.fallback, { modelo: 'org/modelo-local', presente: true, dependencias: true, dim: 48 });
    driver.embedding.fallback = false;
    const semDependencias = comAmbiente({ [CHAVE]: undefined, HF_HUB_CACHE: hf.cache }, () => abrirMemoria(m.carregado, { driver }).estado.embeddings!);
    assert.equal(semDependencias.ativo, 'nenhum');
    assert.match(semDependencias.detalhe, /sem torch\/transformers/);
    const semCache = comAmbiente({ [CHAVE]: undefined, HF_HUB_CACHE: path.join(hf.cache, 'vazio') }, () => abrirMemoria(m.carregado, { driver }).estado.embeddings!);
    assert.equal(semCache.fallback.presente, false);
    assert.match(semCache.detalhe, /ausente do cache local/);
  } finally { m.limpar(); hf.limpar(); }
});

test('chave presente sem indice pede ork memory index; com indice o primario fica ativo sem motivo', () => {
  const m = manifesto(BLOCO());
  try {
    const driver = new DriverEmMemoria(entradas());
    comAmbiente({ [CHAVE]: VALOR }, () => {
      const antes = abrirMemoria(m.carregado, { driver }).estado.embeddings!;
      assert.equal(antes.ativo, 'primario');
      assert.equal(antes.motivo, 'embeddings.indice-ausente');
      const memoria = abrirMemoria(m.carregado, { driver });
      const r = indexar({ raiz: m.raiz, tenant: 'fabrica', dsn: '', config: m.carregado.manifesto.memory.embedding!,
        alvo: 'primario', universo: universoDaBusca(memoria, 'fabrica'), dryRun: false, chavePresente: true,
        embeddar: p => driver.embeddar(p) });
      assert.equal(r.embedados, 3);
      const depois = abrirMemoria(m.carregado, { driver, embeddings: 'detalhado' }).estado.embeddings!;
      assert.equal(depois.motivo, null);
      assert.equal(depois.entradas, 3);
      assert.equal(depois.cobertura, 1);
      assert.deepEqual(depois.indices, [{ modelo: 'qwen/qwen3-embedding-8b', dim: 64, vetores: 3, coerentes: 3, desatualizados: 0 }]);
    });
  } finally { m.limpar(); }
});

test('cobertura cai quando o conteudo muda e o texto do status nunca imprime o valor da chave', () => {
  const m = manifesto(BLOCO());
  try {
    const base = entradas();
    const driver = new DriverEmMemoria(base);
    comAmbiente({ [CHAVE]: VALOR }, () => {
      const memoria = abrirMemoria(m.carregado, { driver });
      indexar({ raiz: m.raiz, tenant: 'fabrica', dsn: '', config: m.carregado.manifesto.memory.embedding!,
        alvo: 'primario', universo: universoDaBusca(memoria, 'fabrica'), dryRun: false, chavePresente: true,
        embeddar: p => driver.embeddar(p) });
      base[0].content = 'Rotacao de conta: conteudo revisado depois do indice';
      const estado = abrirMemoria(m.carregado, { driver, embeddings: 'detalhado' }).estado;
      assert.equal(estado.embeddings!.cobertura, 0.6667);
      assert.equal(estado.embeddings!.indices[0].desatualizados, 1);
      const texto = textoDoEstado(estado);
      assert.ok(texto.includes(`${CHAVE} presente no ambiente (valor nunca impresso)`));
      assert.ok(texto.includes('cobertura'));
      assert.ok(!texto.includes(VALOR));
      assert.ok(!JSON.stringify(estado).includes(VALOR));
    });
  } finally { m.limpar(); }
});

test('health que falha nao e sondagem: regime degrada e embeddings declaram sondado false', () => {
  const m = manifesto(BLOCO());
  try {
    const driver = new DriverEmMemoria(entradas());
    driver.ligado = false;
    const memoria = abrirMemoria(m.carregado, { driver });
    assert.equal(memoria.regime, 'files');
    assert.equal(memoria.estado.motivo, 'orkmind.indisponivel');
    assert.equal(memoria.estado.embeddings?.sondado, false);
  } finally { m.limpar(); }
});

test('sondar faz uma chamada pelo caminho ativo e mede a latencia; sem caminho ativo nao chama', () => {
  const m = manifesto(BLOCO());
  try {
    const driver = new DriverEmMemoria(entradas());
    const ativo = comAmbiente({ [CHAVE]: VALOR }, () => abrirMemoria(m.carregado, { driver }).estado.embeddings!);
    const sonda = sondarEmbeddings(m.carregado.manifesto, ativo, p => driver.embeddar(p), 15000);
    assert.equal(sonda.ok, true);
    assert.equal(sonda.alvo, 'primario');
    assert.equal(typeof sonda.latenciaMs, 'number');
    assert.equal(driver.pedidosDeEmbedding.length, 1);
    assert.deepEqual(driver.pedidosDeEmbedding[0].textos, ['sonda de saude do ork']);
    const inativo = comAmbiente({ [CHAVE]: undefined }, () => abrirMemoria(m.carregado, { driver }).estado.embeddings!);
    assert.deepEqual(sondarEmbeddings(m.carregado.manifesto, inativo, p => driver.embeddar(p), 15000),
      { ok: false, alvo: null, latenciaMs: null, motivo: 'embeddings.chave-ausente' });
    assert.equal(driver.pedidosDeEmbedding.length, 1);
    const falha = sondarEmbeddings(m.carregado.manifesto, ativo, () => { throw new Error('embeddings.timeout'); }, 15000);
    assert.equal(falha.ok, false);
    assert.equal(falha.motivo, 'embeddings.timeout');
  } finally { m.limpar(); }
});

test('estado direto sem ponte sondada nunca afirma fallback usavel', () => {
  const hf = cacheLocal('org/modelo-local', 48);
  const m = manifesto(BLOCO('org/modelo-local'));
  try {
    const e = estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, 'fabrica', '', { env: { HF_HUB_CACHE: hf.cache } });
    assert.equal(e.sondado, false);
    assert.equal(e.ativo, 'nenhum');
    assert.match(e.detalhe, /ponte nao sondada/);
  } finally { m.limpar(); hf.limpar(); }
});

test('valor da variavel que parece URL, DSN ou texto com espaco nao conta como chave e nunca e impresso', () => {
  const m = manifesto(BLOCO());
  try {
    for (const valor of ['postgresql://leitor:' + 'segredo'.repeat(3) + '@db.local/base', 'duas palavras', 'https://exemplo.local/x']) {
      const e = estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, 'fabrica', '', { env: { [CHAVE]: valor } });
      assert.equal(e.chavePresente, false);
      assert.equal(e.motivo, 'embeddings.chave-ausente');
      assert.match(e.detalhe, /valor recusado/);
      assert.ok(!JSON.stringify(e).includes(valor));
    }
    const dsn = 'dbname=memoria user=leitor';
    assert.equal(estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, 'fabrica', dsn, { env: { [CHAVE]: dsn } }).chavePresente, false);
    assert.equal(estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, 'fabrica', dsn, { env: { [CHAVE]: VALOR } }).chavePresente, true);
    const dsnUrl = 'postgresql://leitor:' + 'senha%2Fcom-barra' + '@db.local:5432/base';
    for (const senha of ['senha%2Fcom-barra', 'senha/com-barra']) {
      assert.equal(estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, 'fabrica', dsnUrl, { env: { [CHAVE]: senha } }).chavePresente, false);
    }
    assert.equal(estadoDeEmbeddings(m.carregado.manifesto, null, m.raiz, 'fabrica', dsnUrl, { env: { [CHAVE]: VALOR } }).chavePresente, true);
  } finally { m.limpar(); }
});
