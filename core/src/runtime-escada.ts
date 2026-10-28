/**
 * RM-063 (F4): a escada de recuperacao do runtime.
 *
 * Incidente de 12/10/2026 (P2 e P3 da pagina da RM-063): o despacho do GO da K7 morreu com o daemon do claude-bg
 * (`cc-daemon`) fora do ar, e o retry so sabia repetir o MESMO destino. A fabrica ficou parada 318 min ate o dono
 * perceber. Agora `runtime.unavailable` sobe uma escada, sempre com o MESMO prompt e o MESMO sha256:
 *
 *   1. reerguer o daemon do runtime: no claude-bg, o `claude daemon status` diz se o `control.sock` responde; daemon
 *      de pe com o socket mudo e derrubado (`claude daemon stop --any --keep-workers`, as sessoes destacadas ficam), e
 *      o proximo `claude --bg` sobe outro sob demanda. O prompt volta ao mesmo destino (runtime, perfil, modelo e
 *      esforco do despacho que falhou);
 *   2. o fallback do bloco (I-33): o primeiro alvo da ordem `--fallback` com destino disponivel;
 *   3. outro perfil do mesmo runtime (RM-056): outra conta, outro daemon.
 *
 * Cada degrau vai ao ledger da thread (`runtime_recuperacao`), feito, pulado ou falho, com o destino e a prova. A
 * escada vale por episodio: recomeca a cada pedido novo da fase (`ork phase run`, que grava `phase_prompt_recorded`
 * com origem `phase.run`). So depois dos tres degraus o dono e chamado, com tres alternativas e uma recomendada no
 * contrato curto da RM-048/RM-057 (`ork.hitl-curto/v1`), e o comando que retoma com o mesmo prompt.
 *
 * O `redespachar` e injetado por quem chama (o `ork retry run`): este modulo nao importa o retry, so o tipo.
 */
import { DAEMON_DO_CLAUDE, SondaDoDaemon } from './adapters/claude-bg';
import { registrarGateBloqueado } from './gates';
import { AlternativaCurta, montarPedidoCurto, PedidoCurto } from './hitl-curto';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { textoDoCatalogo } from './locale';
import { ManifestoCarregado } from './manifest';
import { MODOS } from './modos';
import {
  diretorioDoPerfil, diretorioEfetivo, lerPerfisComContas, perfilDeDespacho, PerfilDeDespacho, perfisDisponiveis, perfisDoRuntime, runtimeComPerfil,
  validarPerfilDeDespacho,
} from './runtime-profiles';
import { alvosDaOrdemDeFallback, configDoBloco, lerSetup } from './setup';
import { RUNTIMES_SEM_COTA_TIPADA } from './runtimes';
import { capacidadeDoRuntimeNoProjeto } from './runtime-context';
import { dirThread } from './thread';
import { EventoLedger, Fase, ModoLegado, Thread } from './types';
import type { ResultadoDoRedespacho } from './retry';

/** Os degraus, na ordem do pedido do dono de 12/10/2026. */
export const DEGRAUS_DA_ESCADA = ['reerguer-daemon', 'fallback-do-bloco', 'outro-perfil'] as const;
export type TipoDeDegrau = typeof DEGRAUS_DA_ESCADA[number];
export type NumeroDoDegrau = 1 | 2 | 3;
/**
 * `interrompido`: o redespacho parou por um motivo que nao e do destino (condução de outro, worktree, policy, prompt que
 * mudou, impedimento do dono). O degrau nao e consumido nem gasta tentativa: destravado, a escada o tenta de novo.
 */
export type ResultadoDoDegrau = 'redespachada' | 'falhou' | 'pulado' | 'interrompido';
/** Por que um degrau nao tinha para onde mandar o prompt. */
export type MotivoDoPulo = 'sem-fallback' | 'adaptador-ausente' | 'fallback-sem-destino' | 'sem-outro-perfil' | 'cota-sem-sinal-tipado';

export interface DestinoDoDegrau { runtime: string; perfil: string | null; model: string | null; effort: string | null }

export interface DegrauDaEscada {
  degrau: NumeroDoDegrau;
  tipo: TipoDeDegrau;
  resultado: ResultadoDoDegrau;
  em: string;
  destino: DestinoDoDegrau | null;
  /** O motivo tipado da falha do redespacho, ou o do pulo. */
  motivo: string | null;
  detalhe: string;
}

