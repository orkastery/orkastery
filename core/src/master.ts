/**
 * Modulo MASTER/score: o coracao do bloco B2.
 *
 * "N looping threads, 1 score." A fase MASTER fecha toda thread, em todo modo, com
 * duas pecas que o `ork` grava e valida:
 *
 *   - `POSTMORTEM.json`: o corpo estruturado, com CLASSES DE FALHA FIXAS. Classe livre
 *     vira texto solto, e texto solto nao agrega no `ork learn` do B4.
 *   - `master-log.json`: o MASTER log no CONTRATO CONGELADO. Os nomes dos campos sao o
 *     contrato e nao mudam. "Uma entrega sem MASTER log nao aconteceu."
 *
 * O score e humano, de 0 a 5, com JUSTIFICATIVA OBRIGATORIA: o `ork` recusa score sem
 * justificativa, em qualquer modo. Nos modos que nao pausam no MASTER (`#Classic`,
 * `#Maestro`, `#Auto`) o score nao desaparece: a thread cai na fila de batch scoring,
 * que `ork master` lista com o indice ja derivado do ledger (I-43: a fila saiu).
 */

import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { exigirEntrega, provaDeEntrega } from './thread-close';
import { raizDoEstado } from './estado-thread';
import { EventoLedger, MotivoGate, ScoreProposto, MasterLogPendente, PostmortemPendente } from './types';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { tagDoModo } from './modos';
import { dirThread, gravarThread, lerThread, listarIds, pausaNaThread } from './thread';
import {
  ClasseDeFalha,
  Fase,
  FASES,
  FasePercorrida,
  MasterLog,
  Postmortem,
  ScoreHumano,
  Thread,
} from './types';
import { agora, exec, gravarJson, lerJson, tabela } from './util';
import * as fs from 'node:fs';
import { formatarDataHora, formatarDataHoraRotulada, legendaDoFuso } from './horario';
import { calcularIndice, Indice } from './indice';
import { registrarReversaoDaEntrega } from './ship';
import { publicarEmSegundoPlano } from './fabrica-publicar';
import { liberarAoFechar } from './fechamento';

/** Identificador do contrato congelado do MASTER log. */
export const CONTRATO_MASTER_LOG = 'ork.master-log/v1';

/** Versao do contrato. Uma mudanca de contrato exige uma versao nova, nao um campo novo. */
export const VERSAO_MASTER_LOG = 1;

/** As classes de falha FIXAS do POSTMORTEM, com o que cada uma significa. */
export const CLASSES_DE_FALHA: Readonly<Record<ClasseDeFalha, string>> = {
  'sem-falha': 'a thread atravessou o ciclo sem incidente',
  'erro-de-spec': 'o objetivo ou o plano estavam errados; a execucao seguiu a spec errada',
  'base-avancou': 'a base mudou embaixo da thread e o trabalho precisou ser ressincronizado',
  conflito: 'colisao de regiao entre threads, resolvida na mao',
  'rate-limit': 'o runtime bateu limite de uso e a fase parou por isso',
  modelo: 'o modelo errou (alucinou, ignorou instrucao, entregou self-report)',
  processo: 'o metodo falhou: gate faltando, verificacao pulada, evidencia nao coletada',
  'scope-creep': 'a entrega cresceu alem do que o GOAL prometia',
  outra: 'nao cabe em nenhuma classe acima (descreva na justificativa)',
};

/**
 * RM-008 (classe pelo gate): a classe que cada motivo tipado do gate sustenta quando ninguem informa
 * `--classe`. Antes, todo gate virava "outra", a classe que o `ork licoes` ignora: 8 POSTMORTEMs de
 * 03/10 fecharam assim por aceite por omissao. Motivo fora da tabela (prazo, falta de veredito,
 * runtime, conta, custo, espera humana) nao cabe numa classe fixa e segue "outra".
 */
export const CLASSE_DO_MOTIVO: Readonly<Partial<Record<MotivoGate, ClasseDeFalha>>> = {
  'artifact.missing': 'processo',
  'claims.failed': 'processo',
  'claims.unverifiable': 'processo',
  'policy.violation': 'processo',
  'runtime.autoconferencia': 'processo',
  'verify.regression': 'processo',
  'verify.failed': 'processo',
  'ci.failed': 'processo',
  'hitl.formato': 'processo',
  'runtime.rate-limited': 'rate-limit',
  'runtime.quota-exhausted': 'rate-limit',
  'lease.busy': 'conflito',
  'conducao.em-andamento': 'conflito',
  'tree.blocked': 'conflito',
};

/** As classes que os motivos dos gates sustentam, na ordem canonica e sem repetir. */
export function classesPelosGates(motivos: readonly string[]): ClasseDeFalha[] {
  const achadas = new Set<ClasseDeFalha>();
  for (const m of motivos) achadas.add(CLASSE_DO_MOTIVO[m as MotivoGate] ?? 'outra');
  if (achadas.size === 0) achadas.add('sem-falha');
  return ORDEM_DAS_CLASSES.filter((c) => achadas.has(c));
}

/** Teto de merges conferidos por entrega: a branch de 03/10 com mais sincronizacoes trouxe 16. */
const TETO_DE_MERGES_POR_ENTREGA = 200;

/**
 * RM-008 (base-avancou): quantas vezes a thread precisou trazer a base para dentro da branch. Conta os
 * `worktree_synced` do ledger e, em cada entrega com merge, os merges da branch (entre o primeiro e o
 * segundo pai do merge) cujo pai trazido ja estava na base. Em 03/10/2026, 29 de 35 entregas trouxeram
 * a `origin/main` antes do merge, e nenhuma fechou com `base-avancou`. Git sem resposta conta 0 e nunca
 * derruba o MASTER.
 */
