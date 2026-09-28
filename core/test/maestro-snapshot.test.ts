import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { createProduct, createProject } from '../src/portfolio';
import { createObjective } from '../src/objective';
import { novaThread } from '../src/thread';
import { discoverMaestro } from '../src/maestro-discovery';
import { maestroSnapshot } from '../src/maestro-snapshot';
import { collectMaestroSources } from '../src/maestro-sources';
import { readMaestro } from '../src/maestro-cli';

test('GO-FIX4: envelope inválido não vaza para correlações nem aborta o snapshot', () => {
  const p=projetoTemporario('maestro-invalid-envelope');
  try {
    createProduct(p.dir,{id:'prod-fixture',title:'Produto',status:'delivered'});
    createProject(p.dir,{id:'proj-fixture',productId:'prod-fixture',title:'Projeto',status:'delivered'});
    const objective=createObjective(p.carregado,{title:'Demanda',request:'Teste',doneWhen:['verde'],productId:'prod-fixture',projectId:'proj-fixture',delivery:'project'});
    const file=path.join(p.dir,'.orkastery/objectives',objective.id,'objective.json');
    const context=discoverMaestro({cwd:p.dir});
    for(const invalid of [{...objective,envelope:null}, {...objective,envelope:{...objective.envelope,portfolio:{initiativeIds:null}}},
      {...objective,threads:[null]}, {...objective,threads:[{id:null}]}]) {
      fs.writeFileSync(file,JSON.stringify(invalid));
      for(const threadId of [undefined,objective.threads[0].id]) {
        const s=maestroSnapshot(context,{collect:c=>collectMaestroSources(c,{threadId})});
        assert.equal(s.sections.demands.state,'unavailable');
        assert.equal(s.sections.demands.coverage.total,null);
        assert.deepEqual(s.sections.demands.items,[]);
        assert.equal(s.sections.portfolio.state,'available');
        assert.equal(s.sections.threads.state,'available');
        assert.ok(s.sections.threads.items.every(t=>t.refs.length===0));
        assert.ok(s.sections.threads.gaps.includes('demands.unavailable'));
        assert.ok(!s.gaps.some(g=>g.startsWith('thread.without_objective:')||g.startsWith('portfolio.without_demand:')));
        assert.ok(!s.conflicts.some(g=>g.startsWith('entity.delivered_cycle_open:')));
      }
    }
  } finally {p.limpar();}
});

test('GO-FIX4: thread e catálogo estruturalmente inválidos são descartados antes de derivar seções', () => {
  const p=projetoTemporario('maestro-invalid-sources');
  try {
    createProduct(p.dir,{id:'prod-fixture',title:'Produto'});
    const t=novaThread(p.carregado,{nome:'Fonte',modo:'auto'}).thread;
    const file=path.join(p.dir,'.orkastery/threads',t.id,'thread.json'), context=discoverMaestro({cwd:p.dir});
    for(const invalid of [{...t,blocos:null,sessoes:[{sessionId:'fixture-session',fase:'GO',runtime:'codex'}]},
      {...t,sessoes:[null]}, {...t,id:null}]) {
      fs.writeFileSync(file,JSON.stringify(invalid));
      const s=maestroSnapshot(context);
      assert.equal(s.sections.threads.state,'unavailable');
      for(const name of ['sessions','blockers','hitl','ship','master'] as const) {
        assert.equal(s.sections[name].state,'unavailable');
        assert.deepEqual(s.sections[name].items,[]);
      }
      assert.equal(s.sections.portfolio.state,'available');
    }
    fs.writeFileSync(file,JSON.stringify(t));
    const catalog=path.join(p.dir,'.orkastery/portfolio.json'), original=JSON.parse(fs.readFileSync(catalog,'utf8'));
    for(const invalid of [{...original,products:[{...original.products[0],id:null}]},{...original,products:[null]},
      {...original,projects:null}]) {
      fs.writeFileSync(catalog,JSON.stringify(invalid));
      const s=maestroSnapshot(context);
      assert.equal(s.sections.portfolio.state,'unavailable');
      assert.deepEqual(s.sections.portfolio.items,[]);
      assert.equal(s.sections.threads.state,'available');
    }
  } finally {p.limpar();}
});

