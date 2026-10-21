/**
 * RM-061, F3d (snapshot pt-BR): `portfolio`, `creation`, `objective` e `ci`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lintDoBundle } from '../src/ci';
import { Ambiente, caso, Casos, idDaThread, ork, projeto, texto } from './locale-f3d-apoio';
import { exec } from '../src/util';

function casosDoPortfolio(casos: Casos, amb: Ambiente): void {
  const repo = projeto('portfolio', 'loc', amb);
  caso(casos, 'cli portfolio: list vazio', () => texto(ork(repo, amb, 'portfolio')));
  caso(casos, 'cli portfolio: list com tipo invalido', () => texto(ork(repo, amb, 'portfolio', 'list', 'planeta')));
  caso(casos, 'cli portfolio: inspect sem id', () => texto(ork(repo, amb, 'portfolio', 'inspect')));
  caso(casos, 'cli portfolio: show sem id', () => texto(ork(repo, amb, 'portfolio', 'show')));
  caso(casos, 'cli portfolio: show com opcao aposentada', () => texto(ork(repo, amb, 'portfolio', 'show', 'p1', '--constraints', 'x')));
  caso(casos, 'cli portfolio: show de entidade que nao existe', () => texto(ork(repo, amb, 'portfolio', 'show', 'nada')));
  caso(casos, 'cli portfolio: create sem titulo', () => texto(ork(repo, amb, 'portfolio', 'create', 'product', 'p1')));
  ork(repo, amb, 'portfolio', 'create', 'product', 'prod-loja', '--title', 'Produto um');
  caso(casos, 'cli portfolio: show', () => texto(ork(repo, amb, 'portfolio', 'show', 'prod-loja')));
  caso(casos, 'cli portfolio: list com um produto', () => texto(ork(repo, amb, 'portfolio', 'list')));
  caso(casos, 'cli portfolio: subcomando desconhecido', () => texto(ork(repo, amb, 'portfolio', 'voar')));
}

function casosDaCriacao(casos: Casos, amb: Ambiente): void {
  const repo = projeto('creation', 'loc', amb);
  caso(casos, 'cli creation: principal no payload', () => texto(ork(repo, amb, 'creation', 'start', '--principal', 'x')));
  caso(casos, 'cli creation: start sem arquivo', () => texto(ork(repo, amb, 'creation', 'start')));
  const grande = path.join(repo, 'grande.json');
  fs.writeFileSync(grande, `"${'x'.repeat(100_001)}"`);
  caso(casos, 'cli creation: start com arquivo grande', () => texto(ork(repo, amb, 'creation', 'start', '--input-file', grande)));
  caso(casos, 'cli creation: show sem id', () => texto(ork(repo, amb, 'creation', 'show')));
  caso(casos, 'cli creation: resume sem versao', () => texto(ork(repo, amb, 'creation', 'resume', 'op-1')));
  caso(casos, 'cli creation: subcomando desconhecido', () => texto(ork(repo, amb, 'creation', 'voar', 'op-1')));
  caso(casos, 'cli objective: padrao', () => texto(ork(repo, amb, 'objective')));
  caso(casos, 'cli objective: show', () => texto(ork(repo, amb, 'objective', 'show', 'o1')));
}

function casosDoCi(casos: Casos, amb: Ambiente): void {
  const claim = (id: string, verificar: string[], lint?: boolean) =>
    ({ id, arquivo: 'README.md', alegacao: 'x', verificar, estado: 'pendente', ...(lint ? { lint: { versao: 1 } } : {}) });
  caso(casos, 'ci: lint do bundle com claim anterior ao lint', () => JSON.stringify(lintDoBundle([claim('C1', ['npm --prefix core test'])] as never), null, 1));
  caso(casos, 'ci: lint do bundle com recusa', () => JSON.stringify(lintDoBundle([claim('C2', ['npm --prefix core test'], true)] as never), null, 1));
  const repo = projeto('ci', 'ork', amb);
  caso(casos, 'cli ci: prepare sem thread', () => texto(ork(repo, amb, 'ci', 'prepare')));
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'ci-a', '--sem-worktree'));
  ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'o readme existe', '--verificar', 'test -f README.md');
  caso(casos, 'cli ci: prepare', () => texto(ork(repo, amb, 'ci', 'prepare', id)));
  caso(casos, 'cli ci: run sem thread', () => texto(ork(repo, amb, 'ci', 'run')));
  caso(casos, 'cli ci: run', () => texto(ork(repo, amb, 'ci', 'run', id)));
  caso(casos, 'cli ci: status com sha curto', () => texto(ork(repo, amb, 'ci', 'status', '--sha', 'HEAD')));
  caso(casos, 'cli ci: status', () => texto(ork(repo, amb, 'ci', 'status', '--sha', exec('git', ['rev-parse', 'HEAD'], repo).stdout.trim())));
  caso(casos, 'cli ci: subcomando desconhecido', () => texto(ork(repo, amb, 'ci', 'voar')));
  const sumiu = idDaThread(ork(repo, amb, 'thread', 'new', 'ci-b'));
  const wt = (JSON.parse(fs.readFileSync(path.join(repo, '.orkastery', 'threads', sumiu, 'thread.json'), 'utf8')) as { worktree: string }).worktree;
  fs.rmSync(wt, { recursive: true, force: true });
  caso(casos, 'cli ci: prepare com a worktree que sumiu', () => texto(ork(repo, amb, 'ci', 'prepare', sumiu)));
  ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'a suite passa', '--verificar', 'npm --prefix core test');
  caso(casos, 'cli ci: prepare com a suite inteira', () => texto(ork(repo, amb, 'ci', 'prepare', id)));
}

export function gerarGrupo(casos: Casos, amb: Ambiente): void {
  casosDoPortfolio(casos, amb);
  casosDaCriacao(casos, amb);
  casosDoCi(casos, amb);
}
