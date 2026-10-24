/**
 * RM-059 (T0.7): o despacho `claude-bg` leva os mods de papel `fase` da instalacao do adaptador,
 * conferidos contra o `INSTALADO.json`. Os mods de verdade chegam por outra thread: aqui o catalogo e
 * uma copia temporaria com o mod de exemplo de `core/test/fixtures/mods/ork-exemplo`, sem rede e sem
 * `claude` (a versao vai no pedido do despacho).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { exigirCatalogo } from '../src/catalogo';
import { instalarAdaptador, lerRecibo } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { novaThread } from '../src/thread';
import { contextoDoProjeto, lerDeclaracaoDeMod, ModDeFase } from '../src/runtime-context';
import { montarComando, modsParaOClaude } from '../src/adapters/claude-bg';

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
const EXEMPLO = path.join(RAIZ, 'core', 'test', 'fixtures', 'mods', 'ork-exemplo');
const VERSAO = '2.1.296 (Claude Code)';

interface ModDoCatalogo { nome: string; papeis: unknown; minimo?: string; dependencias?: unknown; semManifesto?: boolean; modulo?: string }

/** Copia do catalogo com os mods pedidos no lugar dos que o repositorio tiver em `adapters/claude-code/mods/`. */
function catalogoCom(mods: ModDoCatalogo[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-test-mods-catalogo-'));
  for (const parte of ['skills', 'references', 'adapters/claude-code']) {
    fs.cpSync(path.join(RAIZ, parte), path.join(dir, parte), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, 'eval'));
  fs.rmSync(path.join(dir, 'adapters', 'claude-code', 'mods'), { recursive: true, force: true });
  for (const m of mods) {
    const alvo = path.join(dir, 'adapters', 'claude-code', 'mods', m.nome);
    fs.cpSync(EXEMPLO, alvo, { recursive: true });
    const arquivoDoManifesto = path.join(alvo, '.claude-plugin', 'plugin.json');
    const manifesto = JSON.parse(fs.readFileSync(arquivoDoManifesto, 'utf8'));
    manifesto.name = m.nome;
    if (m.dependencias !== undefined) manifesto.dependencies = m.dependencias;
    fs.writeFileSync(arquivoDoManifesto, JSON.stringify(manifesto, null, 2) + '\n');
    if (m.semManifesto) fs.rmSync(arquivoDoManifesto);
    if (m.modulo) {
      fs.renameSync(path.join(alvo, 'hooks', 'register.js'), path.join(alvo, 'hooks', m.modulo));
      fs.writeFileSync(path.join(alvo, 'hooks', 'hooks.json'), JSON.stringify({ modules: [`./${m.modulo}`] }, null, 2) + '\n');
    }
    fs.mkdirSync(path.join(alvo, 'types'));
    fs.writeFileSync(path.join(alvo, 'types', 'index.d.ts'), `export type ${m.nome.replaceAll('-', '_')} = unknown;\n`);
    fs.writeFileSync(path.join(alvo, 'orkastery-mod.json'),
      JSON.stringify({ formato: 'ork.mod/v1', papeis: m.papeis, claudeCodeMinimo: m.minimo ?? '2.1.287' }) + '\n');
  }
  return dir;
}

/** Projeto com o adaptador instalado do catalogo temporario; o contexto do runtime ja confere os mods. */
function preparar(nome: string, mods: ModDoCatalogo[]) {
  const catalogo = catalogoCom(mods);
  let p: ReturnType<typeof projetoTemporario> | null = null;
  const limpar = () => { try { p?.limpar(); } finally { fs.rmSync(catalogo, { recursive: true, force: true }); } };
  try {
    p = projetoTemporario(nome);
    const instalado = instalarAdaptador('claude-code', { projeto: p.dir, catalogo, orkBin: 'ork' });
    instalarMcp({ projeto: p.dir, host: 'claude-code', permissoesFilho: 'interactive' });
    const t = novaThread(p.carregado, { nome: 'mods', modo: 'auto', criarWorktree: true }).thread;
    const contexto = contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id)!;
    const comando = (versaoClaude: string | null = VERSAO) =>
      montarComando({ cwd: t.worktree!, nome: 'fase', prompt: 'pedido', contextoRuntime: contexto, versaoClaude });
    return { p, t, instalado, comando, limpar };
  } catch (e) { limpar(); throw e; }
}

const pastasDePlugin = (args: string[]) => args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1]] : []));

