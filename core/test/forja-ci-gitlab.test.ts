import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { EntradaDoEstadoDeCi } from '../src/forja/adaptador';
import { chamadorDaApi, paginarPelaApi, type ChamadorDaApi } from '../src/forja/api';
import { produtorAceito } from '../src/forja/produtor';
import { adaptadorDaForja, exigirCapacidade } from '../src/forja/registro';
import { api, apiEm, cliFalsa, gravado, http, login, ok, respostaGravada, type Regra } from './forja-cli-falsa';

const GL = { tipo: 'gitlab' as const, host: 'gitlab.empresa.com', porta: null, caminhoBase: '', ca: null };
const GH = { ...GL, tipo: 'github' as const, host: 'github.com' };
/** O head e a base do MR gravado com runner em 19.4-ci; as respostas sinteticas do resultado mesclado usam os mesmos. */
const HEAD = '12edddda9ac424f9355c39785b873803a062d59d';
const BASE = '291615e904fc9e96598992e28d1c92a2f2c34dfa';
const MESCLADO = '5e'.repeat(20);
const VELHO = '4d'.repeat(20);
const PROJETO = 'projects/root%2Fmatriz';
type Item = Record<string, unknown>;
const corpo = (caso: string) => gravado(`gitlab/${caso}`) as Item[];
const SEM_LIMITE = { restante: null, total: null, reiniciaEm: null };

function ler(regras: Regra[], o: Partial<EntradaDoEstadoDeCi> = {}) {
  const cli = cliFalsa([{ quando: login, responde: ok('') }, ...regras]);
  const r = exigirCapacidade(adaptadorDaForja('gitlab'), 'estadoDeCi')({ api: chamadorDaApi(GL, { rodar: cli.rodar, logins: new Map() }),
    repo: 'root/matriz', sha: HEAD, context: 'ork-verify', edicao: 'ce', ...o });
  // O caminho e o ultimo argumento do `glab api -i --method GET <caminho>`.
  const caminhos = cli.chamadas.filter((c) => c.args[0] === 'api').map((c) => c.args[c.args.length - 1]);
  return { r, caminhos };
}

const STATUSES = (sha: string, nome = 'ork-verify') => `${PROJETO}/repository/commits/${sha}/statuses?name=${nome}&all=true&per_page=100&page=1`;
const JOBS = (pipeline: number) => `${PROJETO}/pipelines/${pipeline}/jobs?include_retried=true&per_page=100&page=1`;
/** As respostas gravadas com runner: o job real 2 na pipeline 1 do MR e o `POST /statuses` 4 na pipeline external 2. */
const gravadas = (versao: '19.4-ci' | '17.0-ci', statuses = 'statuses-do-check'): Regra[] => [
  { quando: apiEm('/statuses?'), responde: respostaGravada(`gitlab/${versao}/${statuses}`) },
  { quando: apiEm('/pipelines/1/jobs?'), responde: respostaGravada(`gitlab/${versao}/pipeline-1-jobs`) },
  { quando: apiEm('/pipelines/2/jobs?'), responde: respostaGravada(`gitlab/${versao}/pipeline-2-jobs`) },
];
const shaGravado = (versao: string): string => corpo(`${versao}/statuses-do-check`)[0].sha as string;

for (const versao of ['16.11', '17.0', '18.11', '19.2', '19.3', '19.4']) {
  test(`GitLab CE ${versao} gravado: commit sem pipeline não tem check, e a CE não procura resultado mesclado`, () => {
    const { r, caminhos } = ler([{ quando: apiEm('/statuses?'), responde: http(200, gravado(`gitlab/${versao}/statuses`)) }]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.valor, { checks: [], mescladoSemVinculo: false });
    assert.deepEqual(caminhos, [STATUSES(HEAD)]);
  });
}

