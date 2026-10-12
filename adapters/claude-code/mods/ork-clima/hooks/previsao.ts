// O Clima de Cota (RM-059, onda 1, F4; T4.1): a serie das janelas de limite da conta desta sessao e a
// previsao de quando cada uma acaba no ritmo atual (D4 a D6, D12 e D13 da thread). Modulo puro: so dados
// entram e saem, para o teste do nucleo transpila-lo sem o Claude Code. Nenhum `$` passa por aqui, e o
// fuso chega explicito: quem chama decide qual e.
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
/**
 * Serie mais nova que o intervalo so tem ritmo quando a primeira e a ultima leitura distam ao menos esta
 * fracao dele: 10 min na janela de 5 h, 4 h na de 7 d (D13).
 */
export const FRACAO_MINIMA_DO_INTERVALO = 6
/** A partir deste percentual a faixa avisa mesmo sem ritmo (D5). */
export const LIMIAR_DE_ATENCAO = 90
/** Na faixa, o percentual vai em degraus e a hora de acabar vai arredondada, para o texto nao mudar a cada ponto (D13). */
export const DEGRAU_DO_PERCENTUAL = 10
export const PASSO_DA_HORA_NA_FAIXA_MS = 15 * 60 * 1000
/** O texto da faixa nunca passa disto, o mesmo teto da ponte. */
export const TETO_DA_FAIXA = 200
/** Quantas threads que nao cabem a faixa nomeia antes do `e mais N`. */
export const TETO_NA_FAIXA = 3
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

