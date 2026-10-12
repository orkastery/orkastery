import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ts from 'typescript';
import { caminhoBateComGlob } from '../src/leases';

// RM-059 (fatia F3): o Radar de Colisão (`ork-radar`) testado sem o Claude Code. O sandbox do `ork verify` e o
// runner do CI não têm o `claude`, então a claim hermética transpila os módulos puros do Radar com o compilador
// do `core` e os roda num escopo próprio, como os testes da ponte e da Torre. O fonte do mod também é varrido pela
// AST (D2: só a lista fechada de chamadas ao `$`, e todo argv sai dos construtores de `colisao.ts`), e o argv e o
// ambiente que o módulo monta rodam num repositório descartável de verdade: o `merge-tree` acha o conflito sem
// gravar objeto, ref nem índice no repositório (D3).
const raizDoRepo = path.resolve(__dirname, '../../..');
const RADAR = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-radar');
const MODULOS_PUROS = ['hooks/colisao.ts', 'hooks/mapa.tsx'];
/** D2: tudo que o Radar chama direto no `$`; o estado passa pelo `read` e pelo `update` do motor. */
const CHAMADAS_PERMITIDAS = ['ork.papel', 'ork.contexto', 'ork.retrato', 'ork.ler', 'ork.faixa', 'ork.mostrado', 'command.register',
  'clock.now', 'clock.after', 'clock.every', 'process.run', 'fs.stat', 'fs.read', 'ui.open', 'ui.panes', 'ui.resolve', 'ui.toast'];
const NOUNS_PROIBIDOS = ['mcp', 'store', 'env', 'session', 'prompt', 'agent', 'tool'];
/** D2: os únicos construtores de argv do Radar, todos em `colisao.ts`. */
const CONSTRUTORES_DE_ARGV = ['argvDoLsRemoteLocal', 'argvDoLsRemoteRemoto', 'argvDoTemporario', 'argvDoMergeTree', 'argvDeApagar'];
const CONSULTAS_PERMITIDAS = ['thread.list', 'thread.status'];
const NUL = String.fromCharCode(0);

type No = { tipo: string; props: Record<string, unknown>; filhos: unknown[] };
(globalThis as unknown as { h: unknown }).h = (tipo: string, props: Record<string, unknown> | null, ...filhos: unknown[]): No =>
  ({ tipo, props: props ?? {}, filhos: filhos.flat(Infinity) });

const modulos = new Map<string, Record<string, any>>();
function resolver(base: string): string {
  for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error(`modulo do Radar nao encontrado: ${base}`);
}
/** Transpila e roda um módulo puro do Radar; o `require` só resolve outro módulo puro do próprio Radar. */
function carregar(rel: string): Record<string, any> {
  const arquivo = resolver(path.join(RADAR, rel));
  const pronto = modulos.get(arquivo);
  if (pronto) return pronto;
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  });
  const modulo = { exports: {} as Record<string, any> };
  modulos.set(arquivo, modulo.exports);
  const exigir = (id: string) => {
    const alvo = path.relative(RADAR, path.join(path.dirname(arquivo), id));
    if (!id.startsWith('./') || !MODULOS_PUROS.includes(path.relative(RADAR, resolver(path.join(RADAR, alvo))))) {
      throw new Error(`modulo puro do Radar nao importa valor de fora dele: ${id}`);
    }
    return carregar(alvo);
  };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(RADAR, rel), 'utf8'));
const sha = (c: string) => c.repeat(40);

test('manifesto do Radar: nome, contrato de estado, dependencia da ponte, papel dono e nenhuma chave de papel', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-radar');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  assert.equal(typeof m.author?.name, 'string');
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono'], claudeCodeMinimo: '2.1.287' });
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.tsx'] });
  assert.ok(fs.existsSync(path.join(RADAR, 'hooks/register.tsx')));
  assert.ok(fs.readdirSync(path.join(RADAR, 'test')).some((n) => /\.test\.tsx?$/.test(n)));
});