export function sincronizacoesComABase(raiz: string, eventos: readonly EventoLedger[], mergeShas: readonly string[]): number {
  let total = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.worktreeSincronizada).length;
  for (const sha of new Set(mergeShas)) {
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    const r = exec('git', ['rev-list', '--merges', '--parents', `--max-count=${TETO_DE_MERGES_POR_ENTREGA}`,
      `${sha}^1..${sha}^2`], raiz, 30000);
    if (!r.ok) continue;
    for (const linha of r.stdout.split('\n')) {
      const pais = linha.trim().split(/\s+/).slice(1);
      // O pai trazido (o segundo em diante) ja estava na base: e a base entrando na branch.
      if (pais.slice(1).some((p) => /^[0-9a-f]{40}$/.test(p) &&
          exec('git', ['merge-base', '--is-ancestor', p, `${sha}^1`], raiz, 30000).ok)) total += 1;
    }
  }
  return total;
}

/** Ordem canonica das classes na saida do CLI. */
export const ORDEM_DAS_CLASSES: readonly ClasseDeFalha[] = [
  'sem-falha',
  'erro-de-spec',
  'base-avancou',
  'conflito',
  'rate-limit',
  'modelo',
  'processo',
  'scope-creep',
  'outra',
];

/** Remove acentos: a classe escrita com acento vira a classe fixa equivalente. */
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Parseia uma classe de falha. Retorna null quando ela nao esta no catalogo fixo. */
export function parseClasse(bruto: string | undefined | null): ClasseDeFalha | null {
  if (!bruto) return null;
  const limpo = semAcento(bruto.trim().toLowerCase()).replace(/[\s_]+/g, '-');
  return (ORDEM_DAS_CLASSES as readonly string[]).includes(limpo)
    ? (limpo as ClasseDeFalha)
    : null;
}

/** Caminho do POSTMORTEM da thread. */
export function caminhoPostmortem(raiz: string, id: string): string {
  return path.join(dirThread(raiz, id), 'POSTMORTEM.json');
}

/** Caminho do MASTER log da thread. */
export function caminhoMasterLog(raiz: string, id: string): string {
  return path.join(dirThread(raiz, id), 'master-log.json');
}

/**
 * As fases que a thread realmente percorreu, reconstruidas do LEDGER.
 *
 * Nao e o que o modo prometia nem o que a sessao disse ter feito: e o que ficou
 * registrado, com quantos eventos e em que janela de tempo.
 */
export function fasesPercorridas(raiz: string, id: string): FasePercorrida[] {
  const eventos = lerLedger(dirThread(raiz, id));
  const porFase = new Map<Fase, FasePercorrida>();
  for (const e of eventos) {
    const bruta = typeof e.fase === 'string' ? (e.fase.toUpperCase() as Fase) : null;
    if (!bruta || !FASES.includes(bruta)) continue;
    const atual = porFase.get(bruta) ?? {
      fase: bruta,
      eventos: 0,
      primeiroEm: e.ts,
      ultimoEm: e.ts,
      sessoes: [] as string[],
    };
    atual.eventos += 1;
    atual.ultimoEm = e.ts;
    const slug = typeof e.slug === 'string' ? e.slug : null;
    if (slug && !atual.sessoes.includes(slug)) atual.sessoes.push(slug);
    porFase.set(bruta, atual);
  }
  return FASES.filter((f) => porFase.has(f)).map((f) => porFase.get(f) as FasePercorrida);
}

/** Regime do score: `pausa` nos modos que param no MASTER, `batch` nos demais. */
export function regimeDoScore(thread: Thread): ScoreHumano['regime'] {
  // Ciclo sem MASTER (o `#Fast`, I-42) nao pausa no MASTER: o score, quando vier, e de lote.
  // Sem esta guarda, uma thread #Fast entregue derrubava `ork master`, o aceite por omissao
  // e o pulse, que listam as pendentes de score (27/09/2026).
  if (!thread.blocos?.some((b) => b.fases.includes('MASTER'))) return 'batch';
  return pausaNaThread(thread, 'MASTER') ? 'pausa' : 'batch';
}

/** A thread ja entregou (o ledger tem `ship_done`)? */
export function entregou(raiz: string, id: string): boolean {
  return provaDeEntrega(raiz, id) !== null;
}

/**
 * Pergunta ao git se a entrega desta thread foi desfeita, e grava se foi. Nunca lanca.
 *
 * Idempotente por `revertSha` (`registrarReversaoDaEntrega`), entao pode rodar em toda
 * consulta: a mesma reversao nao rebaixa a thread duas vezes. Git indisponivel nao
 * derruba o MASTER; no pior caso o indice continua sendo o que o ledger ja sabia.
 */
function sincronizarReversao(raiz: string, id: string): void {
  try {
    registrarReversaoDaEntrega(raiz, lerThread(raiz, id));
  } catch { /* git indisponivel nao barra o MASTER */ }
}

/**
 * O indice da thread, DEPOIS de perguntar ao git se a entrega ainda esta de pe.
 *
 * ESTE E O PONTO UNICO por onde o MASTER calcula indice, e ele existe por causa do que
 * o CHECK de 20/09/2026 provou com `git revert` real: o unico escritor de
 * `rollback_done` rodava no COMECO de um `ork ship` SEGUINTE da mesma thread, e depois
 * do MASTER nao ha ship seguinte. Uma entrega desfeita na base saia daqui como 5 de 5
 * "sem tropeco", e `ork master --aceitar-omissao` gravava score 5 com a justificativa
 * "sem reversao" sobre ela. Em 20 das 27 threads entregues do projeto a janela do ship
 * seguinte nunca chegou a abrir.
 *
 * A regra que ficou: quem AFIRMA o numero e quem tem de conferir o fato. Por isso a
 * deteccao roda no momento em que o indice e calculado e no momento em que a omissao e
 * aceita, e nao so num ship futuro que quase nunca acontece.
 */
export function indiceDaThread(raiz: string, id: string): Indice {
  sincronizarReversao(raiz, id);
  return calcularIndice(lerLedger(dirThread(raiz, id)));
}

