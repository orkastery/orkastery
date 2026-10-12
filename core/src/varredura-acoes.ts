/**
 * RM-063 (F5): a varredura que age.
 *
 * Incidente de 03 a 12/10/2026 (P4 e P5 da pagina da RM-063): o PR #112 (`ork-rm043sobrasd`) foi mesclado e ficou dois
 * dias sem `ork ship registrar-pr`, e as sessoes fantasmas de threads ja fechadas ficaram registradas, porque ninguem
 * roda esses comandos sem um condutor. Aqui moram as tres acoes de arrumacao que a batida (`pulse-delivery`) faz:
 *
 *  - `limpar`: a sessao fantasma (sem pid e sem processo, RM-056) ainda presa a uma thread deste projeto sai do ork pelo
 *    `ork sessions limpar-fantasmas`, que grava `sessao_morta` e nunca toca o runtime;
 *  - `registrar`: o merge `ship(<thread>)` da branch `ork/*` da thread na base remota, sem `ship_done`, vira entrega
 *    pelo `ork ship registrar-pr`, com a mesma prova de sempre (merge dentro da ponta remota e CI verde);
 *  - `master`: a thread entregue, sem nota do dono e quieta (nada despachado depois da entrega, ninguem conduzindo, 30
 *    min depois do `ship_done`) fecha pelo MASTER por omissao, so ela (`ork master <thread> --aceitar-omissao`).
 *
 * A deteccao (`acoesPendentes`) e leitura pura e alimenta a fila do pulse. A execucao (`agirNaVarredura`) so faz o que
 * a autorizacao duravel do dono permite (`autorizacao-duravel.ts`), e cada acao feita ou recusada vai ao ledger da
 * thread como `varredura_acao`, com a autorizacao que a permitiu. Sem autorizacao, nada e feito: cada acao vira um item
 * da fila do pulse com o comando pronto.
 */
import { autorizada, LeituraDaAutorizacao, lerAutorizacao, referenciaDaAutorizacao } from './autorizacao-duravel';
import { conducaoDaThread } from './conducao';
import { registrarEntregaPorPr } from './entrega-pr';
import { raizDoEstado } from './estado-thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { comLocale, textoDoCatalogo } from './locale';
import { ManifestoCarregado } from './manifest';
import { aceitarPendentesPorOmissao, motivoForaDaOmissao } from './master';
import { LIMIAR_PARADO_NO_CONDUTOR_MIN } from './parado-no-condutor';
import { FantasmaTratado, limparFantasmas } from './sessoes';
import { dirThread, lerThread, listarIds } from './thread';
import { EventoLedger, Thread } from './types';
import { exec } from './util';
import { branchDaWorktree } from './worktree';

export const ACOES_DA_VARREDURA = ['limpar', 'registrar', 'master'] as const;
export type AcaoDaVarredura = typeof ACOES_DA_VARREDURA[number];

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
  /** A ultima tentativa da varredura, autorizada, que nao fez; o dono ve o motivo. */
  recusa: { em: string; detalhe: string } | null;
}

export interface OpcoesDaDeteccao {
  quando?: string;
  /** As sessoes fantasmas que o `limpar` soltaria; `null` quando o runtime nao foi lido (nada se afirma). */
  fantasmas?: () => FantasmaTratado[] | null;
}

const SHA = /^[0-9a-f]{40}$/;
/** Os eventos de trabalho novo numa fase: o pedido de despacho e o despacho. */
const TRABALHO_NOVO: readonly string[] = [TIPOS_DE_EVENTO.promptGravado, TIPOS_DE_EVENTO.faseDespachada];

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

/**
 * Os merges `ship(<thread>)` da base remota (a copia local dela) numa leitura so, do mais novo ao mais velho: fica o mais
 * novo de cada thread, com o instante do commit. E a mesma busca do `ork ship registrar-pr` (`mergeDaEntrega`).
 */
function mergesDaBase(raiz: string, remoto: string, base: string): Map<string, { mergeSha: string; em: string | null }> {
  const mapa = new Map<string, { mergeSha: string; em: string | null }>();
  const r = exec('git', ['log', `refs/remotes/${remoto}/${base}`, '--first-parent', '--format=%H%x09%cI%x09%s', '--grep=^ship(', '--'],
    raiz, 60000);
  if (!r.ok) return mapa;
  for (const linha of r.stdout.split('\n')) {
    const [sha, em, assunto] = linha.split('\t');
    const m = /^ship\(([A-Za-z0-9._-]+)\)/.exec(assunto ?? '');
    if (!m || !sha || !SHA.test(sha) || mapa.has(m[1])) continue;
    const ms = Date.parse(em ?? '');
    mapa.set(m[1], { mergeSha: sha, em: Number.isFinite(ms) ? new Date(ms).toISOString() : null });
  }
  return mapa;
}

