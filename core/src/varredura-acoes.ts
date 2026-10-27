/**
 * RM-063 (F5): a varredura que age.
 *
 * Incidente de 03 a 12/10/2026 (P4 e P5 da pagina da RM-063): o PR #112 (`ork-rm043sobrasd`) foi mesclado e ficou dois
 * dias sem `ork ship registrar-pr`, e as sessoes fantasmas de threads ja fechadas ficaram registradas, porque ninguem
 * roda esses comandos sem um condutor. Aqui moram as tres acoes de arrumacao que a batida (`pulse-delivery`) faz:
 *
 *  - `limpar`: a sessao fantasma (sem pid e sem processo, RM-056) ainda presa a uma thread deste projeto, sem sinal de
 *    vida ha pelo menos 30 min, sai do ork pelo `ork sessions limpar-fantasmas`, que grava `sessao_morta` e nunca toca o
 *    runtime;
 *  - `registrar`: o merge `ship(<thread>)` da branch `ork/*` da thread na base remota, sem `ship_done`, vira entrega
 *    pelo `ork ship registrar-pr`, com a mesma prova de sempre (merge dentro da ponta remota e CI verde);
 *  - `master`: a thread entregue, sem nota do dono e quieta (nada despachado depois da entrega, 30 min depois do
 *    `ship_done`) fecha pelo MASTER por omissao, so ela (`ork master <thread> --aceitar-omissao`).
 *
 * `registrar` e `master` nunca agem sozinhos por cima de trabalho na thread: alguem conduzindo, sessao viva na worktree
 * (ou o runtime que nao respondeu, sem a prova), worktree com alteracao nao commitada, commit na branch depois do head do
 * PR mesclado, ou despacho depois dele. Nesses casos a acao fica com o dono, com o motivo tipado (`motivoDoBloqueio`).
 *
 * A deteccao (`acoesPendentes`) e leitura pura e alimenta a fila do pulse. A execucao (`agirNaVarredura`) so faz o que
 * a autorizacao duravel do dono permite (`autorizacao-duravel.ts`), e cada acao feita ou recusada vai ao ledger da
 * thread como `varredura_acao`, com a autorizacao que a permitiu; a mesma recusa seguida nao vira linha nova. Sem
 * autorizacao, nada e feito: cada acao vira um item da fila do pulse com o comando pronto.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { autorizada, LeituraDaAutorizacao, lerAutorizacao, referenciaDaAutorizacao } from './autorizacao-duravel';
import { conducaoDaThread } from './conducao';
import { registrarEntregaPorPr } from './entrega-pr';
import { mergesDasEntregasNaBase } from './merge-da-entrega';
import { raizDoEstado } from './estado-thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { comLocale, textoDoCatalogo } from './locale';
import { ManifestoCarregado } from './manifest';
import { aceitarPendentesPorOmissao, motivoForaDaOmissao } from './master';
import { ArcoDoPasso, arcoDoPasso, lerArcosDaRaiz, MOTIVO_DO_ARCO_ILEGIVEL } from './noctum-guarda';
import { LIMIAR_PARADO_NO_CONDUTOR_MIN } from './parado-no-condutor';
import { FantasmaTratado, limparFantasmas } from './sessoes';
import { inventariarSessoes } from './sessoes-inventario';
import { dirThread, lerThread, listarIds } from './thread';
import { EventoLedger, Thread } from './types';
import { exec } from './util';
import { PRAZO_DA_LEITURA_MS } from './vida-da-thread';
import { branchDaWorktree } from './worktree';

/**
 * As acoes da varredura. `limpar`, `registrar` e `master` sao da F5 (este modulo); `merge` e `despachar` sao da batida da
 * conducao (F7, `conducao-batida.ts`), que grava o mesmo `varredura_acao` e entra no mesmo "feitas" do pulse.
 */
export const ACOES_DA_VARREDURA = ['limpar', 'registrar', 'master', 'merge', 'despachar'] as const;
export type AcaoDaVarredura = typeof ACOES_DA_VARREDURA[number];

