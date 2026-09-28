import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exigirManifesto } from '../src/manifest';
import { memoryState } from '../src/project-state';
import { abrirMemoria } from '../src/memoria';
import { DriverDeMemoria } from '../src/orkmind';

test('T03: memória usa configuração canônica, mantém código da WT e não disfarça indisponibilidade', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-brain-memory-'));
  const main = path.join(base, 'main'), wt = path.join(base, 'wt');
  const admin = path.join(main, '.git/worktrees/test');
  try {
    fs.mkdirSync(admin, { recursive: true }); fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${admin}\n`);
    fs.writeFileSync(path.join(admin, 'commondir'), '../..');
    const manifest = 'project:\n  name: synthetic\n  abbrev: syn\nmemory:\n  mode: orkmind\n  tenant: factory-synthetic\n  database_url_env: C1_TEST_ABSENT_DSN\n  cli: unavailable-synthetic\n  timeout_ms: 20\n';
    fs.writeFileSync(path.join(main, 'orkastery.yaml'), manifest);
    fs.writeFileSync(path.join(wt, 'orkastery.yaml'), manifest.replace('mode: orkmind', 'mode: files').replace('factory-synthetic', 'wrong-tenant'));
    const candidate = exigirManifesto(wt);
    const context = memoryState(candidate);
    assert.equal(context.loaded.raiz, wt);
    assert.equal(context.source, path.join(main, 'orkastery.yaml'));
    assert.equal(context.divergent, true);
    assert.equal(context.loaded.manifesto.memory.tenant, 'factory-synthetic');
    assert.equal(candidate.manifesto.memory.tenant, 'wrong-tenant');
    const driver: DriverDeMemoria = { nome: 'synthetic', disponivel: () => ({ ok: false, detalhe: 'memory.transport.timeout' }),
      adicionar: () => { throw Error('unexpected write'); }, exportar: () => { throw Error('unexpected export'); } };
    const memory = abrirMemoria(candidate, { driver });
    assert.equal(memory.estado.tenant, 'factory-synthetic');
    assert.equal(memory.estado.pedido, 'orkmind');
    assert.equal(memory.estado.efetivo, 'files');
    assert.equal(memory.ativo, false);
    assert.equal(memory.configDivergent, true);
    assert.match(memory.estado.detalhe, /memory.transport.timeout/);
    assert.equal(abrirMemoria(candidate).estado.motivo, 'dsn.env-ausente');
    fs.unlinkSync(path.join(main, 'orkastery.yaml'));
    assert.throws(() => abrirMemoria(candidate), /project-state.memory.unavailable/);
    fs.writeFileSync(path.join(main, 'orkastery.yaml'), 'memory:\n  mode: invalid');
    assert.throws(() => memoryState(candidate), /project-state.memory.unavailable/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
