/**
 * RM-037 (fatia 4): o trabalho parado no condutor.
 *
 * Em 01/10/2026 o condutor parou duas vezes e nada no produto percebeu. De madrugada, tres threads
 * terminaram com o verify verde e ficaram 15 h sem push e sem PR; de dia, PRs ficaram horas com os
 * checks verdes e sem merge, e um PR com o check vermelho ficou 4h38 sem fase nenhuma. O pulse batia de
 * 15 em 15 min e so dizia "Esperando voce": o `human.pending` que o observador grava quando a sessao
 * claude-bg encerra o turno em `blocked` contava como pergunta do dono, e nao havia pergunta nenhuma
 * (12 desses resultados seguiram ate o `ship_done` sem um `human_gate`).
 *
 * Aqui mora, num lugar so, o que e do condutor depois da entrega:
 *
 *  - quem e do condutor (`esperaDoCondutor`): o fim de turno num bloco sem pausa ao fim, sem pergunta
 *    estruturada aberta. Pausa prevista do modo, escalacao tipada, `hitl_requested` aberto (inclusive
 *    vencido que espera), prompt de permissao do hook e menu na tela continuam do dono;
 *  - o estado da entrega de cada thread aberta: o git local (a ponta da branch, a copia do remoto que o
 *    push desta maquina atualiza e a base) e os PRs da forja, lidos pelo `gh` e guardados como retrato
 *    `ork.prs-abertos/v1`;
 *  - os casos, cada um com o desde e o proximo passo, alem do limiar. O que sai do dono volta sempre
 *    como linha do condutor (CHECK da fatia 4, rodada 1).
 *
 * O pulse le a forja so quando alguma thread tem branch publicada; o status do roadmap le o retrato e
 * nunca a rede. Falha, lista cortada e retrato velho sao "PR nao lido", nunca "sem PR".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { conducaoDaThread } from './conducao';
import { raizDoEstado } from './estado-thread';
import { identidadeDaForja } from './forja';
import { redigirSegredos } from './hitl';
import { estadoDoPedido, PedidoHitlQualquer } from './hitl-contract';
import { quemDecide } from './hitl-classificacao';
import { MOTIVOS_DE_ESCALACAO_HUMANA } from './hitl-gates';
import { lerLedger } from './ledger';
import { ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import { ehAprovacaoHumana, EVENTOS_QUE_DESTRAVAM } from './ocupacao';
import { stopCorrelacionado } from './session-watcher-claude';
import { dirThread, lerThread, listarIds } from './thread';
import { EventoLedger, SessaoNoRadar, Thread } from './types';
import { exec } from './util';
import { branchDaWorktree } from './worktree';

export const CONTRATO_PRS = 'ork.prs-abertos/v1' as const;
/** D4: duas batidas do pulse. Abaixo disto o condutor pode estar agindo. */
export const LIMIAR_PARADO_NO_CONDUTOR_MIN = 30;
/** O retrato de PRs vale por uma hora para quem nao le a rede (o status do roadmap); depois, "PR nao lido". */
export const VALIDADE_DO_RETRATO_MIN = 60;
/** Quantos PRs a leitura pede. Lista cheia e `parcial`: o PR que nao veio nunca vira "sem PR". */
export const LIMITE_DE_PRS = 200;
const ARQUIVO_DOS_PRS = 'prs.json';
const PRAZO_DO_GH_MS = 30000;
const CAMPOS_DO_GH = 'number,state,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,url,createdAt,mergedAt,statusCheckRollup';
/** As fases que o ciclo despacha antes da entrega: depois de um bloco que para nelas, o passo e despachar, nao publicar. */
const FASES_ANTES_DA_ENTREGA = ['GOAL', 'PLAN', 'GO', 'CHECK'];
/** Os modos em que a #TAG ja autoriza o push (`autorizacaoDePush`, `core/src/ship.ts`). */
const MODOS_COM_PUSH_AUTORIZADO = ['auto', 'maestro'];

/** Os casos, na ordem de precedencia (D5): os cinco do pedido e os dois que o CHECK pediu. */
export type CasoParado = 'sem-push' | 'pr-vermelho' | 'pr-verde' | 'sem-registro' | 'sem-pr' | 'fase-seguinte' | 'sessao-sem-pergunta';
export type SituacaoDoCheck = 'verde' | 'vermelho' | 'pendente';

export interface CheckDoPr { nome: string; situacao: SituacaoDoCheck; concluidoEm: string | null }

export interface PrDaForja {
  numero: number;
  branch: string;
  head: string;
  estado: 'aberto' | 'mesclado' | 'fechado';
  rascunho: boolean;
  url: string | null;
  criadoEm: string | null;
  mescladoEm: string | null;
  /** So dos PRs abertos, um por nome (o mais novo); o mesclado e o fechado nao precisam deles. */
  checks: CheckDoPr[];
}

/** O que o pulse leu da forja, guardado em `.orkastery/monitor/prs.json` para quem nao le a rede. */
export interface RetratoDePrs {
  contrato: typeof CONTRATO_PRS;
  lidoEm: string;
  repositorio: string;
  base: string;
  /** A forja devolveu a lista cheia: pode haver PR que nao veio. */
  parcial: boolean;
  prs: PrDaForja[];
}

export type LeituraDePrs = { ok: true; retrato: RetratoDePrs } | { ok: false; lidoEm: string; erro: string };

/** Quem roda o `gh`. Os testes trocam por uma resposta gravada e contam as chamadas. */
export type ExecutorDoGh = (args: readonly string[], timeoutMs: number) => { status: number | null; stdout: string; stderr: string };

/** O ambiente do `gh`: sem cor, sem prompt e sem host ou repositorio herdados (o host vai no `--repo`). */
function ambienteDoGh(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0', CLICOLOR_FORCE: '0' };
  delete env.GH_HOST; delete env.GH_REPO; delete env.GH_FORCE_TTY;
  return env;
}

const ghPadrao: ExecutorDoGh = (args, timeoutMs) => {
  const r = spawnSync('gh', [...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: ambienteDoGh() });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.error ? r.error.message : (r.stderr ?? '') };
};

