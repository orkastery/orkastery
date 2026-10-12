// O painel da Torre de Controle (RM-059, fatia F1; ficha M3 do plano dos mods). Uma linha por thread aberta
// desta maquina, montada so do retrato da thread (`ork.maestro-snapshot/v1`) que a ponte entrega por
// `$.ork.retrato`: o trilho das seis fases, o modo, quem conduz e desde quando, o bloqueio tipado numa frase,
// os pedidos ao dono e as acoes que o nucleo declara disponiveis. Modulo puro: o `$` fica no register.tsx, e
// o desenho recebe a tabela de elementos que a superficie resolveu.
import type { TorreAcao, TorreEstado, TorreFase, TorreLinha, TorrePedido, TorreQuadro, TorreSessao } from '../types'
import { fraseDoMotivo, MOTIVOS_DO_DONO } from './frases'

export const FASES: readonly TorreFase[] = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER']
/** A ordem das linhas (D6): o que pede acao do dono primeiro. */
export const ORDEM_DO_ESTADO: readonly TorreEstado[] = ['espera-voce', 'parada', 'andando', 'quieta', 'sem-leitura']
/** Teto de threads no painel: cada uma custa um retrato. */
export const TETO_DE_THREADS = 40
/** As operacoes que so leem; as outras tem efeito e nunca rodam pela Torre (D4). */
export const LEITURAS: readonly string[] = ['thread.status', 'thread.observe', 'git.status']
/** A ordem e o rotulo de cada operacao do retrato (o enum `operation` do nucleo). */
export const ROTULO_DA_ACAO: Readonly<Record<string, string>> = {
  'thread.status': 'Estado',
  'thread.observe': 'Observar',
  'git.status': 'Git',
  'hitl.decide': 'Decidir',
  'retry': 'Retomar',
  'phase': 'Fase seguinte',
  'verify': 'Verificar',
  'ship': 'Entregar',
  'master': 'Nota do MASTER',
  'git.commit': 'Commit',
  'creation': 'Criação',
}
const ORDEM_DAS_ACOES = Object.keys(ROTULO_DA_ACAO)
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const SECOES_LIDAS = ['threads', 'sessions', 'blockers', 'hitl', 'nextActions']
const TAG_DO_MODO: Readonly<Record<string, string>> = { classic: '#Classic', maestro: '#Maestro', auto: '#Auto', fast: '#Fast' }
const MARCA_DO_ESTADO: Readonly<Record<TorreEstado, string>> = {
  'espera-voce': '!', 'parada': 'x', 'andando': '>', 'quieta': '-', 'sem-leitura': '?',
}

type Item = { id?: unknown; title?: unknown; status?: unknown; refs?: unknown; facts?: unknown; action?: unknown }
type Retrato = { sections?: Record<string, { state?: unknown; items?: unknown } | undefined> } | null | undefined

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function itens(retrato: Retrato, secao: string): Item[] {
  const s = retrato?.sections?.[secao]
  return Array.isArray(s?.items) ? (s?.items as unknown[]).filter((i): i is Item => !!i && typeof i === 'object') : []
}

function fatos(item: Item): Record<string, unknown> {
  return item.facts && typeof item.facts === 'object' ? item.facts as Record<string, unknown> : {}
}

/** O item e desta thread pela referencia `thread`, nunca pelo titulo. */
function daThread(item: Item, thread: string): boolean {
  return Array.isArray(item.refs) && item.refs.some(r => !!r && typeof r === 'object' &&
    (r as { kind?: unknown }).kind === 'thread' && (r as { id?: unknown }).id === thread)
}

/** As threads abertas da consulta `thread.list` da ponte (`ork thread list --json`), em ordem e com teto. */
export function abertasDaLista(lista: unknown, teto = TETO_DE_THREADS): { ids: string[]; omitidas: number } {
  const threads = (lista as { threads?: unknown } | null)?.threads
  if (!Array.isArray(threads)) throw new Error('a lista das threads veio sem o campo threads')
  const ids = [...new Set(threads.filter(t => !!t && typeof t === 'object' && typeof t.id === 'string' &&
    ID_DE_THREAD.test(t.id) && t.status !== 'fechada').map(t => t.id as string))].sort()
  return { ids: ids.slice(0, teto), omitidas: Math.max(0, ids.length - teto) }
}

/** O estado da linha (D6): pedido ou bloqueio do dono, outro bloqueio, alguem conduzindo, ou nada. */
export function estadoDaLinha(l: Pick<TorreLinha, 'pedidos' | 'bloqueio' | 'conducao'>, lido: boolean): TorreEstado {
  if (!lido) return 'sem-leitura'
  if (l.pedidos.length > 0 || (l.bloqueio !== null && MOTIVOS_DO_DONO.includes(l.bloqueio.motivo))) return 'espera-voce'
  if (l.bloqueio !== null) return 'parada'
  return l.conducao !== null ? 'andando' : 'quieta'
}

