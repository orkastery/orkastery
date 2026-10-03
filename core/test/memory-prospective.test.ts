import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CAMPOS_NATIVOS, prepararVersaoProspectiva, hashProspectivo, SnapshotNativo } from '../src/memory-prospective';
import { projetoTemporario } from './apoio';
import { DriverEmMemoria, entradaDoJson } from '../src/orkmind';
import { abrirMemoria, gravarPolicies } from '../src/memoria';
import { semOrkMind } from './ambiente-de-teste';

function fixture() {
  const p = projetoTemporario('prospectiva-isolada');
  p.carregado.manifesto.project.name = 'tenant-sintetico';
  p.carregado.manifesto.memory.tenant = 'tenant-sintetico';
  p.carregado.manifesto.memory.database_url_env = 'FIXTURE_NAO_ABRIR_BANCO';
  p.carregado.manifesto.memory.mode = 'orkmind';
  const d = new DriverEmMemoria();
  gravarPolicies(abrirMemoria(p.carregado, { driver: d }), p.carregado.manifesto);
  const entries = d.tudo().map((e, n) => ({ ...Object.fromEntries(CAMPOS_NATIVOS.map(k => [k, null])),
    id: `00000000-0000-4000-8000-00000000000${n + 1}`, content: e.content, content_hash: hashProspectivo(e.content),
    collection: 'rule', source: 'agent', priority: 'high', mandatory: false, scope: 'project',
    protected: false, version: 1, author_id: null, visibility: 'private',
    metadata: {}, tags: { project: ['tenant-sintetico'], legado: ['preservar'], editors: [] },
    created_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z', injection_risk: false, conflict: false, encrypted: false,
    essence: 'essencia sintetica', structure: 'estrutura sintetica', url: 'https://example.invalid/preservar',
  }));
  const snapshot: SnapshotNativo = { tenant: 'tenant-sintetico', observadoEm: '2026-09-08T00:00:00Z', ids: entries.map(e => e.id), entries };
  const autoria = { agente: 'codex:modelo-fixture', revisao: 'a'.repeat(40), reciboSha256: hashProspectivo(JSON.stringify(snapshot)) };
  return { p, snapshot, autoria };
}

test('B4 preparo usa snapshot integral de tenant generico e preserva private, ACL e campos omitidos pelo arquivo nativo', () => {
  const { p, snapshot, autoria } = fixture();
  try {
    const r = prepararVersaoProspectiva(p.carregado, snapshot, autoria);
    assert.equal(r.executavel, false); assert.equal(r.aplicacaoDisponivel, false); assert.equal(r.liberaShip, false);
    assert.equal(r.impedimento, 'memory.legacy.provenance-collision');
    assert.equal(r.entradas.length, 3);
    for (const e of r.entradas) {
      assert.equal(e.origemHistorica, 'desconhecida');
      assert.deepEqual(e.antes, snapshot.entries.find(x => x.id === e.id));
      for (const k of CAMPOS_NATIVOS.filter(k => !['metadata', 'tags'].includes(k))) assert.deepEqual(e.proposta[k], e.antes[k], k);
      assert.deepEqual(e.proposta.tags.legado, ['preservar']); assert.deepEqual(e.proposta.tags.editors, []);
      assert.equal(e.proposta.visibility, 'private'); assert.equal(e.proposta.author_id, null);
    }
    for (const mutate of [
      (x: SnapshotNativo) => x.entries.pop(),
      (x: SnapshotNativo) => { x.entries[1].id = x.entries[0].id; },
      (x: SnapshotNativo) => { x.entries[1].content_hash = '0'.repeat(64); },
      (x: SnapshotNativo) => { x.entries[1].source = 'human'; },
      (x: SnapshotNativo) => { x.entries[1].mandatory = true; },
      (x: SnapshotNativo) => { x.entries[1].author_id = 'autor-inventado'; },
      (x: SnapshotNativo) => { x.entries[1].visibility = 'public'; },
      (x: SnapshotNativo) => { x.entries[1].tags.editors = ['pessoa']; },
      (x: SnapshotNativo) => { delete x.entries[1].essence; },
    ]) { const x = structuredClone(snapshot); mutate(x); assert.throws(() => prepararVersaoProspectiva(p.carregado, x, autoria), /memory.prospective/); }
    p.carregado.manifesto.policies!.provider = 'warn';
    assert.throws(() => prepararVersaoProspectiva(p.carregado, snapshot, autoria), /hash-mismatch/);
  } finally { p.limpar(); }
});

