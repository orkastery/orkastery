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
import { checar, checarOnboarding } from '../src/doctor';
import { exec, shaCurto } from '../src/util';
import { avaliarPolicies } from '../src/policies';
import { gravarEtapa } from '../src/onboarding';
import { textoDosPitfalls } from '../src/hosts';
import { analisarComando } from '../src/claim-lint';
import { ORDEM_DOS_MODOS } from '../src/modos';
import { instalarMcp } from '../src/mcp-install';
import { ajustarManifesto, dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const RAIZ = path.resolve(__dirname, '../../..');
const QUICKSTART = (): string => fs.readFileSync(path.join(RAIZ, 'docs/comecar/quickstart.md'), 'utf8');

/** O bloco ```text que vem logo depois do bloco ```bash que contem `comando`. */
function amostraDepoisDe(doc: string, comando: string): string {
  const i = doc.indexOf(comando);
  assert.ok(i >= 0, `comando ausente do quickstart: ${comando}`);
  const abre = doc.indexOf('```text\n', i);
  assert.ok(abre > i, `amostra ausente depois de: ${comando}`);
  const fecha = doc.indexOf('\n```', abre + 8);
  return doc.slice(abre + 8, fecha);
}

/** Saida e amostra comparaveis: so o sha e o caminho do projeto variam entre maquinas. */
function normalizar(texto: string, projeto?: string): string {
  const semCaminho = projeto ? texto.split(projeto).join('/caminho/do/seu/projeto') : texto;
  return semCaminho.replace(/@ [0-9a-f]{8}\b/g, '@ <sha>').replace(/[ \t]+$/gm, '').trim();
}

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

test('ensaio 050: init sem commit, outros casos: HEAD destacado fica em main e main existente segue main', () => {
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
  assert.equal(shaCurto('a'.repeat(64)), 'aaaaaaaa', 'sha de repositorio SHA-256');
});

test('ensaio 050: sha curto nas saidas: nenhum commit cortado com slice fora do shaCurto', () => {
  const src = path.join(RAIZ, 'core/src');
  const achados: string[] = [];
  const arquivos = (fs.readdirSync(src, { recursive: true }) as string[]).filter(n => n.endsWith('.ts'));
  assert.ok(arquivos.some(n => n.startsWith('adapters')), 'a varredura desce em core/src/adapters');
  for (const nome of arquivos) {
    fs.readFileSync(path.join(src, nome), 'utf8').split('\n').forEach((linha, i) => {
      if (/commit\??\.slice\(0, ?8\)/.test(linha)) achados.push(`${nome}:${i + 1}`);
    });
  }
  // fix.ts, ship.ts e auditrun.ts cortavam o commit do verify, que e o marcador sem commit.
  assert.deepEqual(achados, []);
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
    assert.doesNotMatch(criada.stdout, /Proximo passo/, 'thread sem base nao tem fase para rodar');

    primeiroCommit(dir);
    // P4 (ork-p4worktreepo): o manifesto do `ork init` traz worktree.por_thread: true, e com o primeiro commit
    // a thread nasce com a worktree e a branch dela.
    const depois = ork(dir, casa, 'thread', 'new', 'segunda tarefa', '--modo', 'auto');
    assert.equal(depois.status, 0, depois.stderr);
    assert.match(depois.stdout, /  base      ork\/\S+-full @ [0-9a-f]{8}\n  worktree  \S+\/\.claude\/worktrees\/\S+\n/);
    assert.match(depois.stdout, /Proximo passo: ork phase run /);
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
      assert.match(v.correcao, /com --para main; sem worktree e antes do GO, crie-a com ork worktree ensure ork-exemplo/);
      assert.match(v.correcao, /--worktree auto/);
      // CHECK, rodada 1: depois do GO, a branch nova nasceria com os commits e o ship empurraria a base.
      assert.match(v.correcao, /depois do GO, os commits ja estao na base e o ship nao os separa/);
      assert.doesNotMatch(v.correcao, /ork ship/);
    }
    assert.equal(avaliarPolicies(p.carregado.manifesto, { gate: 'ship', baseBranch: 'main', threadId: 'ork-exemplo',
      de: 'ork/ork-exemplo-full', para: 'main' }).some(x => x.policy === 'push_direto_na_base'), false);
  } finally { p.limpar(); }
});

