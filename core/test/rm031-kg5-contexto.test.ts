import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { pacoteDeContexto, sementesDaThread, type EntradaDoContexto } from '../src/intelligence-graph-contexto';
import { extrairGrafo } from '../src/intelligence-graph-extract';
import { carregarAnalisadores } from '../src/intelligence-graph-parsers';
import type { GrafoCodigo } from '../src/intelligence-graph-contract';
import { filtrarGrafo, type CabecalhoDoIndice } from '../src/intelligence-graph-query';
import { executarGrafo } from '../src/intelligence-graph-cli';
import { argvDaTool, lerEntradaDaThread } from '../src/mcp-grafo';
import { rodarConsulta } from '../src/mcp-grafo-worker';
import { criarServidorMcp } from '../src/mcp-server';
import { escreverArtefatoMcp } from '../src/mcp-artifacts';
import { adicionarClaim, retirarClaim } from '../src/claims';
import { novaThread } from '../src/thread';
import { exigirManifesto } from '../src/manifest';
import { montarPrompt, montarPromptComMemoria } from '../src/phase';
import { pedidoComDicaDoGrafo, threadDeExemplo } from '../src/prompts';
import { abrirMemoria } from '../src/memoria';
import { commitar, projetoTemporario } from './apoio';

const REPO: Record<string, string> = {
  'src/alvo.ts': 'export function alvo(): number { return 1; }\n',
  'src/app.ts': "import { alvo } from './alvo';\n" + Array.from({ length: 30 }, (_, i) => `export function f${i}(): number { return alvo(); }\n`).join(''),
  'docs/guia.md': '# Guia\n\n[alvo](../src/alvo.ts)\n',
  'src/isolado.ts': 'export const isolado = 42;\n',
};
const ENTRADA: EntradaDoContexto = { thread: 'demo-contexto', base: 'a'.repeat(40), diff: ['src/alvo.ts'], goal: null, plan: null, claims: [] };
let GRAFO: GrafoCodigo, INDICE: CabecalhoDoIndice;
before(() => {
  GRAFO = extrairGrafo({ tenant_id: 'local', repository_id: 'demo', revision: 'a'.repeat(40), revision_unavailable_reason: null,
    acl_refs: ['repo:demo:leitura'], fontes: Object.entries(REPO).map(([p, c]) => ({ path: p, bytes: Buffer.from(c) })) }, carregarAnalisadores()).grafo;
  INDICE = { repository_id: 'demo', revision: 'a'.repeat(40), chave: 'b'.repeat(64), snapshot_id: GRAFO.snapshot.snapshot_id,
    graph_digest: 'c'.repeat(64), arvore: 'limpa', extratores: GRAFO.snapshot.extractors };
});

test('KG5 contexto puro: agrega diff, GOAL, PLAN e claims com origem; rejeita caminhos externos e estado', () => {
  const sementes = sementesDaThread({ ...ENTRADA, diff: ['src/alvo.ts', 'src/alvo.ts'],
    goal: 'Editar `src/alvo.ts` e [guia](docs/guia.md).', plan: 'touch_paths: [src/app.ts, src/novo.ts]',
    claims: [{ id: 'C1', arquivo: 'src/alvo.ts' }, { id: 'C2', arquivo: '../fora.ts' }, { id: 'C3', arquivo: '.orkastery/private/x' }] });
  assert.deepEqual(sementes, [
    { arquivo: 'docs/guia.md', origens: ['goal'] }, { arquivo: 'src/alvo.ts', origens: ['claim:C1', 'diff', 'goal'] },
    { arquivo: 'src/app.ts', origens: ['plan'] }, { arquivo: 'src/novo.ts', origens: ['plan'] },
  ]);
  assert.deepEqual(sementesDaThread({ ...ENTRADA, diff: [], goal: '`/externo/x.ts` https://host/x.ts `C:\\fora.ts`', plan: null }), []);
});

test('KG5 contexto puro: mesma entrada e indice, inclusive ordem permutada, produz bytes identicos', () => {
  const entrada = { ...ENTRADA, diff: ['src/alvo.ts', 'src/app.ts'], claims: [{ id: 'C2', arquivo: 'docs/guia.md' }, { id: 'C1', arquivo: 'src/alvo.ts' }] };
  const a = pacoteDeContexto(GRAFO, INDICE, entrada);
  const b = pacoteDeContexto({ ...GRAFO, nodes: [...GRAFO.nodes].reverse(), edges: [...GRAFO.edges].reverse(),
    snapshot: { ...GRAFO.snapshot, source_manifest: [...GRAFO.snapshot.source_manifest].reverse() } }, INDICE,
  { ...entrada, diff: [...entrada.diff].reverse(), claims: [...entrada.claims].reverse() });
  assert.equal(a, b);
  assert.equal(a, pacoteDeContexto(GRAFO, INDICE, entrada));
});