/** Git local sem rede escondida: clone parcial nunca busca objeto durante uma leitura daqui. */
const git = (raiz: string, args: string[]) => exec('git', args, raiz, 60000, { ...process.env, GIT_NO_LAZY_FETCH: '1' });

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
const REPOSITORIO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** Texto curto vindo de fora: sem controle, num teto. */
function curto(v: unknown, teto = 120): string | null {
  if (typeof v !== 'string') return null;
  const limpo = Array.from(v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, teto).join('');
  return limpo || null;
}

/**
 * O nome de um check vem do GitHub e e o unico texto livre da forja que chega ao dono (no proximo passo).
 * Fica so letra, numero e pontuacao simples: nada de controle, de formatacao invisivel, de quebra de
 * linha, de `:` (diretiva de canal) nem de `$` (padrao de substituicao).
 */
export function nomeDeCheck(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/[^\p{L}\p{N} ()[\]._,+/-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return limpo ? Array.from(limpo).slice(0, 80).join('').trim() : null;
}

/** Instante ISO de fora. O GitHub devolve o ano 1 para o que ainda nao aconteceu. */
function instante(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).getUTCFullYear() >= 2000 ? new Date(ms).toISOString() : null;
}

/** Um check do rollup, com o inicio que decide o mais novo quando o nome se repete. */
function checkDaForja(c: unknown): { check: CheckDoPr; inicio: string } | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const nome = nomeDeCheck(o.name) ?? nomeDeCheck(o.context);
  if (!nome) return null;
  let situacao: SituacaoDoCheck;
  if (o.__typename === 'StatusContext' || (o.status === undefined && typeof o.state === 'string')) {
    const s = String(o.state ?? '').toUpperCase();
    situacao = s === 'SUCCESS' ? 'verde' : s === 'FAILURE' || s === 'ERROR' ? 'vermelho' : 'pendente';
  } else {
    const status = String(o.status ?? '').toUpperCase(), conclusao = String(o.conclusion ?? '').toUpperCase();
    situacao = status !== 'COMPLETED' ? 'pendente' : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusao) ? 'verde' : 'vermelho';
  }
  const concluidoEm = situacao === 'pendente' ? null : instante(o.completedAt) ?? instante(o.startedAt);
  return { check: { nome, situacao, concluidoEm }, inicio: instante(o.startedAt) ?? instante(o.completedAt) ?? '' };
}

/**
 * Um PR da resposta do `gh`, ou `null` quando nao e de thread nenhuma daqui (fork, outra base, branch que
 * nao e nome de branch de thread). Formato errado lanca: a leitura inteira vira "nao lido".
 */
function prDaForja(bruto: unknown, base: string): PrDaForja | null {
  if (!bruto || typeof bruto !== 'object') throw new Error('PR fora do formato');
  const p = bruto as Record<string, unknown>;
  const numero = p.number, head = p.headRefOid;
  const estado = ({ OPEN: 'aberto', MERGED: 'mesclado', CLOSED: 'fechado' } as const)[String(p.state) as 'OPEN' | 'MERGED' | 'CLOSED'];
  if (!Number.isSafeInteger(numero) || (numero as number) < 1 || typeof head !== 'string' || !SHA.test(head) || !estado ||
      typeof p.isDraft !== 'boolean') throw new Error('PR fora do formato');
  if (p.isCrossRepository === true || (typeof p.baseRefName === 'string' && p.baseRefName !== base) ||
      typeof p.headRefName !== 'string' || !BRANCH.test(p.headRefName)) return null;
  const rollup = p.statusCheckRollup;
  if (rollup !== null && rollup !== undefined && !Array.isArray(rollup)) throw new Error('checks fora do formato');
  const porNome = new Map<string, { check: CheckDoPr; inicio: string }>();
  if (estado === 'aberto') {
    for (const c of (rollup ?? []) as unknown[]) {
      // Check ilegivel nunca vira verde: entra como pendente, e o PR nao sai como "esperando merge".
      const lido = checkDaForja(c) ?? { check: { nome: 'check ilegivel', situacao: 'pendente' as const, concluidoEm: null }, inicio: '' };
      // O rollup repete o check reexecutado: vale o mais novo, como no `gh pr checks`.
      const atual = porNome.get(lido.check.nome);
      if (!atual || lido.inicio > atual.inicio) porNome.set(lido.check.nome, lido);
    }
  }
  const url = typeof p.url === 'string' && /^https:\/\/[^\s]+$/.test(p.url) ? curto(p.url, 300) : null;
  return { numero: numero as number, branch: p.headRefName, head, estado, rascunho: p.isDraft as boolean, url,
    criadoEm: instante(p.createdAt), mescladoEm: instante(p.mergedAt), checks: [...porNome.values()].map((x) => x.check) };
}

/** O repositorio `dono/nome` do remoto, so quando ele e do github.com (o host ancorado, nao so citado no caminho). */
export function repositorioDoRemoto(raiz: string, remoto: string): string | null {
  const url = git(raiz, ['remote', 'get-url', remoto]);
  const forja = url.ok ? identidadeDaForja(url.stdout.trim()) : null;
  return forja && forja.tipo === 'github' && forja.host === 'github.com' && REPOSITORIO.test(forja.repo) ? forja.repo : null;
}

/**
 * Le os PRs da base do repositorio do remoto (abertos, mesclados e fechados, os mais novos), numa chamada.
 * O `gh` usa a autenticacao dele; nenhum token passa por aqui. Remoto que nao e do github.com nao chama nada.
 */
