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
 *    estruturada aberta. Pausa prevista do modo, escalacao tipada, `hitl_requested` aberto,
 *    `sessao_bloqueada` pendente e menu na tela continuam do dono;
 *  - o estado da entrega de cada thread aberta: o git local (a ponta da branch, a copia do remoto que o
 *    push desta maquina atualiza e a base) e os PRs da forja, lidos pelo `gh` e guardados como retrato
 *    `ork.prs-abertos/v1`;
 *  - os cinco casos, cada um com o desde e o proximo passo, alem do limiar.
 *
 * O pulse le a forja so quando alguma thread tem branch publicada; o status do roadmap le o retrato e
 * nunca a rede. Falha da leitura e "PR nao lido", nunca "sem PR".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repositorioGitHub } from './ci';
import { conducaoDaThread } from './conducao';
import { mergeDaThread } from './docs';
import { raizDoEstado } from './estado-thread';
import { redigirSegredos } from './hitl';
import { estadoDoPedido, PedidoHitlQualquer } from './hitl-contract';
import { quemDecide } from './hitl-classificacao';
import { MOTIVOS_DE_ESCALACAO_HUMANA } from './hitl-gates';
import { lerLedger } from './ledger';
import { ManifestoCarregado } from './manifest';
import { bloqueioPendente, stopCorrelacionado } from './session-watcher-claude';
import { dirThread, lerThread, listarIds } from './thread';
import { EventoLedger, SessaoNoRadar, Thread } from './types';
import { exec } from './util';
import { branchDaWorktree } from './worktree';

export const CONTRATO_PRS = 'ork.prs-abertos/v1' as const;
/** D4: duas batidas do pulse. Abaixo disto o condutor pode estar agindo. */
export const LIMIAR_PARADO_NO_CONDUTOR_MIN = 30;
const ARQUIVO_DOS_PRS = 'prs.json';
const PRAZO_DO_GH_MS = 30000;
const CAMPOS_DO_GH = 'number,state,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,url,createdAt,mergedAt,statusCheckRollup';

/** Os cinco casos do pedido, na ordem de precedencia (D5): o mais adiantado vence. */
export type CasoParado = 'pr-vermelho' | 'pr-verde' | 'sem-pr' | 'sem-push' | 'sessao-sem-pergunta';
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
  /** So dos PRs abertos; o mesclado e o fechado nao precisam deles. */
  checks: CheckDoPr[];
}

/** O que o pulse leu da forja, guardado em `.orkastery/monitor/prs.json` para quem nao le a rede. */
export interface RetratoDePrs {
  contrato: typeof CONTRATO_PRS;
  lidoEm: string;
  repositorio: string;
  base: string;
  prs: PrDaForja[];
}

export type LeituraDePrs = { ok: true; retrato: RetratoDePrs } | { ok: false; lidoEm: string; erro: string };

/** Quem roda o `gh`. Os testes trocam por uma resposta gravada e contam as chamadas. */
export type ExecutorDoGh = (args: readonly string[], timeoutMs: number) => { status: number | null; stdout: string; stderr: string };

const ghPadrao: ExecutorDoGh = (args, timeoutMs) => {
  const r = spawnSync('gh', [...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.error ? r.error.message : (r.stderr ?? '') };
};

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
const REPOSITORIO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** Texto curto vindo de fora: sem controle, num teto. */
function curto(v: unknown, teto = 120): string | null {
  if (typeof v !== 'string') return null;
  const limpo = Array.from(v.replace(/\p{Cc}/gu, '').trim()).slice(0, teto).join('');
  return limpo || null;
}

/** Instante ISO de fora. O GitHub devolve o ano 1 para o que ainda nao aconteceu. */
function instante(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).getUTCFullYear() >= 2000 ? new Date(ms).toISOString() : null;
}

