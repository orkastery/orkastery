/**
 * RM-063 (F7): a batida da conducao, o passo deterministico que a varredura chama para avancar as threads dentro da
 * autorizacao duravel do dono (`ork conducao batida`).
 *
 * Incidente de 12 e 13/10/2026: os PRs #153 e #154 ficaram prontos, com os checks verdes, e esperaram de 5 a 6 horas pelo
 * condutor, que era uma sessao interativa (P6 da pagina da RM-063: acabou a conversa, acabou a conducao). A batida faz,
 * a cada rodada do cron e no `#OrkRetomar` do canal, o que o condutor fazia, e so o que o dono autorizou:
 *
 *  - `merge`: o PR aberto de branch `ork/*` de uma thread #Auto ou #Maestro, com todos os checks obrigatorios verdes e o
 *    PR limpo (`mergeStateStatus` CLEAN), entra na base por `gh pr merge --merge --match-head-commit`, com o assunto
 *    `ship(<thread>): ...` que o registro da entrega procura; o merge e provado na copia da base. O PR que ficou para
 *    tras, ou em conflito so no CHANGELOG, ganha o merge da base na branch (`atualizar-branch.ts`) e espera o CI de novo;
 *    conflito em codigo vira item do dono;
 *  - `registrar`, `master` e `limpar`: os da varredura da F5 (`varredura-acoes.ts`), na mesma rodada, depois do merge;
 *  - `despachar`: a fase seguinte que o nucleo calcula (`passosDoCondutor`, o mesmo passo da Sentinela), so com o pedido
 *    guardado na criacao da thread, e a retomada pelo retry com o prompt gravado (F3) quando o plano e automatico. A
 *    fase que precisa de LLM sai como sessao de fundo pelo `ork phase run`, nunca por cron LLM. Com a Sentinela ligada
 *    nesta maquina, o despacho comum e dela; a retomada por cota continua na batida da maquina.
 *
 * Nada aqui faz tag nem publicacao. Autorizacao ausente, vencida, de outra maquina ou sem a acao, check pendente ou
 * vermelho, PR em rascunho e trabalho na thread recusam com motivo tipado, e cada recusa vira item da fila do pulse
 * pelo retrato da ultima batida (`.orkastery/monitor/conducao-batida.json`). Cada acao feita ou recusada vai ao ledger
 * da thread como `varredura_acao`, com a autorizacao que a permitiu.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { autorizada, AcaoAutorizavel, LeituraDaAutorizacao, lerAutorizacao, referenciaDaAutorizacao } from './autorizacao-duravel';
import { atualizarBranchDaThread, ResultadoDaAtualizacao } from './atualizar-branch';
import { canalDoProcesso } from './conducao';
import { passosDoCondutor, presencaDaSentinela, PassoDoCondutor } from './conducao-sentinela';
import { mergeDaEntrega } from './entrega-pr';
import { raizDoEstado } from './estado-thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { msg, textoDoCatalogo } from './locale';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { adquirirLockMonitor } from './monitor-lock';
import { citarNoShell } from './doctor-pulse-cron';
import { ExecutorDoGh, ghPadrao, githubDoRemoto, pendenciaDoDono } from './parado-no-condutor';
import { conferirCheck } from './ship-publicar';
import { rodarFase } from './phase';
import { executarRetry, planejarRetry } from './retry';
import { dirThread, lerThread, listarIds, pedidoDaThread } from './thread';
import { CanalDeConducao, Fase, Thread } from './types';
import { exec } from './util';
import { AcaoPendente, agirNaVarredura, buscarBase, lerSessoes, MOTIVOS_DO_BLOQUEIO, MotivoDoBloqueio, OpcoesDaDeteccao,
  trabalhoNaWorktree, VarreduraQueAge } from './varredura-acoes';
import { branchDaWorktree } from './worktree';
import { reconciliarSessaoSemWatcher } from './session-watcher';

export const CONTRATO_DA_BATIDA = 'ork.conducao-batida/v1' as const;
export const ARQUIVO_DA_BATIDA = 'conducao-batida.json';
/** O retrato da ultima batida vale para o pulse por tres batidas do template (`*\/15`); depois, nada se afirma dele. */
export const VALIDADE_DO_RETRATO_MS = 45 * 60 * 1000;
/** A espera da batida (check pendente, estado do merge desconhecido) que passa disto vira item do dono. */
export const ESPERA_LONGA_MS = 2 * 60 * 60 * 1000;
/** Os modos em que a #TAG ja autoriza o push (`MODOS_QUE_AUTORIZAM_PUSH`, `ship.ts`): so neles a batida mescla e despacha. */
const MODOS_QUE_ANDAM_SOZINHOS: readonly string[] = ['auto', 'maestro'];
const PRAZO_DO_GH_MS = 30000;
const CAMPOS_DO_PR = 'number,title,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,mergeable,mergeStateStatus,url';

export type AcaoDaBatida = 'limpar' | 'registrar' | 'master' | 'merge' | 'despachar';
/** O motivo de uma acao que esperou: o da autorizacao, o do bloqueio, ou um destes. */
export type MotivoDaEspera = 'checks-pendentes' | 'estado-desconhecido' | 'merge-sem-prova' | 'branch-atualizada';
export type MotivoDaRecusa = 'merge-recusado' | 'atualizacao-recusada' | 'despacho-recusado' | 'retomada-recusada' | 'acao-recusada';

export interface ItemDaBatida {
  acao: AcaoDaBatida;
  thread: string;
  fase: string | null;
  /** `feita`: a batida fez. `espera`: ela tenta de novo na proxima rodada. `dono`: so o dono destrava. */
  resultado: 'feita' | 'espera' | 'dono';
  /** O motivo tipado: da autorizacao (`autorizacao.*`, `acao-fora-da-autorizacao`), do bloqueio, da espera ou da recusa. */
  motivo: string | null;
  /** O que a acao faz, para o dono. */
  oQue: string;
  /** O que aconteceu, numa linha. */
  detalhe: string;
  /** O comando pronto do dono. */
  comando: string;
  evidencia: string;
  /** Desde quando a acao espera (estavel entre batidas: o resumo nao repete a mesma noticia). */
  desdeEm: string | null;
  pr: number | null;
}

