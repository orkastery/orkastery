import { comLockHitl } from './hitl-gates';
import { consultarSessoes } from './adapters/claude-bg';
/**
 * Politica de retry TIPADA e retomada automatica (bloco B3).
 *
 * O B1 deu ao `ork` o MOTIVO tipado de cada reprovacao; o B2 deu a thread um estado
 * retomavel em disco. O B3 e a camada que liga os dois: para cada motivo tipado existe
 * UMA acao de retry deterministica, igual em todos os modos de conducao.
 *
 * Tres regras mandam aqui, e nenhuma delas e afrouxavel por modo:
 *
 *   1. **Custo nunca reexecuta.** `cost.violation` (despacho que seria redirecionado
 *      para provider pago) e o unico motivo sem retry automatico nenhum. Reexecutar
 *      violacao de custo e gastar de novo, e a politica `subscription-only` esta no manifesto.
 *   2. **O modo afrouxa a PAUSA, nunca a VERIFICACAO.** A politica e identica em
 *      `#Classic` e em `#Auto`. O que muda e a AUTORIZACAO: num bloco de loop que pausa,
 *      a acao espera a resposta humana ao `ork gate request`; num bloco sem pausa (`#Maestro`, `#Auto`) o
 *      `ork` executa sozinho e grava a decisao autonoma no ledger.
 *   3. **O limite de escalacao pausa QUALQUER modo.** Estouradas as tentativas do
 *      manifesto pelo MESMO motivo na MESMA fase, a acao vira `escalar-humano`,
 *      inclusive em `#Auto`. E a invariante de escalacao tipada da secao 3.5.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { abrirRodada, ResultadoDoReverify, reverificar } from './fix';
import { resolverRuntime } from './runtimes';
import { alvosDaOrdemDeFallback, AlvoDeFallback, configDoBloco, lerSetup, limitesDoBloco } from './setup';
import { registrarGateBloqueado } from './gates';
import { EventoLedger } from './types';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { raizDoEstado } from './estado-thread';
import { sessaoVivaNaThread } from './vida-da-thread';
import {
  ControleDoDaemon, DEGRAUS_DA_ESCADA, destinoDoEpisodio, escalarEscada, estadoDaEscada, inicioDoEpisodio, ProvaDeVida, reerguerDaemon,
  resumoDosDegraus, subirAEscada,
} from './runtime-escada';
import { DAEMON_DO_CLAUDE } from './adapters/claude-bg';
import { ManifestoCarregado } from './manifest';
import { hashDoPrompt, concluirDespacho, ContextoDeDespacho, EscolhaDePerfil, perfilParaDespacho, resolverDespacho, slugDaSessao,
  baselineDoDespachoNecessaria, estadoParaDespacho, garantirBaselineDoDespacho, modoDaSessaoDoBloco, prazoDaSessao } from './phase';
import { capacidadeDaRotacao, capacidadeDoRuntimeNoProjeto, ContextoRuntime, contextoDoProjeto, novaIdentidadeDeDespacho } from './runtime-context';
import { proximaRotacao } from './slug';
import { avaliarPolicies, bloqueantes, motivoDominante } from './policies';
import { aguardando, arcoDoPedido, enfileirar, exigirPedido, gravarPedido, janelaPadraoMs, lerFilaDeRetomada, marcarContaDaFalha,
  PedidoComPerfil, vencidos } from './ratelimit';
import { eventosDoIntervalo, fonteRegistrada, headDaWorktree, saidaDoArtefato } from './session-watcher-claude';
import { baseDoArtefato } from './session-watcher-grok';
import {
  lerPerfis, lerPerfisComContas, perfilDeDespacho, PerfilDeDespacho, perfilDoRegistro, perfisDisponiveis, perfisDoRuntime,
  PoliticaDeRotacao, politicaDeRotacao, prazoDaFila, prazoDoRuntime, proximoPerfilDisponivel,
  validarIdDePerfil, validarPerfilDeDespacho,
} from './runtime-profiles';
import { MODOS } from './modos';
import { blocoDaThread, dirThread, lerThread } from './thread';
import { gateDeTokens } from './tokens';
import {
  AcaoDeRetry,
  BloqueioDeRetry,
  Fase,
  ModoLegado,
  MotivoGate,
  PedidoDeRetomada,
  PlanoDeRetry,
  PlaybookDeRetomada,
  PoliticaDeRetry,
  ResultadoDaRetomada,
  RodadaDeFix,
  SinalDeFalhaDeConta,
  SinalDeRateLimit,
  Thread,
} from './types';
import { agora, exec, tabela } from './util';
import { ehImpedimentoDoDono, impedimentoResolvido, registrarImpedimentoDoDono } from './impedimento';
import { ResultadoSync, sincronizarWorktree } from './worktree';
import { avaliarDelegacao, conteudoDePremissas } from './delegation';
import { aprovacoesHumanas } from './gates';
import { formatarDataHora, legendaDoFuso, localizarTexto } from './horario';
import {
  ambienteDaConducao, canalDoProcesso, conducaoDaThread, ConducaoTomada, recusaDeConducao, registrarRecusa, tomarConducao,
} from './conducao';
import { linhaDeConducao } from './conducao-texto';
import { CanalDeConducao } from './types';
import { caminhoContidoOuNulo, cwdLocalOuNulo, diretorioDaThread, exigirCwdLocal } from './procedencia';
import { comandoDeConfirmacao, posturaAfrouxada, recusaDePostura } from './postura-local';
import { Mensagens, msg, remontar, textoDoCatalogo, textoDoErro } from './locale';
import { RETRY_PT_BR } from './locale-retry';
import { prepararPromptDeRetomada } from './retomada-checkpoint';

/** RM-061 (F2b, D3): `porque` e `correcao` de cada motivo tem a fonte no catalogo pt-BR; o `--json` nao muda. */
const TEXTOS_DA_POLITICA = RETRY_PT_BR.politica;

/**
 * Escada de esforco da 2a tentativa em diante.
 *
 * Subir esforco e de graca na assinatura; trocar de provider nao e. Por isso a escada
 * so anda dentro do runtime que ja esta configurado, e nunca vira "tenta no pago".
 */
export const ESCADA_DE_ESFORCO: readonly string[] = ['eco', 'low', 'medium', 'high', 'xhigh'];

/** O proximo degrau de esforco, ou o mesmo quando ja esta no topo (sem inventar degrau). */
export function proximoEsforco(atual: string): string {
  const i = ESCADA_DE_ESFORCO.indexOf(atual.trim().toLowerCase());
  if (i < 0) return atual;
  return ESCADA_DE_ESFORCO[Math.min(i + 1, ESCADA_DE_ESFORCO.length - 1)];
}

/**
 * A politica de retry, motivo tipado a motivo tipado.
 *
 * O mapa e TOTAL sobre `MotivoGate` de proposito: motivo novo no catalogo do gate nao
 * compila sem decidir aqui o que se faz com ele. Silencio nao e politica.
 */
export const POLITICA_DE_RETRY: Readonly<Record<MotivoGate, PoliticaDeRetry>> = {
  'artifact.missing': {
    motivo: 'artifact.missing',
    acao: 'corrigir-dirigido',
    automatica: true,
    ...TEXTOS_DA_POLITICA['artifact.missing'],
  },
  'claims.failed': {
    motivo: 'claims.failed',
    acao: 'corrigir-dirigido',
    automatica: true,
    ...TEXTOS_DA_POLITICA['claims.failed'],
  },
  'claims.unverifiable': {
    motivo: 'claims.unverifiable',
    acao: 'corrigir-dirigido',
    automatica: true,
    ...TEXTOS_DA_POLITICA['claims.unverifiable'],
  },
  'policy.violation': {
    motivo: 'policy.violation',
    acao: 'escalar-humano',
    automatica: false,
    ...TEXTOS_DA_POLITICA['policy.violation'],
  },
  'runtime.autoconferencia': {
    motivo: 'runtime.autoconferencia',
    // `escalar-humano` e nao `sem-retry`: `sem-retry` e o lugar reservado a violacao
    // de CUSTO, e o teste do bloco B3 guarda essa exclusividade de proposito. Aqui a
    // maquina nao esta proibida de agir, ela esta sem o que escolher sozinha: quem
    // decide em que runtime o CHECK roda e quem conduz a thread.
    acao: 'escalar-humano',
    automatica: false,
    ...TEXTOS_DA_POLITICA['runtime.autoconferencia'],
  },
  // RM-056 (D1): o perfil pedido nao existe ou e de outro runtime. Quem corrige e quem pediu.
  'runtime.profile-invalid': {
    motivo: 'runtime.profile-invalid',
    acao: 'escalar-humano',
    automatica: false,
    ...TEXTOS_DA_POLITICA['runtime.profile-invalid'],
  },
  'cost.violation': {
    motivo: 'cost.violation',
    acao: 'sem-retry',
    automatica: false,
    ...TEXTOS_DA_POLITICA['cost.violation'],
  },
  'verify.regression': {
    motivo: 'verify.regression',
    acao: 'corrigir-dirigido',
    automatica: true,
    ...TEXTOS_DA_POLITICA['verify.regression'],
  },
  'verify.failed': {
    motivo: 'verify.failed',
    acao: 'corrigir-dirigido',
    automatica: true,
    ...TEXTOS_DA_POLITICA['verify.failed'],
  },
  'verify.timeout': {
    motivo: 'verify.timeout',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['verify.timeout'],
  },
  'verify.sem-veredito': {
    motivo: 'verify.sem-veredito',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['verify.sem-veredito'],
  },
  'ci.failed': {
    motivo: 'ci.failed',
    acao: 'escalar-humano',
    automatica: false,
    ...TEXTOS_DA_POLITICA['ci.failed'],
  },
  'runtime.unavailable': {
    motivo: 'runtime.unavailable',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['runtime.unavailable'],
  },
  'runtime.silencio': {
    motivo: 'runtime.silencio', acao: 'reexecutar', automatica: true,
    ...TEXTOS_DA_POLITICA['runtime.silencio'],
  },
  'runtime.rate-limited': {
    motivo: 'runtime.rate-limited',
    acao: 'esperar-janela',
    automatica: true,
    ...TEXTOS_DA_POLITICA['runtime.rate-limited'],
  },
  // I-33 (D5, D11) + RM-064 T3: a falha e da CONTA. O perfil sai do rodizio e o pedido segue ao
  // proximo perfil ativo, depois ao fallback e por ultimo a fila. Interrupcao no meio da fase leva
  // checkpoint derivado do ledger/Git; o prompt original permanece gravado e referenciado.
  'runtime.quota-exhausted': {
    motivo: 'runtime.quota-exhausted',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['runtime.quota-exhausted'],
  },
  'runtime.auth-missing': {
    motivo: 'runtime.auth-missing',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['runtime.auth-missing'],
  },
  // RM-037 (defeitosdeco D-6): o modelo e que falta, nao a conta. Repetir o mesmo modelo na mesma conta
  // so repete a recusa; o perfil continua no rodizio para os outros modelos.
  'runtime.model-unavailable': {
    motivo: 'runtime.model-unavailable',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['runtime.model-unavailable'],
  },
  // RM-055: so o dono destrava, no terminal. O retry nao repete o despacho as cegas: confere antes se o
  // impedimento saiu (a confianca do diretorio tem prova local) e, sem prova, deixa o runtime decidir.
  'runtime.workspace-untrusted': {
    motivo: 'runtime.workspace-untrusted',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['runtime.workspace-untrusted'],
  },
  'runtime.consent-pending': {
    motivo: 'runtime.consent-pending',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['runtime.consent-pending'],
  },
  'tree.blocked': {
    motivo: 'tree.blocked',
    acao: 'sincronizar-worktree',
    automatica: true,
    ...TEXTOS_DA_POLITICA['tree.blocked'],
  },
  'lease.resume-unavailable': {
    motivo: 'lease.resume-unavailable',
    acao: 'escalar-humano',
    automatica: false,
    ...TEXTOS_DA_POLITICA['lease.resume-unavailable'],
  },
  'lease.busy': {
    motivo: 'lease.busy',
    acao: 'reexecutar',
    automatica: true,
    ...TEXTOS_DA_POLITICA['lease.busy'],
  },
  'concurrency.lease-indeterminado': {
    motivo: 'concurrency.lease-indeterminado',
    acao: 'esperar-janela',
    automatica: false,
    ...TEXTOS_DA_POLITICA['concurrency.lease-indeterminado'],
  },
  // I-36 (T6): a vez chega quando a conducao atual terminar. Redespachar agora so recebe a mesma recusa,
  // e passar na frente de quem conduz e exatamente o incidente de 19/09/2026.
  'conducao.em-andamento': {
    motivo: 'conducao.em-andamento',
    acao: 'esperar-janela',
    automatica: true,
    ...TEXTOS_DA_POLITICA['conducao.em-andamento'],
  },
  'conducao.acao-necessaria': {
    motivo: 'conducao.acao-necessaria',
    acao: 'esperar-janela',
    automatica: false,
    ...TEXTOS_DA_POLITICA['conducao.acao-necessaria'],
  },
  // I-41 (D10): formato e defeito de quem escreveu o pedido, e a spec dirigida conserta.
  // Escalar isto para o dono seria pedir que ele revise a sintaxe do robo.
  'hitl.formato': {
    motivo: 'hitl.formato',
    acao: 'corrigir-dirigido',
    automatica: true,
    ...TEXTOS_DA_POLITICA['hitl.formato'],
  },
  'human.pending': {
    motivo: 'human.pending',
    acao: 'escalar-humano',
    automatica: false,
    ...TEXTOS_DA_POLITICA['human.pending'],
  },
};

/** A politica de um motivo tipado. */
export function politicaDoMotivo(motivo: MotivoGate): PoliticaDeRetry {
  return POLITICA_DE_RETRY[motivo];
}

/** O motivo pode ser reexecutado automaticamente pelo `ork`? Custo nunca pode. */
export function podeReexecutar(motivo: MotivoGate): boolean {
  return POLITICA_DE_RETRY[motivo].acao !== 'sem-retry';
}

/** Tabela de `ork retry policy`. */
export function tabelaDaPolitica(): string {
  const m = msg().retry;
  const c = m.complementar;
  const linhas = Object.values(POLITICA_DE_RETRY).map((p) => [
    p.motivo,
    p.acao,
    p.automatica ? c.sim : c.nao,
    m.politica[p.motivo].porque,
  ]);
  return tabela([...c.colunasPolitica], linhas);
}

/** A fase a que um evento de gate reprovado se refere. */
function faseDoEvento(evento: EventoLedger, thread: Thread): Fase {
  const declarada = typeof evento.fase === 'string' ? (evento.fase as Fase) : null;
  if (declarada && thread.fases.includes(declarada)) return declarada;
  if (evento.gate === 'verify') return 'CHECK';
  if (evento.gate === 'ship') return 'SHIP';
  return thread.faseAtual;
}

/** O ultimo gate reprovado da thread, ou null quando nao ha reprovacao pendente. */
export function ultimaReprovacao(raiz: string, threadId: string): EventoLedger | null {
  const eventos = lerLedger(dirThread(raiz, threadId));
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.tipo === TIPOS_DE_EVENTO.gateBloqueado && typeof e.motivo === 'string') return e;
  }
  return null;
}

/**
 * Tentativas automaticas ja feitas pelo MESMO motivo na MESMA fase.
 *
 * Conta o que o `ork` REALMENTE executou (`retry_attempt` no ledger), nao o que ele
 * planejou: planejar nao gasta janela nem toca no repositorio.
 */
