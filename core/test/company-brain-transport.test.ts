import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { brainClient, BRAIN_API, validateRequest } from '../src/company-brain-client';
import { projetoTemporario } from './apoio';
import { CONTRACT_HASH } from '../src/company-brain-contract';
test('T12: transporte fechado não herda credenciais, principal nem fallback amplo', () => {
  const p = projetoTemporario('brain-transport');
  try {
    p.carregado.manifesto.memory = { ...p.carregado.manifesto.memory, mode:'orkmind',tenant:'synthetic',database_url_env:'C1_FAKE_DSN' };
    const before = process.env.C1_FAKE_DSN; process.env.C1_FAKE_DSN = 'SYNTHETIC-not-a-connection';
    try {
      let calls=0;
      const run: any = (bin: string,args: string[],opts: any) => {
        calls++; assert.equal(bin,p.carregado.manifesto.memory.cli); assert.deepEqual(args,['brain','request']); assert.equal(opts.shell,false);
        assert.deepEqual(Object.keys(opts.env).sort(),['ORKMIND_BRAIN_TENANT','ORKMIND_DATABASE_URL','PATH','PYTHONDONTWRITEBYTECODE']);
        assert.equal(opts.env.ORKMIND_BRAIN_TENANT,'synthetic');
        return {status:0,stdout:JSON.stringify({schema:BRAIN_API,state:'ok',contract_hash:CONTRACT_HASH})};
      };
      const client=brainClient(p.carregado,run);
      assert.equal(client({schema:BRAIN_API,operation:'capabilities'}).state,'ok');
      assert.throws(() => validateRequest({schema:BRAIN_API,operation:'get',principal:'human'}));
      assert.equal(client({schema:BRAIN_API,operation:'get',payload:{tenant_id:'other',id:'prod-one'}}).state,'forbidden');
      assert.equal(calls,1);
      const invalid=brainClient(p.carregado,(() => ({status:1,stdout:'SENTINEL-secret',stderr:'SENTINEL-secret'})) as any);
      assert.deepEqual(invalid({schema:BRAIN_API,operation:'capabilities'}),{schema:BRAIN_API,state:'unavailable',error:'brain.transport.invalid'});
    } finally { if(before===undefined) delete process.env.C1_FAKE_DSN; else process.env.C1_FAKE_DSN=before; }
  } finally { p.limpar(); }
});

test('RM-026 K7 (fatia 2, CHECK): memory.timeout_ms fora da faixa vale o padrão de 15 s, nunca espera sem prazo', () => {
  const p = projetoTemporario('brain-transport-prazo');
  try {
    const antes = process.env.C1_FAKE_DSN; process.env.C1_FAKE_DSN = 'SYNTHETIC-not-a-connection';
    try {
      const prazos: unknown[] = [];
      const run: any = (_bin: string, _args: string[], opts: any) => { prazos.push(opts.timeout); return { status: 0, stdout: JSON.stringify({ schema: BRAIN_API, state: 'unknown' }) }; };
      for (const timeout_ms of [0, -5, 0.5, Number.NaN, 1e9, 2000.7, 15000]) {
        p.carregado.manifesto.memory = { ...p.carregado.manifesto.memory, mode: 'orkmind', tenant: 'synthetic', database_url_env: 'C1_FAKE_DSN', timeout_ms };
        brainClient(p.carregado, run)({ schema: BRAIN_API, operation: 'get', payload: { tenant_id: 'synthetic', id: 'proj-aaa' } });
      }
      assert.deepEqual(prazos, [15000, 15000, 15000, 15000, 15000, 2000, 15000]);
    } finally { if (antes === undefined) delete process.env.C1_FAKE_DSN; else process.env.C1_FAKE_DSN = antes; }
  } finally { p.limpar(); }
});
