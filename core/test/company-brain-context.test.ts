import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { createInitiative, createProduct, createProject, readPortfolio } from '../src/portfolio';
import { stateFile } from '../src/project-state';
import { novaThread, dirThread } from '../src/thread';
import { runBrain } from '../src/company-brain-cli';
import { BRAIN_API, BrainTransport } from '../src/company-brain-client';
import { BrainEntity, digest } from '../src/company-brain-contract';
import { buildContext, CONTEXT_SCHEMA } from '../src/company-brain-context';
import { portfolioEntities } from '../src/company-brain-source';

/** Portfólio sintético: um produto, um projeto e quatro iniciativas. */
function montar(nome: string): ProjetoDeTeste {
  const p = projetoTemporario(nome);
  createProduct(p.dir, { id: 'prod-alpha', title: 'Alpha' });
  createProject(p.dir, { id: 'proj-alpha-core', productId: 'prod-alpha', title: 'Núcleo', ownerId: 'Equipe' });
  for (const id of ['init-alpha-one', 'init-alpha-two', 'init-alpha-three', 'init-alpha-secret'])
    createInitiative(p.dir, { id, projectId: 'proj-alpha-core', title: id });
  return p;
}
const fonte = (p: ProjetoDeTeste): BrainEntity[] => portfolioEntities(readPortfolio(p.dir),
  { tenant: p.carregado.manifesto.memory.tenant, instance: p.carregado.manifesto.project.name, thread: '', aclRef: 'ork-factory' });
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** Brain falso: responde a seleção por ids e o `get`, como o OrkMind, e anota cada operação. */
function brainFalso(entidades: BrainEntity[], retidas: string[] = [], chamadas: string[] = []): BrainTransport {
  const porId = new Map(entidades.map(e => [e.id, e]));
  return request => {
    chamadas.push(request.operation);
    const payload = request.payload as any;
    if (request.operation === 'query') {
      const items = (payload.facets.ids as string[]).filter(id => porId.has(id) || retidas.includes(id))
        .map(id => retidas.includes(id) ? { state: 'withheld' } : { state: 'ok', entity: porId.get(id) });
      return { schema: BRAIN_API, state: items.length ? 'ok' : 'empty', items, count: items.length };
    }
    if (request.operation === 'get') {
      if (retidas.includes(payload.id)) return { schema: BRAIN_API, state: 'withheld' };
      const entity = porId.get(payload.id);
      return entity ? { schema: BRAIN_API, state: 'ok', entity } : { schema: BRAIN_API, state: 'unknown' };
    }
    return { schema: BRAIN_API, state: 'unavailable', error: 'brain.test.unexpected' };
  };
}
const ids = (pacote: any) => pacote.itens.map((i: any) => i.id);
const lacunasDe = (pacote: any, id: string) => pacote.lacunas.filter((l: any) => l.id === id).map((l: any) => l.codigo);

test('S1 o pacote traz os ids pedidos e a cadeia de pais, em ordem estável e sem repetição', () => {
  const p = montar('brain-context-s1');
  try {
    const locais = fonte(p);
    const beta = (id: string, kind: 'prod' | 'proj' | 'init', parent: string | null): BrainEntity => ({ ...copia(locais[0]), id, kind,
      parent_id: parent, aliases: [{ system: 'ork', instance: 'orkastery', id }], source: { ...locais[0].source, source_ref: `portfolio.json#${id}`, location: `id:${id}` } });
    const brain = brainFalso([...locais, beta('prod-beta', 'prod', null), beta('proj-beta-core', 'proj', 'prod-beta'), beta('init-beta-one', 'init', 'proj-beta-core')]);
    const pacote = buildContext(p.carregado, ['init-alpha-one', 'init-alpha-one'], brain, 'thread-s1');
    assert.equal(pacote.schema, CONTEXT_SCHEMA);
    assert.deepEqual(pacote.pedido, ['init-alpha-one']);
    assert.deepEqual(ids(pacote), ['prod-alpha', 'proj-alpha-core', 'init-alpha-one']);
    // Pais que só o Brain conhece também entram, e a ordem é prod, proj, init e depois id.
    const soBrain = buildContext(p.carregado, ['init-beta-one', 'init-alpha-two'], brain, 'thread-s1');
    assert.deepEqual(ids(soBrain), ['prod-alpha', 'prod-beta', 'proj-alpha-core', 'proj-beta-core', 'init-alpha-two', 'init-beta-one']);
    assert.throws(() => buildContext(p.carregado, [], brain, 'thread-s1'), /brain\.context\.ids-required/);
    assert.throws(() => buildContext(p.carregado, ['../etc'], brain, 'thread-s1'), /brain\.context\.id-invalid/);
  } finally { p.limpar(); }
});