export function tentativasFeitas(raiz: string, threadId: string, fase: Fase, motivo: MotivoGate): number {
  const eventos = lerLedger(dirThread(raiz, threadId));
  // RM-063 (F4): a escada de `runtime.unavailable` vale por episodio, e as tentativas dela tambem: o pedido novo da fase
  // (`ork phase run`) recomeca a contagem.
  const desde = motivo === 'runtime.unavailable' ? inicioDoEpisodio(eventos, fase) : -1;
  // RM-055 (continuacao, D2): a recusa pelo impedimento do dono fica no ledger com `conta: false` e nao conta.
  return eventos.filter(
    (e, i) => i > desde && e.tipo === TIPOS_DE_EVENTO.retryTentado && e.fase === fase && e.motivo === motivo && e.conta !== false
  ).length;
}

/** O bloco de loop desta fase pausa para o humano neste modo? */
export function blocoPausa(thread: Thread, fase: Fase): boolean {
  return blocoDaThread(thread, fase).pausa;
}

export function estadoTerminalDeRetry(estado: string): boolean {
  return ['completed', 'failed', 'stopped', 'cancelled', 'interrupted', 'terminated'].includes(estado.trim().toLowerCase());
}

export interface OpcoesDePlano {
  /** Evidencia de consulta para o plano puro; execucao reconsulta e nao confia neste campo. */
  estadoDaSessao?: { sessionId: string; estado: string };
  /** Motivo forcado (usado quando o chamador ja sabe o que reprovou). */
  motivo?: MotivoGate;
  fase?: Fase;
  /** Autorizacao humana explicita: destrava acao nao automatica em modo que pausa. */
  autorizadoPor?: string;
}

/**
 * Calcula o plano de retry SEM executar nada.
 *
 * Separado da execucao de proposito: `ork retry plan` precisa poder responder "o que
 * voce faria agora e por que" sem gastar uma tentativa nem tocar no repositorio.
 */
export function planejarRetry(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesDePlano = {}
): PlanoDeRetry {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, threadId);
  const limite = manifesto.retry.max_tentativas;
  const effortBase = manifesto.runtime.effort;

  const evento = opcoes.motivo ? null : ultimaReprovacao(raiz, threadId);
  const motivo = opcoes.motivo ?? (evento && (evento.motivo as MotivoGate));
  if (!motivo) {
    return {
      thread: threadId,
      modo: thread.modo,
      fase: opcoes.fase ?? thread.faseAtual,
      motivo: null,
      detalhe: textoDoCatalogo((m) => m.retry.semReprovacao),
      politica: null,
      acao: 'sem-retry',
      tentativas: 0,
      limite,
      effort: effortBase,
      effortAnterior: effortBase,
      automatica: false,
      bloqueio: 'gate.sem-reprovacao',
      razao: textoDoCatalogo((m) => m.retry.nadaARepetir),
    };
  }

  const fase = opcoes.fase ?? (evento ? faseDoEvento(evento, thread) : thread.faseAtual);
  const politica = politicaDoMotivo(motivo);
  const tentativas = tentativasFeitas(raiz, threadId, fase, motivo);
  const detalhe = evento && typeof evento.detalhe === 'string' ? evento.detalhe : '';

  // Custo primeiro: nenhuma tentativa, nenhum degrau de esforco, nenhum modo. Nunca.
  if (politica.acao === 'sem-retry') {
    return {
      thread: threadId,
      modo: thread.modo,
      fase,
      motivo,
      detalhe,
      politica,
      acao: 'sem-retry',
      tentativas,
      limite,
      effort: effortBase,
      effortAnterior: effortBase,
      automatica: false,
      bloqueio: 'politica.nao-automatica',
      razao: textoDoCatalogo((m) => m.retry.politica[motivo].porque),
    };
  }

  // RM-063 (F4): a escada de `runtime.unavailable` diz o proximo degrau do episodio; sem degrau, o dono e chamado.
  const escada = motivo === 'runtime.unavailable' ? estadoDaEscada(lerLedger(dirThread(raiz, threadId)), fase) : null;
  const naEscada = escada ? { degrau: escada.proximo, tipo: escada.proximo ? DEGRAUS_DA_ESCADA[escada.proximo - 1] : null,
    consumidos: escada.consumidos.map((d) => ({ degrau: d.degrau, tipo: d.tipo, resultado: d.resultado, em: d.em })) } : null;
  if (escada && escada.proximo === null) {
    return {
      thread: threadId, modo: thread.modo, fase, motivo, detalhe, politica, acao: 'escalar-humano', tentativas, limite,
      effort: effortBase, effortAnterior: effortBase, automatica: false, bloqueio: 'escalacao.limite',
      razao: textoDoCatalogo((m) => m.retry.escada.esgotada(resumoDosDegraus(escada.consumidos))), escada: naEscada!,
    };
  }

  // Limite de escalacao: pausa QUALQUER modo, inclusive #Auto.
  if (tentativas >= limite) {
    return {
      thread: threadId,
      modo: thread.modo,
      fase,
      motivo,
      detalhe,
      politica,
      acao: 'escalar-humano',
      tentativas,
      limite,
      effort: effortBase,
      effortAnterior: effortBase,
      automatica: false,
      bloqueio: 'escalacao.limite',
      razao: textoDoCatalogo((m) => m.retry.limiteDeEscalacao(tentativas, motivo, fase, limite)),
    };
  }

  // Da 2a tentativa em diante o esforco sobe um degrau, quando o manifesto permite.
  // `tentativas` e quantas JA rodaram, entao a 1a tentativa (tentativas 0) sai no
  // esforco base do manifesto e so a partir da 2a a escada anda.
  // RM-063 (F4): runtime fora nao e prompt fraco. A escada de `runtime.unavailable` troca o destino, nunca o esforco.
  const escala = manifesto.retry.escalar_esforco && tentativas >= 1 && !escada;
  const effortAnterior = escalarEsforco(effortBase, Math.max(0, tentativas - 1));
  const effort = escala ? escalarEsforco(effortBase, tentativas) : effortBase;
  const acao: AcaoDeRetry = escala ? 'escalar-esforco' : politica.acao;

  const pausa = blocoPausa(thread, fase);
  const delegacao = avaliarDelegacao(manifesto, { thread: threadId, modo: thread.modo, fase,
    escopo: 'premissas', conteudo: detalhe + '\n' + conteudoDePremissas(raiz, threadId) });
  const autorizado = delegacao.permitida || aprovacoesHumanas(raiz, threadId).some(e => e.fase === fase && e.autorizadoPor === opcoes.autorizadoPor);
  let bloqueio: BloqueioDeRetry | null = null;
  let automatica = politica.automatica;
  let razao = textoDoCatalogo((m) => m.retry.politica[motivo].porque);
  // RM-063 (F4): o plano de `runtime.unavailable` diz o degrau da escada que a execucao sobe.
  const degrau = escada?.proximo ?? null;
  if (degrau) razao = textoDoCatalogo((m) => m.retry.escada.proximo(degrau, m.retry.escada.degraus[DEGRAUS_DA_ESCADA[degrau - 1]]));
  if (delegacao.permitida && politica.automatica) {
    razao = textoDoCatalogo((m) => m.retry.comDelegacao(m.retry.politica[motivo].porque, delegacao.razao, String(delegacao.delegado),
      String(delegacao.evidencia)));
  }

  if (!politica.automatica) {
    automatica = false;
    bloqueio = 'politica.nao-automatica';
  } else if (pausa && !autorizado) {
    // O bloco de loop deste modo pausa: o humano ja e parte do caminho aqui, e por isso
    // a acao fica planejada e nao executada. `#Maestro` e `#Auto` nao caem neste ramo.
    automatica = false;
    bloqueio = 'modo.bloco-pausa';
    const bloco = blocoDaThread(thread, fase);
    razao = textoDoCatalogo((m) => m.retry.blocoPausa(bloco.fases.join('-'), m.thread.pausaSobre(bloco.pausaSobre), acao));
  }

  if (motivo === 'runtime.silencio') {
    const despacho = ultimoDespachoFalho(raiz, threadId, fase, true);
    const prova = opcoes.estadoDaSessao;
    if (!prova || prova.sessionId !== despacho?.sessionId || !estadoTerminalDeRetry(prova.estado)) {
      automatica = false;
      bloqueio = 'politica.nao-automatica';
      razao = textoDoCatalogo((m) => m.retry.silencioSemProva);
    }
  }
  return {
    thread: threadId, modo: thread.modo, fase, motivo, detalhe, politica, acao, tentativas,
    limite, effort, effortAnterior, automatica, bloqueio, razao, ...(naEscada ? { escada: naEscada } : {}),
  };
}

/** O esforco depois de `n` escaladas a partir do esforco base do manifesto. */
export function escalarEsforco(base: string, degraus: number): string {
  let atual = base;
  for (let i = 0; i < degraus; i++) atual = proximoEsforco(atual);
  return atual;
}

export interface ResultadoDoRedespacho {
  controlador?: string;
  ok: boolean;
  slug: string;
  sessionId: string | null;
  verificada: boolean;
  motivo: MotivoGate | null;
  /**
   * RM-037 (defeito 1): o redespacho parou antes da sessao porque falta a baseline do bloco com GO no codex, e
   * reteve a conducao tomada. Interno: `redespachar` grava a baseline com ela e repete; se ainda faltar, sai
   * como `runtime.unavailable`.
   */
  retida?: ConducaoTomada;
  detalhe: string;
  /** Sinal de rate limit quando o redespacho morreu pelo mesmo motivo de novo. */
  sinal: SinalDeRateLimit | null;
  /** I-33: a conta recusou o redespacho (cota ou auth). */
  falhaDeConta?: SinalDeFalhaDeConta | null;
  /** I-33: perfil usado (ou tentado) no redespacho. */
  perfil?: PerfilDeDespacho | null;
  comando: string[];
  dryRun: boolean;
}

export interface OpcoesDeRedespacho {
  runtime?: string | null;
  /** I-33: perfil explicito do store; sem ele, o primeiro disponivel do runtime (com login conferido). */
  perfil?: string | null;
  /** Pedido original do dono; alvos calculados pelo rodizio nao preenchem este campo. */
  perfilPedido?: { id: string; runtime: string };
  slug?: string;
  model?: string | null;
  effort?: string | null;
  cwd?: string;
  origem?: string;
  dryRun?: boolean;
  /** I-36 (D6): canal de quem pede a retomada; sem ele, o que a borda declarou. */
  canal?: CanalDeConducao;
  /** RM-064 T3: usa um derivado com ponto de parada, preservando caminho/hash do prompt original. */
  checkpoint?: boolean;
}

/**
 * Redespacha um prompt JA GRAVADO, byte a byte.
 *
 * As duas guardas que fazem disto uma retomada, e nao um despacho novo:
 *   - o arquivo precisa existir e o sha256 precisa bater com o registrado. Prompt
 *     alterado entre a morte e a retomada e outro pedido, e por isso recusa;
 *   - as MESMAS policies do `phase.dispatch` sao reavaliadas contra o texto lido. E
 *     assim que a regra de custo alcanca a retomada: se o ambiente ganhou uma variavel
 *     de provider pago enquanto a fase esperava, a retomada recusa em vez de gastar.
 */
export function redespachar(carregado: ManifestoCarregado, thread: Thread, fase: Fase,
  promptRelativo: string, sha: string, opcoes: OpcoesDeRedespacho = {}): ResultadoDoRedespacho {
  const run = (retida?: ConducaoTomada) =>
    redespacharSobLock(carregado, lerThread(carregado.raiz, thread.id), fase, promptRelativo, sha, opcoes, retida);
  if (opcoes.dryRun) return run();
  // RM-037 (defeito 1; A2, G1 e N3 do CHECK 1 e 2, B-1 e A-1r do CHECK 4): o fallback do bloco leva a
  // retomada ao codex. O redespacho pede a baseline depois das guardas baratas, RETENDO a conducao tomada; ela
  // e gravada aqui, fora do lock HITL, como reentrada dessa tomada, e a retomada repete uma vez com ela.
  const r = comLockHitl(carregado.raiz, thread.id, () => run());
  const retida = r.retida;
  if (!retida) return r;
  delete r.retida;
  try {
    garantirBaselineDoDespacho(carregado, thread.id, { fase, prompt: '', runtime: opcoes.runtime ?? undefined,
      model: opcoes.model ?? undefined, effort: opcoes.effort ?? undefined, ...(opcoes.canal ? { canal: opcoes.canal } : {}) },
      retida.identidade);
    return comLockHitl(carregado.raiz, thread.id, () => run(retida));
  } finally { retida.devolver(); }
}

/**
 * RM-063 (F3): onde esta o prompt gravado. O ledger guarda o caminho relativo a raiz de codigo de quem despachou:
 * da worktree, ele sai `../../../.orkastery/threads/...` (a K7 de 12/10/2026), e lido do checkout principal aponta
 * para fora do projeto. O arquivo certo e o que tem o MESMO sha256: absoluto, relativo a raiz de codigo, a raiz do
 * estado ou a pasta de prompts da thread. Sem nenhum com o sha, vale o primeiro que existe (a recusa diz que o prompt
 * mudou); sem nenhum arquivo comum dentro do projeto, `null` (a recusa diz que sumiu).
 */
export function localizarPromptGravado(raiz: string, threadId: string, promptPath: string, sha: string): string | null {
  const candidatos = path.isAbsolute(promptPath) ? [promptPath] : [path.join(raiz, promptPath)];
  try { candidatos.push(path.join(raizDoEstado(raiz), promptPath)); } catch { /* raiz sem estado legivel */ }
  candidatos.push(path.join(dirThread(raiz, threadId), 'prompts', path.basename(promptPath)));
  let thread: { id: string; worktree: string | null } | null = null;
  try { const t = lerThread(raiz, threadId); thread = { id: t.id, worktree: t.worktree }; } catch { thread = null; }
  // O ponteiro vem do estado: so arquivo comum, de tamanho de prompt, dentro do projeto ou da worktree da thread (RM-047).
  const legivel = (c: string): boolean => {
    try {
      const st = fs.lstatSync(c);
      return st.isFile() && st.size <= TETO_DO_PROMPT_GRAVADO && caminhoContidoOuNulo(raiz, thread, c) !== null;
    } catch { return false; }
  };
  const existentes = [...new Set(candidatos.map((c) => path.resolve(c)))].filter(legivel);
  for (const c of existentes) {
    try { if (hashDoPrompt(fs.readFileSync(c, 'utf8')) === sha) return c; } catch { /* ilegivel: tenta o proximo */ }
  }
  return existentes[0] ?? null;
}

/** Um prompt de fase tem dezenas de KB; acima disto o ponteiro do estado nao e um prompt gravado pelo ork. */
export const TETO_DO_PROMPT_GRAVADO = 4 * 1024 * 1024;

/**
 * RM-063 (F3): o despacho cujo prompt o `reexecutar` devolve ao runtime. Primeiro o despacho da sessao do gate (a
 * sessao que morreu depois de despachada, como a K7 de 12/10/2026, nao deixa `phase_dispatch_failed`), depois o
 * proprio gate quando ele carrega o prompt, e por fim a tentativa mais recente da fase com prompt gravado:
 * `phase_dispatch_failed` ou `phase_prompt_recorded` (e o `phase_dispatch`, no silencio do runtime).
 */