export interface BatidaDaConducao {
  contrato: typeof CONTRATO_DA_BATIDA;
  consultadoEm: string;
  maquina: string;
  autorizacao: { valida: boolean; motivo: string | null; detalhe: string | null; por: string | null; ate: string | null; pode: string[] };
  busca: { ok: boolean; detalhe: string } | null;
  /** A leitura dos PRs da forja: `null` sem thread com branch a mesclar. */
  forja: { ok: boolean; detalhe: string } | null;
  /** A Sentinela desta maquina conduz o despacho agora: a batida cede tudo, menos a retomada por cota (RM-064 T5). */
  sentinela: boolean;
  feitas: ItemDaBatida[];
  pendentes: ItemDaBatida[];
}

/** Um PR aberto da forja, como o merge o le. */
export interface PrAberto {
  numero: number;
  titulo: string;
  branch: string;
  head: string;
  base: string;
  rascunho: boolean;
  /** `MERGEABLE`, `CONFLICTING` ou `UNKNOWN`. */
  mergeable: string;
  /** `CLEAN`, `BEHIND`, `DIRTY`, `BLOCKED`, `UNSTABLE`, `HAS_HOOKS`, `DRAFT` ou `UNKNOWN`. */
  estado: string;
  url: string | null;
}

/** Um check obrigatorio do PR (`gh pr checks --required`): `bucket` e pass, fail, pending, skipping ou cancel. */
export interface CheckObrigatorio { nome: string; bucket: string }

export interface OpcoesDaBatida extends OpcoesDaDeteccao {
  autorizacao?: LeituraDaAutorizacao;
  /** Traz a base remota antes (padrao: sim). */
  buscar?: boolean;
  /** Quem roda o `gh`; os testes trocam. */
  executorGh?: ExecutorDoGh;
  /** O repositorio da forja; sem ele, o do remoto (so GitHub). `null` desliga o merge. */
  forja?: { host: string; repositorio: string } | null;
  canal?: CanalDeConducao;
  /** Os testes trocam o despacho e a retomada; sem eles, o `rodarFase` e o `executarRetry` do nucleo. */
  despachar?: (carregado: ManifestoCarregado, thread: string, fase: Fase, prompt: string, canal: CanalDeConducao, correlacao: string) =>
    { ok: boolean; detalhe: string; sessionId: string | null };
  retomar?: (carregado: ManifestoCarregado, thread: string) => { automatica: boolean; ok: boolean; detalhe: string };
}

/**
 * RM-064 T5: a Sentinela pode conduzir fases, mas a conta dela também pode esgotar. A reação ao sinal tipado de cota
 * pertence à batida da máquina; todo o resto continua cedido, evitando dois condutores gerais concorrentes.
 */
export function passosDaBatida(passos: readonly PassoDoCondutor[], sentinela: boolean): PassoDoCondutor[] {
  if (!sentinela) return [...passos];
  return passos.filter((p) => p.acao === 'retomar' && p.bloqueio?.motivo === 'runtime.quota-exhausted');
}

// ---------------------------------------------------------------------------
// A forja: os PRs abertos e os checks obrigatorios.
// ---------------------------------------------------------------------------

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Os PRs abertos da base, so do mesmo repositorio. */
export function lerPrsAbertos(executor: ExecutorDoGh, forja: { host: string; repositorio: string }, base: string):
  { ok: true; prs: PrAberto[] } | { ok: false; erro: string } {
  const r = executor(['pr', 'list', `--repo=${forja.host}/${forja.repositorio}`, `--base=${base}`, '--state=open', '--limit=100',
    `--json=${CAMPOS_DO_PR}`], PRAZO_DO_GH_MS);
  if (r.status !== 0) return { ok: false, erro: `gh pr list saiu ${r.status ?? 'sem código'}: ${r.stderr.trim().split('\n')[0]?.slice(0, 160) ?? ''}` };
  let bruto: unknown;
  try { bruto = JSON.parse(r.stdout); } catch { return { ok: false, erro: 'gh pr list respondeu JSON inválido' }; }
  if (!Array.isArray(bruto)) return { ok: false, erro: 'gh pr list não respondeu uma lista' };
  const prs: PrAberto[] = [];
  for (const x of bruto as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object' || x.isCrossRepository === true || !Number.isInteger(x.number)) continue;
    if (!/^[0-9a-f]{40}$/.test(texto(x.headRefOid))) continue;
    prs.push({ numero: x.number as number, titulo: texto(x.title).slice(0, 240), branch: texto(x.headRefName), head: texto(x.headRefOid),
      base: texto(x.baseRefName), rascunho: x.isDraft === true, mergeable: texto(x.mergeable) || 'UNKNOWN',
      estado: texto(x.mergeStateStatus) || 'UNKNOWN', url: texto(x.url) || null });
  }
  return { ok: true, prs };
}

/** Os checks obrigatorios do PR. Sem nenhum obrigatorio na base, a lista vem vazia (e o merge fica com o dono). */
export function lerChecksObrigatorios(executor: ExecutorDoGh, forja: { host: string; repositorio: string }, numero: number):
  { ok: true; checks: CheckObrigatorio[] } | { ok: false; erro: string } {
  const r = executor(['pr', 'checks', String(numero), `--repo=${forja.host}/${forja.repositorio}`, '--required', '--json=name,bucket,state'],
    PRAZO_DO_GH_MS);
  // O `gh pr checks` sai 8 com check pendente e 1 com check falho: o JSON vem nos dois casos.
  try {
    const lido = JSON.parse(r.stdout) as unknown;
    if (Array.isArray(lido)) {
      return { ok: true, checks: lido.map((c) => ({ nome: texto((c as Record<string, unknown>).name), bucket: texto((c as Record<string, unknown>).bucket) })) };
    }
  } catch { /* sem JSON: a base sem check obrigatorio, ou falha do gh */ }
  if (/no required checks/i.test(`${r.stderr}\n${r.stdout}`)) return { ok: true, checks: [] };
  return { ok: false, erro: `gh pr checks --required saiu ${r.status ?? 'sem código'}: ${(r.stderr || r.stdout).trim().split('\n')[0]?.slice(0, 160) ?? ''}` };
}

