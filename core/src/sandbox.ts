/**
 * Sandbox deterministica para os canarios de `ork eval` (bloco B4).
 *
 * Um canario precisa exercitar o comportamento REAL do nucleo: git de verdade, worktree de
 * verdade, lease de verdade. Fazer isso no repositorio do usuario seria inaceitavel, e
 * simular git com dublê seria testar o dublê. A saida e um repositorio git temporario,
 * criado, usado e apagado dentro da mesma execucao.
 *
 * Regras que esta sandbox respeita, e por isso ela pode rodar em `ork eval` na maquina de
 * qualquer builder: nada de rede, nada de credencial, nada fora de um diretorio temporario,
 * e limpeza garantida mesmo quando o canario falha.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { init } from './init';
import { exigirManifesto, ManifestoCarregado } from './manifest';
import { exec, noPath } from './util';

/** `git` existe nesta maquina? Sem ele os canarios saem `unavailable`, nunca `passing`. */
export function gitDisponivel(): boolean {
  return noPath('git') !== null;
}

/** Diretorio temporario com caminho real (o /tmp de linux e macOS usa symlink). */
export function dirTemporario(nome: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-eval-${nome}-`)));
}

export interface Sandbox {
  dir: string;
  carregado: ManifestoCarregado;
  limpar: () => void;
}

/** Commita um arquivo no repositorio informado e devolve o sha do commit. */
export function commitar(dir: string, arquivo: string, conteudo: string, mensagem: string): string {
  const destino = path.join(dir, arquivo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo, 'utf8');
  exec('git', ['add', '--', arquivo], dir);
  exec('git', ['commit', '-m', mensagem], dir);
  return exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
}

/**
 * Repositorio git temporario com manifesto gerado pelo proprio `ork init`.
 *
 * O manifesto vem do `init` de verdade e nao de um objeto escrito a mao: canario que monta o
 * proprio manifesto testa o canario, nao o produto.
 */
export function sandboxGit(nome: string, abbrev = 'evl'): Sandbox {
  // I-49: canario nunca escreve no registro compartilhado de contas do usuario.
  if (!process.env.ORK_CONTAS_DIR) {
    process.env.ORK_CONTAS_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-contas-eval-')), 'private');
  }
  // I-51: canario nunca publica o estado da fabrica.
  if (process.env.ORK_FABRICA_PUBLICAR === undefined) process.env.ORK_FABRICA_PUBLICAR = '0';
  if (!process.env.ORK_USUARIO_DIR) process.env.ORK_USUARIO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-usuario-eval-'));
  const dir = dirTemporario(nome);
  exec('git', ['init', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'eval@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Canario do ork eval'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  commitar(dir, 'README.md', '# projeto do canario\n', 'inicial');
  init(dir, { nome: 'canario', abbrev });
  return {
    dir,
    carregado: exigirManifesto(dir),
    limpar: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
