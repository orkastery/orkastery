#!/usr/bin/env node
/** RM-074 M10: comando `{arquivos}` da seleção F5 para a lane `node --test`. */
'use strict';

const path = require('node:path');
const { planejarSelecaoNode } = require('../dist/seletor-node-test.js');
const { listasDasLanes, rodarLane, LANES } = require('./test-lanes.cjs');

async function principal(args) {
  const [lane, ...alterados] = args;
  if (!LANES.includes(lane)) throw new Error(`uso: selecionar-testes-node.cjs ${LANES.join('|')} <arquivos mudados...>`);
  const listas = listasDasLanes();
  const plano = planejarSelecaoNode(path.resolve(__dirname, '../dist-test'), listas[lane], alterados);
  const sempre = plano.sempre ? new Set([...plano.sempre.processoFilho, ...plano.sempre.dependenciaIncerta]).size : 0;
  const detalhe = plano.sempre ? `; ${sempre} sempre (${plano.sempre.processoFilho.length} processo filho, `
    + `${plano.sempre.dependenciaIncerta.length} dependencia incerta)` : '';
  process.stderr.write(`selecionar-testes-node: ${lane} ${plano.modo} (${plano.motivo}), ${plano.arquivos.length} arquivo(s)${detalhe}\n`);
  return rodarLane(lane, plano.arquivos);
}

module.exports = { principal };

if (require.main === module) {
  principal(process.argv.slice(2)).then((code) => { process.exitCode = code; },
    (e) => { process.stderr.write(`selecionar-testes-node: ${e.message}\n`); process.exitCode = 1; });
}
