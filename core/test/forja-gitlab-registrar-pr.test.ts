import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EstadoCi, ResultadoCi } from '../src/ci';
import { ExecutorGitHub, registrarEntregaExternaPorPr } from '../src/entrega-pr';
import type { OpcoesDaApi } from '../src/forja/api';
import type { ForjaResolvida } from '../src/forja/contrato';
import type { ChamadaDaCli } from '../src/forja/executor';
import { lerLedger } from '../src/ledger';
import { carregarManifesto } from '../src/manifest';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { projetoTemporario } from './apoio';
import { cliFalsa, gravado, http, login, ok } from './forja-cli-falsa';
import { caminhoDe, GITLAB } from './forja-gitlab-falso';

const VERSOES = ['19.4', '19.3', '19.2', '18.11', '17.0', '16.11'];
const SITE = 'grupo/sub/site', P = 'projects/grupo%2Fsub%2Fsite';
const URL_DO_MR = 'https://gitlab.empresa.com/grupo/sub/site/-/merge_requests/7';
const PONTA = (gravado('gitlab/19.4/branch') as { commit: { id: string } }).commit.id;
type Mr = { sha: string; merge_commit_sha: string | null; squash_commit_sha: string | null };
const SEM_GH: ExecutorGitHub = (c) => { throw new Error(`rodou o gh: ${c}`); };

function projeto(nome: string) {
  const p = projetoTemporario(nome);
  p.carregado.manifesto.ci.required_for_ship = true;
  p.carregado.manifesto.ci.external_repositories = { [SITE]: 'ork-verify' };
  const t = novaThread(p.carregado, { nome: 'sites', modo: 'auto' }).thread;
  return { p, t, dir: dirThread(p.dir, t.id) };
}

/** O MR 7 do site, do MR gravado da versão, com o título que cita a thread. */
const mrDa = (v: string, thread: string, extra: Record<string, unknown> = {}) =>
  ({ ...(gravado(`gitlab/${v}/mr`) as Record<string, unknown>), iid: 7, title: `ship(${thread}): sites`, web_url: URL_DO_MR, ...extra });

/**
 * O GitLab do site: o MR, o projeto, a ponta da main e a comparação da ponta com o merge. O `compare-dentro` foi gravado
 * para outro sha de merge (o do MR !1 da matriz); aqui ele serve como a forma de uma resposta `ahead` não trivial.
 */
function gitlabDoSite(mr: Record<string, unknown>, comparacao: unknown = gravado('gitlab/19.4/compare-dentro')) {
  const m = mr as unknown as Mr;
  const merge = m.merge_commit_sha ?? m.squash_commit_sha ?? m.sha;
  const respostas: Record<string, unknown> = {
    [`${P}/merge_requests/7`]: mr, [P]: gravado('gitlab/19.4/projeto'), [`${P}/repository/branches/main`]: gravado('gitlab/19.4/branch'),
    [`${P}/repository/compare?from=${PONTA}&to=${merge}&straight=false`]: comparacao,
  };
  const cli = cliFalsa([{ quando: login, responde: ok('') },
    ...Object.entries(respostas).map(([k, corpo]) => ({ quando: (c: ChamadaDaCli) => c.args[0] === 'api' && caminhoDe(c) === k, responde: http(200, corpo) })),
    { quando: (c: ChamadaDaCli) => c.args[0] === 'api', responde: http(404, { message: '404 Not Found' }) }]);
  const api: OpcoesDaApi = { rodar: cli.rodar, logins: new Map() };
  return { api, cli, merge };
}

function ciFalsa(estado: EstadoCi = 'success') {
  const chamadas: Array<{ repo: string; host: string; sha: string; contexto: string }> = [];
  const ciDaForja = (f: ForjaResolvida, sha: string, contexto: string): ResultadoCi => {
    chamadas.push({ repo: f.repo, host: f.host, sha, contexto });
    return { schema: 'ork.ci-status/v2', required: true, ok: estado === 'success', provider: 'gitlab', fonte: 'pipeline-job', produtor: 'gitlab-ci',
      repository: f.repo, sha, context: contexto,
      state: estado, url: null, detail: `ork-verify ${estado}` };
  };
  return { ciDaForja, chamadas };
}

