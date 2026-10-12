/**
 * RM-061, fatia F3b: `ork roadmap reservas|pegar|soltar|feat` em ingles, com um remoto bare local. O painel no terminal,
 * o resultado de pegar, soltar e feat, o uso e as recusas `roadmap.*` saem pelo catalogo; o bloco do RM-052 sai igual
 * nas duas linguas; o `--json`, a branch de reservas e o painel em Markdown nao mudam. Os nomes comecam por
 * "locale en F3b reservas:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cobreLocale } from '../src/locale';
import { cenario, EN, linhasEmPortugues, ork, orkEm, PT } from './locale-apoio';

const BLOCO = (t: string) => t.split('\n').filter((x) => x.startsWith('Projeto consultado:') || x.startsWith('Não lido:'));
const SEM_BLOCO = (t: string) => t.split('\n').filter((x) => !BLOCO(x).length).join('\n');

test('locale en F3b reservas: pegar, reservas, feat e soltar saem em ingles, e a branch nao muda', () => {
  const c = cenario('reservas-f3b');
  const remoto = fs.mkdtempSync(path.join(path.dirname(c.dir), 'ork-locale-reservas-remoto-'));
  try {
    fs.mkdirSync(path.join(c.dir, 'docs', 'roadmap'), { recursive: true });
    for (const item of ['RM-001-a', 'RM-002-b']) fs.writeFileSync(path.join(c.dir, 'docs', 'roadmap', `${item}.md`), `# ${item}\n`);
    execFileSync('git', ['add', '--', 'docs', 'orkastery.yaml', 'AGENTS.md'], { cwd: c.dir });
    execFileSync('git', ['commit', '-q', '-m', 'roadmap'], { cwd: c.dir });
    assert.match(ork(c, EN, false, 'roadmap', 'reservas').stdout,
      /\nRoadmap reservations: project loc has no remote origin; nothing was read from ork\/roadmap-reservas\.\n$/);
    execFileSync('git', ['init', '--bare', '-q', remoto]);
    execFileSync('git', ['remote', 'add', 'origin', remoto], { cwd: c.dir });
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: c.dir });
    assert.match(ork(c, EN, false, 'roadmap', 'reservas').stdout, /\n\nNo roadmap item reserved\.\n$/);
    const pegou = ork(c, EN, false, 'roadmap', 'pegar', 'RM-001', '--nota', 'fatia 1');
    assert.equal(pegou.status, 0, pegou.stderr);
    assert.match(pegou.stdout, /^RM-001: reserved for this machine\.\n {2}with Teste Orkastery on \S+\n {2}branch ork\/roadmap-reservas at [0-9a-f]{7}\n$/);
    assert.match(ork(c, EN, false, 'roadmap', 'pegar', 'RM-001').stdout, /^RM-001: reservation renewed\.\n/);
    const painel = ork(c, EN, false, 'roadmap', 'reservas');
    assert.match(painel.stdout, /\nITEM {5}WITH {16}MACHINE {9}THREAD {13}SINCE\nRM-001 {3}Teste Orkastery {5}\S+ +- +\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}fatia 1\n\nTimes in America\/New_York, E[SD]T\.\n$/);
    assert.deepEqual(BLOCO(painel.stdout), BLOCO(ork(c, PT, false, 'roadmap', 'reservas').stdout));
    assert.deepEqual(linhasEmPortugues(SEM_BLOCO(painel.stdout), ['fatia 1']), []);
    const feat = ork(c, EN, false, 'roadmap', 'feat', '--thread', 'loc-a');
    assert.match(feat.stdout, /^FEAT-001: reserved for this machine, thread loc-a\.\n {2}create `docs\/produto\/FEAT-001-<subject>\.md`; the number does not come back, even if the feature never ships\n {2}branch ork\/roadmap-reservas at [0-9a-f]{7}\n$/);
    assert.match(ork(c, EN, false, 'roadmap', 'reservas').stdout,
      /\n\nFEAT numbers reserved \(1\), the latest: FEAT-001 \(loc-a\)\. The next one comes from: ork roadmap feat\n/);
    assert.match(ork(c, EN, false, 'roadmap', 'soltar', 'RM-001').stdout, /^RM-001: released\.\n {2}branch ork\/roadmap-reservas at [0-9a-f]{7}\n$/);
    assert.equal(ork(c, EN, false, 'roadmap', 'soltar', 'RM-001').stdout, 'RM-001: was already free.\n');
    // As recusas, em ingles, com o codigo igual.
    assert.equal(orkEm(c, c.dir, { ...EN, ORK_MAQUINA: 'pc-outro' }, false, 'roadmap', 'pegar', 'RM-002', '--thread', 'loc-x').status, 0);
    const reservado = ork(c, EN, false, 'roadmap', 'pegar', 'RM-002');
    assert.match(reservado.stderr, /^error: roadmap\.reservado: RM-002 is with Teste Orkastery on pc-outro since \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(thread loc-x\)\. Pick another item or talk to whoever is on it\n$/);
    assert.equal(ork(c, EN, false, 'roadmap', 'soltar', 'RM-002', '--forcar').stderr,
      'error: roadmap.forcar: `--forcar` needs `--motivo` (taking another machine\'s reservation is a recorded decision)\n');
    assert.equal(ork(c, EN, false, 'roadmap', 'pegar', 'XX-1').stderr, 'error: roadmap.item: "XX-1" is not a roadmap item (expected RM-NNN)\n');
    assert.match(ork(c, EN, false, 'roadmap', 'voar').stderr, /^usage: ork roadmap status \[--json\] \| reservas /);
    assert.equal(ork(c, EN, false, 'roadmap', 'reservas', '--soltar-orfas').stdout, 'No orphan reservation on this machine.\n');
    // O remoto que nunca vai ao git: a recusa sai do catalogo, com o codigo igual nas duas linguas.
    const remotoInvalido = (env: Record<string, string>) => ork(c, env, false, 'roadmap', 'reservas', '--remoto=--upload-pack=x');
    assert.match(remotoInvalido(EN).stderr, /^error: roadmap\.remoto-invalido: remote "--upload-pack=x" is not a git remote name \(letters, digits, /);
    assert.match(remotoInvalido(PT).stderr, /^erro: roadmap\.remoto-invalido: o remoto "--upload-pack=x" não é nome de remoto do git /);
    // O --json e o mesmo nas duas linguas.
    const semVariavel = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>').replace(/[0-9a-f]{40}/g, '<SHA>');
    assert.equal(semVariavel(ork(c, EN, false, 'roadmap', 'reservas', '--json').stdout), semVariavel(ork(c, PT, false, 'roadmap', 'reservas', '--json').stdout));
    // O painel em Markdown da branch segue em pt-BR (dado da branch).
    const markdown = execFileSync('git', ['show', 'origin/ork/roadmap-reservas:RESERVAS.md'], { cwd: c.dir, encoding: 'utf8' });
    assert.match(markdown, /\| Item \| Com quem \| Máquina \| Thread \| Desde \| Nota \|/);
  } finally { c.limpar(); fs.rmSync(remoto, { recursive: true, force: true }); }
});

test('locale en F3b reservas: owner.language en-US vence o LANG pt-BR, e o --json nunca ativa o locale', () => {
  for (const sub of ['reservas', 'pegar', 'soltar', 'feat']) assert.ok(cobreLocale(['roadmap', sub, 'RM-001'], {}), sub);
  assert.ok(cobreLocale(['roadmap'], {}));
  assert.equal(cobreLocale(['roadmap', 'reservas'], { json: true }), false);
  const c = cenario('reservas-f3b-dono');
  try {
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.match(ork(c, PT, false, 'roadmap').stdout, /\nRoadmap reservations: project loc has no remote origin; nothing was read from ork\/roadmap-reservas\.\n$/);
  } finally { c.limpar(); }
});
