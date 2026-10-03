/**
 * RM-039 (receita da C5): os ramos de `company-brain-context.ts` mudados em 03/10 que a suite nao
 * executava. O pacote dourado do OrkMind (fixture do B4.2) e adulterado um campo por vez, com o
 * digest recalculado: so a conferencia do nucleo pode recusar. Sem OrkMind real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BRAIN_API, BrainResponse, BrainTransport } from '../src/company-brain-client';
import { digest } from '../src/company-brain-contract';
import { buildContext } from '../src/company-brain-context';
import { createInitiative, createProduct, createProject } from '../src/portfolio';
import { projetoTemporario } from './apoio';

const dourado = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/company-brain-context-v1.json'), 'utf8'));
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const PEDIDO = ['init-golden-two', 'init-golden-one', 'init-golden-absent', 'init-golden-three'];
const SEM_MODO: BrainResponse = { schema: BRAIN_API, state: 'unavailable', error: 'brain.selection.context-unsupported' };

/** O servidor responde o pacote dourado depois de `mexer`, com o digest refeito sobre o corpo adulterado. */
function servidorAdulterado(mexer: (ctx: any, resposta: any) => void): BrainTransport {
  return () => {
    const resposta = copia(dourado.response);
    mexer(resposta.context, resposta);
    const { digest: _d, ...corpo } = resposta.context;
    resposta.context.digest = digest(corpo);
    return resposta;
  };
}

test('C5 brain servidor: o pacote dourado adulterado com digest refeito vira conflito de servidor invalido', () => {
  const p = projetoTemporario('c5-brain-servidor');
  try {
    const okDe = (ctx: any) => ctx.items.find((i: any) => i.id === 'init-golden-one');
    const casos: [string, (ctx: any, r: any) => void][] = [
      ['chave a mais no pacote', (ctx) => { ctx.extra = 1; }],
      ['estado empty com itens', (_ctx, r) => { r.state = 'empty'; }],
      ['lacuna com id fora do formato', (ctx) => { ctx.gaps.push({ id: 'INIT-X', code: 'entity.unknown' }); }],
      ['item repetido', (ctx) => { ctx.items.push(copia(okDe(ctx))); }],
      ['retido com campo a mais', (ctx) => { ctx.items.find((i: any) => i.state === 'withheld').entity = {}; }],
      ['kind que nao e o do id', (ctx) => { okDe(ctx).entity.kind = 'proj'; }],
      ['citacao sem authority', (ctx) => { delete okDe(ctx).entity.source.authority; }],
      ['itens fora de ordem', (ctx) => { ctx.items.reverse(); }],
      ['item fora do pedido que nao e pai', (ctx) => { ctx.items.push({ ...copia(okDe(ctx)), id: 'init-golden-zzz' }); }],
      ['pedido sem destino', (ctx) => { ctx.gaps = ctx.gaps.filter((g: any) => g.id !== 'init-golden-absent'); }],
      ['item que tambem e desconhecido', (ctx) => { ctx.gaps.push({ id: 'init-golden-one', code: 'entity.unknown' }); }],
      ['tenant de outro', (ctx) => { ctx.tenant_id = 'outro'; }],
    ];
    for (const [nome, mexer] of casos) {
      const pacote = buildContext(p.carregado, PEDIDO, servidorAdulterado(mexer), 'thread-c5');
      assert.deepEqual([pacote.state, pacote.error, pacote.caminho, pacote.itens.length, pacote.digest], ['conflict', 'brain.context.server-invalid', 'servidor', 0, null], nome);
    }
    const intacto = buildContext(p.carregado, PEDIDO, servidorAdulterado(() => {}), 'thread-c5');
    assert.equal(intacto.state, 'ok', 'sem adulterar, o mesmo servidor passa');
  } finally { p.limpar(); }
});