/** As sessoes fantasmas presas a threads deste projeto, uma acao por sessao. */
function pendentesDeLimpar(raiz: string, threads: Map<string, Thread>, fantasmas: FantasmaTratado[] | null): AcaoPendente[] {
  const saida: AcaoPendente[] = [];
  for (const f of fantasmas ?? []) {
    if (f.acao !== 'solto' || !f.thread || !threads.has(f.thread)) continue;
    const eventos = ledgerDe(raiz, f.thread);
    const ultimo = [...eventos].reverse().find((e) => e.sessionId === f.sessionId)?.ts ?? null;
    const id = f.sessionId.slice(0, 8);
    saida.push({ acao: 'limpar', thread: f.thread, fase: f.fase, sessionId: f.sessionId, desdeEm: ultimo,
      comando: 'ork sessions limpar-fantasmas', oQue: textoDoCatalogo((m) => m.pulse.varredura.oQue.limpar(id)),
      evidencia: `claude agents lista a sessão ${id} sem pid ou com pid sem processo${f.perfil ? ` (perfil ${f.perfil})` : ''}`,
      bloqueio: null, recusa: recusaDe(eventos, 'limpar', f.sessionId, ultimo) });
  }
  return saida;
}

/**
 * O merge `ship(<thread>)` da branch `ork/*` da thread na base remota (a copia local dela) sem `ship_done` que o cubra.
 * O `ship_done` antigo sem o sha, ou o que gravou a ponta da base que contem o merge, cobre (a mesma regra do pulse).
 */
