import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DriverEmMemoria, entradaDoJson } from '../src/orkmind';
import { abrirMemoria, gravarPolicies, sincronizarMemoria } from '../src/memoria';
import { projetoTemporario } from './apoio';
import { EntradaNova } from '../src/types';

const original: EntradaNova = { collection: 'decision', source: 'agent', priority: 'high',
  content: 'Decisao D1 de teste: preservar os contratos publicados durante a evolucao de fase.',
  tags: { project: ['orkastery'], skill: ['GO', 'orkastery-decision'],
    situation: ['decision', 'thread:teste', 'decisao:D1', 'fase:GO'], agent: ['codex:modelo-teste', 'ork'] },
  metadata: { thread: 'teste', decisao: 'D1', origem: 'thread.json', autor: 'autor original' } };
const seguinte = (): EntradaNova => ({ ...original, tags: { ...original.tags,
  skill: ['CHECK', 'orkastery-decision'], situation: ['decision', 'thread:teste', 'decisao:D1', 'fase:CHECK'], agent: ['claude-bg:modelo-teste', 'ork'] } });

test('duplo de decision conserva ID entre fases e recusa colisao de tenant, proveniencia ou privilegios', () => {
  const d = new DriverEmMemoria(), first = d.adicionar(original), second = d.adicionar(seguinte());
  assert.equal(second.ok, true); assert.equal(first.id, second.id);
  const saved = d.recuperar('decision', first.id!)!;
  assert.ok(saved.tags.skill.includes('GO') && saved.tags.skill.includes('CHECK'));
  assert.ok(saved.tags.agent.includes('codex:modelo-teste') && saved.tags.agent.includes('claude-bg:modelo-teste'));
  const before = JSON.stringify(d.tudo());
  assert.equal(d.adicionar(original).id, first.id); assert.equal(d.adicionar(seguinte()).id, first.id);
  assert.equal(JSON.stringify(d.tudo()), before);
  for (const invalid of [
    { ...seguinte(), tags: { ...seguinte().tags, project: ['outro'] } },
    { ...seguinte(), tags: { ...seguinte().tags, situation: ['decision', 'thread:outra', 'decisao:D1'] } },
    { ...seguinte(), metadata: { ...original.metadata, autor: 'outro autor' } },
    { ...seguinte(), priority: 'critical' as const },
    { ...seguinte(), metadata: { ...original.metadata, orkastery_identity: 'forjada' } },
    { ...seguinte(), source: 'human' as const, metadata: { proveniencia: { tipo: 'human_gate', source: 'human', confirmado: true,
      autor: 'Pessoa', evento: 'ledger#1', evidencia: 'prompt.md', sha256: 'abc' } } },
  ]) assert.equal(d.adicionar(invalid).ok, false);
  assert.equal(JSON.stringify(d.tudo()), before);
  const semIdentidade = structuredClone(saved);
  delete semIdentidade.metadata.orkastery_identity; delete semIdentidade.metadata.orkastery_identity_version;
  const legado = new DriverEmMemoria([semIdentidade]);
  assert.equal(legado.adicionar(original).ok, false, 'entrada sem origem comprovada no duplo nao e adotada');
});