/**
 * A linha de uma thread a partir do retrato dela. Sem retrato (a leitura falhou), a linha diz que nao leu e
 * por que, sem inventar fase nem estado.
 */
export function linhaDaThread(thread: string, retrato: unknown,
  meta: { fonte: TorreLinha['fonte']; lidoEm: number | null; erro?: string }): TorreLinha {
  const r = retrato as Retrato
  const lido = !!r && typeof r === 'object' && !meta.erro
  const linha = itens(r, 'threads').find(i => i.id === thread)
  const f = linha ? fatos(linha) : {}
  const sessoesDoRetrato = itens(r, 'sessions').filter(i => daThread(i, thread))
  const conducao = sessoesDoRetrato.map(i => texto(fatos(i).conduction)).find((c): c is string => c !== null) ?? null
  const sessoes: TorreSessao[] = sessoesDoRetrato.filter(i => typeof i.id === 'string' && !i.id.startsWith('conducao:'))
    .map(i => ({ id: i.id as string, rotulo: texto(i.title) ?? '', estado: texto(i.status) ?? 'unknown',
      conduz: texto(fatos(i).conduction) !== null, confirmada: fatos(i).nativeConfirmed === true }))
  const gate = itens(r, 'blockers').find(i => daThread(i, thread) && i.id === `gate:${thread}`)
  const motivo = gate ? texto(fatos(gate).reason) ?? texto(gate.title) : null
  const pedidos: TorrePedido[] = itens(r, 'hitl').filter(i => daThread(i, thread) && i.status !== 'stale' && typeof i.id === 'string')
    .map(i => ({ id: i.id as string, texto: texto(i.title) ?? '', prazo: texto(fatos(i).deadlineLocal) ?? '',
      recomendacao: texto(fatos(i).recommendation) ?? '' }))
  const acoes: TorreAcao[] = itens(r, 'nextActions').filter(i => daThread(i, thread))
    .map(i => i.action as { operation?: unknown; available?: unknown } | undefined)
    .filter((a): a is { operation: string; available: true } => !!a && a.available === true && typeof a.operation === 'string')
    .map(a => ({ operacao: a.operation }))
    .filter((a, i, todas) => todas.findIndex(b => b.operacao === a.operacao) === i)
    .sort((a, b) => posicao(a.operacao) - posicao(b.operacao))
  const lacunas = lido
    ? [...(linha ? [] : ['a thread não veio no retrato']),
      ...SECOES_LIDAS.filter(s => ['unavailable', 'conflict', 'stale'].includes(String(r?.sections?.[s]?.state)))
        .map(s => `${s}: ${String(r?.sections?.[s]?.state)}`)]
    : [meta.erro ?? 'o retrato não veio']
  const base = {
    thread,
    fase: texto(f.phase),
    modo: texto(f.mode),
    conducao,
    bloqueio: motivo ? { motivo, frase: fraseDoMotivo(motivo) } : null,
    pedidos,
    sessoes,
    entrega: texto(itens(r, 'ship').find(i => daThread(i, thread))?.status),
    master: texto(itens(r, 'master').find(i => daThread(i, thread))?.status),
    acoes,
    fonte: meta.fonte,
    lidoEm: meta.lidoEm,
    lacunas,
  }
  return { ...base, estado: estadoDaLinha(base, lido) }
}

function posicao(operacao: string): number {
  const i = ORDEM_DAS_ACOES.indexOf(operacao)
  return i < 0 ? ORDEM_DAS_ACOES.length : i
}

/** As linhas na ordem do estado (D6) e, dentro dele, pelo id. */
export function ordenarLinhas(linhas: readonly TorreLinha[]): TorreLinha[] {
  return [...linhas].sort((a, b) => ORDEM_DO_ESTADO.indexOf(a.estado) - ORDEM_DO_ESTADO.indexOf(b.estado) ||
    (a.thread < b.thread ? -1 : a.thread > b.thread ? 1 : 0))
}

/** O trilho das seis fases: feita, atual, por vir; fase fora do ciclo deixa o trilho apagado. */
export function trilho(fase: string | null): string {
  const i = fase === null ? -1 : FASES.indexOf(fase as TorreFase)
  return FASES.map((_, j) => (i < 0 ? '·' : j < i ? '●' : j === i ? '◉' : '○')).join('')
}

export function modoComTag(modo: string | null): string {
  if (modo === null) return ''
  return TAG_DO_MODO[modo] ?? `#${modo}`
}

/** Idade curta: segundos, minutos ou horas. */
export function idade(ms: number): string {
  const t = Math.max(0, ms)
  if (t < 60000) return `${Math.floor(t / 1000)} s`
  if (t < 3600000) return `${Math.floor(t / 60000)} min`
  return `${Math.floor(t / 3600000)} h`
}

