/**
 * Politica de OCUPACAO DE VAGA por estado real (correcao do escalonador, 09/2026).
 *
 * O incidente que este arquivo corrige: o escalonador contava "em andamento" pela
 * EXISTENCIA da thread aberta, e nao por haver um agente executando de fato. Threads
 * orfas presas ha dias em gates nao-finalizaveis seguravam as vagas de
 * `concurrency.max_parallel_threads` para sempre (em producao: em_andamento=0 e 15
 * threads em `concurrency.limite`, porque 3 orfas ocupavam as 3 vagas sem rodar nada).
 *
 * A regra que mora aqui, e SO aqui (domicilio unico, consumido por `board.ts` e
 * `orquestracao.ts`): uma thread tem PROCURA ATIVA quando a sessao do seu ultimo
 * despacho esta `working` no runtime, ou quando houve atividade recente no ledger de
 * uma thread ja despachada (fase em execucao entre eventos). Pausa humana aberta,
 * impedimento nao-transitorio aberto e stale (sem rodar ha mais que
 * `concurrency.stale_after_min`) NAO ocupam vaga: a vaga volta para quem esta pronto.
 *
 * Tudo e DERIVADO de `thread.json`, `ledger.jsonl` e da lista de sessoes do runtime:
 * avaliar ocupacao nao grava nada, e por isso e deterministico e seguro de rodar em
 * laco. O registro verificavel da devolucao de vaga e o `ork board reap`, que grava
 * `slot_released` no ledger da thread devolvida.
 */

import { TIPOS_DE_EVENTO } from './ledger';
import { EventoLedger, Fase, MotivoGate, Thread } from './types';
import { ehRegistroDeAdocao } from './sessoes-adopt';

/** Estado que o `ork phase run` grava quando o bloco despachado pausa ao fim. */
export const PAUSA_PREVISTA = 'prevista ao fim do bloco';

/**
 * Eventos que destravam uma reprovacao de gate.
 *
 * `phase_dispatch` entra pela porta da frente: o `ork phase run` grava `gate_blocked`
 * ANTES de despachar e aborta o despacho, entao um `phase_dispatch` posterior so existe
 * se aquele bloqueio deixou de valer.
 */
export const EVENTOS_QUE_DESTRAVAM: readonly string[] = [
  TIPOS_DE_EVENTO.gateLiberado,
  TIPOS_DE_EVENTO.faseDespachada,
  TIPOS_DE_EVENTO.leaseAdquirido,
  TIPOS_DE_EVENTO.rateLimitRetomado,
  TIPOS_DE_EVENTO.shipConcluido,
  TIPOS_DE_EVENTO.masterConcluido,
];

/** O evento e uma autorizacao humana ja registrada (resposta ao `ork gate request`)? */
export function ehAprovacaoHumana(e: EventoLedger): boolean {
  return e.tipo === TIPOS_DE_EVENTO.pausaHumana && e.estado === 'aprovado';
}

/** O evento e a pausa PREVISTA gravada no despacho do ultimo bloco? */
export function ehPausaPrevista(e: EventoLedger): boolean {
  return e.tipo === TIPOS_DE_EVENTO.pausaHumana && e.estado === PAUSA_PREVISTA;
}

/** Auto depende do bloco; demais modos conservam o fallback durável após avanço de fase. */
export function faseTemPausaPrevista(thread: Thread): boolean {
  return thread.modo !== 'auto' || thread.blocos.some(b => b.pausa && b.fases.includes(thread.faseAtual));
}

/** Como o `ork` classifica a thread para fins de vaga do escalonador. */
export type ClasseDeOcupacao =
  /** Sessao working ou fase em execucao: e isto que ocupa vaga. */
  | 'ativa'
  /** Pausa humana aberta (gate previsto, escalada ou sessao bloqueada em HITL). */
  | 'pausa-humana'
  /** Gate tipado reprovado sem evento que destrave (claims.failed, verify.failed...). */
  | 'impedida'
  /** Despachada, sem atividade ha mais que o stale timeout e sessao nao-working. */
  | 'stale'
  /** Pronta para rodar: nunca travou; recebe vaga por FIFO quando houver. */
  | 'ociosa';

export interface OpcoesDeOcupacao {
  /** Instante da avaliacao (os testes fixam; o CLI usa o relogio). */
  agora: string;
  /** Mapa sessionId -> state do runtime; null quando o runtime nao foi consultado. */
  estados: Map<string, string> | null;
  /** `concurrency.stale_after_min` do manifesto. */
  staleMin: number;
}

export interface OcupacaoDaThread {
  classe: ClasseDeOcupacao;
  /** A thread conta contra `concurrency.max_parallel_threads` agora? */
  ocupaVaga: boolean;
  /** Motivo tipado quando a thread nao ocupa nem esta pronta; null nas demais. */
  motivo: MotivoGate | 'vaga.stale' | null;
  detalhe: string;
  /** Evidencia verificavel: evento do ledger ou estado de sessao do runtime. */
  evidencia: string;
  /** Sessao do ultimo despacho, quando existe. */
  sessionId: string | null;
  /** State bruto da sessao no runtime; null quando nao consultado ou sem sessao. */
  sessaoEstado: string | null;
}