function checkDaForja(c: unknown): CheckDoPr | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const nome = curto(o.name) ?? curto(o.context);
  if (!nome) return null;
  let situacao: SituacaoDoCheck;
  if (o.__typename === 'StatusContext' || (o.status === undefined && typeof o.state === 'string')) {
    const s = String(o.state ?? '').toUpperCase();
    situacao = s === 'SUCCESS' ? 'verde' : s === 'FAILURE' || s === 'ERROR' ? 'vermelho' : 'pendente';
  } else {
    const status = String(o.status ?? '').toUpperCase(), conclusao = String(o.conclusion ?? '').toUpperCase();
    situacao = status !== 'COMPLETED' ? 'pendente' : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusao) ? 'verde' : 'vermelho';
  }
  return { nome, situacao, concluidoEm: situacao === 'pendente' ? null : instante(o.completedAt) ?? instante(o.startedAt) };
}

/** Um PR da resposta do `gh`, ou `null` quando nao e desta base nem deste repositorio. Formato errado lanca. */
function prDaForja(bruto: unknown, base: string): PrDaForja | null {
  if (!bruto || typeof bruto !== 'object') throw new Error('PR fora do formato');
  const p = bruto as Record<string, unknown>;
  if (p.isCrossRepository === true) return null;
  if (typeof p.baseRefName === 'string' && p.baseRefName !== base) return null;
  const numero = p.number, branch = p.headRefName, head = p.headRefOid;
  const estado = ({ OPEN: 'aberto', MERGED: 'mesclado', CLOSED: 'fechado' } as const)[String(p.state) as 'OPEN' | 'MERGED' | 'CLOSED'];
  if (!Number.isSafeInteger(numero) || (numero as number) < 1 || typeof branch !== 'string' || !BRANCH.test(branch) ||
      typeof head !== 'string' || !SHA.test(head) || !estado || typeof p.isDraft !== 'boolean') throw new Error('PR fora do formato');
  const rollup = p.statusCheckRollup;
  if (rollup !== null && rollup !== undefined && !Array.isArray(rollup)) throw new Error('checks fora do formato');
  const checks: CheckDoPr[] = [];
  if (estado === 'aberto') {
    for (const c of (rollup ?? []) as unknown[]) {
      // Check ilegivel nunca vira verde: entra como pendente, e o PR nao sai como "esperando merge".
      checks.push(checkDaForja(c) ?? { nome: 'check ilegivel', situacao: 'pendente', concluidoEm: null });
    }
  }
  const url = typeof p.url === 'string' && /^https:\/\/[^\s]+$/.test(p.url) ? curto(p.url, 300) : null;
  return { numero: numero as number, branch, head, estado, rascunho: p.isDraft as boolean, url,
    criadoEm: instante(p.createdAt), mescladoEm: instante(p.mergedAt), checks };
}

/**
 * Le os PRs do repositorio do remoto (abertos, mesclados e fechados, os 100 mais novos), numa chamada.
 * O `gh` usa a autenticacao dele; nenhum token passa por aqui. Remoto que nao e GitHub nao chama nada.
 */
export function lerPrsDaForja(carregado: ManifestoCarregado,
  opcoes: { quando?: string; executor?: ExecutorDoGh; remoto?: string } = {}): LeituraDePrs {
  const lidoEm = opcoes.quando ?? new Date().toISOString();
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
  const base = carregado.manifesto.worktree.base_branch;
  const url = exec('git', ['remote', 'get-url', remoto], carregado.raiz);
  const repositorio = url.ok ? repositorioGitHub(url.stdout) : null;
  if (!repositorio || !REPOSITORIO.test(repositorio)) {
    return { ok: false, lidoEm, erro: `o remoto ${remoto} não é um repositório GitHub reconhecível` };
  }
  const r = (opcoes.executor ?? ghPadrao)(['pr', 'list', '--repo', repositorio, '--state', 'all', '--limit', '100',
    '--json', CAMPOS_DO_GH], PRAZO_DO_GH_MS);
  if (r.status !== 0) {
    const detalhe = curto(redigirSegredos(r.stderr || r.stdout || ''), 160) ?? 'sem detalhe';
    return { ok: false, lidoEm, erro: `gh pr list falhou (${r.status ?? 'prazo esgotado'}): ${detalhe}` };
  }
  try {
    const lista = JSON.parse(r.stdout) as unknown;
    if (!Array.isArray(lista)) throw new Error('a resposta não é uma lista');
    const prs = lista.map((p) => prDaForja(p, base)).filter((p): p is PrDaForja => p !== null);
    return { ok: true, retrato: { contrato: CONTRATO_PRS, lidoEm, repositorio, base, prs } };
  } catch (e) {
    return { ok: false, lidoEm, erro: `resposta do gh pr list fora do formato: ${(e as Error).message}` };
  }
}

