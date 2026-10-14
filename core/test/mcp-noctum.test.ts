/**
 * RM-058 (N6, D12 da ork-rm058n6): as ferramentas `ork_noctum_*` do MCP. O cliente do SDK fala com o servidor real numa
 * raiz descartável; o diálogo nativo é a elicitação que o cliente responde. Valores, contas e respostas são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { projetoTemporario } from './apoio';
import { pedidoV2, prepararIngressoSimulado } from './noctum-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { criarServidorMcp } from '../src/mcp-server';
import { lerArco } from '../src/noctum-arco';
import { novaThread } from '../src/thread';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
type Projeto = ReturnType<typeof projetoTemporario>;
type Resposta = 'primeira' | 'segunda' | 'decline' | 'cancel';

interface Sessao { client: Client; fechar: () => Promise<void>; perguntas: string[] }

async function conectar(p: Projeto, o: { formulario?: boolean; resposta?: Resposta; threadId?: string } = {}): Promise<Sessao> {
  const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code', ...(o.threadId ? { threadId: o.threadId } : {}) });
  const formulario = o.formulario ?? true;
  const client = new Client({ name: 'cliente-SIMULADO-do-noctum', version: '1' }, formulario ? { capabilities: { elicitation: { form: {} } } } : {});
  const perguntas: string[] = [];
  if (formulario) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      const params = req.params as unknown as { message: string; requestedSchema: { properties: { opcao: { oneOf: Array<{ const: string }> } } } };
      perguntas.push(params.message);
      const opcoes = params.requestedSchema.properties.opcao.oneOf.map(x => x.const);
      const r = o.resposta ?? 'primeira';
      if (r === 'decline' || r === 'cancel') return { action: r };
      return { action: 'accept' as const, content: { opcao: r === 'primeira' ? opcoes[0] : opcoes[1] } };
    });
  }
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  return { client, perguntas, fechar: async () => { await client.close(); await server.close(); } };
}

async function chamar(s: Sessao, name: string, args: Record<string, unknown>): Promise<{ erro: boolean; texto: string; dados: () => any }> {
  const r = await s.client.callTool({ name, arguments: args });
  const texto = (r.content as Array<{ type: string; text: string }>).map(x => x.text).join('');
  return { erro: r.isError === true, texto, dados: () => JSON.parse(texto) };
}

function arcoProposto(p: Projeto, arco: string): Record<string, unknown> {
  const t = novaThread(p.carregado, { nome: `${arco} trabalho`, modo: 'auto', roadmap: 'RM-901', pedido: 'Trabalho SIMULADO do MCP.', criarWorktree: false }).thread;
  return pedidoV2(arco, { trabalhos: [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }] });
}

test('MN1: ork_noctum_propor grava a proposta com o resumo e o hash, e não autoriza nada', { skip: semKernel }, async () => {
  const p = projetoTemporario('mcp-noctum-mn1');
  const s = await conectar(p);
  try {
    const r = await chamar(s, 'ork_noctum_propor', { pedido: arcoProposto(p, 'arco-mn1') });
    assert.equal(r.erro, false, r.texto);
    const d = r.dados();
    assert.equal(d.autorizado, false);
    assert.match(d.envelopeSha256, /^[a-f0-9]{64}$/);
    assert.ok(d.resumo.some((l: string) => l === `Hash do envelope: ${d.envelopeSha256}`));
    assert.equal(lerArco(p.dir, 'arco-mn1')!.situacao, 'proposto');
    const falta = await chamar(s, 'ork_noctum_propor', { pedido: { contrato: 'ork.noctum-envelope/v2', arco: 'arco-mn1b' } });
    assert.equal(falta.erro, true);
    assert.match(falta.texto, /noctum\.envelope\.valores-ausentes/);
  } finally { await s.fechar(); p.limpar(); }
});

test('MN2: ork_noctum_autorizar mostra o resumo no diálogo nativo e autoriza só com a escolha do dono', { skip: semKernel }, async () => {
  const p = projetoTemporario('mcp-noctum-mn2');
  const s = await conectar(p, { resposta: 'primeira' });
  try {
    const { envelopeSha256 } = (await chamar(s, 'ork_noctum_propor', { pedido: arcoProposto(p, 'arco-mn2') })).dados();
    const r = await chamar(s, 'ork_noctum_autorizar', { arco: 'arco-mn2', envelopeSha256 });
    assert.equal(r.erro, false, r.texto);
    assert.deepEqual([r.dados().situacao, r.dados().envelopeSha256], ['vigente', envelopeSha256]);
    assert.equal(s.perguntas.length, 1);
    assert.match(s.perguntas[0], new RegExp(`Hash do envelope: ${envelopeSha256}`));
    const quem = lerArco(p.dir, 'arco-mn2')!.autorizadoPor as { origem: string; host: string };
    assert.deepEqual([quem.origem, quem.host], ['mcp-local', 'claude-code']);
  } finally { await s.fechar(); p.limpar(); }
});

test('MN3: recusado, cancelado ou com a outra opção, o diálogo não muda nada', { skip: semKernel }, async () => {
  const p = projetoTemporario('mcp-noctum-mn3');
  try {
    const propor = await conectar(p);
    const { envelopeSha256 } = (await chamar(propor, 'ork_noctum_propor', { pedido: arcoProposto(p, 'arco-mn3') })).dados();
    await propor.fechar();
    for (const resposta of ['decline', 'cancel', 'segunda'] as const) {
      const s = await conectar(p, { resposta });
      try {
        const r = await chamar(s, 'ork_noctum_autorizar', { arco: 'arco-mn3', envelopeSha256 });
        assert.equal(r.erro, true, resposta);
        assert.match(r.texto, /noctum\.origem\.sem-prova/);
      } finally { await s.fechar(); }
    }
    assert.equal(lerArco(p.dir, 'arco-mn3')!.situacao, 'proposto');
  } finally { p.limpar(); }
});

test('MN4: ork_noctum_revogar revoga pelo diálogo, e a revogação é terminal', { skip: semKernel }, async () => {
  const p = projetoTemporario('mcp-noctum-mn4');
  const s = await conectar(p);
  try {
    const { envelopeSha256 } = (await chamar(s, 'ork_noctum_propor', { pedido: arcoProposto(p, 'arco-mn4') })).dados();
    await chamar(s, 'ork_noctum_autorizar', { arco: 'arco-mn4', envelopeSha256 });
    const r = await chamar(s, 'ork_noctum_revogar', { arco: 'arco-mn4' });
    assert.equal(r.erro, false, r.texto);
    assert.equal(r.dados().situacao, 'revogado');
    assert.match(s.perguntas.at(-1)!, /Revogar o arco arco-mn4/);
    assert.equal(lerArco(p.dir, 'arco-mn4')!.situacao, 'revogado');
  } finally { await s.fechar(); p.limpar(); }
});

test('MN5: sem o formulário nativo no cliente, autorizar e revogar recusam antes de qualquer escrita', { skip: semKernel }, async () => {
  const p = projetoTemporario('mcp-noctum-mn5');
  const s = await conectar(p, { formulario: false });
  try {
    const { envelopeSha256 } = (await chamar(s, 'ork_noctum_propor', { pedido: arcoProposto(p, 'arco-mn5') })).dados();
    const antes = JSON.stringify(lerArco(p.dir, 'arco-mn5'));
    for (const [nome, args] of [['ork_noctum_autorizar', { arco: 'arco-mn5', envelopeSha256 }], ['ork_noctum_revogar', { arco: 'arco-mn5' }]] as const) {
      const r = await chamar(s, nome, args);
      assert.equal(r.erro, true, nome);
      assert.match(r.texto, /não oferece o formulário nativo do host/);
    }
    assert.equal(JSON.stringify(lerArco(p.dir, 'arco-mn5')), antes, 'nada foi gravado');
  } finally { await s.fechar(); p.limpar(); }
});

test('MN6: resposta nos argumentos é recusada pelo esquema, e o diálogo nem abre', { skip: semKernel }, async () => {
  const p = projetoTemporario('mcp-noctum-mn6');
  const s = await conectar(p);
  try {
    const { envelopeSha256 } = (await chamar(s, 'ork_noctum_propor', { pedido: arcoProposto(p, 'arco-mn6') })).dados();
    for (const extra of [{ resposta: 'Autorizar este envelope' }, { opcao: 'Autorizar este envelope' }, { por: 'dono' }]) {
      const r = await chamar(s, 'ork_noctum_autorizar', { arco: 'arco-mn6', envelopeSha256, ...extra });
      assert.equal(r.erro, true, JSON.stringify(extra));
    }
    assert.equal(s.perguntas.length, 0);
    assert.equal(lerArco(p.dir, 'arco-mn6')!.situacao, 'proposto');
  } finally { await s.fechar(); p.limpar(); }
});

test('MN7: a sessão de fase, fixada numa thread, não lista as ferramentas do arco', { skip: semKernel }, async () => {
  const p = projetoTemporario('mcp-noctum-mn7');
  const t = novaThread(p.carregado, { nome: 'mn7 fase', modo: 'auto', criarWorktree: false }).thread;
  const dono = await conectar(p);
  const fase = await conectar(p, { threadId: t.id });
  try {
    const nomes = async (s: Sessao) => (await s.client.listTools()).tools.map(x => x.name).filter(n => n.startsWith('ork_noctum_')).sort();
    assert.deepEqual(await nomes(dono), ['ork_noctum_autorizar', 'ork_noctum_propor', 'ork_noctum_revogar', 'ork_noctum_status']);
    assert.deepEqual(await nomes(fase), []);
  } finally { await dono.fechar(); await fase.fechar(); p.limpar(); }
});

test('MN8: ork_noctum_status devolve o retrato do arco e, sem arco, a lista', { skip: semKernel }, async () => {
  const p = projetoTemporario('mcp-noctum-mn8');
  const s = await conectar(p);
  try {
    await chamar(s, 'ork_noctum_propor', { pedido: arcoProposto(p, 'arco-mn8') });
    const r = await chamar(s, 'ork_noctum_status', { arco: 'arco-mn8' });
    assert.equal(r.erro, false, r.texto);
    assert.deepEqual([r.dados().contrato, r.dados().situacao], ['ork.noctum-retrato/v1', 'proposto']);
    assert.deepEqual((await chamar(s, 'ork_noctum_status', {})).dados().arcos, [{ arco: 'arco-mn8', situacao: 'proposto' }]);
    assert.equal((await chamar(s, 'ork_noctum_status', { arco: 'arco-inexistente' })).erro, true);
  } finally { await s.fechar(); p.limpar(); }
});