/** O assunto do merge: o `ship(<thread>)` que o registro da entrega e a varredura procuram na base. */
export function assuntoDoMerge(thread: string, pr: Pick<PrAberto, 'numero' | 'titulo'>): string {
  const titulo = pr.titulo.trim();
  const comPrefixo = titulo.startsWith(`ship(${thread})`) ? titulo : `ship(${thread}): ${titulo || `entrega do PR #${pr.numero}`}`;
  return `${comPrefixo} (#${pr.numero})`;
}

/** O comando do merge que o dono roda (e que a batida roda com a autorizacao). */
export function comandoDoMerge(forja: { host: string; repositorio: string }, thread: string, pr: PrAberto): string {
  // O titulo do PR vem do agente que o abriu: entre aspas simples, `$(...)` e crase colados no terminal nao rodam.
  return `gh pr merge ${pr.numero} --repo ${forja.host}/${forja.repositorio} --merge --match-head-commit ${pr.head} ` +
    `--subject ${citarNoShell(assuntoDoMerge(thread, pr))}`;
}

/**
 * O estado do merge, puro: o que o PR precisa antes de entrar. `pronto` so com os checks obrigatorios todos verdes (ou
 * pulados) e o PR limpo; `atualizar` quando a branch ficou para tras ou conflita (o merge da base resolve, ou diz o
 * conflito em codigo); o resto e espera da batida ou bloqueio do dono.
 */
export function avaliarPr(pr: PrAberto, checks: readonly CheckObrigatorio[]):
  { estado: 'pronto' } | { estado: 'atualizar' } | { estado: 'espera'; motivo: MotivoDaEspera; detalhe: string } |
  { estado: 'dono'; motivo: MotivoDoBloqueio; detalhe: string } {
  if (pr.rascunho || pr.estado === 'DRAFT') return { estado: 'dono', motivo: 'pr-rascunho', detalhe: `o PR #${pr.numero} está em rascunho` };
  if (pr.mergeable === 'CONFLICTING' || pr.estado === 'DIRTY' || pr.estado === 'BEHIND') return { estado: 'atualizar' };
  const vermelhos = checks.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel');
  if (vermelhos.length) {
    return { estado: 'dono', motivo: 'checks-vermelhos', detalhe: `check obrigatório vermelho: ${vermelhos.map((c) => c.nome).join(', ').slice(0, 200)}` };
  }
  const pendentes = checks.filter((c) => c.bucket === 'pending' || !['pass', 'skipping'].includes(c.bucket));
  if (pendentes.length) {
    return { estado: 'espera', motivo: 'checks-pendentes', detalhe: `${pendentes.length} de ${checks.length} check(s) obrigatório(s) pendente(s)` };
  }
  if (!checks.length) {
    return { estado: 'dono', motivo: 'sem-checks-obrigatorios', detalhe: 'a base não exige check nenhum: o merge sem check obrigatório verde fica com o dono' };
  }
  if (pr.estado === 'CLEAN' || pr.estado === 'HAS_HOOKS') return { estado: 'pronto' };
  if (pr.estado === 'BLOCKED') return { estado: 'dono', motivo: 'pr-bloqueado', detalhe: 'o GitHub bloqueia o merge com os checks obrigatórios verdes' };
  if (pr.estado === 'UNSTABLE') return { estado: 'dono', motivo: 'pr-instavel', detalhe: 'há check não obrigatório vermelho' };
  return { estado: 'espera', motivo: 'estado-desconhecido', detalhe: `o GitHub ainda não calculou o estado do merge (${pr.estado})` };
}

// ---------------------------------------------------------------------------
// O registro de cada acao no ledger da thread.
// ---------------------------------------------------------------------------

/** As recusas de uma tentativa da batida: so elas (e o que ela fez) vao ao ledger; sem autorizacao ou com bloqueio, so a fila. */
const TENTATIVAS_RECUSADAS: readonly string[] = ['merge-recusado', 'atualizacao-recusada', 'despacho-recusado', 'retomada-recusada',
  'conflito-em-codigo', 'merge-sem-prova'];

function registrarAcao(raiz: string, item: ItemDaBatida, leitura: LeituraDaAutorizacao): void {
  // O `gh pr merge` que respondeu sem a prova na base (fila de merge, merge automatico) e uma tentativa: vai ao ledger.
  if (item.resultado !== 'feita' && !TENTATIVAS_RECUSADAS.includes(item.motivo ?? '')) return;
  const referencia = referenciaDaAutorizacao(leitura);
  const resultado = item.resultado === 'feita' ? 'feita' : 'recusada';
  const detalhe = item.detalhe.slice(0, 400);
  let anterior: Record<string, unknown> | undefined;
  try {
    anterior = [...lerLedger(dirThread(raiz, item.thread))].reverse()
      .find((e) => e.tipo === TIPOS_DE_EVENTO.acaoDaVarredura && e.acao === item.acao);
  } catch { /* sem ledger, a linha vai */ }
  // A mesma recusa da rodada anterior nao vira linha nova a cada batida.
  if (resultado === 'recusada' && anterior?.resultado === 'recusada' && anterior.detalhe === detalhe && anterior.motivo === item.motivo) return;
  try {
    registrar(dirThread(raiz, item.thread), item.thread, TIPOS_DE_EVENTO.acaoDaVarredura, {
      fase: item.fase, acao: item.acao, resultado, motivo: item.motivo, detalhe, comando: item.comando, origem: 'conducao.batida',
      ...(item.pr ? { pr: item.pr } : {}), autorizacao: referencia,
      quemDecidiu: referencia ? `batida da condução do ork, pela autorização durável de ${String(referencia.por)}` : null,
      evidencia: item.evidencia,
    });
  } catch { /* a acao vale; o ledger e o rastro */ }
}

// ---------------------------------------------------------------------------
// As acoes.
// ---------------------------------------------------------------------------

const andaSozinha = (t: Thread): boolean => MODOS_QUE_ANDAM_SOZINHOS.includes(t.modo);

/** O motivo da autorizacao que impede a acao, ou `null` quando ela esta autorizada. */
function semAutorizacao(leitura: LeituraDaAutorizacao, acao: AcaoAutorizavel): string | null {
  if (!leitura.valida) return leitura.motivo;
  return autorizada(leitura, acao) ? null : 'acao-fora-da-autorizacao';
}