export interface OpcoesMaster {
  score: number;
  justificativa: string;
  classes?: ClasseDeFalha[];
  resumo?: string;
  por?: string;
  /** Regrava POSTMORTEM e MASTER log de uma thread ja fechada. */
  refazer?: boolean;
  /**
   * I-43 (D3): o regime com que este score esta sendo gravado.
   *
   * So `aceitarPorOmissao` passa `'omissao'`. Um humano pontuando nunca passa nada:
   * o regime dele e derivado do modo, como sempre foi.
   */
  regime?: ScoreHumano['regime'];
  /**
   * RM-048 (item 8): o recibo do canal que trouxe a nota (origem, canal, conta, mensagem, instante,
   * sha da prova, evidencia). So o caminho do ingresso autenticado preenche; vai ao `master_done`.
   */
  prova?: Record<string, unknown>;
}

export interface ResultadoMaster {
  thread: Thread;
  postmortem: Postmortem;
  masterLog: MasterLog;
  caminhoPostmortem: string;
  caminhoMasterLog: string;
  /** True quando as classes de falha nao foram informadas e o `ork` as inferiu do ledger. */
  classesInferidas: boolean;
  avisos: string[];
}

/**
 * Valida o score humano ANTES de gravar qualquer coisa.
 *
 * Score sem justificativa nao e score, e carimbo. Por isso o `ork` recusa, e recusa
 * igual em todos os modos: o modo afrouxa a pausa, nunca a verificacao.
 */
export function exigirScoreValido(score: number, justificativa: string): void {
  if (!Number.isInteger(score) || score < 0 || score > 5) {
    throw new Error(
      `score invalido: "${score}". O score do MASTER e um inteiro de 0 a 5 (--score 0..5)`
    );
  }
  if (justificativa.trim().length < 3) {
    throw new Error(
      'score sem justificativa: o MASTER exige --justificativa "<texto>". ' +
        'Score sem justificativa nao vira aprendizado e o `ork` nao o registra.'
    );
  }
}

/**
 * Registra o MASTER da thread: POSTMORTEM tipado, MASTER log no contrato e o score.
 * Ao fim, a thread fecha (`status: fechada`) e o ledger ganha `master_done`.
 */
function prepararDocumentos(
  raiz: string,
  id: string,
  opcoes: OpcoesMaster
): ResultadoMaster {
  const thread = lerThread(raiz, id);
  exigirScoreValido(opcoes.score, opcoes.justificativa);
  if (thread.score && !opcoes.refazer) {
    throw new Error(
      `a thread ${id} ja tem score ${thread.score.valor}/5 dado por ${thread.score.avaliadoPor} ` +
        `em ${formatarDataHoraRotulada(thread.score.avaliadoEm)}; use --refazer para regravar o MASTER`
    );
  }

  exigirEntrega(raiz, id);
  // A1: o indice gravado ao lado do score sai do ledger, e o ledger so sabe da reversao
  // se alguem perguntar ao git. Aqui e o momento em que o numero e congelado.
  sincronizarReversao(raiz, id);
  const eventos = lerLedger(dirThread(raiz, id));
  const gatesBloqueados = eventos
    // Ensaio de 03/10/2026 (RM-049): o gate barrado por um `ork ship --dry-run` e ensaio, nao reprovacao.
    .filter((e) => e.tipo === TIPOS_DE_EVENTO.gateBloqueado && e.dryRun !== true)
    .map((e) => ({
      ts: e.ts,
      motivo: String(e.motivo ?? '(sem motivo)'),
      detalhe: String(e.detalhe ?? ''),
    }));
  const entregas = eventos
    .filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido)
    .map((e) => ({
      ts: e.ts,
      de: String(e.de ?? ''),
      para: String(e.para ?? ''),
      mergeSha: String(e.mergeSha ?? ''),
      pushVerificado: e.pushVerificado === true,
    }));

  const avisos: string[] = [];
  let classesInferidas = false;
  let classes = opcoes.classes ?? [];
  if (classes.length === 0) {
    classesInferidas = true;
    classes = classesPelosGates(gatesBloqueados.map((g) => g.motivo));
    const motivos = [...new Set(gatesBloqueados.map((g) => g.motivo))];
    const sincronizacoes = sincronizacoesComABase(raiz, eventos, entregas.map((e) => e.mergeSha));
    if (sincronizacoes > 0) {
      classes = ORDEM_DAS_CLASSES.filter((c) => c === 'base-avancou' || (c !== 'sem-falha' && classes.includes(c)));
    }
    const pelaBase = sincronizacoes > 0
      ? ` A branch trouxe a base ${sincronizacoes} vez(es) antes da entrega: o \`ork\` juntou "base-avancou".` : '';
    avisos.push(
      (gatesBloqueados.length > 0
        ? `a thread levou ${gatesBloqueados.length} reprovacao(oes) tipada(s) (${motivos.join(', ')}) e nenhuma --classe foi ` +
          `informada: o \`ork\` inferiu "${classes.join('", "')}" pelo motivo do gate.${pelaBase} Corrija com --classe <classe> --refazer.`
        : sincronizacoes > 0
          ? `nenhuma --classe informada e nenhum gate reprovou.${pelaBase} Corrija com --classe <classe> --refazer.`
          : 'nenhuma --classe informada e nenhum gate reprovou: o `ork` gravou "sem-falha".')
    );
  }

  // I-43 (D3): o indice e DERIVADO do ledger no momento do registro, e acompanha o
  // score como o que a maquina achava antes de o dono falar. Quando as duas existem,
  // a nota humana e a que vale; o indice fica ao lado dela, nao no lugar.
  const indice = calcularIndice(eventos);
  const score: ScoreHumano = {
    valor: opcoes.score,
    justificativa: opcoes.justificativa.trim(),
    avaliadoPor: opcoes.por?.trim() ?? '',
    avaliadoEm: agora(),
    regime: opcoes.regime ?? regimeDoScore(thread),
    indice: indice.valor,
  };
  const percorridas = fasesPercorridas(raiz, id);
  const resumo =
    opcoes.resumo?.trim() ||
    `thread ${thread.id} (${tagDoModo(thread.modo)}) fechada com score ${score.valor}/5 ` +
      `apos ${percorridas.length} fase(s) registradas no ledger e ${entregas.length} entrega(s)`;

  const postmortem: Postmortem = {
    versao: VERSAO_MASTER_LOG,
    thread: thread.id,
    slug: thread.slug,
    modo: thread.modo,
    tag: tagDoModo(thread.modo),
    variante: thread.variante ?? null,
    fasesPercorridas: percorridas,
    classesDeFalha: classes,
    score,
    gatesBloqueados,
    decisoesAutonomas: eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.decisaoAutonoma).length,
    pausasHumanas: eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.pausaHumana).length,
    entregas,
    resumo,
    geradoEm: agora(),
  };

  const masterLog: MasterLog = {
    contrato: CONTRATO_MASTER_LOG,
    versao: VERSAO_MASTER_LOG,
    thread: thread.id,
    slug: thread.slug,
    projeto: thread.projeto,
    modo: thread.modo,
    tag: tagDoModo(thread.modo),
    variante: thread.variante ?? null,
    // Fases PERCORRIDAS, nao as prometidas pelo modo. Ledger vazio vira ['MASTER'], que e
    // a unica fase que de fato aconteceu: dizer o contrario seria self-report.
    fases: percorridas.length > 0 ? percorridas.map((f) => f.fase) : ['MASTER'],
    score: score.valor,
    justificativa: score.justificativa,
    avaliadoPor: score.avaliadoPor,
    avaliadoEm: score.avaliadoEm,
    classesDeFalha: classes,
    resumo,
    regime: score.regime,
    indice: {
      valor: indice.valor,
      base: indice.base,
      parcelas: indice.parcelas.map((p) => ({ evento: p.evento, ocorrencias: p.ocorrencias, desconto: p.desconto })),
    },
    base: thread.base,
    worktree: thread.worktree,
    evidencia: {
      ledger: path.join('.orkastery', 'threads', thread.id, 'ledger.jsonl'),
      postmortem: path.join('.orkastery', 'threads', thread.id, 'POSTMORTEM.json'),
      eventos: eventos.length,
      sessoes: thread.sessoes.length,
      claims: thread.claims.length,
    },
  };

  if (classes.some(c => !ORDEM_DAS_CLASSES.includes(c))) throw new Error('classe fora do catálogo fixo');
  return { thread, postmortem, masterLog, caminhoPostmortem: caminhoPostmortem(raiz, id),
    caminhoMasterLog: caminhoMasterLog(raiz, id), classesInferidas, avisos };
}