export function despachoParaRedespachar(eventos: readonly EventoLedger[], fase: Fase, gate: EventoLedger | null,
  silencio = false): EventoLedger | null {
  const comPrompt = (e: EventoLedger | undefined | null): e is EventoLedger =>
    !!e && typeof e.promptPath === 'string' && typeof e.promptSha256 === 'string';
  if (gate && typeof gate.sessionId === 'string') {
    const daSessao = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada && e.sessionId === gate.sessionId).at(-1);
    if (comPrompt(daSessao)) return daSessao;
  }
  if (comPrompt(gate)) return gate;
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.fase !== fase || !comPrompt(e)) continue;
    if (e.tipo === TIPOS_DE_EVENTO.despachoFalhou || e.tipo === TIPOS_DE_EVENTO.promptGravado ||
        (silencio && e.tipo === TIPOS_DE_EVENTO.faseDespachada)) return e;
  }
  return null;
}

function redespacharSobLock(
  carregado: ManifestoCarregado,
  thread: Thread,
  fase: Fase,
  promptRelativo: string,
  sha: string,
  opcoes: OpcoesDeRedespacho = {},
  /** A tomada que a primeira passada reteve para a baseline; com ela, esta e a repeticao. */
  tomadaPrevia?: ConducaoTomada
): ResultadoDoRedespacho {
  const { raiz, manifesto } = carregado;
  const achado = localizarPromptGravado(raiz, thread.id, promptRelativo, sha);
  const absoluto = achado ?? '';
  const slug = opcoes.slug ?? slugDaSessao(thread, fase);
  const vazio = { slug, sessionId: null, verificada: false, sinal: null, comando: [] as string[] };
  const erroDeEstado = estadoParaDespacho(raiz, thread, opcoes.dryRun);
  if (erroDeEstado) return { ...vazio, ok: false, motivo: 'tree.blocked', detalhe: erroDeEstado, dryRun: opcoes.dryRun === true };

  if (!achado) {
    return {
      ...vazio,
      ok: false,
      motivo: 'artifact.missing',
      detalhe: textoDoCatalogo((m) => m.retry.promptSumiu(promptRelativo)),
      dryRun: opcoes.dryRun === true,
    };
  }
  const promptOriginal = fs.readFileSync(absoluto, 'utf8');
  const shaAtual = hashDoPrompt(promptOriginal);
  if (shaAtual !== sha) {
    return {
      ...vazio,
      ok: false,
      motivo: 'artifact.missing',
      detalhe: textoDoCatalogo((m) => m.retry.promptMudou(promptRelativo, shaAtual.slice(0, 12), sha.slice(0, 12))),
      dryRun: opcoes.dryRun === true,
    };
  }

  const retomada = opcoes.checkpoint ? prepararPromptDeRetomada(raiz, thread, fase,
    { prompt: promptOriginal, promptPath: absoluto, promptSha256: sha }, !opcoes.dryRun) : null;
  const prompt = retomada?.prompt ?? promptOriginal;
  const promptExecutadoPath = retomada?.promptPath ?? absoluto;
  const promptExecutadoSha = retomada?.promptSha256 ?? sha;

  const violacoes = bloqueantes(avaliarPolicies(manifesto, { gate: 'phase.dispatch', prompt }));
  if (violacoes.length > 0) {
    const motivo = motivoDominante(violacoes);
    const detalhe = violacoes.map((v) => `${v.policy}: ${v.detalhe}`).join('; ');
    registrarGateBloqueado(dirThread(raiz, thread.id), thread.id, {
      gate: 'phase.dispatch',
      motivo,
      modo: thread.modo,
      detalhe,
      correcao: violacoes.map((v) => v.correcao).join('; '),
      fase,
      slug,
      origem: opcoes.origem ?? 'retry',
      evidencia: `prompt sha256 ${promptExecutadoSha} (origem ${sha}; retomada recusada antes de despachar)`,
      ...(opcoes.perfilPedido ? { perfilPedido: opcoes.perfilPedido } : {}),
    });
    return { ...vazio, ok: false, motivo, detalhe, dryRun: opcoes.dryRun === true };
  }

  // I-36 (T6): validado o pedido, a retomada toma a conducao antes de redespachar, como o
  // `ork phase run`. A mesma fase com o mesmo prompt de quem ja conduz nao abre sessao nova;
  // outro pedido espera a vez.
  const identidade = tomadaPrevia ? { ...novaIdentidadeDeDespacho(thread.id, fase), dispatchId: tomadaPrevia.identidade }
    : novaIdentidadeDeDespacho(thread.id, fase);
  const canal = opcoes.canal ?? canalDoProcesso();
  const doBlocoDaConducao = limitesDoBloco(manifesto, lerSetup(raiz), thread.modo, fase);
  const pedidoDeConducao = { canal, correlacao: null, operacao: 'retry.run' as const, fase, promptSha256: promptExecutadoSha,
    identidade: identidade.dispatchId, prazoMs: prazoDaSessao(doBlocoDaConducao) };
  let conducao: ConducaoTomada | null = null;
  if (tomadaPrevia) {
    // R5-B1 do CHECK 5: a sucedida que o dono respondeu durante a baseline recebe o lease de volta.
    if (!tomadaPrevia.sucessaoAindaVale()) {
      tomadaPrevia.devolver();
      const recusa = recusaDeConducao(thread.id, conducaoDaThread(raiz, thread.id), pedidoDeConducao);
      registrarRecusa(raiz, recusa);
      return { ...vazio, ok: false, motivo: 'conducao.em-andamento', detalhe: recusa.texto, dryRun: false };
    }
    conducao = tomadaPrevia;
  } else if (!opcoes.dryRun) {
    const tomada = tomarConducao(raiz, thread.id, pedidoDeConducao);
    if (!tomada.ok) {
      if (tomada.idempotente && tomada.atual) {
        registrar(dirThread(raiz, thread.id), thread.id, TIPOS_DE_EVENTO.despachoIdempotente, { fase, promptSha256: promptExecutadoSha, canal,
          sessionId: tomada.atual.sessao, origem: opcoes.origem ?? 'retry',
          razao: 'mesma fase e mesmo prompt de quem ja conduz: a sessao em andamento atende a retomada, sem sessao nova' });
        const sessao = String(tomada.atual.sessao).slice(0, 8);
        return { ...vazio, ok: true, sessionId: tomada.atual.sessao, motivo: null, dryRun: false,
          detalhe: textoDoCatalogo((m) => m.retry.jaConduz(sessao, fase)) };
      }
      const recusa = recusaDeConducao(thread.id, tomada.atual, pedidoDeConducao);
      registrarRecusa(raiz, recusa);
      return { ...vazio, ok: false, motivo: 'conducao.em-andamento', detalhe: recusa.texto, dryRun: false };
    }
    conducao = tomada;
  }
  try {
    // RM-047 (P2): o cwd do pedido da fila ou da worktree da thread so vale como worktree registrada no git.
    let cwd: string;
    try { cwd = opcoes.cwd !== undefined ? exigirCwdLocal(raiz, thread.id, opcoes.cwd, 'fila') : diretorioDaThread(raiz, thread); }
    // RM-061 (F3b, GO-FIX 1): o erro do catalogo fica registrado, e a impressao o remonta.
    catch (e) { return { ...vazio, ok: false, motivo: 'tree.blocked', detalhe: textoDoErro(e), dryRun: opcoes.dryRun === true }; }
    // Mesma resolucao do `ork phase run`: a retomada carimba no ledger o trio que ela de
    // fato despachou, inclusive quando o pedido da fila trazia um modelo proprio. O setup
    // do bloco (feature #setup) vale aqui tambem: a fase retomada abre no MESMO runtime
    // que a fase original abriria.
    const doBloco = configDoBloco(lerSetup(raiz), thread.modo, fase);
    const { runtime, model, effort } = resolverDespacho(
      manifesto,
      {
        runtime: opcoes.runtime ?? undefined,
        model: opcoes.model ?? undefined,
        effort: opcoes.effort ?? undefined,
      },
      doBloco
    );
    const rt = resolverRuntime(runtime);
    // RM-047 (P1): a retomada recusa o sandbox afrouxado sem a confirmacao local, como o `ork phase run`.
    const erroDePostura = recusaDePostura(raiz, manifesto, runtime);
    if (erroDePostura) {
      if (!opcoes.dryRun) registrarGateBloqueado(dirThread(raiz, thread.id), thread.id, { gate: 'phase.dispatch',
        motivo: 'policy.violation', modo: thread.modo, detalhe: erroDePostura,
        correcao: comandoDeConfirmacao(posturaAfrouxada(manifesto) ?? ''), fase, slug, origem: opcoes.origem ?? 'retry' });
      return { ...vazio, ok: false, motivo: 'policy.violation', detalhe: erroDePostura, dryRun: opcoes.dryRun === true };
    }
    if (!opcoes.dryRun && baselineDoDespachoNecessaria(carregado, thread.id, { fase, prompt: '', runtime, model, effort })) {
      // Na primeira passada a tomada fica retida para a baseline (o `finally` nao a solta); na repeticao, o
      // `finally` devolve o que a tomada consumiu (A-1 do CHECK 3).
      const pendente: ResultadoDoRedespacho = { ...vazio, ok: false, motivo: 'runtime.unavailable', dryRun: false,
        detalhe: textoDoCatalogo((m) => m.retry.baselinePendente(runtime)) };
      if (!tomadaPrevia && conducao) { pendente.retida = conducao; conducao = null; }
      return pendente;
    }
    // RM-064 T8: toda retomada abre com o mesmo contexto de runtime do `ork phase run`.
    // Sem ele, a escada que troca para Codex perde o MCP vinculado à thread e ao despacho.
    let contextoRuntime: ContextoRuntime | undefined;
    try { contextoRuntime = contextoDoProjeto(raiz, runtime, cwd, thread.id); }
    catch (e) {
      const erro = (e as Error).message;
      if (!opcoes.dryRun && opcoes.perfilPedido) registrarGateBloqueado(dirThread(raiz, thread.id), thread.id, {
        gate: 'phase.dispatch', motivo: 'runtime.unavailable', modo: thread.modo,
        detalhe: textoDoCatalogo((m) => m.retry.perfilPedidoRecusado(opcoes.perfilPedido!.id,
          opcoes.perfilPedido!.runtime, 'runtime.unavailable', erro)),
        correcao: textoDoCatalogo((m) => m.retry.correcaoDoPerfilPedido(opcoes.perfilPedido!.id,
          opcoes.perfilPedido!.runtime, 'runtime.unavailable', thread.id)),
        fase, slug, origem: opcoes.origem ?? 'retry', promptPath: promptExecutadoPath,
        promptSha256: promptExecutadoSha, perfilPedido: opcoes.perfilPedido,
      });
      return { ...vazio, ok: false, motivo: 'runtime.unavailable',
        detalhe: textoDoCatalogo((m) => m.retry.runtimeIndisponivel(erro)), dryRun: opcoes.dryRun === true };
    }
    if (contextoRuntime) contextoRuntime.identidade = identidade;
    // I-33 (D4, D7): a retomada escolhe o perfil como o `ork phase run`, com o login conferido.
    let escolha: EscolhaDePerfil;
    try { escolha = perfilParaDespacho(carregado, thread, fase, runtime, { perfil: opcoes.perfil ?? undefined, dryRun: opcoes.dryRun,
      origem: opcoes.origem ?? 'retry' }); }
    catch (e) { escolha = { perfil: null, configurados: 0, erro: (e as Error).message }; }
    if (escolha.erro) {
      const motivo = escolha.motivo ?? 'runtime.unavailable';
      const prazo = motivo === 'runtime.quota-exhausted' ? prazoDoRuntime(lerPerfisComContas(raiz), runtime, politicaDeRotacao(manifesto)) : null;
      const detalhe = opcoes.perfilPedido
        ? textoDoCatalogo((m) => m.retry.perfilPedidoRecusado(opcoes.perfilPedido!.id, opcoes.perfilPedido!.runtime, motivo, escolha.erro!))
        : `${motivo}: ${escolha.erro}`;
      if (!opcoes.dryRun && opcoes.perfilPedido) registrarGateBloqueado(dirThread(raiz, thread.id), thread.id, {
        gate: 'phase.dispatch', motivo, modo: thread.modo, detalhe,
        correcao: textoDoCatalogo((m) => m.retry.correcaoDoPerfilPedido(opcoes.perfilPedido!.id,
          opcoes.perfilPedido!.runtime, motivo, thread.id)), fase, slug, origem: opcoes.origem ?? 'retry',
        promptPath: promptExecutadoPath, promptSha256: promptExecutadoSha, perfilPedido: opcoes.perfilPedido,
      });
      return { ...vazio, ok: false, motivo, detalhe, dryRun: opcoes.dryRun === true,
        sinal: prazo ? { resetEm: prazo, fonte: 'iso', trecho: `menor esgotadoAte dos perfis ${runtime}` } : null };
    }
    const perfil = escolha.perfil ?? undefined;
    // I-33 (N1): o HEAD do GO codex sai antes do despacho, como no `ork phase run`. RM-067: o grok tambem.
    const headNoDespacho = fase === 'GO' && (runtime === 'codex' || runtime === 'grok') && !opcoes.dryRun ? headDaWorktree(cwd) : undefined;
    // RM-067 (D8): a base do artefato do grok tambem sai antes do redespacho, como no `ork phase run`.
    const artefatoNoDespacho = runtime === 'grok' && !opcoes.dryRun ? baseDoArtefato(raiz, thread.id, fase) : undefined;
    const resultado = rt.despachar({
      prompt,
      nome: slug,
      cwd,
      model,
      effort,
      dryRun: opcoes.dryRun,
      sandbox: manifesto.runtime.sandbox,
      logDir: path.join(dirThread(raiz, thread.id), 'sessoes'),
      vinculo: { thread: thread.id, fase, promptSha256: promptExecutadoSha },
      ...(perfil ? { perfil } : {}),
      // RM-037 (defeito 2): o modo plano segue a mesma regra do `ork phase run`, pelo bloco.
      contextoRuntime,
      // RM-067 (GO-FIX 1, A3): o grok tambem; no PLAN que fecha o bloco, ele roda em read-only.
      ...((runtime === 'claude-bg' || runtime === 'grok') && modoDaSessaoDoBloco(thread, fase).plano ? { colaboracao: 'plan' as const } : {}),
      // I-36 (D4): a sessao retomada herda a identidade do despacho e o canal, como no `ork phase run`.
      ambienteExtra: ambienteDaConducao(identidade.dispatchId, thread.id, canal),
    });

    if (opcoes.dryRun) {
      return {
        ok: true,
        slug,
        sessionId: null,
        verificada: false,
        motivo: null,
        detalhe: textoDoCatalogo((m) => m.retry.ensaioDoRedespacho),
        sinal: null,
        comando: resultado.comando,
        dryRun: true,
      };
    }

    if (!resultado.ok || !resultado.sessionId) {
      // RM-063 (F4, GO-FIX): o `claude --bg` lento diz o id e estoura o prazo com a sessao aberta. A falha guarda a sessao,
      // como no `ork phase run`: e por ela que o retry e a escada provam que ninguem trabalha na worktree antes de outro
      // destino.
      const daSessao = resultado.sessionId ? { sessionId: resultado.sessionId } : {};
      registrar(dirThread(raiz, thread.id), thread.id, 'phase_dispatch_failed', { fase, runtime, slug, cwd,
        promptPath: promptExecutadoPath, promptSha256: promptExecutadoSha,
        ...(retomada ? { promptOriginalPath: absoluto, promptOriginalSha256: sha } : {}),
        controlador: resultado.controlador, model, effort,
        erro: resultado.erro ?? 'runtime.unavailable: sem sessionId', stderr: (resultado.stderr ?? '').slice(0, 500),
        origem: 'retry', ...(perfil ? { perfil } : {}), ...(opcoes.perfilPedido ? { perfilPedido: opcoes.perfilPedido } : {}), ...daSessao });
      const sinal = resultado.rateLimit ?? null;
      // RM-055: o redespacho recusado pelo que so o dono resolve reabre a pausa dele, com o mesmo comando.
      const impedimento = !resultado.falhaDeConta && !sinal
        ? registrarImpedimentoDoDono(dirThread(raiz, thread.id), thread, { fase, slug, runtime, cwd, origem: 'retry',
          promptPath: promptExecutadoPath, promptSha256: promptExecutadoSha, perfil, saida: `${resultado.stderr ?? ''}\n${resultado.erro ?? ''}` })
        : null;
      if (impedimento) {
        return { ok: false, slug, sessionId: null, verificada: false, motivo: impedimento.motivo,
          detalhe: `${impedimento.motivo}: ${impedimento.trecho}`, sinal: null, falhaDeConta: null, perfil: perfil ?? null,
          comando: resultado.comando, controlador: resultado.controlador, dryRun: false };
      }
      // I-33 (D5): a conta recusou o redespacho; o perfil sai do rodizio aqui, onde a evidencia esta.
      if (resultado.falhaDeConta) {
        try { marcarContaDaFalha(carregado, perfil, resultado.falhaDeConta); } catch { /* a rotacao segue pelo motivo tipado */ }
      }
      return {
        ok: false,
        slug,
        sessionId: resultado.sessionId ?? null,
        verificada: false,
        // I-33 (D11b): falha de conta reconhecida na saida e o motivo mais especifico.
        motivo: resultado.falhaDeConta?.motivo ?? (sinal ? 'runtime.rate-limited' : 'runtime.unavailable'),
        detalhe: resultado.erro ?? textoDoCatalogo((m) => m.retry.semSessionId),
        sinal,
        falhaDeConta: resultado.falhaDeConta ?? null,
        perfil: perfil ?? null,
        comando: resultado.comando,
        controlador: resultado.controlador,
        dryRun: false,
      };
    }

    const ctx: ContextoDeDespacho = {
      identidade,
      canal,
      ...(conducao ? { conducao } : {}),
      prazoDaSessaoMs: pedidoDeConducao.prazoMs,
      raiz,
      thread,
      fase,
      slug,
      promptPath: promptExecutadoPath,
      promptSha256: promptExecutadoSha,
      ...(retomada ? { promptOriginal: { path: absoluto, sha256: sha } } : {}),
      runtime,
      cwd,
      model,
      effort,
      origem: opcoes.origem ?? 'retry',
      ...(perfil ? { perfil } : {}),
      ...(opcoes.perfilPedido ? { perfilPedido: opcoes.perfilPedido } : {}),
      ...(headNoDespacho !== undefined ? { headNoDespacho } : {}),
      ...(artefatoNoDespacho !== undefined ? { artefatoNoDespacho } : {}),
    };
    // RM-067 (D14 da ork-grokbuild): o redespacho do grok leva os sensores do supervisor ao registro do watcher; o caminho
    // do codex e do claude-bg segue sem eles, como antes.
    concluirDespacho(ctx, resultado.sessionId, resultado.verificada, resultado.comando, rt.fonteVerificacao, resultado.controlador,
      runtime === 'grok' ? { logPath: resultado.logPath, processoPath: resultado.processoPath, reciboPath: resultado.reciboPath } : undefined);

    return {
      ok: true,
      slug,
      sessionId: resultado.sessionId,
      verificada: resultado.verificada,
      motivo: null,
      detalhe: textoDoCatalogo((m) => m.retry.redespachada(String(resultado.sessionId), promptExecutadoSha.slice(0, 12), perfil ? perfil.id : null, runtime)),
      sinal: null,
      perfil: perfil ?? null,
      comando: resultado.comando,
      controlador: resultado.controlador,
      dryRun: false,
    };
  } finally {
    // Retomada que nao virou sessao devolve a conducao, com o que a tomada consumiu; a que virou ja a
    // entregou a sessao, e devolver entao nao faz nada.
    conducao?.devolver();
  }
}

