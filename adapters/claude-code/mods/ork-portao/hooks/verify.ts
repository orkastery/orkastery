// A conclusão pela conferência do núcleo (RM-059, fatia F10, T10.2). Módulo puro: monta o argv do
// `ork claims conferir --tarefa`, lê o JSON `ork.claims-conferencia/v1`, conta a repetição e escreve o texto do
// bloqueio. O Portão nunca roda o verify da tarefa: quem roda é o núcleo, no sandbox do verify (D12 do plano dos
// mods), e quem verifica de verdade continua sendo o `ork verify`.
import type { PortaoRepeticao } from '../types'

export const FORMATO_DA_CONFERENCIA = 'ork.claims-conferencia/v1'
/** O prazo total pedido ao núcleo, em segundos (D5 corrigida: cabe no teto de dez minutos do `$.process.run`). */
export const PRAZO_DA_CONFERENCIA_S = 540
/** O vigia do mod: o `$.process.run` mata o processo depois disto, e a conferência fica indisponível. */
export const VIGIA_DA_CONFERENCIA_MS = 600000
/** Da terceira conclusão seguida bloqueada pelo mesmo resultado em diante, o texto manda deixar a tarefa aberta (D6). */
export const REPETICOES_PARA_DEIXAR = 3
/** Tetos do fim da saída que vai ao modelo. */
export const TETO_DE_LINHAS_DA_SAIDA = 15
export const TETO_DE_CARACTERES_DA_SAIDA = 1500

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const ID_DE_TAREFA = /^T\d+(?:\.\d+)*$/
/** A saída do CLI quando outra condução segura a thread. */
const SAIDA_DE_CONDUCAO = 3

/** O argv do `ork claims conferir` do verify de uma tarefa; o comando da tarefa fica com o núcleo. */
export function argvDaConferencia(thread: string, tarefa: string): string[] {
  if (!ID_DE_THREAD.test(thread)) throw new Error('ork-portao: id de thread inválido')
  if (!ID_DE_TAREFA.test(tarefa)) throw new Error('ork-portao: id de tarefa inválido')
  return ['ork', 'claims', 'conferir', thread, '--tarefa', tarefa, '--prazo', String(PRAZO_DA_CONFERENCIA_S), '--json']
}

/**
 * O que a conferência disse da tarefa: aprovada; reprovada (`claims.failed`); sem veredito (prazo, comando que não
 * rodou); recusada pelo núcleo (`claims.conferir.*`); com outra condução na thread; ou indisponível.
 */
export type Leitura =
  | { tipo: 'aprovada'; comando: string }
  | { tipo: 'reprovada'; comando: string; codigo: number | null; fim: string }
  | { tipo: 'sem-veredito'; motivo: string; comando: string; detalhe: string }
  | { tipo: 'recusada'; motivo: string }
  | { tipo: 'ocupada'; motivo: string }
  | { tipo: 'indisponivel'; motivo: string }

const ultimaLinha = (texto: string) => texto.trim().split('\n').filter(l => l.trim() !== '').slice(-1)[0]?.trim().slice(0, 300) ?? ''

type Execucao = { comando?: unknown; ok?: unknown; code?: unknown; fim?: unknown }

/**
 * A saída do `ork claims conferir --tarefa --json` (D4): o resultado só com o formato certo, o item da tarefa pedida
 * e a saída 0 ou 1; a recusa tipada é a saída 2 com `claims.conferir.*`; a saída 3 é outra condução; o resto (texto
 * solto de um `ork` antigo, JSON sem o item) é indisponível.
 */
export function lerConferencia(tarefa: string, stdout: string, codigo: number | null, stderr: string): Leitura {
  let j: { formato?: unknown; itens?: unknown; erro?: unknown; texto?: unknown } | null = null
  try { j = JSON.parse(stdout) } catch { j = null }
  if (j && j.formato === FORMATO_DA_CONFERENCIA && Array.isArray(j.itens) && (codigo === 0 || codigo === 1)) {
    const item = (j.itens as Array<{ id?: unknown; verificado?: unknown; motivo?: unknown; detalhe?: unknown; execucoes?: unknown } | null>)
      .find(i => i?.id === tarefa)
    if (!item) return { tipo: 'indisponivel', motivo: `a conferência não devolveu a tarefa ${tarefa}` }
    const execucoes = Array.isArray(item.execucoes) ? item.execucoes as Execucao[] : []
    const chave = execucoes.find(x => x && x.ok === false) ?? execucoes[0]
    const comando = typeof chave?.comando === 'string' ? chave.comando : ''
    if (item.verificado === true && codigo === 0) return { tipo: 'aprovada', comando }
    if (item.motivo === 'claims.failed') {
      return { tipo: 'reprovada', comando, codigo: typeof chave?.code === 'number' ? chave.code : null, fim: typeof chave?.fim === 'string' ? chave.fim : '' }
    }
    return {
      tipo: 'sem-veredito', comando,
      motivo: typeof item.motivo === 'string' ? item.motivo : 'sem motivo',
      detalhe: typeof item.detalhe === 'string' ? item.detalhe.slice(0, 300) : '',
    }
  }
  const erro = j && typeof j.erro === 'string' ? j.erro.trim().slice(0, 300) : ''
  if (codigo === SAIDA_DE_CONDUCAO) {
    // Com `--json`, a recusa de condução sai no stdout (`ork.conducao-recusa/v1`), com o texto para quem lê.
    const texto = j && typeof j.texto === 'string' ? (j.texto.trim().split('\n')[0] ?? '').slice(0, 300) : ''
    return { tipo: 'ocupada', motivo: texto || erro || ultimaLinha(stderr) || 'outra condução segura a thread' }
  }
  if (erro.startsWith('claims.conferir.')) return { tipo: 'recusada', motivo: erro }
  const motivo = erro || ultimaLinha(stderr) || (j === null ? ultimaLinha(stdout) : '') || `saiu com código ${codigo ?? 'desconhecido'}`
  return { tipo: 'indisponivel', motivo: `ork claims conferir sem resultado: ${motivo}` }
}

