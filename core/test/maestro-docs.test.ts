import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
const root=path.resolve(__dirname,'../../..');
const {verifyDocs}=require(path.join(root,'core/scripts/verify-maestro-docs.cjs'));

test('narrativa candidata exige evidência e rejeita capacidade/recibo/promessa adulterados',()=>{
  const matrix=JSON.parse(fs.readFileSync(path.join(root,'docs/referencia/maestro-capacidades.json'),'utf8'));
  const docs=Object.fromEntries(matrix.documents.map((f:string)=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.deepEqual(verifyDocs(root,matrix,docs),[]);
  const missing=structuredClone(matrix);missing.capabilities[0].evidence=[];
  assert.ok(verifyDocs(root,missing,docs).includes('maestro.docs.evidence-missing'));
  const drift=structuredClone(matrix);drift.capabilities[0].scope='write-anything';
  assert.ok(verifyDocs(root,drift,docs).includes('maestro.docs.capability-drift'));
  const live=structuredClone(matrix);live.stage='live';live.liveReceipts={author:'agent',ok:true};
  assert.ok(verifyDocs(root,live,docs).includes('maestro.docs.live-receipt-unverified'));
  live.liveReceipts=null;assert.ok(verifyDocs(root,live,docs).length);
  const web={...docs,'README.pt-BR.md':docs['README.pt-BR.md'].replace('<!-- maestro-i32:end -->','Agora oferece controle web.\n<!-- maestro-i32:end -->')};
  assert.ok(verifyDocs(root,matrix,web).includes('maestro.docs.unsupported-promise'));
  const historical={...docs,'README.pt-BR.md':docs['README.pt-BR.md']+'\nHistórico: oferecia controle web em outra iniciativa.'};
  assert.deepEqual(verifyDocs(root,matrix,historical),[]);
});