function threadsAbertas(raiz: string): Thread[] {
  const saida: Thread[] = [];
  for (const id of listarIds(raiz)) {
    try { const t = lerThread(raiz, id); if (t.status !== 'fechada') saida.push(t); } catch { /* thread ilegivel fica de fora */ }
  }
  return saida;
}

/**
 * A branch local da thread contra o head do PR. `igual`; `atras` (o PR tem commits que a local nao tem: o "Update branch"
 * do GitHub ou um push de outra maquina); `merges-da-base` (a local so tem, alem do PR, merges da base, como os que a
 * batida faz e ainda nao empurrou); `fora-do-pr` (a local tem trabalho que o PR nao tem: o merge levaria a entrega sem
 * ele, e a atualizacao o empurraria sem CHECK); `sem-resposta` (o git nao respondeu, ou o head do PR nao chegou aqui).
 */
export function alinhamentoDaBranch(raiz: string, remoto: string, branch: string, head: string, baseRef: string):
  { estado: 'igual' | 'atras' | 'merges-da-base' | 'fora-do-pr' | 'sem-resposta'; fora: number } {
  const local = exec('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`], raiz, 30000);
  if (!local.ok) return { estado: 'igual', fora: 0 };
  if (local.stdout.trim() === head) return { estado: 'igual', fora: 0 };
  if (!exec('git', ['cat-file', '-e', `${head}^{commit}`], raiz, 30000).ok) {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' };
    exec('git', ['fetch', '-q', '--no-tags', '--', remoto, `+refs/heads/${branch}:refs/remotes/${remoto}/${branch}`], raiz, 60000, env);
    if (!exec('git', ['cat-file', '-e', `${head}^{commit}`], raiz, 30000).ok) return { estado: 'sem-resposta', fora: 0 };
  }
  // So o que a local tem alem do PR e da base: os commits que o merge da base trouxe sao da base, nao trabalho da thread.
  const r = exec('git', ['rev-list', '--parents', `${head}..refs/heads/${branch}`, '--not', baseRef], raiz, 30000);
  if (!r.ok) return { estado: 'sem-resposta', fora: 0 };
  const fora = r.stdout.split('\n').map((l) => l.trim().split(/\s+/)).filter((l) => l[0]);
  if (!fora.length) return { estado: 'atras', fora: 0 };
  const daBase = (c: string[]) => c.length === 3 && exec('git', ['merge-base', '--is-ancestor', c[2], baseRef], raiz, 30000).ok;
  return fora.every(daBase) ? { estado: 'merges-da-base', fora: fora.length } : { estado: 'fora-do-pr', fora: fora.filter((c) => !daBase(c)).length };
}

interface ContextoDaBatida {
  carregado: ManifestoCarregado;
  raiz: string;
  quando: string;
  leitura: LeituraDaAutorizacao;
  vivas: ReturnType<typeof lerSessoes>['vivas'];
  canal: CanalDeConducao;
  correlacao: string;
  feitas: ItemDaBatida[];
  pendentes: ItemDaBatida[];
}

function anotar(ctx: ContextoDaBatida, item: ItemDaBatida): void {
  (item.resultado === 'feita' ? ctx.feitas : ctx.pendentes).push(item);
  registrarAcao(ctx.raiz, item, ctx.leitura);
}

/** O merge dos PRs prontos (e a atualizacao dos que ficaram para tras), thread por thread. */
function mesclarProntos(ctx: ContextoDaBatida, threads: Thread[], opcoes: OpcoesDaBatida): { ok: boolean; detalhe: string } | null {
  const { carregado, raiz } = ctx;
  const remoto = carregado.manifesto.fabrica.remoto, base = carregado.manifesto.worktree.base_branch;
  const candidatas = threads.filter((t) => andaSozinha(t) && branchDaWorktree(t).startsWith('ork/'));
  if (!candidatas.length) return null;
  const forja = opcoes.forja === undefined ? githubDoRemoto(raiz, remoto) : opcoes.forja;
  if (!forja) return { ok: false, detalhe: `o remoto ${remoto} não é um GitHub que o gh lê: o merge fica com o dono` };
  const executor = opcoes.executorGh ?? ghPadrao;
  const lidos = lerPrsAbertos(executor, forja, base);
  if (!lidos.ok) return { ok: false, detalhe: lidos.erro };
  for (const t of candidatas) {
    const branch = branchDaWorktree(t);
    const pr = lidos.prs.filter((p) => p.branch === branch && p.base === base).sort((a, b) => b.numero - a.numero)[0];
    if (!pr) continue;
    const item = (resultado: ItemDaBatida['resultado'], motivo: string | null, detalhe: string, oQue?: string, comando?: string): ItemDaBatida => ({
      acao: 'merge', thread: t.id, fase: t.faseAtual, resultado, motivo, detalhe,
      oQue: oQue ?? textoDoCatalogo((m) => m.pulse.varredura.oQue.merge(pr.numero, branch, `${remoto}/${base}`)),
      comando: comando ?? comandoDoMerge(forja, t.id, pr), evidencia: `gh pr view ${pr.numero}: ${pr.estado}, mergeable ${pr.mergeable}`,
      desdeEm: null, pr: pr.numero });
    const checks = lerChecksObrigatorios(executor, forja, pr.numero);
    if (!checks.ok) { anotar(ctx, item('espera', 'estado-desconhecido', checks.erro)); continue; }
    const avaliacao = avaliarPr(pr, checks.checks);
    if (avaliacao.estado === 'espera') { anotar(ctx, item('espera', avaliacao.motivo, avaliacao.detalhe)); continue; }
    if (avaliacao.estado === 'dono') { anotar(ctx, item('dono', avaliacao.motivo, avaliacao.detalhe)); continue; }
    // Pronto ou para atualizar: primeiro o estado (quem trabalha na thread, o que espera o dono, a branch local e o
    // CHECK), e so depois a autorizacao: o dono so recebe "pronto" do PR que esta pronto de verdade.
    const atualizar = avaliacao.estado === 'atualizar';
    const oQue = atualizar ? textoDoCatalogo((m) => m.pulse.varredura.oQue.atualizar(pr.numero, branch, `${remoto}/${base}`)) : undefined;
    const comando = atualizar ? `ork conducao atualizar ${t.id} --enviar` : undefined;
    const trabalho = trabalhoNaWorktree(raiz, t, ctx.quando, ctx.vivas);
    if (trabalho) { anotar(ctx, item('dono', trabalho.motivo, trabalho.texto, oQue, `ork thread status ${t.id}`)); continue; }
    let eventos: ReturnType<typeof lerLedger> = [];
    try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { eventos = []; }
    const doDono = pendenciaDoDono(t, eventos, ctx.quando);
    if (doDono) { anotar(ctx, item('dono', 'pendencia-do-dono', doDono, oQue, `ork thread status ${t.id}`)); continue; }
    // A branch local nao pode ter trabalho que o PR nao tem: o merge o deixaria de fora, e a atualizacao o empurraria
    // para o PR sem CHECK. Os merges da base que a batida fez e nao empurrou nao contam.
    const alinhada = alinhamentoDaBranch(raiz, remoto, branch, pr.head, `refs/remotes/${remoto}/${base}`);
    if (alinhada.estado === 'fora-do-pr' || alinhada.estado === 'sem-resposta') {
      anotar(ctx, item('dono', alinhada.estado === 'sem-resposta' ? 'git-sem-resposta' : 'branch-nao-publicada', alinhada.estado === 'sem-resposta'
        ? 'o git não respondeu sobre a branch' : `a branch local tem ${alinhada.fora} commit(s) que o PR #${pr.numero} não tem`, oQue,
        `ork thread status ${t.id}`));
      continue;
    }
    // O merge so leva o que passou pelo CHECK: o veredito PASSOU gravado depois do ultimo commit de produto do PR.
    if (!atualizar) {
      const check = conferirCheck(raiz, t, `refs/remotes/${remoto}/${base}`, pr.head);
      if (check.etapa.estado !== 'feita' && check.etapa.estado !== 'nao-se-aplica') {
        anotar(ctx, item('dono', 'check-pendente', check.etapa.texto, undefined, `ork thread status ${t.id}`));
        continue;
      }
    }
    const fora = semAutorizacao(ctx.leitura, 'merge');
    if (fora) {
      anotar(ctx, item('dono', fora, atualizar ? `o PR #${pr.numero} precisa da base (${pr.estado})` : `o PR #${pr.numero} está pronto`, oQue, comando));
      continue;
    }
    if (atualizar) {
      anotar(ctx, atualizacaoDoPr(ctx, t, pr, oQue as string, comando as string, alinhada.estado === 'atras' ? pr.head : null));
      continue;
    }
    const r = executor(['pr', 'merge', String(pr.numero), `--repo=${forja.host}/${forja.repositorio}`, '--merge',
      '--match-head-commit', pr.head, '--subject', assuntoDoMerge(t.id, pr)], 120000);
    if (r.status !== 0) {
      anotar(ctx, item('dono', 'merge-recusado', `gh pr merge saiu ${r.status ?? 'sem código'}: ${(r.stderr || r.stdout).trim().split('\n')[0]?.slice(0, 200) ?? ''}`));
      continue;
    }
    // A prova: o merge `ship(<thread>)` com o head do PR como segundo pai, na copia da base trazida agora.
    buscarBase(carregado);
    const merge = mergeDaEntrega(raiz, t.id, remoto, base);
    if (!merge || merge.headSha !== pr.head) {
      anotar(ctx, item('espera', 'merge-sem-prova', `gh pr merge respondeu, mas ${remoto}/${base} ainda não tem o merge ship(${t.id}) do head ` +
        `${pr.head.slice(0, 8)} (fila de merge ou merge automático)`));
      continue;
    }
    anotar(ctx, { ...item('feita', null, `PR #${pr.numero} mesclado em ${remoto}/${base}: ${merge.mergeSha.slice(0, 8)}`),
      evidencia: `git log ${remoto}/${base}: merge ship(${t.id}) ${merge.mergeSha.slice(0, 8)} com o head ${pr.head.slice(0, 8)}` });
  }
  return { ok: true, detalhe: `${lidos.prs.length} PR(s) aberto(s) lidos em ${forja.host}/${forja.repositorio}` };
}

/** O PR para tras ou em conflito: o merge da base na branch, com o CHANGELOG reconciliado, e a branch empurrada. */
function atualizacaoDoPr(ctx: ContextoDaBatida, t: Thread, pr: PrAberto, oQue: string, comando: string,
  alinharCom: string | null): ItemDaBatida {
  const base: Omit<ItemDaBatida, 'resultado' | 'motivo' | 'detalhe'> = { acao: 'merge', thread: t.id, fase: t.faseAtual, oQue, comando,
    evidencia: `gh pr view ${pr.numero}: ${pr.estado}, mergeable ${pr.mergeable}`, desdeEm: null, pr: pr.numero };
  let r: ResultadoDaAtualizacao;
  try {
    r = atualizarBranchDaThread(ctx.carregado, t.id, { buscar: false, enviar: true, canal: ctx.canal, correlacao: ctx.correlacao,
      ...(alinharCom ? { alinharCom } : {}) });
  } catch (e) { return { ...base, resultado: 'dono', motivo: 'atualizacao-recusada', detalhe: (e as Error).message.slice(0, 300) }; }
  switch (r.acao) {
    case 'mesclada':
      return { ...base, resultado: 'feita', motivo: 'branch-atualizada', detalhe: `${r.base} mesclada na ${r.branch} (${r.sha.slice(0, 8)})` +
        (r.changelog?.devolvidos ? `, ${r.changelog.devolvidos} item(ns) da thread de volta a "Não publicado"` : '') +
        `; o PR #${pr.numero} espera o CI do novo head` };
    case 'ja-atualizada':
      // O merge da base que ja estava na branch local e nao tinha chegado ao PR (push falho) foi empurrado agora.
      if (r.enviada) {
        return { ...base, resultado: 'feita', motivo: 'branch-atualizada', detalhe: `a ${r.branch} com ${r.base} foi empurrada (${r.sha.slice(0, 8)}); ` +
          `o PR #${pr.numero} espera o CI do novo head` };
      }
      return { ...base, resultado: 'espera', motivo: 'estado-desconhecido', detalhe: `a branch já contém ${r.base}; o GitHub ainda não recalculou o PR` };
    case 'conflito-em-codigo':
      return { ...base, resultado: 'dono', motivo: 'conflito-em-codigo', detalhe: `o merge de ${r.base} conflita em: ${r.arquivos.join(', ').slice(0, 200)}`,
        comando: `ork thread status ${t.id}` };
    default:
      return { ...base, resultado: 'dono', motivo: r.motivo === 'conduzida' || r.motivo === 'worktree-suja' ? r.motivo : 'atualizacao-recusada',
        detalhe: r.detalhe.slice(0, 300) };
  }
}

/** O despacho da fase seguinte e a retomada pelo retry, pelo passo do nucleo. */
function despacharPassos(ctx: ContextoDaBatida, passos: PassoDoCondutor[], opcoes: OpcoesDaBatida): void {
  const { carregado, raiz } = ctx;
  for (const p of passos) {
    if (p.conduzida || p.modo !== 'auto' || (p.acao !== 'despachar' && p.acao !== 'retomar')) continue;
    const fase = p.acao === 'despachar' ? p.fase : null;
    const oQue = p.acao === 'despachar' ? textoDoCatalogo((m) => m.pulse.varredura.oQue.despachar(String(fase)))
      : textoDoCatalogo((m) => m.pulse.varredura.oQue.retomar(p.faseAtual));
    const comando = p.acao === 'despachar' ? `ork phase run ${p.thread} ${fase} --prompt "$(ork prompt render ${p.thread} ${fase})"`
      : `ork retry run ${p.thread}`;
    const item = (resultado: ItemDaBatida['resultado'], motivo: string | null, detalhe: string): ItemDaBatida => ({
      acao: 'despachar', thread: p.thread, fase: fase ?? p.faseAtual, resultado, motivo, detalhe, oQue, comando,
      evidencia: `passo do núcleo: ${p.porque}`.slice(0, 300), desdeEm: p.desdeEm, pr: null });
    if (p.acao === 'despachar' && !p.pedidoGuardado) {
      anotar(ctx, item('dono', 'sem-prompt-gravado', 'a thread não tem o pedido guardado na criação: sem prompt gravado, nada sai'));
      continue;
    }
    const fora = semAutorizacao(ctx.leitura, 'despachar');
    // A retomada sem autorização não vira item: o pulse já leva o bloqueio da thread com o `ork retry run` (ou o
    // `retry plan`), e um segundo item da mesma parada seria ruído no resumo do dono.
    if (fora && p.acao === 'retomar') continue;
    if (fora) { anotar(ctx, item('dono', fora, p.porque)); continue; }
    if (p.acao === 'despachar' && fase) {
      let pedido: { texto: string } | null = null;
      try { pedido = pedidoDaThread(raiz, lerThread(raiz, p.thread)); } catch (e) {
        anotar(ctx, item('dono', 'sem-prompt-gravado', (e as Error).message.slice(0, 200)));
        continue;
      }
      if (!pedido) { anotar(ctx, item('dono', 'sem-prompt-gravado', 'a thread não tem o pedido guardado na criação')); continue; }
      const despachar = opcoes.despachar ?? despachoPeloNucleo;
      const r = despachar(carregado, p.thread, fase, pedido.texto, ctx.canal, ctx.correlacao);
      anotar(ctx, r.ok ? item('feita', null, `fase ${fase} despachada${r.sessionId ? ` (sessão ${r.sessionId.slice(0, 8)})` : ''}`)
        : item('dono', 'despacho-recusado', r.detalhe));
      continue;
    }
    const retomar = opcoes.retomar ?? retomadaPeloNucleo;
    const r = retomar(carregado, p.thread);
    // O plano que não é automático já é item do dono no pulse (o bloqueio, com o `retry plan`): a batida só o deixa.
    if (!r.automatica) continue;
    anotar(ctx, r.ok ? item('feita', null, r.detalhe) : item('dono', 'retomada-recusada', r.detalhe));
  }
}

/** O despacho pelo nucleo, como o #Noctum: o pedido guardado, o canal de quem pediu e a correlacao da batida. */
function despachoPeloNucleo(carregado: ManifestoCarregado, thread: string, fase: Fase, prompt: string, canal: CanalDeConducao,
  correlacao: string): { ok: boolean; detalhe: string; sessionId: string | null } {
  try {
    const r = rodarFase(carregado, thread, { fase, prompt, canal, correlacao, baselinePeloDespacho: false });
    if (r.idempotente) return { ok: true, detalhe: 'o mesmo pedido já está em andamento', sessionId: r.sessionId };
    if (r.bloqueado || !r.sessionId) {
      return { ok: false, detalhe: (r.recusa?.texto.split('\n')[0] ?? r.erro ?? `despacho recusado (${r.motivo ?? 'sem sessão'})`).slice(0, 300),
        sessionId: null };
    }
    return { ok: true, detalhe: `sessão ${r.sessionId.slice(0, 8)}`, sessionId: r.sessionId };
  } catch (e) { return { ok: false, detalhe: (e as Error).message.slice(0, 300), sessionId: null }; }
}

/** A retomada pelo retry do nucleo, so com o plano automatico e sem bloqueio (a mesma regra da Sentinela). */
function retomadaPeloNucleo(carregado: ManifestoCarregado, thread: string): { automatica: boolean; ok: boolean; detalhe: string } {
  try {
    const plano = planejarRetry(carregado, thread);
    if (!plano.automatica || plano.bloqueio) return { automatica: false, ok: false, detalhe: `o retry plan não é automático: ${plano.razao}`.slice(0, 300) };
    const r = executarRetry(carregado, thread);
    return { automatica: true, ok: r.executada, detalhe: r.detalhe.slice(0, 300) };
  } catch (e) { return { automatica: true, ok: false, detalhe: (e as Error).message.slice(0, 300) }; }
}

/** As acoes da varredura da F5, no formato da batida. */
function daVarredura(v: VarreduraQueAge, ctx: ContextoDaBatida): void {
  for (const f of v.feitas) {
    const item: ItemDaBatida = { acao: f.acao as AcaoDaBatida, thread: f.thread, fase: null, resultado: f.resultado === 'feita' ? 'feita' : 'dono',
      motivo: f.resultado === 'feita' ? null : 'acao-recusada', oQue: f.acao, detalhe: f.detalhe, comando: '', evidencia: '', desdeEm: null, pr: null };
    if (item.resultado === 'feita') ctx.feitas.push(item);
  }
  for (const p of v.pendentes) {
    ctx.pendentes.push({ acao: p.acao as AcaoDaBatida, thread: p.thread, fase: p.fase, resultado: 'dono',
      motivo: p.motivoDoBloqueio ?? (p.recusa ? 'acao-recusada' : semAutorizacao(ctx.leitura, p.acao as AcaoAutorizavel)),
      oQue: p.oQue, detalhe: p.recusa?.detalhe ?? p.bloqueio ?? p.oQue, comando: p.bloqueio ? `ork thread status ${p.thread}` : p.comando,
      evidencia: p.evidencia, desdeEm: p.desdeEm, pr: null });
  }
}

/**
 * A batida da conducao: traz a base, mescla os PRs prontos, roda a varredura da F5 (limpar, registrar, master) e
 * despacha a fase seguinte. Le a autorizacao uma vez; o que ela nao cobre fica pendente, com o motivo e o comando.
 */
export function conduzirBatida(carregado: ManifestoCarregado, opcoes: OpcoesDaBatida = {}): BatidaDaConducao {
  const raiz = raizDoEstado(carregado.raiz);
  const doProjeto = { ...carregado, raiz };
  const quando = opcoes.quando ?? new Date().toISOString();
  const maquina = nomeDaMaquina();
  const leitura = opcoes.autorizacao ?? lerAutorizacao(raiz, { projeto: carregado.manifesto.project.name, agora: new Date(quando) });
  const busca = opcoes.buscar === false ? null : buscarBase(doProjeto);
  const sessoes = lerSessoes(raiz, opcoes);
  const ctx: ContextoDaBatida = { carregado: doProjeto, raiz, quando, leitura, vivas: sessoes.vivas, canal: opcoes.canal ?? canalDoProcesso(),
    correlacao: `batida:${maquina}`, feitas: [], pendentes: [] };
  const threads = threadsAbertas(raiz);
  // RM-064 T9: um watcher que falhou no despacho não pode ocultar o fim nativo da sessão.
  // A reconciliação é local e fail-closed; a rodada seguinte deriva retomar ou pendência do dono.
  for (const thread of threads) {
    try { reconciliarSessaoSemWatcher(doProjeto, thread.id, Date.parse(quando)); }
    catch { /* o diagnóstico da observação fica no ledger; uma thread não interrompe as outras */ }
  }
  // 1. O merge dos PRs prontos: o que entra na base agora e registrado pela varredura nesta mesma batida.
  const forja = mesclarProntos(ctx, threads, opcoes);
  // 2. A varredura da F5, depois do merge e sobre a mesma leitura das sessoes.
  const mesclou = ctx.feitas.some((f) => f.acao === 'merge' && f.motivo === null);
  const v = agirNaVarredura(doProjeto, { ...opcoes, quando, autorizacao: leitura, buscar: mesclou,
    fantasmas: () => sessoes.fantasmas, vivas: () => sessoes.vivas });
  daVarredura(v, ctx);
  // 3. O despacho comum: com a Sentinela ligada nesta maquina, ela conduz. Cota sempre fica com a batida.
  let sentinela = false;
  try { sentinela = presencaDaSentinela(raiz, { agora: new Date(quando), maquina })?.ativa === true; } catch { sentinela = false; }
  let passos: PassoDoCondutor[] = [];
  try { passos = passosDoCondutor(doProjeto, { quando }); } catch { passos = []; }
  despacharPassos(ctx, passosDaBatida(passos, sentinela), opcoes);
  const a = leitura.valida ? leitura.autorizacao : null;
  return {
    contrato: CONTRATO_DA_BATIDA, consultadoEm: quando, maquina,
    autorizacao: { valida: leitura.valida, motivo: leitura.valida ? null : leitura.motivo, detalhe: leitura.valida ? null : leitura.detalhe,
      por: a?.por ?? null, ate: a?.ate ?? null, pode: a ? [...a.pode] : [] },
    busca, forja, sentinela, feitas: ctx.feitas, pendentes: ctx.pendentes,
  };
}

// ---------------------------------------------------------------------------
// O retrato da ultima batida, a trava e o registro da rodada.
// ---------------------------------------------------------------------------

function caminhoDoRetrato(raiz: string): string {
  return path.join(raizDoEstado(raiz), '.orkastery', 'monitor', ARQUIVO_DA_BATIDA);
}

export function lerRetratoDaBatida(raiz: string): BatidaDaConducao | null {
  try {
    const r = JSON.parse(fs.readFileSync(caminhoDoRetrato(raiz), 'utf8')) as BatidaDaConducao;
    return r && r.contrato === CONTRATO_DA_BATIDA && Array.isArray(r.pendentes) && Array.isArray(r.feitas) ? r : null;
  } catch { return null; }
}

/**
 * Sem a leitura dos PRs nesta rodada (o `gh` fora, a rede caida), os merges pendentes da rodada anterior continuam
 * pendentes, com o `desdeEm` deles: a falha passageira nao apaga a fila do dono e nao reabre a mesma noticia depois.
 */
function comMergesDaRodadaAnterior(nova: BatidaDaConducao, anterior: BatidaDaConducao | null, raiz: string): BatidaDaConducao {
  if (!anterior || !nova.forja || nova.forja.ok) return nova;
  const jaTem = new Set(nova.pendentes.filter((i) => i.acao === 'merge').map((i) => i.thread));
  const herdados = anterior.pendentes.filter((i) => i.acao === 'merge' && !jaTem.has(i.thread)).filter((i) => {
    try { return lerThread(raiz, i.thread).status !== 'fechada'; } catch { return false; }
  });
  return herdados.length ? { ...nova, pendentes: [...nova.pendentes, ...herdados] } : nova;
}

/** O `desdeEm` de cada pendente fica o da primeira batida que o viu: o resumo ao dono nao repete a mesma noticia. */
function comDesdeEstavel(nova: BatidaDaConducao, anterior: BatidaDaConducao | null): BatidaDaConducao {
  const chave = (i: ItemDaBatida) => [i.acao, i.thread, i.motivo, i.pr ?? ''].join('|');
  const antes = new Map((anterior?.pendentes ?? []).map((i) => [chave(i), i.desdeEm] as const));
  return { ...nova, pendentes: nova.pendentes.map((i) => ({ ...i, desdeEm: i.desdeEm ?? antes.get(chave(i)) ?? nova.consultadoEm })) };
}

function gravarRetrato(raiz: string, r: BatidaDaConducao): void {
  const arquivo = caminhoDoRetrato(raiz);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(temporario, JSON.stringify(r, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporario, arquivo);
  } finally { fs.rmSync(temporario, { force: true }); }
}

export type RodadaDaBatida = { ocupada: true; detalhe: string } | ({ ocupada: false } & BatidaDaConducao);

/**
 * A batida inteira, como o cron e o `ork conducao batida` a rodam: uma por vez nesta maquina (a mesma trava da varredura
 * que age, `varredura-acoes.lock`), o retrato gravado para o pulse e a linha `varredura_acoes` no `hitl.log`.
 */
export function baterConducao(carregado: ManifestoCarregado, opcoes: OpcoesDaBatida = {}): RodadaDaBatida {
  const raiz = raizDoEstado(carregado.raiz);
  const dir = path.join(raiz, '.orkastery', 'monitor');
  const quando = opcoes.quando ?? new Date().toISOString();
  const log = (linha: Record<string, unknown>): void => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'hitl.log'), JSON.stringify({ ts: quando, tipo: 'varredura_acoes', ...linha }) + '\n', { mode: 0o600 });
    } catch { /* o log e da batida; o ledger da thread guarda cada acao */ }
  };
  fs.mkdirSync(dir, { recursive: true });
  const trava = adquirirLockMonitor(path.join(dir, 'varredura-acoes.lock'));
  if (!trava.ok) { log({ ocupada: true, detalhe: trava.detalhe }); return { ocupada: true, detalhe: trava.detalhe }; }
  let r: BatidaDaConducao;
  try {
    const anterior = lerRetratoDaBatida(raiz);
    r = comDesdeEstavel(comMergesDaRodadaAnterior(conduzirBatida(carregado, { ...opcoes, quando }), anterior, raiz), anterior);
    try { gravarRetrato(raiz, r); } catch { /* sem retrato, o pulse so nao mostra os pendentes do merge e do despacho */ }
  } catch (e) {
    log({ erro: (e as Error).message.slice(0, 300) });
    throw e;
  } finally { trava.liberar(); }
  log({ autorizacao: r.autorizacao.valida ? 'valida' : r.autorizacao.motivo, busca: r.busca, forja: r.forja, sentinela: r.sentinela,
    feitas: r.feitas.map((f) => ({ acao: f.acao, thread: f.thread, ...(f.pr ? { pr: f.pr } : {}) })),
    pendentes: r.pendentes.map((p) => ({ acao: p.acao, thread: p.thread, resultado: p.resultado, motivo: p.motivo })) });
  return { ocupada: false, ...r };
}