export interface EstadoDaEscada {
  /** O pedido novo da fase que abriu o episodio (ISO), ou `null` sem nenhum no ledger. */
  inicioEm: string | null;
  consumidos: DegrauDaEscada[];
  /** O proximo degrau a subir, ou `null` com os tres consumidos neste episodio. */
  proximo: NumeroDoDegrau | null;
}

/** O daemon do runtime, injetado nos testes. O padrao e o `claude daemon` da conta do despacho. */
export interface ControleDoDaemon {
  sondar: (perfil: PerfilDeDespacho | null) => SondaDoDaemon;
  derrubar: (perfil: PerfilDeDespacho | null) => { ok: boolean; detalhe: string };
}

const TIPOS_DO_PEDIDO_NOVO: readonly string[] = [TIPOS_DE_EVENTO.promptGravado, TIPOS_DE_EVENTO.faseDespachada,
  TIPOS_DE_EVENTO.despachoFalhou];

const doPedidoNovo = (e: EventoLedger, fase: Fase): boolean =>
  e.fase === fase && e.origem === 'phase.run' && TIPOS_DO_PEDIDO_NOVO.includes(e.tipo);

/**
 * O indice do pedido novo da fase que abre o episodio da escada: o ultimo pedido do `ork phase run` (o redespacho do
 * retry tem origem `retry.*` e continua o mesmo episodio), a partir do `phase_prompt_recorded` dele quando ha. `-1`
 * sem nenhum.
 */
export function inicioDoEpisodio(eventos: readonly EventoLedger[], fase: Fase): number {
  let ultimo = -1;
  for (let i = eventos.length - 1; i >= 0 && ultimo < 0; i--) if (doPedidoNovo(eventos[i], fase)) ultimo = i;
  if (ultimo < 0) return -1;
  const sha = eventos[ultimo].promptSha256;
  for (let i = ultimo; i >= 0; i--) {
    const e = eventos[i];
    if (!doPedidoNovo(e, fase)) continue;
    if (e.promptSha256 !== sha) break;
    if (e.tipo === TIPOS_DE_EVENTO.promptGravado) return i;
  }
  return ultimo;
}

/**
 * O destino do pedido novo que abriu o episodio: o runtime, o perfil, o modelo e o esforco com que o `ork phase run`
 * despachou ou tentou (o `phase_prompt_recorded` guarda o modelo e o esforco; a falha e o despacho, o perfil). E o
 * "mesmo destino" do degrau 1 e a conta que o degrau 3 troca. `null` sem pedido novo no ledger (despacho de antes da F3).
 */
export function destinoDoEpisodio(eventos: readonly EventoLedger[], fase: Fase):
  { runtime: string | null; perfil: PerfilDeDespacho | null; model: string | null; effort: string | null } | null {
  const inicio = inicioDoEpisodio(eventos, fase);
  if (inicio < 0) return null;
  const sha = eventos[inicio].promptSha256;
  const doPedido = eventos.slice(inicio).filter((e) => doPedidoNovo(e, fase) && e.promptSha256 === sha);
  const campo = (k: string): string | null =>
    doPedido.map((e) => e[k]).find((v): v is string => typeof v === 'string' && v !== '') ?? null;
  let perfil: PerfilDeDespacho | null = null;
  const bruto = doPedido.map((e) => e.perfil).find((v) => v !== undefined && v !== null);
  try { perfil = bruto ? validarPerfilDeDespacho(bruto) : null; } catch { perfil = null; }
  return { runtime: campo('runtime'), perfil, model: campo('model'), effort: campo('effort') };
}

function lerDegrau(e: EventoLedger): DegrauDaEscada | null {
  const n = Number(e.degrau);
  if (n !== 1 && n !== 2 && n !== 3) return null;
  const resultado = e.resultado === 'redespachada' || e.resultado === 'falhou' || e.resultado === 'pulado' ||
    e.resultado === 'interrompido' ? e.resultado : null;
  if (!resultado) return null;
  const para = e.para as Partial<DestinoDoDegrau> | null | undefined;
  return {
    degrau: n, tipo: DEGRAUS_DA_ESCADA[n - 1], resultado, em: e.ts,
    destino: para && typeof para.runtime === 'string' ? { runtime: para.runtime, perfil: typeof para.perfil === 'string' ? para.perfil : null,
      model: typeof para.model === 'string' ? para.model : null, effort: typeof para.effort === 'string' ? para.effort : null } : null,
    motivo: typeof e.motivoDoDegrau === 'string' ? e.motivoDoDegrau : null,
    detalhe: typeof e.detalhe === 'string' ? e.detalhe : '',
  };
}

