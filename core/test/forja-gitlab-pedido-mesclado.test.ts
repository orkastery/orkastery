import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import type { ExecutorGitHub } from '../src/entrega-pr';
import { chamadorDaApi } from '../src/forja/api';
import type { ForjaResolvida } from '../src/forja/contrato';
import type { ChamadaDaCli } from '../src/forja/executor';
import { adaptadorDaForja, exigirCapacidade } from '../src/forja/registro';
import { cliFalsa, FIXTURES, gravado, http, login, ok } from './forja-cli-falsa';

const VERSOES = ['19.4', '19.3', '19.2', '18.11', '17.0', '16.11'];
const GL: ForjaResolvida = { tipo: 'gitlab', host: 'gitlab.empresa.com', porta: null, caminhoBase: '', sshHost: null, sshPorta: null, ca: null,
  repo: 'root/matriz', origem: { tipo: 'manifesto', host: 'manifesto', porta: 'padrao', caminhoBase: 'padrao' } };
const SEM_GH: ExecutorGitHub = (c) => { throw new Error(`rodou o gh: ${c}`); };
const caminho = (c: ChamadaDaCli) => c.args[c.args.indexOf('--method') + 2];
const P = 'projects/root%2Fmatriz';
const gl = adaptadorDaForja('gitlab');
type Mr = { sha: string; merge_commit_sha: string | null; squash_commit_sha: string | null; web_url: string; title: string };

/** A API com uma resposta por caminho exato (200, ou o status de `erros`); caminho sem resposta e 404. */
function api(respostas: Record<string, unknown>, erros: Record<string, { status: number; corpo: unknown }> = {}) {
  const cli = cliFalsa([{ quando: login, responde: ok('') },
    ...Object.entries(respostas).map(([k, corpo]) => ({ quando: (c: ChamadaDaCli) => c.args[0] === 'api' && caminho(c) === k, responde: http(200, corpo) })),
    ...Object.entries(erros).map(([k, e]) => ({ quando: (c: ChamadaDaCli) => c.args[0] === 'api' && caminho(c) === k, responde: http(e.status, e.corpo) })),
    { quando: (c: ChamadaDaCli) => c.args[0] === 'api', responde: http(404, { message: '404 Not Found' }) }]);
  return { cli, api: chamadorDaApi(GL, { rodar: cli.rodar, logins: new Map() }) };
}

test('pedidoMesclado do GitLab lê o MR mesclado gravado de cada versão: o commit de merge e o head', () => {
  for (const v of VERSOES) {
    const mr = gravado(`gitlab/${v}/mr`) as Mr;
    const { api: chamar } = api({ [`${P}/merge_requests/1`]: mr });
    const pr = exigirCapacidade(gl, 'pedidoMesclado')({ repo: 'root/matriz', numero: 1, executor: SEM_GH, api: chamar });
    assert.deepEqual(pr, { numero: 1, mesclado: true, mergeSha: mr.merge_commit_sha, headSha: mr.sha, base: 'main', branch: 'ork/ork-teste',
      titulo: 'ship(ork-teste): teste', corpo: null, url: mr.web_url }, v);
  }
});

test('ff sem commit de merge: o merge é o próprio head; ff com squash: o commit do squash', () => {
  const ff = gravado('gitlab/19.4/mr-ff') as Mr;
  assert.equal(ff.merge_commit_sha, null);
  const prFf = exigirCapacidade(gl, 'pedidoMesclado')({ repo: 'root/matriz', numero: 2, executor: SEM_GH,
    api: api({ [`${P}/merge_requests/2`]: ff }).api });
  assert.equal(prFf?.mesclado, true);
  assert.equal(prFf?.mergeSha, ff.sha);
  const sq = gravado('gitlab/19.4/mr-squash') as Mr;
  assert.equal(sq.merge_commit_sha, null);
  assert.match(sq.squash_commit_sha ?? '', /^[0-9a-f]{40}$/);
  const prSq = exigirCapacidade(gl, 'pedidoMesclado')({ repo: 'root/matriz', numero: 3, executor: SEM_GH,
    api: api({ [`${P}/merge_requests/3`]: sq }).api });
  assert.equal(prSq?.mergeSha, sq.squash_commit_sha);
  assert.equal(prSq?.headSha, sq.sha);
});

