/**
 * RM-031 KG3: analisadores no nucleo, indice persistente e o `ork grafo`.
 *
 * Grupos: "KG3 parsers" (D1: o compilador, o micromark e o juiz de sintaxe vem da instalacao do
 * `ork`, com as versoes do KG2), "KG3 index" (D2 a D4: chave, arvore limpa, idempotencia,
 * permissoes, integridade, corrida e limpeza) e "KG3 cli" (D7 e D8: `ork grafo` de ponta a ponta).
 * Os repositorios sao sinteticos, em Git temporario.
 */
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as ts from 'typescript';
import { estadoCanonico, raizDoEstado } from '../src/estado-thread';
import { extrairGrafo, type EntradaDeExtracao } from '../src/intelligence-graph-extract';
import {
  INDICE_SCHEMA, MODULOS_DO_EXTRATOR, chaveDoIndice, concessaoLocal, construirIndice, estadoDosIndices, impressaoDoExtrator,
  indiceDoHead, lerIndice, limparIndices, perfilDoIndice, type ContextoDoIndice,
} from '../src/intelligence-graph-index';
import { executarGrafo, lerPedido } from '../src/intelligence-graph-cli';
import { carregarAnalisadores, criarJuizDeSintaxe, PACOTES_DOS_ANALISADORES, versoesDosAnalisadores } from '../src/intelligence-graph-parsers';
import { revisaoDaArvore } from '../src/intelligence-graph-repo';
import { dirTemporario } from './apoio';

const MODULO_DOS_ANALISADORES = path.resolve(__dirname, '../src/intelligence-graph-parsers.js');

/** Roda um trecho num Node filho, com o cwd dado, e devolve o JSON que ele imprime. */
function noFilho(cwd: string, corpo: string, env: NodeJS.ProcessEnv = {}): { status: number | null; saida: unknown; erro: string } {
  const r = spawnSync(process.execPath, ['-e', corpo], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 120_000 });
  let saida: unknown = null;
  try {
    saida = JSON.parse(r.stdout);
  } catch {
    saida = r.stdout;
  }
  return { status: r.status, saida, erro: r.stderr };
}