test('S1 o recibo lista os mods de fase e de dono, e o despacho leva so o de fase, logo depois do plugin', () => {
  const f = preparar('mods-papel', [{ nome: 'ork-exemplo', papeis: ['fase'] }, { nome: 'ork-exemplo-dono', papeis: ['dono'] }]);
  try {
    const recibo = lerRecibo(f.instalado.destino)!.arquivos.map((a) => a.arquivo);
    for (const arquivo of ['mods/ork-exemplo/orkastery-mod.json', 'mods/ork-exemplo/hooks/register.js',
      'mods/ork-exemplo/.claude-plugin/plugin.json', 'mods/ork-exemplo-dono/orkastery-mod.json']) {
      assert.ok(recibo.includes(arquivo), `${arquivo} no INSTALADO.json`);
    }
    const args = f.comando();
    const pastas = pastasDePlugin(args);
    assert.equal(pastas.length, 2);
    assert.equal(pastas[1], path.join(pastas[0], 'mods', 'ork-exemplo'));
    assert.equal(args[args.indexOf('--plugin-dir') + 2], '--plugin-dir');
    assert.equal(args[args.indexOf('--plugin-dir') + 4], '--strict-mcp-config');
  } finally { f.limpar(); }
});

test('S2 sem mods o comando continua com um --plugin-dir so, seguido do --strict-mcp-config', () => {
  const f = preparar('mods-nenhum', []);
  try {
    for (const versao of [VERSAO, null]) {
      const args = f.comando(versao);
      assert.equal(pastasDePlugin(args).length, 1);
      assert.equal(args[args.indexOf('--plugin-dir') + 2], '--strict-mcp-config');
    }
  } finally { f.limpar(); }
});

test('S3 arquivo fora do recibo, link e arquivo especial no mod de fase recusam o despacho; no mod de dono, nao', () => {
  const f = preparar('mods-recibo', [{ nome: 'ork-exemplo', papeis: ['fase'] }, { nome: 'ork-exemplo-dono', papeis: ['dono'] }]);
  try {
    const mod = path.join(f.instalado.destino, 'mods', 'ork-exemplo');
    const extra = path.join(mod, 'commands', 'extra.md');
    fs.mkdirSync(path.dirname(extra));
    fs.writeFileSync(extra, '---\ndescription: entrou sem recibo\n---\n');
    assert.throws(() => f.comando(), /runtime\.context\.installation: mod ork-exemplo: arquivo fora do INSTALADO\.json \(commands\/extra\.md\)/);
    fs.rmSync(path.dirname(extra), { recursive: true });
    const atalho = path.join(mod, 'hooks', 'atalho.js');
    fs.symlinkSync('register.js', atalho);
    assert.throws(() => f.comando(), /runtime\.context\.installation: mod ork-exemplo: link em hooks\/atalho\.js/);
    fs.unlinkSync(atalho);
    const cano = path.join(mod, 'hooks', 'cano');
    execFileSync('mkfifo', [cano]);
    assert.throws(() => f.comando(), /runtime\.context\.installation: mod ork-exemplo: arquivo especial em hooks\/cano/);
    fs.unlinkSync(cano);
    fs.writeFileSync(path.join(f.instalado.destino, 'mods', 'ork-exemplo-dono', 'extra.js'), 'export const x = 1\n');
    assert.equal(pastasDePlugin(f.comando()).length, 2, 'o mod de dono nao vai ao despacho e nao e conferido');
    fs.writeFileSync(path.join(mod, 'hooks', 'register.js'), '// editado depois da instalacao\n');
    assert.throws(() => f.comando(), /runtime\.context\.installation: bytes instalados divergentes/);
  } finally { f.limpar(); }
});

