#!/usr/bin/env node
/**
 * RM-037 (fatia 3, defeito 2): a linha no CHANGELOG que o PR deve, conferida no CI.
 *
 * A RM-049 (#26) e o KG2 (#32) entraram na `main` mudando o produto sem linha no CHANGELOG, e o CI
 * passou: a regra so existia no modelo do PR e no guia. Agora o job `documentacao`, check obrigatorio
 * da `main`, roda este checador contra a base do PR.
 *
 * A regra: o PR que muda `core/`, `adapters/` ou `marketplaces/` acrescenta ao menos uma linha de
 * texto na secao `## Não publicado`, ou abre a secao de uma versao nova (o PR de versao leva as
 * linhas para ela). Ficam de fora, e o guia de pull request documenta, o PR so de testes (pasta
 * `test`, `tests` ou `__tests__`, ou arquivo `*.test.*` e `*.spec.*`) e o PR so de CI (`.github/`,
 * `.ork-ci/`, o executor `core/scripts/test-ci.js` e os checadores `core/scripts/checar-*.cjs`,
 * que nao entram no pacote).
 *
 *   node core/scripts/checar-changelog.cjs [--base REF] [--head REF] [raiz]
 *
 * A base padrao e `origin/$GITHUB_BASE_REF` (o PR no CI), depois `origin/main`, depois `main`. No push
 * da `main` a base e o proprio HEAD, e nao ha nada a conferir. Sai 0 quando passa, 1 com
 * `changelog.linha-ausente` ou `changelog.secao-ausente` e 2 com `changelog.base-indisponivel`.
 */
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHANGELOG = 'CHANGELOG.md';
const SECAO = '## Não publicado';
const PASTAS_DE_PRODUTO = ['core/', 'adapters/', 'marketplaces/'];
const DE_CI = [/^\.github\//, /^\.ork-ci\//, /^core\/scripts\/test-ci\.js$/, /^core\/scripts\/checar-[a-z0-9-]+\.cjs$/];
const CORRECAO = 'acrescente em "## Não publicado" do CHANGELOG.md uma linha que diga o que muda para quem usa ' +
  '(PR só de testes ou só de CI fica de fora: docs/guias/contribuir/pull-request.md)';

function git(raiz, args) {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, saida: (r.stdout || '').trim() };
}

/** Arquivo de teste: pasta `test`, `tests` ou `__tests__` no caminho, ou nome `*.test.*`/`*.spec.*`. */
function ehTeste(arquivo) {
  const partes = arquivo.split('/');
  return partes.slice(0, -1).some((p) => p === 'test' || p === 'tests' || p === '__tests__')
    || /\.(test|spec)\.[A-Za-z0-9]+$/.test(partes[partes.length - 1]);
}

/** Arquivo que o PR muda e pede linha: dentro das pastas do produto, fora de teste e de CI. */
function pedeLinha(arquivo) {
  return PASTAS_DE_PRODUTO.some((p) => arquivo.startsWith(p)) && !ehTeste(arquivo) && !DE_CI.some((re) => re.test(arquivo));
}

