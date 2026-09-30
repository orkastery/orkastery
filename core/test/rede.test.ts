/**
 * RM-053: a Orkastery Network, com a forja simulada.
 *
 * `gh`, `glab` e os runtimes sao scripts Node falsos num diretorio proprio, primeiro no PATH, ao
 * lado de um diretorio so com o `git`; `ORK_BINARIOS_EXTRA=''` impede achar a forja de verdade nas
 * pastas de usuario. O "repositorio da rede" e um remoto bare local, que a forja falsa devolve como
 * URL. Nenhum teste toca a rede, a conta do dono nem o ~/.orkastery de quem roda.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acharBinario, comGitIsolado, forjaPorNome, forjasDaMaquina, pastasDeBinarios, versaoDoBinario } from '../src/rede-forja';
import { buscarBranch, gravarNaBranch } from '../src/branch-de-estado';
import { publicarMaquina } from '../src/fabrica-estado';
import { exigirManifesto } from '../src/manifest';
import { gravarConfigDaMaquina } from '../src/maquina';
import { procurarSegredos } from '../src/policies';
import { dirDoCache, entrarNaRede, exigirRetratoSeguro, exigirSoOProprioRetrato, normalizarRetrato, prepararCache, publicarRede,
  publicarRedeNaBatida, retratoDaMaquina, sairDaRede } from '../src/rede';
import { adesaoDaRede, lerConfigDaRede, publicarRedeEmSegundoPlano, TETO_DE_TENTATIVA_MS, tomarVezDePublicar } from '../src/rede-adesao';
import { limparRemoto, projetosConhecidos } from '../src/rede-projetos';
import { lerRede, SEM_BATIDA_MS, textoDaRede } from '../src/rede-status';
import { adicionarPerfil } from '../src/runtime-profiles';
import { exec } from '../src/util';
import { dirTemporario, projetoTemporario } from './apoio';

/** A forja e os runtimes falsos: um script so, que decide pelo nome com que foi chamado. */
const SCRIPT_FALSO = `#!${process.execPath}
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const cli = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const dir = process.env.FORJA_FAKE_DIR;
const arquivo = path.join(dir, 'repos.json');
const ler = () => { try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return {}; } };
const sair = (code, out, err) => { if (out) process.stdout.write(out); if (err) process.stderr.write(err); process.exit(code); };
const TOKEN = 'ghp_FAKEtoken0123456789abcdefghijABCDEFGH';
const RUNTIMES = { claude: '9.9.9 (Claude Code)', codex: 'codex-cli 0.99.0', openclaw: 'OpenClaw 2026.9.9 (abc1234)', lixo: 'sem versao aqui' };
if (RUNTIMES[cli] !== undefined) {
  if (args[0] === '--version') sair(0, RUNTIMES[cli] + '\\n');
  if (args[0] === 'auth') sair(0, 'Logado como dono-pago@exemplo.com, plano Claude Max 20x (pago), token sk-ant-oat01-FAKE0123456789abcdef\\n');
  sair(2, '', 'fake: nao simulado\\n');
}
const login = cli === 'gh' ? (process.env.FORJA_FAKE_LOGIN || 'pessoa-teste') : (process.env.FORJA_FAKE_LOGIN_LAB || 'pessoa-lab');
if (args[0] === '--version') sair(0, cli === 'gh' ? 'gh version 2.99.0 (2026-01-01)\\nhttps://github.com/cli/cli/releases/tag/v2.99.0\\n' : 'glab 1.50.0 (2026-01-01)\\n');
if (args[0] === 'config' && args[1] === 'get' && args[2] === 'git_protocol') sair(0, (process.env.FORJA_FAKE_PROTOCOLO || 'https') + '\\n');
if (args[0] === 'auth') {
  if (process.env.FORJA_FAKE_LOG) fs.appendFileSync(process.env.FORJA_FAKE_LOG, JSON.stringify({ cli, args }) + '\\n');
  if (args[1] === 'token') sair(0, TOKEN + '\\n');
  if (args[1] === 'git-credential') sair(0);
  sair(0, 'Logged in as ' + login + '\\nToken: ' + TOKEN + '\\n');
}
if (args[0] !== 'api') sair(2, '', 'fake: nao simulado\\n');
if (process.env.FORJA_FAKE_LOG) fs.appendFileSync(process.env.FORJA_FAKE_LOG, JSON.stringify({ cli, args }) + '\\n');
if (process.env.FORJA_FAKE_SEM_LOGIN === '1') sair(1, '', cli === 'gh' ? 'gh: To get started with GitHub CLI, please run:  gh auth login\\n' : 'glab: not authenticated\\n');
if (process.env.FORJA_FAKE_ERRO === '1') sair(1, '', cli + ': Server Error (HTTP 500)\\n');
let metodo = 'GET', rota = null;
const campos = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '-X' || args[i] === '--method') { metodo = args[++i]; continue; }
  if (args[i] === '--hostname') { i++; continue; }
  if (['-f', '-F', '--field', '--raw-field'].includes(args[i])) { const [k, ...v] = args[++i].split('='); campos[k] = v.join('='); continue; }
  if (rota === null) rota = args[i];
}
if (rota === 'user') sair(0, JSON.stringify(cli === 'gh'
  ? { login, id: 42, email: 'dono-secreto@exemplo.com', plan: { name: 'pro', private_repos: 9999 }, token: TOKEN }
  : { username: login, id: 7, email: 'lab-secreto@exemplo.com', plan: 'gold', private_token: 'glpat-FAKE0123456789abcdefgh' }));
const estado = ler();
const resposta = (chave) => {
  const r = estado[chave];
  const visibilidade = r.visibilidade || (r.privado ? 'private' : 'public');
  // A URL SSH e inutilizavel de proposito: quem publicar por ela falha.
  return cli === 'gh'
    ? { full_name: chave, private: visibilidade !== 'public', visibility: visibilidade, clone_url: r.url, ssh_url: 'git@fake.invalid:' + chave + '.git' }
    : { path_with_namespace: chave, visibility: visibilidade, http_url_to_repo: r.url, ssh_url_to_repo: 'git@fake.invalid:' + chave + '.git' };
};
if (metodo === 'POST' && (rota === 'user/repos' || rota === 'projects')) {
  const chave = login + '/' + campos.name;
  if (estado[chave]) sair(1, '', 'fake: ja existe (HTTP 422)\\n');
  const url = path.join(dir, 'repos', chave + '.git');
  fs.mkdirSync(url, { recursive: true });
  cp.execFileSync('git', ['init', '--bare', '-q', url]);
  estado[chave] = { privado: rota === 'user/repos' ? campos.private === 'true' : campos.visibility === 'private', url };
  fs.writeFileSync(arquivo, JSON.stringify(estado, null, 2));
  sair(0, JSON.stringify(resposta(chave)));
}
let chave = null;
const m = cli === 'gh' ? /^repos\\/([^/]+)\\/([^/]+)$/.exec(rota || '') : /^projects\\/(.+)$/.exec(rota || '');
if (m) chave = cli === 'gh' ? m[1] + '/' + m[2] : decodeURIComponent(m[1]);
if (metodo === 'GET' && chave) {
  if (!estado[chave]) sair(1, cli === 'gh' ? '{"message":"Not Found","status":"404"}' : '', cli === 'gh' ? 'gh: Not Found (HTTP 404)\\n' : 'glab: 404 Not Found (HTTP 404)\\n');
  sair(0, JSON.stringify(resposta(chave)));
}
sair(2, '', 'fake: rota nao simulada ' + metodo + ' ' + rota + '\\n');
`;

/** Um diretorio so com o `git` e o `node` de verdade: o PATH dos testes nao ve mais nada da maquina. */
function ferramentas(dir: string): string {
  const destino = path.join(dir, 'ferramentas');
  fs.mkdirSync(destino, { recursive: true });
  const git = (process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, 'git')).find((f) => fs.existsSync(f));
  if (!git) throw new Error('teste da rede: git nao encontrado no PATH');
  fs.symlinkSync(git, path.join(destino, 'git'));
  fs.symlinkSync(process.execPath, path.join(destino, 'node'));
  return destino;
}

interface ForjaFalsa {
  raiz: string;
  bin: string;
  estado: string;
  home: string;
  env: NodeJS.ProcessEnv;
  amb: { env: NodeJS.ProcessEnv; home: string };
  tirar(cli: string): void;
  visibilidade(chave: string, privado: boolean): void;
  interna(chave: string): void;
  limpar(): void;
}

function forjaFalsa(nome: string, extra: NodeJS.ProcessEnv = {}): ForjaFalsa {
  const raiz = dirTemporario(`rede-${nome}`);
  const bin = path.join(raiz, 'bin'), estado = path.join(raiz, 'forja'), home = path.join(raiz, 'home');
  for (const d of [bin, estado, home]) fs.mkdirSync(d, { recursive: true });
  for (const cli of ['gh', 'glab', 'claude', 'codex', 'openclaw']) fs.writeFileSync(path.join(bin, cli), SCRIPT_FALSO, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: [bin, ferramentas(raiz)].join(path.delimiter), ORK_BINARIOS_EXTRA: '',
    FORJA_FAKE_DIR: estado, HOME: home, ...extra };
  delete env.GITLAB_HOST;
  return {
    raiz, bin, estado, home, env, amb: { env, home },
    tirar: (cli) => fs.rmSync(path.join(bin, cli), { force: true }),
    visibilidade(chave, privado) {
      const arquivo = path.join(estado, 'repos.json');
      const atual = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Record<string, { privado: boolean }>;
      atual[chave].privado = privado;
      fs.writeFileSync(arquivo, JSON.stringify(atual, null, 2));
    },
    interna(chave) {
      const arquivo = path.join(estado, 'repos.json');
      const atual = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Record<string, { privado: boolean; visibilidade?: string }>;
      atual[chave].visibilidade = 'internal';
      fs.writeFileSync(arquivo, JSON.stringify(atual, null, 2));
    },
    limpar: () => fs.rmSync(raiz, { recursive: true, force: true }),
  };
}

test('RM-053 forja: o GitHub pela CLI, so com o login; 404 e "nao existe"; criar e privado; publico aparece como publico', () => {
  const f = forjaFalsa('forja-github');
  try {
    const gh = forjaPorNome('github', f.amb);
    assert.ok(gh);
    assert.equal(gh.binario, path.join(f.bin, 'gh'));
    // A resposta de `gh api user` traz e-mail, plano e um token: so o login sai daqui.
    assert.deepEqual(gh.identidade(), { forja: 'github', host: 'github.com', cli: 'gh', versao: '2.99.0', usuario: 'pessoa-teste' });
    assert.deepEqual(gh.repositorio('pessoa-teste', 'orkastery-network'), { existe: false, privado: null, url: null });
    const criado = gh.criarPrivado('orkastery-network', 'Rede Orkastery');
    assert.equal(criado.existe, true);
    assert.equal(criado.privado, true);
    assert.ok(criado.url && fs.existsSync(path.join(criado.url, 'HEAD')), 'a forja falsa criou o remoto bare');
    assert.deepEqual(gh.repositorio('pessoa-teste', 'orkastery-network'), criado);
    f.visibilidade('pessoa-teste/orkastery-network', false);
    assert.equal(gh.repositorio('pessoa-teste', 'orkastery-network').privado, false);
    assert.equal(gh.helperDeCredencial(), `!${path.join(f.bin, 'gh')} auth git-credential`);
  } finally { f.limpar(); }
});

