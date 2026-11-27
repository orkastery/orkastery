import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { dirThread, novaThread } from '../src/thread';
import { decidirShipComFabrica, ship } from '../src/ship';
import { criarPortaDaFabricaNoShip } from '../src/ship-fabrica';
import { executarShipDoWorkerMcp, opcoesDaFabricaDoShipMcp } from '../src/mcp-ship';
import { chamadorDaApi, chaveDoLogin, type ChamadorDaApi } from '../src/forja/api';
import type { ForjaResolvida } from '../src/forja/contrato';
import { rodarCli } from '../src/forja/executor';
import { exigirManifesto } from '../src/manifest';
import { opcoesDaFabricaDoShipCli } from '../src/index';
import { exec } from '../src/util';
import { adicionarClaim } from '../src/claims';
import { lerLedger } from '../src/ledger';
import type { ExecutorVerify } from '../src/verify';
import { commitar, dirTemporario, projetoTemporario } from './apoio';

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

function mr(branch: string, sha: string, estado: 'opened' | 'merged', autor = 77, iid = 5,
  mergeSha = 'c'.repeat(40)) {
  return { iid, sha, state: estado, draft: false, source_project_id: 1, target_project_id: 1,
    target_branch: 'main', source_branch: branch, web_url: `https://gitlab.example/grupo/projeto/-/merge_requests/${iid}`,
    created_at: '2026-11-26T10:00:00.000Z', merged_at: estado === 'merged' ? '2026-11-26T10:05:00.000Z' : null,
    has_conflicts: false, detailed_merge_status: 'mergeable', merge_user: { id: autor },
    merge_commit_sha: estado === 'merged' ? mergeSha : null };
}

function apiGitlab(lista: () => unknown[]): ChamadorDaApi {
  return () => ({ ok: true, valor: { status: 200, cabecalhos: {},
    limite: { restante: null, total: null, reiniciaEm: null }, corpo: lista() } });
}