test('KG5 contexto puro: expande simbolos, importadores, chamadas e docs; toda ligacao tem pontas e evidencia integral', () => {
  const r = JSON.parse(pacoteDeContexto(GRAFO, INDICE, ENTRADA, 65536));
  assert.equal(r.truncado, false);
  assert.ok(r.arestas.some((a: any) => a.kind === 'calls'));
  assert.ok(r.arestas.some((a: any) => a.kind === 'imports'));
  assert.ok(r.nos.some((n: any) => n.path === 'docs/guia.md'));
  assert.ok(!r.nos.some((n: any) => n.path === 'src/isolado.ts'));
  const ids = new Set(r.nos.map((n: any) => n.node_id));
  for (const a of r.arestas) {
    assert.ok(ids.has(a.from) && ids.has(a.to));
    const original = GRAFO.edges.find((x) => x.edge_id === a.edge_id)!;
    assert.equal(a.evidencias.length, original.evidence.length);
    for (const e of a.evidencias) {
      assert.ok(original.evidence.some((o) => o.path === e.path && o.span.byte_start === e.span.byte_start && o.span.byte_end === e.span.byte_end));
      assert.ok(Buffer.from(REPO[e.path]).subarray(e.span.byte_start, e.span.byte_end).length > 0);
      assert.ok(e.extractor_id && e.extractor_version && e.extraction_method);
    }
  }
});

test('KG5 contexto puro: teto corta unidades inteiras, declara omissoes e suporta Unicode em bytes', () => {
  for (const teto of [4096, 8192, 16384, 32768, 65536]) {
    const texto = pacoteDeContexto(GRAFO, INDICE, { ...ENTRADA, diff: [...ENTRADA.diff, 'src/ação.ts'] }, teto), r = JSON.parse(texto);
    assert.ok(Buffer.byteLength(texto) <= teto);
    assert.equal(r.medida.pacote_bytes, Buffer.byteLength(texto));
    assert.equal(r.omitidos.arestas + r.arestas.length, r.total_arestas);
    assert.equal(r.teto.cortado, r.truncado);
    for (const a of r.arestas) assert.equal(a.evidencias.length, GRAFO.edges.find((x) => x.edge_id === a.edge_id)!.evidence.length);
  }
  const pequeno = JSON.parse(pacoteDeContexto(GRAFO, INDICE, ENTRADA, 4096));
  assert.equal(pequeno.truncado, true);
  const muitas = { ...ENTRADA, diff: Array.from({ length: 1000 }, (_, i) => `src/arquivo-${i}.ts`) };
  const cortadas = JSON.parse(pacoteDeContexto(GRAFO, INDICE, muitas, 4096));
  assert.ok(cortadas.omitidos.sementes > 0);
  assert.equal(cortadas.arestas.length, 0);
  for (const n of [1, 4095, 65537, NaN, 4096.5]) assert.throws(() => pacoteDeContexto(GRAFO, INDICE, ENTRADA, n), /teto-invalido/);
});

test('KG5 contexto puro: ausentes declarados, pacote vazio valido e concessao nao revela ligacoes ocultas', () => {
  const r = JSON.parse(pacoteDeContexto(GRAFO, INDICE, { ...ENTRADA, diff: ['src/novo.ts'] }));
  assert.deepEqual(r.sementes, [{ arquivo: 'src/novo.ts', estado: 'fora-do-indice', origens: ['diff'] }]);
  assert.deepEqual(r.nos, []); assert.deepEqual(r.arestas, []);
  const vazio = JSON.parse(pacoteDeContexto(GRAFO, INDICE, { ...ENTRADA, diff: [] }));
  assert.equal(vazio.truncado, false); assert.deepEqual(vazio.sementes, []);
  const filtrado = filtrarGrafo(GRAFO, { tenant_id: 'outro', acl_refs: [] });
  const oculto = JSON.parse(pacoteDeContexto(filtrado, INDICE, ENTRADA));
  assert.deepEqual(oculto.arestas, []); assert.deepEqual(oculto.medida.arquivos, []);
});

test('KG5 medida offline: bytes do pacote contra leitura crua dos mesmos arquivos, sem tokens estimados', (t) => {
  const texto = pacoteDeContexto(GRAFO, INDICE, ENTRADA), r = JSON.parse(texto);
  const cru = r.medida.arquivos.reduce((s: number, f: any) => s + Buffer.byteLength(REPO[f.path]), 0);
  assert.equal(r.medida.pacote_bytes, Buffer.byteLength(texto));
  assert.equal(r.medida.leitura_crua_bytes, cru);
  for (const f of r.medida.arquivos) assert.equal(f.bytes, Buffer.byteLength(REPO[f.path]));
  assert.equal(r.medida.tokens, 'unavailable');
  t.diagnostic(JSON.stringify({ pacote_bytes: Buffer.byteLength(texto), leitura_crua_bytes: cru, arquivos: r.medida.arquivos.length, truncado: r.truncado, tokens: r.medida.tokens }));
});

