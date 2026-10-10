/**
 * RM-031 KG5 fatia 5: a proveniencia de cada aresta conferida contra a arvore da thread.
 *
 * Grupo `KG5 proveniencia`: a consulta pura traz `fontes` (o sha256 e o blob de cada caminho citado) e a
 * situacao de cada aresta, com o padrao "tudo igual" (D2 a D4); o CLI so le a arvore modificada, pelos
 * bytes, e marca o que mudou, sumiu ou virou link, pasta ou FIFO, sem travar nem sair da raiz (D3, D6); o
 * texto marca a aresta (D9); o teto e a igualdade entre o worker e a CLI valem com os campos novos (D10). No
 * pacote de contexto v2, so o grupo de fonte mudada ganha `arvore: "modificada"`, e a arvore limpa deixa os
 * bytes de antes (D5); CLI, worker e MCP entregam a mesma marca.
 */
import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { compararUtf8, derivarIds, validarGrafo, type GrafoCodigo } from '../src/intelligence-graph-contract';
import { pacoteDeContexto, type EntradaDoContexto } from '../src/intelligence-graph-contexto';
import { extrairGrafo } from '../src/intelligence-graph-extract';
import { carregarAnalisadores } from '../src/intelligence-graph-parsers';
import {
  caminho, chamadores, importadores, jsonDaResposta, prepararConsulta, rotuloDoNo, textoDaResposta, vizinhos,
  type CabecalhoDoIndice, type Concessao, type GrafoConsultavel, type RespostaDeConsulta, type SituacaoNaArvore,
} from '../src/intelligence-graph-query';
import { executarGrafo, situacaoNaArvore } from '../src/intelligence-graph-cli';
import { exigirManifesto } from '../src/manifest';
import { raizDoEstado } from '../src/estado-thread';
import { argvDaTool, consultarPeloWorker, lerEntradaDaThread } from '../src/mcp-grafo';
import { rodarConsulta } from '../src/mcp-grafo-worker';
import { criarServidorMcp } from '../src/mcp-server';
import { escreverArtefatoMcp } from '../src/mcp-artifacts';
import { novaThread } from '../src/thread';
import { commitar, dirTemporario, projetoTemporario } from './apoio';

const UTIL = 'export function soma(a: number, b: number): number { return a + b; }\nexport function dobro(x: number): number { return soma(x, x); }\n';
const APP = "import { dobro } from './util';\nexport function principal(): number { return dobro(2); }\n";
const GUIA = '# Guia\n\nVeja [app](../src/app.ts).\n';
const PURO: Record<string, string> = { 'src/util.ts': UTIL, 'src/app.ts': APP, 'docs/guia.md': GUIA };
const CONCESSAO: Concessao = { tenant_id: 'local', acl_refs: ['repo:demo:leitura'] };
const CHAMADA = 'calls symbol src/app.ts#principal -> symbol src/util.ts#dobro';
const IMPORT_DO_SIMBOLO = 'imports file src/app.ts -> symbol src/util.ts#dobro';

let GRAFO: GrafoCodigo;
let G: GrafoConsultavel;
before(() => {
  GRAFO = extrairGrafo({
    tenant_id: 'local', repository_id: 'demo', revision: null, revision_unavailable_reason: 'repositorio-sintetico', acl_refs: ['repo:demo:leitura'],
    fontes: Object.entries(PURO).map(([p, c]) => ({ path: p, bytes: Buffer.from(c, 'utf8') })),
  }, carregarAnalisadores()).grafo;
  G = prepararConsulta(GRAFO, CONCESSAO);
});

const cabecalho = (arvore: CabecalhoDoIndice['arvore'] = 'limpa', g: GrafoCodigo = GRAFO): CabecalhoDoIndice => ({
  repository_id: 'demo', revision: 'a'.repeat(40), chave: `idx-${'b'.repeat(64)}`, snapshot_id: g.snapshot.snapshot_id,
  graph_digest: 'c'.repeat(64), arvore, extratores: g.snapshot.extractors,
});
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const blob = (b: Buffer | string): string => {
  const bytes = Buffer.from(b);
  return createHash('sha1').update(`blob ${bytes.length}\u0000`).update(bytes).digest('hex');
};
const marcando = (...caminhos: string[]): SituacaoNaArvore => (p) => (caminhos.includes(p) ? 'modificada' : 'igual');
const porPar = (r: { arestas: { kind: string; from: string; to: string; arvore: string }[] }): Record<string, string> =>
  Object.fromEntries(r.arestas.map((a) => [`${a.kind} ${a.from} -> ${a.to}`, a.arvore]));