for (const versao of ['19.4-ci', '17.0-ci'] as const) {
  test(`GitLab CE ${versao.slice(0, 4)} gravado com runner: só o status que é job da lista da pipeline vira gitlab-ci; o POST /statuses fica commit-status`, () => {
    const sha = shaGravado(versao);
    const { r, caminhos } = ler(gravadas(versao), { sha });
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.valor.checks.map((c) => [c.ordem, c.fonte, c.produtor, c.status, c.url]), [
      [2, 'pipeline-job', 'gitlab-ci', 'success', 'http://127.0.0.1/root/matriz/-/jobs/2'],
      [4, 'commit-status', 'root', 'success', 'https://ci.example/ork-verify/1'],
    ]);
    assert.equal(r.valor.mescladoSemVinculo, false);
    assert.deepEqual(caminhos, [STATUSES(sha), JOBS(1), JOBS(2)]);
    assert.deepEqual(r.valor.checks.map((c) => produtorAceito(c, ['gitlab-ci'])), [true, false]);
  });

  test(`GitLab CE ${versao.slice(0, 4)} gravado com runner: POST /statuses com nome novo entra na pipeline real do MR e não vira job`, () => {
    // O `ork-extra` foi publicado por POST /statuses na pipeline 1 (a do MR, com runner): mesmo pipeline_id do job
    // real, ausente da lista de jobs dela. A lista gravada traz todos os nomes; o filtro do nome e conferido aqui.
    const sha = shaGravado(versao);
    const { r } = ler(gravadas(versao, 'statuses'), { sha, context: 'ork-extra' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.valor.checks.length, 1);
    const [c] = r.valor.checks;
    assert.deepEqual([c.nome, c.fonte, c.produtor], ['ork-extra', 'commit-status', 'root']);
    assert.equal(corpo(`${versao}/statuses`).find((s) => s.id === c.ordem)!.pipeline_id, 1, 'o status entrou na pipeline real');
    assert.equal(produtorAceito(c, ['gitlab-ci']), false);
  });
}

test('reexecução: os dois jobs do check na lista com include_retried contam, cada um pelo seu estado', () => {
  const [real] = corpo('19.4-ci/statuses-do-check');
  const job = corpo('19.4-ci/pipeline-1-jobs').find((j) => j.id === 2)!;
  const statuses = [{ ...real, id: 8, status: 'failed' }, ...corpo('19.4-ci/statuses-do-check')];
  const jobs = [{ ...job, id: 8, status: 'failed', web_url: 'http://127.0.0.1/root/matriz/-/jobs/8' }, ...corpo('19.4-ci/pipeline-1-jobs')];
  const { r } = ler([{ quando: apiEm('/statuses?'), responde: http(200, statuses) },
    { quando: apiEm('/pipelines/1/jobs?'), responde: http(200, jobs) }, gravadas('19.4-ci')[2]]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.valor.checks.map((c) => [c.ordem, c.fonte, c.status]),
    [[8, 'pipeline-job', 'failed'], [2, 'pipeline-job', 'success'], [4, 'commit-status', 'success']]);
});

