#!/usr/bin/env node
/**
 * Monta (e desmonta) o catalogo do produto dentro de `core/` na hora de empacotar.
 *
 * O `ork` compilado e autocontido, mas `ork eval` e `ork hosts install` leem arquivos do
 * PRODUTO, nao codigo: `skills/`, `references/`, `eval/` e `adapters/`. Instalado global, o
 * `core/src/catalogo.ts` procura essa raiz subindo a partir do proprio `__dirname`, entao ela
 * precisa estar DENTRO do tarball, ao lado de `dist/`. Como o npm nao empacota nada acima do
 * diretorio do pacote, o `prepack` copia essas pastas para ca e o `postpack` as remove, para a
 * arvore de trabalho voltar exatamente ao que estava (elas continuam versionadas so na raiz).
 *
 *   node scripts/preparar-pacote.js            copia da raiz do repo para core/
 *   node scripts/preparar-pacote.js --limpar   remove as copias
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** As 3 marcas que `raizDoCatalogo()` exige, mais os adaptadores que `ork hosts install` le. */
const DIRETORIOS = ['skills', 'references', 'eval', 'adapters', 'monitor'];
const ARQUIVOS = ['LICENSE'];

const core = path.resolve(__dirname, '..');
const raiz = path.resolve(core, '..');

function limpar() {
  for (const alvo of [...DIRETORIOS, ...ARQUIVOS]) {
    const destino = path.join(core, alvo);
    if (fs.existsSync(destino)) {
      fs.rmSync(destino, { recursive: true, force: true });
      console.log(`removido core/${alvo}`);
    }
  }
}

function copiar() {
  limpar();
  for (const alvo of [...DIRETORIOS, ...ARQUIVOS]) {
    const origem = path.join(raiz, alvo);
    if (!fs.existsSync(origem)) {
      console.error(`preparar-pacote: ${alvo} nao existe em ${raiz}`);
      process.exit(1);
    }
    fs.cpSync(origem, path.join(core, alvo), { recursive: true });
    console.log(`copiado ${alvo} -> core/${alvo}`);
  }
}

if (process.argv.includes('--limpar')) limpar();
else copiar();