/**
 * RM-063 (F7): o que a ultima batida deixou pendente no merge e no despacho, no formato das acoes da varredura, para o
 * pulse levar a fila. So o retrato fresco (`VALIDADE_DO_RETRATO_MS`) conta; o pendente de thread ja fechada sai.
 */
export function pendentesDaUltimaBatida(raiz: string, quando: string): AcaoPendente[] {
  const r = lerRetratoDaBatida(raiz);
  if (!r || !(Date.parse(quando) - Date.parse(r.consultadoEm) <= VALIDADE_DO_RETRATO_MS)) return [];
  const saida: AcaoPendente[] = [];
  for (const i of r.pendentes) {
    if (i.acao !== 'merge' && i.acao !== 'despachar') continue;
    try { if (lerThread(raizDoEstado(raiz), i.thread).status === 'fechada') continue; } catch { continue; }
    // A espera que passa de 2 h (check obrigatorio parado, o GitHub sem o estado do merge) vira item do dono.
    const longa = i.resultado === 'espera' && !!i.desdeEm && Date.parse(quando) - Date.parse(i.desdeEm) > ESPERA_LONGA_MS;
    const motivo = longa ? 'espera-longa' : i.motivo;
    const bloqueio = ehBloqueio(motivo) ? textoDoCatalogo((m) => m.pulse.varredura.bloqueios[motivo as MotivoDoBloqueio]) : null;
    const recusa = i.motivo && /-recusad[oa]$/.test(i.motivo) ? { em: r.consultadoEm, detalhe: i.detalhe } : null;
    saida.push({ acao: i.acao, thread: i.thread, fase: i.fase, sessionId: null, desdeEm: i.desdeEm, comando: i.comando, oQue: i.oQue,
      evidencia: i.evidencia, bloqueio, motivoDoBloqueio: bloqueio ? (motivo as MotivoDoBloqueio) : null, recusa });
  }
  return saida;
}