export function lerPrsDaForja(carregado: ManifestoCarregado,
  opcoes: { quando?: string; executor?: ExecutorDoGh; remoto?: string } = {}): LeituraDePrs {
  const lidoEm = opcoes.quando ?? new Date().toISOString();
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
  const base = carregado.manifesto.worktree.base_branch;
  const repositorio = repositorioDoRemoto(carregado.raiz, remoto);
  if (!repositorio) return { ok: false, lidoEm, erro: `o remoto ${remoto} não é um repositório do github.com` };
  const r = (opcoes.executor ?? ghPadrao)(['pr', 'list', `--repo=github.com/${repositorio}`, `--base=${base}`, '--state=all',
    `--limit=${LIMITE_DE_PRS}`, `--json=${CAMPOS_DO_GH}`], PRAZO_DO_GH_MS);
  if (r.status !== 0) {
    const detalhe = curto(redigirSegredos(r.stderr || r.stdout || ''), 160) ?? 'sem detalhe';
    return { ok: false, lidoEm, erro: `gh pr list falhou (${r.status === null ? 'sem código de saída' : `código ${r.status}`}): ${detalhe}` };
  }
  try {
    const lista = JSON.parse(r.stdout) as unknown;
    if (!Array.isArray(lista)) throw new Error('a resposta não é uma lista');
    const prs = lista.map((p) => prDaForja(p, base)).filter((p): p is PrDaForja => p !== null);
    return { ok: true, retrato: { contrato: CONTRATO_PRS, lidoEm, repositorio, base, parcial: lista.length >= LIMITE_DE_PRS, prs } };
  } catch (e) {
    return { ok: false, lidoEm, erro: `resposta do gh pr list fora do formato: ${curto(redigirSegredos((e as Error).message), 120) ?? 'sem detalhe'}` };
  }
}

const dirDoMonitor = (raiz: string) => path.join(raizDoEstado(raiz), '.orkastery', 'monitor');

/** Grava o retrato de uma leitura que deu certo: arquivo novo exclusivo, so do dono, renomeado por cima. */
export function gravarRetratoDePrs(raiz: string, retrato: RetratoDePrs): void {
  const dir = dirDoMonitor(raiz);
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, ARQUIVO_DOS_PRS), tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(retrato, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, arquivo);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ja saiu */ }
    throw e;
  }
}

/** O ultimo retrato gravado pelo pulse, conferido campo a campo e com os nomes de check limpos de novo. */
export function lerRetratoDePrs(raiz: string): RetratoDePrs | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dirDoMonitor(raiz), ARQUIVO_DOS_PRS), 'utf8')) as Record<string, unknown>;
    const lidoEm = instante(r.lidoEm);
    if (r.contrato !== CONTRATO_PRS || !lidoEm || typeof r.repositorio !== 'string' || !REPOSITORIO.test(r.repositorio) ||
        typeof r.base !== 'string' || typeof r.parcial !== 'boolean' || !Array.isArray(r.prs)) return null;
    const opcional = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : instante(v) ?? undefined);
    const prs: PrDaForja[] = [];
    for (const bruto of r.prs as unknown[]) {
      const p = (bruto ?? {}) as Record<string, unknown>;
      const estado = p.estado as PrDaForja['estado'];
      const criadoEm = opcional(p.criadoEm), mescladoEm = opcional(p.mescladoEm);
      if (!Number.isSafeInteger(p.numero) || (p.numero as number) < 1 || typeof p.branch !== 'string' || !BRANCH.test(p.branch) ||
          typeof p.head !== 'string' || !SHA.test(p.head) || !['aberto', 'mesclado', 'fechado'].includes(estado) ||
          typeof p.rascunho !== 'boolean' || !Array.isArray(p.checks) || criadoEm === undefined || mescladoEm === undefined) return null;
      const checks: CheckDoPr[] = [];
      for (const c of p.checks as unknown[]) {
        const k = (c ?? {}) as Record<string, unknown>;
        const nome = nomeDeCheck(k.nome), concluidoEm = opcional(k.concluidoEm);
        if (!nome || !['verde', 'vermelho', 'pendente'].includes(String(k.situacao)) || concluidoEm === undefined) return null;
        checks.push({ nome, situacao: k.situacao as SituacaoDoCheck, concluidoEm });
      }
      prs.push({ numero: p.numero as number, branch: p.branch, head: p.head, estado, rascunho: p.rascunho,
        url: typeof p.url === 'string' && /^https:\/\/[^\s]+$/.test(p.url) ? curto(p.url, 300) : null, criadoEm, mescladoEm, checks });
    }
    return { contrato: CONTRATO_PRS, lidoEm, repositorio: r.repositorio, base: r.base, parcial: r.parcial, prs };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Quem e do condutor (D6).
// ---------------------------------------------------------------------------

const RESPOSTAS_HITL = ['human_gate', 'session_answered'];

/**
 * Pergunta estruturada ainda pendente desde `desde`: pedido sem resposta que, vencido, espera ou escala
 * (so o "seguir a recomendada" resolve sozinho). Decisao informada (`decidido`) nao e pergunta. Pedido
 * ilegivel conta como pendente: na duvida, a vez e do dono.
 */
export function perguntaAberta(eventos: readonly EventoLedger[], desde: string, quando: string): boolean {
  const inicio = Date.parse(desde);
  const respondidos = new Set(eventos.filter((e) => RESPOSTAS_HITL.includes(e.tipo)).map((e) => String(e.pedidoId)));
  return eventos.some((e) => {
    if (e.tipo !== 'hitl_requested' || Date.parse(e.ts) < inicio) return false;
    const pedido = e.pedido as PedidoHitlQualquer | undefined;
    if (!pedido || typeof pedido !== 'object') return true;
    if ((pedido as { classe?: unknown }).classe === 'decidido' || respondidos.has(String(pedido.id))) return false;
    try { return estadoDoPedido(pedido, quando) !== 'seguir-recomendada'; } catch { return true; }
  });
}

/**
 * O bloqueio que pede o dono: o prompt de permissao do hook e o que o radar leu com pergunta na tela. O
 * carimbo do radar no fim de turno (`blocked` lido sem menu nem pergunta) nao e prompt nenhum.
 */
function bloqueioDoDono(e: EventoLedger): boolean {
  return e.tipo === 'sessao_bloqueada' && !(e.fonte === 'ork sessions hitl --registrar' && e.tipoDeHitl === 'hitl.desconhecido' &&
    !String(e.pergunta ?? '').trim());
}

