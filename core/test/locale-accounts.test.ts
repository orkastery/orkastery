/**
 * RM-061, fatia F3b: `ork accounts list|add|remove|check|esgotamentos` em ingles. O texto, a tabela e o relatorio saem
 * pelo catalogo; o estado do perfil e o da marca so se traduzem na impressao; as recusas `runtime.profiles.*` nascem do
 * catalogo com o codigo igual. O store de perfis, o `--json` e o limite do relatorio ficam iguais nas duas linguas. Os
 * nomes comecam por "locale en F3b accounts:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cobreLocale } from '../src/locale';
import { cenario, Cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

/** O `claude` das contas: `auth status --json` com login de assinatura, ou sem login quando a pasta tem `sem-login`. */
const CLAUDE = `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/sem-login" ]; then echo '{"loggedIn":false}'; exit 1; fi
  echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}'
  exit 0
fi
echo '[]'
`;

function comContas(nome: string): { c: Cenario; com: string; sem: string } {
  const c = cenario(nome);
  fs.writeFileSync(path.join(c.stub, 'claude'), CLAUDE, { mode: 0o755 });
  const com = fs.mkdtempSync(path.join(path.dirname(c.dir), 'ork-locale-accounts-com-'));
  const sem = fs.mkdtempSync(path.join(path.dirname(c.dir), 'ork-locale-accounts-sem-'));
  fs.writeFileSync(path.join(sem, 'sem-login'), '');
  return { c, com, sem };
}

test('locale en F3b accounts: list, add, check, remove e esgotamentos saem em ingles, e o store nao muda', () => {
  const { c, com, sem } = comContas('accounts-f3b');
  try {
    assert.equal(ork(c, EN, true, 'accounts').stdout, 'No profile configured: each runtime dispatches with the process environment.\n');
    const add = ork(c, EN, true, 'accounts', 'add', 'p1', '--runtime', 'claude-bg', '--dir', com, '--sem-login');
    assert.equal(add.status, 0, add.stderr);
    assert.equal(add.stdout, `Login pending: run \`CLAUDE_CONFIG_DIR='${com}' claude auth login --claudeai\`, then \`ork accounts check p1\`\n` +
      `Profile p1 (claude-bg) in ${com}: subscription login checked\n`);
    const semLogin = ork(c, EN, true, 'accounts', 'add', 'p2', '--runtime', 'claude-bg', '--dir', sem, '--sem-login');
    assert.match(semLogin.stdout, /\nProfile p2 \(claude-bg\) in \S+: no login \(.*\); out of the rotation\n$/);
    const lista = ork(c, EN, true, 'accounts', 'list');
    assert.match(lista.stdout, /^ {2}PROFILE {2}RUNTIME {4}DIRECTORY +STATE {4}EXHAUSTED UNTIL {2}LAST USE {2}LAST FAILURE/);
    assert.match(lista.stdout, /\n {2}p1 {7}claude-bg {2}\S+ +active {3}- +- +-\n/);
    assert.match(lista.stdout, /\n {2}p2 {7}claude-bg {2}\S+ +no-auth {2}- +- +runtime\.auth-missing at \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n/);
    assert.match(lista.stdout, /\nTimes in America\/New_York, E[SD]T\.\n$/);
    const check = ork(c, EN, true, 'accounts', 'check');
    assert.equal(check.status, 1);
    assert.match(check.stdout, /^p1 \(claude-bg\): subscription login checked\np2 \(claude-bg\): no login \(.*\)\n\n/);
    assert.equal(ork(c, EN, true, 'accounts', 'check', 'p9').stderr, 'active profile "p9" does not exist (see: `ork accounts list`)\n');
    assert.equal(ork(c, EN, true, 'accounts', 'remove', 'p2').stdout, 'Profile p2 disabled: the directory and the CLI login stay where they are.\n');
    assert.equal(ork(c, EN, true, 'accounts', 'remove', 'p9').stderr, 'runtime.profiles.unknown: profile "p9" does not exist (see: `ork accounts list`)\n');
    const reativa = ork(c, EN, true, 'accounts', 'add', 'p2', '--runtime', 'claude-bg', '--dir', sem, '--sem-login');
    assert.match(reativa.stdout, /^Profile p2 reactivated: same id, runtime and directory as the disabled profile\.\n/);
    assert.equal(ork(c, EN, true, 'accounts', 'add', 'p3', '--runtime', 'gpt', '--dir', com, '--sem-login').stderr,
      'profile refused: runtime.profiles.invalid: runtime "gpt" does not take a profile\n');
    assert.equal(ork(c, EN, true, 'accounts', 'add', 'p3', '--runtime', 'claude-bg', '--dir', com, '--sem-login').stderr,
      `profile refused: runtime.profiles.invalid: there is already a claude-bg profile in ${com}\n`);
    const esg = ork(c, EN, true, 'accounts', 'esgotamentos');
    assert.equal(esg.status, 0, esg.stderr);
    assert.match(esg.stdout, /^Account exhaustions {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2} to \d{4}-\d{2}-\d{2} \d{2}:\d{2} \[desde,ate\)\n {2}live marks in the registry: \d+\n/);
    assert.match(esg.stdout, /\n {2}dispatches on an account marked by another project: 0\n {2}limit: the registry only keeps live marks /);
    assert.equal(ork(c, EN, true, 'accounts', 'esgotamentos', '--desde', 'ontem').stderr,
      'ledger.period.invalid: ontem (use `--desde` 7d, 24h, 30m or an ISO date)\n');
    assert.equal(ork(c, EN, true, 'accounts', 'add', 'p4').stderr, 'usage: ork accounts add <id> --runtime claude-bg|codex --dir <directory> [--sem-login]\n');
    assert.equal(ork(c, EN, true, 'accounts', 'voar').stderr, 'unknown subcommand: accounts voar (use list, add, remove, check or esgotamentos)\n');
    const tudo = [lista, check, esg].map((s) => s.stdout).join('\n').split(com).join('<DIR_A>').split(sem).join('<DIR_B>');
    assert.deepEqual(linhasEmPortugues(tudo, ['[desde,ate)']), []);
    // O --json e o mesmo nas duas linguas: o store, o estado e o limite em pt-BR.
    for (const args of [['accounts', 'list', '--json'], ['accounts', 'esgotamentos', '--json']]) {
      const semInstante = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>');
      assert.equal(semInstante(ork(c, EN, true, ...args).stdout), semInstante(ork(c, PT, true, ...args).stdout), args.join(' '));
    }
    assert.match(ork(c, EN, true, 'accounts', 'esgotamentos', '--json').stdout, /"limite": "o registro guarda so as marcas vivas/);
  } finally { c.limpar(); fs.rmSync(com, { recursive: true, force: true }); fs.rmSync(sem, { recursive: true, force: true }); }
});

test('locale en F3b accounts: owner.language en-US vence o LANG pt-BR, e o --json nunca ativa o locale', () => {
  const { c, com, sem } = comContas('accounts-f3b-dono');
  try {
    assert.equal(ork(c, PT, true, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.equal(ork(c, PT, true, 'accounts', 'list').stdout, 'No profile configured: each runtime dispatches with the process environment.\n');
    assert.equal(cobreLocale(['accounts', 'list'], { json: true }), false);
    for (const sub of ['list', 'add', 'remove', 'check', 'esgotamentos']) assert.ok(cobreLocale(['accounts', sub], {}), sub);
    assert.ok(cobreLocale(['accounts'], {}));
  } finally { c.limpar(); fs.rmSync(com, { recursive: true, force: true }); fs.rmSync(sem, { recursive: true, force: true }); }
});