function ehBloqueio(motivo: string | null): boolean {
  return !!motivo && (MOTIVOS_DO_BLOQUEIO as readonly string[]).includes(motivo);
}

/** O texto do `ork conducao batida` e da resposta ao `#OrkRetomar`: o que voltou a andar e o que ficou com o dono. */
export function textoDaBatida(r: RodadaDaBatida): string {
  const m = msg().conducao.batida;
  if (r.ocupada) return m.ocupada(r.detalhe);
  const linhas: string[] = [];
  const a = r.autorizacao;
  linhas.push(a.valida ? m.autorizada(a.por ?? '-', a.ate ?? '-', a.pode.join(', ')) : m.semAutorizacao(a.motivo ?? '-'));
  if (r.sentinela) linhas.push(m.sentinela);
  if (r.forja && !r.forja.ok) linhas.push(m.prs(r.forja.detalhe));
  if (r.busca && !r.busca.ok) linhas.push(m.base(r.busca.detalhe));
  const andou = r.feitas;
  linhas.push(andou.length ? m.voltou(andou.length) : m.nada);
  for (const f of andou) linhas.push(m.item(f.thread, f.acao, f.pr ?? null, f.detalhe));
  const espera = r.pendentes.filter((p) => p.resultado === 'espera');
  if (espera.length) linhas.push(m.espera(espera.length));
  for (const p of espera) linhas.push(m.item(p.thread, p.acao, p.pr ?? null, p.detalhe));
  const dono = r.pendentes.filter((p) => p.resultado === 'dono');
  if (dono.length) linhas.push(m.comVoce(dono.length));
  for (const p of dono) linhas.push(m.itemDono(p.thread, p.acao, p.pr ?? null, p.motivo ?? '-', p.detalhe, p.comando));
  return linhas.join('\n');
}