test('MR aberto não é mesclado, e não tem merge; MR que não se lê é null, nunca MR vazio', () => {
  // Derivado do MR gravado: so o estado muda.
  const aberto = { ...(gravado('gitlab/19.4/mr') as Mr), state: 'opened', merge_commit_sha: null };
  const pr = exigirCapacidade(gl, 'pedidoMesclado')({ repo: 'root/matriz', numero: 1, executor: SEM_GH, api: api({ [`${P}/merge_requests/1`]: aberto }).api });
  assert.equal(pr?.mesclado, false);
  assert.equal(pr?.mergeSha, null);
  assert.equal(exigirCapacidade(gl, 'pedidoMesclado')({ repo: 'root/matriz', numero: 9, executor: SEM_GH, api: api({}).api }), null);
  assert.equal(exigirCapacidade(gl, 'pedidoMesclado')({ repo: 'root/matriz', numero: 1, executor: SEM_GH }), null);
});

test('branchPadrao do GitLab pelo projeto gravado de cada versão; sem o campo, texto vazio; sem leitura, null', () => {
  for (const v of VERSOES) {
    assert.equal(exigirCapacidade(gl, 'branchPadrao')({ repo: 'root/matriz', executor: SEM_GH, api: api({ [P]: gravado(`gitlab/${v}/projeto`) }).api }), 'main', v);
  }
  assert.equal(exigirCapacidade(gl, 'branchPadrao')({ repo: 'root/matriz', executor: SEM_GH, api: api({ [P]: { id: 1 } }).api }), '');
  assert.equal(exigirCapacidade(gl, 'branchPadrao')({ repo: 'root/matriz', executor: SEM_GH, api: api({}).api }), null);
});

test('pontaDaBranch do GitLab pela branch gravada, com o nome codificado no caminho', () => {
  const branch = gravado('gitlab/19.4/branch') as { commit: { id: string } };
  assert.equal(exigirCapacidade(gl, 'pontaDaBranch')({ repo: 'root/matriz', branch: 'main', executor: SEM_GH,
    api: api({ [`${P}/repository/branches/main`]: branch }).api }), branch.commit.id);
  assert.equal(exigirCapacidade(gl, 'pontaDaBranch')({ repo: 'root/matriz', branch: 'ork/x', executor: SEM_GH,
    api: api({ [`${P}/repository/branches/ork%2Fx`]: branch }).api }), branch.commit.id);
  // Sintetico: sha curto, que a forja nunca devolve.
  assert.equal(exigirCapacidade(gl, 'pontaDaBranch')({ repo: 'root/matriz', branch: 'main', executor: SEM_GH,
    api: api({ [`${P}/repository/branches/main`]: { commit: { id: 'curto' } } }).api }), null);
});