const dirDoMonitor = (raiz: string) => path.join(raizDoEstado(raiz), '.orkastery', 'monitor');

/** Grava o retrato de uma leitura que deu certo. Escrita atomica, so para o dono do arquivo. */
export function gravarRetratoDePrs(raiz: string, retrato: RetratoDePrs): void {
  const dir = dirDoMonitor(raiz);
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, ARQUIVO_DOS_PRS), tmp = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(retrato, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
}

/** O ultimo retrato gravado pelo pulse, conferido inteiro; `null` quando nao ha ou nao vale. */
export function lerRetratoDePrs(raiz: string): RetratoDePrs | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dirDoMonitor(raiz), ARQUIVO_DOS_PRS), 'utf8')) as RetratoDePrs;
    if (r.contrato !== CONTRATO_PRS || !instante(r.lidoEm) || typeof r.repositorio !== 'string' || typeof r.base !== 'string' ||
        !Array.isArray(r.prs)) return null;
    const valido = (p: PrDaForja) => Number.isSafeInteger(p.numero) && typeof p.branch === 'string' && SHA.test(String(p.head)) &&
      ['aberto', 'mesclado', 'fechado'].includes(p.estado) && Array.isArray(p.checks) &&
      p.checks.every((c) => typeof c.nome === 'string' && ['verde', 'vermelho', 'pendente'].includes(c.situacao));
    return r.prs.every(valido) ? r : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Quem e do condutor (D6).
// ---------------------------------------------------------------------------

const RESPOSTAS_HITL = ['human_gate', 'session_answered'];

/**
 * Pergunta estruturada ainda aberta desde `desde`: pedido sem resposta e no prazo. Decisao informada
 * (`decidido`) nao e pergunta. Pedido ilegivel conta como aberto: na duvida, a vez e do dono.
 */
export function perguntaAberta(eventos: readonly EventoLedger[], desde: string, quando: string): boolean {
  const inicio = Date.parse(desde);
  const respondidos = new Set(eventos.filter((e) => RESPOSTAS_HITL.includes(e.tipo)).map((e) => String(e.pedidoId)));
  return eventos.some((e) => {
    if (e.tipo !== 'hitl_requested' || Date.parse(e.ts) < inicio) return false;
    const pedido = e.pedido as PedidoHitlQualquer | undefined;
    if (!pedido || typeof pedido !== 'object') return true;
    if ((pedido as { classe?: unknown }).classe === 'decidido' || respondidos.has(String(pedido.id))) return false;
    try { return estadoDoPedido(pedido, quando) === 'aberto'; } catch { return true; }
  });
}