function glabFalso(lista: unknown[], atrasoMs: number): string {
  const arquivo = path.join(os.tmpdir(), `glab-falso-${process.pid}-${Math.random().toString(16).slice(2)}.sh`);
  const corpo = JSON.stringify(lista), nl = String.fromCharCode(10);
  const seguro = corpo.replaceAll("'", "'\"'\"'");
  fs.writeFileSync(arquivo, ['#!/bin/sh', `/bin/sleep ${atrasoMs / 1000}`,
    "printf '%s\\n' 'HTTP/1.1 200 OK' 'Content-Type: application/json' ''",
    `printf '%s' '${seguro}'`,
  ].join(nl));
  fs.chmodSync(arquivo, 0o755);
  return arquivo;
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

test('dry-run GitHub lê o check decisório com prazo útil', () => {
  const projeto = projetoTemporario('rm089-f7-ship-github-dry-run', true);
  versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  github_app_id: 731']);
  const { thread } = novaThread(projeto.carregado, { nome: 'ship github dry-run', modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega pela fabrica');
  const prazos: number[] = [];
  const api: ChamadorDaApi = (pedido) => {
    prazos.push(pedido.prazoMs ?? 0);
    return { ok: true, valor: { status: 200, cabecalhos: {}, limite: { restante: null, total: null, reiniciaEm: null },
      corpo: { total_count: 0, check_runs: [] } } };
  };
  const resultado = ship(projeto.carregado, thread.id, { para: 'main', dryRun: true, prazoFabricaMs: 3000,
    portaDaFabrica: criarPortaDaFabricaNoShip(projeto.carregado, { resolver: () => forjaGithub, criarApi: () => api }) });

  assert.equal(resultado.ok, false);
  assert.deepEqual(prazos, [3000]);
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

function mesclarNoDestinoRemoto(f: ReturnType<typeof casoGitlab>, manterLocal: boolean): { antes: string; mergeSha: string } {
  const antes = exec('git', ['rev-parse', 'main'], f.projeto.dir).stdout.trim();
  assert.equal(exec('git', ['merge', '--no-ff', '-m', 'merge observado', f.branch], f.projeto.dir).ok, true);
  const mergeSha = exec('git', ['rev-parse', 'main'], f.projeto.dir).stdout.trim();
  assert.equal(exec('git', ['push', 'origin', 'main'], f.projeto.dir).ok, true);
  if (!manterLocal) assert.equal(exec('git', ['reset', '--hard', antes], f.projeto.dir).ok, true);
  return { antes, mergeSha };
}

function mesclarForaDoProjeto(f: ReturnType<typeof casoGitlab>, avancar: boolean): { mergeSha: string; ponta: string } {
  assert.equal(exec('git', ['push', f.projeto.remoto as string, `${f.branch}:refs/heads/${f.branch}`], f.projeto.dir).ok, true);
  const clone = dirTemporario('rm089-f7-ship-remoto');
  try {
    assert.equal(exec('git', ['clone', '-q', f.projeto.remoto as string, clone], os.tmpdir()).ok, true);
    assert.equal(exec('git', ['config', 'user.email', 'fabrica@exemplo.invalid'], clone).ok, true);
    assert.equal(exec('git', ['config', 'user.name', 'Fabrica'], clone).ok, true);
    assert.equal(exec('git', ['merge', '--no-ff', '-m', 'merge observado', `origin/${f.branch}`], clone).ok, true);
    const mergeSha = exec('git', ['rev-parse', 'HEAD'], clone).stdout.trim();
    const ponta = avancar
      ? commitar(clone, 'depois-do-merge.md', '# destino avançou\n', 'avança destino depois do merge')
      : mergeSha;
    assert.equal(exec('git', ['push', 'origin', 'main'], clone).ok, true);
    return { mergeSha, ponta };
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
  }
}

for (const localAtualizada of [false, true]) {
  test(`ship registra merge GitLab da fábrica sem criar outro merge local: main ${localAtualizada ? 'atualizada' : 'inalterada'}`, () => {
    let mergeObservado = '';
    const f = casoGitlab(`mesmo-sha-${localAtualizada}`,
      (branch, head) => [mr(branch, head, 'merged', 77, 5, mergeObservado)]);
    const { antes, mergeSha } = mesclarNoDestinoRemoto(f, localAtualizada);
    mergeObservado = mergeSha;
    const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
      prazoFabricaMs: f.prazoFabricaMs });
    assert.equal(resultado.ok, true, resultado.detalhe);
    assert.equal(resultado.mergeSha, mergeSha);
    assert.equal(resultado.shaRemoto, mergeSha);
    assert.equal(resultado.pushVerificado, true);
    assert.equal(exec('git', ['rev-parse', 'main'], f.projeto.dir).stdout.trim(), localAtualizada ? mergeSha : antes);
    const eventos = lerLedger(dirThread(f.projeto.dir, f.thread.id));
    const gate = eventos.find((e) => e.tipo === 'gate_passed' && e.gate === 'ship');
    const entrega = eventos.find((e) => e.tipo === 'ship_done');
    assert.ok(gate);
    assert.deepEqual(entrega && { mergeSha: entrega.mergeSha, shaRemoto: entrega.shaRemoto,
      pushVerificado: entrega.pushVerificado }, { mergeSha, shaRemoto: mergeSha, pushVerificado: true });
    assert.match(String(entrega?.fonteDaProva), /ls-remote .* igual ao merge; GitLab API merge request 5/);
    f.projeto.limpar();
  });
}

test('ship registra quando a ponta do destino avançou e contém o merge GitLab', () => {
  let mergeObservado = '';
  const f = casoGitlab('destino-avancou', (branch, head) => [mr(branch, head, 'merged', 77, 5, mergeObservado)]);
  const { mergeSha } = mesclarNoDestinoRemoto(f, true);
  mergeObservado = mergeSha;
  const ponta = commitar(f.projeto.dir, 'depois-do-merge.md', '# destino avançou\n', 'avança destino depois do merge');
  assert.equal(exec('git', ['push', 'origin', 'main'], f.projeto.dir).ok, true);

  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });

  assert.equal(resultado.ok, true, resultado.detalhe);
  assert.equal(resultado.mergeSha, mergeSha);
  assert.equal(resultado.shaRemoto, ponta);
  assert.equal(resultado.pontaDaBase, ponta);
  const entrega = lerLedger(dirThread(f.projeto.dir, f.thread.id)).find((e) => e.tipo === 'ship_done');
  assert.deepEqual(entrega && { mergeSha: entrega.mergeSha, shaRemoto: entrega.shaRemoto,
    pontaDaBase: entrega.pontaDaBase, pushVerificado: entrega.pushVerificado },
  { mergeSha, shaRemoto: ponta, pontaDaBase: ponta, pushVerificado: true });
  assert.match(String(entrega?.fonteDaProva), new RegExp(`git merge-base --is-ancestor ${mergeSha} ${ponta}`));
  f.projeto.limpar();
});

test('ship busca a ponta avançada só no remoto antes de registrar o merge GitLab', () => {
  let mergeObservado = '';
  const f = casoGitlab('destino-avancou-so-remoto',
    (branch, head) => [mr(branch, head, 'merged', 77, 5, mergeObservado)]);
  const { mergeSha, ponta } = mesclarForaDoProjeto(f, true);
  mergeObservado = mergeSha;
  assert.equal(exec('git', ['cat-file', '-e', `${mergeSha}^{commit}`], f.projeto.dir).ok, false);
  assert.equal(exec('git', ['cat-file', '-e', `${ponta}^{commit}`], f.projeto.dir).ok, false);

  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });

  assert.equal(resultado.ok, true, resultado.detalhe);
  assert.equal(resultado.mergeSha, mergeSha);
  assert.equal(resultado.shaRemoto, ponta);
  assert.equal(resultado.pontaDaBase, ponta);
  const entrega = lerLedger(dirThread(f.projeto.dir, f.thread.id)).find((e) => e.tipo === 'ship_done');
  assert.deepEqual(entrega && { mergeSha: entrega.mergeSha, shaRemoto: entrega.shaRemoto,
    pontaDaBase: entrega.pontaDaBase, pushVerificado: entrega.pushVerificado },
  { mergeSha, shaRemoto: ponta, pontaDaBase: ponta, pushVerificado: true });
  f.projeto.limpar();
});

