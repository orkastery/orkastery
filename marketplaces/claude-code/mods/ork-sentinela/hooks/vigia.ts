// A leitura da condução pela Sentinela (RM-059, fatia F6, T6.1). Módulo puro: o argv do status e da batida, a
// leitura do contrato `ork.conducao-sentinela/v1`, a thread de um ledger que mudou, o diário, as chaves guardadas e
// a linha da faixa. As chamadas ao `$` ficam no register.ts.
import type { SentinelaEntrada, SentinelaPasso, SentinelaPresenca, SentinelaResumo } from '../types'

export const MOD = 'ork-sentinela'
export const CONTRATO = 'ork.conducao-sentinela/v1'
/** A batida da presença e a rodada de reserva: a mesma cadência do núcleo (`BATIDA_DA_SENTINELA_MS`). */
export const BATIDA_MS = 60000
/** Um ledger que muda acorda a rodada depois deste intervalo, para juntar as linhas do mesmo evento. */
export const ESPERA_DO_LEDGER_MS = 1500
/** O status lê todas as threads abertas: até 20 s, com folga sobre o que se mede (1 a 4 s). */
export const PRAZO_DO_STATUS_MS = 20000
export const PRAZO_DA_BATIDA_MS = 10000
export const TETO_DO_DIARIO = 50
export const TETO_DE_CHAVES = 200
export const ACOES: readonly string[] = ['despachar', 'retomar', 'avisar', 'nada']
export const FASES: readonly string[] = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER']
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const SESSAO = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const LEDGER = /\/\.orkastery\/threads\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})\/ledger\.jsonl$/

export function idDeThreadValido(t: unknown): t is string {
  return typeof t === 'string' && ID_DE_THREAD.test(t)
}

export function sessaoValida(s: unknown): s is string {
  return typeof s === 'string' && SESSAO.test(s)
}

function exigirSessao(sessao: unknown): string {
  if (!sessaoValida(sessao)) throw new Error('ork-sentinela: id de sessao invalido')
  return sessao
}

/** O status do núcleo: a presença desta máquina e o passo do condutor em cada thread aberta. */
export function argvDoStatus(): string[] {
  return ['ork', 'conducao', 'sentinela', 'status', '--json']
}

/** A batida da presença desta sessão. */
export function argvDaBatida(sessao: string): string[] {
  return ['ork', 'conducao', 'sentinela', 'bater', '--sessao', exigirSessao(sessao), '--json']
}

/** Tira a presença desta sessão (pausa e fim da sessão). */
export function argvDoDesligar(sessao: string): string[] {
  return ['ork', 'conducao', 'sentinela', 'desligar', '--sessao', exigirSessao(sessao), '--json']
}

type Saida = { exitCode: number; stdout: string; stderr: string }

function ultimaLinha(texto: unknown): string {
  return String(texto ?? '').trim().split('\n').filter(l => l.trim() !== '').slice(-1)[0]?.trim().slice(0, 200) ?? ''
}

