/**
 * Prova de conceito do CLI por locale (thread ork-provadeconce; achados EN1, EN6 e EN7 do recibo
 * docs/roadmap/evidencias/RM-049/ensaio-2026-10-03-en.json). Os testes "locale pt-BR:" prendem o
 * texto de `ork doctor` e `ork init` byte a byte como era antes do catalogo de mensagens; os
 * "locale en:" provam a saida em ingles. Os nomes comecam por "locale" para cada claim rodar so o seu.
 *
 * A CLI roda com HOME temporario e so PATH e as variaveis de locale no ambiente.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { relatorio } from '../src/doctor';
import { definirFusoDoDono, formatarDataHora } from '../src/horario';
import { ativarLocale, localeDe, msg, resolverLocale } from '../src/locale';
import { Check } from '../src/types';
import { exec } from '../src/util';
import { dirTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

/** Checks fixos: os tres niveis, correcao e um instante ISO no detalhe (o ano fora do corrente). */
const CHECKS: Check[] = [
  { nome: 'node', nivel: 'ok', detalhe: 'v24.21.0' },
  { nome: 'git', nivel: 'fail', detalhe: 'nao encontrado no PATH', correcao: 'instale o git' },
  { nome: 'fila de rate limit', nivel: 'warn', detalhe: '1 aguardando janela; libera em 2025-09-19T18:16:00Z',
    correcao: 'ork retry resume retoma o que ja liberou' },
];

/**
 * O detalhe e a correcao destes checks sao dados do teste, nao do catalogo: no relatorio en so mudam
 * o titulo, o nome do check, o rotulo da correcao, a data, a legenda e o veredito.
 */

/** O relatorio do doctor em pt-BR, como saia na main a598ad8, antes do catalogo de mensagens. */
const RELATORIO_PT = [
  'ork doctor: o que vale nesta maquina agora',
  '',
  '  [ok]   node                v24.21.0',
  '  [FAIL] git                 nao encontrado no PATH',
  '                             correcao: instale o git',
  '  [warn] fila de rate limit  1 aguardando janela; libera em 19/09/2025 15:16',
  '                             correcao: ork retry resume retoma o que ja liberou',
  'Horários de Brasília.',
  '',
  'Veredito: BLOQUEADO (1 fail, 1 warn). Corrija os itens acima antes de despachar fase.',
].join('\n');

/** A saida do `ork init` em pt-BR, como saia na main a598ad8; `<DIR>` e o repositorio do teste. */
const INIT_PT = [
  'Manifesto criado: <DIR>/orkastery.yaml',
  '  projeto     loc (abbrev "loc")',
  '  branch base main',
  '  gerenciador npm',
  '  verify      (nenhum script detectado)',
  '  AGENTS.md   criado: <DIR>/AGENTS.md',
  '  estado      .orkastery/ fora do git (.orkastery/.gitignore com *; o seu .gitignore fica como está)',
  '',
  'Proximo passo: ork doctor; depois ork onboarding para conduzir a entrevista do projeto.',
  '',
].join('\n');

const INIT_PT_DE_NOVO = [
  'Manifesto ja existe: <DIR>/orkastery.yaml',
  'Nada foi sobrescrito. Use --force para regerar.',
  'AGENTS.md inalterado: <DIR>/AGENTS.md',
  '',
].join('\n');

function repoComCommit(nome: string): string {
  const dir = dirTemporario(nome);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# locale\n');
  exec('git', ['add', '--', 'README.md'], dir);
  assert.ok(exec('git', ['commit', '-q', '-m', 'inicial'], dir).ok, 'commit inicial');
  return dir;
}

function ork(dir: string, casa: string, env: Record<string, string>, ...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, PATH: process.env.PATH ?? '/usr/bin:/bin', ...env },
  });
  return { status: r.status, stdout: (r.stdout ?? '').split(dir).join('<DIR>'), stderr: r.stderr ?? '' };
}

function limpar(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test('locale pt-BR: o relatorio do doctor fica igual byte a byte', () => {
  definirFusoDoDono('America/Sao_Paulo');
  try {
    assert.equal(relatorio(CHECKS), RELATORIO_PT);
  } finally { definirFusoDoDono(undefined); }
});

for (const env of [{ LANG: 'C.UTF-8' }, { LANG: 'pt_BR.UTF-8' }, { LANG: 'es_ES.UTF-8' }]) {
  test(`locale pt-BR: ork init fica igual byte a byte com ${JSON.stringify(env)}`, () => {
    const dir = repoComCommit('locale-init-pt'), casa = dirTemporario('locale-init-pt-casa');
    try {
      const r = ork(dir, casa, env, 'init', '--name', 'loc', '--abbrev', 'loc');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, INIT_PT);
      const de = ork(dir, casa, env, 'init');
      assert.equal(de.status, 0, de.stderr);
      assert.equal(de.stdout, INIT_PT_DE_NOVO);
    } finally { limpar(dir, casa); }
  });
}

