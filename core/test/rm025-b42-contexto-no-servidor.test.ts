import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { createInitiative, createProduct, createProject, readPortfolio } from '../src/portfolio';
import { BRAIN_API, BrainResponse, BrainTransport } from '../src/company-brain-client';
import { BrainEntity, canonical, digest, validateContract } from '../src/company-brain-contract';
import { buildContext, SERVER_CONTEXT_SCHEMA } from '../src/company-brain-context';
import { portfolioEntities } from '../src/company-brain-source';

/** B4.2: o núcleo pede o modo `context` do OrkMind, confere o pacote e só volta à consulta sem o modo. */
const root = path.resolve(__dirname, '../../..');
const dourado = JSON.parse(fs.readFileSync(path.join(root, 'core/test/fixtures/company-brain-context-v1.json'), 'utf8'));
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const SEM_MODO: BrainResponse = { schema: BRAIN_API, state: 'unavailable', error: 'brain.selection.context-unsupported' };
const ORDEM: Record<string, number> = { prod: 0, proj: 1, init: 2 };
const kind = (id: string) => id.slice(0, 4);
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

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

/**
 * OrkMind falso com os dois modos, pelas regras de docs/company-brain.md do OrkMind: no `context`, cada
 * id com a semântica do get, fecho só a partir de item citado e digest do corpo canônico.
 */
