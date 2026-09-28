import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { usingFixture, pythonFixture, fixtureEnv, assets } from './native-fixture';

test('B4 ensaio PostgreSQL sem rede: transacao, recibo integral, ACL, replay e rollback compensatorio', () => {
  usingFixture(receipt => {
    const r = spawnSync(pythonFixture(), [path.resolve(__dirname, '../../test/memory-native-preparation.py'),
      receipt, assets], { encoding: 'utf8', env: fixtureEnv(), timeout: 60000 });
    console.log(r.stdout.trim());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS: native preparation/);
    const capacity = JSON.parse(/^CAPACITY: (.+)$/m.exec(r.stdout)![1]);
    assert.equal(capacity.vectorDimensions, 1024);
    assert.ok(capacity.markerBytes.every((n: number) => n > 11300));
    assert.ok(capacity.receiptBytes > 100000);
    assert.ok(capacity.applyReadAndSixSyncMs < 10000, 'limite do ensaio local, nao capacidade operacional');
    assert.match(r.stdout, /rollback receipt cannot be used as original/);
    assert.match(r.stdout, /reduced marker refused; full data and receipts invariant/);
  });
});
