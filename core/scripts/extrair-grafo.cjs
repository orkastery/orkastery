#!/usr/bin/env node
/**
 * RM-031 KG2, comando PROVISORIO de desenvolvimento: extrai o grafo `ork.code-artifact-graph/v1`
 * do repositorio Git local e prova a extracao. Indice e CLI de consulta sao do KG3, que substitui
 * este script. Fica fora do pacote publicado (core/scripts nao entra em `files`).
 *
 *   node core/scripts/extrair-grafo.cjs [--raiz DIR] [--repositorio ID] [--tenant T] [--acl REF]...
 *        [--saida ARQ] [--relatorio ARQ] [--verificar] [--amostra [N]] [--conferir-amostra ARQ]
 *
 * Sem opcao de modo, imprime o resumo. `--verificar` confere o contrato, os bytes de cada fonte e
 * a mesma extracao com a ordem de leitura invertida e embaralhada. `--amostra` escolhe N arestas
 * por estrato (tipo e metodo), por passo fixo sobre os `edge_id` ordenados, para auditoria manual.
 * `--conferir-amostra` confere uma amostra auditada contra a extracao atual.
 *
 * Requer `npm --prefix core run build` (usa core/dist) e o `typescript` instalado no core.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ts = require('typescript');
const { extrairGrafo } = require('../dist/intelligence-graph-extract.js');
const { lerRepositorio } = require('../dist/intelligence-graph-repo.js');
const { canonico, conferirFontes, sha256DoCanonico } = require('../dist/intelligence-graph-contract.js');
const { carregarMarkdown } = require('./micromark-adaptador.cjs');
const { criarJuizDeSintaxe } = require('./sintaxe-node.cjs');

const AMOSTRA_SCHEMA = 'ork.graph-edge-audit-sample/v0';

function argumentos(argv) {
  const r = { raiz: process.cwd(), acl: [], amostra: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], valor = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} exige valor`);
      return argv[++i];
    };
    if (a === '--raiz') r.raiz = valor();
    else if (a === '--repositorio') r.repositorio = valor();
    else if (a === '--tenant') r.tenant = valor();
    else if (a === '--acl') r.acl.push(valor());
    else if (a === '--saida') r.saida = valor();
    else if (a === '--relatorio') r.relatorio = valor();
    else if (a === '--verificar') r.verificar = true;
    else if (a === '--amostra') r.amostra = /^[0-9]+$/.test(argv[i + 1] ?? '') ? Number(argv[++i]) : 3;
    else if (a === '--conferir-amostra') r.conferir = valor();
    else throw new Error(`opcao desconhecida: ${a}`);
  }
  return r;
}

const escrever = (linha) => process.stdout.write(`${linha}\n`);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function utf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Embaralhamento reproduzivel (LCG): a permutacao da verificacao nao depende de acaso. */
function embaralhar(itens, semente) {
  const r = [...itens];
  let s = semente >>> 0;
  for (let i = r.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

let parser = null;

function extrair(entrada) {
  const inicio = process.hrtime.bigint();
  const r = extrairGrafo(entrada, parser);
  return { ...r, ms: Number((process.hrtime.bigint() - inicio) / 1000000n) };
}

const localizador = (n) => ({ kind: n.kind, path: n.locator.path, fragment: n.locator.fragment });
const rotulo = (l) => `${l.kind}:${l.path}${l.fragment === null ? '' : `#${l.fragment}`}`;
const chaveDaAresta = (kind, de, para) => `${kind} ${rotulo(de)} -> ${rotulo(para)}`;

function indexar(grafo) {
  const nos = new Map(grafo.nodes.map((n) => [n.node_id, localizador(n)]));
  return new Map(grafo.edges.map((a) => [chaveDaAresta(a.kind, nos.get(a.from), nos.get(a.to)), { aresta: a, de: nos.get(a.from), para: nos.get(a.to) }]));
}

function trecho(bytesDe, e) {
  return Buffer.from(bytesDe.get(e.path)).subarray(e.span.byte_start, e.span.byte_end);
}

function resumo(entrada, r) {
  const c = r.relatorio.contagens;
  escrever(`grafo ${r.grafo.schema}`);
  escrever(`  repositorio ${r.grafo.repository_id}, tenant ${r.grafo.tenant_id}`);
  escrever(`  revisao     ${r.grafo.snapshot.revision ?? `indisponivel (${r.grafo.snapshot.revision_unavailable_reason})`}`);
  escrever(`  snapshot    ${r.grafo.snapshot.snapshot_id}`);
  escrever(`  digest      ${r.digest}`);
  escrever(`  fontes      ${c.fontes} (fora: ${r.relatorio.excluidas.length})`);
  escrever(`  nos         ${Object.entries(c.nos).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  escrever(`  arestas     ${Object.entries(c.arestas).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  escrever(`  evidencias  ${c.evidencias} (excedentes fora: ${r.relatorio.evidencias_excedentes})`);
  escrever(`  diagnostico ${Object.entries(c.diagnosticos).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  escrever(`  lacunas     ${Object.entries(r.relatorio.lacunas_por_categoria).map(([k, v]) => `${k}=${v}`).join(' ') || 'nenhuma'}`);
  escrever(`  extracao    ${r.ms} ms`);
}

function verificar(entrada, r) {
  const falhas = [];
  const bytesDe = new Map(entrada.fontes.map((f) => [f.path, f.bytes]));
  const fornecidas = new Map(r.grafo.snapshot.source_manifest.map((m) => {
    const b = bytesDe.get(m.path);
    return [m.path, { tipo: utf8(b) ? 'texto' : 'binario', bytes: b }];
  }));
  const conferencia = conferirFontes(r.grafo, fornecidas);
  escrever(`contrato: validarGrafo ok; conferirFontes ${conferencia.estado}, ${conferencia.fontesVerificadas.length} fontes e ${conferencia.evidenciasVerificadas} evidencias conferidas contra os bytes`);
  if (conferencia.estado !== 'verificada' || conferencia.evidenciasIndisponiveis > 0) falhas.push('conferirFontes nao verificou tudo');
  const digestDoRelatorio = sha256DoCanonico(r.relatorio);
  for (const [nome, fontes] of [['ordem invertida', [...entrada.fontes].reverse()], ['ordem embaralhada', embaralhar(entrada.fontes, 2026)]]) {
    const outra = extrair({ ...entrada, fontes });
    const igual = outra.digest === r.digest && sha256DoCanonico(outra.relatorio) === digestDoRelatorio;
    escrever(`determinismo: ${nome}: digest ${outra.digest.slice(0, 16)}, relatorio ${sha256DoCanonico(outra.relatorio).slice(0, 16)}, ${igual ? 'igual' : 'DIFERENTE'} (${outra.ms} ms)`);
    if (!igual) falhas.push(`${nome} mudou o grafo ou o relatorio`);
  }
  return falhas;
}

/** D12: estrato por tipo de aresta e metodos; passo fixo sobre os `edge_id` ordenados. */
function amostrar(entrada, r, n) {
  const bytesDe = new Map(entrada.fontes.map((f) => [f.path, f.bytes]));
  const nos = new Map(r.grafo.nodes.map((x) => [x.node_id, localizador(x)]));
  const estratos = new Map();
  for (const a of r.grafo.edges) {
    const chave = `${a.kind}/${[...new Set(a.evidence.map((e) => e.extraction_method))].sort().join('+')}`;
    if (!estratos.has(chave)) estratos.set(chave, []);
    estratos.get(chave).push(a);
  }
  const arestas = [], universo = {};
  for (const chave of [...estratos.keys()].sort()) {
    const lista = estratos.get(chave).sort((x, y) => (x.edge_id < y.edge_id ? -1 : 1));
    universo[chave] = lista.length;
    const k = Math.min(n, lista.length);
    for (let i = 0; i < k; i++) {
      const a = lista[Math.floor((i * lista.length) / k)];
      const e = [...a.evidence].sort((x, y) => (x.path === y.path ? x.span.byte_start - y.span.byte_start : x.path < y.path ? -1 : 1))[0];
      const t = trecho(bytesDe, e);
      arestas.push({
        estrato: chave, kind: a.kind, from: nos.get(a.from), to: nos.get(a.to),
        evidencia: {
          path: e.path, extractor_id: e.extractor_id, extraction_method: e.extraction_method, line_start: e.span.line_start, line_end: e.span.line_end,
          trecho_sha256: sha256(t), trecho_inicio: t.toString('utf8').split('\n')[0].slice(0, 200),
        },
        veredito: null, nota: null,
      });
    }
  }
  return {
    schema: AMOSTRA_SCHEMA, graph_schema: r.grafo.schema, repository_id: r.grafo.repository_id,
    revision: r.grafo.snapshot.revision, revision_unavailable_reason: r.grafo.snapshot.revision_unavailable_reason,
    snapshot_id: r.grafo.snapshot.snapshot_id, graph_digest: r.digest, por_estrato: n, universo, arestas,
  };
}

function conferirAmostra(entrada, r, arquivo) {
  const amostra = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (amostra.schema !== AMOSTRA_SCHEMA) return [`schema da amostra: ${amostra.schema}`];
  const falhas = [], indice = indexar(r.grafo), bytesDe = new Map(entrada.fontes.map((f) => [f.path, f.bytes]));
  const estratos = new Set(), vereditos = {};
  for (const item of amostra.arestas) {
    const chave = chaveDaAresta(item.kind, item.from, item.to);
    vereditos[item.veredito] = (vereditos[item.veredito] ?? 0) + 1;
    estratos.add(item.estrato);
    if (item.veredito !== 'supported' || typeof item.nota !== 'string' || !item.nota.trim()) {
      falhas.push(`${chave}: veredito ${item.veredito ?? 'ausente'}${item.nota ? '' : ', sem nota'}`);
      continue;
    }
    const achada = indice.get(chave);
    if (!achada) {
      falhas.push(`${chave}: aresta ausente na extracao atual`);
      continue;
    }
    const ev = item.evidencia;
    const bate = achada.aresta.evidence.some((e) => e.path === ev.path && e.extractor_id === ev.extractor_id
      && e.extraction_method === ev.extraction_method && sha256(trecho(bytesDe, e)) === ev.trecho_sha256);
    if (!bate) falhas.push(`${chave}: nenhuma evidencia com o trecho auditado`);
  }
  escrever(`amostra: ${amostra.arestas.length} arestas em ${estratos.size} estratos, auditada na revisao ${amostra.revision ?? amostra.revision_unavailable_reason}`);
  escrever(`  vereditos ${Object.entries(vereditos).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  escrever(`  conferidas contra a extracao atual: ${amostra.arestas.length - falhas.length} de ${amostra.arestas.length}`);
  return falhas;
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  parser = { ts, unicode: process.versions.unicode, markdown: await carregarMarkdown(), javascript: criarJuizDeSintaxe() };
  const opcoes = {};
  if (a.repositorio) opcoes.repository_id = a.repositorio;
  if (a.tenant) opcoes.tenant_id = a.tenant;
  if (a.acl.length) opcoes.acl_refs = a.acl;
  const entrada = lerRepositorio(path.resolve(a.raiz), opcoes);
  const r = extrair(entrada);
  if (a.saida) fs.writeFileSync(a.saida, canonico(r.grafo));
  if (a.relatorio) fs.writeFileSync(a.relatorio, `${JSON.stringify(r.relatorio, null, 2)}\n`);
  if (a.amostra !== null) {
    escrever(JSON.stringify(amostrar(entrada, r, a.amostra), null, 2));
    return 0;
  }
  resumo(entrada, r);
  const falhas = [...(a.verificar ? verificar(entrada, r) : []), ...(a.conferir ? conferirAmostra(entrada, r, a.conferir) : [])];
  for (const f of falhas) escrever(`FALHA ${f}`);
  if (a.verificar || a.conferir) escrever(falhas.length ? `reprovado: ${falhas.length} falha(s)` : 'aprovado');
  return falhas.length ? 1 : 0;
}

principal().then((codigo) => {
  process.exitCode = codigo;
}, (e) => {
  process.stderr.write(`extrair-grafo: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
});
