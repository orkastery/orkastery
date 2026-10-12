// O Clima de Cota (RM-059, onda 1, F4; T4.1): a serie das janelas de limite da conta desta sessao e a
// previsao de quando cada uma acaba no ritmo atual (D4 a D6 da thread). Modulo puro: so dados entram e
// saem, para o teste do nucleo transpila-lo sem o Claude Code. Nenhum `$` passa por aqui, e o fuso chega
// explicito: quem chama decide qual e.
import type { ClimaEstado, ClimaJanela, ClimaPonto, ClimaPrevisao, ClimaSerie } from '../types'

export const FORMATO_DA_SERIE = 'ork.clima-serie/v1'
/** A chave da serie no `$.store` do mod, que dura entre sessoes. */
export const CHAVE_DA_SERIE = 'serie'
export const TETO_DE_PONTOS = 120
export const TETO_DE_JANELAS = 8
/** Diferenca de `resetsAt` que ainda e a mesma janela. */
export const TOLERANCIA_DA_RENOVACAO_MS = 60 * 1000
/** Dentro da janela o uso so cresce: uma queda deste tamanho so acontece quando ela renova. */
export const QUEDA_QUE_RENOVA = 1
/** O ritmo sai deste intervalo recente, proporcional a janela de cota (D4). */
export const INTERVALO_DO_RITMO_MS: Readonly<Record<string, number>> = {
  five_hour: 60 * 60 * 1000,
  seven_day: 24 * 60 * 60 * 1000,
}
export const INTERVALO_PADRAO_DO_RITMO_MS = 60 * 60 * 1000
/** O ritmo so vale com dois pontos ou mais e este intervalo entre o primeiro e o ultimo. */
export const MINIMO_DO_RITMO_MS = 10 * 60 * 1000
/** A partir deste percentual a faixa avisa mesmo sem ritmo (D5). */
export const LIMIAR_DE_ATENCAO = 90
export const AVISO_DE_AUTORIDADE = 'O Clima só lê e avisa: troca de conta, de runtime ou de modelo fica com o núcleo e com você.'

const KIND = /^[a-z0-9][a-z0-9_.-]{0,63}$/i
const ORDEM_DOS_KINDS = ['five_hour', 'seven_day']
const ROTULOS: Readonly<Record<string, string>> = { five_hour: '5 h', seven_day: '7 d', spend_limit: 'gasto' }
const GRAVIDADE: Readonly<Record<ClimaEstado, number>> = { 'esgotada': 0, 'acaba-antes': 1, 'folga': 2, 'sem-ritmo': 3 }

