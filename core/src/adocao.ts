/** RM-089 F6: incorpora história existente sem mover a ref externa. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ManifestoCarregado } from './manifest';
import { dirThread, gravarThread, listarIds, lerThread, novaThread } from './thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import type { Modo, Thread } from './types';
import { exec } from './util';
import { worktreesDoGit } from './worktree';
import { executarAdocaoCoordenada, portaColetivaDoProjeto, portaLocalDoRoadmap, portaThreadOrfa } from './rede-empresa-operacao';
import { fotografarConflitoDaAdocao, type FotografiaF3DaAdocao } from './rede-empresa-conflito';
import { preflightDoProjeto } from './rede-empresa-preflight';
import { CONTRATO_PROJECAO_REPLAY_CI, estadoDoReciboRunnerCi, validarProjecaoReplayCi } from './ci-recibo-basico';
import { comandosDoBundle } from './ci';
import { conferirBundle } from './ship-publicar';
import { chaveDoReciboDeProva } from './recibo-prova';
import { estadoDoArtefato } from './session-watcher-claude';

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
      operacaoReserva?: string;
      fotografiaF3?: FotografiaF3DaAdocao;
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

export interface DependenciasDaAdocao {
  /** Testes podem substituir a saga remota sem transformar a fotografia em autorrelato. */
  coordenar?: (criar: (operacaoId: string) => Thread) => { thread: Thread; operationId: string };
  fotografar?: () => ReturnType<typeof preflightDoProjeto>;
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
  if (remoto?.includes('://')) {
    const fetch = exec('git', ['fetch', '--no-tags', '--force', remoto, ref], raiz);
    if (!fetch.ok) throw new ErroDeAdocao('adocao.origem-nao-encontrada', ref);
    const commit = exec('git', ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], raiz);
    const head = commit.stdout.trim();
    if (!commit.ok || !HEAD.test(head)) throw new ErroDeAdocao('adocao.origem-nao-encontrada', ref);
    return { head, branch: ref };
  }
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

function branchRegistrada(thread: Thread, raiz: string,
  worktrees: ReadonlyArray<{ dir: string; branch: string; head: string }>): string[] {
  const branches = [thread.base.branch];
  const criada = lerLedger(dirThread(raiz, thread.id)).find((e) => e.tipo === 'thread_created');
  if (typeof criada?.branchDeOrigem === 'string') branches.push(criada.branchDeOrigem);
  const wt = worktrees.find((w) => thread.worktree && path.resolve(w.dir) === path.resolve(thread.worktree));
  if (wt?.branch) branches.push(wt.branch);
  return branches;
}