/** Identidade declarada explicitamente. Não é autenticação de host. */
export function autoriaHumana(por: unknown): por is string {
  const genericos = ['humano', 'humana', 'operador', 'usuario', 'user', 'anonimo', 'ninguem', 'host', 'admin', 'root', 'equipe', 'time'];
  return typeof por === 'string' && por.trim().length >= 2 && !por.trim().startsWith('-') &&
    !genericos.includes(semAcento(por.trim().toLowerCase())) &&
    !/(?:^|[^a-z0-9])(codex|claude|gpt(?:[0-9-]*)?|openai|agente?|agent|runtime|auto|ia|llm|bot|pendente|pending|batch)(?:$|[^a-z0-9])/i.test(semAcento(por));
}
export function exigirAutoriaHumana(por: unknown): asserts por is string {
  if (!autoriaHumana(por)) throw new Error('ratificação exige --por humano explícito (ex.: --por "seu-nome"); agente ou autoria pendente não pode pontuar');
}

export function masterRatificado(raiz: string, id: string): boolean {
  const t = lerThread(raiz, id);
  if (!t.score || !autoriaHumana(t.score.avaliadoPor) || t.fechamentoAdmin) return false;
  const e = [...lerLedger(dirThread(raiz, id))].reverse().find(e => e.tipo === TIPOS_DE_EVENTO.masterConcluido);
  return !!e && e.por === t.score.avaliadoPor && e.score === t.score.valor && e.justificativa === t.score.justificativa;
}

/** Preflight reutilizado pelo lote, sem escrita. */
export function preflightMaster(raiz: string, id: string, opcoes: OpcoesMaster): ResultadoMaster {
  // Mantém erros de valor e duplicação anteriores ao erro de autoria.
  const r = prepararDocumentos(raiz, id, opcoes);
  exigirAutoriaHumana(opcoes.por);
  const erros = validarMasterLog(r.masterLog);
  if (erros.length) throw new Error(erros.join('; '));
  return r;
}

export function registrarMaster(raiz: string, id: string, opcoes: OpcoesMaster): ResultadoMaster {
  const r = preflightMaster(raiz, id, opcoes);
  const { thread, postmortem, masterLog } = r;
  gravarJson(r.caminhoPostmortem, postmortem);
  gravarJson(r.caminhoMasterLog, masterLog);
  thread.score = postmortem.score;
  thread.score_proposto = null;
  // I-42: ciclo sem MASTER (o `#Fast`) fecha sem trocar de fase; `faseAtual` fica dentro do ciclo.
  if (!thread.fases?.length || thread.fases.includes('MASTER')) thread.faseAtual = 'MASTER';
  thread.status = 'fechada';
  gravarThread(raiz, thread);
  publicarEmSegundoPlano(raiz);
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.postmortemGravado, {
    fase: 'MASTER', classesDeFalha: postmortem.classesDeFalha, classesInferidas: r.classesInferidas,
    gatesBloqueados: postmortem.gatesBloqueados.length, arquivo: path.relative(raizDoEstado(raiz), r.caminhoPostmortem),
  });
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.masterConcluido, {
    fase: 'MASTER', modo: thread.modo, tag: tagDoModo(thread.modo), score: masterLog.score,
    justificativa: masterLog.justificativa, por: masterLog.avaliadoPor, autorizadoPor: masterLog.avaliadoPor,
    classesDeFalha: masterLog.classesDeFalha, regime: postmortem.score.regime,
    contrato: CONTRATO_MASTER_LOG, arquivo: path.relative(raizDoEstado(raiz), r.caminhoMasterLog), estado: 'thread fechada',
    masterLogSha256: hashDocumento(r.caminhoMasterLog), postmortemSha256: hashDocumento(r.caminhoPostmortem),
    ...(opcoes.prova ? { prova: 'ingresso-autenticado', ...opcoes.prova } : {}),
  });
  // RM-037 (rm037noite): a thread fechada solta o que segurava, com registro no ledger dela.
  liberarAoFechar(raiz, id);
  return r;
}