// ---------------------------------------------------------------------------
// Os 3 playbooks de recuperacao, em codigo.
// ---------------------------------------------------------------------------

/**
 * Escolhe o playbook da retomada.
 *
 * Nao ha regra nova de rotacao aqui: quem decide entre a MESMA sessao e uma NOVA e o
 * gate de tokens do B1 (visao, secao 3.6), com `refazer: true`, porque retomar uma fase
 * morta E refazer uma fase. `escalada` e a terceira porta: o limite do manifesto.
 */
export function playbookDaRetomada(
  carregado: ManifestoCarregado,
  pedido: PedidoDeRetomada,
  opcoes: { ocupacao?: number; fonte?: 'runtime_reported' | 'estimated' | 'informada' } = {}
): { playbook: PlaybookDeRetomada; razao: string; slugSugerido: string | null } {
  const { manifesto } = carregado;
  if (pedido.tentativas >= manifesto.retry.max_tentativas) {
    return {
      playbook: 'escalada',
      razao:
        `${pedido.tentativas} retomada(s) do pedido ${pedido.id} para o limite de ` +
        `${manifesto.retry.max_tentativas}: escalacao tipada pausa qualquer modo, inclusive #Auto`,
      slugSugerido: null,
    };
  }
  const veredito = gateDeTokens(carregado, pedido.thread, {
    proximo: pedido.fase,
    refazer: true,
    ocupacao: opcoes.ocupacao,
    fonte: opcoes.fonte,
  });
  if (veredito.veredito === 'new-session') {
    return {
      playbook: 'nova-sessao',
      razao: `gate de tokens: ${veredito.razao}`,
      slugSugerido: veredito.slugSugerido,
    };
  }
  return {
    playbook: 'mesma-sessao',
    razao: `gate de tokens: ${veredito.razao}`,
    slugSugerido: null,
  };
}

export interface OpcoesDeRetomada {
  /** Instante considerado "agora" (o CLI aceita `--agora ISO` para operar a fila). */
  quando?: string;
  dryRun?: boolean;
  ocupacao?: number;
  fonte?: 'runtime_reported' | 'estimated' | 'informada';
  /** Retoma mesmo antes de a janela liberar (uso do operador, sempre registrado). */
  forcar?: boolean;
}

type PedidoComCheckpoint = PedidoComPerfil & { checkpoint?: boolean };

/** Retoma UM pedido da fila, aplicando o playbook que couber. */
export function retomarPedido(
  carregado: ManifestoCarregado,
  pedidoOriginal: PedidoDeRetomada,
  opcoes: OpcoesDeRetomada = {}
): ResultadoDaRetomada {
  const { raiz } = carregado;
  const quando = opcoes.quando ?? agora();
  // RM-058 N4 (D17 da ork-rm058n4): o pedido do despacho de um arco #Noctum é retomado pelo vigia do arco, pelo passo dele
  // (conferência do envelope e reserva). Aqui ele não é redespachado nem regravado, e o ledger da thread não muda.
  const arco = arcoDoPedido(pedidoOriginal);
  if (arco) {
    return { pedido: pedidoOriginal, playbook: 'mesma-sessao', slug: pedidoOriginal.slug, despachada: false, sessionId: null, verificada: false,
      motivo: null, dryRun: opcoes.dryRun === true,
      detalhe: `o pedido ${pedidoOriginal.id} é do arco ${arco}: quem o retoma é o vigia do arco, com a conferência do envelope e a reserva; ` +
        `nada foi despachado (sem o vigia, o dono tira o pedido da fila com ork retry cancel ${pedidoOriginal.id} --motivo "..." e retoma a fase à mão)` };
  }
  const thread = lerThread(raiz, pedidoOriginal.thread);
  const dir = dirThread(raiz, thread.id);
  let pedido = pedidoOriginal;

  if (!opcoes.forcar && pedido.liberaEm > quando) {
    return {
      pedido,
      playbook: 'mesma-sessao',
      slug: pedido.slug,
      despachada: false,
      sessionId: null,
      verificada: false,
      motivo: 'runtime.rate-limited',
      detalhe: `a janela ainda nao liberou (libera em ${pedido.liberaEm})`,
      dryRun: opcoes.dryRun === true,
    };
  }

  const escolha = playbookDaRetomada(carregado, pedido, opcoes);

  // Playbook 3: escalada. Pausa QUALQUER modo, e o pedido sai da fila de espera.
  if (escolha.playbook === 'escalada') {
    registrarGateBloqueado(dir, thread.id, {
      gate: 'phase.dispatch',
      motivo: 'human.pending',
      modo: thread.modo,
      detalhe: escolha.razao,
      correcao: `ork gate request ${thread.id}`,
      fase: pedido.fase,
      slug: pedido.slug,
      pedido: pedido.id,
      pausaQualquerModo: true,
    });
    registrar(dir, thread.id, TIPOS_DE_EVENTO.retryEscalado, {
      fase: pedido.fase,
      motivo: 'runtime.rate-limited',
      origem: 'rate-limit.fila',
      pedido: pedido.id,
      tentativas: pedido.tentativas,
      limite: carregado.manifesto.retry.max_tentativas,
      modo: thread.modo,
      razao: escolha.razao,
    });
    pedido = gravarPedido(raiz, { ...pedido, estado: 'escalado', detalhe: escolha.razao });
    return {
      pedido,
      playbook: 'escalada',
      slug: pedido.slug,
      despachada: false,
      sessionId: null,
      verificada: false,
      motivo: 'human.pending',
      detalhe: escolha.razao,
      dryRun: opcoes.dryRun === true,
    };
  }

  // Playbooks 1 e 2: mesma sessao (mesmo slug) ou nova sessao (slug rotacionado).
  //
  // A rotacao conta o slug da sessao MORTA junto dos slugs ja usados na thread. A fase
  // morreu antes de virar sessao registrada, entao sem isso o `slugDaSessao` devolveria
  // o mesmo slug e a "nova sessao" nasceria com o nome da que acabou de cair.
  const slug =
    escolha.playbook === 'nova-sessao'
      ? proximaRotacao(pedido.slug, [...thread.sessoes.map((s) => s.slug), pedido.slug])
      : pedido.slug;

  // I-33 (R3, D15/A4): pedido da conta retoma no primeiro runtime, original ou da ordem de fallback,
  // cujo perfil da vez voltou: o prazo que liberou a fila pode ter sido o do fallback. Pedido antigo,
  // sem os campos, segue igual.
  const doPedido = pedido as PedidoComCheckpoint;
  const alvo = alvoDaRetomada(carregado, thread, doPedido);
  const r: ResultadoDoRedespacho = !alvo.destino
    ? { ok: false, slug, sessionId: null, verificada: false, motivo: doPedido.motivo ?? 'runtime.quota-exhausted',
        detalhe: `${doPedido.motivo ?? 'runtime.quota-exhausted'}: nenhum perfil da vez disponivel em ${alvo.runtimes.join(', ')}`,
        sinal: null, comando: [], dryRun: opcoes.dryRun === true }
    : redespachar(carregado, thread, pedido.fase, pedido.promptPath, pedido.promptSha256, {
      slug,
      runtime: alvo.runtime,
      perfil: alvo.perfil ?? doPedido.perfil ?? null,
      ...(doPedido.perfilPedido ? { perfilPedido: doPedido.perfilPedido } : {}),
      model: alvo.model,
      effort: alvo.effort,
      cwd: pedido.cwd,
      origem: 'retry.rate-limit',
      checkpoint: doPedido.checkpoint === true,
      dryRun: opcoes.dryRun,
    });

  registrar(dir, thread.id, TIPOS_DE_EVENTO.retryTentado, {
    fase: pedido.fase,
    motivo: 'runtime.rate-limited',
    acao: 'esperar-janela',
    playbook: escolha.playbook,
    pedido: pedido.id,
    slug,
    tentativa: pedido.tentativas + 1,
    limite: carregado.manifesto.retry.max_tentativas,
    modo: thread.modo,
    dryRun: opcoes.dryRun === true,
    ok: r.ok,
    detalhe: r.detalhe,
  });

  if (opcoes.dryRun) {
    return {
      pedido,
      playbook: escolha.playbook,
      slug,
      despachada: false,
      sessionId: null,
      verificada: false,
      motivo: r.motivo,
      detalhe: `${escolha.razao}; ${r.detalhe}`,
      dryRun: true,
    };
  }

  if (r.ok) {
    registrar(dir, thread.id, TIPOS_DE_EVENTO.rateLimitRetomado, {
      fase: pedido.fase,
      pedido: pedido.id,
      playbook: escolha.playbook,
      slug,
      sessionId: r.sessionId,
      ...(alvo.destino && alvo.runtime !== null ? { runtime: alvo.runtime } : {}),
      ...(r.perfil ? { perfil: r.perfil.id } : {}),
      promptSha256: pedido.promptSha256,
      esperouAte: pedido.liberaEm,
      janelaEstimada: pedido.janelaEstimada,
      modo: thread.modo,
      autorizadoPor: 'politica de retry do bloco B3 (rate limit nao pausa modo nenhum)',
      evidencia: `mesmo prompt sha256 ${pedido.promptSha256}`,
      razao: escolha.razao,
    });
    pedido = gravarPedido(raiz, {
      ...pedido,
      estado: 'retomado',
      tentativas: pedido.tentativas + 1,
      detalhe: r.detalhe,
    });
    return {
      pedido,
      playbook: escolha.playbook,
      slug,
      despachada: true,
      sessionId: r.sessionId,
      verificada: r.verificada,
      motivo: null,
      detalhe: r.detalhe,
      dryRun: false,
    };
  }

  // Falhou de novo. Rate limit outra vez reagenda o MESMO pedido com a hora nova;
  // qualquer outro motivo devolve o pedido para a fila com a tentativa contada.
  // D15 (A4): pedido da conta reagenda no proximo prazo entre TODOS os runtimes candidatos, e o
  // novo prazo e sempre posterior ao instante da retomada: nada volta a vencer na mesma chamada.
  const instante = Math.max(Date.parse(quando), Date.now());
  const prazoDaConta = alvo.contas ? prazoDaFila(lerPerfisComContas(raiz), alvo.runtimes, politicaDeRotacao(carregado.manifesto), instante) : null;
  let novaJanela = prazoDaConta ?? r.sinal?.resetEm ?? pedido.liberaEm;
  let estimada = prazoDaConta ? false : r.sinal ? r.sinal.resetEm === null : pedido.janelaEstimada;
  if (alvo.contas && !(Date.parse(novaJanela) > instante)) {
    novaJanela = new Date(instante + janelaPadraoMs(carregado.manifesto)).toISOString();
    estimada = true;
  }
  pedido = gravarPedido(raiz, {
    ...pedido,
    tentativas: pedido.tentativas + 1,
    liberaEm: novaJanela,
    janelaEstimada: estimada,
    sinal: r.sinal ?? pedido.sinal,
    detalhe: r.detalhe,
  });
  return {
    pedido,
    playbook: escolha.playbook,
    slug,
    despachada: false,
    sessionId: null,
    verificada: false,
    motivo: r.motivo,
    detalhe: r.detalhe,
    dryRun: false,
  };
}

interface AlvoDaRetomada {
  /** Ha para onde despachar agora; `false` so em pedido da conta sem perfil da vez em nenhum candidato. */
  destino: boolean;
  /** `null` em pedido antigo: o redespacho resolve o runtime como antes. */
  runtime: string | null; perfil?: string | null; model: string | null; effort: string | null;
  /** Runtimes candidatos, original primeiro, na ordem do bloco. */
  runtimes: string[];
  /** Pedido da conta (I-33): o prazo e a escolha seguem os perfis. */
  contas: boolean;
}

