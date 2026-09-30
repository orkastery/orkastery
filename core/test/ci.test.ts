import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ajustarManifesto, projetoTemporario } from './apoio';
import { consultarCi, executarBundleCi, motivoDiferimentoCi, prepararBundleCi, repositorioGitHub } from '../src/ci';
import { ship } from '../src/ship';
import { novaThread } from '../src/thread';
import { commitar, shaDaBranch } from './apoio';
import { exec } from '../src/util';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('normaliza remotos GitHub HTTPS e SSH sem aceitar outros hosts', () => {
  assert.equal(repositorioGitHub('https://github.com/Orkastery/orkastery.git'), 'Orkastery/orkastery');
  assert.equal(repositorioGitHub('git@github.com:Orkastery/OrkMind.git'), 'Orkastery/OrkMind');
  assert.equal(repositorioGitHub('/tmp/origin.git'), null);
});

test('consulta exige sucesso do contexto e do SHA exatos', () => {
  const p = projetoTemporario('ci-status', false);
  ajustarManifesto(p, 'required_for_ship: false', 'required_for_ship: true');
  const remote = 'https://github.com/Orkastery/orkastery.git';
  p.carregado.manifesto.ci.required_for_ship = true;
  const original = p.carregado.raiz;
  // O remoto só é consultado para obter owner/repo; o executor injetado não usa rede.
  exec('git', ['remote', 'add', 'origin', remote], original);
  const sha = shaDaBranch(original, 'main');
  const success = consultarCi(p.carregado, sha, 'origin', ({ repository, sha: got, context }) => {
    assert.equal(repository, 'Orkastery/orkastery');
    assert.equal(got, sha);
    assert.equal(context, 'ork-verify');
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ check_runs: [{ name: 'ork-verify', status: 'completed', conclusion: 'success', html_url: 'https://example.test/run/1' }] }) };
  });
  assert.equal(success.ok, true);
  assert.equal(success.state, 'success');
  const missing = consultarCi(p.carregado, sha, 'origin', () => ({ ok: true, code: 0, stderr: '', stdout: JSON.stringify({ check_runs: [{ name: 'outro-check', status: 'completed', conclusion: 'success' }] }) }));
  assert.equal(missing.ok, false);
  assert.equal(missing.state, 'missing');
  p.limpar();
});

test('runner do CI reexecuta claims e comandos do bundle no checkout real', () => {
  const p = projetoTemporario('ci-bundle');
  const file = `${p.dir}/bundle.json`;
  const sha = shaDaBranch(p.dir, 'main');
  fs.writeFileSync(file, JSON.stringify({
    schema: 'ork.ci-bundle/v1',
    thread: 'ork-ci-bundle',
    base: 'main',
    claims: [{ id: 'C1', thread: 'ork-ci-bundle', fase: 'CHECK', arquivo: 'README.md', alegacao: 'README existe', negativa: false, verificar: ['test -f README.md'], criadoEm: new Date().toISOString(), estado: 'pendente' }],
    commands: [{ name: 'fixture', command: 'test -f README.md' }],
  }));
  const result = executarBundleCi(p.carregado, file);
  assert.equal(result.ok, true);
  assert.equal(result.commit, sha);
  assert.equal(result.claims[0].verificado, true);
  assert.equal(result.commands[0].ok, true);
  p.limpar();
});

test('runner do CI roda o preparo do manifesto antes das claims, como o verify local', () => {
  const p = projetoTemporario('ci-preparo');
  const file = `${p.dir}/bundle.json`;
  fs.writeFileSync(file, JSON.stringify({
    schema: 'ork.ci-bundle/v1',
    thread: 'ork-ci-preparo',
    base: 'main',
    claims: [{ id: 'C1', thread: 'ork-ci-preparo', fase: 'GO', arquivo: 'README.md', alegacao: 'a compilacao do preparo existe', negativa: false, verificar: ['test -f gerado/pronto'], criadoEm: new Date().toISOString(), estado: 'pendente' }],
    commands: [],
  }));
  const sem = executarBundleCi(p.carregado, file);
  assert.equal(sem.preparo, null);
  assert.equal(sem.claims[0].verificado, false, 'sem preparo, a claim que depende da compilacao reprova');
  const comPreparo = { ...p.carregado, manifesto: { ...p.carregado.manifesto,
    verify: { ...p.carregado.manifesto.verify, preparo: 'mkdir -p gerado && touch gerado/pronto' } } };
  const com = executarBundleCi(comPreparo, file);
  assert.equal(com.preparo?.ok, true);
  assert.equal(com.claims[0].verificado, true);
  assert.equal(com.ok, true);
  p.limpar();
});

