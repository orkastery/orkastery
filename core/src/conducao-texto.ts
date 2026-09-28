/**
 * I-36 (D9): o texto de "quem conduz agora", em UM lugar.
 *
 * Todas as superficies (thread status, board, monitor, pulse, snapshot do Maestro e os quatro
 * hosts) imprimem esta linha e nenhuma a reescreve. Modulo sem dependencia de estado para que o
 * `thread.ts` e o `leases.ts` possam usa-lo sem ciclo de importacao.
 */
import { formatarDataHora } from './horario';
import { ConducaoAtual, Lease, OperacaoDeConducao } from './types';

/** O que cada operacao de conducao e, em portugues de gente. */
export const NOME_DA_OPERACAO: Readonly<Record<OperacaoDeConducao, string>> = {
  'phase.run': 'despacho de fase',
  'retry.run': 'retomada de fase',
  verify: 'ork verify',
  baseline: 'ork verify --baseline',
  'fix.open': 'ork fix open',
  'fix.reverify': 'ork fix reverify',
  'mcp.verify': 'ork_verify (MCP)',
  handoff: 'reserva de quem assumiu',
};

/** O objeto de leitura a partir do lease, sem consultar nada. */
export function conducaoDoLease(lease: Lease): ConducaoAtual | null {
  const c = lease.conducao;
  if (!c || c.contrato !== 'ork.conducao/v1') return null;
  return {
    thread: lease.thread,
    canal: c.canal,
    sessao: c.dono.tipo === 'sessao' ? c.dono.sessionId : null,
    fase: c.fase,
    desde: lease.adquiridoEm,
    promptSha256: c.promptSha256,
    operacao: c.operacao,
    dono: c.dono,
    expiraEm: lease.expiraEm,
    identidade: c.identidade,
  };
}

/** Quem segura a conducao, em poucas palavras: a sessao, o processo ou a reserva. */
export function quemConduz(c: Pick<ConducaoAtual, 'sessao' | 'dono' | 'operacao'>): string {
  if (c.sessao) return `sessao ${c.sessao.slice(0, 8)}`;
  if (c.dono.tipo === 'processo') return `processo ${c.dono.pid} (${NOME_DA_OPERACAO[c.operacao]})`;
  if (c.dono.tipo === 'reserva') return `reserva de ${c.dono.por}`;
  return NOME_DA_OPERACAO[c.operacao];
}

/**
 * "conduzido agora por CANAL, sessao ID, fase F, desde HORARIO": a linha unica (CS7). O horario
 * sai no fuso do dono; a legenda do fuso fica com a superficie, uma vez por tela.
 */
export function linhaDeConducao(c: ConducaoAtual, opcoes: { agora?: string } = {}): string {
  return `conduzido agora por ${c.canal}, ${quemConduz(c)}, fase ${c.fase ?? '-'}, ` +
    `desde ${formatarDataHora(c.desde, opcoes.agora ? { agora: opcoes.agora } : {})}`;
}
