/**
 * Ensaio de primeira experiencia da 0.5.0 publicada (thread ork-ensaioprimei). Cada teste prende
 * um achado do ensaio corrigido no codigo ou na doc; os nomes comecam por "ensaio 050:" para que
 * cada claim rode so o seu.
 *
 * A CLI roda com HOME temporario e so PATH e LANG no ambiente: `init` e `thread new` registram o
 * projeto em `~/.orkastery/projetos.json`, e o teste nao pode tocar no HOME de quem roda.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { init } from '../src/init';
import { carregarManifesto } from '../src/manifest';
import { checar } from '../src/doctor';
import { exec, shaCurto } from '../src/util';
import { avaliarPolicies } from '../src/policies';
import { gravarEtapa } from '../src/onboarding';
import { textoDosPitfalls } from '../src/hosts';
import { ajustarManifesto, dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

/** Repositorio recem-criado, sem commit, com o HEAD apontando para `branch`. */
function repoSemCommit(nome: string, branch: string): string {
  const dir = dirTemporario(nome);
  exec('git', ['init', '-q'], dir);
  exec('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  return dir;
}

function primeiroCommit(dir: string): void {
  fs.writeFileSync(path.join(dir, 'README.md'), '# ensaio\n');
  exec('git', ['add', '--', 'README.md'], dir);
  assert.ok(exec('git', ['commit', '-q', '-m', 'inicial'], dir).ok, 'commit inicial');
}

/** A CLI do HEAD, com HOME proprio e sem as variaveis de quem roda o teste. */
function ork(dir: string, casa: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function limpar(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test('ensaio 050: init sem commit grava a branch do HEAD, nao main', () => {
  const dir = repoSemCommit('ensaio-init', 'trunk');
  const casa = dirTemporario('ensaio-init-casa');
  try {
    const r = ork(dir, casa, 'init');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /branch base trunk\n/);
    assert.equal(carregarManifesto(dir)?.manifesto.worktree.base_branch, 'trunk');
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /Branch base: `trunk`\./);
  } finally { limpar(dir, casa); }
});

test('ensaio 050: init sem commit com HEAD destacado fica em main, e com main existente segue main', () => {
  const destacado = repoSemCommit('ensaio-init-destacado', 'trunk');
  const comMain = repoSemCommit('ensaio-init-main', 'main');
  try {
    primeiroCommit(destacado);
    exec('git', ['checkout', '-q', '--detach'], destacado);
    // Antes: `rev-parse --abbrev-ref HEAD` respondia "HEAD", e o manifesto nascia com base "HEAD".
    assert.equal(init(destacado, { nome: 'ensaio', abbrev: 'ens' }).deteccao.baseBranch, 'main');

    primeiroCommit(comMain);
    exec('git', ['checkout', '-q', '-b', 'tarefa'], comMain);
    assert.equal(init(comMain, { nome: 'ensaio', abbrev: 'ens' }).deteccao.baseBranch, 'main');
  } finally { limpar(destacado, comMain); }
});

test('ensaio 050: doctor sem commit diz a branch e que nao ha commit', () => {
  const dir = repoSemCommit('ensaio-doctor', 'trunk');
  try {
    init(dir, { nome: 'ensaio', abbrev: 'ens' });
    const antes = checar(dir).find(c => c.nome === 'repositorio');
    assert.equal(antes?.nivel, 'ok');
    assert.equal(antes?.detalhe, 'branch trunk (sem commit)');

    primeiroCommit(dir);
    assert.equal(checar(dir).find(c => c.nome === 'repositorio')?.detalhe, 'branch trunk');
  } finally { limpar(dir); }
});

test('ensaio 050: sha curto corta sha e deixa o marcador inteiro', () => {
  assert.equal(shaCurto('ce29557dea45609242972e696400e8913d8915f9'), 'ce29557d');
  assert.equal(shaCurto('abc1234'), 'abc1234');
  assert.equal(shaCurto('desconhecido'), 'desconhecido');
  assert.equal(shaCurto('main'), 'main');
});

test('ensaio 050: thread sem commit avisa no stderr e mostra o marcador inteiro', () => {
  const dir = repoSemCommit('ensaio-thread', 'master');
  const casa = dirTemporario('ensaio-thread-casa');
  try {
    assert.equal(ork(dir, casa, 'init').status, 0);
    const simulada = ork(dir, casa, 'thread', 'new', 'primeira tarefa', '--modo', 'auto', '--dry-run');
    assert.equal(simulada.status, 0, simulada.stderr);
    assert.match(simulada.stdout, /  base      desconhecida @ desconhecido\n/);
    assert.match(simulada.stderr, /ainda não tem commit, e a thread nasceria sem base: faça o primeiro commit/);

    const criada = ork(dir, casa, 'thread', 'new', 'primeira tarefa', '--modo', 'auto');
    assert.equal(criada.status, 0, criada.stderr);
    assert.match(criada.stdout, /Thread criada\.\n[\s\S]*  base      desconhecida @ desconhecido\n/);
    const id = /  id        (\S+)\n/.exec(criada.stdout)?.[1];
    assert.ok(id, criada.stdout);
    assert.ok(criada.stderr.includes(`a thread ${id} nasceu sem base: o ship não tem de onde partir`), criada.stderr);
    assert.ok(criada.stderr.includes(`ork thread close ${id} --motivo engano`), criada.stderr);

    primeiroCommit(dir);
    const depois = ork(dir, casa, 'thread', 'new', 'segunda tarefa', '--modo', 'auto');
    assert.equal(depois.status, 0, depois.stderr);
    assert.match(depois.stdout, /  base      master @ [0-9a-f]{8}\n/);
    assert.doesNotMatch(depois.stderr, /sem base/);
  } finally { limpar(dir, casa); }
});

test('ensaio 050: baseline sem commit mostra o marcador inteiro no verify', () => {
  const dir = repoSemCommit('ensaio-baseline', 'master');
  const casa = dirTemporario('ensaio-baseline-casa');
  try {
    assert.equal(ork(dir, casa, 'init').status, 0);
    const criada = ork(dir, casa, 'thread', 'new', 'tarefa sem commit', '--modo', 'auto');
    const id = /  id        (\S+)\n/.exec(criada.stdout)?.[1];
    assert.ok(id, criada.stdout + criada.stderr);
    assert.equal(ork(dir, casa, 'verify', id, '--baseline').status, 0);
    const v = ork(dir, casa, 'verify', id);
    assert.match(v.stdout, /  baseline    desconhecido de /);
    assert.doesNotMatch(v.stdout, /desconhe de /);
  } finally { limpar(dir, casa); }
});

test('ensaio 050: push direto na base aponta ork worktree ensure, e nao o proprio ship', () => {
  const p = projetoTemporario('ensaio-push');
  try {
    // Origem igual ao destino (a thread sem worktree entrega main para main) e origem igual a base.
    for (const rota of [{ de: 'main', para: 'main' }, { de: 'main', para: 'release' }]) {
      const v = avaliarPolicies(p.carregado.manifesto, { gate: 'ship', baseBranch: 'main', threadId: 'ork-exemplo', ...rota })
        .find(x => x.policy === 'push_direto_na_base');
      assert.ok(v, JSON.stringify(rota));
      assert.equal(v.severidade, 'block');
      assert.match(v.correcao, /sem worktree, crie-a com ork worktree ensure ork-exemplo/);
      assert.match(v.correcao, /--worktree auto/);
      assert.doesNotMatch(v.correcao, /ork ship/);
    }
    assert.equal(avaliarPolicies(p.carregado.manifesto, { gate: 'ship', baseBranch: 'main', threadId: 'ork-exemplo',
      de: 'ork/ork-exemplo-full', para: 'main' }).some(x => x.policy === 'push_direto_na_base'), false);
  } finally { p.limpar(); }
});

test('ensaio 050: fuso do owner vence o fuso legado no aviso do doctor', () => {
  const p = projetoTemporario('ensaio-fuso');
  try {
    // O guia de onboarding responde com o fuso legado; o de experiencia, com owner na mesma etapa.
    gravarEtapa(p.dir, 'maestro', { nome: 'Equipe', objetivo: 'Conduzir o produto', fuso: 'America/Sao_Paulo' }, 'equipe');
    gravarEtapa(p.dir, 'maestro', { owner: { language: 'pt-BR', timezone: 'UTC', depth: 'curta', experience: true } }, 'equipe');
    assert.equal(checar(p.dir).some(c => c.nome === 'onboarding fuso'), false, 'owner.timezone foi gravado no manifesto');

    // Manifesto editado a mao: o aviso cita o owner.timezone da resposta, nao o fuso legado.
    ajustarManifesto(p, /timezone: "UTC"/, 'timezone: "Europe/Lisbon"');
    const aviso = checar(p.dir).find(c => c.nome === 'onboarding fuso');
    assert.equal(aviso?.nivel, 'warn');
    assert.match(aviso?.detalhe ?? '', /entrevista informou UTC; manifesto declara Europe\/Lisbon/);
  } finally { p.limpar(); }
});

test('ensaio 050: fuso do owner ausente deixa o fuso legado valer como antes', () => {
  const p = projetoTemporario('ensaio-fuso-legado');
  try {
    gravarEtapa(p.dir, 'maestro', { nome: 'Equipe', fuso: 'America/Sao_Paulo' }, 'equipe');
    assert.match(checar(p.dir).find(c => c.nome === 'onboarding fuso')?.detalhe ?? '',
      /entrevista informou America\/Sao_Paulo; manifesto declara owner\.timezone ausente/);
  } finally { p.limpar(); }
});

test('ensaio 050: textos do adaptador sem contagem fixa e com o pacote pulado dito como pulado', () => {
  const pitfalls = textoDosPitfalls('claude-code');
  // A 0.5.0 dizia "os 17 caminhos"; o plugin.json da 0.5.0 declara 20 skills.
  assert.doesNotMatch(pitfalls, /\d+ caminhos/);
  assert.match(pitfalls, /declara cada caminho de skill, um a um/);
  assert.match(pitfalls, /Skills \(N\) soma as skills do plugin\.json e os comandos de commands\//);

  const p = projetoTemporario('ensaio-adaptador');
  const casa = dirTemporario('ensaio-adaptador-casa');
  const fora = dirTemporario('ensaio-adaptador-fora');
  try {
    // Catalogo fora do projeto: o pacote de experiencia (ativo por padrao) e pulado com aviso.
    const r = ork(p.dir, casa, 'adapter', 'install', 'claude-code', '--dir', fora, '--dry-run');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Experiência: pacote pulado nesta instalação \(motivo no aviso abaixo\)/m);
    assert.match(r.stdout, /^Aviso: Pacote de experiência pulado: o adaptador fica fora do projeto/m);
    assert.doesNotMatch(r.stdout, /desativada ou sem integração/);
  } finally { p.limpar(); limpar(casa, fora); }
});

test('ensaio 050: ajuda do setup traz a continuacao logo abaixo do setup', () => {
  const casa = dirTemporario('ensaio-ajuda-casa');
  try {
    const r = ork(casa, casa, '--help');
    assert.equal(r.status, 0, r.stderr);
    const linhas = r.stdout.split('\n');
    const i = linhas.findIndex(l => /^  setup\s+Pauta da entrevista #setup/.test(l));
    assert.ok(i >= 0, 'linha do setup');
    assert.match(linhas[i + 1], /^\s+por bloco de cada modo \(default claude-bg\/opus\/high; #Fast: sonnet\)$/);
    const sync = linhas.findIndex(l => /^  onboarding sync \[--json\]/.test(l));
    assert.ok(sync > i, 'onboarding sync depois do setup');
    assert.doesNotMatch(linhas[sync + 1] ?? '', /por bloco de cada modo/);
  } finally { limpar(casa); }
});
