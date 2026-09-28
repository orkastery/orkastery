import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assets, fixtureEnv, pythonFixture, usingFixture, prepareFixture,
  FIXTURE_TTL_PADRAO_MS, FIXTURE_TTL_MIN_MS, FIXTURE_TTL_MAX_MS } from './native-fixture';

test('fixture ausente e Docker indisponivel falham runtime.unavailable sem skip ou ensaio falso', t => {
  const dir = fs.mkdtempSync('/tmp/ork-fixture-runtime-'); t.after(() => fs.rmSync(dir, { recursive: true }));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'native-fixture.js'), 'prepare', 'synthetic-test'],
    { encoding: 'utf8', env: { PATH: dir, HOME: dir }, timeout: 5000 });
  assert.equal(r.status, 1); assert.match(r.stderr, /runtime.unavailable/); assert.equal(r.stdout, '');
});

test('fixture externa valida identidade, localizacao, tenant, dono e recibo antes de ensaio; varias execucoes isoladas', () => {
  usingFixture(receipt => {
    const original = fs.readFileSync(receipt);
    const code = `
import asyncio,copy,json,sys
sys.path.insert(0,sys.argv[2])
from orkmind_fixture import connect_fixture
async def run():
 c,r=await connect_fixture(sys.argv[1]);await c.close();print('validated')
asyncio.run(run())
`;
    const negative = path.join(path.dirname(receipt), 'receipt-'+randomBytes(16).toString('hex')+'.json');
    const run = (file = receipt) => spawnSync(pythonFixture(), ['-c', code, file, assets], { encoding: 'utf8', env: fixtureEnv(), timeout: 10000 });
    assert.equal(run().status, 0);
    try {
      for (const change of [{ tenant: 'another' }, { identity: '0'.repeat(64) }, { socket: '/tmp' },
        { ownerUid: -1 }, { synthetic: false }, { expiresAt: 0 }]) {
        fs.writeFileSync(negative, JSON.stringify({ ...JSON.parse(original.toString()), ...change }), {mode: 0o600});
        const r = run(negative); assert.notEqual(r.status, 0); assert.match(r.stderr, /runtime.fixture/);
      }
    } finally { fs.rmSync(negative, {force: true}); }
    const script = path.resolve(__dirname, '../../test/memory-native-preparation.py');
    for (let i = 0; i < 2; i++) {
      const r = spawnSync(pythonFixture(), [script, receipt, assets], { encoding: 'utf8', env: fixtureEnv(), timeout: 60000 });
      assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /PASS: native preparation/);
    }
    assert.deepEqual(fs.readFileSync(receipt), original);
  });
});

test('validade inicial da fixture e configuravel, finita e validada antes de Docker ou de qualquer arquivo', t => {
  const antes=fs.readdirSync('/tmp').filter(n=>n.startsWith('ork-prospective-fixture-'));
  assert.equal(FIXTURE_TTL_PADRAO_MS,1_800_000,'o padrao de 30 minutos e preservado');
  assert.equal(FIXTURE_TTL_MIN_MS,60_000);assert.equal(FIXTURE_TTL_MAX_MS,3_600_000);
  const recusados: [string,unknown][]=[['NaN',NaN],['Infinity',Infinity],['-Infinity',-Infinity],
    ['negativo',-1_800_000],['zero',0],['fracao',1_800_000.5],['abaixo do minimo',FIXTURE_TTL_MIN_MS-1],
    ['acima do maximo',FIXTURE_TTL_MAX_MS+1],['texto','2400000'],['nulo',null],['objeto',{}],
    ['fora do inteiro seguro',Number.MAX_SAFE_INTEGER+2]];
  for(const [nome,valor] of recusados)
    assert.throws(()=>prepareFixture('synthetic-test',{ttlMs:valor as number}),/runtime\.fixture\.ttl-invalid/,
      'ttl recusado antes de Docker: '+nome);
  assert.deepEqual(fs.readdirSync('/tmp').filter(n=>n.startsWith('ork-prospective-fixture-')),antes,
    'pedido invalido nao cria diretorio nem recibo');

  // Sem docker no PATH: o ttl invalido ainda recusa por ttl, prova de que a validacao vem antes.
  const dir=fs.mkdtempSync('/tmp/ork-fixture-ttl-');t.after(()=>fs.rmSync(dir,{recursive:true}));
  const cli=(...args: string[])=>spawnSync(process.execPath,[path.join(__dirname,'native-fixture.js'),'prepare',...args],
    {encoding:'utf8',env:{PATH:dir,HOME:dir},timeout:5000});
  const invalido=cli('synthetic-test','120000000');
  assert.equal(invalido.status,1);assert.equal(invalido.stdout,'');
  assert.match(invalido.stderr,/runtime\.fixture\.ttl-invalid/,'ttl invalido recusa antes de constatar Docker ausente');
  const semTtl=cli('synthetic-test');
  assert.equal(semTtl.status,1);assert.match(semTtl.stderr,/runtime\.unavailable/,'ttl valido por default chega ate a checagem de Docker');
  const valido=cli('synthetic-test','2400000');
  assert.equal(valido.status,1);assert.match(valido.stderr,/runtime\.unavailable/,'40 minutos e aceito pelo contrato e para em Docker ausente');
  assert.deepEqual(fs.readdirSync('/tmp').filter(n=>n.startsWith('ork-prospective-fixture-')),antes,
    'nenhuma fixture foi provisionada por este teste');
});
