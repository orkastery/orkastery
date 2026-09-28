import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { abrirMemoria, sincronizarOnboarding } from '../src/memoria';
import { DriverEmMemoria } from '../src/orkmind';
import { caminhoOnboarding, gravarEtapa } from '../src/onboarding';
import { projetoTemporario } from './apoio';

test('onboarding files não chama driver e sync CLI retorna JSON de degradação sem impedir set', () => {
  const p = projetoTemporario('onboarding-memory-files');
  try {
    const driver = new DriverEmMemoria();
    driver.disponivel = () => { throw Error('não deveria abrir'); };
    driver.adicionar = () => { throw Error('não deveria gravar'); };
    const yaml = fs.readFileSync(p.carregado.caminho, 'utf8');
    gravarEtapa(p.dir, 'memoria', { modo: 'orkmind' });
    const r = sincronizarOnboarding(p.carregado, { driver });
    assert.equal(r.regime, 'files'); assert.equal(r.motivo, 'modo.files');
    assert.equal(r.respondidas, 1); assert.equal(r.gravadas, 0);
    assert.equal(fs.readFileSync(p.carregado.caminho, 'utf8'), yaml);
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/index.js'), 'onboarding', 'sync', '--json'],
      { cwd: p.dir, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).motivo, 'modo.files');
  } finally { p.limpar(); }
});

test('driver do núcleo publica decision agent sem mandatory/critical; idempotência e tenant isolados', () => {
  const a = projetoTemporario('onboarding-tenant-a'), b = projetoTemporario('onboarding-tenant-b');
  const driver = new DriverEmMemoria();
  try {
    for (const [p, tenant] of [[a, 'a'], [b, 'b']] as const) {
      p.carregado.manifesto.memory.mode = 'orkmind';
      p.carregado.manifesto.memory.database_url_env = 'TEST_ONLY_DATABASE_URL';
      p.carregado.manifesto.memory.tenant = tenant;
      gravarEtapa(p.dir, 'maestro', { objetivo: 'Mesmo conteúdo público' });
      gravarEtapa(p.dir, 'credenciais', { env: ['PUBLIC_API_KEY'] });
      assert.equal(sincronizarOnboarding(p.carregado, { driver }).gravadas, 2);
      assert.equal(sincronizarOnboarding(p.carregado, { driver }).duplicadas, 2);
      const entradas = abrirMemoria(p.carregado, { driver }).buscar({ collection: 'decision', tags: { project: [tenant] } });
      assert.equal(entradas.length, 2);
      for (const e of entradas) {
        assert.equal(e.source, 'agent'); assert.equal(e.mandatory, false); assert.equal(e.priority, 'medium');
        assert.equal(e.metadata.tenant, tenant);
        assert.ok(e.tags.situation.some(t => t.startsWith(`onboarding:${tenant}:`)));
      }
    }
    assert.equal(driver.exportar('decision').length, 4);
    assert.equal(new Set(driver.exportar('decision').map(e => e.metadata.identidade)).size, 4);
  } finally { a.limpar(); b.limpar(); }
});

test('indisponibilidade e exceções do driver não vazam diagnóstico bruto nem perdem entrevista', () => {
  const p = projetoTemporario('onboarding-memory-fail');
  const sentinel = 'SENTINELA_SEGREDO_FAKE';
  try {
    p.carregado.manifesto.memory.mode = 'orkmind';
    p.carregado.manifesto.memory.database_url_env = 'TEST_ONLY_DATABASE_URL';
    gravarEtapa(p.dir, 'maestro', { objetivo: 'público' });
    const bytes = fs.readFileSync(caminhoOnboarding(p.dir), 'utf8');
    const driver = new DriverEmMemoria();
    driver.ligado = false;
    assert.equal(sincronizarOnboarding(p.carregado, { driver }).motivo, 'orkmind.indisponivel');
    driver.ligado = true;
    driver.adicionar = () => { throw Error(sentinel); };
    const r = sincronizarOnboarding(p.carregado, { driver });
    assert.equal(r.regime, 'files'); assert.equal(r.falhas, 1);
    assert.ok(!JSON.stringify(r).includes(sentinel));
    assert.ok(!fs.readFileSync(path.join(p.dir, '.orkastery/ledger.jsonl'), 'utf8').includes(sentinel));
    assert.equal(fs.readFileSync(caminhoOnboarding(p.dir), 'utf8'), bytes);
  } finally { p.limpar(); }
});

test('entrevista vazia não publica e conteúdo legado inseguro não chega à memória', () => {
  const p = projetoTemporario('onboarding-memory-empty'), driver = new DriverEmMemoria();
  try {
    p.carregado.manifesto.memory.mode = 'orkmind';
    p.carregado.manifesto.memory.database_url_env = 'TEST_ONLY_DATABASE_URL';
    assert.equal(sincronizarOnboarding(p.carregado, { driver }).gravadas, 0);
    gravarEtapa(p.dir, 'skills', { publico: true });
    const file = caminhoOnboarding(p.dir), state = JSON.parse(fs.readFileSync(file, 'utf8'));
    state.etapas.bancos = { por: 'teste', respondidaEm: new Date().toISOString(), conteudo: { senha: 'FAKE_LEGACY_SECRET' } };
    fs.writeFileSync(file, JSON.stringify(state));
    assert.equal(sincronizarOnboarding(p.carregado, { driver }).gravadas, 1);
    assert.ok(!JSON.stringify(driver.exportar('decision')).includes('FAKE_LEGACY_SECRET'));
  } finally { p.limpar(); }
});