test('B4 marcador integral sobrevive sync normal e repetido no duplo e na ponte nativa privada', { skip: semOrkMind() }, () => {
  const { p, snapshot, autoria } = fixture();
  try {
    const plano = prepararVersaoProspectiva(p.carregado, snapshot, autoria);
    const seeds = plano.entradas.map(e => e.proposta);
    const d = new DriverEmMemoria(seeds.map(e => entradaDoJson(e)!));
    const before = JSON.stringify(d.tudo());
    for (let n = 0; n < 3; n++) {
      assert.equal(gravarPolicies(abrirMemoria(p.carregado, { driver: d }), p.carregado.manifesto).falhas, 0);
      assert.equal(JSON.stringify(d.tudo()), before);
    }
    for (const seed of seeds) {
      const marker = seed.metadata.orkastery_prospective as Record<string, string>;
      assert.deepEqual(JSON.parse(marker.originalJson), snapshot.entries.find(e => e.id === seed.id));
      assert.equal(hashProspectivo(marker.originalJson), marker.originalSha256);
    }
    const pedidos: unknown[] = [];
    const capturar = new DriverEmMemoria();
    const add = capturar.adicionar.bind(capturar);
    capturar.adicionar = entrada => { pedidos.push(entrada); return add(entrada); };
    gravarPolicies(abrirMemoria(p.carregado, { driver: capturar }), p.carregado.manifesto);
    for (const mutate of [
      (x: typeof seeds) => { (x[0].metadata.orkastery_prospective as Record<string, string>).historicalOrigin = 'human'; },
      (x: typeof seeds) => { (x[0].metadata.orkastery_prospective as Record<string, string>).originalJson = '{}'; },
      (x: typeof seeds) => { x[0].visibility = 'public'; },
      (x: typeof seeds) => { x[0].tags.editors = ['novo']; },
    ]) {
      const invalid = structuredClone(seeds); mutate(invalid);
      const bad = new DriverEmMemoria(invalid.map(e => entradaDoJson(e)!)), bytes = JSON.stringify(bad.tudo());
      assert.ok(gravarPolicies(abrirMemoria(p.carregado, { driver: bad }), p.carregado.manifesto).falhas > 0);
      assert.equal(JSON.stringify(bad.tudo()), bytes);
    }
    const cli = (process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, 'orkmind')).find(p => fs.existsSync(p));
    assert.ok(cli); const python = /^#!(\S+)/.exec(fs.readFileSync(cli, 'utf8'))![1];
    const r = spawnSync(python, ['-c', `
import asyncio,copy,importlib.util,json,sys
from orkmind.core.config import OrkMindConfig
from orkmind.core.models import MemoryEntry
from orkmind.store.factory import create_store
spec=importlib.util.spec_from_file_location('b',sys.argv[1]);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
async def run():
 data=json.load(sys.stdin);s=create_store(OrkMindConfig(store_backend='memory'));await s.initialize()
 for seed in data['seeds']:await s.store(MemoryEntry.model_validate(seed))
 async def read():return [(await s.retrieve(e['id'])).model_dump(mode='json') for e in data['seeds']]
 before=await read()
 for _ in range(3):
  for entry in data['pedidos']:
   r=await b.execute({'op':'add','entrada':entry},s);assert r['duplicada'] and 'historical-origin-unknown' in r['detalhe']
  assert await read()==before
 for field,value in [('visibility','public'),('protected',True),('source','human')]:
  old=await s.retrieve(data['seeds'][0]['id']);bad=old.model_copy(deep=True,update={field:value})
  entry=MemoryEntry.model_validate({**data['pedidos'][0], 'metadata':{**data['pedidos'][0]['metadata'],'orkastery_identity':b.hashlib.sha256(b.encoded(data['pedidos'][0]).encode()).hexdigest()}})
  assert not b.prospective_compatible(bad,entry)
 await s.close();print('PASS: native private sync preserves full marker, original snapshot and ACL')
asyncio.run(run())
`, path.resolve(__dirname, '../../assets/orkmind_bridge.py')], { input: JSON.stringify({ seeds, pedidos }), encoding: 'utf8',
      timeout: 15000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^PASS:/);
  } finally { p.limpar(); }
});

test('B4 comando recusa aplicacao antes de carregar projeto ou banco', () => {
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../src/memory-prospective.js'), '--apply'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stderr).erro, 'memory.prospective.apply-unavailable');
});

