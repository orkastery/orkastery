import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as os from 'node:os';
import { chamarApi, lerSaidaHttp, limiteBaixo, paginarApi, proximaPagina, temLogin } from '../src/forja/api';
import { msg } from '../src/locale';
import { api, cabecalhosGravados, cliFalsa, falhou, http, login, ok, respostaGravada, saidaHttp } from './forja-cli-falsa';

const GL = { tipo: 'gitlab' as const, host: 'gitlab.empresa.com', porta: 8443, caminhoBase: '/gitlab', ca: null };
const GH = { tipo: 'github' as const, host: 'github.com', porta: null, caminhoBase: '', ca: null };
const AGORA = Date.parse('2026-10-13T12:00:00Z');

test('lerSaidaHttp lê o envelope do -i com os cabeçalhos gravados do GitHub e do GitLab', () => {
  const gh = lerSaidaHttp(respostaGravada('github/2026-10-cabecalhos/check-runs').stdout)!;
  assert.equal(gh.status, 200);
  assert.deepEqual(gh.cabecalhos, cabecalhosGravados('github/2026-10-cabecalhos/check-runs'));
  assert.equal((JSON.parse(gh.corpo) as { check_runs: unknown[] }).check_runs.length > 0, true);
  const gl = lerSaidaHttp(respostaGravada('gitlab/19.4-cabecalhos/mr-list').stdout)!;
  assert.equal(gl.cabecalhos['x-next-page'], '');
  assert.match(gl.cabecalhos.link, /rel="first"/);
  // Sem cabecalho nenhum, a linha vazia vem logo depois da linha de status.
  assert.deepEqual(lerSaidaHttp('HTTP/1.1 204 No Content\n\r\n'), { status: 204, cabecalhos: {}, corpo: '' });
  assert.equal(lerSaidaHttp('{"message":"sem envelope"}'), null);
});

test('glab: a resposta gravada da 19.4 volta com status e corpo; host por GITLAB_HOST=host:porta, ambiente reduzido, diretório neutro', () => {
  const cli = cliFalsa([{ quando: login, responde: ok('') }, { quando: api('metadata'), responde: respostaGravada('gitlab/19.4-cabecalhos/metadata') }]);
  const r = chamarApi(GL, { metodo: 'GET', caminho: 'metadata' }, { rodar: cli.rodar, logins: new Map() });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.valor.status, 200);
  assert.equal((r.valor.corpo as { version: string }).version, '19.4.2');
  assert.equal(r.valor.cabecalhos['x-request-id'], cabecalhosGravados('gitlab/19.4-cabecalhos/metadata')['x-request-id']);
  // O GitLab local gravado nao manda RateLimit-*: a cota fica desconhecida, nunca zero.
  assert.deepEqual(r.valor.limite, { restante: null, total: null, reiniciaEm: null });
  assert.deepEqual(cli.chamadas.find(login)!.args, ['auth', 'status', '--hostname', 'gitlab.empresa.com:8443']);
  const chamada = cli.chamadas.find((c) => c.args[0] === 'api')!;
  assert.equal(chamada.cmd, 'glab');
  assert.ok(!chamada.args.includes('--hostname'));
  assert.equal(chamada.acrescentar?.GITLAB_HOST, 'gitlab.empresa.com:8443');
  assert.equal(chamada.reduzido, true);
  assert.equal(chamada.cwd, os.tmpdir());
});

test('a cota do GitHub sai dos cabeçalhos gravados', () => {
  const r = chamarApi(GH, { metodo: 'GET', caminho: 'repos/o/r/commits/x/check-runs' },
    { rodar: cliFalsa([{ quando: () => true, responde: respostaGravada('github/2026-10-cabecalhos/check-runs') }]).rodar });
  assert.ok(r.ok);
  assert.deepEqual(r.valor.limite, { restante: 4979, total: 5000, reiniciaEm: new Date(1791933886 * 1000).toISOString() });
  assert.equal(limiteBaixo(r.valor.limite), false);
  assert.equal(r.valor.cabecalhos['x-oauth-scopes'], 'gist, read:org, repo, workflow');
});

