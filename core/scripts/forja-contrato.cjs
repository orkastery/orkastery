#!/usr/bin/env node
// core/scripts/forja-contrato.cjs
/**
 * Grava as respostas reais de uma forja para o contrato gravado dos testes.
 * Usa a CLI ja logada (`gh`, `glab`): nenhum token e lido, passado ou gravado. O registro inteiro passa pelo
 * redator antes do disco (o corpo e lido como JSON e redigido valor a valor). So consulta: nenhum caso escreve
 * na forja.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PADROES = [
  // GitLab: o token pode ter ponto (formato roteavel: glpat-xxxx.01.yyyy); nada de \b no fim, que cortaria o ponto.
  /\b(?:glpat|gldt|glrt|glptt|glcbt|gloas|glft|glimt|glsoat)-[A-Za-z0-9_.-]{16,}/g,
  // Token de registro de runner (legado, prefixo fixo GR1348941) e de runner novo (glrt-).
  /\bGR1348941[A-Za-z0-9_-]{20,}/g,
  /\bglrt-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Credencial embutida em URL. As classes excluem aspas e barra invertida: nunca atravessa o limite de uma string JSON.
  /(https?:\/\/)[^\s/@:"\\,]+:[^\s/@"\\,]+@/g,
];

/** Redige um texto livre (stderr, mensagem de erro). */
function redigirTexto(t) {
  return PADROES.reduce((s, p) => s.replace(p, (m, g1) => (typeof g1 === 'string' && g1.startsWith('http') ? `${g1}[redigido]@` : '[redigido]')), t);
}

/** Redige um valor JSON: strings (e chaves) um a um, recursivamente. Numeros, booleanos e null passam. */
function redigirValor(v) {
  if (typeof v === 'string') return redigirTexto(v);
  if (Array.isArray(v)) return v.map(redigirValor);
  if (v && typeof v === 'object') {
    const out = {};
    // Chave que termina em `token` (runners_token, access_token, token): o texto inteiro some, qualquer que seja o formato.
    for (const [k, x] of Object.entries(v)) out[redigirTexto(k)] = (/(^|_)token$/i.test(k) && typeof x === 'string') ? '[redigido]' : redigirValor(x);
    return out;
  }
  return v;
}

// Cabecalhos cujo valor some por inteiro, qualquer que seja o formato.
const CABECALHOS_SECRETOS = new Set(['authorization', 'proxy-authorization', 'private-token', 'job-token', 'deploy-token', 'set-cookie', 'cookie']);

/**
 * Separa a saida de `api -i` em { status_http, cabecalhos, corpo }. Os nomes viram minusculos; repetidos juntam com ", ".
 * Os secretos somem e os demais valores passam pelo redator de texto. Devolve null se a saida nao comeca com `HTTP/`.
 */
function separarCabecalhos(saida) {
  const m = /^HTTP\/\S+\s+(\d{3})[^\r\n]*\r?\n/.exec(saida);
  if (!m) return null;
  const resto = saida.slice(m[0].length);
  const fim = /\r?\n\r?\n/.exec(resto);
  const bloco = fim ? resto.slice(0, fim.index) : resto;
  const corpo = fim ? resto.slice(fim.index + fim[0].length) : '';
  const cabecalhos = {};
  for (const linha of bloco.split(/\r?\n/)) {
    const i = linha.indexOf(':');
    if (i <= 0) continue;
    const nome = linha.slice(0, i).trim().toLowerCase();
    const valor = CABECALHOS_SECRETOS.has(nome) ? '[redigido]' : redigirTexto(linha.slice(i + 1).trim());
    cabecalhos[nome] = nome in cabecalhos ? `${cabecalhos[nome]}, ${valor}` : valor;
  }
  return { status_http: Number(m[1]), cabecalhos, corpo };
}

function opcoes(argv) {
  const o = {};
  // `--incluir-cabecalhos` e a unica opcao sem valor.
  const resto = argv.filter((a) => a !== '--incluir-cabecalhos');
  o['incluir-cabecalhos'] = resto.length !== argv.length;
  for (let i = 0; i < resto.length; i += 2) o[resto[i].replace(/^--/, '')] = resto[i + 1];
  return o;
}

function casosDoGithub(o) {
  const r = o.repo, s = o.sha, h = ['--hostname', o.host];
  const casos = {
    'check-runs': ['api', ...h, `repos/${r}/commits/${s}/check-runs?per_page=100`],
    'statuses': ['api', ...h, `repos/${r}/commits/${s}/statuses?per_page=100`],
    'repositorio': ['api', ...h, `repos/${r}`],
  };
  if (o.pr) casos['pr'] = ['api', ...h, `repos/${r}/pulls/${o.pr}`];
  if (o.branch) {
    casos['branch'] = ['api', ...h, `repos/${r}/branches/${encodeURIComponent(o.branch)}`];
    casos['pr-list'] = ['pr', 'list', `--repo=${o.host}/${r}`, `--head=${o.branch}`, '--state=all', '--limit=10',
      '--json=number,state,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,url,createdAt,mergedAt,mergeable'];
  }
  return { cli: 'gh', casos };
}