test('G3/G4/G10: produtor e validadores TS/Python recusam agentes human, protected nao booleano e scopes divergentes', { skip: semOrkMind() }, () => {
  const { p, snapshot, autoria } = fixture();
  try {
    const { agenteProspectivoValido, prospectivaCompativel } = require('../src/orkmind');
    const agents = ['codex:fixture', 'human:pessoa', 'codex:human', 'Human:pessoa', 'codex:HuMaN', 'codex:humanoid', '', null, 'a:b:c'];
    for (const agente of agents) {
      if (agente !== 'codex:fixture') assert.throws(() => prepararVersaoProspectiva(p.carregado, snapshot, { ...autoria, agente: agente as string }), /authorship/);
      assert.equal(agenteProspectivoValido(agente), agente === 'codex:fixture');
    }
    const plan = prepararVersaoProspectiva(p.carregado, snapshot, autoria);
    const seed = plan.entradas[0].proposta;
    const capturar = new DriverEmMemoria(), pedidos: any[] = [], add = capturar.adicionar.bind(capturar);
    capturar.adicionar = e => { pedidos.push(e); return add(e); };
    gravarPolicies(abrirMemoria(p.carregado, { driver: capturar }), p.carregado.manifesto);
    const pedido = pedidos.find(e => e.content === seed.content);
    const metadata = { ...seed.metadata }; delete metadata.orkastery_prospective;
    const cases: any[] = [];
    const include = (name: string, mutate: (old: any, request: any) => void, expected: boolean) => {
      const old = structuredClone(seed), request = structuredClone(pedido); mutate(old, request);
      const normalized = { ...entradaDoJson(old)!, protected: old.protected, mandatory: old.mandatory };
      const actual = prospectivaCompativel(normalized, request, metadata);
      assert.equal(actual, expected, name); cases.push({ name, old, request, metadata, expected });
    };
    include('control', () => {}, true);
    for (const agent of agents) if (agent !== 'codex:fixture') include('agent:'+agent, old => { old.metadata.orkastery_prospective.agent=agent; }, false);
    for (const protectedValue of [true, null, 0, '', 'false']) include('protected:'+JSON.stringify(protectedValue), old => { old.protected=protectedValue; }, false);
    include('scope old and original global', old => {
      old.scope='global'; const marker=old.metadata.orkastery_prospective, original=JSON.parse(marker.originalJson);
      original.scope='global'; marker.originalJson=JSON.stringify(original); marker.originalSha256=hashProspectivo(marker.originalJson);
    }, false);
    include('scope request global', (_old, request) => { request.scope='global'; }, false);
    include('reduced marker', old => { old.metadata.orkastery_prospective={schema:'ork.prospective-origin/v1'}; }, false);
    for (const c of cases.filter(c => c.name.startsWith('agent:') || c.name==='reduced marker')) {
      const bad=new DriverEmMemoria([entradaDoJson(c.old)!]), before=JSON.stringify(bad.tudo());
      assert.equal(bad.adicionar(pedido).detalhe,'memory.prospective.marker-invalid');
      assert.equal(JSON.stringify(bad.tudo()),before);
    }
    const cli=(process.env.PATH??'').split(path.delimiter).map(p=>path.join(p,'orkmind')).find(p=>fs.existsSync(p))!;
    const python=/^#!(\S+)/.exec(fs.readFileSync(cli,'utf8'))![1];
    const r=spawnSync(python,['-c',`
import json,sys,types
sys.path.insert(0,sys.argv[1]);import orkmind_bridge as b
from orkmind.core.models import MemoryEntry
cases=json.load(sys.stdin)
for case in cases:
 old=types.SimpleNamespace(**case['old']);request=case['request']
 entry=types.SimpleNamespace(**{**request,'scope':request.get('scope','project'),'source':request.get('source','agent'),'metadata':case['metadata']})
 assert b.prospective_compatible(old,entry)==case['expected'],case['name']
assert b.error_code(b.ProspectiveMarkerInvalid())=='memory.prospective.marker-invalid'
assert b.error_code(OSError())=='memory.bridge.failed'
print('PASS: cross-language negative matrix',len(cases))
`,path.resolve(__dirname,'../../assets')],{encoding:'utf8',input:JSON.stringify(cases),timeout:15000,
      env:{PATH:process.env.PATH,HOME:process.env.HOME,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/PASS:/);
  } finally { p.limpar(); }
});