test('ship recusa sem registro quando a ponta remota não contém o merge informado pela API GitLab', () => {
  const f = casoGitlab('remoto-sem-merge', (branch, head) => [mr(branch, head, 'merged', 77, 5, head)]);

  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'runtime.unavailable');
  assert.match(resultado.detalhe, /ponta não provou conter o merge GitLab/);
  const eventos = lerLedger(dirThread(f.projeto.dir, f.thread.id));
  assert.equal(eventos.filter((e) => e.tipo === 'gate_passed' && e.gate === 'ship').length, 0);
  assert.equal(eventos.filter((e) => e.tipo === 'ship_done').length, 0);
  f.projeto.limpar();
});

test('dry-run GitLab não grava gate nem entrega depois de provar o merge remoto', () => {
  let mergeObservado = '';
  const f = casoGitlab('dry-run-sem-registro', (branch, head) => [mr(branch, head, 'merged', 77, 5, mergeObservado)]);
  mergeObservado = mesclarNoDestinoRemoto(f, false).mergeSha;

  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs, dryRun: true });

  assert.equal(resultado.ok, true, resultado.detalhe);
  const eventos = lerLedger(dirThread(f.projeto.dir, f.thread.id));
  assert.equal(eventos.filter((e) => e.tipo === 'gate_passed' && e.gate === 'ship').length, 0);
  assert.equal(eventos.filter((e) => e.tipo === 'ship_done').length, 0);
  f.projeto.limpar();
});

test('ship devolve SHA divergente no primeiro retrato GitLab', () => {
  const f = casoGitlab('sha-divergente', (branch) => [mr(branch, 'f'.repeat(40), 'merged')], 1500);
  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 'ship.fabrica.sha-divergente');
  assert.equal(f.esperou(), 0);
  f.projeto.limpar();
});