function vinculada(raiz: string, origemNormalizada: string, branch: string,
  worktrees: ReadonlyArray<{ dir: string; branch: string; head: string }>): Thread | null {
  for (const id of listarIds(raiz)) {
    const thread = lerThread(raiz, id);
    if (thread.adocao?.origemNormalizada === origemNormalizada
        || branchRegistrada(thread, raiz, worktrees).includes(branch)) return thread;
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

function reciboAtual(recibo: { head?: string; sha256?: string } | null | undefined,
  atual: { head?: string; sha256?: string } | null | undefined, head: string): boolean {
  return recibo?.head === head && atual?.head === head && typeof recibo.sha256 === 'string' && recibo.sha256 === atual.sha256;
}

function perfilDaSessao(sessao: Thread['sessoes'][number]): string | null {
  const perfil = (sessao as Thread['sessoes'][number] & { perfil?: string | { id?: unknown } }).perfil;
  return typeof perfil === 'string' ? perfil : perfil && typeof perfil.id === 'string' ? perfil.id : null;
}

function verifyOficialNoHead(eventos: ReturnType<typeof lerLedger>, head: string) {
  const verify = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.verificacao).at(-1);
  const recibo = verify?.recibo as { head?: string; sha256?: string } | undefined;
  return verify?.commit === head && verify.veredito === 'verdade sustentada' && verify.parcial !== true &&
    recibo?.head === head && typeof recibo.sha256 === 'string' ? verify : null;
}

function checkOficialNoHead(carregado: ManifestoCarregado, thread: Thread, head: string,
  eventos: ReturnType<typeof lerLedger>): boolean {
  const adocao = thread.adocao!;
  const sessao = [...thread.sessoes].reverse().find((s) => s.fase === 'CHECK' && s.origem !== 'adocao' &&
    perfilDaSessao(s) === adocao.perfilCheck);
  if (!sessao || !sessao.verificada || !sessao.despachadaEm || !sessao.promptPath || !sessao.promptSha256) return false;
  const despachoIndex = eventos.findIndex((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada &&
    e.sessionId === sessao.sessionId && e.fase === 'CHECK' && e.runtime === sessao.runtime &&
    e.promptSha256 === sessao.promptSha256 && typeof e.eventId === 'string');
  const resultadoIndex = eventos.findIndex((e, i) => i > despachoIndex && e.tipo === 'phase_result' &&
    e.sessionId === sessao.sessionId && e.fase === 'CHECK' && e.despachoEm === sessao.despachadaEm &&
    e.origem === 'sessions.watch' && typeof e.sensorResultId === 'string' && e.sensorResultId &&
    e.classificacao === 'fase_concluida' && e.ok === true);
  if (despachoIndex < 0 || resultadoIndex < 0 || !eventos.some((e) => e.tipo === TIPOS_DE_EVENTO.despachoVerificado &&
      e.sessionId === sessao.sessionId && e.encontrada === true)) return false;
  try {
    const prompt = path.resolve(carregado.raiz, sessao.promptPath);
    const escopo = fs.realpathSync(dirThread(carregado.raiz, thread.id)) + path.sep;
    if (!fs.realpathSync(prompt).startsWith(escopo) ||
        createHash('sha256').update(fs.readFileSync(prompt)).digest('hex') !== sessao.promptSha256) return false;
  } catch { return false; }

  const caminhoDoBundle = `.ork-ci/${thread.id}.json`;
  const commitDoBundle = eventos.slice(0, despachoIndex).find((e) =>
    (e.tipo === 'mcp_git_committed' || e.tipo === 'commit') && e.commit === head &&
    Array.isArray(e.paths) && e.paths.includes(caminhoDoBundle) && typeof e.sessionId === 'string' &&
    e.sessionId !== sessao.sessionId);
  if (!commitDoBundle || conferirBundle(carregado.raiz, thread, thread.base.branch, head,
    comandosDoBundle(carregado)).estado !== 'feita') return false;
  const lido = exec('git', ['show', `${head}:${caminhoDoBundle}`], carregado.raiz);
  try {
    const bundle = JSON.parse(lido.stdout) as { recibo?: unknown };
    const projecao = lido.ok ? validarProjecaoReplayCi(bundle.recibo) : { ok: false as const, causa: 'invalida' as const };
    if (!projecao.ok || projecao.projecao.contrato !== CONTRATO_PROJECAO_REPLAY_CI ||
        projecao.projecao.thread !== thread.id) return false;
  } catch { return false; }

  const verify = eventos.slice(despachoIndex + 1, resultadoIndex).filter((e) => e.tipo === TIPOS_DE_EVENTO.verificacao).at(-1);
  const atual = chaveDoReciboDeProva(carregado.raiz, thread.id, head);
  const prova = (eventos[resultadoIndex].provaOrk ?? {}) as { ok?: unknown; veredito?: unknown;
    verify?: { eventId?: unknown; commit?: unknown } | null };
  const parecer = estadoDoArtefato(carregado.raiz, thread.id, 'docs/check.md');
  const vereditos = parecer.texto?.match(/^Veredito:\s*(PASSOU|PRECISA DE MUDANÇA)\s*$/gm) ?? [];
  return verify?.commit === head && verify.veredito === 'verdade sustentada' && verify.parcial !== true &&
    reciboAtual(verify.recibo as { head?: string; sha256?: string } | undefined, atual, head) &&
    prova.ok === true && prova.veredito === 'PASSOU' && prova.verify?.eventId === verify.eventId &&
    prova.verify?.commit === head && vereditos.length === 1 && vereditos[0].trim() === 'Veredito: PASSOU';
}

/** Relê somente recibos do núcleo; um objeto fornecido pelo chamador nunca avança a adoção. */
export function reconciliarAdocao(carregado: ManifestoCarregado, id: string): Thread {
  const thread = lerThread(carregado.raiz, id), adocao = thread.adocao;
  if (!adocao || !thread.worktree) return thread;
  const lido = exec('git', ['rev-parse', '--verify', 'HEAD^{commit}'], thread.worktree);
  const head = lido.stdout.trim();
  if (!lido.ok || !HEAD.test(head)) return thread;
  const eventos = lerLedger(dirThread(carregado.raiz, id));
  let mudou = false;

  if (adocao.estado === 'preparada') {
    if (verifyOficialNoHead(eventos, head)) {
      adocao.estado = 'verificada'; adocao.verifyHead = head; mudou = true;
    }
  }

  if (adocao.estado === 'verificada' && adocao.verifyHead !== head && verifyOficialNoHead(eventos, head)) {
    adocao.verifyHead = head; mudou = true;
  }

  if (adocao.estado === 'verificada' && adocao.verifyHead === head) {
    if (checkOficialNoHead(carregado, thread, head, eventos)) {
      adocao.estado = 'revisada'; adocao.checkHead = head; mudou = true;
    }
  }

  if (adocao.estado === 'revisada' && adocao.checkHead === head) {
    const entregue = eventos.filter((e) => e.tipo === 'phase_artifact_written' && e.fase === 'CHECK' && e.head === head)
      .map((e) => e.recibo).find((recibo) => estadoDoReciboRunnerCi(recibo, head) === 'presente') as
        { thread?: string; resultado?: { ok?: boolean } } | undefined;
    if (entregue?.thread === id && entregue.resultado?.ok === true) {
      adocao.estado = 'concluida'; adocao.reciboHead = head; mudou = true;
    }
  }
  if (mudou) gravarThread(carregado.raiz, thread);
  return thread;
}

/** A camada pública persiste o recibo depois que o runner puro termina; repetição não duplica o evento. */
export function registrarReciboRunnerDaAdocao(carregado: ManifestoCarregado, resultado: unknown): Thread | null {
  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado)) return null;
  const r = resultado as { ok?: unknown; thread?: unknown; commit?: unknown; recibo?: unknown };
  if (r.ok !== true || typeof r.thread !== 'string' || typeof r.commit !== 'string' ||
      estadoDoReciboRunnerCi(r.recibo, r.commit) !== 'presente') return null;
  let thread: Thread;
  try { thread = lerThread(carregado.raiz, r.thread); } catch { return null; }
  if (!thread.adocao || !thread.worktree) return null;
  const head = exec('git', ['rev-parse', '--verify', 'HEAD^{commit}'], thread.worktree).stdout.trim();
  if (head !== r.commit) return null;
  const recibo = r.recibo as { sha256?: unknown };
  const eventos = lerLedger(dirThread(carregado.raiz, thread.id));
  if (!eventos.some((e) => e.tipo === 'phase_artifact_written' && e.fase === 'CHECK' &&
      (e.recibo as { sha256?: unknown } | undefined)?.sha256 === recibo.sha256)) {
    registrar(dirThread(carregado.raiz, thread.id), thread.id, 'phase_artifact_written', {
      fase: 'CHECK', arquivo: `.ork-ci/${thread.id}.json`, head, recibo: r.recibo,
    });
  }
  return reconciliarAdocao(carregado, thread.id);
}