test('ponte e biblioteca reais evoluem tags sem duplicar, validam T5 e recusam legado ou identidade divergente', t => {
  const cli = (process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, 'orkmind')).find(p => fs.existsSync(p));
  if (!cli) {
    assert.notEqual(process.env.ORK_I06_REQUIRE_REAL_DATABASE, '1', 'OrkMind obrigatorio na aceitacao real');
    t.skip('biblioteca opcional ausente no CI'); return;
  }
  const python = /^#!(\S+)/.exec(fs.readFileSync(cli, 'utf8'))?.[1]; assert.ok(python);
  const r = spawnSync(python, ['-c', `
import asyncio,copy,hashlib,importlib.util,json,logging,sys
from orkmind.core.config import OrkMindConfig
from orkmind.core.models import MemoryEntry
from orkmind.core.semantic_layer import SemanticLayer
from orkmind.store.factory import create_store
logging.disable(logging.CRITICAL)
spec=importlib.util.spec_from_file_location('bridge',sys.argv[1]);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
async def empty():
 s=create_store(OrkMindConfig(store_backend='memory'));await s.initialize();return s
async def run():
 d=json.load(sys.stdin);p=d['original'];q=d['seguinte'];s=await empty()
 a=await b.execute({'op':'add','entrada':p},s);z=await b.execute({'op':'add','entrada':q},s)
 assert a['id']==z['id'] and z['duplicada'] and await s.count()==1
 saved=await s.retrieve(a['id']);snapshot=saved.model_dump(mode='json')
 assert set(saved.tags['skill'])=={'GO','CHECK','orkastery-decision'}
 assert saved.metadata['autor']=='autor original' and saved.source=='agent' and saved.priority=='high' and not saved.mandatory
 found=await s.search_by_tags({'project':['orkastery'],'skill':['CHECK']},collection='decision',limit=10)
 assert any(e.id==a['id'] for e in found)
 for item in (p,q,p):
  again=await b.execute({'op':'add','entrada':item},s);assert again['id']==a['id'] and again['duplicada']
 assert (await s.retrieve(a['id'])).model_dump(mode='json')==snapshot
 invalid=[]
 for field,value in [('project',['outro']),('situation',['decision','thread:outra','decisao:D1']),('skill',['instrucao-nova'])]:
  item=copy.deepcopy(q);item['tags'][field]=value;invalid.append(item)
 item=copy.deepcopy(q);item['metadata']['autor']='outro autor';invalid.append(item)
 item=copy.deepcopy(q);item['priority']='critical';invalid.append(item)
 item=copy.deepcopy(q);item['mandatory']=True;invalid.append(item)
 item=copy.deepcopy(q);item['metadata']['orkastery_identity']='forjada';invalid.append(item)
 item=copy.deepcopy(q);item['source']='human';item['metadata']={'proveniencia':{'tipo':'human_gate','source':'human','confirmado':True,'autor':'Pessoa','evento':'ledger#1','evidencia':'prompt.md','sha256':'abc'}};invalid.append(item)
 for item in invalid:
  try: await b.execute({'op':'add','entrada':item},s)
  except ValueError: pass
  else: raise AssertionError('colisao indevida aceita')
  assert await s.count()==1 and (await s.retrieve(a['id'])).model_dump(mode='json')==snapshot
 await s.close()
 for declared_source in (True,False):
  for kind in ('T5','legacy','forged'):
   s=await empty();old=copy.deepcopy(p)
   if not declared_source: old.pop('source')
   meta=copy.deepcopy(old['metadata'])
   if kind=='T5': meta['orkastery_identity']=hashlib.sha256(b.encoded(old).encode()).hexdigest()
   if kind=='forged': meta['orkastery_identity']='a'*64
   e=MemoryEntry(collection='decision',content=old['content'],tags=old['tags'],priority='high',source='agent',scope='project',visibility='public',metadata=meta)
   await SemanticLayer(s,embedder=None,semantic_enabled=False).add_memory(e)
   before=(await s.retrieve(e.id)).model_dump(mode='json')
   try: result=await b.execute({'op':'add','entrada':q},s)
   except ValueError:
    assert kind!='T5';assert (await s.retrieve(e.id)).model_dump(mode='json')==before
   else:
    assert kind=='T5' and result['id']==e.id
    upgraded=await s.retrieve(e.id);assert upgraded.metadata['orkastery_identity_version']==2
    after=upgraded.model_dump(mode='json');again=await b.execute({'op':'add','entrada':p},s)
    assert again['id']==e.id and (await s.retrieve(e.id)).model_dump(mode='json')==after
   assert await s.count()==1;await s.close()
 for collection in ('rule','learning','roadmap'):
  s=await empty();item=copy.deepcopy(p);item['collection']=collection
  e=MemoryEntry(collection=collection,content=item['content'],tags=item['tags'],priority='high',source='agent',scope='project',metadata={'origem':'legado sem prova'})
  await SemanticLayer(s,embedder=None).add_memory(e)
  before=(await s.retrieve(e.id)).model_dump(mode='json')
  for _ in range(2):
   try: await b.execute({'op':'add','entrada':item},s)
   except b.LegacyProvenanceCollision: pass
   else: raise AssertionError('legado adotado')
   assert await s.count()==1 and (await s.retrieve(e.id)).model_dump(mode='json')==before
  await s.close()
 print('PASS: decision GO/CHECK, mesmo ID, tags consultaveis, idempotencia, T5 comprovada, isolamento e legado recusado')
try: asyncio.run(run())
except Exception as error:
 import traceback
 frame=traceback.extract_tb(error.__traceback__)[-1]
 print('FAIL:'+type(error).__name__+'@'+frame.name+':'+str(frame.lineno));raise SystemExit(1)
`, path.resolve(__dirname, '../../assets/orkmind_bridge.py')], { encoding: 'utf8', input: JSON.stringify({ original, seguinte: seguinte() }),
    timeout: 15000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONDONTWRITEBYTECODE: '1' } });
  const diagnostico = r.stdout.match(/FAIL:[A-Za-z]+@[A-Za-z_]+:\d+/)?.[0] ?? 'sem diagnostico seguro';
  assert.equal(r.status, 0, `sonda real deve passar (${diagnostico}); stderr do filho nao e exibido`);
  assert.match(r.stdout, /^PASS: decision/);
});