test('KG3 parsers: versoes no formato do KG2, iguais as do modulo carregado e as dos extratores', () => {
  const v = versoesDosAnalisadores();
  const p = carregarAnalisadores();
  assert.equal(v.typescript, ts.version);
  assert.equal(p.ts.version, ts.version);
  assert.equal(v.javascript, `node.${process.versions.node}`);
  assert.equal(p.javascript.versao, v.javascript);
  assert.match(v.markdown, /^micromark\.[0-9]+\.[0-9]+\.[0-9]+\.gfm-table\.[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(p.markdown.versao, v.markdown);
  assert.equal(p.unicode, String(process.versions.unicode));
  assert.equal(v.unicode, p.unicode);
  const entrada: EntradaDeExtracao = {
    tenant_id: 'teste', repository_id: 'repo-teste', revision: null, revision_unavailable_reason: 'repositorio-sintetico',
    acl_refs: ['repo:repo-teste:leitura'],
    fontes: [{ path: 'a.ts', bytes: Buffer.from('export const a = 1;\n') }, { path: 'x.md', bytes: Buffer.from('# X\n') }],
  };
  const versoes = new Map(extrairGrafo(entrada, p).grafo.snapshot.extractors.map((e) => [e.extractor_id, e.extractor_version]));
  assert.equal(versoes.get('ork.ts-ast'), `1.0.0+typescript.${v.typescript}+${v.javascript}`);
  assert.equal(versoes.get('ork.md-structure'), `1.0.0+${v.markdown}+unicode.${v.unicode}`);
});

test('KG3 parsers: micromark com a tabela GFM e o decodificador de referencia do proprio micromark', () => {
  const { markdown } = carregarAnalisadores();
  const tipos = new Set(markdown.analisar('# Titulo\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n').filter((e) => e.entrada).map((e) => e.tipo));
  for (const t of ['atxHeading', 'table', 'tableRow', 'tableData', 'tableDelimiterRow']) assert.ok(tipos.has(t), t);
  const evento = markdown.analisar('é# x').find((e) => e.entrada && e.tipo === 'paragraph');
  assert.deepEqual([evento?.inicio, evento?.fim], [0, 4], 'offset em unidades UTF-16 do texto');
  assert.equal(markdown.referencia('eacute'), 'é');
  assert.equal(markdown.referencia('#233'), 'é');
  assert.equal(markdown.referencia('#xE9'), 'é');
  assert.equal(markdown.referencia('#x0'), '�');
  assert.equal(markdown.referencia('naoexiste'), null);
});

test('KG3 parsers: juiz de sintaxe do V8 decide CommonJS e ESM sem executar o codigo', () => {
  const dir = dirTemporario('kg3-juiz');
  try {
    const canario = (n: string) => path.join(dir, `canario-${n}`);
    const juiz = criarJuizDeSintaxe();
    assert.equal(juiz.versao, `node.${process.versions.node}`);
    const pedidos = [
      { texto: `require('node:fs').writeFileSync(${JSON.stringify(canario('cjs'))}, 'x');\n`, formato: 'cjs' as const },
      { texto: `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(canario('esm'))}, 'x');\n`, formato: 'esm' as const },
      { texto: `await import('node:fs').then((f) => f.writeFileSync(${JSON.stringify(canario('await'))}, 'x'));\n`, formato: 'esm' as const },
      { texto: `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(canario('hashbang'))}, 'x');\n`, formato: 'cjs' as const },
      { texto: "import x from './x';\n", formato: 'cjs' as const },
      { texto: 'return 1;\n', formato: 'esm' as const },
      { texto: 'return 1;\n', formato: 'cjs' as const },
      { texto: 'let a; let a;\n', formato: 'esm' as const },
    ];
    assert.deepEqual(juiz.sintaxe(pedidos), [true, true, true, true, false, false, true, false]);
    for (const n of ['cjs', 'esm', 'await', 'hashbang']) assert.ok(!fs.existsSync(canario(n)), `o juiz executou ${n}`);
    // Mesmo texto e formato: o veredito vem do cache, sem outro filho.
    assert.deepEqual(juiz.sintaxe([pedidos[1], pedidos[5]]), [true, false]);
    // O filho roda sem ambiente: um NODE_OPTIONS hostil de quem chama nao carrega codigo nele.
    const preload = path.join(dir, 'preload.js');
    fs.writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(canario('preload'))}, 'x');\n`);
    const antes = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `--require ${preload}`;
    try {
      assert.deepEqual(criarJuizDeSintaxe().sintaxe([{ texto: 'export const b = 2;\n', formato: 'esm' }]), [true]);
    } finally {
      if (antes === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = antes;
    }
    assert.ok(!fs.existsSync(canario('preload')), 'o filho herdou o NODE_OPTIONS');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 parsers: typescript falso no repositorio analisado e no diretorio atual nao e carregado', () => {
  const dir = dirTemporario('kg3-ts-falso');
  try {
    const canario = path.join(dir, 'canario');
    for (const pacote of ['typescript', 'micromark']) {
      fs.mkdirSync(path.join(dir, 'node_modules', pacote), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', pacote, 'package.json'), JSON.stringify({ name: pacote, version: '0.0.0-falso', main: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'node_modules', pacote, 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(canario)}, '${pacote}');\n`);
    }
    const r = noFilho(dir, `
      const m = require(${JSON.stringify(MODULO_DOS_ANALISADORES)});
      const p = m.carregarAnalisadores();
      process.stdout.write(JSON.stringify({ versoes: m.versoesDosAnalisadores(), ts: p.ts.version }));
    `, { NODE_PATH: path.join(dir, 'node_modules') });
    assert.equal(r.status, 0, r.erro);
    const saida = r.saida as { versoes: { typescript: string; markdown: string }; ts: string };
    assert.equal(saida.ts, ts.version);
    assert.equal(saida.versoes.typescript, ts.version);
    assert.ok(!saida.versoes.markdown.includes('falso'));
    assert.ok(!fs.existsSync(canario), 'carregou pacote do diretorio analisado');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 parsers: sem o pacote na instalacao, a recusa e grafo.parser.indisponivel com o nome dele', () => {
  const dir = dirTemporario('kg3-sem-parser');
  try {
    // O modulo compilado so importa o Node em tempo de execucao: sozinho, fora do core, nao acha os pacotes.
    const copia = path.join(dir, 'isolado', 'intelligence-graph-parsers.js');
    fs.mkdirSync(path.dirname(copia), { recursive: true });
    fs.copyFileSync(MODULO_DOS_ANALISADORES, copia);
    const r = noFilho(dir, `
      const m = require(${JSON.stringify(copia)});
      const erro = (f) => { try { f(); return null; } catch (e) { return e.message; } };
      process.stdout.write(JSON.stringify({ versoes: erro(() => m.versoesDosAnalisadores()), carga: erro(() => m.carregarAnalisadores()), pacotes: m.PACOTES_DOS_ANALISADORES }));
    `);
    assert.equal(r.status, 0, r.erro);
    const saida = r.saida as { versoes: string; carga: string; pacotes: string[] };
    assert.equal(saida.versoes, 'grafo.parser.indisponivel: typescript');
    assert.equal(saida.carga, 'grafo.parser.indisponivel: typescript');
    assert.deepEqual(saida.pacotes, [...PACOTES_DOS_ANALISADORES]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Repositorio Git temporario com identidade local, sem assinatura e com o estado do ork ignorado. */
function repositorioGit(arquivos: Record<string, string>, nome = 'kg3-repo'): { dir: string; git: (...args: string[]) => string } {
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
  if (Object.keys(arquivos).length) {
    git('add', '--', ...Object.keys(arquivos));
    git('commit', '-q', '-m', 'inicial');
  }
  return { dir, git };
}
const REPO = {
  '.gitignore': '.orkastery/\n',
  'orkastery.yaml': 'project:\n  name: "demo"\n  abbrev: "dem"\n',
  'src/a.ts': "import { b } from './b';\nexport function a() { return b(); }\n",
  'src/b.ts': 'export function b() { return 1; }\n',
  'docs/x.md': '# X\n\nVeja [a](../src/a.ts).\n',
};
const contexto = (dir: string): ContextoDoIndice => ({ raiz: dir, estado: raizDoEstado(dir) });
const modo = (p: string): number => fs.statSync(p).mode & 0o777;
const assinatura = (dir: string): string[] => fs.readdirSync(dir).sort().map((n) => {
  const st = fs.statSync(path.join(dir, n));
  return `${n} ${st.size} ${st.mtimeMs} ${createHash('sha256').update(fs.readFileSync(path.join(dir, n))).digest('hex')}`;
});

test('KG3 index: revisaoDaArvore da o HEAD e se a arvore esta limpa, sem ler os arquivos', () => {
  const { dir, git } = repositorioGit({}, 'kg3-revisao');
  try {
    assert.deepEqual(revisaoDaArvore(dir), { raiz: dir, head: null, motivo: 'sem-commit' });
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    git('add', '--', 'a.ts');
    git('commit', '-q', '-m', 'um');
    const head = git('rev-parse', 'HEAD').trim();
    fs.mkdirSync(path.join(dir, 'sub'));
    assert.deepEqual(revisaoDaArvore(path.join(dir, 'sub')), { raiz: dir, head, motivo: null });
    fs.writeFileSync(path.join(dir, 'nao-rastreado.ts'), 'x');
    assert.equal(revisaoDaArvore(dir).motivo, null, 'arquivo nao rastreado nao suja a arvore');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2;\n');
    assert.deepEqual(revisaoDaArvore(dir), { raiz: dir, head, motivo: 'working-tree-modified' });
    // Arquivo ilegivel nao importa: nada e lido.
    fs.chmodSync(path.join(dir, 'a.ts'), 0o000);
    assert.equal(revisaoDaArvore(dir).head, head);
    fs.chmodSync(path.join(dir, 'a.ts'), 0o644);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 index: arvore suja, sem commit e filtro do Git sao recusados com o motivo', () => {
  const vazio = repositorioGit({}, 'kg3-sem-commit');
  const { dir, git } = repositorioGit({ ...REPO, '.gitattributes': '*.md text eol=crlf\n' });
  const parser = carregarAnalisadores();
  try {
    assert.throws(() => construirIndice(contexto(vazio.dir), { parser }), /^Error: grafo\.indice\.arvore-nao-limpa: sem-commit$/);
    fs.appendFileSync(path.join(dir, 'src/b.ts'), '// mudou\n');
    assert.throws(() => construirIndice(contexto(dir), { parser }), /^Error: grafo\.indice\.arvore-nao-limpa: working-tree-modified$/);
    // A recusa vem antes de ler qualquer arquivo: o rastreado ilegivel nem chega a ser aberto.
    fs.chmodSync(path.join(dir, 'src/b.ts'), 0o000);
    try {
      assert.throws(() => construirIndice(contexto(dir), { parser }), /^Error: grafo\.indice\.arvore-nao-limpa: working-tree-modified$/);
    } finally {
      fs.chmodSync(path.join(dir, 'src/b.ts'), 0o644);
    }
    git('checkout', '--', 'src/b.ts');
    fs.rmSync(path.join(dir, 'docs/x.md'));
    git('checkout', '--', 'docs/x.md');
    assert.equal(git('status', '--porcelain'), '');
    assert.throws(() => construirIndice(contexto(dir), { parser }), /^Error: grafo\.indice\.arvore-nao-limpa: filtro-do-git$/);
    assert.ok(!fs.existsSync(path.join(dir, '.orkastery', 'grafo')) || fs.readdirSync(path.join(dir, '.orkastery', 'grafo')).length === 0);
  } finally {
    fs.rmSync(vazio.dir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 index: cria, reconhece o existente sem reescrever e --forcar reconstroi identico', () => {
  const { dir, git } = repositorioGit(REPO);
  const parser = carregarAnalisadores();
  try {
    const ctx = contexto(dir);
    const a = construirIndice(ctx, { parser });
    assert.equal(a.estado, 'criado');
    assert.equal(a.dir, path.join(dir, '.orkastery', 'grafo', a.chave));
    assert.deepEqual(fs.readdirSync(a.dir).sort(), ['grafo.json', 'indice.json', 'relatorio.json']);
    assert.equal(a.manifesto.schema, INDICE_SCHEMA);
    assert.equal(a.manifesto.revision, git('rev-parse', 'HEAD').trim());
    assert.equal(a.manifesto.conferencia.fontes, Object.keys(REPO).length);
    const bytes = fs.readFileSync(path.join(a.dir, 'grafo.json'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), a.manifesto.graph_digest);
    assert.ok(!/"(?:criado|gerado|atualizado)_?em"|\d{4}-\d{2}-\d{2}T/.test(fs.readFileSync(path.join(a.dir, 'indice.json'), 'utf8')), 'sem horario');
    const antes = assinatura(a.dir);
    const b = construirIndice(ctx, { parser });
    assert.deepEqual([b.estado, b.chave], ['existente', a.chave]);
    assert.deepEqual(assinatura(a.dir), antes, 'o existente nao e reescrito');
    const c = construirIndice(ctx, { parser, forcar: true });
    assert.deepEqual([c.estado, c.chave, c.motivo], ['reconstruido-identico', a.chave, null]);
    assert.deepEqual(assinatura(a.dir), antes, 'o forcar identico nao troca os arquivos');
    assert.deepEqual(c.manifesto, a.manifesto);
    const lido = lerIndice(ctx, a.chave);
    assert.equal(lido.grafo?.snapshot.snapshot_id, a.manifesto.snapshot_id);
    assert.equal(indiceDoHead(ctx).chave, a.chave, 'a consulta acha a mesma chave sem carregar o compilador');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 index: --verificar extrai de novo e reprova guardado integro que difere; --forcar o troca', () => {
  const { dir } = repositorioGit(REPO);
  const parser = carregarAnalisadores();
  try {
    const ctx = contexto(dir);
    const a = construirIndice(ctx, { parser });
    const v = construirIndice(ctx, { parser, verificar: true });
    assert.deepEqual([v.estado, v.determinismo?.map((d) => `${d.ordem} ${d.igual}`)], ['reconstruido-identico', ['ordem invertida true', 'ordem embaralhada true']]);
    // Adultera o relatorio e acerta o manifesto: a leitura passa, e so a extracao nova descobre.
    const rel = path.join(a.dir, 'relatorio.json'), man = path.join(a.dir, 'indice.json');
    const outro = fs.readFileSync(rel, 'utf8').replace('"lacunas":[', '"lacunas":[{"categoria":"x","detalhe":null,"linha":null,"path":"src/a.ts"},');
    fs.writeFileSync(rel, outro);
    const m = JSON.parse(fs.readFileSync(man, 'utf8'));
    m.report_bytes = Buffer.byteLength(outro, 'utf8');
    m.report_digest = createHash('sha256').update(outro).digest('hex');
    fs.writeFileSync(man, JSON.stringify(m));
    assert.ok(lerIndice(ctx, a.chave).grafo, 'a adulteracao passa na leitura');
    assert.throws(() => construirIndice(ctx, { parser, verificar: true }), /^Error: grafo\.indice\.nao-deterministico: o indice guardado difere da extracao nova$/);
    const f = construirIndice(ctx, { parser, forcar: true });
    assert.deepEqual([f.estado, f.motivo], ['substituido', 'conteudo diferente na mesma chave']);
    assert.equal(construirIndice(ctx, { parser, verificar: true }).estado, 'reconstruido-identico');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 index: outra revisao, ACL, tenant, repositorio, analisador ou codigo dao outra chave', () => {
  const { dir, git } = repositorioGit(REPO);
  const parser = carregarAnalisadores();
  try {
    const ctx = contexto(dir);
    const head = git('rev-parse', 'HEAD').trim();
    const perfil = perfilDoIndice(dir);
    const base = chaveDoIndice(head, perfil);
    assert.equal(base, chaveDoIndice(head, { ...perfil, acl_refs: [...perfil.acl_refs] }), 'a chave e funcao do conteudo');
    const variantes = [
      chaveDoIndice('0'.repeat(40), perfil),
      chaveDoIndice(head, { ...perfil, acl_refs: ['repo:demo:escrita'] }),
      chaveDoIndice(head, { ...perfil, tenant_id: 'outro' }),
      chaveDoIndice(head, { ...perfil, repository_id: 'outro' }),
      chaveDoIndice(head, { ...perfil, analisadores: { ...perfil.analisadores, typescript: '0.0.0' } }),
      chaveDoIndice(head, { ...perfil, analisadores: { ...perfil.analisadores, javascript: 'node.0.0.0' } }),
      chaveDoIndice(head, { ...perfil, codigo: '0'.repeat(64) }),
    ];
    assert.equal(new Set([base, ...variantes]).size, variantes.length + 1);
    assert.deepEqual(perfilDoIndice(dir, undefined, { acl_refs: ['b:x', 'a:y', 'b:x'] }).acl_refs, ['a:y', 'b:x']);
    // A impressao e a dos modulos compilados da extracao: um byte a mais em um deles muda a chave.
    assert.equal(perfil.codigo, impressaoDoExtrator());
    const compilado = path.dirname(require.resolve('../src/intelligence-graph-index'));
    const copia = dirTemporario('kg3-impressao');
    try {
      for (const m of MODULOS_DO_EXTRATOR) fs.copyFileSync(path.join(compilado, `${m}.js`), path.join(copia, `${m}.js`));
      assert.equal(impressaoDoExtrator(copia), perfil.codigo);
      fs.appendFileSync(path.join(copia, 'intelligence-graph-extract-ts.js'), '\n');
      assert.notEqual(impressaoDoExtrator(copia), perfil.codigo);
    } finally {
      fs.rmSync(copia, { recursive: true, force: true });
    }
    const a = construirIndice(ctx, { parser });
    assert.equal(a.chave, base);
    const outraAcl = construirIndice(ctx, { parser, leitura: { acl_refs: ['repo:demo:leitura', 'equipe:nucleo'] } });
    assert.notEqual(outraAcl.chave, a.chave);
    fs.writeFileSync(path.join(dir, 'src/c.ts'), 'export const c = 3;\n');
    git('add', '--', 'src/c.ts');
    git('commit', '-q', '-m', 'dois');
    const b = construirIndice(ctx, { parser });
    assert.equal(b.estado, 'criado');
    assert.notEqual(b.chave, a.chave);
    assert.equal(estadoDosIndices(ctx).indices.length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 index: pastas 0700 e arquivos 0600 no estado canonico, tambem a partir de worktree, fora do git', () => {
  const { dir, git } = repositorioGit(REPO);
  const parser = carregarAnalisadores();
  const wt = path.join(dir, '.claude', 'worktrees', 'kg3');
  try {
    git('worktree', 'add', '-q', '-b', 'ork/kg3', wt);
    const ctx = contexto(wt);
    assert.equal(ctx.estado, dir, 'a worktree usa o estado da arvore principal');
    const r = construirIndice(ctx, { parser });
    assert.ok(r.dir.startsWith(path.join(dir, '.orkastery', 'grafo') + path.sep), r.dir);
    assert.ok(!fs.existsSync(path.join(wt, '.orkastery', 'grafo')));
    assert.equal(modo(path.join(dir, '.orkastery', 'grafo')), 0o700);
    assert.equal(modo(r.dir), 0o700);
    for (const n of fs.readdirSync(r.dir)) assert.equal(modo(path.join(r.dir, n)), 0o600, n);
    assert.ok(!git('status', '--porcelain', '--untracked-files=all').includes('.orkastery'), 'o indice nao aparece no git');
    assert.equal(git('ls-files', '--', '.orkastery'), '');
    git('check-ignore', '-q', '.orkastery/grafo');
    // A mesma chave vista da arvore principal: mesma revisao, mesmo indice.
    assert.equal(construirIndice(contexto(dir), { parser }).estado, 'existente');
    assert.equal(estadoCanonico(wt, 'x').startsWith(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 index: link simbolico, modo errado, dono, segundo link, truncado e digest divergente sao recusados', () => {
  const { dir } = repositorioGit(REPO);
  const parser = carregarAnalisadores();
  const fora = dirTemporario('kg3-fora');
  try {
    const ctx = contexto(dir);
    const r = construirIndice(ctx, { parser });
    const arquivo = (n: string) => path.join(r.dir, n);
    const recusa = (re: RegExp, preparar: () => void, desfazer: () => void) => {
      preparar();
      try {
        assert.throws(() => lerIndice(ctx, r.chave), re);
        assert.throws(() => indiceDoHead(ctx), re);
      } finally {
        desfazer();
      }
      assert.ok(lerIndice(ctx, r.chave).grafo);
    };
    const original = fs.readFileSync(arquivo('grafo.json'));
    recusa(/grafo\.indice\.permissao-invalida: grafo\.json/, () => fs.chmodSync(arquivo('grafo.json'), 0o644), () => fs.chmodSync(arquivo('grafo.json'), 0o600));
    recusa(/grafo\.indice\.permissao-invalida: idx-/, () => fs.chmodSync(r.dir, 0o755), () => fs.chmodSync(r.dir, 0o700));
    recusa(/grafo\.indice\.permissao-invalida: grafo com modo 755/, () => fs.chmodSync(path.dirname(r.dir), 0o755), () => fs.chmodSync(path.dirname(r.dir), 0o700));
    recusa(/grafo\.indice\.permissao-invalida: relatorio\.json/, () => fs.linkSync(arquivo('relatorio.json'), path.join(fora, 'segundo')), () => fs.rmSync(path.join(fora, 'segundo')));
    recusa(/grafo\.indice\.permissao-invalida: grafo\.json \(ELOOP\)/, () => {
      fs.renameSync(arquivo('grafo.json'), path.join(fora, 'grafo.json'));
      fs.symlinkSync(path.join(fora, 'grafo.json'), arquivo('grafo.json'));
    }, () => {
      fs.rmSync(arquivo('grafo.json'));
      fs.renameSync(path.join(fora, 'grafo.json'), arquivo('grafo.json'));
    });
    recusa(/grafo\.indice\.corrompido: grafo\.json nao bate com o digest/, () => fs.truncateSync(arquivo('grafo.json'), 100), () => fs.writeFileSync(arquivo('grafo.json'), original));
    recusa(/grafo\.indice\.corrompido: grafo\.json nao bate com o digest/, () => {
      const b = Buffer.from(original);
      b[b.length - 2] = b[b.length - 2] === 0x5d ? 0x7d : 0x5d;
      fs.writeFileSync(arquivo('grafo.json'), b);
    }, () => fs.writeFileSync(arquivo('grafo.json'), original));
    recusa(/grafo\.indice\.corrompido: indice\.json/, () => fs.writeFileSync(arquivo('indice.json'), '{'), () => fs.writeFileSync(arquivo('indice.json'), JSON.stringify(r.manifesto)));
    // Pasta do grafo trocada por link simbolico para fora: nem le, nem escreve.
    const grafoDir = path.dirname(r.dir);
    fs.renameSync(grafoDir, path.join(fora, 'grafo'));
    fs.symlinkSync(path.join(fora, 'grafo'), grafoDir);
    assert.throws(() => lerIndice(ctx, r.chave), /grafo\.indice\.permissao-invalida: grafo nao e pasta real/);
    assert.throws(() => construirIndice(ctx, { parser }), /grafo\.indice\.permissao-invalida: grafo nao e pasta real/);
    fs.rmSync(grafoDir);
    fs.renameSync(path.join(fora, 'grafo'), grafoDir);
    // Indice que nao passa na leitura e substituido pela construcao, com o motivo.
    fs.truncateSync(arquivo('grafo.json'), 10);
    const s = construirIndice(ctx, { parser });
    assert.deepEqual([s.estado, s.chave], ['substituido', r.chave]);
    assert.match(s.motivo ?? '', /grafo\.indice\.corrompido/);
    assert.deepEqual(fs.readFileSync(arquivo('grafo.json')), original);
    assert.throws(() => lerIndice(ctx, '../fora'), /grafo\.indice\.chave-invalida/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('KG3 index: corrida entre duas construcoes da mesma chave nao deixa indice parcial nem sobra', () => {
  const { dir } = repositorioGit(REPO);
  const parser = carregarAnalisadores();
  try {
    const ctx = contexto(dir);
    let interna: ReturnType<typeof construirIndice> | null = null;
    const externa = construirIndice(ctx, { parser, antesDePublicar: () => { interna = construirIndice(ctx, { parser }); } });
    assert.equal((interna as ReturnType<typeof construirIndice> | null)?.estado, 'criado');
    assert.equal(externa.estado, 'existente');
    const grafoDir = path.dirname(externa.dir);
    assert.deepEqual(fs.readdirSync(grafoDir), [externa.chave], 'o temporario da perdedora sai');
    assert.ok(lerIndice(ctx, externa.chave).grafo);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 index: limpar so apaga indice fora do manter e sobra velha, nunca outro nome', () => {
  const { dir, git } = repositorioGit(REPO);
  const parser = carregarAnalisadores();
  const fora = dirTemporario('kg3-limpar-fora');
  try {
    const ctx = contexto(dir);
    const velho = construirIndice(ctx, { parser });
    fs.writeFileSync(path.join(dir, 'src/c.ts'), 'export const c = 3;\n');
    git('add', '--', 'src/c.ts');
    git('commit', '-q', '-m', 'dois');
    const atual = construirIndice(ctx, { parser });
    const grafoDir = path.dirname(atual.dir);
    const agora = Date.now(), velhoMs = (agora - 2 * 60 * 60 * 1000) / 1000;
    const tmpVelho = path.join(grafoDir, '.tmp-00000000-0000-4000-8000-000000000001');
    const tmpNovo = path.join(grafoDir, '.tmp-00000000-0000-4000-8000-000000000002');
    fs.mkdirSync(tmpVelho);
    fs.writeFileSync(path.join(tmpVelho, 'x'), 'x');
    fs.utimesSync(tmpVelho, velhoMs, velhoMs);
    fs.mkdirSync(tmpNovo);
    fs.writeFileSync(path.join(grafoDir, 'nao-e-do-indice'), 'fica');
    fs.writeFileSync(path.join(fora, 'alvo'), 'fica');
    fs.symlinkSync(fora, path.join(grafoDir, `idx-${'a'.repeat(64)}`));
    const r = limparIndices(ctx, { manter: [atual.chave], agora });
    assert.deepEqual(r.removidos.map((x) => x.nome).sort(), [`idx-${'a'.repeat(64)}`, path.basename(tmpVelho), velho.chave].sort());
    assert.ok(r.bytes > 0);
    assert.deepEqual(fs.readdirSync(grafoDir).sort(), [path.basename(tmpNovo), atual.chave, 'nao-e-do-indice'].sort());
    assert.equal(fs.readFileSync(path.join(fora, 'alvo'), 'utf8'), 'fica', 'o link foi removido sem seguir');
    assert.ok(lerIndice(ctx, atual.chave).grafo);
    assert.deepEqual(limparIndices(ctx, { tudo: true, agora }).removidos.map((x) => x.nome), [atual.chave]);
    assert.deepEqual(estadoDosIndices(ctx).indices, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('KG3 index: a concessao local e a leitura do repositorio, e sem leitura da raiz a recusa e explicita', { skip: uidRoot() }, () => {
  const { dir } = repositorioGit(REPO);
  try {
    const perfil = perfilDoIndice(dir);
    assert.deepEqual(concessaoLocal(dir, perfil), { tenant_id: 'local', acl_refs: ['repo:demo:leitura'] });
    assert.deepEqual(concessaoLocal(dir, { ...perfil, acl_refs: ['repo:demo:leitura', 'equipe:x'] }).acl_refs, ['repo:demo:leitura'],
      'ACL configurada na leitura nao amplia a concessao');
    fs.chmodSync(dir, 0o000);
    try {
      assert.throws(() => concessaoLocal(dir, perfil), /^Error: grafo\.acesso\.negado/);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function uidRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

const CLI = path.resolve(__dirname, '../src/index.js');

/** `ork grafo` pelo modulo, com a saida capturada; erro lancado vira `{ codigo: null, erro }`. */
function grafo(dir: string, ...argv: string[]): { codigo: number | null; saida: string; erro: string | null } {
  const partes: string[] = [];
  try {
    const codigo = executarGrafo(argv, { raiz: dir, estado: raizDoEstado(dir), escrever: (t) => partes.push(t) });
    return { codigo, saida: partes.join('\n'), erro: null };
  } catch (e) {
    return { codigo: null, saida: partes.join('\n'), erro: (e as Error).message };
  }
}

test('KG3 cli: o parser recusa subcomando, opcao desconhecida ou repetida, bandeira com valor, valor ausente e posicionais errados', () => {
  const recusa = (re: RegExp, ...argv: string[]) => assert.throws(() => lerPedido(argv), re, argv.join(' '));
  recusa(/^Error: grafo\.uso: falta o subcomando/);
  recusa(/subcomando desconhecido: apagar/, 'apagar');
  recusa(/subcomando desconhecido: constructor/, 'constructor');
  recusa(/opcao desconhecida para vizinhos: --forcar/, 'vizinhos', 'x', '--forcar');
  recusa(/--json repetida/, 'status', '--json', '--json');
  recusa(/--limite repetida/, 'vizinhos', 'x', '--limite', '1', '--limite=2');
  recusa(/--json nao leva valor/, 'status', '--json=sim');
  recusa(/--profundidade exige valor/, 'vizinhos', 'x', '--profundidade');
  recusa(/--profundidade exige valor/, 'vizinhos', 'x', '--profundidade', '--json');
  recusa(/vizinhos pede 1 argumento\(s\), veio 0/, 'vizinhos', '--json');
  recusa(/caminho pede 2 argumento\(s\), veio 1/, 'caminho', 'a');
  recusa(/indexar pede 0 argumento\(s\), veio 1/, 'indexar', 'agora');
  // `--json` seguido de posicional nao engole o no, como o parser geral do ork faria.
  const p = lerPedido(['chamadores', '--json', 'soma']);
  assert.deepEqual([p.posicionais, [...p.bandeiras]], [['soma'], ['json']]);
  assert.deepEqual([...lerPedido(['vizinhos', 'x', '--tipo=calls,imports']).valores], [['tipo', 'calls,imports']]);
});

test('KG3 cli: indexar, status, consultas e limpar de ponta a ponta num Git temporario', () => {
  const { dir, git } = repositorioGit(REPO);
  try {
    let r = grafo(dir, 'status', '--json');
    assert.equal(r.codigo, 0);
    assert.equal(JSON.parse(r.saida).indice_do_head, 'ausente');
    r = grafo(dir, 'chamadores', 'b');
    assert.match(r.erro ?? '', /^grafo\.indice\.ausente: sem indice do HEAD [0-9a-f]{12}; rode ork grafo indexar$/);
    r = grafo(dir, 'chamadores', 'b', '--json');
    assert.equal(r.codigo, 1);
    assert.equal(JSON.parse(r.saida).erro.codigo, 'grafo.indice.ausente');
    r = grafo(dir, 'indexar');
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /^indice do grafo de demo: criado$/m);
    assert.match(r.saida, /conferirFontes verificada: 5 fontes e \d+ evidencias contra os bytes/);
    // `--verificar` com o indice ja guardado extrai de novo, prova o determinismo e compara com ele.
    r = grafo(dir, 'indexar', '--verificar');
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /^indice do grafo de demo: reconstruido-identico$/m);
    assert.match(r.saida, /determinismo ordem invertida: .* igual/);
    assert.match(r.saida, /determinismo ordem embaralhada: .* igual/);
    assert.match(r.saida, /\naprovado$/);
    assert.ok(!/aprovado/.test(grafo(dir, 'indexar').saida), 'sem verificar, nada de aprovado');
    r = grafo(dir, 'indexar', '--forcar', '--json');
    assert.equal(JSON.parse(r.saida).estado, 'reconstruido-identico');
    r = grafo(dir, 'status', '--json');
    assert.equal(JSON.parse(r.saida).indice_do_head, 'presente');
    r = grafo(dir, 'chamadores', 'b');
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /^chamadores de symbol src\/b\.ts#b \(profundidade 1\): 1 aresta\(s\), 1 no\(s\)$/m);
    assert.match(r.saida, /^  calls  symbol src\/a\.ts#a -> symbol src\/b\.ts#b$/m);
    const json = JSON.parse(grafo(dir, 'importadores', 'src/b.ts', '--json').saida);
    assert.equal(json.schema, 'ork.code-graph-query/v0');
    assert.deepEqual(json.arestas.map((a: { from: string }) => a.from), ['file src/a.ts']);
    assert.equal(json.indice.arvore, 'limpa');
    assert.match(grafo(dir, 'vizinhos', 'docs/x.md', '--tipo', 'contains,references', '--profundidade', '2').saida, /references  section docs\/x\.md#x -> file src\/a\.ts/);
    assert.match(grafo(dir, 'caminho', 'docs/x.md', 'b').saida, /caminho de file docs\/x\.md para symbol src\/b\.ts#b \(sentido saida\): /);
    assert.match(grafo(dir, 'vizinhos', 'x', '--tipo', 'usa').erro ?? '', /--tipo desconhecido: usa/);
    // Arvore modificada: a consulta responde pelo HEAD e diz; indexar recusa.
    fs.appendFileSync(path.join(dir, 'src/b.ts'), '// mudou\n');
    assert.match(grafo(dir, 'chamadores', 'b').saida, /^aviso: a arvore tem mudanca rastreada; a resposta e do HEAD, nao da arvore$/m);
    assert.equal(JSON.parse(grafo(dir, 'chamadores', 'b', '--json').saida).indice.arvore, 'modificada');
    assert.match(grafo(dir, 'indexar').erro ?? '', /^grafo\.indice\.arvore-nao-limpa: working-tree-modified$/);
    // A amostra le o trecho da arvore e confere cada arquivo lido contra o manifesto do HEAD.
    assert.match(grafo(dir, 'amostra', '--por-estrato', '9').erro ?? '', /^grafo\.amostra\.fonte-mudou: src\/b\.ts$/);
    git('checkout', '--', 'src/b.ts');
    // Outro commit: o indice antigo fica ate o limpar; o do HEAD e mantido.
    const antes = JSON.parse(grafo(dir, 'status', '--json').saida).chave_do_head;
    fs.writeFileSync(path.join(dir, 'src/c.ts'), 'export const c = 3;\n');
    git('add', '--', 'src/c.ts');
    git('commit', '-q', '-m', 'dois');
    assert.equal(JSON.parse(grafo(dir, 'status', '--json').saida).indice_do_head, 'ausente');
    assert.equal(grafo(dir, 'indexar').codigo, 0);
    assert.equal(JSON.parse(grafo(dir, 'status', '--json').saida).indices.length, 2);
    const l = JSON.parse(grafo(dir, 'limpar', '--json').saida);
    assert.deepEqual(l.removidos.map((x: { nome: string }) => x.nome), [antes]);
    assert.equal(JSON.parse(grafo(dir, 'status', '--json').saida).indice_do_head, 'presente');
    assert.match(grafo(dir, 'limpar', '--tudo').saida, /^grafo limpar: 1 removido\(s\)/);
    assert.equal(JSON.parse(grafo(dir, 'status', '--json').saida).indice_do_head, 'ausente');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 cli: nome ambiguo e no desconhecido saem tipados, com candidatos no JSON', () => {
  const { dir } = repositorioGit({ ...REPO, 'src/d.ts': 'export function b() { return 2; }\n' });
  try {
    assert.equal(grafo(dir, 'indexar').codigo, 0);
    const r = grafo(dir, 'chamadores', 'b', '--json');
    assert.equal(r.codigo, 1);
    assert.deepEqual(JSON.parse(r.saida).erro, {
      codigo: 'grafo.consulta.ambiguo', detalhe: 'b tem 2 candidatos: symbol src/b.ts#b; symbol src/d.ts#b', candidatos: ['symbol src/b.ts#b', 'symbol src/d.ts#b'],
    });
    assert.match(grafo(dir, 'chamadores', 'nada').erro ?? '', /^grafo\.consulta\.no-desconhecido: nada$/);
    assert.equal(grafo(dir, 'chamadores', 'src/d.ts#b').codigo, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 cli: amostra gera, reprova sem veredito e com trecho mudado, e confere a auditada', () => {
  const { dir, git } = repositorioGit(REPO);
  const fora = dirTemporario('kg3-amostra');
  try {
    assert.equal(grafo(dir, 'indexar').codigo, 0);
    const amostra = JSON.parse(grafo(dir, 'amostra', '--por-estrato', '2').saida);
    assert.equal(amostra.schema, 'ork.graph-edge-audit-sample/v0');
    assert.ok(amostra.arestas.length > 0);
    const arquivo = path.join(fora, 'amostra.json');
    fs.writeFileSync(arquivo, JSON.stringify(amostra));
    let r = grafo(dir, 'amostra', '--conferir', arquivo);
    assert.equal(r.codigo, 1, 'sem veredito a conferencia reprova');
    for (const item of amostra.arestas) Object.assign(item, { veredito: 'supported', nota: 'conferida no teste' });
    const correta = JSON.stringify(amostra);
    fs.writeFileSync(arquivo, correta);
    r = grafo(dir, 'amostra', '--conferir', arquivo);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /conferidas contra o indice do HEAD: (\d+) de \1\naprovado$/);
    amostra.arestas[0].evidencia.trecho_sha256 = '0'.repeat(64);
    fs.writeFileSync(arquivo, JSON.stringify(amostra));
    r = grafo(dir, 'amostra', '--conferir', arquivo, '--json');
    assert.equal(r.codigo, 1);
    assert.match(JSON.parse(r.saida).falhas[0], /nenhuma evidencia com o trecho auditado/);
    assert.match(grafo(dir, 'amostra', '--conferir', arquivo, '--por-estrato', '1').erro ?? '', /nao combinam/);
    // Outro arquivo rastreado modificado nao impede: so os lidos precisam bater com o manifesto.
    fs.writeFileSync(path.join(dir, 'orkastery.yaml'), `${REPO['orkastery.yaml']}# comentario\n`);
    assert.equal(revisaoDaArvore(dir).motivo, 'working-tree-modified');
    fs.writeFileSync(arquivo, correta);
    assert.equal(grafo(dir, 'amostra', '--conferir', arquivo).codigo, 0);
    git('checkout', '--', 'orkastery.yaml');
    // Bytes que o Git nao ve mudar (assume-unchanged) nao passam: o trecho e conferido contra o manifesto.
    git('update-index', '--assume-unchanged', '--', 'src/a.ts');
    fs.appendFileSync(path.join(dir, 'src/a.ts'), '// fora do indice\n');
    assert.equal(revisaoDaArvore(dir).motivo, null);
    assert.match(grafo(dir, 'amostra', '--por-estrato', '9').erro ?? '', /^grafo\.amostra\.fonte-mudou: src\/a\.ts$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('KG3 cli: o ork despacha grafo pelo index.js com o argv cru, e a ajuda lista os subcomandos', () => {
  const { dir } = repositorioGit(REPO);
  try {
    const ork = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
    let r = ork('grafo', 'indexar', '--json');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).estado, 'criado');
    r = ork('grafo', 'chamadores', '--json', 'b');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).alvo.rotulo, 'symbol src/b.ts#b');
    r = ork('grafo', 'apagar');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /erro: grafo\.uso: subcomando desconhecido: apagar/);
    r = ork('--help');
    for (const sub of ['indexar', 'status', 'vizinhos', 'chamadores', 'importadores', 'caminho', 'amostra', 'limpar']) {
      assert.match(r.stdout, new RegExp(`^  grafo ${sub} `, 'm'), sub);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