test('MR mesclado de cada versão, num projeto GitLab com subgrupo: registraria, com a CI do head no mesmo GitLab', () => {
  const { p, t } = projeto('gitlab-externo-versoes');
  try {
    for (const v of VERSOES) {
      const mr = mrDa(v, t.id);
      const gl = gitlabDoSite(mr);
      const ci = ciFalsa();
      const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, forja: GITLAB, api: gl.api, ciDaForja: ci.ciDaForja,
        executorGitHub: SEM_GH, dryRun: true, publicar: false });
      assert.equal(r.acao, 'registraria', `${v}: ${r.motivo}`);
      assert.equal(r.mergeSha, (mr as unknown as Mr).merge_commit_sha, v);
      assert.equal(r.headSha, (mr as unknown as Mr).sha, v);
      assert.deepEqual(ci.chamadas, [{ repo: SITE, host: 'gitlab.empresa.com', sha: (mr as unknown as Mr).sha, contexto: 'ork-verify' }], v);
    }
  } finally { p.limpar(); }
});

test('registra: ship_done com o MR, a ponta e a prova pela comparação do GitLab; não registra duas vezes', () => {
  const { p, t, dir } = projeto('gitlab-externo-registra');
  try {
    const mr = mrDa('19.4', t.id);
    const gl = gitlabDoSite(mr);
    const opcoes = { repositorio: SITE, pr: 7, forja: GITLAB, api: gl.api, ciDaForja: ciFalsa().ciDaForja, executorGitHub: SEM_GH, publicar: false };
    const r = registrarEntregaExternaPorPr(p.carregado, t.id, opcoes);
    assert.equal(r.acao, 'registrou', r.motivo);
    const e = lerLedger(dir).find((x) => x.tipo === 'ship_done')!;
    assert.deepEqual([e.repositorio, e.pr, e.mergeSha, e.shaDe, e.shaRemoto, e.pontaDaBase, e.remoto, e.tipoDeAutorizacao, e.para, e.url],
      [SITE, 7, gl.merge, (mr as unknown as Mr).sha, PONTA, PONTA, `gitlab:${SITE}`, 'pr-externo', `${SITE}:main`, URL_DO_MR]);
    assert.match(String(e.fonteDaProva), new RegExp(`^glab api ${P}/repository/compare\\?from=${PONTA}&to=${gl.merge}&straight=false \\(status ahead`));
    assert.equal(registrarEntregaExternaPorPr(p.carregado, t.id, opcoes).acao, 'ja-registrada');
  } finally { p.limpar(); }
});

test('ff sem commit de merge e ff com squash: a entrega vem pela API do MR, provada pela comparação', () => {
  const { p, t } = projeto('gitlab-externo-ff');
  try {
    for (const caso of ['mr-ff', 'mr-squash']) {
      const gravada = gravado(`gitlab/19.4/${caso}`) as Mr;
      const gl = gitlabDoSite(mrDa('19.4', t.id, { ...gravada, iid: 7, title: `ship(${t.id}): sites`, web_url: URL_DO_MR }));
      const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, forja: GITLAB, api: gl.api, ciDaForja: ciFalsa().ciDaForja,
        executorGitHub: SEM_GH, dryRun: true, publicar: false });
      assert.equal(r.acao, 'registraria', `${caso}: ${r.motivo}`);
      assert.equal(r.mergeSha, gravada.squash_commit_sha ?? gravada.sha, caso);
      assert.equal(r.headSha, gravada.sha, caso);
    }
  } finally { p.limpar(); }
});

test('recusas no GitLab: MR aberto, MR que não se lê, CI vermelha, merge fora da ponta e forja declarada que não se resolve', () => {
  const { p, t, dir } = projeto('gitlab-externo-recusas');
  try {
    const com = (mr: Record<string, unknown>, extra: Record<string, unknown> = {}, comparacao?: unknown) => registrarEntregaExternaPorPr(p.carregado, t.id,
      { repositorio: SITE, pr: 7, forja: GITLAB, api: gitlabDoSite(mr, comparacao).api, ciDaForja: ciFalsa().ciDaForja, executorGitHub: SEM_GH,
        publicar: false, ...extra });
    assert.equal(com(mrDa('19.4', t.id, { state: 'opened', merge_commit_sha: null })).acao, 'sem-merge');
    assert.equal(com(mrDa('19.4', t.id, { state: 'closed', merge_commit_sha: null })).acao, 'sem-merge');
    const naoLe = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, forja: GITLAB,
      api: { rodar: cliFalsa([{ quando: login, responde: ok('') }, { quando: () => true, responde: http(404, { message: '404' }) }]).rodar, logins: new Map() },
      executorGitHub: SEM_GH, publicar: false });
    assert.equal(naoLe.acao, 'recusada');
    assert.match(naoLe.motivo, /a consulta do PR #7 de grupo\/sub\/site ao GitLab falhou/);
    const vermelha = com(mrDa('19.4', t.id), { ciDaForja: ciFalsa('failure').ciDaForja });
    assert.equal(vermelha.acao, 'recusada');
    assert.equal(vermelha.ci?.state, 'failure');
    const fora = com(mrDa('19.4', t.id), {}, gravado('gitlab/19.4/compare-fora'));
    assert.equal(fora.acao, 'recusada');
    assert.match(fora.motivo, /nao esta na ponta de grupo\/sub\/site:main/);
    p.carregado.manifesto.forja = { tipo: 'gitlab' };
    const semForja = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, executorGitHub: SEM_GH, publicar: false,
      sondas: { github: () => 'sem-login', gitlab: () => 'sem-login' } });
    assert.equal(semForja.acao, 'recusada');
    assert.equal(semForja.codigo, 'entrega.sem-leitura');
    assert.match(semForja.motivo, /a forja de grupo\/sub\/site não foi resolvida/);
    assert.equal(lerLedger(dir).filter((x) => x.tipo === 'ship_done').length, 0);
  } finally { p.limpar(); }
});