test('ship recusa imediatamente MR mesclado no HEAD por autor diferente', () => {
  const f = casoGitlab('autor-diferente', (branch, head) => [mr(branch, head, 'merged', 88)]);
  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, undefined);
  assert.match(resultado.detalhe, /ci\.fabrica\.prova-ausente/);
  assert.equal(f.esperou(), 0);
  f.projeto.limpar();
});

test('ship exige a conta da fábrica também para SHA divergente', () => {
  const f = casoGitlab('sha-divergente-outro-autor', (branch) => [mr(branch, 'f'.repeat(40), 'merged', 88)]);
  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, undefined);
  assert.match(resultado.detalhe, /ci\.fabrica\.prova-ausente/);
  assert.equal(f.esperou(), 0);
  f.projeto.limpar();
});

test('ship ignora MR antigo da branch quando o MR mais novo continua aberto no HEAD', () => {
  const f = casoGitlab('mr-antigo', (branch, head) => [
    mr(branch, head, 'opened', 77, 6), mr(branch, 'e'.repeat(40), 'merged', 77, 4),
  ]);
  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 'ship.fabrica.merge-pendente');
  assert.ok(f.esperou() > 0);
  f.projeto.limpar();
});

test('ship espera MR aberto até o prazo e devolve merge pendente', () => {
  const f = casoGitlab('mr-aberto', (branch, head) => [mr(branch, head, 'opened')]);
  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 'ship.fabrica.merge-pendente');
  assert.ok(f.esperou() > 0);
  f.projeto.limpar();
});

test('dry-run consulta o GitLab uma vez sem esperar o prazo', () => {
  const f = casoGitlab('dry-run', (branch, head) => [mr(branch, head, 'opened')], 1500);
  const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: f.porta,
    prazoFabricaMs: f.prazoFabricaMs, dryRun: true });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 'ship.fabrica.merge-pendente');
  assert.equal(f.esperou(), 0);
  f.projeto.limpar();
});

test('API GitLab pelo rodarCli preserva prazo útil no fim da espera e no dry-run', () => {
  const casos = [
    { nome: 'h0', estado: 'merged' as const, prazo: 3000, dryRun: false, ok: true, atraso: 150 },
    { nome: 'h1', estado: 'opened' as const, prazo: 3000, dryRun: false, ok: false, atraso: 150 },
    { nome: 'h2', estado: 'merged' as const, prazo: 3000, dryRun: true, ok: true, atraso: 150 },
    { nome: 'h3', estado: 'opened' as const, prazo: 3000, dryRun: true, ok: false, atraso: 150 },
    { nome: 'h4', estado: 'opened' as const, prazo: 3000, dryRun: false, ok: false, atraso: 1500 },
    { nome: 'h5', estado: 'merged' as const, prazo: 3000, dryRun: true, ok: true, atraso: 1500 },
  ];
  for (const caso of casos) {
    let mergeObservado = '';
    const f = casoGitlab(`executor-${caso.nome}`, () => []);
    if (caso.estado === 'merged') mergeObservado = mesclarNoDestinoRemoto(f, false).mergeSha;
    const binario = glabFalso([mr(f.branch, f.head, caso.estado, caso.estado === 'merged' ? 77 : 0, 5,
      mergeObservado || 'c'.repeat(40))], caso.atraso);
    const sonda = rodarCli({ cmd: 'glab', args: [], prazoMs: caso.atraso + 500,
      maxBuffer: 1024 * 1024, binario, reduzido: true });
    assert.match(sonda.stdout, /^HTTP\/1\.1 200 OK/);
    const prazos: number[] = [], erros: string[] = [];
    const porta = criarPortaDaFabricaNoShip(f.projeto.carregado, { resolver: () => forjaGitlab,
      criarApi: (forja) => {
        const api = chamadorDaApi(forja, { rodar: (c) => rodarCli({ ...c, binario }),
          logins: new Map([[chaveDoLogin(forja), true]]) });
        return (pedido) => {
          assert.equal(typeof pedido.prazoMs, 'number');
          prazos.push(pedido.prazoMs ?? 0);
          const lido = api(pedido);
          if (!lido.ok) erros.push(`${lido.erro.codigo}: ${lido.erro.detalhe}`);
          return lido;
        };
      } });
    try {
      const resultado = ship(f.projeto.carregado, f.thread.id, { para: 'main', portaDaFabrica: porta,
        prazoFabricaMs: caso.prazo, dryRun: caso.dryRun });
      assert.equal(resultado.ok, caso.ok, JSON.stringify({ detalhe: resultado.detalhe, prazos, erros }));
      if (!caso.ok) assert.equal(resultado.codigo, 'ship.fabrica.merge-pendente');
      assert.ok(prazos.length >= 1);
      assert.ok(prazos.every((prazo) => prazo >= 1000), prazos.join(','));
      if (caso.nome === 'h4') assert.ok(erros.length >= 1);
      else assert.deepEqual(erros, []);
      if (caso.nome === 'h5') assert.equal(prazos[0], caso.prazo);
    } finally {
      fs.rmSync(binario, { force: true });
      f.projeto.limpar();
    }
  }
});