/** Os degraus ja subidos neste episodio e o proximo. */
export function estadoDaEscada(eventos: readonly EventoLedger[], fase: Fase): EstadoDaEscada {
  const inicio = inicioDoEpisodio(eventos, fase);
  const consumidos: DegrauDaEscada[] = [];
  for (let i = inicio + 1; i < eventos.length; i++) {
    const e = eventos[i];
    if (e.tipo !== TIPOS_DE_EVENTO.recuperacaoDoRuntime || e.fase !== fase) continue;
    const d = lerDegrau(e);
    // O degrau interrompido (o motivo nao era do destino) fica para depois: nao e consumido.
    if (d && d.resultado !== 'interrompido') consumidos.push(d);
  }
  const feitos = new Set(consumidos.map((d) => d.degrau));
  const proximo = ([1, 2, 3] as const).find((n) => !feitos.has(n)) ?? null;
  return { inicioEm: inicio >= 0 ? eventos[inicio].ts : null, consumidos, proximo };
}

/** O despacho que a escada devolve ao runtime: o prompt e o destino de onde ele caiu. */
export interface DespachoDaEscada {
  promptPath: string;
  promptSha256: string;
  runtime: string;
  perfil: PerfilDeDespacho | null;
  model: string | null;
  effort: string | null;
}

/** O destino de um degrau, ou por que ele nao tem destino. */
export type PlanoDoDegrau = { destino: DestinoDoDegrau } | { pulo: MotivoDoPulo };

/**
 * O destino do degrau `n`. O 1 e o proprio destino que falhou. O 2 e o primeiro alvo da ordem de fallback do bloco
 * com destino agora: o perfil da vez do runtime dele, ou o ambiente do processo quando ele nao tem perfil. O 3 e
 * outra conta do runtime que falhou: um perfil disponivel, que nao seja o do despacho nem tenha o mesmo diretorio
 * dele, e que nao tenha sido tentado neste episodio.
 */