const situacoes = (r: { fontes: { path: string; arvore: string }[] }): Record<string, string> => Object.fromEntries(r.fontes.map((f) => [f.path, f.arvore]));

/** Os caminhos que a resposta cita: os dos nos e os das evidencias devolvidas, em ordem UTF-8 (D2, D10). */
function citados(r: RespostaDeConsulta): string[] {
  const s = new Set(r.nos.map((n) => n.path));
  for (const a of r.arestas) for (const e of a.evidencias) s.add(e.path);
  return [...s].sort(compararUtf8);
}

test('KG5 proveniencia: sem a situacao, toda aresta e fonte vale igual, e fontes traz o sha256 e o blob de cada caminho citado', () => {
  const respostas = [vizinhos(G, cabecalho(), 'src/util.ts#dobro'), chamadores(G, cabecalho(), 'dobro'), importadores(G, cabecalho(), 'src/util.ts'),
    caminho(G, cabecalho(), 'docs/guia.md', 'dobro')];
  for (const r of respostas) {
    assert.ok(r.arestas.length > 0, r.consulta.tipo);
    assert.ok(r.arestas.every((a) => a.arvore === 'igual'), r.consulta.tipo);
    assert.deepEqual(r.fontes.map((f) => f.path), citados(r), 'um caminho por entrada, dos nos e das evidencias, em ordem UTF-8');
    for (const f of r.fontes) assert.deepEqual(f, { path: f.path, source_hash: sha256(PURO[f.path]), source_version: blob(PURO[f.path]), arvore: 'igual' });
    assert.deepEqual(Object.keys(r.arestas[0]), ['kind', 'from', 'to', 'edge_id', 'distancia', 'arvore', 'evidencias']);
    assert.deepEqual(Object.keys(r).slice(-2), ['fontes', 'parcial']);
  }
  // O caminho repete as arestas dos passos com a mesma marca, e a sem caminho traz as fontes das duas pontas.
  const passos = respostas[3];
  assert.deepEqual(passos.caminho?.map((p) => p.aresta), passos.arestas);
  const semCaminho = caminho(G, cabecalho(), 'src/util.ts', 'docs/guia.md');
  assert.equal(semCaminho.caminho, null);
  assert.deepEqual(semCaminho.fontes.map((f) => f.path), ['docs/guia.md', 'src/util.ts']);
});

