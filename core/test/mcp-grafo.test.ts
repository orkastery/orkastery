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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto } from '../src/manifest';
import { dirTemporario } from './apoio';

const MANIFESTO_MINIMO = 'project:\n  name: "demo"\n  abbrev: "dem"\n';

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
