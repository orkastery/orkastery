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
  process.stderr.write(`selecionar-testes-node: ${lane} ${plano.modo} (${plano.motivo}), ${plano.arquivos.length} arquivo(s)\n`);
  return rodarLane(lane, plano.arquivos);
}

module.exports = { principal };

if (require.main === module) {
  principal(process.argv.slice(2)).then((code) => { process.exitCode = code; },
    (e) => { process.stderr.write(`selecionar-testes-node: ${e.message}\n`); process.exitCode = 1; });
}
