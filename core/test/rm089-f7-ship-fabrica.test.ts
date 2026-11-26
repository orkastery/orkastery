import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { novaThread } from '../src/thread';
import { decidirShipComFabrica, ship } from '../src/ship';
import { criarPortaDaFabricaNoShip } from '../src/ship-fabrica';
import { opcoesDaFabricaDoShipMcp } from '../src/mcp-ship';
import type { ChamadorDaApi } from '../src/forja/api';
import type { ForjaResolvida } from '../src/forja/contrato';
import { exigirManifesto } from '../src/manifest';
import { opcoesDaFabricaDoShipCli } from '../src/index';
import { exec } from '../src/util';
import { commitar, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

function versionarDestino(projeto: ReturnType<typeof projetoTemporario>, linhasCi: string[], extra = '', recarregar = true): string {
  const arquivo = path.join(projeto.dir, 'orkastery.yaml');
  let texto = fs.readFileSync(arquivo, 'utf8');
  texto = texto.replace('  context: ork-verify\n', `  context: ork-verify\n${linhasCi.map((l) => `  ${l}`).join('\n')}\n`);
  texto += extra;
  commitar(projeto.dir, 'orkastery.yaml', texto, 'configura destino da fábrica');
  assert.equal(exec('git', ['push', 'origin', 'main'], projeto.dir).ok, true);
  if (recarregar) projeto.carregado = exigirManifesto(projeto.dir);
  return texto;
}

const forjaGithub: ForjaResolvida = { tipo: 'github', host: 'github.com', porta: null, caminhoBase: '', sshHost: null,
  sshPorta: null, ca: null, repo: 'exemplo/projeto', origem: { tipo: 'manifesto', host: 'remoto', porta: 'padrao', caminhoBase: 'padrao' } };
const forjaGitlab: ForjaResolvida = { tipo: 'gitlab', host: 'gitlab.com', porta: null, caminhoBase: '', sshHost: null,
  sshPorta: null, ca: null, repo: 'grupo/projeto', origem: { tipo: 'manifesto', host: 'remoto', porta: 'padrao', caminhoBase: 'padrao' } };

function mr(branch: string, sha: string, estado: 'opened' | 'merged', autor = 77) {
  return { iid: 5, sha, state: estado, draft: false, source_project_id: 1, target_project_id: 1,
    target_branch: 'main', source_branch: branch, web_url: 'https://gitlab.example/grupo/projeto/-/merge_requests/5',
    created_at: '2026-11-26T10:00:00.000Z', merged_at: estado === 'merged' ? '2026-11-26T10:05:00.000Z' : null,
    has_conflicts: false, detailed_merge_status: 'mergeable', merge_user: { id: autor },
    merge_commit_sha: estado === 'merged' ? 'c'.repeat(40) : null };
}

function apiGitlab(lista: () => unknown[]): ChamadorDaApi {
  return () => ({ ok: true, valor: { status: 200, cabecalhos: {},
    limite: { restante: null, total: null, reiniciaEm: null }, corpo: lista() } });
}

test('ship consulta na forja o check decisório exato do destino, HEAD e App', () => {
  const projeto = projetoTemporario('rm089-f7-ship-fabrica', true);
  versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  github_app_id: 731']);
  const local = fs.readFileSync(path.join(projeto.dir, 'orkastery.yaml'), 'utf8')
    .replace('  fabrica:\n    github_app_id: 731\n', '');
  commitar(projeto.dir, 'orkastery.yaml', local, 'checkout sem configuração da fábrica');
  projeto.carregado = exigirManifesto(projeto.dir);
  const { thread } = novaThread(projeto.carregado, { nome: 'ship fabrica', modo: 'auto', criarWorktree: true });
  const head = commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega pela fabrica');
  const caminhos: string[] = [];
  const api: ChamadorDaApi = (pedido) => {
    caminhos.push(pedido.caminho);
    return { ok: true, valor: { status: 200, cabecalhos: {}, limite: { restante: null, total: null, reiniciaEm: null },
      corpo: { total_count: 2, check_runs: [
        { id: 9, name: 'outro-check', head_sha: 'f'.repeat(40), status: 'completed', conclusion: 'failure', app: { id: 731 } },
        { id: 8, name: 'ork-fabrica/utf8-6d61696e', head_sha: head,
          status: 'completed', conclusion: 'success', app: { id: 731 } },
      ] } } };
  };
  const portaDaFabrica = criarPortaDaFabricaNoShip(projeto.carregado, {
    resolver: () => forjaGithub, criarApi: () => api,
  });

  const resultado = ship(projeto.carregado, thread.id, { para: 'main', portaDaFabrica });

  assert.equal(resultado.ok, true, resultado.detalhe);
  assert.equal(caminhos.length, 1);
  assert.match(caminhos[0], new RegExp(`/commits/${head}/check-runs\\?`));
  assert.match(caminhos[0], /check_name=ork-fabrica%2Futf8-6d61696e/);
  projeto.limpar();
});

test('ship falha fechado quando o check decisório não vem do App configurado', () => {
  const projeto = projetoTemporario('rm089-f7-ship-fabrica-app', true);
  versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  github_app_id: 731']);
  const { thread } = novaThread(projeto.carregado, { nome: 'ship fabrica app', modo: 'auto', criarWorktree: true });
  const head = commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega pela fabrica');
  const api: ChamadorDaApi = () => ({ ok: true, valor: { status: 200, cabecalhos: {},
    limite: { restante: null, total: null, reiniciaEm: null }, corpo: { total_count: 1,
      check_runs: [{ id: 9, name: 'ork-fabrica/utf8-6d61696e', head_sha: head,
        status: 'completed', conclusion: 'success', app: { id: 999 } }] } } });
  const portaDaFabrica = criarPortaDaFabricaNoShip(projeto.carregado, {
    resolver: () => forjaGithub, criarApi: () => api,
  });

  const resultado = ship(projeto.carregado, thread.id, { para: 'main', portaDaFabrica });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'ci.failed');
  projeto.limpar();
});

