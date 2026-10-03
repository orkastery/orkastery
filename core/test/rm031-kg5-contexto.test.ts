import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CONTEXTO_POR_ALVO, CONTEXTO_FORA_DO_INDICE, pacoteDeContexto, sementesDaThread, type EntradaDoContexto } from '../src/intelligence-graph-contexto';
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
  assert.equal(a, pacoteDeContexto({ ...GRAFO, edges: GRAFO.edges.map((a) => ({ ...a, evidence: [...a.evidence].reverse() })) },
    { ...INDICE, extratores: [...INDICE.extratores].reverse() }, entrada));
  assert.equal(a, pacoteDeContexto(GRAFO, INDICE, entrada));
});

test('KG5 contexto v2: agrega fan-in e preserva todos os spans com referencias locais', () => {
  const texto = pacoteDeContexto(GRAFO, INDICE, ENTRADA, 65536), r = JSON.parse(texto);
  assert.equal(r.schema, 'ork.thread-graph-context/v2');
  assert.equal(r.truncado, false);
  assert.doesNotMatch(texto, /(?:node|edge)-[a-f0-9]{64}/);
  assert.ok(Object.keys(r.nos).every((k) => /^n[1-9][0-9]*$/.test(k)));
  assert.ok(Object.values(r.nos).includes('file docs/guia.md'));
  assert.ok(!Object.values(r.nos).includes('file src/isolado.ts'));
  const calls = r.arestas.filter((a: any) => a.kind === 'calls');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].quantidade, 30);
  assert.equal(calls[0].evidencias.length, 30);
  assert.equal(r.nos[calls[0].from], 'file src/app.ts');
  assert.equal(r.nos[calls[0].to], 'symbol src/alvo.ts#alvo');
  assert.ok(r.arestas.some((a: any) => a.kind === 'imports'));
  assert.ok(r.arestas.some((a: any) => a.kind === 'references'));
  assert.ok(!r.arestas.some((a: any) => a.kind === 'declares' || a.kind === 'contains'));
  assert.equal(r.resumidas.estruturais, 1);
  for (const a of r.arestas) {
    assert.ok(r.nos[a.from] && r.nos[a.to]);
    const arquivo = r.nos[a.from].slice(5);
    const originais = GRAFO.edges.filter((e) => e.kind === a.kind
      && GRAFO.nodes.find((n) => n.node_id === e.from)!.locator.path === arquivo
      && r.nos[a.to] === (() => { const n = GRAFO.nodes.find((n) => n.node_id === e.to)!;
        return `${n.kind} ${n.locator.path}${n.locator.fragment === null ? '' : `#${n.locator.fragment}`}`; })());
    assert.equal(a.quantidade, originais.length);
    const tuplas = originais.flatMap((o) => o.evidence.map((e) => {
      assert.equal(e.span.type, 'text');
      if (e.span.type !== 'text') throw Error('fixture textual');
      return [r.indice.extratores.findIndex((x: any) => x.extractor_id === e.extractor_id && x.extractor_version === e.extractor_version),
        e.extraction_method, [e.span.line_start, e.span.line_end], [e.span.byte_start, e.span.byte_end]];
    }));
    assert.deepEqual(a.evidencias.map(JSON.stringify).sort(), [...new Set(tuplas.map((t) => JSON.stringify(t)))].sort());
    for (const [, , , [inicio, fim]] of a.evidencias) assert.ok(Buffer.from(REPO[arquivo]).subarray(inicio, fim).length > 0);
  }
  // Comparacao com a medida v0 registrada na fatia 2, mesma fixture de 30 chamadas.
  assert.ok(22973 / Buffer.byteLength(pacoteDeContexto(GRAFO, INDICE, ENTRADA)) >= 4, 'meta minima: quatro vezes menor');
});

test('KG5 contexto v2: teto preserva grupos inteiros, contagens e Unicode', () => {
  for (const teto of [4096, 8192, 16384, 32768, 65536]) {
    const texto = pacoteDeContexto(GRAFO, INDICE, { ...ENTRADA, diff: [...ENTRADA.diff, 'src/ação.ts'] }, teto), r = JSON.parse(texto);
    assert.ok(Buffer.byteLength(texto) <= teto);
    assert.equal(r.medida.pacote_bytes, Buffer.byteLength(texto));
    assert.equal(r.omitidos.ligacoes + r.arestas.length, r.total_ligacoes);
    assert.equal(r.omitidos.arestas + r.resumidas.estruturais + r.arestas.reduce((s: number, a: any) => s + a.quantidade, 0), r.total_arestas);
    assert.equal(r.teto.cortado, r.truncado);
    const calls = r.arestas.find((a: any) => a.kind === 'calls');
    if (calls) { assert.equal(calls.quantidade, 30); assert.equal(calls.evidencias.length, 30); }
  }
  const muitas = { ...ENTRADA, diff: ['src/alvo.ts', ...Array.from({ length: 1000 }, (_, i) => `aaa/arquivo-${i}.ts`)] };
  const r = JSON.parse(pacoteDeContexto(GRAFO, INDICE, muitas, 4096));
  assert.equal(r.sementes[0].arquivo, 'src/alvo.ts');
  assert.equal(r.sementes_fora_do_indice, 1000);
  assert.ok(r.sementes.filter((s: any) => s.estado === 'fora-do-indice').length <= CONTEXTO_FORA_DO_INDICE);
  assert.ok(r.arestas.some((a: any) => a.kind === 'imports'));
  assert.ok(r.arestas.some((a: any) => a.kind === 'references'));
  assert.equal(r.truncado, true);
  const grande = JSON.parse(pacoteDeContexto(GRAFO, INDICE, muitas, 65536));
  assert.deepEqual(grande.sementes.slice(1).map((s: any) => s.arquivo), ['aaa/arquivo-0.ts', 'aaa/arquivo-1.ts', 'aaa/arquivo-10.ts']);
  for (const n of [1, 4095, 65537, NaN, 4096.5]) assert.throws(() => pacoteDeContexto(GRAFO, INDICE, ENTRADA, n), /teto-invalido/);
});

test('KG5 sementes: prosa nao confunde versao, runtime ou dominio com arquivo', () => {
  const r = sementesDaThread({ ...ENTRADA, diff: [], goal: 'Usar v0.5.0 no Node.js e example.com ou api.example.org. Editar src/app.ts e README.md.', plan: null });
  assert.deepEqual(r.map((s) => s.arquivo), ['README.md', 'src/app.ts']);
});

test('KG5 sementes: barras de prosa nao ocupam amostra e diretorios do indice aceitam arquivos novos', () => {
  const entrada = { ...ENTRADA, diff: [], goal: 'e/ou CHECK/SHIP 03/10/2026 imports/references src/novo.ts src/sem-extensao nova/pasta/arquivo.ts',
    plan: '`e/ou` [fase](CHECK/SHIP) `03/10/2026` `imports/references` [novo](docs/novo.md)' };
  const r = JSON.parse(pacoteDeContexto(GRAFO, INDICE, entrada));
  assert.equal(r.sementes_fora_do_indice, 4);
  assert.deepEqual(r.sementes.map((s: any) => s.arquivo), ['docs/novo.md', 'nova/pasta/arquivo.ts', 'src/novo.ts']);
  const sementes = sementesDaThread(entrada, Object.keys(REPO));
  assert.deepEqual(sementes.map((s) => s.arquivo), ['docs/novo.md', 'nova/pasta/arquivo.ts', 'src/novo.ts', 'src/sem-extensao']);
  assert.deepEqual(sementesDaThread({ ...entrada, goal: 'desconhecido/sem-extensao src/sem-extensao', plan: null }), []);
  // Diff e claims sao caminhos explicitos, nao prosa: nao dependem da extensao ou do indice.
  assert.deepEqual(sementesDaThread({ ...ENTRADA, diff: ['nova/sem-extensao'], claims: [{ id: 'C1', arquivo: 'nova/outra' }] })
    .map((s) => s.arquivo), ['nova/outra', 'nova/sem-extensao']);
});

test('KG5 relevancia: entre arquivos antes de internas, diff antes de ordem alfabetica e teto por alvo', () => {
  const fontes = {
    'src/hub.ts': 'export function hub() { return 1; }\nexport function local() { return hub(); }\n',
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`src/a${i}.ts`, "import { hub } from './hub';\nexport function f() { return hub(); }\n"])),
    'src/z-diff.ts': "import { hub } from './hub';\nexport function perto() { return hub(); }\n",
  };
  const g = extrairGrafo({ tenant_id: 'local', repository_id: 'demo', revision: ENTRADA.base, revision_unavailable_reason: null,
    acl_refs: ['repo:demo:leitura'], fontes: Object.entries(fontes).map(([p, c]) => ({ path: p, bytes: Buffer.from(c) })) }, carregarAnalisadores()).grafo;
  const entrada = { ...ENTRADA, diff: ['src/z-diff.ts'], goal: '`src/hub.ts`' };
  const r = JSON.parse(pacoteDeContexto(g, { ...INDICE, extratores: g.snapshot.extractors }, entrada, 65536));
  const calls = r.arestas.filter((a: any) => a.kind === 'calls');
  assert.equal(r.arestas.filter((a: any) => a.to === calls[0].to).length, CONTEXTO_POR_ALVO);
  assert.equal(r.nos[calls[0].from], 'file src/z-diff.ts');
  assert.ok(calls.every((a: any) => r.nos[a.from] !== 'file src/hub.ts'));
  assert.ok(r.arestas.some((a: any) => a.kind === 'imports' && a.to === calls[0].to && r.nos[a.from] !== 'file src/z-diff.ts'));
  assert.equal(r.omitidos.ligacoes, 24); // 19 omitidos no alvo simbolo e 5 no alvo arquivo.
  assert.equal(r.truncado, true);
  assert.ok(r.arestas.some((a: any) => a.kind === 'imports'));
  const reduzido = JSON.parse(pacoteDeContexto(g, { ...INDICE, extratores: g.snapshot.extractors }, entrada, 4096));
  assert.equal(reduzido.nos[reduzido.arestas[0].from], 'file src/z-diff.ts');
  assert.ok(reduzido.omitidos.ligacoes >= r.omitidos.ligacoes);
});

