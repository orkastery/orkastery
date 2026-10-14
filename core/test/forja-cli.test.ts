import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ambienteReduzido, rodarCli } from '../src/forja/executor';
import { CLI_DA_FORJA, hostDaApi, versaoAbaixo } from '../src/forja/cli';
import { chamadorDaApi } from '../src/forja/api';
import { lerDaForja } from '../src/forja';
import { cliFalsa, falhou, login, ok } from './forja-cli-falsa';

const GL = { tipo: 'gitlab' as const, host: 'gitlab.empresa.com', porta: 8443, caminhoBase: '/gitlab', ca: '/etc/pki/empresa.pem' };
const GHE = { tipo: 'github' as const, host: 'ghe.empresa.com', porta: 8443, caminhoBase: '', ca: '/etc/pki/empresa.pem' };

test('glab: a API por GITLAB_HOST=host:porta, sem o caminho base e nunca com --hostname; a CA por GLAB_CA_CERT', () => {
  const cli = CLI_DA_FORJA.gitlab;
  assert.equal(cli.cmd, 'glab');
  assert.deepEqual(cli.api(GL, 'GET', 'metadata', false), ['api', '-i', '--method', 'GET', 'metadata']);
  // Medido: sem o Content-Type, o GitLab ignora o corpo do `--input -`.
  assert.deepEqual(cli.api(GL, 'POST', 'projects/1/merge_requests', true), ['api', '-i', '--method', 'POST', 'projects/1/merge_requests',
    '-H', 'Content-Type: application/json', '--input', '-']);
  assert.ok(!cli.api(GL, 'GET', 'x', false).includes('--hostname'));
  const amb = cli.ambiente(GL);
  // Medido: o glab guarda o login de `H/sub` como `H` (com subfolder) e acrescenta `/sub/api/v4` sozinho.
  assert.equal(amb.acrescentar.GITLAB_HOST, 'gitlab.empresa.com:8443');
  assert.equal(amb.acrescentar.GLAB_CA_CERT, '/etc/pki/empresa.pem');
  assert.equal(amb.acrescentar.GLAB_CHECK_UPDATE, 'false');
  assert.equal(amb.acrescentar.GLAB_SEND_TELEMETRY, 'false');
  assert.ok(amb.apagar.includes('GITLAB_URI') && amb.apagar.includes('GITLAB_API_HOST'));
  assert.ok(!amb.apagar.includes('GITLAB_HOST'));
  assert.equal(cli.loginAntes, true);
});

test('glab: o auth status pela chave (host:porta, sem caminho base); o login da pessoa leva o caminho base e o protocolo', () => {
  const cli = CLI_DA_FORJA.gitlab;
  assert.deepEqual(cli.login(GL), ['auth', 'status', '--hostname', 'gitlab.empresa.com:8443']);
  assert.deepEqual(cli.entrar(GL, false), ['glab', 'auth', 'login', '--hostname', 'gitlab.empresa.com:8443/gitlab', '--stdin']);
  assert.deepEqual(cli.entrar({ ...GL, porta: null, caminhoBase: '' }, true),
    ['glab', 'auth', 'login', '--hostname', 'gitlab.empresa.com', '--api-protocol', 'http', '--stdin']);
  assert.deepEqual(CLI_DA_FORJA.github.entrar(GHE, false), ['GH_HOST=ghe.empresa.com:8443', 'gh', 'auth', 'login']);
  assert.deepEqual(CLI_DA_FORJA.github.entrar({ ...GHE, porta: null }, false), ['gh', 'auth', 'login', '--hostname', 'ghe.empresa.com']);
});

test('gh com porta: o host por GH_HOST, sem --hostname (o gh recusa host:porta), e o GH_HOST fica no ambiente', () => {
  const cli = CLI_DA_FORJA.github;
  assert.deepEqual(cli.api(GHE, 'POST', 'repos/o/r/pulls', true), ['api', '-i', '--method', 'POST',
    '-H', 'Accept: application/vnd.github+json', 'repos/o/r/pulls', '--input', '-']);
  assert.deepEqual(cli.login(GHE), ['auth', 'status']);
  const amb = cli.ambiente(GHE);
  assert.equal(amb.acrescentar.GH_HOST, 'ghe.empresa.com:8443');
  assert.ok(!amb.apagar.includes('GH_HOST'));
  assert.equal(amb.acrescentar.SSL_CERT_FILE, '/etc/pki/empresa.pem');
  assert.equal(cli.ambiente({ ...GHE, ca: null }).acrescentar.SSL_CERT_FILE, undefined);
  assert.equal(cli.loginAntes, false);
});

test('gh sem porta: --hostname, como hoje, e o GH_HOST herdado é apagado', () => {
  const cli = CLI_DA_FORJA.github, sem = { ...GHE, porta: null };
  assert.deepEqual(cli.api(sem, 'GET', 'meta', false), ['api', '--hostname', 'ghe.empresa.com', '-i', '--method', 'GET',
    '-H', 'Accept: application/vnd.github+json', 'meta']);
  assert.deepEqual(cli.login(sem), ['auth', 'status', '--hostname', 'ghe.empresa.com']);
  assert.equal(cli.ambiente(sem).acrescentar.GH_HOST, undefined);
  assert.ok(cli.ambiente(sem).apagar.includes('GH_HOST'));
});