test('KG5 proveniencia: a aresta fica modificada pela origem, pelo alvo ou por uma evidencia que mudou, e so ela (D4)', () => {
  const pelaOrigem = vizinhos(G, cabecalho('modificada'), 'src/util.ts#dobro', {}, marcando('src/app.ts'));
  assert.deepEqual(porPar(pelaOrigem), {
    [CHAMADA]: 'modificada', [IMPORT_DO_SIMBOLO]: 'modificada',
    'calls symbol src/util.ts#dobro -> symbol src/util.ts#soma': 'igual', 'declares file src/util.ts -> symbol src/util.ts#dobro': 'igual',
  });
  assert.deepEqual(situacoes(pelaOrigem), { 'src/app.ts': 'modificada', 'src/util.ts': 'igual' });
  // So o arquivo do alvo mudou: a chamada parte de app.ts, que confere, e ainda assim fica marcada.
  assert.deepEqual(porPar(chamadores(G, cabecalho('modificada'), 'dobro', {}, marcando('src/util.ts'))), { [CHAMADA]: 'modificada' });
  assert.deepEqual(porPar(chamadores(G, cabecalho('modificada'), 'dobro', {}, marcando('docs/guia.md'))), { [CHAMADA]: 'igual' });
  // Evidencia auxiliar em outro arquivo (o contrato aceita): a mudanca dela marca a aresta com as duas pontas em util.ts.
  const g2 = structuredClone(GRAFO);
  const rotulos = new Map(g2.nodes.map((n) => [n.node_id, rotuloDoNo(n)]));
  const interna = g2.edges.find((a) => a.kind === 'calls' && rotulos.get(a.from) === 'symbol src/util.ts#dobro');
  const guia = g2.snapshot.source_manifest.find((m) => m.path === 'docs/guia.md');
  assert.ok(interna && guia);
  interna.evidence.push({ ...interna.evidence[0], path: 'docs/guia.md', source_hash: guia.source_hash, source_version: guia.source_version,
    span: { type: 'text', byte_start: 0, byte_end: 7, line_start: 1, line_end: 1 } });
  const outro = validarGrafo(derivarIds(g2));
  const auxiliar = vizinhos(prepararConsulta(outro, CONCESSAO), cabecalho('modificada', outro), 'src/util.ts#soma', {}, marcando('docs/guia.md'));
  assert.equal(porPar(auxiliar)['calls symbol src/util.ts#dobro -> symbol src/util.ts#soma'], 'modificada');
  assert.equal(situacoes(auxiliar)['docs/guia.md'], 'modificada', 'o caminho da evidencia auxiliar entra nas fontes');
  // A situacao e pedida so para os caminhos citados, e a resposta e a mesma repetida.
  const pedidos: string[] = [];
  const contando: SituacaoNaArvore = (p) => { pedidos.push(p); return 'igual'; };
  const limitada = vizinhos(G, cabecalho(), 'src/app.ts', { profundidade: 2, limite: 1 }, contando);
  assert.ok(pedidos.every((p) => citados(limitada).includes(p)), `${pedidos}`);
  assert.equal(jsonDaResposta(vizinhos(G, cabecalho('modificada'), 'src/util.ts#dobro', {}, marcando('src/app.ts'))), jsonDaResposta(pelaOrigem));
});

