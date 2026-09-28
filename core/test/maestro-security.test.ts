import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { discoverMaestro } from '../src/maestro-discovery';
import { maestroSnapshot } from '../src/maestro-snapshot';
import { collectMaestroSources, MaestroReader, item } from '../src/maestro-sources';

test('redige valores, chaves sensíveis, IDs, origens e ações; não executa dados redigidos',()=>{
  const p=projetoTemporario('maestro-secrets');
  try {
    const ctx=discoverMaestro({cwd:p.dir}),secret='sk-'+ 'a'.repeat(30);
    const s=maestroSnapshot(ctx,{collect:()=>({fingerprint:'f'.repeat(64),unchanged:()=>true,gaps:[secret],conflicts:[],sections:{
      nextActions:{source:`/home/private/${secret}`,gaps:[secret],items:[{...item('action',secret,'ready',[{kind:'thread',id:secret}],{password:'plain-sensitive',info:`postgres://user:pass@host/db`,apiKey:'opaque-key',location:'/home/private/location'}),
        action:{operation:'thread.status',available:true,reason:secret,preconditions:[secret],readback:secret}}]}}})});
    const raw=JSON.stringify(s);
    for(const leak of [secret,'plain-sensitive','opaque-key','user:pass','/home/private'])assert.ok(!raw.includes(leak),leak);
    assert.equal(s.sections.nextActions.items[0].action!.available,false);
  } finally {p.limpar();}
});

test('fonte corrompida ou symlink não vaza conteúdo nem vira vazio confiável',()=>{
  const p=projetoTemporario('maestro-symlink');
  try {
    const ctx=discoverMaestro({cwd:p.dir}),file=path.join(p.dir,'.orkastery/portfolio.json');
    fs.writeFileSync(file,'{corrupt');
    assert.equal(maestroSnapshot(ctx).sections.portfolio.state,'unavailable');
    fs.unlinkSync(file);fs.symlinkSync(path.join(p.dir,'orkastery.yaml'),file);
    assert.throws(()=>new MaestroReader(p.dir).read('.orkastery/portfolio.json'),/scope/);
    assert.equal(maestroSnapshot(ctx).sections.portfolio.state,'unavailable');
    assert.throws(()=>new MaestroReader(p.dir).read('../outside'),/scope/);
  } finally {p.limpar();}
});

test('mudança real de fonte após leitura gera conflito após uma única releitura',()=>{
  const p=projetoTemporario('maestro-race');let calls=0;
  try {
    const ctx=discoverMaestro({cwd:p.dir});
    const s=maestroSnapshot(ctx,{collect:c=>{
      calls++;const result=collectMaestroSources(c);
      fs.writeFileSync(path.join(p.dir,'.orkastery/portfolio.json'),JSON.stringify({schema:'changed',n:calls}));return result;
    }});
    assert.equal(calls,2);assert.ok(s.conflicts.includes('maestro.snapshot.stale'));
    assert.equal(s.sections.threads.state,'conflict');
  } finally {p.limpar();}
});