test('glab sem login no host: forja.sem-login e nenhum pedido à API (o glab faria o pedido anônimo)', () => {
  const cli = cliFalsa([{ quando: login, responde: falhou('x 127.0.0.1:8930 has not been authenticated with glab') }]);
  const r = chamarApi(GL, { metodo: 'GET', caminho: 'metadata' }, { rodar: cli.rodar, logins: new Map() });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.erro.codigo, 'forja.sem-login');
  assert.equal(cli.chamadas.filter((c) => c.args[0] === 'api').length, 0);
});

test('o login do glab é conferido uma vez por host no processo; o gh não confere (recusa sozinho, sem pedido)', () => {
  const cli = cliFalsa([{ quando: login, responde: ok('') }, { quando: api('metadata'), responde: respostaGravada('gitlab/19.4-cabecalhos/metadata') },
    { quando: api('meta'), responde: http(200, {}) }]);
  const logins = new Map<string, boolean>();
  chamarApi(GL, { metodo: 'GET', caminho: 'metadata' }, { rodar: cli.rodar, logins });
  chamarApi(GL, { metodo: 'GET', caminho: 'metadata' }, { rodar: cli.rodar, logins });
  chamarApi(GH, { metodo: 'GET', caminho: 'meta' }, { rodar: cli.rodar, logins });
  assert.equal(cli.chamadas.filter(login).length, 1);
  assert.equal(cli.chamadas.filter((c) => c.args[0] === 'api').length, 3);
});

test('temLogin pergunta à CLI do tipo, com o host certo', () => {
  const cli = cliFalsa([{ quando: login, responde: ok('') }]);
  assert.equal(temLogin({ ...GH, host: 'ghe.empresa.com', porta: 8443 }, cli.rodar), true);
  assert.deepEqual(cli.chamadas[0].args, ['auth', 'status']);
  assert.equal(cli.chamadas[0].acrescentar?.GH_HOST, 'ghe.empresa.com:8443');
  assert.equal(temLogin(GL, cliFalsa([{ quando: login, responde: falhou('not authenticated') }]).rodar), false);
});

test('o corpo da escrita vai pelo stdin, nunca pelo argv', () => {
  const cli = cliFalsa([{ quando: (c) => c.args[0] === 'api', responde: http(201, { number: 7 }) }]);
  const corpo = { title: '--repo=outro/repo', body: 'x'.repeat(70 * 1024) };
  const r = chamarApi(GH, { metodo: 'POST', caminho: 'repos/o/r/pulls', corpo }, { rodar: cli.rodar });
  assert.ok(r.ok);
  const c = cli.chamadas[0];
  assert.deepEqual(c.args.slice(0, 3), ['api', '--hostname', 'github.com']);
  assert.deepEqual(c.args.slice(-2), ['--input', '-']);
  assert.ok(!c.args.some((a) => a.includes('outro/repo')));
  assert.equal(c.entrada, JSON.stringify(corpo));
});