/**
 * D15 (A4): o destino da retomada. Pedido da conta tenta o runtime original e depois cada runtime da
 * ordem de fallback do bloco, e fica com o primeiro cujo perfil da vez esta disponivel agora, pela
 * politica da D14. Runtime original sem perfil configurado segue pelo ambiente do processo, como
 * antes; pedido antigo (rate limit) segue no runtime gravado.
 */
function alvoDaRetomada(carregado: ManifestoCarregado, thread: Thread, pedido: PedidoComPerfil): AlvoDaRetomada {
  const { raiz, manifesto } = carregado;
  const original = { runtime: pedido.runtime ?? null, model: pedido.model, effort: pedido.effort };
  if (pedido.perfilPedido) return { runtime: pedido.perfilPedido.runtime, perfil: pedido.perfilPedido.id,
    model: pedido.model, effort: pedido.effort, destino: true, runtimes: [pedido.perfilPedido.runtime], contas: false };
  if (pedido.motivo !== 'runtime.quota-exhausted' && pedido.motivo !== 'runtime.auth-missing')
    return { ...original, destino: true, runtimes: original.runtime ? [original.runtime] : [], contas: false };
  const doBloco = configDoBloco(lerSetup(raiz), thread.modo, pedido.fase);
  const principal = pedido.runtime ?? doBloco?.runtime ?? manifesto.runtime.adapter;
  const candidatos = [{ runtime: principal, model: pedido.model, effort: pedido.effort },
    ...alvosDeFallback(doBloco, doBloco?.runtime ?? manifesto.runtime.adapter).filter(f => f.runtime !== principal)
      .map(f => ({ runtime: f.runtime, model: f.model as string | null, effort: f.effort ?? pedido.effort }))]
    // RM-067 (F4): a troca de conta do runtime principal vale tambem para o runtime sem host MCP (o grok).
    .filter(c => capacidadeDaRotacao(raiz, c.runtime, c.runtime === principal).capaz);
  const runtimes = candidatos.map(c => c.runtime);
  const store = lerPerfisComContas(raiz), politica = politicaDeRotacao(manifesto);
  for (const c of candidatos) {
    if (perfisDoRuntime(store, c.runtime).length === 0) {
      if (c.runtime === principal) return { ...c, destino: true, perfil: null, runtimes, contas: true };
      continue;
    }
    const p = proximoPerfilDisponivel(store, c.runtime, politica);
    if (p) return { ...c, destino: true, perfil: p.id, runtimes, contas: true };
  }
  return { destino: false, runtime: null, model: pedido.model, effort: pedido.effort, runtimes, contas: true };
}

/** Retoma todos os pedidos cuja janela ja liberou. */
export function retomarFila(
  carregado: ManifestoCarregado,
  opcoes: OpcoesDeRetomada = {}
): ResultadoDaRetomada[] {
  const quando = opcoes.quando ?? agora();
  const alvos = opcoes.forcar ? aguardando(carregado.raiz) : vencidos(carregado.raiz, quando);
  return alvos.map((p) => retomarPedido(carregado, p, { ...opcoes, quando }));
}

/** Retoma um pedido especifico pelo id. */
export function retomarPorId(
  carregado: ManifestoCarregado,
  id: string,
  opcoes: OpcoesDeRetomada = {}
): ResultadoDaRetomada {
  return retomarPedido(carregado, exigirPedido(carregado.raiz, id), opcoes);
}

/** Cancela um pedido da fila, com motivo obrigatorio. */
export function cancelarPedido(
  carregado: ManifestoCarregado,
  id: string,
  motivo: string
): PedidoDeRetomada {
  const pedido = exigirPedido(carregado.raiz, id);
  const cancelado = gravarPedido(carregado.raiz, {
    ...pedido,
    estado: 'cancelado',
    detalhe: motivo,
  });
  registrar(dirThread(carregado.raiz, pedido.thread), pedido.thread, TIPOS_DE_EVENTO.retryEscalado, {
    fase: pedido.fase,
    motivo: 'runtime.rate-limited',
    origem: 'rate-limit.fila',
    pedido: pedido.id,
    estado: 'cancelado',
    razao: motivo,
  });
  return cancelado;
}

// ---------------------------------------------------------------------------
// I-33 (D5, D11): rotacao de perfil e fallback de runtime depois de falha da conta.
// ---------------------------------------------------------------------------

export type { AlvoDeFallback } from './setup';

/**
 * D6 (A13): a ordem de fallback do bloco, `runtime:modelo[:esforco]`, pelo parser unico do setup
 * (domicilio da D6): entrada malformada, runtime nao homologado, repetido ou igual ao principal e
 * descartada com as mesmas regras da edicao e da listagem.
 */
export function alvosDeFallback(bloco: unknown, principal: string): AlvoDeFallback[] {
  return alvosDaOrdemDeFallback((bloco as { fallback?: unknown } | null | undefined)?.fallback, principal);
}

export interface AlvoDaRotacao { runtime: string; perfil: PerfilDeDespacho | null; model: string | null; effort: string | null }

/**
 * D5, D14, D16: proximo destino do MESMO prompt. Primeiro o perfil da vez do mesmo runtime (outro
 * perfil so com a troca do manifesto ligada para o motivo: por cota, ligada por padrao desde a
 * decisao do dono em 19/09/2026); depois cada runtime da ordem de fallback (perfil da vez dele, ou o ambiente do
 * processo quando ele nao tem perfil configurado e esse ambiente ainda nao falhou nesta rotacao).
 * Sem destino, `null`.
 */
export function proximoAlvo(raiz: string, atual: { runtime: string; perfil: PerfilDeDespacho | null },
  fallback: readonly AlvoDeFallback[], excluir: { perfis: readonly string[]; runtimesImplicitos: readonly string[] },
  politica: PoliticaDeRotacao, agoraMs = Date.now()): AlvoDaRotacao | null {
  const store = lerPerfisComContas(raiz, agoraMs);
  const perfis = [...excluir.perfis, ...(atual.perfil ? [atual.perfil.id] : [])];
  const mesmo = capacidadeDaRotacao(raiz, atual.runtime, true).capaz
    ? proximoPerfilDisponivel(store, atual.runtime, politica, { excluir: perfis, agoraMs }) : null;
  if (mesmo) return { runtime: atual.runtime, perfil: perfilDeDespacho(mesmo), model: null, effort: null };
  for (const f of fallback) {
    if (f.runtime === atual.runtime || !capacidadeDoRuntimeNoProjeto(raiz, f.runtime).capaz) continue;
    if (perfisDoRuntime(store, f.runtime).length > 0) {
      const p = proximoPerfilDisponivel(store, f.runtime, politica, { excluir: perfis, agoraMs });
      if (p) return { runtime: f.runtime, perfil: perfilDeDespacho(p), model: f.model, effort: f.effort ?? null };
      continue;
    }
    if (!excluir.runtimesImplicitos.includes(f.runtime)) return { runtime: f.runtime, perfil: null, model: f.model, effort: f.effort ?? null };
  }
  return null;
}

/**
 * D11 (c): o intervalo do despacho produziu alguma coisa? Leitura de disco, do ledger e do git,
 * como a prova da I-34: artefato da fase gravado, commit registrado, entrega registrada ou, no
 * GO, HEAD movido ou worktree alterada. Duvida conta como producao (fail-closed): so o intervalo
 * provadamente vazio aceita redespacho do mesmo prompt.
 */
export function producaoNoIntervalo(raiz: string, thread: Thread,
  sessao: { sessionId: string; fase: Fase; despachadaEm: string }, eventos: readonly EventoLedger[]): { produziu: boolean; evidencia: string } {
  const fonte = fonteRegistrada(eventos, sessao);
  const saida = saidaDoArtefato(raiz, thread.id, sessao, fonte, eventos);
  if (saida?.produzido) return { produziu: true, evidencia: `${saida.arquivo} gravado no intervalo do despacho` };
  const intervalo = eventosDoIntervalo(eventos, sessao);
  const commits = intervalo.filter(e => e.tipo === 'mcp_git_committed' || (e.tipo === 'commit' && e.sessionId === sessao.sessionId));
  if (commits.length) return { produziu: true, evidencia: `${commits.length} commit(s) registrado(s) no intervalo do despacho` };
  const entrega = intervalo.find(e => e.tipo === 'ship_done' || e.tipo === 'score_proposto');
  if (entrega) return { produziu: true, evidencia: `${entrega.tipo} registrado no intervalo do despacho` };
  if (sessao.fase === 'GO') {
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessao.sessionId).at(-1);
    // I-33 (N1): o HEAD vem do registro do despacho em qualquer runtime (claude-bg e codex); commit feito
    // pelo shell nao passa pelo ledger, entao so o HEAD o revela.
    const registro = eventos.filter(e => e.tipo === 'session_sensor_registered' && e.sessionId === sessao.sessionId &&
      e.despachoEm === sessao.despachadaEm).at(-1);
    const doLedger = typeof registro?.cwd === 'string' ? registro.cwd : typeof despacho?.cwd === 'string' ? despacho.cwd : null;
    // RM-047 (P2): git so roda em worktree registrada; cwd que nao vale e duvida, e duvida conta como producao.
    const cwd = doLedger !== null ? cwdLocalOuNulo(raiz, thread.id, doLedger, 'ledger') : cwdLocalOuNulo(raiz, thread.id, thread.worktree ?? raiz, 'thread');
    if (cwd === null) return { produziu: true, evidencia: 'cwd do despacho fora das worktrees registradas; producao nao descartada' };
    const head = registro?.head;
    if (typeof head !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))
      return { produziu: true, evidencia: 'HEAD da worktree no despacho desconhecido; producao nao descartada' };
    if (headDaWorktree(cwd) !== head)
      return { produziu: true, evidencia: 'HEAD da worktree mudou desde o despacho' };
    const status = exec('git', ['status', '--porcelain', '--', '.', ':(exclude).orkastery'], cwd, 30000);
    if (!status.ok) return { produziu: true, evidencia: 'git status da worktree falhou; producao nao descartada' };
    if (status.stdout.trim() !== '') return { produziu: true, evidencia: 'worktree com alteracoes nao commitadas' };
  }
  return { produziu: false, evidencia: 'nenhum artefato, commit, entrega ou alteracao da worktree no intervalo do despacho' };
}

/** O despacho que falhou pela conta: o da sessao do gate (observador) ou o ultimo recusado na fase. */
function despachoDaFalha(eventos: readonly EventoLedger[], gate: EventoLedger | null, fase: Fase): EventoLedger | null {
  if (gate && typeof gate.sessionId === 'string')
    return eventos.filter(e => e.tipo === TIPOS_DE_EVENTO.faseDespachada && e.sessionId === gate.sessionId).at(-1) ?? null;
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.fase === fase && e.tipo === TIPOS_DE_EVENTO.despachoFalhou) return e;
    if (e.fase === fase && e.tipo === TIPOS_DE_EVENTO.faseDespachada) return null;
  }
  return null;
}

function perfilDoEvento(e: EventoLedger | null): PerfilDeDespacho | null {
  return e && e.perfil !== undefined && e.perfil !== null ? validarPerfilDeDespacho(e.perfil) : null;
}

type PerfilPedido = { id: string; runtime: string };

/** O marcador distinto do destino efetivo: ausente em despacho sem `--perfil` e em rotacao interna. */
function perfilPedidoDoEvento(e: EventoLedger | null | undefined): PerfilPedido | null {
  if (!e || e.perfilPedido === undefined || e.perfilPedido === null) return null;
  if (typeof e.perfilPedido !== 'object' || Array.isArray(e.perfilPedido)) return null;
  const p = e.perfilPedido as Record<string, unknown>;
  if (typeof p.runtime !== 'string' || p.runtime.length === 0 || p.runtime.length > 64) return null;
  try { return { id: validarIdDePerfil(p.id), runtime: p.runtime }; } catch { return null; }
}

/** Recupera o pedido do mesmo prompt; eventos antigos sem o campo preservam o comportamento anterior. */
function perfilPedidoDoDespacho(eventos: readonly EventoLedger[], fase: Fase,
  despacho: EventoLedger | null, gate: EventoLedger | null): PerfilPedido | null {
  for (const e of [gate, despacho]) {
    const p = perfilPedidoDoEvento(e);
    if (p) return p;
  }
  const sha = typeof despacho?.promptSha256 === 'string' ? despacho.promptSha256
    : typeof gate?.promptSha256 === 'string' ? gate.promptSha256 : null;
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.fase !== fase || (sha !== null && e.promptSha256 !== sha)) continue;
    const p = perfilPedidoDoEvento(e);
    if (p) return p;
  }
  return null;
}

/** O perfil ja esta fora do rodizio por esta falha (cota com prazo futuro, ou sem login)? */
function jaMarcado(raiz: string, perfil: PerfilDeDespacho, falha: SinalDeFalhaDeConta, agoraMs = Date.now()): boolean {
  let atual;
  try { atual = lerPerfis(raiz).perfis.find(p => p.id === perfil.id); } catch { return false; }
  if (!atual) return false;
  return falha.motivo === 'runtime.quota-exhausted'
    ? atual.estado === 'esgotado' && atual.esgotadoAte !== null && Date.parse(atual.esgotadoAte) > agoraMs
    : atual.estado === 'sem-auth';
}

/**
 * RM-037 (fatia 5, aviso da rodada 1 do CHECK): a cota que o observador viu ao vivo (`runtime_quota_detected`, da mesma
 * sessao e do mesmo despacho, com o mesmo prazo dito) ja tirou o perfil do rodizio ate a hora da mensagem. Marcar de
 * novo aqui, depois dessa hora, pela janela padrao (A10), tiraria do rodizio uma conta que ja voltou.
 */
function cotaJaVistaAoVivo(eventos: readonly EventoLedger[], gate: EventoLedger | null, falha: SinalDeFalhaDeConta): boolean {
  if (falha.motivo !== 'runtime.quota-exhausted' || typeof gate?.sessionId !== 'string') return false;
  return eventos.some((e) => e.tipo === TIPOS_DE_EVENTO.cotaVistaNaTranscricao && e.sessionId === gate.sessionId &&
    e.despachoEm === gate.despachoEm && (e.resetEm ?? null) === falha.resetEm);
}

function sinalDoGate(gate: EventoLedger | null, motivo: MotivoGate): SinalDeFalhaDeConta {
  const f = gate?.falhaDeConta as Partial<SinalDeFalhaDeConta> | undefined;
  return { motivo: motivo === 'runtime.auth-missing' ? 'runtime.auth-missing' : 'runtime.quota-exhausted',
    resetEm: typeof f?.resetEm === 'string' ? f.resetEm : null, fonte: f?.fonte ?? 'sem-horario',
    trecho: typeof f?.trecho === 'string' ? f.trecho : String(gate?.detalhe ?? motivo).slice(0, 200) };
}

// ---------------------------------------------------------------------------
// `ork retry run`: executa a acao de retry do ultimo gate reprovado.
// ---------------------------------------------------------------------------

export interface ResultadoDeRetry {
  plano: PlanoDeRetry;
  executada: boolean;
  /** O que a acao produziu, quando produziu algo. */
  rodada: RodadaDeFix | null;
  reverify: ResultadoDoReverify | null;
  sync: ResultadoSync | null;
  redespacho: ResultadoDoRedespacho | null;
  fila: PedidoDeRetomada[];
  detalhe: string;
}