test('S2 todo item ok cita a fonte inteira; citação incompleta vira lacuna e sai do conteúdo', () => {
  const p = montar('brain-context-s2');
  try {
    const brain = fonte(p).map(e => e.id === 'init-alpha-two' ? { ...e, source: { ...e.source, location: undefined as any } } : e);
    const pacote = buildContext(p.carregado, ['init-alpha-one', 'init-alpha-two'], brainFalso(brain), 'thread-s2');
    assert.ok(!ids(pacote).includes('init-alpha-two'));
    assert.deepEqual(lacunasDe(pacote, 'init-alpha-two'), ['citacao.incompleta']);
    const conteudo = pacote.itens.filter(i => i.estado === 'ok');
    assert.equal(conteudo.length, 3);
    for (const item of conteudo) {
      if (item.estado !== 'ok') continue;
      assert.match(item.citacao.source_ref, /^portfolio\.json#/);
      assert.match(item.citacao.source_hash, /^[a-f0-9]{64}$/);
      assert.ok(Number.isInteger(item.citacao.source_version));
      assert.equal(item.citacao.location, `id:${item.id}`);
    }
  } finally { p.limpar(); }
});

test('S3 cada item recebe um frescor: confere, divergente, ausente-no-brain, ausente-na-fonte ou retido', () => {
  const p = montar('brain-context-s3');
  try {
    const locais = fonte(p), um = locais.find(e => e.id === 'init-alpha-one')!;
    const brain = locais.filter(e => e.id !== 'init-alpha-three').map(e => e.id === 'init-alpha-two'
      ? { ...e, title: 'título antigo', source: { ...e.source, source_hash: digest('título antigo') } } : e);
    brain.push({ ...copia(um), id: 'init-alpha-gone', title: 'Só no Brain', aliases: [{ system: 'ork', instance: 'orkastery', id: 'init-alpha-gone' }],
      source: { ...um.source, source_ref: 'portfolio.json#init-alpha-gone', location: 'id:init-alpha-gone' } });
    const pacote = buildContext(p.carregado, ['init-alpha-one', 'init-alpha-two', 'init-alpha-three', 'init-alpha-gone', 'init-alpha-secret'],
      brainFalso(brain, ['init-alpha-secret']), 'thread-s3');
    const frescor = Object.fromEntries(pacote.itens.map(i => [i.id, i.frescor]));
    assert.deepEqual(frescor, { 'prod-alpha': 'confere', 'proj-alpha-core': 'confere', 'init-alpha-gone': 'ausente-na-fonte',
      'init-alpha-one': 'confere', 'init-alpha-secret': 'retido', 'init-alpha-three': 'ausente-no-brain', 'init-alpha-two': 'divergente' });
    const porId = Object.fromEntries(pacote.itens.map(i => [i.id, i as any]));
    assert.equal(porId['init-alpha-two'].titulo, 'título antigo');
    assert.equal(porId['init-alpha-two'].fonte.source_hash, locais.find(e => e.id === 'init-alpha-two')!.source.source_hash);
    assert.equal(porId['init-alpha-three'].origem, 'fonte');
    assert.equal(porId['init-alpha-gone'].fonte, null);
    // Retido não leva valor, nem o que a fonte local teria.
    assert.deepEqual(porId['init-alpha-secret'], { id: 'init-alpha-secret', estado: 'retido', frescor: 'retido', origem: 'brain' });
    assert.deepEqual(lacunasDe(pacote, 'init-alpha-secret'), ['brain.retido']);
    assert.ok(lacunasDe(pacote, 'init-alpha-two').includes('fonte.divergente'));
    assert.ok(lacunasDe(pacote, 'init-alpha-three').includes('brain.ausente'));
    assert.ok(lacunasDe(pacote, 'init-alpha-gone').includes('fonte.ausente'));
  } finally { p.limpar(); }
});

test('S4 lacunas tipadas por item, calculadas da entidade, e id desconhecido sem item', () => {
  const p = montar('brain-context-s4');
  try {
    const brain = fonte(p).map(e => e.id === 'init-alpha-one' ? { ...e, observed_at: '2026-09-28T12:00:00Z', recorded_at: '2026-09-28T12:00:01Z' } : e);
    const pacote = buildContext(p.carregado, ['init-alpha-one', 'init-alpha-two', 'init-nobody-here'], brainFalso(brain), 'thread-s4');
    assert.deepEqual(lacunasDe(pacote, 'init-alpha-two'), ['dono.sem-principal', 'observado.desconhecido', 'registrado.desconhecido']);
    assert.deepEqual(lacunasDe(pacote, 'init-alpha-one'), ['dono.sem-principal']);
    assert.deepEqual(lacunasDe(pacote, 'init-nobody-here'), ['entidade.desconhecida']);
    assert.ok(!ids(pacote).includes('init-nobody-here'));
    const projeto = pacote.itens.find(i => i.id === 'proj-alpha-core') as any;
    assert.deepEqual(projeto.owner, { raw: 'Equipe', state: 'legacy-label' });
    const ordenadas = [...pacote.lacunas].sort((a, b) => a.id.localeCompare(b.id) || a.codigo.localeCompare(b.codigo));
    assert.deepEqual(pacote.lacunas, ordenadas);
  } finally { p.limpar(); }
});

test('S5 o digest é reproduzível, ignora o horário da consulta e muda quando a fonte muda', () => {
  const p = montar('brain-context-s5');
  try {
    const brain = brainFalso(fonte(p));
    const primeiro = buildContext(p.carregado, ['init-alpha-one'], brain, 'thread-s5');
    const segundo = buildContext(p.carregado, ['init-alpha-one'], brain, 'thread-s5');
    assert.match(primeiro.digest!, /^[a-f0-9]{64}$/);
    assert.equal(primeiro.digest, segundo.digest);
    const { digest: _d, consultadoEm: _c, ...corpo } = primeiro;
    assert.equal(digest(corpo), primeiro.digest);
    const arquivo = stateFile(p.dir, 'portfolio.json'), catalogo = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    catalogo.initiatives.find((e: any) => e.id === 'init-alpha-one').title = 'Outro título';
    fs.writeFileSync(arquivo, JSON.stringify(catalogo, null, 2) + '\n');
    const depois = buildContext(p.carregado, ['init-alpha-one'], brain, 'thread-s5');
    assert.notEqual(depois.digest, primeiro.digest);
    assert.equal(depois.itens.find(i => i.id === 'init-alpha-one')!.frescor, 'divergente');
  } finally { p.limpar(); }
});

test('S6 context é só leitura: só query e get, sem ativação, sem identidade vinda do argumento e sem escrita na thread', () => {
  const p = montar('brain-context-s6');
  try {
    const thread = novaThread(p.carregado, { nome: 'Contexto', modo: 'auto' }).thread.id;
    const dir = dirThread(p.dir, thread);
    const retrato = () => fs.readdirSync(dir, { recursive: true }).map(String).sort()
      .map(n => { const f = path.join(dir, n); return fs.statSync(f).isFile() ? `${n}:${createHash('sha256').update(fs.readFileSync(f)).digest('hex')}` : n; });
    const antes = retrato(), chamadas: string[] = [];
    // A ativação de escrita está desligada: a escrita recusa, a leitura segue.
    assert.throws(() => runBrain(p.carregado, 'bind', { thread, project: 'proj-alpha-core', initiatives: 'init-alpha-one' }, [], brainFalso([])), /activation/);
    const pacote = runBrain(p.carregado, 'context', { thread, ids: 'init-alpha-one,init-alpha-three' }, [], brainFalso(fonte(p), [], chamadas));
    assert.equal(pacote.state, 'ok');
    assert.equal(pacote.thread, thread);
    assert.ok(chamadas.length > 0 && chamadas.every(o => o === 'query' || o === 'get'), chamadas.join(','));
    for (const proibida of ['principal', 'dsn', 'root'])
      assert.throws(() => runBrain(p.carregado, 'context', { thread, ids: 'init-alpha-one', [proibida]: 'x' }, [], brainFalso([])), /brain\.argument\.invalid/);
    assert.throws(() => runBrain(p.carregado, 'context', { ids: 'init-alpha-one' }, [], brainFalso([])), /brain\.thread\.required/);
    assert.deepEqual(retrato(), antes);
  } finally { p.limpar(); }
});

test('D7 Brain indisponível ou recusando encerra o pacote sem montar conteúdo só da fonte', () => {
  const p = montar('brain-context-d7');
  try {
    for (const state of ['forbidden', 'unavailable'] as const) {
      const pacote = buildContext(p.carregado, ['init-alpha-one'], () => ({ schema: BRAIN_API, state, error: 'brain.test.refused' }), 'thread-d7');
      assert.equal(pacote.state, state);
      assert.equal(pacote.error, 'brain.test.refused');
      assert.deepEqual([pacote.itens, pacote.lacunas, pacote.digest], [[], [], null]);
    }
    let consultas = 0;
    const getRecusado: BrainTransport = r => r.operation === 'query' ? (consultas++, { schema: BRAIN_API, state: 'empty', items: [] })
      : { schema: BRAIN_API, state: 'forbidden' };
    assert.equal(buildContext(p.carregado, ['init-alpha-one'], getRecusado, 'thread-d7').state, 'forbidden');
    assert.equal(consultas, 1);
  } finally { p.limpar(); }
});