test('locale pt-BR: ork doctor abre e fecha em portugues com LANG=pt_BR.UTF-8', () => {
  const dir = repoComCommit('locale-doctor-pt'), casa = dirTemporario('locale-doctor-pt-casa');
  try {
    const r = ork(dir, casa, { LANG: 'pt_BR.UTF-8' }, 'doctor');
    const linhas = r.stdout.trimEnd().split('\n');
    assert.equal(linhas[0], 'ork doctor: o que vale nesta maquina agora');
    assert.match(linhas.at(-1) ?? '', /^Veredito: (BLOQUEADO \(\d+ fail, \d+ warn\)\. Corrija os itens acima antes de despachar fase\.|PRONTO \(\d+ warn\)\. Despacho de fase liberado por `ork phase run`\.)$/);
    assert.match(r.stdout, /\[FAIL\] manifesto +orkastery\.yaml nao encontrado a partir de /);
    assert.match(r.stdout, / correcao: ork init\n/);
  } finally { limpar(dir, casa); }
});

// ---------------------------------------------------------------------------
// en: o mesmo caminho em ingles
// ---------------------------------------------------------------------------

const RELATORIO_EN = [
  'ork doctor: what holds on this machine now',
  '',
  '  [ok]   node              v24.21.0',
  '  [FAIL] git               nao encontrado no PATH',
  '                           fix: instale o git',
  '  [warn] rate limit queue  1 aguardando janela; libera em 2025-09-19 14:16',
  '                           fix: ork retry resume retoma o que ja liberou',
  'Times in America/New_York, EDT.',
  '',
  'Verdict: BLOCKED (1 fail, 1 warn). Fix the items above before dispatching a phase.',
].join('\n');

const INIT_EN = [
  'Manifest created: <DIR>/orkastery.yaml',
  '  project     loc (abbrev "loc")',
  '  base branch main',
  '  package mgr npm',
  '  verify      (no script detected)',
  '  AGENTS.md   created: <DIR>/AGENTS.md',
  '  state       .orkastery/ kept out of git (.orkastery/.gitignore with *; your .gitignore stays as is)',
  '',
  'Next step: ork doctor; then ork onboarding to run the project interview.',
  '',
].join('\n');

const INIT_EN_DE_NOVO = [
  'Manifest already exists: <DIR>/orkastery.yaml',
  'Nothing was overwritten. Use --force to regenerate.',
  'AGENTS.md unchanged: <DIR>/AGENTS.md',
  '',
].join('\n');

test('locale en: a escolha do onboarding vence LC_ALL, LC_MESSAGES e LANG, nessa ordem; o padrao e pt-BR', () => {
  assert.deepEqual(resolverLocale(undefined, {}), { locale: 'pt-BR', origem: 'padrao' });
  assert.deepEqual(resolverLocale(undefined, { LANG: 'en_US.UTF-8' }), { locale: 'en', origem: 'LANG' });
  assert.deepEqual(resolverLocale(undefined, { LANG: 'en_US.UTF-8', LC_MESSAGES: 'pt_BR.UTF-8' }), { locale: 'pt-BR', origem: 'LC_MESSAGES' });
  assert.deepEqual(resolverLocale(undefined, { LANG: 'pt_BR.UTF-8', LC_MESSAGES: 'pt_BR', LC_ALL: 'en_GB.UTF-8' }), { locale: 'en', origem: 'LC_ALL' });
  assert.deepEqual(resolverLocale('en-US', { LC_ALL: 'pt_BR.UTF-8' }), { locale: 'en', origem: 'manifesto' });
  assert.deepEqual(resolverLocale('pt-BR', { LC_ALL: 'en_US.UTF-8' }), { locale: 'pt-BR', origem: 'manifesto' });
  for (const v of ['C.UTF-8', 'POSIX', 'es_ES.UTF-8', 'fr', '']) assert.equal(resolverLocale(undefined, { LANG: v }).locale, 'pt-BR', v);
  assert.equal(localeDe('en'), 'en');
  assert.equal(localeDe('pt'), 'pt-BR');
  assert.equal(localeDe('de_DE@euro'), undefined);
});

test('locale en: o catalogo ingles tem as mesmas chaves do pt-BR e nenhuma mensagem vazia', () => {
  const chaves = (o: object, pre = ''): string[] => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && k !== 'nomes' ? chaves(v, `${pre}${k}.`) : [`${pre}${k}`]);
  assert.deepEqual(chaves(msg('en')), chaves(msg('pt-BR')));
  for (const [k, v] of Object.entries(msg('en').doctor)) if (typeof v === 'string') assert.ok(v.trim(), k);
});

