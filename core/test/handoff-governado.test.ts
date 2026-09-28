import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportarHandoff } from '../src/handoff';
import { abrirMemoria, gravarHandoff, prepararHandoffGovernado } from '../src/memoria';
import { DriverEmMemoria } from '../src/orkmind';
import { novaThread } from '../src/thread';
import { PedidoDeHandoff } from '../src/types';
import { projetoTemporario } from './apoio';

function fixture(tenant?: string) {
  const p = projetoTemporario('handoff-g3');
  p.carregado.manifesto.memory.mode = 'orkmind';
  p.carregado.manifesto.memory.database_url_env = 'TEST_TENANT';
  if (tenant) p.carregado.manifesto.memory.tenant = tenant;
  const { thread } = novaThread(p.carregado, { nome: 'G3', modo: 'auto' });
  const driver = new DriverEmMemoria();
  const memoria = abrirMemoria(p.carregado, { driver });
  return { p, thread, driver, memoria };
}

test('tenant configurado separadamente do nome do projeto permanece isolado', () => {
  const { p, thread, driver, memoria } = fixture('tenant-customizado');
  try {
    exportarHandoff(p.carregado, thread.id, { proximaFase: 'GOAL', memoria });
    const h = driver.tudo().find(e => e.collection === 'handoff')!;
    assert.deepEqual(h.tags.project, ['tenant-customizado']);
    assert.equal(h.metadata.tenant, 'tenant-customizado');
  } finally { p.limpar(); }
});

test('export publica pelo canal G3, preserva bytes e recupera cadeia idempotente', () => {
  const { p, thread, driver, memoria } = fixture();
  try {
    let capturado: PedidoDeHandoff | undefined;
    const submeter = driver.submeterHandoff.bind(driver);
    driver.submeterHandoff = pedido => { capturado = pedido; return submeter(pedido); };
    const r = exportarHandoff(p.carregado, thread.id, { proximaFase: 'GOAL', memoria });
    assert.ok(capturado);
    const original = fs.readFileSync(r.caminhoHistorico, 'utf8');
    assert.equal(capturado.payload.original_texto, original);
    assert.deepEqual(capturado.payload.original, r.handoff);
    assert.equal(capturado.tags.skill[0], 'GOAL');
    assert.equal(capturado.tags.agent[0], 'desconhecido:desconhecido');
    const first = driver.tudo().find(e => e.collection === 'handoff')!;
    const again = gravarHandoff(memoria, p.carregado.manifesto, thread, r.handoff, r.caminhoHistorico);
    assert.equal(again.id, first.id); assert.equal(again.duplicada, true);
    const pkg = driver.tudo().find(e => e.collection === 'semantic_log')!;
    assert.equal(first.parent_id, pkg.parent_id);
    assert.equal(first.metadata.package_id, pkg.metadata.package_id);
    assert.equal(driver.tudo().filter(e => e.collection === 'handoff').length, 1);
    assert.throws(() => gravarHandoff(memoria, p.carregado.manifesto, thread, r.handoff, 'ausente.json'), /memory.handoff.failed/);
    assert.throws(() => prepararHandoffGovernado(p.carregado.manifesto, thread, r.handoff, r.caminhoHistorico, '{}', p.dir), /source-mismatch/);
  } finally { p.limpar(); }
});

test('falha de G3 reprova export e preserva o handoff em arquivo', () => {
  const { p, thread, driver, memoria } = fixture();
  try {
    driver.submeterHandoff = () => ({ ok: false, id: null, duplicada: false, collection: 'handoff', detalhe: 'G3 rejected' });
    assert.throws(() => exportarHandoff(p.carregado, thread.id, { proximaFase: 'GOAL', memoria }), /memory.handoff.failed/);
    assert.ok(fs.existsSync(path.join(p.dir, '.orkastery/threads', thread.id, 'handoff.json')));
    assert.equal(driver.tudo().length, 0);
  } finally { p.limpar(); }
});

