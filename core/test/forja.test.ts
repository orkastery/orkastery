/**
 * RM-054 (fatia 1): a forja lida sem clone e so com consulta.
 *
 * Nenhum teste toca a rede: o executor da CLI da forja e trocado por respostas gravadas no formato
 * que `gh api graphql` e `glab api` devolvem. O que se prova: a identidade sai do remoto sem a
 * credencial; o GitHub custa UMA chamada e o GitLab usa a mesma saida; nenhuma consulta tem
 * mutation; nenhum token vai para argv; o erro sai tipado e redigido; resposta fora do formato vira
 * erro, nunca lista vazia.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chamadorDaApi } from '../src/forja/api';
import { cliFalsa, falhou, gravado as respostaGravada, http, login, ok as okCli } from './forja-cli-falsa';
import { classificarFalha, detalheSeguro, ExecutorDaForja, forjaDoArgumento, identidadeDaForja, lerDaForja, mesmaForja,
  PedidoDaForja, rotuloDaForja, SaidaDoExecutor } from '../src/forja';

const PEDIDO: PedidoDaForja = {
  desde: '2026-09-29T02:00:00.000Z', dirRoadmap: 'docs/roadmap', manifesto: 'orkastery.yaml',
  reservas: { branch: 'ork/roadmap-reservas', dir: 'reservas' }, fabrica: { branch: 'ork/fabrica-estado', dir: 'maquinas' },
  lidoEm: '2026-09-29T23:10:00.000Z',
};
const SHA_BASE = 'a'.repeat(40), SHA_RESERVAS = 'b'.repeat(40), SHA_FABRICA = 'c'.repeat(40);

function gravado(respostas: SaidaDoExecutor[]) {
  const chamadas: { cmd: string; args: string[]; entrada: string }[] = [];
  const executor: ExecutorDaForja = (cmd, args, entrada) => {
    chamadas.push({ cmd, args: [...args], entrada });
    return respostas.shift() ?? { status: 1, stdout: '', stderr: 'sem resposta gravada' };
  };
  return { executor, chamadas };
}

const ok = (json: unknown): SaidaDoExecutor => ({ status: 0, stdout: JSON.stringify(json), stderr: '' });
const blob = (name: string, text: string | null, extra: Record<string, unknown> = {}) =>
  ({ name, type: 'blob', object: { text, isBinary: text === null, isTruncated: false, ...extra } });

function respostaDoGithub(opcoes: { semReservas?: boolean; parcial?: boolean } = {}) {
  return { data: { repository: {
    base: { name: 'main', target: { oid: SHA_BASE, committedDate: '2026-09-29T11:49:15Z',
      roadmap: { object: { entries: [blob('README.md', '# indice'), blob('RM-001-um.md', '---\nid: RM-001\n---\n'),
        blob('logo.png', null), { name: 'sub', type: 'tree', object: {} }] } },
      manifesto: { object: { text: 'project:\n  name: "orkastery"\n', isBinary: false, isTruncated: false } },
      history: { pageInfo: { hasNextPage: opcoes.parcial === true }, nodes: [
        { oid: SHA_BASE, messageHeadline: 'ship(ork-x): merge de a em main', committedDate: '2026-09-29T11:49:15Z' }] } } },
    reservas: opcoes.semReservas ? null : { name: 'ork/roadmap-reservas', target: { oid: SHA_RESERVAS, committedDate: '2026-09-29T16:32:33Z',
      arquivos: { object: { entries: [blob('RM-001.json', '{"contrato":"ork.roadmap-reserva/v1"}')] } } } },
    fabrica: { name: 'ork/fabrica-estado', target: { oid: SHA_FABRICA, committedDate: '2026-09-29T23:00:08Z',
      arquivos: { object: { entries: [blob('vps.json', '{"contrato":"ork.fabrica-maquina/v1"}')] } } } },
  } } };
}

test('forja: identidade do remoto para GitHub e GitLab, sem a credencial', () => {
  const casos: [string, string | null][] = [
    ['https://github.com/orkastery/orkastery.git', 'github github.com orkastery/orkastery'],
    ['https://github.com/orkastery/orkastery', 'github github.com orkastery/orkastery'],
    ['git@github.com:orkastery/orkastery.git', 'github github.com orkastery/orkastery'],
    ['ssh://git@github.com:22/orkastery/orkastery.git', 'github github.com orkastery/orkastery'],
    ['https://julio:ghp_segredo123@github.com/Orkastery/Orkastery.git/', 'github github.com Orkastery/Orkastery'],
    ['https://github.empresa.com.br/time/app.git', 'github github.empresa.com.br time/app'],
    ['https://gitlab.com/grupo/sub/projeto.git', 'gitlab gitlab.com grupo/sub/projeto'],
    ['git@gitlab.exemplo.org:grupo/projeto.git', 'gitlab gitlab.exemplo.org grupo/projeto'],
    ['/tmp/ork-test-origin-abc', null],
    ['file:///tmp/origin.git', null],
    ['https://bitbucket.org/dono/repo.git', null],
    ['https://github.com/so-o-dono', null],
    ['https://github.com/dono/repo/extra', null],
    ['C:\\repos\\app', null],
  ];
  for (const [url, esperado] of casos) {
    const f = identidadeDaForja(url);
    assert.equal(f ? `${f.tipo} ${f.host} ${f.repo}` : null, esperado, url);
    if (f) assert.doesNotMatch(JSON.stringify(f), /segredo|julio/, 'a credencial da URL nunca entra na identidade');
  }
  assert.deepEqual(forjaDoArgumento('github:orkastery/orkastery'), { tipo: 'github', host: 'github.com', repo: 'orkastery/orkastery' });
  assert.deepEqual(forjaDoArgumento('gitlab:grupo/sub/projeto'), { tipo: 'gitlab', host: 'gitlab.com', repo: 'grupo/sub/projeto' });
  assert.deepEqual(forjaDoArgumento('gitlab:gitlab.exemplo.org/grupo/projeto'), { tipo: 'gitlab', host: 'gitlab.exemplo.org', repo: 'grupo/projeto' });
  assert.deepEqual(forjaDoArgumento('https://github.com/orkastery/orkastery'), { tipo: 'github', host: 'github.com', repo: 'orkastery/orkastery' });
  // Nome solto ou dono/repo sem prefixo nao e forja: quem resolve e o registro de projetos (nunca chuta).
  assert.equal(forjaDoArgumento('orkastery'), null);
  assert.equal(forjaDoArgumento('orkastery/orkastery'), null);
  assert.equal(forjaDoArgumento('github:../etc/passwd'), null);
  assert.equal(rotuloDaForja(forjaDoArgumento('github:orkastery/orkastery')!), 'github.com/orkastery/orkastery');
  assert.ok(mesmaForja(identidadeDaForja('git@github.com:Orkastery/Orkastery.git'), forjaDoArgumento('github:orkastery/orkastery')));
  assert.ok(!mesmaForja(null, forjaDoArgumento('github:orkastery/orkastery')));
});

test('forja: leitura GitHub em uma consulta GraphQL, sem mutation', () => {
  const { executor, chamadas } = gravado([ok(respostaDoGithub())]);
  const r = lerDaForja(forjaDoArgumento('github:orkastery/orkastery')!, PEDIDO, executor);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(chamadas.length, 1, 'uma chamada so');
  assert.equal(chamadas[0].cmd, 'gh');
  assert.deepEqual(chamadas[0].args, ['api', 'graphql', '--method', 'POST', '--input', '-', '--hostname', 'github.com']);
  const corpo = JSON.parse(chamadas[0].entrada) as { query: string; variables: Record<string, string> };
  assert.doesNotMatch(corpo.query, /mutation/i);
  assert.match(corpo.query, /base: defaultBranchRef/, 'sem base conhecida vale a branch padrao');
  assert.deepEqual([corpo.variables.owner, corpo.variables.name, corpo.variables.refReservas, corpo.variables.dirFabrica],
    ['orkastery', 'orkastery', 'refs/heads/ork/roadmap-reservas', 'maquinas']);
  const l = r.leitura;
  assert.equal(l.chamadas, 1);
  assert.equal(l.lidoEm, PEDIDO.lidoEm);
  assert.deepEqual([l.base!.ref, l.base!.commit, l.base!.dataDoCommit], ['main', SHA_BASE, '2026-09-29T11:49:15Z']);
  assert.deepEqual(l.base!.arquivos!.map((a) => [a.caminho, a.texto === null]),
    [['docs/roadmap/README.md', false], ['docs/roadmap/RM-001-um.md', false], ['docs/roadmap/logo.png', true]],
    'subdiretorio fica de fora; binario chega sem texto');
  assert.match(l.base!.manifesto!, /name: "orkastery"/);
  assert.deepEqual(l.base!.commits, [{ commit: SHA_BASE, assunto: 'ship(ork-x): merge de a em main', data: '2026-09-29T11:49:15Z' }]);
  assert.equal(l.base!.commitsParciais, false);
  assert.deepEqual([l.reservas!.commit, l.reservas!.arquivos!.map((a) => a.caminho)], [SHA_RESERVAS, ['reservas/RM-001.json']]);
  assert.deepEqual([l.fabrica!.commit, l.fabrica!.arquivos!.map((a) => a.caminho)], [SHA_FABRICA, ['maquinas/vps.json']]);

  // Base conhecida vai por variavel; host proprio vai em --hostname; branch ausente e null, nao lista vazia.
  const outro = gravado([ok(respostaDoGithub({ semReservas: true, parcial: true }))]);
  const r2 = lerDaForja({ tipo: 'github', host: 'github.empresa.com.br', repo: 'time/app' }, { ...PEDIDO, base: 'main' }, outro.executor);
  assert.ok(r2.ok);
  assert.deepEqual(outro.chamadas[0].args, ['api', 'graphql', '--method', 'POST', '--input', '-', '--hostname', 'github.empresa.com.br']);
  const corpo2 = JSON.parse(outro.chamadas[0].entrada) as { query: string; variables: Record<string, string> };
  assert.match(corpo2.query, /base: ref\(qualifiedName: \$base\)/);
  assert.equal(corpo2.variables.base, 'refs/heads/main');
  assert.equal(r2.leitura.reservas, null);
  assert.equal(r2.leitura.base!.commitsParciais, true, 'mais de 100 commits na janela fica declarado');
});

const ALVO_GITLAB = { tipo: 'gitlab' as const, host: '127.0.0.1', porta: null, caminhoBase: '', ca: null };

/** O GitLab gravado (19.4 e 17.0): `time/sub/app` com o roadmap, a fabrica e sem a branch de reservas. */
function gitlabGravado(versao: string) {
  const v = `gitlab/${versao}`;
  return cliFalsa([{ quando: login, responde: okCli('') },
    { quando: (c) => c.args.includes('graphql'), responde: (c) => {
      const q = (JSON.parse(c.entrada ?? '{}') as { query: string }).query;
      return http(200, respostaGravada(`${v}/${q.includes('rootRef') ? 'roadmap-raiz' : q.includes('baseTopo') ? 'roadmap-arvores' : 'roadmap-blobs'}`));
    } },
    { quando: (c) => c.args.some((a) => a.includes('/repository/commits?')), responde: http(200, respostaGravada(`${v}/commits`)) }]);
}