/** So a conferencia da entrevista: o `checar()` inteiro le sessoes e runtimes do HOME de quem roda. */
function avisoDeFuso(dir: string) {
  return checarOnboarding(carregarManifesto(dir)!).find(c => c.nome === 'onboarding fuso');
}

test('ensaio 050: fuso do owner vence o fuso legado no aviso do doctor', () => {
  const p = projetoTemporario('ensaio-fuso');
  try {
    // O guia de onboarding responde com o fuso legado; o de experiencia, com owner na mesma etapa.
    gravarEtapa(p.dir, 'maestro', { nome: 'Equipe', objetivo: 'Conduzir o produto', fuso: 'America/Sao_Paulo' }, 'equipe');
    gravarEtapa(p.dir, 'maestro', { owner: { language: 'pt-BR', timezone: 'UTC', depth: 'curta', experience: true } }, 'equipe');
    assert.equal(avisoDeFuso(p.dir), undefined, 'owner.timezone foi gravado no manifesto');

    // Manifesto editado a mao: o aviso cita o owner.timezone da resposta, nao o fuso legado.
    ajustarManifesto(p, /timezone: "UTC"/, 'timezone: "Europe/Lisbon"');
    const aviso = avisoDeFuso(p.dir);
    assert.equal(aviso?.nivel, 'warn');
    assert.match(aviso?.detalhe ?? '', /entrevista informou UTC; manifesto declara Europe\/Lisbon/);
  } finally { p.limpar(); }
});