test('sinal positivo da CI não substitui a decisão válida da fábrica', () => {
  const r = decidirShipComFabrica({ configurada: true, nivel: 'exigir', forja: 'github', destino: 'main',
    head: 'a'.repeat(40), resultado: null, github: { appIdEsperado: 731, checkVerde: false },
    ci: { state: 'success' } });
  assert.equal(r.ok, false);
});

test('sinal negativo da CI veta uma decisão válida da fábrica', () => {
  const r = decidirShipComFabrica({ configurada: true, nivel: 'exigir', forja: 'github', destino: 'main',
    head: 'a'.repeat(40), resultado: { valido: true, destino: 'main', head: 'a'.repeat(40), githubAppId: 731 },
    github: { appIdEsperado: 731, checkVerde: true }, ci: { state: 'failure' } });
  assert.equal(r.ok, false);
  assert.equal(r.ok ? null : r.codigo, 'ci.failed');
});

test('destino sem manifesto versionado preserva o ship sem opt-in da fábrica', () => {
  const projeto = projetoTemporario('rm089-f7-ship-sem-manifesto');
  const porta = criarPortaDaFabricaNoShip(projeto.carregado, { lerManifestoDestino: () => null });
  const lido = porta({ remoto: 'origin', origem: 'feature/fabrica', destino: 'main', head: 'a'.repeat(40),
    ci: { state: 'disabled' }, prazoMs: 1000 });
  assert.equal(lido.ok, true);
  assert.equal(lido.ok && lido.entrada.configurada, false);
  projeto.limpar();
});

test('manifesto de destino ilegível falha fechado na porta do ship', () => {
  const projeto = projetoTemporario('rm089-f7-ship-manifesto-ilegivel');
  const porta = criarPortaDaFabricaNoShip(projeto.carregado, { lerManifestoDestino: () => '{' });
  const lido = porta({ remoto: 'origin', origem: 'feature/fabrica', destino: 'main', head: 'a'.repeat(40),
    ci: { state: 'disabled' }, prazoMs: 0 });
  assert.equal(lido.ok, false);
  projeto.limpar();
});