/** O ultimo entre bloqueio do dono, destravamento e Stop da sessao, desde o despacho, e bloqueio? */
function bloqueioPendente(eventos: readonly EventoLedger[], sessionId: string, desde: string): boolean {
  const inicio = Date.parse(desde);
  const ultimo = eventos.filter((e) => e.sessionId === sessionId && !(Date.parse(e.ts) < inicio) &&
    (bloqueioDoDono(e) || e.tipo === 'sessao_destravada' || e.tipo === 'runtime_stop')).at(-1);
  return ultimo?.tipo === 'sessao_bloqueada';
}

/** O ultimo despacho de fase da thread, quando ha um. */
function ultimoDespacho(eventos: readonly EventoLedger[]): EventoLedger | null {
  for (let i = eventos.length - 1; i >= 0; i--) if (eventos[i].tipo === 'phase_dispatch') return eventos[i];
  return null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Como o turno do ultimo despacho acabou, quando acabou (so pelo ledger). */
export interface FimDoTurno {
  em: string;
  /**
   * `concluida`: resultado da fase com a prova do ork (ou o legado `ok: true`). `espera-do-observador`: o
   * observador viu o Stop e a sessao `blocked` e gravou `human.pending`. `stop-sem-resultado`: o Stop foi a
   * ultima atividade e o resultado nunca veio (a fatia 3 de 01/10). `outro`: falha tecnica ou pausa, com
   * dono proprio. Sessao `blocked` sem Stop e prompt no meio do turno, e nao fim de turno.
   */
  tipo: 'concluida' | 'espera-do-observador' | 'stop-sem-resultado' | 'outro';
  sessionId: string | null;
  fase: string | null;
  /** A prova do ork que o observador conferiu, quando ele diz. */
  comProva: boolean | null;
}

export function fimDoTurno(eventos: readonly EventoLedger[], despacho: EventoLedger): FimDoTurno | null {
  const i = eventos.lastIndexOf(despacho);
  const depois = eventos.slice(i + 1);
  const sid = texto(despacho.sessionId);
  const daSessao = (e: EventoLedger) => !sid || !e.sessionId || e.sessionId === sid;
  const resultado = [...depois].reverse().find((e) => e.tipo === 'phase_result' && daSessao(e));
  if (resultado) {
    const fase = texto(resultado.fase);
    // O resultado legado (sem classificacao, `ok: true`) tambem e fase concluida.
    const concluida = resultado.ok !== false && (resultado.classificacao === 'fase_concluida' ||
      (resultado.classificacao === undefined && resultado.ok === true));
    if (concluida) return { em: resultado.ts, tipo: 'concluida', sessionId: sid, fase, comProva: true };
    if (resultado.motivo === 'human.pending' && resultado.estadoNativo === 'blocked' && resultado.stop) {
      const { ts: doStop } = resultado.stop as { ts?: unknown };
      const { ok: provou } = (resultado.provaOrk ?? {}) as { ok?: unknown };
      return { em: instante(doStop) ?? resultado.ts, tipo: 'espera-do-observador', sessionId: sid, fase,
        comProva: typeof provou === 'boolean' ? provou : null };
    }
    return { em: resultado.ts, tipo: 'outro', sessionId: sid, fase, comProva: null };
  }
  if (sid) {
    const ultimoStop = [...depois].reverse().find((e) => e.tipo === 'runtime_stop' && e.sessionId === sid && e.sensor === 'stop');
    const despachadaEm = texto(ultimoStop?.despachoEm);
    if (ultimoStop && despachadaEm) {
      const stop = stopCorrelacionado(eventos, { sessionId: sid, fase: String(ultimoStop.fase) as Thread['faseAtual'], despachadaEm });
      if (stop) return { em: stop.ts, tipo: 'stop-sem-resultado', sessionId: sid, fase: texto(stop.fase), comProva: null };
    }
  }
  return null;
}

/**
 * O que ainda espera o dono depois do ultimo despacho, quando espera: a pausa prevista do bloco sem
 * aprovacao humana, a thread pausada, a pergunta pendente, o prompt de permissao e a escalacao tipada
 * dele, cada um com as regras de destravar do monitor. Nada disso e do condutor (P3).
 */
export function pendenciaDoDono(t: Thread, eventos: readonly EventoLedger[], quando: string): string | null {
  if (t.status === 'pausada') return 'thread pausada';
  const despacho = ultimoDespacho(eventos);
  if (!despacho) return null;
  const depois = eventos.slice(eventos.lastIndexOf(despacho) + 1);
  if (despacho.pausaAoFim === true && !depois.some(ehAprovacaoHumana)) return 'pausa prevista ao fim do bloco';
  if (perguntaAberta(eventos, despacho.ts, quando)) return 'pergunta aberta';
  const sid = texto(despacho.sessionId);
  if (sid && bloqueioPendente(eventos, sid, despacho.ts)) return 'prompt de permissão pendente';
  for (let k = 0; k < depois.length; k++) {
    const e = depois[k];
    if (e.tipo !== 'gate_blocked') continue;
    const motivo = String(e.motivo ?? '');
    // O fim de turno que o observador viu em `blocked` nao e escalacao: e justamente o que muda de dono.
    if (motivo === 'human.pending' && e.origem === 'sessions.watch' && e.estadoNativo === 'blocked') continue;
    const doDono = motivo === 'human.pending' ||
      ((MOTIVOS_DE_ESCALACAO_HUMANA as readonly string[]).includes(motivo) && quemDecide(motivo) === 'dono');
    const resolvido = depois.slice(k + 1).some((p) => EVENTOS_QUE_DESTRAVAM.includes(p.tipo) || ehAprovacaoHumana(p));
    if (doDono && !resolvido) return `escalação ${motivo}`;
  }
  return null;
}

/** A espera que e do condutor: o turno do ultimo despacho acabou, sem pausa ao fim e sem nada do dono. */
export interface EsperaDoCondutor {
  thread: string;
  fase: string | null;
  sessionId: string | null;
  fimDoTurnoEm: string;
  tipo: Exclude<FimDoTurno['tipo'], 'outro'>;
  comProva: boolean | null;
}

export function esperaDoCondutor(t: Thread, eventos: readonly EventoLedger[], quando: string): EsperaDoCondutor | null {
  if (t.status === 'fechada') return null;
  const despacho = ultimoDespacho(eventos);
  if (!despacho || despacho.pausaAoFim !== false) return null;
  const fim = fimDoTurno(eventos, despacho);
  if (!fim || fim.tipo === 'outro' || pendenciaDoDono(t, eventos, quando)) return null;
  return { thread: t.id, fase: fim.fase, sessionId: fim.sessionId, fimDoTurnoEm: fim.em, tipo: fim.tipo, comProva: fim.comProva };
}

/**
 * Sessao `blocked` do radar de quem o turno acabou sem pergunta: claude-bg com a tela lida, sem menu, sem
 * pergunta e sem palavra de credencial ou permissao. Sessao nativa (Codex) em `blocked` e pergunta
 * estruturada, e tela nao lida (orcamento) nao prova nada: as duas continuam do dono.
 */
export function sessaoSemPergunta(s: SessaoNoRadar): boolean {
  return s.classe === 'hitl' && s.jobVivo === true && s.kind !== 'codex-controller' && s.tipoDeHitl === 'hitl.desconhecido' &&
    s.alternativas.length === 0 && !s.pergunta?.trim() && !!s.thread?.id;
}

// ---------------------------------------------------------------------------
// O estado da entrega e os casos.
// ---------------------------------------------------------------------------

export interface ParadoNoCondutor {
  thread: string;
  caso: CasoParado;
  desdeEm: string;
  paradoHaMin: number;
  proximoPasso: string;
  evidencia: string[];
  branch: string | null;
  pr: number | null;
  sessionId: string | null;
  /** A hora da leitura dos PRs, quando o caso depende dela. */
  prLidoEm: string | null;
}

export interface PrDaEntrega {
  numero: number;
  estado: PrDaForja['estado'];
  situacao: SituacaoDoCheck | null;
  /** O check vermelho mais novo, quando ha. */
  checkVermelho: string | null;
  rascunho: boolean;
}

export interface EstadoDaEntrega {
  thread: string;
  branch: string | null;
  /** A ponta da branch tem commit fora da base. */
  comProduto: boolean;
  /** `true`: a copia local do remoto contem a ponta; `false`: ha commit sem push; `null`: sem branch ou git sem resposta. */
  publicada: boolean | null;
  pr: PrDaEntrega | null;
  /** A hora da leitura dos PRs que valeu para esta thread. */
  prLidoEm: string | null;
  /** Por que os PRs nao valeram, quando a thread precisava deles. */
  prNaoLido: string | null;
  conduzidaAgora: boolean;
  espera: EsperaDoCondutor | null;
  parado: ParadoNoCondutor | null;
  /** O estado real em uma frase, para o status do roadmap. */
  resumo: string | null;
}

export interface OpcoesDasEntregas {
  quando: string;
  /** A leitura dos PRs: chamada no maximo uma vez, e so quando ha branch publicada com produto. */
  lerPrs?: () => LeituraDePrs | null;
  /** O radar do pulse: as sessoes que sobraram, sem pergunta. */
  sessoes?: readonly SessaoNoRadar[];
  limiarMin?: number;
}

export interface EntregasDoProjeto {
  estados: EstadoDaEntrega[];
  /** Uma linha por thread: o caso dela ou, sem caso, as sessoes que sobraram. */
  parados: ParadoNoCondutor[];
  /** O que o pulse tira do dono: `thread|fase` do `human.pending` do observador e as sessoes sem pergunta. */
  doCondutor: { gates: Set<string>; sessoes: Set<string> };
  prs: LeituraDePrs | null;
}

const minutosDesde = (desde: string, quando: string): number =>
  Math.max(0, Math.floor((Date.parse(quando) - Date.parse(desde)) / 60000));

const curtoDaSessao = (sid: string | null): string => (sid ?? '').slice(0, 8);

/** Os refs locais de uma vez: `refs/heads/...` e a copia do remoto, sem rede. */
function refsLocais(raiz: string, remoto: string): Map<string, string> {
  const r = git(raiz, ['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads/', `refs/remotes/${remoto}/`]);
  const mapa = new Map<string, string>();
  if (!r.ok) return mapa;
  for (const linha of r.stdout.split('\n')) {
    const [ref, sha] = linha.split('\t');
    if (ref && sha && SHA.test(sha)) mapa.set(ref, sha);
  }
  return mapa;
}

/** Os merges `ship(<thread>)` da base numa leitura so, do mais novo para o mais velho (fica o mais novo). */
function mergesNaBase(raiz: string, baseRef: string | null): Map<string, { sha: string; em: string | null }> {
  const mapa = new Map<string, { sha: string; em: string | null }>();
  if (!baseRef) return mapa;
  // Regex basica do git: o `(` e literal. A ref vem qualificada do `for-each-ref`.
  const r = git(raiz, ['log', baseRef, '--first-parent', '--format=%H%x09%cI%x09%s', '--grep=^ship(']);
  if (!r.ok) return mapa;
  for (const linha of r.stdout.split('\n')) {
    const [sha, em, assunto] = linha.split('\t');
    const m = /^ship\(([A-Za-z0-9._-]+)\)/.exec(assunto ?? '');
    if (m && sha && SHA.test(sha) && !mapa.has(m[1])) mapa.set(m[1], { sha, em: instante(em) });
  }
  return mapa;
}

/** Situacao dos checks de um PR aberto e o instante que conta para cada uma. */
function situacaoDoPr(pr: PrDaForja): { situacao: SituacaoDoCheck; desdeEm: string | null; vermelho: string | null; semChecks: boolean } {
  const maisNovo = (cs: CheckDoPr[]) => cs.map((c) => c.concluidoEm).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const vermelhos = pr.checks.filter((c) => c.situacao === 'vermelho');
  if (vermelhos.length) {
    const ultimo = [...vermelhos].sort((a, b) => String(a.concluidoEm).localeCompare(String(b.concluidoEm))).at(-1)!;
    return { situacao: 'vermelho', desdeEm: maisNovo(vermelhos) ?? pr.criadoEm, vermelho: ultimo.nome, semChecks: false };
  }
  if (!pr.checks.length) return { situacao: 'pendente', desdeEm: pr.criadoEm, vermelho: null, semChecks: true };
  if (pr.checks.some((c) => c.situacao === 'pendente')) return { situacao: 'pendente', desdeEm: null, vermelho: null, semChecks: false };
  return { situacao: 'verde', desdeEm: maisNovo(pr.checks) ?? pr.criadoEm, vermelho: null, semChecks: false };
}

/** Os PRs da branch no retrato: o aberto mais novo; o mesclado na ponta atual; o fechado mais novo. */
function prsDaBranch(retrato: RetratoDePrs | null, branch: string | null, cabeca: string | null) {
  const daBranch = retrato && branch ? retrato.prs.filter((p) => p.branch === branch).sort((a, b) => b.numero - a.numero) : [];
  return {
    aberto: daBranch.find((p) => p.estado === 'aberto') ?? null,
    // Commit novo depois do merge e entrega nova, que ainda nao tem PR.
    mesclado: daBranch.find((p) => p.estado === 'mesclado' && p.head === cabeca) ?? null,
    fechado: daBranch.find((p) => p.estado === 'fechado') ?? null,
    achado: daBranch.length > 0,
  };
}

const houveDespachoDepois = (eventos: readonly EventoLedger[], desde: string): boolean =>
  eventos.some((e) => e.tipo === 'phase_dispatch' && Date.parse(e.ts) > Date.parse(desde));

/** A fase que vem depois do bloco despachado, quando o ciclo da thread tem uma. */
function faseDepoisDoBloco(t: Thread, despacho: EventoLedger | null): string | null {
  if (!despacho) return null;
  const fases = t.fases ?? [];
  const bloco = typeof despacho.bloco === 'string' && despacho.bloco ? despacho.bloco.split('-') : [String(despacho.fase ?? '')];
  const i = fases.indexOf(bloco.at(-1) as Thread['faseAtual']);
  return i >= 0 && i + 1 < fases.length ? fases[i + 1] : null;
}

/** A linha das sessoes que sobraram de uma thread: uma linha, com todas elas. */
function passoDasSobras(ids: string[], fechada: boolean): string {
  const onde = fechada ? 'da thread fechada' : 'de um despacho anterior';
  return ids.length === 1
    ? `encerrar a sessão ${ids[0]}, que sobrou ${onde} (ork sessions stop ${ids[0]})`
    : `encerrar as sessões ${ids.join(' e ')}, que sobraram ${onde} (${ids.map((id) => `ork sessions stop ${id}`).join('; ')})`;
}

/**
 * O estado da entrega de cada thread aberta deste checkout e o que esta parado no condutor (D5), mais as
 * sessoes `blocked` sem pergunta que sobraram. O que o predicado tira do dono volta sempre como linha.
 */
export function entregasDoProjeto(carregado: ManifestoCarregado, opcoes: OpcoesDasEntregas): EntregasDoProjeto {
  const raiz = carregado.raiz, quando = opcoes.quando, limiar = opcoes.limiarMin ?? LIMIAR_PARADO_NO_CONDUTOR_MIN;
  const remoto = carregado.manifesto.fabrica.remoto, baseBranch = carregado.manifesto.worktree.base_branch;
  const refs = refsLocais(raiz, remoto);
  // A copia do remoto vem primeiro: a base local desta maquina pode estar parada (o merge e pelo GitHub).
  const baseRef = [`refs/remotes/${remoto}/${baseBranch}`, `refs/heads/${baseBranch}`].find((r) => refs.has(r)) ?? null;
  const merges = mergesNaBase(raiz, baseRef);
  const sessoes = opcoes.sessoes ?? [];
  const threads: Thread[] = [];
  for (const id of listarIds(raiz)) { try { threads.push(lerThread(raiz, id)); } catch { /* thread ilegivel fica de fora */ } }

  const fatos = threads.filter((t) => t.status !== 'fechada').map((t) => {
    let eventos: EventoLedger[] = [];
    try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { /* ledger ilegivel: sem fato, sem caso */ }
    const branch = branchDaWorktree(t);
    const cabeca = refs.get(`refs/heads/${branch}`) ?? null;
    const remota = refs.get(`refs/remotes/${remoto}/${branch}`) ?? null;
    const comProduto = !!cabeca && !!baseRef && Number(git(raiz, ['rev-list', '--count', `${baseRef}..${cabeca}`]).stdout.trim()) > 0;
    // `merge-base --is-ancestor`: 0 contem, 1 nao contem; outro codigo e git sem resposta, que nunca vira "sem push".
    const contem = remota && cabeca && remota !== cabeca ? git(raiz, ['merge-base', '--is-ancestor', cabeca, remota]).code : null;
    const publicada = !cabeca ? null : !remota ? false : remota === cabeca || contem === 0 ? true : contem === 1 ? false : null;
    return { t, eventos, branch: cabeca ? branch : null, cabeca, comProduto, publicada, temRemota: !!remota,
      shipNoLedger: eventos.some((e) => e.tipo === 'ship_done'), merge: merges.get(t.id) ?? null };
  });

  // D2: a forja so e lida quando alguma thread tem o que mostrar la: produto numa branch que ja foi ao remoto
  // (inteira, ou com commit novo ainda sem push, que pode ter PR aberto).
  let prs: LeituraDePrs | null = null;
  if (opcoes.lerPrs && fatos.some((f) => f.comProduto && f.temRemota)) prs = opcoes.lerPrs();
  // O retrato so vale do repositorio e da base de agora, e lido ha menos de `VALIDADE_DO_RETRATO_MIN`.
  let retrato: RetratoDePrs | null = null, semRetrato = prs && !prs.ok ? prs.erro : 'sem leitura dos PRs';
  if (prs?.ok) {
    const r = prs.retrato;
    if (r.base !== baseBranch || r.repositorio !== repositorioDoRemoto(raiz, remoto)) semRetrato = 'retrato de PRs de outro repositório ou base';
    else if (minutosDesde(r.lidoEm, quando) > VALIDADE_DO_RETRATO_MIN) semRetrato = 'retrato de PRs velho';
    else retrato = r;
  }

  const estados: EstadoDaEntrega[] = [], parados: ParadoNoCondutor[] = [];
  const doCondutor = { gates: new Set<string>(), sessoes: new Set<string>() };
  for (const f of fatos) {
    const { t, eventos } = f;
    const despacho = ultimoDespacho(eventos);
    const fim = despacho ? fimDoTurno(eventos, despacho) : null;
    const terminou = !!fim && fim.tipo !== 'outro';
    const fimEm = terminou ? fim!.em : null;
    const espera = esperaDoCondutor(t, eventos, quando);
    if (espera) {
      doCondutor.gates.add(`${t.id}|${espera.fase ?? t.faseAtual}`);
      if (espera.sessionId) doCondutor.sessoes.add(espera.sessionId);
    }
    const conducao = conducaoDaThread(raiz, t.id, { agora: new Date(quando) });
    // P7: a sessao que ja encerrou o turno nao conduz mais nada, mesmo com o lease de pe.
    const conduzidaAgora = !!conducao && !(conducao.dono.tipo === 'sessao' && terminou && conducao.dono.sessionId === fim!.sessionId);
    const doDono = pendenciaDoDono(t, eventos, quando);
    // A2 do CHECK: a leitura dos PRs so vale depois do fim do turno; antes dele, o turno pode ter mudado o PR.
    const prLido = retrato && (!fimEm || Date.parse(retrato.lidoEm) >= Date.parse(fimEm)) ? retrato : null;
    const prs = prsDaBranch(prLido, f.branch, f.cabeca);
    const aberto = prs.aberto, s = aberto ? situacaoDoPr(aberto) : null;
    const precisaDePr = f.comProduto && f.publicada === true;
    const cortado = !!prLido && prLido.parcial && !prs.achado;
    const usouPr = !!prLido && precisaDePr && !cortado;
    const prNaoLido = !precisaDePr || usouPr ? null : !retrato ? semRetrato : !prLido ? 'retrato de PRs anterior ao fim do turno'
      : `lista de PRs cortada nos ${LIMITE_DE_PRS} mais novos`;
    const proxima = faseDepoisDoBloco(t, despacho);
    const antesDaEntrega = !!proxima && FASES_ANTES_DA_ENTREGA.includes(proxima);
    const despachar = `despachar a fase ${proxima} (ork phase run ${t.id} ${proxima})`;
    const autorizacao = MODOS_COM_PUSH_AUTORIZADO.includes(t.modo) ? '' : `, com a autorização de push do dono (${tagDoModo(t.modo)})`;
    // B2 do CHECK: depois de uma fase que terminou, o PR parado volta a ser do condutor, mesmo com despacho no meio.
    const valeDesde = (instanteDoPr: string) => !houveDespachoDepois(eventos, instanteDoPr) ||
      (!!fimEm && Date.parse(fimEm) >= Date.parse(instanteDoPr));
    const maisTarde = (a: string, b: string | null) => (b && Date.parse(b) > Date.parse(a) ? b : a);

    let caso: CasoParado | null = null, desde: string | null = null, passo = '';
    const evidencia: string[] = [];
    if (!conduzidaAgora && !doDono) {
      if (f.comProduto && f.publicada === false && terminou) {
        desde = fimEm;
        if (antesDaEntrega && !aberto) { caso = 'fase-seguinte'; passo = despachar; }
        else {
          caso = 'sem-push';
          passo = aberto ? `publicar os commits novos da branch ${f.branch} no PR #${aberto.numero}` : `publicar a branch ${f.branch} e abrir o PR`;
        }
        evidencia.push(`refs/heads/${f.branch} tem commit fora de refs/remotes/${remoto}/${f.branch}`);
      } else if (aberto && s?.situacao === 'vermelho' && s.desdeEm && valeDesde(s.desdeEm)) {
        caso = 'pr-vermelho'; desde = maisTarde(s.desdeEm, fimEm);
        passo = `corrigir o check ${s.vermelho} vermelho do PR #${aberto.numero} e despachar a correção`;
        evidencia.push(`gh pr list: PR #${aberto.numero} com o check ${s.vermelho} vermelho`);
      } else if (aberto && s && (s.situacao === 'verde' || s.semChecks) && s.desdeEm && valeDesde(s.desdeEm)) {
        caso = 'pr-verde'; desde = maisTarde(s.desdeEm, fimEm);
        passo = `${aberto.rascunho ? `tirar o PR #${aberto.numero} do rascunho e mergear` : `mergear o PR #${aberto.numero}`}` +
          `${s.semChecks ? ', que não tem checks' : ''}${autorizacao}`;
        evidencia.push(s.semChecks ? `gh pr list: PR #${aberto.numero} sem checks e sem merge`
          : `gh pr list: PR #${aberto.numero} com ${aberto.checks.length} check(s) verde(s) e sem merge`);
      } else if (!aberto && !f.comProduto && f.merge && !f.shipNoLedger) {
        caso = 'sem-registro'; desde = f.merge.em ?? fimEm;
        passo = `registrar a entrega do merge ${f.merge.sha.slice(0, 7)} (ork ship registrar-pr ${t.id})`;
        evidencia.push(`git log: merge ship(${t.id}) ${f.merge.sha.slice(0, 7)} na base, sem ship_done no ledger`);
      } else if (!aberto && !prs.mesclado && precisaDePr && terminou && usouPr) {
        desde = fimEm;
        if (antesDaEntrega) { caso = 'fase-seguinte'; passo = despachar; }
        else {
          caso = 'sem-pr';
          passo = prs.fechado ? `abrir de novo o PR da branch ${f.branch} (o PR #${prs.fechado.numero} foi fechado sem merge)`
            : `abrir o PR da branch ${f.branch}`;
        }
        evidencia.push(`refs/remotes/${remoto}/${f.branch} contém a ponta`,
          prs.fechado ? `gh pr list: PR #${prs.fechado.numero} fechado sem merge` : `gh pr list: nenhum PR de ${f.branch}`);
      } else if (espera) {
        // O que sai do dono volta sempre: sem caso de entrega, a linha diz o que a thread pede agora.
        desde = espera.fimDoTurnoEm;
        const id = curtoDaSessao(espera.sessionId);
        if (antesDaEntrega && !f.shipNoLedger && espera.comProva !== false) { caso = 'fase-seguinte'; passo = despachar; }
        else {
          caso = 'sessao-sem-pergunta';
          passo = f.shipNoLedger && !f.comProduto ? `fechar o MASTER da thread (ork master ${t.id})`
            : aberto ? `acompanhar os checks do PR #${aberto.numero}, que seguem em andamento`
            : precisaDePr && !usouPr ? `conferir o PR da branch ${f.branch} (PR não lido) e seguir`
            : `ler o fim da sessão ${id} (ork sessions logs ${id}) e seguir a thread`;
        }
      }
    }
    if (caso && fim && fim.tipo !== 'outro') evidencia.push(`fim do turno: ${fim.tipo}`);
    const paradoHaMin = desde ? minutosDesde(desde, quando) : 0;
    const dependeDoPr = caso === 'pr-verde' || caso === 'pr-vermelho' || caso === 'sem-pr' || (caso === 'sem-push' && !!aberto);
    const parado: ParadoNoCondutor | null = caso && desde && paradoHaMin >= limiar ? {
      thread: t.id, caso, desdeEm: desde, paradoHaMin, proximoPasso: passo, evidencia, branch: f.branch, pr: aberto?.numero ?? null,
      sessionId: espera?.sessionId ?? fim?.sessionId ?? null, prLidoEm: dependeDoPr && prLido ? prLido.lidoEm : null,
    } : null;
    if (parado) parados.push(parado);

    const prDaEntrega: PrDaEntrega | null = aberto ? { numero: aberto.numero, estado: 'aberto', situacao: s?.situacao ?? null,
      checkVermelho: s?.vermelho ?? null, rascunho: aberto.rascunho }
      : prs.mesclado && !f.shipNoLedger ? { numero: prs.mesclado.numero, estado: 'mesclado', situacao: null, checkVermelho: null, rascunho: false }
      : null;
    const registrar = `ork ship registrar-pr ${t.id}`;
    const resumo = aberto ? (s?.situacao === 'vermelho' ? `PR #${aberto.numero} aberto com o check ${s.vermelho} vermelho`
        : s?.semChecks ? `PR #${aberto.numero} aberto, sem checks, esperando o merge`
        : s?.situacao === 'verde' ? (aberto.rascunho ? `PR #${aberto.numero} em rascunho, com os checks verdes`
          : `PR #${aberto.numero} com os checks verdes, esperando o merge`)
        : `PR #${aberto.numero} aberto, checks em andamento`)
      : f.comProduto && f.publicada === false ? 'branch com commits sem push'
      : prs.mesclado && !f.shipNoLedger ? `PR #${prs.mesclado.numero} mesclado, falta registrar a entrega (${registrar})`
      : !f.comProduto && f.merge && !f.shipNoLedger ? `merge ${f.merge.sha.slice(0, 7)} na base, falta registrar a entrega (${registrar})`
      : precisaDePr ? (!usouPr ? 'branch publicada, PR não lido'
        : prs.fechado ? `branch publicada, PR #${prs.fechado.numero} fechado sem merge` : 'branch publicada sem PR')
      : null;
    estados.push({ thread: t.id, branch: f.branch, comProduto: f.comProduto, publicada: f.publicada, pr: prDaEntrega,
      prLidoEm: prLido && (usouPr || aberto) ? prLido.lidoEm : null, prNaoLido, conduzidaAgora, espera, parado, resumo });
  }

  // As sessoes `blocked` sem pergunta que sobraram: de thread fechada, ou de despacho antigo de thread aberta.
  // A do despacho corrente fica com o predicado do ledger (`esperaDoCondutor`). Sem o carimbo do radar nao
  // ha desde, e a sessao segue com o dono.
  const sobras = new Map<string, { ids: string[]; sessoes: string[]; desde: string; fechada: boolean }>();
  for (const s of sessoes) {
    if (!sessaoSemPergunta(s)) continue;
    const t = threads.find((x) => x.id === s.thread!.id);
    const { bloqueadaDesdeEm: carimbo } = s;
    const desde = instante(carimbo);
    if (!t || !desde) continue;
    if (t.status !== 'fechada') {
      let eventos: EventoLedger[] = [];
      try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { continue; }
      const despachos = eventos.filter((e) => e.tipo === 'phase_dispatch');
      const antiga = texto(despachos.at(-1)?.sessionId) !== s.sessionId && despachos.some((e) => e.sessionId === s.sessionId);
      if (!antiga || pendenciaDoDono(t, eventos, quando)) continue;
    }
    const atual = sobras.get(t.id) ?? { ids: [], sessoes: [], desde, fechada: t.status === 'fechada' };
    atual.ids.push(curtoDaSessao(s.sessionId)); atual.sessoes.push(s.sessionId);
    if (Date.parse(desde) < Date.parse(atual.desde)) atual.desde = desde;
    sobras.set(t.id, atual);
  }
  for (const [thread, x] of sobras) {
    for (const sid of x.sessoes) doCondutor.sessoes.add(sid);
    // A thread que ja tem a linha dela nao ganha outra: uma linha por thread.
    if (parados.some((p) => p.thread === thread) || minutosDesde(x.desde, quando) < limiar) continue;
    parados.push({ thread, caso: 'sessao-sem-pergunta', desdeEm: x.desde, paradoHaMin: minutosDesde(x.desde, quando),
      proximoPasso: passoDasSobras(x.ids, x.fechada), evidencia: ['radar: sessão blocked com a tela lida, sem menu nem pergunta'],
      branch: null, pr: null, sessionId: x.sessoes[0], prLidoEm: null });
  }
  parados.sort((a, b) => a.desdeEm.localeCompare(b.desdeEm) || a.thread.localeCompare(b.thread));
  return { estados, parados, doCondutor, prs };
}