/**
 * Por que nem a autorizacao faz a acao sozinha agora. Os sete primeiros sao o trabalho na thread (F5); os seguintes sao
 * do merge e do despacho da batida da conducao (F7): o PR que ainda nao esta pronto, o conflito em codigo e a fase sem o
 * prompt gravado.
 */
export const MOTIVOS_DO_BLOQUEIO = ['conduzida', 'sessao-viva', 'sessoes-sem-leitura', 'worktree-suja', 'branch-com-commits',
  'trabalho-novo', 'git-sem-resposta', 'pr-rascunho', 'checks-vermelhos', 'sem-checks-obrigatorios', 'pr-bloqueado',
  'pr-instavel', 'conflito-em-codigo', 'branch-nao-publicada', 'sem-prompt-gravado', 'check-pendente', 'pendencia-do-dono',
  'espera-longa', 'thread-do-arco'] as const;
export type MotivoDoBloqueio = typeof MOTIVOS_DO_BLOQUEIO[number];

export interface AcaoPendente {
  acao: AcaoDaVarredura;
  thread: string;
  fase: string | null;
  /** A sessao fantasma, em `limpar`. */
  sessionId: string | null;
  /** Desde quando a acao espera: o ultimo sinal da sessao, o merge, a entrega. */
  desdeEm: string | null;
  /** O comando pronto que o dono roda no terminal. */
  comando: string;
  /** O que a acao faz, em linguagem simples (vai ao dono). */
  oQue: string;
  evidencia: string;
  /** Por que nem a autorizacao faz esta acao sozinha agora; ela fica com o dono. */
  bloqueio: string | null;
  motivoDoBloqueio: MotivoDoBloqueio | null;
  /** A ultima tentativa da varredura, autorizada, que nao fez; o dono ve o motivo. */
  recusa: { em: string; detalhe: string } | null;
}

/** Uma sessao viva agora, pelo cwd: e o que prova trabalho na worktree de uma thread. */
export interface SessaoViva { sessionId: string; cwd: string }

export interface OpcoesDaDeteccao {
  quando?: string;
  /** As sessoes fantasmas que o `limpar` soltaria; `null` quando o runtime nao foi lido (nada se afirma). */
  fantasmas?: () => FantasmaTratado[] | null;
  /**
   * As sessoes vivas agora; `null` quando o runtime nao foi lido: sem a prova, `registrar` e `master` nao agem sozinhos.
   * Sem esta opcao e sem `fantasmas`, as duas saem de uma leitura so do inventario de todas as contas.
   */
  vivas?: () => readonly SessaoViva[] | null;
}

/** A sessao so e tratada como fantasma depois de duas batidas sem sinal: a recem-despachada pode nao ter pid ainda. */
export const IDADE_MINIMA_DA_FANTASMA_MIN = 30;

const SHA = /^[0-9a-f]{40}$/;
/** Os eventos de trabalho novo numa fase: o pedido de despacho e o despacho. */
const TRABALHO_NOVO: readonly string[] = [TIPOS_DE_EVENTO.promptGravado, TIPOS_DE_EVENTO.faseDespachada];
/** Os eventos que nao sao sinal de vida da sessao: a contabilidade do proprio ork. */
const SO_DO_ORK = /^(conducao_|retry_|despacho_idempotente$|varredura_acao$)/;

function lerThreads(raiz: string): Thread[] {
  const saida: Thread[] = [];
  for (const id of listarIds(raiz)) { try { saida.push(lerThread(raiz, id)); } catch { /* thread ilegivel fica de fora */ } }
  return saida;
}

function ledgerDe(raiz: string, id: string): EventoLedger[] {
  try { return lerLedger(dirThread(raiz, id)); } catch { return []; }
}

/** A ultima tentativa recusada desta acao na thread, depois de `desde`. */
function recusaDe(eventos: readonly EventoLedger[], acao: AcaoDaVarredura, sessionId: string | null, desde: string | null):
  AcaoPendente['recusa'] {
  const e = [...eventos].reverse().find((x) => x.tipo === TIPOS_DE_EVENTO.acaoDaVarredura && x.acao === acao &&
    (sessionId === null || x.sessionId === sessionId));
  if (!e || e.resultado !== 'recusada' || (desde && e.ts < desde)) return null;
  return { em: e.ts, detalhe: typeof e.detalhe === 'string' ? e.detalhe : '' };
}

