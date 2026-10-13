#!/usr/bin/env node
// core/scripts/forja-contrato.cjs
/**
 * Spec do suporte a GitLab, fatia 0: grava as respostas reais de uma forja para o contrato gravado dos testes.
 * Usa a CLI ja logada (`gh`, `glab`): nenhum token e lido, passado ou gravado. O corpo passa pelo redator antes
 * do disco. So consulta: nenhum caso escreve na forja.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PADROES = [
  /\b(?:glpat|gldt|glrt|glptt|glcbt|gloas|glft)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g,
];
const redigir = (t) => PADROES.reduce((s, p) => s.replace(p, (m, g1) => (typeof g1 === 'string' && g1.startsWith('http') ? `${g1}[redigido]@` : '[redigido]')), t);

function opcoes(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
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
  };
  if (o.pr) casos['mr'] = ['api', ...h, `projects/${id}/merge_requests/${o.pr}`];
  if (o.branch) casos['mr-list'] = ['api', ...h, `projects/${id}/merge_requests?source_branch=${encodeURIComponent(o.branch)}&state=all&per_page=100`];
  return { cli: 'glab', casos };
}

function principal() {
  const o = opcoes(process.argv.slice(2));
  const plano = o.forja === 'github' ? casosDoGithub(o) : o.forja === 'gitlab' ? casosDoGitlab(o) : null;
  if (!plano || !o.host || !o.repo || !/^[0-9a-f]{40}$/.test(o.sha ?? '') || !o.saida) {
    process.stderr.write('uso: forja-contrato.cjs --forja github|gitlab --host H --repo CAMINHO --sha SHA [--pr N] [--branch B] --saida DIR\n');
    return 2;
  }
  fs.mkdirSync(o.saida, { recursive: true });
  let falhas = 0;
  for (const [caso, args] of Object.entries(plano.casos)) {
    const r = spawnSync(plano.cli, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GLAB_CHECK_UPDATE: 'false', NO_COLOR: '1' } });
    let corpo = null, erro = null;
    if (r.status === 0) {
      try { corpo = JSON.parse(redigir(r.stdout)); } catch { erro = 'resposta nao e JSON'; }
    } else erro = redigir((r.stderr || r.stdout || String(r.error ?? '')).trim()).slice(0, 400);
    if (erro) falhas++;
    const arquivo = path.join(o.saida, `${caso}.json`);
    fs.writeFileSync(arquivo, JSON.stringify({ caso, forja: o.forja, host: o.host, comando: [plano.cli, ...args],
      status: r.status, corpo, ...(erro ? { erro } : {}) }, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(arquivo, 0o600);
  }
  return falhas ? 1 : 0;
}

process.exitCode = principal();