test('o contrato declara o estado do Radar em PluginState, sem import nem referencia', () => {
  const contrato = fs.readFileSync(path.join(RADAR, 'types/index.d.ts'), 'utf8');
  assert.match(contrato, /interface PluginState \{\s*'ork-radar': \{/);
  assert.ok(contrato.includes('mapa: RadarMapa'));
  assert.ok(contrato.includes('novas: string[]'));
  assert.doesNotMatch(contrato, /^\s*import\s/m);
  assert.doesNotMatch(contrato, /\/\/\/\s*<reference/);
  assert.doesNotMatch(contrato, /interface EngineInterface/);
});

test('modulo puro do Radar so importa tipos ou outro modulo puro dele', () => {
  for (const rel of MODULOS_PUROS) {
    const fonte = fs.readFileSync(path.join(RADAR, rel), 'utf8');
    for (const linha of fonte.split('\n').filter((l) => /^\s*import\s/.test(l))) {
      if (/^\s*import type\s/.test(linha)) continue;
      const de = /from '(\.\/[a-z]+)'/.exec(linha)?.[1];
      assert.ok(de && MODULOS_PUROS.includes(path.relative(RADAR, resolver(path.join(RADAR, 'hooks', de)))), `${rel}: ${linha}`);
    }
    assert.doesNotMatch(fonte, /\$\./, `${rel} chama o $`);
  }
});

test('colisao: as threads da lista na ordem das fases, ate o teto, sem fechada, sem MASTER e sem id ou slug ruim', () => {
  const { threadsDaLista, TETO_DE_THREADS, ORDEM_DAS_FASES } = carregar('hooks/colisao.ts');
  assert.equal(TETO_DE_THREADS, 12);
  assert.deepEqual([...ORDEM_DAS_FASES], ['SHIP', 'CHECK', 'GO', 'PLAN', 'GOAL']);
  const lista = { threads: [
    { id: 'ork-g', slug: 'ork-g-full', fase: 'GOAL', status: 'aberta' },
    { id: 'ork-s', slug: 'ork-s-full', fase: 'SHIP', status: 'aberta' },
    { id: 'ork-m', slug: 'ork-m-full', fase: 'MASTER', status: 'aberta' },
    { id: 'ork-f', slug: 'ork-f-full', fase: 'GO', status: 'fechada' },
    { id: 'ork-c', slug: 'ork-c-full', fase: 'CHECK', status: 'pausada' },
    { id: 'ork-b', slug: 'ork-b-full', fase: 'GO', status: 'aberta' },
    { id: 'ork-a', slug: 'ork-a-full', fase: 'GO', status: 'aberta' },
    { id: '../x', slug: 'x', fase: 'GO' }, { id: 'ork-y', slug: '../y', fase: 'GO' }, { id: 'ork-z', fase: 'GO' },
    { id: 'ork-a', slug: 'ork-a-outra', fase: 'SHIP' }, { id: 'ork-q', slug: 'ork-q-full', fase: 'ESTRANHA' }, null,
  ] };
  assert.deepEqual(threadsDaLista(lista).threads.map((t: { id: string }) => t.id), ['ork-s', 'ork-c', 'ork-a', 'ork-b', 'ork-g', 'ork-q']);
  assert.deepEqual(threadsDaLista(lista, 2), { threads: [{ id: 'ork-s', slug: 'ork-s-full', fase: 'SHIP' }, { id: 'ork-c', slug: 'ork-c-full', fase: 'CHECK' }], omitidas: 4 });
  assert.throws(() => threadsDaLista({ erro: 'x' }), /sem threads/);
});

test('colisao: branch pelo slug ou pelo base.branch, argv do ls-remote e leitura das linhas', () => {
  const c = carregar('hooks/colisao.ts');
  assert.equal(c.refDaThread('ork-a-full'), 'refs/heads/ork/ork-a-full');
  assert.equal(c.refDoStatus({ base: { branch: 'ork/ork-a-outra' } }), 'refs/heads/ork/ork-a-outra');
  for (const ruim of ['main', 'ork/../main', 'ork//x', 'ork/x/', 'ork/x.lock', 'ork/-x', '']) assert.equal(c.refDoStatus({ base: { branch: ruim } }), null, ruim);
  assert.equal(c.refDoStatus(null), null);
  // A regra do núcleo (`branchDaWorktree`): o `base.branch` com `ork/` vence a `ork/<slug>`.
  assert.equal(c.branchCanonica('refs/heads/ork/ork-a-outra', 'ork-a-full'), 'refs/heads/ork/ork-a-outra');
  assert.equal(c.branchCanonica(null, 'ork-a-full'), 'refs/heads/ork/ork-a-full');
  assert.deepEqual(c.argvDoLsRemoteLocal(['refs/heads/ork/a']), ['git', 'ls-remote', '.', 'refs/remotes/origin/main', 'refs/heads/ork/a']);
  assert.deepEqual(c.argvDoLsRemoteRemoto(), ['git', 'ls-remote', 'origin', 'refs/heads/main']);
  assert.deepEqual({ ...c.AMBIENTE_DO_GIT }, { GIT_TERMINAL_PROMPT: '0' });
  const saida = `${sha('a')}\trefs/heads/ork/a\n${sha('b')}  refs/remotes/origin/main\nlixo\n${sha('c')}\trefs/x a mais\nabc\trefs/heads/curto\n${sha('d')}\tsem-refs\n`;
  assert.deepEqual(c.lerLsRemote(saida), { 'refs/heads/ork/a': sha('a'), 'refs/remotes/origin/main': sha('b') });
});

test('colisao (D5): o temporario so no /tmp com o nome do Radar e 8 caracteres, e o rm so dele', () => {
  const c = carregar('hooks/colisao.ts');
  assert.deepEqual(c.argvDoTemporario(), ['mktemp', '-d', '/tmp/ork-radar.XXXXXXXX']);
  assert.equal(c.temporarioValido('/tmp/ork-radar.Ab12Cd34\n'), '/tmp/ork-radar.Ab12Cd34');
  for (const ruim of ['/tmp/ork-radar.Ab12Cd3', '/tmp/ork-radar.Ab12Cd345', '/tmp/ork-radar.Ab12Cd3/', '/tmp/../srv/ork-radar.Ab12Cd34',
    'tmp/ork-radar.Ab12Cd34', '/var/tmp/ork-radar.Ab12Cd34', '/tmp/ork-radar.Ab-2Cd34', '/tmp/x/ork-radar.Ab12Cd34', '', 3]) {
    assert.equal(c.temporarioValido(ruim), null, String(ruim));
  }
  assert.deepEqual(c.argvDeApagar('/tmp/ork-radar.Ab12Cd34'), ['rm', '-rf', '--', '/tmp/ork-radar.Ab12Cd34']);
  assert.throws(() => c.argvDeApagar('/srv/projeto'), /próprio temporário/);
  assert.throws(() => c.argvDeApagar('/tmp/ork-radar.Ab12Cd34\n'), /próprio temporário/);
});

test('colisao: os objetos do repositorio pelo .git em pasta ou pelo gitdir e commondir da worktree vinculada', () => {
  const c = carregar('hooks/colisao.ts');
  assert.equal(c.normalizar('/a/b/../c/./d//e'), '/a/c/d/e');
  assert.equal(c.gitdirDoArquivo('gitdir: /repo/.git/worktrees/w\n', '/p'), '/repo/.git/worktrees/w');
  assert.equal(c.gitdirDoArquivo('gitdir: ../repo/.git/worktrees/w', '/x/p'), '/x/repo/.git/worktrees/w');
  assert.equal(c.gitdirDoArquivo('sem nada', '/p'), null);
  assert.equal(c.objetosDoComum('/repo/.git/worktrees/w', '../..\n'), '/repo/.git/objects');
  assert.equal(c.objetosDoComum('/repo/.git/worktrees/w', '/outro/.git\n'), '/outro/.git/objects');
  assert.equal(c.objetosDoComum('/repo/.git', null), '/repo/.git/objects');
  assert.equal(c.juntar('/p/', '/.git'), '/p/.git');
});

test('colisao: merge-tree so com SHA, e a leitura separa limpo, conflito e erro (saida 1 sem arvore e erro)', () => {
  const c = carregar('hooks/colisao.ts');
  assert.deepEqual(c.argvDoMergeTree(sha('a'), sha('b')), ['git', 'merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', sha('a'), sha('b')]);
  assert.deepEqual(c.argvDoMergeTree('a'.repeat(64), sha('b')).slice(-2), ['a'.repeat(64), sha('b')]);
  for (const ruim of ['main', 'HEAD', sha('g'), 'a'.repeat(39), '--output=x']) assert.throws(() => c.argvDoMergeTree(ruim, sha('b')), /só recebe SHA/, ruim);
  assert.deepEqual(c.ambienteDoMerge('/tmp/ork-radar.Ab12Cd34', '/p/.git/objects'), { GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1',
    GIT_OBJECT_DIRECTORY: '/tmp/ork-radar.Ab12Cd34', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/p/.git/objects' });
  // A lista do alternativo é separada por `:`: caminho com `:`, aspas, barra invertida ou quebra vai entre aspas no estilo C.
  assert.equal(c.caminhoDoAlternativo('/p/.git/objects'), '/p/.git/objects');
  assert.equal(c.caminhoDoAlternativo('/x/dois:pontos/.git/objects'), '"/x/dois:pontos/.git/objects"');
  assert.equal(c.caminhoDoAlternativo('/x/a"b\\c/objects'), '"/x/a\\"b\\\\c/objects"');
  assert.equal(c.caminhoDoAlternativo('/x/a\nb'), '"/x/a\\nb"');
  const arvore = sha('e');
  assert.deepEqual(c.lerMergeTree({ exitCode: 0, stdout: arvore + NUL, stderr: '' }), { estado: 'limpa' });
  assert.deepEqual(c.lerMergeTree({ exitCode: 1, stdout: [arvore, 'b.ts', 'a.ts', 'b.ts', ''].join(NUL), stderr: '' }), { estado: 'conflito', arquivos: ['a.ts', 'b.ts'] });
  assert.deepEqual(c.lerMergeTree({ exitCode: 1, stdout: '', stderr: 'merge-tree: x - not something we can merge\n' }),
    { estado: 'erro', erro: 'merge-tree: x - not something we can merge' });
  assert.deepEqual(c.lerMergeTree({ exitCode: 1, stdout: arvore + NUL, stderr: '' }), { estado: 'erro', erro: 'o merge-tree acusou conflito sem arquivo' });
  assert.deepEqual(c.lerMergeTree({ exitCode: 128, stdout: arvore + NUL, stderr: '' }), { estado: 'erro', erro: 'o merge-tree saiu 128' });
  assert.deepEqual(c.lerMergeTree({ exitCode: 0, stdout: 'nao e arvore', stderr: '' }), { estado: 'erro', erro: 'o merge-tree saiu 0' });
});

test('colisao: os pares da rodada, a chave em ordem e o cache com teto que nao guarda erro', () => {
  const c = carregar('hooks/colisao.ts');
  const threads = [
    { id: 'ork-a', fase: 'SHIP', rotulo: '1', branch: 'refs/heads/ork/a', sha: sha('a'), motivo: null },
    { id: 'ork-x', fase: 'GO', rotulo: '2', branch: 'refs/heads/ork/x', sha: null, motivo: 'sem branch local' },
    { id: 'ork-b', fase: 'GO', rotulo: '3', branch: 'refs/heads/ork/b', sha: sha('b'), motivo: null },
  ];
  assert.deepEqual(c.paresDaRodada(threads, sha('0')).map((p: { a: string; b: string }) => `${p.a}|${p.b}`), ['ork-a|@main', 'ork-b|@main', 'ork-a|ork-b']);
  assert.deepEqual(c.paresDaRodada(threads, null).map((p: { a: string; b: string }) => `${p.a}|${p.b}`), ['ork-a|ork-b']);
  assert.equal(c.chaveDoPar('ork-b', 'ork-a'), 'ork-a|ork-b');
  assert.equal(c.chaveDoPar('ork-a', '@main'), '@main|ork-a');
  const cache = new Map();
  c.guardarNoCache(cache, 'k1', { estado: 'limpa' }, 2);
  c.guardarNoCache(cache, 'k2', { estado: 'erro', erro: 'x' }, 2);
  c.guardarNoCache(cache, 'k3', { estado: 'conflito', arquivos: ['a'] }, 2);
  c.guardarNoCache(cache, 'k1', { estado: 'limpa' }, 2);
  c.guardarNoCache(cache, 'k4', { estado: 'limpa' }, 2);
  assert.deepEqual([...cache.keys()], ['k1', 'k4']);
  assert.equal(c.TETO_DO_CACHE, 256);
  assert.deepEqual([c.PRAZO_LOCAL_MS, c.PRAZO_DO_REMOTO_MS, c.PRAZO_DO_MERGE_MS, c.ORCAMENTO_DO_MERGE_MS, c.PERIODO_DA_RODADA_MS], [5000, 15000, 20000, 60000, 600000]);
});

test('colisao (D10): so os leases path ativos, e o glob casa o arquivo com a mesma regra do nucleo', () => {
  const c = carregar('hooks/colisao.ts');
  const item = (id: string, thread: string, status = 'active') => ({ id, status, refs: [{ kind: 'thread', id: thread }] });
  const retrato = { sections: { leases: { items: [item('path:core/src/**', 'ork-a'), item('path:docs/*.md', 'ork-b', 'expired'),
    item('exec:ork-c', 'ork-c'), item('path:', 'ork-d'), { id: 'path:x', status: 'active', refs: [] }, null, item('path:CHANGELOG.md', 'ork-e')] } } };
  const leases = c.leasesDoRetrato(retrato);
  assert.deepEqual(leases, [{ glob: 'core/src/**', thread: 'ork-a' }, { glob: 'CHANGELOG.md', thread: 'ork-e' }]);
  assert.throws(() => c.leasesDoRetrato({ sections: {} }), /sem a seção leases/);
  // Paginação da seção (até 50 itens por página) e a seção indisponível, que vira lacuna sem lease.
  const pagina = (extra: Record<string, unknown>) => ({ sections: { leases: { state: 'available', items: [item('path:a/**', 'ork-a')], gaps: [], ...extra } } });
  assert.deepEqual(c.paginaDosLeases(pagina({ coverage: { nextOffset: 50 } })), { leases: [{ glob: 'a/**', thread: 'ork-a' }], proximo: 50, lacuna: null });
  assert.deepEqual(c.paginaDosLeases(pagina({ coverage: { nextOffset: null } })).proximo, null);
  assert.deepEqual(c.paginaDosLeases(pagina({ coverage: { nextOffset: -1 } })).proximo, null);
  assert.equal(c.paginaDosLeases(pagina({ gaps: ['leases.parcial'] })).lacuna, 'a seção leases veio com lacunas (leases.parcial)');
  assert.deepEqual(c.paginaDosLeases(pagina({ state: 'unavailable', items: [], gaps: ['leases.unavailable'] })),
    { leases: [], proximo: null, lacuna: 'a seção leases veio indisponível (leases.unavailable)' });
  assert.throws(() => c.paginaDosLeases({ sections: {} }), /sem a seção leases/);
  assert.deepEqual([c.LEITURAS_EM_PARALELO, c.TETO_DE_PAGINAS_DE_LEASES], [4, 10]);
  assert.deepEqual(c.leasesDoArquivo('core/src/a/b.ts', leases), [{ lease: 'path:core/src/**', thread: 'ork-a' }]);
  assert.deepEqual(c.leasesDoArquivo('CHANGELOG.md', leases), [{ lease: 'path:CHANGELOG.md', thread: 'ork-e' }]);
  assert.deepEqual(c.leasesDoArquivo('core/test/x.ts', leases), []);
  const globs = ['core/src/**', 'core/**/x.ts', 'docs/*.md', 'a?c.ts', 'CHANGELOG.md', '**', 'adapters/claude-code/mods/*/hooks/*.tsx', 'a+b(c).md', 'core/src/'];
  const caminhos = ['core/src/a.ts', 'core/src/a/b.ts', 'core/x.ts', 'core/a/b/x.ts', 'docs/a.md', 'docs/a/b.md', 'abc.ts', 'a/c.ts', 'CHANGELOG.md',
    'CHANGELOGxmd', 'adapters/claude-code/mods/ork-radar/hooks/mapa.tsx', 'a+b(c).md', 'core/src/'];
  for (const g of globs) for (const p of caminhos) assert.equal(c.globParaRegex(g).test(p), caminhoBateComGlob(p, g), `${g} contra ${p}`);
});

test('colisao: a celula do par, a base, as colisoes novas da sessao, o comando que resolve e o resumo do /radar', () => {
  const c = carregar('hooks/colisao.ts');
  const leases = [{ glob: 'CHANGELOG.md', thread: 'ork-c' }];
  const conflito = c.celulaDoPar({ a: 'ork-a', b: '@main' }, { estado: 'conflito', arquivos: ['CHANGELOG.md', 'x.ts'] }, leases);
  assert.deepEqual(conflito, { par: '@main|ork-a', a: 'ork-a', b: '@main', estado: 'conflito', erro: null,
    arquivos: [{ caminho: 'CHANGELOG.md', leases: [{ lease: 'path:CHANGELOG.md', thread: 'ork-c' }] }, { caminho: 'x.ts', leases: [] }] });
  assert.equal(c.celulaDoPar({ a: 'ork-a', b: 'ork-b' }, null, leases).estado, 'pendente');
  assert.equal(c.celulaDoPar({ a: 'ork-a', b: 'ork-b' }, null, leases, 'motivo').erro, 'motivo');
  assert.deepEqual(c.celulaDoPar({ a: 'ork-a', b: 'ork-b' }, { estado: 'erro', erro: 'falhou' }, leases).erro, 'falhou');
  assert.deepEqual(c.baseDoMapa(sha('0'), { sha: sha('0'), erro: null }).situacao, 'igual');
  assert.deepEqual(c.baseDoMapa(sha('0'), { sha: sha('1'), erro: null }).situacao, 'diferente');
  assert.deepEqual(c.baseDoMapa(sha('0'), { sha: null, erro: 'x' }), { ref: 'refs/remotes/origin/main', sha: sha('0'), remoto: null, situacao: 'nao-conferida', erroRemoto: 'x' });
  const outro = c.celulaDoPar({ a: 'ork-a', b: 'ork-b' }, { estado: 'conflito', arquivos: ['y.ts'] }, []);
  const limpa = c.celulaDoPar({ a: 'ork-b', b: '@main' }, { estado: 'limpa' }, []);
  const base = c.baseDoMapa(sha('0'), { sha: sha('0'), erro: null });
  const mapa = { threads: [{ id: 'ork-a', fase: 'SHIP', rotulo: '1', branch: 'b', sha: sha('a'), motivo: null },
    { id: 'ork-b', fase: 'GO', rotulo: '2', branch: 'b', sha: sha('b'), motivo: null },
    { id: 'ork-x', fase: 'GO', rotulo: '3', branch: 'b', sha: null, motivo: 'sem branch local' }],
  base, celulas: [conflito, limpa, outro], omitidas: 2, lacunas: ['leases não lidos (x)'], lidoEm: 5, erro: null };
  assert.deepEqual(c.colisoesDoMapa(mapa), ['@main|ork-a|CHANGELOG.md', '@main|ork-a|x.ts', 'ork-a|ork-b|y.ts']);
  assert.deepEqual(c.paresComColisaoNova(null, mapa), ['@main|ork-a', 'ork-a|ork-b']);
  assert.deepEqual(c.paresComColisaoNova(new Set(c.colisoesDoMapa(mapa)), mapa), []);
  assert.deepEqual(c.paresComColisaoNova(new Set(['@main|ork-a|CHANGELOG.md', 'ork-a|ork-b|y.ts']), mapa), ['@main|ork-a']);
  assert.equal(c.comandoQueResolve({ a: 'ork-a', b: '@main' }), 'ork worktree sync ork-a --dry-run');
  assert.equal(c.comandoQueResolve({ a: 'ork-a', b: 'ork-b' }), 'a que entregar depois roda: ork worktree sync <ork-a ou ork-b> --dry-run');
  assert.equal(c.textoDosArquivos({ arquivos: ['1', '2', '3', '4', '5', '6', '7'].map((caminho) => ({ caminho, leases: [] })) }), '1, 2, 3, 4, 5 e mais 2');
  assert.deepEqual(c.resumoDoMapa(mapa).split('\n'), [
    'Radar de Colisão: 3 threads abertas (mais 2 fora do teto); base origin/main 0000000, igual ao remoto.',
    '- ork-a × origin/main: CHANGELOG.md (lease path:CHANGELOG.md de ork-c), x.ts; resolve: ork worktree sync ork-a --dry-run',
    '- ork-a × ork-b: y.ts; resolve: a que entregar depois roda: ork worktree sync <ork-a ou ork-b> --dry-run',
    '2 pares em conflito e 1 limpo.',
    'Sem branch local: ork-x.',
    'Lacuna: leases não lidos (x).',
  ]);
  assert.equal(c.resumoDoMapa({ ...mapa, lidoEm: null, erro: 'a lista falhou' }), 'Radar de Colisão: ainda sem rodada (a lista falhou).');
  // "Nenhuma colisão" sozinho só quando todo par foi calculado.
  const pendente = c.celulaDoPar({ a: 'ork-b', b: 'ork-x' }, null, []);
  const comErro = c.celulaDoPar({ a: 'ork-b', b: 'ork-y' }, { estado: 'erro', erro: 'x' }, []);
  assert.equal(c.textoSemColisao({ celulas: [] }), 'Nenhum par para calcular');
  assert.equal(c.textoSemColisao({ celulas: [limpa, limpa] }), 'Nenhuma colisão: 2 pares limpos');
  assert.equal(c.textoSemColisao({ celulas: [limpa] }), 'Nenhuma colisão: 1 par limpo');
  assert.equal(c.textoSemColisao({ celulas: [limpa, pendente, comErro] }), 'Nenhuma colisão entre os pares calculados (1 de 3)');
  assert.equal(c.textoSemColisao({ celulas: [pendente, comErro] }), 'Nenhum par calculado nesta rodada');
  assert.ok(c.resumoDoMapa({ ...mapa, celulas: [pendente, comErro] }).includes('Nenhum par calculado nesta rodada.'));
  // D6 depois de uma recarga: a rodada anterior é a do mapa guardado.
  assert.equal(c.anterioresDoMapa({ ...mapa, lidoEm: null }), null);
  assert.deepEqual([...c.anterioresDoMapa(mapa)], c.colisoesDoMapa(mapa));
});

type Chamada = { cadeia: string[]; no: ts.CallExpression; linha: number };
/** As chamadas `x.noun.metodo(...)` de um fonte, com o nó para conferir os argumentos. */
function chamadasDoFonte(arquivo: string): { chamadas: Chamada[]; fonte: ts.SourceFile } {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2022, true, /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const chamadas: Chamada[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isCallExpression(no)) {
      const cadeia: string[] = [];
      let e: ts.Expression = no.expression;
      while (ts.isPropertyAccessExpression(e)) { cadeia.unshift(e.name.text); e = e.expression; }
      if (ts.isIdentifier(e)) cadeia.unshift(e.text);
      chamadas.push({ cadeia, no, linha: fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1 });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return { chamadas, fonte };
}

function fontesDoMod(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'test' || e.name === 'node_modules' || e.name === 'types' ? [] : fontesDoMod(abs);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && !e.name.endsWith('.d.ts') ? [abs] : [];
  });
}

test('D2: o Radar so chama no $ a lista fechada, todo argv sai dos construtores de colisao.ts e so le as consultas da lista', () => {
  const fontes = fontesDoMod(RADAR);
  assert.ok(fontes.some((f) => f.endsWith('hooks/register.tsx')));
  const vistas = new Set<string>();
  let processos = 0;
  for (const arquivo of fontes) {
    const { chamadas, fonte } = chamadasDoFonte(arquivo);
    for (const c of chamadas) {
      const onde = `${path.relative(raizDoRepo, arquivo)}:${c.linha} ${c.cadeia.join('.')}`;
      if (c.cadeia[0] !== '$') continue;
      const chamada = c.cadeia.slice(1).join('.');
      assert.ok(!NOUNS_PROIBIDOS.includes(c.cadeia[1] ?? ''), `noun proibido: ${onde}`);
      assert.ok(CHAMADAS_PERMITIDAS.includes(chamada), `chamada fora da lista fechada do $: ${onde}`);
      vistas.add(chamada);
      if (chamada === 'process.run') {
        processos++;
        const argv = c.no.arguments[0];
        assert.ok(argv && ts.isCallExpression(argv) && ts.isIdentifier(argv.expression) && CONSTRUTORES_DE_ARGV.includes(argv.expression.text),
          `argv que nao sai de um construtor: ${onde}: ${argv?.getText(fonte)}`);
      }
      if (chamada === 'ork.ler') {
        const pedido = c.no.arguments[0];
        const consulta = pedido && ts.isObjectLiteralExpression(pedido)
          ? pedido.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(fonte) === 'consulta') : undefined;
        assert.ok(consulta && ts.isStringLiteral(consulta.initializer) && CONSULTAS_PERMITIDAS.includes(consulta.initializer.text), `consulta fora da lista: ${onde}`);
      }
    }
  }
  assert.ok(processos >= 5, `process.run achados: ${processos}`);
  for (const esperada of ['ork.contexto', 'ork.ler', 'ork.retrato', 'process.run', 'fs.stat', 'ork.faixa', 'ork.mostrado', 'ui.open', 'ui.panes']) {
    assert.ok(vistas.has(esperada), esperada);
  }
});

/** Roda um comando com a saída em arquivo (o sandbox do verify recusa pipe de processo filho) e sem config do usuário. */
function rodador(raiz: string) {
  let n = 0;
  const vazio = path.join(raiz, 'gitconfig-vazio');
  fs.writeFileSync(vazio, '');
  const ambiente: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('GIT_')) ambiente[k] = v;
  Object.assign(ambiente, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: vazio, HOME: raiz, GIT_AUTHOR_NAME: 'radar', GIT_AUTHOR_EMAIL: 'radar@example.invalid',
    GIT_COMMITTER_NAME: 'radar', GIT_COMMITTER_EMAIL: 'radar@example.invalid', GIT_TERMINAL_PROMPT: '0' });
  return (cwd: string, argv: readonly string[], extra: Record<string, string> = {}) => {
    const saida = path.join(raiz, `saida-${++n}`);
    const fo = fs.openSync(saida, 'w');
    const fe = fs.openSync(`${saida}.err`, 'w');
    try {
      const r = spawnSync(argv[0] as string, argv.slice(1), { cwd, env: { ...ambiente, ...extra }, stdio: ['ignore', fo, fe] });
      return { exitCode: r.status ?? 1, stdout: fs.readFileSync(saida, 'utf8'), stderr: fs.readFileSync(`${saida}.err`, 'utf8') };
    } finally {
      fs.closeSync(fo);
      fs.closeSync(fe);
    }
  };
}

