/**
 * I-33 (T7, D7): o doctor e o preflight conferem o login de cada perfil com o proprio CLI e o env
 * do perfil (`claude auth status`, `codex login status`), sem marcar o store, e sondam umask e
 * permissoes do estado na mesma regra do sensor (sem bits 0o022; pasta privada 0700 exata).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { checarContas } from '../src/doctor';
import { checkDeContas, preflight, SensoresPreflight, sondasDeAmbiente, umaskDoProcesso } from '../src/preflight';
import { adicionarPerfil, caminhoDoStore, lerPerfis } from '../src/runtime-profiles';

const SCRIPT_CLAUDE = `#!/bin/sh
echo "$1 $CLAUDE_CONFIG_DIR" >> "$ORK_PERFIL_STUB_DIR/envs"
if [ "$1" = "--version" ]; then echo "stub 0.0.1"; exit 0; fi
if [ "$1" = "auth" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/.stub-logado" ]; then L=true; else L=false; fi
  printf '{"loggedIn":%s,"authMethod":"claude.ai","apiProvider":"firstParty","configDirectory":"%s"}\\n' "$L" "$CLAUDE_CONFIG_DIR"
  [ "$L" = true ] && exit 0 || exit 1
fi
exit 0
`;
const SCRIPT_CODEX = `#!/bin/sh
echo "$1 $CODEX_HOME" >> "$ORK_PERFIL_STUB_DIR/envs"
if [ "$1" = "login" ]; then
  if [ -f "$CODEX_HOME/.stub-logado" ]; then echo "Logged in using ChatGPT"; exit 0; fi
  echo "Not logged in"; exit 1
fi
exit 0
`;

function comStubs(dir: string): { envs: () => string[]; restaurar: () => void } {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), SCRIPT_CLAUDE, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'codex'), SCRIPT_CODEX, { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, STUB: process.env.ORK_PERFIL_STUB_DIR };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.ORK_PERFIL_STUB_DIR = bin;
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  return { envs: () => fs.existsSync(path.join(bin, 'envs')) ? fs.readFileSync(path.join(bin, 'envs'), 'utf8').trim().split('\n') : [],
    restaurar: () => { volta('PATH', anterior.PATH); volta('ORK_PERFIL_STUB_DIR', anterior.STUB); } };
}

function conta(raiz: string, id: string, runtime: 'claude-bg' | 'codex', logado: boolean): string {
  const dir = path.join(raiz, 'contas', id);
  fs.mkdirSync(dir, { recursive: true });
  if (logado) fs.writeFileSync(path.join(dir, '.stub-logado'), '');
  adicionarPerfil(raiz, { id, runtime, dir });
  return dir;
}

test('doctor: contas por runtime conferidas pelo proprio CLI com o env de cada perfil, sem marcar o store', () => {
  const p = projetoTemporario('doctor-contas');
  const s = comStubs(p.dir);
  try {
    assert.equal(checarContas(p.dir).nivel, 'ok', 'sem perfil: ambiente do processo');
    assert.deepEqual(s.envs(), [], 'sem perfil nada e sondado');
    const a = conta(p.dir, 'a', 'claude-bg', true);
    const b = conta(p.dir, 'b', 'claude-bg', false);
    const x = conta(p.dir, 'x', 'codex', true);
    const antes = fs.readFileSync(caminhoDoStore(p.dir));
    const c = checarContas(p.dir);
    assert.equal(c.nivel, 'warn');
    assert.equal(c.detalhe, 'claude-bg: a pronto, b sem login; codex: x pronto');
    assert.ok(s.envs().includes(`auth ${a}`) && s.envs().includes(`auth ${b}`) && s.envs().includes(`login ${x}`));
    assert.deepEqual(fs.readFileSync(caminhoDoStore(p.dir)), antes, 'o doctor so le');
    fs.rmSync(path.join(a, '.stub-logado'));
    assert.equal(checarContas(p.dir).nivel, 'fail', 'runtime com perfis e nenhum pronto reprova');
    assert.ok(lerPerfis(p.dir).perfis.every(q => q.estado === 'ativo'));
  } finally { s.restaurar(); p.limpar(); }
});

test('sonda de umask e permissoes: mesma regra 0o022 do sensor e 0700 exato da pasta privada', () => {
  const p = projetoTemporario('doctor-umask');
  try {
    const nivel = (umask: number, nome: string) => sondasDeAmbiente(p.dir, umask).find(c => c.nome === nome)?.nivel;
    assert.equal(nivel(0o022, 'umask'), 'ok');
    assert.equal(nivel(0o077, 'umask'), 'ok');
    assert.equal(nivel(0o002, 'umask'), 'warn');
    assert.equal(nivel(0o000, 'umask'), 'warn');
    assert.equal(sondasDeAmbiente(p.dir, null).find(c => c.nome === 'umask')?.nivel, 'warn');
    const medido = umaskDoProcesso();
    assert.ok(medido === null || (medido >= 0 && medido <= 0o777));
    assert.equal(nivel(0o022, 'pasta privada'), 'ok', 'ausente: criada sob demanda');
    const privada = path.join(p.dir, '.orkastery', 'private');
    fs.mkdirSync(privada, { mode: 0o700 });
    fs.chmodSync(privada, 0o755);
    assert.equal(nivel(0o022, 'pasta privada'), 'fail');
    fs.chmodSync(privada, 0o700);
    assert.equal(nivel(0o022, 'pasta privada'), 'ok');
    fs.chmodSync(path.join(p.dir, '.orkastery'), 0o777);
    assert.equal(nivel(0o022, 'permissoes do estado'), 'warn');
    fs.chmodSync(path.join(p.dir, '.orkastery'), 0o755);
    assert.equal(nivel(0o022, 'permissoes do estado'), 'ok');
  } finally { p.limpar(); }
});

test('preflight por bloco: com perfis o bloco so fica pronto com login conferido; sem perfis nada muda', () => {
  const p = projetoTemporario('preflight-contas');
  try {
    const chamadas: string[] = [];
    const logados = new Set<string>();
    const sensores: SensoresPreflight = { runtime: n => { chamadas.push(n); return true; }, sandboxCodex: () => true,
      auth: perfil => { chamadas.push(`auth ${perfil.id}`); return logados.has(perfil.id) ? { ok: true, detalhe: 'loggedIn' } : { ok: false, detalhe: 'loggedIn false' }; } };
    let r = preflight(p.dir, 'auto', [], sensores);
    assert.equal(r.prontoPrimeiroBloco, true);
    assert.equal(r.blocos[0].checks.find(c => c.nome === 'contas')?.nivel, 'ok');
    assert.deepEqual(chamadas, ['claude-bg'], 'sem perfil nenhuma conferencia de login');
    assert.ok(r.checks.some(c => c.nome === 'umask'));
    fs.mkdirSync(path.join(p.dir, 'contas'));
    adicionarPerfil(p.dir, { id: 'a', runtime: 'claude-bg', dir: path.join(p.dir, 'contas', 'a') });
    chamadas.length = 0;
    r = preflight(p.dir, 'auto', [], sensores);
    assert.equal(r.prontoPrimeiroBloco, false);
    assert.match(r.blocos[0].checks.find(c => c.nome === 'contas')?.detalhe ?? '', /a sem login/);
    assert.deepEqual(chamadas, ['claude-bg', 'auth a'], 'uma conferencia por runtime, reaproveitada entre blocos');
    logados.add('a');
    r = preflight(p.dir, 'auto', [], sensores);
    assert.equal(r.prontoPrimeiroBloco, true);
    assert.equal(checkDeContas(p.dir, 'codex', () => { throw new Error('nao deveria sondar'); }).nivel, 'ok');
  } finally { p.limpar(); }
});