test('status sem pipeline_id, com id que a pipeline lista com outro nome ou job de outra pipeline: não é job real', () => {
  const semPipeline = ler([{ quando: apiEm('/statuses?'), responde: http(200, corpo('19.4-ci/statuses-do-check').map((s) => ({ ...s, pipeline_id: null }))) }]);
  assert.ok(semPipeline.r.ok);
  assert.ok(semPipeline.r.valor.checks.every((c) => c.fonte === 'commit-status'));
  assert.equal(semPipeline.caminhos.length, 1, 'sem pipeline_id, nenhuma lista de jobs');

  const renomeados = corpo('19.4-ci/pipeline-1-jobs').map((j) => ({ ...j, name: 'build' }));
  const outroNome = ler([gravadas('19.4-ci')[0], { quando: apiEm('/pipelines/1/jobs?'), responde: http(200, renomeados) }, gravadas('19.4-ci')[2]]);
  assert.ok(outroNome.r.ok);
  assert.deepEqual(outroNome.r.valor.checks.map((c) => [c.fonte, c.produtor]), [['commit-status', 'root'], ['commit-status', 'root']]);

  // Mesmo nome e mesma pipeline de um job real, mas o id nao esta na lista: so o id prova o job.
  const forjado = { ...corpo('19.4-ci/statuses-do-check')[1], id: 9, pipeline_id: 1, author: { username: 'mallory' } };
  const mesmoNome = ler([{ quando: apiEm('/statuses?'), responde: http(200, [forjado, ...corpo('19.4-ci/statuses-do-check')]) },
    gravadas('19.4-ci')[1], gravadas('19.4-ci')[2]]);
  assert.ok(mesmoNome.r.ok);
  assert.deepEqual(mesmoNome.r.valor.checks.map((c) => [c.ordem, c.fonte, c.produtor]),
    [[9, 'commit-status', 'mallory'], [2, 'pipeline-job', 'gitlab-ci'], [4, 'commit-status', 'root']]);

  const deOutra = corpo('19.4-ci/pipeline-1-jobs').map((j) => ({ ...j, pipeline: { ...(j.pipeline as Item), id: 9 } }));
  const outraPipeline = ler([gravadas('19.4-ci')[0], { quando: apiEm('/pipelines/1/jobs?'), responde: http(200, deOutra) }, gravadas('19.4-ci')[2]]);
  assert.ok(outraPipeline.r.ok);
  assert.ok(outraPipeline.r.valor.checks.every((c) => c.fonte === 'commit-status'));
});

test('lista de jobs que falha, que some (pipeline de outro projeto) ou que não acaba; status fora do formato e pipelines demais: erro, nunca check a menos', () => {
  const falhaJobs = ler([gravadas('19.4-ci')[0], { quando: apiEm('/pipelines/'), responde: http(500, { message: '500 Internal Server Error' }) }]);
  assert.equal(!falhaJobs.r.ok && falhaJobs.r.erro.codigo, 'forja.indisponivel');
  const semJobs = ler([gravadas('19.4-ci')[0], { quando: apiEm('/pipelines/'), responde: http(404, { message: '404 Not found' }) }]);
  assert.equal(!semJobs.r.ok && semJobs.r.erro.codigo, 'forja.nao-achei');
  const semFim = ler([gravadas('19.4-ci')[0],
    { quando: apiEm('/pipelines/1/jobs?'), responde: (c) => {
      const pagina = Number(/[?&]page=(\d+)/.exec(c.args[c.args.length - 1])![1]);
      return http(200, corpo('19.4-ci/pipeline-1-jobs'), { 'x-next-page': String(pagina + 1) });
    } }, gravadas('19.4-ci')[2]]);
  assert.equal(!semFim.r.ok && semFim.r.erro.codigo, 'forja.incompleto');
  const jobTorto = ler([gravadas('19.4-ci')[0], { quando: apiEm('/pipelines/1/jobs?'), responde: http(200, [{ id: 2, name: 'ork-verify' }]) }]);
  assert.equal(!jobTorto.r.ok && jobTorto.r.erro.codigo, 'forja.resposta-invalida');
  const jobsNaoLista = ler([gravadas('19.4-ci')[0], { quando: apiEm('/pipelines/1/jobs?'), responde: http(200, { message: 'x' }) }]);
  assert.equal(!jobsNaoLista.r.ok && jobsNaoLista.r.erro.codigo, 'forja.resposta-invalida');
  const torto = ler([{ quando: apiEm('/statuses?'), responde: http(200, [{ id: 'x', name: 'ork-verify' }]) }]);
  assert.equal(!torto.r.ok && torto.r.erro.codigo, 'forja.resposta-invalida');
  const muitas = Array.from({ length: 11 }, (_, i) => ({ ...corpo('19.4-ci/statuses-do-check')[0], id: 500 + i, pipeline_id: 600 + i }));
  const demais = ler([{ quando: apiEm('/statuses?'), responde: http(200, muitas) }]);
  assert.equal(!demais.r.ok && demais.r.erro.codigo, 'forja.incompleto');
  assert.equal(demais.caminhos.length, 1, 'acima do teto, nenhuma lista de jobs');
});