test('snapshot correlaciona IDs e conserva divergência catálogo/ciclo sem inferir SHIP',()=>{
  const p=projetoTemporario('maestro-snapshot');
  try {
    createProduct(p.dir,{id:'prod-fixture',title:'Ensaio',status:'delivered'});
    createProduct(p.dir,{id:'prod-unrelated',title:'Ensaio',status:'delivered'});
    createProject(p.dir,{id:'proj-fixture',productId:'prod-fixture',title:'Entregue no catálogo',status:'delivered'});
    const objective=createObjective(p.carregado,{title:'Ciclo aberto',request:'Ensaio',doneWhen:['verde'],productId:'prod-fixture',projectId:'proj-fixture',delivery:'project'});
    const orphan=novaThread(p.carregado,{nome:'Sem objective',modo:'auto'}).thread;
    const context=discoverMaestro({cwd:p.dir}), result=maestroSnapshot(context);
    assert.ok(result.conflicts.includes('entity.delivered_cycle_open:proj-fixture'));
    assert.ok(result.conflicts.includes('entity.delivered_cycle_open:prod-fixture'));
    assert.ok(!result.gaps.includes('portfolio.without_demand:prod-fixture'));
    assert.ok(result.gaps.includes('portfolio.without_demand:prod-unrelated'));
    assert.ok(!result.conflicts.includes('entity.delivered_cycle_open:prod-unrelated'));
    assert.ok(result.gaps.includes(`thread.without_objective:${orphan.id}`));
    assert.equal(result.sections.demands.items[0].id,objective.id);
    assert.ok(result.sections.demands.items[0].refs.some(r=>r.kind==='product'&&r.id==='prod-fixture'));
    assert.ok(result.sections.demands.items[0].refs.some(r=>r.kind==='project'&&r.id==='proj-fixture'));
    assert.ok(result.sections.portfolio.items.every(i=>i.facts.deliveryProven===false));
    assert.ok(result.sections.threads.items.some(i=>i.refs.some(r=>r.id===objective.id)));
    const before=fs.readFileSync(path.join(p.dir,'.orkastery/portfolio.json'));
    maestroSnapshot(context);assert.deepEqual(fs.readFileSync(path.join(p.dir,'.orkastery/portfolio.json')),before);
    fs.writeFileSync(path.join(p.dir,'.orkastery/portfolio.json'),'{broken');
    assert.equal(maestroSnapshot(context).sections.portfolio.state,'unavailable');
  } finally {p.limpar();}
});
test('duas leituras divergentes resultam em conflito com origem, não transação fictícia',()=>{
  const p=projetoTemporario('maestro-stale');let calls=0;
  try {
    const context=discoverMaestro({cwd:p.dir});
    const result=maestroSnapshot(context,{collect:ctx=>{calls++;return {...collectMaestroSources(ctx),unchanged:()=>false};}});
    assert.equal(calls,2);assert.ok(result.conflicts.includes('maestro.snapshot.stale'));
    assert.equal(result.sections.threads.state,'conflict');
  } finally {p.limpar();}
});

test('thread ilegível propaga indisponibilidade às projeções dependentes sem fingir filas vazias', () => {
  const p = projetoTemporario('maestro-thread-unavailable');
  try {
    const t = novaThread(p.carregado, { nome: 'Fonte', modo: 'auto' }).thread;
    const file = path.join(p.dir, '.orkastery/threads', t.id, 'thread.json');
    const context = discoverMaestro({ cwd: p.dir });
    const read = (threadId?: string) => readMaestro(context, { threadId, host: { tools: [], child: false } });
    assert.equal(read().sections.hitl.state, 'empty');
    fs.writeFileSync(file, '{broken');
    for (const snapshot of [read(), read(t.id), read('ork-missing')]) {
      for (const name of ['sessions', 'blockers', 'hitl', 'ship', 'master', 'nextActions'] as const) {
        const section = snapshot.sections[name];
        assert.equal(section.state, 'unavailable', name);
        assert.equal(section.coverage.total, null, name);
        assert.equal(section.coverage.omitted, null, name);
        assert.ok(section.gaps.includes('threads.unavailable'), name);
      }
      for (const name of ['leases', 'retries'] as const) {
        assert.equal(snapshot.sections[name].state, 'empty');
        assert.equal(snapshot.sections[name].coverage.total, 0);
      }
    }
  } finally { p.limpar(); }
});
