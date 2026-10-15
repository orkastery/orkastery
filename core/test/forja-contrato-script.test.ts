import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/forja-contrato.cjs');
const SHA = 'a'.repeat(40);
const GH_TOKEN = 'ghp_' + 'a'.repeat(36);

/** Regra da CLI falsa: o trecho `padrao` casa em "$*" (os argumentos da chamada). */
type Regra = { padrao: string; corpo?: unknown; bruto?: string; stderr?: string; codigo?: number };

/**
 * CLI falsa no PATH. Escolhe a resposta pelo caminho da API ("$*"): cada regra vira um `case`.
 * Corpos e erros vao para arquivos, para nao haver citacao de shell no conteudo.
 */
function cliFalso(bin: string, cli: string, regras: Regra[]): void {
  const dados = path.join(bin, `${cli}-dados`);
  fs.mkdirSync(dados, { recursive: true });
  const linhas = ['#!/bin/sh', 'case "$*" in'];
  regras.forEach((r, i) => {
    if (r.stderr !== undefined) {
      const f = path.join(dados, `${i}.txt`);
      fs.writeFileSync(f, r.stderr);
      linhas.push(`  *${r.padrao}*) cat '${f}' >&2; exit ${r.codigo ?? 1} ;;`);
    } else {
      const f = path.join(dados, `${i}.json`);
      fs.writeFileSync(f, r.bruto ?? JSON.stringify(r.corpo ?? {}));
      linhas.push(`  *${r.padrao}*) cat '${f}'; exit ${r.codigo ?? 0} ;;`);
    }
  });
  linhas.push("  *) printf '%s' '{}' ;;", 'esac');
  fs.writeFileSync(path.join(bin, cli), linhas.join('\n') + '\n', { mode: 0o755 });
}

function sandbox(): { bin: string; saida: string } {
  return {
    bin: fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bin-')),
    saida: fs.mkdtempSync(path.join(os.tmpdir(), 'forja-saida-')),
  };
}

function rodar(bin: string, args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

const argsGithub = (saida: string) => ['--forja', 'github', '--host', 'github.com', '--repo', 'o/r', '--sha', SHA, '--saida', saida];
const argsGitlab = (saida: string) => ['--forja', 'gitlab', '--host', 'gitlab.example.com', '--repo', 'grupo/proj', '--sha', SHA, '--saida', saida];

test('grava cada caso com o corpo redigido e o comando sem token', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo: { total_count: 1, check_runs: [{ name: 'ork-verify', output: { text: GH_TOKEN } }] } }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  const arquivo = path.join(saida, 'check-runs.json');
  const gravado = fs.readFileSync(arquivo, 'utf8');
  assert.doesNotMatch(gravado, /ghp_a{36}/);
  assert.match(gravado, /\[redigido\]/);
  assert.equal((fs.statSync(arquivo).mode & 0o777), 0o600);
});

test('recusa forja desconhecida sem gravar nada', () => {
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-saida-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--forja', 'gitea', '--host', 'h', '--repo', 'o/r', '--sha', SHA,
    '--saida', saida], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.deepEqual(fs.readdirSync(saida), []);
});

test('caminho de erro: CLI que sai com erro grava status e erro redigidos, com saida 1', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', codigo: 1,
    stderr: `gh: falha com ${GH_TOKEN} e https://u:senha@h.example/o/r.git` }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 1, r.stderr);
  const arquivo = path.join(saida, 'check-runs.json');
  const gravado = fs.readFileSync(arquivo, 'utf8');
  const caso = JSON.parse(gravado);
  assert.notEqual(caso.status, 0);
  assert.equal(typeof caso.erro, 'string');
  assert.match(caso.erro, /\[redigido\]/);
  assert.doesNotMatch(gravado, /ghp_a{36}/);
  assert.doesNotMatch(gravado, /senha/);
  assert.equal((fs.statSync(arquivo).mode & 0o777), 0o600);
});

test('ramo GitLab: usa o glab e grava os casos com o contrato do roteiro', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'glab', [{ padrao: 'metadata', corpo: { version: '17.0.0', enterprise: false } }]);
  const r = rodar(bin, argsGitlab(saida));
  assert.equal(r.status, 0, r.stderr);
  const caso = JSON.parse(fs.readFileSync(path.join(saida, 'metadata.json'), 'utf8'));
  assert.equal(caso.forja, 'gitlab');
  assert.equal(caso.host, 'gitlab.example.com');
  assert.equal(caso.comando[0], 'glab');
  assert.equal(caso.status, 0);
  assert.equal(caso.corpo.version, '17.0.0');
  assert.ok(fs.existsSync(path.join(saida, 'projeto.json')));
});

