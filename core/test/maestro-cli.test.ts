import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { projetoTemporario,dirTemporario } from './apoio';
import { runMaestroCli } from '../src/maestro-cli';

test('CLI executável escreve JSON íntegro sem criar ciclo, e reporta ausência no stderr',()=>{
  const p=projetoTemporario('maestro-cli'),empty=dirTemporario('maestro-cli-none');
  try {
    const before=fs.readdirSync(p.dir),cli=path.resolve(__dirname,'../src/index.js');
    const output=spawnSync(process.execPath,[cli,'maestro','--json'],{cwd:p.dir,encoding:'utf8'});
    assert.equal(output.error,undefined,output.error?.message);
    assert.equal(output.status,0,output.stderr);assert.equal(output.stderr,'');
    const snapshot=JSON.parse(output.stdout);assert.equal(snapshot.schema,'ork.maestro-snapshot/v1');
    assert.equal(snapshot.sections.threads.coverage.total,0);assert.deepEqual(fs.readdirSync(p.dir),before);
    const missing=spawnSync(process.execPath,[cli,'maestro','--json'],{cwd:empty,encoding:'utf8'});
    assert.equal(missing.error,undefined,missing.error?.message);
    assert.equal(missing.status,1);assert.equal(missing.stdout,'');assert.match(missing.stderr,/maestro.project.missing/);
  } finally {p.limpar();fs.rmSync(empty,{recursive:true});}
});
test('CLI ambiguo e argumentos arbitrários são recusados; help distingue a conversa',()=>{
  const a=projetoTemporario('maestro-cli-a'),b=projetoTemporario('maestro-cli-b');
  try {
    let out='',err='';const io={out:(s:string)=>{out+=s;},err:(s:string)=>{err+=s;}};
    assert.equal(runMaestroCli(['--json'],a.dir,{allowedRoots:[a.dir,b.dir]},io),1);assert.match(err,/ambiguous/);assert.equal(out,'');
    assert.equal(runMaestroCli(['--shell','true'],a.dir,{},io),2);
    assert.equal(runMaestroCli(['--help'],a.dir,{},io),0);assert.match(out,/orkastery maestro/);
  } finally {a.limpar();b.limpar();}
});