function numero(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** `5 h`, `7 d`, `gasto` ou o proprio `kind`. */
export function rotuloDaJanela(kind: string): string {
  return Object.prototype.hasOwnProperty.call(ROTULOS, kind) ? (ROTULOS[kind] as string) : kind
}

function ordemDoKind(kind: string): number {
  const i = ORDEM_DOS_KINDS.indexOf(kind)
  return i < 0 ? ORDEM_DOS_KINDS.length : i
}

function porKind(a: { kind: string }, b: { kind: string }): number {
  return ordemDoKind(a.kind) - ordemDoKind(b.kind) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
}

/** A leitura conferida, ou `null` quando ela nao serve (kind estranho, percentual que nao e numero, data ruim). */
export function conferirLeitura(bruta: unknown): { kind: string; pct: number; renovaEm: number | null } | null {
  const l = (bruta ?? {}) as Record<string, unknown>
  if (typeof l.kind !== 'string' || !KIND.test(l.kind)) return null
  if (!numero(l.percentUsed) || l.percentUsed < 0 || l.percentUsed > 1000) return null
  let renovaEm: number | null = null
  if (l.resetsAt !== undefined && l.resetsAt !== null) {
    const t = typeof l.resetsAt === 'string' ? Date.parse(l.resetsAt) : NaN
    if (!Number.isFinite(t)) return null
    renovaEm = t
  }
  return { kind: l.kind, pct: Math.round(l.percentUsed * 10) / 10, renovaEm }
}

/** A serie guardada, ou uma vazia quando o que esta no store nao e deste formato. */
export function lerSerie(guardado: unknown): ClimaSerie {
  const s = guardado as Partial<ClimaSerie> | null | undefined
  const janelas: ClimaJanela[] = []
  if (s && s.formato === FORMATO_DA_SERIE && Array.isArray(s.janelas)) {
    for (const bruta of s.janelas) {
      const j = (bruta ?? {}) as Partial<ClimaJanela>
      if (typeof j.kind !== 'string' || !KIND.test(j.kind) || janelas.some(x => x.kind === j.kind)) continue
      if (!(j.renovaEm === null || numero(j.renovaEm))) continue
      const pontos = (Array.isArray(j.pontos) ? j.pontos : [])
        .filter((p): p is ClimaPonto => !!p && numero(p.em) && numero(p.pct))
        .map(p => ({ em: p.em, pct: p.pct }))
        .sort((a, b) => a.em - b.em)
      if (pontos.length > 0) janelas.push({ kind: j.kind, renovaEm: j.renovaEm, pontos: pontos.slice(-TETO_DE_PONTOS) })
    }
  }
  return { formato: FORMATO_DA_SERIE, janelas: janelas.sort(porKind).slice(0, TETO_DE_JANELAS) }
}

/** A janela ja renovou: a ultima leitura dela nao diz mais nada. */
export function vencida(j: Pick<ClimaJanela, 'renovaEm'>, agora: number): boolean {
  return j.renovaEm !== null && j.renovaEm + TOLERANCIA_DA_RENOVACAO_MS <= agora
}

/** Acrescenta o ponto em ordem de tempo; numa corrida plana ficam so o primeiro e o ultimo ponto. */
function acrescentar(pontos: readonly ClimaPonto[], novo: ClimaPonto): ClimaPonto[] {
  const ordenados = [...pontos.filter(p => p.em !== novo.em), novo].sort((a, b) => a.em - b.em)
  const saida: ClimaPonto[] = []
  for (const p of ordenados) {
    const ultimo = saida[saida.length - 1]
    const penultimo = saida[saida.length - 2]
    if (ultimo !== undefined && penultimo !== undefined && ultimo.pct === p.pct && penultimo.pct === p.pct) saida[saida.length - 1] = p
    else saida.push(p)
  }
  return saida.slice(-TETO_DE_PONTOS)
}

/**
 * Grava as leituras de uma medicao na serie: uma janela por `kind`, serie nova quando a janela renova (o
 * `resetsAt` muda ou o percentual cai), janela vencida fora, teto de pontos e de janelas (D4).
 */
export function registrarLeituras(guardado: unknown, leituras: readonly unknown[] | undefined, agora: number): ClimaSerie {
  const janelas = lerSerie(guardado).janelas.filter(j => !vencida(j, agora))
  for (const bruta of leituras ?? []) {
    const l = conferirLeitura(bruta)
    if (l === null) continue
    const i = janelas.findIndex(j => j.kind === l.kind)
    const anterior = i >= 0 ? janelas[i] : undefined
    const ultimo = anterior?.pontos[anterior.pontos.length - 1]
    const renovou = anterior !== undefined && (
      (anterior.renovaEm !== null && l.renovaEm !== null && Math.abs(anterior.renovaEm - l.renovaEm) > TOLERANCIA_DA_RENOVACAO_MS)
      || (ultimo !== undefined && ultimo.pct - l.pct >= QUEDA_QUE_RENOVA))
    const ponto = { em: agora, pct: l.pct }
    const janela: ClimaJanela = anterior === undefined || renovou
      ? { kind: l.kind, renovaEm: l.renovaEm, pontos: [ponto] }
      : { kind: l.kind, renovaEm: l.renovaEm ?? anterior.renovaEm, pontos: acrescentar(anterior.pontos, ponto) }
    if (i >= 0) janelas[i] = janela
    else janelas.push(janela)
  }
  return { formato: FORMATO_DA_SERIE, janelas: janelas.sort(porKind).slice(0, TETO_DE_JANELAS) }
}

/**
 * A previsao de cada janela que ainda nao renovou, da mais urgente para a mais calma. O ritmo e a diferenca
 * entre a primeira leitura do intervalo recente e a ultima, porque o uso so cresce dentro da janela (D4); com
 * leitura esparsa, entre a ultima e a mais nova que esta ao menos `MINIMO_DO_RITMO_MS` antes dela (D12).
 */
export function prever(guardado: unknown, agora: number): ClimaPrevisao[] {
  const previsoes: ClimaPrevisao[] = []
  for (const j of lerSerie(guardado).janelas) {
    const ultimo = j.pontos[j.pontos.length - 1]
    if (ultimo === undefined || vencida(j, agora)) continue
    const intervalo = Object.prototype.hasOwnProperty.call(INTERVALO_DO_RITMO_MS, j.kind)
      ? (INTERVALO_DO_RITMO_MS[j.kind] as number) : INTERVALO_PADRAO_DO_RITMO_MS
    const recentes = j.pontos.filter(p => p.em >= ultimo.em - intervalo)
    let primeiro = recentes[0]
    if (primeiro === undefined || ultimo.em - primeiro.em < MINIMO_DO_RITMO_MS) {
      // Leitura esparsa (o dono parado enquanto as fases gastam a mesma conta): o intervalo recente ficou com um
      // ponto so, e o ritmo sai do ponto mais novo que guarda o minimo de distancia, dentro da mesma janela.
      primeiro = [...j.pontos].reverse().find(p => ultimo.em - p.em >= MINIMO_DO_RITMO_MS)
    }
    const ritmoPorMs = primeiro !== undefined && ultimo.em - primeiro.em >= MINIMO_DO_RITMO_MS
      ? (ultimo.pct - primeiro.pct) / (ultimo.em - primeiro.em) : null
    let estado: ClimaEstado
    let acabaEm: number | null = null
    if (ultimo.pct >= 100) estado = 'esgotada'
    else if (ritmoPorMs === null) estado = 'sem-ritmo'
    else if (ritmoPorMs <= 0) estado = 'folga'
    else {
      acabaEm = Math.round(ultimo.em + (100 - ultimo.pct) / ritmoPorMs)
      estado = j.renovaEm !== null && acabaEm >= j.renovaEm ? 'folga' : 'acaba-antes'
    }
    previsoes.push({
      kind: j.kind, rotulo: rotuloDaJanela(j.kind), pct: ultimo.pct, lidaEm: ultimo.em, renovaEm: j.renovaEm,
      ritmoPorHora: ritmoPorMs === null ? null : Math.round(ritmoPorMs * 3600 * 1000 * 10) / 10, acabaEm, estado,
    })
  }
  return previsoes.sort((a, b) => GRAVIDADE[a.estado] - GRAVIDADE[b.estado] || porKind(a, b))
}

/** A janela ja se esgotou ou acaba antes de renovar no ritmo atual. */
export function emAlerta(p: ClimaPrevisao): boolean {
  return p.estado === 'esgotada' || p.estado === 'acaba-antes'
}

/** A janela pede atencao na faixa: em alerta, ou no limiar mesmo sem ritmo (D5). */
export function pedeAtencao(p: ClimaPrevisao): boolean {
  return emAlerta(p) || p.pct >= LIMIAR_DE_ATENCAO
}

type Partes = { ano: string; mes: string; dia: string; hora: string; minuto: string }

function partesLocais(ms: number, fuso: string): Partes {
  let f: Intl.DateTimeFormat
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  } catch {
    f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }
  const p: Record<string, string> = {}
  for (const parte of f.formatToParts(new Date(ms))) p[parte.type] = parte.value
  return { ano: p.year ?? '', mes: p.month ?? '', dia: p.day ?? '', hora: p.hour ?? '', minuto: p.minute ?? '' }
}