/** O ultimo despacho que falhou nesta fase, de onde sai o prompt a redespachar. */
function ultimoDespachoFalho(raiz: string, threadId: string, fase: Fase, silencio = false): EventoLedger | null {
  const eventos = lerLedger(dirThread(raiz, threadId));
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.fase === fase && (e.tipo === TIPOS_DE_EVENTO.despachoFalhou ||
        (silencio && e.tipo === TIPOS_DE_EVENTO.faseDespachada))) return e;
  }
  return null;
}

/**
 * RM-063 (F4, GO-FIX): quantas recusas seguidas, no episodio da fase, sairam porque o runtime nao respondeu a prova de
 * vida (`semProva`). Uma tentativa que andou (contada, ou recusada com sessao viva) zera a conta.
 */
export function recusasSemProvaSeguidas(eventos: readonly EventoLedger[], fase: Fase): number {
  const desde = inicioDoEpisodio(eventos, fase);
  let seguidas = 0;
  for (let i = eventos.length - 1; i > desde; i--) {
    const e = eventos[i];
    if (e.tipo !== TIPOS_DE_EVENTO.retryTentado || e.fase !== fase || e.motivo !== 'runtime.unavailable') continue;
    if (e.semProva !== true) break;
    seguidas += 1;
  }
  return seguidas;
}

/** Recusas seguidas sem resposta do runtime, no mesmo episodio, ate o dono ser chamado. */
export const LIMITE_SEM_PROVA = 3;

export interface OpcoesDeExecucao extends OpcoesDePlano {
  dryRun?: boolean;
  /** Encadeia o CHECK-REVERIFY logo apos abrir a rodada de GO-FIX. */
  reverify?: boolean;
  /** RM-063 (F4): o daemon do runtime do degrau 1; sem ele, o `claude daemon` da conta (os testes injetam um falso). */
  daemon?: ControleDoDaemon;
}

/**
 * Executa a acao de retry do ultimo gate reprovado da thread.
 *
 * O que ele NAO faz: inventar uma acao que a politica nao previu, executar acao nao
 * automatica sem autorizacao humana registrada, e reexecutar violacao de custo.
 */
export function executarRetry(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesDeExecucao = {}
): ResultadoDeRetry {
  const { raiz } = carregado;
  let plano = planejarRetry(carregado, threadId, { ...opcoes, estadoDaSessao: undefined });
  if (plano.motivo === 'runtime.silencio' && plano.fase && plano.tentativas < plano.limite) {
    const despacho = ultimoDespachoFalho(raiz, threadId, plano.fase, true);
    // O adapter Codex da baseline nao fornece prova terminal. I-04 adiciona esse contrato.
    if (despacho?.runtime === 'claude-bg' && typeof despacho.sessionId === 'string') {
      const consulta = consultarSessoes(undefined, true);
      const sessao = consulta.ok ? consulta.sessoes.find(s => s.sessionId === despacho.sessionId) : undefined;
      const estado = sessao?.state ?? sessao?.status;
      plano = planejarRetry(carregado, threadId, { ...opcoes,
        estadoDaSessao: typeof estado === 'string' ? { sessionId: despacho.sessionId, estado } : undefined });
    }
  }
  const thread = lerThread(raiz, threadId);
  const dir = dirThread(raiz, threadId);
  const vazio: ResultadoDeRetry = {
    plano,
    executada: false,
    rodada: null,
    reverify: null,
    sync: null,
    redespacho: null,
    fila: [],
    detalhe: plano.razao,
  };

  registrar(dir, threadId, TIPOS_DE_EVENTO.retryPlanejado, {
    fase: plano.fase,
    motivo: plano.motivo,
    acao: plano.acao,
    modo: thread.modo,
    tentativas: plano.tentativas,
    limite: plano.limite,
    automatica: plano.automatica,
    bloqueio: plano.bloqueio,
    effort: plano.effort,
    razao: plano.razao,
  });

  if (!plano.automatica || plano.motivo === null) {
    // RM-063 (F4, GO-FIX, achado 9): a escada esgotada pelo plano (a sessao do ultimo degrau morreu depois) chama o dono
    // pela escada, com as alternativas e o comando que retoma com o mesmo prompt; a escalada generica so repetia o retry.
    if (plano.motivo === 'runtime.unavailable' && plano.escada && plano.escada.degrau === null && plano.fase && !opcoes.dryRun) {
      const eventos = lerLedger(dir);
      const ultimo = despachoParaRedespachar(eventos, plano.fase, null);
      if (ultimo && typeof ultimo.promptPath === 'string' && typeof ultimo.promptSha256 === 'string') {
        const origem = destinoDoEpisodio(eventos, plano.fase);
        let perfil: PerfilDeDespacho | null = null;
        try { perfil = perfilDoEvento(ultimo); } catch { perfil = null; }
        const despacho = { promptPath: localizarPromptGravado(raiz, threadId, ultimo.promptPath, ultimo.promptSha256) ?? ultimo.promptPath,
          promptSha256: ultimo.promptSha256, perfil: origem?.perfil ?? perfil,
          runtime: origem?.runtime ?? (typeof ultimo.runtime === 'string' ? ultimo.runtime : carregado.manifesto.runtime.adapter),
          model: origem?.model ?? null, effort: origem?.effort ?? null };
        const detalhe = escalarEscada(carregado, thread, plano.fase, despacho, estadoDaEscada(eventos, plano.fase).consumidos,
          plano.tentativas, plano.limite);
        return { ...vazio, detalhe };
      }
    }
    // Escalacao e custo viram gate humano explicito no ledger, nao silencio.
    if (plano.bloqueio === 'escalacao.limite' || plano.acao === 'sem-retry') {
      registrarGateBloqueado(dir, threadId, {
        gate: 'phase.dispatch',
        motivo: plano.acao === 'sem-retry' ? (plano.motivo as MotivoGate) : 'human.pending',
        modo: thread.modo,
        detalhe: plano.razao,
        correcao: plano.politica?.correcao ?? `ork gate request ${threadId}`,
        fase: plano.fase,
        origem: 'retry.run',
        pausaQualquerModo: true,
      });
      registrar(dir, threadId, TIPOS_DE_EVENTO.retryEscalado, {
        fase: plano.fase,
        motivo: plano.motivo,
        origem: 'retry.run',
        acao: plano.acao,
        tentativas: plano.tentativas,
        limite: plano.limite,
        modo: thread.modo,
        razao: plano.razao,
      });
    }
    return vazio;
  }

  const acaoBase = plano.politica?.acao ?? plano.acao;
  const registrarTentativa = (ok: boolean, detalhe: string, extra: Record<string, unknown> = {}): void => {
    registrar(dir, threadId, TIPOS_DE_EVENTO.retryTentado, {
      fase: plano.fase,
      motivo: plano.motivo,
      acao: plano.acao,
      acaoBase,
      modo: thread.modo,
      tentativa: plano.tentativas + 1,
      limite: plano.limite,
      effort: plano.effort,
      effortAnterior: plano.effortAnterior,
      dryRun: opcoes.dryRun === true,
      autorizadoPor: blocoPausa(thread, plano.fase as Fase)
        ? (aprovacoesHumanas(raiz, threadId).some(e => e.fase === plano.fase && e.autorizadoPor === opcoes.autorizadoPor)
          ? opcoes.autorizadoPor : `delegacao:${carregado.manifesto.conduction.delegation?.delegado ?? 'ausente'}`)
        : `politica de retry do bloco B3 (bloco sem pausa no modo ${thread.modo})`,
      ok,
      detalhe,
      ...extra,
    });
  };

  // I-36 (T6): conducao em andamento nao e fila de rate limit. Nada e redespachado; o registro diz
  // quem conduz, e a vez chega quando essa conducao terminar.
  if (plano.motivo === 'conducao.em-andamento') {
    const atual = conducaoDaThread(raiz, threadId);
    const detalhe = textoDoCatalogo((m) => atual ? m.retry.conduzidaAgora(linhaDeConducao(atual)) : m.retry.ninguemConduz);
    registrarTentativa(!atual, detalhe);
    return { ...vazio, executada: false, detalhe };
  }

  // `esperar-janela`: quem retoma e a fila, e ela ja esta gravada em disco.
  if (acaoBase === 'esperar-janela') {
    const fila = lerFilaDeRetomada(raiz).filter(
      (p) => p.thread === threadId && p.estado === 'aguardando'
    );
    const detalhe = textoDoCatalogo((m) => fila.length > 0 ? m.retry.naFila(fila.length, fila[0].liberaEm) : m.retry.filaVazia);
    registrarTentativa(fila.length > 0, detalhe);
    return { ...vazio, executada: fila.length > 0, fila, detalhe };
  }

  if (acaoBase === 'sincronizar-worktree') {
    const sync = sincronizarWorktree(carregado, threadId, { dryRun: opcoes.dryRun });
    // RM-061 (F3b): o detalhe da worktree tambem vem do catalogo; remontado aqui, ele segue o locale da impressao.
    const detalhe = textoDoCatalogo((m) => sync.ok ? m.retry.sincronizada(sync.passos.join('; ')) : m.retry.sincronizacaoFalhou(remontar(sync.detalhe)));
    registrarTentativa(sync.ok, detalhe);
    return { ...vazio, executada: sync.ok, sync, detalhe };
  }

  if (acaoBase === 'corrigir-dirigido') {
    const rodada = abrirRodada(carregado, threadId);
    const reverify =
      opcoes.reverify && rodada.correcoes.length > 0
        ? reverificar(carregado, threadId, { rodada: rodada.rodada })
        : null;
    const detalhe = textoDoCatalogo((m) => rodada.correcoes.length === 0 ? m.retry.checkPassou
      : m.retry.correcoesNaRodada(rodada.correcoes.length, rodada.rodada, reverify ? m.retry.vereditos[reverify.veredito] ?? reverify.veredito : null));
    registrarTentativa(rodada.correcoes.length > 0, detalhe);
    return { ...vazio, executada: rodada.correcoes.length > 0, rodada, reverify, detalhe };
  }

  const redespacharNoPerfilPedido = (falho: EventoLedger, pedido: PerfilPedido): ResultadoDeRetry => {
    const r = redespachar(carregado, thread, plano.fase as Fase, String(falho.promptPath), String(falho.promptSha256), {
      runtime: pedido.runtime,
      perfil: pedido.id,
      perfilPedido: pedido,
      model: typeof falho.model === 'string' ? falho.model : null,
      effort: plano.effort ?? (typeof falho.effort === 'string' ? falho.effort : null),
      origem: 'retry.run',
      dryRun: opcoes.dryRun,
    });
    registrarTentativa(r.ok, r.detalhe, { perfilPedido: pedido, ...(!r.ok ? { conta: false } : {}) });
    return { ...vazio, executada: r.ok, redespacho: r, detalhe: r.detalhe };
  };

  if (plano.motivo === 'runtime.quota-exhausted' || plano.motivo === 'runtime.auth-missing') {
    const eventos = lerLedger(dir);
    const gate = ultimaReprovacao(raiz, threadId);
    const falho = despachoParaRedespachar(eventos, plano.fase as Fase, gate);
    const pedido = perfilPedidoDoDespacho(eventos, plano.fase as Fase, falho, gate);
    // Falha observada na propria conta continua na rotacao I-33 D5/RM-064 T3. A indisponibilidade
    // detectada antes de abrir a conta preserva o pedido do dono e nunca escolhe outra em silencio.
    if (pedido && gate?.falhaDeConta === undefined && falho && typeof falho.promptPath === 'string' &&
        typeof falho.promptSha256 === 'string') return redespacharNoPerfilPedido(falho, pedido);
    return rotacionarConta(carregado, thread, plano, opcoes, vazio, registrarTentativa);
  }
  if (plano.motivo === 'runtime.model-unavailable') {
    return trocarDestinoDoModelo(carregado, thread, plano, opcoes, vazio, registrarTentativa);
  }

  // `reexecutar` e `escalar-esforco`: o MESMO prompt volta ao runtime. RM-063 (F3): o gate que o plano leu diz de que
  // despacho e o prompt; sem ele, a tentativa mais recente da fase com prompt gravado.
  const reprovacao = ultimaReprovacao(raiz, threadId);
  const gateDoPlano = reprovacao && reprovacao.motivo === plano.motivo && faseDoEvento(reprovacao, thread) === plano.fase
    ? reprovacao : null;
  const falho = despachoParaRedespachar(lerLedger(dirThread(raiz, threadId)), plano.fase as Fase, gateDoPlano,
    plano.motivo === 'runtime.silencio');
  if (!falho || typeof falho.promptPath !== 'string' || typeof falho.promptSha256 !== 'string') {
    const detalhe = textoDoCatalogo((m) => m.retry.semDespachoFalho(plano.fase, threadId));
    registrarTentativa(false, detalhe);
    return { ...vazio, detalhe };
  }
  const perfilPedidoDoRetry = perfilPedidoDoDespacho(lerLedger(dir), plano.fase as Fase, falho, gateDoPlano);
  // RM-055: o impedimento do dono com prova local (confianca do diretorio) so volta ao runtime depois de
  // resolvido. Sem a prova, nada e despachado e a tentativa nao conta: a pausa do dono continua aberta.
  if (plano.motivo && ehImpedimentoDoDono(plano.motivo) && typeof falho.cwd === 'string') {
    const perfilFalho = perfilDoEvento(falho);
    const resolvido = impedimentoResolvido(plano.motivo, { cwd: falho.cwd,
      runtime: typeof falho.runtime === 'string' ? falho.runtime : '', configDir: perfilFalho?.configDir ?? null });
    if (resolvido === false) {
      const motivo = plano.motivo, cwd = falho.cwd;
      const detalhe = textoDoCatalogo((m) => m.retry.semConfianca(motivo, cwd, threadId));
      return { ...vazio, detalhe };
    }
  }
  // RM-063 (F3, GO-FIX): antes de devolver o prompt ao runtime, a prova de que nenhuma sessao viva trabalha na thread. O
  // despacho que falhou depois de abrir a sessao (o `claude --bg` lento) e o adaptador que lanca deixariam duas sessoes
  // na mesma worktree. Sem a prova, nada e redespachado, e a tentativa nao conta.
  const ids = [falho.sessionId, gateDoPlano?.sessionId].filter((x): x is string => typeof x === 'string' && !!x);
  const provar: ProvaDeVida = (conhecidos) => sessaoVivaNaThread(raiz, thread, conhecidos);
  let viva = provar(ids);
  // RM-063 (F4): `runtime.unavailable` sobe a escada de recuperacao (reerguer o daemon, o fallback do bloco, outro perfil),
  // sempre com o mesmo prompt e o mesmo sha256. Ate aqui o retry so sabia repetir o destino que tinha acabado de falhar.
  if (plano.motivo === 'runtime.unavailable') {
    let perfilFalho: PerfilDeDespacho | null = null;
    try { perfilFalho = perfilDoEvento(falho); } catch { perfilFalho = null; }
    // O destino de origem e o do pedido novo que abriu o episodio; o despacho do gate completa o que faltar.
    const origem = destinoDoEpisodio(lerLedger(dir), plano.fase as Fase);
    const perfilPedido = perfilPedidoDoDespacho(lerLedger(dir), plano.fase as Fase, falho, gateDoPlano);
    const sha = falho.promptSha256;
    // GO-FIX (achado 10): o caminho do ledger e relativo a quem despachou; o absoluto e o que o dono roda de qualquer lugar.
    const promptPath = localizarPromptGravado(raiz, threadId, falho.promptPath, sha) ?? falho.promptPath;
    const despacho = { promptPath, promptSha256: sha, perfil: origem?.perfil ?? perfilFalho,
      runtime: origem?.runtime ?? (typeof falho.runtime === 'string' ? falho.runtime : carregado.manifesto.runtime.adapter),
      model: origem?.model ?? (typeof falho.model === 'string' ? falho.model : null),
      effort: origem?.effort ?? (typeof falho.effort === 'string' ? falho.effort : plano.effort) };
    // GO-FIX (a conferir da revisao): com o daemon travado, o proprio `claude agents` pode nao responder, e a prova de vida
    // segurava a escada para sempre. No claude-bg, o degrau 1 reergue o daemon antes (o `--keep-workers` deixa as sessoes
    // de pe) e a prova e refeita; sem resposta de novo, nada sai, e na terceira vez seguida no episodio o dono e chamado.
    let daemonJaReerguido: ReturnType<typeof reerguerDaemon> | null = null;
    if (!viva.respondeu && despacho.runtime === 'claude-bg' && !opcoes.dryRun) {
      daemonJaReerguido = reerguerDaemon(opcoes.daemon ?? DAEMON_DO_CLAUDE, despacho.perfil);
      viva = provar(ids);
    }
    if (!viva.respondeu || viva.sessionId) {
      const { sessionId: sessao, detalhe: falhaDaConsulta } = viva;
      const detalhe = sessao ? textoDoCatalogo((m) => m.retry.sessaoAindaViva(sessao.slice(0, 8), threadId))
        : textoDoCatalogo((m) => m.retry.runtimeSemProva(falhaDaConsulta ?? '', threadId));
      registrarTentativa(false, detalhe, { conta: false, ...(sessao ? {} : { semProva: true }),
        ...(daemonJaReerguido ? { daemon: daemonJaReerguido } : {}) });
      const seguidas = sessao ? 0 : recusasSemProvaSeguidas(lerLedger(dir), plano.fase as Fase);
      if (seguidas >= LIMITE_SEM_PROVA && !opcoes.dryRun) {
        const escada = estadoDaEscada(lerLedger(dir), plano.fase as Fase);
        const motivo = textoDoCatalogo((m) => m.retry.escada.semResposta(seguidas, falhaDaConsulta ?? '-'));
        return { ...vazio, detalhe: escalarEscada(carregado, thread, plano.fase as Fase, despacho, escada.consumidos, plano.tentativas,
          plano.limite, motivo) };
      }
      return { ...vazio, detalhe };
    }
    if (perfilPedido) return redespacharNoPerfilPedido(falho, perfilPedido);
    const saida = subirAEscada({
      carregado, thread, fase: plano.fase as Fase, despacho,
      tentativas: plano.tentativas, limite: plano.limite, dryRun: opcoes.dryRun, daemon: opcoes.daemon, daemonJaReerguido,
      idsConhecidos: ids, provaDeVida: provar,
      redespachar: (d) => redespachar(carregado, thread, plano.fase as Fase, promptPath, sha, { runtime: d.runtime, perfil: d.perfil,
        model: d.model, effort: d.effort, origem: 'retry.escada', dryRun: opcoes.dryRun }),
      // RM-055 (D2): a recusa do runtime por um impedimento do dono nao gasta tentativa, tambem na escada.
      registrarTentativa: (ok, detalhe, extra = {}) => registrarTentativa(ok, detalhe,
        { ...extra, ...(ehImpedimentoDoDono(extra.motivoDoRedespacho) ? { conta: false } : {}) }),
    });
    return { ...vazio, executada: saida.executada, redespacho: saida.redespacho, detalhe: saida.detalhe };
  }
  if (!viva.respondeu || viva.sessionId) {
    const { sessionId: sessao, detalhe: falhaDaConsulta } = viva;
    const detalhe = sessao ? textoDoCatalogo((m) => m.retry.sessaoAindaViva(sessao.slice(0, 8), threadId))
      : textoDoCatalogo((m) => m.retry.runtimeSemProva(falhaDaConsulta ?? '', threadId));
    registrarTentativa(false, detalhe, { conta: false });
    return { ...vazio, detalhe };
  }
  const redespacho = redespachar(
    carregado,
    thread,
    plano.fase as Fase,
    falho.promptPath,
    falho.promptSha256,
    {
      effort: plano.effort,
      runtime: perfilPedidoDoRetry?.runtime ?? (typeof falho.runtime === 'string' ? falho.runtime : null),
      model: typeof falho.model === 'string' ? falho.model : null,
      ...(perfilPedidoDoRetry ? { perfil: perfilPedidoDoRetry.id, perfilPedido: perfilPedidoDoRetry } : {}),
      origem: 'retry.run',
      dryRun: opcoes.dryRun,
    }
  );
  // RM-055 (continuacao, D2): o runtime recusou o redespacho por um motivo que so o dono resolve. Nada rodou
  // e a espera do dono voltou com o mesmo comando: a recusa fica no ledger, mas nao gasta tentativa nem sobe
  // esforco. Contada, a quarta chamada escalava e o retry nunca mais re-despachava, nem depois do aceite.
  const recusaDoDono = !redespacho.ok && ehImpedimentoDoDono(redespacho.motivo);
  registrarTentativa(redespacho.ok, redespacho.detalhe, recusaDoDono ? { conta: false } : {});
  return {
    ...vazio,
    executada: redespacho.ok,
    redespacho,
    detalhe: redespacho.detalhe,
  };
}