/** sessionId do ultimo despacho: o ledger primeiro, o `thread.json` como reserva. */
function ultimaSessao(thread: Thread, eventos: EventoLedger[]): string | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const s = eventos[i].sessionId;
    if (typeof s === 'string' && s !== '') return s;
  }
  const registrada = thread.sessoes[thread.sessoes.length - 1];
  return registrada && registrada.sessionId ? registrada.sessionId : null;
}

/**
 * Carimbo do ultimo sinal de vida: o evento mais novo do ledger que seja TRABALHO da
 * thread. `slot_released` fica de fora: e contabilidade do escalonador, e se contasse
 * como atividade a thread stale rejuvenesceria no exato momento em que e expulsa.
 */
function ultimaAtividadeEm(eventos: EventoLedger[]): string | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    if (eventos[i].tipo !== TIPOS_DE_EVENTO.vagaLiberada) return eventos[i].ts;
  }
  return null;
}

/** A thread tem pausa humana ABERTA? Mesmas tres fontes do monitor, resumidas. */
function pausaHumanaAberta(
  thread: Thread,
  eventos: EventoLedger[]
): { desdeEm: string; evidencia: string } | null {
  if (thread.status === 'pausada' && faseTemPausaPrevista(thread)) {
    return { desdeEm: thread.atualizadaEm, evidencia: 'thread.json (status: pausada)' };
  }
  const indiceDaFase = (fase: unknown): number =>
    typeof fase === 'string' ? thread.fases.indexOf(fase as Fase) : -1;
  for (let i = 0; i < eventos.length; i++) {
    const e = eventos[i];
    const prevista = ehPausaPrevista(e);
    const escalada = e.tipo === TIPOS_DE_EVENTO.gateBloqueado && e.motivo === 'human.pending';
    if (!prevista && !escalada) continue;
    const iFase = indiceDaFase(e.fase);
    // Na pausa prevista, redespachar a MESMA fase nao resolve pausa nenhuma: so o
    // avanco para fase posterior, a aprovacao humana ou o MASTER concluido resolvem.
    const resolvida = eventos.slice(i + 1).some((p) => {
      if (ehAprovacaoHumana(p)) return true;
      if (p.tipo === TIPOS_DE_EVENTO.masterConcluido) return true;
      if (escalada && EVENTOS_QUE_DESTRAVAM.includes(p.tipo)) return true;
      return (
        prevista && p.tipo === TIPOS_DE_EVENTO.faseDespachada && indiceDaFase(p.fase) > iFase
      );
    });
    if (resolvida) continue;
    return {
      desdeEm: e.ts,
      evidencia: prevista
        ? `ledger ${TIPOS_DE_EVENTO.pausaHumana} (${PAUSA_PREVISTA}) em ${e.ts}`
        : `ledger ${TIPOS_DE_EVENTO.gateBloqueado} (human.pending) em ${e.ts}`,
    };
  }
  return null;
}

/** Gate tipado reprovado sem destravamento: o impedimento nao-transitorio aberto. */
function impedimentoAberto(
  eventos: EventoLedger[]
): { motivo: MotivoGate; desdeEm: string; evidencia: string } | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.tipo !== TIPOS_DE_EVENTO.gateBloqueado && e.tipo !== 'phase_wait') continue;
    if (typeof e.motivo !== 'string') continue;
    const motivo = e.motivo as MotivoGate;
    // `human.pending` ja e pausa humana; `claims.unverifiable` avisa mas nao bloqueia.
    if (motivo === 'human.pending' || motivo === 'claims.unverifiable') continue;
    const resolvido = eventos
      .slice(i + 1)
      .some((p) => EVENTOS_QUE_DESTRAVAM.includes(p.tipo) || ehAprovacaoHumana(p));
    if (resolvido) continue;
    return {
      motivo,
      desdeEm: e.ts,
      evidencia: `ledger ${e.tipo} (${motivo}) em ${e.ts}`,
    };
  }
  return null;
}

/** Minutos inteiros entre dois carimbos ISO (nunca negativo). */
function minutos(desdeEm: string, ateEm: string): number {
  const inicio = Date.parse(desdeEm);
  const fim = Date.parse(ateEm);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 0;
  return Math.max(0, Math.floor((fim - inicio) / 60000));
}

/**
 * Avalia a PROCURA ATIVA de uma thread, na ordem que decide a vaga:
 *
 *   1. sessao `working` no runtime ocupa vaga, mesmo com pausa prevista no ledger --
 *      a pausa so chega quando a sessao terminar (licao do incidente de 05/09/2026);
 *   2. sessao `blocked` e pausa humana JA chegada (HITL no runtime): nao ocupa;
 *   3. pausa humana aberta nao ocupa: esperar humano nao e executar;
 *   4. impedimento nao-transitorio aberto nao ocupa;
 *   5. despachada e parada ha mais que `staleMin` vira `stale` e devolve a vaga;
 *   6. o resto esta `ociosa`: pronta (inclusive entre fases, com a sessao do bloco
 *      anterior terminada ou o runtime nao consultado), e entra por FIFO quando
 *      houver vaga -- e ai conta contra o limite, como sempre contou.
 */