function texto(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** Um passo do contrato, ou `null` quando ele não tem a forma: passo torto nunca vira despacho. */
export function lerPasso(bruto: unknown): SentinelaPasso | null {
  const p = bruto as Record<string, unknown> | null
  if (!p || typeof p !== 'object' || !idDeThreadValido(p.thread) || typeof p.acao !== 'string' || !ACOES.includes(p.acao)) return null
  const fase = texto(p.fase)
  if (p.acao === 'despachar' && (fase === null || !FASES.includes(fase))) return null
  const b = p.bloqueio as { motivo?: unknown; em?: unknown } | null | undefined
  return {
    thread: p.thread, modo: texto(p.modo) ?? '', faseAtual: texto(p.faseAtual) ?? '', conduzida: p.conduzida === true,
    acao: p.acao as SentinelaPasso['acao'], fase: fase && FASES.includes(fase) ? fase : null,
    caso: texto(p.caso), proximoPasso: texto(p.proximoPasso), porque: texto(p.porque) ?? '', desdeEm: texto(p.desdeEm),
    bloqueio: b && typeof b.motivo === 'string' && typeof b.em === 'string' ? { motivo: b.motivo, em: b.em } : null,
    pedidoGuardado: p.pedidoGuardado === true,
  }
}

/** A leitura do `status --json`: recusa o que não for o contrato; a presença diz de quem é, frente a esta sessão. */
export function lerStatus(r: Saida, sessao: string | null): { presenca: SentinelaPresenca; passos: SentinelaPasso[] } {
  if (r.exitCode !== 0) throw new Error(`o status do nucleo saiu ${r.exitCode}${ultimaLinha(r.stderr) ? `: ${ultimaLinha(r.stderr)}` : ''}`)
  let s: { contrato?: unknown; presenca?: { ativa?: unknown; sessao?: unknown } | null; threads?: unknown }
  try { s = JSON.parse(r.stdout) } catch { throw new Error('o status do nucleo nao e JSON') }
  if (!s || s.contrato !== CONTRATO || !Array.isArray(s.threads)) throw new Error(`o status do nucleo nao e o contrato ${CONTRATO}`)
  const p = s.presenca
  const presenca: SentinelaPresenca = !p || p.ativa !== true ? 'nenhuma' : p.sessao === sessao ? 'minha' : 'outra'
  const passos = s.threads.map(lerPasso).filter((x): x is SentinelaPasso => x !== null)
  return { presenca, passos }
}

/** A batida: `minha` com saída 0 e `ok`; `outra` com saída 3 (outra sessão viva nesta máquina); o resto é erro. */
export function lerBatida(r: Saida): SentinelaPresenca {
  let ok: unknown
  try { ok = (JSON.parse(r.stdout) as { ok?: unknown }).ok } catch { ok = undefined }
  if (r.exitCode === 0 && ok === true) return 'minha'
  if (r.exitCode === 3 && ok === false) return 'outra'
  throw new Error(`a batida da presenca saiu ${r.exitCode}${ultimaLinha(r.stderr) ? `: ${ultimaLinha(r.stderr)}` : ''}`)
}

/** A thread de um ledger que mudou (`.../.orkastery/threads/<id>/ledger.jsonl`), ou `null`. */
export function threadDoLedger(caminho: unknown): string | null {
  const m = typeof caminho === 'string' ? LEDGER.exec(caminho) : null
  return m ? (m[1] as string) : null
}

/** Acrescenta no fim e corta os mais velhos acima do teto. */
export function acrescentar<T>(lista: readonly T[] | undefined, item: T, teto: number): T[] {
  return [...(lista ?? []), item].slice(-teto)
}

/** Guarda uma chave sem repetir, com teto: as mais velhas saem primeiro. */
export function guardarChave(chaves: readonly string[] | undefined, chave: string, teto = TETO_DE_CHAVES): string[] {
  const resto = (chaves ?? []).filter(c => c !== chave)
  return [...resto, chave].slice(-teto)
}

export function entrada(em: number, tipo: SentinelaEntrada['tipo'], thread: string | null, texto: string): SentinelaEntrada {
  return { em, tipo, thread, texto: texto.replace(/\s+/g, ' ').trim().slice(0, 300) }
}

function minutosDesde(iso: string | null, agora: number): number | null {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / 60000)) : null
}