test('redige cada familia de segredo num corpo gravado e preserva URL com porta e e-mail', () => {
  const { bin, saida } = sandbox();
  const corpo = {
    gl: 'glpat-abcdefghijklmnop',
    gl_roteavel: 'glpat-abcdefgh.01.ijklmnop',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJhc2lnbmF0dXJh',
    url_cred: 'https://user:senha@host.example.com/repo.git',
    url_porta: 'https://host:8443',
    email: 'a@b',
    nested: { lista: [GH_TOKEN] },
  };
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  const gravado = fs.readFileSync(path.join(saida, 'check-runs.json'), 'utf8');
  for (const segredo of ['abcdefghijklmnop', 'ijklmnop', 'eyJhbGci', 'senha', 'ghp_a', 'user:']) {
    assert.doesNotMatch(gravado, new RegExp(segredo), `vazou: ${segredo}`);
  }
  const lido = JSON.parse(gravado).corpo;
  assert.equal(lido.gl, '[redigido]');
  assert.equal(lido.gl_roteavel, '[redigido]');
  assert.equal(lido.jwt, '[redigido]');
  assert.equal(lido.url_cred, 'https://[redigido]@host.example.com/repo.git');
  assert.equal(lido.url_porta, 'https://host:8443');
  assert.equal(lido.email, 'a@b');
  assert.equal(lido.nested.lista[0], '[redigido]');
});

test('comando gravado nao contem token', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo: {} }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  const caso = JSON.parse(fs.readFileSync(path.join(saida, 'check-runs.json'), 'utf8'));
  assert.ok(Array.isArray(caso.comando));
  for (const arg of caso.comando) assert.doesNotMatch(arg, /ghp_|glpat-|eyJ|senha/);
});

test('arquivo de caso existente com modo 644 fica com 600', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo: { ok: true } }]);
  const arquivo = path.join(saida, 'check-runs.json');
  fs.writeFileSync(arquivo, 'antigo', { mode: 0o644 });
  fs.chmodSync(arquivo, 0o644);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  assert.equal((fs.statSync(arquivo).mode & 0o777), 0o600);
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).corpo.ok, true);
});

test('GitLab: redige runners_token (chave *_token) e token de runner glrt- em qualquer chave', () => {
  const { bin, saida } = sandbox();
  const runner = 'GR1348941' + 'x'.repeat(20);
  const novo = 'glrt-' + 'y'.repeat(24);
  cliFalso(bin, 'glab', [{ padrao: 'projects/grupo%2Fproj', corpo: { id: 7, runners_token: runner, access_token: 'qualquer', nota: novo,
    expires_at: '2026-10-14', ativo: true } }]);
  const r = rodar(bin, argsGitlab(saida));
  assert.equal(r.status, 0, r.stderr);
  const gravado = fs.readFileSync(path.join(saida, 'projeto.json'), 'utf8');
  assert.doesNotMatch(gravado, /GR1348941/);
  assert.doesNotMatch(gravado, /glrt-/);
  assert.doesNotMatch(gravado, /qualquer/);
  const corpo = JSON.parse(gravado).corpo;
  assert.equal(corpo.runners_token, '[redigido]');
  assert.equal(corpo.access_token, '[redigido]');
  assert.equal(corpo.nota, '[redigido]');
  assert.equal(corpo.id, 7);
  assert.equal(corpo.expires_at, '2026-10-14');
  assert.equal(corpo.ativo, true);
});