export function planoDoDegrau(carregado: ManifestoCarregado, thread: Thread, fase: Fase, n: NumeroDoDegrau,
  despacho: DespachoDaEscada, tentados: readonly DegrauDaEscada[], agoraMs = Date.now()): PlanoDoDegrau {
  const { raiz, manifesto } = carregado;
  const original: DestinoDoDegrau = { runtime: despacho.runtime, perfil: despacho.perfil?.id ?? null, model: despacho.model,
    effort: despacho.effort };
  if (n === 1) return { destino: original };
  const store = lerPerfisComContas(raiz, agoraMs);
  if (n === 2) {
    const doBloco = configDoBloco(lerSetup(raiz), thread.modo as ModoLegado, fase);
    const configurados = alvosDaOrdemDeFallback((doBloco as { fallback?: unknown } | null)?.fallback,
      doBloco?.runtime ?? manifesto.runtime.adapter).filter((f) => f.runtime !== despacho.runtime);
    if (configurados.length === 0) return { pulo: 'sem-fallback' };
    const ordem = configurados.filter((f) => capacidadeDoRuntimeNoProjeto(raiz, f.runtime).capaz);
    if (ordem.length === 0) return { pulo: 'adaptador-ausente' };
    for (const f of ordem) {
      const perfis = perfisDoRuntime(store, f.runtime);
      const effort = f.effort ?? despacho.effort;
      if (perfis.length === 0) return { destino: { runtime: f.runtime, perfil: null, model: f.model, effort } };
      const p = perfisDisponiveis(store, f.runtime, agoraMs)[0];
      if (p) return { destino: { runtime: f.runtime, perfil: p.id, model: f.model, effort } };
    }
    return { pulo: 'fallback-sem-destino' };
  }
  // RM-067 (F3, F4): o runtime sem cota esgotada tipada (o grok) fica fora do degrau "outra conta": a escada nunca troca a
  // conta dele, ate o formato da cota esgotada ser confirmado no ensaio real. Como alvo de fallback (degrau 2) ele vale no
  // projeto sem o MCP do ork e, desde a F4c (o servidor do ork fora do sandbox dele), tambem no preparado.
  if (RUNTIMES_SEM_COTA_TIPADA.includes(despacho.runtime)) return { pulo: 'cota-sem-sinal-tipado' };
  // Degrau 3: outra conta do runtime que falhou. O diretorio de cada conta e o que separa um daemon do outro. Os perfis
  // tentados sao os efetivos (o redespacho sem perfil pedido escolhe um, e e ele que falhou); o despacho que nasceu sem
  // perfil (o runtime caiu antes da escolha) tem como conta de origem a que o degrau 1 de fato usou.
  const jaTentados = new Set(tentados.flatMap((d) => d.destino?.runtime === despacho.runtime && d.destino.perfil ? [d.destino.perfil] : []));
  const doDegrau1 = tentados.find((d) => d.degrau === 1 && d.destino?.runtime === despacho.runtime)?.destino?.perfil ?? null;
  let contaDeOrigem: PerfilDeDespacho | null = despacho.perfil;
  if (!contaDeOrigem && doDegrau1) {
    const usado = perfisDoRuntime(store, despacho.runtime).find((x) => x.id === doDegrau1);
    if (usado) contaDeOrigem = perfilDeDespacho(usado);
  }
  let dirOriginal: string | null = null;
  if (runtimeComPerfil(despacho.runtime)) {
    try { dirOriginal = diretorioEfetivo(despacho.runtime, contaDeOrigem); } catch { dirOriginal = null; }
  }
  const outro = perfisDisponiveis(store, despacho.runtime, agoraMs).find((p) => {
    if (p.id === contaDeOrigem?.id || jaTentados.has(p.id)) return false;
    const d = perfilDeDespacho(p);
    return !dirOriginal || diretorioDoPerfil(d) !== dirOriginal;
  });
  return outro ? { destino: { ...original, perfil: outro.id } } : { pulo: 'sem-outro-perfil' };
}

/** O que o degrau 1 fez com o daemon do claude-bg, para o ledger. */
export interface DaemonNoDegrau {
  antes: SondaDoDaemon['estado'];
  acao: 'nenhuma' | 'derrubado' | 'derrubada-falhou';
  depois: SondaDoDaemon['estado'] | null;
  detalhe: string;
}

/**
 * Degrau 1 no claude-bg: o daemon de pe com o `control.sock` mudo e derrubado, para o proximo `claude --bg` subir
 * outro. Daemon parado (o `--bg` sobe um), que responde ou que nao se deixa ler fica como esta: sem prova, nada cai.
 */
export function reerguerDaemon(daemon: ControleDoDaemon, perfil: PerfilDeDespacho | null): DaemonNoDegrau {
  const antes = daemon.sondar(perfil);
  if (antes.estado !== 'nao-responde') return { antes: antes.estado, acao: 'nenhuma', depois: null, detalhe: antes.detalhe };
  const derrubada = daemon.derrubar(perfil);
  const depois = daemon.sondar(perfil);
  return { antes: antes.estado, acao: derrubada.ok ? 'derrubado' : 'derrubada-falhou', depois: depois.estado,
    detalhe: `${antes.detalhe}; stop: ${derrubada.detalhe}; depois: ${depois.detalhe}`.slice(0, 400) };
}

/**
 * As falhas do redespacho em que o degrau seguinte ainda vale: o destino nao recebeu o prompt agora (runtime fora,
 * conta sem cota ou login, modelo que a conta nao tem, janela de rate limit). O resto (impedimento do dono, policy,
 * worktree, conducao, prompt que mudou) para a escada: outro destino nao resolve.
 */
const FALHAS_DO_DESTINO: readonly string[] = ['runtime.unavailable', 'runtime.quota-exhausted', 'runtime.auth-missing',
  'runtime.model-unavailable', 'runtime.rate-limited'];

export function falhaDoDestino(motivo: string | null | undefined): boolean {
  return FALHAS_DO_DESTINO.includes(String(motivo ?? ''));
}