function contar(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

/**
 * Há quanto tempo, em degraus (mais de 15, 30 ou 45 min, depois horas inteiras): a linha da faixa não muda a cada
 * minuto, e o registro do mostrado não ganha uma linha nova por minuto. Antes de 15 min, nada.
 */
export function haQuantoTempo(minutos: number): string {
  if (minutos < 15) return ''
  if (minutos < 60) return `há mais de ${Math.floor(minutos / 15) * 15} min`
  return `há mais de ${Math.floor(minutos / 60)} h`
}

/**
 * A linha da faixa: quantas threads andam, quantas estão paradas e há quanto tempo a mais antiga, quantas estão na vez
 * da Sentinela e quantos avisos do pulse esperam o dono. Pausada, ou com outra sessão conduzindo, diz isso. Sem nada a
 * dizer, a linha sai.
 */
export function textoDaFaixa(r: SentinelaResumo, pausada: boolean, agora: number, avisos = 0): string | undefined {
  if (pausada) return 'pausada; o condutor externo conduz'
  if (r.presenca === 'outra') return 'outra sessão conduz nesta máquina; esta só olha'
  if (r.lidoEm === null) return r.erro ? `sem leitura do núcleo (${r.erro})` : undefined
  const andando = r.passos.filter(p => p.conduzida).length
  const paradas = r.passos.filter(p => !p.conduzida && p.acao === 'avisar')
  const naVez = r.passos.filter(p => !p.conduzida && (p.acao === 'despachar' || p.acao === 'retomar')).length
  if (andando === 0 && paradas.length === 0 && naVez === 0 && avisos === 0) return r.erro ? `sem leitura do núcleo (${r.erro})` : undefined
  const partes = [contar(andando, 'thread andando', 'threads andando')]
  if (paradas.length > 0) {
    const ha = haQuantoTempo(Math.max(...paradas.map(p => minutosDesde(p.desdeEm, agora) ?? 0)))
    partes.push(`${contar(paradas.length, 'parada', 'paradas')}${ha ? ` ${ha}` : ''}`)
  }
  if (naVez > 0) partes.push(`${naVez} na vez da Sentinela`)
  if (avisos > 0) partes.push(contar(avisos, 'aviso para você', 'avisos para você'))
  return partes.join(', ')
}

const ROTULO: Record<string, string> = { despachar: 'despachar', retomar: 'retomar', avisar: 'parada', nada: 'nada' }

/** O `/sentinela`: o estado, o passo de cada thread e o diário mais recente. */
export function textoDoDiario(r: SentinelaResumo, diario: readonly SentinelaEntrada[], pausada: boolean, agora: number): string {
  const linhas: string[] = []
  linhas.push(pausada ? 'Sentinela pausada: o condutor externo conduz. Para voltar: /sentinela retomar.'
    : r.presenca === 'outra' ? 'Outra sessão conduz pela Sentinela nesta máquina; esta só olha.'
    : r.presenca === 'minha' ? 'Sentinela conduzindo nesta máquina: o condutor externo cede o despacho e o retry.'
    : 'Sentinela ligada, sem a presença confirmada pelo núcleo ainda.')
  if (r.erro) linhas.push(`Última leitura do núcleo falhou: ${r.erro}`)
  if (r.passos.length > 0) {
    linhas.push('', 'Threads abertas:')
    for (const p of r.passos) {
      const acao = p.conduzida ? 'andando' : p.acao === 'despachar' ? `despachar ${p.fase}` : ROTULO[p.acao] ?? p.acao
      const desde = !p.conduzida && p.acao === 'avisar' ? minutosDesde(p.desdeEm, agora) : null
      linhas.push(`  ${p.thread}: ${acao}${desde ? ` há ${desde} min` : ''}${p.proximoPasso && p.acao === 'avisar' ? `; ${p.proximoPasso}` : ''}`)
    }
  }
  const recentes = diario.slice(-10)
  linhas.push('', recentes.length ? 'Diário (mais recente por último):' : 'Diário vazio: nada despachado nesta sessão.')
  for (const e of recentes) {
    const ha = Math.max(0, Math.floor((agora - e.em) / 60000))
    linhas.push(`  ${ha === 0 ? 'agora' : `há ${ha} min`} ${e.tipo}${e.thread ? ` ${e.thread}` : ''}: ${e.texto}`)
  }
  return linhas.join('\n')
}