/**
 * A hora no fuso, arredondada ao minuto: `16:40` no mesmo dia de `agora`, `13/10 09:00` em outro dia e
 * `13/10/2027 09:00` em outro ano, como o nucleo escreve.
 */
export function formatarHora(ms: number, fuso: string, agora: number): string {
  const p = partesLocais(Math.round(ms / 60000) * 60000, fuso)
  const a = partesLocais(agora, fuso)
  if (p.ano === a.ano && p.mes === a.mes && p.dia === a.dia) return `${p.hora}:${p.minuto}`
  return `${p.dia}/${p.mes}${p.ano !== a.ano ? `/${p.ano}` : ''} ${p.hora}:${p.minuto}`
}

/** `45min`, `1h30`, `2d 05h`, como o nucleo escreve; abaixo de 1 min, `menos de 1 min`. */
export function duracao(ms: number): string {
  const minutos = Math.round(Math.abs(ms) / 60000)
  if (minutos < 1) return 'menos de 1 min'
  if (minutos < 60) return `${minutos}min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas}h${String(minutos % 60).padStart(2, '0')}`
  return `${Math.floor(horas / 24)}d ${String(horas % 24).padStart(2, '0')}h`
}

/** `em 1h30` ou `há 10min`, relativo a `agora`. */
export function distancia(ms: number, agora: number): string {
  return ms >= agora ? `em ${duracao(ms - agora)}` : `há ${duracao(agora - ms)}`
}

