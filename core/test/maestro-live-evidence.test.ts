import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
const { inspectCandidate, verifyCanonical, main } = require(path.resolve(__dirname, '../../scripts/verify-maestro-live.cjs'));
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/maestro-live-receipts.json'), 'utf8'));
const ship = { tipo: 'ship_done', pushVerificado: true, mergeSha: 'a'.repeat(40), shaRemoto: 'a'.repeat(40),
  fonteDaProva: 'fixture-only' };
const candidate = () => structuredClone(fixture.candidate);
const unavailable = 'maestro.live.native-receipt-source-unavailable';

test('mesmo um candidato completo não autentica live; fixture e self-report são recusados', () => {
  assert.ok(inspectCandidate(fixture, ship).includes('maestro.live.self-report'));
  for (const scope of ['hosts', 'sites', 'delivery']) {
    assert.deepEqual(inspectCandidate(candidate(), ship, scope), [unavailable]);
  }
  for (const input of [null, {}, { ...candidate(), author: 'agent' }, { ...candidate(), simulated: true },
    { ...candidate(), selfReport: true }, { ...candidate(), kind: 'fixture' }]) {
    assert.ok(inspectCandidate(input, ship).includes('maestro.live.self-report'));
  }
});

test('diagnóstico rejeita sessão reutilizada, versão/host ausentes, autenticação e jornada sem origem', () => {
  const cases = [
    [{ newSession: false }, 'session-unproved'], [{ reusedSession: true }, 'session-unproved'],
    [{ sessionId: '' }, 'session-unproved'], [{ sessionId: candidate().hosts[1].sessionId }, 'session-unproved'],
    [{ authentication: 'denied' }, 'host-unproved'], [{ snapshotOrigin: 'self-report' }, 'host-unproved'],
    [{ nativeReference: '' }, 'host-unproved'], [{ installedHash: 'bad' }, 'host-unproved'],
    [{ actionReference: '' }, 'journey-unproved'], [{ readbackReference: '' }, 'journey-unproved'],
    [{ hitlReference: '' }, 'journey-unproved'],
  ] as const;
  for (const [change, error] of cases) {
    const copy = candidate(); Object.assign(copy.hosts[0], change);
    assert.ok(inspectCandidate(copy, ship).includes(`maestro.live.${error}`), JSON.stringify(change));
  }
  assert.ok(inspectCandidate({ ...candidate(), deliveredSha: 'c'.repeat(40) }, ship).includes('maestro.live.version-mismatch'));
  for (const hosts of [candidate().hosts.slice(1), [null], [...candidate().hosts, candidate().hosts[0]]]) {
    assert.ok(inspectCandidate({ ...candidate(), hosts }, ship).includes('maestro.live.host-missing'));
  }
  for (const broken of [null, { ...ship, pushVerificado: false }, { ...ship, shaRemoto: 'c'.repeat(40) },
    { ...ship, fonteDaProva: '' }]) assert.ok(inspectCandidate(candidate(), broken).includes('maestro.live.ship-unproved'));
});

test('publicação exige dois sites e readback coerente, ainda sem autenticar referências declarativas', () => {
  const copy = candidate(); copy.sites[0].servedHash = 'c'.repeat(64);
  assert.ok(inspectCandidate(copy, ship, 'sites').includes('maestro.live.site-unproved'));
  copy.sites = copy.sites.slice(1);
  assert.ok(inspectCandidate(copy, ship, 'delivery').includes('maestro.live.site-missing'));
  assert.deepEqual(inspectCandidate(copy, ship, 'hosts'), [unavailable]);
});

test('consulta canônica só lê: SHIP atual, scope e MASTER pendente; eventos inventados não provam live', () => {
  const p = projetoTemporario('live-canonical');
  try {
    const t = novaThread(p.carregado, { nome: 'Live pendente', modo: 'maestro' }).thread;
    const dir = dirThread(p.dir, t.id);
    const read = (scope = 'delivery') => verifyCanonical(p.dir, t.id, scope);
    assert.deepEqual(read().errors, ['maestro.live.ship-unproved', unavailable, 'maestro.live.master-pending']);
    registrar(dir, t.id, 'ship_done', ship);
    registrar(dir, t.id, 'invented_live_receipt', { candidate: candidate() });
    const before = fs.readdirSync(dir).sort().map(file => [file, fs.readFileSync(path.join(dir, file), 'utf8'), fs.statSync(path.join(dir, file)).mtimeMs]);
    for (const scope of ['hosts', 'sites', 'delivery']) {
      const result = read(scope);
      assert.equal(result.ok, false); assert.equal(result.ship, ship.mergeSha);
      assert.deepEqual(result.errors, [unavailable, ...(scope === 'delivery' ? ['maestro.live.master-pending'] : [])]);
    }
    assert.deepEqual(fs.readdirSync(dir).sort().map(file => [file, fs.readFileSync(path.join(dir, file), 'utf8'), fs.statSync(path.join(dir, file)).mtimeMs]), before);
    registrar(dir, t.id, 'ship_started', {});
    assert.equal(read().ship, null); assert.ok(read().errors.includes('maestro.live.ship-unproved'));
    registrar(dir, 'ork-other', 'ship_done', ship);
    assert.ok(read().errors.includes('maestro.live.ledger-invalid')); assert.equal(read().ship, null);
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), '{broken\n');
    assert.ok(read().errors.includes('maestro.live.ledger-invalid'));
    for (const scope of ['', 'all']) assert.throws(() => verifyCanonical(p.dir, t.id, scope), /arguments/);
    assert.throws(() => verifyCanonical(p.dir, '../escape', 'hosts'), /arguments/);
    assert.throws(() => main(['--fixture', 'receipt.json', '--scope', 'hosts']), /arguments/);
  } finally { p.limpar(); }
});