function casosDoGitlab(o) {
  const id = encodeURIComponent(o.repo), s = o.sha, h = ['--hostname', o.host];
  const casos = {
    'metadata': ['api', ...h, 'metadata'],
    'projeto': ['api', ...h, `projects/${id}`],
    'statuses': ['api', ...h, `projects/${id}/repository/commits/${s}/statuses?all=true&per_page=100`],
    'token': ['api', ...h, 'personal_access_tokens/self'],
    // A CI do commit: o commit com os pais (o vinculo do resultado mesclado) e os MRs que o contem.
    'commit': ['api', ...h, `projects/${id}/repository/commits/${s}`],
    'commit-mrs': ['api', ...h, `projects/${id}/repository/commits/${s}/merge_requests?per_page=100`],
  };
  if (o.contexto) {
    casos['statuses-do-check'] = ['api', ...h, `projects/${id}/repository/commits/${s}/statuses?name=${encodeURIComponent(o.contexto)}&all=true&per_page=100`];
  }
  for (const p of (o.pipeline ?? '').split(',').filter(Boolean)) {
    casos[`pipeline-${p}-jobs`] = ['api', ...h, `projects/${id}/pipelines/${p}/jobs?include_retried=true&per_page=100`];
  }
  if (o.pr) {
    casos['mr'] = ['api', ...h, `projects/${id}/merge_requests/${o.pr}`];
    casos['mr-pipelines'] = ['api', ...h, `projects/${id}/merge_requests/${o.pr}/pipelines?per_page=100`];
  }
  if (o['commit-mesclado']) casos['commit-mesclado'] = ['api', ...h, `projects/${id}/repository/commits/${o['commit-mesclado']}`];
  if (o.branch) casos['mr-list'] = ['api', ...h, `projects/${id}/merge_requests?source_branch=${encodeURIComponent(o.branch)}&state=all&per_page=100`];
  return { cli: 'glab', casos };
}

function principal() {
  const o = opcoes(process.argv.slice(2));
  const plano = o.forja === 'github' ? casosDoGithub(o) : o.forja === 'gitlab' ? casosDoGitlab(o) : null;
  const pipelinesOk = o.pipeline === undefined || /^\d+(?:,\d+)*$/.test(o.pipeline);
  const mescladoOk = o['commit-mesclado'] === undefined || /^[0-9a-f]{40}$/.test(o['commit-mesclado']);
  if (!plano || !o.host || !o.repo || !/^[0-9a-f]{40}$/.test(o.sha ?? '') || !o.saida || !pipelinesOk || !mescladoOk) {
    process.stderr.write('uso: forja-contrato.cjs --forja github|gitlab --host H --repo CAMINHO --sha SHA [--pr N] [--branch B] ' +
      '[--contexto C] [--pipeline ID[,ID...]] [--commit-mesclado SHA] [--incluir-cabecalhos] --saida DIR\n');
    return 2;
  }
  fs.mkdirSync(o.saida, { recursive: true });
  let falhas = 0;
  for (const [caso, args0] of Object.entries(plano.casos)) {
    // `-i` so existe no `api`: o `pr list` devolve so o JSON.
    const comCab = o['incluir-cabecalhos'] && args0[0] === 'api';
    const args = comCab ? ['api', '-i', ...args0.slice(1)] : args0;
    const r = spawnSync(plano.cli, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GLAB_CHECK_UPDATE: 'false', NO_COLOR: '1' } });
    let corpo = null, erro = null, http = null;
    const bruto = comCab ? separarCabecalhos(r.stdout ?? '') : null;
    if (comCab && bruto) http = { status_http: bruto.status_http, cabecalhos: bruto.cabecalhos };
    const texto = bruto ? bruto.corpo : r.stdout;
    if (r.status === 0 && !(comCab && !bruto)) {
      try { corpo = redigirValor(JSON.parse(texto)); } catch { erro = 'resposta nao e JSON'; }
    } else if (bruto) {
      // Erro HTTP: a CLI sai com erro, mas os cabecalhos e o corpo do erro sao o que o contrato quer guardar.
      try { corpo = redigirValor(JSON.parse(texto)); } catch { corpo = null; }
      erro = `HTTP ${bruto.status_http}`;
    } else {
      erro = redigirTexto((r.stderr || r.stdout || String(r.error ?? '')).trim()).slice(0, 400);
    }
    if (erro) falhas++;
    // O registro inteiro (comando e host incluidos) passa pelo redator antes do disco.
    const registro = redigirValor({ caso, forja: o.forja, host: o.host, comando: [plano.cli, ...args],
      status: r.status, ...(http ?? {}), corpo, ...(erro ? { erro } : {}) });
    const arquivo = path.join(o.saida, `${caso}.json`);
    fs.writeFileSync(arquivo, JSON.stringify(registro, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(arquivo, 0o600);
  }
  return falhas ? 1 : 0;
}

process.exitCode = principal();
