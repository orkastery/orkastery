// O que o Ritual do MASTER pede ao nucleo para a nota (RM-059, fatia F8, T8.3), em funcoes puras. Sao dois caminhos, e
// em nenhum o mod da a nota pelo dono:
//  - "Dar a nota" chama `ork_request_master_note` com exatamente `{ threadId }`: o nucleo abre o dialogo nativo do host,
//    o dono escolhe de 0 a 5 e escreve o porque, e o nucleo grava o MASTER com o recibo do ingresso local. Nenhum
//    argumento leva nota, porque ou texto.
//  - "Pelo Telegram" (a reserva, so no clique do dono, D7) roda `ork master pedir <thread> --formato json`: o nucleo guarda
//    o pedido de nota e devolve o codigo que o dono responde pelo Telegram. O pedido nao responde nada.
// So importa tipos.
import type { RitualNota, RitualReserva } from '../types'
import { exigirThread, umaLinha } from './ritual'

export const FERRAMENTA_DA_NOTA = 'ork_request_master_note'
/**
 * O dialogo do nucleo fecha em ate 300 s, a gravacao espera a trava da thread por ate 60 s e a resposta sai depois da
 * soltura ao fechar (o git das reservas e o runtime); o botao espera tudo isso, com folga.
 */
export const PRAZO_DA_NOTA_MS = 430000
/** O pedido pelo Telegram so grava o pedido de nota e devolve o codigo. */
export const PRAZO_DA_RESERVA_MS = 60000

/** Os argumentos do "Dar a nota": so o id da thread, nada que seja nota. */
export function argsDaNota(thread: string): { threadId: string } {
  return { threadId: exigirThread(thread) }
}

/** O argv da reserva pelo Telegram, montado so aqui: o pedido de nota do nucleo, nunca a nota. */
export function argvDaReserva(thread: string): string[] {
  return ['ork', 'master', 'pedir', exigirThread(thread), '--formato', 'json']
}

/** O que o cartao diz do "Dar a nota", a partir do que o nucleo devolveu (`{ ok, estado, repetida, score }`). */
export function resultadoDaNota(resposta: unknown, thread: string, agora: number): RitualNota {
  const r = (resposta && typeof resposta === 'object' ? resposta : {}) as { ok?: unknown; estado?: unknown; repetida?: unknown; score?: unknown }
  const nota = typeof r.score === 'number' && Number.isInteger(r.score) ? `${r.score}/5` : 'a nota'
  if (r.ok === true && r.estado === 'registrada') {
    return r.repetida === true
      ? { estado: 'repetida', texto: `a ${thread} já tinha nota humana ${nota} no núcleo`, em: agora }
      : { estado: 'registrada', texto: `nota ${nota} da ${thread} registrada pelo diálogo nativo`, em: agora }
  }
  return { estado: 'pendente', texto: 'o diálogo fechou sem nota; a entrega segue esperando', em: agora }
}

/**
 * O que o cartao diz quando o "Dar a nota" falhou: sem dialogo nativo (ou sem a ferramenta) a reserva aparece; a thread
 * que seguiu ocupada depois da resposta volta a ter o botao, sem reserva.
 */
export function notaDoErro(erro: unknown, agora: number): RitualNota {
  const motivo = umaLinha(erro)
  if (/master\.nota\.trava-ocupada/.test(motivo)) {
    return { estado: 'pendente', texto: 'a thread seguiu ocupada e a nota não foi gravada; dê de novo', em: agora }
  }
  if (/master\.nota\.sem-dialogo/.test(motivo)) {
    return { estado: 'sem-dialogo', texto: 'o diálogo nativo não abriu: este cliente MCP não abre formulário; peça a nota pelo Telegram', em: agora }
  }
  if (/mcp\.tool\.unknown/.test(motivo)) {
    return { estado: 'sem-dialogo', texto: 'o núcleo desta sessão não tem a ferramenta da nota; atualize o Orkastery ou peça a nota pelo Telegram', em: agora }
  }
  return { estado: 'erro', texto: `o Dar a nota falhou: ${motivo}; peça a nota pelo Telegram`, em: agora }
}

/** A reserva aparece quando o dialogo nao serviu (sem dialogo nativo ou erro do nucleo). */
export function pedeReserva(nota: RitualNota | undefined): boolean {
  return nota?.estado === 'sem-dialogo' || nota?.estado === 'erro'
}

/** Depois de uma recarga do modulo nenhum dialogo esta em curso: o que ficou `abrindo` volta a ter o botao. */
export function soltarAbrindo(notas: Readonly<Record<string, RitualNota>>): Record<string, RitualNota> {
  return Object.fromEntries(Object.entries(notas).map(([t, n]) => [t, n.estado === 'abrindo'
    ? { estado: 'pendente' as const, texto: 'o diálogo ficou sem resposta (o Ritual recarregou); a entrega segue esperando', em: n.em } : n]))
}

/** A saida do `ork master pedir --formato json`: o codigo que o dono responde pelo Telegram, ou o motivo da falha. */
export function lerReserva(saida: { exitCode: number; stdout: string; stderr: string }, thread: string, agora: number): RitualReserva {
  if (saida.exitCode !== 0) {
    const fim = umaLinha(saida.stderr.trim().split('\n').slice(-2).join(' ') || `saiu ${saida.exitCode}`)
    return { estado: 'erro', texto: `o pedido pelo Telegram falhou: ${fim}`, codigo: null, em: agora }
  }
  let p: { contrato?: unknown; thread?: unknown; codigo?: unknown }
  try {
    p = JSON.parse(saida.stdout) as typeof p
  } catch {
    return { estado: 'erro', texto: 'o pedido pelo Telegram não devolveu o contrato ork.master-nota/v1', codigo: null, em: agora }
  }
  if (!p || p.contrato !== 'ork.master-nota/v1' || p.thread !== thread || typeof p.codigo !== 'string' || !/^[0-9A-Za-z]{3,8}$/.test(p.codigo)) {
    return { estado: 'erro', texto: 'o pedido pelo Telegram não devolveu o contrato ork.master-nota/v1', codigo: null, em: agora }
  }
  return { estado: 'pronta', texto: `pelo Telegram, responda: ${p.codigo} <0 a 5> <porquê>`, codigo: p.codigo, em: agora }
}
