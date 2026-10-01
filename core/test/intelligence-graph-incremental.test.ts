/**
 * RM-031 KG4: indice incremental do grafo.
 *
 * Grupos: "KG4 equivalencia" (D1 a D4: o indice construido a partir do indice da revisao anterior
 * grava os mesmos bytes da extracao completa, com renome, remocao, arquivo novo e as mudancas que
 * atravessam arquivos, e reextrai so o que a mudanca alcanca), "KG4 queda" (D5: sem base que prove,
 * extracao completa com o motivo; TypeScript inteiro quando a mudanca toca `package.json` ou arquivo
 * global) e "KG4 cli" (D7: a saida, o `--verificar` contra a completa e a integridade das unidades).
 * A prova de cada caso: depois do incremental, `--forcar` extrai completo e so da
 * `reconstruido-identico` se os quatro arquivos do indice sao iguais byte a byte. Repositorios Git
 * temporarios.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { raizDoEstado } from '../src/estado-thread';
import type { Parser } from '../src/intelligence-graph-extract';
import { executarGrafo } from '../src/intelligence-graph-cli';
import {
  INDICE_SCHEMA, construirIndice, escolherBase, estadoDosIndices, lerIndice, perfilDoIndice, versoesDoParser,
  type ContextoDoIndice, type ResultadoDaConstrucao,
} from '../src/intelligence-graph-index';
import { carregarAnalisadores } from '../src/intelligence-graph-parsers';
import { dirTemporario } from './apoio';

const PARSER = carregarAnalisadores();
const BASE = { '.gitignore': '.orkastery/\n', 'orkastery.yaml': 'project:\n  name: "demo"\n  abbrev: "dem"\n' };

/** Repositorio Git temporario com identidade local, sem assinatura e com o estado do ork ignorado. */
function repositorioGit(arquivos: Record<string, string>, nome: string): { dir: string; git: (...args: string[]) => string } {
  const dir = dirTemporario(nome);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString('utf8');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'teste@orkastery.local');
  git('config', 'user.name', 'Teste Orkastery');
  git('config', 'commit.gpgsign', 'false');
  mudar({ dir, git }, { ...BASE, ...arquivos }, 'inicial');
  return { dir, git };
}

/** Escreve (texto) ou apaga (`null`) cada caminho e commita; devolve o HEAD novo. */
function mudar(repo: { dir: string; git: (...args: string[]) => string }, mudancas: Record<string, string | null>, mensagem = 'mudanca'): string {
  for (const [p, c] of Object.entries(mudancas)) {
    const alvo = path.join(repo.dir, p);
    if (c === null) {
      repo.git('rm', '-q', '--', p);
      continue;
    }
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, c);
    repo.git('add', '--', p);
  }
  repo.git('commit', '-q', '-m', mensagem);
  return repo.git('rev-parse', 'HEAD').trim();
}

const contexto = (dir: string): ContextoDoIndice => ({ raiz: dir, estado: raizDoEstado(dir) });
const modo = (p: string): number => fs.statSync(p).mode & 0o777;
const relatorioDe = (r: ResultadoDaConstrucao): { lacunas: { categoria: string; path: string }[]; lacunas_por_categoria: Record<string, number> } =>
  JSON.parse(fs.readFileSync(path.join(r.dir, 'relatorio.json'), 'utf8'));

interface Prova { base: ResultadoDaConstrucao; incremental: ResultadoDaConstrucao; completa: ResultadoDaConstrucao }

/**
 * Indice completo da revisao inicial, a mudanca commitada, o incremental a partir dele e a completa
 * por `--forcar`, que so da `reconstruido-identico` com os quatro arquivos iguais.
 */
