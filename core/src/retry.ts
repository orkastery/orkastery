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
import { ManifestoCarregado } from './manifest';
import { hashDoPrompt, concluirDespacho, ContextoDeDespacho, EscolhaDePerfil, perfilParaDespacho, resolverDespacho, slugDaSessao,
  baselineDoDespachoNecessaria, estadoParaDespacho, garantirBaselineDoDespacho, modoDaSessaoDoBloco, prazoDaSessao } from './phase';
import { ContextoRuntime, contextoDoProjeto, novaIdentidadeDeDespacho } from './runtime-context';
import { proximaRotacao } from './slug';
import { avaliarPolicies, bloqueantes, motivoDominante } from './policies';
import { aguardando, enfileirar, exigirPedido, gravarPedido, janelaPadraoMs, lerFilaDeRetomada, marcarContaDaFalha, PedidoComPerfil,
  vencidos } from './ratelimit';
import { eventosDoIntervalo, fonteRegistrada, headDaWorktree, saidaDoArtefato } from './session-watcher-claude';
import {
  lerPerfis, lerPerfisComContas, perfilDeDespacho, PerfilDeDespacho, perfilDoRegistro, perfisDoRuntime, PoliticaDeRotacao, politicaDeRotacao,
  perfilDisponivel, PerfilDeRuntime, prazoDaFila, prazoDoRuntime, proximoPerfilDisponivel,
  validarPerfilDeDespacho,
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
import { ResultadoSync, sincronizarWorktree } from './worktree';
import { avaliarDelegacao, conteudoDePremissas } from './delegation';
import { aprovacoesHumanas } from './gates';
import { formatarDataHora, legendaDoFuso, localizarTexto } from './horario';
import {
  ambienteDaConducao, canalDoProcesso, conducaoDaThread, ConducaoTomada, recusaDeConducao, registrarRecusa, tomarConducao,
} from './conducao';
import { linhaDeConducao } from './conducao-texto';
import { CanalDeConducao } from './types';

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
    porque:
      'o artefato exigido pela fase nao existe: a fase precisa de spec dirigida do que gravar, nao de repeticao cega do mesmo prompt',
    correcao: 'ork fix open <thread> abre a rodada com a spec exata',
  },
  'claims.failed': {
    motivo: 'claims.failed',
    acao: 'corrigir-dirigido',
    automatica: true,
    porque:
      'a alegacao reprovou na reexecucao no HEAD real: reexecutar a fase igual reproduz a mesma mentira; o que resolve e GO-FIX com a claim e o comando exatos',
    correcao: 'ork fix open <thread> e depois ork fix reverify <thread>',
  },
  'claims.unverifiable': {
    motivo: 'claims.unverifiable',
    acao: 'corrigir-dirigido',
    automatica: true,
    porque:
      'alegacao sem comando de verificacao vira correcao tipo A: anexar o comando (ou retirar a alegacao com motivo) e uma linha, nao um GO inteiro',
    correcao: 'ork claims verificar <thread> <claim> --comando "<comando>"',
  },
  'policy.violation': {
    motivo: 'policy.violation',
    acao: 'escalar-humano',
    automatica: false,
    porque:
      'policy com severidade block reprova em qualquer modo: reexecutar sozinho seria a maquina revogando a policy do manifesto',
    correcao: 'corrija a violacao no pedido/manifesto; policy block nao se resolve por repeticao',
  },
  'runtime.autoconferencia': {
    motivo: 'runtime.autoconferencia',
    // `escalar-humano` e nao `sem-retry`: `sem-retry` e o lugar reservado a violacao
    // de CUSTO, e o teste do bloco B3 guarda essa exclusividade de proposito. Aqui a
    // maquina nao esta proibida de agir, ela esta sem o que escolher sozinha: quem
    // decide em que runtime o CHECK roda e quem conduz a thread.
    acao: 'escalar-humano',
    automatica: false,
    porque:
      'repetir o despacho no MESMO runtime daria o mesmo resultado: o que falta nao e tentativa, e um validador que nao seja quem executou. Escolher o outro runtime e decisao de conducao, nao retry',
    correcao:
      'despache o CHECK em outro runtime (`ork phase run <thread> CHECK --runtime <outro>`), ou tire a exigencia de validacao cruzada da thread se ela nao se justifica',
  },
  'cost.violation': {
    motivo: 'cost.violation',
    acao: 'sem-retry',
    automatica: false,
    porque:
      'violacao de CUSTO nunca recebe retry automatico: cada reexecucao gastaria de novo pelo provider pago (subscription-only e regra de codigo, nao lembrete)',
    correcao:
      'tire do ambiente a variavel que redireciona o despacho e rode a fase de novo a mao, com o gasto sob os olhos de um humano',
  },
  'verify.regression': {
    motivo: 'verify.regression',
    acao: 'corrigir-dirigido',
    automatica: true,
    porque:
      'o comando passava na baseline e falha agora: o defeito e desta thread e tem alvo conhecido, entao ele vira spec de GO-FIX tipo B',
    correcao: 'ork fix open <thread> (a reexecucao seguinte e completa)',
  },
  'verify.failed': {
    motivo: 'verify.failed',
    acao: 'corrigir-dirigido',
    automatica: true,
    porque:
      'o comando falha sem baseline para separar regressao de divida: a correcao dirigida conserta ou grava a baseline, mas nao chuta de quem e a culpa',
    correcao: 'ork fix open <thread>, ou ork verify <thread> --baseline antes do proximo GO',
  },
  'verify.timeout': {
    motivo: 'verify.timeout',
    acao: 'reexecutar',
    automatica: true,
    porque:
      'o prazo estourou antes de o comando terminar: a prova nao chegou ao fim, e carga de maquina nao e defeito. A reexecucao e completa, e o limite de escalacao do manifesto impede repetir para sempre',
    correcao: 'ork verify <thread> de novo; se estourar sempre, suba verify.timeout_ms no manifesto ou divida o comando',
  },
  'verify.sem-veredito': {
    motivo: 'verify.sem-veredito',
    acao: 'reexecutar',
    automatica: true,
    porque:
      'um comando nao chegou a rodar ou o produto mudou no meio da rodada: nao ha veredito sobre ele, e a prova certa e rodar de novo, inteira',
    correcao: 'ork verify <thread> de novo, sem editar a worktree durante a rodada',
  },
  'ci.failed': {
    motivo: 'ci.failed',
    acao: 'escalar-humano',
    automatica: false,
    porque:
      'o recibo pertence ao provedor e ao SHA candidato: repetir uma fase não cria nem altera legitimamente esse resultado',
    correcao: 'publique a candidata, aguarde o check obrigatório e repita o SHIP; se reprovou, corrija a causa registrada no runner',
  },
  'runtime.unavailable': {
    motivo: 'runtime.unavailable',
    acao: 'reexecutar',
    automatica: true,
    porque:
      'falha de infraestrutura no despacho nao e falha de conteudo: o MESMO prompt, com o mesmo sha256, e redespachado sem alterar uma virgula',
    correcao: 'ork retry run <thread> redespacha o prompt ja gravado em disco',
  },
  'runtime.silencio': {
    motivo: 'runtime.silencio', acao: 'reexecutar', automatica: true,
    porque: 'fase sem heartbeat: retomar o despacho original com hash conferido e limite de tentativas',
    correcao: 'ork retry run <thread> --motivo runtime.silencio',
  },
  'runtime.rate-limited': {
    motivo: 'runtime.rate-limited',
    acao: 'esperar-janela',
    automatica: true,
    porque:
      'o limite de uso tem HORA de volta: a fase entra na fila duravel e e retomada na janela seguinte, sem humano no meio e sem gastar por fora da assinatura',
    correcao: 'ork retry list mostra a fila; ork retry resume retoma o que ja liberou',
  },
  // I-33 (D5, D11): a falha e da CONTA. O perfil sai do rodizio e o MESMO prompt vai ao proximo
  // perfil ativo, depois ao runtime de fallback do bloco, e so por ultimo a fila duravel. A
  // rotacao so redespacha quando a prova do `ork` confirma que o intervalo nao produziu nada;
  // producao parcial sob cota esgotada vira `human.pending`, nunca redespacho sobre a worktree.
  'runtime.quota-exhausted': {
    motivo: 'runtime.quota-exhausted',
    acao: 'reexecutar',
    automatica: true,
    porque:
      'a cota ou os creditos da CONTA acabaram, nao a infraestrutura: o perfil sai do rodizio ate o prazo e o MESMO prompt, com o mesmo sha256, segue no proximo perfil, no runtime de fallback ou na fila ate o menor prazo',
    correcao: 'ork accounts list mostra o perfil esgotado; ork retry run <thread> rotaciona o prompt ja gravado',
  },
  'runtime.auth-missing': {
    motivo: 'runtime.auth-missing',
    acao: 'reexecutar',
    automatica: true,
    porque:
      'a conta do runtime perdeu a autenticacao: o perfil nunca mais recebe despacho ate o login ser refeito pelo proprio CLI, e o MESMO prompt segue no proximo perfil ou no runtime de fallback',
    correcao: 'ork accounts check confere o login de cada perfil; ork retry run <thread> rotaciona o prompt ja gravado',
  },
  // RM-037 (defeitosdeco D-6): o modelo e que falta, nao a conta. Repetir o mesmo modelo na mesma conta
  // so repete a recusa; o perfil continua no rodizio para os outros modelos.
  'runtime.model-unavailable': {
    motivo: 'runtime.model-unavailable',
    acao: 'reexecutar',
    automatica: true,
    porque:
      'o modelo pedido nao existe ou a conta nao tem acesso a ele: o MESMO prompt, com o mesmo sha256, segue no proximo perfil do mesmo runtime com o mesmo modelo e depois no fallback do bloco, nunca de novo no par que ja recusou',
    correcao: 'ork retry run <thread> troca o destino; sem destino, ork setup <modo> --bloco N --model <modelo acessivel> ou --fallback runtime:modelo',
  },
  'tree.blocked': {
    motivo: 'tree.blocked',
    acao: 'sincronizar-worktree',
    automatica: true,
    porque:
      'a arvore de destino andou por baixo da thread: rebasar a worktree contra a base e o passo que desbloqueia, e reexecutar antes disso so repete o conflito',
    correcao: 'ork worktree sync <thread> e so entao repetir o passo',
  },
  'lease.busy': {
    motivo: 'lease.busy',
    acao: 'reexecutar',
    automatica: true,
    porque:
      'o lease e de outra thread e vai ser liberado: a fila ja serializa, entao a acao e tentar de novo quando chegar a vez, nunca furar a fila',
    correcao: 'ork lease list mostra a fila; a vez chega sem ninguem forcar',
  },
  // I-36 (T6): a vez chega quando a conducao atual terminar. Redespachar agora so recebe a mesma recusa,
  // e passar na frente de quem conduz e exatamente o incidente de 19/09/2026.
  'conducao.em-andamento': {
    motivo: 'conducao.em-andamento',
    acao: 'esperar-janela',
    automatica: true,
    porque:
      'outra conducao executa na mesma worktree agora: a vez chega quando ela terminar, e furar a fila e o incidente de 19/09/2026',
    correcao: 'ork conducao status <thread> mostra quem conduz; repita o pedido com --esperar <min> para seguir sozinho quando liberar',
  },
  // I-41 (D10): formato e defeito de quem escreveu o pedido, e a spec dirigida conserta.
  // Escalar isto para o dono seria pedir que ele revise a sintaxe do robo.
  'hitl.formato': {
    motivo: 'hitl.formato',
    acao: 'corrigir-dirigido',
    automatica: true,
    porque:
      'o pedido HITL saiu fora do formato obrigatorio: quem errou foi o emissor, e a correcao e reemitir com alternativas rotuladas, consequencia por alternativa e exatamente uma recomendada com o porque',
    correcao: 'ork fix open <thread> abre a rodada com a spec exata do formato',
  },
  'human.pending': {
    motivo: 'human.pending',
    acao: 'escalar-humano',
    automatica: false,
    porque:
      'nao e reprovacao de verdade, e espera de autorizacao: automatizar a espera seria a maquina se autorizando',
    correcao: 'ork gate request <thread>',
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
  const linhas = Object.values(POLITICA_DE_RETRY).map((p) => [
    p.motivo,
    p.acao,
    p.automatica ? 'sim' : 'nao',
    p.porque,
  ]);
  return tabela(['MOTIVO TIPADO', 'ACAO DE RETRY', 'AUTOMATICA', 'POR QUE'], linhas);
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
  return lerLedger(dirThread(raiz, threadId)).filter(
    (e) => e.tipo === TIPOS_DE_EVENTO.retryTentado && e.fase === fase && e.motivo === motivo
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
      detalhe: 'nenhum gate reprovado no ledger desta thread',
      politica: null,
      acao: 'sem-retry',
      tentativas: 0,
      limite,
      effort: effortBase,
      effortAnterior: effortBase,
      automatica: false,
      bloqueio: 'gate.sem-reprovacao',
      razao: 'nao ha o que repetir: o ledger da thread nao tem reprovacao tipada pendente',
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
      razao: politica.porque,
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
      razao:
        `${tentativas} tentativa(s) automatica(s) por ${motivo} em ${fase}, no limite de ${limite} ` +
        'do manifesto: escalacao tipada pausa qualquer modo, inclusive #Auto',
    };
  }

  // Da 2a tentativa em diante o esforco sobe um degrau, quando o manifesto permite.
  // `tentativas` e quantas JA rodaram, entao a 1a tentativa (tentativas 0) sai no
  // esforco base do manifesto e so a partir da 2a a escada anda.
  const escala = manifesto.retry.escalar_esforco && tentativas >= 1;
  const effortAnterior = escalarEsforco(effortBase, Math.max(0, tentativas - 1));
  const effort = escala ? escalarEsforco(effortBase, tentativas) : effortBase;
  const acao: AcaoDeRetry = escala ? 'escalar-esforco' : politica.acao;

  const pausa = blocoPausa(thread, fase);
  const delegacao = avaliarDelegacao(manifesto, { thread: threadId, modo: thread.modo, fase,
    escopo: 'premissas', conteudo: detalhe + '\n' + conteudoDePremissas(raiz, threadId) });
  const autorizado = delegacao.permitida || aprovacoesHumanas(raiz, threadId).some(e => e.fase === fase && e.autorizadoPor === opcoes.autorizadoPor);
  let bloqueio: BloqueioDeRetry | null = null;
  let automatica = politica.automatica;
  let razao = politica.porque;
  if (delegacao.permitida && politica.automatica) razao += `; ${delegacao.razao}; delegado ${delegacao.delegado}; evidência ${delegacao.evidencia}`;

  if (!politica.automatica) {
    automatica = false;
    bloqueio = 'politica.nao-automatica';
  } else if (pausa && !autorizado) {
    // O bloco de loop deste modo pausa: o humano ja e parte do caminho aqui, e por isso
    // a acao fica planejada e nao executada. `#Maestro` e `#Auto` nao caem neste ramo.
    automatica = false;
    bloqueio = 'modo.bloco-pausa';
    razao =
      `o bloco ${blocoDaThread(thread, fase).fases.join('-')} pausa neste modo ` +
      `(${blocoDaThread(thread, fase).pausaSobre}): a acao ${acao} espera autorizacao humana. ` +
      'O modo afrouxa a pausa, nunca a verificacao.';
  }

  if (motivo === 'runtime.silencio') {
    const despacho = ultimoDespachoFalho(raiz, threadId, fase, true);
    const prova = opcoes.estadoDaSessao;
    if (!prova || prova.sessionId !== despacho?.sessionId || !estadoTerminalDeRetry(prova.estado)) {
      automatica = false;
      bloqueio = 'politica.nao-automatica';
      razao = 'runtime.silencio exige prova terminal atual da mesma sessao; ausencia ou silencio nao provam morte';
    }
  }
  return {
    thread: threadId, modo: thread.modo, fase, motivo, detalhe, politica, acao, tentativas,
    limite, effort, effortAnterior, automatica, bloqueio, razao,
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
   * RM-037 (defeito 1): o redespacho parou antes da sessao porque falta a baseline do bloco com GO no codex.
   * Interno: `redespachar` grava a baseline e repete; se ainda faltar, sai como `runtime.unavailable`.
   */
  baselinePendente?: true;
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
  slug?: string;
  model?: string | null;
  effort?: string | null;
  cwd?: string;
  origem?: string;
  dryRun?: boolean;
  /** I-36 (D6): canal de quem pede a retomada; sem ele, o que a borda declarou. */
  canal?: CanalDeConducao;
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
  const run = () => redespacharSobLock(carregado, lerThread(carregado.raiz, thread.id), fase, promptRelativo, sha, opcoes);
  if (opcoes.dryRun) return run();
  // RM-037 (defeito 1; A2, G1 e N3 do CHECK): o fallback do bloco leva a retomada ao codex. O redespacho
  // pede a baseline depois das guardas baratas e com a conducao tomada; ela e gravada aqui, fora do lock
  // HITL, e a retomada repete uma vez, como no `ork phase run`.
  const r = comLockHitl(carregado.raiz, thread.id, run);
  if (!r.baselinePendente) return r;
  garantirBaselineDoDespacho(carregado, thread.id, { fase, prompt: '', runtime: opcoes.runtime ?? undefined,
    model: opcoes.model ?? undefined, effort: opcoes.effort ?? undefined, ...(opcoes.canal ? { canal: opcoes.canal } : {}) });
  return comLockHitl(carregado.raiz, thread.id, run);
}