test('RM-053 forja: o GitLab passa pela mesma interface', () => {
  const f = forjaFalsa('forja-gitlab');
  try {
    const lab = forjaPorNome('gitlab', f.amb);
    assert.ok(lab);
    assert.deepEqual(lab.identidade(), { forja: 'gitlab', host: 'gitlab.com', cli: 'glab', versao: '1.50.0', usuario: 'pessoa-lab' });
    assert.equal(lab.repositorio('pessoa-lab', 'orkastery-network').existe, false);
    const criado = lab.criarPrivado('orkastery-network', 'Rede Orkastery');
    assert.deepEqual([criado.existe, criado.privado], [true, true]);
    assert.deepEqual(lab.repositorio('pessoa-lab', 'orkastery-network'), criado);
    f.visibilidade('pessoa-lab/orkastery-network', false);
    assert.equal(lab.repositorio('pessoa-lab', 'orkastery-network').privado, false);
    assert.deepEqual(forjasDaMaquina(f.amb).map((x) => x.nome), ['github', 'gitlab'], 'GitHub primeiro');
    // Host proprio do GitLab vem de GITLAB_HOST, so o nome do host.
    const proprio = forjaPorNome('gitlab', { env: { ...f.env, GITLAB_HOST: 'https://git.exemplo.com/' }, home: f.home });
    assert.equal(proprio?.host, 'git.exemplo.com');
  } finally { f.limpar(); }
});

test('RM-053 forja: sem login o usuario e null, erro da API e tipado, e sem CLI nao ha forja', () => {
  const f = forjaFalsa('forja-sem-login', { FORJA_FAKE_SEM_LOGIN: '1' });
  try {
    const gh = forjaPorNome('github', f.amb)!;
    assert.deepEqual(gh.identidade(), { forja: 'github', host: 'github.com', cli: 'gh', versao: '2.99.0', usuario: null });
    const comErro = forjaPorNome('github', { env: { ...f.env, FORJA_FAKE_SEM_LOGIN: '', FORJA_FAKE_ERRO: '1' }, home: f.home })!;
    assert.throws(() => comErro.repositorio('pessoa-teste', 'x'), /^Error: rede\.forja: gh api repos\/pessoa-teste\/x falhou: gh: Server Error \(HTTP 500\)$/);
    f.tirar('gh');
    f.tirar('glab');
    assert.equal(forjaPorNome('github', f.amb), null);
    assert.deepEqual(forjasDaMaquina(f.amb), []);
  } finally { f.limpar(); }
});

test('RM-053 forja: binario fora do PATH e achado nas pastas de usuario; versao so no formato de versao', () => {
  const f = forjaFalsa('forja-binarios');
  try {
    const extra = path.join(f.raiz, 'extra');
    fs.mkdirSync(extra);
    fs.renameSync(path.join(f.bin, 'gh'), path.join(extra, 'gh'));
    assert.equal(acharBinario('gh', f.amb), null, 'com ORK_BINARIOS_EXTRA vazio, so o PATH conta');
    assert.equal(acharBinario('gh', { env: { ...f.env, ORK_BINARIOS_EXTRA: extra }, home: f.home }), path.join(extra, 'gh'));
    // Sem a variavel, as pastas de usuario do home entram depois do PATH (o cron tem PATH curto).
    const semVariavel = { ...f.env };
    delete semVariavel.ORK_BINARIOS_EXTRA;
    const pastas = pastasDeBinarios({ env: semVariavel, home: f.home });
    assert.equal(pastas[0], f.bin);
    for (const d of ['.local/bin', '.npm-global/bin']) assert.ok(pastas.includes(path.join(f.home, d)), d);

    assert.equal(versaoDoBinario(path.join(f.bin, 'claude'), f.amb), '9.9.9');
    assert.equal(versaoDoBinario(path.join(f.bin, 'codex'), f.amb), '0.99.0');
    assert.equal(versaoDoBinario(path.join(f.bin, 'openclaw'), f.amb), '2026.9.9');
    fs.writeFileSync(path.join(f.bin, 'lixo'), SCRIPT_FALSO, { mode: 0o755 });
    assert.equal(versaoDoBinario(path.join(f.bin, 'lixo'), f.amb), null);
  } finally { f.limpar(); }
});

/** Um diretorio com manifesto, que a rede reconhece como raiz de projeto. */
function comManifesto(dir: string, nome = 'x'): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'orkastery.yaml'), `project:\n  name: ${nome}\n`);
  return dir;
}