test('KG5 contexto puro: ausentes declarados, pacote vazio valido e concessao nao revela ligacoes ocultas', () => {
  const r = JSON.parse(pacoteDeContexto(GRAFO, INDICE, { ...ENTRADA, diff: ['src/novo.ts'] }));
  assert.deepEqual(r.sementes, [{ arquivo: 'src/novo.ts', estado: 'fora-do-indice', origens: ['diff'] }]);
  assert.deepEqual(r.nos, {}); assert.deepEqual(r.arestas, []);
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

test('KG5 contexto integrado: coleta artefatos e claims ativas, ignora diff sem worktree; CLI/worker/MCP identicos', async () => {
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
    assert.equal(r.fontes.diff, 'ignorado-sem-worktree');
    assert.ok(!r.sementes.some((s: any) => s.origens.includes('diff')));
    assert.ok(!r.sementes.some((s: any) => s.arquivo === 'src/app.ts'));
    assert.ok(!r.sementes.some((s: any) => s.arquivo === 'orkastery.yaml'));
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
    assert.equal(r.schema, 'ork.thread-graph-context/v2');
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



test('KG5 contexto puro: estado sem worktree ignora diff mesmo se o chamador o fornecer', () => {
  const entrada = { ...ENTRADA, diffEstado: 'ignorado-sem-worktree' as const, goal: '`docs/guia.md`' };
  const a = pacoteDeContexto(GRAFO, INDICE, entrada);
  assert.equal(a, pacoteDeContexto(GRAFO, INDICE, { ...entrada, diff: ['src/isolado.ts'] }));
  const r = JSON.parse(a);
  assert.equal(r.fontes.diff, 'ignorado-sem-worktree');
  assert.ok(!r.sementes.some((s: any) => s.origens.includes('diff')));
});

test('KG5 contexto puro: nao atribui evidencia auxiliar a arquivo errado e preserva span PDF', () => {
  const a = GRAFO.edges.find((a) => a.kind === 'calls')!, e = a.evidence[0];
  const auxiliar = { ...a, evidence: [...a.evidence, { ...e, path: 'docs/guia.md' }] };
  const texto = pacoteDeContexto({ ...GRAFO, edges: [auxiliar] }, INDICE, ENTRADA);
  const comAuxiliar = JSON.parse(texto);
  const semAuxiliar = JSON.parse(pacoteDeContexto({ ...GRAFO, edges: [a] }, INDICE, ENTRADA));
  assert.deepEqual(comAuxiliar.arestas, semAuxiliar.arestas);
  assert.equal(comAuxiliar.omitidos.evidencias_auxiliares, 1);
  assert.equal(comAuxiliar.omitidos.arestas, 0);
  assert.equal(comAuxiliar.truncado, true);
  assert.ok(!Object.values(comAuxiliar.nos).includes('file docs/guia.md'));
  assert.equal(texto, pacoteDeContexto({ ...GRAFO, edges: [{ ...auxiliar, evidence: [...auxiliar.evidence].reverse() }] }, INDICE, ENTRADA));
  const soAuxiliar = JSON.parse(pacoteDeContexto({ ...GRAFO, edges: [{ ...a, evidence: [{ ...e, path: 'docs/guia.md' }] }] }, INDICE, ENTRADA));
  assert.deepEqual(soAuxiliar.arestas, []);
  assert.equal(soAuxiliar.omitidos.evidencias_auxiliares, 1);
  assert.equal(soAuxiliar.omitidos.arestas, 1);
  assert.equal(soAuxiliar.total_arestas, 1);
  const pdf = { ...a, evidence: [{ ...e, span: { type: 'pdf-text' as const, page: 2, byte_start: 3, byte_end: 9, extracted_text_hash: 'd'.repeat(64) } }] };
  const r = JSON.parse(pacoteDeContexto({ ...GRAFO, edges: [pdf] }, INDICE, ENTRADA));
  assert.deepEqual(r.arestas[0].evidencias[0].slice(2), [['pdf', 2, 'd'.repeat(64)], [3, 9]]);
});


test('KG5 contexto v2: grupo maior que o teto nao expulsa imports e references menores', () => {
  const fontes = { ...REPO, 'src/app.ts': "import { alvo } from './alvo';\n" + Array.from({ length: 300 }, (_, i) => `export function f${i}() { return alvo(); }\n`).join('') };
  const g = extrairGrafo({ tenant_id: 'local', repository_id: 'demo', revision: ENTRADA.base, revision_unavailable_reason: null,
    acl_refs: ['repo:demo:leitura'], fontes: Object.entries(fontes).map(([p, c]) => ({ path: p, bytes: Buffer.from(c) })) }, carregarAnalisadores()).grafo;
  const i = { ...INDICE, extratores: g.snapshot.extractors };
  const completo = JSON.parse(pacoteDeContexto(g, i, ENTRADA, 65536));
  assert.equal(completo.arestas.find((a: any) => a.kind === 'calls').quantidade, 300);
  const texto = pacoteDeContexto(g, i, ENTRADA, 4096), r = JSON.parse(texto);
  assert.ok(Buffer.byteLength(texto) <= 4096);
  assert.ok(!r.arestas.some((a: any) => a.kind === 'calls'));
  assert.ok(r.arestas.some((a: any) => a.kind === 'imports'));
  assert.ok(r.arestas.some((a: any) => a.kind === 'references'));
  assert.equal(r.omitidos.arestas, 300);
});

function provarSegundoSalto(pacote = pacoteDeContexto): void {
  const repo = {
    'src/semente.ts': "import './ponte';\nexport function local() { return 1; }\nexport function usa() { return local(); }",
    'src/ponte.ts': "import './segundo';",
    'src/segundo.ts': "import './terceiro';",
    'src/terceiro.ts': 'export const terceiro = 1;',
    'src/inverso.ts': "import './ponte';",
    ...Object.fromEntries(Array.from({ length: 16 }, (_, n) => [`src/outro-${n}.ts`, "import './ponte';"])),
  };
  const g = extrairGrafo({ tenant_id: 'local', repository_id: 'demo', revision: ENTRADA.base, revision_unavailable_reason: null,
    acl_refs: ['repo:demo:leitura'], fontes: Object.entries(repo).map(([p, c]) => ({ path: p, bytes: Buffer.from(c) })) }, carregarAnalisadores()).grafo;
  const i = { ...INDICE, extratores: g.snapshot.extractors };
  // GOAL sem diff tambem deve abrir o segundo salto; ele nao depende da distancia ao diff.
  const e = { ...ENTRADA, diff: [], goal: '`src/semente.ts`', claims: [{ id: 'C1', arquivo: 'src/ausente.ts' }] };
  const completo = JSON.parse(pacote(g, i, e, 65536));
  assert.equal(completo.schema, 'ork.thread-graph-context/v2');
  assert.equal(completo.consulta.profundidade, 2);
  const caminhos = completo.medida.arquivos.map((f: any) => f.path);
  assert.ok(caminhos.includes('src/segundo.ts'));
  assert.ok(caminhos.includes('src/inverso.ts'));
  assert.ok(!caminhos.includes('src/terceiro.ts'));
  const segundo = completo.arestas.find((a: any) => completo.nos[a.to] === 'file src/segundo.ts');
  assert.equal(segundo.salto, 2);
  for (const teto of [4096, 5000, 8192, 32768, 65536]) {
    const texto = pacote(g, i, e, teto), r = JSON.parse(texto);
    assert.ok(Buffer.byteLength(texto) <= teto);
    assert.equal(r.medida.pacote_bytes, Buffer.byteLength(texto));
    const internas = r.arestas.findIndex((a: any) => a.kind === 'calls');
    const inicioDoSegundo = r.arestas.findIndex((a: any) => a.salto === 2);
    assert.ok(internas >= 0, 'ligacao direta interna tem prioridade sobre qualquer segundo salto');
    if (inicioDoSegundo >= 0) {
      assert.ok(internas < inicioDoSegundo);
      assert.ok(r.arestas.slice(inicioDoSegundo).every((a: any) => a.salto === 2));
    }
    for (const alvo of new Set(r.arestas.map((a: any) => a.to)))
      assert.ok(r.arestas.filter((a: any) => a.to === alvo).length <= CONTEXTO_POR_ALVO);
    assert.equal(r.total_arestas, r.omitidos.arestas + r.resumidas.estruturais + r.arestas.reduce((s: number, a: any) => s + a.quantidade, 0));
    assert.equal(texto, pacote({ ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() },
      { ...i, extratores: [...i.extratores].reverse() }, e, teto));
  }
  // Uma ponte sem evidencia na origem nao pode sustentar a expansao.
  const porId = new Map(g.nodes.map((n) => [n.node_id, n.locator.path]));
  const semPonte = { ...g, edges: g.edges.map((a) => porId.get(a.from) === 'src/semente.ts' && porId.get(a.to) === 'src/ponte.ts'
    ? { ...a, evidence: a.evidence.map((ev) => ({ ...ev, path: 'src/terceiro.ts' })) } : a) };
  assert.ok(!JSON.parse(pacote(semPonte, i, e)).arestas.some((a: any) => a.salto === 2));
  // Se a ponte nao couber, nao basta que exista no indice para incluir o segundo salto.
  const ponteGrande = { ...g, edges: g.edges.map((a) => porId.get(a.from) === 'src/semente.ts' && porId.get(a.to) === 'src/ponte.ts'
    ? { ...a, evidence: Array.from({ length: 500 }, (_, n) => ({ ...a.evidence[0], span: {
      type: 'text' as const, line_start: n + 1, line_end: n + 1, byte_start: n * 10, byte_end: n * 10 + 5,
    } })) } : a) };
  assert.ok(!JSON.parse(pacote(ponteGrande, i, e, 4096)).arestas.some((a: any) => a.salto === 2));
}

test('KG5 segundo salto: sobra, prioridade direta, marca, sentidos, limite, ponte selecionada e determinismo', () => {
  provarSegundoSalto();
});

test('KG5 segundo salto: prova cai sem expansao, marca, teto ou prioridade direta', () => {
  const Module = require('node:module');
  const arquivo = path.resolve(__dirname, '../src/intelligence-graph-contexto.js');
  const original = fs.readFileSync(arquivo, 'utf8');
  for (const [antes, depois] of [
    ["a.salto === 2 && (pontes.has", "false && (pontes.has"],
    ["{ salto: 2 }", "{ salto: 1 }"],
    ["if (a.salto === 1)", "if (a.salto === 2)"],
    ["Buffer.byteLength(texto) <= tetoBytes", "true"],
    ["(porAlvo.get(a.alvo) ?? 0) >= exports.CONTEXTO_POR_ALVO", "false"],
    ["(pontes.has(a.origem.slice(5)) || pontes.has(porId.get(a.alvo).locator.path))", "true"],
  ]) {
    assert.ok(original.includes(antes), `ponto de mutacao: ${antes}`);
    const modulo = new Module(arquivo);
    modulo.filename = arquivo; modulo.paths = Module._nodeModulePaths(path.dirname(arquivo));
    modulo._compile(original.replaceAll(antes, depois), arquivo);
    assert.throws(() => provarSegundoSalto(modulo.exports.pacoteDeContexto), antes);
  }
});

function provarTermosContexto({ nomesExportadosContexto, descobertaContexto }: any): void {
  const texto = `
    const privadoLongo = 1; let localLongo = 2;
    // export function falsoComentario() {}
    const literal = "export const falsoLiteral = 1";
    export const a = 1, id = 2, abc = 3, nome = 4;
    export function publico() { const internoLongo = 0; return internoLongo; }
    export class ClassePublica {}
    export interface ContratoPublico {}
    export type TipoPublico = string;
    export enum EnumPublico { valor }
    const interno = 1; export { interno as externo };
    export { remoto as aliasPublico } from './dep';
    export * as espacoPublico from './dep';
    export * from './dep';
    export default function nomeDoDefault() {}
    export const { origem: desestruturado, outro } = objeto;
  `;
  const esperados = ['ClassePublica', 'ContratoPublico', 'EnumPublico', 'TipoPublico', 'aliasPublico',
    'desestruturado', 'espacoPublico', 'externo', 'nome', 'outro', 'publico'].sort();
  assert.deepEqual(nomesExportadosContexto(texto, 'src/base.ts'), esperados);
  const fontes = [{ path: 'src/base.ts', bytes: Buffer.from(texto) },
    { path: 'src/dep.ts', bytes: Buffer.from('export const soNaDependencia = 1;') },
    { path: 'src/match.ts', bytes: Buffer.from('publico();') }];
  const stdout = Buffer.from('base:src/match.ts:1:publico();\n');
  let chamadas = 0;
  const r = descobertaContexto('base', fontes, ['src/base.ts'], (cmd: string, argv: string[]) => {
    chamadas++;
    assert.equal(cmd, 'git');
    assert.deepEqual(argv, ['-c', 'core.fsmonitor=false', 'grep', '-n', '-I', '-F', '-w',
      ...esperados.flatMap((t) => ['-e', t]), 'base', '--']);
    return { status: 0, stdout };
  });
  assert.equal(chamadas, 1);
  assert.deepEqual(r.termos, esperados);
  assert.deepEqual(r.arquivos, ['src/base.ts', 'src/dep.ts', 'src/match.ts']);
  assert.equal(r.bytes_ao_agente, stdout.length + fontes.reduce((n, f) => n + f.bytes.length, 0));
  const vazio = descobertaContexto('base', [{ path: 'src/base.ts', bytes: Buffer.from('const privadoLongo = 1;') }],
    ['src/base.ts'], () => { throw Error('nao deve executar grep sem exports'); });
  assert.equal(vazio.argv, null);
  assert.deepEqual(vazio.termos, []);
  assert.deepEqual(vazio.arquivos, ['src/base.ts']);
}

test('KG5 medida historica: exports com quatro caracteres e grep por palavra inteira', () => {
  provarTermosContexto(require('../../scripts/medir-mcp-grafo.cjs'));
});

test('KG5 medida historica: a prova dos termos cai nas mutacoes de tamanho, exports e -w', () => {
  const Module = require('node:module');
  const arquivo = path.resolve(__dirname, '../../scripts/medir-mcp-grafo.cjs');
  const original = fs.readFileSync(arquivo, 'utf8');
  const mutacoes = [
    ['tamanho', '[...nome.text].length >= 4', '[...nome.text].length >= 1'],
    ['exports', '!no.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)', 'false'],
    ['palavra inteira', "['grep', '-n', '-I', '-F', '-w',", "['grep', '-n', '-I', '-F',"],
  ];
  for (const [nome, antes, depois] of mutacoes) {
    assert.ok(original.includes(antes), `ponto da mutacao ${nome}`);
    const modulo = new Module(arquivo);
    modulo.filename = arquivo;
    modulo.paths = Module._nodeModulePaths(path.dirname(arquivo));
    // Modulo isolado em memoria: nenhum arquivo ou cache da implementacao e alterado.
    modulo._compile(original.replace(antes, depois), arquivo);
    assert.throws(() => provarTermosContexto(modulo.exports), assert.AssertionError, nome);
  }
});

test('KG5 medida historica: cobertura do alcancavel, novos separados e precisao nos dois bracos', () => {
  const { separarEditadosContexto, coberturaContexto } = require('../../scripts/medir-mcp-grafo.cjs');
  const resultado = separarEditadosContexto(['src/base.ts', 'src/vizinho.ts', 'src/novo.ts', 'src/perdido.ts'],
    ['src/base.ts', 'src/vizinho.ts', 'src/perdido.ts', 'docs/guia.md', 'src/ruido.ts']);
  assert.deepEqual(resultado, { editados_na_base: ['src/base.ts', 'src/perdido.ts', 'src/vizinho.ts'], arquivos_novos: ['src/novo.ts'] });
  const pacote = coberturaContexto(resultado.editados_na_base, ['src/base.ts', 'src/vizinho.ts'], ['src/base.ts']);
  const descoberta = coberturaContexto(resultado.editados_na_base,
    ['src/base.ts', 'src/vizinho.ts', 'docs/guia.md', 'src/ruido.ts'], ['src/base.ts']);
  assert.equal(pacote.total_editados, 3);
  assert.equal(pacote.total_acertos, 2);
  assert.equal(pacote.cobertura, 2 / 3);
  assert.equal(descoberta.cobertura, 2 / 3);
  assert.equal(pacote.precisao, 1);
  assert.equal(descoberta.precisao, 1 / 2);
  assert.deepEqual(pacote.fora_das_sementes, { total_editados: 2, acertos: ['src/vizinho.ts'] });
  assert.equal(coberturaContexto([], ['src/base.ts'], []).cobertura, null);
  assert.equal(coberturaContexto(['src/base.ts'], [], []).precisao, null);
});

function registroHistoricoSintetico(): any {
  const { coberturaContexto, CONTEXTO_CASOS, CONTEXTO_MEDIDA_SCHEMA } = require('../../scripts/medir-mcp-grafo.cjs');
  return { schema: CONTEXTO_MEDIDA_SCHEMA, estado: 'measured', casos: CONTEXTO_CASOS.map((c: any) => {
    const base = 'a'.repeat(40), arquivos = c.sementes;
    return { ...c, base, merge: 'b'.repeat(40), entrada: { diff: [] },
      resultado: { editados_na_base: arquivos, arquivos_novos: ['src/novo.ts'] },
      pacote: { bytes_ao_agente: 100, sha256: 'c'.repeat(64), arquivos },
      descoberta: { bytes_grep: 10, bytes_arquivos: 100, bytes_ao_agente: 110, arquivos,
        termos: ['exportado'], argv: ['git', 'grep', '-n', '-I', '-F', '-w', '-e', 'exportado', base, '--'] },
      cobertura_pacote: coberturaContexto(arquivos, arquivos, c.sementes),
      cobertura_descoberta: coberturaContexto(arquivos, arquivos, c.sementes), tokens: { source: 'unavailable', value: null } };
  }) };
}

test('KG5 medida historica: conferir detecta hash e metricas alterados e valida ambos os bracos', () => {
  const { validarContexto, conferirContexto } = require('../../scripts/medir-mcp-grafo.cjs');
  const registro = registroHistoricoSintetico();
  assert.deepEqual(validarContexto(registro), []);
  assert.deepEqual(conferirContexto(registro, structuredClone(registro)), []);
  const hashAlterado = structuredClone(registro);
  hashAlterado.casos[0].pacote.sha256 = 'd'.repeat(64);
  assert.ok(conferirContexto(registro, hashAlterado).some((e: string) => e.includes('sha256')));
  const bytesAlterados = structuredClone(registro);
  bytesAlterados.casos[0].pacote.bytes_ao_agente++;
  assert.ok(conferirContexto(registro, bytesAlterados).includes('registro historico difere da fixture'));
  for (const braco of ['cobertura_pacote', 'cobertura_descoberta']) {
    for (const campo of ['cobertura', 'precisao', 'total_editados']) {
      const errado = structuredClone(registro);
      errado.casos[0][braco][campo]++;
      assert.ok(validarContexto(errado).includes(braco));
    }
  }
  const novoAlcancavel = structuredClone(registro);
  novoAlcancavel.casos[0].resultado.arquivos_novos.push(registro.casos[0].sementes[0]);
  assert.ok(validarContexto(novoAlcancavel).includes('resultado'));
  const semPalavra = structuredClone(registro);
  semPalavra.casos[0].descoberta.argv = semPalavra.casos[0].descoberta.argv.filter((a: string) => a !== '-w');
  assert.ok(validarContexto(semPalavra).includes('termos descoberta'));
});

test('KG5 medida historica: fixture anterior e identificada como metodo obsoleto, nunca recibo novo', () => {
  const { validarContexto, conferirContexto, CONTEXTO_MEDIDA_SCHEMA } = require('../../scripts/medir-mcp-grafo.cjs');
  const registro = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/kg5-medida-contexto.json'), 'utf8'));
  assert.equal(registro.estado, 'measured');
  if (registro.schema === 'ork.graph-context-cost/v2') {
    assert.deepEqual(validarContexto(registro), ['metodo historico desatualizado: regravar fixture']);
    assert.deepEqual(conferirContexto(registroHistoricoSintetico(), registro), ['metodo historico desatualizado: regravar fixture']);
  } else {
    assert.equal(registro.schema, CONTEXTO_MEDIDA_SCHEMA);
    assert.deepEqual(validarContexto(registro), []);
  }
  assert.deepEqual(validarContexto({ schema: CONTEXTO_MEDIDA_SCHEMA, estado: 'not-run', casos: [] }), ['medicao historica nao executada']);
});