/** As linhas de texto da secao `## Não publicado` (sem titulo e sem linha em branco); `null` sem a secao. */
function linhasDaSecao(texto) {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  const inicio = linhas.findIndex((l) => l.trim() === SECAO);
  if (inicio < 0) return null;
  const corpo = [];
  for (const linha of linhas.slice(inicio + 1)) {
    if (/^## /.test(linha)) break;
    if (linha.trim() && !/^#/.test(linha.trim())) corpo.push(linha.trimEnd());
  }
  return corpo;
}

/** As versoes do CHANGELOG (`## [0.5.0] - ...`). */
function versoes(texto) {
  return new Set([...texto.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]));
}

/** O CHANGELOG numa revisao; `''` quando ele nao existe nela. */
function changelogEm(raiz, ref) {
  const r = git(raiz, ['show', `${ref}:${CHANGELOG}`]);
  return r.ok ? r.saida : '';
}

/**
 * Confere o PR de `base` (o merge-base com o head) ate `head`. Devolve o veredito com o motivo
 * tipado, a correcao e o que sustentou a decisao (arquivos que pedem linha, linhas novas, versao nova).
 */
function checarChangelog(raiz, opcoes = {}) {
  const head = opcoes.head || 'HEAD';
  const base = opcoes.base;
  const indisponivel = (detalhe) => ({ ok: false, motivo: 'changelog.base-indisponivel', detalhe,
    correcao: 'rode com o histórico completo do git (fetch-depth: 0 no CI) ou passe --base <ref>', arquivos: [], linhas: [] });
  if (!base) return indisponivel('nenhuma base para comparar');
  const pontaDaBase = git(raiz, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (!pontaDaBase.ok) return indisponivel(`a base ${base} não existe neste repositório`);
  if (!git(raiz, ['rev-parse', '--verify', '--quiet', `${head}^{commit}`]).ok) return indisponivel(`o head ${head} não existe neste repositório`);
  const mb = git(raiz, ['merge-base', base, head]);
  if (!mb.ok || !mb.saida) return indisponivel(`${base} e ${head} não têm ancestral comum`);

  const mudados = git(raiz, ['diff', '--name-only', '--no-renames', mb.saida, head]);
  const arquivos = (mudados.ok ? mudados.saida.split('\n') : []).filter(Boolean);
  const pedem = arquivos.filter(pedeLinha);
  if (pedem.length === 0) {
    return { ok: true, motivo: null, arquivos: [], linhas: [],
      detalhe: arquivos.length === 0 ? `nada a conferir: ${head} não muda nada desde ${base}`
        : 'nada pede linha: o PR não muda core/, adapters/ nem marketplaces/ fora de teste e de CI' };
  }

  const antes = changelogEm(raiz, mb.saida), depois = changelogEm(raiz, head);
  const secao = linhasDaSecao(depois);
  if (secao === null) {
    return { ok: false, motivo: 'changelog.secao-ausente', arquivos: pedem, linhas: [],
      detalhe: `o ${CHANGELOG} de ${head} não tem a seção "${SECAO}"`,
      correcao: `abra a seção "${SECAO}" no alto do ${CHANGELOG} e acrescente a linha da mudança` };
  }
  const versaoNova = [...versoes(depois)].filter((v) => !versoes(antes).has(v));
  if (versaoNova.length > 0) {
    return { ok: true, motivo: null, arquivos: pedem, linhas: [],
      detalhe: `versão nova no ${CHANGELOG}: ${versaoNova.join(', ')} (o PR de versão leva as linhas para ela)` };
  }
  // Multiconjunto: uma linha repetida que ja existia na base nao conta como nova.
  const naBase = new Map();
  for (const l of linhasDaSecao(antes) || []) naBase.set(l, (naBase.get(l) || 0) + 1);
  const novas = [];
  for (const l of secao) {
    const n = naBase.get(l) || 0;
    if (n > 0) naBase.set(l, n - 1); else novas.push(l);
  }
  if (novas.length > 0) {
    return { ok: true, motivo: null, arquivos: pedem, linhas: novas,
      detalhe: `${novas.length} linha(s) nova(s) em "${SECAO}"` };
  }
  return { ok: false, motivo: 'changelog.linha-ausente', arquivos: pedem, linhas: [],
    detalhe: `o PR muda ${pedem.length} arquivo(s) de core/, adapters/ ou marketplaces/ (${pedem.slice(0, 3).join(', ')}` +
      `${pedem.length > 3 ? ', ...' : ''}) e não acrescenta linha em "${SECAO}" do ${CHANGELOG}`,
    correcao: CORRECAO };
}

/** A base padrao do CI: a branch alvo do PR; fora dele, a `main` do remoto, depois a local. */
function basePadrao(raiz, env = process.env) {
  if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`;
  for (const ref of ['origin/main', 'main']) {
    if (git(raiz, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
  }
  return null;
}

function main(argv = process.argv.slice(2)) {
  const opcoes = {};
  let raiz = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base' || a === '--head') {
      const valor = argv[++i];
      if (!valor || valor.startsWith('--')) {
        console.error('uso: node core/scripts/checar-changelog.cjs [--base REF] [--head REF] [raiz]');
        return 2;
      }
      opcoes[a.slice(2)] = valor;
    } else if (!a.startsWith('--') && raiz === null) raiz = a;
    else {
      console.error('uso: node core/scripts/checar-changelog.cjs [--base REF] [--head REF] [raiz]');
      return 2;
    }
  }
  raiz = path.resolve(raiz || path.join(__dirname, '..', '..'));
  const r = checarChangelog(raiz, { base: opcoes.base || basePadrao(raiz), head: opcoes.head });
  if (r.ok) {
    console.log(`CHANGELOG: OK. ${r.detalhe}`);
    for (const l of r.linhas.slice(0, 5)) console.log(`  + ${l}`);
    return 0;
  }
  console.log(`${r.motivo}: ${r.detalhe}`);
  console.log(`correcao: ${r.correcao}`);
  return r.motivo === 'changelog.base-indisponivel' ? 2 : 1;
}

module.exports = { checarChangelog, basePadrao, ehTeste, pedeLinha, linhasDaSecao };

if (require.main === module) process.exit(main());
