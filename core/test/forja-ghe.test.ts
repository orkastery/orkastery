import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ajustarManifesto, comAmbientePtBr, projetoTemporario, shaDaBranch } from './apoio';
import { consultarCi } from '../src/ci';
import { exec } from '../src/util';
import type { SondasDaForja } from '../src/forja/resolver';
import type { OpcoesDaApi } from '../src/forja/api';
import { cliFalsa, falhou, login } from './forja-cli-falsa';
import { CONTRATO_PRS, ExecutorDoGh, gravarRetratoDePrs, lerPrsDaForja, lerRetratoDePrs } from '../src/parado-no-condutor';

/** Sem bloco `forja:`, o GHE e reconhecido pela sonda do gh com login; o glab nao tem login nele. */
const SONDA_GHE: SondasDaForja = { github: () => 'responde', gitlab: () => 'sem-login' };

const verde = JSON.stringify({ check_runs: [{ name: 'ork-verify', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } }] });

function consultar(url: string) {
  const p = projetoTemporario('ci-ghe', false);
  ajustarManifesto(p, 'required_for_ship: false', 'required_for_ship: true');
  p.carregado.manifesto.ci.required_for_ship = true;
  exec('git', ['remote', 'add', 'origin', url], p.carregado.raiz);
  const sha = shaDaBranch(p.carregado.raiz, 'main');
  let host: string | undefined;
  const r = consultarCi(p.carregado, sha, 'origin', (e) => { if (e.caminho?.includes('/statuses')) return { ok: true, code: 0, stderr: '', stdout: '[]' }; host = e.host; return { ok: true, code: 0, stderr: '', stdout: verde }; }, () => true, SONDA_GHE);
  p.limpar();
  return { host, r };
}

test('remoto GitHub Enterprise com porta consulta o host certo', () => {
  const { host, r } = consultar('https://ghe.empresa.com:8443/o/r.git');
  assert.equal(host, 'ghe.empresa.com:8443');
  assert.equal(r.state, 'success');
});

test('remoto ssh.github.com (SSH pela 443) consulta o github.com', () => {
  const { host, r } = consultar('ssh://git@ssh.github.com:443/o/r.git');
  assert.equal(host, 'github.com');
  assert.equal(r.state, 'success');
});

function consultarComLogin(url: string, login: (h: string) => boolean, api: OpcoesDaApi = {}) {
  const p = projetoTemporario('ci-ghe2', false);
  ajustarManifesto(p, 'required_for_ship: false', 'required_for_ship: true');
  p.carregado.manifesto.ci.required_for_ship = true;
  exec('git', ['remote', 'add', 'origin', url], p.carregado.raiz);
  const sha = shaDaBranch(p.carregado.raiz, 'main');
  const hosts: Array<string | undefined> = [];
  const perguntados: string[] = [];
  const r = consultarCi(p.carregado, sha, 'origin', (e) => { if (e.caminho?.includes('/statuses')) return { ok: true, code: 0, stderr: '', stdout: '[]' }; hosts.push(e.host); return { ok: true, code: 0, stderr: '', stdout: verde }; },
    (h) => { perguntados.push(h); return login(h); }, SONDA_GHE, api);
  p.limpar();
  return { hosts, perguntados, r };
}

test('GHE com login no host: host passado e sucesso', () => {
  const { hosts, perguntados, r } = consultarComLogin('https://ghe.empresa.com:8443/o/r.git', () => true);
  assert.deepEqual(hosts, ['ghe.empresa.com:8443']);
  assert.deepEqual(perguntados, ['ghe.empresa.com:8443']);
  assert.equal(r.state, 'success');
});

test('GHE sem login no host: unavailable e o executor nunca roda', () => {
  const { hosts, r } = consultarComLogin('https://ghe.empresa.com/o/r.git', () => false);
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /ghe\.empresa\.com/);
  assert.deepEqual(hosts, []);
});