test('--incluir-cabecalhos: passa -i, grava status_http, cabecalhos e corpo, e redige os cabecalhos sensiveis', () => {
  const { bin, saida } = sandbox();
  const bruto = ['HTTP/2.0 200 OK', 'Content-Type: application/json', 'X-Gitlab-Feature-Category: team_planning',
    'Authorization: Bearer segredo-um', 'PRIVATE-TOKEN: segredo-dois', 'Set-Cookie: _gitlab_session=segredo-tres; path=/',
    `X-Vazou: valor ${GH_TOKEN}`, 'Etag: W/"abc"', '', JSON.stringify({ version: '19.4.2', corpo_token: GH_TOKEN })].join('\r\n');
  cliFalso(bin, 'glab', [{ padrao: 'metadata', bruto }, { padrao: 'hostname', bruto }]);
  const r = rodar(bin, [...argsGitlab(saida), '--incluir-cabecalhos']);
  assert.equal(r.status, 0, r.stderr);
  const arquivo = path.join(saida, 'metadata.json');
  const gravado = fs.readFileSync(arquivo, 'utf8');
  for (const segredo of ['segredo-um', 'segredo-dois', 'segredo-tres', 'ghp_a']) {
    assert.doesNotMatch(gravado, new RegExp(segredo), `vazou: ${segredo}`);
  }
  const caso = JSON.parse(gravado);
  assert.equal(caso.comando[1], 'api');
  assert.ok(caso.comando.includes('-i'));
  assert.equal(caso.status_http, 200);
  assert.equal(caso.cabecalhos['content-type'], 'application/json');
  assert.equal(caso.cabecalhos['x-gitlab-feature-category'], 'team_planning');
  assert.equal(caso.cabecalhos['authorization'], '[redigido]');
  assert.equal(caso.cabecalhos['private-token'], '[redigido]');
  assert.equal(caso.cabecalhos['set-cookie'], '[redigido]');
  assert.equal(caso.cabecalhos['x-vazou'], 'valor [redigido]');
  assert.equal(caso.corpo.version, '19.4.2');
  assert.equal((fs.statSync(arquivo).mode & 0o777), 0o600);
});

test('--incluir-cabecalhos: resposta HTTP de erro (4xx) grava status_http e cabecalhos mesmo com a CLI saindo com erro', () => {
  const { bin, saida } = sandbox();
  const bruto = ['HTTP/2.0 404 Not Found', 'Content-Type: application/json', '', '{"message":"404 Not found"}'].join('\r\n');
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', bruto, codigo: 1 }]);
  const r = rodar(bin, [...argsGithub(saida), '--incluir-cabecalhos']);
  assert.equal(r.status, 1, r.stderr);
  const caso = JSON.parse(fs.readFileSync(path.join(saida, 'check-runs.json'), 'utf8'));
  assert.equal(caso.status_http, 404);
  assert.equal(caso.cabecalhos['content-type'], 'application/json');
  assert.equal(caso.corpo.message, '404 Not found');
});

test('sem --incluir-cabecalhos nada muda: sem -i e sem status_http', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'gh', [{ padrao: 'check-runs', corpo: { ok: true } }]);
  const r = rodar(bin, argsGithub(saida));
  assert.equal(r.status, 0, r.stderr);
  const caso = JSON.parse(fs.readFileSync(path.join(saida, 'check-runs.json'), 'utf8'));
  assert.ok(!caso.comando.includes('-i'));
  assert.equal(caso.status_http, undefined);
});

test('ramo GitLab: os casos da CI do commit, do check, das pipelines, do MR e do commit mesclado', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'glab', []);
  const mesclado = 'b'.repeat(40);
  const r = rodar(bin, [...argsGitlab(saida), '--contexto', 'ork-verify', '--pipeline', '7,9', '--pr', '3', '--commit-mesclado', mesclado]);
  assert.equal(r.status, 0, r.stderr);
  const caminho = (caso: string) => JSON.parse(fs.readFileSync(path.join(saida, `${caso}.json`), 'utf8')).comando.at(-1);
  assert.equal(caminho('commit'), `projects/grupo%2Fproj/repository/commits/${SHA}`);
  assert.equal(caminho('commit-mrs'), `projects/grupo%2Fproj/repository/commits/${SHA}/merge_requests?per_page=100`);
  assert.equal(caminho('statuses-do-check'), `projects/grupo%2Fproj/repository/commits/${SHA}/statuses?name=ork-verify&all=true&per_page=100`);
  assert.equal(caminho('pipeline-7-jobs'), 'projects/grupo%2Fproj/pipelines/7/jobs?include_retried=true&per_page=100');
  assert.equal(caminho('pipeline-9-jobs'), 'projects/grupo%2Fproj/pipelines/9/jobs?include_retried=true&per_page=100');
  assert.equal(caminho('mr-pipelines'), 'projects/grupo%2Fproj/merge_requests/3/pipelines?per_page=100');
  assert.equal(caminho('commit-mesclado'), `projects/grupo%2Fproj/repository/commits/${mesclado}`);
});

test('--pipeline que não é número e --commit-mesclado que não é sha: recusa sem gravar', () => {
  for (const extra of [['--pipeline', '7;rm'], ['--commit-mesclado', 'HEAD']]) {
    const { bin, saida } = sandbox();
    cliFalso(bin, 'glab', []);
    const r = rodar(bin, [...argsGitlab(saida), ...extra]);
    assert.equal(r.status, 2, extra.join(' '));
    assert.deepEqual(fs.readdirSync(saida), []);
  }
});