test('S4 o .gitignore que o Claude Code escreve em .claude-plugin/types e aceito', () => {
  const f = preparar('mods-tipos-gitignore', [{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  try {
    const tipos = path.join(f.instalado.destino, 'mods', 'ork-exemplo', '.claude-plugin', 'types');
    fs.mkdirSync(tipos, { recursive: true });
    fs.writeFileSync(path.join(tipos, '.gitignore'), '*\n');
    assert.equal(pastasDePlugin(f.comando()).length, 2);
  } finally { f.limpar(); }
});

test('S4.1 link .d.ts do motor para types de outro mod na mesma instalacao e no recibo e aceito', () => {
  const f = preparar('mods-tipos-link', [{ nome: 'ork-exemplo', papeis: ['fase'] }, { nome: 'ork-ponte', papeis: ['fase'] }]);
  try {
    const dir = path.join(f.instalado.destino, 'mods', 'ork-exemplo', '.claude-plugin', 'types', 'ork-ponte');
    const alvo = path.join(f.instalado.destino, 'mods', 'ork-ponte', 'types', 'index.d.ts');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(path.relative(dir, alvo), path.join(dir, 'index.d.ts'));
    assert.equal(pastasDePlugin(f.comando()).length, 3);
  } finally { f.limpar(); }
});

test('S4.2 tsconfig da raiz com o extends exato do motor e aceito como JSON', () => {
  const f = preparar('mods-tipos-tsconfig', [{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  try {
    const mod = path.join(f.instalado.destino, 'mods', 'ork-exemplo');
    fs.writeFileSync(path.join(mod, 'tsconfig.json'), '{\n  "extends": "./.claude-plugin/types/tsconfig.json"\n}\n');
    assert.equal(pastasDePlugin(f.comando()).length, 2);
  } finally { f.limpar(); }
});

test('S4.3 link de tipos para fora da instalacao continua recusado', () => {
  const f = preparar('mods-tipos-link-externo', [{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  const externo = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-test-tipo-externo-'));
  try {
    const dir = path.join(f.instalado.destino, 'mods', 'ork-exemplo', '.claude-plugin', 'types', 'fora');
    const alvo = path.join(externo, 'index.d.ts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(alvo, 'export type Fora = unknown;\n');
    fs.symlinkSync(alvo, path.join(dir, 'index.d.ts'));
    assert.throws(() => f.comando(), /link em \.claude-plugin\/types\/fora\/index\.d\.ts/);
  } finally { f.limpar(); fs.rmSync(externo, { recursive: true, force: true }); }
});

test('S4.4 link de tipos para arquivo da instalacao fora do recibo continua recusado', () => {
  const f = preparar('mods-tipos-link-sem-recibo', [
    { nome: 'ork-exemplo', papeis: ['fase'] }, { nome: 'ork-ponte', papeis: ['dono'] },
  ]);
  try {
    const dir = path.join(f.instalado.destino, 'mods', 'ork-exemplo', '.claude-plugin', 'types', 'ork-ponte');
    const alvo = path.join(f.instalado.destino, 'mods', 'ork-ponte', 'types', 'extra.d.ts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(alvo, 'export type Extra = unknown;\n');
    fs.symlinkSync(path.relative(dir, alvo), path.join(dir, 'index.d.ts'));
    assert.throws(() => f.comando(), /link em \.claude-plugin\/types\/ork-ponte\/index\.d\.ts/);
  } finally { f.limpar(); }
});

test('S4.5 link do motor que nao termina em .d.ts continua recusado', () => {
  const f = preparar('mods-tipos-link-extensao', [{ nome: 'ork-exemplo', papeis: ['fase'] }, { nome: 'ork-ponte', papeis: ['fase'] }]);
  try {
    const dir = path.join(f.instalado.destino, 'mods', 'ork-exemplo', '.claude-plugin', 'types', 'ork-ponte');
    const alvo = path.join(f.instalado.destino, 'mods', 'ork-ponte', 'types', 'index.d.ts');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(path.relative(dir, alvo), path.join(dir, 'index.js'));
    assert.throws(() => f.comando(), /link em \.claude-plugin\/types\/ork-ponte\/index\.js/);
  } finally { f.limpar(); }
});

test('S4.6 tsconfig da raiz com qualquer outro conteudo continua recusado', () => {
  const f = preparar('mods-tipos-tsconfig-invalido', [{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  try {
    const arquivo = path.join(f.instalado.destino, 'mods', 'ork-exemplo', 'tsconfig.json');
    for (const conteudo of ['{}\n', '{"extends":"./outro.json"}\n',
      '{"extends":"./.claude-plugin/types/tsconfig.json","compilerOptions":{}}\n', 'nao e json\n']) {
      fs.writeFileSync(arquivo, conteudo);
      assert.throws(() => f.comando(), /arquivo fora do INSTALADO\.json \(tsconfig\.json\)/);
    }
  } finally { f.limpar(); }
});

test('S4.7 qualquer outro arquivo fora do recibo continua recusado', () => {
  const f = preparar('mods-tipos-outro', [{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  try {
    const tipos = path.join(f.instalado.destino, 'mods', 'ork-exemplo', '.claude-plugin', 'types');
    fs.mkdirSync(tipos, { recursive: true });
    fs.writeFileSync(path.join(tipos, 'gancho.js'), 'export const y = 2\n');
    assert.throws(() => f.comando(), /arquivo fora do INSTALADO\.json \(\.claude-plugin\/types\/gancho\.js\)/);
  } finally { f.limpar(); }
});

test('S4.8 declaracoes e tsconfig dentro de .claude-plugin/types continuam aceitos', () => {
  const f = preparar('mods-tipos-legado', [{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  try {
    const tipos = path.join(f.instalado.destino, 'mods', 'ork-exemplo', '.claude-plugin', 'types');
    fs.mkdirSync(path.join(tipos, 'claude-code'), { recursive: true });
    fs.writeFileSync(path.join(tipos, 'claude-code', 'index.d.ts'), 'export type X = 1;\n');
    fs.writeFileSync(path.join(tipos, 'tsconfig.json'), '{}\n');
    assert.equal(pastasDePlugin(f.comando()).length, 2);
  } finally { f.limpar(); }
});

test('S5 declaracao invalida ou manifesto fora do recibo no mod de fase recusam o contexto do despacho', () => {
  for (const [nome, mod, erro] of [
    ['mods-repetido', { nome: 'ork-exemplo', papeis: ['fase', 'fase'] }, /papeis fora de dono e fase, vazios ou repetidos/],
    ['mods-papel-invalido', { nome: 'ork-exemplo', papeis: ['revisor'] }, /papeis fora de dono e fase/],
    ['mods-sem-manifesto', { nome: 'ork-exemplo', papeis: ['fase'], semManifesto: true }, /\.claude-plugin\/plugin\.json fora do recibo/],
  ] as const) {
    assert.throws(() => preparar(nome, [mod]),
      (e: Error) => /^runtime\.context\.installation: mod ork-exemplo: /.test(e.message) && erro.test(e.message), nome);
  }
  assert.throws(() => lerDeclaracaoDeMod('{"formato":"ork.mod/v2","papeis":["fase"],"claudeCodeMinimo":"2.1.287"}'), /ork\.mod\/v1/);
  assert.throws(() => lerDeclaracaoDeMod('{"formato":"ork.mod/v1","papeis":["fase"],"claudeCodeMinimo":"2.1"}'), /X\.Y\.Z/);
  assert.throws(() => lerDeclaracaoDeMod('[]'), /objeto/);
  assert.deepEqual(lerDeclaracaoDeMod('{"formato":"ork.mod/v1","papeis":["dono","fase"],"claudeCodeMinimo":"2.1.287"}').papeis, ['dono', 'fase']);
});

test('S6 versao: abaixo do minimo do mod ou da API de mods, ou ilegivel, o mod fica fora e o despacho segue', () => {
  const f = preparar('mods-versao', [{ nome: 'ork-exemplo', papeis: ['fase'] }, { nome: 'ork-exemplo-novo', papeis: ['fase'], minimo: '2.1.300' }]);
  try {
    const base = pastasDePlugin(f.comando())[0];
    assert.deepEqual(pastasDePlugin(f.comando()), [base, path.join(base, 'mods', 'ork-exemplo')]);
    assert.deepEqual(pastasDePlugin(f.comando('2.1.300 (Claude Code)')),
      [base, path.join(base, 'mods', 'ork-exemplo'), path.join(base, 'mods', 'ork-exemplo-novo')]);
    assert.deepEqual(pastasDePlugin(f.comando('2.1.286 (Claude Code)')), [base]);
    assert.deepEqual(pastasDePlugin(f.comando(null)), [base]);
    assert.deepEqual(pastasDePlugin(f.comando('claude sem numero')), [base]);
  } finally { f.limpar(); }
  const antigo: ModDeFase = { nome: 'ork-velho', dir: '/x', claudeCodeMinimo: '2.0.0', dependencias: [] };
  assert.deepEqual(modsParaOClaude([antigo], '2.1.280 (Claude Code)'), [], 'o piso da API de mods vale mesmo com minimo declarado menor');
  assert.deepEqual(modsParaOClaude([antigo], '2.1.287 (Claude Code)'), [antigo]);
  assert.deepEqual(modsParaOClaude([antigo], '10.0.0'), [antigo]);
});

test('S7 a dependencia vai antes de quem depende, nas formas de dependencies aceitas; o resto segue o nome', () => {
  const f = preparar('mods-ordem', [
    { nome: 'ork-a', papeis: ['fase'], dependencias: ['ork-ponte@orkastery'] },
    { nome: 'ork-b', papeis: ['fase'], dependencias: [{ name: 'ork-ponte' }] },
    { nome: 'ork-c', papeis: ['fase'], dependencias: { 'ork-ponte': '*' } },
    { nome: 'ork-ponte', papeis: ['dono', 'fase'], dependencias: 'texto que nao e lista' },
    { nome: 'ork-d', papeis: ['fase'] },
  ]);
  try {
    const nomes = pastasDePlugin(f.comando()).slice(1).map((p) => path.basename(p));
    assert.deepEqual(nomes, ['ork-ponte', 'ork-a', 'ork-b', 'ork-c', 'ork-d']);
  } finally { f.limpar(); }
});

test('S8 arquivo de mod que saiu do catalogo sai da copia na reinstalacao; o editado a mao fica e a recusa diz onde apagar', () => {
  const f = preparar('mods-renomeado', [{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  const novo = catalogoCom([{ nome: 'ork-exemplo', papeis: ['fase'], modulo: 'registro.js' }]);
  try {
    const mod = path.join(f.instalado.destino, 'mods', 'ork-exemplo');
    const ensaio = instalarAdaptador('claude-code', { projeto: f.p.dir, catalogo: novo, orkBin: 'ork', dryRun: true });
    assert.deepEqual(ensaio.removidos, ['mods/ork-exemplo/hooks/register.js']);
    assert.equal(fs.existsSync(path.join(mod, 'hooks', 'register.js')), true, 'o ensaio nao apaga');
    const r = instalarAdaptador('claude-code', { projeto: f.p.dir, catalogo: novo, orkBin: 'ork' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.removidos, ['mods/ork-exemplo/hooks/register.js']);
    assert.equal(fs.existsSync(path.join(mod, 'hooks', 'register.js')), false);
    assert.equal(fs.existsSync(path.join(mod, 'hooks', 'registro.js')), true);
    assert.equal(pastasDePlugin(f.comando()).length, 2, 'o despacho leva o mod de novo, sem passo a mao');
    // Editado a mao depois da instalacao: o instalador nao apaga, e o despacho recusa dizendo o caminho.
    const velho = catalogoCom([{ nome: 'ork-exemplo', papeis: ['fase'] }]);
    try {
      instalarAdaptador('claude-code', { projeto: f.p.dir, catalogo: velho, orkBin: 'ork', force: true });
      fs.appendFileSync(path.join(mod, 'hooks', 'register.js'), '// editado a mao\n');
      const de = instalarAdaptador('claude-code', { projeto: f.p.dir, catalogo: novo, orkBin: 'ork' });
      assert.equal(de.removidos, undefined);
      assert.throws(() => f.comando(), (e: Error) => /arquivo fora do INSTALADO\.json \(hooks\/register\.js\)/.test(e.message) &&
        e.message.includes(`apague ${path.join(mod, 'hooks', 'register.js')}`));
    } finally { fs.rmSync(velho, { recursive: true, force: true }); }
  } finally { f.limpar(); fs.rmSync(novo, { recursive: true, force: true }); }
});

test('S9 mod cuja dependencia ficou de fora (por versao ou por ser so de dono) tambem fica de fora', () => {
  const f = preparar('mods-dependencia', [
    { nome: 'ork-ponte', papeis: ['dono'] },
    { nome: 'ork-a', papeis: ['fase'], dependencias: ['ork-ponte'] },
    { nome: 'ork-novo', papeis: ['fase'], minimo: '2.1.300' },
    { nome: 'ork-b', papeis: ['fase'], dependencias: [{ name: 'ork-novo' }] },
    { nome: 'ork-c', papeis: ['fase'], dependencias: ['plugin-de-fora'] },
  ]);
  try {
    const nomes = (versao: string) => pastasDePlugin(f.comando(versao)).slice(1).map((p) => path.basename(p));
    assert.deepEqual(nomes(VERSAO), ['ork-c'], 'ork-a sem a ponte (so de dono), ork-b sem o ork-novo (versao); dependencia de fora da instalacao nao conta');
    assert.deepEqual(nomes('2.1.300 (Claude Code)'), ['ork-novo', 'ork-b', 'ork-c']);
  } finally { f.limpar(); }
});

test('S10 o claude --version so roda quando a instalacao tem mod de fase', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-test-claude-falso-'));
  const registro = path.join(dir, 'chamadas.log');
  fs.writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\necho "$*" >> '${registro}'\necho '2.1.296 (Claude Code)'\n`);
  fs.chmodSync(path.join(dir, 'claude'), 0o755);
  const sem = preparar('mods-chamada-sem', []);
  const com = preparar('mods-chamada-com', [{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  const PATH = process.env.PATH;
  try {
    process.env.PATH = `${dir}${path.delimiter}${PATH}`;
    const semArgs = montarComando({ cwd: sem.t.worktree!, nome: 'f', prompt: 'p', contextoRuntime: contextoDoProjeto(sem.p.dir, 'claude-bg', sem.t.worktree!, sem.t.id)! });
    assert.equal(fs.existsSync(registro), false, 'sem mod de fase, o claude nao e chamado');
    assert.equal(pastasDePlugin(semArgs).length, 1);
    const comArgs = montarComando({ cwd: com.t.worktree!, nome: 'f', prompt: 'p', contextoRuntime: contextoDoProjeto(com.p.dir, 'claude-bg', com.t.worktree!, com.t.id)! });
    assert.deepEqual(fs.readFileSync(registro, 'utf8').trim().split('\n'), ['--version']);
    assert.equal(pastasDePlugin(comArgs).length, 2);
  } finally {
    process.env.PATH = PATH;
    sem.limpar(); com.limpar(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S11 arquivo comum da raiz de mods/ so vale com recibo; o que saiu do catalogo sai da copia; sem mod de fase, nada muda', () => {
  const comLista = catalogoCom([{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  fs.writeFileSync(path.join(comLista, 'adapters', 'claude-code', 'mods', 'autoridade.json'), '{"lista":[]}\n');
  const semLista = catalogoCom([{ nome: 'ork-exemplo', papeis: ['fase'] }]);
  const soDono = catalogoCom([{ nome: 'ork-exemplo-dono', papeis: ['dono'] }]);
  const p = projetoTemporario('mods-raiz');
  try {
    const instalado = instalarAdaptador('claude-code', { projeto: p.dir, catalogo: comLista, orkBin: 'ork' });
    instalarMcp({ projeto: p.dir, host: 'claude-code', permissoesFilho: 'interactive' });
    const t = novaThread(p.carregado, { nome: 'mods', modo: 'auto', criarWorktree: true }).thread;
    const comando = () => montarComando({ cwd: t.worktree!, nome: 'fase', prompt: 'pedido',
      contextoRuntime: contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id)!, versaoClaude: VERSAO });
    const raizDosMods = path.join(instalado.destino, 'mods');
    assert.ok(lerRecibo(instalado.destino)!.arquivos.some((a) => a.arquivo === 'mods/autoridade.json'));
    assert.equal(pastasDePlugin(comando()).length, 2);
    // Escrito a mao na raiz, fora do recibo: a ponte le ../autoridade.json antes da propria pasta.
    const solta = path.join(raizDosMods, 'outra-lista.json');
    fs.writeFileSync(solta, '{"lista":["tudo"]}\n');
    assert.throws(() => comando(), (e: Error) => /runtime\.context\.installation: mods\/: arquivo fora do INSTALADO\.json \(outra-lista\.json\)/.test(e.message) &&
      e.message.includes(`apague ${solta}`));
    fs.unlinkSync(solta);
    fs.symlinkSync('autoridade.json', path.join(raizDosMods, 'atalho.json'));
    assert.throws(() => comando(), /runtime\.context\.installation: mods\/: link em atalho\.json/);
    fs.unlinkSync(path.join(raizDosMods, 'atalho.json'));
    // A lista saiu do catalogo (foi para dentro da pasta do mod, por exemplo): a reinstalacao tira a copia velha.
    const r = instalarAdaptador('claude-code', { projeto: p.dir, catalogo: semLista, orkBin: 'ork' });
    assert.deepEqual(r.removidos, ['mods/autoridade.json']);
    assert.equal(fs.existsSync(path.join(raizDosMods, 'autoridade.json')), false);
    assert.equal(pastasDePlugin(comando()).length, 2, 'a pasta dos mods fica e o despacho segue');
    // So mod de dono: o despacho nao leva mod e nao confere a raiz, como antes dos mods.
    instalarAdaptador('claude-code', { projeto: p.dir, catalogo: soDono, orkBin: 'ork' });
    fs.writeFileSync(solta, '{"lista":["tudo"]}\n');
    assert.equal(pastasDePlugin(comando()).length, 1);
  } finally {
    p.limpar();
    for (const c of [comLista, semLista, soDono]) fs.rmSync(c, { recursive: true, force: true });
  }
});