function arquivosDe(dir: string, rel = ''): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = path.join(rel, e.name);
    return e.isDirectory() ? arquivosDe(dir, r) : [r];
  }).sort();
}

const hash = (arquivo: string) => crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');

test('D3: o argv e o ambiente do Radar num repositorio de verdade acham o conflito sem gravar objeto, ref nem indice', () => {
  const c = carregar('hooks/colisao.ts');
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-radar-git-'));
  try {
    const rodar = rodador(raiz);
    // Um `:` no caminho do repositório: o alternativo precisa ir entre aspas (`caminhoDoAlternativo`).
    const repo = path.join(raiz, 'dois:pontos', 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => {
      const r = rodar(repo, ['git', ...args]);
      assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout;
    };
    const escrever = (nome: string, texto: string) => fs.writeFileSync(path.join(repo, nome), texto);
    git('init', '-q', '-b', 'main');
    escrever('f.txt', 'a\nb\nc\n');
    escrever('g.txt', 'x\n');
    git('add', 'f.txt', 'g.txt');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'ork/ork-a-full');
    escrever('f.txt', 'a\nB-a\nc\n');
    git('add', 'f.txt');
    git('commit', '-q', '-m', 'a');
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', 'ork/ork-b-full');
    escrever('f.txt', 'a\nB-b\nc\n');
    escrever('h.txt', 'y\n');
    git('add', 'f.txt', 'h.txt');
    git('commit', '-q', '-m', 'b');
    git('checkout', '-q', 'main');
    escrever('g.txt', 'x2\n');
    git('add', 'g.txt');
    git('commit', '-q', '-m', 'main anda');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    git('worktree', 'add', '-q', path.join(raiz, 'wt'), 'ork/ork-b-full');

    // Os objetos pelo `.git` da worktree vinculada, como o register.tsx faz pelo `$.fs`.
    const wt = path.join(raiz, 'wt');
    const gitdir = c.gitdirDoArquivo(fs.readFileSync(path.join(wt, '.git'), 'utf8'), wt);
    const objetos = c.objetosDoComum(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8'));
    assert.equal(fs.realpathSync(objetos), fs.realpathSync(path.join(repo, '.git', 'objects')));

    // Os SHAs pelo `ls-remote` no próprio repositório: a branch que não existe fica de fora.
    const ls = rodar(repo, c.argvDoLsRemoteLocal([c.refDaThread('ork-a-full'), c.refDaThread('ork-b-full'), c.refDaThread('ork-x-full')]), c.AMBIENTE_DO_GIT);
    assert.equal(ls.exitCode, 0, ls.stderr);
    const shas = c.lerLsRemote(ls.stdout);
    assert.deepEqual(Object.keys(shas).sort(), ['refs/heads/ork/ork-a-full', 'refs/heads/ork/ork-b-full', 'refs/remotes/origin/main']);
    const [shaA, shaB, shaBase] = [shas['refs/heads/ork/ork-a-full'], shas['refs/heads/ork/ork-b-full'], shas['refs/remotes/origin/main']];

    const estado = () => ({
      objetos: arquivosDe(path.join(repo, '.git', 'objects')),
      refs: git('for-each-ref', '--format=%(refname) %(objectname)'),
      indice: hash(path.join(repo, '.git', 'index')),
      head: fs.readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8'),
      arvore: arquivosDe(repo).filter((f) => !f.startsWith('.git')).map((f) => `${f} ${hash(path.join(repo, f))}`),
    });
    const antes = estado();
    const temporario = fs.mkdtempSync(path.join(raiz, 'objetos-'));
    const ambiente = c.ambienteDoMerge(temporario, objetos);
    assert.ok(ambiente.GIT_ALTERNATE_OBJECT_DIRECTORIES.startsWith('"'), 'o alternativo com dois-pontos vai entre aspas');
    assert.equal(ambiente.GIT_NO_LAZY_FETCH, '1');
    const merge = (x: string, y: string) => c.lerMergeTree(rodar(repo, c.argvDoMergeTree(x, y), ambiente));
    assert.deepEqual(merge(shaA, shaBase), { estado: 'limpa' });
    assert.deepEqual(merge(shaB, shaBase), { estado: 'limpa' });
    assert.deepEqual(merge(shaA, shaB), { estado: 'conflito', arquivos: ['f.txt'] });
    assert.equal(merge(shaA, sha('f')).estado, 'erro');
    assert.deepEqual(estado(), antes, 'o repositorio mudou');
    assert.ok(arquivosDe(temporario).length > 0, 'os objetos novos foram para o temporario');

    // Controle: sem o ambiente do Radar, o mesmo merge-tree grava objeto no repositório.
    const semAmbiente = rodar(repo, c.argvDoMergeTree(shaA, shaBase));
    assert.equal(semAmbiente.exitCode, 0, semAmbiente.stderr);
    assert.ok(estado().objetos.length > antes.objetos.length, 'o controle sem ambiente nao gravou objeto');
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

/** Um mapa de teste: ork-a em conflito com a base e com a ork-b, a ork-c limpa, e a ork-x sem branch local. */
function mapaDeTeste(c: Record<string, any>) {
  const t = (id: string, fase: string, rotulo: string, s: string | null) => ({ id, fase, rotulo, branch: `refs/heads/ork/${id}`, sha: s, motivo: s ? null : 'sem branch local' });
  const celulas = [
    c.celulaDoPar({ a: 'ork-a', b: '@main' }, { estado: 'conflito', arquivos: ['CHANGELOG.md'] }, [{ glob: 'CHANGELOG.md', thread: 'ork-c' }]),
    c.celulaDoPar({ a: 'ork-b', b: '@main' }, { estado: 'limpa' }, []),
    c.celulaDoPar({ a: 'ork-c', b: '@main' }, { estado: 'erro', erro: 'fatal: x' }, []),
    c.celulaDoPar({ a: 'ork-a', b: 'ork-b' }, { estado: 'conflito', arquivos: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] }, []),
    c.celulaDoPar({ a: 'ork-a', b: 'ork-c' }, null, [], 'não calculado nesta rodada (orçamento de 60 s)'),
    c.celulaDoPar({ a: 'ork-b', b: 'ork-c' }, { estado: 'conflito', arquivos: ['x', 'y'] }, []),
  ];
  return {
    threads: [t('ork-a', 'SHIP', '1', sha('a')), t('ork-b', 'GO', '2', sha('b')), t('ork-c', 'GOAL', '3', sha('c')), t('ork-x', 'PLAN', '4', null)],
    base: c.baseDoMapa(sha('0'), { sha: sha('0'), erro: null }), celulas, omitidas: 0, lacunas: [], lidoEm: 1000, erro: null,
  };
}

function nosDe(no: unknown, tipo: string): No[] {
  if (!no || typeof no !== 'object') return [];
  const n = no as No;
  return [...(n.tipo === tipo ? [n] : []), ...n.filhos.flatMap((f) => nosDe(f, tipo))];
}

function textoDoNo(n: No): string {
  return n.filhos.filter((f) => typeof f === 'string' || typeof f === 'number').join('');
}

test('mapa: a faixa de calor e o simbolo de cada par, e a grade simetrica com a coluna da base e a diagonal', () => {
  const c = carregar('hooks/colisao.ts');
  const m = carregar('hooks/mapa.tsx');
  const mapa = mapaDeTeste(c);
  assert.deepEqual(mapa.celulas.map((x: any) => m.faixaDaCelula(x)), ['baixa', 'limpa', 'erro', 'alta', 'pendente', 'media']);
  assert.equal(m.faixaDaCelula(undefined), 'vazia');
  assert.deepEqual(mapa.celulas.map((x: any) => m.simboloDaCelula(m.faixaDaCelula(x), x)), ['1', '.', '!', '+', '?', '2']);
  const g = m.gradeDoMapa(mapa);
  assert.deepEqual(g.colunas, ['m', '1', '2', '3', '4']);
  // A ork-x (sem branch) não tem par: a coluna e a linha dela ficam vazias, com a diagonal no lugar.
  assert.deepEqual(g.linhas.map((l: any) => l.celulas.map((x: any) => x.simbolo).join('')), ['1-+? ', '.+-2 ', '!?2- ', '    -']);
  assert.equal(m.PALETA.baixa.fundo, '#f9a825');
  assert.equal(m.corDoRaster('#f9a825'), 0xf9a825);
  assert.equal(m.corDoRaster(null), 0x01000000);
  assert.equal(m.corDoRaster('vermelho'), 0x01000000);
});

test('mapa: o Raster em base64 de triplas u32 traz o cabecalho, o simbolo e as cores da faixa', () => {
  const c = carregar('hooks/colisao.ts');
  const m = carregar('hooks/mapa.tsx');
  for (let n = 0; n <= 10; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
    assert.equal(m.base64(bytes), Buffer.from(bytes).toString('base64'), `n=${n}`);
  }
  const r = m.rasterDoMapa(mapaDeTeste(c));
  assert.deepEqual([r.columns, r.rows], [15, 5]);
  const bytes = Buffer.from(r.cells, 'base64');
  assert.equal(bytes.length, 15 * 5 * 12);
  const celula = (linha: number, coluna: number) => {
    const i = (linha * 15 + coluna) * 12;
    return [String.fromCodePoint(bytes.readUInt32LE(i)), bytes.readUInt32LE(i + 4), bytes.readUInt32LE(i + 8)];
  };
  assert.deepEqual([1, 4, 7, 10, 13].map((col) => celula(0, col)[0]), ['m', '1', '2', '3', '4']);
  assert.deepEqual(celula(1, 1), ['1', 0x000000, 0xf9a825]);
  assert.deepEqual(celula(1, 0), [' ', 0x000000, 0xf9a825]);
  assert.deepEqual(celula(1, 7), ['+', 0xffffff, 0xc62828]);
  assert.deepEqual(celula(2, 1), ['.', 0xffffff, 0x2e7d32]);
  assert.deepEqual(celula(3, 1), ['!', 0xffffff, 0x6a1b9a]);
  assert.deepEqual(celula(1, 10), ['?', 0xffffff, 0x546e7a]);
  assert.deepEqual(celula(1, 4), ['-', 0x757575, 0x01000000]);
  assert.deepEqual(celula(4, 1), [' ', 0x01000000, 0x01000000]);
});

test('mapa: as linhas do painel, a janela do registro do mostrado e o texto de cada conflito', () => {
  const c = carregar('hooks/colisao.ts');
  const m = carregar('hooks/mapa.tsx');
  const mapa = mapaDeTeste(c);
  const linhas = m.linhasDoPainel(mapa, ['ork-a|ork-b'], 61000);
  assert.deepEqual(linhas.map((l: any) => (l.tipo === 'matriz' ? `matriz:${l.altura}` : `${l.tipo}:${l.texto}`)), [
    'titulo:Radar de Colisão · 4 threads · 3 pares em conflito (1 novo) · lido há 1 min',
    'base:base: origin/main 0000000, igual ao remoto',
    'botao:Atualizar',
    'matriz:5',
    'legenda:m = origin/main · número = arquivos em conflito (+ = 10 ou mais) · . limpo · ! erro do git · ? não calculado · - a própria thread · vazio = sem branch local',
    'conflito:ork-a × origin/main: CHANGELOG.md (lease path:CHANGELOG.md de ork-c)',
    'resolve:  resolve: ork worktree sync ork-a --dry-run',
    'conflito:nova: ork-a × ork-b: a, b, c, d, e e mais 5',
    'resolve:  resolve: a que entregar depois roda: ork worktree sync <ork-a ou ork-b> --dry-run',
    'conflito:ork-b × ork-c: x, y',
    'resolve:  resolve: a que entregar depois roda: ork worktree sync <ork-b ou ork-c> --dry-run',
    'nota:erro em ork-c × origin/main: fatal: x',
    'nota:1 par ficou para a próxima rodada',
    'nota:sem branch local: ork-x',
  ]);
  // Linhas da tela: 0 título, 1 base, 2 botão, 3 a 7 matriz, 8 legenda, 9 o primeiro conflito, 11 o segundo.
  assert.deepEqual(m.mostradosVisiveis(linhas, { offset: 9, bodyRows: 2 }).map((v: any) => v.chave), ['radar:@main|ork-a']);
  assert.deepEqual(m.mostradosVisiveis(linhas, { offset: 0, bodyRows: 9 }), []);
  assert.deepEqual(m.mostradosVisiveis(linhas, { offset: 10, bodyRows: 4 }).map((v: any) => v.chave), ['radar:ork-a|ork-b', 'radar:ork-b|ork-c']);
  assert.deepEqual(m.mostradosVisiveis(linhas, undefined), []);
  assert.deepEqual(m.mostradosVisiveis(linhas, { offset: 0, bodyRows: 0 }), []);
  const conflito = linhas.find((l: any) => l.tipo === 'conflito' && l.nova);
  assert.deepEqual(conflito.mostrado, { chave: 'radar:ork-a|ork-b', thread: 'ork-a', texto: 'ork-a × ork-b: a, b, c, d, e e mais 5' });
  assert.deepEqual(m.mostradosDoMapa(mapa).map((v: any) => [v.chave, v.thread]), [['radar:@main|ork-a', 'ork-a'], ['radar:ork-a|ork-b', 'ork-a'], ['radar:ork-b|ork-c', 'ork-b']]);
  assert.deepEqual(m.linhasDoPainel({ ...mapa, lidoEm: null, erro: 'a lista falhou' }, [], 0).map((l: any) => l.texto),
    ['Radar de Colisão · ainda sem rodada', 'a rodada parou: a lista falhou', 'Atualizar']);
  assert.deepEqual(m.linhasDoPainel({ ...mapa, threads: [], celulas: [] }, [], 1000).map((l: any) => l.texto).slice(-1), ['nenhuma thread aberta para cruzar']);
  assert.ok(m.linhasDoPainel({ ...mapa, erro: 'x' }, [], 1000).some((l: any) => l.texto === 'a última rodada parou: x; o mapa é o da rodada anterior'));
  assert.deepEqual([m.idade(0), m.idade(59400), m.idade(61000), m.idade(3 * 3600000)], ['0 s', '59 s', '1 min', '3 h']);
  // A linha cortada na largura do painel: o registro leva só o que coube (a reticência ocupa a última coluna).
  const nova = linhas.find((l: any) => l.tipo === 'conflito' && l.nova);
  assert.deepEqual(m.mostradoNaLargura(nova, 200), nova.mostrado);
  assert.deepEqual(m.mostradoNaLargura(nova, undefined), nova.mostrado);
  assert.equal(m.mostradoNaLargura(nova, 20).texto, 'ork-a × ork-b');
  assert.equal(m.mostradoNaLargura(nova, 7), null);
  assert.deepEqual(m.mostradosVisiveis(linhas, { offset: 11, bodyRows: 1 }, 20).map((v: any) => v.texto), ['ork-a × ork-b']);
});

test('mapa (D6): as colisoes novas depois da rodada e a linha da faixa, que sai sem nova', () => {
  const c = carregar('hooks/colisao.ts');
  const m = carregar('hooks/mapa.tsx');
  const mapa = mapaDeTeste(c);
  assert.deepEqual(m.novasDepoisDaRodada([], ['ork-b|ork-c', '@main|ork-a'], mapa), ['@main|ork-a', 'ork-b|ork-c']);
  assert.deepEqual(m.novasDepoisDaRodada(['ork-a|ork-b', '@main|ork-sumiu'], [], mapa), ['ork-a|ork-b']);
  // A ponte já escreve o nome do mod antes da linha (`radar: `): o texto não o repete.
  assert.equal(m.textoDaFaixa(mapa, ['@main|ork-a', 'ork-b|ork-c']), 'colisão nova entre ork-a e origin/main (1 arquivo) e mais 1; /radar abre o mapa');
  assert.equal(m.textoDaFaixa(mapa, ['ork-b|ork-c']), 'colisão nova entre ork-b e ork-c (2 arquivos); /radar abre o mapa');
  assert.equal(m.textoDaFaixa(mapa, []), undefined);
  assert.equal(m.textoDaFaixa(mapa, ['@main|ork-b']), undefined);
});

test('mapa: o desenho decide pela superficie: Raster no terminal, tabela de Box e Text fora dele, mesmo com o construtor', () => {
  const c = carregar('hooks/colisao.ts');
  const m = carregar('hooks/mapa.tsx');
  const mapa = mapaDeTeste(c);
  const el = { Box: 'Box', Text: 'Text', Button: 'Button', Raster: 'Raster' };
  const linhas = m.linhasDoPainel(mapa, [], 1000);
  let apertou = 0;
  const terminal = m.desenharPainel(el, mapa, linhas, { terminal: true, atualizar: () => { apertou++; } });
  const raster = nosDe(terminal, 'Raster');
  assert.equal(raster.length, 1);
  assert.deepEqual([raster[0]?.props.columns, raster[0]?.props.rows, raster[0]?.props.key], [15, 5, 'mapa']);
  assert.equal(raster[0]?.props.cells, m.rasterDoMapa(mapa).cells);
  assert.ok(nosDe(terminal, 'Text').every((t) => !t.props.backgroundColor));
  const botao = nosDe(terminal, 'Button')[0] as No;
  assert.equal(botao.props.label, 'Atualizar');
  (botao.props.onPress as () => void)();
  assert.equal(apertou, 1);
  const desktop = m.desenharPainel(el, mapa, linhas, { terminal: false });
  assert.equal(nosDe(desktop, 'Raster').length, 0);
  const celulas = nosDe(desktop, 'Text').filter((t) => t.props.backgroundColor);
  assert.equal(celulas.length, 9);
  assert.deepEqual(celulas.filter((t) => textoDoNo(t) === ' 1 ').map((t) => t.props.backgroundColor), ['#f9a825']);
  assert.deepEqual(celulas.filter((t) => textoDoNo(t) === ' + ').map((t) => t.props.backgroundColor), ['#c62828', '#c62828']);
});

test('D5: o mktemp e o rm de verdade, pelo argv do Radar: o temporario nasce com a forma esperada e o rm apaga so ele', (t) => {
  const c = carregar('hooks/colisao.ts');
  // O sandbox do verify do MCP e do `ork claims conferir` deixa o `/tmp` só leitura: lá esta prova não roda, com o
  // motivo dito; o CI e o `ork verify` do CLI a rodam inteira.
  let tmpGravavel = true;
  try { fs.rmdirSync(fs.mkdtempSync('/tmp/ork-radar-sonda-')); } catch { tmpGravavel = false; }
  if (!tmpGravavel) {
    t.skip('o /tmp não é gravável aqui (sandbox do verify): a prova do mktemp e do rm reais roda no CI e no ork verify do CLI');
    return;
  }
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-radar-tmp-'));
  try {
    const rodar = rodador(raiz);
    const criado = rodar(raiz, c.argvDoTemporario());
    assert.equal(criado.exitCode, 0, criado.stderr);
    const temporario = c.temporarioValido(criado.stdout);
    assert.ok(temporario && fs.statSync(temporario).isDirectory(), criado.stdout);
    fs.mkdirSync(path.join(temporario, 'objetos', 'ab'), { recursive: true });
    fs.writeFileSync(path.join(temporario, 'objetos', 'ab', 'cdef'), 'objeto');
    const vizinho = `${temporario}-vizinho`;
    fs.mkdirSync(vizinho);
    try {
      const apagado = rodar(raiz, c.argvDeApagar(temporario));
      assert.equal(apagado.exitCode, 0, apagado.stderr);
      assert.equal(fs.existsSync(temporario), false);
      assert.equal(fs.existsSync(vizinho), true);
      assert.throws(() => c.argvDeApagar(vizinho), /próprio temporário/);
    } finally {
      fs.rmSync(vizinho, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