test('comparar no GitLab: a ponta contém o merge (ahead), não contém (diverged), o mesmo sha (identical) e sem leitura (null)', () => {
  // O merge do MR !1 (a ponta da main quando ele entrou) e a ponta de agora, que andou depois dele (o squash do MR !3).
  const MERGE = (gravado('gitlab/19.4/branch') as { commit: { id: string } }).commit.id;
  const PONTA = (gravado('gitlab/19.4/mr-squash') as Mr).squash_commit_sha!;
  const consulta = `${P}/repository/compare?from=${PONTA}&to=${MERGE}&straight=false`;
  const comparar = exigirCapacidade(gl, 'comparar');
  const gravada = gravado('gitlab/19.4/compare-dentro') as { commits: unknown[]; compare_same_ref: boolean; web_url: string };
  assert.deepEqual([gravada.commits, gravada.compare_same_ref], [[], false]);
  assert.match(gravada.web_url, new RegExp(MERGE));
  const dentro = api({ [consulta]: gravada });
  assert.equal(comparar({ repo: 'root/matriz', de: MERGE, ate: PONTA, executor: SEM_GH, api: dentro.api }), 'ahead');
  assert.equal(comparar({ repo: 'root/matriz', de: MERGE, ate: PONTA, executor: SEM_GH, api: api({ [consulta]: gravado('gitlab/19.4/compare-fora') }).api }),
    'diverged');
  const mesmo = api({});
  assert.equal(comparar({ repo: 'root/matriz', de: MERGE, ate: MERGE, executor: SEM_GH, api: mesmo.api }), 'identical');
  assert.equal(mesmo.cli.chamadas.filter((c) => c.args[0] === 'api').length, 0);
  // Sintetico: `compare_timeout` verdadeiro (o servidor so o devolve sob carga).
  assert.equal(comparar({ repo: 'root/matriz', de: MERGE, ate: PONTA, executor: SEM_GH,
    api: api({ [consulta]: { commits: [], compare_timeout: true } }).api }), null);
  assert.equal(comparar({ repo: 'root/matriz', de: MERGE, ate: PONTA, executor: SEM_GH, api: api({}).api }), null);
});

test('comparar no GitLab com a ponta ou o merge que não existem: o GitLab responde 404 (gravado), e a comparação não é lida', () => {
  const MERGE = (gravado('gitlab/19.4/branch') as { commit: { id: string } }).commit.id;
  const PONTA = (gravado('gitlab/19.4/mr-squash') as Mr).squash_commit_sha!;
  const comparar = exigirCapacidade(gl, 'comparar');
  const consulta = (de: string, ate: string) => `${P}/repository/compare?${new URLSearchParams({ from: ate, to: de, straight: 'false' }).toString()}`;
  // Os 40 hex aleatorios que a gravacao mandou como `from` (a ponta) e como `to` (o merge).
  const doComando = (caso: string, campo: 'from' | 'to') => {
    const g = JSON.parse(fs.readFileSync(path.join(FIXTURES, `gitlab/19.4/${caso}.json`), 'utf8')) as { comando: string[]; status_http: number };
    assert.equal(g.status_http, 404, caso);
    return new URLSearchParams(g.comando[g.comando.length - 1].split('?')[1]).get(campo)!;
  };
  const casos: Array<[string, string, string]> = [
    ['compare-from-inexistente', MERGE, doComando('compare-from-inexistente', 'from')],
    ['compare-to-inexistente', doComando('compare-to-inexistente', 'to'), PONTA],
  ];
  for (const [caso, de, ate] of casos) {
    assert.match(de, /^[0-9a-f]{40}$/, caso);
    assert.match(ate, /^[0-9a-f]{40}$/, caso);
    const lida = api({}, { [consulta(de, ate)]: { status: 404, corpo: gravado(`gitlab/19.4/${caso}`) } });
    assert.equal(comparar({ repo: 'root/matriz', de, ate, executor: SEM_GH, api: lida.api }), null, caso);
    assert.equal(lida.cli.chamadas.filter((c) => c.args[0] === 'api' && caminho(c) === consulta(de, ate)).length, 1, caso);
  }
  // O nome de branch inexistente tambem e 404 "Ref Not Found"; a porta so manda sha, e o nome nunca chega a API.
  assert.deepEqual(gravado('gitlab/19.4/compare-from-branch-inexistente'), gravado('gitlab/19.4/compare-from-inexistente'));
  const nenhuma = api({});
  assert.equal(comparar({ repo: 'root/matriz', de: MERGE, ate: 'ork/nao-existe', executor: SEM_GH, api: nenhuma.api }), null);
  assert.equal(nenhuma.cli.chamadas.filter((c) => c.args[0] === 'api').length, 0);
});