test('tres rules legadas continuam falhas tipadas e preservam conteudo, source e historico', () => {
  const p = projetoTemporario('legacy-policies');
  try {
    p.carregado.manifesto.memory.mode = 'orkmind';
    p.carregado.manifesto.memory.database_url_env = 'FIXTURE_NAO_ABRIR_BANCO';
    const gerador = new DriverEmMemoria();
    gravarPolicies(abrirMemoria(p.carregado, { driver: gerador }), p.carregado.manifesto);
    const antigas = gerador.tudo().map(e => ({ ...structuredClone(e),
      metadata: { origem: 'legado sem fingerprint', historico: ['registro anterior'] }, tags: { project: ['orkastery'] } }));
    assert.equal(antigas.length, 3);
    const driver = new DriverEmMemoria(antigas), memoria = abrirMemoria(p.carregado, { driver });
    const before = JSON.stringify(driver.tudo());
    for (let i = 0; i < 2; i++) {
      const r = sincronizarMemoria(p.carregado, memoria, null);
      assert.equal(r.policies.falhas, 3); assert.equal(r.falhas, 3);
      assert.ok(r.policies.gravadas.every(e => !e.ok && !e.id && e.detalhe === 'memory.legacy.provenance-collision'));
      assert.equal(JSON.stringify(driver.tudo()), before);
    }
  } finally { p.limpar(); }
});


test('CG10: entry semeada com identidade comprovada equivale a ponte; legado e forjada continuam recusados', () => {
  const produtor = new DriverEmMemoria();
  const r = produtor.adicionar(original);
  const seeded = structuredClone(produtor.recuperar('decision', r.id!)!);
  const d = new DriverEmMemoria([seeded]);
  assert.equal(d.adicionar(seguinte()).ok, true);
  assert.equal(d.adicionar(seguinte()).id, seeded.id);
  for (const identity of [undefined, 'a'.repeat(64)]) {
    const invalid = structuredClone(seeded);
    if (identity) invalid.metadata.orkastery_identity = identity;
    else delete invalid.metadata.orkastery_identity;
    const bad = new DriverEmMemoria([invalid]), before = JSON.stringify(bad.tudo());
    assert.equal(bad.adicionar(original).ok, false);
    assert.equal(JSON.stringify(bad.tudo()), before);
  }
});


test('CG10/F2: seeds T5 e v2 com chaves astrais aninhadas sao reconhecidas no duplo', () => {
  const cli = (process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, 'orkmind')).find(p => fs.existsSync(p));
  assert.ok(cli, 'prova cruzada exige biblioteca instalada, sem banco');
  const python = /^#!(\S+)/.exec(fs.readFileSync(cli, 'utf8'))?.[1]; assert.ok(python);
  const cruzada = { ...original, metadata: { ...original.metadata,
    '\u{1D400}': 'astral', '\uFF21': 'BMP', lista: [{ '\u{1F600}': 1, '\uE000': 2 }] } };
  const r = spawnSync(python, ['-c', `
import asyncio,copy,hashlib,importlib.util,json,sys
from orkmind.core.config import OrkMindConfig
from orkmind.core.models import MemoryEntry
from orkmind.store.factory import create_store
spec=importlib.util.spec_from_file_location('b',sys.argv[1]);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
async def run():
 p=json.load(sys.stdin);out=[]
 for collection in ('decision','rule'):
  item=copy.deepcopy(p);item['collection']=collection
  s=create_store(OrkMindConfig(store_backend='memory'));await s.initialize()
  result=await b.execute({'op':'add','entrada':item},s)
  saved=await s.retrieve(result['id']);out.append({'entrada':item,'seed':saved.model_dump(mode='json')})
  if collection=='decision':
   for source in (True,False):
    legacy=copy.deepcopy(item)
    if not source: legacy.pop('source')
    saved.metadata={**item['metadata'],'orkastery_identity':hashlib.sha256(b.encoded(legacy).encode()).hexdigest()}
    out.append({'entrada':item,'seed':saved.model_dump(mode='json')})
  await s.close()
 print(json.dumps(out))
asyncio.run(run())
`, path.resolve(__dirname, '../../assets/orkmind_bridge.py')], { encoding: 'utf8', input: JSON.stringify(cruzada),
    timeout: 15000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, 'geracao isolada de seeds pela ponte');
  for (const { entrada, seed } of JSON.parse(r.stdout)) {
    const e = entradaDoJson(seed)!; assert.ok(e);
    const d = new DriverEmMemoria([e]);
    const result = d.adicionar(entrada.collection === 'decision' ? { ...entrada, tags: seguinte().tags } : entrada);
    assert.equal(result.ok, true); assert.equal(result.id, e.id); assert.equal(result.duplicada, true);
    const bad = structuredClone(e); bad.metadata.orkastery_identity = 'b'.repeat(64);
    const invalid = new DriverEmMemoria([bad]), before = JSON.stringify(invalid.tudo());
    assert.equal(invalid.adicionar(entrada).ok, false); assert.equal(JSON.stringify(invalid.tudo()), before);
  }
});