test('KG5 proveniencia: o texto marca a aresta de fonte mudada e lista as fontes que mudaram, e sem mudanca fica como antes (D9)', () => {
  const marcado = textoDaResposta(vizinhos(G, cabecalho('modificada'), 'src/util.ts#dobro', {}, marcando('src/app.ts')));
  assert.match(marcado, /^  calls  symbol src\/app\.ts#principal -> symbol src\/util\.ts#dobro  \[fonte modificada na arvore\]$/m);
  assert.match(marcado, /^  calls  symbol src\/util\.ts#dobro -> symbol src\/util\.ts#soma$/m);
  assert.match(marcado, /^fontes que mudaram na arvore: src\/app\.ts \(modificada\)$/m);
  const limpo = textoDaResposta(vizinhos(G, cabecalho(), 'src/util.ts#dobro'));
  assert.ok(!limpo.includes('fonte') && !limpo.includes('[fonte'), limpo);
  const varias: SituacaoNaArvore = (p) => (p === 'src/util.ts' ? 'ausente' : 'modificada');
  assert.match(textoDaResposta(vizinhos(G, cabecalho('modificada'), 'src/app.ts', { profundidade: 2 }, varias)),
    /^fontes que mudaram na arvore: docs\/guia\.md \(modificada\), src\/app\.ts \(modificada\), src\/util\.ts \(ausente\)$/m);
});

const MANIFESTO_MINIMO = 'project:\n  name: "demo"\n  abbrev: "dem"\n';
const REPO: Record<string, string> = { '.gitignore': '.orkastery/\n', 'orkastery.yaml': MANIFESTO_MINIMO, ...PURO };

/** Repositorio Git temporario com os arquivos commitados; `.orkastery/` fora do git, como no projeto. */
function repositorio(arquivos: Record<string, string>, nome: string): { dir: string; git: (...args: string[]) => string; limpar: () => void } {
  const dir = dirTemporario(nome);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString('utf8');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'teste@orkastery.local');
  git('config', 'user.name', 'Teste Orkastery');
  git('config', 'commit.gpgsign', 'false');
  for (const [p, c] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  }
  git('add', '--', ...Object.keys(arquivos));
  git('commit', '-q', '-m', 'inicial');
  return { dir, git, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** `ork grafo` pelo modulo, na raiz pedida e com o repositorio do manifesto dela, como a CLI e o worker. */
function grafo(dir: string, ...argv: string[]): { codigo: number | null; saida: string; erro: string | null } {
  const partes: string[] = [];
  try {
    const repositorio = exigirManifesto(dir).manifesto.project.name;
    const codigo = executarGrafo(argv, { raiz: dir, estado: raizDoEstado(dir), repositorio, escrever: (t) => partes.push(t) });
    return { codigo, saida: partes.join('\n'), erro: null };
  } catch (e) {
    return { codigo: null, saida: partes.join('\n'), erro: (e as Error).message };
  }
}

function consulta(dir: string, ...argv: string[]): RespostaDeConsulta & { teto?: unknown } {
  const r = grafo(dir, ...argv, '--json');
  assert.equal(r.codigo, 0, r.erro ?? r.saida);
  return JSON.parse(r.saida);
}

test('KG5 proveniencia: na CLI, arvore limpa da tudo igual, e fontes bate com o sha256 e o blob do HEAD', () => {
  const r = repositorio(REPO, 'kg5f5-limpa');
  try {
    assert.equal(grafo(r.dir, 'indexar').codigo, 0);
    const c = consulta(r.dir, 'vizinhos', 'src/app.ts', '--profundidade', '2');
    assert.equal(c.indice.arvore, 'limpa');
    assert.ok(c.arestas.length >= 5 && c.arestas.every((a) => a.arvore === 'igual'));
    assert.deepEqual(c.fontes.map((f) => f.path), ['docs/guia.md', 'src/app.ts', 'src/util.ts']);
    for (const f of c.fontes) {
      assert.equal(f.arvore, 'igual');
      assert.equal(f.source_hash, sha256(execFileSync('git', ['show', `HEAD:${f.path}`], { cwd: r.dir })));
      assert.equal(f.source_version, r.git('rev-parse', `HEAD:${f.path}`).trim());
    }
    // Limite aceito no D3: com o git status limpo nada e lido, entao a mudanca que o skip-worktree esconde vale igual,
    // como no indice.arvore. Se a arvore limpa passasse a ser lida, este caso viraria modificada.
    r.git('update-index', '--skip-worktree', '--', 'src/app.ts');
    fs.writeFileSync(path.join(r.dir, 'src/app.ts'), APP.replace('dobro(2)', 'dobro(5)'));
    const escondida = consulta(r.dir, 'chamadores', 'dobro');
    assert.equal(escondida.indice.arvore, 'limpa');
    assert.deepEqual(situacoes(escondida), { 'src/app.ts': 'igual', 'src/util.ts': 'igual' });
  } finally {
    r.limpar();
  }
});

test('KG5 proveniencia: na CLI, editar, apagar ou trocar a fonte por link, pasta ou FIFO marca so o que mudou (D3, D6)', () => {
  const r = repositorio(REPO, 'kg5f5-sujo');
  const fora = dirTemporario('kg5f5-fora');
  try {
    assert.equal(grafo(r.dir, 'indexar').codigo, 0);
    const app = path.join(r.dir, 'src/app.ts'), util = path.join(r.dir, 'src/util.ts');
    const restaurar = (): void => {
      fs.rmSync(path.join(r.dir, 'src'), { recursive: true, force: true });
      r.git('checkout', '-q', '--', '.');
      assert.equal(r.git('status', '--porcelain=v1', '--untracked-files=no'), '');
    };
    const cenario = (nome: string, mexer: () => void, esperado: { app: string; util: string; chamada: string }): void => {
      mexer();
      const c = consulta(r.dir, 'chamadores', 'dobro');
      assert.equal(c.indice.arvore, 'modificada', nome);
      assert.deepEqual(situacoes(c), { 'src/app.ts': esperado.app, 'src/util.ts': esperado.util }, nome);
      assert.deepEqual(porPar(c), { [CHAMADA]: esperado.chamada }, nome);
      restaurar();
    };
    // Mesmo tamanho, outro conteudo: so o sha256 decide.
    cenario('mesmo tamanho', () => fs.writeFileSync(app, APP.replace('dobro(2)', 'dobro(3)')), { app: 'modificada', util: 'igual', chamada: 'modificada' });
    // Outro tamanho, no arquivo do alvo: a chamada que parte de app.ts fica marcada (D4).
    cenario('outro tamanho no alvo', () => fs.appendFileSync(util, '// depois do HEAD\n'), { app: 'igual', util: 'modificada', chamada: 'modificada' });
    cenario('apagada', () => fs.rmSync(app), { app: 'ausente', util: 'igual', chamada: 'modificada' });
    // Link para uma copia identica fora da raiz: nao e mais o arquivo regular indexado.
    fs.writeFileSync(path.join(fora, 'app.ts'), APP);
    cenario('link', () => { fs.rmSync(app); fs.symlinkSync(path.join(fora, 'app.ts'), app); }, { app: 'ausente', util: 'igual', chamada: 'modificada' });
    cenario('pasta', () => { fs.rmSync(app); fs.mkdirSync(app); }, { app: 'ausente', util: 'igual', chamada: 'modificada' });
    // Pasta-mae trocada por link para fora, com os mesmos bytes: o caminho real sai da raiz.
    fs.mkdirSync(path.join(fora, 'src'));
    fs.writeFileSync(path.join(fora, 'src', 'app.ts'), APP);
    fs.writeFileSync(path.join(fora, 'src', 'util.ts'), UTIL);
    cenario('pasta-mae fora', () => { fs.rmSync(path.join(r.dir, 'src'), { recursive: true }); fs.symlinkSync(path.join(fora, 'src'), path.join(r.dir, 'src')); },
      { app: 'ausente', util: 'ausente', chamada: 'modificada' });
    if (process.platform !== 'win32') {
      // FIFO no lugar da fonte: recusada pelo lstat, sem abrir, entao a consulta nao trava.
      cenario('fifo', () => { fs.rmSync(app); execFileSync('mkfifo', [app]); }, { app: 'ausente', util: 'igual', chamada: 'modificada' });
    }
    // O git status lista o arquivo, mas a arvore tem os bytes do HEAD (mudanca so no indice do Git): igual pelos bytes.
    fs.writeFileSync(app, APP.replace('dobro(2)', 'dobro(4)'));
    r.git('add', '--', 'src/app.ts');
    fs.writeFileSync(app, APP);
    const c = consulta(r.dir, 'chamadores', 'dobro');
    assert.equal(c.indice.arvore, 'modificada');
    assert.deepEqual(situacoes(c), { 'src/app.ts': 'igual', 'src/util.ts': 'igual' });
    assert.deepEqual(porPar(c), { [CHAMADA]: 'igual' });
  } finally {
    r.limpar();
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('KG5 proveniencia: situacaoNaArvore le cada caminho uma vez, so do manifesto, e confere o tamanho antes de abrir', () => {
  const dir = dirTemporario('kg5f5-situacao');
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    const entrada = (p: string, conteudo: string) => ({ path: p, authority: 'git:demo', source_hash: sha256(conteudo), source_version: blob(conteudo),
      size_bytes: Buffer.byteLength(conteudo), access: { tenant_id: 'local', acl_refs: ['repo:demo:leitura'] } });
    const manifesto = [entrada('src/a.ts', 'export const a = 1;\n'), entrada('src/b.ts', 'export const b = 2;\n'), entrada('src/vazio.ts', '')];
    fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'src/b.ts'), 'export const b = 3;\n');
    fs.writeFileSync(path.join(dir, 'src/vazio.ts'), '');
    fs.writeFileSync(path.join(dir, 'src/fora-do-manifesto.ts'), 'x');
    const situacao = situacaoNaArvore(dir, manifesto);
    assert.deepEqual(['src/a.ts', 'src/b.ts', 'src/vazio.ts', 'src/fora-do-manifesto.ts', 'src/inexistente.ts'].map(situacao),
      ['igual', 'modificada', 'igual', 'ausente', 'ausente']);
    // Lido uma vez: a resposta inteira (e a busca binaria do teto) ve a mesma situacao.
    fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 9;\n');
    assert.equal(situacao('src/a.ts'), 'igual');
    assert.equal(situacaoNaArvore(dir, manifesto)('src/a.ts'), 'modificada');
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      // Sem permissao de leitura: tamanho diferente ja e modificada (nao abriu); o mesmo tamanho precisa abrir e falha.
      fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 10;\n');
      fs.chmodSync(path.join(dir, 'src/a.ts'), 0o000);
      fs.writeFileSync(path.join(dir, 'src/b.ts'), 'export const b = 2;\n');
      fs.chmodSync(path.join(dir, 'src/b.ts'), 0o000);
      const nova = situacaoNaArvore(dir, manifesto);
      assert.deepEqual([nova('src/a.ts'), nova('src/b.ts')], ['modificada', 'ausente']);
      fs.chmodSync(path.join(dir, 'src/a.ts'), 0o644);
      fs.chmodSync(path.join(dir, 'src/b.ts'), 0o644);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Trinta funcoes chamam `alvo`: a resposta passa do teto pequeno e o corte entra. */
const CHAMADAS = 30;
const REPO_TETO: Record<string, string> = {
  '.gitignore': '.orkastery/\n',
  'orkastery.yaml': MANIFESTO_MINIMO,
  'src/alvo.ts': 'export function alvo(): number { return 1; }\n',
  'src/chamadores.ts': "import { alvo } from './alvo';\n"
    + Array.from({ length: CHAMADAS }, (_, i) => `export function chama${String(i).padStart(2, '0')}(): number { return alvo(); }\n`).join(''),
};

test('KG5 proveniencia: com a arvore modificada, o teto corta pelo limite com fontes no calculo, e o worker responde o mesmo que a CLI (D10)', async () => {
  const r = repositorio(REPO_TETO, 'kg5f5-teto');
  try {
    assert.equal(grafo(r.dir, 'indexar').codigo, 0);
    fs.appendFileSync(path.join(r.dir, 'src/chamadores.ts'), '// depois do HEAD\n');
    const teto = 6000;
    const cortada = grafo(r.dir, 'chamadores', 'alvo', '--json', `--teto-bytes=${teto}`);
    assert.equal(cortada.codigo, 0, cortada.saida);
    assert.ok(Buffer.byteLength(cortada.saida) <= teto, `${Buffer.byteLength(cortada.saida)} bytes`);
    const c = JSON.parse(cortada.saida) as RespostaDeConsulta & { teto: { cortado: boolean } };
    const k = c.arestas.length;
    assert.ok(k >= 1 && k < CHAMADAS && c.teto.cortado, `${k} arestas`);
    assert.ok(c.arestas.every((a) => a.arvore === 'modificada'));
    assert.deepEqual(situacoes(c), { 'src/alvo.ts': 'igual', 'src/chamadores.ts': 'modificada' });
    const comLimite = consulta(r.dir, 'chamadores', 'alvo', '--limite', String(k));
    assert.equal(cortada.saida, JSON.stringify({ ...comLimite, teto: c.teto }));
    const seguinte = consulta(r.dir, 'chamadores', 'alvo', '--limite', String(k + 1));
    assert.ok(Buffer.byteLength(JSON.stringify({ ...seguinte, teto: c.teto })) > teto, 'o maior limite que cabe');
    // O worker (no processo e num processo filho, com o ambiente minimo do MCP) responde os mesmos bytes.
    const argv = argvDaTool('ork_grafo_chamadores', { alvo: 'alvo', tetoBytes: teto });
    const partes: string[] = [];
    assert.equal(rodarConsulta({ raiz: r.dir, argv }, r.dir, (x) => partes.push(x)), 0);
    assert.equal(partes.join(''), cortada.saida);
    const filho = await consultarPeloWorker(r.dir, argv);
    assert.deepEqual([filho.codigo, filho.interrompido], [0, null], filho.erro);
    assert.equal(filho.saida, cortada.saida);
    // O texto da CLI diz o mesmo.
    const texto = grafo(r.dir, 'chamadores', 'alvo', '--limite', '1');
    assert.match(texto.saida, /^fontes que mudaram na arvore: src\/chamadores\.ts \(modificada\)$/m);
    assert.match(texto.saida, /^  calls  symbol src\/chamadores\.ts#chama00 -> symbol src\/alvo\.ts#alvo  \[fonte modificada na arvore\]$/m);
  } finally {
    r.limpar();
  }
});

const ENTRADA: EntradaDoContexto = {
  thread: 'demo-proveniencia', base: 'a'.repeat(40), diff: [], diffEstado: 'ignorado-sem-worktree', goal: 'Editar `src/util.ts`', plan: null, claims: [],
};
type Grupo = { from: string; to: string; arvore?: string };
type Pacote = { nos: Record<string, string>; arestas: Grupo[]; indice: { arvore: string }; medida: { pacote_bytes: number } };
/** O caminho de um rotulo local do pacote (`symbol src/a.ts#f` da `src/a.ts`). */
const caminhoDoRotulo = (rotulo: string): string => rotulo.slice(rotulo.indexOf(' ') + 1).split('#')[0];
const tocam = (r: Pacote, p: string): boolean[] => r.arestas.map((a) => [r.nos[a.from], r.nos[a.to]].some((x) => caminhoDoRotulo(x) === p));

test('KG5 proveniencia: no pacote v2, so o grupo cuja origem ou alvo mudou ganha a marca, e sem mudanca os bytes sao os de antes (D5)', () => {
  const antes = pacoteDeContexto(GRAFO, cabecalho(), ENTRADA);
  assert.equal(pacoteDeContexto(GRAFO, cabecalho(), ENTRADA, 32768, () => 'igual'), antes, 'situacao toda igual nao muda um byte');
  const r0 = JSON.parse(antes) as Pacote;
  assert.ok(r0.arestas.length >= 4 && r0.arestas.every((a) => !('arvore' in a)));
  const marcado = JSON.parse(pacoteDeContexto(GRAFO, cabecalho('modificada'), ENTRADA, 32768, marcando('src/app.ts'))) as Pacote;
  const esperadas = tocam(marcado, 'src/app.ts');
  assert.ok(esperadas.some(Boolean) && !esperadas.every(Boolean), 'ha grupo de app.ts e grupo so de util.ts');
  assert.deepEqual(marcado.arestas.map((a) => a.arvore === 'modificada'), esperadas);
  assert.ok(marcado.arestas.every((a) => a.arvore === undefined || a.arvore === 'modificada'), 'a marca so existe quando a fonte mudou');
  // Tirando a marca, o cabecalho da arvore e a medida do proprio pacote, o resto e identico.
  const sem = (r: Pacote) => ({ ...r, arestas: r.arestas.map(({ arvore: _, ...g }) => g), indice: { ...r.indice, arvore: 'limpa' }, medida: { ...r.medida, pacote_bytes: 0 } });
  assert.deepEqual(sem(marcado), sem(r0));
  // O alvo pesa como nas consultas por no (D4): mudar so util.ts marca a chamada que parte de app.ts.
  const peloAlvo = JSON.parse(pacoteDeContexto(GRAFO, cabecalho('modificada'), ENTRADA, 32768, marcando('src/util.ts'))) as Pacote;
  assert.deepEqual(peloAlvo.arestas.map((a) => a.arvore === 'modificada'), tocam(peloAlvo, 'src/util.ts'));
});

test('KG5 proveniencia: o ork grafo contexto marca so os grupos da fonte editada e conta no resumo, e a arvore limpa nao marca nada', () => {
  const r = repositorio(REPO, 'kg5f5-contexto-cli');
  try {
    assert.equal(grafo(r.dir, 'indexar').codigo, 0);
    const head = r.git('rev-parse', 'HEAD').trim();
    const contexto = (...opcoes: string[]): { codigo: number; saida: string } => {
      let saida = '';
      const codigo = executarGrafo(['contexto', ENTRADA.thread, ...opcoes], { raiz: r.dir, estado: raizDoEstado(r.dir), repositorio: 'demo',
        contextoDaThread: (id) => ({ raiz: r.dir, head, entrada: { ...ENTRADA, thread: id, base: head } }), escrever: (s) => { saida = s; } });
      return { codigo, saida };
    };
    const limpo = contexto('--json');
    assert.equal(limpo.codigo, 0, limpo.saida);
    assert.ok((JSON.parse(limpo.saida) as Pacote).arestas.every((a) => !('arvore' in a)));
    assert.ok(!contexto().saida.includes('fonte modificada'));
    fs.appendFileSync(path.join(r.dir, 'src/app.ts'), '// depois do HEAD\n');
    const sujo = JSON.parse(contexto('--json').saida) as Pacote;
    assert.equal(sujo.indice.arvore, 'modificada');
    const esperadas = tocam(sujo, 'src/app.ts');
    assert.ok(esperadas.some(Boolean) && !esperadas.every(Boolean));
    assert.deepEqual(sujo.arestas.map((a) => a.arvore === 'modificada'), esperadas);
    assert.match(contexto().saida, new RegExp(`^  ligacoes com fonte modificada na arvore: ${esperadas.filter(Boolean).length}$`, 'm'));
  } finally {
    r.limpar();
  }
});

test('KG5 proveniencia: com a arvore modificada, o pacote pelo MCP e pelo worker traz a mesma marca que a CLI', async () => {
  const p = projetoTemporario('kg5f5-contexto-mcp');
  let cliente: Client | undefined, servidor: ReturnType<typeof criarServidorMcp> | undefined;
  try {
    for (const [arquivo, conteudo] of Object.entries(PURO)) commitar(p.dir, arquivo, conteudo, 'fixture da proveniencia');
    commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8') + '\ngrafo:\n  mcp: true\n', 'flag da fixture');
    const t = novaThread(p.carregado, { nome: 'proveniencia do contexto', modo: 'auto', worktree: null }).thread;
    escreverArtefatoMcp(p.dir, t.id, 'goal', 'Editar `src/util.ts`', null);
    const cli = (...argv: string[]): { codigo: number; saida: string } => {
      let saida = '';
      const codigo = executarGrafo(argv, { raiz: p.dir, estado: p.dir, repositorio: p.carregado.manifesto.project.name,
        contextoDaThread: (id) => lerEntradaDaThread(p.dir, id), escrever: (s) => { saida = s; } });
      return { codigo, saida };
    };
    assert.equal(cli('indexar').codigo, 0);
    fs.appendFileSync(path.join(p.dir, 'src/app.ts'), '// depois do HEAD\n');
    const argv = argvDaTool('ork_grafo_contexto', { threadId: t.id });
    const esperado = cli(...argv);
    assert.equal(esperado.codigo, 0, esperado.saida);
    const r = JSON.parse(esperado.saida) as Pacote;
    assert.ok(r.arestas.some((a) => a.arvore === 'modificada'));
    assert.deepEqual(r.arestas.map((a) => a.arvore === 'modificada'), tocam(r, 'src/app.ts'));
    let worker = '';
    assert.equal(rodarConsulta({ raiz: p.dir, argv }, p.dir, (s) => { worker = s; }), 0);
    assert.equal(worker, esperado.saida);
    servidor = criarServidorMcp({ projeto: p.dir, host: 'claude-code' });
    cliente = new Client({ name: 'kg5f5-contexto', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await servidor.connect(st);
    await cliente.connect(ct);
    const resposta = await cliente.callTool({ name: 'ork_grafo_contexto', arguments: { threadId: t.id } });
    assert.ok(!resposta.isError, JSON.stringify(resposta));
    assert.equal((resposta.content as { type: string; text: string }[])[0].text, esperado.saida);
    // A consulta por no pela tool tambem traz as fontes e a marca da aresta.
    const porNo = await cliente.callTool({ name: 'ork_grafo_chamadores', arguments: { threadId: t.id, alvo: 'dobro' } });
    assert.ok(!porNo.isError, JSON.stringify(porNo));
    const c = JSON.parse((porNo.content as { type: string; text: string }[])[0].text) as RespostaDeConsulta;
    assert.deepEqual(porPar(c), { [CHAMADA]: 'modificada' });
    assert.deepEqual(situacoes(c), { 'src/app.ts': 'modificada', 'src/util.ts': 'igual' });
  } finally {
    await cliente?.close();
    await servidor?.close();
    p.limpar();
  }
});
