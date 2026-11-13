/** RM-089 F6: incorpora história existente sem mover a ref externa. */
import * as path from 'node:path';
import { ManifestoCarregado } from './manifest';
import { dirThread, gravarThread, listarIds, lerThread, novaThread } from './thread';
import { lerLedger } from './ledger';
import type { Modo, Thread } from './types';
import { exec } from './util';
import { worktreesDoGit } from './worktree';

declare module './types' {
  interface Thread {
    /** RM-089 F6: fotografia imutável da origem incorporada sem reescrever a história. */
    adocao?: {
      contrato: 'ork.adocao/v1';
      estado: 'preparada' | 'verificada' | 'revisada' | 'concluida';
      origem: string;
      origemNormalizada: string;
      remoto: string | null;
      sourceHead: string;
      baseHead: string;
      mergeBase: string;
      oidsExclusivos: string[];
      perfilCheck: string;
      preparadaEm: string;
      verifyHead?: string;
      checkHead?: string;
      reciboHead?: string;
    };
  }
}

const HEAD = /^[a-f0-9]{40,64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

export class ErroDeAdocao extends Error {
  constructor(readonly codigo: string, detalhe?: string) { super(`${codigo}${detalhe ? `: ${detalhe}` : ''}`); }
}

export interface PedidoDeAdocao {
  ref: string;
  remoto?: string;
  roadmap: string;
  nome: string;
  modo: Modo;
  perfilCheck: string;
}

export interface ResultadoDeAdocao {
  thread: Thread;
  criada: boolean;
  estado: NonNullable<Thread['adocao']>['estado'];
  proximoPasso: string;
}

function refValida(ref: string): boolean {
  return REF.test(ref) && !ref.includes('..') && !ref.includes('//') && !ref.includes('@{') && !ref.endsWith('/') && !ref.endsWith('.lock');
}

function normalizarOrigem(ref: string, remoto?: string): { origem: string; normalizada: string; remoto: string | null } {
  if (!refValida(ref)) throw new ErroDeAdocao('adocao.ref-invalida', ref);
  if (remoto && /:\/\/[^/]*@/.test(remoto)) throw new ErroDeAdocao('adocao.credencial-na-origem');
  const r = remoto?.trim() || null;
  return { origem: ref, normalizada: `${r ?? 'local'}:${ref}`.toLowerCase(), remoto: r };
}

function resolverCommit(raiz: string, ref: string, remoto: string | null): { head: string; branch: string } {
  const candidatos = remoto && !remoto.includes('://')
    ? [`refs/remotes/${remoto}/${ref}`, `${remoto}/${ref}`, ref]
    : [ref, `refs/heads/${ref}`, `refs/remotes/origin/${ref}`];
  for (const candidato of candidatos) {
    const commit = exec('git', ['rev-parse', '--verify', `${candidato}^{commit}`], raiz);
    if (!commit.ok) continue;
    const head = commit.stdout.trim();
    if (!HEAD.test(head)) continue;
    const simbolica = exec('git', ['rev-parse', '--symbolic-full-name', candidato], raiz).stdout.trim();
    const branch = simbolica.replace(/^refs\/(?:heads|remotes\/[^/]+)\//, '') || ref;
    return { head, branch };
  }
  throw new ErroDeAdocao('adocao.origem-nao-encontrada', ref);
}

function branchRegistrada(thread: Thread, raiz: string): string[] {
  const branches = [thread.base.branch];
  const criada = lerLedger(dirThread(raiz, thread.id)).find((e) => e.tipo === 'thread_created');
  if (typeof criada?.branchDeOrigem === 'string') branches.push(criada.branchDeOrigem);
  const wt = worktreesDoGit(raiz).find((w) => thread.worktree && path.resolve(w.dir) === path.resolve(thread.worktree));
  if (wt?.branch) branches.push(wt.branch);
  return branches;
}

function vinculada(raiz: string, origemNormalizada: string, branch: string): Thread | null {
  for (const id of listarIds(raiz)) {
    const thread = lerThread(raiz, id);
    if (thread.adocao?.origemNormalizada === origemNormalizada || branchRegistrada(thread, raiz).includes(branch)) return thread;
  }
  return null;
}

function proximoPasso(thread: Thread): string {
  const estado = thread.adocao?.estado ?? 'preparada';
  if (estado === 'preparada') return `node core/dist/index.js verify ${thread.id}`;
  if (estado === 'verificada') return `execute o CHECK independente de ${thread.id}`;
  if (estado === 'revisada') return `node core/dist/index.js ci run`;
  return `node core/dist/index.js ship ${thread.id}`;
}

export function adotar(carregado: ManifestoCarregado, pedido: PedidoDeAdocao): ResultadoDeAdocao {
  const origem = normalizarOrigem(pedido.ref, pedido.remoto);
  if (!/^RM-[0-9]{3,}$/.test(pedido.roadmap.trim().toUpperCase())) throw new ErroDeAdocao('adocao.roadmap-invalido');
  if (!pedido.perfilCheck.trim()) throw new ErroDeAdocao('adocao.perfil-check-ausente');
  const antes = resolverCommit(carregado.raiz, pedido.ref, origem.remoto);
  const existente = vinculada(carregado.raiz, origem.normalizada, antes.branch);
  if (existente) return { thread: existente, criada: false, estado: existente.adocao?.estado ?? 'preparada', proximoPasso: proximoPasso(existente) };

  const foraDoRegistro = worktreesDoGit(carregado.raiz).find((w) => w.branch === antes.branch);
  if (foraDoRegistro) throw new ErroDeAdocao('adocao.worktree-sem-vinculo', foraDoRegistro.dir);
  const baseRef = carregado.manifesto.worktree.base_branch;
  const base = exec('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], carregado.raiz);
  if (!base.ok || !HEAD.test(base.stdout.trim())) throw new ErroDeAdocao('adocao.base-ausente', baseRef);
  const baseHead = base.stdout.trim();
  const mergeBase = exec('git', ['merge-base', antes.head, baseHead], carregado.raiz);
  if (!mergeBase.ok || !HEAD.test(mergeBase.stdout.trim())) throw new ErroDeAdocao('adocao.historia-separada');
  const oids = exec('git', ['rev-list', '--reverse', antes.head, '--not', baseHead], carregado.raiz);
  if (!oids.ok) throw new ErroDeAdocao('adocao.historia-invalida');

  // A origem e a base são reconsultadas antes do primeiro estado durável.
  const depois = resolverCommit(carregado.raiz, pedido.ref, origem.remoto);
  if (depois.head !== antes.head) throw new ErroDeAdocao('adocao.origem-movel');
  const baseDepois = exec('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], carregado.raiz).stdout.trim();
  if (baseDepois !== baseHead) throw new ErroDeAdocao('adocao.base-movel');

  const fotografia: NonNullable<Thread['adocao']> = {
    contrato: 'ork.adocao/v1', estado: 'preparada', origem: origem.origem, origemNormalizada: origem.normalizada,
    remoto: origem.remoto, sourceHead: antes.head, baseHead, mergeBase: mergeBase.stdout.trim(),
    oidsExclusivos: oids.stdout.trim().split('\n').filter((oid) => HEAD.test(oid)), perfilCheck: pedido.perfilCheck.trim(),
    preparadaEm: new Date().toISOString(),
  };
  const criada = novaThread(carregado, { nome: pedido.nome, modo: pedido.modo, roadmap: pedido.roadmap.trim().toUpperCase(),
    criarWorktree: true, origemDaWorktree: 'flag', adocao: fotografia });
  criada.thread.faseAtual = 'GO';
  gravarThread(carregado.raiz, criada.thread);
  return { thread: lerThread(carregado.raiz, criada.thread.id), criada: true, estado: 'preparada',
    proximoPasso: proximoPasso(criada.thread) };
}