export const CONTRATO_MASTER_PENDENTE = 'ork.master-pending/v1';
export function proporMaster(raiz: string, id: string, opcoes: OpcoesMaster): MasterLogPendente {
  if (!opcoes.por?.trim()) throw new Error('proposta exige autoria explícita');
  if (lerThread(raiz, id).score) throw new Error('thread já pontuada; proposta não sobrescreve score');
  const r = prepararDocumentos(raiz, id, opcoes);
  const proposta: ScoreProposto = { valor: opcoes.score, justificativa: opcoes.justificativa.trim(),
    classes: r.postmortem.classesDeFalha, propostoPor: opcoes.por.trim(), propostoEm: agora(), resumo: r.postmortem.resumo };
  // O contrato pendente não contém avaliadoPor nem avaliadoEm.
  const { avaliadoPor: _por, avaliadoEm: _em, ...base } = r.masterLog;
  const log: MasterLogPendente = { ...base, contrato: CONTRATO_MASTER_PENDENTE, score: null,
    estado: 'ratificacao-pendente', score_proposto: proposta };
  const post: PostmortemPendente = { ...r.postmortem, score: null, score_proposto: proposta };
  gravarJson(r.caminhoPostmortem, post);
  gravarJson(r.caminhoMasterLog, log);
  r.thread.score_proposto = proposta;
  if (!r.thread.fases?.length || r.thread.fases.includes('MASTER')) r.thread.faseAtual = 'MASTER';
  r.thread.status = 'aberta';
  gravarThread(raiz, r.thread);
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.scoreProposto, { fase: 'MASTER', ...proposta, arquivo: path.relative(raizDoEstado(raiz), r.caminhoMasterLog) });
  return log;
}

/**
 * Valida um MASTER log contra o contrato congelado. Devolve a lista de erros (vazia = valido).
 * E o mesmo validador que a suite roda: o contrato e executavel, nao prosa.
 */
export function validarMasterLog(bruto: unknown): string[] {
  const erros = validarBaseMaster(bruto);
  if (!bruto || typeof bruto !== 'object') return ['o MASTER log nao e um objeto'];
  const log = bruto as Partial<MasterLog>;
  if (log.contrato !== CONTRATO_MASTER_LOG) {
    erros.push(`campo "contrato" deve ser "${CONTRATO_MASTER_LOG}"`);
  }
  if (typeof log.score !== 'number' || !Number.isInteger(log.score) || log.score < 0 || log.score > 5) {
    erros.push('campo "score" deve ser um inteiro de 0 a 5');
  }
  if (typeof log.avaliadoEm !== 'string' || Number.isNaN(Date.parse(log.avaliadoEm))) {
    erros.push('campo "avaliadoEm" deve ser um carimbo ISO valido');
  }
  if (!autoriaHumana(log.avaliadoPor)) erros.push('avaliadoPor precisa de autoria humana explícita');
  return erros;
}

/** Valida a proposta sem convertê-la em avaliação humana. */
export function validarMasterPendente(bruto: unknown): string[] {
  const erros = validarBaseMaster(bruto);
  if (!bruto || typeof bruto !== 'object') return erros;
  const log = bruto as Partial<MasterLogPendente>;
  if (log.contrato !== CONTRATO_MASTER_PENDENTE || log.estado !== 'ratificacao-pendente' || log.score !== null ||
      Object.hasOwn(log, 'avaliadoPor') || Object.hasOwn(log, 'avaliadoEm')) erros.push('MASTER pendente exige ratificação sem score humano');
  const p = log.score_proposto;
  if (!p || !Number.isInteger(p.valor) || p.valor < 0 || p.valor > 5 ||
      typeof p.propostoPor !== 'string' || !p.propostoPor.trim() ||
      typeof p.propostoEm !== 'string' || !Number.isFinite(Date.parse(p.propostoEm)) ||
      p.justificativa !== log.justificativa || p.resumo !== log.resumo ||
      JSON.stringify(p.classes) !== JSON.stringify(log.classesDeFalha)) erros.push('proposta de score inválida');
  return erros;
}