const sintetico = (caso: string) => gravado(`gitlab/sintetico/${caso}`);
const resultadoMesclado = (pais: string[], o: { pipelines?: unknown } = {}): Regra[] => [
  // Sem job real do check no head: so o `POST /statuses` gravado (status 4, pipeline external 2).
  { quando: apiEm('/statuses?'), responde: http(200, corpo('19.4-ci/statuses-do-check').filter((s) => s.id === 4)) },
  gravadas('19.4-ci')[2],
  { quando: api(PROJETO), responde: http(200, sintetico('projeto-ee')) },
  { quando: apiEm(`/commits/${HEAD}/merge_requests?`), responde: respostaGravada('gitlab/19.4-ci/commit-mrs') },
  { quando: apiEm('/merge_requests/1/pipelines?'), responde: http(200, o.pipelines ?? sintetico('mr-pipelines')) },
  { quando: api(`${PROJETO}/repository/commits/${MESCLADO}`), responde: http(200, { ...(sintetico('commit-mesclado') as Item), parent_ids: pais }) },
  { quando: api(`${PROJETO}/repository/commits/${VELHO}`), responde: http(200, sintetico('commit-mesclado-velho')) },
  { quando: apiEm('/pipelines/21/jobs?'), responde: http(200, sintetico('pipeline-21-jobs')) },
];