const conduzida = (raiz: string, id: string, quando: string): boolean => {
  try { return conducaoDaThread(raiz, id, { agora: new Date(quando) }) !== null; } catch { return true; }
};

const real = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** O instante do commit pela copia local; `null` quando o git nao responde. */
function dataDoCommit(raiz: string, sha: string): string | null {
  const r = exec('git', ['log', '-1', '--format=%cI', sha, '--'], raiz, 30000);
  const ms = r.ok ? Date.parse(r.stdout.trim()) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const comMotivo = (motivo: MotivoDoBloqueio): { motivo: MotivoDoBloqueio; texto: string } =>
  ({ motivo, texto: textoDoCatalogo((m) => m.pulse.varredura.bloqueios[motivo]) });

/**
 * O trabalho em curso na worktree da thread, que nenhuma acao automatica atropela: alguem conduzindo, sessao viva nela
 * (ou o runtime que nao respondeu, sem a prova), ou alteracao nao commitada.
 */
export function trabalhoNaWorktree(raiz: string, t: Thread, quando: string, vivas: readonly SessaoViva[] | null):
  { motivo: MotivoDoBloqueio; texto: string } | null {
  if (conduzida(raiz, t.id, quando)) return comMotivo('conduzida');
  if (vivas === null) return comMotivo('sessoes-sem-leitura');
  const wt = t.worktree ? real(t.worktree) : null;
  if (!wt || !fs.existsSync(wt)) return null;
  if (vivas.some((v) => { const c = real(v.cwd); return c === wt || c.startsWith(wt + path.sep); })) return comMotivo('sessao-viva');
  const st = exec('git', ['status', '--porcelain', '--', '.', ':(exclude).orkastery'], wt, 30000);
  if (!st.ok) return comMotivo('git-sem-resposta');
  return st.stdout.trim() ? comMotivo('worktree-suja') : null;
}

/** Commits na branch da thread depois de `sha` (o head do PR mesclado); `null` quando o git nao responde. */
function commitsDepois(raiz: string, t: Thread, sha: string): number | null {
  const branch = branchDaWorktree(t);
  if (!exec('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], raiz, 30000).ok) return 0;
  const r = exec('git', ['rev-list', '--count', `${sha}..refs/heads/${branch}`], raiz, 30000);
  return r.ok ? Number(r.stdout.trim()) : null;
}

/**
 * Os merges `ship(<thread>)` da base remota (a copia local dela) numa leitura so, do mais novo ao mais velho: fica o mais
 * novo de cada thread, com o head do PR (o segundo pai) e o instante do commit. E a mesma busca do `ork ship
 * registrar-pr` (`mergeDaEntrega`).
 */
function mergesDaBase(raiz: string, remoto: string, base: string, threads: Thread[]):
  Map<string, { mergeSha: string; headSha: string | null; em: string | null }> {
  const mapa = new Map<string, { mergeSha: string; headSha: string | null; em: string | null }>();
  const reconhecidos = mergesDasEntregasNaBase(raiz, `refs/remotes/${remoto}/${base}`, base,
    threads.map((t) => ({ thread: t.id, branch: branchDaWorktree(t) })));
  for (const t of threads) {
    const merge = reconhecidos.get(t.id)?.[0];
    if (merge) mapa.set(t.id, merge);
  }
  return mapa;
}

/** As sessoes fantasmas presas a threads deste projeto, sem sinal de vida ha 30 min, uma acao por sessao. */
function pendentesDeLimpar(raiz: string, threads: Map<string, Thread>, fantasmas: FantasmaTratado[] | null, quando: string): AcaoPendente[] {
  const saida: AcaoPendente[] = [];
  for (const f of fantasmas ?? []) {
    const t = f.thread ? threads.get(f.thread) : undefined;
    if (f.acao !== 'solto' || !t) continue;
    const eventos = ledgerDe(raiz, t.id);
    // O ultimo sinal da sessao, sem a contabilidade do ork: a recusa da propria varredura nao rejuvenesce a fantasma.
    const ultimo = [...eventos].reverse().find((e) => e.sessionId === f.sessionId && !SO_DO_ORK.test(e.tipo))?.ts ??
      (t.sessoes ?? []).find((s) => s.sessionId === f.sessionId)?.despachadaEm ?? null;
    if (!ultimo || Date.parse(quando) - Date.parse(ultimo) < IDADE_MINIMA_DA_FANTASMA_MIN * 60000) continue;
    const id = f.sessionId.slice(0, 8);
    saida.push({ acao: 'limpar', thread: t.id, fase: f.fase, sessionId: f.sessionId, desdeEm: ultimo,
      comando: 'ork sessions limpar-fantasmas', oQue: textoDoCatalogo((m) => m.pulse.varredura.oQue.limpar(id)),
      evidencia: `claude agents lista a sessão ${id} sem pid ou com pid sem processo${f.perfil ? ` (perfil ${f.perfil})` : ''}`,
      bloqueio: null, motivoDoBloqueio: null, recusa: recusaDe(eventos, 'limpar', f.sessionId, ultimo) });
  }
  return saida;
}

/**
 * O merge `ship(<thread>)` da branch `ork/*` da thread na base remota (a copia local dela) sem `ship_done` que o cubra.
 * O `ship_done` antigo sem o sha, ou o que gravou a ponta da base que contem o merge, cobre (a mesma regra do pulse).
 */
function pendentesDeRegistrar(carregado: ManifestoCarregado, threads: Thread[], quando: string,
  vivas: readonly SessaoViva[] | null): AcaoPendente[] {
  const { raiz, manifesto } = carregado;
  const remoto = manifesto.fabrica.remoto, base = manifesto.worktree.base_branch;
  const saida: AcaoPendente[] = [];
  const abertas = threads.filter((t) => t.status !== 'fechada' && branchDaWorktree(t).startsWith('ork/'));
  const merges = abertas.length ? mergesDaBase(raiz, remoto, base, abertas)
    : new Map<string, { mergeSha: string; headSha: string | null; em: string | null }>();
  for (const t of abertas) {
    const merge = merges.get(t.id);
    if (!merge) continue;
    const eventos = ledgerDe(raiz, t.id);
    const ships = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
    const coberto = ships.some((e) => typeof e.mergeSha !== 'string' || !SHA.test(e.mergeSha) || e.mergeSha === merge.mergeSha ||
      exec('git', ['merge-base', '--is-ancestor', merge.mergeSha, e.mergeSha], raiz, 30000).code === 0);
    if (coberto) continue;
    // O registro avanca a fase da thread para SHIP: ele nao vai por cima do trabalho que veio depois do PR. Conta a partir
    // do head do PR (o merge pode chegar horas depois): commit novo na branch, ou despacho depois dele.
    const desde = (merge.headSha ? dataDoCommit(raiz, merge.headSha) : null) ?? merge.em;
    const depois = merge.headSha ? commitsDepois(raiz, t, merge.headSha) : 0;
    const motivo = trabalhoNaWorktree(raiz, t, quando, vivas)
      ?? (depois === null ? comMotivo('git-sem-resposta') : depois > 0 ? comMotivo('branch-com-commits') : null)
      ?? (desde && eventos.some((e) => TRABALHO_NOVO.includes(e.tipo) && e.ts > desde) ? comMotivo('trabalho-novo') : null);
    const curto = merge.mergeSha.slice(0, 7);
    saida.push({ acao: 'registrar', thread: t.id, fase: t.faseAtual, sessionId: null, desdeEm: merge.em,
      comando: `ork ship registrar-pr ${t.id}`,
      oQue: textoDoCatalogo((m) => m.pulse.varredura.oQue.registrar(curto, branchDaWorktree(t), `${remoto}/${base}`)),
      evidencia: `git log ${remoto}/${base}: merge ship(${t.id}) ${curto}, sem ship_done no ledger`,
      bloqueio: motivo?.texto ?? null, motivoDoBloqueio: motivo?.motivo ?? null, recusa: recusaDe(eventos, 'registrar', null, merge.em) });
  }
  return saida;
}

/** A branch da thread tem commit fora da base? `null` quando o git nao responde (na duvida, nada fecha). */
function produtoNovo(carregado: ManifestoCarregado, t: Thread): boolean | null {
  const { raiz, manifesto } = carregado;
  const remoto = manifesto.fabrica.remoto, base = manifesto.worktree.base_branch, branch = branchDaWorktree(t);
  const ref = (r: string) => exec('git', ['rev-parse', '--verify', '-q', r], raiz, 30000).ok;
  if (!ref(`refs/heads/${branch}`)) return false;
  const daBase = ref(`refs/remotes/${remoto}/${base}`) ? `refs/remotes/${remoto}/${base}` : `refs/heads/${base}`;
  const r = exec('git', ['rev-list', '--count', `${daBase}..refs/heads/${branch}`], raiz, 30000);
  return r.ok ? Number(r.stdout.trim()) > 0 : null;
}

/** A thread entregue e quieta, sem nota do dono: fecha pelo MASTER por omissao. */
function pendentesDeMaster(carregado: ManifestoCarregado, threads: Thread[], quando: string,
  vivas: readonly SessaoViva[] | null): AcaoPendente[] {
  const { raiz } = carregado;
  const saida: AcaoPendente[] = [];
  for (const t of threads) {
    if (t.status === 'fechada') continue;
    let fora: ReturnType<typeof motivoForaDaOmissao>;
    try { fora = motivoForaDaOmissao(raiz, t.id); } catch { continue; }
    if (fora) continue;
    const eventos = ledgerDe(raiz, t.id);
    const ship = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido).at(-1);
    if (!ship) continue;
    // Quieta: nada pedido ou despachado depois da entrega, e o condutor teve 30 min para o MASTER dele.
    if (eventos.some((e) => TRABALHO_NOVO.includes(e.tipo) && e.ts > ship.ts)) continue;
    if (Date.parse(quando) - Date.parse(ship.ts) < LIMIAR_PARADO_NO_CONDUTOR_MIN * 60000) continue;
    // A entrega conta do head que ela levou (o registro pode vir horas depois do PR): despacho depois dele e trabalho novo.
    const desdeOHead = typeof ship.shaDe === 'string' && SHA.test(ship.shaDe) ? dataDoCommit(raiz, ship.shaDe) : null;
    const novo = produtoNovo(carregado, t);
    const motivo = trabalhoNaWorktree(raiz, t, quando, vivas)
      ?? (novo === true ? comMotivo('branch-com-commits') : novo === null ? comMotivo('git-sem-resposta') : null)
      ?? (desdeOHead && eventos.some((e) => TRABALHO_NOVO.includes(e.tipo) && e.ts > desdeOHead) ? comMotivo('trabalho-novo') : null);
    saida.push({ acao: 'master', thread: t.id, fase: t.faseAtual, sessionId: null, desdeEm: ship.ts,
      comando: `ork master ${t.id} --aceitar-omissao`, oQue: textoDoCatalogo((m) => m.pulse.varredura.oQue.master),
      evidencia: 'ledger: ship_done sem despacho nem MASTER depois dele',
      bloqueio: motivo?.texto ?? null, motivoDoBloqueio: motivo?.motivo ?? null, recusa: recusaDe(eventos, 'master', null, ship.ts) });
  }
  return saida;
}

/**
 * As fantasmas e as sessoes vivas numa leitura so do inventario de todas as contas, com o prazo curto da leitura da vida
 * (20 s por conta): o pulse e o status nao esperam um daemon travado. Conta que nao respondeu deixa as vivas sem prova.
 */
export function lerSessoes(raiz: string, opcoes: OpcoesDaDeteccao): { fantasmas: FantasmaTratado[] | null; vivas: readonly SessaoViva[] | null } {
  if (opcoes.fantasmas || opcoes.vivas) {
    let fantasmas: FantasmaTratado[] | null = null, vivas: readonly SessaoViva[] | null = null;
    try { fantasmas = opcoes.fantasmas ? opcoes.fantasmas() : null; } catch { fantasmas = null; }
    try { vivas = opcoes.vivas ? opcoes.vivas() : null; } catch { vivas = null; }
    return { fantasmas, vivas };
  }
  try {
    const inventario = inventariarSessoes(raiz, { global: true, prazoMs: PRAZO_DA_LEITURA_MS });
    const fantasmas = limparFantasmas(raiz, { dryRun: true, inventario }).itens;
    const claude = inventario.fontes.filter((f) => f.origem.startsWith('claude agents'));
    const vivas = claude.every((f) => f.ok)
      ? inventario.sessoes.filter((s) => s.viva && typeof s.cwd === 'string').map((s) => ({ sessionId: s.sessionId, cwd: s.cwd as string }))
      : null;
    return { fantasmas, vivas };
  } catch { return { fantasmas: null, vivas: null }; }
}

/**
 * As acoes que a varredura faria agora, sem fazer nenhuma. Leitura pura (o git da copia local, o ledger, o runtime pelo
 * inventario), na ordem em que a execucao as faz: `limpar`, `registrar`, `master`.
 *
 * RM-058, integracao (T1.2, D3): a thread que um arco #Noctum segura nao tem acao de fora. Por padrao (o pulse) ela some da
 * lista, porque quem diz dela ao dono e o relatorio do arco; com `comArco` (a varredura que age), ela fica com o bloqueio
 * `thread-do-arco`, para o retrato da batida dizer o pulo. A retencao depois do arco nao segura estas tres acoes (D4).
 */
export function acoesPendentes(carregado: ManifestoCarregado, opcoes: OpcoesDaDeteccao & { comArco?: boolean } = {}): AcaoPendente[] {
  const raiz = raizDoEstado(carregado.raiz);
  const quando = opcoes.quando ?? new Date().toISOString();
  const doProjeto = { ...carregado, raiz };
  const threads = lerThreads(raiz);
  const { fantasmas, vivas } = lerSessoes(raiz, opcoes);
  const todas = [
    ...pendentesDeLimpar(raiz, new Map(threads.map((t) => [t.id, t])), fantasmas, quando),
    ...pendentesDeRegistrar(doProjeto, threads, quando, vivas),
    ...pendentesDeMaster(doProjeto, threads, quando, vivas),
  ];
  const arcos = lerArcosDaRaiz(raiz, quando);
  if (!arcos.lidos.size && !arcos.ilegiveis.size) return todas;
  const porThread = new Map<string, ArcoDoPasso | null>();
  const saida: AcaoPendente[] = [];
  for (const a of todas) {
    if (!porThread.has(a.thread)) porThread.set(a.thread, arcoDoPasso(raiz, arcos, a.thread, ledgerDe(raiz, a.thread)));
    const arco = porThread.get(a.thread);
    if (arco?.efeito !== 'guarda') { saida.push(a); continue; }
    // A6 do CHECK: o arco que nao se le nao tem relatorio que diga da thread ao dono; a acao fica no pulse, bloqueada.
    if (opcoes.comArco || arco.motivo === MOTIVO_DO_ARCO_ILEGIVEL) saida.push({ ...a, bloqueio: arco.detalhe, motivoDoBloqueio: 'thread-do-arco' });
  }
  return saida;
}

export interface AcaoFeita {
  acao: AcaoDaVarredura;
  thread: string;
  sessionId: string | null;
  resultado: 'feita' | 'recusada';
  detalhe: string;
}

export interface VarreduraQueAge {
  autorizacao: LeituraDaAutorizacao;
  /** A base remota foi trazida antes da deteccao? `null` quando nao houve busca. */
  busca: { ok: boolean; detalhe: string } | null;
  feitas: AcaoFeita[];
  /** O que ficou para o dono: sem autorizacao para a acao, ou com bloqueio. */
  pendentes: AcaoPendente[];
}

export interface OpcoesDaVarreduraQueAge extends OpcoesDaDeteccao {
  /** A autorizacao ja lida; sem ela, a desta maquina. */
  autorizacao?: LeituraDaAutorizacao;
  /** Traz a base remota antes da deteccao (padrao: sim). Os testes com remoto local tambem buscam. */
  buscar?: boolean;
}

/** `git fetch` da base, sem pergunta no terminal e com prazo: e o que faz o merge do GitHub aparecer na batida. */
export function buscarBase(carregado: ManifestoCarregado): { ok: boolean; detalhe: string } {
  const { raiz, manifesto } = carregado;
  const remoto = manifesto.fabrica.remoto, base = manifesto.worktree.base_branch;
  if (!exec('git', ['remote', 'get-url', '--', remoto], raiz, 30000).ok) return { ok: false, detalhe: `sem o remoto ${remoto}` };
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' };
  const r = exec('git', ['fetch', '-q', '--no-tags', '--', remoto, `+refs/heads/${base}:refs/remotes/${remoto}/${base}`], raiz, 60000, env);
  return r.ok ? { ok: true, detalhe: `${remoto}/${base} trazida` }
    : { ok: false, detalhe: `git fetch ${remoto} ${base} saiu ${r.error ?? r.code}: ${r.stderr.trim().split('\n')[0]?.slice(0, 160) ?? ''}` };
}

/**
 * A batida que age: traz a base, detecta as acoes e faz as que a autorizacao duravel permite, na ordem. Cada acao feita
 * ou recusada vai ao ledger da thread (`varredura_acao`), com quem autorizou e ate quando; a mesma recusa da vez anterior
 * nao vira linha nova. Sem autorizacao valida, nada e feito e tudo fica pendente para a fila do pulse.
 */
export function agirNaVarredura(carregado: ManifestoCarregado, opcoes: OpcoesDaVarreduraQueAge = {}): VarreduraQueAge {
  const raiz = raizDoEstado(carregado.raiz);
  const quando = opcoes.quando ?? new Date().toISOString();
  const leitura = opcoes.autorizacao ?? lerAutorizacao(raiz, { projeto: carregado.manifesto.project.name, agora: new Date(quando) });
  const busca = opcoes.buscar === false ? null : buscarBase(carregado);
  const sessoes = lerSessoes(raiz, opcoes);
  const pendentes = acoesPendentes(carregado, { quando, fantasmas: () => sessoes.fantasmas, vivas: () => sessoes.vivas, comArco: true });
  const feitas: AcaoFeita[] = [];
  const ficam: AcaoPendente[] = [];
  const referencia = referenciaDaAutorizacao(leitura);
  const gravar = (p: AcaoPendente, resultado: AcaoFeita['resultado'], detalhe: string): void => {
    const curto = detalhe.slice(0, 400);
    // A mesma recusa da vez anterior (mesma acao, sessao e motivo) nao vira linha nova a cada batida.
    const anterior = [...ledgerDe(raiz, p.thread)].reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.acaoDaVarredura &&
      e.acao === p.acao && (p.sessionId === null || e.sessionId === p.sessionId));
    if (!(resultado === 'recusada' && anterior?.resultado === 'recusada' && anterior.detalhe === curto)) {
      registrar(dirThread(raiz, p.thread), p.thread, TIPOS_DE_EVENTO.acaoDaVarredura, {
        fase: p.fase, acao: p.acao, resultado, detalhe: curto, comando: p.comando,
        ...(p.sessionId ? { sessionId: p.sessionId } : {}), origem: 'varredura', autorizacao: referencia,
        quemDecidiu: referencia ? `varredura do ork, pela autorização durável de ${String(referencia.por)}` : null,
        evidencia: p.evidencia,
      });
    }
    feitas.push({ acao: p.acao, thread: p.thread, sessionId: p.sessionId, resultado, detalhe });
  };
  // `limpar` e uma chamada so para as fantasmas que a deteccao ja viu velhas: e o mesmo `ork sessions limpar-fantasmas`.
  const aLimpar = pendentes.filter((p) => p.acao === 'limpar' && !p.bloqueio && autorizada(leitura, 'limpar'));
  let soltas: Map<string, FantasmaTratado> | null = null;
  if (aLimpar.length) {
    try {
      const r = limparFantasmas(raiz, { origem: 'varredura', sessoes: aLimpar.map((p) => p.sessionId as string) });
      soltas = new Map(r.itens.filter((i) => i.thread).map((i) => [`${i.thread}|${i.sessionId}`, i]));
    } catch (e) {
      soltas = null;
      for (const p of aLimpar) { gravar(p, 'recusada', `limpar-fantasmas falhou: ${(e as Error).message}`); ficam.push(p); }
    }
  }
  for (const p of pendentes) {
    if (p.bloqueio || !autorizada(leitura, p.acao)) { ficam.push(p); continue; }
    if (p.acao === 'limpar') {
      if (!soltas) continue;
      const i = soltas.get(`${p.thread}|${p.sessionId}`);
      if (i?.acao === 'solto' || i?.acao === 'ja-solto') gravar(p, 'feita', `sessão ${String(p.sessionId).slice(0, 8)} solta: sessao_morta no ledger`);
      else { gravar(p, 'recusada', i ? `limpar-fantasmas respondeu ${i.acao}` : 'a sessão não apareceu como fantasma na execução'); ficam.push(p); }
      continue;
    }
    if (p.acao === 'registrar') {
      let r: ReturnType<typeof registrarEntregaPorPr>;
      try { r = registrarEntregaPorPr({ ...carregado, raiz }, p.thread, { buscar: false, remoto: carregado.manifesto.fabrica.remoto }); }
      catch (e) { gravar(p, 'recusada', (e as Error).message); ficam.push(p); continue; }
      if (r.acao === 'registrou' || r.acao === 'ja-registrada') gravar(p, 'feita', `${r.acao}: ${r.motivo}`);
      else { gravar(p, 'recusada', `${r.acao}: ${r.motivo}`); ficam.push({ ...p, recusa: { em: quando, detalhe: `${r.acao}: ${r.motivo}` } }); }
      continue;
    }
    // RM-061 (F2b, G2): o MASTER log, o POSTMORTEM e o registro da omissao nascem em pt-BR, como no CLI.
    let aceitas: ReturnType<typeof aceitarPendentesPorOmissao> = [];
    try { aceitas = comLocale('pt-BR', () => aceitarPendentesPorOmissao(raiz, { thread: p.thread })); }
    catch (e) { gravar(p, 'recusada', (e as Error).message); ficam.push(p); continue; }
    if (aceitas.length === 1) gravar(p, 'feita', `fechada pelo MASTER por omissão, índice ${aceitas[0].indice.valor}/${aceitas[0].indice.base}`);
    else { gravar(p, 'recusada', 'nenhuma entrega desta thread esperava o aceite'); ficam.push(p); }
  }
  return { autorizacao: leitura, busca, feitas, pendentes: ficam };
}

/** As acoes feitas pela varredura desde `desde`, de todas as threads (a fechada pelo MASTER inclusive). */
export function acoesFeitasDesde(raiz: string, desde: string): (AcaoFeita & { em: string; eventId: string })[] {
  const saida: (AcaoFeita & { em: string; eventId: string })[] = [];
  const canonica = raizDoEstado(raiz);
  for (const id of listarIds(canonica)) {
    for (const e of ledgerDe(canonica, id)) {
      if (e.tipo !== TIPOS_DE_EVENTO.acaoDaVarredura || e.resultado !== 'feita' || e.ts < desde) continue;
      if (!(ACOES_DA_VARREDURA as readonly string[]).includes(String(e.acao))) continue;
      saida.push({ acao: e.acao as AcaoDaVarredura, thread: id, sessionId: typeof e.sessionId === 'string' ? e.sessionId : null,
        resultado: 'feita', detalhe: typeof e.detalhe === 'string' ? e.detalhe : '', em: e.ts, eventId: String(e.eventId ?? [id, e.ts].join('|')) });
    }
  }
  return saida.sort((a, b) => a.em.localeCompare(b.em));
}
