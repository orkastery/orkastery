/**
 * RM-037 (fatia 3, defeito 2): a RM-049 (#26) e o KG2 (#32) entraram na `main` mudando o produto sem
 * linha no CHANGELOG, e o CI passou: a regra so existia no modelo do PR. O job `documentacao`, check
 * obrigatorio da `main`, passa a rodar `core/scripts/checar-changelog.cjs` contra a base do PR.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { exec } from '../src/util';

const raizDoRepo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(raizDoRepo, 'core/scripts/checar-changelog.cjs');
const { checarChangelog } = require(SCRIPT) as {
  checarChangelog: (raiz: string, opcoes: { base?: string; head?: string }) =>
    { ok: boolean; motivo: string | null; detalhe: string; correcao?: string; arquivos: string[]; linhas: string[] };
};

const CHANGELOG_DA_BASE = `# Changelog

## Não publicado

- **Coisa antiga** já registrada.

## [0.5.0] - 2026-09-30

### Adicionado

- a versão anterior.
`;

function git(dir: string, ...args: string[]): string {
  const r = exec('git', args, dir);
  assert.equal(r.ok, true, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Repositorio com a `main` (CHANGELOG e um arquivo de produto) e a branch do PR saindo dela. */
function repositorio(nome: string): { dir: string; mudar: (arquivo: string, conteudo: string) => void; limpar: () => void } {
  const dir = dirTemporario(nome);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'teste@orkastery.local');
  git(dir, 'config', 'user.name', 'Teste Orkastery');
  git(dir, 'config', 'commit.gpgsign', 'false');
  const escrever = (arquivo: string, conteudo: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, arquivo)), { recursive: true });
    fs.writeFileSync(path.join(dir, arquivo), conteudo);
  };
  escrever('CHANGELOG.md', CHANGELOG_DA_BASE);
  escrever('core/src/modulo.ts', 'export const x = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'ork/ork-pr-full');
  return {
    dir,
    mudar: (arquivo, conteudo) => { escrever(arquivo, conteudo); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', `muda ${arquivo}`); },
    limpar: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const checar = (dir: string) => checarChangelog(dir, { base: 'main', head: 'HEAD' });

test('defeito 2: PR que muda core/ sem linha em "Não publicado" reprova com changelog.linha-ausente', () => {
  const r = repositorio('rm037-f3-changelog-sem-linha');
  try {
    r.mudar('core/src/modulo.ts', 'export const x = 2;\n');
    r.mudar('adapters/claude-code/agents/ork-go.md', '# agente\n');
    const v = checar(r.dir);
    assert.equal(v.ok, false);
    assert.equal(v.motivo, 'changelog.linha-ausente');
    assert.deepEqual(v.arquivos, ['adapters/claude-code/agents/ork-go.md', 'core/src/modulo.ts']);
    assert.match(String(v.correcao), /acrescente em "## Não publicado" do CHANGELOG\.md/);
    // Linha nova fora de "Não publicado" (na versão já publicada) não vale.
    r.mudar('CHANGELOG.md', CHANGELOG_DA_BASE.replace('- a versão anterior.', '- a versão anterior.\n- linha no lugar errado.'));
    assert.equal(checar(r.dir).motivo, 'changelog.linha-ausente');
    // Só um título novo, sem texto, também não.
    r.mudar('CHANGELOG.md', CHANGELOG_DA_BASE.replace('## Não publicado\n', '## Não publicado\n\n### Corrigido\n'));
    assert.equal(checar(r.dir).motivo, 'changelog.linha-ausente');
  } finally { r.limpar(); }
});

test('defeito 2: com a linha nova em "Não publicado", ou com a seção de uma versão nova, passa', () => {
  const r = repositorio('rm037-f3-changelog-com-linha');
  try {
    r.mudar('marketplaces/claude-code/orkastery/plugin.json', '{}\n');
    r.mudar('CHANGELOG.md', CHANGELOG_DA_BASE.replace('- **Coisa antiga** já registrada.',
      '- **Coisa antiga** já registrada.\n- **Plugin nos marketplaces**: o plugin do Claude Code e do Codex.'));
    const v = checar(r.dir);
    assert.equal(v.ok, true, v.detalhe);
    assert.deepEqual(v.linhas, ['- **Plugin nos marketplaces**: o plugin do Claude Code e do Codex.']);
  } finally { r.limpar(); }
  const versao = repositorio('rm037-f3-changelog-versao');
  try {
    // O PR de versão leva as linhas de "Não publicado" para a versão nova e deixa a seção vazia.
    versao.mudar('core/package.json', '{"version":"0.6.0"}\n');
    versao.mudar('CHANGELOG.md', CHANGELOG_DA_BASE.replace('## Não publicado\n\n- **Coisa antiga** já registrada.\n',
      '## Não publicado\n\n## [0.6.0] - 2026-10-01\n\n- **Coisa antiga** já registrada.\n'));
    const v = checar(versao.dir);
    assert.equal(v.ok, true, v.detalhe);
    assert.match(v.detalhe, /versão nova no CHANGELOG\.md: 0\.6\.0/);
  } finally { versao.limpar(); }
});

test('defeito 2 (GO-FIX 2): o PR de versão passa nos dois formatos, também quando "Não publicado" vira a versão', () => {
  // Como manda o guia: a seção "Não publicado" vira a da versão, sem colchetes, como as versões até a 0.4.3.
  const renomeia = repositorio('rm037-f3-changelog-renomeia');
  try {
    renomeia.mudar('core/package.json', '{"version":"0.6.0"}\n');
    renomeia.mudar('CHANGELOG.md', CHANGELOG_DA_BASE.replace('## Não publicado', '## 0.6.0 - 01/10/2026'));
    const v = checar(renomeia.dir);
    assert.equal(v.ok, true, v.detalhe);
    assert.match(v.detalhe, /versão nova no CHANGELOG\.md: 0\.6\.0/);
  } finally { renomeia.limpar(); }
  // Com colchetes e sem a seção "Não publicado" no head.
  const colchetes = repositorio('rm037-f3-changelog-colchetes');
  try {
    colchetes.mudar('core/package.json', '{"version":"0.6.0"}\n');
    colchetes.mudar('CHANGELOG.md', CHANGELOG_DA_BASE.replace('## Não publicado', '## [0.6.0] - 2026-10-01'));
    assert.equal(checar(colchetes.dir).ok, true);
  } finally { colchetes.limpar(); }
});

test('defeito 2: a exceção documentada, PR só de testes ou só de CI, não pede linha', () => {
  const r = repositorio('rm037-f3-changelog-excecao');
  try {
    r.mudar('core/test/modulo.test.ts', '// teste\n');
    r.mudar('core/test/fixtures/amostra.json', '{}\n');
    r.mudar('adapters/hermes/test/hitl_test.py', '# teste\n');
    r.mudar('core/tsconfig.test.json', '{}\n');
    r.mudar('.github/workflows/ci.yml', 'name: CI\n');
    r.mudar('.ork-ci/ork-pr.json', '{}\n');
    r.mudar('core/scripts/test-ci.js', '// executor do CI\n');
    r.mudar('core/scripts/checar-links.cjs', '// checador do CI\n');
    r.mudar('docs/guias/um-guia.md', '# guia\n');
    const v = checar(r.dir);
    assert.equal(v.ok, true, v.detalhe);
    assert.match(v.detalhe, /nada pede linha/);
    // Um arquivo do pacote no meio deles volta a pedir a linha.
    r.mudar('core/scripts/preparar-pacote.js', '// entra no npm pack\n');
    assert.deepEqual(checar(r.dir).arquivos, ['core/scripts/preparar-pacote.js']);
  } finally { r.limpar(); }
});

test('defeito 2 (GO-FIX 1): arquivo com acento em core/ pede a linha como qualquer outro', () => {
  const r = repositorio('rm037-f3-changelog-acento');
  try {
    r.mudar('core/src/configuração.ts', 'export const y = 1;\n');
    const v = checar(r.dir);
    assert.equal(v.motivo, 'changelog.linha-ausente', v.detalhe);
    assert.deepEqual(v.arquivos, ['core/src/configuração.ts']);
  } finally { r.limpar(); }
});

test('defeito 2: sem a seção, sem base ou sem nada mudado, o checador diz por quê', () => {
  const r = repositorio('rm037-f3-changelog-bordas');
  try {
    assert.match(checar(r.dir).detalhe, /nada a conferir/);
    r.mudar('core/src/modulo.ts', 'export const x = 3;\n');
    r.mudar('CHANGELOG.md', '# Changelog\n\n## [0.5.0] - 2026-09-30\n');
    assert.equal(checar(r.dir).motivo, 'changelog.secao-ausente');
    assert.equal(checarChangelog(r.dir, { base: 'origin/nao-existe' }).motivo, 'changelog.base-indisponivel');
  } finally { r.limpar(); }
});

test('defeito 2: o CLI sai 1 com o motivo tipado e a correção, e 0 quando passa', () => {
  const r = repositorio('rm037-f3-changelog-cli');
  try {
    r.mudar('core/src/modulo.ts', 'export const x = 4;\n');
    let saida = spawnSync(process.execPath, [SCRIPT, '--base', 'main', r.dir], { encoding: 'utf8' });
    assert.equal(saida.status, 1, saida.stdout + saida.stderr);
    assert.match(saida.stdout, /^changelog\.linha-ausente: o PR muda 1 arquivo\(s\)/m);
    assert.match(saida.stdout, /^correcao: acrescente em "## Não publicado"/m);
    r.mudar('CHANGELOG.md', CHANGELOG_DA_BASE.replace('## Não publicado\n', '## Não publicado\n\n- **Módulo**: x vale 4.\n'));
    saida = spawnSync(process.execPath, [SCRIPT, '--base', 'main', r.dir], { encoding: 'utf8' });
    assert.equal(saida.status, 0, saida.stdout + saida.stderr);
    assert.equal(spawnSync(process.execPath, [SCRIPT, '--base', 'origin/nao-existe', r.dir], { encoding: 'utf8' }).status, 2);
  } finally { r.limpar(); }
});

test('defeito 2: o job documentacao do CI, check obrigatório da main, roda o checador contra a base do PR', () => {
  const ci = fs.readFileSync(path.join(raizDoRepo, '.github/workflows/ci.yml'), 'utf8');
  const job = ci.slice(ci.indexOf('\n  documentacao:'), ci.indexOf('\n  nucleo:'));
  assert.ok(job.length > 0, 'o job documentacao existe');
  assert.match(job, /run: node core\/scripts\/checar-changelog\.cjs --base "origin\/\$\{GITHUB_BASE_REF:-main\}"/);
  assert.match(job, /fetch-depth: 0/, 'o checador precisa do historico para o merge-base');
});