test('RM-053 projetos: o registro da RM-052 (raiz, remoto) e lido; remoto sai sem credencial', () => {
  const d = dirTemporario('rede-projetos-registro');
  try {
    const a = comManifesto(path.join(d, 'a')), b = comManifesto(path.join(d, 'b'));
    const arquivo = path.join(d, 'projetos.json');
    fs.writeFileSync(arquivo, JSON.stringify({ contrato: 'ork.projetos/v1', atualizadoEm: '2026-09-29T20:00:00.000Z', projetos: [
      { nome: 'orkastery', abbrev: 'ork', raiz: a, fonte: 'init', registradoEm: '2026-09-29T20:00:00.000Z', atualizadoEm: '2026-09-29T20:00:00.000Z',
        remoto: 'https://x-access-token:ghp_FAKEtoken0123456789abcdefghij@github.com/orkastery/orkastery.git' },
      { nome: 'sumido', abbrev: 's', raiz: path.join(d, 'nao-existe'), remoto: null },
      { nome: 'nome com espaco', raiz: b },
      { nome: 'relativo', raiz: 'b' },
    ] }));
    const r = projetosConhecidos({ arquivo });
    assert.equal(r.registro.estado, 'lido');
    assert.deepEqual(r.projetos.map((p) => [p.nome, p.remoto, p.fonte, p.presente]), [
      ['orkastery', 'https://github.com/orkastery/orkastery.git', 'registro', true],
      ['sumido', null, 'registro', false],
    ]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 projetos: formas toleradas (mapa por nome, caminho, remotos) e registro de outra versao ou ilegivel ignorado', () => {
  const d = dirTemporario('rede-projetos-formas');
  try {
    const alfa = comManifesto(path.join(d, 'alfa')), beta = comManifesto(path.join(d, 'beta'));
    const arquivo = path.join(d, 'projetos.json');
    fs.writeFileSync(arquivo, JSON.stringify({ projetos: {
      alfa: { caminho: alfa, remotos: { origin: 'git@github.com:pessoa/alfa.git', up: 'https://h/up.git' } },
      beta: { raiz: beta, remotos: [{ nome: 'up', url: 'https://u:p@h/up.git' }, { nome: 'origin', url: 'https://u:p@h/beta.git' }] },
    } }));
    assert.deepEqual(projetosConhecidos({ arquivo }).projetos.map((p) => [p.nome, p.remoto]),
      [['alfa', 'ssh://github.com/pessoa/alfa.git'], ['beta', 'https://h/beta.git']]);
    fs.writeFileSync(arquivo, JSON.stringify({ contrato: 'ork.projetos/v2', projetos: [{ nome: 'alfa', raiz: alfa }] }));
    assert.deepEqual(projetosConhecidos({ arquivo }), { registro: { arquivo, estado: 'invalido', projetos: [] }, projetos: [] });
    fs.writeFileSync(arquivo, '{ nao e json');
    assert.equal(projetosConhecidos({ arquivo }).registro.estado, 'invalido');
    assert.equal(projetosConhecidos({ arquivo: path.join(d, 'nada.json') }).registro.estado, 'ausente');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 projetos: sem registro, a reserva e o projeto do cwd e o ultimo retrato; a mesma raiz nao repete', () => {
  const p = projetoTemporario('rede-projetos-cwd', true);
  const outro = comManifesto(dirTemporario('rede-projetos-outro'));
  try {
    exec('git', ['remote', 'set-url', 'origin', 'https://pessoa:ghp_FAKEtoken0123456789abcdefghij@github.com/pessoa/produto.git'], p.dir);
    const r = projetosConhecidos({ arquivo: path.join(p.dir, 'nao-existe.json'), diretorio: p.dir, anteriores: [
      { nome: 'outro', remoto: 'https://h/outro.git', caminho: outro },
      { nome: 'velho', remoto: null, caminho: '/caminho/que/nao/existe' },
      { nome: 'orkastery', remoto: null, caminho: p.dir },
    ] });
    assert.equal(r.registro.estado, 'ausente');
    assert.deepEqual(r.projetos.map((x) => [x.nome, x.fonte, x.remoto, x.caminho]), [
      ['orkastery', 'cwd', 'https://github.com/pessoa/produto.git', p.dir],
      ['outro', 'retrato', 'https://h/outro.git', outro],
    ]);
  } finally { p.limpar(); fs.rmSync(outro, { recursive: true, force: true }); }
});

test('RM-053 projetos: limparRemoto tira usuario e senha e recusa o que nao e remoto', () => {
  assert.equal(limparRemoto('https://user:pass@host.com/a/b.git'), 'https://host.com/a/b.git');
  assert.equal(limparRemoto('https://ghp_FAKEtoken0123456789abcdefghij@github.com/x/y'), 'https://github.com/x/y');
  assert.equal(limparRemoto('ssh://git@host.com/a/b.git'), 'ssh://host.com/a/b.git');
  // A1 (CHECK 1): a forma scp vira ssh://, sem o usuario de transporte e sem o `@` que parecia e-mail.
  assert.equal(limparRemoto('git@github.com:dono/repo.git'), 'ssh://github.com/dono/repo.git');
  assert.equal(limparRemoto('git@gitlab.empresa.com:time/produto.git'), 'ssh://gitlab.empresa.com/time/produto.git');
  assert.equal(limparRemoto('git.sr.ht:~pessoa/x'), 'ssh://git.sr.ht/~pessoa/x');
  assert.equal(limparRemoto('git@ssh.dev.azure.com:v3/org/proj/repo'), 'ssh://ssh.dev.azure.com/v3/org/proj/repo');
  assert.equal(limparRemoto('/srv/git/repo.git'), '/srv/git/repo.git');
  assert.equal(limparRemoto('texto qualquer'), null);
  assert.equal(limparRemoto(42), null);
});

test('RM-053 projetos: remoto com senha na forma scp, query ou unidade do Windows nunca passa (S1, S12 da revisao 2)', () => {
  assert.equal(limparRemoto('julio:MinhaSenha123@github.com:julio/repo.git'), null, 'usuario com senha na forma scp');
  assert.equal(limparRemoto('x@y:z@w'), null, '@ depois do host e ambiguo');
  assert.equal(limparRemoto('https://host/r.git?access_token=abcdef0123456789abcdef#frag'), 'https://host/r.git');
  assert.equal(limparRemoto('C:\\repos\\x'), null);
  assert.equal(limparRemoto('C:/repos/x'), null);
  assert.equal(limparRemoto('git@srv:/abs/x.git'), 'ssh://srv/abs/x.git');
  assert.equal(limparRemoto('ssh://git@host.com/a/b.git'), 'ssh://host.com/a/b.git');
});

// ---------------------------------------------------------------------------
// A rede de ponta a ponta, em processo: cada "maquina" e uma pasta de usuario propria.
// ---------------------------------------------------------------------------

const TOKEN_GH = 'ghp_FAKEtoken0123456789abcdefghijABCDEFGH';

/** Troca a maquina do processo: a pasta do usuario (rede.json, maquina.json e o cache) e o nome. */
function naMaquina<T>(usuario: string, f: () => T): T {
  const antes = { usuario: process.env.ORK_USUARIO_DIR, maquina: process.env.ORK_MAQUINA };
  process.env.ORK_USUARIO_DIR = usuario;
  delete process.env.ORK_MAQUINA;
  try { return f(); } finally {
    if (antes.usuario === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes.usuario;
    if (antes.maquina === undefined) delete process.env.ORK_MAQUINA; else process.env.ORK_MAQUINA = antes.maquina;
  }
}

/** O ambiente da forja falsa com a publicacao automatica LIGADA (o apoio desliga para a suite toda). */
function ligado(f: ForjaFalsa, extra: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...f.env };
  delete env.ORK_REDE_PUBLICAR;
  delete env.ORK_FABRICA_PUBLICAR;
  return { env: { ...env, ...extra }, home: f.home };
}

/** O remoto bare que a forja falsa criou para a casa. */
const casaFalsa = (f: ForjaFalsa, dono = 'pessoa-teste') => path.join(f.estado, 'repos', dono, 'orkastery-network.git');

/** Todos os blobs do repositorio, de todas as versoes, inclusive os inalcancaveis. */
function todosOsBlobs(repo: string): string[] {
  return exec('git', ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)'], repo).stdout
    .split('\n').filter((l) => l.endsWith(' blob')).map((l) => exec('git', ['cat-file', '-p', l.split(' ')[0]], repo).stdout);
}

test('RM-053 segredo: nada de token, credencial, caminho de credencial ou conta paga em nenhum blob da casa', () => {
  const f = forjaFalsa('segredo');
  const usuario = dirTemporario('rede-segredo-usuario');
  const p = projetoTemporario('rede-segredo', true);
  try {
    naMaquina(usuario, () => {
      // Tudo o que nao pode sair, plantado onde uma maquina de verdade tem.
      const amb = ligado(f, { GH_TOKEN: TOKEN_GH, GITHUB_TOKEN: TOKEN_GH, GITLAB_TOKEN: 'glpat-FAKE0123456789abcdefgh',
        ANTHROPIC_API_KEY: 'sk-ant-api03-FAKE0123456789abcdefghij', OPENAI_API_KEY: 'sk-FAKEopenai0123456789abcdefghijklmnop' });
      fs.mkdirSync(path.join(f.home, '.config', 'gh'), { recursive: true });
      fs.writeFileSync(path.join(f.home, '.config', 'gh', 'hosts.yml'), `github.com:\n  oauth_token: ${TOKEN_GH}\n`);
      fs.mkdirSync(path.join(f.home, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(f.home, '.claude', '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-FAKE0123456789abcdef', subscriptionType: 'max' } }));
      const conta = path.join(f.home, '.claude-conta-max');
      fs.mkdirSync(conta, { recursive: true });
      adicionarPerfil(p.dir, { id: 'conta-max', runtime: 'claude-bg', dir: conta });
      const recibo = path.join(f.home, '.openclaw', 'extensions', 'orkastery');
      fs.mkdirSync(recibo, { recursive: true });
      fs.writeFileSync(path.join(recibo, 'INSTALADO.json'), JSON.stringify({ contrato: 'ork.adapter-install/v1', host: 'openclaw',
        versao: '0.4.3', catalogo: path.join(f.home, 'catalogo-local'), orkBin: path.join(f.home, 'bin-local', 'ork'), arquivos: [] }));
      exec('git', ['remote', 'set-url', 'origin', `https://x-access-token:${TOKEN_GH}@github.com/pessoa/produto.git`], p.dir);

      const r = entrarNaRede({ amb, maquina: 'pc-segredo', diretorio: p.dir });
      assert.deepEqual([r.criado, r.publicacao.acao, r.casa.dono, r.casa.repositorio], [true, 'publicou', 'pessoa-teste', 'orkastery-network']);

      const blobs = todosOsBlobs(casaFalsa(f));
      assert.equal(blobs.length, 2, 'o retrato e o REDE.md');
      const proibidos = [TOKEN_GH, 'ghp_', 'glpat-', 'sk-ant-', 'sk-FAKE', 'dono-secreto@exemplo.com', 'lab-secreto', 'dono-pago@exemplo.com',
        'Claude Max', 'subscriptionType', '"plan"', 'private_repos', 'oauth_token', 'x-access-token', 'hosts.yml', '.credentials.json',
        'conta-max', conta, 'catalogo-local', 'bin-local', 'auth.json', 'pago'];
      for (const b of blobs) {
        for (const x of proibidos) assert.ok(!b.includes(x), `"${x}" vazou para a casa da rede`);
        assert.deepEqual(procurarSegredos(b), [], 'a varredura do nucleo nao acha nada');
      }
      // E o que devia ir foi: runtimes e hosts com versao, o adaptador, o projeto sem credencial.
      const retrato = JSON.parse(blobs.find((b) => b.includes('"ork.rede-maquina/v1"'))!);
      assert.deepEqual(Object.keys(retrato).sort(), ['adesao', 'contrato', 'forjas', 'hostname', 'hosts', 'id', 'maquina', 'projetos',
        'publicadoEm', 'runtimes', 'versaoOrk']);
      assert.equal(retrato.id, fs.readFileSync(path.join(usuario, 'rede', 'maquina-id'), 'utf8'), 'o id aleatorio desta instalacao, nada da pessoa');
      assert.deepEqual(retrato.forjas, [{ forja: 'github', host: 'github.com', cli: 'gh', versao: '2.99.0', usuario: 'pessoa-teste' },
        { forja: 'gitlab', host: 'gitlab.com', cli: 'glab', versao: '1.50.0', usuario: 'pessoa-lab' }]);
      assert.deepEqual(retrato.runtimes, [{ runtime: 'claude-bg', binario: 'claude', versao: '9.9.9' }, { runtime: 'codex', binario: 'codex', versao: '0.99.0' }]);
      assert.deepEqual(retrato.hosts, [{ host: 'claude-code', versao: '9.9.9', adaptador: null }, { host: 'codex', versao: '0.99.0', adaptador: null },
        { host: 'openclaw', versao: '2026.9.9', adaptador: '0.4.3' }]);
      assert.deepEqual(retrato.projetos, [{ nome: 'orkastery', remoto: 'https://github.com/pessoa/produto.git', caminho: p.dir }]);
      assert.equal(retrato.adesao, 'rede');
    });
  } finally { f.limpar(); p.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); }
});

test('RM-053 segredo: retrato com valor de cara de segredo e recusado antes do push, e o erro nao mostra o valor', () => {
  const f = forjaFalsa('segredo-recusa');
  const usuario = dirTemporario('rede-segredo-recusa-usuario');
  const p = projetoTemporario('rede-segredo-recusa', true);
  try {
    naMaquina(usuario, () => {
      const amb = ligado(f);
      const base = retratoDaMaquina({ amb, maquina: 'pc-x' });
      exigirRetratoSeguro(base);
      const casos: Array<[Record<string, unknown>, RegExp]> = [
        [{ ...base, projetos: [{ nome: TOKEN_GH, remoto: null, caminho: '/x' }] }, /padrao "token do GitHub" em projetos\[0\]\.nome/],
        [{ ...base, projetos: [{ nome: 'p', remoto: 'https://u:segredo@h/x.git', caminho: '/x' }] }, /padrao "credencial em URL" em projetos\[0\]\.remoto/],
        [{ ...base, projetos: [{ nome: 'p', remoto: null, caminho: '/home/x/.config/gh' }] }, /padrao "arquivo de credencial" em projetos\[0\]\.caminho/],
        [{ ...base, hostname: 'dono@exemplo.com' }, /padrao "e-mail de conta" em hostname/],
        [{ ...base, email: 'dono@exemplo.com' }, /campo "retrato\.email" fora da lista de permissao/],
        [{ ...base, forjas: [{ ...base.forjas[0], token: 'x' }] }, /campo "forjas\[0\]\.token" fora da lista de permissao/],
      ];
      for (const [retrato, erro] of casos) {
        assert.throws(() => exigirRetratoSeguro(retrato as never), (e: Error) => erro.test(e.message) && e.message.startsWith('rede.segredo: ') &&
          !/segredo@|ghp_|dono@/.test(e.message.replace(/^rede\.segredo: /, '').replace(/rede\.segredo/g, '')), String(erro));
      }
      // De ponta a ponta (A1 do CHECK 1): o registro de projetos (RM-052) vem de fora do nucleo. O projeto
      // com valor de cara de segredo sai SO ele, com aviso; o scp num host de dois pontos nao e e-mail.
      const drive = comManifesto(path.join(usuario, 'CloudStorage', 'GoogleDrive-dono@exemplo.com', 'produto'));
      const empresa = comManifesto(path.join(usuario, 'empresa'));
      const comSenha = comManifesto(path.join(usuario, 'com-senha'));
      const registro = path.join(usuario, 'projetos-ruim.json');
      fs.writeFileSync(registro, JSON.stringify({ contrato: 'ork.projetos/v1', projetos: [
        { nome: TOKEN_GH, raiz: p.dir, remoto: null },
        { nome: 'no-drive', raiz: drive, remoto: null },
        { nome: 'empresa', raiz: empresa, remoto: 'git@gitlab.empresa.com:time/produto.git' },
        { nome: 'com-senha', raiz: comSenha, remoto: 'julio:MinhaSenha123@github.com:julio/repo.git' },
      ] }));
      const r = entrarNaRede({ amb, maquina: 'pc-x', arquivoDeProjetos: registro });
      assert.equal(r.publicacao.acao, 'publicou');
      assert.deepEqual(r.publicacao.descartados.map((d) => [d.padrao, d.campo]).sort(),
        [['e-mail de conta', 'projetos[3].caminho'], ['token do GitHub', 'projetos[2].nome']], 'indice na lista ordenada por nome');
      const blobs = todosOsBlobs(casaFalsa(f));
      for (const b of blobs) for (const x of [TOKEN_GH, 'dono@exemplo.com', 'GoogleDrive', 'MinhaSenha123']) assert.ok(!b.includes(x), `"${x}" vazou`);
      const publicado = JSON.parse(blobs.find((b) => b.includes('"ork.rede-maquina/v1"'))!);
      assert.deepEqual(publicado.projetos, [
        { nome: 'com-senha', remoto: null, caminho: comSenha },
        { nome: 'empresa', remoto: 'ssh://gitlab.empresa.com/time/produto.git', caminho: empresa },
      ], 'o remoto com senha sai null; o projeto fica');
    });
  } finally { f.limpar(); p.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); }
});