test('projeto do GitHub: o subgrupo declarado é recusado sem consultar o gh; o manifesto aceita subgrupos e recusa o resto', () => {
  const { p, t } = projeto('gitlab-externo-github');
  try {
    const consultas: string[] = [];
    const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, publicar: false,
      executorGitHub: (c) => { consultas.push(c); return { ok: false, stdout: '', stderr: 'x', code: 1 }; } });
    assert.equal(r.acao, 'recusada');
    assert.match(r.motivo, /tem subgrupos/);
    assert.equal(r.codigo, 'entrega.forja-mista');
    assert.deepEqual(consultas, []);

    const arquivo = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(arquivo, 'utf8');
    const comBloco = (bloco: string) => original.replace(/^ci:\n/m, `ci:\n${bloco}`);
    fs.writeFileSync(arquivo, comBloco('  external_repositories:\n    grupo/sub/site: ork-verify\n    dono/nome: ""\n'));
    const lido = carregarManifesto(p.dir)!;
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.manifesto.ci.external_repositories, { 'grupo/sub/site': 'ork-verify', 'dono/nome': '' });
    fs.writeFileSync(arquivo, comBloco('  external_repositories:\n    so-o-nome: ""\n    grupo/../fora: ""\n'));
    const erros = carregarManifesto(p.dir)!.erros.join('\n');
    assert.match(erros, /"so-o-nome" nao e dono\/nome do GitHub nem grupo\/subgrupo\/projeto do GitLab/);
    assert.match(erros, /"grupo\/\.\.\/fora" nao e dono\/nome/);
  } finally { p.limpar(); }
});

test('a CI padrão é a do GitLab da forja, pela mesma API injetada: sem metadados lidos, a entrega é recusada, nunca verde', () => {
  const { p, t } = projeto('gitlab-externo-ci-padrao');
  try {
    const gl = gitlabDoSite(mrDa('19.4', t.id));
    const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, forja: GITLAB, api: gl.api, executorGitHub: SEM_GH,
      dryRun: true, publicar: false });
    assert.equal(r.acao, 'recusada', r.motivo);
    assert.equal(r.ci?.state, 'unavailable');
    assert.ok(gl.cli.chamadas.some((c) => c.args[0] === 'api' && caminhoDe(c) === 'metadata'));
  } finally { p.limpar(); }
});

test('a forja do externo vem do --remoto do projeto: o gitlab.com com subgrupo, sem sondar, no mesmo host', () => {
  const { p, t } = projeto('gitlab-externo-remoto');
  try {
    exec('git', ['remote', 'add', 'gl', 'https://gitlab.com/grupo/sub/app.git'], p.dir);
    const gl = gitlabDoSite(mrDa('19.4', t.id));
    const ci = ciFalsa();
    const nunca = { github: () => { throw new Error('sondou o github'); }, gitlab: () => { throw new Error('sondou o gitlab'); } };
    const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, remoto: 'gl', sondas: nunca, api: gl.api,
      ciDaForja: ci.ciDaForja, executorGitHub: SEM_GH, dryRun: true, publicar: false });
    assert.equal(r.acao, 'registraria', r.motivo);
    assert.deepEqual(ci.chamadas.map((c) => [c.repo, c.host]), [[SITE, 'gitlab.com']]);
    const apis = gl.cli.chamadas.filter((c) => c.args[0] === 'api');
    assert.ok(apis.length > 0 && apis.every((c) => c.acrescentar?.GITLAB_HOST === 'gitlab.com'));
  } finally { p.limpar(); }
});