/** O ultimo despacho de fase da thread, quando ha um. */
function ultimoDespacho(eventos: readonly EventoLedger[]): EventoLedger | null {
  for (let i = eventos.length - 1; i >= 0; i--) if (eventos[i].tipo === 'phase_dispatch') return eventos[i];
  return null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Como o turno do ultimo despacho acabou, quando acabou. */
export interface FimDoTurno {
  em: string;
  /**
   * `concluida`: resultado da fase com a prova do ork. `espera-do-observador`: o observador viu o Stop e a
   * sessao `blocked` e gravou `human.pending`. `stop-sem-resultado`: o Stop foi a ultima atividade e o
   * resultado nunca veio (a fatia 3 de 01/10). `radar`: a sessao aparece `blocked` sem menu. `outro`:
   * falha tecnica ou pausa, que tem dono proprio.
   */
  tipo: 'concluida' | 'espera-do-observador' | 'stop-sem-resultado' | 'radar' | 'outro';
  sessionId: string | null;
  fase: string | null;
}

/**
 * Sessao `blocked` do radar, com job vivo, sem menu e sem pergunta lida na tela: o turno acabou e ninguem
 * perguntou nada. Prompt de credencial ou de permissao, mesmo sem menu, continua do dono.
 */
export function sessaoSemPergunta(s: SessaoNoRadar): boolean {
  return s.classe === 'hitl' && s.jobVivo === true && s.alternativas.length === 0 && !s.pergunta?.trim() &&
    (s.tipoDeHitl === null || s.tipoDeHitl === 'hitl.desconhecido') && !!s.thread?.id;
}

export function fimDoTurno(eventos: readonly EventoLedger[], despacho: EventoLedger,
  radar?: SessaoNoRadar | null): FimDoTurno | null {
  const i = eventos.lastIndexOf(despacho);
  const depois = eventos.slice(i + 1);
  const sid = texto(despacho.sessionId);
  const daSessao = (e: EventoLedger) => !sid || !e.sessionId || e.sessionId === sid;
  const resultado = [...depois].reverse().find((e) => e.tipo === 'phase_result' && daSessao(e));
  if (resultado) {
    const fase = texto(resultado.fase);
    if (resultado.classificacao === 'fase_concluida' && resultado.ok !== false) return { em: resultado.ts, tipo: 'concluida', sessionId: sid, fase };
    if (resultado.motivo === 'human.pending' && resultado.estadoNativo === 'blocked' && resultado.stop) {
      const { ts: doStop } = resultado.stop as { ts?: unknown };
      return { em: instante(doStop) ?? resultado.ts, tipo: 'espera-do-observador', sessionId: sid, fase };
    }
    return { em: resultado.ts, tipo: 'outro', sessionId: sid, fase };
  }
  if (sid) {
    const ultimoStop = [...depois].reverse().find((e) => e.tipo === 'runtime_stop' && e.sessionId === sid && e.sensor === 'stop');
    const despachadaEm = texto(ultimoStop?.despachoEm);
    if (ultimoStop && despachadaEm) {
      const stop = stopCorrelacionado(eventos, { sessionId: sid, fase: String(ultimoStop.fase) as Thread['faseAtual'], despachadaEm });
      if (stop) return { em: stop.ts, tipo: 'stop-sem-resultado', sessionId: sid, fase: texto(stop.fase) };
    }
    if (radar && radar.sessionId === sid && sessaoSemPergunta(radar)) {
      const { bloqueadaDesdeEm: desde, desdeEm: inicio } = radar;
      const em = instante(desde) ?? instante(inicio);
      if (em) return { em, tipo: 'radar', sessionId: sid, fase: texto(despacho.fase) };
    }
  }
  return null;
}

/**
 * O que ainda espera o dono depois do ultimo despacho, quando espera: a pausa prevista do bloco sem
 * aprovacao, a thread pausada, a pergunta aberta, o prompt de permissao pendente e a escalacao tipada
 * dele. Nada disso e do condutor (P3).
 */
export function pendenciaDoDono(t: Thread, eventos: readonly EventoLedger[], quando: string): string | null {
  if (t.status === 'pausada') return 'thread pausada';
  const despacho = ultimoDespacho(eventos);
  if (!despacho) return null;
  const depois = eventos.slice(eventos.lastIndexOf(despacho) + 1);
  const aprovado = (desde: number) => depois.some((e) => Date.parse(e.ts) >= desde &&
    (e.tipo === 'gate_passed' || (e.tipo === 'human_gate' && e.estado === 'aprovado')));
  if (despacho.pausaAoFim === true && !aprovado(Date.parse(despacho.ts))) return 'pausa prevista ao fim do bloco';
  if (perguntaAberta(eventos, despacho.ts, quando)) return 'pergunta aberta';
  const sid = texto(despacho.sessionId);
  if (sid && bloqueioPendente(eventos, { sessionId: sid, despachadaEm: despacho.ts })) return 'prompt de permissão pendente';
  for (const e of depois) {
    if (e.tipo !== 'gate_blocked') continue;
    const motivo = String(e.motivo ?? '');
    // O fim de turno que o observador viu em `blocked` nao e escalacao: e justamente o que muda de dono.
    if (motivo === 'human.pending' && e.origem === 'sessions.watch' && e.estadoNativo === 'blocked') continue;
    const doDono = motivo === 'human.pending' ||
      ((MOTIVOS_DE_ESCALACAO_HUMANA as readonly string[]).includes(motivo) && quemDecide(motivo) === 'dono');
    if (doDono && !aprovado(Date.parse(e.ts))) return `escalação ${motivo}`;
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
}

export function esperaDoCondutor(t: Thread, eventos: readonly EventoLedger[], quando: string,
  radar?: SessaoNoRadar | null): EsperaDoCondutor | null {
  if (t.status === 'fechada') return null;
  const despacho = ultimoDespacho(eventos);
  if (!despacho || despacho.pausaAoFim !== false) return null;
  const fim = fimDoTurno(eventos, despacho, radar);
  if (!fim || fim.tipo === 'outro' || pendenciaDoDono(t, eventos, quando)) return null;
  return { thread: t.id, fase: fim.fase, sessionId: fim.sessionId, fimDoTurnoEm: fim.em, tipo: fim.tipo };
}

// ---------------------------------------------------------------------------
// O estado da entrega e os cinco casos.
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
  /** `true`: a copia local do remoto contem a ponta; `false`: ha commit sem push; `null`: sem branch. */
  publicada: boolean | null;
  pr: PrDaEntrega | null;
  /** A hora da leitura dos PRs que valeu para esta thread. */
  prLidoEm: string | null;
  /** Por que os PRs nao foram lidos, quando a thread precisava deles. */
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
  /** O radar do pulse. */
  sessoes?: readonly SessaoNoRadar[];
  limiarMin?: number;
}

export interface EntregasDoProjeto {
  estados: EstadoDaEntrega[];
  /** Uma linha por thread, mais as sessoes que sobraram de thread fechada. */
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
  const r = exec('git', ['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads/', `refs/remotes/${remoto}/`], raiz);
  const mapa = new Map<string, string>();
  if (!r.ok) return mapa;
  for (const linha of r.stdout.split('\n')) {
    const [ref, sha] = linha.split('\t');
    if (ref && sha && SHA.test(sha)) mapa.set(ref, sha);
  }
  return mapa;
}

/** Situacao dos checks de um PR aberto e o instante que conta para cada uma. */
function situacaoDoPr(pr: PrDaForja): { situacao: SituacaoDoCheck; desdeEm: string | null; vermelho: string | null } {
  const vermelhos = pr.checks.filter((c) => c.situacao === 'vermelho');
  const maisNovo = (cs: CheckDoPr[]) => cs.map((c) => c.concluidoEm).filter((x): x is string => !!x).sort().at(-1) ?? null;
  if (vermelhos.length) {
    const ultimo = [...vermelhos].sort((a, b) => String(a.concluidoEm).localeCompare(String(b.concluidoEm))).at(-1)!;
    return { situacao: 'vermelho', desdeEm: maisNovo(vermelhos) ?? pr.criadoEm, vermelho: ultimo.nome };
  }
  if (!pr.checks.length || pr.checks.some((c) => c.situacao === 'pendente')) return { situacao: 'pendente', desdeEm: null, vermelho: null };
  return { situacao: 'verde', desdeEm: maisNovo(pr.checks) ?? pr.criadoEm, vermelho: null };
}

/**
 * O PR que vale para a branch: o aberto mais novo; sem aberto, o mesclado na ponta atual (commit novo
 * depois do merge e entrega nova, que ainda nao tem PR).
 */
function prDaBranch(retrato: RetratoDePrs | null, branch: string | null, cabeca: string | null): PrDaForja | null {
  if (!retrato || !branch) return null;
  const daBranch = retrato.prs.filter((p) => p.branch === branch).sort((a, b) => b.numero - a.numero);
  return daBranch.find((p) => p.estado === 'aberto') ?? daBranch.find((p) => p.estado === 'mesclado' && p.head === cabeca) ?? null;
}

const houveDespachoDepois = (eventos: readonly EventoLedger[], desde: string): boolean =>
  eventos.some((e) => e.tipo === 'phase_dispatch' && Date.parse(e.ts) > Date.parse(desde));

/**
 * O estado da entrega de cada thread aberta deste checkout e o que esta parado no condutor (os cinco
 * casos, D5), mais as sessoes `blocked` sem pergunta que sobraram de thread fechada.
 */
export function entregasDoProjeto(carregado: ManifestoCarregado, opcoes: OpcoesDasEntregas): EntregasDoProjeto {
  const raiz = carregado.raiz, quando = opcoes.quando, limiar = opcoes.limiarMin ?? LIMIAR_PARADO_NO_CONDUTOR_MIN;
  const remoto = carregado.manifesto.fabrica.remoto, baseBranch = carregado.manifesto.worktree.base_branch;
  const refs = refsLocais(raiz, remoto);
  // A copia do remoto vem primeiro: a base local desta maquina pode estar parada (o merge e pelo GitHub).
  const baseRef = [`refs/remotes/${remoto}/${baseBranch}`, `refs/heads/${baseBranch}`].find((r) => refs.has(r)) ?? null;
  const sessoes = opcoes.sessoes ?? [];
  const threads: Thread[] = [];
  for (const id of listarIds(raiz)) { try { threads.push(lerThread(raiz, id)); } catch { /* thread ilegivel fica de fora */ } }

  const fatos = threads.filter((t) => t.status !== 'fechada').map((t) => {
    let eventos: EventoLedger[] = [];
    try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { /* ledger ilegivel: sem fato, sem caso */ }
    const branch = branchDaWorktree(t);
    const cabeca = refs.get(`refs/heads/${branch}`) ?? null;
    const remota = refs.get(`refs/remotes/${remoto}/${branch}`) ?? null;
    const comProduto = !!cabeca && !!baseRef && Number(exec('git', ['rev-list', '--count', `${baseRef}..${cabeca}`], raiz).stdout.trim()) > 0;
    const publicada = !cabeca ? null
      : !!remota && (remota === cabeca || exec('git', ['merge-base', '--is-ancestor', cabeca, remota], raiz).ok);
    let entregue = false;
    try { entregue = !!baseRef && mergeDaThread(raiz, t.id, baseRef) !== null; } catch { entregue = false; }
    return { t, eventos, branch: cabeca ? branch : null, cabeca, comProduto, publicada, entregue };
  });

  // D2: a forja so e lida quando alguma thread tem o que mostrar la.
  let prs: LeituraDePrs | null = null;
  if (opcoes.lerPrs && fatos.some((f) => f.comProduto && f.publicada === true && !f.entregue)) prs = opcoes.lerPrs();
  const retrato = prs?.ok ? prs.retrato : null;

  const estados: EstadoDaEntrega[] = [], parados: ParadoNoCondutor[] = [];
  const doCondutor = { gates: new Set<string>(), sessoes: new Set<string>() };
  for (const f of fatos) {
    const { t, eventos } = f;
    const despacho = ultimoDespacho(eventos);
    const radar = sessoes.find((s) => s.thread?.id === t.id && s.sessionId === texto(despacho?.sessionId)) ?? null;
    const espera = esperaDoCondutor(t, eventos, quando, radar);
    if (espera) {
      doCondutor.gates.add(`${t.id}|${espera.fase ?? t.faseAtual}`);
      if (espera.sessionId) doCondutor.sessoes.add(espera.sessionId);
    }
    const fim = despacho ? fimDoTurno(eventos, despacho, radar) : null;
    const conducao = conducaoDaThread(raiz, t.id, { agora: new Date(quando) });
    // P7: a sessao que ja encerrou o turno nao conduz mais nada, mesmo com o lease de pe.
    const conduzidaAgora = !!conducao && !(conducao.dono.tipo === 'sessao' && fim && fim.tipo !== 'outro' &&
      conducao.dono.sessionId === fim.sessionId);
    const doDono = pendenciaDoDono(t, eventos, quando);
    const forja = prDaBranch(retrato, f.branch, f.cabeca);
    const pr = forja && !(forja.estado === 'mesclado' && f.entregue) ? forja : null;
    const situacao = pr?.estado === 'aberto' ? situacaoDoPr(pr) : null;
    const prDaEntrega: PrDaEntrega | null = pr ? { numero: pr.numero, estado: pr.estado, situacao: situacao?.situacao ?? null,
      checkVermelho: situacao?.vermelho ?? null, rascunho: pr.rascunho } : null;
    const precisaDePr = f.comProduto && f.publicada === true && !f.entregue;
    const prNaoLido = precisaDePr && !retrato ? (prs && !prs.ok ? prs.erro : 'sem leitura dos PRs') : null;
    const terminou = !!fim && fim.tipo !== 'outro';

    let caso: CasoParado | null = null, desde: string | null = null, passo = '';
    const evidencia: string[] = [];
    if (!f.entregue && !conduzidaAgora && !doDono) {
      if (pr && pr.estado === 'aberto' && situacao?.situacao === 'vermelho' && situacao.desdeEm &&
          !houveDespachoDepois(eventos, situacao.desdeEm)) {
        caso = 'pr-vermelho'; desde = situacao.desdeEm;
        passo = `corrigir o check ${situacao.vermelho} vermelho do PR #${pr.numero} e despachar a correção`;
        evidencia.push(`gh pr list: PR #${pr.numero} com o check ${situacao.vermelho} vermelho`, 'ledger: nenhuma fase despachada depois do check');
      } else if (pr && pr.estado === 'aberto' && situacao?.situacao === 'verde' && situacao.desdeEm &&
          !houveDespachoDepois(eventos, situacao.desdeEm)) {
        caso = 'pr-verde'; desde = situacao.desdeEm;
        passo = pr.rascunho ? `tirar o PR #${pr.numero} do rascunho e mergear` : `mergear o PR #${pr.numero}`;
        evidencia.push(`gh pr list: PR #${pr.numero} com ${pr.checks.length} check(s) verde(s) e sem merge`);
      } else if (!pr && precisaDePr && retrato && terminou) {
        caso = 'sem-pr'; desde = fim!.em;
        passo = `abrir o PR da branch ${f.branch}`;
        evidencia.push(`refs/remotes/${remoto}/${f.branch} contém a ponta`, `gh pr list: nenhum PR de ${f.branch}`);
      } else if (f.comProduto && f.publicada === false && terminou) {
        caso = 'sem-push'; desde = fim!.em;
        passo = `publicar a branch ${f.branch} e abrir o PR`;
        evidencia.push(`refs/heads/${f.branch} tem commit fora de refs/remotes/${remoto}/${f.branch}`);
      } else if (espera && !precisaDePr && !(f.comProduto && f.publicada === false)) {
        caso = 'sessao-sem-pergunta'; desde = espera.fimDoTurnoEm;
        const id = curtoDaSessao(espera.sessionId);
        passo = `ler o fim da sessão ${id} (ork sessions logs ${id}) e seguir a thread`;
      }
    }
    if (caso && fim && fim.tipo !== 'outro') evidencia.push(`fim do turno: ${fim.tipo}`);
    const paradoHaMin = desde ? minutosDesde(desde, quando) : 0;
    const parado: ParadoNoCondutor | null = caso && desde && paradoHaMin >= limiar ? {
      thread: t.id, caso, desdeEm: desde, paradoHaMin, proximoPasso: passo, evidencia, branch: f.branch, pr: pr?.numero ?? null,
      sessionId: espera?.sessionId ?? fim?.sessionId ?? null,
    } : null;
    if (parado) parados.push(parado);

    const resumo = f.entregue ? null
      : prDaEntrega?.estado === 'aberto' ? (prDaEntrega.situacao === 'vermelho'
        ? `PR #${prDaEntrega.numero} aberto com o check ${prDaEntrega.checkVermelho} vermelho`
        : prDaEntrega.situacao === 'verde' ? `PR #${prDaEntrega.numero} com os checks verdes, esperando o merge`
        : `PR #${prDaEntrega.numero} aberto, checks em andamento`)
      : prDaEntrega?.estado === 'mesclado' ? `PR #${prDaEntrega.numero} mesclado, falta registrar a entrega (ork ship registrar-pr ${t.id})`
      : precisaDePr ? (retrato ? 'branch publicada sem PR' : 'branch publicada, PR não lido')
      : f.comProduto && f.publicada === false ? 'branch com commits sem push' : null;
    estados.push({ thread: t.id, branch: f.branch, comProduto: f.comProduto, publicada: f.publicada, pr: prDaEntrega,
      prLidoEm: retrato && (pr || precisaDePr) ? retrato.lidoEm : null, prNaoLido, conduzidaAgora, espera, parado, resumo });
  }

  // A sessao `blocked` sem pergunta: de thread fechada e sobra; de thread aberta, sem nada do dono, e do condutor.
  for (const s of sessoes) {
    if (!sessaoSemPergunta(s)) continue;
    const t = threads.find((x) => x.id === s.thread!.id);
    if (!t) continue;
    if (t.status !== 'fechada') {
      let eventos: EventoLedger[] = [];
      try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { continue; }
      // A sessao do despacho corrente so muda de dono pelo predicado; a de um despacho antigo da thread e
      // sobra. Sessao que nenhum despacho abriu (adotada, interativa) continua do dono.
      const despachos = eventos.filter((e) => e.tipo === 'phase_dispatch');
      const atual = texto(despachos.at(-1)?.sessionId) === s.sessionId;
      const antiga = !atual && despachos.some((e) => e.sessionId === s.sessionId);
      if (!pendenciaDoDono(t, eventos, quando) && (atual ? doCondutor.sessoes.has(s.sessionId) : antiga)) doCondutor.sessoes.add(s.sessionId);
      continue;
    }
    doCondutor.sessoes.add(s.sessionId);
    const { bloqueadaDesdeEm: desde, desdeEm: inicio } = s;
    const em = instante(desde) ?? instante(inicio);
    if (!em || minutosDesde(em, quando) < limiar) continue;
    const id = curtoDaSessao(s.sessionId);
    parados.push({ thread: t.id, caso: 'sessao-sem-pergunta', desdeEm: em, paradoHaMin: minutosDesde(em, quando),
      proximoPasso: `encerrar a sessão ${id}, que sobrou da thread fechada (ork sessions stop ${id})`,
      evidencia: ['radar: sessão blocked com job vivo e sem menu', 'thread fechada'], branch: null, pr: null, sessionId: s.sessionId });
  }
  parados.sort((a, b) => a.desdeEm.localeCompare(b.desdeEm) || a.thread.localeCompare(b.thread));
  return { estados, parados, doCondutor, prs };
}