function validarBaseMaster(bruto: unknown): string[] {
  if (!bruto || typeof bruto !== 'object') return ['o MASTER log nao e um objeto'];
  const erros: string[] = [], log = bruto as Partial<MasterLog>;
  if (log.versao !== VERSAO_MASTER_LOG) erros.push(`campo "versao" deve ser ${VERSAO_MASTER_LOG}`);
  for (const campo of ['thread', 'slug', 'modo', 'tag', 'justificativa', 'resumo'] as const) {
    const v = log[campo];
    if (typeof v !== 'string' || v.trim() === '') erros.push(`campo "${campo}" ausente ou vazio`);
  }
  if (!Array.isArray(log.fases) || log.fases.length === 0) {
    erros.push('campo "fases" deve listar as fases percorridas');
  } else {
    const fora = log.fases.filter((f) => !FASES.includes(f as Fase));
    if (fora.length > 0) erros.push(`campo "fases" tem fase fora do ciclo canonico: ${fora.join(', ')}`);
  }
  if (!Array.isArray(log.classesDeFalha) || log.classesDeFalha.length === 0) {
    erros.push('campo "classesDeFalha" deve ter ao menos uma classe fixa');
  } else {
    const fora = log.classesDeFalha.filter(
      (c) => !(ORDEM_DAS_CLASSES as readonly string[]).includes(c as string)
    );
    if (fora.length > 0) {
      erros.push(`campo "classesDeFalha" tem classe fora do catalogo fixo: ${fora.join(', ')}`);
    }
  }
  if (!log.projeto || typeof log.projeto.name !== 'string' || typeof log.projeto.abbrev !== 'string') {
    erros.push('campo "projeto" precisa de name e abbrev');
  }
  if (!log.base || typeof log.base.branch !== 'string' || typeof log.base.commit !== 'string') {
    erros.push('campo "base" precisa de branch e commit');
  }
  if (!log.evidencia || typeof log.evidencia.ledger !== 'string' || typeof log.evidencia.postmortem !== 'string') {
    erros.push('campo "evidencia" precisa apontar o ledger e o POSTMORTEM');
  }
  return erros;
}

function hashDocumento(arquivo: string): string {
  return createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
}

/** Leitura fail-closed: documento divergente não vira aprendizado ratificado. */
export function lerMasterLog(raiz: string, id: string): MasterLog | null {
  const caminho = caminhoMasterLog(raiz, id);
  if (!fs.existsSync(caminho)) return null;
  let log: MasterLog;
  try { log = lerJson<MasterLog>(caminho); } catch { return null; /* JSON inválido não é MASTER */ }
  if (validarMasterLog(log).length || !masterRatificado(raiz, id)) return null;
  const score = lerThread(raiz, id).score!;
  const evento = [...lerLedger(dirThread(raiz, id))].reverse().find(e => e.tipo === TIPOS_DE_EVENTO.masterConcluido)!;
  if (log.thread !== id || log.score !== score.valor || log.justificativa !== score.justificativa ||
      log.avaliadoPor !== score.avaliadoPor || log.avaliadoEm !== score.avaliadoEm) return null;
  if (Array.isArray(evento.classesDeFalha) && JSON.stringify(log.classesDeFalha) !== JSON.stringify(evento.classesDeFalha)) return null;
  // Hashes são evidência adicional no evento, sem mudar o contrato congelado v1.
  if (evento.masterLogSha256 && hashDocumento(caminho) !== evento.masterLogSha256) return null;
  if (evento.postmortemSha256 && (!fs.existsSync(caminhoPostmortem(raiz, id)) ||
      hashDocumento(caminhoPostmortem(raiz, id)) !== evento.postmortemSha256)) return null;
  return log;
}

export interface PendenteDeScore {
  thread: Thread;
  /** `batch` nos modos que nao pausam no MASTER. */
  regime: ScoreHumano['regime'];
  /** A thread ja entregou (ship_done no ledger)? */
  entregou: boolean;
  /** Ja esta na fase MASTER? */
  noMaster: boolean;
  fasesPercorridas: number;
}

/** O que a aceitacao por omissao registrou, para o dono conseguir ver depois. */
export interface AceitePorOmissao {
  thread: string;
  indice: Indice;
  /** Quem decidiu. Nunca um nome humano: e o nucleo, e isso fica legivel a olho. */
  decididoPor: string;
  aceitoEm: string;
  /** O score que ficou gravado no aceite, para a divergencia com o indice ao vivo aparecer. */
  scoreGravado?: number | null;
}

/** Quem decide quando ninguem decide. Literal unico, para o leitor reconhecer. */
export const AUTOR_DA_OMISSAO = 'nucleo ork (omissao)';

/**
 * Aceita a entrega por OMISSAO e registra que foi por omissao (I-43, D3).
 *
 * Este e o coracao da remocao da fila de ratificacao, e a parte que nao pode dar
 * errado. Aceitacao por default sem registro seria pior que a fila: a fila ao menos
 * deixava 13 threads visiveis esperando; uma entrega ruim aceita em silencio some, e
 * some sem deixar rastro de que sumiu (R4 do GOAL).
 *
 * Entao a aceitacao produz TRES rastros independentes:
 *   1. o evento `aceite_por_omissao` no ledger, append-only, com o indice e os
 *      insumos que o produziram;
 *   2. o `score` gravado com `regime: 'omissao'` e `avaliadoPor` do nucleo,
 *      distinguivel de nota humana a olho e por codigo;
 *   3. a visao de `ork master`, que lista o que passou sem o dono olhar.
 *
 * E ela NAO e irreversivel: reclamar continua possivel para sempre. O dono pontua a
 * thread quando quiser, o score vira `regime: 'pausa'` com o nome dele, e o evento de
 * omissao PERMANECE no ledger, porque o ledger e append-only e a historia de que a
 * entrega passou sem revisao continua sendo verdade.
 */
