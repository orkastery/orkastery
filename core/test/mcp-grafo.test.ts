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
import { carregarManifesto } from '../src/manifest';
import { raizDoEstado } from '../src/estado-thread';
import { executarGrafo } from '../src/intelligence-graph-cli';
import { dirTemporario } from './apoio';

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

/** `ork grafo` pelo modulo, na raiz pedida; erro lancado vira `{ codigo: null, erro }`. */
function grafo(dir: string, ...argv: string[]): { codigo: number | null; saida: string; erro: string | null } {
  const partes: string[] = [];
  try {
    const codigo = executarGrafo(argv, { raiz: dir, estado: raizDoEstado(dir), repositorio: 'demo', escrever: (t) => partes.push(t) });
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
    assert.equal(e.detalhe, `o HEAD ${head.slice(0, 12)} nao tem indice; o guardado e de outra revisao (${antiga.slice(0, 12)}); rode ork grafo indexar`);
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
    assert.match(e.detalhe, /^ha indice do HEAD [0-9a-f]{12} de outro extrator \(.*\); rode ork grafo indexar$/);
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
