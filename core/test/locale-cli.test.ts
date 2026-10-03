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
import { definirFusoDoDono } from '../src/horario';
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