test('recusas no GitLab: MR mesclado em outra base e MR que não cita a thread', () => {
  const { p, t, dir } = projeto('gitlab-externo-base-vinculo');
  try {
    const com = (mr: Record<string, unknown>) => registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, forja: GITLAB,
      api: gitlabDoSite(mr).api, ciDaForja: ciFalsa().ciDaForja, executorGitHub: SEM_GH, publicar: false });
    const outraBase = com(mrDa('19.4', t.id, { target_branch: 'dev' }));
    assert.equal(outraBase.acao, 'recusada');
    assert.match(outraBase.motivo, /o PR #7 entrou em dev, e a branch padrao de grupo\/sub\/site e main/);
    const semVinculo = com(mrDa('19.4', t.id, { title: 'feat: outra coisa', description: null, source_branch: 'ork/outra-coisa' }));
    assert.equal(semVinculo.acao, 'recusada');
    assert.match(semVinculo.motivo, new RegExp(`nao cita a thread ${t.id}`));
    assert.equal(lerLedger(dir).filter((x) => x.tipo === 'ship_done').length, 0);
  } finally { p.limpar(); }
});

test('merge igual à ponta: identical sem consultar a comparação, e a prova diz de onde veio a ponta', () => {
  const { p, t, dir } = projeto('gitlab-externo-identical');
  try {
    const gl = gitlabDoSite(mrDa('19.4', t.id, { merge_commit_sha: PONTA }));
    const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: SITE, pr: 7, forja: GITLAB, api: gl.api, ciDaForja: ciFalsa().ciDaForja,
      executorGitHub: SEM_GH, publicar: false });
    assert.equal(r.acao, 'registrou', r.motivo);
    assert.equal(gl.cli.chamadas.filter((c) => c.args[0] === 'api' && caminhoDe(c).includes('/repository/compare')).length, 0);
    const e = lerLedger(dir).find((x) => x.tipo === 'ship_done')!;
    assert.equal(e.fonteDaProva, `merge = ponta de main por glab api ${P}/repository/branches/main`);
  } finally { p.limpar(); }
});

test('sem host de reserva: o remoto de forja que não se resolve recusa sem ir ao github.com; sem remoto e GitHub resolvido seguem no github.com', () => {
  const { p, t } = projeto('gitlab-externo-sem-reserva');
  try {
    const REPO = 'dono/site';
    p.carregado.manifesto.ci.external_repositories = { [REPO]: '' };
    const consultas: string[] = [];
    const gh: ExecutorGitHub = (c) => { consultas.push(c); return { ok: false, stdout: '', stderr: 'x', code: 1 }; };
    const semLogin = { github: () => 'sem-login' as const, gitlab: () => 'sem-login' as const };
    const nunca = { github: () => { throw new Error('sondou o github'); }, gitlab: () => { throw new Error('sondou o gitlab'); } };
    const com = (remoto: string, sondas: typeof semLogin | typeof nunca) =>
      registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: REPO, pr: 7, remoto, sondas, executorGitHub: gh, publicar: false });

    // (a) Um GitLab proprio sem `forja:` e sem login na CLI: nem o gh nem o glab sao chamados.
    exec('git', ['remote', 'add', 'proprio', 'https://git.empresa.interna/dono/site.git'], p.dir);
    const proprio = com('proprio', semLogin);
    assert.equal(proprio.acao, 'recusada');
    assert.equal(proprio.codigo, 'entrega.sem-leitura');
    assert.match(proprio.motivo, /a forja do remoto proprio não foi resolvida .*declare forja\.tipo no orkastery\.yaml ou faça login na CLI da forja nesse host/);
    assert.deepEqual(consultas, []);

    // (b) Sem remoto: o github.com, como sempre.
    const semRemoto = com('origin', nunca);
    assert.equal(semRemoto.acao, 'recusada');
    assert.match(semRemoto.motivo, /a consulta do PR #7 de dono\/site ao GitHub falhou/);
    assert.deepEqual(consultas, [`repos/${REPO}/pulls/7`]);

    // (c) O GitHub resolvido pelo host conhecido, sem sondar: o github.com.
    consultas.length = 0;
    exec('git', ['remote', 'add', 'gh', 'https://github.com/dono/app.git'], p.dir);
    const github = com('gh', nunca);
    assert.match(github.motivo, /ao GitHub falhou/);
    assert.deepEqual(consultas, [`repos/${REPO}/pulls/7`]);
  } finally { p.limpar(); }
});