/** O que a escada devolve ao `ork retry run`. */
export interface SaidaDaEscada {
  /** Algum degrau abriu a sessao. */
  executada: boolean;
  redespacho: ResultadoDoRedespacho | null;
  detalhe: string;
  /** Os degraus desta chamada. */
  degraus: DegrauDaEscada[];
  /** A escada acabou sem sessao e o dono foi chamado. */
  escalada: boolean;
}

/** A prova de que ninguem trabalha na worktree: a de `sessaoVivaNaThread`, injetada pelo retry. */
export type ProvaDeVida = (ids: readonly string[]) => { respondeu: boolean; sessionId: string | null; detalhe: string | null };

export interface EntradaDaEscada {
  carregado: ManifestoCarregado;
  thread: Thread;
  fase: Fase;
  despacho: DespachoDaEscada;
  /** Tentativas ja contadas neste episodio, e o limite do manifesto. */
  tentativas: number;
  limite: number;
  dryRun?: boolean;
  daemon?: ControleDoDaemon;
  /** O degrau 1 ja reergueu o daemon antes da prova de vida (o runtime nao respondia): nao derruba de novo. */
  daemonJaReerguido?: DaemonNoDegrau | null;
  /** As sessoes que ja se sabe serem da thread (a do gate, a do despacho que falhou). */
  idsConhecidos?: readonly string[];
  /** A prova de vida entre um degrau e outro: com sessao viva, ou sem resposta do runtime, nada mais sai. */
  provaDeVida: ProvaDeVida;
  redespachar: (destino: DestinoDoDegrau) => ResultadoDoRedespacho;
  registrarTentativa: (ok: boolean, detalhe: string, extra?: Record<string, unknown>) => void;
  agoraMs?: number;
}

function rotuloDoDestino(d: DestinoDoDegrau | null): string {
  if (!d) return '-';
  return [d.runtime, d.perfil ? `perfil ${d.perfil}` : null, d.model, d.effort].filter(Boolean).join(' ');
}

const linhaCurta = (texto: string): string => texto.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

/** O redespacho que lanca vira falha do destino: o degrau fica no ledger, e a escada segue. */
function redespacharSemLancar(e: EntradaDaEscada, destino: DestinoDoDegrau): ResultadoDoRedespacho {
  try { return e.redespachar(destino); }
  catch (erro) {
    const detalhe = textoDoCatalogo((m) => m.retry.escada.lancou(linhaCurta((erro as Error).message ?? String(erro))));
    return { ok: false, slug: '', sessionId: null, verificada: false, motivo: 'runtime.unavailable', detalhe, sinal: null,
      comando: [], dryRun: false };
  }
}

/**
 * Sobe a escada a partir do proximo degrau do episodio, ate um degrau abrir a sessao, uma falha que nao e do destino
 * parar, a prova de vida achar sessao (ou o runtime nao responder), o limite de tentativas do manifesto ou o fim dos
 * degraus. No fim sem sessao, chama o dono (`escalarEscada`).
 */