test('KG5 dica pura: flag desligada preserva o prompt antigo byte a byte em todas as fases', () => {
  for (const fase of ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] as const) {
    const t = threadDeExemplo('auto', fase), pedido = '  implementar\n';
    assert.equal(montarPrompt(t, fase, pedidoComDicaDoGrafo(pedido, t.id, false)), montarPrompt(t, fase, pedido));
    const ligado = montarPrompt(t, fase, pedidoComDicaDoGrafo(pedido, t.id, true));
    assert.match(ligado, /ork_grafo_contexto/); assert.match(ligado, /ork grafo indexar/);
    assert.ok(Buffer.byteLength(ligado) - Buffer.byteLength(montarPrompt(t, fase, pedido)) < 700);
  }
});

function fixture() {
  const p = projetoTemporario('kg5-contexto');
  for (const [arquivo, conteudo] of Object.entries(REPO)) commitar(p.dir, arquivo, conteudo, 'fixture contexto');
  const t = novaThread(p.carregado, { nome: 'contexto da thread', modo: 'auto', worktree: null }).thread;
  const cli = (...argv: string[]) => {
    let saida = '';
    const codigo = executarGrafo(argv, { raiz: p.dir, estado: p.dir, repositorio: p.carregado.manifesto.project.name,
      contextoDaThread: (id) => lerEntradaDaThread(p.dir, id), escrever: (s) => { saida = s; } });
    return { codigo, saida };
  };
  return { p, t, cli };
}

