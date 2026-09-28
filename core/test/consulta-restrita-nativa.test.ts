import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { usingFixture, pythonFixture, fixtureEnv, assets } from './native-fixture';

test('consulta delimitada usa PostgreSQL governado e filtra na origem antes da janela', () => {
  usingFixture(receipt => {
    const script = String.raw`
import asyncio, json, logging, os, sys, uuid
from datetime import datetime, timedelta, timezone
sys.path.insert(0, sys.argv[2])
import psycopg
import orkmind_bridge as bridge
from orkmind_fixture import connect_fixture, fixture_dsn
from orkmind.core.config import OrkMindConfig
from orkmind.core.models import MemoryEntry
from orkmind.store.factory import create_store
logging.disable(logging.CRITICAL)
assert not any(k in os.environ for k in ('DATABASE_URL','ORKMIND_DATABASE_URL','OPENAI_API_KEY','ANTHROPIC_API_KEY'))
async def run():
 boot, fixture = await connect_fixture(sys.argv[1])
 schema = 'query_' + uuid.uuid4().hex
 await boot.execute(psycopg.sql.SQL('CREATE SCHEMA {}').format(psycopg.sql.Identifier(schema)))
 dsn = psycopg.conninfo.make_conninfo(fixture_dsn(fixture), options=f'-c search_path={schema},public')
 store = create_store(OrkMindConfig(database_url=dsn, store_backend='pgvector', embedding_provider=''))
 try:
  await store.inner.initialize()
  async def seed(name, tenant='synthetic', thread='ork-query', **extra):
   e = MemoryEntry(content='Synthetic bounded query '+name, collection='decision', source='agent',
     author_id='fixture-agent', tags={'project':[tenant],'situation':['thread:'+thread]},
     embedding=[0.01]*1024, **extra)
   await store.store(e)
   return e.id
  expected = {await seed('one'), await seed('two')}
  for n in range(6):
   await seed('other-tenant-'+str(n),tenant='synthetic-other',priority='high')
   await seed('other-thread-'+str(n),thread='ork-other',priority='high')
  await seed('expired',expires_at=datetime.now(timezone.utc)-timedelta(days=1))
  await seed('injection',injection_risk=True)
  raw_search = store.inner.search_by_tags
  calls = []
  async def observe(tags, collection=None, mandatory_only=False, limit=50, requester_id=None):
   rows = await raw_search(tags,collection,mandatory_only,limit,requester_id)
   calls.append({'tags':tags,'collection':collection,'limit':limit,'requester':requester_id,
                 'ids':{e.id for e in rows}})
   return rows
  store.inner.search_by_tags = observe
  async def forbidden(*args, **kwargs): raise AssertionError('broad fallback forbidden')
  store.count = forbidden
  store.retrieve = forbidden
  request = {'op':'query','collection':'decision','tags':{'project':['synthetic'],
    'situation':['thread:ork-query']},'limit':4}
  result = await bridge.execute(request,store)
  assert {e['id'] for e in result} == expected
  assert len(calls)==1 and calls[0]['ids']==expected, 'filter must occur in backend before returning rows'
  assert calls[0]['tags']==request['tags'] and calls[0]['limit']==4 and calls[0]['requester'] is None
  try: await bridge.execute({**request,'limit':2},store)
  except bridge.QueryError as e: assert str(e)=='memory.query.window-saturated'
  else: raise AssertionError('full window accepted')
  assert len(calls)==2, 'no count, retry or fallback after saturation'
  empty = await bridge.execute({**request,'tags':{**request['tags'],'situation':['thread:ork-empty']}},store)
  assert empty==[] and calls[-1]['ids']==set()
  count=len(calls)
  try: await bridge.execute({**request,'requester_id':'owner'},store)
  except bridge.QueryError as e: assert str(e)=='memory.query.invalid'
  else: raise AssertionError('requester override accepted')
  assert len(calls)==count
  print('PASS: bounded native query; tenant/thread pushdown; expiry/injection; saturation; requester unchanged')
 finally:
  await store.close()
  await boot.execute(psycopg.sql.SQL('DROP SCHEMA {} CASCADE').format(psycopg.sql.Identifier(schema)))
  await boot.close()
asyncio.run(run())
`;
    const r = spawnSync(pythonFixture(), ['-c', script, receipt, assets], {
      encoding: 'utf8', env: fixtureEnv(), timeout: 60000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS: bounded native query/);
    console.log(r.stdout.trim());
  });
});