function provar(nome: string, arquivos: Record<string, string>, mudancas: Record<string, string | null>,
  conferir?: (p: Prova, dir: string) => void): Prova {
  const repo = repositorioGit(arquivos, nome);
  try {
    const ctx = contexto(repo.dir);
    const base = construirIndice(ctx, { parser: PARSER });
    assert.equal(base.modo, 'completo');
    mudar(repo, mudancas);
    const incremental = construirIndice(ctx, { parser: PARSER });
    assert.equal(incremental.modo, 'incremental', incremental.motivo_completo ?? '');
    assert.equal(incremental.base?.revision, base.manifesto.revision);
    const completa = construirIndice(ctx, { parser: PARSER, forcar: true });
    assert.deepEqual([completa.estado, completa.modo, completa.motivo], ['reconstruido-identico', 'completo', null], 'os quatro arquivos iguais aos da completa');
    assert.equal(completa.manifesto.graph_digest, incremental.manifesto.graph_digest);
    const p = { base, incremental, completa };
    conferir?.(p, repo.dir);
    return p;
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
}

const reextraidos = (r: ResultadoDaConstrucao): { ts: string[]; md: string[]; modo: string } => ({
  ts: r.reaproveitamento?.ts.reextraidos ?? [], md: r.reaproveitamento?.md.reextraidos ?? [], modo: r.reaproveitamento?.ts.modo ?? '',
});

test('KG4 equivalencia: renome de modulo TypeScript e do alvo de link; so o renomeado e quem o importava sao reextraidos', () => {
  provar('kg4-renome', {
    'src/a.ts': "import { b } from './b';\nexport function a() { return b(); }\n",
    'src/b.ts': 'export function b() { return 1; }\n',
    'src/c.ts': 'export function c() { return 3; }\n',
    'docs/x.md': '# X\n\nVeja [b](../src/b.ts) e [c](../src/c.ts).\n',
  }, { 'src/b.ts': null, 'src/b2.ts': 'export function b() { return 1; }\n' }, ({ incremental }) => {
    assert.deepEqual(reextraidos(incremental), { ts: ['src/a.ts', 'src/b2.ts'], md: [], modo: 'parcial' });
    assert.deepEqual(incremental.reaproveitamento?.mudanca, { alterados: 0, novos: 1, removidos: 1 });
    const r = relatorioDe(incremental);
    assert.ok(r.lacunas.some((l) => l.categoria === 'link-sem-alvo' && l.path === 'docs/x.md'), 'o link ao renomeado ficou sem alvo');
  });
});

test('KG4 equivalencia: remocao de modulo reexportado; quem o alcanca pela cadeia e reextraido', () => {
  provar('kg4-remocao', {
    'src/util.ts': 'export function u() { return 1; }\n',
    'src/idx.ts': "export * from './util';\n",
    'src/a.ts': "import { u } from './idx';\nexport function a() { return u(); }\n",
    'src/d.ts': "import './util';\nexport const d = 1;\n",
    'src/solto.ts': 'export function s() { return 2; }\n',
  }, { 'src/util.ts': null }, ({ incremental }) => {
    assert.deepEqual(reextraidos(incremental).ts, ['src/a.ts', 'src/d.ts', 'src/idx.ts']);
  });
});

test('KG4 equivalencia: arquivo novo resolve import que estava solto e da destino a ID citado em Markdown que nao mudou', () => {
  provar('kg4-novo', {
    'src/a.ts': "import { n } from './novo';\nexport function a() { return n(); }\n",
    'src/solto.ts': 'export function s() { return 2; }\n',
    'docs/x.md': '# X\n\nO item RM-007 ainda nao existe.\n',
  }, {
    'src/novo.ts': 'export function n() { return 1; }\n',
    'docs/RM-007-item.md': '---\nid: RM-007\ntipo: roadmap\n---\n\n# Item\n',
  }, ({ incremental }) => {
    assert.deepEqual(reextraidos(incremental), { ts: ['src/a.ts', 'src/novo.ts'], md: ['docs/RM-007-item.md'], modo: 'parcial' });
    const r = relatorioDe(incremental);
    assert.equal(r.lacunas_por_categoria['id-sem-artefato'] ?? 0, 0, 'a mencao do Markdown reaproveitado achou o artefato novo');
  });
});

test('KG4 equivalencia: mudanca no alvo importado reextrai quem chama, e o simbolo do frontmatter fica sem alvo', () => {
  provar('kg4-alvo', {
    'src/b.ts': 'export function f() { return 1; }\n',
    'src/a.ts': "import { f } from './b';\nexport function a() { return f(); }\n",
    'src/e.ts': 'export function e() { return 5; }\n',
    'docs/RM-001-x.md': '---\nid: RM-001\ntipo: roadmap\nfontes:\n  simbolos: [src/b.ts#f]\n---\n\n# X\n',
  }, { 'src/b.ts': 'export function g() { return 1; }\n' }, ({ incremental }) => {
    assert.deepEqual(reextraidos(incremental), { ts: ['src/a.ts', 'src/b.ts'], md: [], modo: 'parcial' });
    assert.ok(relatorioDe(incremental).lacunas.some((l) => l.categoria === 'frontmatter-sem-alvo'));
  });
});

test('KG4 equivalencia: export * que fica ambiguo muda o import de quem passa pelo indice, e nao o do outro ramo', () => {
  provar('kg4-ambiguo', {
    'src/b.ts': 'export function x() { return 1; }\n',
    'src/c.ts': 'export function y() { return 2; }\n',
    'src/idx.ts': "export * from './b';\nexport * from './c';\n",
    'src/a.ts': "import { x } from './idx';\nexport function a() { return x(); }\n",
  }, { 'src/c.ts': 'export function y() { return 2; }\nexport function x() { return 3; }\n' }, ({ incremental }) => {
    assert.deepEqual(reextraidos(incremental).ts, ['src/a.ts', 'src/c.ts', 'src/idx.ts']);
  });
});

test('KG4 equivalencia: .d.ts que ganha implementacao torna o import divergente e contamina a cadeia', () => {
  provar('kg4-divergente', {
    'src/lib.d.ts': 'export declare function f(): void;\n',
    'src/m.ts': "export * from './lib';\n",
    'src/a.ts': "import { f } from './m';\nexport function a() { return f(); }\n",
    'src/solto.ts': 'export function s() { return 2; }\n',
  }, { 'src/lib.js': 'exports.f = function () {};\n' }, ({ incremental }) => {
    assert.deepEqual(reextraidos(incremental).ts, ['src/a.ts', 'src/lib.js', 'src/m.ts']);
    assert.ok((relatorioDe(incremental).lacunas_por_categoria['import-divergente'] ?? 0) >= 1, 'o caso passa pelo import divergente');
  });
});

test('KG4 equivalencia: o tipo importado no JSDoc liga o JavaScript ao modulo da classe', () => {
  provar('kg4-jsdoc', {
    'src/t.ts': 'export class C { m() { return 1; } }\n',
    'src/a.js': "/** @this {import('./t').C} */\nfunction g() { return this.m(); }\nmodule.exports = { g };\n",
    'src/solto.ts': 'export function s() { return 2; }\n',
  }, { 'src/t.ts': 'export class C { n() { return 1; } }\n' }, ({ base, incremental }) => {
    assert.ok(relatorioDe(base).lacunas.some((l) => l.categoria === 'chamada-global-entre-arquivos' && l.path === 'src/a.js'), 'na base, a chamada passa pelo JSDoc');
    assert.deepEqual(reextraidos(incremental).ts, ['src/a.js', 'src/t.ts']);
  });
});

test('KG4 equivalencia: titulo renomeado deixa a ancora sem alvo; so o Markdown mudado e reestruturado e o TypeScript fica todo', () => {
  provar('kg4-markdown', {
    'docs/a.md': '# A\n\n## Secao\n\nVer [b](b.md#parte) e RM-002.\n',
    'docs/b.md': '# B\n\n## Parte\n',
    'docs/RM-002-c.md': '---\nid: RM-002\ntipo: roadmap\n---\n\n# C\n',
    'src/a.ts': 'export function a() { return 1; }\n',
  }, { 'docs/b.md': '# B\n\n## Outra\n' }, ({ incremental }) => {
    assert.deepEqual(reextraidos(incremental), { ts: [], md: ['docs/b.md'], modo: 'reaproveitado' });
    assert.ok(relatorioDe(incremental).lacunas.some((l) => l.categoria === 'ancora-nao-resolvida' && l.path === 'docs/a.md'));
  });
});

test('KG4 queda: sem indice anterior, extracao completa com o motivo', () => {
  const repo = repositorioGit({ 'src/a.ts': 'export const a = 1;\n' }, 'kg4-sem-base');
  try {
    const r = construirIndice(contexto(repo.dir), { parser: PARSER });
    assert.deepEqual([r.estado, r.modo, r.base, r.reaproveitamento], ['criado', 'completo', null, null]);
    assert.match(r.motivo_completo ?? '', /^nenhum indice/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('KG4 queda: extrator mudado, historico reescrito e base ilegivel extraem completo e dizem por que', () => {
  const repo = repositorioGit({ 'src/a.ts': 'export const a = 1;\n', 'docs/x.md': '# X\n' }, 'kg4-quedas');
  try {
    const ctx = contexto(repo.dir);
    // Extrator mudado: o indice ancestral e de outros analisadores.
    const outro: Parser = { ...PARSER, unicode: '1.0' };
    const r0 = construirIndice(ctx, { parser: outro });
    mudar(repo, { 'src/a.ts': 'export const a = 2;\n' });
    const r1 = construirIndice(ctx, { parser: PARSER });
    assert.equal(r1.modo, 'completo');
    assert.equal(r1.motivo_completo, `o extrator mudou desde o indice de ${r0.manifesto.revision.slice(0, 12)} (analisadores)`);
    // Historico reescrito: o indice do commit emendado fica fora da linha do HEAD.
    repo.git('commit', '-q', '--amend', '-m', 'emendado');
    mudar(repo, { 'docs/x.md': '# X\n\nmais\n' });
    const r2 = construirIndice(ctx, { parser: PARSER });
    assert.equal(r2.modo, 'completo');
    assert.equal(r2.motivo_completo, `nenhum indice de revisao ancestral nas ultimas 512; o de ${r1.manifesto.revision.slice(0, 12)} esta fora da linha do HEAD `
      + `(historico reescrito ou outro ramo); o extrator mudou desde o indice de ${r0.manifesto.revision.slice(0, 12)} (analisadores)`);
    // Base ilegivel: as unidades da base nao batem com o digest.
    fs.appendFileSync(path.join(r2.dir, 'unidades.json'), ' ');
    mudar(repo, { 'docs/x.md': '# X\n\nde novo\n' });
    const r3 = construirIndice(ctx, { parser: PARSER });
    assert.equal(r3.modo, 'completo');
    assert.equal(r3.motivo_completo, `base ilegivel (${r2.manifesto.revision.slice(0, 12)}: grafo.indice.corrompido: unidades.json nao bate com o digest)`);
    // Em todos, a completa de novo da os mesmos bytes.
    assert.equal(construirIndice(ctx, { parser: PARSER, forcar: true }).estado, 'reconstruido-identico');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('KG4 queda: package.json na mudanca extrai o TypeScript inteiro, com o motivo, e o Markdown segue da base', () => {
  provar('kg4-pacote', {
    'package.json': '{ "name": "demo", "version": "1.0.0" }\n',
    'src/a.js': "const b = require('./b');\nfunction a() { return b.b(); }\nmodule.exports = { a };\n",
    'src/b.js': 'function b() { return 1; }\nmodule.exports = { b };\n',
    'docs/x.md': '# X\n',
  }, { 'package.json': '{ "name": "demo", "version": "1.0.0", "type": "commonjs" }\n' }, ({ incremental }) => {
    const a = incremental.reaproveitamento;
    assert.deepEqual([a?.ts.modo, a?.ts.motivo, a?.ts.reextraidos], ['inteiro', 'package.json na mudanca (package.json)', ['src/a.js', 'src/b.js']]);
    assert.deepEqual([a?.md.reextraidos, a?.md.reaproveitados], [[], 1]);
  });
});

test('KG4 queda: arquivo global na mudanca, e arquivo que passa a declarar global, extraem o TypeScript inteiro', () => {
  provar('kg4-global', {
    'src/g.ts': 'function ola() { return 1; }\n',
    'src/a.ts': 'export function a() { return ola(); }\n',
    'src/b.ts': 'export function b() { return 2; }\n',
  }, { 'src/g.ts': 'function ola() { return 2; }\n' }, ({ incremental }) => {
    assert.deepEqual([incremental.reaproveitamento?.ts.modo, incremental.reaproveitamento?.ts.motivo], ['inteiro', 'arquivo global do TypeScript na mudanca (src/g.ts)']);
  });
  provar('kg4-vira-global', {
    'src/a.ts': 'export function a() { return 1; }\n',
    'src/b.ts': 'export function b() { return 2; }\n',
  }, { 'src/a.ts': 'export function a() { return 1; }\ndeclare global { function extra(): void }\n' }, ({ incremental }) => {
    assert.deepEqual([incremental.reaproveitamento?.ts.modo, incremental.reaproveitamento?.ts.motivo],
      ['inteiro', 'arquivo passa a declarar global no TypeScript (src/a.ts)']);
  });
});

test('KG4 cli: indexar diz o modo, a base e o que reextraiu; --verificar compara o incremental com a completa', () => {
  const repo = repositorioGit({
    'src/a.ts': "import { b } from './b';\nexport function a() { return b(); }\n", 'src/b.ts': 'export function b() { return 1; }\n', 'docs/x.md': '# X\n',
  }, 'kg4-cli');
  try {
    const ctx = contexto(repo.dir), saidas: string[] = [];
    const cli = { ...ctx, escrever: (t: string) => saidas.push(t) };
    assert.equal(executarGrafo(['indexar'], cli), 0);
    assert.match(saidas.pop() ?? '', /extracao {5}completa: nenhum indice/);
    const head = mudar(repo, { 'src/b.ts': 'export function b() { return 2; }\n' });
    assert.equal(executarGrafo(['indexar'], cli), 0);
    const texto = saidas.pop() ?? '';
    assert.match(texto, /extracao {5}incremental a partir do indice de [0-9a-f]{12}: 1 alterado\(s\), 0 novo\(s\), 0 removido\(s\)/);
    assert.match(texto, /TypeScript parcial, 2 reextraido\(s\) \(src\/a\.ts, src\/b\.ts\) num programa de 2, 0 da base/);
    assert.match(texto, /Markdown: 0 reextraido\(s\), 1 da base/);
    // --verificar: completa, determinismo e o incremental da base conferido byte a byte.
    assert.equal(executarGrafo(['indexar', '--verificar'], cli), 0);
    const v = saidas.pop() ?? '';
    assert.match(v, /incremental {2}a partir do indice de [0-9a-f]{12}: igual a completa nos quatro arquivos/);
    assert.match(v, /aprovado$/);
    mudar(repo, { 'docs/x.md': '# X\n\nnovo\n' });
    assert.equal(executarGrafo(['indexar', '--json'], cli), 0);
    const j = JSON.parse(saidas.pop() ?? '{}') as ResultadoDaConstrucao;
    assert.deepEqual([j.estado, j.modo, j.base?.revision, j.reaproveitamento?.ts.modo, j.reaproveitamento?.md.reextraidos], ['criado', 'incremental', head, 'reaproveitado', ['docs/x.md']]);
    assert.equal(j.manifesto.schema, INDICE_SCHEMA);
    // Quatro arquivos 0600 numa pasta 0700; a leitura confere o tamanho das unidades e, quando pedidas, o digest.
    assert.equal(modo(j.dir), 0o700);
    assert.deepEqual(fs.readdirSync(j.dir).sort(), ['grafo.json', 'indice.json', 'relatorio.json', 'unidades.json']);
    for (const n of fs.readdirSync(j.dir)) assert.equal(modo(path.join(j.dir, n)), 0o600, n);
    const lido = lerIndice(ctx, j.chave, { grafo: false, unidades: true });
    assert.equal(lido.unidades?.graph_digest, j.manifesto.graph_digest);
    const unidades = path.join(j.dir, 'unidades.json'), original = fs.readFileSync(unidades);
    fs.writeFileSync(unidades, Buffer.concat([original, Buffer.from(' ')]));
    assert.throws(() => lerIndice(ctx, j.chave, { grafo: false }), /grafo\.indice\.corrompido: unidades\.json nao bate com o tamanho/);
    assert.ok(estadoDosIndices(ctx).indices.find((i) => i.chave === j.chave)?.problema?.includes('unidades.json'));
    fs.writeFileSync(unidades, original);
    fs.chmodSync(unidades, 0o644);
    assert.throws(() => lerIndice(ctx, j.chave, { grafo: false }), /grafo\.indice\.permissao-invalida: unidades\.json/);
    fs.chmodSync(unidades, 0o600);
    assert.equal(lerIndice(ctx, j.chave, { grafo: false }).manifesto.units_digest, j.manifesto.units_digest);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('KG4 cli: --verificar reprova base adulterada com digest coerente, e o indexar sem ela cai para a completa', () => {
  const repo = repositorioGit({
    'src/a.ts': "import { b } from './b';\nexport function a() { return b(); }\n", 'src/b.ts': 'export function b() { return 1; }\n',
    'src/c.ts': 'export function c() { return 3; }\n',
  }, 'kg4-adulterada');
  try {
    const ctx = contexto(repo.dir);
    const r0 = construirIndice(ctx, { parser: PARSER });
    // Adultera as unidades da base (uma lacuna a mais no arquivo que nao muda) e acerta o manifesto.
    const arquivo = path.join(r0.dir, 'unidades.json'), u = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    u.arquivos.find((x: { path: string }) => x.path === 'src/c.ts').ts.achados.lacunas.push({ categoria: 'chamada-por-tipo', path: 'src/c.ts', inicio: 0, detalhe: null });
    const texto = JSON.stringify(u), manifesto = JSON.parse(fs.readFileSync(path.join(r0.dir, 'indice.json'), 'utf8'));
    fs.writeFileSync(arquivo, texto);
    fs.writeFileSync(path.join(r0.dir, 'indice.json'), JSON.stringify({
      ...manifesto, units_bytes: Buffer.byteLength(texto), units_digest: createHash('sha256').update(texto).digest('hex'),
    }));
    mudar(repo, { 'src/b.ts': 'export function b() { return 2; }\n' });
    assert.throws(() => construirIndice(ctx, { parser: PARSER, verificar: true }),
      new RegExp(`^Error: grafo\\.indice\\.incremental-divergente: base ${r0.manifesto.revision.slice(0, 12)}$`));
    // Base que quebra o plano (unidade sem sondas): o incremental falha e a completa decide, com o motivo.
    u.arquivos.find((x: { path: string }) => x.path === 'src/c.ts').ts.sondas = null;
    const quebrado = JSON.stringify(u);
    fs.writeFileSync(arquivo, quebrado);
    fs.writeFileSync(path.join(r0.dir, 'indice.json'), JSON.stringify({
      ...manifesto, units_bytes: Buffer.byteLength(quebrado), units_digest: createHash('sha256').update(quebrado).digest('hex'),
    }));
    mudar(repo, { 'src/b.ts': 'export function b() { return 3; }\n', 'src/novo.ts': 'export const n = 1;\n' });
    const r = construirIndice(ctx, { parser: PARSER });
    assert.equal(r.modo, 'completo');
    assert.match(r.motivo_completo ?? '', /^o incremental falhou e a extracao foi completa \(/);
    assert.equal(construirIndice(ctx, { parser: PARSER, forcar: true }).estado, 'reconstruido-identico');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('KG4 cli: indice do KG3 (v0) aparece como formato anterior e nao serve de base', () => {
  const repo = repositorioGit({ 'src/a.ts': 'export const a = 1;\n' }, 'kg4-v0');
  try {
    const ctx = contexto(repo.dir);
    const r = construirIndice(ctx, { parser: PARSER });
    const manifesto = JSON.parse(fs.readFileSync(path.join(r.dir, 'indice.json'), 'utf8'));
    fs.writeFileSync(path.join(r.dir, 'indice.json'), JSON.stringify({ ...manifesto, schema: 'ork.code-graph-index/v0' }));
    const status = estadoDosIndices(ctx).indices.find((i) => i.chave === r.chave);
    assert.match(status?.problema ?? '', /^grafo\.indice\.formato-anterior: ork\.code-graph-index\/v0 \(KG3\)/);
    const head = mudar(repo, { 'src/a.ts': 'export const a = 2;\n' });
    const perfil = perfilDoIndice(repo.dir, versoesDoParser(PARSER), { repository_id: 'demo' });
    assert.deepEqual(escolherBase(ctx, perfil, head, repo.dir), { base: null, motivo: 'so ha indice de formato anterior (ork.code-graph-index/v0)' });
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});