test('EE com resultado mesclado: o job da pipeline do MR cujo commit tem o head como pai conta como pipeline-job', () => {
  const { r, caminhos } = ler(resultadoMesclado([BASE, HEAD]), { edicao: 'ee' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.valor.checks.map((c) => [c.ordem, c.fonte, c.produtor, c.status]),
    [[4, 'commit-status', 'root', 'success'], [201, 'pipeline-job', 'gitlab-ci', 'success']]);
  assert.equal(r.valor.mescladoSemVinculo, false);
  assert.ok(!caminhos.some((c) => c.includes(VELHO)), 'a pipeline mais nova ligada ao head decide; a velha nem é lida');
  assert.ok(!caminhos.some((c) => c.includes(`commits/${HEAD}?`) || c.endsWith(`commits/${HEAD}`)), 'a pipeline do head não é candidata');
});

test('resultado mesclado sem o head entre os pais (squash no merge train): mescladoSemVinculo, sem check de CI', () => {
  const { r } = ler(resultadoMesclado([BASE]), { edicao: 'ee' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.valor.checks.map((c) => c.fonte), ['commit-status']);
  assert.equal(r.valor.mescladoSemVinculo, true);
});

test('resultado mesclado: pipeline de outro projeto não é candidata; job dela de outro projeto não conta; erro no commit é erro', () => {
  const pipelines = (sintetico('mr-pipelines') as Item[]).map((p) => ({ ...p, project_id: 2 }));
  const outroProjeto = ler(resultadoMesclado([BASE, HEAD], { pipelines }), { edicao: 'ee' });
  assert.ok(outroProjeto.r.ok, JSON.stringify(outroProjeto.r));
  assert.deepEqual(outroProjeto.r.valor.checks.map((c) => c.fonte), ['commit-status']);
  assert.ok(!outroProjeto.caminhos.some((c) => c.includes(MESCLADO)));

  const jobs = (sintetico('pipeline-21-jobs') as Item[]).map((j) => ({ ...j, pipeline: { ...(j.pipeline as Item), project_id: 2 } }));
  const jobDeOutro = ler([...resultadoMesclado([BASE, HEAD]).slice(0, 7), { quando: apiEm('/pipelines/21/jobs?'), responde: http(200, jobs) }],
    { edicao: 'ee' });
  assert.ok(jobDeOutro.r.ok, JSON.stringify(jobDeOutro.r));
  assert.deepEqual(jobDeOutro.r.valor.checks.map((c) => c.fonte), ['commit-status']);

  const erro = ler([{ quando: api(`${PROJETO}/repository/commits/${MESCLADO}`), responde: http(500, { message: 'x' }) }, ...resultadoMesclado([BASE, HEAD])],
    { edicao: 'ee' });
  assert.equal(!erro.r.ok && erro.r.erro.codigo, 'forja.indisponivel');
});

test('EE sem a opção no projeto: nenhuma pergunta de MR; edição desconhecida pergunta ao projeto', () => {
  const desligado = { ...(sintetico('projeto-ee') as Item), merge_pipelines_enabled: false, merge_trains_enabled: false };
  const regras: Regra[] = [{ quando: apiEm('/statuses?'), responde: http(200, []) }, { quando: api(PROJETO), responde: http(200, desligado) }];
  const ee = ler(regras, { edicao: 'ee' });
  assert.ok(ee.r.ok);
  assert.deepEqual(ee.r.valor, { checks: [], mescladoSemVinculo: false });
  assert.ok(!ee.caminhos.some((c) => c.includes('merge_requests')));
  assert.ok(ler(regras, { edicao: null }).caminhos.includes(PROJETO));
  // O projeto CE gravado nao tem os campos: nenhuma pergunta de MR, mesmo com a edicao desconhecida.
  const ce = ler([regras[0], { quando: api(PROJETO), responde: respostaGravada('gitlab/19.4-ci/projeto') }], { edicao: null });
  assert.ok(ce.r.ok);
  assert.ok(!ce.caminhos.some((c) => c.includes('merge_requests')));
});

test('GitHub gravado: a mesma leitura pela API dá o ork-verify do github-actions', () => {
  const cli = cliFalsa([{ quando: apiEm('/check-runs?'), responde: http(200, gravado('github/2026-10/check-runs')) },
    { quando: apiEm('/statuses?'), responde: http(200, gravado('github/2026-10/statuses')) }]);
  const r = exigirCapacidade(adaptadorDaForja('github'), 'estadoDeCi')({ api: chamadorDaApi(GH, { rodar: cli.rodar }),
    repo: 'orkastery/orkastery', sha: '9436d3e076e66353e8e47f39c4457ed1d9bc3dc8', context: 'ork-verify', edicao: null });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.valor.checks.map((c) => [c.fonte, c.produtor, c.status, c.conclusao]), [['check-run', 'github-actions', 'completed', 'success']]);
  assert.equal(r.valor.mescladoSemVinculo, false);
});

test('paginarPelaApi segue o x-next-page de um chamador qualquer e para no teto', () => {
  const pedidos: string[] = [];
  const tres: ChamadorDaApi = (p) => {
    pedidos.push(p.caminho);
    const pagina = Number(/[?&]page=(\d+)/.exec(p.caminho)![1]);
    return { ok: true, valor: { status: 200, corpo: [pagina], cabecalhos: pagina < 3 ? { 'x-next-page': String(pagina + 1) } : {} as Record<string, string>, limite: SEM_LIMITE } };
  };
  const r = paginarPelaApi(tres, { caminho: `${PROJETO}/x?all=true` });
  assert.ok(r.ok);
  assert.deepEqual(r.valor, { itens: [1, 2, 3], paginas: 3 });
  assert.equal(pedidos[0], `${PROJETO}/x?all=true&per_page=100&page=1`);
  const sempre: ChamadorDaApi = (p) => {
    const pagina = Number(/[?&]page=(\d+)/.exec(p.caminho)![1]);
    return { ok: true, valor: { status: 200, corpo: [pagina], cabecalhos: { 'x-next-page': String(pagina + 1) }, limite: SEM_LIMITE } };
  };
  const teto = paginarPelaApi(sempre, { caminho: 'x' });
  assert.equal(!teto.ok && teto.erro.codigo, 'forja.incompleto');
});

test('as duas forjas registram estadoDeCi; o GitLab segue sem checksNoCommit', () => {
  assert.equal(typeof adaptadorDaForja('gitlab').estadoDeCi, 'function');
  assert.equal(typeof adaptadorDaForja('github').estadoDeCi, 'function');
  assert.throws(() => exigirCapacidade(adaptadorDaForja('gitlab'), 'checksNoCommit'), /^Error: forja\.sem-capacidade: gitlab/);
});
