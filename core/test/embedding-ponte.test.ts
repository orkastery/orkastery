/**
 * I-38 (T2, C13): operacao `embed` da ponte Python, no interpretador do OrkMind instalado.
 *
 * Nada aqui usa rede nem modelo real: o provider do OpenRouter e trocado por um falso
 * deterministico, e o cache do Hugging Face aponta para um diretorio vazio. Os valores com
 * cara de segredo sao montados em tempo de execucao.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pythonFixture } from './native-fixture';

const PONTE = path.resolve(__dirname, '../../assets/orkmind_bridge.py');

function rodarPython(corpo: string, env: Record<string, string> = {}) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-embed-hf-'));
  const py = String.raw`
import asyncio, importlib.util, sys, json
spec = importlib.util.spec_from_file_location('bridge', sys.argv[1]); b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
import orkmind.embeddings.provider as prov
chamadas = []
class Falso:
    def __init__(self, **kw):
        chamadas.append(kw)
        self.kw = kw
    async def embed_batch(self, textos):
        return [[float((i + j) % 7) / 7 + 0.01 for j in range(self.kw['embedding_dim'])] for i, _ in enumerate(textos)]
prov.OpenRouterEmbeddingProvider = Falso
def pedido(**kw):
    base = {'op': 'embed', 'papel': 'documento', 'alvo': 'primario', 'modelo': 'qwen/qwen3-embedding-8b', 'dim': 64, 'textos': ['entrada de memoria']}
    base.update(kw); return base
async def falha(req, codigo):
    try:
        await b.embed(req)
    except b.QueryError as e:
        assert e.code == codigo, (e.code, codigo)
        return
    raise AssertionError('aceito: ' + codigo)
${corpo}
`;
  try {
    return spawnSync(pythonFixture(), ['-c', py, PONTE], { encoding: 'utf8', timeout: 60_000,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PYTHONDONTWRITEBYTECODE: '1',
        HF_HOME: cache, HF_HUB_CACHE: path.join(cache, 'hub'), ...env } });
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
}

test('embed primario usa o provider da biblioteca com request_dimensions e a chave pelo nome fixo', () => {
  const r = rodarPython(String.raw`
async def run():
    out = await b.embed(pedido(textos=['uma entrada', 'outra entrada']))
    assert out['alvo'] == 'primario' and out['dim'] == 64 and len(out['vetores']) == 2
    assert all(len(v) == 64 for v in out['vetores'])
    kw = chamadas[0]
    assert kw['api_key_env'] == 'ORKMIND_EMBEDDING_API_KEY' and kw['request_dimensions'] is True
    assert kw['embedding_dim'] == 64 and kw['model'] == 'qwen/qwen3-embedding-8b' and kw['timeout_s'] <= 10
    print('primario ok')
asyncio.run(run())`, { ORKMIND_EMBEDDING_API_KEY: ['falsa', 'x'.repeat(24)].join('-') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /primario ok/);
});

test('embed confere a dimensao devolvida e recusa vetor divergente', () => {
  const r = rodarPython(String.raw`
class Curto(Falso):
    async def embed_batch(self, textos):
        return [[0.1] * (self.kw['embedding_dim'] - 1) for _ in textos]
class Faltando(Falso):
    async def embed_batch(self, textos):
        return [[0.1] * self.kw['embedding_dim']]
class NaoFinito(Falso):
    async def embed_batch(self, textos):
        return [[float('nan')] * self.kw['embedding_dim'] for _ in textos]
async def run():
    for classe in (Curto, Faltando, NaoFinito):
        prov.OpenRouterEmbeddingProvider = classe
        await falha(pedido(textos=['a', 'b']), 'embeddings.dimensao-divergente')
    print('dimensao ok')
asyncio.run(run())`, { ORKMIND_EMBEDDING_API_KEY: ['falsa', 'y'.repeat(24)].join('-') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /dimensao ok/);
});

test('texto com padrao de segredo e recusado antes de instanciar o provider', () => {
  const r = rodarPython(String.raw`
async def run():
    segredos = ['sk-' + 'ant-' + 'a' * 20, 'sk-' + 'or-v1-' + 'b' * 40, 'gh' + 'p_' + 'c' * 30,
                'postgresql://usuario:' + 'senha' * 3 + '@db.local/base', 'AKIA' + 'D' * 16]
    for s in segredos:
        await falha(pedido(textos=['ok', 'entrada com ' + s]), 'embeddings.conteudo-recusado')
        await falha(pedido(alvo='fallback', modelo='intfloat/multilingual-e5-small', textos=[s]), 'embeddings.conteudo-recusado')
    assert chamadas == [], chamadas
    print('segredo ok')
asyncio.run(run())`, { ORKMIND_EMBEDDING_API_KEY: ['falsa', 'z'.repeat(24)].join('-') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /segredo ok/);
});

test('sem chave no ambiente o primario responde chave-ausente sem provider', () => {
  const r = rodarPython(String.raw`
async def run():
    await falha(pedido(), 'embeddings.chave-ausente')
    assert chamadas == []
    print('chave ok')
asyncio.run(run())`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /chave ok/);
});

test('falha do provider vira codigo tipado, timeout separado, sem texto do provider', () => {
  const r = rodarPython(String.raw`
import httpx
class Rede(Falso):
    async def embed_batch(self, textos):
        raise prov.EmbeddingError('API retornou erro HTTP 401: ' + 'eco-da-entrada') from httpx.ConnectError('x')
class Lento(Falso):
    async def embed_batch(self, textos):
        raise prov.EmbeddingError('Erro de rede') from httpx.ReadTimeout('lento')
async def run():
    prov.OpenRouterEmbeddingProvider = Rede
    await falha(pedido(), 'embeddings.provider-indisponivel')
    prov.OpenRouterEmbeddingProvider = Lento
    await falha(pedido(), 'embeddings.timeout')
    print('provider ok')
asyncio.run(run())`, { ORKMIND_EMBEDDING_API_KEY: ['falsa', 'w'.repeat(24)].join('-') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /provider ok/);
});

test('modelo local ausente do cache responde local-ausente, offline', () => {
  const r = rodarPython(String.raw`
import os
async def run():
    await falha(pedido(alvo='fallback', modelo='org-inexistente/modelo-ausente'), 'embeddings.local-ausente')
    assert os.environ['HF_HUB_OFFLINE'] == '1'
    print('local ok')
asyncio.run(run())`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /local ok/);
});

test('pedido fora do contrato e recusado antes de qualquer provider', () => {
  const r = rodarPython(String.raw`
async def run():
    invalidos = [pedido(dim=16), pedido(dim=True), pedido(textos=[]), pedido(textos=['x'] * 33),
                 pedido(textos=['x' * 24001]), pedido(textos=['   ']), pedido(papel='outro'), pedido(alvo='nuvem'),
                 pedido(modelo='sem-org'), dict(pedido(), extra=1)]
    for req in invalidos:
        await falha(req, 'memory.embed.invalid')
    assert chamadas == []
    print('contrato ok')
asyncio.run(run())`, { ORKMIND_EMBEDDING_API_KEY: ['falsa', 'v'.repeat(24)].join('-') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /contrato ok/);
});

test('nenhuma outra operacao instancia provider e embed nao le a DSN', () => {
  const r = rodarPython(String.raw`
import os
class Proibido:
    def __init__(self, **kw):
        raise AssertionError('provider instanciado fora do embed')
prov.OpenRouterEmbeddingProvider = Proibido
b.LocalEmbeddingProvider = Proibido
from orkmind.core.models import MemoryEntry
q = {'op': 'query', 'collection': 'handoff', 'tags': {'project': ['fabrica'], 'situation': ['thread:ork-teste']}, 'limit': 3}
e = MemoryEntry(id='propria', collection='handoff', content='Contexto', tags=q['tags'])
class Store:
    async def search_by_tags(self, *a, **k): return [e]
    async def count(self, c=None): return 1
    async def list_collections(self): return ['handoff']
async def run():
    assert (await b.execute({'op': 'stats'}, Store())) == {'handoff': 1}
    assert (await b.execute(q, Store()))[0]['id'] == 'propria'
    assert (await b.execute({'op': 'export', 'collection': 'handoff'}, Store()))[0]['id'] == 'propria'
    assert 'ORKMIND_DATABASE_URL' not in os.environ
    try:
        await b.main(pedido())
    except b.QueryError as err:
        assert err.code == 'embeddings.chave-ausente', err.code
    else:
        raise AssertionError('embed sem chave aceito')
    print('isolamento ok')
asyncio.run(run())`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /isolamento ok/);
});

test('prefixo de instrucao depende da familia do modelo e nunca altera o conteudo', () => {
  const r = rodarPython(String.raw`
assert b.model_prefix('intfloat/multilingual-e5-small', 'consulta') == 'query: '
assert b.model_prefix('intfloat/multilingual-e5-small', 'documento') == 'passage: '
assert b.model_prefix('qwen/qwen3-embedding-8b', 'consulta').startswith('Instruct: ')
assert b.model_prefix('qwen/qwen3-embedding-8b', 'documento') == ''
assert b.model_prefix('org/outro-modelo', 'consulta') == ''
async def run():
    capturado = []
    class Captura(Falso):
        async def embed_batch(self, textos):
            capturado.extend(textos); return await Falso.embed_batch(self, textos)
    prov.OpenRouterEmbeddingProvider = Captura
    await b.embed(pedido(textos=['conteudo integral']))
    assert capturado == ['conteudo integral'], capturado
    print('prefixo ok')
asyncio.run(run())`, { ORKMIND_EMBEDDING_API_KEY: ['falsa', 'u'.repeat(24)].join('-') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /prefixo ok/);
});
