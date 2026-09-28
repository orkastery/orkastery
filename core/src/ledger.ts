/**
 * Ledger de eventos JSONL por thread (`.orkastery/threads/<id>/ledger.jsonl`).
 *
 * O ledger e append-only: e a rastreabilidade da conducao. Toda decisao autonoma
 * (modo sem pausa) precisa estar aqui com quem decidiu, evidencia e razao.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventoLedger } from './types';
import { agora } from './util';
import { randomUUID } from 'node:crypto';
import { durableAppend } from './company-brain-journal';

/** Tipos de evento do ledger. B0 abriu a lista; o B1 acrescenta os seus. */
export const TIPOS_DE_EVENTO = {
  // Bloco B0
  threadCriada: 'thread_created',
  worktreeCriada: 'worktree_created',
  faseDespachada: 'phase_dispatch',
  despachoVerificado: 'phase_dispatch_verified',
  despachoFalhou: 'phase_dispatch_failed',
  decisaoAutonoma: 'autonomous_decision',
  pausaHumana: 'human_gate',
  // Bloco B1: verdade, leases, ship e handoff
  gateBloqueado: 'gate_blocked',
  gateLiberado: 'gate_passed',
  claimRegistrada: 'claim_added',
  baselineGravada: 'baseline_recorded',
  verificacao: 'verify_run',
  leaseAdquirido: 'lease_acquired',
  leaseLiberado: 'lease_released',
  shipIniciado: 'ship_started',
  shipConcluido: 'ship_done',
  shipBloqueado: 'ship_blocked',
  /**
   * I-43 (D3): a entrega foi revertida na base depois do ship.
   *
   * Ele ja existia na allowlist do ciclo (`company-brain-source.ts`) e tinha ZERO
   * escritor no nucleo: o insumo de MAIOR peso do indice de qualidade nao era
   * gravado por ninguem. Quem o escreve e `ship.ts`, que e quem sabe de merge e de
   * base, e so quando o git prova a reversao.
   */
  rollbackConcluido: 'rollback_done',
  /**
   * I-43 (D3): a entrega foi aceita porque ninguem reclamou, e isso ficou REGISTRADO.
   *
   * Aceitacao por default nao pode ser silencio. O evento carrega o indice, os
   * insumos que o produziram e quem decidiu, para o dono conseguir ver depois o que
   * passou sem ele olhar. Nota humana posterior sobrescreve o score; este evento
   * permanece, porque o ledger e append-only.
   */
  aceitePorOmissao: 'aceite_por_omissao',
  gateDeTokens: 'token_gate',
  handoffExportado: 'handoff_exported',
  handoffRecuperado: 'handoff_recalled',
  // Bloco B2: worktree gerenciada, fila de leases, escalonador e MASTER/score
  worktreeGarantida: 'worktree_ensured',
  worktreeSincronizada: 'worktree_synced',
  worktreeAuditada: 'worktree_audited',
  worktreeLiberada: 'worktree_released',
  leaseEnfileirado: 'lease_queued',
  postmortemGravado: 'postmortem_recorded',
  masterConcluido: 'master_done',
  scoreProposto: 'score_proposto',
  masterMigrado: 'master_migrated',
  threadFechadaAdmin: 'thread_closed_admin',
  artefatoEntregue: 'artifact_delivered',
  // Bloco B5: auditores periodicos (rodada, achados, propostas e board de divida)
  auditoriaDespachada: 'audit_dispatch',
  auditoriaBloqueada: 'audit_blocked',
  auditoriaVerificada: 'audit_verified',
  achadoRegistrado: 'finding_added',
  propostaGravada: 'proposal_recorded',
  relatorioGerado: 'audit_report',
  achadoVirouThread: 'finding_to_thread',
  // Extensao do B5: varredura deterministica da superficie de ataque de rede (SP8..SP12)
  superficieVarrida: 'attack_surface_scanned',
  // Bloco B6: camada OrkMind (memoria semantica opcional)
  memoriaGravada: 'memory_written',
  memoriaInjetada: 'memory_injected',
  memoriaDegradada: 'memory_degraded',
  recallResolvido: 'recall_resolved',
  // Bloco B3: autonomia (retry tipado, fila de rate limit, GO-FIX/CHECK-REVERIFY)
  retryPlanejado: 'retry_planned',
  retryTentado: 'retry_attempt',
  retryEscalado: 'retry_escalated',
  rateLimitDetectado: 'rate_limit_detected',
  rateLimitEnfileirado: 'rate_limit_queued',
  rateLimitRetomado: 'rate_limit_resumed',
  // I-33 (D5): troca de perfil ou de runtime depois de falha da conta (quem, de qual para
  // qual, evidencia e razao). Faz parte do catalogo, nao de literal solto.
  perfilRotacionado: 'runtime_profile_rotated',
  fixAberto: 'go_fix_opened',
  fixDespachado: 'go_fix_dispatched',
  reverifyConcluido: 'check_reverify',
  // Feature #setup: customizacao de runtime/modelo/esforco por bloco de cada modo
  setupConfigurado: 'setup_configured',
  onboardingRegistrado: 'onboarding_recorded',
  // Correcao do escalonador: vaga devolvida por thread sem procura ativa (`ork board reap`)
  vagaLiberada: 'slot_released',
  // I-07: estimativa humana no PLAN para comparacao economica posterior.
  estimativaPlano: 'plan_estimate',
  // I-42 (D5): ciclo sem CHECK que nao achou teste nem comando honesto declara a ausencia de
  // prova, com os caminhos e o motivo. Ausencia registrada, nunca silenciosa.
  provaAusente: 'prova_ausente',
  // I-53 (RM-037, P6): o `ci prepare` avisou ou recusou comando de claim pelo lint.
  lintDeClaim: 'claim_lint',
  // I-55 (RM-008): a mesma falha em 3+ threads fechadas virou proposta de policy (so proposta).
  politicaProposta: 'policy_proposta',
  // I-36 (RM-036): conducao multicanal. O segundo pedido recusado, o despacho repetido que nao abriu
  // sessao nova, a liberacao com prova (fim da sessao ou dono morto), o handoff e a renovacao do prazo.
  conducaoRecusada: 'conducao_recusada',
  despachoIdempotente: 'despacho_idempotente',
  conducaoLiberada: 'conducao_liberada',
  conducaoOrfaLiberada: 'conducao_orfa_liberada',
  conducaoAssumida: 'conducao_assumida',
  conducaoRenovada: 'conducao_renovada',
} as const;

