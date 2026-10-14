import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chamadorDaApi } from '../src/forja/api';
import type { ForjaResolvida } from '../src/forja/contrato';
import type { ChamadaDaCli } from '../src/forja/executor';
import { prDoMr, projetoNaApi } from '../src/forja/gitlab/pedidos';
import { adaptadorDaForja, exigirCapacidade } from '../src/forja/registro';
import type { ExecutorDoGh } from '../src/parado-no-condutor';
import { cliFalsa, falhou, gravado, http, login, ok, Regra } from './forja-cli-falsa';

const VERSOES = ['19.4', '19.3', '19.2', '18.11', '17.0', '16.11'];
const GL: ForjaResolvida = { tipo: 'gitlab', host: 'gitlab.empresa.com', porta: null, caminhoBase: '', sshHost: null, sshPorta: null, ca: null,
  repo: 'root/matriz', origem: { tipo: 'manifesto', host: 'manifesto', porta: 'padrao', caminhoBase: 'padrao' } };
/** O gh nunca roda numa forja GitLab. */
const SEM_GH: ExecutorDoGh = (args) => { throw new Error(`rodou o gh: ${args.join(' ')}`); };
const metodo = (c: ChamadaDaCli) => c.args[c.args.indexOf('--method') + 1];
const caminho = (c: ChamadaDaCli) => c.args[c.args.indexOf('--method') + 2];
const listaDaBranch = (c: ChamadaDaCli) => c.args[0] === 'api' && metodo(c) === 'GET' && caminho(c).startsWith('projects/root%2Fmatriz/merge_requests?');
/** O MR gravado da 19.4; os casos marcados "derivado" trocam so os campos que o caso exercita. */
const MR = () => (gravado('gitlab/19.4/mr-list') as Record<string, unknown>[])[0];

function ler(regras: Regra[], f: ForjaResolvida = GL, branch = 'ork/ork-teste') {
  const cli = cliFalsa([{ quando: login, responde: ok('') }, ...regras]);
  const r = exigirCapacidade(adaptadorDaForja('gitlab'), 'pedidosDaBranch')({ host: f.host, repositorio: f.repo, base: 'main', branch,
    executor: SEM_GH, prazoMs: 1000, api: chamadorDaApi(f, { rodar: cli.rodar, logins: new Map() }) });
  return { r, cli };
}

test('pedidosDaBranch do GitLab lê o MR gravado de cada versão na forma neutra, pela lista da branch', () => {
  for (const v of VERSOES) {
    const gravada = (gravado(`gitlab/${v}/mr-list`) as Record<string, unknown>[])[0];
    const { r, cli } = ler([{ quando: listaDaBranch, responde: http(200, gravado(`gitlab/${v}/mr-list`)) }]);
    assert.equal(r.erro, null, v);
    assert.deepEqual(r.prs.map((p) => [p.numero, p.estado, p.branch, p.head, p.rascunho, p.url, p.checks]),
      [[1, 'mesclado', 'ork/ork-teste', gravada.sha, false, gravada.web_url, []]], v);
    const pedido = cli.chamadas.find(listaDaBranch)!;
    assert.equal(pedido.cmd, 'glab', v);
    assert.equal(caminho(pedido), 'projects/root%2Fmatriz/merge_requests?source_branch=ork%2Fork-teste&state=all&per_page=100', v);
  }
});

test('o MR gravado de cada versão tem rascunho em draft ou, so nas antigas, em work_in_progress', () => {
  // Derivado: o MR gravado sem `draft` (as versoes que so tem `work_in_progress`) e com ele verdadeiro.
  const { draft, ...semDraft } = MR();
  void draft;
  const { r } = ler([{ quando: listaDaBranch, responde: http(200, [{ ...semDraft, work_in_progress: true }]) }]);
  assert.equal(r.erro, null);
  assert.deepEqual(r.prs.map((p) => p.rascunho), [true]);
});

