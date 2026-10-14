/**
 * O pulse no GitLab contra as respostas reais gravadas do CE 19.4 e 17.0 (!1 verde no runner, !2 rascunho
 * cancelado, !3 mesclado, !4 de fork, !5 so com o status externo `ork-verify`). Os casos de pagina, cota e candidatas
 * cortadas partem do corpo gravado, com o `pageInfo` trocado; o de projeto ausente e o de `errors` tem a forma medida
 * em 13/10/2026.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chamadorDaApi } from '../src/forja/api';
import type { EntradaDosPedidosAbertos } from '../src/forja/adaptador';
import type { ForjaResolvida } from '../src/forja/contrato';
import { estadoDoCheck } from '../src/forja/estado';
import { CONSULTA_DOS_ABERTOS_SEGUINTES, CONSULTA_DOS_PEDIDOS } from '../src/forja/gitlab/consultas';
import { adaptadorDaForja } from '../src/forja/registro';
import { LIMITES_DOS_PEDIDOS } from '../src/parado-no-condutor';
import { api, cliFalsa, falhou, FIXTURES, gravado, http, login, ok } from './forja-cli-falsa';

const FORJA: ForjaResolvida = { tipo: 'gitlab', host: '127.0.0.1', porta: null, caminhoBase: '', sshHost: null, sshPorta: null, ca: null,
  repo: 'time/sub/app', origem: { tipo: 'manifesto', host: 'remoto', porta: 'padrao', caminhoBase: 'padrao' } };
const NUNCA_GH = () => { throw new Error('o GitLab nao chama o gh'); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type No = Record<string, any>;
type Corpo = { data: { queryComplexity: { score: number; limit: number }; project: No } };
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function ler(respostas: Array<ReturnType<typeof http>>, extra: Partial<EntradaDosPedidosAbertos> = {}) {
  let i = 0;
  const cli = cliFalsa([{ quando: login, responde: ok('') },
    { quando: api('graphql'), responde: () => respostas[Math.min(i++, respostas.length - 1)] }]);
  const r = adaptadorDaForja('gitlab').pedidosAbertos!({ forja: FORJA, base: 'main', candidatas: ['ork/ork-c', 'ork/ork-x'],
    api: chamadorDaApi(FORJA, { rodar: cli.rodar, logins: new Map() }), executor: NUNCA_GH, resta: () => 60000, orcamentoMs: 60000,
    limites: LIMITES_DOS_PEDIDOS, ...extra });
  const corpos = cli.chamadas.filter((c) => c.args[0] === 'api')
    .map((c) => JSON.parse(c.entrada ?? '{}') as { query: string; variables: Record<string, unknown> });
  return { r, corpos, chamadas: cli.chamadas };
}

test('a regra única de estado cobre os estados do GitLab', () => {
  assert.deepEqual(['SUCCESS', 'FAILED', 'CANCELED', 'PENDING', 'RUNNING', 'CREATED', 'MANUAL', 'SKIPPED']
    .map((s) => estadoDoCheck('pipeline-job', s, null)),
  ['verde', 'vermelho', 'vermelho', 'pendente', 'pendente', 'pendente', 'bloqueado', 'bloqueado']);
});

for (const versao of ['19.4', '17.0']) {
  test(`GitLab ${versao}: uma consulta (a do código), fork fora, ork-verify externo pendente`, () => {
    const caso = JSON.parse(fs.readFileSync(path.join(FIXTURES, `gitlab/${versao}/mr-abertos.json`), 'utf8')) as { entrada: { query: string } };
    assert.equal(caso.entrada.query, CONSULTA_DOS_PEDIDOS, 'a resposta gravada e a da consulta de hoje: regrave se a consulta mudar');
    const corpo = gravado(`gitlab/${versao}/mr-abertos`) as Corpo;
    assert.ok(corpo.data.queryComplexity.score <= corpo.data.queryComplexity.limit);
    const { r, corpos, chamadas } = ler([http(200, corpo)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(corpos.length, 1);
    assert.deepEqual(corpos[0].variables, { path: 'time/sub/app', base: 'main', candidatas: ['ork/ork-c', 'ork/ork-x'] });
    assert.ok(chamadas.find((c) => c.args[0] === 'api')!.args.includes('Content-Type: application/json'));
    const porNumero = new Map(r.valor.prs.map((p) => [p.numero, p]));
    assert.deepEqual([...porNumero.keys()].sort(), [1, 2, 3, 5], 'o !4 e de fork: fica de fora');
    assert.deepEqual(porNumero.get(1)!.checks.map((c) => [c.nome, c.situacao]), [['pipeline', 'verde'], ['ork-verify', 'verde']]);
    assert.equal(porNumero.get(2)!.rascunho, true);
    assert.deepEqual(porNumero.get(2)!.checks.map((c) => c.situacao), ['vermelho', 'vermelho']);
    assert.equal(porNumero.get(3)!.estado, 'mesclado');
    assert.deepEqual(porNumero.get(5)!.checks.map((c) => [c.nome, c.situacao]), [['pipeline', 'verde'], ['ork-verify', 'pendente']],
      'o status externo com o nome ork-verify nao e o job');
    assert.equal(porNumero.get(1)!.url, null, 'a instancia de teste e http: so URL https entra');
    assert.equal(r.valor.parcial, false);
    assert.deepEqual(r.valor.semConferir, [], 'ork/ork-x foi conferida e nao tem MR');
  });
}

test('pipeline de outro head fica pendente; MR sem pipeline fica sem checks; nunca verde', () => {
  const corpo = copia(gravado('gitlab/19.4/mr-abertos') as Corpo);
  const nos = corpo.data.project.abertos.nodes as No[];
  nos.find((n) => n.iid === '1')!.headPipeline.sha = 'f'.repeat(40);
  nos.find((n) => n.iid === '2')!.headPipeline = null;
  const { r } = ler([http(200, corpo)]);
  assert.ok(r.ok);
  assert.deepEqual(r.valor.prs.find((p) => p.numero === 1)!.checks, [{ nome: 'pipeline', situacao: 'pendente', concluidoEm: null }]);
  assert.deepEqual(r.valor.prs.find((p) => p.numero === 2)!.checks, []);
});

test('pipeline verde sem o job ork-verify nao fica verde: o status externo de outro nome tambem fecha a pipeline', () => {
  const corpo = copia(gravado('gitlab/19.4/mr-abertos') as Corpo);
  (corpo.data.project.abertos.nodes as No[]).find((n) => n.iid === '1')!.headPipeline.job = null;
  const { r } = ler([http(200, corpo)]);
  assert.ok(r.ok);
  assert.deepEqual(r.valor.prs.find((p) => p.numero === 1)!.checks.map((c) => [c.nome, c.situacao]),
    [['pipeline', 'verde'], ['ork-verify', 'pendente']]);
});

test('abertos acima de uma página seguem o cursor; com a cota abaixo de 10 %, param e ficam parciais', () => {
  const primeira = copia(gravado('gitlab/19.4/mr-abertos') as Corpo);
  primeira.data.project.abertos.pageInfo = { hasNextPage: true, endCursor: 'cursor-1' };
  const seguinte = { data: { queryComplexity: primeira.data.queryComplexity, project: { id: primeira.data.project.id,
    abertos: { ...copia(primeira.data.project.abertos), pageInfo: { hasNextPage: false, endCursor: 'cursor-2' } } } } };
  const duas = ler([http(200, primeira), http(200, seguinte)]);
  assert.ok(duas.r.ok);
  assert.equal(duas.corpos.length, 2);
  assert.equal(duas.corpos[1].query, CONSULTA_DOS_ABERTOS_SEGUINTES);
  assert.deepEqual(duas.corpos[1].variables, { path: 'time/sub/app', base: 'main', depois: 'cursor-1' });
  assert.equal(duas.r.valor.parcial, false);
  const baixa = ler([http(200, primeira, { 'Ratelimit-Remaining': '5', 'Ratelimit-Limit': '600' })]);
  assert.ok(baixa.r.ok);
  assert.equal(baixa.corpos.length, 1, 'cota baixa: nao pagina');
  assert.equal(baixa.r.valor.parcial, true);
});

test('candidatas acima do teto e lista de candidatas cortada ficam sem conferir, nunca "sem MR"', () => {
  const corpo = copia(gravado('gitlab/19.4/mr-abertos') as Corpo);
  corpo.data.project.daBranch.pageInfo = { hasNextPage: true };
  const muitas = Array.from({ length: 12 }, (_, i) => `ork/ork-n${i}`);
  const { r, corpos } = ler([http(200, corpo)], { candidatas: muitas });
  assert.ok(r.ok);
  assert.deepEqual(corpos[0].variables.candidatas, muitas.slice(0, 10));
  assert.deepEqual(r.valor.semConferir, muitas);
});

test('projeto sem acesso, consulta com erros e glab sem login: erro tipado, nunca lista vazia', () => {
  const semProjeto = ler([http(200, { data: { queryComplexity: { score: 138, limit: 250 }, project: null } })]);
  assert.equal(!semProjeto.r.ok && semProjeto.r.erro.codigo, 'forja.nao-achei');
  const comErros = ler([http(200, { errors: [{ message: "Field 'conflicts' doesn't exist on type 'MergeRequest'" }] })]);
  assert.equal(!comErros.r.ok && comErros.r.erro.codigo, 'forja.resposta-invalida');
  assert.match(!comErros.r.ok ? comErros.r.erro.detalhe : '', /conflicts/);
  const cli = cliFalsa([{ quando: login, responde: falhou('x 127.0.0.1 has not been authenticated with glab') }]);
  const semLogin = adaptadorDaForja('gitlab').pedidosAbertos!({ forja: FORJA, base: 'main', candidatas: [], executor: NUNCA_GH,
    api: chamadorDaApi(FORJA, { rodar: cli.rodar, logins: new Map() }), resta: () => 60000, orcamentoMs: 60000, limites: LIMITES_DOS_PEDIDOS });
  assert.equal(!semLogin.ok && semLogin.erro.codigo, 'forja.sem-login');
  assert.equal(cli.chamadas.filter((c) => c.args[0] === 'api').length, 0, 'sem login, nenhum pedido anonimo');
});
