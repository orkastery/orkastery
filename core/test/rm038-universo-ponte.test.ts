/**
 * RM-038 (fatia de correcao): a ponte Python le o universo da busca ate o fim e o FTS fica dentro dele.
 *
 * A fixture e o GovernedStore real da biblioteca instalada sobre o adapter em memoria: a mesma
 * governanca da producao (o search_by_tags tira injection_risk e expiradas; o search_by_text nao
 * tira injection_risk), sem rede e sem base. Roda no interpretador do OrkMind instalado, por isso o
 * arquivo esta em TESTES_DE_INTEGRACAO_LOCAL.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assets, fixtureEnv, pythonFixture, usingFixture } from './native-fixture';
import { semOrkMind, semPostgres } from './ambiente-de-teste';

const PONTE = path.resolve(__dirname, '../../assets/orkmind_bridge.py');

function rodarPython(corpo: string, nome: string) {
  const py = String.raw`
import asyncio, importlib.util, sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location('bridge', sys.argv[1]); b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
from orkmind.core.config import OrkMindConfig
from orkmind.core.models import MemoryEntry
from orkmind.store.factory import create_store
T = 'fabrica'
async def falha(pedido, store, codigo):
    try:
        await b.execute(pedido, store)
    except b.QueryError as e:
        assert e.code == codigo, (e.code, codigo)
        return
    raise AssertionError('aceito: ' + codigo)
async def povoado():
    """150 do tenant em decision (acima das janelas padrao 10, 50 e 100) e o que nunca entra no universo."""
    s = create_store(OrkMindConfig(store_backend='memory', embedding_provider=''))
    def e(i, c, p, **kw): return MemoryEntry(id=i, collection=c, content='comum entrada ' + i, tags={'project': p}, **kw)
    for n in range(150):
        await s.store(e('d%03d' % n, 'decision', [T]))
    for i, c in (('r1', 'rule'), ('l1', 'learning'), ('h1', 'handoff'), ('m1', 'roadmap')):
        await s.store(e(i, c, [T]))
    await s.store(e('inj', 'learning', [T], injection_risk=True))
    await s.store(e('exp', 'roadmap', [T], expires_at=datetime.now(timezone.utc) - timedelta(days=1)))
    await s.store(e('alheia', 'decision', ['outro-produto']))
    await s.store(e('dupla', 'rule', ['outro-produto', T + '-x']))
    await s.store(e('ses', 'session', [T]))
    return s
UNIVERSO = {'d%03d' % n for n in range(150)} | {'r1', 'l1', 'h1', 'm1'}
${corpo}
`;
  const r = spawnSync(pythonFixture(), ['-c', py, PONTE], { encoding: 'utf8', timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(nome));
}

test('rm038 ponte: universo le ate o fim pelo GovernedStore real e deixa fora o que a governanca tira', { skip: semOrkMind() }, () => {
  rodarPython(String.raw`
async def run():
    s = await povoado()
    out = await b.execute({'op': 'universo', 'tenant': T}, s)
    ids = [x['id'] for x in out['entradas']]
    assert len(ids) == len(set(ids)) == 154, len(ids)
    assert set(ids) == UNIVERSO, set(ids) ^ UNIVERSO
    assert all(x['collection'] in b.ORK_COLLECTIONS and T in x['tags']['project'] for x in out['entradas'])
    assert out['foraDaBusca'] is None, out['foraDaBusca']
    print('universo inteiro')
asyncio.run(run())`, 'universo inteiro');
});

test('rm038 ponte: universo pede a colecao inteira mais um e sai window-saturated quando a janela enche', { skip: semOrkMind() }, () => {
  rodarPython(String.raw`
def e(i, c='decision'): return MemoryEntry(id=i, collection=c, content='x ' + i, tags={'project': [T]})
class Contado:
    """Conta a colecao com folga negativa: a escrita concorrente entre a contagem e a leitura."""
    def __init__(self, por_colecao, folga=0): self.por = por_colecao; self.folga = folga; self.pedidos = []
    async def count(self, c=None): return len(self.por.get(c, [])) + self.folga
    async def search_by_tags(self, tags, collection=None, limit=50, **kw):
        self.pedidos.append((tags, collection, limit)); return self.por.get(collection, [])[:limit]
async def run():
    exato = Contado({'decision': [e('a'), e('b')], 'rule': [e('r', 'rule')]})
    out = await b.execute({'op': 'universo', 'tenant': T}, exato)
    assert sorted(x['id'] for x in out['entradas']) == ['a', 'b', 'r']
    assert exato.pedidos == [({'project': [T]}, c, (2 if c == 'decision' else 1 if c == 'rule' else 0) + 1)
                             for c in b.ORK_COLLECTIONS], exato.pedidos
    await falha({'op': 'universo', 'tenant': T}, Contado({'decision': [e('a'), e('b')]}, folga=-1), 'memory.query.window-saturated')
    print('janela da colecao')
asyncio.run(run())`, 'janela da colecao');
});

test('rm038 ponte: universo recusa entrada fora do predicado e pedido invalido antes de I/O', { skip: semOrkMind() }, () => {
  rodarPython(String.raw`
class Fixo:
    def __init__(self, entradas): self.entradas = entradas; self.chamadas = 0
    async def count(self, c=None): self.chamadas += 1; return 10
    async def search_by_tags(self, tags, collection=None, limit=50, **kw):
        self.chamadas += 1; return [x for x in self.entradas if x.collection == collection]
def e(i, p, **kw): return MemoryEntry(id=i, collection='decision', content='x ' + i, tags={'project': p}, **kw)
async def run():
    for ruim in (e('alheia', ['outro-produto']), e('inj', [T], injection_risk=True),
                 e('exp', [T], expires_at=datetime.now(timezone.utc) - timedelta(hours=1)),
                 SimpleNamespace(id='texto', collection='decision', tags={'project': T + '-outro'}, injection_risk=False, expires_at=None)):
        await falha({'op': 'universo', 'tenant': T}, Fixo([e('ok', [T]), ruim]), 'memory.query.scope-violation')
    await falha({'op': 'universo', 'tenant': T}, Fixo([e('rep', [T]), MemoryEntry(id='rep', collection='rule', content='y', tags={'project': [T]})]),
                'memory.query.scope-violation')
    for ruim in ({'op': 'universo'}, {'op': 'universo', 'tenant': ''}, {'op': 'universo', 'tenant': '  '},
                 {'op': 'universo', 'tenant': 'a\x00b'}, {'op': 'universo', 'tenant': 'x' * 129},
                 {'op': 'universo', 'tenant': T, 'collection': 'rule'}, {'op': 'universo', 'tenant': ['fabrica']}):
        vazio = Fixo([])
        await falha(ruim, vazio, 'memory.universo.invalid')
        assert vazio.chamadas == 0
    print('fronteira do universo')
asyncio.run(run())`, 'fronteira do universo');
});

test('rm038 ponte: fts devolve so ids do universo e o conjunto do termo comum e o proprio universo', { skip: semOrkMind() }, () => {
  rodarPython(String.raw`
async def run():
    s = await povoado()
    # O search_by_text governado alcanca a entrada com injection_risk; o FTS da ponte nao a devolve.
    crus = {x.id for x in await s.search_by_text('comum', limit=await s.count() + 1)}
    assert 'inj' in crus and 'alheia' in crus and 'ses' in crus, crus
    ids = (await b.execute({'op': 'fts', 'tenant': T, 'texto': 'comum'}, s))['ids']
    assert len(ids) == len(set(ids)) and set(ids) == UNIVERSO, set(ids) ^ UNIVERSO
    universo = {x['id'] for x in (await b.execute({'op': 'universo', 'tenant': T}, s))['entradas']}
    assert set(ids) == universo
    texto = SimpleNamespace(id='texto', collection='decision', tags={'project': T + '-outro'}, injection_risk=False, expires_at=None)
    class Cru:
        async def count(self, c=None): return 5
        async def search_by_text(self, q, collection=None, limit=10, **kw): return [texto]
    assert (await b.execute({'op': 'fts', 'tenant': T, 'texto': 'x'}, Cru()))['ids'] == []
    print('fts no universo')
asyncio.run(run())`, 'fts no universo');
});

test('rm038 ponte: fora da busca no pgvector e uma leitura so de contagem e em outro backend sai null', { skip: semOrkMind() }, () => {
  rodarPython(String.raw`
class Cursor:
    async def fetchone(self): return {'injecao': 5, 'expiradas': 0, 'outras_colecoes': 13}
class Conexao:
    def __init__(self): self.consultas = []
    async def execute(self, sql, params=None): self.consultas.append((sql, params)); return Cursor()
class Inner:
    def __init__(self): self.conn = Conexao()
    async def _get_conn(self): return self.conn
class Pg:
    capabilities = SimpleNamespace(backend='pgvector')
    def __init__(self): self.inner = Inner()
async def run():
    pg = Pg()
    assert await b.contar_fora_da_busca(pg, T) == {'injecao': 5, 'expiradas': 0, 'outrasColecoes': 13}
    (sql, params), = pg.inner.conn.consultas
    normal = ' '.join(sql.split()).lower()
    assert normal.startswith('select ') and 'count(*)' in normal and 'from memories' in normal
    assert not any(p in normal for p in ('insert', 'update', 'delete', 'content', 'returning')), normal
    assert params[-1] == T and all(list(p) == list(b.ORK_COLLECTIONS) for p in params[:-1]), params
    assert await b.contar_fora_da_busca(await povoado(), T) is None
    print('contagem so de numeros')
asyncio.run(run())`, 'contagem so de numeros');
});

test('rm038 ponte: export sai window-saturated em vez de cortar em silencio', { skip: semOrkMind() }, () => {
  rodarPython(String.raw`
class Export:
    def __init__(self, n, folga): self.n = n; self.folga = folga
    async def count(self, c=None): return self.n + self.folga
    async def search_by_tags(self, tags, collection=None, limit=50, **kw):
        return [MemoryEntry(id='e%d' % i, collection='decision', content='x %d' % i, tags={'project': [T]}) for i in range(self.n)][:limit]
async def run():
    assert len(await b.execute({'op': 'export', 'collection': 'decision'}, Export(3, 0))) == 3
    await falha({'op': 'export', 'collection': 'decision'}, Export(3, -1), 'memory.query.window-saturated')
    print('export sem corte')
asyncio.run(run())`, 'export sem corte');
});

test('rm038 ponte: universo, export e fts releem uma vez quando uma escrita isolada enche a janela', { skip: semOrkMind() }, () => {
  rodarPython(String.raw`
def e(i, c='decision'): return MemoryEntry(id=i, collection=c, content='comum ' + i, tags={'project': [T]})
class UmaEscrita:
    # A primeira contagem chega antes de uma escrita; a segunda ja a ve. Nada foi cortado.
    def __init__(self, entradas): self.entradas = entradas; self.contagens = 0
    async def count(self, c=None):
        self.contagens += 1
        total = len([x for x in self.entradas if c is None or x.collection == c])
        return total - 1 if self.contagens == 1 else total
    async def search_by_tags(self, tags, collection=None, limit=50, **kw):
        return [x for x in self.entradas if x.collection == collection][:limit]
    async def search_by_text(self, q, collection=None, limit=10, **kw): return self.entradas[:limit]
async def run():
    dados = [e('a'), e('b'), e('c')]
    assert sorted(x['id'] for x in (await b.execute({'op': 'universo', 'tenant': T}, UmaEscrita(dados)))['entradas']) == ['a', 'b', 'c']
    assert len(await b.execute({'op': 'export', 'collection': 'decision'}, UmaEscrita(dados))) == 3
    assert (await b.execute({'op': 'fts', 'tenant': T, 'texto': 'comum'}, UmaEscrita(dados)))['ids'] == ['a', 'b', 'c']
    print('uma escrita se resolve')
asyncio.run(run())`, 'uma escrita se resolve');
});

test('rm038 ponte: fts e universo julgam a expiracao pelo instante de antes da leitura', { skip: semOrkMind() }, () => {
  rodarPython(String.raw`
async def run():
    agora = datetime.now(timezone.utc)
    quase = MemoryEntry(id='quase', collection='decision', content='x', tags={'project': [T]}, expires_at=agora + timedelta(seconds=1))
    assert b.no_universo(quase, T, agora) is True
    assert b.no_universo(quase, T, agora + timedelta(seconds=2)) is False
    ingenua = SimpleNamespace(id='ingenua', collection='decision', tags={'project': [T]}, injection_risk=False,
                              expires_at=(agora + timedelta(hours=1)).replace(tzinfo=None))
    assert b.no_universo(ingenua, T, agora) is True
    print('expiracao pelo instante da leitura')
asyncio.run(run())`, 'expiracao pelo instante da leitura');
});

test('rm038 ponte: pgvector de verdade, universo, contagem de fora da busca e FTS batem com o predicado', { skip: semPostgres() }, () => {
  usingFixture(receipt => {
    const script = String.raw`
import asyncio, logging, sys, uuid
from datetime import datetime, timedelta, timezone
sys.path.insert(0, sys.argv[2])
import psycopg
import orkmind_bridge as bridge
from orkmind_fixture import connect_fixture, fixture_dsn
from orkmind.core.config import OrkMindConfig
from orkmind.core.models import MemoryEntry
from orkmind.store.factory import create_store
logging.disable(logging.CRITICAL)
T = 'fabrica'
async def run():
 boot, fixture = await connect_fixture(sys.argv[1])
 schema = 'universo_' + uuid.uuid4().hex
 await boot.execute(psycopg.sql.SQL('CREATE SCHEMA {}').format(psycopg.sql.Identifier(schema)))
 dsn = psycopg.conninfo.make_conninfo(fixture_dsn(fixture), options=f'-c search_path={schema},public')
 store = create_store(OrkMindConfig(database_url=dsn, store_backend='pgvector', embedding_provider=''))
 try:
  await store.inner.initialize()
  async def seed(nome, colecao, projeto, **extra):
   e = MemoryEntry(content='comum entrada ' + nome, collection=colecao, source='agent', author_id='fixture-agent',
     tags={'project': projeto}, embedding=[0.01] * 1024, **extra)
   await store.store(e)
   return e.id
  esperado = {await seed('d1', 'decision', [T]), await seed('d2', 'decision', [T]), await seed('l1', 'learning', [T]),
              await seed('multi', 'rule', ['outro-produto', T])}
  await seed('inj', 'learning', [T], injection_risk=True)
  for n in ('exp1', 'exp2'):
   await seed(n, 'roadmap', [T], expires_at=datetime.now(timezone.utc) - timedelta(days=1))
  for n in ('ses', 'log'):
   await seed(n, 'session' if n == 'ses' else 'semantic_log', [T])
  await seed('alheia', 'decision', ['outro-produto'])
  await seed('vizinha', 'decision', [T + '-x'])
  # Tenant vizinho (o nome contem o tenant) fora da busca: so um predicado por substring o contaria.
  await seed('vizinha-ses', 'session', [T + '-x'])
  await seed('vizinha-inj', 'learning', [T + '-x'], injection_risk=True)
  await seed('injalheia', 'learning', ['outro-produto'], injection_risk=True)
  out = await bridge.execute({'op': 'universo', 'tenant': T}, store)
  assert {x['id'] for x in out['entradas']} == esperado, out['entradas']
  assert all('embedding' not in x for x in out['entradas'])
  assert out['foraDaBusca'] == {'injecao': 1, 'expiradas': 2, 'outrasColecoes': 2}, out['foraDaBusca']
  assert await bridge.contar_fora_da_busca(store, 'outro-produto') == {'injecao': 1, 'expiradas': 0, 'outrasColecoes': 0}
  assert await bridge.contar_fora_da_busca(store, T + '-x') == {'injecao': 1, 'expiradas': 0, 'outrasColecoes': 1}
  ids = (await bridge.execute({'op': 'fts', 'tenant': T, 'texto': 'comum'}, store))['ids']
  assert set(ids) == esperado and len(ids) == len(set(ids)), ids
  print('PASS: pgvector universo, fora da busca e fts no mesmo predicado')
 finally:
  await store.close()
  await boot.execute(psycopg.sql.SQL('DROP SCHEMA {} CASCADE').format(psycopg.sql.Identifier(schema)))
  await boot.close()
asyncio.run(run())
`;
    const r = spawnSync(pythonFixture(), ['-c', script, receipt, assets], { encoding: 'utf8', env: fixtureEnv(), timeout: 60_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS: pgvector universo, fora da busca e fts no mesmo predicado/);
  });
});