/**
 * D5 + RM-064 T2/T3: rotação depois de falha da conta. Produção parcial sob cota segue com um
 * checkpoint derivado do ledger e do Git; sem produção, o prompt original segue no próximo
 * destino. Recusa da conta no redespacho continua a rotação dentro do limite de tentativas.
 * Sem destino: fila até o menor prazo, ou o humano quando nenhum prazo existe.
 */
function rotacionarConta(carregado: ManifestoCarregado, thread: Thread, plano: PlanoDeRetry, opcoes: OpcoesDeExecucao,
  vazio: ResultadoDeRetry, registrarTentativa: (ok: boolean, detalhe: string) => void): ResultadoDeRetry {
  const { raiz, manifesto } = carregado;
  const dir = dirThread(raiz, thread.id);
  const fase = plano.fase as Fase;
  const motivo = plano.motivo as MotivoGate;
  const eventos = lerLedger(dir);
  const gate = ultimaReprovacao(raiz, thread.id);
  const despacho = despachoDaFalha(eventos, gate, fase);
  const escalar = (razao: string, diagnostico: string): ResultadoDeRetry => {
    if (!opcoes.dryRun) {
      registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo: 'human.pending', modo: thread.modo, detalhe: diagnostico,
        diagnostico, correcao: `ork gate request ${thread.id}`, fase, origem: 'retry.rotacao', pausaQualquerModo: true });
      registrar(dir, thread.id, TIPOS_DE_EVENTO.retryEscalado, { fase, motivo, origem: 'retry.rotacao', acao: plano.acao,
        tentativas: plano.tentativas, limite: plano.limite, modo: thread.modo, razao });
    }
    return { ...vazio, detalhe: diagnostico };
  };
  if (!despacho || typeof despacho.promptPath !== 'string' || typeof despacho.promptSha256 !== 'string') {
    const detalhe = textoDoCatalogo((m) => m.retry.semDespachoComPrompt(motivo, fase));
    registrarTentativa(false, detalhe);
    return { ...vazio, detalhe };
  }
  const runtime = typeof despacho.runtime === 'string' ? despacho.runtime : manifesto.runtime.adapter;
  let perfil: PerfilDeDespacho | null;
  try {
    perfil = typeof gate?.sessionId === 'string'
      ? perfilDoRegistro(eventos, { sessionId: gate.sessionId, despachadaEm: typeof gate.despachoEm === 'string' ? gate.despachoEm : undefined })
      : perfilDoEvento(despacho);
  } catch (e) {
    const erro = (e as Error).message;
    return escalar('perfil registrado invalido', textoDoCatalogo((m) => m.retry.rotacaoRecusada(erro)));
  }

  // RM-064 T3: produção parcial sob cota é preservada no checkpoint; não é razão para recomeçar nem escalar.
  let checkpoint = false;
  if (typeof gate?.sessionId === 'string' && typeof gate.despachoEm === 'string') {
    const producao = producaoNoIntervalo(raiz, thread, { sessionId: gate.sessionId, fase, despachadaEm: gate.despachoEm }, eventos);
    checkpoint = motivo === 'runtime.quota-exhausted' &&
      (producao.produziu || gate?.origem === 'account.quota-exhausted');
  }

  const promptOriginalPath = typeof despacho.promptOriginalPath === 'string' ? despacho.promptOriginalPath : despacho.promptPath;
  const promptOriginalSha = typeof despacho.promptOriginalSha256 === 'string' ? despacho.promptOriginalSha256 : despacho.promptSha256;

  const doBloco = configDoBloco(lerSetup(raiz), thread.modo, fase);
  const fallback = alvosDeFallback(doBloco, doBloco?.runtime ?? manifesto.runtime.adapter)
    .filter(f => capacidadeDoRuntimeNoProjeto(raiz, f.runtime).capaz);
  const politica = politicaDeRotacao(manifesto);
  const falha = sinalDoGate(gate, motivo);
  // I-33 (D12): o observador ja marca o perfil no caminho terminal; remarcar empurraria o prazo a cada retry.
  // RM-037 (fatia 5, aviso da rodada 1 do CHECK): a cota que ele viu ao vivo ja marcou ate a hora da mensagem.
  if (!opcoes.dryRun && perfil && !jaMarcado(raiz, perfil, falha) && !cotaJaVistaAoVivo(eventos, gate, falha)) {
    try { marcarContaDaFalha(carregado, perfil, falha); } catch { /* o store pode ja estar marcado */ }
  }
  const tentados: string[] = [];
  const implicitos: string[] = perfil ? [] : [runtime];
  let atual = { runtime, perfil };
  let tentativas = plano.tentativas;
  let ultimo: ResultadoDoRedespacho | null = null;
  let falhaAtual = falha;
  const emitir = (para: AlvoDaRotacao | null, razao: string) => {
    if (!opcoes.dryRun) registrar(dir, thread.id, TIPOS_DE_EVENTO.perfilRotacionado, { fase, motivo: falhaAtual.motivo, origem: 'retry.rotacao',
      de: { runtime: atual.runtime, perfil: atual.perfil?.id ?? null },
      para: para ? { runtime: para.runtime, perfil: para.perfil?.id ?? null } : null,
      evidencia: falhaAtual.trecho, razao, promptSha256: promptOriginalSha, modo: thread.modo,
      autorizadoPor: `politica de retry da I-33 (D5), bloco sem pausa ou delegado no modo ${thread.modo}` });
  };
  for (;;) {
    const alvo = proximoAlvo(raiz, atual, fallback, { perfis: tentados, runtimesImplicitos: implicitos }, politica);
    if (!alvo) break;
    emitir(alvo, alvo.runtime === atual.runtime ? 'proximo perfil ativo do mesmo runtime' : 'fallback de runtime pela ordem do bloco');
    const mudouRuntime = alvo.runtime !== runtime;
    ultimo = redespachar(carregado, thread, fase, promptOriginalPath, promptOriginalSha, {
      runtime: alvo.runtime, perfil: alvo.perfil?.id ?? null,
      model: mudouRuntime ? alvo.model : typeof despacho.model === 'string' ? despacho.model : null,
      effort: mudouRuntime ? alvo.effort ?? (typeof despacho.effort === 'string' ? despacho.effort : null) : plano.effort,
      origem: 'retry.rotacao', checkpoint, dryRun: opcoes.dryRun,
    });
    registrarTentativa(ultimo.ok, ultimo.detalhe);
    tentativas += 1;
    if (ultimo.ok || opcoes.dryRun) return { ...vazio, executada: ultimo.ok, redespacho: ultimo, detalhe: ultimo.detalhe };
    // So a recusa da CONTA no redespacho (nada rodou) continua a rotacao; outra falha para aqui.
    if (!ultimo.falhaDeConta && ultimo.motivo !== 'runtime.auth-missing' && ultimo.motivo !== 'runtime.quota-exhausted')
      return { ...vazio, redespacho: ultimo, detalhe: ultimo.detalhe };
    if (alvo.perfil) tentados.push(alvo.perfil.id); else implicitos.push(alvo.runtime);
    atual = { runtime: alvo.runtime, perfil: alvo.perfil };
    // GO-FIX (R4b): destino que recusou o MODELO sai da rotacao, mas a falha que manda (e o motivo da
    // fila) continua sendo a da conta; o modelo inacessivel tem troca propria (trocarDestinoDoModelo).
    if (ultimo.falhaDeConta?.motivo !== 'runtime.model-unavailable') falhaAtual = ultimo.falhaDeConta ?? falhaAtual;
    if (tentativas >= plano.limite) {
      const feitas = tentativas;
      return escalar('limite de tentativas na rotacao', textoDoCatalogo((m) => m.retry.limiteDaRotacao(feitas, motivo, fase, plano.limite)));
    }
  }

  // Sem destino: a fila so faz sentido quando algum perfil tem prazo para voltar. Sem perfil (ambiente do
  // processo), o prazo e o horario dito pelo proprio runtime, quando ainda esta no futuro.
  const runtimes = [runtime, ...fallback.map(f => f.runtime)];
  const dito = !perfil && falhaAtual.resetEm !== null && Date.parse(falhaAtual.resetEm) > Date.now() ? falhaAtual.resetEm : null;
  const prazo = prazoDaFila(lerPerfisComContas(raiz), runtimes, politica) ?? dito;
  if (!prazo && falhaAtual.motivo === 'runtime.auth-missing') {
    emitir(null, 'nenhum perfil com login em nenhum runtime da ordem de fallback');
    return escalar('auth ausente sem alternativa', textoDoCatalogo((m) => m.retry.semLogin));
  }
  const liberaEm = prazo ?? new Date(Date.now() + janelaPadraoMs(manifesto)).toISOString();
  emitir(null, `nenhum perfil ativo em ${runtimes.join(', ')}: fila duravel ate ${liberaEm}`);
  if (opcoes.dryRun) return { ...vazio, detalhe: textoDoCatalogo((m) => m.retry.entrariaNaFila(liberaEm)) };
  let pedido = enfileirar(carregado, { thread: thread.id, fase, slug: typeof despacho.slug === 'string' ? despacho.slug : slugDaSessao(thread, fase),
    promptPath: promptOriginalPath, promptSha256: promptOriginalSha,
    cwd: typeof despacho.cwd === 'string' ? despacho.cwd : thread.worktree ?? raiz,
    model: typeof despacho.model === 'string' ? despacho.model : null, effort: typeof despacho.effort === 'string' ? despacho.effort : null,
    sinal: { resetEm: prazo, fonte: prazo ? 'iso' : 'sem-horario', trecho: falhaAtual.trecho },
    detalhe: `${falhaAtual.motivo}: nenhum perfil ativo em ${runtimes.join(', ')}`, runtime, perfil: null, motivo: falhaAtual.motivo });
  if (checkpoint) pedido = gravarPedido(raiz, { ...pedido, checkpoint: true } as PedidoComCheckpoint);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.rateLimitEnfileirado, { fase, slug: pedido.slug, pedido: pedido.id, liberaEm: pedido.liberaEm,
    janelaEstimada: pedido.janelaEstimada, motivo: falhaAtual.motivo, promptSha256: promptOriginalSha, checkpoint,
    correcao: `ork retry resume (ou aguarde ate ${pedido.liberaEm})` });
  registrarTentativa(true, `fila duravel: pedido ${pedido.id} libera em ${pedido.liberaEm}`);
  return { ...vazio, executada: true, fila: [pedido], redespacho: ultimo, detalhe: textoDoCatalogo((m) => m.retry.pedidoAte(pedido.id, pedido.liberaEm)) };
}