function pendentesDeRegistrar(carregado: ManifestoCarregado, threads: Thread[], quando: string): AcaoPendente[] {
  const { raiz, manifesto } = carregado;
  const remoto = manifesto.fabrica.remoto, base = manifesto.worktree.base_branch;
  const saida: AcaoPendente[] = [];
  const abertas = threads.filter((t) => t.status !== 'fechada' && branchDaWorktree(t).startsWith('ork/'));
  const merges = abertas.length ? mergesDaBase(raiz, remoto, base) : new Map<string, { mergeSha: string; em: string | null }>();
  for (const t of abertas) {
    const merge = merges.get(t.id);
    if (!merge) continue;
    const eventos = ledgerDe(raiz, t.id);
    const ships = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
    const coberto = ships.some((e) => typeof e.mergeSha !== 'string' || !SHA.test(e.mergeSha) || e.mergeSha === merge.mergeSha ||
      exec('git', ['merge-base', '--is-ancestor', merge.mergeSha, e.mergeSha], raiz, 30000).code === 0);
    if (coberto) continue;
    const desde = merge.em;
    // Trabalho novo depois do merge (outra fatia despachada) ou alguem conduzindo: registrar agora avancaria a fase da
    // thread por baixo de quem trabalha nela. O dono decide.
    const depois = desde ? eventos.filter((e) => TRABALHO_NOVO.includes(e.tipo) && e.ts > desde) : [];
    const bloqueio = conduzida(raiz, t.id, quando) ? textoDoCatalogo((m) => m.pulse.varredura.bloqueios.conduzida)
      : depois.length ? textoDoCatalogo((m) => m.pulse.varredura.bloqueios.trabalhoNovo) : null;
    const curto = merge.mergeSha.slice(0, 7);
    saida.push({ acao: 'registrar', thread: t.id, fase: t.faseAtual, sessionId: null, desdeEm: desde,
      comando: `ork ship registrar-pr ${t.id}`,
      oQue: textoDoCatalogo((m) => m.pulse.varredura.oQue.registrar(curto, branchDaWorktree(t), `${remoto}/${base}`)),
      evidencia: `git log ${remoto}/${base}: merge ship(${t.id}) ${curto}, sem ship_done no ledger`,
      bloqueio, recusa: recusaDe(eventos, 'registrar', null, desde) });
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
function pendentesDeMaster(carregado: ManifestoCarregado, threads: Thread[], quando: string): AcaoPendente[] {
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
    // Quieta: nada pedido ou despachado depois da entrega, ninguem conduzindo, e o condutor teve 30 min para o MASTER dele.
    if (eventos.some((e) => TRABALHO_NOVO.includes(e.tipo) && e.ts > ship.ts)) continue;
    if (Date.parse(quando) - Date.parse(ship.ts) < LIMIAR_PARADO_NO_CONDUTOR_MIN * 60000) continue;
    const novo = produtoNovo(carregado, t);
    const bloqueio = conduzida(raiz, t.id, quando) ? textoDoCatalogo((m) => m.pulse.varredura.bloqueios.conduzida)
      : novo === true ? textoDoCatalogo((m) => m.pulse.varredura.bloqueios.branchComCommits)
      : novo === null ? textoDoCatalogo((m) => m.pulse.varredura.bloqueios.gitSemResposta) : null;
    saida.push({ acao: 'master', thread: t.id, fase: t.faseAtual, sessionId: null, desdeEm: ship.ts,
      comando: `ork master ${t.id} --aceitar-omissao`, oQue: textoDoCatalogo((m) => m.pulse.varredura.oQue.master),
      evidencia: 'ledger: ship_done sem despacho nem MASTER depois dele',
      bloqueio, recusa: recusaDe(eventos, 'master', null, ship.ts) });
  }
  return saida;
}

/**
 * As acoes que a varredura faria agora, sem fazer nenhuma. Leitura pura (o git da copia local, o ledger, o runtime pelo
 * `fantasmas`), na ordem em que a execucao as faz: `limpar`, `registrar`, `master`.
 */
export function acoesPendentes(carregado: ManifestoCarregado, opcoes: OpcoesDaDeteccao = {}): AcaoPendente[] {
  const raiz = raizDoEstado(carregado.raiz);
  const quando = opcoes.quando ?? new Date().toISOString();
  const doProjeto = { ...carregado, raiz };
  const threads = lerThreads(raiz);
  let fantasmas: FantasmaTratado[] | null = null;
  try { fantasmas = opcoes.fantasmas ? opcoes.fantasmas() : limparFantasmas(raiz, { dryRun: true }).itens; } catch { fantasmas = null; }
  return [
    ...pendentesDeLimpar(raiz, new Map(threads.map((t) => [t.id, t])), fantasmas),
    ...pendentesDeRegistrar(doProjeto, threads, quando),
    ...pendentesDeMaster(doProjeto, threads, quando),
  ];
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
 * ou recusada vai ao ledger da thread (`varredura_acao`), com quem autorizou e ate quando. Sem autorizacao valida, nada
 * e feito e tudo fica pendente para a fila do pulse.
 */
export function agirNaVarredura(carregado: ManifestoCarregado, opcoes: OpcoesDaVarreduraQueAge = {}): VarreduraQueAge {
  const raiz = raizDoEstado(carregado.raiz);
  const quando = opcoes.quando ?? new Date().toISOString();
  const leitura = opcoes.autorizacao ?? lerAutorizacao(raiz, { projeto: carregado.manifesto.project.name, agora: new Date(quando) });
  const busca = opcoes.buscar === false ? null : buscarBase(carregado);
  const pendentes = acoesPendentes(carregado, { quando, fantasmas: opcoes.fantasmas });
  const feitas: AcaoFeita[] = [];
  const ficam: AcaoPendente[] = [];
  const referencia = referenciaDaAutorizacao(leitura);
  const gravar = (p: AcaoPendente, resultado: AcaoFeita['resultado'], detalhe: string): void => {
    registrar(dirThread(raiz, p.thread), p.thread, TIPOS_DE_EVENTO.acaoDaVarredura, {
      fase: p.fase, acao: p.acao, resultado, detalhe: detalhe.slice(0, 400), comando: p.comando,
      ...(p.sessionId ? { sessionId: p.sessionId } : {}), origem: 'varredura', autorizacao: referencia,
      quemDecidiu: referencia ? `varredura do ork, pela autorização durável de ${String(referencia.por)} até ${String(referencia.ate)}` : null,
      evidencia: p.evidencia,
    });
    feitas.push({ acao: p.acao, thread: p.thread, sessionId: p.sessionId, resultado, detalhe });
  };
  // `limpar` e uma chamada so para todas as fantasmas: e o mesmo `ork sessions limpar-fantasmas`.
  const aLimpar = pendentes.filter((p) => p.acao === 'limpar' && !p.bloqueio && autorizada(leitura, 'limpar'));
  let soltas: Map<string, FantasmaTratado> | null = null;
  if (aLimpar.length) {
    try {
      const r = limparFantasmas(raiz, { origem: 'varredura' });
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
      else gravar(p, 'recusada', i ? `limpar-fantasmas respondeu ${i.acao}` : 'a sessão não apareceu como fantasma na execução');
      continue;
    }
    if (p.acao === 'registrar') {
      let r: ReturnType<typeof registrarEntregaPorPr>;
      try { r = registrarEntregaPorPr({ ...carregado, raiz }, p.thread, { buscar: false }); }
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
