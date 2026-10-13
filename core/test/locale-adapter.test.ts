/**
 * RM-061, fatia F3b: `ork adapter list|show|install` em ingles. A tabela dos hosts, a descricao e os pitfalls, o texto da
 * instalacao (simulada, feita e barrada) e o aviso do pacote de experiencia saem pelo catalogo; o host, o caminho, o
 * comando de ativacao e o motivo da divergencia saem iguais. Negativo: o recibo `INSTALADO.json` e o motivo da divergencia
 * nao mudam com a lingua, e o `HOSTS` (dado) segue em pt-BR. Os nomes comecam por "locale en F3b adapter:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cobreLocale, msg } from '../src/locale';
import { HOSTS } from '../src/hosts';
import { cenario, Cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

/** O recibo da instalacao do codex, sem a hora e os caminhos de maquina. */
function recibo(c: Cenario): { contrato: string; host: string; arquivos: string[] } {
  const r = JSON.parse(fs.readFileSync(path.join(c.dir, '.agents', 'skills', 'orkastery', 'INSTALADO.json'), 'utf8')) as
    { contrato: string; host: string; arquivos: { arquivo: string }[] };
  return { contrato: r.contrato, host: r.host, arquivos: r.arquivos.map((a) => a.arquivo) };
}

test('locale en F3b adapter: list, show e os erros de uso saem em ingles', () => {
  const c = cenario('adapter-f3b');
  try {
    const lista = ork(c, EN, false, 'adapter');
    assert.equal(lista.status, 0, lista.stderr);
    assert.match(lista.stdout, /^Host adapters \(Layer 1, the podium\)\n\n {2}claude-code {3}Plugin with the catalog skills, /);
    assert.match(lista.stdout, /\n {16}default target: <project>\/\.agents\/skills\/orkastery\n {16}skill catalog included: yes\n/);
    assert.match(lista.stdout, /\nInstall with: ork adapter install <host> \[--dir DIR\] \[--dry-run\] \[--force\]\n/);
    assert.deepEqual(linhasEmPortugues(lista.stdout), []);
    const show = ork(c, EN, false, 'adapter', 'show', 'hermes');
    assert.match(show.stdout, /^Adapter hermes\n {2}A thin router skill, the plugin that declares it and the thread opening script\n {2}default target: <project>\/\.hermes\n\nThe 3 install pitfalls of hermes \(check them, do not assume\):\n\n {2}1\. ork outside the host PATH\n/);
    assert.match(show.stdout, /\n {5}proof: ork modos --do-pedido "test #Maestro" {3}# the only source of the mode\n/);
    assert.deepEqual(linhasEmPortugues(show.stdout), []);
    assert.equal(ork(c, EN, false, 'adapter', 'show', 'x').stderr, 'unknown host: "x". Use: claude-code | codex | hermes | openclaw\n');
    assert.equal(ork(c, EN, false, 'adapter', 'voar').stderr, 'unknown subcommand: adapter voar\n');
  } finally { c.limpar(); }
});

test('locale en F3b adapter: install simulado, feito e barrado saem em ingles, com o recibo e o motivo iguais (negativo)', () => {
  const en = cenario('adapter-f3b-en'), pt = cenario('adapter-f3b-pt');
  try {
    const simulado = ork(en, EN, false, 'adapter', 'install', 'codex', '--dry-run');
    assert.equal(simulado.status, 0, simulado.stderr);
    assert.match(simulado.stdout, /\nDry run \(`--dry-run`\) of the codex adapter install: nothing was written\.\n {2}catalog: {2}\S+\n {2}target: {3}\S+\n {2}ork: {6}\S+\n\n {2}files: \d+ \(\d+ new, 0 already identical, 0 divergent\)\n/);
    const feito = ork(en, EN, false, 'adapter', 'install', 'codex');
    assert.equal(feito.status, 0, feito.stderr);
    assert.match(feito.stdout, /\ncodex adapter files prepared\.\nOpen Codex in this project and use \$ork\.\n/);
    assert.match(feito.stdout, /\nNext step \(the same as at the start\):\nOpen Codex in this project and use \$ork\.\n/);
    assert.deepEqual(linhasEmPortugues(feito.stdout), []);
    assert.equal(ork(pt, PT, false, 'adapter', 'install', 'codex').status, 0);
    // O recibo e o mesmo nas duas linguas: o contrato, o host e os arquivos instalados.
    assert.deepEqual(recibo(en), recibo(pt));
    // Uma copia editada barra nas duas linguas, com o mesmo motivo tipado e os mesmos comandos de saida.
    for (const c of [en, pt]) fs.appendFileSync(path.join(c.dir, '.agents', 'skills', 'orkastery', 'skills', 'core', 'onboarding', 'SKILL.md'), '\nedicao local\n');
    const barrado = ork(en, EN, false, 'adapter', 'install', 'codex');
    assert.equal(barrado.status, 2);
    assert.match(barrado.stdout, /\ncodex adapter install BLOCKED: there is a different file at the target\.\n/);
    assert.match(barrado.stdout, /\n {2}1 file\(s\) need a decision from you:\n {4}skills\/core\/onboarding\/SKILL\.md {2}\(copia-editada\)\n/);
    assert.match(barrado.stdout, /\n {2}Resolve it in ONE command, per file:\n {4}ork adapter install codex --dir \.agents\/skills\/orkastery --aceitar-catalogo skills\/core\/onboarding\/SKILL\.md\n/);
    const barradoPt = ork(pt, PT, false, 'adapter', 'install', 'codex');
    assert.equal(barradoPt.status, 2);
    assert.match(barradoPt.stdout, /\n {4}skills\/core\/onboarding\/SKILL\.md {2}\(copia-editada\)\n/);
    // O HOSTS e dado: a descricao segue em pt-BR, e o catalogo e quem traduz.
    assert.equal(HOSTS.codex.descricao, msg('pt-BR').adapter.hosts.codex.descricao);
    assert.notEqual(HOSTS.codex.descricao, msg('en').adapter.hosts.codex.descricao);
  } finally { en.limpar(); pt.limpar(); }
});

test('locale en F3b adapter: o aviso do pacote de experiencia sai remontado em ingles', () => {
  const c = cenario('adapter-f3b-aviso');
  try {
    fs.appendFileSync(path.join(c.dir, 'orkastery.yaml'), '\nowner:\n  experience: "false"\n');
    const r = ork(c, EN, false, 'adapter', 'install', 'claude-code', '--dry-run');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Experience: package skipped in this install, see the warning below\.\nWarning: Experience package skipped: experiencia\.config\.invalid: `owner\.experience` requires a boolean; [^\n]+\. The rest of the adapter install goes on as usual\.\n/);
    assert.deepEqual(linhasEmPortugues(r.stdout.split('\n').slice(0, 3).join('\n')), []);
  } finally { c.limpar(); }
});

test('locale en F3b adapter: owner.language en-US vence o LANG pt-BR', () => {
  for (const sub of ['list', 'show', 'install', 'voar']) assert.ok(cobreLocale(['adapter', sub], {}), sub);
  assert.ok(cobreLocale(['adapter'], {}));
  const c = cenario('adapter-f3b-dono');
  try {
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.match(ork(c, PT, false, 'adapter').stdout, /^Host adapters \(Layer 1, the podium\)\n/);
  } finally { c.limpar(); }
});
