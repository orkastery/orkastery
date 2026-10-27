import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checar, doctorJson } from '../src/doctor';
import { checarForja } from '../src/doctor-forja';
import type { ManifestoCarregado } from '../src/manifest';
import type { Check } from '../src/types';
import { spawnSync } from 'node:child_process';
import { envPtBr, projetoTemporario } from './apoio';
import { api, falhou, gravado, http, login, ok, versao } from './forja-cli-falsa';
import { cliGithub, cliGitlab, linha, projeto, sondas } from './forja-doctor-apoio';

const NOMES = ['forja identidade', 'forja alcance', 'forja tls', 'forja cli', 'forja login', 'forja servidor', 'forja escopo',
  'forja projeto', 'forja capacidades'];

test('GitLab CE 19.2 gravado: CLI, login, servidor testado, escopo api e mensagem de merge padrão aceita', () => {
  const cli = cliGitlab('19.2');
  const checks = checarForja(projeto({ exigida: true }), sondas({ rodar: cli.rodar }));
  assert.deepEqual(checks.map((c) => c.nome), NOMES);
  assert.equal(linha(checks, 'forja cli')!.detalhe, 'glab 1.121.0 (mínimo 1.121.0)');
  assert.equal(linha(checks, 'forja login')!.detalhe, 'glab com login em gitlab.empresa.com');
  assert.equal(linha(checks, 'forja servidor')!.detalhe, '19.2.7 CE, faixa testada');
  assert.equal(linha(checks, 'forja escopo')!.detalhe, 'escopos do token: api');
  const p = linha(checks, 'forja projeto')!;
  assert.equal(p.nivel, 'ok');
  assert.equal(p.detalhe, 'merge merge; squash default_off; merged results não disponível nesta edição; merge train não disponível nesta edição');
  const cap = linha(checks, 'forja capacidades')!;
  assert.equal(cap.nivel, 'ok', 'o checksNoCommit é do executor do gh; o GitLab lê a CI pelo estadoDeCi');
  assert.match(cap.detalhe, /estadoDeCi, pedidoMesclado, branchPadrao, pontaDaBranch, comparar, pedidosDaBranch, abrirPedido, metadados, pedidosAbertos, donoDaRede$/);
  assert.doesNotMatch(cap.detalhe, /checksNoCommit|desligadas/);
  assert.equal(checks.filter((c) => c.nivel === 'fail').length, 0);
  // Um `auth status` so: as chamadas da API reusam o login conferido.
  assert.equal(cli.chamadas.filter(login).length, 1);
  assert.deepEqual(cli.chamadas.find(login)!.args, ['auth', 'status', '--hostname', 'gitlab.empresa.com']);
});

test('GitLab CE 16.11 gravado: o servidor abaixo do piso reprova e encerra a seção', () => {
  const checks = checarForja(projeto({ exigida: true }), sondas({ rodar: cliGitlab('16.11').rodar }));
  const s = linha(checks, 'forja servidor')!;
  assert.equal(s.nivel, 'fail');
  assert.equal(s.detalhe, '16.11.10 abaixo do piso 17.0: o ork não opera esta versão');
  assert.match(s.correcao ?? '', /17\.0/);
  assert.equal(linha(checks, 'forja escopo'), undefined);
  assert.equal(linha(checarForja(projeto(), sondas({ rodar: cliGitlab('16.11').rodar })), 'forja servidor')!.nivel, 'warn');
});

test('GitLab CE 17.0 gravado: faixa compatível, sem reprovar', () => {
  const checks = checarForja(projeto({ exigida: true }), sondas({ rodar: cliGitlab('17.0').rodar }));
  assert.equal(linha(checks, 'forja servidor')!.detalhe, '17.0.8 CE, faixa compatível');
  assert.equal(linha(checks, 'forja servidor')!.nivel, 'ok');
});

