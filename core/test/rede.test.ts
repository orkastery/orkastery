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
import { acharBinario, forjaPorNome, forjasDaMaquina, pastasDeBinarios, versaoDoBinario } from '../src/rede-forja';
import { dirTemporario } from './apoio';

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
  if (args[1] === 'token') sair(0, TOKEN + '\\n');
  if (args[1] === 'git-credential') sair(0);
  sair(0, 'Logged in as ' + login + '\\nToken: ' + TOKEN + '\\n');
}
if (args[0] !== 'api') sair(2, '', 'fake: nao simulado\\n');
if (process.env.FORJA_FAKE_SEM_LOGIN === '1') sair(1, '', cli === 'gh' ? 'gh: To get started with GitHub CLI, please run:  gh auth login\\n' : 'glab: not authenticated\\n');
if (process.env.FORJA_FAKE_ERRO === '1') sair(1, '', cli + ': Server Error (HTTP 500)\\n');
let metodo = 'GET', rota = null;
const campos = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '-X' || args[i] === '--method') { metodo = args[++i]; continue; }
  if (['-f', '-F', '--field', '--raw-field'].includes(args[i])) { const [k, ...v] = args[++i].split('='); campos[k] = v.join('='); continue; }
  if (rota === null) rota = args[i];
}
if (rota === 'user') sair(0, JSON.stringify(cli === 'gh'
  ? { login, id: 42, email: 'dono-secreto@exemplo.com', plan: { name: 'pro', private_repos: 9999 }, token: TOKEN }
  : { username: login, id: 7, email: 'lab-secreto@exemplo.com', plan: 'gold', private_token: 'glpat-FAKE0123456789abcdefgh' }));
const estado = ler();
const resposta = (chave) => {
  const r = estado[chave];
  return cli === 'gh'
    ? { full_name: chave, private: r.privado, visibility: r.privado ? 'private' : 'public', clone_url: r.url, ssh_url: r.url }
    : { path_with_namespace: chave, visibility: r.privado ? 'private' : 'public', http_url_to_repo: r.url, ssh_url_to_repo: r.url };
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