test('locale en: datas ISO (EN6) so com o locale en; pt-BR segue dia/mes', () => {
  const quando = '2026-10-03T10:30:00Z', agora = '2026-10-03T12:00:00Z';
  assert.equal(formatarDataHora(quando, { fuso: 'America/New_York', agora }), '03/10 06:30');
  assert.equal(formatarDataHora(quando, { fuso: 'America/New_York', agora, locale: 'en' }), '2026-10-03 06:30');
  ativarLocale('en');
  try {
    assert.equal(formatarDataHora(quando, { fuso: 'America/New_York', agora, segundos: true }), '2026-10-03 06:30:00');
  } finally { ativarLocale(undefined); }
  assert.equal(formatarDataHora(quando, { fuso: 'America/New_York', agora }), '03/10 06:30');
});

test('locale en: o relatorio do doctor sai em ingles, com a data ISO e a legenda do fuso', () => {
  definirFusoDoDono('America/New_York');
  ativarLocale('en');
  try {
    assert.equal(relatorio(CHECKS), RELATORIO_EN);
  } finally { ativarLocale(undefined); definirFusoDoDono(undefined); }
  definirFusoDoDono('America/Sao_Paulo');
  try {
    assert.equal(relatorio(CHECKS), RELATORIO_PT, 'sem ativar, o relatorio volta ao pt-BR');
  } finally { definirFusoDoDono(undefined); }
});

for (const env of [{ LANG: 'en_US.UTF-8' }, { LANG: 'pt_BR.UTF-8', LC_ALL: 'en_GB.UTF-8' }] as Record<string, string>[]) {
  test(`locale en: ork init sai em ingles com ${JSON.stringify(env)}`, () => {
    const dir = repoComCommit('locale-init-en'), casa = dirTemporario('locale-init-en-casa');
    try {
      const r = ork(dir, casa, env, 'init', '--name', 'loc', '--abbrev', 'loc');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, INIT_EN);
      const de = ork(dir, casa, env, 'init');
      assert.equal(de.status, 0, de.stderr);
      assert.equal(de.stdout, INIT_EN_DE_NOVO);
    } finally { limpar(dir, casa); }
  });
}

test('locale en: escolher en-US no onboarding muda o CLI (EN7), e pt-BR no onboarding vence LANG=en', () => {
  const dir = repoComCommit('locale-onboarding'), casa = dirTemporario('locale-onboarding-casa');
  const pt = { LANG: 'pt_BR.UTF-8' }, en = { LANG: 'en_US.UTF-8' };
  try {
    assert.equal(ork(dir, casa, pt, 'init', '--name', 'loc', '--abbrev', 'loc').stdout, INIT_PT);
    const set = ork(dir, casa, pt, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste');
    assert.equal(set.status, 0, set.stderr);
    assert.equal(ork(dir, casa, pt, 'init').stdout, INIT_EN_DE_NOVO);
    const doctor = ork(dir, casa, pt, 'doctor');
    assert.match(doctor.stdout, /^ork doctor: what holds on this machine now\n/);
    assert.match(doctor.stdout, /\nVerdict: (BLOCKED|READY) /);
    assert.match(doctor.stdout, /\[ok\] +project abbrev +"loc" \(part 1 of the session slug\)\n/);
    const volta = ork(dir, casa, pt, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"pt-BR"}}', '--por', 'teste');
    assert.equal(volta.status, 0, volta.stderr);
    assert.equal(ork(dir, casa, en, 'init').stdout, INIT_PT_DE_NOVO);
  } finally { limpar(dir, casa); }
});

test('locale en: ork doctor abre e fecha em ingles com LANG=en_US.UTF-8', () => {
  const dir = repoComCommit('locale-doctor-en'), casa = dirTemporario('locale-doctor-en-casa');
  try {
    const r = ork(dir, casa, { LANG: 'en_US.UTF-8' }, 'doctor');
    const linhas = r.stdout.trimEnd().split('\n');
    assert.equal(linhas[0], 'ork doctor: what holds on this machine now');
    assert.match(linhas.at(-1) ?? '', /^Verdict: (BLOCKED \(\d+ fail, \d+ warn\)\. Fix the items above before dispatching a phase\.|READY \(\d+ warn\)\. Phase dispatch allowed through `ork phase run`\.)$/);
    assert.match(r.stdout, /\[FAIL\] manifest +orkastery\.yaml not found from /);
    assert.match(r.stdout, / fix: ork init\n/);
  } finally { limpar(dir, casa); }
});

test('locale en: comando fora da prova de conceito segue em pt-BR byte a byte com LANG=en_US.UTF-8', () => {
  const dir = repoComCommit('locale-fora'), casa = dirTemporario('locale-fora-casa');
  try {
    assert.equal(ork(dir, casa, { LANG: 'pt_BR.UTF-8' }, 'init').status, 0);
    for (const args of [['modos'], ['doctor', '--modo', 'fast'], ['projetos', '--json']]) {
      const pt = ork(dir, casa, { LANG: 'pt_BR.UTF-8' }, ...args), en = ork(dir, casa, { LANG: 'en_US.UTF-8' }, ...args);
      assert.equal(en.stdout, pt.stdout, args.join(' '));
    }
  } finally { limpar(dir, casa); }
});