test('glab abaixo do mínimo ou ausente reprova e para antes do login', () => {
  const velho = cliGitlab('19.2', [{ quando: versao, responde: ok('glab 1.100.0 (abc)\n') }]);
  const checks = checarForja(projeto({ exigida: true }), sondas({ rodar: velho.rodar }));
  assert.equal(linha(checks, 'forja cli')!.nivel, 'fail');
  assert.equal(linha(checks, 'forja cli')!.detalhe, 'glab 1.100.0 abaixo do mínimo 1.121.0');
  assert.equal(linha(checks, 'forja login'), undefined);
  assert.equal(velho.chamadas.filter(login).length, 0);
  const ausente = cliGitlab('19.2', [{ quando: versao, responde: { status: null, stdout: '', stderr: '', erro: 'ENOENT' } }]);
  assert.match(linha(checarForja(projeto({ exigida: true }), sondas({ rodar: ausente.rodar })), 'forja cli')!.detalhe, /não está instalado/);
});

test('sem login no host: reprova com o comando de login, e nenhuma chamada à API', () => {
  const sem = cliGitlab('19.2', [{ quando: login, responde: falhou('has not been authenticated with glab') }]);
  const checks = checarForja(projeto({ exigida: true }), sondas({ rodar: sem.rodar }));
  const l = linha(checks, 'forja login')!;
  assert.equal(l.nivel, 'fail');
  assert.equal(l.correcao, 'rode glab auth login --hostname gitlab.empresa.com --stdin');
  const comBase = checarForja(projeto({ forja: { tipo: 'gitlab', caminho_base: '/gitlab' } }),
    sondas({ url: 'https://gitlab.empresa.com:8443/gitlab/root/matriz.git', rodar: sem.rodar }));
  assert.equal(linha(comBase, 'forja login')!.correcao, 'rode glab auth login --hostname gitlab.empresa.com:8443/gitlab --stdin');
  assert.deepEqual(sem.chamadas.filter(login).at(-1)!.args, ['auth', 'status', '--hostname', 'gitlab.empresa.com:8443']);
  assert.equal(sem.chamadas.filter((c) => c.args[0] === 'api').length, 0);
});

test('caminho base: o subcaminho confere o metadata, com GITLAB_HOST sem a base (o glab a acrescenta pelo login)', () => {
  const cli = cliGitlab('19.2');
  const checks = checarForja(projeto({ forja: { tipo: 'gitlab', caminho_base: '/gitlab' } }),
    sondas({ url: 'https://gitlab.empresa.com/gitlab/root/matriz.git', rodar: cli.rodar }));
  assert.equal(linha(checks, 'forja subcaminho')!.detalhe, '/gitlab/api/v4/metadata responde');
  assert.equal(cli.chamadas.find(api('metadata'))!.acrescentar?.GITLAB_HOST, 'gitlab.empresa.com');
  const fora = cliGitlab('19.2', [{ quando: api('metadata'), responde: http(404, { message: '404 Not Found' }) }]);
  const semBase = checarForja(projeto({ forja: { tipo: 'gitlab', caminho_base: '/gitlab' } }),
    sondas({ url: 'https://gitlab.empresa.com/gitlab/root/matriz.git', rodar: fora.rodar }));
  assert.equal(linha(semBase, 'forja subcaminho')!.nivel, 'fail');
  assert.equal(linha(semBase, 'forja servidor'), undefined);
});

test('escopo: token sem api nem read_api reprova; token sem self (OAuth) não é medível', () => {
  const token = gravado('gitlab/19.2/token') as Record<string, unknown>;
  const leitura = cliGitlab('19.2', [{ quando: api('personal_access_tokens/self'), responde: http(200, { ...token, scopes: ['read_repository'] }) }]);
  const e = linha(checarForja(projeto({ exigida: true }), sondas({ rodar: leitura.rodar })), 'forja escopo')!;
  assert.equal(e.nivel, 'fail');
  assert.match(e.detalhe, /read_repository/);
  const oauth = cliGitlab('19.2', [{ quando: api('personal_access_tokens/self'), responde: http(404, { message: '404 Not Found' }) }]);
  const n = linha(checarForja(projeto({ exigida: true }), sondas({ rodar: oauth.rodar })), 'forja escopo')!;
  assert.equal(n.nivel, 'warn');
  assert.match(n.detalhe, /^não medível: forja\.nao-achei/);
});