test('C5 brain servidor: sem o modo context depois da primeira volta e conflito; falha do servidor encerra o pacote', () => {
  const p = projetoTemporario('c5-brain-voltas');
  try {
    createProduct(p.dir, { id: 'prod-local', title: 'Local' });
    createProject(p.dir, { id: 'proj-local-core', productId: 'prod-local', title: 'Nucleo' });
    createInitiative(p.dir, { id: 'init-local-one', projectId: 'proj-local-core', title: 'Uma' });
    // Primeira volta: o servidor nao conhece o pedido (lacuna de desconhecido); o pai so a fonte local
    // conhece e vai na segunda volta, quando o servidor diz que nao tem o modo.
    let voltas = 0;
    const servidor: BrainTransport = (r) => {
      voltas++;
      if (voltas > 1) return SEM_MODO;
      const ids = (r.payload as any).facets.ids as string[];
      const corpo = { schema: 'orkmind.company-brain-context/v1', tenant_id: (r.payload as any).tenant_id, requested: ids, items: [],
        gaps: ids.map((id) => ({ id, code: 'entity.unknown' })) };
      return { schema: BRAIN_API, state: 'empty', context: { ...corpo, digest: digest(corpo) } } as BrainResponse;
    };
    const pacote = buildContext(p.carregado, ['init-local-one'], servidor, 'thread-c5');
    assert.equal(voltas, 2);
    assert.deepEqual([pacote.state, pacote.error, pacote.caminho], ['conflict', 'brain.context.server-invalid', 'servidor']);

    const negado = buildContext(p.carregado, ['init-local-one'], () => ({ schema: BRAIN_API, state: 'forbidden', error: 'brain.acl' }), 'thread-c5');
    assert.deepEqual([negado.state, negado.error, negado.caminho, negado.itens.length], ['forbidden', 'brain.acl', 'servidor', 0]);
  } finally { p.limpar(); }
});

test('C5 brain consulta: falha da selecao encerra; itens fora de lista viram desconhecidos; campos ausentes tem padrao', () => {
  const p = projetoTemporario('c5-brain-consulta');
  try {
    const indisponivel: BrainTransport = (r) => (r.payload as any).mode === 'context' ? SEM_MODO
      : { schema: BRAIN_API, state: 'unavailable', error: 'brain.down' };
    const fora = buildContext(p.carregado, ['init-nada-aqui'], indisponivel, 'thread-c5');
    assert.deepEqual([fora.state, fora.error, fora.caminho], ['unavailable', 'brain.down', 'consulta']);

    const semLista: BrainTransport = (r) => (r.payload as any).mode === 'context' ? SEM_MODO
      : { schema: BRAIN_API, state: 'ok', items: 'nao e lista' } as unknown as BrainResponse;
    const vazio = buildContext(p.carregado, ['init-nada-aqui'], semLista, 'thread-c5');
    assert.deepEqual([vazio.state, vazio.caminho], ['empty', 'consulta']);
    assert.deepEqual(vazio.lacunas, [{ id: 'init-nada-aqui', codigo: 'entidade.desconhecida' }]);

    // Entidade citavel sem titulo, status, pai, dependencias e dono: o item sai com os padroes.
    const um = dourado.response.context.items.find((i: any) => i.id === 'init-golden-one').entity;
    const minima = { id: 'init-golden-one', kind: 'init', version: um.version, source: um.source };
    const so: BrainTransport = (r) => (r.payload as any).mode === 'context' ? SEM_MODO
      : { schema: BRAIN_API, state: 'ok', items: [{ state: 'ok', entity: minima }] } as unknown as BrainResponse;
    const pacote = buildContext(p.carregado, ['init-golden-one'], so, 'thread-c5');
    assert.deepEqual(pacote.itens, [{ id: 'init-golden-one', kind: 'init', estado: 'ok', frescor: 'ausente-na-fonte', origem: 'brain', titulo: '',
      status: '', parent_id: null, depends_on: [], owner: { raw: null, state: 'unknown' }, versao: um.version,
      citacao: { instance: um.source.instance, source_ref: um.source.source_ref, source_hash: um.source.source_hash,
        source_version: um.source.source_version, location: um.source.location }, fonte: null }]);
  } finally { p.limpar(); }
});
