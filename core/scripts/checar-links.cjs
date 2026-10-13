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
/**
 * RM-061 (F3b): a variante inglesa de um arquivo do catalogo mora em `core/assets/*-en/`, mas e instalada no lugar do
 * original e tem os mesmos alvos de link (o teste `locale-skills` confere): o link dela vale a partir do original.
 */
const VARIANTES = [['core/assets/skills-en/', 'skills/'], ['core/assets/references-en/', 'references/'],
  ['core/assets/adapters-en/', 'adapters/']];
const lugarDoLink = (rel) => {
  for (const [de, para] of VARIANTES) if (rel.startsWith(de)) return para + rel.slice(de.length);
  return rel;
};

for (const rel of arquivos) {
  const absoluto = path.join(raiz, rel);
  if (!fs.existsSync(absoluto)) continue;
  const texto = fs.readFileSync(absoluto, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, alvo] of texto.matchAll(LINK)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(alvo) || alvo.startsWith('#') || alvo.startsWith('/')) continue;
    const caminho = decodeURIComponent(alvo.split('#')[0]);
    if (!caminho) continue;
    if (!fs.existsSync(path.resolve(path.dirname(path.join(raiz, lugarDoLink(rel))), caminho))) quebrados.push(`${rel}: ${alvo}`);
  }
}

for (const q of quebrados) console.log(q);
console.log(`${arquivos.length} arquivos Markdown, ${quebrados.length} link(s) quebrado(s)`);
process.exit(quebrados.length ? 1 : 0);