/** O placar de uma linha no topo do painel. */
export function placar(q: TorreQuadro, agora: number): string {
  if (q.lidoEm === null) return q.erro ? `Torre: não li o núcleo (${q.erro})` : 'Torre: lendo o núcleo…'
  const lido = `lido há ${idade(agora - q.lidoEm)}`
  const total = q.linhas.length + q.omitidas
  if (total === 0) return `nenhuma thread aberta nesta máquina · ${lido}`
  const conta = (e: TorreEstado) => q.linhas.filter(l => l.estado === e).length
  const partes = [total === 1 ? '1 thread aberta' : `${total} threads abertas`]
  const espera = conta('espera-voce')
  const paradas = conta('parada')
  const andando = conta('andando')
  const semLeitura = conta('sem-leitura')
  if (espera) partes.push(espera === 1 ? '1 espera você' : `${espera} esperam você`)
  if (paradas) partes.push(paradas === 1 ? '1 parada' : `${paradas} paradas`)
  if (andando) partes.push(`${andando} andando`)
  if (semLeitura) partes.push(semLeitura === 1 ? '1 sem leitura' : `${semLeitura} sem leitura`)
  partes.push(lido)
  if (q.erro) partes.push(`a lista não foi relida: ${q.erro}`)
  return partes.join(' · ')
}

/** A primeira linha de cada thread: estado, id, trilho, fase e modo. */
export function cabecalhoDaLinha(l: TorreLinha): string {
  return [MARCA_DO_ESTADO[l.estado], l.thread, `${trilho(l.fase)} ${l.fase ?? '?'}`, modoComTag(l.modo)]
    .filter(p => p !== '').join('  ')
}

/** As linhas de baixo: o que espera o dono, o bloqueio, quem conduz, as acoes com efeito e as lacunas. */
export function detalhesDaLinha(l: TorreLinha): string[] {
  const saida: string[] = []
  for (const p of l.pedidos) saida.push(`espera você: ${p.texto || p.id}${p.prazo ? ` (prazo ${p.prazo})` : ''}`)
  if (l.bloqueio) {
    const doDono = MOTIVOS_DO_DONO.includes(l.bloqueio.motivo)
    saida.push(`${doDono ? 'espera você' : 'parada'}: ${l.bloqueio.frase} (${l.bloqueio.motivo})`)
  }
  if (l.estado !== 'sem-leitura') saida.push(l.conducao ?? 'ninguém conduz agora')
  const efeitos = l.acoes.filter(a => !LEITURAS.includes(a.operacao)).map(a => ROTULO_DA_ACAO[a.operacao] ?? a.operacao)
  if (efeitos.length) saida.push(`ações: ${efeitos.join(' · ')}`)
  if (l.lacunas.length) saida.push(`lacuna: ${l.lacunas.join('; ')}`)
  return saida
}

/**
 * O que o painel mostra e o Telegram nao precisa repetir (M5 do dono, D10): cada bloqueio e cada pedido,
 * com a chave que junta o que e a mesma coisa.
 */
export function mostradosDoQuadro(q: TorreQuadro): Array<{ chave: string; thread: string; texto: string }> {
  const saida: Array<{ chave: string; thread: string; texto: string }> = []
  for (const l of q.linhas) {
    if (l.bloqueio) saida.push({ chave: `bloqueio:${l.thread}:${l.bloqueio.motivo}`, thread: l.thread, texto: `${l.thread}: ${l.bloqueio.frase}` })
    for (const p of l.pedidos) saida.push({ chave: `hitl:${p.id}`, thread: l.thread, texto: `${l.thread}: espera você: ${p.texto || p.id}` })
  }
  return saida
}

/**
 * A arvore do painel com os elementos que a superficie resolveu (`$.ui.resolve(e)` no register.tsx). A
 * primeira linha de cada thread e um botao que abre o detalhe dela (T1.2).
 */
export function desenharPainel(el: { Box: any; Text: any; Button: any }, q: TorreQuadro,
  opcoes: { agora: number; abrir?: (thread: string) => void }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      <Text key="placar" bold wrap="truncate">{placar(q, opcoes.agora)}</Text>
      {q.linhas.map(l => (
        <Box key={`linha:${l.thread}`} flexDirection="column">
          <Button key={`abrir:${l.thread}`} plain onPress={() => opcoes.abrir?.(l.thread)}>{cabecalhoDaLinha(l)}</Button>
          {detalhesDaLinha(l).map((d, i) => (
            <Text key={`detalhe:${l.thread}:${i}`} dimColor wrap="truncate">{`  ${d}`}</Text>
          ))}
        </Box>
      ))}
      {q.omitidas > 0 && <Text key="omitidas" dimColor>{`+${q.omitidas} threads abertas além do teto de ${TETO_DE_THREADS}`}</Text>}
    </Box>
  )
}