test('RM-053 autoria: cada maquina so escreve o proprio retrato; retrato com nome trocado vira lacuna', () => {
  const f = forjaFalsa('autoria');
  const [ua, ub] = [dirTemporario('rede-autoria-a'), dirTemporario('rede-autoria-b')];
  try {
    const amb = ligado(f);
    naMaquina(ua, () => entrarNaRede({ amb, maquina: 'pc-a' }));
    naMaquina(ub, () => entrarNaRede({ amb, maquina: 'pc-b' }));
    const casa = casaFalsa(f);
    const ponta = exec('git', ['rev-parse', 'main'], casa).stdout.trim();
    assert.deepEqual(exec('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', ponta], casa).stdout.trim().split('\n'),
      ['REDE.md', 'maquinas/pc-b.json'], 'o commit de B so toca o retrato de B e o indice');
    assert.equal(exec('git', ['rev-parse', `${ponta}:maquinas/pc-a.json`], casa).stdout, exec('git', ['rev-parse', `${ponta}~1:maquinas/pc-a.json`], casa).stdout,
      'o retrato de A continua o blob que A gravou');
    assert.match(exec('git', ['log', '-1', '--format=%s', ponta], casa).stdout, /^rede: pc-b publicou o retrato/);
    assert.throws(() => exigirSoOProprioRetrato('pc-b', [{ caminho: 'maquinas/pc-a.json', conteudo: '{}\n' }]),
      /^Error: rede\.retrato-alheio: pc-b tentou gravar maquinas\/pc-a\.json; cada maquina so escreve maquinas\/pc-b\.json$/);
    assert.throws(() => exigirSoOProprioRetrato('pc-b', [{ caminho: 'outra/coisa.md', conteudo: null }]), /rede\.retrato-alheio/);

    // Um cliente com defeito grava um retrato que diz ser de A no arquivo de outra maquina, e um JSON quebrado.
    naMaquina(ua, () => {
      const cache = dirDoCache({ forja: 'github', host: 'github.com', dono: 'pessoa-teste', repositorio: 'orkastery-network' });
      const { ponta: atual } = buscarBranch(cache, 'origin', 'main', 'teste');
      const deA = exec('git', ['show', `${atual}:maquinas/pc-a.json`], cache).stdout;
      assert.ok(gravarNaBranch(cache, 'origin', 'main', atual, [{ caminho: 'maquinas/pc-c.json', conteudo: deA },
        { caminho: 'maquinas/lixo.json', conteudo: '{ nao e json' }], 'teste: retrato forjado', 'teste'));
      const status = lerRede({ amb, maquina: 'pc-a' });
      assert.deepEqual(status.membros.map((m) => m.maquina), ['pc-a', 'pc-b']);
      assert.deepEqual(status.lacunas.filter((l) => l.tipo === 'retrato.invalido').map((l) => l.detalhe).sort(), [
        'maquinas/lixo.json: JSON ilegivel',
        'maquinas/pc-c.json: diz ser a maquina "pc-a", que nao e a dona deste arquivo',
      ]);
    });
  } finally { f.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 migracao: quem fez ork fabrica entrar e membro sem refazer; a batida publica, respeita o teto e o sair vence', () => {
  const f = forjaFalsa('migracao');
  const [ua, uv] = [dirTemporario('rede-migracao-a'), dirTemporario('rede-migracao-vps')];
  try {
    const amb = ligado(f);
    naMaquina(ua, () => entrarNaRede({ amb, maquina: 'pc-a' }));
    naMaquina(uv, () => {
      // A vps so fez `ork fabrica entrar` (RM-047): nenhum rede.json.
      gravarConfigDaMaquina({ nome: 'vps', fabricaCompartilhada: true });
      assert.equal(lerConfigDaRede(), null);
      assert.deepEqual(adesaoDaRede(), { membro: true, adesao: 'fabrica', config: null });
      const t0 = Date.parse('2026-09-29T20:00:00.000Z');
      assert.equal(publicarRedeNaBatida({ amb: ligado(f, { ORK_REDE_PUBLICAR: '0' }), agoraMs: t0 }), null, 'publicacao desligada pelo ambiente');
      const primeira = publicarRedeNaBatida({ amb, agoraMs: t0, agora: new Date(t0).toISOString() });
      assert.equal(primeira?.acao, 'publicou');
      assert.equal(publicarRedeNaBatida({ amb, agoraMs: t0 + 5 * 60 * 1000 }), null, 'dentro do teto de 15 min nem tenta');
      const t1 = t0 + TETO_DE_TENTATIVA_MS + 60 * 1000;
      assert.equal(publicarRedeNaBatida({ amb, agoraMs: t1, agora: new Date(t1).toISOString() })?.acao, 'sem-mudanca', 'retrato igual, dentro da hora');
      const t2 = t0 + 61 * 60 * 1000;
      assert.equal(publicarRedeNaBatida({ amb, agoraMs: t2, agora: new Date(t2).toISOString() })?.acao, 'publicou', 'a batida de hora em hora');
    });
    const status = naMaquina(ua, () => lerRede({ amb, maquina: 'pc-a' }));
    const vps = status.membros.find((m) => m.maquina === 'vps');
    assert.deepEqual([vps?.origem, vps?.adesao], ['rede', 'fabrica']);
    assert.match(textoDaRede(status), /vps · rede, adesão herdada da fábrica · batida/);

    naMaquina(uv, () => {
      const saiu = sairDaRede({ amb, maquina: 'vps' });
      assert.match(String(saiu.commit), /^[a-f0-9]{40}$/);
      assert.deepEqual([lerConfigDaRede()?.membro, adesaoDaRede().membro], [false, false], 'sair vence a heranca da fabrica');
      assert.throws(() => publicarRede({ amb, maquina: 'vps' }), /^Error: rede\.fora: /);
    });
    assert.deepEqual(naMaquina(ua, () => lerRede({ amb, maquina: 'pc-a' })).membros.map((m) => m.maquina), ['pc-a']);
  } finally { f.limpar(); for (const d of [ua, uv]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 migracao: maquina que so publicou em ork/fabrica-estado aparece como membro pela fabrica', () => {
  const f = forjaFalsa('migracao-legada');
  const ua = dirTemporario('rede-migracao-legada-a');
  const p = projetoTemporario('rede-migracao-legada', true);
  try {
    // A vps-velha roda um ork antigo: so conhece a fabrica do projeto.
    assert.equal(publicarMaquina(exigirManifesto(p.dir), { maquina: 'vps-velha', por: 'Julio' }).acao, 'publicou');
    const amb = ligado(f);
    const status = naMaquina(ua, () => {
      entrarNaRede({ amb, maquina: 'pc-a', diretorio: p.dir });
      return lerRede({ amb, maquina: 'pc-a', diretorio: p.dir });
    });
    assert.deepEqual(status.membros.map((m) => [m.maquina, m.origem]), [['pc-a', 'rede'], ['vps-velha', 'fabrica-estado']]);
    const velha = status.membros[1];
    assert.deepEqual([velha.pessoa, velha.adesao, velha.projetos], ['Julio', null, [{ nome: 'orkastery', remoto: null, caminho: null }]]);
    assert.deepEqual(status.fontes.map((x) => [x.fonte, x.projeto ?? null, x.atualizado]), [['rede', null, true], ['fabrica-estado', 'orkastery', true]]);
    assert.match(textoDaRede(status), /vps-velha · vista só na fábrica de orkastery; não publica na rede/);
    // De qualquer outro diretorio, o projeto vem do ultimo retrato desta maquina: a vps-velha continua visivel.
    const deLonge = naMaquina(ua, () => lerRede({ amb, maquina: 'pc-a', diretorio: f.home }));
    assert.deepEqual(deLonge.membros.map((m) => m.maquina), ['pc-a', 'vps-velha']);
  } finally { f.limpar(); p.limpar(); fs.rmSync(ua, { recursive: true, force: true }); }
});

test('RM-053 migracao: evento de thread dispara a publicacao em segundo plano so para membro, fora do teto', async () => {
  const f = forjaFalsa('migracao-evento');
  const ua = dirTemporario('rede-migracao-evento');
  try {
    const cli = path.join(f.raiz, 'cli-falso.js');
    const saida = path.join(f.raiz, 'chamado.json');
    fs.writeFileSync(cli, `require('fs').writeFileSync(${JSON.stringify(saida)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\n`);
    const { env } = ligado(f);
    await naMaquina(ua, async () => {
      assert.equal(publicarRedeEmSegundoPlano({ cli, env, diretorio: f.home }), false, 'fora da rede nao dispara');
      gravarConfigDaMaquina({ nome: 'pc-evento', fabricaCompartilhada: true });
      assert.equal(publicarRedeEmSegundoPlano({ cli, env: { ...env, ORK_REDE_PUBLICAR: '0' }, diretorio: f.home }), false);
      assert.equal(publicarRedeEmSegundoPlano({ cli, env, diretorio: f.home }), true);
      for (let i = 0; i < 100 && !fs.existsSync(saida); i++) await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(JSON.parse(fs.readFileSync(saida, 'utf8')), { argv: ['network', 'publicar', '--silencioso'], cwd: f.home });
      assert.equal(publicarRedeEmSegundoPlano({ cli, env, diretorio: f.home }), false, 'segunda dentro do teto');
    });
  } finally { f.limpar(); fs.rmSync(ua, { recursive: true, force: true }); }
});

test('RM-053 honestidade: cada falta de leitura vira lacuna tipada, nunca lista vazia calada', () => {
  const f = forjaFalsa('honestidade');
  const [ua, ub] = [dirTemporario('rede-honestidade-a'), dirTemporario('rede-honestidade-b')];
  try {
    const amb = ligado(f);
    const tipos = (s: ReturnType<typeof lerRede>) => s.lacunas.map((l) => l.tipo);
    naMaquina(ua, () => {
      // Sem repositorio ainda: a casa e conhecida pelo login, e ninguem entrou.
      const semCasa = lerRede({ amb, maquina: 'pc-a' });
      assert.deepEqual([semCasa.casa?.dono, tipos(semCasa)], ['pessoa-teste', ['rede.sem-repositorio']]);
      assert.deepEqual(semCasa.naoConsultado, ['roadmap', 'reservas', 'threads']);
      const texto = textoDaRede(semCasa);
      assert.match(texto, /Nenhuma máquina lida\. Isso não quer dizer que não há máquinas: veja as lacunas\./);
      assert.match(texto, /Não consultado: roadmap, reservas, threads\./);
      assert.match(texto, /rede\.sem-repositorio: github\.com\/pessoa-teste\/orkastery-network ainda nao existe/);
      // Sem login e sem CLI de forja.
      assert.deepEqual(tipos(lerRede({ amb: ligado(f, { FORJA_FAKE_SEM_LOGIN: '1' }), maquina: 'pc-a' })), ['forja.sem-login']);
      entrarNaRede({ amb, maquina: 'pc-a' });
    });
    naMaquina(ub, () => entrarNaRede({ amb, maquina: 'pc-b', agora: '2026-09-29T10:00:00.000Z' }));
    naMaquina(ua, () => {
      // B publicou as 10h; lida as 14h01, esta sem batida ha 4 h.
      const tarde = lerRede({ amb, maquina: 'pc-a', agora: '2026-09-29T14:01:00.000Z' });
      const semBatida = tarde.lacunas.filter((l) => l.tipo === 'maquina.sem-batida');
      assert.deepEqual(semBatida.map((l) => [l.maquina, l.detalhe]), [['pc-b', 'pc-b: sem batida ha 4 h']]);
      assert.ok(SEM_BATIDA_MS === 3 * 60 * 60 * 1000);
      // O remoto sumiu: mostra a ultima copia e diz que e a ultima copia.
      fs.renameSync(casaFalsa(f), `${casaFalsa(f)}.fora`);
      const semRede = lerRede({ amb, maquina: 'pc-a' });
      assert.deepEqual(semRede.membros.map((m) => m.maquina), ['pc-a', 'pc-b']);
      assert.deepEqual(semRede.fontes.find((x) => x.fonte === 'rede')?.atualizado, false);
      assert.ok(semRede.lacunas.some((l) => l.tipo === 'rede.sem-leitura' && /mostrando a ultima copia local/.test(l.detalhe)));
      assert.match(textoDaRede(semRede), /· última cópia local/);
      fs.renameSync(`${casaFalsa(f)}.fora`, casaFalsa(f));
      // Sem rede nenhuma (--sem-remoto): a casa vem do rede.json, e a leitura se declara copia.
      const offline = lerRede({ amb, maquina: 'pc-a', semRemoto: true });
      assert.deepEqual([offline.casa?.origem, offline.fontes[0]?.atualizado, offline.membros.length], ['rede.json', false, 2]);
      // O repositorio ficou publico: a leitura avisa.
      f.visibilidade('pessoa-teste/orkastery-network', false);
      assert.ok(tipos(lerRede({ amb, maquina: 'pc-a' })).includes('rede.repositorio-publico'));
    });
    f.tirar('gh');
    f.tirar('glab');
    const semForja = naMaquina(dirTemporario('rede-honestidade-c'), () => lerRede({ amb, maquina: 'pc-c', diretorio: null }));
    assert.deepEqual([semForja.casa, tipos(semForja), semForja.membros], [null, ['forja.ausente'], []]);
    assert.match(textoDaRede(semForja), /sem casa: nenhuma forja com login nesta máquina/);
  } finally { f.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 forja: repositorio publico recusa entrar e publicar; nada vai ao remoto', () => {
  const f = forjaFalsa('forja-publica');
  const ua = dirTemporario('rede-forja-publica');
  try {
    const amb = ligado(f);
    naMaquina(ua, () => {
      entrarNaRede({ amb, maquina: 'pc-a' });
      const antes = exec('git', ['rev-parse', 'main'], casaFalsa(f)).stdout.trim();
      f.visibilidade('pessoa-teste/orkastery-network', false);
      assert.throws(() => publicarRede({ amb, maquina: 'pc-a', forcar: true }),
        /^Error: rede\.repositorio-publico: github\.com\/pessoa-teste\/orkastery-network nao e privado; nada foi publicado$/);
      assert.throws(() => entrarNaRede({ amb, maquina: 'pc-a' }), /rede\.repositorio-publico/);
      assert.equal(exec('git', ['rev-parse', 'main'], casaFalsa(f)).stdout.trim(), antes, 'nenhum commit novo');
      // Repositorio de outra pessoa que nao existe nao e criado.
      assert.throws(() => entrarNaRede({ amb, maquina: 'pc-a', repositorio: 'outra-pessoa/rede' }), /^Error: rede\.repositorio-alheio: /);
    });
  } finally { f.limpar(); fs.rmSync(ua, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// O CLI, de fora de qualquer clone.
// ---------------------------------------------------------------------------

const CLI = path.resolve(__dirname, '../../dist/index.js');

function ork(cwd: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env, timeout: 60000 });
}

test('RM-053 ciclo: entrar, status, publicar e sair pelo CLI, com duas maquinas e fora de qualquer clone', () => {
  const f = forjaFalsa('ciclo');
  const [ua, ub, fora] = [dirTemporario('rede-ciclo-a'), dirTemporario('rede-ciclo-b'), dirTemporario('rede-ciclo-fora')];
  try {
    const envDe = (usuario: string) => ({ ...f.env, ORK_USUARIO_DIR: usuario, ORK_MAQUINA: '', ORK_REDE_PUBLICAR: '0', ORK_FABRICA_PUBLICAR: '0' });
    const a = ork(fora, ['network', 'entrar', '--maquina', 'pc-a'], envDe(ua));
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /^Rede: pc-a entrou na Orkastery Network de pessoa-teste \(github: github\.com\/pessoa-teste\/orkastery-network, privado, criado agora\)\.$/m);
    assert.match(a.stdout, /Primeiro retrato publicado \([0-9a-f]{7}\)/);
    const b = ork(fora, ['network', 'entrar', '--maquina', 'pc-b'], envDe(ub));
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /de pessoa-teste \(github: github\.com\/pessoa-teste\/orkastery-network, privado\)\./, 'a casa ja existia');

    const st = ork(fora, ['network', 'status', '--json'], envDe(ua));
    assert.equal(st.status, 0, st.stderr);
    const json = JSON.parse(st.stdout);
    assert.equal(json.contrato, 'ork.rede-status/v1');
    assert.deepEqual(json.membros.map((m: { maquina: string; origem: string }) => [m.maquina, m.origem]), [['pc-a', 'rede'], ['pc-b', 'rede']]);
    assert.deepEqual(json.estaMaquina, { maquina: 'pc-a', membro: true, adesao: 'rede', publicada: true });
    assert.deepEqual([json.lacunas, json.naoConsultado], [[], ['roadmap', 'reservas', 'threads']]);
    assert.deepEqual(json.casa, { forja: 'github', host: 'github.com', dono: 'pessoa-teste', repositorio: 'orkastery-network', origem: 'rede.json' });

    const texto = ork(fora, ['network'], envDe(ub));
    assert.equal(texto.status, 0, texto.stderr);
    assert.match(texto.stdout, /^Orkastery Network de pessoa-teste · github: github\.com\/pessoa-teste\/orkastery-network · lida agora$/m);
    assert.match(texto.stdout, /^Não consultado: roadmap, reservas, threads\./m);
    assert.match(texto.stdout, /^pc-b \(esta máquina\) · rede · batida /m);
    assert.match(texto.stdout, /^  runtimes: claude-bg 9\.9\.9, codex 0\.99\.0$/m);
    assert.match(texto.stdout, /^Lacunas: nenhuma\.$/m);

    const igual = ork(fora, ['network', 'publicar'], envDe(ua));
    assert.equal(igual.status, 0, igual.stderr);
    assert.match(igual.stdout, /retrato de pc-a igual ao ultimo publicado/);
    const forcado = JSON.parse(ork(fora, ['network', 'publicar', '--forcar', '--json'], envDe(ua)).stdout);
    assert.deepEqual([forcado.acao, forcado.maquina, forcado.casa], ['publicou', 'pc-a', 'github.com/pessoa-teste/orkastery-network']);

    const sai = ork(fora, ['network', 'sair'], envDe(ub));
    assert.equal(sai.status, 0, sai.stderr);
    assert.match(sai.stdout, /^Rede: pc-b saiu; nada mais e publicado daqui\. Retrato removido de github\.com\/pessoa-teste\/orkastery-network \([0-9a-f]{7}\)\.$/m);
    const depois = JSON.parse(ork(fora, ['network', 'status', '--json'], envDe(ua)).stdout);
    assert.deepEqual(depois.membros.map((m: { maquina: string }) => m.maquina), ['pc-a']);
    const deB = JSON.parse(ork(fora, ['network', 'status', '--json'], envDe(ub)).stdout);
    assert.deepEqual(deB.estaMaquina, { maquina: 'pc-b', membro: false, adesao: null, publicada: false });

    assert.equal(ork(fora, ['network', 'entrar', '--forja', 'bitbucket'], envDe(ua)).status, 2);
    assert.equal(ork(fora, ['network', 'voar'], envDe(ua)).status, 2);
    const semRede = ork(fora, ['network', 'publicar'], envDe(ub));
    assert.equal(semRede.status, 1);
    assert.match(semRede.stderr, /erro: rede\.fora: esta maquina nao esta na rede; ork network entrar/);
  } finally { f.limpar(); for (const d of [ua, ub, fora]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 honestidade: ork network status fora de clone e sem forja responde com a lacuna, nunca com "nenhuma maquina"', () => {
  const f = forjaFalsa('honestidade-cli');
  const [u, fora] = [dirTemporario('rede-honestidade-cli'), dirTemporario('rede-honestidade-cli-fora')];
  try {
    f.tirar('gh');
    f.tirar('glab');
    const env = { ...f.env, ORK_USUARIO_DIR: u, ORK_MAQUINA: 'pc-h' };
    const r = ork(fora, ['network', 'status'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Orkastery Network · sem casa: nenhuma forja com login nesta máquina$/m);
    assert.match(r.stdout, /^Nenhuma máquina lida\. Isso não quer dizer que não há máquinas: veja as lacunas\.$/m);
    assert.match(r.stdout, /^  • forja\.ausente: nenhuma CLI de forja \(gh ou glab\) nesta maquina$/m);
    assert.match(r.stdout, /^Esta máquina \(pc-h\) não está na rede: ork network entrar\.$/m);
    assert.doesNotMatch(r.stdout, /nenhuma publicou/i);
    const json = JSON.parse(ork(fora, ['network', 'status', '--json'], env).stdout);
    assert.deepEqual([json.casa, json.membros, json.lacunas.map((l: { tipo: string }) => l.tipo)], [null, [], ['forja.ausente']]);
  } finally { f.limpar(); for (const d of [u, fora]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 migracao: a batida real do pulse publica o retrato de quem so fez ork fabrica entrar', () => {
  const f = forjaFalsa('migracao-pulse');
  const [ua, uv] = [dirTemporario('rede-pulse-a'), dirTemporario('rede-pulse-vps')];
  const p = projetoTemporario('rede-pulse', true);
  try {
    naMaquina(ua, () => entrarNaRede({ amb: ligado(f), maquina: 'pc-a' }));
    naMaquina(uv, () => gravarConfigDaMaquina({ nome: 'vps', fabricaCompartilhada: true }));
    const pulse = path.resolve(__dirname, '../../dist/pulse-delivery.js');
    const r = spawnSync(process.execPath, [pulse, p.dir], { cwd: p.dir, encoding: 'utf8', timeout: 60000,
      env: { ...ligado(f).env, ORK_USUARIO_DIR: uv, ORK_MAQUINA: '' } });
    assert.equal(r.error, undefined);
    const log = fs.readFileSync(path.join(uv, 'rede', 'rede.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((l) => [l.origem, l.acao, l.maquina]), [['pulse', 'publicou', 'vps']], r.stderr);
    const vps = JSON.parse(exec('git', ['show', 'main:maquinas/vps.json'], casaFalsa(f)).stdout);
    assert.deepEqual([vps.maquina, vps.adesao, vps.projetos.map((x: { nome: string }) => x.nome)], ['vps', 'fabrica', ['orkastery']]);
    // M4 do CHECK 1: a varredura (a entrega ao dono) vem antes da rede.
    const varredura = fs.readFileSync(path.join(p.dir, '.orkastery', 'monitor', 'hitl.log'), 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l) as { ts: string; tipo: string }).find((l) => l.tipo === 'pulse_scan');
    assert.ok(varredura, r.stdout + r.stderr);
    assert.ok(Date.parse(varredura.ts) <= Date.parse(log[0].ts), `varredura ${varredura.ts} antes da rede ${log[0].ts}`);
  } finally { f.limpar(); p.limpar(); for (const d of [ua, uv]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 migracao: o teto de tentativa fica um minuto abaixo do cron de 15 min (B4 do CHECK 1)', () => {
  const u = dirTemporario('rede-teto');
  try {
    naMaquina(u, () => {
      assert.equal(TETO_DE_TENTATIVA_MS, 14 * 60 * 1000);
      const t0 = Date.parse('2026-09-30T12:00:00.000Z');
      assert.equal(tomarVezDePublicar(t0), true);
      assert.equal(tomarVezDePublicar(t0 + 13 * 60 * 1000), false, 'antes do teto');
      // A batida seguinte do cron chega 14m50s depois (oscilacao do horario): ainda e a vez dela.
      assert.equal(tomarVezDePublicar(t0 + (14 * 60 + 50) * 1000), true, 'a batida seguinte do cron nao e pulada');
      const marca = JSON.parse(fs.readFileSync(path.join(u, 'rede', 'tentativa.json'), 'utf8'));
      assert.equal(marca.em, new Date(t0 + (14 * 60 + 50) * 1000).toISOString());
    });
  } finally { fs.rmSync(u, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// GO-FIX 1 (CHECK 1): o git da rede isolado do ambiente de quem chamou.
// ---------------------------------------------------------------------------

/** Liga variaveis no processo durante `f` e devolve o ambiente como estava. */
function comAmbiente<T>(vars: Record<string, string>, f: () => T): T {
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return f(); } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('RM-053 isolamento: GIT_DIR, GIT_WORK_TREE e GIT_INDEX_FILE herdados (hook do git) nao fazem o git da rede tocar o projeto', () => {
  const f = forjaFalsa('isolamento-git-dir');
  const u = dirTemporario('rede-isolamento-usuario');
  const p = projetoTemporario('rede-isolamento', true);
  try {
    const amb = ligado(f);
    naMaquina(u, () => {
      const configDoProjeto = () => exec('git', ['config', '--local', '--list'], p.dir).stdout;
      const antes = configDoProjeto();
      const deHook = { GIT_DIR: path.join(p.dir, '.git'), GIT_WORK_TREE: p.dir, GIT_INDEX_FILE: path.join(p.dir, '.git', 'index') };
      const r = comAmbiente(deHook, () => entrarNaRede({ amb, maquina: 'pc-hook' }));
      assert.equal(r.publicacao.acao, 'publicou');
      comAmbiente(deHook, () => {
        lerRede({ amb, maquina: 'pc-hook' });
        publicarRede({ amb, maquina: 'pc-hook', forcar: true });
        sairDaRede({ amb, maquina: 'pc-hook' });
      });
      assert.equal(configDoProjeto(), antes, 'remote.origin.url, core.hooksPath, user.* e o helper do projeto intactos');
      assert.equal(exec('git', ['rev-parse', 'HEAD'], p.dir).stdout, exec('git', ['rev-parse', 'origin/main'], p.dir).stdout);
      assert.match(exec('git', ['log', '--format=%s', 'main'], casaFalsa(f)).stdout, /rede: pc-hook saiu\nrede: pc-hook publicou o retrato\nrede: pc-hook publicou o retrato/);
    });
  } finally { f.limpar(); p.limpar(); fs.rmSync(u, { recursive: true, force: true }); }
});

test('RM-053 isolamento: o e-mail do ambiente nunca vai aos commits da casa; autor e committer sao a maquina', () => {
  const f = forjaFalsa('isolamento-autor');
  const u = dirTemporario('rede-isolamento-autor');
  try {
    naMaquina(u, () => comAmbiente({ GIT_AUTHOR_NAME: 'Dono Real', GIT_AUTHOR_EMAIL: 'dono-real@exemplo.com',
      GIT_COMMITTER_NAME: 'Dono Real', GIT_COMMITTER_EMAIL: 'dono-real@exemplo.com', EMAIL: 'dono-real@exemplo.com' },
    () => entrarNaRede({ amb: ligado(f), maquina: 'pc-autor' })));
    const autores = exec('git', ['log', '--format=%an <%ae> | %cn <%ce>', 'main'], casaFalsa(f)).stdout.trim().split('\n');
    assert.deepEqual([...new Set(autores)], ['pc-autor <pc-autor@rede.orkastery.invalid> | pc-autor <pc-autor@rede.orkastery.invalid>']);
    assert.doesNotMatch(exec('git', ['log', '--format=%B%an%ae%cn%ce', 'main'], casaFalsa(f)).stdout, /dono-real|Dono Real/);
  } finally { f.limpar(); fs.rmSync(u, { recursive: true, force: true }); }
});

test('RM-053 isolamento: dentro do git da rede nao ha redirecionamento, prompt nem traducao; na saida o ambiente volta', () => {
  comAmbiente({ GIT_DIR: '/tmp/outro/.git', GIT_TERMINAL_PROMPT: '1', LC_ALL: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' }, () => {
    const dentro = comGitIsolado(() => comGitIsolado(() => ({ dir: process.env.GIT_DIR, prompt: process.env.GIT_TERMINAL_PROMPT,
      lc: process.env.LC_ALL, lingua: process.env.LANGUAGE, ssh: process.env.GIT_SSH_COMMAND, email: process.env.GIT_AUTHOR_EMAIL })),
    { nome: 'pc-x', email: 'pc-x@rede.orkastery.invalid' });
    assert.deepEqual(dentro, { dir: undefined, prompt: '0', lc: 'C', lingua: 'C', ssh: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
      email: 'pc-x@rede.orkastery.invalid' });
    assert.deepEqual([process.env.GIT_DIR, process.env.GIT_TERMINAL_PROMPT, process.env.LC_ALL, process.env.LANGUAGE],
      ['/tmp/outro/.git', '1', 'pt_BR.UTF-8', 'pt_BR'], 'o ambiente de quem chamou volta como estava');
  });
});

// ---------------------------------------------------------------------------
// GO-FIX 1 (CHECK 1): a forja.
// ---------------------------------------------------------------------------

test('RM-053 forja: internal do GitHub nao conta como privado; entrar recusa e nada vai ao remoto (B1)', () => {
  const f = forjaFalsa('forja-interna');
  const u = dirTemporario('rede-forja-interna');
  try {
    const gh = forjaPorNome('github', f.amb)!;
    gh.criarPrivado('orkastery-network', 'x');
    f.interna('pessoa-teste/orkastery-network');
    assert.equal(gh.repositorio('pessoa-teste', 'orkastery-network').privado, false, 'a empresa inteira le um repositorio internal');
    naMaquina(u, () => assert.throws(() => entrarNaRede({ amb: ligado(f), maquina: 'pc-a' }), /^Error: rede\.repositorio-publico: /));
    assert.equal(exec('git', ['ls-remote', casaFalsa(f)], f.raiz).stdout.trim(), '');
  } finally { f.limpar(); fs.rmSync(u, { recursive: true, force: true }); }
});

test('RM-053 forja: a casa vai sempre por HTTPS com o helper, mesmo com git_protocol=ssh na CLI (B2)', () => {
  const f = forjaFalsa('forja-https', { FORJA_FAKE_PROTOCOLO: 'ssh' });
  const u = dirTemporario('rede-forja-https');
  try {
    const r = naMaquina(u, () => entrarNaRede({ amb: ligado(f), maquina: 'pc-a' }));
    assert.equal(r.publicacao.acao, 'publicou', 'a URL SSH da forja falsa e inutilizavel: publicar por ela falharia');
    const cache = path.join(u, 'rede', 'github-github.com-pessoa-teste-orkastery-network');
    assert.equal(exec('git', ['config', 'remote.origin.url'], cache).stdout.trim(), casaFalsa(f));
  } finally { f.limpar(); fs.rmSync(u, { recursive: true, force: true }); }
});

test('RM-053 forja: o host da casa vai em toda chamada da API e --repositorio sozinho mantem a forja gravada (B9, B3)', () => {
  const log = path.join(dirTemporario('rede-forja-host-log'), 'chamadas.jsonl');
  const f = forjaFalsa('forja-host', { FORJA_FAKE_LOG: log });
  const u = dirTemporario('rede-forja-host');
  try {
    naMaquina(u, () => {
      // Entra pelo GitLab proprio com GITLAB_HOST no terminal; a batida roda sem ele.
      const r = entrarNaRede({ amb: ligado(f, { GITLAB_HOST: 'https://git.exemplo.com' }), maquina: 'pc-lab', forja: 'gitlab' });
      assert.deepEqual([r.casa.forja, r.casa.host, r.casa.dono], ['gitlab', 'git.exemplo.com', 'pessoa-lab']);
      assert.equal(lerConfigDaRede()?.host, 'git.exemplo.com');
      fs.writeFileSync(log, '');
      assert.equal(publicarRede({ amb: ligado(f), maquina: 'pc-lab', forcar: true }).acao, 'publicou');
      const chamadas = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { cli: string; args: string[] });
      const doGlab = chamadas.filter((c) => c.cli === 'glab' && !c.args.includes('user'));
      assert.ok(doGlab.length > 0);
      for (const c of doGlab) assert.deepEqual(c.args.slice(0, 3), ['api', '--hostname', 'git.exemplo.com'], JSON.stringify(c));
      // B3: com rede.json no GitLab proprio, --repositorio sozinho continua no GitLab e no host gravado.
      const outra = entrarNaRede({ amb: ligado(f), maquina: 'pc-lab', repositorio: 'outra-rede' });
      assert.deepEqual([outra.casa.forja, outra.casa.host, outra.casa.dono, outra.casa.repositorio],
        ['gitlab', 'git.exemplo.com', 'pessoa-lab', 'outra-rede']);
    });
  } finally { f.limpar(); fs.rmSync(u, { recursive: true, force: true }); fs.rmSync(path.dirname(log), { recursive: true, force: true }); }
});

test('RM-053 forja: o helper cita o caminho do binario com espaco, aspa e cifrao (B10)', () => {
  const f = forjaFalsa('forja-aspas');
  try {
    const estranho = path.join(f.raiz, "b'in $x");
    fs.mkdirSync(estranho);
    fs.writeFileSync(path.join(estranho, 'gh'), SCRIPT_FALSO, { mode: 0o755 });
    const gh = forjaPorNome('github', { env: { ...f.env, PATH: estranho }, home: f.home })!;
    const helper = gh.helperDeCredencial();
    assert.equal(helper, `!'${estranho.replace(/'/g, "'\\''")}/gh' auth git-credential`);
    // O git roda o helper pelo shell: o comando citado precisa achar o binario de verdade.
    const r = spawnSync('/bin/sh', ['-c', `${helper.slice(1).replace(' auth git-credential', '')} --version`],
      { encoding: 'utf8', env: { ...f.env, x: 'NAO-EXPANDIR' } });
    assert.match(r.stdout, /^gh version 2\.99\.0/, r.stderr);
  } finally { f.limpar(); }
});

test('RM-053 autoria: retrato raso, com item nulo ou com nome fora do padrao vira lacuna; status, publicar e sair seguem (M1, B12)', () => {
  const f = forjaFalsa('autoria-rasa');
  const [ua, ub] = [dirTemporario('rede-rasa-a'), dirTemporario('rede-rasa-b')];
  try {
    const amb = ligado(f);
    naMaquina(ua, () => entrarNaRede({ amb, maquina: 'pc-a' }));
    naMaquina(ub, () => {
      entrarNaRede({ amb, maquina: 'pc-b' });
      const cache = dirDoCache({ forja: 'github', host: 'github.com', dono: 'pessoa-teste', repositorio: 'orkastery-network' });
      const { ponta } = buscarBranch(cache, 'origin', 'main', 'teste');
      const agora = new Date().toISOString();
      const raso = { contrato: 'ork.rede-maquina/v1', maquina: 'pc-velho', publicadoEm: agora, forjas: [], runtimes: [], hosts: [], projetos: [] };
      const nulo = { contrato: 'ork.rede-maquina/v1', maquina: 'pc-nulo', hostname: 'x', adesao: 'rede', versaoOrk: '0.4.3', publicadoEm: agora,
        forjas: [null], runtimes: [], hosts: [], projetos: [null] };
      assert.ok(gravarNaBranch(cache, 'origin', 'main', ponta, [
        { caminho: 'maquinas/pc-velho.json', conteudo: JSON.stringify(raso) },
        { caminho: 'maquinas/pc-nulo.json', conteudo: JSON.stringify(nulo) },
        { caminho: 'maquinas/máquina.json', conteudo: JSON.stringify({ ...raso, maquina: 'máquina' }) },
      ], 'teste: retratos ruins', 'teste'));
      const status = lerRede({ amb, maquina: 'pc-b' });
      assert.deepEqual(status.membros.map((m) => m.maquina), ['pc-a', 'pc-b']);
      assert.deepEqual(status.lacunas.filter((l) => l.tipo === 'retrato.invalido').map((l) => l.detalhe).sort(), [
        'maquinas/máquina.json: nome de arquivo fora do padrao maquinas/<maquina>.json',
        'maquinas/pc-nulo.json: fora do contrato ork.rede-maquina/v1',
        'maquinas/pc-velho.json: fora do contrato ork.rede-maquina/v1',
      ]);
      assert.equal(publicarRede({ amb, maquina: 'pc-b', forcar: true }).acao, 'publicou');
      const painel = exec('git', ['show', 'main:REDE.md'], casaFalsa(f)).stdout;
      assert.match(painel, /^\| pc-a \| /m);
      assert.doesNotMatch(painel, /pc-velho|pc-nulo/);
      assert.match(String(sairDaRede({ amb, maquina: 'pc-b' }).commit), /^[a-f0-9]{40}$/);
    });
  } finally { f.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// GO-FIX 1 (CHECK 1): entrar atomico, nome gravado, identidade da instalacao, trava e atalho.
// ---------------------------------------------------------------------------

test('RM-053 autoria: duas instalacoes com o mesmo nome nao regravam o retrato uma da outra; --forcar toma o nome (B7, M2)', () => {
  const f = forjaFalsa('autoria-nome');
  const [ua, ub] = [dirTemporario('rede-nome-a'), dirTemporario('rede-nome-b')];
  try {
    const amb = ligado(f);
    naMaquina(ua, () => entrarNaRede({ amb, maquina: 'ubuntu' }));
    const deA = exec('git', ['show', 'main:maquinas/ubuntu.json'], casaFalsa(f)).stdout;
    naMaquina(ub, () => {
      assert.throws(() => entrarNaRede({ amb, maquina: 'ubuntu' }),
        /^Error: rede\.nome-em-uso: outra instalacao ja publica como "ubuntu" \(hostname .+, batida .+\); escolha outro nome/);
      // M2: a entrada que falhou nao deixou adesao nem nome gravados aqui.
      assert.deepEqual([lerConfigDaRede(), fs.existsSync(path.join(ub, 'maquina.json'))], [null, false]);
      assert.equal(exec('git', ['show', 'main:maquinas/ubuntu.json'], casaFalsa(f)).stdout, deA, 'o retrato de A continua o de A');
      const tomou = entrarNaRede({ amb, maquina: 'ubuntu', tomarNome: true });
      assert.equal(tomou.publicacao.acao, 'publicou');
      assert.match(exec('git', ['log', '-1', '--format=%s', 'main'], casaFalsa(f)).stdout, /^rede: ubuntu publicou o retrato, tomando o nome de outra instalacao/);
    });
    // A, que perdeu o nome, sai sem apagar o retrato de quem o tomou.
    const saida = naMaquina(ua, () => sairDaRede({ amb, maquina: 'ubuntu' }));
    assert.deepEqual([saida.commit, saida.alheio], [null, true]);
    assert.ok(exec('git', ['cat-file', '-e', 'main:maquinas/ubuntu.json'], casaFalsa(f)).ok);
  } finally { f.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 migracao: entrar sem --maquina grava o nome que valeu, e a batida sem ORK_MAQUINA publica com o mesmo (M3)', () => {
  const f = forjaFalsa('migracao-nome');
  const u = dirTemporario('rede-nome-gravado');
  try {
    const amb = ligado(f);
    naMaquina(u, () => {
      const antes = process.env.ORK_MAQUINA;
      process.env.ORK_MAQUINA = 'julio-pc';
      try { assert.equal(entrarNaRede({ amb }).publicacao.maquina, 'julio-pc'); }
      finally { if (antes === undefined) delete process.env.ORK_MAQUINA; else process.env.ORK_MAQUINA = antes; }
      assert.equal(JSON.parse(fs.readFileSync(path.join(u, 'maquina.json'), 'utf8')).nome, 'julio-pc');
      const batida = publicarRedeNaBatida({ amb, agoraMs: Date.now() + 2 * 60 * 60 * 1000, agora: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
      assert.deepEqual([batida?.maquina, batida?.acao], ['julio-pc', 'publicou']);
      assert.deepEqual(lerRede({ amb }).membros.map((m) => m.maquina), ['julio-pc'], 'uma maquina, um membro');
    });
  } finally { f.limpar(); fs.rmSync(u, { recursive: true, force: true }); }
});

test('RM-053 migracao: com a casa ocupada, entrar recusa sem gravar nada e publicar devolve ocupado (M2, B6)', () => {
  const f = forjaFalsa('migracao-ocupado');
  const [ua, ub] = [dirTemporario('rede-ocupado-a'), dirTemporario('rede-ocupado-b')];
  try {
    const amb = ligado(f);
    naMaquina(ua, () => entrarNaRede({ amb, maquina: 'pc-a' }));
    naMaquina(ub, () => {
      // Outra publicacao viva desta maquina segura a trava (o pid e o deste processo, que esta vivo).
      const trava = path.join(ub, 'rede', 'publicar.lock');
      fs.mkdirSync(trava, { recursive: true });
      fs.writeFileSync(path.join(trava, 'pid'), String(process.pid));
      assert.throws(() => entrarNaRede({ amb, maquina: 'pc-b' }), /^Error: rede\.ocupado: /);
      assert.deepEqual([lerConfigDaRede(), fs.existsSync(path.join(ub, 'maquina.json'))], [null, false]);
      fs.rmSync(trava, { recursive: true, force: true });
      entrarNaRede({ amb, maquina: 'pc-b' });
      fs.mkdirSync(trava, { recursive: true });
      fs.writeFileSync(path.join(trava, 'pid'), String(process.pid));
      assert.equal(publicarRede({ amb, maquina: 'pc-b', forcar: true }).acao, 'ocupado');
      fs.rmSync(trava, { recursive: true, force: true });
      // B6: o cache nao regrava a config quando nada mudou.
      const cache = dirDoCache({ forja: 'github', host: 'github.com', dono: 'pessoa-teste', repositorio: 'orkastery-network' });
      const config = path.join(cache, '.git', 'config');
      const conteudo = fs.readFileSync(config, 'utf8');
      const quando = fs.statSync(config).mtimeMs;
      prepararCache({ forja: 'github', host: 'github.com', dono: 'pessoa-teste', repositorio: 'orkastery-network', origem: 'rede.json' },
        casaFalsa(f), forjaPorNome('github', amb)!.helperDeCredencial(), 'pc-b');
      assert.deepEqual([fs.readFileSync(config, 'utf8'), fs.statSync(config).mtimeMs], [conteudo, quando]);
    });
  } finally { f.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 migracao: retrato igual dentro da batida nao chama a forja nenhuma vez (M4)', () => {
  const log = path.join(dirTemporario('rede-atalho-log'), 'chamadas.jsonl');
  const f = forjaFalsa('migracao-atalho', { FORJA_FAKE_LOG: log });
  const u = dirTemporario('rede-atalho');
  try {
    const amb = ligado(f);
    naMaquina(u, () => {
      entrarNaRede({ amb, maquina: 'pc-a' });
      fs.writeFileSync(log, '');
      assert.equal(publicarRede({ amb, maquina: 'pc-a' }).acao, 'sem-mudanca');
      assert.equal(fs.readFileSync(log, 'utf8'), '', 'nem gh api nem glab api');
      // Passada a hora, a batida refaz o login e publica.
      const depois = new Date(Date.now() + 61 * 60 * 1000).toISOString();
      assert.equal(publicarRede({ amb, maquina: 'pc-a', agora: depois }).acao, 'publicou');
      assert.notEqual(fs.readFileSync(log, 'utf8'), '');
    });
  } finally { f.limpar(); fs.rmSync(u, { recursive: true, force: true }); fs.rmSync(path.dirname(log), { recursive: true, force: true }); }
});

test('RM-053 migracao: quem saiu da rede mas segue na fabrica aparece como vista na fabrica, nunca como membro (B11)', () => {
  const f = forjaFalsa('migracao-saiu');
  const [ua, ub] = [dirTemporario('rede-saiu-a'), dirTemporario('rede-saiu-b')];
  const p = projetoTemporario('rede-saiu', true);
  try {
    const amb = ligado(f);
    naMaquina(ua, () => { entrarNaRede({ amb, maquina: 'pc-a', diretorio: p.dir }); sairDaRede({ amb, maquina: 'pc-a' }); });
    // pc-a continua publicando a fabrica do projeto.
    assert.equal(publicarMaquina(exigirManifesto(p.dir), { maquina: 'pc-a', por: 'Julio' }).acao, 'publicou');
    const status = naMaquina(ub, () => { entrarNaRede({ amb, maquina: 'pc-b', diretorio: p.dir }); return lerRede({ amb, maquina: 'pc-b', diretorio: p.dir }); });
    const a = status.membros.find((m) => m.maquina === 'pc-a');
    assert.deepEqual([a?.origem, a?.adesao], ['fabrica-estado', null]);
    assert.match(textoDaRede(status), /^pc-a · vista só na fábrica de orkastery; não publica na rede · batida /m);
  } finally { f.limpar(); p.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// GO-FIX 1 (CHECK 1): lacunas de teste apontadas na revisao.
// ---------------------------------------------------------------------------

test('RM-053 forja: com URL HTTPS, o git do cache pergunta so ao helper da propria forja; o helper global e zerado (D4)', () => {
  const raiz = dirTemporario('rede-helper');
  const log = path.join(raiz, 'chamadas.jsonl');
  const f = forjaFalsa('forja-helper', { FORJA_FAKE_LOG: log });
  const u = dirTemporario('rede-helper-usuario');
  try {
    // A pessoa tem um helper global (store, keychain...): ele nunca pode receber a credencial da casa.
    const global = path.join(raiz, 'gitconfig-global');
    const marca = path.join(raiz, 'helper-global-chamado');
    fs.writeFileSync(global, `[credential]\n\thelper = "!f() { echo chamado > ${marca}; }; f"\n`);
    naMaquina(u, () => {
      const gh = forjaPorNome('github', f.amb)!;
      const casa = { forja: 'github' as const, host: 'github.com', dono: 'pessoa-teste', repositorio: 'orkastery-network', origem: 'rede.json' as const };
      const cache = prepararCache(casa, 'https://github.com/pessoa-teste/orkastery-network.git', gh.helperDeCredencial(), 'pc-a');
      assert.equal(exec('git', ['config', '--local', '--get-all', 'credential.https://github.com.helper'], cache).stdout, `\n${gh.helperDeCredencial()}\n`);
      // Idempotente mesmo com um helper na config global da pessoa: a segunda chamada nao regrava nada.
      const config = path.join(cache, '.git', 'config');
      const antes = [fs.readFileSync(config, 'utf8'), fs.statSync(config).mtimeMs];
      prepararCache(casa, 'https://github.com/pessoa-teste/orkastery-network.git', gh.helperDeCredencial(), 'pc-a');
      assert.deepEqual([fs.readFileSync(config, 'utf8'), fs.statSync(config).mtimeMs], antes);
      spawnSync('git', ['credential', 'fill'], { cwd: cache, encoding: 'utf8', timeout: 20000,
        input: 'protocol=https\nhost=github.com\npath=pessoa-teste/orkastery-network.git\n\n',
        env: { ...f.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', HOME: f.home } });
      assert.equal(fs.existsSync(marca), false, 'o helper global nao foi chamado');
      const chamadas = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { cli: string; args: string[] }) : [];
      assert.ok(chamadas.some((c) => c.cli === 'gh' && c.args.join(' ') === 'auth git-credential get'), JSON.stringify(chamadas));
    });
  } finally { f.limpar(); fs.rmSync(raiz, { recursive: true, force: true }); fs.rmSync(u, { recursive: true, force: true }); }
});

test('RM-053 forja: GitLab de ponta a ponta, so com o glab: entrar, status e sair', () => {
  const f = forjaFalsa('forja-gitlab-e2e');
  const [ua, ub] = [dirTemporario('rede-lab-a'), dirTemporario('rede-lab-b')];
  try {
    f.tirar('gh');
    const amb = ligado(f);
    const a = naMaquina(ua, () => entrarNaRede({ amb, maquina: 'pc-lab-a' }));
    assert.deepEqual([a.casa.forja, a.casa.host, a.casa.dono, a.criado], ['gitlab', 'gitlab.com', 'pessoa-lab', true]);
    naMaquina(ub, () => entrarNaRede({ amb, maquina: 'pc-lab-b' }));
    const status = naMaquina(ua, () => lerRede({ amb, maquina: 'pc-lab-a' }));
    assert.deepEqual([status.casa?.forja, status.membros.map((m) => m.maquina), status.lacunas], ['gitlab', ['pc-lab-a', 'pc-lab-b'], []]);
    assert.deepEqual(status.membros[0].forjas, [{ forja: 'gitlab', host: 'gitlab.com', cli: 'glab', versao: '1.50.0', usuario: 'pessoa-lab' }]);
    assert.match(String(naMaquina(ub, () => sairDaRede({ amb, maquina: 'pc-lab-b' })).commit), /^[a-f0-9]{40}$/);
    assert.deepEqual(naMaquina(ua, () => lerRede({ amb, maquina: 'pc-lab-a' })).membros.map((m) => m.maquina), ['pc-lab-a']);
  } finally { f.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// GO-FIX 2 (revisao 2): o escritor publica o que o leitor aceita.
// ---------------------------------------------------------------------------

test('RM-053 autoria: todo retrato publicado passa no leitor, mesmo com nome de maquina e de projeto nos limites (S2)', () => {
  const f = forjaFalsa('autoria-limites');
  const [ua, ub] = [dirTemporario('rede-limites-a'), dirTemporario('rede-limites-b')];
  const p = projetoTemporario('rede-limites', true);
  try {
    const amb = ligado(f);
    naMaquina(ua, () => entrarNaRede({ amb, maquina: 'pc-a' }));
    // Projeto do cwd com nome de manifesto de 90 caracteres, e um do registro com remoto que passa de 500 no scp.
    fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8')
      .replace(/name: .*/, `name: ${'n'.repeat(90)}`));
    const longo = comManifesto(path.join(ub, 'longo'));
    const registro = path.join(ub, 'projetos.json');
    fs.writeFileSync(registro, JSON.stringify({ contrato: 'ork.projetos/v1', projetos: [
      { nome: 'remoto-longo', raiz: longo, remoto: `git@github.com:${'r'.repeat(490)}.git` },
    ] }));
    naMaquina(ub, () => {
      // Membro herdado da fabrica, com o nome vindo de ORK_MAQUINA (espaco e acento, sem validar).
      gravarConfigDaMaquina({ nome: null, fabricaCompartilhada: true });
      const antes = process.env.ORK_MAQUINA;
      process.env.ORK_MAQUINA = 'Meu PC do Escritório';
      try {
        const r = publicarRede({ amb, diretorio: p.dir, arquivoDeProjetos: registro, forcar: true });
        assert.equal(r.acao, 'publicou');
        assert.equal(r.maquina, 'Meu-PC-do-Escrit-rio');
        assert.deepEqual(r.descartados.map((d) => d.padrao), ['fora do contrato ork.rede-maquina/v1'], 'o projeto de nome longo sai, com aviso');
      } finally { if (antes === undefined) delete process.env.ORK_MAQUINA; else process.env.ORK_MAQUINA = antes; }
    });
    const bruto = JSON.parse(exec('git', ['show', 'main:maquinas/Meu-PC-do-Escrit-rio.json'], casaFalsa(f)).stdout);
    assert.ok(normalizarRetrato(bruto), 'o leitor aceita o que o escritor publicou');
    assert.deepEqual(bruto.projetos, [{ nome: 'remoto-longo', remoto: null, caminho: longo }], 'remoto longo demais vira null');
    const status = naMaquina(ua, () => lerRede({ amb, maquina: 'pc-a' }));
    assert.deepEqual(status.membros.map((m) => m.maquina), ['Meu-PC-do-Escrit-rio', 'pc-a']);
    assert.deepEqual(status.lacunas, []);
  } finally { f.limpar(); p.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('RM-053 autoria: o sair tira o proprio arquivo mesmo invalido, e host ou forja novos nao invalidam a maquina (S9, S2)', () => {
  const f = forjaFalsa('autoria-sair-invalido');
  const [ua, ub] = [dirTemporario('rede-sair-invalido-a'), dirTemporario('rede-sair-invalido-b')];
  try {
    const amb = ligado(f);
    naMaquina(ub, () => entrarNaRede({ amb, maquina: 'pc-b' }));
    naMaquina(ua, () => {
      entrarNaRede({ amb, maquina: 'pc-a' });
      const cache = dirDoCache({ forja: 'github', host: 'github.com', dono: 'pessoa-teste', repositorio: 'orkastery-network' });
      const { ponta } = buscarBranch(cache, 'origin', 'main', 'teste');
      // Uma versao nova do ork publicou pc-b com um host e uma forja que esta versao nao conhece.
      const deB = JSON.parse(exec('git', ['show', `${ponta}:maquinas/pc-b.json`], cache).stdout);
      const novo = { ...deB, hosts: [...deB.hosts, { host: 'host-do-futuro', versao: '1.0.0', adaptador: null }],
        forjas: [...deB.forjas, { forja: 'bitbucket', host: 'bitbucket.org', cli: 'bb', versao: null, usuario: 'x' }], campoNovo: 1 };
      assert.ok(gravarNaBranch(cache, 'origin', 'main', ponta, [
        { caminho: 'maquinas/pc-a.json', conteudo: '{ quebrado' },
        { caminho: 'maquinas/pc-b.json', conteudo: JSON.stringify(novo) },
      ], 'teste: arquivo invalido e retrato de versao nova', 'teste'));
      const status = lerRede({ amb, maquina: 'pc-a' });
      const b = status.membros.find((m) => m.maquina === 'pc-b');
      assert.ok(b, 'a maquina da versao nova continua visivel');
      assert.deepEqual([b.hosts.map((h) => h.host).includes('host-do-futuro' as never), b.forjas.map((x) => x.forja)], [false, ['github', 'gitlab']]);
      const saida = sairDaRede({ amb, maquina: 'pc-a' });
      assert.match(String(saida.commit), /^[a-f0-9]{40}$/, 'o proprio arquivo invalido saiu');
      assert.equal(exec('git', ['cat-file', '-e', 'main:maquinas/pc-a.json'], casaFalsa(f)).ok, false);
    });
  } finally { f.limpar(); for (const d of [ua, ub]) fs.rmSync(d, { recursive: true, force: true }); }
});