export function subirAEscada(e: EntradaDaEscada): SaidaDaEscada {
  const { carregado, thread, fase, despacho } = e;
  const dir = dirThread(carregado.raiz, thread.id);
  const daemon = e.daemon ?? DAEMON_DO_CLAUDE;
  const estado = estadoDaEscada(lerLedger(dir), fase);
  const feitos: DegrauDaEscada[] = [];
  const tentados = [...estado.consumidos];
  const ids = [...(e.idsConhecidos ?? [])];
  let tentativas = e.tentativas;
  let ultimo: ResultadoDoRedespacho | null = null;
  const original: DestinoDoDegrau = { runtime: despacho.runtime, perfil: despacho.perfil?.id ?? null, model: despacho.model,
    effort: despacho.effort };
  for (const n of [1, 2, 3] as const) {
    if (tentados.some((d) => d.degrau === n)) continue;
    if (tentativas >= e.limite) break;
    const tipo = DEGRAUS_DA_ESCADA[n - 1];
    const plano = planoDoDegrau(carregado, thread, fase, n, despacho, tentados, e.agoraMs);
    if (e.dryRun) {
      const detalhe = 'pulo' in plano
        ? textoDoCatalogo((m) => m.retry.escada.ensaioPulado(n, m.retry.escada.degraus[tipo], m.retry.escada.pulos[plano.pulo]))
        : textoDoCatalogo((m) => m.retry.escada.ensaio(n, m.retry.escada.degraus[tipo], rotuloDoDestino(plano.destino)));
      if ('pulo' in plano) continue;
      const r = redespacharSemLancar(e, plano.destino);
      return { executada: false, redespacho: r, detalhe, degraus: [], escalada: false };
    }
    const base = { fase, motivo: 'runtime.unavailable', degrau: n, tipoDoDegrau: tipo, origem: 'retry.escada',
      promptSha256: despacho.promptSha256, modo: thread.modo, de: original,
      autorizadoPor: `politica de retry da RM-063 (F4), bloco sem pausa ou delegado no modo ${thread.modo}` };
    if ('pulo' in plano) {
      const detalhe = textoDoCatalogo((m) => m.retry.escada.pulos[plano.pulo]);
      const ev = registrar(dir, thread.id, TIPOS_DE_EVENTO.recuperacaoDoRuntime, { ...base, resultado: 'pulado', para: null,
        motivoDoDegrau: plano.pulo, detalhe });
      const d: DegrauDaEscada = { degrau: n, tipo, resultado: 'pulado', em: ev.ts, destino: null, motivo: plano.pulo, detalhe };
      feitos.push(d); tentados.push(d);
      continue;
    }
    // GO-FIX (achado 1 da revisao): o degrau anterior pode ter aberto a sessao e falhado depois (o `claude --bg` lento).
    // Antes de outro destino, a prova de que ninguem trabalha na worktree; sem ela, nada mais sai e o degrau fica.
    if (ultimo) {
      const viva = e.provaDeVida(ids);
      if (!viva.respondeu || viva.sessionId) {
        const sessao = viva.sessionId;
        const detalhe = sessao ? textoDoCatalogo((m) => m.retry.sessaoAindaViva(sessao.slice(0, 8), thread.id))
          : textoDoCatalogo((m) => m.retry.runtimeSemProva(viva.detalhe ?? '', thread.id));
        return { executada: false, redespacho: ultimo, detalhe, degraus: feitos, escalada: false };
      }
    }
    const noDaemon = n === 1 && despacho.runtime === 'claude-bg'
      ? (e.daemonJaReerguido ?? reerguerDaemon(daemon, despacho.perfil)) : null;
    const r = redespacharSemLancar(e, plano.destino);
    ultimo = r;
    if (r.sessionId) ids.push(r.sessionId);
    const resultado: ResultadoDoDegrau = r.ok ? 'redespachada' : falhaDoDestino(r.motivo) ? 'falhou' : 'interrompido';
    e.registrarTentativa(r.ok, r.detalhe, { degrau: n, tipoDoDegrau: tipo, tentativa: tentativas + 1,
      ...(r.ok ? {} : { motivoDoRedespacho: r.motivo }), ...(resultado === 'interrompido' ? { conta: false } : {}) });
    if (resultado !== 'interrompido') tentativas += 1;
    // O perfil efetivo: o redespacho sem perfil pedido escolhe um, e e ele que o degrau 3 nao repete.
    const efetivo: DestinoDoDegrau = { ...plano.destino, perfil: r.perfil?.id ?? plano.destino.perfil };
    const ev = registrar(dir, thread.id, TIPOS_DE_EVENTO.recuperacaoDoRuntime, { ...base, resultado, para: efetivo,
      ...(noDaemon ? { daemon: noDaemon } : {}), motivoDoDegrau: r.ok ? null : r.motivo, detalhe: r.detalhe,
      ...(r.sessionId ? { sessionId: r.sessionId } : {}) });
    const d: DegrauDaEscada = { degrau: n, tipo, resultado, em: ev.ts, destino: efetivo, motivo: r.ok ? null : r.motivo,
      detalhe: r.detalhe };
    feitos.push(d);
    if (resultado !== 'interrompido') tentados.push(d);
    if (r.ok) return { executada: true, redespacho: r, detalhe: r.detalhe, degraus: feitos, escalada: false };
    if (resultado === 'interrompido') return { executada: false, redespacho: r, detalhe: r.detalhe, degraus: feitos, escalada: false };
  }
  if (e.dryRun) {
    return { executada: false, redespacho: null, detalhe: textoDoCatalogo((m) => m.retry.escada.ensaioEsgotada), degraus: [],
      escalada: false };
  }
  const detalhe = escalarEscada(carregado, thread, fase, despacho, tentados, tentativas, e.limite);
  return { executada: false, redespacho: ultimo, detalhe, degraus: feitos, escalada: true };
}