for (const versao of ['19.4', '17.0']) {
  test(`forja: GitLab ${versao} pela mesma interface, só com consulta, pela API da CLI logada`, () => {
    const cli = gitlabGravado(versao);
    const r = lerDaForja({ tipo: 'gitlab', host: '127.0.0.1', repo: 'time/sub/app' }, { ...PEDIDO, desde: '2026-01-01T00:00:00Z' }, undefined,
      chamadorDaApi(ALVO_GITLAB, { rodar: cli.rodar, logins: new Map() }));
    assert.ok(r.ok, JSON.stringify(r));
    const apis = cli.chamadas.filter((c) => c.args[0] === 'api');
    assert.equal(apis.length, 4);
    assert.equal(r.leitura.chamadas, 4);
    // O REST de commits e GET e so le.
    const rest = apis[3];
    assert.deepEqual(rest.args.slice(rest.args.indexOf('--method'), rest.args.indexOf('--method') + 2), ['--method', 'GET']);
    assert.ok(rest.args.some((a) => /^projects\/time%2Fsub%2Fapp\/repository\/commits\?ref_name=[0-9a-f]{40}&since=/.test(a)), rest.args.join(' '));
    // A branch que nao existe nao entra na consulta dos blobs.
    assert.doesNotMatch(JSON.parse(apis[2].entrada!).query, /reservas:/);
    for (const c of apis) {
      assert.equal(c.acrescentar?.GITLAB_HOST, '127.0.0.1');
      assert.ok(!c.args.includes('--hostname'));
    }
    for (const c of apis.filter((x) => x.args.includes('graphql'))) {
      assert.ok(c.args.includes('Content-Type: application/json'));
      assert.doesNotMatch(JSON.parse(c.entrada!).query, /mutation/i);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arvores = respostaGravada(`gitlab/${versao}/roadmap-arvores`) as any;
    const l = r.leitura;
    assert.deepEqual([l.base!.ref, l.base!.commit], ['main', arvores.data.project.repository.baseTopo.lastCommit.sha]);
    assert.deepEqual(l.base!.arquivos!.map((a) => a.caminho), ['docs/roadmap/RM-001-um.md']);
    assert.match(l.base!.manifesto!, /name: "app"/);
    assert.ok(l.base!.commits.some((c) => c.assunto === 'base') && l.base!.commits.every((c) => /^[0-9a-f]{40}$/.test(c.commit)));
    assert.equal(l.reservas, null);
    assert.deepEqual(l.fabrica!.arquivos, [{ caminho: 'maquinas/vps.json', texto: '{"contrato":"ork.fabrica-maquina/v1"}' }]);
  });
}

test('forja: a porta da API vem so de remoto https/http fora da porta do esquema, e a de ssh nunca', () => {
  const chamadasDe = (url: string) => {
    const id = identidadeDaForja(url)!;
    const cli = cliFalsa([{ quando: login, responde: okCli('') }, { quando: (c) => c.args.includes('graphql'), responde: http(200, { data: { project: null } }) }]);
    lerDaForja(id, PEDIDO, undefined, chamadorDaApi({ tipo: 'gitlab', host: id.host, porta: id.porta ?? null, caminhoBase: '', ca: null },
      { rodar: cli.rodar, logins: new Map() }));
    return cli.chamadas;
  };
  const https = chamadasDe('https://gitlab.exemplo.org:8443/time/sub/app.git');
  assert.deepEqual(https.find(login)!.args, ['auth', 'status', '--hostname', 'gitlab.exemplo.org:8443']);
  assert.ok(https.filter((c) => c.args[0] === 'api').every((c) => c.acrescentar?.GITLAB_HOST === 'gitlab.exemplo.org:8443'));
  assert.equal(identidadeDaForja('https://gitlab.exemplo.org:8443/time/sub/app.git')!.porta, 8443);
  for (const url of ['ssh://git@gitlab.exemplo.org:2222/time/sub/app.git', 'https://gitlab.exemplo.org:443/time/sub/app.git', 'https://gitlab.exemplo.org/time/sub/app.git']) {
    assert.equal(identidadeDaForja(url)!.porta, undefined, url);
    const c = chamadasDe(url);
    assert.ok(c.filter((x) => x.args[0] === 'api').every((x) => x.acrescentar?.GITLAB_HOST === 'gitlab.exemplo.org'), url);
  }
  // O GitHub segue como sempre: so o host.
  assert.equal(identidadeDaForja('https://github.com:8443/o/r.git')!.porta, undefined);
});

test('forja: GitLab sem login não faz pedido; projeto sem acesso é forja.nao-achei', () => {
  const sem = cliFalsa([{ quando: login, responde: falhou('x 127.0.0.1 has not been authenticated with glab') }]);
  const r = lerDaForja({ tipo: 'gitlab', host: '127.0.0.1', repo: 'time/sub/app' }, PEDIDO, undefined,
    chamadorDaApi(ALVO_GITLAB, { rodar: sem.rodar, logins: new Map() }));
  assert.equal(!r.ok && r.erro.codigo, 'forja.sem-login');
  assert.equal(sem.chamadas.filter((c) => c.args[0] === 'api').length, 0);
  // Medido no CE 19.4: projeto inexistente ou sem acesso responde 200 com `project: null`.
  const nulo = cliFalsa([{ quando: login, responde: okCli('') }, { quando: (c) => c.args.includes('graphql'), responde: http(200, { data: { project: null } }) }]);
  const r2 = lerDaForja({ tipo: 'gitlab', host: '127.0.0.1', repo: 'time/sub/app' }, PEDIDO, undefined,
    chamadorDaApi(ALVO_GITLAB, { rodar: nulo.rodar, logins: new Map() }));
  assert.equal(!r2.ok && r2.erro.codigo, 'forja.nao-achei');
});

test('forja: erro tipado e sem segredo na saida', () => {
  const forja = forjaDoArgumento('github:orkastery/orkastery')!;
  const ler = (saida: SaidaDoExecutor) => {
    const g = gravado([saida]);
    const r = lerDaForja(forja, PEDIDO, g.executor);
    for (const c of g.chamadas) {
      assert.ok(!c.args.includes('auth') && !c.args.includes('token'), 'nunca gh auth token');
      assert.doesNotMatch(c.args.join(' '), /gh[pousr]_|glpat-|github_pat_/, 'nenhum token em argv');
    }
    assert.equal(r.ok, false);
    return (r as { erro: { codigo: string; detalhe: string } }).erro;
  };
  assert.equal(ler({ status: null, stdout: '', stderr: '', erro: 'ENOENT' }).codigo, 'forja.ausente');
  assert.equal(ler({ status: null, stdout: '', stderr: '', erro: 'ETIMEDOUT', sinal: 'SIGTERM' }).codigo, 'forja.indisponivel');
  assert.equal(ler({ status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' +
    'Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.' }).codigo, 'forja.sem-login');
  const credencial = ler({ status: 1, stdout: '', stderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)\n' +
    'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
  assert.equal(credencial.codigo, 'forja.sem-login');
  assert.doesNotMatch(credencial.detalhe, /ghp_/);
  const naoAchou = ler({ status: 1, stdout: JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND',
    message: "Could not resolve to a Repository with the name 'orkastery/orkastery'." }] }),
    stderr: "gh: Could not resolve to a Repository with the name 'orkastery/orkastery'." });
  assert.equal(naoAchou.codigo, 'forja.nao-achei');
  assert.equal(ler({ status: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' }).codigo, 'forja.indisponivel');
  // Saida que nao e o formato esperado vira erro tipado, nunca lista vazia.
  assert.equal(ler({ status: 0, stdout: 'isto nao e json', stderr: '' }).codigo, 'forja.resposta-invalida');
  assert.equal(ler(ok({ data: { outra: 1 } })).codigo, 'forja.resposta-invalida');
  assert.equal(ler(ok({ data: { repository: { base: { name: 'main', target: { oid: 'curto' } } } } })).codigo, 'forja.resposta-invalida');

  // O detalhe passa pela redacao: tokens do GitHub e do GitLab e credencial em URL nao saem.
  for (const bruto of ['glab: 401 Unauthorized glpat-ABCDEFGHIJKLMNOPQRST', 'erro com github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
    'fatal: https://julio:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git']) {
    const d = detalheSeguro(bruto);
    assert.doesNotMatch(d, /glpat-|github_pat_|ghp_|julio:/, d);
  }
  const semLogin = classificarFalha('glab', { status: 1, stdout: '', stderr: 'glab: 401 Unauthorized glpat-ABCDEFGHIJKLMNOPQRST' });
  assert.equal(semLogin.codigo, 'forja.sem-login');
  assert.doesNotMatch(semLogin.detalhe, /glpat-/);
});

test('forja: host explicito e listagem cortada declarada', () => {
  // GitHub: o host vai sempre, mesmo o github.com; a arvore do GitHub nao pagina.
  const gh = gravado([ok(respostaDoGithub())]);
  const r = lerDaForja(forjaDoArgumento('github:orkastery/orkastery')!, PEDIDO, gh.executor);
  assert.ok(r.ok);
  assert.deepEqual(gh.chamadas[0].args.slice(-2), ['--hostname', 'github.com']);
  assert.deepEqual([r.leitura.base!.parcial, r.leitura.reservas!.parcial, r.leitura.fabrica!.parcial], [false, false, false]);
  // GitLab: conexao com mais pagina e dita parcial, nunca lida como se estivesse inteira.
  const respostas = [
    { data: { project: { repository: {
      baseTopo: { lastCommit: { sha: SHA_BASE, committedDate: '2026-09-29T11:49:15Z' } },
      baseDir: { blobs: { pageInfo: { hasNextPage: true }, nodes: [{ name: 'RM-001-um.md', path: 'docs/roadmap/RM-001-um.md' }] } },
      reservasTopo: { lastCommit: null }, reservasDir: { blobs: { pageInfo: { hasNextPage: false }, nodes: [] } },
      fabricaTopo: { lastCommit: null }, fabricaDir: { blobs: { pageInfo: { hasNextPage: false }, nodes: [] } },
    } } } },
    { data: { project: { repository: {
      base: { pageInfo: { hasNextPage: false }, nodes: [{ path: 'docs/roadmap/RM-001-um.md', rawTextBlob: '---\nid: RM-001\n---\n' }] },
    } } } },
  ];
  const gl = cliFalsa([{ quando: login, responde: okCli('') },
    { quando: (c) => c.args.includes('graphql'), responde: () => http(200, respostas.shift()) },
    { quando: (c) => c.args.some((a) => a.includes('/repository/commits?')), responde: http(200, []) }]);
  const l = lerDaForja({ tipo: 'gitlab', host: 'gitlab.exemplo.org', repo: 'grupo/app' }, { ...PEDIDO, base: 'main' }, undefined,
    chamadorDaApi({ tipo: 'gitlab', host: 'gitlab.exemplo.org', porta: null, caminhoBase: '', ca: null }, { rodar: gl.rodar, logins: new Map() }));
  assert.ok(l.ok, JSON.stringify(l));
  assert.equal(l.leitura.base!.parcial, true);
  const apis = gl.chamadas.filter((c) => c.args[0] === 'api');
  assert.ok(apis.every((c) => c.acrescentar?.GITLAB_HOST === 'gitlab.exemplo.org' && !c.args.includes('--hostname')));
  assert.match(JSON.parse(apis[0].entrada!).query, /blobs\(first: 100\) \{ pageInfo \{ hasNextPage \}/);
});