test('sessao adotada sem despacho nao autentica autoria historica do handoff', () => {
  const { p, thread, memoria } = fixture();
  try {
    const r = exportarHandoff(p.carregado, thread.id, { proximaFase: 'GOAL', memoria });
    thread.sessoes.push({ origem: 'adocao', slug: r.handoff.de.slug, fase: r.handoff.de.fase!,
      bloco: 'GO', sessionId: 'adopted-synthetic', runtime: 'codex', verificada: true,
      adotadaEm: '2000-01-01T00:00:00Z', cwdOrigem: p.dir });
    const pedido = prepararHandoffGovernado(p.carregado.manifesto, thread, r.handoff,
      r.caminhoHistorico, fs.readFileSync(r.caminhoHistorico, 'utf8'), p.dir);
    assert.deepEqual(pedido.tags.agent, ['desconhecido:desconhecido', 'ork']);
    assert.match(pedido.sessionId, /^origem-declarada:/);
    assert.match(JSON.stringify(pedido.metadata.autoria), /runtime e modelo desconhecidos/);
    assert.ok(!JSON.stringify(pedido).includes('adopted-synthetic'));
  } finally { p.limpar(); }
});

test('G3 instalado rejeita pacote invalido, conserva IDs e pacote completo na ponte', t => {
  const cli = (process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, 'orkmind')).find(p => fs.existsSync(p));
  if (!cli) {
    assert.notEqual(process.env.ORK_I06_REQUIRE_REAL_DATABASE, '1', 'OrkMind obrigatorio na aceitacao real');
    t.skip('biblioteca opcional ausente no CI'); return;
  }
  const python = /^#!(\S+)/.exec(fs.readFileSync(cli, 'utf8'))?.[1];
  assert.ok(python, 'shebang do OrkMind');
  const f = fixture();
  let pedido: PedidoDeHandoff | undefined;
  try {
    const submeter = f.driver.submeterHandoff.bind(f.driver);
    f.driver.submeterHandoff = p => { pedido = p; return submeter(p); };
    exportarHandoff(f.p.carregado, f.thread.id, { proximaFase: 'GOAL', memoria: f.memoria });
    assert.ok(pedido);
    assert.match(String(pedido.payload.original_texto), /[a-f0-9]{64}/, 'origem de teste contem hashes reais');
  } finally { f.p.limpar(); }
  const bridge = path.resolve(__dirname, '../../assets/orkmind_bridge.py');
  const r = spawnSync(python, ['-c', `
import asyncio,importlib.util,json,logging,sys
from orkmind.core.config import OrkMindConfig
from orkmind.store.factory import create_store
logging.disable(logging.CRITICAL)
spec=importlib.util.spec_from_file_location('bridge',sys.argv[1]);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
async def run():
 store=create_store(OrkMindConfig(store_backend='memory'));await store.initialize()
 p=json.load(sys.stdin)
 invalid={**p,'payload':{'orkastery_identity':p['identidade']}}
 try: await b.execute({'op':'handoff','pedido':invalid},store)
 except ValueError: pass
 else: raise AssertionError('G3 invalido aceito')
 assert await store.count()==0
 a=await b.execute({'op':'handoff','pedido':p},store);z=await b.execute({'op':'handoff','pedido':p},store)
 assert a['id']==z['id'] and z['duplicada'] and a['readback'] and await store.count()==3
 summary=await store.retrieve(a['id']);package=await store.retrieve(a['package_entry_id'])
 assert not summary.injection_risk, 'resumo seguro deve ser consultavel'
 assert package.injection_risk, 'hashes originais continuam sujeitos a governanca nativa'
 found=await store.search_by_tags(p['tags'],collection='handoff',limit=10)
 assert any(e.id==a['id'] for e in found)
 assert json.loads(package.content)==p['payload']
 await store.close()
 print('G3 real: valido, invalido, pacote integral, readback e idempotencia PASS')
asyncio.run(run())
`, bridge], { encoding: 'utf8', input: JSON.stringify(pedido), timeout: 15000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, 'G3 instalado deve passar; erros do filho nao sao exibidos');
  assert.match(r.stdout, /G3 real:.*PASS/);
});
