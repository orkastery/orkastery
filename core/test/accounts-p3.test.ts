/**
 * I-33 (GO-FIX 1 do CHECK aa279e17, achados P3 do `ork accounts`). A7: dois caminhos para o mesmo
 * diretorio (link simbolico) sao o mesmo perfil, e diretorio inacessivel ou de outro usuario nunca
 * e gravado no store. A8: a dica de login pendente pode ser colada no shell sem executar nada do
 * caminho. A9: `remove` desativa e o mesmo `add` (id, runtime e diretorio) reativa.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirTemporario, projetoTemporario } from './apoio';
import { adicionarPerfil, caminhoRealDoPerfil, desativarPerfil, lerPerfis } from '../src/runtime-profiles';

const CLI = path.resolve(__dirname, '../../dist/index.js');
/**
 * Stub do `claude` para o CLI: `auth status` responde sem login (nunca a conta real), e `auth login`
 * so imprime o diretorio que recebeu, que e o que o login do proprio CLI usaria.
 */
const STUB = dirTemporario('accounts-p3-bin');
fs.writeFileSync(path.join(STUB, 'claude'), `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then printf '{"loggedIn":false,"configDirectory":"%s"}' "$CLAUDE_CONFIG_DIR"; exit 1; fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then printf '%s' "$CLAUDE_CONFIG_DIR"; exit 0; fi
exit 1
`, { mode: 0o755 });
const ENV = { ...process.env, PATH: `${STUB}:${process.env.PATH ?? ''}` };
process.on('exit', () => fs.rmSync(STUB, { recursive: true, force: true }));
function ork(cwd: string, args: string[]): { saida: string; codigo: number } {
  try { return { saida: execFileSync(process.execPath, [CLI, ...args], { cwd, env: ENV, encoding: 'utf8', stdio: 'pipe' }), codigo: 0 }; }
  catch (e) { const x = e as { stdout?: string; stderr?: string; status?: number }; return { saida: `${x.stdout ?? ''}${x.stderr ?? ''}`, codigo: x.status ?? 1 }; }
}

