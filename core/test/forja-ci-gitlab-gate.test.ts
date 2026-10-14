import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { consultarCi } from '../src/ci';
import type { SondasDaForja } from '../src/forja/resolver';
import { carregarManifesto, exigirManifesto } from '../src/manifest';
import { exec } from '../src/util';
import { projetoTemporario } from './apoio';
import { api, apiEm, cliFalsa, falhou, gravado, http, login, ok, type Regra } from './forja-cli-falsa';

/** O head e a base do MR gravado com runner em 19.4-ci; as respostas sinteticas do resultado mesclado usam os mesmos. */
const HEAD = '12edddda9ac424f9355c39785b873803a062d59d';
const BASE = '291615e904fc9e96598992e28d1c92a2f2c34dfa';
const PROJETO = 'projects/root%2Fmatriz';
const NUNCA: SondasDaForja = { github: () => { throw new Error('sondou o github'); }, gitlab: () => { throw new Error('sondou o gitlab'); } };
type Item = Record<string, unknown>;
const comRunner = (caso: string) => gravado(`gitlab/19.4-ci/${caso}`) as Item[];
const sintetico = (caso: string) => gravado(`gitlab/sintetico/${caso}`);
const statuses = apiEm('/statuses?');

function consultar(regras: Regra[], o: { produtor?: string; remoto?: string } = {}) {
  const p = projetoTemporario('ci-gitlab-gate', false);
  try {
    const arquivo = path.join(p.dir, 'orkastery.yaml');
    let texto = fs.readFileSync(arquivo, 'utf8').replace('required_for_ship: false', 'required_for_ship: true');
    if (o.produtor) texto = texto.replace('  context: ork-verify\n', `  context: ork-verify\n  produtor: ${o.produtor}\n`);
    fs.writeFileSync(arquivo, `${texto}\nforja:\n  tipo: gitlab\n`);
    const carregado = exigirManifesto(p.dir);
    exec('git', ['remote', 'add', 'origin', o.remoto ?? 'https://gitlab.empresa.com/root/matriz.git'], p.dir);
    const cli = cliFalsa(regras);
    const gh: string[] = [];
    const r = consultarCi(carregado, HEAD, 'origin', (e) => { gh.push(e.caminho ?? ''); return { ok: false, code: 1, stdout: '', stderr: 'gh' }; },
      () => { throw new Error('perguntou o login do gh'); }, NUNCA, { rodar: cli.rodar, logins: new Map() });
    // O caminho e o ultimo argumento do `glab api -i --method GET <caminho>`.
    const caminhos = cli.chamadas.filter((c) => c.args[0] === 'api').map((c) => c.args[c.args.length - 1]);
    return { r, gh, caminhos, chamadas: cli.chamadas };
  } finally { p.limpar(); }
}

const ce = (versao: string, corpo: unknown = gravado(`gitlab/${versao}/statuses`)): Regra[] => [
  { quando: login, responde: ok('') },
  { quando: api('metadata'), responde: http(200, gravado(`gitlab/${versao}/metadata`)) },
  { quando: statuses, responde: http(200, corpo) },
];
/** As gravacoes com runner: o job real 2 na pipeline 1 do MR e o `POST /statuses` 4 (de `root`) na pipeline external 2. */
const comJobs = (corpo: unknown, jobs1: unknown = comRunner('pipeline-1-jobs')): Regra[] => [...ce('19.4-ci', corpo),
  { quando: apiEm('/pipelines/1/jobs?'), responde: http(200, jobs1) },
  { quando: apiEm('/pipelines/2/jobs?'), responde: http(200, comRunner('pipeline-2-jobs')) }];

for (const versao of ['17.0', '18.11', '19.2', '19.3', '19.4']) {
  test(`GitLab CE ${versao} gravado: sem job no commit, missing, sem o gh e sem procurar resultado mesclado`, () => {
    const { r, gh, caminhos } = consultar(ce(versao));
    assert.deepEqual([r.schema, r.provider, r.repository, r.state, r.ok], ['ork.ci-status/v2', 'gitlab', 'root/matriz', 'missing', false]);
    assert.equal(r.detail, 'check ork-verify não encontrado no commit');
    assert.deepEqual(gh, []);
    assert.ok(!caminhos.some((c) => c.includes('merge_requests') || c === PROJETO), caminhos.join('\n'));
  });
}

test('GitLab CE 16.11 gravado: recusa abaixo do piso antes de ler a CI', () => {
  const { r, caminhos } = consultar(ce('16.11'));
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /forja\.versao-abaixo-do-piso/);
  assert.deepEqual(caminhos, ['metadata']);
});

test('job real verde do gitlab-ci aprova; o verde do status externo não entra', () => {
  const { r } = consultar(comJobs(comRunner('statuses-do-check')));
  assert.deepEqual([r.state, r.ok, r.fonte, r.produtor, r.url], ['success', true, 'pipeline-job', 'gitlab-ci', 'http://127.0.0.1/root/matriz/-/jobs/2']);
  assert.equal(r.detail, 'CHECK independente verde no GitLab');
});

test('só o status externo (POST /statuses): não aprova; com status:<login> em ci.produtor, aprova', () => {
  const externo = comRunner('statuses-do-check').filter((s) => s.id === 4);
  const sem = consultar(comJobs(externo));
  assert.equal(sem.r.state, 'missing');
  assert.match(sem.r.detail, /commit status/);
  const com = consultar(comJobs(externo), { produtor: '[gitlab-ci, "status:root"]' });
  assert.deepEqual([com.r.state, com.r.fonte, com.r.produtor], ['success', 'commit-status', 'root']);
});

