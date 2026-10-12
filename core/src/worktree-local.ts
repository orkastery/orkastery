/**
 * RM-047 (fronteira de confiança, P3): a pasta das worktrees fora da raiz vale só com a confirmação
 * desta máquina.
 *
 * O `worktree.dir` mora no `orkastery.yaml`, que vem com o repositório, e o `git worktree add` cria o
 * checkout (e o `.gitignore` da pasta) onde ele apontar. Dentro da raiz do projeto, pelo caminho real,
 * nada muda. Fora dela (`..`, caminho absoluto ou um link versionado que leva para fora), a criação
 * recusa com `worktree.dir-fora-da-raiz` até a máquina confirmar a mesma pasta com
 * `ork setup worktree confirmar`. A confirmação fica em `.orkastery/private/worktree-local.json`, com
 * as mesmas regras da postura de sandbox (P1): pasta 0700, arquivo 0600, nunca link, nunca rastreado
 * pelo git, e só para este checkout e esta pasta.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { gravarArquivoPrivado, lerArquivoPrivado, raizRealDoEstado, revogarArquivoPrivado } from './postura-local';
import { Manifesto } from './types';
import { agora } from './util';

export const CONTRATO_WORKTREE_LOCAL = 'ork.worktree-local/v1';
export const ARQUIVO_WORKTREE_LOCAL = 'worktree-local.json';

export interface WorktreeLocal {
  contrato: typeof CONTRATO_WORKTREE_LOCAL;
  /** Caminho real da pasta das worktrees que esta máquina aceita fora da raiz. */
  dir: string;
  /** Caminho real da raiz de estado no momento da confirmação. */
  raiz: string;
  confirmadoEm: string;
  por: string;
}

/**
 * Caminho real de um caminho que talvez ainda não exista: o real do ancestral mais próximo que existe,
 * mais o resto. Um link no caminho (inclusive versionado no clone) é resolvido aqui.
 */
export function caminhoRealPrevisto(alvo: string): string {
  let atual = path.resolve(alvo);
  const resto: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync(atual), ...resto.reverse()); } catch { /* sobe */ }
    const pai = path.dirname(atual);
    if (pai === atual) return path.resolve(alvo);
    resto.push(path.basename(atual));
    atual = pai;
  }
}

/** A pasta das worktrees que o manifesto pede, pelo caminho real, e se ela fica dentro da raiz. */
export function pastaDasWorktreesPedida(raiz: string, manifesto: Pick<Manifesto, 'worktree'>):
  { dir: string; dentro: boolean } {
  let principal: string;
  try { principal = raizDoEstado(raiz); } catch { principal = path.resolve(raiz); }
  const raizReal = caminhoRealPrevisto(principal);
  const dir = caminhoRealPrevisto(path.resolve(principal, manifesto.worktree.dir));
  const rel = path.relative(raizReal, dir);
  const primeiro = rel.split(path.sep)[0];
  const dentro = !rel.startsWith('..') && !path.isAbsolute(rel) && primeiro !== '.git';
  return { dir, dentro };
}

/** Lê a confirmação local; `null` com o motivo quando ela não existe ou não vale. */
export function lerWorktreeLocal(raiz: string): { local: WorktreeLocal | null; motivo: string | null } {
  const { bruto: o, motivo } = lerArquivoPrivado(raiz, ARQUIVO_WORKTREE_LOCAL);
  if (!o) return { local: null, motivo };
  if (o.contrato !== CONTRATO_WORKTREE_LOCAL || typeof o.dir !== 'string' || typeof o.raiz !== 'string' ||
      typeof o.confirmadoEm !== 'string' || typeof o.por !== 'string') {
    return { local: null, motivo: `${ARQUIVO_WORKTREE_LOCAL} fora do contrato ${CONTRATO_WORKTREE_LOCAL}` };
  }
  if (o.raiz !== raizRealDoEstado(raiz)) return { local: null, motivo: 'a confirmação local é de outro checkout' };
  return { local: o as unknown as WorktreeLocal, motivo: null };
}

/** Comando que confirma a pasta nesta máquina; vai em toda recusa. */
export const COMANDO_CONFIRMAR_WORKTREE = 'ork setup worktree confirmar';

/**
 * A recusa da criação de worktree: `null` quando a pasta do manifesto fica dentro da raiz, ou quando
 * a máquina confirmou exatamente essa pasta; senão o erro tipado com o comando que confirma.
 */
export function recusaDePastaDasWorktrees(raiz: string, manifesto: Pick<Manifesto, 'worktree'>): string | null {
  const { dir, dentro } = pastaDasWorktreesPedida(raiz, manifesto);
  if (dentro) return null;
  const { local, motivo } = lerWorktreeLocal(raiz);
  if (local && local.dir === dir) return null;
  const porque = local ? `a máquina confirmou ${local.dir}` : motivo ?? 'sem confirmação local';
  return `worktree.dir-fora-da-raiz: o orkastery.yaml pede worktree.dir: ${JSON.stringify(manifesto.worktree.dir).slice(0, 200)}, ` +
    `que leva a ${dir}, fora da raiz do projeto (pelo caminho real), e esta máquina não confirmou essa pasta (${porque}). ` +
    'Nenhuma worktree foi criada. O manifesto vem com o repositório; quem decide criar checkout fora da raiz é a ' +
    `máquina. Para aceitar nesta máquina: ${COMANDO_CONFIRMAR_WORKTREE} (ou volte worktree.dir para dentro do projeto, ` +
    'como .claude/worktrees).';
}

/** Lança a recusa, quando houver. */
export function exigirPastaDasWorktrees(raiz: string, manifesto: Pick<Manifesto, 'worktree'>): void {
  const recusa = recusaDePastaDasWorktrees(raiz, manifesto);
  if (recusa) throw new Error(recusa);
}

/**
 * Grava a confirmação local da pasta que o manifesto pede hoje. Com `esperado`, ele precisa levar à
 * mesma pasta: a máquina confirma o que leu, não o que o manifesto pode passar a dizer depois.
 */
export function confirmarWorktreeLocal(raiz: string, manifesto: Pick<Manifesto, 'worktree'>, por: string,
  esperado?: string): WorktreeLocal {
  const { dir, dentro } = pastaDasWorktreesPedida(raiz, manifesto);
  if (esperado !== undefined) {
    let principal: string;
    try { principal = raizDoEstado(raiz); } catch { principal = path.resolve(raiz); }
    const pedido = caminhoRealPrevisto(path.resolve(principal, esperado));
    if (pedido !== dir) {
      throw new Error(`worktree.dir-divergente: o orkastery.yaml leva a ${dir}, não a ${pedido}; nada foi confirmado`);
    }
  }
  if (dentro) throw new Error(`worktree.dir-dentro-da-raiz: ${dir} fica dentro do projeto e não precisa de confirmação`);
  const local: WorktreeLocal = { contrato: CONTRATO_WORKTREE_LOCAL, dir, raiz: raizRealDoEstado(raiz), confirmadoEm: agora(), por };
  gravarArquivoPrivado(raiz, ARQUIVO_WORKTREE_LOCAL, local);
  return local;
}

/** Apaga a confirmação local; devolve se havia uma. */
export function revogarWorktreeLocal(raiz: string): boolean {
  return revogarArquivoPrivado(raiz, ARQUIVO_WORKTREE_LOCAL);
}
