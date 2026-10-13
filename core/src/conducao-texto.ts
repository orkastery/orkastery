/**
 * I-36 (D9): o texto de "quem conduz agora", em UM lugar.
 *
 * Todas as superficies (thread status, board, monitor, pulse, snapshot do Maestro e os quatro
 * hosts) imprimem esta linha e nenhuma a reescreve. Modulo sem dependencia de estado para que o
 * `thread.ts` e o `leases.ts` possam usa-lo sem ciclo de importacao.
 */
import { formatarDataHora } from './horario';
import { msg } from './locale';
import { ConducaoAtual, Lease, OperacaoDeConducao } from './types';

/** O que cada operacao de conducao e, em portugues de gente (o texto gravado das recusas usa este). */
export const NOME_DA_OPERACAO = msg('pt-BR').thread.operacoes as Readonly<Record<OperacaoDeConducao, string>>;

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
  // RM-061 (F2a): no locale do comando; fora dos comandos cobertos, o pt-BR de sempre.
  const m = msg().thread;
  if (c.sessao) return m.quemSessao(c.sessao.slice(0, 8));
  if (c.dono.tipo === 'processo') return m.quemProcesso(c.dono.pid, m.operacoes[c.operacao]);
  if (c.dono.tipo === 'reserva') return m.quemReserva(c.dono.por);
  return m.operacoes[c.operacao];
}

/**
 * A linha unica de quem conduz (CS7): canal, quem, fase e desde, na redacao do catalogo (`msg().thread.conduzido`,
 * RM-061), no locale do comando; fora dos comandos cobertos, o pt-BR de sempre. O horario
 * sai no fuso do dono; a legenda do fuso fica com a superficie, uma vez por tela.
 */
export function linhaDeConducao(c: ConducaoAtual, opcoes: { agora?: string } = {}): string {
  return msg().thread.conduzido(c.canal, quemConduz(c), c.fase ?? '-',
    formatarDataHora(c.desde, opcoes.agora ? { agora: opcoes.agora } : {}));
}