/** RM-037 (defeitosdeco D-6): chave de um destino (runtime, perfil, modelo) que recusou o modelo. */
function chaveDoModelo(runtime: string, perfil: string | null, model: string | null): string {
  return `${runtime}|${perfil ?? ''}|${model ?? ''}`;
}

/**
 * D-6: todo destino que ja recusou o modelo nesta fase, lido do ledger. O gate do observador traz o
 * `sessionId` (o modelo vem do `phase_dispatch` dele); o do despacho sincrono, o ultimo
 * `phase_dispatch_failed` da fase antes dele.
 */
function destinosQueRecusaramOModelo(eventos: readonly EventoLedger[], fase: Fase): string[] {
  const chaves: string[] = [];
  const chaveDo = (origem: EventoLedger): string | null => {
    if (typeof origem.runtime !== 'string') return null;
    let perfil: PerfilDeDespacho | null = null;
    try { perfil = perfilDoEvento(origem); } catch { /* perfil ilegivel nao exclui ninguem */ }
    return chaveDoModelo(origem.runtime, perfil?.id ?? null, typeof origem.model === 'string' ? origem.model : null);
  };
  eventos.forEach((e, i) => {
    // GO-FIX (R4a): a recusa sincrona do redespacho (nada rodou) so grava `phase_dispatch_failed`.
    if (e.tipo === TIPOS_DE_EVENTO.despachoFalhou && e.fase === fase && String(e.erro ?? '').startsWith('runtime.model-unavailable')) {
      const chave = chaveDo(e);
      if (chave) chaves.push(chave);
      return;
    }
    if (e.tipo !== TIPOS_DE_EVENTO.gateBloqueado || e.fase !== fase || e.motivo !== 'runtime.model-unavailable') return;
    const origem = typeof e.sessionId === 'string'
      ? eventos.filter(d => d.tipo === TIPOS_DE_EVENTO.faseDespachada && d.sessionId === e.sessionId).at(-1)
      : eventos.slice(0, i).filter(d => d.tipo === TIPOS_DE_EVENTO.despachoFalhou && d.fase === fase).at(-1);
    const chave = origem ? chaveDo(origem) : null;
    if (chave) chaves.push(chave);
  });
  return chaves;
}

/**
 * D-6: o proximo destino do MESMO prompt depois de `runtime.model-unavailable`. Primeiro outro perfil do
 * mesmo runtime com o MESMO modelo (outra conta pode ter acesso), depois cada runtime da ordem de
 * fallback do bloco com o modelo dele. Perfil fora do rodizio (esgotado, sem login, desativado, pago)
 * nao entra, e nenhum destino que ja recusou volta. Sem destino, `null`.
 */
function proximoDestinoDoModelo(raiz: string, runtime: string, model: string | null, fallback: readonly AlvoDeFallback[],
    recusados: ReadonlySet<string>): AlvoDaRotacao | null {
  const store = lerPerfisComContas(raiz);
  const mesmo = capacidadeDaRotacao(raiz, runtime, true).capaz
    ? perfisDisponiveis(store, runtime).find(p => !recusados.has(chaveDoModelo(runtime, p.id, model))) : null;
  if (mesmo) return { runtime, perfil: perfilDeDespacho(mesmo), model, effort: null };
  for (const f of fallback) {
    if (!capacidadeDoRuntimeNoProjeto(raiz, f.runtime).capaz) continue;
    const perfis = perfisDoRuntime(store, f.runtime);
    if (perfis.length) {
      const p = perfisDisponiveis(store, f.runtime).find(x => !recusados.has(chaveDoModelo(f.runtime, x.id, f.model)));
      if (p) return { runtime: f.runtime, perfil: perfilDeDespacho(p), model: f.model, effort: f.effort ?? null };
      continue;
    }
    if (!recusados.has(chaveDoModelo(f.runtime, null, f.model))) return { runtime: f.runtime, perfil: null, model: f.model, effort: f.effort ?? null };
  }
  return null;
}

/** D-6: a correcao exata quando nenhum destino tem o modelo: o bloco do setup que conduz a fase. */
function correcaoDoModelo(thread: Thread, fase: Fase, m: Mensagens = msg()): string {
  const indice = MODOS[thread.modo as ModoLegado]?.blocos.findIndex(b => (b.fases as readonly string[]).includes(fase)) ?? -1;
  const bloco = indice >= 0 ? String(indice + 1) : 'N';
  return m.retry.correcaoDoModelo(thread.modo, bloco);
}

/**
 * RM-037 (defeitosdeco D-6): troca de destino depois de `runtime.model-unavailable`. O modelo pedido nao
 * existe ou a conta nao tem acesso a ele (`model_not_found` na transcricao); o perfil continua no
 * rodizio e o MESMO prompt segue no proximo destino (`proximoDestinoDoModelo`). Producao no intervalo
 * escala ao humano, como na rotacao por conta. Recusa do modelo no redespacho (nada rodou) continua a
 * troca na mesma chamada, dentro do limite de tentativas. Sem destino, o humano recebe a correcao exata.
 */
function trocarDestinoDoModelo(carregado: ManifestoCarregado, thread: Thread, plano: PlanoDeRetry, opcoes: OpcoesDeExecucao,
  vazio: ResultadoDeRetry, registrarTentativa: (ok: boolean, detalhe: string) => void): ResultadoDeRetry {
  const { raiz, manifesto } = carregado;
  const dir = dirThread(raiz, thread.id);
  const fase = plano.fase as Fase;
  const motivo: MotivoGate = 'runtime.model-unavailable';
  const eventos = lerLedger(dir);
  const gate = ultimaReprovacao(raiz, thread.id);
  const despacho = despachoDaFalha(eventos, gate, fase);
  const escalar = (razao: string, diagnostico: string): ResultadoDeRetry => {
    if (!opcoes.dryRun) {
      registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo: 'human.pending', modo: thread.modo, detalhe: diagnostico,
        diagnostico, correcao: `ork gate request ${thread.id}`, fase, origem: 'retry.modelo', pausaQualquerModo: true });
      registrar(dir, thread.id, TIPOS_DE_EVENTO.retryEscalado, { fase, motivo, origem: 'retry.modelo', acao: plano.acao,
        tentativas: plano.tentativas, limite: plano.limite, modo: thread.modo, razao });
    }
    return { ...vazio, detalhe: diagnostico };
  };
  if (!despacho || typeof despacho.promptPath !== 'string' || typeof despacho.promptSha256 !== 'string') {
    const detalhe = textoDoCatalogo((m) => m.retry.semDespachoComPrompt(motivo, fase));
    registrarTentativa(false, detalhe);
    return { ...vazio, detalhe };
  }
  const runtime = typeof despacho.runtime === 'string' ? despacho.runtime : manifesto.runtime.adapter;
  const model = typeof despacho.model === 'string' ? despacho.model : null;
  let perfil: PerfilDeDespacho | null;
  try {
    perfil = typeof gate?.sessionId === 'string'
      ? perfilDoRegistro(eventos, { sessionId: gate.sessionId, despachadaEm: typeof gate.despachoEm === 'string' ? gate.despachoEm : undefined })
      : perfilDoEvento(despacho);
  } catch (e) {
    const erro = (e as Error).message;
    return escalar('perfil registrado invalido', textoDoCatalogo((m) => m.retry.trocaRecusada(erro)));
  }
  if (typeof gate?.sessionId === 'string' && typeof gate.despachoEm === 'string') {
    const producao = producaoNoIntervalo(raiz, thread, { sessionId: gate.sessionId, fase, despachadaEm: gate.despachoEm }, eventos);
    if (producao.produziu) {
      return escalar('producao parcial com modelo inacessivel',
        textoDoCatalogo((m) => m.retry.producaoParcialModelo(model ?? m.retry.padraoDoRuntime, String(producao.evidencia))));
    }
  }
  const recusados = new Set([...destinosQueRecusaramOModelo(eventos, fase), chaveDoModelo(runtime, perfil?.id ?? null, model)]);
  const doBloco = configDoBloco(lerSetup(raiz), thread.modo, fase);
  const fallback = alvosDeFallback(doBloco, doBloco?.runtime ?? manifesto.runtime.adapter)
    .filter(f => capacidadeDoRuntimeNoProjeto(raiz, f.runtime).capaz);
  let atual = { runtime, perfil, model };
  let tentativas = plano.tentativas;
  for (;;) {
    const alvo = proximoDestinoDoModelo(raiz, runtime, model, fallback, recusados);
    if (!alvo) break;
    if (!opcoes.dryRun) registrar(dir, thread.id, TIPOS_DE_EVENTO.perfilRotacionado, { fase, motivo, origem: 'retry.modelo',
      de: { runtime: atual.runtime, perfil: atual.perfil?.id ?? null, model: atual.model },
      para: { runtime: alvo.runtime, perfil: alvo.perfil?.id ?? null, model: alvo.model },
      razao: alvo.runtime === runtime ? 'outro perfil do mesmo runtime com o mesmo modelo' : 'fallback de runtime pela ordem do bloco',
      promptSha256: despacho.promptSha256, modo: thread.modo,
      autorizadoPor: `politica de retry da RM-037 (D-6), bloco sem pausa ou delegado no modo ${thread.modo}` });
    const mudouRuntime = alvo.runtime !== runtime;
    const r = redespachar(carregado, thread, fase, despacho.promptPath, despacho.promptSha256, {
      runtime: alvo.runtime, perfil: alvo.perfil?.id ?? null, model: alvo.model,
      effort: mudouRuntime ? alvo.effort ?? (typeof despacho.effort === 'string' ? despacho.effort : null) : plano.effort,
      origem: 'retry.modelo', dryRun: opcoes.dryRun,
    });
    if (opcoes.dryRun) return { ...vazio, redespacho: r, detalhe: textoDoCatalogo((m) => m.retry.ensaioDoModelo(alvo.runtime,
      alvo.perfil ? alvo.perfil.id : null, alvo.model ?? m.retry.padraoDoRuntime, remontar(r.detalhe))) };
    registrarTentativa(r.ok, r.detalhe);
    tentativas += 1;
    if (r.ok) return { ...vazio, executada: true, redespacho: r, detalhe: r.detalhe };
    // So a recusa do MODELO no redespacho (nada rodou) continua a troca; outra falha para aqui.
    if (r.falhaDeConta?.motivo !== 'runtime.model-unavailable') return { ...vazio, redespacho: r, detalhe: r.detalhe };
    recusados.add(chaveDoModelo(alvo.runtime, alvo.perfil?.id ?? null, alvo.model));
    atual = { runtime: alvo.runtime, perfil: alvo.perfil, model: alvo.model };
    if (tentativas >= plano.limite) {
      const feitas = tentativas;
      return escalar('limite de tentativas na troca de modelo', textoDoCatalogo((m) => m.retry.limiteDaTroca(feitas, motivo, fase, plano.limite)));
    }
  }
  const tentados = [...recusados].map(k => { const [rt, p, m] = k.split('|'); return `${rt}${p ? `/${p}` : ''}:${m || '(padrao)'}`; });
  return escalar('modelo inacessivel sem outro destino', textoDoCatalogo((m) => m.retry.modeloSemDestino(model ?? m.retry.padraoDoRuntime,
    tentados.join(', '), correcaoDoModelo(thread, fase, m))));
}

/** Texto de `ork retry plan`. */
export function textoDoPlano(p: PlanoDeRetry): string {
  // RM-061 (F2b, G2): a razao e o detalhe que este processo montou saem remontados no locale; o detalhe lido
  // do ledger (gravado por outro processo) e a politica pelo motivo saem como o catalogo os traz.
  const m = msg().retry;
  const linhas: string[] = [];
  linhas.push(m.titulo(p.thread));
  linhas.push(m.modo(p.modo));
  linhas.push(m.fase(p.fase));
  linhas.push(m.motivo(p.motivo));
  const detalhe = remontar(p.detalhe);
  if (p.detalhe) linhas.push(m.detalhe(localizarTexto(detalhe)));
  linhas.push(m.acao(p.acao));
  linhas.push(m.tentativas(p.tentativas, p.limite));
  linhas.push(m.esforco(p.effort, p.effort !== p.effortAnterior ? p.effortAnterior : null));
  linhas.push(m.automatica(p.automatica));
  // RM-063 (F4): o degrau da escada de `runtime.unavailable`, ou o fim dela.
  const escada = p.escada;
  if (escada) linhas.push(escada.degrau && escada.tipo ? m.escada.noPlano(escada.degrau, m.escada.degraus[escada.tipo]) : m.escada.noPlanoEsgotada);
  if (p.bloqueio) linhas.push(m.bloqueio(p.bloqueio));
  linhas.push(m.razao(remontar(p.razao)));
  if (p.politica && !p.automatica) linhas.push(m.correcao(p.motivo ? m.politica[p.motivo].correcao : p.politica.correcao));
  if (p.detalhe && localizarTexto(detalhe) !== detalhe) linhas.push(legendaDoFuso());
  return linhas.join('\n');
}

/** Texto de `ork retry run`. */
export function textoDoRetry(r: ResultadoDeRetry): string {
  const m = msg().retry;
  const plano = textoDoPlano(r.plano);
  const linhas: string[] = [plano, ''];
  const detalhe = remontar(r.detalhe);
  linhas.push(m.execucao(r.executada));
  linhas.push(m.linhaDoDetalhe(localizarTexto(detalhe)));
  if (r.rodada && r.rodada.correcoes.length > 0) {
    linhas.push('');
    linhas.push(m.rodada(r.rodada.rodada, r.rodada.correcoes.map((c) => m.correcaoDaRodada(c.id, c.tipo, c.origem)).join(', ')));
  }
  if (r.reverify) {
    linhas.push(m.reverify(m.vereditos[r.reverify.veredito] ?? r.reverify.veredito, m.coberturas[r.reverify.cobertura] ?? r.reverify.cobertura));
  }
  if (r.fila.length > 0) {
    linhas.push('');
    linhas.push(m.fila);
    for (const p of r.fila) {
      linhas.push(m.pedidoNaFila(p.id, p.fase, formatarDataHora(p.liberaEm), p.janelaEstimada));
    }
  }
  if ((r.fila.length > 0 || localizarTexto(detalhe) !== detalhe) && !plano.includes(legendaDoFuso())) {
    linhas.push(legendaDoFuso());
  }
  return linhas.join('\n');
}

/** Texto de `ork retry resume`. */
export function textoDaRetomada(rs: ResultadoDaRetomada[]): string {
  const m = msg().retry.complementar;
  if (rs.length === 0) {
    return m.retomadaVazia;
  }
  const linhas: string[] = [];
  for (const r of rs) {
    linhas.push(m.retomadaCabecalho(r.pedido.id, r.pedido.thread, r.pedido.fase));
    linhas.push(m.playbook(r.playbook));
    linhas.push(m.slug(r.slug));
    linhas.push(m.retomada(r.despachada, r.sessionId));
    if (r.motivo) linhas.push(m.motivoRetomada(r.motivo));
    linhas.push(m.detalhe(localizarTexto(r.detalhe)));
    linhas.push(m.estado(m.estados[r.pedido.estado] ?? r.pedido.estado));
  }
  if (rs.some((r) => localizarTexto(r.detalhe) !== r.detalhe)) linhas.push(legendaDoFuso());
  return linhas.join('\n');
}