/** O fim da saída de um comando: as últimas linhas e o último trecho, dentro dos tetos. */
export function fimDaSaida(fim: string): string[] {
  let texto = fim.replace(/\s+$/, '')
  if (texto.length > TETO_DE_CARACTERES_DA_SAIDA) texto = texto.slice(-TETO_DE_CARACTERES_DA_SAIDA)
  return texto === '' ? [] : texto.split('\n').slice(-TETO_DE_LINHAS_DA_SAIDA)
}

/** O que torna dois bloqueios "o mesmo resultado" para a contagem da D6. */
export function assinatura(l: Leitura): string {
  switch (l.tipo) {
    case 'aprovada': return 'aprovada'
    case 'reprovada': return JSON.stringify(['reprovada', l.comando, l.codigo, fimDaSaida(l.fim).slice(-3)])
    case 'sem-veredito': return JSON.stringify(['sem-veredito', l.motivo, l.comando])
    default: return JSON.stringify([l.tipo, l.motivo])
  }
}

/** A repetição da tarefa depois deste bloqueio: a mesma assinatura soma, outra recomeça em 1. */
export function contarRepeticao(anterior: PortaoRepeticao | undefined, nova: string): PortaoRepeticao {
  return anterior && anterior.assinatura === nova ? { assinatura: nova, vezes: anterior.vezes + 1 } : { assinatura: nova, vezes: 1 }
}

const SAIDA = 'Se não der para corrigir agora, devolva a tarefa para pending (TaskUpdate) e siga: o ork verify continua sendo quem verifica.'

/** O texto do `block` da conclusão recusada (D4 e D6), com a saída sempre dita. */
export function textoDoBloqueio(tarefa: string, l: Exclude<Leitura, { tipo: 'aprovada' }>, vezes = 1): string {
  const partes: string[] = []
  switch (l.tipo) {
    case 'reprovada':
      partes.push(`Portão de Tarefas: a tarefa ${tarefa} não fecha: o verify do plano reprovou na conferência do núcleo (ork claims conferir, no sandbox do verify, sem recibo).`)
      if (l.comando) partes.push(`  comando: ${l.comando}`)
      partes.push(`  saiu com código ${l.codigo ?? 'desconhecido'}${l.fim.trim() ? '; fim da saída:' : ', sem saída'}`)
      for (const linha of fimDaSaida(l.fim)) partes.push(`  | ${linha}`)
      partes.push('Corrija e conclua de novo. Teste que cria processo pode reprovar no sandbox e passar no ork verify.')
      break
    case 'sem-veredito':
      partes.push(`Portão de Tarefas: a tarefa ${tarefa} não fecha: a conferência do núcleo terminou sem veredito (${l.motivo}${l.detalhe ? `: ${l.detalhe}` : ''}).`)
      if (l.comando) partes.push(`  comando: ${l.comando}`)
      partes.push('Conclua de novo para conferir outra vez.')
      break
    case 'recusada':
      partes.push(`Portão de Tarefas: a tarefa ${tarefa} não fecha: o núcleo recusou a conferência (${l.motivo}).`)
      break
    case 'ocupada':
      partes.push(`Portão de Tarefas: a tarefa ${tarefa} não fecha agora: outra condução segura a thread (${l.motivo}). Conclua de novo em instantes.`)
      break
    case 'indisponivel':
      partes.push(`Portão de Tarefas: a tarefa ${tarefa} não fecha: a conferência do núcleo não deu resultado (${l.motivo}).`)
      break
  }
  partes.push(SAIDA)
  if (vezes >= REPETICOES_PARA_DEIXAR) {
    partes.push(`É a ${vezes}ª vez seguida com o mesmo resultado: deixe a tarefa aberta (pending) e siga para a próxima; o ork verify do CHECK decide.`)
  }
  return partes.join('\n')
}

/** O texto do `block` quando outra conferência do Portão está em curso (D5). */
export function textoDeOutraConferencia(tarefa: string, emCurso: string): string {
  return `Portão de Tarefas: a tarefa ${tarefa} não fecha agora: o Portão está conferindo a tarefa ${emCurso} no núcleo, uma conferência por vez. ` +
    `Conclua de novo quando ela terminar. ${SAIDA}`
}

/** A linha de status depois de uma conferência; `undefined` limpa a linha. */
export function textoDoStatus(tarefa: string, l: Leitura): string | undefined {
  if (l.tipo === 'aprovada') return undefined
  const nome: Record<Exclude<Leitura['tipo'], 'aprovada'>, string> = {
    reprovada: 'reprovou', 'sem-veredito': 'sem veredito', recusada: 'recusada pelo núcleo', ocupada: 'outra condução', indisponivel: 'conferência indisponível',
  }
  return `portão: ${tarefa} não fechou (${nome[l.tipo]})`
}