function redespacharSobLock(
  carregado: ManifestoCarregado,
  thread: Thread,
  fase: Fase,
  promptRelativo: string,
  sha: string,
  opcoes: OpcoesDeRedespacho = {}
): ResultadoDoRedespacho {
  const { raiz, manifesto } = carregado;
  const absoluto = path.isAbsolute(promptRelativo)
    ? promptRelativo
    : path.join(raiz, promptRelativo);
  const slug = opcoes.slug ?? slugDaSessao(thread, fase);
  const vazio = { slug, sessionId: null, verificada: false, sinal: null, comando: [] as string[] };
  const erroDeEstado = estadoParaDespacho(raiz, thread, opcoes.dryRun);
  if (erroDeEstado) return { ...vazio, ok: false, motivo: 'tree.blocked', detalhe: erroDeEstado, dryRun: opcoes.dryRun === true };

  if (!fs.existsSync(absoluto)) {
    return {
      ...vazio,
      ok: false,
      motivo: 'artifact.missing',
      detalhe: `o prompt gravado sumiu do disco: ${promptRelativo}`,
      dryRun: opcoes.dryRun === true,
    };
  }
  const prompt = fs.readFileSync(absoluto, 'utf8');
  const shaAtual = hashDoPrompt(prompt);
  if (shaAtual !== sha) {
    return {
      ...vazio,
      ok: false,
      motivo: 'artifact.missing',
      detalhe:
        `o prompt em ${promptRelativo} mudou desde o despacho original ` +
        `(sha256 ${shaAtual.slice(0, 12)} != ${sha.slice(0, 12)}): retomada e redespachar o MESMO texto`,
      dryRun: opcoes.dryRun === true,
    };
  }

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
      evidencia: `prompt sha256 ${sha} (retomada recusada antes de despachar)`,
    });
    return { ...vazio, ok: false, motivo, detalhe, dryRun: opcoes.dryRun === true };
  }

  // I-36 (T6): validado o pedido, a retomada toma a conducao antes de redespachar, como o
  // `ork phase run`. A mesma fase com o mesmo prompt de quem ja conduz nao abre sessao nova;
  // outro pedido espera a vez.
  const identidade = novaIdentidadeDeDespacho(thread.id, fase);
  const canal = opcoes.canal ?? canalDoProcesso();
  const doBlocoDaConducao = limitesDoBloco(manifesto, lerSetup(raiz), thread.modo, fase);
  const pedidoDeConducao = { canal, correlacao: null, operacao: 'retry.run' as const, fase, promptSha256: sha,
    identidade: identidade.dispatchId, prazoMs: prazoDaSessao(doBlocoDaConducao) };
  let conducao: ConducaoTomada | null = null;
  if (!opcoes.dryRun) {
    const tomada = tomarConducao(raiz, thread.id, pedidoDeConducao);
    if (!tomada.ok) {
      if (tomada.idempotente && tomada.atual) {
        registrar(dirThread(raiz, thread.id), thread.id, TIPOS_DE_EVENTO.despachoIdempotente, { fase, promptSha256: sha, canal,
          sessionId: tomada.atual.sessao, origem: opcoes.origem ?? 'retry',
          razao: 'mesma fase e mesmo prompt de quem ja conduz: a sessao em andamento atende a retomada, sem sessao nova' });
        return { ...vazio, ok: true, sessionId: tomada.atual.sessao, motivo: null, dryRun: false,
          detalhe: `a sessao ${String(tomada.atual.sessao).slice(0, 8)} ja conduz a fase ${fase} com este prompt: nada foi redespachado` };
      }
      const recusa = recusaDeConducao(thread.id, tomada.atual, pedidoDeConducao);
      registrarRecusa(raiz, recusa);
      return { ...vazio, ok: false, motivo: 'conducao.em-andamento', detalhe: recusa.texto, dryRun: false };
    }
    conducao = tomada;
  }
  try {
    const cwd = opcoes.cwd ?? thread.worktree ?? raiz;
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
    if (!opcoes.dryRun && baselineDoDespachoNecessaria(carregado, thread.id, { fase, prompt: '', runtime, model, effort })) {
      // A-1 do CHECK 3: a retomada recusada antes da sessao devolve o que a tomada consumiu.
      conducao?.devolver(); conducao = null;
      return { ...vazio, ok: false, motivo: 'runtime.unavailable', baselinePendente: true, dryRun: false,
        detalhe: `baseline.pendente: o bloco com GO no ${runtime} precisa da baseline antes da retomada` };
    }
    // D14 (GO-FIX 2): a retomada claude-bg abre com a mesma colaboração e o mesmo contexto de
    // runtime do `ork phase run`; sem eles, o PLAN retomado saía sem negar Edit, Write e
    // NotebookEdit e sem a allowlist do núcleo. O ramo Codex não muda.
    let contextoRuntime: ContextoRuntime | undefined;
    if (runtime === 'claude-bg') {
      try { contextoRuntime = contextoDoProjeto(raiz, runtime, cwd, thread.id); }
      catch (e) {
        return { ...vazio, ok: false, motivo: 'runtime.unavailable',
          detalhe: `runtime.unavailable: ${(e as Error).message}`, dryRun: opcoes.dryRun === true };
      }
      if (contextoRuntime) contextoRuntime.identidade = identidade;
    }
    // I-33 (D4, D7): a retomada escolhe o perfil como o `ork phase run`, com o login conferido.
    let escolha: EscolhaDePerfil;
    try { escolha = perfilParaDespacho(carregado, thread, fase, runtime, { perfil: opcoes.perfil ?? undefined, dryRun: opcoes.dryRun,
      origem: opcoes.origem ?? 'retry' }); }
    catch (e) { escolha = { perfil: null, configurados: 0, erro: (e as Error).message }; }
    if (escolha.erro) {
      const motivo = escolha.motivo ?? 'runtime.unavailable';
      const prazo = motivo === 'runtime.quota-exhausted' ? prazoDoRuntime(lerPerfisComContas(raiz), runtime, politicaDeRotacao(manifesto)) : null;
      return { ...vazio, ok: false, motivo, detalhe: `${motivo}: ${escolha.erro}`, dryRun: opcoes.dryRun === true,
        sinal: prazo ? { resetEm: prazo, fonte: 'iso', trecho: `menor esgotadoAte dos perfis ${runtime}` } : null };
    }
    const perfil = escolha.perfil ?? undefined;
    // I-33 (N1): o HEAD do GO codex sai antes do despacho, como no `ork phase run`.
    const headNoDespacho = fase === 'GO' && runtime === 'codex' && !opcoes.dryRun ? headDaWorktree(cwd) : undefined;
    const resultado = rt.despachar({
      prompt,
      nome: slug,
      cwd,
      model,
      effort,
      dryRun: opcoes.dryRun,
      sandbox: manifesto.runtime.sandbox,
      logDir: path.join(dirThread(raiz, thread.id), 'sessoes'),
      vinculo: { thread: thread.id, fase, promptSha256: sha },
      ...(perfil ? { perfil } : {}),
      // RM-037 (defeito 2): o modo plano segue a mesma regra do `ork phase run`, pelo bloco.
      ...(runtime === 'claude-bg' ? { contextoRuntime, ...(modoDaSessaoDoBloco(thread, fase).plano ? { colaboracao: 'plan' as const } : {}) } : {}),
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
        detalhe: 'ensaio (--dry-run): comando montado, nada despachado',
        sinal: null,
        comando: resultado.comando,
        dryRun: true,
      };
    }

    if (!resultado.ok || !resultado.sessionId) {
      registrar(dirThread(raiz, thread.id), thread.id, 'phase_dispatch_failed', { fase, runtime, slug, cwd,
        promptPath: absoluto, promptSha256: sha, controlador: resultado.controlador, model, effort,
        erro: resultado.erro ?? 'runtime.unavailable: sem sessionId', origem: 'retry', ...(perfil ? { perfil } : {}) });
      const sinal = resultado.rateLimit ?? null;
      // I-33 (D5): a conta recusou o redespacho; o perfil sai do rodizio aqui, onde a evidencia esta.
      if (resultado.falhaDeConta) {
        try { marcarContaDaFalha(carregado, perfil, resultado.falhaDeConta); } catch { /* a rotacao segue pelo motivo tipado */ }
      }
      return {
        ok: false,
        slug,
        sessionId: null,
        verificada: false,
        // I-33 (D11b): falha de conta reconhecida na saida e o motivo mais especifico.
        motivo: resultado.falhaDeConta?.motivo ?? (sinal ? 'runtime.rate-limited' : 'runtime.unavailable'),
        detalhe: resultado.erro ?? 'sem sessionId na saida do runtime',
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
      promptPath: absoluto,
      promptSha256: sha,
      runtime,
      cwd,
      model,
      effort,
      origem: opcoes.origem ?? 'retry',
      ...(perfil ? { perfil } : {}),
      ...(headNoDespacho !== undefined ? { headNoDespacho } : {}),
    };
    concluirDespacho(ctx, resultado.sessionId, resultado.verificada, resultado.comando, rt.fonteVerificacao, resultado.controlador);

    return {
      ok: true,
      slug,
      sessionId: resultado.sessionId,
      verificada: resultado.verificada,
      motivo: null,
      detalhe: `sessao ${resultado.sessionId} despachada com o mesmo prompt sha256 ${sha.slice(0, 12)}` +
        (perfil ? ` no perfil ${perfil.id} (${runtime})` : ''),
      sinal: null,
      perfil: perfil ?? null,
      comando: resultado.comando,
      dryRun: false,
    };
  } finally {
    // Retomada que nao virou sessao devolve a conducao; a que virou ja a entregou a sessao.
    conducao?.liberar();
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

/** Retoma UM pedido da fila, aplicando o playbook que couber. */
export function retomarPedido(
  carregado: ManifestoCarregado,
  pedidoOriginal: PedidoDeRetomada,
  opcoes: OpcoesDeRetomada = {}
): ResultadoDaRetomada {
  const { raiz } = carregado;
  const quando = opcoes.quando ?? agora();
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
  const doPedido = pedido as PedidoComPerfil;
  const alvo = alvoDaRetomada(carregado, thread, doPedido);
  const r: ResultadoDoRedespacho = !alvo.destino
    ? { ok: false, slug, sessionId: null, verificada: false, motivo: doPedido.motivo ?? 'runtime.quota-exhausted',
        detalhe: `${doPedido.motivo ?? 'runtime.quota-exhausted'}: nenhum perfil da vez disponivel em ${alvo.runtimes.join(', ')}`,
        sinal: null, comando: [], dryRun: opcoes.dryRun === true }
    : redespachar(carregado, thread, pedido.fase, pedido.promptPath, pedido.promptSha256, {
      slug,
      runtime: alvo.runtime,
      perfil: alvo.perfil ?? doPedido.perfil ?? null,
      model: alvo.model,
      effort: alvo.effort,
      cwd: pedido.cwd,
      origem: 'retry.rate-limit',
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
  if (pedido.motivo !== 'runtime.quota-exhausted' && pedido.motivo !== 'runtime.auth-missing')
    return { ...original, destino: true, runtimes: original.runtime ? [original.runtime] : [], contas: false };
  const doBloco = configDoBloco(lerSetup(raiz), thread.modo, pedido.fase);
  const principal = pedido.runtime ?? doBloco?.runtime ?? manifesto.runtime.adapter;
  const candidatos = [{ runtime: principal, model: pedido.model, effort: pedido.effort },
    ...alvosDeFallback(doBloco, doBloco?.runtime ?? manifesto.runtime.adapter).filter(f => f.runtime !== principal)
      .map(f => ({ runtime: f.runtime, model: f.model as string | null, effort: f.effort ?? pedido.effort }))];
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
  const mesmo = proximoPerfilDisponivel(store, atual.runtime, politica, { excluir: perfis, agoraMs });
  if (mesmo) return { runtime: atual.runtime, perfil: perfilDeDespacho(mesmo), model: null, effort: null };
  for (const f of fallback) {
    if (f.runtime === atual.runtime) continue;
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
    const cwd = typeof registro?.cwd === 'string' ? registro.cwd : typeof despacho?.cwd === 'string' ? despacho.cwd : thread.worktree ?? raiz;
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

/** O perfil ja esta fora do rodizio por esta falha (cota com prazo futuro, ou sem login)? */
function jaMarcado(raiz: string, perfil: PerfilDeDespacho, falha: SinalDeFalhaDeConta, agoraMs = Date.now()): boolean {
  let atual;
  try { atual = lerPerfis(raiz).perfis.find(p => p.id === perfil.id); } catch { return false; }
  if (!atual) return false;
  return falha.motivo === 'runtime.quota-exhausted'
    ? atual.estado === 'esgotado' && atual.esgotadoAte !== null && Date.parse(atual.esgotadoAte) > agoraMs
    : atual.estado === 'sem-auth';
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

export interface OpcoesDeExecucao extends OpcoesDePlano {
  dryRun?: boolean;
  /** Encadeia o CHECK-REVERIFY logo apos abrir a rodada de GO-FIX. */
  reverify?: boolean;
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
  const registrarTentativa = (ok: boolean, detalhe: string): void => {
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
    });
  };

  // I-36 (T6): conducao em andamento nao e fila de rate limit. Nada e redespachado; o registro diz
  // quem conduz, e a vez chega quando essa conducao terminar.
  if (plano.motivo === 'conducao.em-andamento') {
    const atual = conducaoDaThread(raiz, threadId);
    const detalhe = atual
      ? `${linhaDeConducao(atual)}; nada foi redespachado, a vez chega quando essa conducao terminar`
      : 'ninguem conduz a thread agora: o proximo pedido segue normalmente';
    registrarTentativa(!atual, detalhe);
    return { ...vazio, executada: false, detalhe };
  }

  // `esperar-janela`: quem retoma e a fila, e ela ja esta gravada em disco.
  if (acaoBase === 'esperar-janela') {
    const fila = lerFilaDeRetomada(raiz).filter(
      (p) => p.thread === threadId && p.estado === 'aguardando'
    );
    const detalhe =
      fila.length > 0
        ? `${fila.length} pedido(s) na fila duravel; o proximo libera em ${fila[0].liberaEm}`
        : 'nenhum pedido aguardando na fila para esta thread';
    registrarTentativa(fila.length > 0, detalhe);
    return { ...vazio, executada: fila.length > 0, fila, detalhe };
  }

  if (acaoBase === 'sincronizar-worktree') {
    const sync = sincronizarWorktree(carregado, threadId, { dryRun: opcoes.dryRun });
    const detalhe = sync.ok
      ? `worktree sincronizada com a base (${sync.passos.join('; ')})`
      : `sincronizacao nao concluiu: ${sync.detalhe}`;
    registrarTentativa(sync.ok, detalhe);
    return { ...vazio, executada: sync.ok, sync, detalhe };
  }

  if (acaoBase === 'corrigir-dirigido') {
    const rodada = abrirRodada(carregado, threadId);
    const reverify =
      opcoes.reverify && rodada.correcoes.length > 0
        ? reverificar(carregado, threadId, { rodada: rodada.rodada })
        : null;
    const detalhe =
      rodada.correcoes.length === 0
        ? 'o CHECK passou no HEAD real: nao ha correcao a dirigir'
        : `${rodada.correcoes.length} correcao(oes) na rodada ${rodada.rodada}` +
          (reverify ? `; CHECK-REVERIFY: ${reverify.veredito}` : '');
    registrarTentativa(rodada.correcoes.length > 0, detalhe);
    return { ...vazio, executada: rodada.correcoes.length > 0, rodada, reverify, detalhe };
  }

  if (plano.motivo === 'runtime.quota-exhausted' || plano.motivo === 'runtime.auth-missing') {
    return rotacionarConta(carregado, thread, plano, opcoes, vazio, registrarTentativa);
  }
  if (plano.motivo === 'runtime.model-unavailable') {
    return trocarDestinoDoModelo(carregado, thread, plano, opcoes, vazio, registrarTentativa);
  }

  // `reexecutar` e `escalar-esforco`: o MESMO prompt volta ao runtime.
  const falho = ultimoDespachoFalho(raiz, threadId, plano.fase as Fase, plano.motivo === 'runtime.silencio');
  if (!falho || typeof falho.promptPath !== 'string' || typeof falho.promptSha256 !== 'string') {
    const detalhe =
      `nao ha despacho falho registrado em ${plano.fase} com prompt gravado: ` +
      `rode a fase de novo com \`ork phase run ${threadId} ${plano.fase} --prompt "..."\``;
    registrarTentativa(false, detalhe);
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
      runtime: typeof falho.runtime === 'string' ? falho.runtime : null,
      model: typeof falho.model === 'string' ? falho.model : null,
      origem: 'retry.run',
      dryRun: opcoes.dryRun,
    }
  );
  registrarTentativa(redespacho.ok, redespacho.detalhe);
  return {
    ...vazio,
    executada: redespacho.ok,
    redespacho,
    detalhe: redespacho.detalhe,
  };
}

/**
 * D5 + D11: rotacao depois de falha da conta. Com sessao no gate (o observador classificou a
 * morte), a prova do `ork` decide antes: producao parcial vira `human.pending` com diagnostico.
 * Sem producao, o perfil sai do rodizio e o MESMO prompt segue no proximo destino; recusa da
 * conta no redespacho (nada rodou) continua a rotacao na mesma chamada, dentro do limite de
 * tentativas. Sem destino: fila ate o menor prazo, ou o humano quando nenhum prazo existe.
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
    const detalhe = `nao ha despacho com prompt gravado para ${motivo} em ${fase}: rode a fase de novo com ork phase run`;
    registrarTentativa(false, detalhe);
    return { ...vazio, detalhe };
  }
  const runtime = typeof despacho.runtime === 'string' ? despacho.runtime : manifesto.runtime.adapter;
  let perfil: PerfilDeDespacho | null;
  try {
    perfil = typeof gate?.sessionId === 'string'
      ? perfilDoRegistro(eventos, { sessionId: gate.sessionId, despachadaEm: typeof gate.despachoEm === 'string' ? gate.despachoEm : undefined })
      : perfilDoEvento(despacho);
  } catch (e) { return escalar('perfil registrado invalido', `rotacao recusada: ${(e as Error).message}`); }

  // D11 (c): sessao que morreu por cota depois de produzir nao e redespachada.
  if (typeof gate?.sessionId === 'string' && typeof gate.despachoEm === 'string') {
    const producao = producaoNoIntervalo(raiz, thread, { sessionId: gate.sessionId, fase, despachadaEm: gate.despachoEm }, eventos);
    if (producao.produziu) {
      return escalar('producao parcial sob falha da conta',
        `producao parcial sob ${motivo === 'runtime.quota-exhausted' ? 'cota esgotada' : 'auth ausente'}: ${producao.evidencia}; ` +
        'a sessao nao e redespachada sobre a worktree alterada e a fase nao conclui sem o humano');
    }
  }

  const doBloco = configDoBloco(lerSetup(raiz), thread.modo, fase);
  const fallback = alvosDeFallback(doBloco, doBloco?.runtime ?? manifesto.runtime.adapter);
  const politica = politicaDeRotacao(manifesto);
  const falha = sinalDoGate(gate, motivo);
  // I-33 (D12): o observador ja marca o perfil no caminho terminal; remarcar empurraria o prazo a cada retry.
  if (!opcoes.dryRun && perfil && !jaMarcado(raiz, perfil, falha)) {
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
      evidencia: falhaAtual.trecho, razao, promptSha256: despacho.promptSha256, modo: thread.modo,
      autorizadoPor: `politica de retry da I-33 (D5), bloco sem pausa ou delegado no modo ${thread.modo}` });
  };
  for (;;) {
    const alvo = proximoAlvo(raiz, atual, fallback, { perfis: tentados, runtimesImplicitos: implicitos }, politica);
    if (!alvo) break;
    emitir(alvo, alvo.runtime === atual.runtime ? 'proximo perfil ativo do mesmo runtime' : 'fallback de runtime pela ordem do bloco');
    const mudouRuntime = alvo.runtime !== runtime;
    ultimo = redespachar(carregado, thread, fase, despacho.promptPath, despacho.promptSha256, {
      runtime: alvo.runtime, perfil: alvo.perfil?.id ?? null,
      model: mudouRuntime ? alvo.model : typeof despacho.model === 'string' ? despacho.model : null,
      effort: mudouRuntime ? alvo.effort ?? (typeof despacho.effort === 'string' ? despacho.effort : null) : plano.effort,
      origem: 'retry.rotacao', dryRun: opcoes.dryRun,
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
      return escalar('limite de tentativas na rotacao', `${tentativas} tentativa(s) de rotacao por ${motivo} em ${fase}, no limite de ` +
        `${plano.limite} do manifesto: escalacao tipada pausa qualquer modo`);
    }
  }

  // Sem destino: a fila so faz sentido quando algum perfil tem prazo para voltar. Sem perfil (ambiente do
  // processo), o prazo e o horario dito pelo proprio runtime, quando ainda esta no futuro.
  const runtimes = [runtime, ...fallback.map(f => f.runtime)];
  const dito = !perfil && falhaAtual.resetEm !== null && Date.parse(falhaAtual.resetEm) > Date.now() ? falhaAtual.resetEm : null;
  const prazo = prazoDaFila(lerPerfisComContas(raiz), runtimes, politica) ?? dito;
  if (!prazo && falhaAtual.motivo === 'runtime.auth-missing') {
    emitir(null, 'nenhum perfil com login em nenhum runtime da ordem de fallback');
    return escalar('auth ausente sem alternativa', 'nenhum perfil com login conferido em nenhum runtime da ordem de fallback: ' +
      'refaca o login com ork accounts add ou ork accounts check antes de retomar');
  }
  const liberaEm = prazo ?? new Date(Date.now() + janelaPadraoMs(manifesto)).toISOString();
  emitir(null, `nenhum perfil ativo em ${runtimes.join(', ')}: fila duravel ate ${liberaEm}`);
  if (opcoes.dryRun) return { ...vazio, detalhe: `ensaio: entraria na fila duravel ate ${liberaEm}` };
  const pedido = enfileirar(carregado, { thread: thread.id, fase, slug: typeof despacho.slug === 'string' ? despacho.slug : slugDaSessao(thread, fase),
    promptPath: despacho.promptPath, promptSha256: despacho.promptSha256,
    cwd: typeof despacho.cwd === 'string' ? despacho.cwd : thread.worktree ?? raiz,
    model: typeof despacho.model === 'string' ? despacho.model : null, effort: typeof despacho.effort === 'string' ? despacho.effort : null,
    sinal: { resetEm: prazo, fonte: prazo ? 'iso' : 'sem-horario', trecho: falhaAtual.trecho },
    detalhe: `${falhaAtual.motivo}: nenhum perfil ativo em ${runtimes.join(', ')}`, runtime, perfil: null, motivo: falhaAtual.motivo });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.rateLimitEnfileirado, { fase, slug: pedido.slug, pedido: pedido.id, liberaEm: pedido.liberaEm,
    janelaEstimada: pedido.janelaEstimada, motivo: falhaAtual.motivo, promptSha256: despacho.promptSha256,
    correcao: `ork retry resume (ou aguarde ate ${pedido.liberaEm})` });
  registrarTentativa(true, `fila duravel: pedido ${pedido.id} libera em ${pedido.liberaEm}`);
  return { ...vazio, executada: true, fila: [pedido], redespacho: ultimo, detalhe: `pedido ${pedido.id} na fila ate ${pedido.liberaEm}` };
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
  const utilizavel = (p: PerfilDeRuntime) => !['desativado', 'provider-pago', 'sem-auth'].includes(p.estado) && perfilDisponivel(p);
  const mesmo = perfisDoRuntime(store, runtime).find(p => utilizavel(p) && !recusados.has(chaveDoModelo(runtime, p.id, model)));
  if (mesmo) return { runtime, perfil: perfilDeDespacho(mesmo), model, effort: null };
  for (const f of fallback) {
    const perfis = perfisDoRuntime(store, f.runtime);
    if (perfis.length) {
      const p = perfis.find(x => utilizavel(x) && !recusados.has(chaveDoModelo(f.runtime, x.id, f.model)));
      if (p) return { runtime: f.runtime, perfil: perfilDeDespacho(p), model: f.model, effort: f.effort ?? null };
      continue;
    }
    if (!recusados.has(chaveDoModelo(f.runtime, null, f.model))) return { runtime: f.runtime, perfil: null, model: f.model, effort: f.effort ?? null };
  }
  return null;
}

/** D-6: a correcao exata quando nenhum destino tem o modelo: o bloco do setup que conduz a fase. */
function correcaoDoModelo(thread: Thread, fase: Fase): string {
  const indice = MODOS[thread.modo as ModoLegado]?.blocos.findIndex(b => (b.fases as readonly string[]).includes(fase)) ?? -1;
  const bloco = indice >= 0 ? String(indice + 1) : 'N';
  return `ork setup ${thread.modo} --bloco ${bloco} --model <modelo acessivel>, ou declare no mesmo bloco --fallback runtime:modelo`;
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
    const detalhe = `nao ha despacho com prompt gravado para ${motivo} em ${fase}: rode a fase de novo com ork phase run`;
    registrarTentativa(false, detalhe);
    return { ...vazio, detalhe };
  }
  const runtime = typeof despacho.runtime === 'string' ? despacho.runtime : manifesto.runtime.adapter;
  const model = typeof despacho.model === 'string' ? despacho.model : null;
  const rotulo = model ?? '(padrao do runtime)';
  let perfil: PerfilDeDespacho | null;
  try {
    perfil = typeof gate?.sessionId === 'string'
      ? perfilDoRegistro(eventos, { sessionId: gate.sessionId, despachadaEm: typeof gate.despachoEm === 'string' ? gate.despachoEm : undefined })
      : perfilDoEvento(despacho);
  } catch (e) { return escalar('perfil registrado invalido', `troca de destino recusada: ${(e as Error).message}`); }
  if (typeof gate?.sessionId === 'string' && typeof gate.despachoEm === 'string') {
    const producao = producaoNoIntervalo(raiz, thread, { sessionId: gate.sessionId, fase, despachadaEm: gate.despachoEm }, eventos);
    if (producao.produziu) {
      return escalar('producao parcial com modelo inacessivel', `producao parcial com o modelo ${rotulo} inacessivel: ${producao.evidencia}; ` +
        'a sessao nao e redespachada sobre a worktree alterada e a fase nao conclui sem o humano');
    }
  }
  const recusados = new Set([...destinosQueRecusaramOModelo(eventos, fase), chaveDoModelo(runtime, perfil?.id ?? null, model)]);
  const doBloco = configDoBloco(lerSetup(raiz), thread.modo, fase);
  const fallback = alvosDeFallback(doBloco, doBloco?.runtime ?? manifesto.runtime.adapter);
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
    if (opcoes.dryRun) return { ...vazio, redespacho: r, detalhe: `ensaio: o mesmo prompt iria a ${alvo.runtime}` +
      `${alvo.perfil ? ` (perfil ${alvo.perfil.id})` : ''} com o modelo ${alvo.model ?? '(padrao do runtime)'}; ${r.detalhe}` };
    registrarTentativa(r.ok, r.detalhe);
    tentativas += 1;
    if (r.ok) return { ...vazio, executada: true, redespacho: r, detalhe: r.detalhe };
    // So a recusa do MODELO no redespacho (nada rodou) continua a troca; outra falha para aqui.
    if (r.falhaDeConta?.motivo !== 'runtime.model-unavailable') return { ...vazio, redespacho: r, detalhe: r.detalhe };
    recusados.add(chaveDoModelo(alvo.runtime, alvo.perfil?.id ?? null, alvo.model));
    atual = { runtime: alvo.runtime, perfil: alvo.perfil, model: alvo.model };
    if (tentativas >= plano.limite) {
      return escalar('limite de tentativas na troca de modelo', `${tentativas} tentativa(s) de troca por ${motivo} em ${fase}, no limite de ` +
        `${plano.limite} do manifesto: escalacao tipada pausa qualquer modo`);
    }
  }
  const tentados = [...recusados].map(k => { const [rt, p, m] = k.split('|'); return `${rt}${p ? `/${p}` : ''}:${m || '(padrao)'}`; });
  return escalar('modelo inacessivel sem outro destino', `o modelo ${rotulo} nao esta acessivel em ${tentados.join(', ')} e o bloco ` +
    `nao tem outro destino: ${correcaoDoModelo(thread, fase)}`);
}

/** Texto de `ork retry plan`. */
export function textoDoPlano(p: PlanoDeRetry): string {
  const linhas: string[] = [];
  linhas.push(`Plano de retry da thread ${p.thread}`);
  linhas.push(`  modo            ${p.modo}`);
  linhas.push(`  fase            ${p.fase ?? '(nenhuma)'}`);
  linhas.push(`  motivo tipado   ${p.motivo ?? '(nenhuma reprovacao pendente)'}`);
  if (p.detalhe) linhas.push(`  detalhe         ${localizarTexto(p.detalhe)}`);
  linhas.push(`  acao            ${p.acao}`);
  linhas.push(`  tentativas      ${p.tentativas} de ${p.limite} antes da escalacao`);
  linhas.push(
    `  esforco         ${p.effort}${p.effort !== p.effortAnterior ? ` (escalado de ${p.effortAnterior})` : ''}`
  );
  linhas.push(`  automatica      ${p.automatica ? 'sim' : 'nao'}`);
  if (p.bloqueio) linhas.push(`  bloqueio        ${p.bloqueio}`);
  linhas.push(`  razao           ${p.razao}`);
  if (p.politica && !p.automatica) linhas.push(`  correcao        ${p.politica.correcao}`);
  if (p.detalhe && localizarTexto(p.detalhe) !== p.detalhe) linhas.push(legendaDoFuso());
  return linhas.join('\n');
}

/** Texto de `ork retry run`. */
export function textoDoRetry(r: ResultadoDeRetry): string {
  const plano = textoDoPlano(r.plano);
  const linhas: string[] = [plano, ''];
  linhas.push(`Execucao: ${r.executada ? 'acao executada' : 'nada executado'}`);
  linhas.push(`  ${localizarTexto(r.detalhe)}`);
  if (r.rodada && r.rodada.correcoes.length > 0) {
    linhas.push('');
    linhas.push(
      `GO-FIX rodada ${r.rodada.rodada}: ` +
        r.rodada.correcoes.map((c) => `${c.id} (tipo ${c.tipo}, ${c.origem})`).join(', ')
    );
  }
  if (r.reverify) {
    linhas.push(`CHECK-REVERIFY: ${r.reverify.veredito} (cobertura ${r.reverify.cobertura})`);
  }
  if (r.fila.length > 0) {
    linhas.push('');
    linhas.push('Fila de rate limit desta thread:');
    for (const p of r.fila) {
      linhas.push(`  ${p.id}  ${p.fase}  libera em ${formatarDataHora(p.liberaEm)}${p.janelaEstimada ? ' (janela estimada)' : ''}`);
    }
  }
  if ((r.fila.length > 0 || localizarTexto(r.detalhe) !== r.detalhe) && !plano.includes(legendaDoFuso())) {
    linhas.push(legendaDoFuso());
  }
  return linhas.join('\n');
}

/** Texto de `ork retry resume`. */
export function textoDaRetomada(rs: ResultadoDaRetomada[]): string {
  if (rs.length === 0) {
    return 'Nenhum pedido da fila de rate limit com a janela liberada agora.';
  }
  const linhas: string[] = [];
  for (const r of rs) {
    linhas.push(`${r.pedido.id}  thread ${r.pedido.thread}  fase ${r.pedido.fase}`);
    linhas.push(`  playbook    ${r.playbook}`);
    linhas.push(`  slug        ${r.slug}`);
    linhas.push(`  retomada    ${r.despachada ? `sim (sessao ${r.sessionId})` : 'nao'}`);
    if (r.motivo) linhas.push(`  motivo      ${r.motivo}`);
    linhas.push(`  detalhe     ${localizarTexto(r.detalhe)}`);
    linhas.push(`  estado      ${r.pedido.estado}`);
  }
  if (rs.some((r) => localizarTexto(r.detalhe) !== r.detalhe)) linhas.push(legendaDoFuso());
  return linhas.join('\n');
}