test('KG5 contexto integrado: coleta artefatos, claims ativas e diff modificado; CLI/worker/MCP identicos', async () => {
  const { p, t, cli } = fixture();
  let cliente: Client | undefined, servidor: ReturnType<typeof criarServidorMcp> | undefined;
  try {
    commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8') + '\ngrafo:\n  mcp: true\n', 'flag da fixture');
    escreverArtefatoMcp(p.dir, t.id, 'goal', 'Editar `src/alvo.ts`', null);
    escreverArtefatoMcp(p.dir, t.id, 'plan', 'touch_paths: [docs/guia.md]', null);
    adicionarClaim(p.dir, t.id, { arquivo: 'src/novo.ts', alegacao: 'caminho de entrada da fixture', verificar: ['true'] });
    const retirada = adicionarClaim(p.dir, t.id, { arquivo: 'src/retirado.ts', alegacao: 'fora da demanda', verificar: ['true'] });
    retirarClaim(p.dir, t.id, retirada.id, 'retirada na fixture');
    assert.equal(cli('indexar').codigo, 0);
    fs.appendFileSync(path.join(p.dir, 'src/app.ts'), '\n// modificado\n');
    const argv = argvDaTool('ork_grafo_contexto', { threadId: t.id });
    const esperado = cli(...argv); assert.equal(esperado.codigo, 0, esperado.saida);
    const r = JSON.parse(esperado.saida);
    assert.equal(r.indice.arvore, 'modificada');
    assert.ok(r.sementes.find((s: any) => s.arquivo === 'src/app.ts').origens.includes('diff'));
    assert.ok(r.sementes.find((s: any) => s.arquivo === 'src/alvo.ts').origens.includes('goal'));
    assert.ok(r.sementes.find((s: any) => s.arquivo === 'docs/guia.md').origens.includes('plan'));
    assert.equal(r.sementes.find((s: any) => s.arquivo === 'src/novo.ts').estado, 'fora-do-indice');
    assert.ok(!r.sementes.some((s: any) => s.arquivo === 'src/retirado.ts'));
    let worker = '';
    assert.equal(rodarConsulta({ raiz: p.dir, argv }, p.dir, (s) => { worker = s; }), 0);
    assert.equal(worker, esperado.saida);
    servidor = criarServidorMcp({ projeto: p.dir, host: 'claude-code' }); cliente = new Client({ name: 'kg5-contexto', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await servidor.connect(st); await cliente.connect(ct);
    const resposta = await cliente.callTool({ name: 'ork_grafo_contexto', arguments: { threadId: t.id } });
    assert.ok(!resposta.isError, JSON.stringify(resposta));
    assert.ok((resposta.content as { type: string; text: string }[])[0].text === esperado.saida, 'MCP deve devolver exatamente o JSON da CLI');
  } finally { await cliente?.close(); await servidor?.close(); p.limpar(); }
});

test('KG5 contexto integrado: indice ausente ou de outra revisao recusa com correcao, nunca entrega nos', () => {
  const { p, t, cli } = fixture();
  try {
    const argv = ['contexto', t.id, '--json'];
    const ausente = cli(...argv); assert.equal(ausente.codigo, 1);
    assert.equal(JSON.parse(ausente.saida).erro.estado_do_indice, 'nao-indexado');
    assert.equal(cli('indexar').codigo, 0);
    commitar(p.dir, 'src/alvo.ts', REPO['src/alvo.ts'] + '// nova revisao\n', 'mover HEAD');
    const velho = cli(...argv); assert.equal(velho.codigo, 1);
    const r = JSON.parse(velho.saida);
    assert.equal(r.schema, 'ork.thread-graph-context/v0');
    assert.equal(r.erro.estado_do_indice, 'outra-revisao'); assert.equal(r.erro.correcao, 'ork grafo indexar');
    assert.equal(r.nos, undefined);
    assert.throws(() => lerEntradaDaThread(p.dir, '../outra'), /thread-invalida/);
  } finally { p.limpar(); }
});

test('KG5 contexto puro: uso invalido recusa antes de ler estado ou indice', () => {
  let leu = false;
  for (const opcoes of [['--json', '--teto-bytes=4095'], ['--json', '--teto-bytes=65537'], ['--teto-bytes=4096'], ['--json', '--profundidade=2']]) {
    const run = () => executarGrafo(['contexto', 'demo-contexto', ...opcoes], {
      raiz: '.', estado: '.', contextoDaThread: () => { leu = true; throw Error('nao deveria ler'); }, escrever: () => undefined,
    });
    if (opcoes.includes('--json')) assert.equal(run(), 1); else assert.throws(run, /exige --json/);
    assert.equal(leu, false);
  }
});

test('KG5 dica integrada: despacho sem flag igual; ligado injeta dica antes do hash', () => {
  const { p, t } = fixture();
  try {
    const memoria = abrirMemoria(p.carregado);
    const antes = montarPromptComMemoria(p.carregado, t, 'GO', 'implementar', memoria);
    assert.equal(antes.prompt, montarPrompt(t, 'GO', 'implementar', p.dir, antes.injecao.texto));
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\ngrafo:\n  mcp: true\n');
    const ligado = montarPromptComMemoria(exigirManifesto(p.dir), t, 'GO', 'implementar', memoria);
    assert.match(ligado.prompt, /ork_grafo_contexto/);
    fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8').replace('mcp: true', 'mcp: false'));
    assert.equal(montarPromptComMemoria(exigirManifesto(p.dir), t, 'GO', 'implementar', memoria).prompt, antes.prompt);
  } finally { p.limpar(); }
});

test('KG5 contexto integrado: CLI na raiz usa HEAD da worktree; dica usa flag da raiz e recusa outra thread na WT', () => {
  const { p } = fixture();
  try {
    commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'manifesto da fixture');
    const t = novaThread(p.carregado, { nome: 'contexto isolado', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    const head = commitar(wt, 'src/alterado.ts', 'export const alterado = 1;\n', 'mudanca da thread');
    const ler = (raiz: string, ...argv: string[]) => {
      let saida = '';
      const codigo = executarGrafo(argv, { raiz, estado: p.dir, repositorio: p.carregado.manifesto.project.name,
        contextoDaThread: (id) => lerEntradaDaThread(raiz, id), escrever: (s) => { saida = s; } });
      return { codigo, saida };
    };
    assert.equal(ler(wt, 'indexar').codigo, 0);
    const principal = ler(p.dir, 'contexto', t.id, '--json'), local = ler(wt, 'contexto', t.id, '--json');
    assert.equal(principal.codigo, 0, principal.saida); assert.equal(principal.saida, local.saida);
    assert.equal(JSON.parse(principal.saida).indice.revision, head);
    assert.ok(JSON.parse(principal.saida).sementes.some((s: any) => s.arquivo === 'src/alterado.ts' && s.origens.includes('diff')));
    const outra = novaThread(p.carregado, { nome: 'outra demanda', modo: 'auto' }).thread;
    assert.throws(() => lerEntradaDaThread(wt, outra.id), /outra worktree/);
    fs.appendFileSync(path.join(wt, 'orkastery.yaml'), '\ngrafo:\n  mcp: true\n');
    const carregadoWt = exigirManifesto(wt), memoria = abrirMemoria(carregadoWt);
    assert.doesNotMatch(montarPromptComMemoria(carregadoWt, t, 'GO', 'implementar', memoria).prompt, /ork_grafo_contexto/);
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\ngrafo:\n  mcp: true\n');
    assert.match(montarPromptComMemoria(carregadoWt, t, 'GO', 'implementar', memoria).prompt, /ork_grafo_contexto/);
  } finally { p.limpar(); }
});
