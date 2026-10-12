// Quando a Torre rele o nucleo (RM-059, Torre de Controle; D7 da thread). O ledger de uma thread ativa muda
// a cada batida do sensor, e cada retrato custa um passeio pelo servidor MCP do dono: a Torre junta os
// eventos de arquivo num lote so, rele cada thread no maximo a cada 10 s e confere a lista das abertas a
// cada minuto. Modulo puro: so dados entram e saem; os relogios ficam no register.tsx.

/** Espera entre o primeiro evento de arquivo e a leitura do lote. */
export const ESPERA_DO_LOTE_MS = 2000
/** Intervalo minimo entre duas leituras da mesma thread. */
export const INTERVALO_POR_THREAD_MS = 10000
/** Periodo do tique: confere a lista das abertas e o que ficou velho. */
export const PERIODO_DO_TIQUE_MS = 60000
/** Linha lida ha mais que isto volta a ser lida no tique, mesmo sem evento de arquivo. */
export const IDADE_MAXIMA_MS = 300000
/**
 * Com o painel escondido so a faixa le o quadro: o intervalo por thread e a idade maxima se espacam, porque
 * cada retrato roda a observacao nativa no servidor do dono (D16).
 */
export const INTERVALO_ESCONDIDO_MS = 60000
export const IDADE_MAXIMA_ESCONDIDO_MS = 900000

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

export type MarcaDoArquivo = { tipo: 'thread'; thread: string } | { tipo: 'lista' }

/**
 * O que um evento de arquivo marca: o ledger de uma thread marca a thread; a pasta das threads marca a
 * lista das abertas (thread nova ou fechada). Outro caminho nao marca nada.
 */
export function marcaDoArquivo(caminho: unknown): MarcaDoArquivo | null {
  if (typeof caminho !== 'string') return null
  const c = caminho.replace(/\\/g, '/').replace(/\/+$/, '')
  const m = /(?:^|\/)\.orkastery\/threads\/([^/]+)\/ledger\.jsonl$/.exec(c)
  if (m) return ID_DE_THREAD.test(m[1] as string) ? { tipo: 'thread', thread: m[1] as string } : null
  return /(?:^|\/)\.orkastery\/threads$/.test(c) ? { tipo: 'lista' } : null
}

/**
 * Das threads marcadas, as que podem ser lidas agora (fora do intervalo minimo) e as que ficam para depois,
 * com o instante mais cedo em que a primeira adiada pode ser lida.
 */
export function escolher(marcadas: Iterable<string>, lidaEm: Readonly<Record<string, number>>, agora: number,
  intervalo = INTERVALO_POR_THREAD_MS): { ler: string[]; adiadas: string[]; proximaEm: number | null } {
  const ler: string[] = []
  const adiadas: string[] = []
  let proximaEm: number | null = null
  for (const t of [...new Set(marcadas)].sort()) {
    const ultima = lidaEm[t]
    if (typeof ultima !== 'number' || agora - ultima >= intervalo) { ler.push(t); continue }
    adiadas.push(t)
    const quando = ultima + intervalo
    if (proximaEm === null || quando < proximaEm) proximaEm = quando
  }
  return { ler, adiadas, proximaEm }
}

/** No tique: as threads abertas que nunca foram lidas ou foram lidas ha mais que a idade maxima. */
export function vencidas(abertas: readonly string[], lidaEm: Readonly<Record<string, number>>, agora: number,
  idade = IDADE_MAXIMA_MS): string[] {
  return abertas.filter(t => typeof lidaEm[t] !== 'number' || agora - (lidaEm[t] as number) > idade)
}