test('bundle usa o perfil hermético declarado pelo CI quando ele existe', () => {
  const p = projetoTemporario('ci-command');
  const { thread } = novaThread(p.carregado, { nome: 'perfil ci', modo: 'auto' });
  p.carregado.manifesto.ci.command = 'node --version';
  const bundle = JSON.parse(fs.readFileSync(prepararBundleCi(p.carregado, thread.id), 'utf8'));
  assert.deepEqual(bundle.commands, [{ name: 'ci', command: 'node --version' }]);
  p.limpar();
});

test('bundle separa claims do host sem fingir que o runner hospedado as executou', () => {
  const p = projetoTemporario('ci-host-claims');
  const base = {
    id: 'C1', thread: 'ork-ci-host', fase: 'CHECK' as const, arquivo: 'README.md',
    alegacao: 'prova', negativa: false, criadoEm: new Date().toISOString(), estado: 'pendente' as const,
  };
  assert.equal(
    motivoDiferimentoCi({ ...base, verificar: ['test -f /home/usuario/.hermes/bin/ork'] }, p.dir),
    'host-runtime-required'
  );
  assert.equal(
    motivoDiferimentoCi({ ...base, arquivo: '.orkastery/tmp/externo/test.py', verificar: ['true'] }, p.dir),
    'artifact-not-in-checkout'
  );
  assert.equal(
    motivoDiferimentoCi({ ...base, arquivo: path.join(p.dir, 'README.md'), verificar: ['true'] }, p.dir),
    'artifact-not-in-checkout'
  );
  assert.equal(
    motivoDiferimentoCi({ ...base, verificar: ['node --test core/dist-test/test/mcp-server.test.js'] }, p.dir),
    'local-integration-required'
  );
  assert.equal(
    motivoDiferimentoCi({ ...base, verificar: ['node --test core/dist-test/test/hosts.test.js'] }, p.dir),
    null
  );
  assert.equal(
    motivoDiferimentoCi({ ...base, verificar: ['node core/scripts/verify-goal-c2-b3.cjs P2'] }, p.dir),
    'host-runtime-required'
  );
  assert.equal(
    motivoDiferimentoCi({ ...base, verificar: ['node core/scripts/verify-check-c2-b3.cjs docs-metrics'] }, p.dir),
    'host-runtime-required'
  );
  assert.equal(
    motivoDiferimentoCi({ ...base, verificar: ['node core/scripts/verify-check-c2-b3.cjs channel-offer'] }, p.dir),
    'local-integration-required'
  );
  assert.equal(
    motivoDiferimentoCi({ ...base, verificar: ['node core/scripts/verify-check-c2-b3.cjs matrix-4x2'] }, p.dir),
    null
  );
  assert.equal(motivoDiferimentoCi({ ...base, verificar: ['test -f README.md'] }, p.dir), null);
  // I-38: memoria do tenant, OrkMind instalado e suite inteira ficam para a estacao.
  for (const comando of [
    'node core/dist/index.js memory status --json | node -e "x"',
    'env -u CHAVE node "$CLI" memory index --dry-run --json',
    'node core/dist/index.js memory search --tags \'{"project":["x"]}\' --json',
    'PY=$(sed -n 1p "$(command -v orkmind)") && "$PY" -c "import orkmind"',
    'npm --prefix core run build && npm --prefix core test',
    'bash core/scripts/prova-busca-semantica.sh | grep -qF x',
  ]) assert.equal(motivoDiferimentoCi({ ...base, verificar: [comando] }, p.dir), 'local-integration-required', comando);
  for (const comando of [
    'npm --prefix core run test:ci',
    "node core/dist/index.js --help | grep -qF 'memory search --texto'",
    "grep -qF 'ork memory index' docs/produto/FEAT-017-memoria-orkmind.md",
    'node --test core/dist-test/test/busca-semantica.test.js',
  ]) assert.equal(motivoDiferimentoCi({ ...base, verificar: [comando] }, p.dir), null, comando);
  p.limpar();
});

test('SHIP para antes do lease e do merge quando CI obrigatório não tem recibo', () => {
  const p = projetoTemporario('ci-ship-block', true);
  ajustarManifesto(p, 'required_for_ship: false', 'required_for_ship: true');
  p.carregado.manifesto.ci.required_for_ship = true;
  const { thread } = novaThread(p.carregado, { nome: 'ci bloqueia', modo: 'auto', criarWorktree: true });
  commitar(thread.worktree!, 'entrega.md', 'entrega\n', 'feat: entrega');
  const before = shaDaBranch(p.dir, 'main');
  const result = ship(p.carregado, thread.id, { para: 'main' });
  assert.equal(result.ok, false);
  assert.equal(result.motivo, 'ci.failed');
  assert.equal(result.ci?.state, 'unavailable');
  assert.equal(shaDaBranch(p.dir, 'main'), before);
  assert.equal(result.lease, null);
  p.limpar();
});
