#!/usr/bin/env node
/**
 * RM-038 (fatia de correcao): prova reexecutavel, so de leitura, de que o universo do indice e o
 * da busca na memoria real do tenant.
 *
 * Pelo dist/ deste checkout e pela DSN do manifesto do diretorio corrente, sem a chave de embedding
 * e sem gravar nada:
 *   universo  operacao universo da ponte: o que o `ork memory index` embeda e a busca ranqueia;
 *   tag       leitura por tag do tenant, colecao a colecao (o caminho de `ork memory search --tags`);
 *   fts       operacao fts da ponte para termos de sonda (o FTS da busca por significado).
 * Sai 0 com "invariantes ok" quando o universo e igual a leitura por tag em cada colecao e todo id
 * do FTS esta no universo; 1 quando algum invariante cai; 2 quando a memoria nao abre.
 *
 * Uso: node core/scripts/prova-universo-da-busca.cjs [termo ...]
 */
'use strict';

const path = require('node:path');

const dist = path.resolve(__dirname, '..', 'dist');
const { exigirManifesto } = require(path.join(dist, 'manifest.js'));
const { memoryState } = require(path.join(dist, 'project-state.js'));
const { abrirMemoria } = require(path.join(dist, 'memoria.js'));
const { COLECOES_DO_ORK, configDoManifesto, DriverCliOrkMind } = require(path.join(dist, 'orkmind.js'));
const { codigoDaFalha, textoForaDaBusca, universoDaBusca } = require(path.join(dist, 'indice-vetorial.js'));

// Termos que, na base medida pela RM-038, alcancavam pelo FTS entradas com injection_risk.
const SONDAS = ['thread', 'aberta', 'pitfall', 'handoff', 'orkastery', 'decisao', 'policy', 'regra'];

const curto = (ids) => ids.map((id) => id.slice(0, 8)).join(', ');

function main(argv) {
  const termos = argv.length ? argv : SONDAS;
  const carregado = memoryState(exigirManifesto(process.cwd())).loaded;
  const memoria = abrirMemoria(carregado);
  if (!memoria.ativo) {
    console.error(`prova do universo: regime ${memoria.regime} (${memoria.estado.motivo}); ${memoria.estado.correcao}`);
    return 2;
  }
  const tenant = memoria.estado.tenant;
  let universo;
  try {
    universo = universoDaBusca(memoria, tenant);
  } catch (erro) {
    console.error(`prova do universo: ${codigoDaFalha(erro)}; o universo da busca nao foi lido inteiro`);
    return 1;
  }
  console.log(`Prova do universo da busca (RM-038), tenant ${tenant}`);
  console.log('');
  console.log('  colecao     universo   tag');
  let falhas = 0;
  for (const colecao of COLECOES_DO_ORK) {
    const doUniverso = universo.entradas.filter((e) => e.collection === colecao).map((e) => e.id).sort();
    const porTag = memoria.buscar({ collection: colecao, tags: { project: [tenant] } }).map((e) => e.id).sort();
    const igual = doUniverso.length === porTag.length && doUniverso.every((id, i) => id === porTag[i]);
    console.log(`  ${colecao.padEnd(10)} ${String(doUniverso.length).padStart(9)} ${String(porTag.length).padStart(5)}${igual ? '' : '  DIFERENTE'}`);
    if (!igual) {
      falhas += 1;
      const so = (a, b) => a.filter((id) => !b.includes(id));
      console.log(`      so no universo: ${curto(so(doUniverso, porTag)) || '(nenhum)'}; so na tag: ${curto(so(porTag, doUniverso)) || '(nenhum)'}`);
    }
  }
  console.log(`  total      ${String(universo.entradas.length).padStart(9)}`);
  console.log(`  fora da busca: ${textoForaDaBusca(universo.foraDaBusca)}`);
  console.log('');
  const ids = new Set(universo.entradas.map((e) => e.id));
  const transporte = new DriverCliOrkMind(configDoManifesto(carregado.manifesto));
  let foraDoUniverso = 0;
  for (const termo of termos) {
    let achados;
    try {
      achados = transporte.buscarTexto(tenant, termo);
    } catch (erro) {
      console.log(`  fts '${termo}': ${codigoDaFalha(erro, 'memory.transport.fts')}`);
      falhas += 1;
      continue;
    }
    const fora = achados.filter((id) => !ids.has(id));
    foraDoUniverso += fora.length;
    console.log(`  fts '${termo}': ${achados.length} id(s), ${fora.length} fora do universo${fora.length ? ` (${curto(fora)})` : ''}`);
  }
  if (foraDoUniverso) falhas += 1;
  console.log('');
  if (falhas) {
    console.log(`resultado: ${falhas} invariante(s) quebrado(s); o universo do indice nao e o da busca`);
    return 1;
  }
  console.log(`invariantes ok: universo igual a leitura por tag em ${COLECOES_DO_ORK.length} colecao(oes); ` +
    `0 id(s) do FTS fora do universo em ${termos.length} sonda(s)`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
