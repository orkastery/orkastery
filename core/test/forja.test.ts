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
  assert.deepEqual(chamadas[0].args, ['api', 'graphql', '--method', 'POST', '--input', '-']);
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

test('forja: GitLab pela mesma interface, so com consulta', () => {
  const { executor, chamadas } = gravado([
    ok({ data: { project: { repository: { rootRef: 'main' } } } }),
    ok({ data: { project: { repository: {
      baseTopo: { lastCommit: { sha: SHA_BASE, committedDate: '2026-09-29T11:49:15Z' } },
      baseDir: { blobs: { nodes: [{ name: 'RM-001-um.md', path: 'docs/roadmap/RM-001-um.md' }] } },
      reservasTopo: { lastCommit: null }, reservasDir: { blobs: { nodes: [] } },
      fabricaTopo: { lastCommit: { sha: SHA_FABRICA, committedDate: '2026-09-29T23:00:08Z' } },
      fabricaDir: { blobs: { nodes: [{ name: 'vps.json', path: 'maquinas/vps.json' }] } },
    } } } }),
    ok({ data: { project: { repository: {
      base: { nodes: [{ path: 'docs/roadmap/RM-001-um.md', rawTextBlob: '---\nid: RM-001\n---\n' },
        { path: 'orkastery.yaml', rawTextBlob: 'project:\n  name: "app"\n' }] },
      fabrica: { nodes: [{ path: 'maquinas/vps.json', rawTextBlob: '{"contrato":"ork.fabrica-maquina/v1"}' }] },
    } } } }),
    ok([{ id: SHA_BASE, title: 'ship(ork-y): merge de b em main', committed_date: '2026-09-29T08:49:15-03:00' }]),
  ]);
  const r = lerDaForja(forjaDoArgumento('gitlab:grupo/sub/app')!, PEDIDO, executor);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(chamadas.length, 4);
  assert.ok(chamadas.every((c) => c.cmd === 'glab'));
  for (const c of chamadas.slice(0, 3)) {
    assert.deepEqual(c.args, ['api', 'graphql', '--method', 'POST', '--input', '-']);
    assert.doesNotMatch(JSON.parse(c.entrada).query, /mutation/i);
  }
  // O REST de commits e GET (sem --method) e so le.
  assert.deepEqual(chamadas[3].args.slice(0, 1), ['api']);
  assert.match(chamadas[3].args[1], /^projects\/grupo%2Fsub%2Fapp\/repository\/commits\?ref_name=a{40}&since=/);
  assert.ok(!chamadas[3].args.includes('--method'));
  // A branch que nao existe nao entra na consulta dos blobs.
  assert.doesNotMatch(JSON.parse(chamadas[2].entrada).query, /reservas:/);
  const l = r.leitura;
  assert.equal(l.chamadas, 4);
  assert.deepEqual([l.base!.ref, l.base!.commit, l.base!.arquivos!.map((a) => a.caminho)], ['main', SHA_BASE, ['docs/roadmap/RM-001-um.md']]);
  assert.match(l.base!.manifesto!, /name: "app"/);
  assert.deepEqual(l.base!.commits.map((c) => c.assunto), ['ship(ork-y): merge de b em main']);
  assert.equal(l.reservas, null);
  assert.deepEqual(l.fabrica!.arquivos, [{ caminho: 'maquinas/vps.json', texto: '{"contrato":"ork.fabrica-maquina/v1"}' }]);
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
  assert.equal(ler({ status: null, stdout: '', stderr: '', erro: 'ENOENT' }).codigo, 'forja.sem-cli');
  assert.equal(ler({ status: null, stdout: '', stderr: '', erro: 'ETIMEDOUT', sinal: 'SIGTERM' }).codigo, 'forja.tempo-esgotado');
  assert.equal(ler({ status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' +
    'Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.' }).codigo, 'forja.sem-login');
  const credencial = ler({ status: 1, stdout: '', stderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)\n' +
    'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
  assert.equal(credencial.codigo, 'forja.sem-login');
  assert.doesNotMatch(credencial.detalhe, /ghp_/);
  const naoAchou = ler({ status: 1, stdout: JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND',
    message: "Could not resolve to a Repository with the name 'orkastery/orkastery'." }] }),
    stderr: "gh: Could not resolve to a Repository with the name 'orkastery/orkastery'." });
  assert.equal(naoAchou.codigo, 'forja.nao-encontrado');
  assert.equal(ler({ status: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' }).codigo, 'forja.inacessivel');
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