function orkmindFalso(entidades: BrainEntity[], opcoes: { retidas?: string[]; semModo?: boolean; chamadas?: string[];
  adulterar?: (ctx: any) => void } = {}): BrainTransport {
  const porId = new Map(entidades.map(e => [e.id, e])), retidas = opcoes.retidas ?? [];
  const citada = (s: any) => s && ['authority', 'instance', 'source_ref', 'location'].every(k => typeof s[k] === 'string' && s[k])
    && /^[a-f0-9]{64}$/.test(s.source_hash ?? '') && Number.isInteger(s.source_version);
  return request => {
    const payload = request.payload as any;
    opcoes.chamadas?.push(`${request.operation}${payload?.mode ? ':' + payload.mode : ''}`);
    if (request.operation === 'query' && payload.mode === 'context') {
      if (opcoes.semModo) return SEM_MODO;
      const requested = [...new Set<string>(payload.facets.ids)].sort(cmp), resolvidos = new Map<string, any>();
      for (let pendentes = requested; pendentes.length;) {
        const pais = new Set<string>();
        for (const id of pendentes) {
          const e = porId.get(id);
          const entrada = retidas.includes(id) ? 'withheld' : !e ? null : !citada(e.source) ? 'uncited' : e;
          resolvidos.set(id, entrada);
          const parent = entrada && typeof entrada === 'object' ? entrada.parent_id : null;
          if (parent && ORDEM[kind(parent)] < ORDEM[kind(id)]) pais.add(parent);
        }
        pendentes = [...pais].filter(id => !resolvidos.has(id)).sort(cmp);
      }
      const items: any[] = [], gaps: any[] = [];
      for (const [id, e] of resolvidos) {
        if (e === null) gaps.push({ id, code: 'entity.unknown' });
        else if (e === 'withheld') { items.push({ id, state: 'withheld' }); gaps.push({ id, code: 'entity.withheld' }); }
        else if (e === 'uncited') gaps.push({ id, code: 'citation.incomplete' });
        else {
          const { kind: k, version, title, status, parent_id, depends_on, owner, source, observed_at, recorded_at } = e;
          items.push({ id, state: 'ok', entity: { kind: k, version, title, status, parent_id, depends_on, owner, source, observed_at, recorded_at } });
          if (owner?.principal == null) gaps.push({ id, code: 'owner.unresolved' });
          if (observed_at == null) gaps.push({ id, code: 'observed.unknown' });
          if (recorded_at == null) gaps.push({ id, code: 'recorded.unknown' });
        }
      }
      items.sort((a, b) => ORDEM[kind(a.id)] - ORDEM[kind(b.id)] || cmp(a.id, b.id));
      gaps.sort((a, b) => cmp(a.id, b.id) || cmp(a.code, b.code));
      const body = { schema: SERVER_CONTEXT_SCHEMA, tenant_id: payload.tenant_id, requested, items, gaps };
      const context: any = { ...body, digest: digest(body) };
      opcoes.adulterar?.(context);
      return { schema: BRAIN_API, state: items.length ? 'ok' : 'empty', context };
    }
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
const semHorario = (pacote: any) => { const { consultadoEm: _c, caminho: _k, ...resto } = pacote; return resto; };

test('B4.2 o pacote dourado do OrkMind vira o pacote do núcleo numa só consulta, com o digest conferido', () => {
  const p = projetoTemporario('rm025-b42-dourado');
  try {
    assert.equal(p.carregado.manifesto.memory.tenant, dourado.request.tenant_id);
    const pedidos: any[] = [];
    const servidor: BrainTransport = r => {
      pedidos.push(r.payload);
      return canonical(r.payload) === canonical(dourado.request) ? copia(dourado.response) : { schema: BRAIN_API, state: 'conflict', error: 'brain.test.request' };
    };
    const pacote = buildContext(p.carregado, ['init-golden-two', 'init-golden-one', 'init-golden-absent', 'init-golden-three'], servidor, 'thread-dourado');
    assert.equal(pacote.caminho, 'servidor');
    assert.equal(pedidos.length, 1);
    assert.equal(pacote.state, 'ok');
    assert.deepEqual(pacote.itens.map(i => `${i.id} ${i.estado} ${i.frescor}`), ['prod-golden ok ausente-na-fonte',
      'proj-golden-core ok ausente-na-fonte', 'init-golden-one ok ausente-na-fonte', 'init-golden-two retido retido']);
    const lacunas = pacote.lacunas.map(l => `${l.id} ${l.codigo}`);
    for (const esperada of ['init-golden-absent entidade.desconhecida', 'init-golden-three citacao.incompleta', 'init-golden-two brain.retido',
      'init-golden-one dono.sem-principal', 'prod-golden observado.desconhecido', 'proj-golden-core registrado.desconhecido'])
      assert.ok(lacunas.includes(esperada), esperada);
    const um = pacote.itens.find(i => i.id === 'init-golden-one') as any;
    assert.equal(um.citacao.source_hash, dourado.response.context.items.find((i: any) => i.id === 'init-golden-one').entity.source.source_hash);
    assert.equal(um.titulo, 'Iniciativa citável');
    const { digest: _d, consultadoEm: _c, caminho: _k, ...corpo } = pacote;
    assert.equal(digest(corpo), pacote.digest);
  } finally { p.limpar(); }
});

test('B4.2 os dois caminhos dão o mesmo conteúdo e o mesmo digest para os mesmos dados', () => {
  const p = montar('rm025-b42-paridade');
  try {
    const locais = fonte(p), um = locais.find(e => e.id === 'init-alpha-one')!;
    // Brain atrasado e adiantado: uma divergente, uma que falta, uma só no Brain com pai só no Brain, uma retida e uma sem citação.
    const brain: BrainEntity[] = locais.filter(e => e.id !== 'init-alpha-three' && e.id !== 'proj-alpha-core').map(e => e.id === 'init-alpha-two'
      ? { ...e, title: 'título antigo', source: { ...e.source, source_hash: digest('título antigo') } } : e);
    const so = (id: string, kind: 'prod' | 'proj' | 'init', parent_id: string | null): BrainEntity => ({ ...copia(um), id, kind, parent_id,
      aliases: [{ system: 'ork', instance: 'orkastery', id }], source: { ...um.source, source_ref: `portfolio.json#${id}`, location: `id:${id}` } });
    brain.push(so('prod-beta', 'prod', null), so('init-beta-one', 'init', 'prod-beta'),
      { ...so('init-beta-uncited', 'init', null), source: { ...um.source, location: '' } });
    const pedido = ['init-alpha-one', 'init-alpha-two', 'init-alpha-three', 'init-alpha-secret', 'init-beta-one', 'init-beta-uncited', 'init-nobody-here'];
    const chamadasServidor: string[] = [], chamadasConsulta: string[] = [];
    const pelaServidor = buildContext(p.carregado, pedido, orkmindFalso(brain, { retidas: ['init-alpha-secret'], chamadas: chamadasServidor }), 'thread-par');
    const pelaConsulta = buildContext(p.carregado, pedido, orkmindFalso(brain, { retidas: ['init-alpha-secret'], semModo: true, chamadas: chamadasConsulta }), 'thread-par');
    assert.equal(pelaServidor.caminho, 'servidor');
    assert.equal(pelaConsulta.caminho, 'consulta');
    assert.ok(chamadasServidor.every(c => c === 'query:context'), chamadasServidor.join(','));
    assert.ok(chamadasConsulta.includes('query:selection'));
    assert.deepEqual(semHorario(pelaServidor), semHorario(pelaConsulta));
    assert.equal(pelaServidor.digest, pelaConsulta.digest);
    // O proj-alpha-core só a fonte local conhece: o servidor não o fecha, e o núcleo pede o pai e o avô em mais duas voltas.
    assert.equal(chamadasServidor.length, 3);
    assert.ok(pelaServidor.itens.some(i => i.id === 'proj-alpha-core' && i.frescor === 'ausente-no-brain'));
    assert.ok(pelaServidor.lacunas.some(l => l.id === 'init-beta-uncited' && l.codigo === 'citacao.incompleta'));
  } finally { p.limpar(); }
});

test('B4.2 pacote do servidor que não confere encerra com conflict, sem cair na consulta', () => {
  const p = montar('rm025-b42-adulterado');
  try {
    const brain = fonte(p);
    const casos: Array<[string, (ctx: any) => void]> = [
      ['digest trocado', ctx => { ctx.digest = digest('outro'); }],
      ['título trocado depois do digest', ctx => { ctx.items[0].entity.title = 'mentira'; }],
      ['pedido trocado', ctx => { ctx.requested = ['init-alpha-two']; ctx.digest = digest({ ...ctx, digest: undefined }); }],
      ['citação sem authority', ctx => { delete ctx.items[0].entity.source.authority; const { digest: _d, ...b } = ctx; ctx.digest = digest(b); }],
      ['item fora do fecho', ctx => { ctx.items.push({ id: 'init-alpha-two', state: 'withheld' }); const { digest: _d, ...b } = ctx; ctx.digest = digest(b); }],
      ['id pedido sem destino', ctx => { ctx.items = ctx.items.filter((i: any) => i.id !== 'init-alpha-one'); const { digest: _d, ...b } = ctx; ctx.digest = digest(b); }],
      ['tenant trocado', ctx => { ctx.tenant_id = 'outro'; const { digest: _d, ...b } = ctx; ctx.digest = digest(b); }],
      ['schema trocado', ctx => { ctx.schema = 'orkmind.company-brain-context/v2'; const { digest: _d, ...b } = ctx; ctx.digest = digest(b); }],
    ];
    for (const [nome, adulterar] of casos) {
      const chamadas: string[] = [];
      const pacote = buildContext(p.carregado, ['init-alpha-one'], orkmindFalso(brain, { adulterar, chamadas }), 'thread-adulterado');
      assert.deepEqual([pacote.state, pacote.error, pacote.caminho], ['conflict', 'brain.context.server-invalid', 'servidor'], nome);
      assert.deepEqual([pacote.itens, pacote.lacunas, pacote.digest], [[], [], null], nome);
      assert.deepEqual(chamadas, ['query:context'], nome);
    }
  } finally { p.limpar(); }
});

test('B4.2 só brain.selection.context-unsupported leva à consulta; outra recusa encerra o pacote', () => {
  const p = montar('rm025-b42-recusa');
  try {
    for (const resposta of [{ state: 'forbidden', error: 'brain.access.denied' }, { state: 'unavailable', error: 'brain.transport.unavailable' }] as const) {
      const chamadas: string[] = [];
      const pacote = buildContext(p.carregado, ['init-alpha-one'], r => { chamadas.push((r.payload as any)?.mode ?? r.operation);
        return { schema: BRAIN_API, ...resposta }; }, 'thread-recusa');
      assert.deepEqual([pacote.state, pacote.error, pacote.caminho], [resposta.state, resposta.error, 'servidor']);
      assert.deepEqual(chamadas, ['context']);
    }
    const chamadas: string[] = [];
    const pacote = buildContext(p.carregado, ['init-alpha-one'], orkmindFalso(fonte(p), { semModo: true, chamadas }), 'thread-recusa');
    assert.deepEqual([pacote.state, pacote.caminho], ['ok', 'consulta']);
    assert.deepEqual(chamadas.slice(0, 2), ['query:context', 'query:selection']);
  } finally { p.limpar(); }
});

// Suspeitas da revisao de 03/10 (thread ork-suspeitasdar): "o caminho do servidor exige
// source.authority e segue so o pai da fonte local; o por consulta nao. Se a projecao tirar
// authority ou os pais divergirem, os dois caminhos dao digests diferentes".
test('suspeitas 03/10: pais divergentes entre a fonte e o Brain dao o mesmo pacote nos dois caminhos', () => {
  const p = montar('susp0310-b42-pais');
  try {
    const locais = fonte(p), um = locais.find(e => e.id === 'init-alpha-one')!;
    const so = (id: string, kind: 'prod' | 'proj' | 'init', parent_id: string | null): BrainEntity => ({ ...copia(um), id, kind, parent_id,
      aliases: [{ system: 'ork', instance: 'orkastery', id }], source: { ...um.source, source_ref: `portfolio.json#${id}`, location: `id:${id}` } });
    // No Brain, a init-alpha-two mudou de projeto (pai e avo so no Brain); a init-alpha-one perdeu o pai.
    const brain: BrainEntity[] = locais.map(e => e.id === 'init-alpha-two' ? { ...e, parent_id: 'proj-gama-core' }
      : e.id === 'init-alpha-one' ? { ...e, parent_id: null } : e);
    brain.push(so('prod-gama', 'prod', null), so('proj-gama-core', 'proj', 'prod-gama'));
    const pedido = ['init-alpha-one', 'init-alpha-two'];
    const pelaServidor = buildContext(p.carregado, pedido, orkmindFalso(brain), 'thread-pais');
    const pelaConsulta = buildContext(p.carregado, pedido, orkmindFalso(brain, { semModo: true }), 'thread-pais');
    assert.equal(pelaServidor.caminho, 'servidor');
    assert.equal(pelaConsulta.caminho, 'consulta');
    assert.deepEqual(semHorario(pelaServidor), semHorario(pelaConsulta));
    assert.equal(pelaServidor.digest, pelaConsulta.digest);
    // Os dois fecham pelos dois pais: o da fonte (proj-alpha-core) e o do Brain (proj-gama-core), ate os produtos.
    assert.deepEqual(pelaServidor.itens.map(i => i.id).sort(), ['init-alpha-one', 'init-alpha-two', 'prod-alpha', 'prod-gama', 'proj-alpha-core', 'proj-gama-core']);
  } finally { p.limpar(); }
});

test('suspeitas 03/10: entidade sem authority nao e citavel em nenhum dos dois caminhos', () => {
  const p = montar('susp0310-b42-authority');
  try {
    const locais = fonte(p);
    const semAuthority = locais.map(e => e.id === 'init-alpha-one' ? { ...e, source: (({ authority: _a, ...s }) => s)(e.source) as any } : e);
    assert.throws(() => validateContract(semAuthority.find(e => e.id === 'init-alpha-one')), /authority|contract|schema/i,
      'o schema canonico (Source.authority: const "ork", obrigatorio) recusa a entidade');
    const pelaServidor = buildContext(p.carregado, ['init-alpha-one'], orkmindFalso(semAuthority), 'thread-auth');
    assert.ok(pelaServidor.lacunas.some(l => l.id === 'init-alpha-one' && l.codigo === 'citacao.incompleta'));
    // Um Brain fora do proprio contrato entrega a entidade sem authority pela consulta: o pacote e o mesmo do servidor.
    const pelaConsulta = buildContext(p.carregado, ['init-alpha-one'], orkmindFalso(semAuthority, { semModo: true }), 'thread-auth');
    assert.deepEqual(semHorario(pelaConsulta), semHorario(pelaServidor));
    assert.equal(pelaConsulta.digest, pelaServidor.digest);
  } finally { p.limpar(); }
});