test('porta fora da faixa: unavailable, sem cair no github.com', () => {
  const { hosts, perguntados, r } = consultarComLogin('https://ghe.empresa.com:99999/o/r.git', () => true);
  assert.equal(r.state, 'unavailable');
  assert.deepEqual(hosts, []);
  assert.deepEqual(perguntados, []);
});

test('remoto do gitlab.com vai à CI do GitLab pelo glab, nunca pelo gh', () => {
  const cli = cliFalsa([{ quando: login, responde: falhou('glab: not logged in') }]);
  const { hosts, perguntados, r } = consultarComLogin('https://gitlab.com/o/r.git', () => true, { rodar: cli.rodar, logins: new Map() });
  assert.deepEqual([r.state, r.provider], ['unavailable', 'gitlab']);
  assert.match(r.detail, /forja\.sem-login/);
  assert.deepEqual(hosts, []);
  assert.deepEqual(perguntados, []);
  assert.deepEqual(cli.chamadas.map((c) => c.cmd), ['glab']);
});

test('github.com nao pergunta login', () => {
  const { perguntados, r } = consultarComLogin('https://github.com/o/r.git', () => false);
  assert.equal(r.state, 'success');
  assert.deepEqual(perguntados, []);
});

test('pulse num GHE com porta própria: o login é conferido no host:porta exato, nunca pelo --hostname sem a porta', () => {
  const p = projetoTemporario('pulse-ghe-porta', false);
  try {
    exec('git', ['remote', 'add', 'origin', 'https://ghe.empresa.com:8443/o/r.git'], p.carregado.raiz);
    const executor: ExecutorDoGh = (args) => { throw new Error(`o gh rodou sem a porta: ${args.join(' ')}`); };
    // O gh tem login em outro host: o `auth status` sem --hostname sai 0, mas a linha do host:porta exato nao aparece.
    const cli = cliFalsa([{ quando: (c) => c.cmd === 'gh' && c.args[0] === 'auth', responde: { status: 0, stdout: '', stderr: 'Logged in to github.com account alguem' } },
      { quando: login, responde: falhou('not logged in') }]);
    const r = lerPrsDaForja(p.carregado, { remoto: 'origin', executor, rodar: cli.rodar });
    assert.equal(r.ok, false);
    const doGh = cli.chamadas.filter((c) => c.cmd === 'gh');
    assert.equal(doGh.length, 1);
    assert.deepEqual(doGh[0].args, ['auth', 'status']);
    assert.equal(doGh[0].acrescentar?.GH_HOST, 'ghe.empresa.com:8443');
  } finally { p.limpar(); }
});

test('pulse num host próprio sem login no gh nem no glab: a frase diz as duas CLIs', () => {
  const p = projetoTemporario('pulse-sem-login-nas-duas', false);
  try {
    exec('git', ['remote', 'add', 'origin', 'https://git.empresa.com/o/r.git'], p.carregado.raiz);
    const executor: ExecutorDoGh = () => ({ status: 1, stdout: '', stderr: 'You are not logged into any accounts on git.empresa.com' });
    const cli = cliFalsa([{ quando: login, responde: falhou('not logged in') }]);
    const r = comAmbientePtBr(() => lerPrsDaForja(p.carregado, { remoto: 'origin', executor, rodar: cli.rodar }));
    assert.match(!r.ok ? r.erro : '', /^o gh não está autenticado em git\.empresa\.com, a forja de origin, e o glab também não$/);
  } finally { p.limpar(); }
});

test('retrato de PRs com segmento .. no caminho do projeto não é lido', () => {
  const p = projetoTemporario('retrato-ponto-ponto', false);
  try {
    const base = { contrato: CONTRATO_PRS, lidoEm: '2026-10-02T13:15:00.000Z', base: 'main', parcial: false, prs: [] };
    gravarRetratoDePrs(p.dir, { ...base, repositorio: 'grupo/sub/app' });
    assert.equal(lerRetratoDePrs(p.dir)?.repositorio, 'grupo/sub/app');
    gravarRetratoDePrs(p.dir, { ...base, repositorio: 'grupo/../app' });
    assert.equal(lerRetratoDePrs(p.dir), null);
  } finally { p.limpar(); }
});