test('outro bloco inválido sem ci.fabrica não ativa a porta do ship', () => {
  const projeto = projetoTemporario('rm089-f7-ship-sem-opt-in-invalido', true);
  const base = fs.readFileSync(path.join(projeto.dir, 'orkastery.yaml'), 'utf8');
  const checkInvalido = base.replace(/check:\n(?: {2}.*\n)+/, 'check:\n  mode: turbo\n');
  commitar(projeto.dir, 'orkastery.yaml', checkInvalido, 'manifesto de destino com outro bloco inválido');
  assert.equal(exec('git', ['push', 'origin', 'main'], projeto.dir).ok, true);
  const { thread } = novaThread(projeto.carregado, { nome: 'sem opt-in invalido', modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega sem opt-in');
  const resultado = ship(projeto.carregado, thread.id, { para: 'main',
    portaDaFabrica: criarPortaDaFabricaNoShip(projeto.carregado) });
  assert.equal(resultado.ok, true, resultado.detalhe);
  projeto.limpar();
});

for (const caso of ['yaml-ilegivel', 'fabrica-invalida', 'forja-ausente'] as const) {
  test(`ship falha fechado com fábrica em exigir: ${caso}`, () => {
    const projeto = projetoTemporario(`rm089-f7-ship-${caso}`, true);
    if (caso === 'yaml-ilegivel') {
      versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  github_app_id: 731'], '\nquebrado: [\n', false);
    } else if (caso === 'fabrica-invalida') {
      versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  github_app_id: invalido'], '', false);
    } else {
      versionarDestino(projeto, ['politica_recibo: " exigir "', 'fabrica:', '  github_app_id: 731']);
    }
    const { thread } = novaThread(projeto.carregado, { nome: `falha fechada ${caso}`, modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega bloqueada');
    const resultado = ship(projeto.carregado, thread.id, { para: 'main',
      portaDaFabrica: criarPortaDaFabricaNoShip(projeto.carregado) });
    if (caso === 'yaml-ilegivel') {
      const porta = criarPortaDaFabricaNoShip(projeto.carregado);
      const lido = porta({ remoto: 'origin', origem: thread.id, destino: 'main', head: 'a'.repeat(40),
        ci: { state: 'disabled' }, prazoMs: 0 });
      assert.equal(lido.ok, false);
    }
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, 'ci.failed');
    projeto.limpar();
  });
}

function casoGitlab(nome: string, corpo: (branch: string, head: string) => unknown[], prazoFabricaMs = 50) {
  const projeto = projetoTemporario(`rm089-f7-gitlab-${nome}`, true);
  versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  gitlab_user_id: 77']);
  const { thread } = novaThread(projeto.carregado, { nome: `gitlab ${nome}`, modo: 'auto', criarWorktree: true });
  const head = commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega gitlab');
  const branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], thread.worktree as string).stdout.trim();
  let relogio = 0, esperou = 0;
  const porta = criarPortaDaFabricaNoShip(projeto.carregado, { resolver: () => forjaGitlab,
    criarApi: () => apiGitlab(() => corpo(branch, head)), agoraMs: () => relogio,
    esperar: (ms) => { relogio += ms; esperou += ms; } });
  return { projeto, thread, head, branch, porta, prazoFabricaMs, esperou: () => esperou };
}

for (const localAtualizada of [false, true]) {
  test(`ship registra merge GitLab da fábrica sem criar outro merge local: main ${localAtualizada ? 'atualizada' : 'inalterada'}`, () => {
    const f = casoGitlab(`mesmo-sha-${localAtualizada}`, (branch, head) => [mr(branch, head, 'merged')]);
    if (localAtualizada) assert.equal(exec('git', ['merge', '--no-ff', '-m', 'merge já observado', f.branch], f.projeto.dir).ok, true);
    const mainAntes = exec('git', ['rev-parse', 'main'], f.projeto.dir).stdout.trim();
    const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
      prazoFabricaMs: f.prazoFabricaMs });
    assert.equal(resultado.ok, true, resultado.detalhe);
    assert.equal(resultado.mergeSha, 'c'.repeat(40));
    assert.equal(resultado.pushVerificado, false);
    assert.equal(exec('git', ['rev-parse', 'main'], f.projeto.dir).stdout.trim(), mainAntes);
    f.projeto.limpar();
  });
}

test('ship devolve SHA divergente no primeiro retrato GitLab', () => {
  const f = casoGitlab('sha-divergente', (branch) => [mr(branch, 'f'.repeat(40), 'merged')], 1500);
  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 'ship.fabrica.sha-divergente');
  assert.equal(f.esperou(), 0);
  f.projeto.limpar();
});

for (const caso of ['autor-diferente', 'mr-aberto'] as const) {
  test(`ship não conta como decisão da fábrica: ${caso}`, () => {
    const f = casoGitlab(caso, (branch, head) => [mr(branch, head, caso === 'mr-aberto' ? 'opened' : 'merged',
      caso === 'autor-diferente' ? 88 : 77)]);
    const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
      prazoFabricaMs: f.prazoFabricaMs });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.codigo, 'ship.fabrica.merge-pendente');
    assert.ok(f.esperou() > 0);
    f.projeto.limpar();
  });
}

test('dry-run consulta o GitLab uma vez sem esperar o prazo', () => {
  const f = casoGitlab('dry-run', (branch, head) => [mr(branch, head, 'opened')], 1500);
  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs, dryRun: true });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 'ship.fabrica.merge-pendente');
  assert.equal(f.esperou(), 0);
  f.projeto.limpar();
});

test('o comando ork ship instala a porta da fábrica', () => {
  const projeto = projetoTemporario('rm089-f7-cli-porta', true);
  const opcoes = opcoesDaFabricaDoShipCli(projeto.carregado);
  assert.equal(typeof opcoes.portaDaFabrica, 'function');
  versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  github_app_id: 731']);
  const { thread } = novaThread(projeto.carregado, { nome: 'cli porta', modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega via cli');
  const r = spawnSync(process.execPath, [CLI, 'ship', thread.id, '--para', 'main'],
    { cwd: projeto.dir, env: process.env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  projeto.limpar();
});

test('o worker MCP compõe a porta da fábrica no ship', () => {
  const projeto = projetoTemporario('rm089-f7-mcp-porta');
  const opcoes = opcoesDaFabricaDoShipMcp(projeto.carregado, Date.now() + 10_000);
  assert.equal(typeof opcoes.portaDaFabrica, 'function');
  assert.ok(opcoes.prazoFabricaMs >= 0);
  projeto.limpar();
});
