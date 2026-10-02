/**
 * RM-031 KG5: a consulta do grafo de codigo pelas fases, pelo MCP do projeto.
 *
 * Grupos: `KG5 flag` (manifesto e servidor: desligada por padrao, nada muda sem ela), `KG5 contrato`
 * (as quatro tools respondem o mesmo que o `ork grafo ... --json --teto-bytes N`), `KG5 teto` (resposta
 * limitada em bytes), `KG5 indice` (indice ausente ou de outra revisao recusa com a correcao), `KG5 worker`
 * (o processo filho so roda as quatro consultas), `KG5 despacho` (allowlist do claude-bg so com a flag) e
 * `KG5 medida` (o validador do registro offline).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { carregarManifesto, exigirManifesto } from '../src/manifest';
import { raizDoEstado } from '../src/estado-thread';
import { executarGrafo } from '../src/intelligence-graph-cli';
import { TIPOS_DE_ARESTA } from '../src/intelligence-graph-contract';
import { LIMITE_MAXIMO, PROFUNDIDADE_MAXIMA } from '../src/intelligence-graph-query';
import { criarServidorMcp } from '../src/mcp-server';
import {
  LIMITE_MAXIMO_DO_MCP, PROFUNDIDADE_MAXIMA_DO_MCP, TETO_PADRAO, TIPOS_DE_ARESTA_DO_MCP, TOOLS_DO_GRAFO, consultarPeloWorker, registrarConsultasDoGrafo,
} from '../src/mcp-grafo';
import { rodarConsulta } from '../src/mcp-grafo-worker';
import { novaThread } from '../src/thread';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { contextoDoProjeto } from '../src/runtime-context';
import { montarComando } from '../src/adapters/claude-bg';
import type { Thread } from '../src/types';
import { commitar, dirTemporario, projetoTemporario, type ProjetoDeTeste } from './apoio';

const MANIFESTO_MINIMO = 'project:\n  name: "demo"\n  abbrev: "dem"\n';

/** Repositorio Git temporario com os arquivos commitados; `.orkastery/` fora do git, como no projeto. */
function repositorio(arquivos: Record<string, string>, nome = 'kg5-repo'): { dir: string; git: (...args: string[]) => string; limpar: () => void } {
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

/** Trinta funcoes chamam `alvo`: a resposta de `chamadores alvo` passa de 8 KB e o teto corta. */
const CHAMADAS = 30;
const REPO = {
  '.gitignore': '.orkastery/\n',
  'orkastery.yaml': MANIFESTO_MINIMO,
  'src/alvo.ts': 'export function alvo(): number { return 1; }\n',
  'src/chamadores.ts': "import { alvo } from './alvo';\n"
    + Array.from({ length: CHAMADAS }, (_, i) => `export function chama${String(i).padStart(2, '0')}(): number { return alvo(); }\n`).join(''),
  'docs/x.md': '# X\n\nVeja [alvo](../src/alvo.ts).\n',
};

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

function indexar(dir: string): void {
  const r = grafo(dir, 'indexar');
  assert.equal(r.codigo, 0, r.erro ?? r.saida);
}

interface Aresta { edge_id: string; evidencias: unknown[] }

/** O bloco `grafo` lido de um manifesto com o trecho pedido. */
function lerBlocoGrafo(trecho: string): { grafo: unknown; avisos: string[] } {
  const dir = dirTemporario('kg5-manifesto');
  try {
    fs.writeFileSync(path.join(dir, 'orkastery.yaml'), MANIFESTO_MINIMO + trecho);
    const c = carregarManifesto(dir);
    assert.ok(c, 'manifesto carregado');
    assert.deepEqual(c.erros, [], 'a flag nunca vira erro de manifesto');
    return { grafo: c.manifesto.grafo, avisos: c.avisos.filter((a) => a.startsWith('grafo')) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('KG5 flag: manifesto sem o bloco grafo, ou com mcp false, deixa a consulta pelo MCP desligada', () => {
  assert.deepEqual(lerBlocoGrafo(''), { grafo: { mcp: false }, avisos: [] });
  assert.deepEqual(lerBlocoGrafo('grafo:\n  mcp: false\n'), { grafo: { mcp: false }, avisos: [] });
  assert.deepEqual(lerBlocoGrafo('grafo:\n  mcp:\n'), { grafo: { mcp: false }, avisos: [] });
  assert.deepEqual(lerBlocoGrafo('grafo:\n'), { grafo: { mcp: false }, avisos: [] });
});

test('KG5 flag: manifesto so liga com o booleano true', () => {
  assert.deepEqual(lerBlocoGrafo('grafo:\n  mcp: true\n'), { grafo: { mcp: true }, avisos: [] });
  // O YAML do nucleo le `yes` e `no` como booleanos (`escalar` em core/src/yaml.ts): e o booleano que liga.
  assert.deepEqual(lerBlocoGrafo('grafo:\n  mcp: yes\n'), { grafo: { mcp: true }, avisos: [] });
  assert.deepEqual(lerBlocoGrafo('grafo:\n  mcp: no\n'), { grafo: { mcp: false }, avisos: [] });
});

test('KG5 flag: manifesto com valor que nao e booleano vale desligado, com aviso, e nunca erro', () => {
  for (const valor of ['sim', '"true"', '1', 'on', '[true]']) {
    const r = lerBlocoGrafo(`grafo:\n  mcp: ${valor}\n`);
    assert.deepEqual(r.grafo, { mcp: false }, valor);
    assert.equal(r.avisos.length, 1, valor);
    assert.match(r.avisos[0], /^grafo\.mcp deve ser true ou false; vale false \(/, valor);
  }
  const naoMapa = lerBlocoGrafo('grafo: true\n');
  assert.deepEqual(naoMapa.grafo, { mcp: false });
  assert.match(naoMapa.avisos[0], /^grafo deve ser um mapa com mcp: true ou false; vale mcp: false/);
  // Chave desconhecida so avisa: o mcp explicito vale.
  const extra = lerBlocoGrafo('grafo:\n  mcp: true\n  cache: 5\n');
  assert.deepEqual(extra.grafo, { mcp: true });
  assert.deepEqual(extra.avisos, ['grafo.cache desconhecida; o bloco grafo so tem mcp']);
});

test('KG5 flag: manifesto deste repositorio declara a flag desligada, sem aviso', () => {
  const c = carregarManifesto(path.resolve(__dirname, '../../..'));
  assert.ok(c);
  assert.deepEqual(c.manifesto.grafo, { mcp: false });
  assert.deepEqual(c.avisos.filter((a) => a.startsWith('grafo')), []);
});

test('KG5 teto: sem --teto-bytes a saida e o JSON formatado de sempre; com teto que cabe, o mesmo objeto compacto com o teto', () => {
  const r = repositorio(REPO);
  try {
    indexar(r.dir);
    const formatado = grafo(r.dir, 'chamadores', 'alvo', '--json');
    assert.equal(formatado.codigo, 0, formatado.saida);
    const objeto = JSON.parse(formatado.saida);
    assert.equal(formatado.saida, JSON.stringify(objeto, null, 2));
    assert.equal(objeto.teto, undefined);
    assert.equal(objeto.arestas.length, CHAMADAS);
    const compacto = grafo(r.dir, 'chamadores', 'alvo', '--json', '--teto-bytes', '999999');
    assert.equal(compacto.codigo, 0);
    assert.equal(compacto.saida, JSON.stringify({ ...objeto, teto: { bytes: 999999, limite_pedido: 500, cortado: false } }));
  } finally {
    r.limpar();
  }
});

test('KG5 teto: acima do teto saem as arestas mais longe, com o maior limite que cabe e a evidencia inteira', () => {
  const r = repositorio(REPO);
  try {
    indexar(r.dir);
    const cheia = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json').saida);
    const teto = 8000;
    const cortada = grafo(r.dir, 'chamadores', 'alvo', '--json', `--teto-bytes=${teto}`);
    assert.equal(cortada.codigo, 0, cortada.saida);
    assert.ok(Buffer.byteLength(cortada.saida) <= teto, `${Buffer.byteLength(cortada.saida)} bytes`);
    const c = JSON.parse(cortada.saida);
    const k = c.arestas.length;
    assert.ok(k >= 1 && k < CHAMADAS, `${k} arestas`);
    assert.deepEqual(c.teto, { bytes: teto, limite_pedido: 500, cortado: true });
    assert.deepEqual([c.consulta.limite, c.truncado, c.total_arestas, c.total_nos], [k, true, CHAMADAS, cheia.total_nos]);
    // E a resposta da CLI com --limite k, com o teto ao lado: as primeiras k arestas da ordem fixa e os mesmos nos.
    const comLimite = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json', '--limite', String(k)).saida);
    assert.equal(cortada.saida, JSON.stringify({ ...comLimite, teto: c.teto }));
    assert.deepEqual(c.arestas, cheia.arestas.slice(0, k));
    // O maior que cabe: com k+1 arestas a resposta passaria do teto.
    const seguinte = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json', '--limite', String(k + 1)).saida);
    assert.ok(Buffer.byteLength(JSON.stringify({ ...seguinte, teto: c.teto })) > teto);
    for (const a of c.arestas as Aresta[]) {
      assert.ok(a.evidencias.length >= 1, a.edge_id);
      assert.deepEqual(a.evidencias, (cheia.arestas as Aresta[]).find((x) => x.edge_id === a.edge_id)?.evidencias);
    }
    assert.equal(grafo(r.dir, 'chamadores', 'alvo', '--json', `--teto-bytes=${teto}`).saida, cortada.saida, 'deterministica');
    // Na vizinhanca, as mais perto do alvo ficam: a distancia nunca diminui na lista cortada.
    const viz = JSON.parse(grafo(r.dir, 'vizinhos', 'alvo', '--profundidade', '2', '--json', '--teto-bytes', '6000').saida);
    assert.equal(viz.teto.cortado, true);
    const distancias = viz.arestas.map((a: { distancia: number }) => a.distancia);
    assert.deepEqual(distancias, [...distancias].sort((x, y) => x - y));
    assert.ok(Buffer.byteLength(JSON.stringify(viz)) <= 6000);
  } finally {
    r.limpar();
  }
});

test('KG5 teto: caminho que nao cabe e resposta em que nem uma aresta cabe recusam, em JSON compacto', () => {
  const r = repositorio(REPO);
  try {
    indexar(r.dir);
    assert.equal(grafo(r.dir, 'caminho', 'docs/x.md', 'alvo', '--json').codigo, 0, 'o caminho existe');
    const caminho = grafo(r.dir, 'caminho', 'docs/x.md', 'alvo', '--json', '--teto-bytes', '300');
    assert.equal(caminho.codigo, 1);
    assert.ok(!caminho.saida.includes('\n'), 'erro compacto com o teto');
    const e = JSON.parse(caminho.saida).erro;
    assert.equal(e.codigo, 'grafo.consulta.teto-excedido');
    assert.match(e.detalhe, /^o caminho de \d+ passo\(s\) tem \d+ bytes, acima do teto de 300; o caminho nao se corta: use --teto-bytes maior$/);
    const um = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json', '--teto-bytes', '300').saida).erro;
    assert.equal(um.codigo, 'grafo.consulta.teto-excedido');
    assert.match(um.detalhe, /^a resposta com 1 aresta tem \d+ bytes, acima do teto de 300; use --teto-bytes maior$/);
    assert.equal(um.estado_do_indice, undefined, 'so recusa de indice traz a correcao');
  } finally {
    r.limpar();
  }
});

test('KG5 teto: --teto-bytes so com --json, inteiro de ao menos 1, e so nas quatro consultas', () => {
  const r = repositorio(REPO);
  try {
    // Sem indice: a opcao e conferida antes de ler o indice, senao o erro seria de indice ausente.
    assert.match(grafo(r.dir, 'chamadores', 'alvo', '--teto-bytes', '9000').erro ?? '', /^grafo\.uso: --teto-bytes exige --json/);
    for (const [valor, motivo] of [['0', /--teto-bytes precisa ser ao menos 1/], ['abc', /--teto-bytes precisa ser inteiro/]] as const) {
      const x = grafo(r.dir, 'chamadores', 'alvo', '--json', '--teto-bytes', valor);
      assert.equal(x.codigo, 1);
      assert.ok(!x.saida.includes('\n'));
      assert.equal(JSON.parse(x.saida).erro.codigo, 'grafo.uso');
      assert.match(JSON.parse(x.saida).erro.detalhe, motivo);
    }
    assert.match(grafo(r.dir, 'indexar', '--teto-bytes', '10').erro ?? '', /opcao desconhecida para indexar: --teto-bytes/);
    assert.equal(JSON.parse(grafo(r.dir, 'status', '--json', '--teto-bytes=10').saida).erro.codigo, 'grafo.uso');
  } finally {
    r.limpar();
  }
});

const CORRECAO = { correcao: 'ork grafo indexar' };

test('KG5 indice: cli sem indice nenhum diz nao indexado e da a correcao', () => {
  const r = repositorio(REPO);
  try {
    const x = grafo(r.dir, 'chamadores', 'alvo', '--json');
    assert.equal(x.codigo, 1);
    const e = JSON.parse(x.saida).erro;
    assert.match(e.detalhe, /^sem indice do HEAD [0-9a-f]{12}; rode ork grafo indexar$/);
    assert.deepEqual({ ...e, detalhe: null }, { codigo: 'grafo.indice.ausente', detalhe: null, candidatos: [], estado_do_indice: 'nao-indexado', ...CORRECAO });
    assert.match(grafo(r.dir, 'chamadores', 'alvo').erro ?? '', /^grafo\.indice\.ausente: sem indice do HEAD [0-9a-f]{12}; rode ork grafo indexar$/);
  } finally {
    r.limpar();
  }
});

test('KG5 indice: cli com indice de outra revisao recusa como indice velho, sem responder por ele', () => {
  const r = repositorio(REPO);
  try {
    indexar(r.dir);
    const antiga = r.git('rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(r.dir, 'src/novo.ts'), "import { alvo } from './alvo';\nexport function novo(): number { return alvo(); }\n");
    r.git('add', '--', 'src/novo.ts');
    r.git('commit', '-q', '-m', 'dois');
    const head = r.git('rev-parse', 'HEAD').trim();
    const x = grafo(r.dir, 'chamadores', 'alvo', '--json', '--teto-bytes', '32768');
    assert.equal(x.codigo, 1);
    const e = JSON.parse(x.saida).erro;
    assert.deepEqual([e.codigo, e.estado_do_indice, e.correcao], ['grafo.indice.outra-revisao', 'outra-revisao', 'ork grafo indexar']);
    assert.equal(e.detalhe, `o HEAD ${head.slice(0, 12)} nao tem indice; o guardado e de outra revisao (${antiga.slice(0, 12)}); `
      + 'rode ork grafo indexar com a mesma instalacao do ork e o mesmo Node de quem consulta');
    assert.match(grafo(r.dir, 'chamadores', 'alvo').erro ?? '', /^grafo\.indice\.outra-revisao: o HEAD [0-9a-f]{12} nao tem indice/);
    indexar(r.dir);
    assert.equal(JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json').saida).arestas.length, CHAMADAS + 1, 'com o indice do HEAD, responde');
  } finally {
    r.limpar();
  }
});

test('KG5 indice: cli com indice do HEAD de outro extrator recusa e manda indexar', () => {
  const r = repositorio(REPO);
  try {
    indexar(r.dir);
    const status = JSON.parse(grafo(r.dir, 'status', '--json').saida);
    const outra = `idx-${'f'.repeat(64)}`;
    assert.notEqual(status.chave_do_head, outra);
    // O mesmo indice sob outra chave e outro codigo do extrator: o que sobra quando o ork e atualizado.
    fs.renameSync(path.join(status.dir, status.chave_do_head), path.join(status.dir, outra));
    const arquivo = path.join(status.dir, outra, 'indice.json');
    const manifesto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    fs.writeFileSync(arquivo, JSON.stringify({ ...manifesto, chave: outra, codigo: '0'.repeat(64) }));
    assert.equal(JSON.parse(grafo(r.dir, 'status', '--json').saida).indices.find((i: { chave: string }) => i.chave === outra).problema, null);
    const e = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json').saida).erro;
    assert.deepEqual([e.codigo, e.estado_do_indice, e.correcao], ['grafo.indice.outro-extrator', 'outro-extrator', 'ork grafo indexar']);
    // CHECK rodada 1 (A1): a recusa diz o que mudou e que a correcao e com a instalacao de quem consulta.
    assert.match(e.detalhe, /^ha indice do HEAD [0-9a-f]{12} de outro extrator \(codigo do extrator\); rode ork grafo indexar com a mesma instalacao do ork e o mesmo Node de quem consulta/);
    // CHECK rodada 2 (N2): outro Node (o rotulo do analisador de JavaScript) e outros pacotes tambem sao ditos.
    const outroNode = { ...manifesto, chave: outra, analisadores: { ...manifesto.analisadores, javascript: 'node.0.0.0' }, pacotes: ['outro@1.0.0'] };
    fs.writeFileSync(arquivo, JSON.stringify(outroNode));
    const n = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json').saida).erro;
    assert.equal(n.codigo, 'grafo.indice.outro-extrator');
    assert.match(n.detalhe, new RegExp(`\\(javascript node\\.0\\.0\\.0 no indice, ${manifesto.analisadores.javascript.replace(/\./g, '\\.')} aqui; pacotes dos analisadores\\)`));
  } finally {
    r.limpar();
  }
});

test('KG5 indice: cli com indice do HEAD corrompido traz o estado e a correcao no JSON', () => {
  const r = repositorio(REPO);
  try {
    indexar(r.dir);
    const status = JSON.parse(grafo(r.dir, 'status', '--json').saida);
    fs.truncateSync(path.join(status.dir, status.chave_do_head, 'grafo.json'), 10);
    const e = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json').saida).erro;
    assert.deepEqual([e.codigo, e.estado_do_indice, e.correcao], ['grafo.indice.corrompido', 'corrompido', 'ork grafo indexar']);
  } finally {
    r.limpar();
  }
});

// ---------------------------------------------------------------------------
// As tools no servidor MCP (T4).
// ---------------------------------------------------------------------------

/** Fontes do projeto das tools: `alvo` com dois chamadores, um nome repetido e um link de documento. */
const FONTES = {
  'src/alvo.ts': 'export function alvo(): number { return 1; }\nexport function repetido(): number { return 2; }\n',
  'src/usa.ts': "import { alvo } from './alvo';\nexport function um(): number { return alvo(); }\nexport function dois(): number { return alvo() + um(); }\n",
  'src/outro.ts': 'export function repetido(): number { return 3; }\n',
  'docs/x.md': '# X\n\nVeja [alvo](../src/alvo.ts).\n',
};
const FLAG_LIGADA = 'grafo:\n  mcp: true\n';

async function chamar(c: Client, nome: string, args: Record<string, unknown>): Promise<{ erro: boolean; texto: string }> {
  const r = await c.callTool({ name: nome, arguments: args });
  const texto = (r.content as { type: string; text?: string }[]).filter((x) => x.type === 'text').map((x) => x.text ?? '').join('');
  return { erro: r.isError === true, texto };
}

async function conectar(projeto: string, threadId?: string): Promise<{ c: Client; fechar: () => Promise<void> }> {
  const server = criarServidorMcp({ projeto, host: 'codex', ...(threadId ? { threadId } : {}) });
  const c = new Client({ name: 'kg5-fixture', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await c.connect(ct);
  return { c, fechar: async () => { await c.close(); await server.close(); } };
}

/**
 * Projeto com o manifesto (com a flag pedida) e as fontes commitados, uma thread, o indice do HEAD
 * da arvore da thread e o servidor MCP com um cliente. O manifesto e rastreado, como no projeto real:
 * a worktree da thread tem o proprio.
 */
async function comServidor(corpo: (f: { p: ProjetoDeTeste; t: Thread; c: Client }) => Promise<void>,
  opcoes: { flag?: string; indexar?: boolean; worktree?: boolean; vinculada?: boolean } = {}): Promise<void> {
  const p = projetoTemporario('kg5-mcp');
  try {
    const manifesto = path.join(p.dir, 'orkastery.yaml');
    commitar(p.dir, 'orkastery.yaml', `${fs.readFileSync(manifesto, 'utf8')}\n${opcoes.flag ?? FLAG_LIGADA}`, 'manifesto');
    for (const [arquivo, conteudo] of Object.entries(FONTES)) commitar(p.dir, arquivo, conteudo, `fonte ${arquivo}`);
    p.carregado = exigirManifesto(p.dir);
    const t = novaThread(p.carregado, { nome: 'consulta', modo: 'auto', criarWorktree: opcoes.worktree === true }).thread;
    if (opcoes.indexar !== false) indexar(t.worktree ?? p.dir);
    const { c, fechar } = await conectar(p.dir, opcoes.vinculada ? t.id : undefined);
    try {
      await corpo({ p, t, c });
    } finally {
      await fechar();
    }
  } finally {
    p.limpar();
  }
}

/** A lista de tools do servidor no mesmo projeto, com o bloco `grafo` pedido no manifesto. */
async function listarCom(p: ProjetoDeTeste, bloco: string): Promise<Tool[]> {
  const manifesto = path.join(p.dir, 'orkastery.yaml');
  const base = fs.readFileSync(manifesto, 'utf8').split('\ngrafo:')[0];
  fs.writeFileSync(manifesto, bloco ? `${base}\n${bloco}` : base);
  const { c, fechar } = await conectar(p.dir);
  try {
    return (await c.listTools()).tools;
  } finally {
    await fechar();
  }
}

test('KG5 flag: servidor sem a flag, com false ou com valor invalido lista as mesmas 30 tools; com true, so acrescenta as quatro', async () => {
  const p = projetoTemporario('kg5-lista');
  try {
    const sem = await listarCom(p, '');
    assert.equal(sem.length, 30);
    assert.ok(!sem.some((t) => t.name.startsWith('ork_grafo_')));
    assert.deepEqual(await listarCom(p, 'grafo:\n  mcp: false\n'), sem);
    assert.deepEqual(await listarCom(p, 'grafo:\n  mcp: sim\n'), sem);
    const com = await listarCom(p, FLAG_LIGADA);
    assert.equal(com.length, 34);
    assert.deepEqual(com.slice(0, 30), sem, 'a flag nao muda nenhuma das outras tools');
    assert.deepEqual(com.slice(30).map((t) => t.name), [...TOOLS_DO_GRAFO]);
  } finally {
    p.limpar();
  }
});

test('KG5 flag: servidor com a flag expoe as quatro tools de leitura, com schema fechado e threadId', async () => {
  const p = projetoTemporario('kg5-schemas');
  try {
    const grafoTools = (await listarCom(p, FLAG_LIGADA)).filter((t) => t.name.startsWith('ork_grafo_'));
    assert.deepEqual(grafoTools.map((t) => t.name), [...TOOLS_DO_GRAFO]);
    for (const t of grafoTools) {
      assert.deepEqual([t.annotations?.readOnlyHint, t.annotations?.destructiveHint], [true, false], t.name);
      assert.equal(t.inputSchema.additionalProperties, false, t.name);
      const props = Object.keys(t.inputSchema.properties ?? {});
      assert.ok(props.includes('threadId') && props.includes('tetoBytes') && props.includes('projeto'), `${t.name}: ${props}`);
      const exigidos = t.name === 'ork_grafo_caminho' ? ['threadId', 'de', 'para'] : ['threadId', 'alvo'];
      assert.deepEqual([...(t.inputSchema.required ?? [])].sort(), exigidos.sort(), t.name);
      assert.match(t.description ?? '', /ork grafo indexar/, t.name);
    }
  } finally {
    p.limpar();
  }
});

test('KG5 contrato: o vocabulario e os limites das tools sao os do contrato v1 e da consulta', () => {
  assert.deepEqual([...TIPOS_DE_ARESTA_DO_MCP], [...TIPOS_DE_ARESTA]);
  assert.equal(PROFUNDIDADE_MAXIMA_DO_MCP, PROFUNDIDADE_MAXIMA);
  assert.equal(LIMITE_MAXIMO_DO_MCP, LIMITE_MAXIMO);
});

test('KG5 contrato: cada tool responde byte a byte o que o ork grafo responde ao mesmo argv, com a evidencia de cada aresta', () => comServidor(async ({ p, t, c }) => {
  const teto = `--teto-bytes=${TETO_PADRAO}`;
  const casos: [string, Record<string, unknown>, string[]][] = [
    ['ork_grafo_chamadores', { alvo: 'alvo' }, ['chamadores', 'alvo', '--json', teto]],
    ['ork_grafo_importadores', { alvo: 'src/alvo.ts', profundidade: 2 }, ['importadores', 'src/alvo.ts', '--profundidade=2', '--json', teto]],
    ['ork_grafo_vizinhos', { alvo: 'src/alvo.ts#alvo', profundidade: 2, sentido: 'entrada', tipos: ['calls', 'declares'], limite: 3, tetoBytes: 8192 },
      ['vizinhos', 'src/alvo.ts#alvo', '--profundidade=2', '--sentido=entrada', '--tipo=calls,declares', '--limite=3', '--json', '--teto-bytes=8192']],
    ['ork_grafo_caminho', { de: 'docs/x.md', para: 'alvo', sentido: 'saida' }, ['caminho', 'docs/x.md', 'alvo', '--sentido=saida', '--json', teto]],
  ];
  for (const [nome, args, argv] of casos) {
    const r = await chamar(c, nome, { threadId: t.id, ...args });
    const cli = grafo(p.dir, ...argv);
    assert.equal(cli.codigo, 0, cli.saida);
    assert.equal(r.erro, false, `${nome}: ${r.texto}`);
    assert.equal(r.texto, cli.saida, nome);
    const o = JSON.parse(r.texto);
    assert.equal(o.schema, 'ork.code-graph-query/v0');
    assert.ok(o.arestas.length >= 1, nome);
    for (const a of o.arestas) {
      assert.ok(a.evidencias.length >= 1, `${nome} ${a.edge_id}`);
      for (const e of a.evidencias) {
        assert.ok(e.extractor_id && e.extractor_version && e.extraction_method && e.path, nome);
        assert.ok(Number.isInteger(e.span.byte_start) && Number.isInteger(e.span.byte_end) && Number.isInteger(e.span.line_start), nome);
      }
    }
  }
  assert.equal(JSON.parse((await chamar(c, 'ork_grafo_vizinhos', { threadId: t.id, alvo: 'src/alvo.ts#alvo', profundidade: 2, sentido: 'entrada', limite: 3 })).texto).truncado, true);
}));

test('KG5 contrato: recusa da consulta vem como o JSON da CLI, com isError', () => comServidor(async ({ p, t, c }) => {
  const teto = `--teto-bytes=${TETO_PADRAO}`;
  for (const [nome, alvo, sub, codigo] of [
    ['ork_grafo_chamadores', 'repetido', 'chamadores', 'grafo.consulta.ambiguo'],
    ['ork_grafo_chamadores', 'nada', 'chamadores', 'grafo.consulta.no-desconhecido'],
    ['ork_grafo_chamadores', 'src/alvo.ts', 'chamadores', 'grafo.consulta.alvo-invalido'],
    ['ork_grafo_importadores', 'docs/x.md#x', 'importadores', 'grafo.consulta.alvo-invalido'],
  ] as const) {
    const r = await chamar(c, nome, { threadId: t.id, alvo });
    assert.equal(r.erro, true, alvo);
    assert.equal(r.texto, grafo(p.dir, sub, alvo, '--json', teto).saida, alvo);
    assert.equal(JSON.parse(r.texto).erro.codigo, codigo, alvo);
  }
  assert.deepEqual(JSON.parse((await chamar(c, 'ork_grafo_chamadores', { threadId: t.id, alvo: 'repetido' })).texto).erro.candidatos,
    ['symbol src/alvo.ts#repetido', 'symbol src/outro.ts#repetido']);
}));

test('KG5 contrato: no com -- no inicio, parametro desconhecido ou fora da faixa recusam antes do worker', () => comServidor(async ({ t, c }) => {
  for (const [nome, args] of [
    ['ork_grafo_chamadores', { alvo: '--json' }],
    ['ork_grafo_caminho', { de: 'docs/x.md', para: '--projeto=outro' }],
    ['ork_grafo_chamadores', { alvo: 'alvo', forcar: true }],
    ['ork_grafo_chamadores', { alvo: 'alvo', sentido: 'entrada' }],
    ['ork_grafo_vizinhos', { alvo: 'alvo', profundidade: 6 }],
    ['ork_grafo_vizinhos', { alvo: 'alvo', tipos: [] }],
    ['ork_grafo_vizinhos', { alvo: 'alvo', tipos: ['usa'] }],
    ['ork_grafo_vizinhos', { alvo: 'alvo', limite: 0 }],
    ['ork_grafo_chamadores', { alvo: 'alvo', tetoBytes: 4095 }],
    ['ork_grafo_chamadores', { alvo: 'alvo', tetoBytes: 65537 }],
    ['ork_grafo_chamadores', { alvo: '' }],
  ] as const) {
    const r = await chamar(c, nome, { threadId: t.id, ...args });
    assert.equal(r.erro, true, JSON.stringify(args));
    assert.ok(!r.texto.includes('ork.code-graph-query'), `${JSON.stringify(args)} chegou ao worker`);
  }
}));

test('KG5 indice: tool sem indice diz nao indexado; com indice de outra revisao, indice velho; os dois com a correcao', () => comServidor(async ({ p, t, c }) => {
  const consultar = async () => chamar(c, 'ork_grafo_chamadores', { threadId: t.id, alvo: 'alvo' });
  let r = await consultar();
  assert.equal(r.erro, true);
  let e = JSON.parse(r.texto).erro;
  assert.deepEqual([e.codigo, e.estado_do_indice, e.correcao], ['grafo.indice.ausente', 'nao-indexado', 'ork grafo indexar']);
  indexar(p.dir);
  commitar(p.dir, 'src/novo.ts', "import { alvo } from './alvo';\nexport function novo(): number { return alvo(); }\n", 'novo');
  r = await consultar();
  assert.equal(r.erro, true);
  e = JSON.parse(r.texto).erro;
  assert.deepEqual([e.codigo, e.estado_do_indice, e.correcao], ['grafo.indice.outra-revisao', 'outra-revisao', 'ork grafo indexar']);
  indexar(p.dir);
  r = await consultar();
  assert.equal(r.erro, false, r.texto);
  assert.deepEqual(JSON.parse(r.texto).arestas.map((a: { from: string }) => a.from).sort(),
    ['symbol src/novo.ts#novo', 'symbol src/usa.ts#dois', 'symbol src/usa.ts#um']);
}, { indexar: false }));

test('KG5 indice: flag desligada com a sessao aberta recusa sem consultar', () => comServidor(async ({ p, t, c }) => {
  assert.equal((await chamar(c, 'ork_grafo_chamadores', { threadId: t.id, alvo: 'alvo' })).erro, false);
  const manifesto = path.join(p.dir, 'orkastery.yaml');
  fs.writeFileSync(manifesto, fs.readFileSync(manifesto, 'utf8').replace('  mcp: true', '  mcp: false'));
  const r = await chamar(c, 'ork_grafo_chamadores', { threadId: t.id, alvo: 'alvo' });
  assert.equal(r.erro, true);
  assert.match(JSON.parse(r.texto).erro, /^grafo\.mcp\.desligado: /);
}));

test('KG5 indice: sessao vinculada a uma thread nao consulta a worktree de outra', () => comServidor(async ({ p, t, c }) => {
  const outra = novaThread(p.carregado, { nome: 'outra', modo: 'auto' }).thread;
  const r = await chamar(c, 'ork_grafo_chamadores', { threadId: outra.id, alvo: 'alvo' });
  assert.equal(r.erro, true);
  assert.match(r.texto, /mcp\.thread\.scope/);
  assert.equal((await chamar(c, 'ork_grafo_chamadores', { threadId: t.id, alvo: 'alvo' })).erro, false);
}, { vinculada: true }));

test('KG5 indice: na thread com worktree, a tool responde pelo HEAD da worktree, nao pelo da raiz', () => comServidor(async ({ p, t, c }) => {
  const wt = t.worktree as string;
  assert.notEqual(wt, p.dir);
  const head = commitar(wt, 'src/tres.ts', "import { alvo } from './alvo';\nexport function tres(): number { return alvo(); }\n", 'na worktree');
  indexar(wt);
  const r = await chamar(c, 'ork_grafo_chamadores', { threadId: t.id, alvo: 'alvo' });
  assert.equal(r.erro, false, r.texto);
  const o = JSON.parse(r.texto);
  assert.equal(o.indice.revision, head);
  assert.ok(o.arestas.some((a: { from: string }) => a.from === 'symbol src/tres.ts#tres'));
  assert.equal(r.texto, grafo(wt, 'chamadores', 'alvo', '--json', `--teto-bytes=${TETO_PADRAO}`).saida);
}, { worktree: true }));

// ---------------------------------------------------------------------------
// O worker (T4).
// ---------------------------------------------------------------------------

/** Espera o processo sumir da tabela (o Node colhe o filho morto); reprova se ele ficar. */
async function semProcesso(pid: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`o worker ${pid} ficou vivo`);
}

test('KG5 worker: so roda as quatro consultas no argv que a tool monta, na raiz conferida', () => {
  const r = repositorio(REPO, 'kg5-worker');
  try {
    indexar(r.dir);
    const argv = ['chamadores', 'alvo', '--json', '--teto-bytes=32768'];
    const partes: string[] = [];
    assert.equal(rodarConsulta({ raiz: r.dir, argv }, r.dir, (x) => partes.push(x)), 0);
    assert.equal(partes.join(''), grafo(r.dir, ...argv).saida);
    const recusa = (entrada: unknown, cwd: string, motivo: RegExp): void => {
      assert.throws(() => rodarConsulta(entrada, cwd, () => undefined), motivo, JSON.stringify(entrada));
    };
    const pedido = (...a: string[]) => ({ raiz: r.dir, argv: a });
    recusa({ raiz: r.dir }, r.dir, /^Error: grafo\.mcp\.worker: pedido fora do schema$/);
    recusa({ ...pedido(...argv), extra: 1 }, r.dir, /pedido fora do schema/);
    recusa({ raiz: 'relativa', argv }, r.dir, /pedido fora do schema/);
    const fora = dirTemporario('kg5-fora');
    try {
      recusa(pedido(...argv), fora, /o cwd nao e a raiz pedida/);
    } finally {
      fs.rmSync(fora, { recursive: true, force: true });
    }
    for (const sub of ['indexar', 'limpar', 'amostra', 'status', 'constructor']) recusa(pedido(sub, 'x', '--json', '--teto-bytes=100'), r.dir, /so as consultas/);
    recusa(pedido('chamadores', '--forcar', '--json', '--teto-bytes=100'), r.dir, /no ausente ou com -- no inicio/);
    recusa(pedido('caminho', 'docs/x.md', '--json', '--teto-bytes=100'), r.dir, /no ausente ou com -- no inicio/);
    recusa(pedido('chamadores', 'alvo', '--json', '--limite=5'), r.dir, /opcoes fora das que a tool monta/);
    recusa(pedido('chamadores', 'alvo', '--teto-bytes=100', '--limite=5'), r.dir, /opcoes fora das que a tool monta/);
    recusa(pedido('chamadores', 'alvo', '--json', '--teto-bytes=100', '--projeto=outro'), r.dir, /opcoes fora das que a tool monta/);
    recusa(pedido('chamadores', 'alvo', '--json', '--teto-bytes=100', '--limite=5;x'), r.dir, /opcoes fora das que a tool monta/);
    recusa(pedido('chamadores', 'alvo', '--json', '--teto-bytes=100', '--version'), r.dir, /opcoes fora das que a tool monta/);
  } finally {
    r.limpar();
  }
});

test('KG5 worker: o processo responde como a CLI e, cancelado ou fora do prazo, morre sem deixar processo', async () => {
  const r = repositorio(REPO, 'kg5-processo');
  try {
    indexar(r.dir);
    const argv = ['chamadores', 'alvo', '--json', '--teto-bytes=32768'];
    const ok = await consultarPeloWorker(r.dir, argv);
    assert.deepEqual([ok.codigo, ok.interrompido], [0, null], ok.erro);
    assert.equal(ok.saida, grafo(r.dir, ...argv).saida);
    const recusado = await consultarPeloWorker(r.dir, ['indexar', 'x', '--json', '--teto-bytes=1']);
    assert.equal(recusado.codigo, 2);
    assert.match(recusado.erro, /^grafo\.mcp\.worker: so as consultas/);
    const ctl = new AbortController();
    const pendente = consultarPeloWorker(r.dir, argv, { signal: ctl.signal });
    ctl.abort();
    const cancelada = await pendente;
    assert.equal(cancelada.interrompido, 'cancelada');
    const fora = await consultarPeloWorker(r.dir, argv, { prazoMs: 1 });
    assert.equal(fora.interrompido, 'prazo de 1 ms');
    for (const pid of [cancelada.pid, fora.pid]) {
      assert.ok(pid);
      await semProcesso(pid);
    }
    const antes = new AbortController();
    antes.abort();
    assert.deepEqual(await consultarPeloWorker(r.dir, argv, { signal: antes.signal }), { codigo: null, saida: '', erro: '', interrompido: 'cancelada', pid: null });
  } finally {
    r.limpar();
  }
});

// ---------------------------------------------------------------------------
// O despacho claude-bg (T5).
// ---------------------------------------------------------------------------

const NOMES_DO_GRAFO_NO_CLAUDE = TOOLS_DO_GRAFO.map((nome) => `mcp__orkastery__${nome}`);
const valorDe = (args: string[], flag: string): string[] => {
  const i = args.indexOf(flag);
  return i < 0 ? [] : args[i + 1].split(',');
};
/** O comando sem o valor da allowlist: o que nao pode mudar com a flag. */
const semAllowlist = (args: string[]): string[] => args.map((x, i) => (args[i - 1] === '--allowedTools' ? '<allowlist>' : x));

function despacho(perfil: 'interactive' | 'worktree'): { p: ProjetoDeTeste; t: Thread; comando: (plano: boolean) => string[] } {
  const p = projetoTemporario(`kg5-despacho-${perfil}`);
  instalarAdaptador('claude-code', { projeto: p.dir });
  instalarMcp({ projeto: p.dir, host: 'claude-code', permissoesFilho: perfil });
  const t = novaThread(p.carregado, { nome: 'despacho', modo: 'auto', criarWorktree: true }).thread;
  const contexto = contextoDoProjeto(p.dir, 'claude-bg', t.worktree as string, t.id);
  assert.ok(contexto, 'projeto preparado pelo instalador');
  return {
    p, t,
    comando: (plano) => montarComando({ cwd: t.worktree as string, nome: 'kg5-despacho', prompt: 'consulta', contextoRuntime: contexto, ...(plano ? { colaboracao: 'plan' as const } : {}) }),
  };
}

test('KG5 despacho: com a flag da raiz, as quatro tools entram logo depois das consultas, em todas as fases; sem ela, o comando de sempre', () => {
  for (const perfil of ['interactive', 'worktree'] as const) {
    const f = despacho(perfil);
    try {
      const manifesto = path.join(f.p.dir, 'orkastery.yaml'), original = fs.readFileSync(manifesto, 'utf8');
      const antes = [f.comando(false), f.comando(true)];
      fs.writeFileSync(manifesto, `${original}\n${FLAG_LIGADA}`);
      const depois = [f.comando(false), f.comando(true)];
      antes.forEach((a, i) => {
        const allow = valorDe(a, '--allowedTools'), comFlag = valorDe(depois[i], '--allowedTools');
        assert.ok(!allow.some((x) => x.includes('ork_grafo_')), `${perfil}: sem a flag, nenhuma tool do grafo`);
        const fim = allow.indexOf('mcp__orkastery__ork_claims_list') + 1;
        assert.ok(fim > 0, `${perfil}: as consultas estao na allowlist`);
        assert.deepEqual(comFlag, [...allow.slice(0, fim), ...NOMES_DO_GRAFO_NO_CLAUDE, ...allow.slice(fim)], `${perfil} ${i ? 'PLAN' : 'fase'}`);
        assert.deepEqual(semAllowlist(depois[i]), semAllowlist(a), `${perfil}: fora a allowlist, o comando e o mesmo`);
      });
      fs.writeFileSync(manifesto, `${original}\ngrafo:\n  mcp: false\n`);
      assert.deepEqual([f.comando(false), f.comando(true)], antes, `${perfil}: com mcp false, o comando de antes`);
    } finally {
      f.p.limpar();
    }
  }
});

test('KG5 despacho: a flag no manifesto da worktree da thread nao liga as tools', () => {
  const f = despacho('worktree');
  try {
    const antes = f.comando(false);
    fs.writeFileSync(path.join(f.t.worktree as string, 'orkastery.yaml'), `${fs.readFileSync(path.join(f.p.dir, 'orkastery.yaml'), 'utf8')}\n${FLAG_LIGADA}`);
    assert.deepEqual(f.comando(false), antes);
    assert.ok(!valorDe(f.comando(true), '--allowedTools').some((x) => x.includes('ork_grafo_')));
  } finally {
    f.p.limpar();
  }
});

// ---------------------------------------------------------------------------
// O validador da medida offline (T6).
// ---------------------------------------------------------------------------

const MEDIDA = require(path.resolve(__dirname, '../../scripts/medir-mcp-grafo.cjs')) as { CONCLUSAO: string; LIMITES: string[]; validar: (r: unknown) => string[] };
const PERGUNTAS_DO_KG3 = (require(path.resolve(__dirname, '../../scripts/medir-consulta-grafo.cjs')) as { PERGUNTAS: { id: string; cru: { indisponivel?: string } }[] }).PERGUNTAS;

/** Um registro de forma valida, com numeros sinteticos: so o validador e o alvo deste teste. */
function registroSintetico(): Record<string, any> {
  const tokens = { value: null, source: 'unavailable', unavailable_reason: 'sem tokenizador exato nem contagem do runtime' };
  return {
    schema: 'ork.graph-mcp-cost/v0', medido_em: '2026-10-02T05:00:00.000Z', revisao: 'a'.repeat(40), teto_padrao: TETO_PADRAO,
    maquina: { node: 'v22', plataforma: 'linux', cpus: 8, carga_1min: 1 },
    preparo_do_indice: { ms: 1, bytes_do_indice: 1, fontes: 1, arestas: 1 },
    descoberta: { tools: [...TOOLS_DO_GRAFO], bytes_das_tools: 4000, tools_sem_flag: 30, tools_com_flag: 34, bytes_tools_list_sem_flag: 30000, bytes_tools_list_com_flag: 34000 },
    perguntas: PERGUNTAS_DO_KG3.map((p) => ({
      id: p.id,
      tool: { bytes_ao_agente: 1000, arestas_devolvidas: 1, total_arestas: 1, cortado: false, evidencias: 1, arquivos_abertos: 0, latencia_ms: [1], latencia_mediana_ms: 1 },
      cli: { bytes_ao_agente: 1200, arestas_devolvidas: 1, total_arestas: 1, evidencias: 1, latencia_ms: [1], latencia_mediana_ms: 1 },
      cru: p.cru.indisponivel ? { indisponivel: 'sem procedimento fixo' } : { bytes_grep: 1, bytes_arquivos: 1, bytes_ao_agente: 2, ocorrencias: 1, arquivos_abertos: 1, latencia_mediana_ms: 1 },
      tokens: { tool: tokens, cli: tokens, cru: tokens },
    })),
    conclusao: MEDIDA.CONCLUSAO, limites: [...MEDIDA.LIMITES],
  };
}

test('KG5 medida: o validador aceita o registro de forma valida e recusa promessa, token sem medida, tarefa faltando e tool acima do teto', () => {
  assert.deepEqual(MEDIDA.validar(registroSintetico()), []);
  const com = (mudar: (r: Record<string, any>) => void): string[] => {
    const r = registroSintetico();
    mudar(r);
    return MEDIDA.validar(r);
  };
  assert.deepEqual(com((r) => { r.conclusao = 'a tool reduz o contexto do agente'; }), ['conclusao', 'promessa de economia']);
  assert.deepEqual(com((r) => { r.limites.push('economia de 90% medida'); }), ['promessa de economia']);
  assert.deepEqual(com((r) => { r.perguntas[0].tokens.tool = { value: 1200, source: 'runtime_reported', unavailable_reason: null }; }), ['P1 tokens']);
  assert.match(com((r) => { r.perguntas.pop(); })[0], /^perguntas P1,P2,P3,P4,P5$/);
  assert.deepEqual(com((r) => { r.perguntas[1].tool.bytes_ao_agente = TETO_PADRAO + 1; }), ['P2 tool acima do teto']);
  assert.deepEqual(com((r) => { r.perguntas[2].tool.arestas_devolvidas = 2; }), ['P3 tool sem corte com outra resposta']);
  assert.deepEqual(com((r) => { r.descoberta.tools_com_flag = 33; }), ['descoberta']);
  assert.deepEqual(com((r) => { r.teto_padrao = 65536; }), ['teto_padrao']);
});

// ---------------------------------------------------------------------------
// CHECK rodada 1: o que a revisao independente pediu.
// ---------------------------------------------------------------------------

test('KG5 indice: cli nao toma indice de outro repositorio nem indice com problema pelo do HEAD', () => {
  const r = repositorio(REPO, 'kg5-outro-repo');
  try {
    // O mesmo HEAD indexado com outro repositorio: e outra identidade, nao outro extrator.
    assert.equal(executarGrafo(['indexar'], { raiz: r.dir, estado: raizDoEstado(r.dir), repositorio: 'outro', escrever: () => undefined }), 0);
    let e = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json').saida).erro;
    assert.deepEqual([e.codigo, e.estado_do_indice], ['grafo.indice.ausente', 'nao-indexado']);
    // Indice de outra revisao que nao passa na leitura nao vira indice velho: so os integros contam.
    indexar(r.dir);
    const status = JSON.parse(grafo(r.dir, 'status', '--json').saida);
    fs.writeFileSync(path.join(r.dir, 'src/novo.ts'), 'export const novo = 1;\n');
    r.git('add', '--', 'src/novo.ts');
    r.git('commit', '-q', '-m', 'dois');
    fs.truncateSync(path.join(status.dir, status.chave_do_head, 'grafo.json'), 10);
    e = JSON.parse(grafo(r.dir, 'chamadores', 'alvo', '--json').saida).erro;
    assert.deepEqual([e.codigo, e.estado_do_indice], ['grafo.indice.ausente', 'nao-indexado']);
  } finally {
    r.limpar();
  }
});

type Manipulador = (args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>;

test('KG5 indice: tool recusa indisponivel quando o worker passa do prazo ou sai com 2, e worktree fora do projeto', async () => {
  const raiz = dirTemporario('kg5-handler'), fora = dirTemporario('kg5-fora-do-projeto');
  const manipuladores = new Map<string, Manipulador>();
  const registrar = ((nome: string, _config: unknown, manipulador: Manipulador) => { manipuladores.set(nome, manipulador); }) as unknown as Parameters<typeof registrarConsultasDoGrafo>[0];
  try {
    const semManifesto = path.join(raiz, 'arvore');
    fs.mkdirSync(semManifesto);
    const chamadores = (worktree: string, prazoMs?: number): Manipulador => {
      manipuladores.clear();
      registrarConsultasDoGrafo(registrar, { raiz, carregar: () => ({ manifesto: { grafo: { mcp: true } } }), thread: () => ({ worktree }), prazoMs });
      return manipuladores.get('ork_grafo_chamadores') as Manipulador;
    };
    const extra = { signal: new AbortController().signal }, args = { threadId: 'ork-kg5', alvo: 'alvo' };
    // Arvore sem manifesto: o worker recusa a entrada (saida 2), e a tool diz que nao respondeu.
    await assert.rejects(chamadores(semManifesto)(args, extra), /^Error: grafo\.mcp\.indisponivel: o worker saiu com 2: /);
    await assert.rejects(chamadores(semManifesto, 1)(args, extra), /^Error: grafo\.mcp\.indisponivel: consulta interrompida \(prazo de 1 ms\)$/);
    await assert.rejects(chamadores(fora)(args, extra), /^Error: mcp\.scope\.violation: worktree fora do projeto$/);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('KG5 worker: o worker abre o proprio grupo, e o cancelamento mata o grupo inteiro', { skip: process.platform !== 'linux' }, async () => {
  const r = repositorio(REPO, 'kg5-grupo');
  try {
    indexar(r.dir);
    const ctl = new AbortController();
    let lider = 0, grupo = -1;
    // CHECK rodada 2 (N1): o cancelamento sai no proprio gancho, antes de o worker poder terminar sozinho.
    const c = await consultarPeloWorker(r.dir, ['chamadores', 'alvo', '--json', '--teto-bytes=32768'], {
      signal: ctl.signal,
      aoIniciar: (pid) => {
        lider = pid;
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        grupo = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
        ctl.abort();
      },
    });
    assert.equal(c.interrompido, 'cancelada', JSON.stringify(c));
    assert.ok(lider > 0);
    assert.equal(grupo, lider, 'o worker e lider do proprio grupo');
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(-lider, 0);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`o grupo ${lider} ficou com processo`);
  } finally {
    r.limpar();
  }
});

test('KG5 medida: o registro do repositorio e valido e foi medido com o teto padrao', () => {
  const registro = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/kg5-medida-mcp.json'), 'utf8'));
  assert.deepEqual(MEDIDA.validar(registro), []);
  assert.equal(registro.teto_padrao, TETO_PADRAO);
});

test('KG5 flag: servidor sobe sem conferir o estado do projeto no startup, com ou sem a flag, e a tool recusa na chamada', async () => {
  const p = projetoTemporario('kg5-estado-fora');
  const alheio = dirTemporario('kg5-estado-alheio');
  try {
    const estado = path.join(p.dir, '.orkastery');
    fs.rmSync(estado, { recursive: true, force: true });
    fs.symlinkSync(alheio, estado);
    const manifesto = path.join(p.dir, 'orkastery.yaml'), base = fs.readFileSync(manifesto, 'utf8');
    for (const bloco of ['', FLAG_LIGADA]) {
      fs.writeFileSync(manifesto, `${base}\n${bloco}`);
      const { c, fechar } = await conectar(p.dir);
      try {
        const nomes = (await c.listTools()).tools.map((t) => t.name);
        assert.equal(nomes.includes('ork_grafo_chamadores'), bloco !== '');
        if (bloco) {
          const r = await chamar(c, 'ork_grafo_chamadores', { threadId: 'ork-kg5', alvo: 'alvo' });
          assert.equal(r.erro, true);
          assert.match(r.texto, /mcp\.scope\.violation: estado fora do projeto/);
        }
      } finally {
        await fechar();
      }
    }
  } finally {
    p.limpar();
    fs.rmSync(alheio, { recursive: true, force: true });
  }
});