export function aceitarPorOmissao(raiz: string, id: string): AceitePorOmissao {
  const thread = lerThread(raiz, id);
  const dir = dirThread(raiz, id);
  // A1: aceitar por default so pode carimbar nota depois de perguntar ao git se a
  // entrega ainda esta de pe. Era aqui que uma entrega revertida virava score 5.
  const indice = indiceDaThread(raiz, id);
  const aceitoEm = agora();

  registrar(dir, id, TIPOS_DE_EVENTO.aceitePorOmissao, {
    fase: 'MASTER',
    indice: indice.valor,
    base: indice.base,
    // Os INSUMOS vao junto: um numero sem origem no ledger e um numero inventado.
    insumos: indice.parcelas.map((p) => ({ evento: p.evento, ocorrencias: p.ocorrencias, desconto: p.desconto })),
    decididoPor: AUTOR_DA_OMISSAO,
    razao: 'entrega aceita por default: ninguem pontuou. Nota humana posterior sobrescreve, e este evento permanece',
  });

  registrarMaster(raiz, id, {
    score: Math.round(indice.valor),
    justificativa:
      `Aceita por omissao: ninguem pontuou esta entrega. Indice derivado do ledger = ` +
      `${indice.valor} de ${indice.base}` +
      (indice.parcelas.length === 0
        ? ', sem reversao, GO-FIX, CHECK refeito nem ship barrado.'
        : `, descontando ${indice.parcelas.map((p) => `${p.evento} x${p.ocorrencias}`).join(', ')}.`) +
      ' O dono pode pontuar quando quiser; a nota humana sobrescreve e o registro da omissao permanece.',
    por: AUTOR_DA_OMISSAO,
    regime: 'omissao',
    refazer: thread.status === 'fechada',
  });

  return { thread: id, indice, decididoPor: AUTOR_DA_OMISSAO, aceitoEm };
}

/** As entregas aceitas por omissao: o que passou sem o dono olhar. */
export function aceitosPorOmissao(raiz: string): AceitePorOmissao[] {
  const saida: AceitePorOmissao[] = [];
  for (const id of listarIds(raiz)) {
    const eventos = lerLedger(dirThread(raiz, id));
    const aceite = [...eventos].reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao);
    if (!aceite) continue;
    // A1: a reversao pode ter vindo DEPOIS do aceite. O indice aqui e recalculado ao
    // vivo, e `scoreGravado` fica ao lado para a divergencia aparecer em vez de sumir:
    // o MASTER log e contrato congelado e nao se reescreve sozinho.
    saida.push({
      thread: id,
      indice: indiceDaThread(raiz, id),
      decididoPor: String(aceite.decididoPor ?? AUTOR_DA_OMISSAO),
      aceitoEm: String(aceite.ts ?? ''),
      scoreGravado: lerThread(raiz, id).score?.valor ?? null,
    });
  }
  return saida;
}

/**
 * A fila de batch scoring: threads que entregaram (ou chegaram ao MASTER) e ainda nao
 * tem score. E a fila que `#Classic`, `#Maestro` e `#Auto` alimentam ao entregar sem pausa.
 */
export function pendentesDeScore(raiz: string, todas = false): PendenteDeScore[] {
  const saida: PendenteDeScore[] = [];
  for (const id of listarIds(raiz)) {
    const thread = lerThread(raiz, id);
    if (thread.fechamentoAdmin || masterRatificado(raiz, id)) continue;
    const jaEntregou = entregou(raiz, id);
    const noMaster = thread.faseAtual === 'MASTER';
    if (!todas && !jaEntregou && !noMaster) continue;
    saida.push({
      thread,
      regime: regimeDoScore(thread),
      entregou: jaEntregou,
      noMaster,
      fasesPercorridas: fasesPercorridas(raiz, id).length,
    });
  }
  return saida;
}

/**
 * A visao de entregas de `ork master` (I-43, T8): o que a FILA deixou de ser.
 *
 * O que saiu foi a FILA, e o que ela era: uma lista que acumulava "entregou e nao tem
 * score" esperando o humano. Ela tinha 13 entradas em 20/09/2026, e nao por falta de
 * lembrete: lembrete nao converte em nota. Enquanto ela existia, a unica informacao
 * sobre a qualidade de uma entrega era uma nota que ninguem dava.
 *
 * No lugar dela, cada entrega chega com um INDICE ja calculado do ledger, e o comando
 * oferece UM caminho para drenar o que sobrou: aceitar por omissao, com registro.
 *
 * O que NAO saiu, e nao podia sair: pontuar. `ork master <thread> --score` continua
 * inteiro, e a nota humana continua sobrescrevendo o indice quando o dono reclama.
 */
export function tabelaDeEntregas(raiz: string, todas = false): string {
  const pendentes = pendentesDeScore(raiz, todas);
  const omissoes = aceitosPorOmissao(raiz);

  // A1: o indice da coluna e o de AGORA; `SCORE GRAVADO` e o que o MASTER log congelou.
  // Quando o segundo e maior, a entrega caiu depois de aceita e isso precisa aparecer.
  const caiuDepoisDeAceita = omissoes.filter(
    (o) => typeof o.scoreGravado === 'number' && o.indice.valor < o.scoreGravado
  );
  const secaoOmissao = omissoes.length === 0
    ? []
    : ['', `Aceitas por omissao (${omissoes.length}): o que passou sem voce olhar.`, '',
       tabela(['ID', 'INDICE', 'SCORE GRAVADO', 'ACEITA EM'],
         omissoes.map((o) => [o.thread, `${o.indice.valor}/${o.indice.base}`,
           typeof o.scoreGravado === 'number' ? `${o.scoreGravado}/5` : '-',
           formatarDataHora(o.aceitoEm)])),
       legendaDoFuso(),
       ...(caiuDepoisDeAceita.length === 0 ? [] : ['',
         `ATENCAO: ${caiuDepoisDeAceita.length} entrega(s) cairam DEPOIS de aceitas: ` +
           caiuDepoisDeAceita.map((o) => o.thread).join(', ') + '.',
         '  O MASTER log e contrato congelado e nao se reescreve sozinho. Pontue para o',
         '  registro humano alcancar o fato; o registro da omissao permanece no ledger.']),
       '', 'Discordou de alguma? A nota humana sobrescreve, e o registro da omissao permanece:',
       '  ork master <thread-id> --score <0-5> --justificativa "<por que>" --por <humano>'];

  if (pendentes.length === 0) {
    return [
      todas
        ? 'Nenhuma thread aberta sem score.'
        : 'Nenhuma entrega esperando decisao. Para ver tambem as que ainda nao entregaram: ork master --todas',
      ...secaoOmissao,
    ].join('\n');
  }

  const linhas = pendentes.map((p) => {
    const indice = indiceDaThread(raiz, p.thread.id);
    return [
      p.thread.id,
      p.thread.slug,
      tagDoModo(p.thread.modo),
      p.thread.faseAtual,
      p.thread.status,
      p.entregou ? 'sim' : 'nao',
      `${indice.valor}/${indice.base}`,
      indice.parcelas.length === 0 ? 'sem tropeco' : indice.parcelas.map((x) => `${x.evento} x${x.ocorrencias}`).join(', '),
    ];
  });

  return [
    `Entregas (${pendentes.length}) com o indice ja derivado do ledger. O numero nao foi digitado por ninguem.`,
    '',
    tabela(['ID', 'SLUG', 'MODO', 'FASE', 'STATUS', 'ENTREGOU', 'INDICE', 'DE ONDE VEIO'], linhas),
    '',
    'ENTREGUE E ACEITO, a menos que voce diga o contrario.',
    '  ork master <id> --aceitar-omissao     aceita so esta entrega, com o indice e os insumos no ledger',
    '  ork master --aceitar-omissao          aceita TODAS as entregues da lista (--dry-run mostra quais, sem gravar)',
    '  ork master <id> --score <0-5> --justificativa "<por que>" --por <humano>   se quiser reclamar',
    '',
    `Classes fixas: ${ORDEM_DAS_CLASSES.join(', ')}`,
    ...secaoOmissao,
  ].join('\n');
}

