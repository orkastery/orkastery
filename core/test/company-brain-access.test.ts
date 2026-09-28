import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateRequest, BRAIN_API } from '../src/company-brain-client';
test('T15: principal, DSN e shell não entram pelo contrato de consulta',()=>{
  for(const key of ['principal','dsn','root','shell','owner','host'])assert.throws(()=>validateRequest({schema:BRAIN_API,operation:'get',payload:{tenant_id:'synthetic',id:'prod-test'},[key]:'forged'}),/brain.api.invalid/);
});