test('status externo vermelho reprova mesmo com o job real verde', () => {
  const corpo = comRunner('statuses-do-check').map((s) => (s.id === 4 ? { ...s, status: 'failed' } : s));
  const { r } = consultar(comJobs(corpo));
  assert.deepEqual([r.state, r.fonte, r.produtor], ['failure', 'commit-status', 'root']);
});

test('job manual no head: bloqueado, nunca verde, com o estado no detalhe', () => {
  const manual = <T extends Item>(x: T) => ({ ...x, status: 'manual', finished_at: null });
  const corpo = comRunner('statuses-do-check').filter((s) => s.id === 2).map(manual);
  const jobs = comRunner('pipeline-1-jobs').map((j) => (j.id === 2 ? manual(j) : j));
  const { r } = consultar(comJobs(corpo, jobs));
  assert.equal(r.state, 'failure');
  assert.equal(r.detail, 'check ork-verify: bloqueado (manual)');
});

test('sem login do glab no host: indisponível com forja.sem-login, e nenhuma chamada da API', () => {
  const { r, chamadas } = consultar([{ quando: login, responde: falhou('glab: not logged in') }]);
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /forja\.sem-login/);
  assert.deepEqual(chamadas.map((c) => c.args[0]), ['auth']);
});

test('metadados ilegíveis ou leitura da CI com erro: indisponível, nunca verde', () => {
  const semVersao = consultar([{ quando: login, responde: ok('') }, { quando: api('metadata'), responde: http(200, { enterprise: false }) }]);
  assert.deepEqual([semVersao.r.state, semVersao.r.ok], ['unavailable', false]);
  assert.match(semVersao.r.detail, /^check ork-verify: a CI não foi lida: /);
  const jobs500 = consultar([...ce('19.4-ci', comRunner('statuses-do-check')), { quando: apiEm('/pipelines/'), responde: http(500, { message: 'x' }) }]);
  assert.deepEqual([jobs500.r.state, jobs500.r.ok], ['unavailable', false]);
});

const ee = (pais: string[]): Regra[] => [
  { quando: login, responde: ok('') },
  { quando: api('metadata'), responde: http(200, { ...(gravado('gitlab/19.4-ci/metadata') as Item), enterprise: true }) },
  { quando: statuses, responde: http(200, gravado('gitlab/19.4/statuses')) },
  { quando: api(PROJETO), responde: http(200, sintetico('projeto-ee')) },
  { quando: apiEm(`/commits/${HEAD}/merge_requests?`), responde: http(200, comRunner('commit-mrs')) },
  { quando: apiEm('/merge_requests/1/pipelines?'), responde: http(200, sintetico('mr-pipelines')) },
  { quando: api(`${PROJETO}/repository/commits/${'5e'.repeat(20)}`), responde: http(200, { ...(sintetico('commit-mesclado') as Item), parent_ids: pais }) },
  { quando: api(`${PROJETO}/repository/commits/${'4d'.repeat(20)}`), responde: http(200, sintetico('commit-mesclado-velho')) },
  { quando: apiEm('/pipelines/21/jobs?'), responde: http(200, sintetico('pipeline-21-jobs')) },
];

test('resultado mesclado ligado ao head pelo pai do commit: o job da pipeline do MR aprova', () => {
  const { r } = consultar(ee([BASE, HEAD]));
  assert.deepEqual([r.state, r.fonte, r.produtor, r.url], ['success', 'pipeline-job', 'gitlab-ci', 'http://127.0.0.1/root/matriz/-/jobs/201']);
});

test('resultado mesclado sem vínculo com o head: ci.merged-results-sem-vinculo, nunca verde', () => {
  const { r } = consultar(ee([BASE]));
  assert.deepEqual([r.state, r.ok], ['missing', false]);
  assert.match(r.detail, /^ci\.merged-results-sem-vinculo: /);
  assert.match(r.detail, /12edddda/);
});

test('subgrupo no remoto: o caminho inteiro vai à API', () => {
  const { r, caminhos } = consultar(ce('19.4'), { remoto: 'https://gitlab.empresa.com/grupo/sub/projeto.git' });
  assert.equal(r.repository, 'grupo/sub/projeto');
  assert.ok(caminhos.some((c) => c.startsWith('projects/grupo%2Fsub%2Fprojeto/repository/commits/')), caminhos.join('\n'));
});

test('ci.external_repositories aceita subgrupo do GitLab e recusa segmento . ou ..', () => {
  const p = projetoTemporario('ci-externos-subgrupo', false);
  try {
    const arquivo = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(arquivo, 'utf8');
    const comBloco = (bloco: string) => original.replace(/^ci:\n/m, `ci:\n${bloco}`);
    fs.writeFileSync(arquivo, comBloco('  external_repositories:\n    grupo/sub/projeto: ork-verify\n    dono/nome: ""\n'));
    const lido = carregarManifesto(p.dir)!;
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.manifesto.ci.external_repositories, { 'grupo/sub/projeto': 'ork-verify', 'dono/nome': '' });
    fs.writeFileSync(arquivo, comBloco('  external_repositories:\n    grupo/../projeto: ""\n'));
    assert.match(carregarManifesto(p.dir)!.erros.join('\n'), /"grupo\/\.\.\/projeto" nao e dono\/nome do GitHub nem grupo\/subgrupo\/projeto do GitLab/);
  } finally { p.limpar(); }
});