test('MR de fork, de outra base ou de outra branch fica de fora; o conflito só vale do MR aberto e calculado; locked é aberto', () => {
  // Derivados do MR gravado da 19.4: so mudam os campos de cada caso.
  const lista = [
    MR(),
    { ...MR(), iid: 2, state: 'opened', source_project_id: 9 },
    { ...MR(), iid: 3, state: 'opened', target_branch: 'develop' },
    { ...MR(), iid: 4, state: 'opened', has_conflicts: true, detailed_merge_status: 'conflict' },
    { ...MR(), iid: 5, state: 'opened', has_conflicts: false, detailed_merge_status: 'checking' },
    { ...MR(), iid: 6, state: 'opened', has_conflicts: false, detailed_merge_status: 'mergeable', draft: true },
    { ...MR(), iid: 7, state: 'closed', source_branch: 'ork/outra' },
    { ...MR(), iid: 8, state: 'locked', has_conflicts: false, detailed_merge_status: 'mergeable' },
    { ...MR(), iid: 10, state: 'closed' },
  ];
  const { r } = ler([{ quando: listaDaBranch, responde: http(200, lista) }]);
  assert.equal(r.erro, null);
  assert.deepEqual(r.prs.map((p) => [p.numero, p.estado, p.conflito, p.rascunho]),
    [[10, 'fechado', undefined, false], [8, 'aberto', false, false], [6, 'aberto', false, true], [5, 'aberto', null, false],
      [4, 'aberto', true, false], [1, 'mesclado', undefined, false]]);
});

test('lista que não cabe numa página, fora do formato ou com erro da API vira erro, nunca a lista curta', () => {
  // Sintetico: o cabecalho `X-Next-Page` de uma lista cheia (a gravada cabe numa pagina).
  const pagina = ler([{ quando: listaDaBranch, responde: http(200, [MR()], { 'X-Next-Page': '2' }) }]);
  assert.match(pagina.r.erro ?? '', /^forja\.incompleto/);
  assert.deepEqual(pagina.r.prs, []);
  assert.match(ler([{ quando: listaDaBranch, responde: http(200, { message: 'x' }) }]).r.erro ?? '', /^forja\.resposta-invalida/);
  assert.match(ler([{ quando: listaDaBranch, responde: http(200, [{ ...MR(), sha: null }]) }]).r.erro ?? '',
    /^forja\.resposta-invalida: MR fora do formato/);
  assert.match(ler([{ quando: listaDaBranch, responde: http(200, [{ ...MR(), source_project_id: undefined, target_project_id: undefined }]) }]).r.erro ?? '',
    /^forja\.resposta-invalida: MR fora do formato/);
  // Sintetico: o corpo do 404 (nao ha 404 gravado desta lista).
  assert.match(ler([{ quando: listaDaBranch, responde: http(404, { message: '404 Project Not Found' }) }]).r.erro ?? '',
    /^forja\.nao-achei: HTTP 404 GET projects\/root%2Fmatriz\/merge_requests/);
});

test('sem login do glab no host: sem-login e nenhuma chamada à API (o glab faria o pedido anônimo)', () => {
  const cli = cliFalsa([{ quando: login, responde: falhou('127.0.0.1 has not been authenticated with glab') }]);
  const r = exigirCapacidade(adaptadorDaForja('gitlab'), 'pedidosDaBranch')({ host: GL.host, repositorio: GL.repo, base: 'main',
    branch: 'ork/x', executor: SEM_GH, prazoMs: 1000, api: chamadorDaApi(GL, { rodar: cli.rodar, logins: new Map() }) });
  assert.match(r.erro ?? '', /^forja\.sem-login/);
  assert.equal(cli.chamadas.filter((c) => c.args[0] === 'api').length, 0);
});