export function avaliarOcupacao(
  thread: Thread,
  eventos: EventoLedger[],
  opcoes: OpcoesDeOcupacao
): OcupacaoDaThread {
  const sessionId = ultimaSessao(thread, eventos);
  const sessaoEstado =
    opcoes.estados === null || sessionId === null
      ? null
      : opcoes.estados.get(sessionId) ?? null;
  const base = { sessionId, sessaoEstado };

  if (thread.status === 'fechada') {
    return {
      ...base,
      classe: 'ociosa',
      ocupaVaga: false,
      motivo: null,
      detalhe: 'thread fechada nao disputa vaga',
      evidencia: 'thread.json (status: fechada)',
    };
  }

  const registro = ehRegistroDeAdocao(thread);
  if (!registro && (sessaoEstado === 'working' || (sessaoEstado === '' && sessionId !== null))) {
    return {
      ...base,
      classe: 'ativa',
      ocupaVaga: true,
      motivo: null,
      detalhe: `sessao ${String(sessionId).slice(0, 8)} trabalhando no runtime`,
      evidencia: `claude agents --json (sessao ${String(sessionId).slice(0, 8)} state=working)`,
    };
  }

  if (sessaoEstado === 'blocked') {
    return {
      ...base,
      classe: 'pausa-humana',
      ocupaVaga: false,
      motivo: 'human.pending',
      detalhe:
        `sessao ${String(sessionId).slice(0, 8)} BLOQUEADA no runtime esperando acao humana: ` +
        'esperar humano nao ocupa vaga da maquina',
      evidencia: `claude agents --json (sessao ${String(sessionId).slice(0, 8)} state=blocked)`,
    };
  }

  const pausa = pausaHumanaAberta(thread, eventos);
  if (pausa) {
    return {
      ...base,
      classe: 'pausa-humana',
      ocupaVaga: false,
      motivo: 'human.pending',
      detalhe:
        `pausa humana aberta ha ${minutos(pausa.desdeEm, opcoes.agora)} min: ` +
        'esperar veredito humano nao ocupa vaga da maquina',
      evidencia: pausa.evidencia,
    };
  }

  if (registro) return { ...base, classe: 'ociosa', ocupaVaga: false, motivo: null,
    detalhe: 'registro de adoção não disputa vaga de trabalho',
    evidencia: 'thread.json: origem de adoção, sem sessão despachada' };

  const impedimento = impedimentoAberto(eventos);
  if (impedimento) {
    return {
      ...base,
      classe: 'impedida',
      ocupaVaga: false,
      motivo: impedimento.motivo,
      detalhe:
        `gate ${impedimento.motivo} aberto ha ${minutos(impedimento.desdeEm, opcoes.agora)} min ` +
        'sem evento que destrave: impedimento nao-transitorio nao ocupa vaga',
      evidencia: impedimento.evidencia,
    };
  }

  const foiDespachada = sessionId !== null;
  const atividadeEm = ultimaAtividadeEm(eventos);
  if (foiDespachada && atividadeEm !== null) {
    const paradaHaMin = minutos(atividadeEm, opcoes.agora);
    if (paradaHaMin >= opcoes.staleMin) {
      return {
        ...base,
        classe: 'stale',
        ocupaVaga: false,
        motivo: 'vaga.stale',
        detalhe:
          `despachada e sem atividade ha ${paradaHaMin} min (limite ${opcoes.staleMin} min, ` +
          'concurrency.stale_after_min) com sessao nao-working: a vaga foi devolvida',
        evidencia:
          `ledger parado desde ${atividadeEm}` +
          (sessaoEstado !== null
            ? `; sessao ${String(sessionId).slice(0, 8)} state=${sessaoEstado}`
            : opcoes.estados !== null
              ? `; sessao ${String(sessionId).slice(0, 8)} fora da lista do runtime`
              : '; runtime nao consultado'),
      };
    }
    // Sessao nao-working (ou runtime nao consultado) com atividade recente: a thread
    // esta entre fases, pronta para o proximo despacho. Ela disputa vaga por FIFO,
    // nao por posse -- e continua contando contra o limite quando recebe a vaga.
  }

  return {
    ...base,
    classe: 'ociosa',
    ocupaVaga: false,
    motivo: null,
    detalhe: foiDespachada
      ? 'pronta para o proximo despacho: a sessao do bloco anterior terminou'
      : 'pronta para rodar: sem despacho ativo, sem pausa e sem impedimento',
    evidencia: !foiDespachada
      ? 'thread.json + ledger sem despacho em aberto'
      : opcoes.estados !== null
        ? `sessao ${String(sessionId).slice(0, 8)} nao-working na lista do runtime`
        : `sessao ${String(sessionId).slice(0, 8)} com runtime nao consultado`,
  };
}