/** O numero com virgula decimal e no maximo uma casa. */
export function numeroBr(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',')
}

/** O trecho de uma janela na faixa, so com horas absolutas: o texto so muda com leitura nova (D5). */
function trechoDaFaixa(p: ClimaPrevisao, fuso: string, agora: number): string {
  const renova = p.renovaEm === null ? '' : `, renova ${formatarHora(p.renovaEm, fuso, agora)}`
  if (p.estado === 'esgotada') return `${p.rotulo} esgotada${renova}`
  if (p.estado === 'acaba-antes' && p.acabaEm !== null) {
    return `${p.rotulo} em ${numeroBr(p.pct)}%, acaba ~${formatarHora(p.acabaEm, fuso, agora)}${renova}`
  }
  return `${p.rotulo} em ${numeroBr(p.pct)}%${renova}`
}

/** A linha do Clima na faixa da ponte, ou `null` quando nenhuma janela pede atencao (a linha sai). */
export function textoDaFaixa(previsoes: readonly ClimaPrevisao[], fuso: string, agora: number, sufixo = ''): string | null {
  const trechos = previsoes.filter(pedeAtencao).map(p => trechoDaFaixa(p, fuso, agora))
  return trechos.length === 0 ? null : trechos.join(' · ') + sufixo
}

/** `às 14:30` hoje, `em 11/10 14:30` em outro dia. */
function quandoLida(ms: number, fuso: string, agora: number): string {
  const hora = formatarHora(ms, fuso, agora)
  return hora.includes('/') ? `em ${hora}` : `às ${hora}`
}

/** Uma janela no `/clima`, com o ritmo, a previsao, a renovacao, as distancias e a hora da leitura. */
export function linhaDaJanela(p: ClimaPrevisao, fuso: string, agora: number): string {
  const ritmo = p.ritmoPorHora === null ? 'ritmo ainda sem leituras suficientes' : `ritmo de ${numeroBr(p.ritmoPorHora)} pontos por hora`
  let previsao: string
  if (p.estado === 'esgotada') previsao = 'esgotada'
  else if (p.estado === 'acaba-antes' && p.acabaEm !== null) {
    previsao = `acaba ~${formatarHora(p.acabaEm, fuso, agora)} (${distancia(p.acabaEm, agora)}), antes de renovar`
  } else if (p.estado === 'folga') previsao = 'folga no ritmo atual'
  else previsao = 'sem previsão ainda'
  const renova = p.renovaEm === null ? 'sem hora de renovação' : `renova ${formatarHora(p.renovaEm, fuso, agora)} (${distancia(p.renovaEm, agora)})`
  return `- ${p.rotulo}: ${numeroBr(p.pct)}%, ${ritmo}, ${previsao}, ${renova}. Lida ${quandoLida(p.lidaEm, fuso, agora)}.`
}

/** O texto do `/clima`: as janelas da conta desta sessao, o que vier depois delas e o aviso de autoridade. */
export function textoDoClima(previsoes: readonly ClimaPrevisao[], fuso: string, agora: number, extras: readonly string[] = []): string {
  const linhas = ['Clima de cota da conta desta sessão']
  if (previsoes.length === 0) {
    linhas.push('Sem leitura de cota ainda. A leitura chega na medição depois de uma resposta da API desta sessão, e só existe em conta de assinatura.')
  } else {
    for (const p of previsoes) linhas.push(linhaDaJanela(p, fuso, agora))
  }
  return [...linhas, ...extras, AVISO_DE_AUTORIDADE].join('\n')
}

/** O `/clima` fora da sessao do dono: o Clima so roda nela (D3). */
export function textoForaDoDono(papel: string): string {
  return `O Clima de Cota só roda na sessão do dono de um projeto do Orkastery; o papel desta sessão é ${papel}.`
}

/** O `/clima` sem a ponte, de quem o Clima depende para tudo. */
export function textoSemPonte(motivo: string): string {
  return `O Clima de Cota depende da ponte ork-ponte, que não respondeu (${motivo}).`
}

/** O motivo de um erro em uma linha curta. */
export function motivoDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : String(erro)
  return texto.replace(/\s+/g, ' ').trim().slice(0, 200)
}