/**
 * Aceita por omissao TODAS as entregas que ainda esperam decisao.
 *
 * E o comando que drena a fila de uma vez, e por isso ele so alcanca o que de fato
 * ENTREGOU: uma thread que nunca chegou ao ship nao tem entrega para aceitar, e
 * aceita-la seria inventar um fato.
 */
export function aceitarPendentesPorOmissao(raiz: string, opcoes: { thread?: string } = {}): AceitePorOmissao[] {
  return entregasParaOmissao(raiz, opcoes.thread).map((p) => aceitarPorOmissao(raiz, p.thread.id));
}

/**
 * RM-008 (03/10/2026): o que `ork master --aceitar-omissao` fecharia, sem gravar nada.
 *
 * Na madrugada de 03/10, tres vezes, um condutor rodou `ork master --aceitar-omissao` para fechar
 * a PROPRIA thread, e o comando fechou tambem as entregues de outras frentes paralelas. A CLI nao
 * deixava indicar a thread. Com `thread`, o alvo e so ela; sem, continua sendo toda entrega que
 * espera decisao (o padrao nao mudou). Thread inexistente recusa pelo `lerThread`.
 */
export function entregasParaOmissao(raiz: string, thread?: string): PendenteDeScore[] {
  if (thread !== undefined) lerThread(raiz, thread);
  return pendentesDeScore(raiz)
    .filter((p) => p.entregou)
    .filter((p) => thread === undefined || p.thread.id === thread);
}

/**
 * Por que a thread indicada nao entra no aceite por omissao, ou `null` quando entra.
 * `ja-fechada` e idempotencia (nada a fazer); `fechamento-admin` e `sem-entrega` sao recusa.
 */
export function motivoForaDaOmissao(raiz: string, id: string): { motivo: 'ja-fechada' | 'fechamento-admin' | 'sem-entrega'; texto: string } | null {
  const thread = lerThread(raiz, id);
  if (thread.fechamentoAdmin) {
    return { motivo: 'fechamento-admin', texto: `a thread ${id} foi fechada administrativamente (${thread.fechamentoAdmin.motivo}); nao ha entrega para aceitar.` };
  }
  if (masterRatificado(raiz, id)) {
    return { motivo: 'ja-fechada', texto: `a thread ${id} ja tem MASTER registrado; nada a aceitar.` };
  }
  if (!entregou(raiz, id)) {
    return { motivo: 'sem-entrega', texto: `a thread ${id} ainda nao entregou (sem ship_done no ledger); registre a entrega antes: ork ship registrar-pr ${id}` };
  }
  return null;
}

/** Texto de `ork master <thread-id> --score`. */
export function textoDoMaster(r: ResultadoMaster): string {
  const linhas: string[] = [];
  linhas.push(`MASTER registrado: thread ${r.thread.id} fechada.`);
  linhas.push(`  score          ${r.masterLog.score}/5 (${r.postmortem.score.regime})`);
  linhas.push(`  justificativa  ${r.masterLog.justificativa}`);
  linhas.push(`  avaliado por   ${r.masterLog.avaliadoPor} em ${formatarDataHoraRotulada(r.masterLog.avaliadoEm)}`);
  linhas.push(`  classes        ${r.masterLog.classesDeFalha.join(', ')}`);
  linhas.push(`  fases          ${r.masterLog.fases.join(' -> ')}`);
  linhas.push(`  entregas       ${r.postmortem.entregas.length} ship(s) concluido(s) no ledger`);
  linhas.push(`  gates          ${r.postmortem.gatesBloqueados.length} reprovacao(oes) tipada(s)`);
  linhas.push('');
  linhas.push(`  POSTMORTEM     ${r.caminhoPostmortem}`);
  linhas.push(`  MASTER log     ${r.caminhoMasterLog} (contrato ${r.masterLog.contrato})`);
  if (r.avisos.length > 0) {
    linhas.push('');
    for (const a of r.avisos) linhas.push(`  AVISO: ${a}`);
  }
  return linhas.join('\n');
}

/** Tabela das classes de falha fixas, para o humano escolher sem inventar. */
export function tabelaDeClasses(): string {
  const linhas = ['Classes de falha do POSTMORTEM (fixas, nao extensiveis pelo executor)', ''];
  for (const c of ORDEM_DAS_CLASSES) linhas.push(`  ${c.padEnd(14)} ${CLASSES_DE_FALHA[c]}`);
  return linhas.join('\n');
}