export function adotar(carregado: ManifestoCarregado, pedido: PedidoDeAdocao,
  dependencias: DependenciasDaAdocao = {}): ResultadoDeAdocao {
  const origem = normalizarOrigem(pedido.ref, pedido.remoto);
  if (!/^RM-[0-9]{3,}$/.test(pedido.roadmap.trim().toUpperCase())) throw new ErroDeAdocao('adocao.roadmap-invalido');
  if (!pedido.perfilCheck.trim()) throw new ErroDeAdocao('adocao.perfil-check-ausente');
  const antes = resolverCommit(carregado.raiz, pedido.ref, origem.remoto);
  const worktrees = worktreesDoGit(carregado.raiz);
  const existente = vinculada(carregado.raiz, origem.normalizada, antes.branch, worktrees);
  if (existente) {
    const reconciliada = existente.adocao ? reconciliarAdocao(carregado, existente.id) : existente;
    return { thread: reconciliada, criada: false, estado: reconciliada.adocao?.estado ?? 'preparada',
      proximoPasso: proximoPasso(reconciliada) };
  }

  const foraDoRegistro = worktrees.find((w) => w.branch === antes.branch);
  if (foraDoRegistro) throw new ErroDeAdocao('adocao.worktree-sem-vinculo', foraDoRegistro.dir);
  const baseRef = carregado.manifesto.worktree.base_branch;
  const base = exec('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], carregado.raiz);
  if (!base.ok || !HEAD.test(base.stdout.trim())) throw new ErroDeAdocao('adocao.base-ausente', baseRef);
  const baseHead = base.stdout.trim();
  const mergeBase = exec('git', ['merge-base', antes.head, baseHead], carregado.raiz);
  if (!mergeBase.ok || !HEAD.test(mergeBase.stdout.trim())) throw new ErroDeAdocao('adocao.historia-separada');
  const oids = exec('git', ['rev-list', '--reverse', antes.head, '--not', baseHead], carregado.raiz);
  if (!oids.ok) throw new ErroDeAdocao('adocao.historia-invalida');

  const fotografiaBase: NonNullable<Thread['adocao']> = {
    contrato: 'ork.adocao/v1', estado: 'preparada', origem: origem.origem, origemNormalizada: origem.normalizada,
    remoto: origem.remoto, sourceHead: antes.head, baseHead, mergeBase: mergeBase.stdout.trim(),
    oidsExclusivos: oids.stdout.trim().split('\n').filter((oid) => HEAD.test(oid)), perfilCheck: pedido.perfilCheck.trim(),
    preparadaEm: new Date().toISOString(),
  };
  const criar = (operacaoId: string): Thread => {
    // A origem e a base são reconsultadas depois da reserva e antes do primeiro estado durável.
    const depois = resolverCommit(carregado.raiz, pedido.ref, origem.remoto);
    if (depois.head !== antes.head) throw new ErroDeAdocao('adocao.origem-movel');
    const baseDepois = exec('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], carregado.raiz).stdout.trim();
    if (baseDepois !== baseHead) throw new ErroDeAdocao('adocao.base-movel');
    const preflight = (dependencias.fotografar ?? (() => preflightDoProjeto(carregado.raiz, carregado.manifesto)))();
    const fotografiaF3 = fotografarConflitoDaAdocao(preflight);
    const criada = novaThread(carregado, { nome: pedido.nome, modo: pedido.modo,
      roadmap: pedido.roadmap.trim().toUpperCase(), criarWorktree: true, origemDaWorktree: 'flag',
      adocao: { ...fotografiaBase, operacaoReserva: operacaoId, fotografiaF3 } });
    criada.thread.faseAtual = 'GO';
    gravarThread(carregado.raiz, criada.thread);
    return criada.thread;
  };
  const coordenar = dependencias.coordenar ?? ((fn: (operacaoId: string) => Thread) => {
    const item = pedido.roadmap.trim().toUpperCase();
    const coletiva = portaColetivaDoProjeto(carregado.raiz, carregado.manifesto, item, 'GO');
    const saga = executarAdocaoCoordenada({ raiz: carregado.raiz, projectKey: coletiva.projectKey, itemId: item,
      coletiva: coletiva.porta, local: portaLocalDoRoadmap(carregado.raiz, item), thread: portaThreadOrfa(carregado.raiz),
      criarThread: (operationId) => { const thread = fn(operationId); return { threadId: thread.id, valor: thread }; } });
    return { thread: saga.thread, operationId: saga.operationId };
  });
  const coordenada = coordenar(criar);
  return { thread: lerThread(carregado.raiz, coordenada.thread.id), criada: true, estado: 'preparada',
    proximoPasso: proximoPasso(coordenada.thread) };
}