test('projeto: fast-forward e squash sempre avisam; mensagem padrão ou %{title} não avisa; projeto não lido reprova', () => {
  const base = gravado('gitlab/19.2/projeto') as Record<string, unknown>;
  const com = (projetoGravado: Record<string, unknown>) => linha(checarForja(projeto({ exigida: true }), sondas({ rodar: cliGitlab('19.2',
    [{ quando: api('projects/root%2Fmatriz'), responde: http(200, projetoGravado) }]).rodar })), 'forja projeto')!;
  const ff = com({ ...base, merge_method: 'ff' });
  assert.match(ff.detalhe, /fast-forward/);
  assert.match(com({ ...base, squash_option: 'always', merge_commit_template: '%{title}\n\n%{description}' }).detalhe, /squash always: /);
  assert.equal(com({ ...base, merge_commit_template: null }).nivel, 'ok');
  const certo = com({ ...base, merge_commit_template: '%{title}\n\nSee merge request %{reference}' });
  assert.equal(certo.nivel, 'ok');
  const privado = checarForja(projeto({ exigida: true }), sondas({ rodar: cliGitlab('19.2',
    [{ quando: api('projects/root%2Fmatriz'), responde: http(404, { message: '404 Project Not Found' }) }]).rodar }));
  assert.equal(linha(privado, 'forja projeto')!.nivel, 'fail');
  assert.match(linha(privado, 'forja projeto')!.detalhe, /projeto privado sem acesso também responde 404/);
});

test('GitHub github.com: escopos do x-oauth-scopes, o repositório gravado e todas as capacidades ligadas', () => {
  const checks = checarForja(projeto({ exigida: true }), sondas({ url: 'https://github.com/orkastery/orkastery.git', rodar: cliGithub().rodar }));
  assert.deepEqual(checks.map((c) => c.nome), NOMES);
  assert.equal(checks.filter((c) => c.nivel !== 'ok').length, 0, JSON.stringify(checks.filter((c) => c.nivel !== 'ok')));
  assert.equal(linha(checks, 'forja servidor')!.detalhe, 'github.com');
  assert.equal(linha(checks, 'forja escopo')!.detalhe, 'escopos do token: gist, read:org, repo, workflow');
  assert.equal(linha(checks, 'forja projeto')!.detalhe, 'merge commit permitido; squash permitido; rebase permitido');
  assert.match(linha(checks, 'forja capacidades')!.detalhe, /^ligadas: checksNoCommit, .*metadados, pedidosAbertos, donoDaRede$/);
});

test('GitHub: gh 2.17 não tem headRefOid e reprova; token fine-grained não é medível', () => {
  const velho = cliGithub([{ quando: versao, responde: ok('gh version 2.17.0 (2022-10-04)\n') }]);
  const cli = linha(checarForja(projeto({ exigida: true }), sondas({ url: 'https://github.com/orkastery/orkastery.git', rodar: velho.rodar })), 'forja cli')!;
  assert.equal(cli.nivel, 'fail');
  assert.equal(cli.detalhe, 'gh 2.17.0 abaixo do mínimo 2.18.0');
  const fino = cliGithub([{ quando: api('rate_limit'), responde: http(200, { resources: {} }) }]);
  const e = linha(checarForja(projeto(), sondas({ url: 'https://github.com/orkastery/orkastery.git', rodar: fino.rodar })), 'forja escopo')!;
  assert.equal(e.nivel, 'ok');
  assert.match(e.detalhe, /fine-grained/);
});