test('a leitura GraphQL do GitLab de hoje (lerDaForja) manda o Content-Type junto do corpo e o host por GITLAB_HOST', () => {
  const cli = cliFalsa([{ quando: login, responde: ok('') }, { quando: (c) => c.args.includes('graphql'), responde: falhou('HTTP 404') }]);
  lerDaForja({ tipo: 'gitlab', host: 'gitlab.com', repo: 'grupo/app' }, { desde: '2026-10-13T00:00:00.000Z', dirRoadmap: 'docs/roadmap',
    manifesto: 'orkastery.yaml', reservas: { branch: 'ork/roadmap-reservas', dir: 'reservas' }, fabrica: { branch: 'ork/fabrica-estado', dir: 'maquinas' } },
  undefined, chamadorDaApi({ tipo: 'gitlab', host: 'gitlab.com', porta: null, caminhoBase: '', ca: null }, { rodar: cli.rodar, logins: new Map() }));
  const consulta = cli.chamadas.find((c) => c.args.includes('graphql'))!;
  assert.deepEqual(consulta.args, ['api', '-i', '--method', 'POST', 'graphql', '-H', 'Content-Type: application/json', '--input', '-']);
  assert.equal(consulta.acrescentar?.GITLAB_HOST, 'gitlab.com');
});

test('a porta 443 não entra no host da API', () => {
  assert.equal(hostDaApi({ host: 'gitlab.com', porta: null }), 'gitlab.com');
  assert.equal(hostDaApi({ host: 'gitlab.com', porta: 443 }), 'gitlab.com');
  assert.equal(hostDaApi({ host: 'h.empresa.com', porta: 8443 }), 'h.empresa.com:8443');
});

test('versões mínimas: gh 2.18.0 e glab 1.121.0, as medidas', () => {
  assert.equal(CLI_DA_FORJA.github.minima, '2.18.0');
  assert.equal(CLI_DA_FORJA.gitlab.minima, '1.121.0');
  assert.equal(CLI_DA_FORJA.github.lerVersao('gh version 2.102.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.102.0\n'), '2.102.0');
  assert.equal(CLI_DA_FORJA.gitlab.lerVersao('glab 1.121.0 (4d447cc6c)\n'), '1.121.0');
  assert.equal(CLI_DA_FORJA.gitlab.lerVersao('glab version 1.36.0 (2024-01-10)\n'), '1.36.0');
  assert.equal(CLI_DA_FORJA.gitlab.lerVersao('qualquer coisa'), null);
  assert.equal(versaoAbaixo('2.4.0', '2.18.0'), true);
  assert.equal(versaoAbaixo('2.17.9', '2.18.0'), true);
  assert.equal(versaoAbaixo('2.18.0', '2.18.0'), false);
  assert.equal(versaoAbaixo('2.102.0', '2.18.0'), false);
  assert.equal(versaoAbaixo('1.120.5', '1.121.0'), true);
});

test('ambiente reduzido: passam PATH, HOME, o keyring e as variáveis da CLI; o resto do ambiente fica', () => {
  const env = { PATH: '/bin', HOME: '/home/x', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus', GH_TOKEN: 't', GITLAB_TOKEN: 't',
    GLAB_CONFIG_DIR: '/c', HTTPS_PROXY: 'http://p:3128', SEGREDO_DO_PROJETO: 's', ANTHROPIC_API_KEY: 'k', NODE_OPTIONS: '--x' };
  assert.deepEqual(Object.keys(ambienteReduzido(env)).sort(),
    ['DBUS_SESSION_BUS_ADDRESS', 'GH_TOKEN', 'GITLAB_TOKEN', 'GLAB_CONFIG_DIR', 'HOME', 'HTTPS_PROXY', 'PATH']);
});

test('rodarCli com ambiente reduzido e diretório neutro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cli-'));
  fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\nprintf "SEGREDO=%s TOKEN=%s CWD=%s" "$SEGREDO_DO_PROJETO" "$GH_TOKEN" "$(pwd -P)"\n', { mode: 0o755 });
  const salvo = { PATH: process.env.PATH, SEGREDO_DO_PROJETO: process.env.SEGREDO_DO_PROJETO, GH_TOKEN: process.env.GH_TOKEN };
  process.env.PATH = `${dir}:${salvo.PATH}`; process.env.SEGREDO_DO_PROJETO = 'nao-passa'; process.env.GH_TOKEN = 'passa';
  try {
    const r = rodarCli({ cmd: 'gh', args: [], prazoMs: 5000, maxBuffer: 1024 * 1024, reduzido: true, cwd: os.tmpdir(),
      acrescentar: { ORK_BINARIOS_EXTRA: '' } });
    assert.equal(r.stdout, `SEGREDO= TOKEN=passa CWD=${fs.realpathSync(os.tmpdir())}`);
  } finally {
    for (const [k, v] of Object.entries(salvo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