test('abrirPedido do GitLab: POST com a descrição pelo stdin, só os quatro campos, nunca o merge automático', () => {
  const f = { ...GL, repo: 'grupo/sub/app' };
  const corpo = `--repo=outro/repo\n${'x'.repeat(70 * 1024)}`;
  const titulo = '--repo=outro/repo ship(ork-x): x';
  const criacao = (c: ChamadaDaCli) => c.args[0] === 'api' && metodo(c) === 'POST' && caminho(c) === 'projects/grupo%2Fsub%2Fapp/merge_requests';
  const cli = cliFalsa([{ quando: login, responde: ok('') }, { quando: criacao, responde: http(201, { ...MR(), iid: 9, state: 'opened' }) }]);
  const r = exigirCapacidade(adaptadorDaForja('gitlab'), 'abrirPedido')({ host: f.host, repositorio: f.repo, base: 'main', branch: 'ork/ork-x',
    titulo, corpo, executor: SEM_GH, prazoMs: 1000, api: chamadorDaApi(f, { rodar: cli.rodar, logins: new Map() }) });
  assert.equal(r.status, 0, r.stderr);
  const c = cli.chamadas.find(criacao)!;
  const enviado = JSON.parse(c.entrada ?? '') as Record<string, unknown>;
  assert.deepEqual(Object.keys(enviado).sort(), ['description', 'source_branch', 'target_branch', 'title']);
  assert.deepEqual(enviado, { source_branch: 'ork/ork-x', target_branch: 'main', title: titulo, description: corpo });
  assert.ok(!c.args.some((a) => a.includes('outro/repo') || a.includes('xxxx')), 'o corpo e o titulo não tocam o argv');
  assert.ok(c.args.join(' ').includes('Content-Type: application/json'));
  assert.doesNotMatch(c.entrada ?? '', /merge_when_pipeline_succeeds|auto_merge|remove_source_branch|squash/);
});

test('abrirPedido do GitLab que a forja recusa (MR já aberto: 409) devolve a saída de erro, sem repetir a escrita', () => {
  // Sintetico: o corpo do 409 (a mensagem da forja para MR ja aberto nao foi gravada).
  const cli = cliFalsa([{ quando: login, responde: ok('') },
    { quando: (c) => c.args[0] === 'api', responde: http(409, { message: ['Another open merge request already exists for this source branch: !1'] }) }]);
  const r = exigirCapacidade(adaptadorDaForja('gitlab'), 'abrirPedido')({ host: GL.host, repositorio: GL.repo, base: 'main', branch: 'ork/ork-teste',
    titulo: 't', corpo: 'c', executor: SEM_GH, prazoMs: 1000, api: chamadorDaApi(GL, { rodar: cli.rodar, logins: new Map() }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^forja\.conflito: HTTP 409 POST projects\/root%2Fmatriz\/merge_requests/);
  assert.equal(cli.chamadas.filter((c) => c.args[0] === 'api').length, 1);
});

test('sem a API, as capacidades do GitLab dizem sem-capacidade; o caminho do projeto leva os subgrupos codificados', () => {
  const r = exigirCapacidade(adaptadorDaForja('gitlab'), 'pedidosDaBranch')({ host: GL.host, repositorio: GL.repo, base: 'main', branch: 'x',
    executor: SEM_GH, prazoMs: 1000 });
  assert.match(r.erro ?? '', /^forja\.sem-capacidade/);
  const a = exigirCapacidade(adaptadorDaForja('gitlab'), 'abrirPedido')({ host: GL.host, repositorio: GL.repo, base: 'main', branch: 'x',
    titulo: 't', corpo: 'c', executor: SEM_GH, prazoMs: 1000 });
  assert.equal(a.status, 1);
  assert.equal(projetoNaApi('grupo/sub/app'), 'projects/grupo%2Fsub%2Fapp');
  assert.throws(() => prDoMr({ ...MR(), state: 'desconhecido' }, 'main'), /MR fora do formato/);
});
