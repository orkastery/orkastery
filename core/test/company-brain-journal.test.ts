import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { portfolioMutation, readJournal, recoverPortfolio, replaceWithJournal } from '../src/company-brain-journal';
test('T10: crash entre intenção, fonte e recibo recupera sem duplicar efeito', () => {
  for (const stage of ['intent', 'source', 'confirmed']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-journal-')), file = path.join(dir, 'portfolio.json');
    try {
      fs.writeFileSync(file, '{"before":true}');
      assert.throws(() => replaceWithJournal(file, { after: true }, s => { if (s === stage) throw Error('crash'); }), /crash/);
      recoverPortfolio(file); const once = fs.readFileSync(file + '.journal.jsonl'); recoverPortfolio(file);
      assert.ok(once.equals(fs.readFileSync(file + '.journal.jsonl')));
      assert.equal(readJournal(file + '.journal.jsonl').at(-1).type, stage === 'intent' ? 'aborted' : 'confirmed');
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), stage === 'intent' ? { before: true } : { after: true });
      portfolioMutation(file, () => assert.throws(() => portfolioMutation(file, () => {}), /busy/));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
test('T10: fonte divergente e journal parcial exigem recuperação explícita', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-journal-')), file = path.join(dir, 'portfolio.json');
  try {
    assert.throws(() => replaceWithJournal(file, { after: true }, () => { throw Error('crash'); }));
    fs.writeFileSync(file, 'concurrent'); assert.throws(() => recoverPortfolio(file), /source-conflict/);
    fs.appendFileSync(file + '.journal.jsonl', '{'); assert.throws(() => recoverPortfolio(file), /incomplete/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('GO-FIX R3: abrupt process death releases ownership, never steals a live writer',()=>{
  const {spawnSync}=require('node:child_process');
  const module=path.resolve(__dirname,'../src/company-brain-journal');
  for(const stage of ['intent','source','confirmed']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-journal-kill-')),file=path.join(dir,'portfolio.json');
    try{
      fs.writeFileSync(file,JSON.stringify({before:true}));
      const script=`const j=require(${JSON.stringify(module)});j.portfolioMutation(${JSON.stringify(file)},()=>j.replaceWithJournal(${JSON.stringify(file)},{after:true},s=>{if(s===${JSON.stringify(stage)})process.kill(process.pid,'SIGKILL')}));`;
      const r=spawnSync(process.execPath,['-e',script],{stdio:'ignore'});assert.equal(r.error,undefined);assert.equal(r.signal,'SIGKILL');
      portfolioMutation(file,()=>{});
      assert.equal(readJournal(file+'.journal.jsonl').at(-1).type,stage==='intent'?'aborted':'confirmed');
      portfolioMutation(file,()=>{
        const r=spawnSync(process.execPath,['-e',`try{require(${JSON.stringify(module)}).portfolioMutation(${JSON.stringify(file)},()=>process.exit(44))}catch(e){if(e.message==='brain.journal.busy')process.exit(23);throw e}`],{stdio:'ignore'});
        assert.equal(r.error,undefined);assert.equal(r.status,23);
      });
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