/** Um glab falso que guarda o stdin de cada chamada GraphQL e responde um corpo fixo. */
function glabQueGuardaOStdin(bin: string, corpo: unknown): string {
  const recebido = path.join(bin, 'stdin.jsonl');
  const resposta = path.join(bin, 'resposta.json');
  fs.writeFileSync(resposta, JSON.stringify(corpo));
  fs.writeFileSync(path.join(bin, 'glab'), [
    '#!/bin/sh',
    'case "$*" in',
    `  *graphql*) cat >> '${recebido}'; printf '\\n' >> '${recebido}'; cat '${resposta}' ;;`,
    `  *namespaces/*|*members/all/*|*user*) printf '%s' '{"id":7,"username":"pessoa","kind":"group","full_path":"time/sub","access_level":40}' ;;`,
    "  *) printf '%s' '{}' ;;",
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  return recebido;
}

test('GitLab: a consulta GraphQL vai pelo stdin com Content-Type, e o registro guarda a consulta e as variáveis', () => {
  const { bin, saida } = sandbox();
  const recebido = glabQueGuardaOStdin(bin, { data: { project: null } });
  const consultas = path.join(bin, 'consultas.js');
  fs.writeFileSync(consultas, "exports.CONSULTA_DOS_PEDIDOS = 'query($path: ID!) { project(fullPath: $path) { id } }';\n");
  const r = rodar(bin, [...argsGitlab(saida), '--base', 'main', '--candidatas', 'ork/a,ork/b', '--consultas', consultas]);
  assert.equal(r.status, 0, r.stderr);
  const caso = JSON.parse(fs.readFileSync(path.join(saida, 'mr-abertos.json'), 'utf8'));
  assert.deepEqual(caso.comando, ['glab', 'api', '--hostname', 'gitlab.example.com', '--method', 'POST', '-H', 'Content-Type: application/json',
    'graphql', '--input', '-']);
  const enviado = JSON.parse(fs.readFileSync(recebido, 'utf8').trim());
  assert.equal(enviado.query, 'query($path: ID!) { project(fullPath: $path) { id } }');
  assert.deepEqual(enviado.variables, { path: 'grupo/proj', base: 'main', candidatas: ['ork/a', 'ork/b'], check: 'ork-verify' });
  assert.deepEqual(caso.entrada, enviado);
  assert.deepEqual(caso.corpo, { data: { project: null } });
});

test('GitLab: os casos da rede usam o id do usuário lido e o caminho codificado do grupo', () => {
  const { bin, saida } = sandbox();
  glabQueGuardaOStdin(bin, {});
  const r = rodar(bin, [...argsGitlab(saida), '--grupo', 'time/sub', '--grupo-sem-nivel', 'outro', '--alheio', 'alheia']);
  assert.equal(r.status, 0, r.stderr);
  const comando = (caso: string) => JSON.parse(fs.readFileSync(path.join(saida, `${caso}.json`), 'utf8')).comando.at(-1);
  assert.equal(comando('usuario'), 'user');
  assert.equal(comando('namespace-usuario'), 'namespaces/pessoa');
  assert.equal(comando('namespace-grupo'), 'namespaces/time%2Fsub');
  assert.equal(comando('namespace-alheio'), 'namespaces/alheia');
  assert.equal(comando('membro-do-grupo'), 'groups/time%2Fsub/members/all/7');
  assert.equal(comando('membro-sem-nivel'), 'groups/outro/members/all/7');
});

test('ramo GitLab com --base: grava a ponta da base e a comparação do sha com ela', () => {
  const { bin, saida } = sandbox();
  cliFalso(bin, 'glab', [
    { padrao: 'repository/branches/main', corpo: { name: 'main', commit: { id: SHA } } },
    { padrao: 'repository/compare', corpo: { commits: [], diffs: [], compare_timeout: false, compare_same_ref: false } },
  ]);
  const r = rodar(bin, [...argsGitlab(saida), '--base', 'main']);
  assert.equal(r.status, 0, r.stderr);
  const branch = JSON.parse(fs.readFileSync(path.join(saida, 'branch.json'), 'utf8'));
  assert.deepEqual(branch.comando.slice(-1), ['projects/grupo%2Fproj/repository/branches/main']);
  assert.equal(branch.corpo.commit.id, SHA);
  const compare = JSON.parse(fs.readFileSync(path.join(saida, 'compare.json'), 'utf8'));
  assert.deepEqual(compare.comando.slice(-1), [`projects/grupo%2Fproj/repository/compare?from=main&to=${SHA}&straight=false`]);
  assert.deepEqual(compare.corpo.commits, []);
});