test('o comando ork ship instala a porta da fábrica', () => {
  const projeto = projetoTemporario('rm089-f7-cli-porta', true);
  const opcoes = opcoesDaFabricaDoShipCli(projeto.carregado);
  assert.equal(typeof opcoes.portaDaFabrica, 'function');
  versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  github_app_id: 731']);
  const { thread } = novaThread(projeto.carregado, { nome: 'cli porta', modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega via cli');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  const supervisor = [
    'import os, subprocess, sys',
    'e = os.environ.copy(); e.pop("NODE_TEST_CONTEXT", None)',
    'r = subprocess.run(sys.argv[1:], env=e, stdout=subprocess.PIPE, stderr=subprocess.PIPE)',
    'sys.stdout.buffer.write(r.stdout); sys.stderr.buffer.write(r.stderr)',
    'raise SystemExit(r.returncode)',
  ].join('\n');
  const r = spawnSync('/usr/bin/python3', ['-c', supervisor, process.execPath, CLI, 'ship', thread.id, '--para', 'main'],
    { cwd: projeto.dir, env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(`${r.stdout}\n${r.stderr}`, /ci\.fabrica\.prova-ausente/);
  projeto.limpar();
});

test('o worker MCP compõe a porta da fábrica no ship', () => {
  const projeto = projetoTemporario('rm089-f7-mcp-porta');
  const opcoes = opcoesDaFabricaDoShipMcp(projeto.carregado, Date.now() + 10_000);
  assert.equal(typeof opcoes.portaDaFabrica, 'function');
  assert.ok(opcoes.prazoFabricaMs >= 0);
  projeto.limpar();
});

test('o caminho usado pelo worker MCP executa o ship com a porta da fábrica recusando', () => {
  const projeto = projetoTemporario('rm089-f7-mcp-worker-porta', true);
  versionarDestino(projeto, ['politica_recibo: exigir', 'fabrica:', '  github_app_id: 731']);
  const { thread } = novaThread(projeto.carregado, { nome: 'mcp worker porta', modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega mcp');
  adicionarClaim(projeto.dir, thread.id, { arquivo: 'entrega.md', alegacao: 'entrega da fixture', fase: 'GO',
    verificar: ['test -f entrega.md'] });
  const executor: ExecutorVerify = (nome, comando) => ({ nome, comando, ok: true, code: 0, resumo: '' });
  const destino = exec('git', ['rev-parse', 'main'], projeto.dir).stdout.trim();
  const resultado = executarShipDoWorkerMcp(projeto.carregado, thread.id, Date.now() + 30_000,
    { para: 'main', executorVerify: executor }, null);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'ci.failed');
  assert.match(resultado.detalhe, /ci\.fabrica\.prova-ausente/);
  assert.equal(exec('git', ['rev-parse', 'main'], projeto.dir).stdout.trim(), destino);
  projeto.limpar();
});