test('A7: link simbolico para o diretorio de outro perfil e o mesmo perfil, inclusive para um subdiretorio ainda inexistente', () => {
  const raiz = dirTemporario('a7-real');
  try {
    fs.mkdirSync(path.join(raiz, '.orkastery'));
    const conta = path.join(raiz, 'contas', 'a');
    fs.mkdirSync(conta, { recursive: true });
    fs.symlinkSync(conta, path.join(raiz, 'atalho'));
    fs.symlinkSync(path.join(raiz, 'contas'), path.join(raiz, 'atalho-pai'));
    adicionarPerfil(raiz, { id: 'a', runtime: 'claude-bg', dir: conta });
    assert.throws(() => adicionarPerfil(raiz, { id: 'b', runtime: 'claude-bg', dir: path.join(raiz, 'atalho') }), /mesmo diretorio do perfil "a"/);
    assert.equal(caminhoRealDoPerfil(path.join(raiz, 'atalho-pai', 'nova')), path.join(fs.realpathSync(raiz), 'contas', 'nova'));
    adicionarPerfil(raiz, { id: 'c', runtime: 'claude-bg', dir: path.join(raiz, 'contas', 'nova') });
    assert.throws(() => adicionarPerfil(raiz, { id: 'd', runtime: 'claude-bg', dir: path.join(raiz, 'atalho-pai', 'nova') }), /mesmo diretorio do perfil "c"/);
    // Outro runtime no mesmo diretorio continua sendo outro perfil (cada CLI tem seu arquivo).
    adicionarPerfil(raiz, { id: 'x', runtime: 'codex', dir: path.join(raiz, 'atalho') });
    assert.deepEqual(lerPerfis(raiz).perfis.map(p => p.id), ['a', 'c', 'x']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('A7 CLI: diretorio sem permissao ou de outro usuario e recusado e nada e gravado no store', () => {
  const p = projetoTemporario('a7-cli');
  const fechado = path.join(p.dir, 'fechado');
  try {
    fs.mkdirSync(fechado, { mode: 0o700 });
    fs.chmodSync(fechado, 0o000);
    if (process.getuid?.() !== 0) {
      const r = ork(p.dir, ['accounts', 'add', 'x', '--runtime', 'claude-bg', '--dir', path.join(fechado, 'perfil'), '--sem-login']);
      assert.equal(r.codigo, 1, r.saida);
      assert.match(r.saida, /perfil recusado: .*inacessivel \(EACCES\)/);
      const alheio = ork(p.dir, ['accounts', 'add', 'y', '--runtime', 'claude-bg', '--dir', '/usr/share', '--sem-login']);
      assert.equal(alheio.codigo, 1, alheio.saida);
      assert.match(alheio.saida, /pertence a outro usuario|sem leitura e escrita/);
      assert.deepEqual(lerPerfis(p.dir).perfis, [], 'nenhum perfil gravado');
    }
    const ok = ork(p.dir, ['accounts', 'add', 'z', '--runtime', 'claude-bg', '--dir', path.join(p.dir, 'contas', 'z'), '--sem-login']);
    assert.equal(ok.codigo, 0, ok.saida);
    assert.equal(fs.statSync(path.join(p.dir, 'contas', 'z')).mode & 0o777, 0o700);
    fs.symlinkSync(path.join(p.dir, 'contas', 'z'), path.join(p.dir, 'atalho-z'));
    const dup = ork(p.dir, ['accounts', 'add', 'w', '--runtime', 'claude-bg', '--dir', path.join(p.dir, 'atalho-z'), '--sem-login']);
    assert.equal(dup.codigo, 1, dup.saida);
    assert.deepEqual(lerPerfis(p.dir).perfis.map(q => q.id), ['z']);
  } finally { fs.chmodSync(fechado, 0o700); p.limpar(); }
});

test('A8: a dica de login pendente cita o diretorio para o shell; colar a dica nao executa o caminho', () => {
  const p = projetoTemporario('a8-aspas');
  try {
    const alvo = path.join(p.dir, 'PWNED-a8');
    for (const nome of [`meta;touch ${alvo}`, `sub $(touch ${alvo})`, `aspa'; touch ${alvo}; '`]) {
      const dir = path.join(p.dir, 'contas', nome);
      const r = ork(p.dir, ['accounts', 'add', `m${nome.length}`, '--runtime', 'claude-bg', '--dir', dir, '--sem-login']);
      assert.equal(r.codigo, 0, r.saida);
      const dica = /Login pendente: rode (.*) e depois ork accounts check/.exec(r.saida)?.[1];
      assert.ok(dica, r.saida);
      const colado = execFileSync('/bin/sh', ['-c', dica as string], { encoding: 'utf8', env: ENV });
      assert.equal(colado, dir, 'o CLI recebe o diretorio exato');
      assert.equal(fs.existsSync(alvo), false, `colar a dica executou o caminho: ${nome}`);
    }
  } finally { p.limpar(); }
});

test('A9: o mesmo add reativa o perfil desativado; outro diretorio ou outro runtime continuam recusados', () => {
  const raiz = dirTemporario('a9-store');
  try {
    fs.mkdirSync(path.join(raiz, '.orkastery'));
    const dir = path.join(raiz, 'contas', 'a');
    adicionarPerfil(raiz, { id: 'a', runtime: 'claude-bg', dir }, '2026-09-19T00:00:00.000Z');
    desativarPerfil(raiz, 'a');
    assert.throws(() => adicionarPerfil(raiz, { id: 'a', runtime: 'claude-bg', dir: path.join(raiz, 'contas', 'outra') }), /ja existe \(desativado/);
    assert.throws(() => adicionarPerfil(raiz, { id: 'a', runtime: 'codex', dir }), /ja existe/);
    assert.throws(() => adicionarPerfil(raiz, { id: 'b', runtime: 'claude-bg', dir }), /ja ha perfil claude-bg/);
    const reativado = adicionarPerfil(raiz, { id: 'a', runtime: 'claude-bg', dir });
    assert.deepEqual([reativado.estado, reativado.criadoEm], ['ativo', '2026-09-19T00:00:00.000Z']);
    assert.throws(() => adicionarPerfil(raiz, { id: 'a', runtime: 'claude-bg', dir }), /ja existe/, 'perfil ativo nao e readicionado');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('A9 CLI: remove e depois add com o mesmo id e diretorio reativam o perfil', () => {
  const p = projetoTemporario('a9-cli');
  try {
    const dir = path.join(p.dir, 'contas', 'a');
    assert.equal(ork(p.dir, ['accounts', 'add', 'a', '--runtime', 'claude-bg', '--dir', dir, '--sem-login']).codigo, 0);
    assert.equal(ork(p.dir, ['accounts', 'remove', 'a']).codigo, 0);
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'desativado');
    const add = ork(p.dir, ['accounts', 'add', 'a', '--runtime', 'claude-bg', '--dir', dir, '--sem-login']);
    assert.equal(add.codigo, 0, add.saida);
    assert.match(add.saida, /Perfil a reativado/);
    // O stub responde sem login: o perfil volta, mas fora do rodizio ate o login ser conferido.
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'sem-auth');
    assert.equal(lerPerfis(p.dir).perfis.length, 1);
  } finally { p.limpar(); }
});