/** O intervalo recente do ritmo de uma janela. */
export function intervaloDoRitmo(kind: string): number {
  return Object.prototype.hasOwnProperty.call(INTERVALO_DO_RITMO_MS, kind) ? (INTERVALO_DO_RITMO_MS[kind] as number)
    : INTERVALO_PADRAO_DO_RITMO_MS
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
 * Grava as leituras de uma medicao em que as janelas mudaram: uma serie por `kind`, serie nova quando a
 * janela renova (o `resetsAt` muda ou o percentual cai), tetos de pontos e de janelas (D4). A medicao traz
 * todas as janelas da conta, entao a janela vencida e a que saiu da leitura deixam a serie (D13).
 */
export function registrarLeituras(guardado: unknown, leituras: readonly unknown[] | undefined, agora: number): ClimaSerie {
  const lidas = (leituras ?? []).map(conferirLeitura).filter((l): l is NonNullable<ReturnType<typeof conferirLeitura>> => l !== null)
  const anteriores = lerSerie(guardado).janelas.filter(j => !vencida(j, agora))
  const janelas: ClimaJanela[] = []
  for (const l of lidas) {
    if (janelas.some(j => j.kind === l.kind)) continue
    const anterior = anteriores.find(j => j.kind === l.kind)
    const ultimo = anterior?.pontos[anterior.pontos.length - 1]
    const renovou = anterior !== undefined && (
      (anterior.renovaEm !== null && l.renovaEm !== null && Math.abs(anterior.renovaEm - l.renovaEm) > TOLERANCIA_DA_RENOVACAO_MS)
      || (ultimo !== undefined && ultimo.pct - l.pct >= QUEDA_QUE_RENOVA))
    const ponto = { em: agora, pct: l.pct }
    janelas.push(anterior === undefined || renovou
      ? { kind: l.kind, renovaEm: l.renovaEm, pontos: [ponto] }
      : { kind: l.kind, renovaEm: l.renovaEm ?? anterior.renovaEm, pontos: acrescentar(anterior.pontos, ponto) })
  }
  return { formato: FORMATO_DA_SERIE, janelas: janelas.sort(porKind).slice(0, TETO_DE_JANELAS) }
}

/**
 * O ritmo da janela, em pontos por ms, no intervalo recente (D13). Como o uso so cresce, o valor no inicio do
 * intervalo sai dos pontos que o cercam: exato quando o ultimo antes e o primeiro dentro sao iguais, e por
 * interpolacao quando nao sao; com leitura esparsa (D12), isso da a inclinacao desde o ultimo ponto antes do
 * intervalo. Serie mais nova que o intervalo precisa de `1/FRACAO_MINIMA_DO_INTERVALO` dele entre a primeira
 * e a ultima leitura; antes disso, nao ha ritmo.
 */
export function ritmoDaJanela(j: Pick<ClimaJanela, 'kind' | 'pontos'>): number | null {
  const ultimo = j.pontos[j.pontos.length - 1]
  const primeiro = j.pontos[0]
  if (ultimo === undefined || primeiro === undefined) return null
  const intervalo = intervaloDoRitmo(j.kind)
  const inicio = ultimo.em - intervalo
  const antes = [...j.pontos].reverse().find(p => p.em < inicio)
  const dentro = j.pontos.find(p => p.em >= inicio)
  if (antes !== undefined && dentro !== undefined) {
    const noInicio = antes.pct === dentro.pct ? antes.pct
      : antes.pct + (dentro.pct - antes.pct) * (inicio - antes.em) / (dentro.em - antes.em)
    return (ultimo.pct - noInicio) / intervalo
  }
  if (ultimo.em - primeiro.em < intervalo / FRACAO_MINIMA_DO_INTERVALO) return null
  return (ultimo.pct - primeiro.pct) / (ultimo.em - primeiro.em)
}

/** A previsao de cada janela que ainda nao renovou, da mais urgente para a mais calma. */
export function prever(guardado: unknown, agora: number): ClimaPrevisao[] {
  const previsoes: ClimaPrevisao[] = []
  for (const j of lerSerie(guardado).janelas) {
    const ultimo = j.pontos[j.pontos.length - 1]
    if (ultimo === undefined || vencida(j, agora)) continue
    const ritmoPorMs = ritmoDaJanela(j)
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
 * A hora no fuso, com o minuto truncado como o nucleo escreve: `16:40` no mesmo dia de `agora`, `13/10 09:00`
 * em outro dia e `13/10/2027 09:00` em outro ano.
 */
export function formatarHora(ms: number, fuso: string, agora: number): string {
  const p = partesLocais(ms, fuso)
  const a = partesLocais(agora, fuso)
  if (p.ano === a.ano && p.mes === a.mes && p.dia === a.dia) return `${p.hora}:${p.minuto}`
  return `${p.dia}/${p.mes}${p.ano !== a.ano ? `/${p.ano}` : ''} ${p.hora}:${p.minuto}`
}

/** `45min`, `1h30`, `2d 05h`, como o nucleo escreve; abaixo de 1 min, `menos de 1 min`. */
export function duracao(ms: number): string {
  const minutos = Math.floor(Math.abs(ms) / 60000)
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

/** O percentual da faixa em degraus: `70% ou mais`, ou `menos de 10%` (D13). */
export function percentualEmDegrau(pct: number): string {
  const degrau = Math.floor(pct / DEGRAU_DO_PERCENTUAL) * DEGRAU_DO_PERCENTUAL
  return degrau <= 0 ? `menos de ${DEGRAU_DO_PERCENTUAL}%` : `${degrau}% ou mais`
}

/** O trecho de uma janela na faixa: percentual em degraus e hora de acabar arredondada (D13). */
function trechoDaFaixa(p: ClimaPrevisao, fuso: string, agora: number): string {
  const renova = p.renovaEm === null ? '' : `, renova ${formatarHora(p.renovaEm, fuso, agora)}`
  if (p.estado === 'esgotada') return `${p.rotulo} esgotou${renova}`
  if (p.estado === 'acaba-antes' && p.acabaEm !== null) {
    const acaba = Math.round(p.acabaEm / PASSO_DA_HORA_NA_FAIXA_MS) * PASSO_DA_HORA_NA_FAIXA_MS
    return `${p.rotulo} com ${percentualEmDegrau(p.pct)}, acaba ~${formatarHora(acaba, fuso, agora)}${renova}`
  }
  return `${p.rotulo} com ${percentualEmDegrau(p.pct)}${renova}`
}

function cortar(texto: string, teto: number): string {
  return texto.length <= teto ? texto : texto.slice(0, teto - 1) + '…'
}

/**
 * A linha do Clima na faixa da ponte, ou `null` quando nenhuma janela pede atencao (a linha sai). As threads
 * que nao cabem vem primeiro, porque a faixa corta o fim da linha (D13).
 */
export function textoDaFaixa(previsoes: readonly ClimaPrevisao[], fuso: string, agora: number, naoCabem: readonly string[] = []): string | null {
  const trechos = previsoes.filter(pedeAtencao).map(p => trechoDaFaixa(p, fuso, agora))
  if (trechos.length === 0) return null
  const nomeadas = naoCabem.slice(0, TETO_NA_FAIXA)
  const mais = naoCabem.length > nomeadas.length ? ` e mais ${naoCabem.length - nomeadas.length}` : ''
  const inicio = nomeadas.length > 0 ? `não cabe: ${nomeadas.join(', ')}${mais}; ` : ''
  return cortar(inicio + trechos.join(' · '), TETO_DA_FAIXA)
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
  if (p.estado === 'esgotada') previsao = 'esgotou'
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
  const base = `O Clima de Cota só roda na sessão do dono de um projeto do Orkastery; o papel desta sessão é ${papel}.`
  return papel === 'dormente' ? `${base} Se o servidor orkastery ainda está conectando, tente de novo em instantes.` : base
}

/** O `/clima` sem a ponte, de quem o Clima depende para tudo; o erro interno nao vai ao dono (D13). */
export const TEXTO_SEM_PONTE = 'O Clima de Cota depende da ponte ork-ponte, que não respondeu nesta sessão; confira se ela está instalada e carregada.'

/** O motivo de um erro em uma linha curta. */
export function motivoDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : String(erro)
  return texto.replace(/\s+/g, ' ').trim().slice(0, 200)
}