test('ensaio 050: fuso do owner ausente deixa o fuso legado valer como antes', () => {
  const p = projetoTemporario('ensaio-fuso-legado');
  try {
    gravarEtapa(p.dir, 'maestro', { nome: 'Equipe', fuso: 'America/Sao_Paulo' }, 'equipe');
    assert.match(avisoDeFuso(p.dir)?.detalhe ?? '',
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
    assert.match(r.stdout, /^Experiência: pacote pulado nesta instalação, veja o aviso abaixo \(orchestration-experience[a-z-]*\)\.$/m);
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

test('ensaio 050: quickstart traz modos vivos, commit, gitignore, worktree, claim focada e a ativacao do plugin', () => {
  const doc = QUICKSTART();
  const modos = [...doc.matchAll(/^\s*allowed_modes: \[([^\]]*)\]/gm)].map(m => m[1]);
  assert.ok(modos.length >= 1, 'trecho do manifesto com allowed_modes');
  for (const m of modos) assert.equal(m, ORDEM_DOS_MODOS.join(', '), 'o que o ork init grava, sem look nem ork');
  assert.match(doc, /Um repositório git com pelo menos um commit/);
  // Fatia 2 (P3): o `ork init` e a primeira worktree deixam o estado fora do git; o printf no
  // `.gitignore` do usuario saiu do quickstart.
  assert.ok(doc.includes('`.orkastery/.gitignore`') && doc.includes('git add orkastery.yaml AGENTS.md'), 'estado fora do git');
  assert.doesNotMatch(doc, />> \.gitignore/);
  // P4 (ork-p4worktreepo, D5): a worktree da primeira thread vem da chave worktree.por_thread que o `ork init`
  // grava; o comando dispensa o --worktree auto, e a saida explicita aparece no texto.
  assert.match(doc, /ork thread new "corrigir o filtro de data do relatorio" --modo classic\n/);
  assert.match(doc, /Com\s+`--sem-worktree`, a thread roda na raiz do projeto/);
  assert.match(doc, /ainda não passou do GO,\s+`ork worktree ensure <thread>`/);

  const claim = /ork claims add prd-corrigirofil[\s\S]*?--verificar "([^"]+)"/.exec(doc)?.[1];
  assert.ok(claim, 'claim de exemplo do passo 6');
  assert.deepEqual(analisarComando(claim), [], `a claim de exemplo nao pode cair no lint: ${claim}`);

  assert.ok(doc.includes('claude plugin marketplace add "$PWD/.claude/plugins/orkastery" --scope project'));
  assert.ok(doc.includes('claude plugin install orkastery@orkastery --scope project'));
  assert.ok(doc.includes('ork mcp install --project "$PWD" --host claude-code'));
  assert.doesNotMatch(doc, /--project \. /);
  for (const fase of ['goal', 'plan', 'go', 'check', 'ship', 'master']) assert.ok(doc.includes(`/orkastery:${fase}`), fase);
  assert.doesNotMatch(doc, /usa `\/goal`/);
});

test('ensaio 050: amostras do quickstart batem com a saida do ork do HEAD', () => {
  const doc = QUICKSTART();
  const dir = repoSemCommit('ensaio-amostras', 'main');
  const casa = dirTemporario('ensaio-amostras-casa');
  const semManifesto = repoSemCommit('ensaio-amostras-vazio', 'main');
  try {
    primeiroCommit(dir);
    primeiroCommit(semManifesto);
    assert.equal(ork(dir, casa, 'init', '--name', 'meu-produto', '--abbrev', 'prd').status, 0);

    const comando = 'ork thread new "corrigir o filtro de data do relatorio" --modo classic\n';
    const thread = ork(dir, casa, 'thread', 'new', 'corrigir o filtro de data do relatorio', '--modo', 'classic');
    assert.equal(thread.status, 0, thread.stderr);
    assert.equal(normalizar(thread.stdout, dir), normalizar(amostraDepoisDe(doc, comando)));

    const gate = ork(dir, casa, 'gate', 'next', 'prd-corrigirofil', '--proximo', 'GO');
    assert.equal(gate.status, 0, gate.stderr);
    assert.equal(normalizar(gate.stdout, dir), normalizar(amostraDepoisDe(doc, 'ork gate next prd-corrigirofil --proximo GO\n')));

    // O doctor depende da maquina (versoes, caminhos, runtimes): conferem os rotulos e o veredito.
    const nomes = new Set([...checar(semManifesto), ...checar(dir)].map(c => c.nome));
    const amostras = [...doc.matchAll(/```text\n(ork doctor: o que vale nesta maquina agora\n[\s\S]*?)\n```/g)].map(m => m[1]);
    assert.equal(amostras.length, 2, 'antes e depois do ork init');
    for (const a of amostras) {
      const rotulos = [...a.matchAll(/^  \[(?:ok|warn|FAIL)\]\s+(.+?)\s{2,}/gm)].map(m => m[1]);
      assert.ok(rotulos.length >= 5, a);
      for (const r of rotulos) assert.ok(nomes.has(r), `rotulo da amostra que o doctor nao emite: ${r}`);
      assert.match(a, /\nVeredito: (?:PRONTO|BLOQUEADO) \(\d+ (?:fail, \d+ )?warn\)\. /);
    }
  } finally { limpar(dir, casa, semManifesto); }
});

test('ensaio 050: mcp install com caminho relativo diz como acertar', () => {
  assert.throws(() => instalarMcp({ projeto: '.', host: 'claude-code' }),
    /mcp\.install\.project\.invalid: raiz absoluta obrigatoria; na raiz do projeto, use --project "\$PWD"/);
  for (const arquivo of ['marketplaces/fontes/claude-code/README.md', 'marketplaces/fontes/claude-code/README.pt-BR.md',
    'marketplaces/fontes/codex/README.md', 'marketplaces/fontes/codex/README.pt-BR.md', 'marketplaces/formularios.md']) {
    const texto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    assert.doesNotMatch(texto, /ork mcp install --project \. /, arquivo);
    assert.ok(texto.includes('ork mcp install --project "$PWD" --host'), arquivo);
  }
});

test('ensaio 050: contagens da doc batem com o catalogo e o pacote', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(RAIZ, 'adapters/claude-code/.claude-plugin/plugin.json'), 'utf8'));
  const skills = plugin.skills.length;
  const comandos = fs.readdirSync(path.join(RAIZ, 'adapters/claude-code/commands')).filter(f => f.endsWith('.md')).length;
  const readme = fs.readFileSync(path.join(RAIZ, 'adapters/claude-code/README.md'), 'utf8');
  assert.ok(readme.includes(`${skills + comandos} entradas: ${skills} skills e ${comandos} comandos`), 'README do adaptador');

  const extenso = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez'];
  const deps = Object.keys(JSON.parse(fs.readFileSync(path.join(RAIZ, 'core/package.json'), 'utf8')).dependencies ?? {}).length;
  assert.ok(QUICKSTART().includes(`com ${extenso[deps]} dependências de runtime`), `quickstart: ${deps} dependências`);
});