test('o doctor liga a seção só com o manifesto válido', () => {
  const p = projetoTemporario('doctor-forja-ligado', false);
  try {
    let chamadas = 0;
    const forja = (c: ManifestoCarregado): Check[] => { chamadas++; return [{ nome: 'forja identidade', nivel: 'fail', detalhe: `teste ${c.manifesto.project.name}` }]; };
    const semCrontab = () => ({ ok: false as const, motivo: 'crontab -l falhou: no crontab for teste' });
    const auth = () => ({ ok: false, detalhe: 'claude auth status: loggedIn false' });
    const sem = checar(p.dir, [], semCrontab, auth);
    const com = checar(p.dir, [], semCrontab, auth, undefined, forja);
    assert.equal(chamadas, 1);
    assert.deepEqual(com.filter((c) => !c.nome.startsWith('forja ')).map((c) => c.nome), sem.map((c) => c.nome));
    assert.ok(com.some((c) => c.nome === 'forja identidade' && c.nivel === 'fail' && c.detalhe === 'teste orkastery'));
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nforja: gitlab\n');
    const invalido = checar(p.dir, [], semCrontab, auth, undefined, forja);
    assert.equal(chamadas, 1);
    assert.equal(invalido.some((c) => c.nome.startsWith('forja ')), false);
  } finally { p.limpar(); }
});

test('doctor --json: sem a seção, forja nao-medida; com ela, medida', () => {
  const p = projetoTemporario('doctor-forja-json', false);
  try {
    const semCrontab = () => ({ ok: false as const, motivo: 'crontab -l falhou: no crontab for teste' });
    const sem = doctorJson(p.dir, [], undefined, semCrontab).json;
    assert.equal(sem.forja, 'nao-medida');
    assert.equal(sem.checks.some((c) => c.nome.startsWith('forja ')), false);
    const com = doctorJson(p.dir, [], undefined, semCrontab, () => [{ nome: 'forja identidade', nivel: 'ok', detalhe: 'x' }]).json;
    assert.equal(com.forja, 'medida');
    assert.ok(com.checks.some((c) => c.nome === 'forja identidade'));
  } finally { p.limpar(); }
});

test('escopo com o SHIP do MCP em forja-https: read_api sem write_repository reprova; com write_repository ou api, passa', () => {
  const token = gravado('gitlab/19.2/token') as Record<string, unknown>;
  const com = (scopes: string[], transporte: string | null) => {
    const cli = cliGitlab('19.2', [{ quando: api('personal_access_tokens/self'), responde: http(200, { ...token, scopes }) }]);
    return linha(checarForja(projeto({ exigida: true }), { ...sondas({ rodar: cli.rodar }), transporteDoShip: () => transporte }), 'forja escopo')!;
  };
  const semEscrita = com(['read_api'], 'forja-https');
  assert.equal(semEscrita.nivel, 'fail');
  assert.match(semEscrita.detalhe, /write_repository/);
  assert.equal(com(['read_api', 'write_repository'], 'forja-https').nivel, 'ok');
  assert.equal(com(['api'], 'forja-https').nivel, 'ok');
  assert.equal(com(['read_api'], 'forja-ssh').nivel, 'ok', 'o forja-ssh empurra pela chave, não pelo token');
  assert.equal(com(['read_api'], null).nivel, 'ok');
});

test('doctor --forja com valor é recusado na linha de comando, nunca vira nao-medida calado', () => {
  const p = projetoTemporario('doctor-forja-valor', false);
  try {
    const cli = path.resolve(__dirname, '../../dist/index.js');
    for (const flag of ['--forja=false', '--forja=sim']) {
      const r = spawnSync(process.execPath, [cli, 'doctor', '--json', flag], { cwd: p.dir, encoding: 'utf8', env: { ...envPtBr(), ORK_FABRICA_PUBLICAR: '0' } });
      assert.equal(r.status, 2, `${flag}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /ork doctor --forja não leva valor/);
      assert.equal(r.stdout, '');
    }
  } finally { p.limpar(); }
});
