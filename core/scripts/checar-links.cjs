#!/usr/bin/env node
/**
 * Confere todo link relativo dos arquivos Markdown versionados: o alvo precisa existir.
 *
 * Roda no job `documentacao` do CI. Link externo, ancora da propria pagina e caminho absoluto
 * ficam de fora; bloco de codigo tambem, porque exemplo nao e link. Sai != 0 com a lista.
 *   node core/scripts/checar-links.cjs [raiz]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const raiz = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '..'));
const arquivos = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'],
  { cwd: raiz, encoding: 'utf8' }).split('\n').filter(Boolean);
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const quebrados = [];

for (const rel of arquivos) {
  const absoluto = path.join(raiz, rel);
  if (!fs.existsSync(absoluto)) continue;
  const texto = fs.readFileSync(absoluto, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, alvo] of texto.matchAll(LINK)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(alvo) || alvo.startsWith('#') || alvo.startsWith('/')) continue;
    const caminho = decodeURIComponent(alvo.split('#')[0]);
    if (!caminho) continue;
    if (!fs.existsSync(path.resolve(path.dirname(absoluto), caminho))) quebrados.push(`${rel}: ${alvo}`);
  }
}

for (const q of quebrados) console.log(q);
console.log(`${arquivos.length} arquivos Markdown, ${quebrados.length} link(s) quebrado(s)`);
process.exit(quebrados.length ? 1 : 0);
