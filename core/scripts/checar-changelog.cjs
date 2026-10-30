#!/usr/bin/env node
/** RM-037: adaptador CLI da regra compartilhada do CHANGELOG. */
'use strict';

const path = require('node:path');
const regra = require('../dist/changelog-check.js');

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
  const r = regra.checarChangelog(raiz, { base: opcoes.base || regra.basePadrao(raiz), head: opcoes.head });
  if (r.ok) {
    console.log(`CHANGELOG: OK. ${r.detalhe}`);
    for (const linha of r.linhas.slice(0, 5)) console.log(`  + ${linha}`);
    return 0;
  }
  console.log(`${r.motivo}: ${r.detalhe}`);
  console.log(`correcao: ${r.correcao}`);
  return r.motivo === 'changelog.base-indisponivel' ? 2 : 1;
}

module.exports = { ...regra, main };

if (require.main === module) process.exit(main());