/** "degrau 1 (reerguer o daemon do runtime): falhou (runtime.unavailable)", uma por degrau. */
export function resumoDosDegraus(degraus: readonly DegrauDaEscada[]): string {
  return [...degraus].sort((a, b) => a.degrau - b.degrau)
    .map((d) => textoDoCatalogo((m) => m.retry.escada.linhaDoDegrau(d.degrau, m.retry.escada.degraus[d.tipo],
      m.retry.escada.resultados[d.resultado], d.motivo)))
    .join('; ');
}

/** O comando que confere o runtime do despacho no terminal do dono. */
export function comandoDeConferir(runtime: string, perfil: PerfilDeDespacho | null): string {
  if (runtime === 'claude-bg') return perfil?.configDir ? `CLAUDE_CONFIG_DIR=${citar(perfil.configDir)} claude daemon status` : 'claude daemon status';
  if (runtime === 'codex') return perfil?.codexHome ? `CODEX_HOME=${citar(perfil.codexHome)} codex login status` : 'codex login status';
  return 'ork doctor';
}

/** Aspas simples do shell, com a aspa de dentro escapada. */
function citar(caminho: string): string {
  return `'${caminho.replace(/'/g, `'\\''`)}'`;
}

/**
 * O comando que devolve a fase ao runtime com o MESMO prompt: um pedido novo, e a escada recomeca. O caminho e o
 * absoluto do prompt gravado (o do ledger e relativo a quem despachou), entre aspas.
 */
export function comandoDeRetomar(thread: string, fase: Fase, promptPath: string): string {
  return `ork phase run ${thread} ${fase} --prompt "$(cat ${citar(promptPath)})"`;
}

/** A escada que acabou, como o `gate_blocked` a guarda e o pulse a mostra. */
export interface EscadaEsgotada {
  degraus: { degrau: NumeroDoDegrau; tipo: TipoDeDegrau; resultado: ResultadoDoDegrau; motivo: string | null }[];
  /** O comando que o dono roda para conferir o runtime. */
  conferir: string;
  /** O comando que retoma a fase com o mesmo prompt. */
  retomar: string;
  alternativas: AlternativaCurta[];
}

/** O bloco do modo que conduz a fase, para a alternativa de trocar o runtime. */
function numeroDoBloco(thread: Thread, fase: Fase): string {
  const i = MODOS[thread.modo as ModoLegado]?.blocos.findIndex((b) => (b.fases as readonly string[]).includes(fase)) ?? -1;
  return i >= 0 ? String(i + 1) : 'N';
}

/**
 * RM-057: as tres alternativas, uma recomendada, em linguagem simples. A recomendada e o despacho de novo com o mesmo
 * pedido depois de conferir o runtime: o dono nao reescreve nada.
 */
export function alternativasDaEscada(thread: Thread, fase: Fase, retomar: string): AlternativaCurta[] {
  const bloco = numeroDoBloco(thread, fase);
  return [
    { chave: 'a', texto: 'Conferir o runtime e despachar de novo com o mesmo pedido',
      consequencia: `\`${retomar}\` devolve ${fase} ao runtime com o mesmo prompt, e a escada recomeça`,
      recomendada: { porque: 'a fábrica não religou o runtime sozinha; o pedido volta igual, sem você reescrever nada' } },
    { chave: 'b', texto: 'Trocar o runtime do bloco',
      consequencia: `ork setup ${thread.modo} --bloco ${bloco} --runtime <outro> (ou --fallback), e depois o mesmo despacho` },
    { chave: 'c', texto: 'Deixar parada', consequencia: 'nada é despachado; a thread segue esperando você' },
  ];
}

/**
 * Chama o dono: o `gate_blocked human.pending` com a escada e as alternativas, e o `retry_escalated`. Tambem quem acha a
 * escada esgotada pelo plano (a sessao do ultimo degrau morreu depois) e quem desiste do runtime que nao responde chamam
 * por aqui, com o detalhe deles.
 */