const porStatus: Array<[number, Record<string, string>, string]> = [
  [401, {}, 'forja.sem-login'],
  [403, {}, 'forja.sem-permissao'],
  [403, { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': '1791933869' }, 'forja.limite'],
  [404, {}, 'forja.nao-achei'],
  [409, {}, 'forja.conflito'],
  [422, {}, 'forja.pedido-recusado'],
  [429, { 'Retry-After': '120' }, 'forja.limite'],
  [502, {}, 'forja.indisponivel'],
];
for (const [status, cabecalhos, codigo] of porStatus) {
  test(`HTTP ${status}${Object.keys(cabecalhos).length ? ' com cota' : ''} vira ${codigo}`, () => {
    const cli = cliFalsa([{ quando: (c) => c.args[0] === 'api', responde: http(status, { message: '404 Project Not Found' }, cabecalhos) }]);
    const r = chamarApi(GH, { metodo: 'POST', caminho: 'repos/o/r/pulls', corpo: {} }, { rodar: cli.rodar, agoraMs: () => AGORA });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.erro.codigo, codigo);
    assert.match(!r.ok ? r.erro.detalhe : '', new RegExp(`^HTTP ${status} POST repos/o/r/pulls: 404 Project Not Found$`));
  });
}

test('forja.limite carrega tentarEm: do Retry-After, e do reset da cota', () => {
  const pelo = (cabecalhos: Record<string, string>, status: number) => {
    const r = chamarApi(GH, { metodo: 'POST', caminho: 'x', corpo: {} }, { rodar: cliFalsa([{ quando: () => true, responde: http(status, {}, cabecalhos) }]).rodar,
      agoraMs: () => AGORA });
    return !r.ok ? r.erro.tentarEm : 'ok';
  };
  assert.equal(pelo({ 'Retry-After': '120' }, 429), new Date(AGORA + 120_000).toISOString());
  assert.equal(pelo({ 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': '1791933869' }, 403), new Date(1791933869 * 1000).toISOString());
  assert.equal(pelo({ 'Ratelimit-Reset': '1791933869' }, 429), new Date(1791933869 * 1000).toISOString());
  // A cota primaria esgotada do GitHub: os cabecalhos gravados, com `x-ratelimit-remaining` zerado.
  const gravado403 = cabecalhosGravados('github/2026-10-cabecalhos/check-runs');
  const esgotada = chamarApi(GH, { metodo: 'POST', caminho: 'x', corpo: {} }, { agoraMs: () => AGORA,
    rodar: () => ({ status: 1, stdout: saidaHttp(403, { message: 'API rate limit exceeded' }, { ...gravado403, 'x-ratelimit-remaining': '0' }), stderr: '' }) });
  assert.equal(!esgotada.ok && esgotada.erro.codigo, 'forja.limite');
  assert.equal(!esgotada.ok && esgotada.erro.tentarEm, new Date(Number(gravado403['x-ratelimit-reset']) * 1000).toISOString());
});

test('falha antes do HTTP (TLS, DNS) é indisponível, com o detalhe redigido', () => {
  const token = 'glpat-' + 'a'.repeat(20);
  const cli = cliFalsa([{ quando: () => true, responde: falhou(`Get "https://h/api/v4/x": x509: certificate signed by unknown authority ${token}`) }]);
  const r = chamarApi(GH, { metodo: 'GET', caminho: 'x' }, { rodar: cli.rodar });
  assert.equal(!r.ok && r.erro.codigo, 'forja.indisponivel');
  assert.doesNotMatch(!r.ok ? r.erro.detalhe : '', /a{20}/);
  const semLogin = chamarApi(GH, { metodo: 'GET', caminho: 'x' }, { rodar: cliFalsa([{ quando: () => true,
    responde: { status: 4, stdout: 'To get started with GitHub CLI, please run:  gh auth login\n', stderr: '' } }]).rodar });
  assert.equal(!semLogin.ok && semLogin.erro.codigo, 'forja.sem-login');
});

test('CLI ausente, prazo estourado e 200 sem JSON', () => {
  const com = (saida: Parameters<typeof cliFalsa>[0][0]['responde']) => chamarApi(GH, { metodo: 'GET', caminho: 'x' },
    { rodar: cliFalsa([{ quando: () => true, responde: saida }]).rodar });
  const ausente = com({ status: null, stdout: '', stderr: '', erro: 'ENOENT' });
  assert.equal(!ausente.ok && ausente.erro.codigo, 'forja.ausente');
  const prazo = com({ status: null, stdout: '', stderr: '', sinal: 'SIGTERM', erro: 'ETIMEDOUT' });
  assert.equal(!prazo.ok && prazo.erro.codigo, 'forja.indisponivel');
  const html = com(http(200, '<html>login</html>'));
  assert.equal(!html.ok && html.erro.codigo, 'forja.resposta-invalida');
  const vazio = com(http(204, ''));
  assert.ok(vazio.ok && vazio.valor.corpo === null);
});

test('429 em leitura: espera o tentarEm uma vez e repete', () => {
  let n = 0;
  const esperas: number[] = [];
  const rodar = () => (++n === 1 ? http(429, {}, { 'Retry-After': '2' }) : http(200, { ok: true }));
  const r = chamarApi(GH, { metodo: 'GET', caminho: 'x' }, { rodar, agoraMs: () => AGORA, esperar: (ms) => esperas.push(ms) });
  assert.ok(r.ok);
  assert.equal(n, 2);
  assert.deepEqual(esperas, [2000]);
});

test('429 duas vezes em leitura: forja.limite, sem terceira tentativa', () => {
  let n = 0;
  const r = chamarApi(GH, { metodo: 'GET', caminho: 'x' }, { rodar: () => { n++; return http(429, {}, { 'Retry-After': '1' }); },
    agoraMs: () => AGORA, esperar: () => undefined });
  assert.equal(!r.ok && r.erro.codigo, 'forja.limite');
  assert.equal(n, 2);
});

test('429 com espera acima de 60 s não espera, e escrita nunca se repete', () => {
  let n = 0;
  const esperas: number[] = [];
  const opcoes = { rodar: () => { n++; return http(429, {}, { 'Retry-After': '600' }); }, agoraMs: () => AGORA, esperar: (ms: number) => esperas.push(ms) };
  chamarApi(GH, { metodo: 'GET', caminho: 'x' }, opcoes);
  assert.equal(n, 1);
  n = 0;
  chamarApi(GH, { metodo: 'POST', caminho: 'x', corpo: {} }, { ...opcoes, rodar: () => { n++; return http(429, {}, { 'Retry-After': '1' }); } });
  assert.equal(n, 1);
  assert.deepEqual(esperas, []);
});

test('limiteBaixo: abaixo de 10 % do total', () => {
  assert.equal(limiteBaixo({ restante: 59, total: 600, reiniciaEm: null }), true);
  assert.equal(limiteBaixo({ restante: 60, total: 600, reiniciaEm: null }), false);
  assert.equal(limiteBaixo({ restante: null, total: 600, reiniciaEm: null }), false);
});

/**
 * Uma forja que pagina `total` itens de 100, com os cabecalhos gravados (GitHub ou GitLab 19.4) e, quando ha proxima, o
 * `Link` `rel="next"` do GitHub ou o `x-next-page` do GitLab. A gravacao real so tem uma pagina; a proxima e o que muda.
 */
function paginada(total: number, estilo: 'link' | 'x-next-page'): { rodar: ReturnType<typeof cliFalsa>['rodar']; caminhos: string[] } {
  const caminhos: string[] = [];
  return { caminhos, rodar: (c) => {
    const caminho = c.args.find((a) => a.startsWith('repos/') || a.startsWith('projects/'))!;
    caminhos.push(caminho);
    const pagina = Number(/[?&]page=(\d+)/.exec(caminho)?.[1] ?? '1');
    const itens = Array.from({ length: Math.max(0, Math.min(100, total - (pagina - 1) * 100)) }, (_, i) => ({ id: (pagina - 1) * 100 + i }));
    const ha = pagina * 100 < total;
    const gravados = estilo === 'link' ? cabecalhosGravados('github/2026-10-cabecalhos/statuses') : cabecalhosGravados('gitlab/19.4-cabecalhos/mr-list');
    const proxima: Record<string, string> = !ha ? {} : estilo === 'link'
      ? { link: `<https://api.github.com/x?per_page=100&page=${pagina + 1}>; rel="next", <https://api.github.com/x?page=99>; rel="last"` }
      : { 'x-next-page': String(pagina + 1) };
    return http(200, itens, { ...gravados, ...proxima });
  } };
}

test('paginarApi segue o Link rel=next pelo número da página e mantém a consulta do caminho', () => {
  const f = paginada(250, 'link');
  const r = paginarApi(GH, { caminho: 'repos/o/r/commits/abc/statuses?state=success' }, { rodar: f.rodar });
  assert.ok(r.ok);
  assert.equal(r.valor.itens.length, 250);
  assert.equal(r.valor.paginas, 3);
  assert.deepEqual(f.caminhos, [1, 2, 3].map((n) => `repos/o/r/commits/abc/statuses?state=success&per_page=100&page=${n}`));
});

test('paginarApi segue o x-next-page do GitLab', () => {
  const f = paginada(101, 'x-next-page');
  const r = paginarApi({ ...GL, caminhoBase: '' }, { caminho: 'projects/1/merge_requests?state=all' },
    { rodar: (c) => (login(c) ? ok('') : f.rodar(c)), logins: new Map() });
  assert.ok(r.ok);
  assert.equal(r.valor.itens.length, 101);
});

test('mais de 10 páginas é forja.incompleto, nunca a lista curta', () => {
  const r = paginarApi(GH, { caminho: 'repos/o/r/x' }, { rodar: paginada(5000, 'link').rodar });
  assert.equal(!r.ok && r.erro.codigo, 'forja.incompleto');
});

test('Link next sem número de página e página fora do formato são resposta inválida, não fim da lista', () => {
  const sem = paginarApi(GH, { caminho: 'repos/o/r/x' }, { rodar: () => http(200, [], { Link: '<https://api.github.com/x?cursor=abc>; rel="next"' }) });
  assert.equal(!sem.ok && sem.erro.codigo, 'forja.resposta-invalida');
  const fora = paginarApi(GH, { caminho: 'repos/o/r/x' }, { rodar: () => http(200, { check_runs: [] }) });
  assert.equal(!fora.ok && fora.erro.codigo, 'forja.resposta-invalida');
  const extraida = paginarApi(GH, { caminho: 'repos/o/r/x', itens: (c) => ((c as { check_runs?: unknown[] }).check_runs ?? null) },
    { rodar: () => http(200, { check_runs: [{ id: 1 }] }) });
  assert.ok(extraida.ok && extraida.valor.itens.length === 1);
});

test('os cabeçalhos gravados de uma página só encerram a lista: GitLab (Link first/last, x-next-page vazio) e GitHub (sem Link)', () => {
  assert.equal(proximaPagina(cabecalhosGravados('gitlab/19.4-cabecalhos/mr-list')), null);
  assert.equal(proximaPagina(cabecalhosGravados('gitlab/19.4-cabecalhos/statuses')), null);
  assert.equal(proximaPagina(cabecalhosGravados('github/2026-10-cabecalhos/statuses')), null);
  const r = paginarApi({ ...GL, porta: null, caminhoBase: '' }, { caminho: 'projects/root%2Fmatriz/merge_requests?state=all' },
    { rodar: (c) => (login(c) ? ok('') : respostaGravada('gitlab/19.4-cabecalhos/mr-list')), logins: new Map() });
  assert.ok(r.ok && r.valor.paginas === 1 && r.valor.itens.length === 1);
});

test('proximaPagina: Link, x-next-page vazio e ausência', () => {
  assert.equal(proximaPagina({ link: '<https://h/api/v4/x?page=3&per_page=100>; rel="next"' }), 3);
  assert.equal(proximaPagina({ 'x-next-page': '' }), null);
  assert.equal(proximaPagina({}), null);
  assert.equal(proximaPagina({ link: '<https://h/x?after=abc>; rel="next"' }), 'sem-numero');
});

test('o motivo do erro sai do catálogo nas duas línguas; o 404 do GitLab lembra do projeto privado', () => {
  const e = { codigo: 'forja.nao-achei', detalhe: 'HTTP 404 GET projects/g%2Fp: 404 Project Not Found' };
  assert.match(msg('pt-BR').forja.motivo(e, 'gitlab'), /^forja\.nao-achei: .*privado/);
  assert.match(msg('en').forja.motivo(e, 'gitlab'), /^forja\.nao-achei: .*private/);
  assert.doesNotMatch(msg('pt-BR').forja.motivo(e, 'github'), /privado/);
  assert.match(msg('pt-BR').forja.motivo({ codigo: 'forja.limite', detalhe: 'HTTP 429 GET x', tentarEm: '2026-10-13T10:00:00.000Z' }, null),
    /2026-10-13T10:00:00\.000Z/);
  assert.match(msg('en').forja.motivo({ codigo: 'forja.desconhecida', detalhe: 'git.empresa.com' }, null), /forja\.tipo/);
});

test('Link com vírgula na URL do next: segue a página, e next sem número nunca encerra a lista', () => {
  const link = '<https://api.github.com/x?labels=a,b&per_page=100&page=2>; rel="next", <https://api.github.com/x?labels=a,b&page=5>; rel="last"';
  assert.equal(proximaPagina({ link }), 2);
  assert.equal(proximaPagina({ link: '<https://api.github.com/x?labels=a,b&after=abc>; rel="next"' }), 'sem-numero');
  assert.equal(proximaPagina({ link: '<https://h/x?page=1>; rel="first", <https://h/x?page=3>; rel="last"' }), null);
  let n = 0;
  const r = paginarApi(GH, { caminho: 'repos/o/r/issues?labels=a,b' }, { rodar: () => (++n === 1
    ? http(200, [{ id: 1 }], { Link: '<https://api.github.com/x?labels=a,b&after=abc>; rel="next"' }) : http(200, [])) });
  assert.equal(!r.ok && r.erro.codigo, 'forja.resposta-invalida');
});

test('limite secundário do GitHub: 403 com cota sobrando e mensagem de rate limit é forja.limite, com tentarEm em 60 s', () => {
  const r = chamarApi(GH, { metodo: 'POST', caminho: 'x', corpo: {} }, { agoraMs: () => AGORA, rodar: () =>
    http(403, { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' },
      { 'X-Ratelimit-Remaining': '4000', 'X-Ratelimit-Reset': '1791933869' }) });
  assert.equal(!r.ok && r.erro.codigo, 'forja.limite');
  assert.equal(!r.ok && r.erro.tentarEm, new Date(AGORA + 60_000).toISOString());
  const proibido = chamarApi(GH, { metodo: 'POST', caminho: 'x', corpo: {} }, { agoraMs: () => AGORA, rodar: () =>
    http(403, { message: 'Resource not accessible by integration' }, { 'X-Ratelimit-Remaining': '4000' }) });
  assert.equal(!proibido.ok && proibido.erro.codigo, 'forja.sem-permissao');
});

test('saída acima do teto (ENOBUFS, que também mata com SIGTERM) é resposta inválida, com o detalhe redigido', () => {
  const token = 'ghp_' + 'b'.repeat(36);
  const r = chamarApi(GH, { metodo: 'GET', caminho: `repos/o/r/x?t=${token}` },
    { rodar: () => ({ status: null, stdout: '', stderr: '', sinal: 'SIGTERM', erro: 'ENOBUFS' }) });
  assert.equal(!r.ok && r.erro.codigo, 'forja.resposta-invalida');
  assert.match(!r.ok ? r.erro.detalhe : '', /repos\/o\/r\/x/);
  assert.doesNotMatch(!r.ok ? r.erro.detalhe : '', /b{36}/);
});

test('JSON inválido e paginação: o detalhe passa pelo detalheSeguro', () => {
  const token = 'glpat-' + 'c'.repeat(20);
  const json = chamarApi(GH, { metodo: 'GET', caminho: `x?t=${token}` }, { rodar: () => http(200, '<html>') });
  assert.equal(!json.ok && json.erro.codigo, 'forja.resposta-invalida');
  assert.doesNotMatch(!json.ok ? json.erro.detalhe : '', /c{20}/);
  const lista = paginarApi(GH, { caminho: `repos/o/r/x?t=${token}` }, { rodar: () => http(200, {}) });
  assert.equal(!lista.ok && lista.erro.codigo, 'forja.resposta-invalida');
  assert.doesNotMatch(!lista.ok ? lista.erro.detalhe : '', /c{20}/);
});

test('o glab: login que falhou não fica guardado; o que passou, sim', () => {
  let tentativas = 0;
  const cli = cliFalsa([{ quando: login, responde: () => (++tentativas === 1 ? falhou('connection reset') : ok('')) },
    { quando: api('metadata'), responde: respostaGravada('gitlab/19.4-cabecalhos/metadata') }]);
  const logins = new Map<string, boolean>();
  const primeira = chamarApi(GL, { metodo: 'GET', caminho: 'metadata' }, { rodar: cli.rodar, logins });
  assert.equal(!primeira.ok && primeira.erro.codigo, 'forja.sem-login');
  assert.ok(chamarApi(GL, { metodo: 'GET', caminho: 'metadata' }, { rodar: cli.rodar, logins }).ok);
  assert.ok(chamarApi(GL, { metodo: 'GET', caminho: 'metadata' }, { rodar: cli.rodar, logins }).ok);
  assert.equal(cli.chamadas.filter(login).length, 2);
});

test('caminho que começa com - é recusado antes de rodar a CLI', () => {
  const cli = cliFalsa([{ quando: () => true, responde: ok('') }]);
  for (const f of [GH, GL]) {
    const r = chamarApi(f, { metodo: 'GET', caminho: '--hostname=outro.com' }, { rodar: cli.rodar, logins: new Map() });
    assert.equal(!r.ok && r.erro.codigo, 'forja.pedido-recusado');
  }
  assert.equal(cli.chamadas.length, 0);
});

test('lerSaidaHttp lê a linha de status do gh (HTTP/2.0 200 OK)', () => {
  assert.deepEqual(lerSaidaHttp('HTTP/2.0 200 OK\nContent-Type: application/json\r\n\r\n{"a":1}'),
    { status: 200, cabecalhos: { 'content-type': 'application/json' }, corpo: '{"a":1}' });
});
