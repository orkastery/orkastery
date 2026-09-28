"""Dados sinteticos; positivos possuem autor fixture previamente estabelecido, orfas sao negativas."""
import asyncio, copy, hashlib, json, logging, os, sys, uuid, time
from pathlib import Path
sys.path.insert(0, sys.argv[2])
import orkmind_prospective as p
import orkmind_bridge as b
import psycopg
from orkmind.core.config import OrkMindConfig
from orkmind.core.models import MemoryEntry
from orkmind.core.ontology import ProtectionError
from orkmind.store.factory import create_store
logging.disable(logging.CRITICAL)
assert not any(k in os.environ for k in ('DATABASE_URL', 'ORKMIND_DATABASE_URL', 'ORKASTERY_ORKMIND_DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'))
async def run():
 from orkmind_fixture import connect_fixture, fixture_dsn
 boot,fixture=await connect_fixture(sys.argv[1])
 schema='run_'+uuid.uuid4().hex
 await boot.execute(psycopg.sql.SQL('CREATE SCHEMA {}').format(psycopg.sql.Identifier(schema)))
 dsn=psycopg.conninfo.make_conninfo(fixture_dsn(fixture),options=f'-c search_path={schema},public')
 s=create_store(OrkMindConfig(database_url=dsn,embedding_provider=''))
 try:
  await s.inner.initialize();conn=await s.inner._get_conn();checks=[]
 except BaseException:
  await s.close()
  await boot.execute(psycopg.sql.SQL('DROP SCHEMA {} CASCADE').format(psycopg.sql.Identifier(schema)))
  await boot.close()
  raise
 async def rehearse(plan,requester='fixture-agent',**kwargs):
  return await p.rehearse(s,plan,requester,fixture_receipt=sys.argv[1],**kwargs)
 async def setup(case,author='fixture-agent',protected=False,source='agent'):
  items=[];requests=[]
  for n in range(3):
   content=f'Synthetic governed prospective {schema} {case} {n}'
   entry=MemoryEntry(content=content,collection='rule',source=source,priority='high',mandatory=False,
     scope='project',visibility='private',author_id=author,protected=protected,
     embedding=[(i%97-48)/97 for i in range(1024)],tags={'project':['synthetic'], 'old':['keep']},
     essence='all fields',structure='structured fixture',url='https://example.invalid/preserve',
     encryption_meta={'synthetic':True},content_hash=hashlib.sha256(content.encode()).hexdigest())
   await s.store(entry);old=p.dump(await s.retrieve(entry.id))
   request={'collection':'rule','source':'agent','content':content,'priority':'high','metadata':{'policy':'synthetic'},'tags':{'project':['synthetic'],'agent':['codex:fixture']}}
   original=json.dumps(old,ensure_ascii=False)
   marker={'schema':'ork.prospective-origin/v1','historicalOrigin':'unknown','source':'agent','entryId':entry.id,
    'agent':'codex:fixture','revision':'a'*40,'receiptSha256':'b'*64,'originalJson':original,'originalSha256':hashlib.sha256(original.encode()).hexdigest()}
   desired=copy.deepcopy(old);desired['metadata']={**request['metadata'],'orkastery_identity':hashlib.sha256(b.encoded(request).encode()).hexdigest(),'orkastery_prospective':marker}
   desired['tags']={k:sorted(set(old['tags'].get(k,[]))|set(request['tags'].get(k,[]))) for k in set(old['tags'])|set(request['tags'])}
   items.append({'id':entry.id,'antes':old,'proposta':desired});requests.append(request)
  return {'entradas':items,'autoriaProspectiva':{'source':'agent','agente':'codex:fixture'}},requests
 async def state(plan):return [p.dump(await s.retrieve(i['id'])) for i in sorted(plan['entradas'],key=lambda e:e['id'])]
 async def counts():
  return [dict(await (await conn.execute('SELECT count(*) AS n FROM '+table)).fetchone())['n'] for table in ('memories','memory_versions')]
 async def full_state():
  tables=['memories','memory_versions','snapshots','snapshot_entries','profiles']
  return {table:await (await conn.execute('SELECT to_jsonb(t) AS row FROM '+table+' t ORDER BY to_jsonb(t)::text')).fetchall() for table in tables}
 async def refused(plan,**kwargs):
  before=await full_state();c=await counts();expected_error=kwargs.pop('expected_error',None)
  try:await rehearse(plan,kwargs.pop('requester','fixture-agent'),**kwargs)
  except (ValueError,PermissionError,RuntimeError,ProtectionError) as error:
   if expected_error:assert str(error)==expected_error,str(error)
  else:raise AssertionError('negative accepted')
  assert await full_state()==before and await counts()==c
 try:
  plan,requests=await setup('rollback-second');await refused(plan,fail_after=2);checks.append('atomic rollback after second write and receipt absent')
  plan,requests=await setup('success');before=await state(plan)
  async def probe(ids):
   other=await psycopg.AsyncConnection.connect(dsn,autocommit=True)
   try:
    async with other.transaction():await other.execute('SELECT id FROM memories WHERE id=%s FOR UPDATE NOWAIT',(ids[0],))
   except psycopg.errors.LockNotAvailable:pass
   else:raise AssertionError('lock missing during rehearsal')
   finally:await other.close()
  started=time.perf_counter()
  result=await rehearse(plan,'fixture-agent',locked_probe=probe);assert result['updated']==3
  after=await state(plan);receipt=json.loads((await s.retrieve(result['receiptId'])).content)
  assert receipt['before']==before and receipt['after']==after
  assert [e['version'] for e in after]==[2,2,2]
  for old,new in zip(before,after):
   for k in old:
    if k not in ('tags','metadata','version','updated_at'):assert old[k]==new[k],k
  for _ in range(2):
   for request in requests:assert (await b.execute({'op':'add','entrada':request},s))['duplicada']
   assert await state(plan)==after and json.loads((await s.retrieve(result['receiptId'])).content)==receipt
  measured={'vectorDimensions':1024,'markerBytes':[len(json.dumps(e['metadata']['orkastery_prospective'],ensure_ascii=False).encode()) for e in after],
   'receiptBytes':len(json.dumps(receipt,ensure_ascii=False).encode()),'applyReadAndSixSyncMs':(time.perf_counter()-started)*1000}
  assert min(measured['markerBytes'])>11300
  print('CAPACITY: '+json.dumps(measured))
  checks.append('native commit and bridge sync preserve complete marker, receipt, private and ACL')
  c=await counts();assert (await rehearse(plan,'fixture-agent'))['replay'];assert await counts()==c
  checks.append('replay no version or receipt write')
  checks.append('independent connection observes locks inside rehearsal')
  await refused(plan,rollback_receipt=result['receiptId'],fail_after=2)
  rolled=await rehearse(plan,'fixture-agent',rollback_receipt=result['receiptId'])
  back=await state(plan)
  for old,new in zip(before,back):assert p.same_payload(old,new) and new['version']==3
  assert (await rehearse(plan,'fixture-agent',rollback_receipt=result['receiptId']))['replay']
  assert (await s.retrieve(result['receiptId'])).content==json.dumps(receipt,ensure_ascii=False)
  checks.append('compensating rollback atomic, versioned, idempotent and original receipt durable')
  await refused(plan,rollback_receipt=rolled['receiptId'],expected_error='memory.prospective.receipt-conflict')
  checks.append('rollback receipt cannot be used as original; all data and receipts invariant')
  for name,value in [('schema','invalid'),('agent','codex:HuMaN'),('revision','invalid'),('receiptSha256','invalid'),
    ('originalJson','{invalid'),('originalSha256','0'*64),('source','human'),('entryId','invalid')]:
   bad,_=await setup('marker-'+name);bad['entradas'][1]['proposta']['metadata']['orkastery_prospective'][name]=value
   await refused(bad,expected_error='memory.prospective.marker-invalid');checks.append('marker '+name+' refused; full data and receipts invariant')
  bad,_=await setup('marker-reduced');bad['entradas'][1]['proposta']['metadata']['orkastery_prospective']={'schema':'ork.prospective-origin/v1'}
  await refused(bad,expected_error='memory.prospective.marker-invalid');checks.append('reduced marker refused; full data and receipts invariant')
  plan,_=await setup('stale');plan['entradas'][1]['antes']['version']=0;await refused(plan);checks.append('stale version refused')
  plan,_=await setup('acl-change');plan['entradas'][1]['proposta']['tags']['editors']=['*'];await refused(plan);checks.append('ACL expansion refused')
  plan,_=await setup('visibility');plan['entradas'][1]['proposta']['visibility']='public';await refused(plan);checks.append('visibility expansion refused')
  plan,_=await setup('missing');del plan['entradas'][1]['proposta']['essence'];await refused(plan);checks.append('incomplete snapshot refused')
  for case,kw in [('protected',{'protected':True}),('human',{'source':'human'}),('orphan',{'author':None})]:
   plan,_=await setup(case,**kw);await refused(plan);checks.append(case+' refused before write')
  plan,_=await setup('requester');await refused(plan,requester='');checks.append('missing requester refused')
  before=await full_state();c=await counts()
  try:
   async with conn.transaction():
    await conn.execute('SET TRANSACTION READ ONLY');await rehearse(plan,'fixture-agent')
  except psycopg.errors.ReadOnlySqlTransaction:pass
  else:raise AssertionError('read only accepted')
  assert await full_state()==before and await counts()==c;checks.append('read only enforced')
  print('PASS: native preparation '+json.dumps(checks))
 finally:
  await conn.close()
  # Only the freshly created run schema; never clear a shared or operational database.
  await boot.execute(psycopg.sql.SQL('DROP SCHEMA {} CASCADE').format(psycopg.sql.Identifier(schema)))
  await boot.close()
asyncio.run(run())