export function escalarEscada(carregado: ManifestoCarregado, thread: Thread, fase: Fase, despacho: DespachoDaEscada,
  degraus: readonly DegrauDaEscada[], tentativas: number, limite: number, detalheProprio?: string): string {
  const dir = dirThread(carregado.raiz, thread.id);
  const resumo = resumoDosDegraus(degraus);
  const detalhe = detalheProprio ?? textoDoCatalogo((m) => m.retry.escada.esgotada(resumo || '-'));
  // O dono ja foi chamado pela escada nesta fase e nada foi despachado depois: o mesmo pedido nao e gravado de novo.
  const eventos = lerLedger(dir);
  const aberto = [...eventos].reverse().find((x) => x.tipo === TIPOS_DE_EVENTO.gateBloqueado && x.origem === 'retry.escada' && x.fase === fase);
  if (aberto && !eventos.slice(eventos.indexOf(aberto) + 1).some((x) => x.fase === fase &&
      (x.tipo === TIPOS_DE_EVENTO.faseDespachada || x.tipo === TIPOS_DE_EVENTO.promptGravado))) {
    return typeof aberto.detalhe === 'string' ? aberto.detalhe : detalhe;
  }
  const retomar = comandoDeRetomar(thread.id, fase, despacho.promptPath);
  const escada: EscadaEsgotada = {
    degraus: [...degraus].sort((a, b) => a.degrau - b.degrau).map((d) => ({ degrau: d.degrau, tipo: d.tipo, resultado: d.resultado,
      motivo: d.motivo })),
    conferir: comandoDeConferir(despacho.runtime, despacho.perfil), retomar,
    alternativas: alternativasDaEscada(thread, fase, retomar),
  };
  registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo: 'human.pending', modo: thread.modo as ModoLegado,
    detalhe, correcao: textoDoCatalogo((m) => m.retry.escada.correcao(escada.conferir, retomar)), fase, origem: 'retry.escada',
    promptPath: despacho.promptPath, promptSha256: despacho.promptSha256, escada, pausaQualquerModo: true,
    evidencia: 'runtime_recuperacao no ledger da thread: os degraus da escada deste episodio' });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.retryEscalado, { fase, motivo: 'runtime.unavailable', origem: 'retry.escada',
    acao: 'reexecutar', tentativas, limite, modo: thread.modo, razao: detalhe });
  return detalhe;
}

/** A escada gravada num `gate_blocked`, lida de volta com tipos; `null` quando o evento nao a traz. */
export function escadaDoEvento(e: { [campo: string]: unknown }): EscadaEsgotada | null {
  const x = e.escada as Partial<EscadaEsgotada> | undefined;
  if (!x || typeof x.conferir !== 'string' || typeof x.retomar !== 'string' || !Array.isArray(x.alternativas) ||
      !Array.isArray(x.degraus)) return null;
  const alternativas = x.alternativas.filter((a): a is AlternativaCurta => !!a && typeof a.chave === 'string' &&
    typeof a.texto === 'string' && typeof a.consequencia === 'string');
  if (alternativas.length < 3 || alternativas.length > 5 || alternativas.filter((a) => a.recomendada).length !== 1) return null;
  return { degraus: x.degraus as EscadaEsgotada['degraus'], conferir: x.conferir, retomar: x.retomar, alternativas };
}

/**
 * RM-057: o pedido da escada no contrato curto da RM-048 (`ork.hitl-curto/v1`): o que parou, os degraus que a
 * fabrica ja subiu e as tres alternativas. O dono responde no terminal, com o comando que retoma.
 */
export function pedidoCurtoDaEscada(d: { thread: string; fase: string | null; desdeEm: string | null;
  escada: Pick<EscadaEsgotada, 'conferir' | 'retomar' | 'alternativas'> & { degraus: readonly { degrau: number; resultado: string }[] } },
quando: string): PedidoCurto {
  const subidos = d.escada.degraus.map((x) => `${x.degrau} ${x.resultado}`).join(', ') || '-';
  return montarPedidoCurto({
    thread: d.thread, fase: d.fase, desde: d.desdeEm,
    pergunta: 'A fábrica não conseguiu religar o runtime sozinha: como seguimos?',
    corpo: [`Degraus: ${subidos} (o mesmo prompt em todos).`, `Conferir: ${d.escada.conferir}.`],
    alternativas: d.escada.alternativas,
  }, { quando, responder: { tipo: 'terminal', comando: d.escada.retomar } });
}
