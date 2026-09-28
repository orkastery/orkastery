import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { camposNativos } from '../src/orkmind';
import { pythonFixture, fixtureEnv, assets } from './native-fixture';

test('G8 contrato compartilhado coincide com MemoryEntry real; drift aditivo e subtrativo falham explicitamente', () => {
  const CAMPOS_NATIVOS = camposNativos();
  const r=spawnSync(pythonFixture(),['-c',`
import json,sys
sys.path.insert(0,sys.argv[1]);import orkmind_bridge as b
from orkmind.core.models import MemoryEntry
expected=json.load(sys.stdin)
assert set(expected)==b.native_schema_fields()==set(MemoryEntry.model_fields)
original=dict(MemoryEntry.model_fields)
for mutation in ('add','remove'):
 try:
  if mutation=='add':MemoryEntry.model_fields['future_synthetic_field']=next(iter(original.values()))
  else:MemoryEntry.model_fields.pop('essence')
  try:b.prospective_compatible(None,None)
  except b.NativeSchemaMismatch as error:assert b.error_code(error)=='memory.native.schema-mismatch'
  else:raise AssertionError('schema drift silently accepted')
 finally:
  MemoryEntry.model_fields.clear();MemoryEntry.model_fields.update(original)
assert set(expected)==b.native_schema_fields()
print(json.dumps({'fields':len(expected),'driftRefused':['add','remove']}))
`,assets],{encoding:'utf8',input:JSON.stringify(CAMPOS_NATIVOS),env:fixtureEnv(),timeout:10000});
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),{fields:CAMPOS_NATIVOS.length,driftRefused:['add','remove']});
});

test('runtime files sem assets continua carregavel; uso nativo sem contrato recusa tipado', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-schema-fixture-'));
  try {
    const dist = path.join(root, 'core/dist');
    fs.cpSync(path.resolve(__dirname, '../../dist'), dist, { recursive: true });
    const r = spawnSync(process.execPath, ['-e', `
const assert=require('node:assert/strict');
const native=require(process.argv[1]);
assert.equal(typeof native.DriverEmMemoria,'function');
assert.throws(()=>native.camposNativos(),/memory.native.schema-mismatch/);
assert.throws(()=>native.prospectivaCompativel(null,null,null),/memory.native.schema-mismatch/);
console.log('files loaded; native missing schema refused');
`, path.join(dist, 'orkmind')], { encoding: 'utf8', env: fixtureEnv(), timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /native missing schema refused/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