/**
 * I-41 (GO-FIX 1, B4 e D11): o rastro tipado da decisao autonoma.
 *
 * O cabecalho deste arquivo sempre disse que "toda decisao autonoma precisa estar aqui com quem
 * decidiu, evidencia e razao", e o registro nunca conferiu: 849 eventos com 215 chaves distintas,
 * oito nomes para "quem decidiu" e 45% sem os tres campos (M6 do PLAN). A partir daqui o registro
 * recusa `autonomous_decision` sem `quemDecidiu`, `evidencia` e `razao`, com esses nomes. Evento
 * antigo continua legivel (a leitura normaliza os nomes historicos em `decisao-autonoma.ts`) e
 * nenhuma linha e reescrita: a exigencia vale para a escrita nova, como v1 e v2 no contrato HITL.
 */
export function exigirRastroDeDecisaoAutonoma(dados: Record<string, unknown>): void {
  for (const campo of ['quemDecidiu', 'evidencia', 'razao']) {
    const v = dados[campo];
    if (typeof v !== 'string' || !v.trim() || v.length > 1000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(v)) {
      throw new Error(`decisão autônoma exige ${campo}: quem decidiu, com que evidência e por quê`);
    }
  }
}

/** Caminho do ledger de uma thread. */
export function caminhoLedger(dirThread: string): string {
  return path.join(dirThread, 'ledger.jsonl');
}

/** Anexa um evento ao ledger da thread e devolve o evento gravado. */
export function registrar(
  dirThread: string,
  threadId: string,
  tipo: string,
  dados: Record<string, unknown> = {}
): EventoLedger {
  if (tipo === TIPOS_DE_EVENTO.decisaoAutonoma) exigirRastroDeDecisaoAutonoma(dados);
  const evento: EventoLedger = { ts: agora(), thread: threadId, tipo, ...dados, eventId: randomUUID() };
  fs.mkdirSync(dirThread, { recursive: true });
  durableAppend(caminhoLedger(dirThread), evento);
  return evento;
}

/** A thread ainda existe em disco? `thread.json` e ledger presentes; nada é criado aqui. */
export function threadPresente(dirThread: string): boolean {
  return fs.existsSync(path.join(dirThread, 'thread.json')) && fs.existsSync(caminhoLedger(dirThread));
}

/**
 * Variante do `registrar` para processos destacados (watcher): anexa só a um ledger que já
 * existe, sem criar pasta nem arquivo (`O_APPEND` sem `O_CREAT`). Thread apagada devolve
 * `null` em vez de renascer com um ledger de um evento só.
 */
export function registrarSeExiste(
  dirThread: string,
  threadId: string,
  tipo: string,
  dados: Record<string, unknown> = {}
): EventoLedger | null {
  if (tipo === TIPOS_DE_EVENTO.decisaoAutonoma) exigirRastroDeDecisaoAutonoma(dados);
  if (!fs.existsSync(path.join(dirThread, 'thread.json'))) return null;
  let fd: number;
  try { fd = fs.openSync(caminhoLedger(dirThread), fs.constants.O_WRONLY | fs.constants.O_APPEND); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const evento: EventoLedger = { ts: agora(), thread: threadId, tipo, ...dados, eventId: randomUUID() };
  try { fs.writeFileSync(fd, JSON.stringify(evento) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return evento;
}

/** Le o ledger inteiro. Linha corrompida vira evento `ledger_corrupted` em vez de quebrar a leitura. */
export function lerLedger(dirThread: string): EventoLedger[] {
  const caminho = caminhoLedger(dirThread);
  if (!fs.existsSync(caminho)) return [];
  const linhas = fs.readFileSync(caminho, 'utf8').split('\n').filter((l) => l.trim() !== '');
  return linhas.map((linha, i) => {
    try {
      return JSON.parse(linha) as EventoLedger;
    } catch {
      return {
        ts: '',
        thread: '',
        tipo: 'ledger_corrupted',
        linha: i + 1,
        conteudo: linha.slice(0, 200),
      } as EventoLedger;
    }
  });
}
