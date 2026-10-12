// O teammate ocioso e os leases (RM-059, fatia F10, T10.3). Módulo puro: a colisão de leases e de `touch_paths` pela
// regra do núcleo (`leasesColidem` e `globsColidem` de `core/src/leases.ts`, reimplementados aqui porque mod não
// importa código do núcleo, e cruzados no teste do núcleo), os leases ativos de todas as threads página a página do
// retrato do `ork maestro --json`, a escolha da próxima tarefa para o teammate, os tetos do piloto de agent teams e os
// textos. O Portão não toma nem solta lease (D8 revista): o `ork_git_commit` toma o `path:` de cada arquivo na hora do
// commit e recusa com qualquer lease no caminho, até da própria thread. As chamadas ao `$` ficam no register.ts.
import type { PortaoQuadro, PortaoTarefa } from '../types'

/** Os tetos do piloto (D10 do plano da thread), como o núcleo os passa no `env` do `--settings`. */
export const ENV_TEAMMATES = 'ORK_AGENT_TEAMS_TEAMMATES'
export const ENV_CUSTO = 'ORK_AGENT_TEAMS_CUSTO_USD'
export const TETO_MAXIMO_DE_TEAMMATES = 8
export const TETO_MAXIMO_DE_CUSTO_USD = 500
/** Quantas páginas da seção `leases` o Portão lê numa vez (o retrato traz até 50 itens por página). */
export const TETO_DE_PAGINAS_DE_LEASES = 5
/** Os estados de agente que contam como teammate vivo para o teto. */
export const VIVOS: readonly string[] = ['pending', 'running', 'waiting', 'idle']

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const NOME_DE_TEAMMATE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,79}$/
const FAMILIAS = ['worktree-write', 'path', 'board', 'service', 'exec']

/** A família de um lease, como `tipoDoLease` do núcleo: prefixo conhecido, `main-tree`, ou `path` por padrão. */
export function familiaDoLease(nome: string): string {
  if (nome === 'main-tree') return 'main-tree'
  const prefixo = nome.split(':')[0] as string
  return FAMILIAS.includes(prefixo) ? prefixo : 'path'
}

/** O alvo de um lease (o que vem depois dos dois pontos), como `alvoDoLease` do núcleo. */
export function alvoDoLease(nome: string): string {
  const corte = nome.indexOf(':')
  return corte < 0 ? '' : nome.slice(corte + 1)
}

/** O glob de caminho (`*`, `**`, `?`) como a regex equivalente, como `globParaRegex` do núcleo. */
export function globParaRegex(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

function prefixoLiteral(glob: string): string {
  const corte = glob.search(/[*?]/)
  return corte < 0 ? glob : glob.slice(0, corte)
}

function prefixoDeCaminho(a: string, b: string): boolean {
  if (a === '') return false
  if (!b.startsWith(a)) return false
  return a.length === b.length || a.endsWith('/') || b[a.length] === '/'
}

/** Dois globs disputam a mesma região? Conservador como o do núcleo: na dúvida, colide. */
export function globsColidem(a: string, b: string): boolean {
  if (a === b) return true
  if (globParaRegex(a).test(b) || globParaRegex(b).test(a)) return true
  const pa = prefixoLiteral(a)
  const pb = prefixoLiteral(b)
  return prefixoDeCaminho(pa, pb) || prefixoDeCaminho(pb, pa)
}

/** Dois nomes de lease colidem? Famílias diferentes nunca; `path` pela colisão de glob; o resto pela igualdade. */
export function leasesColidem(a: string, b: string): boolean {
  if (a === b) return true
  const fa = familiaDoLease(a)
  if (fa !== familiaDoLease(b)) return false
  return fa === 'path' ? globsColidem(alvoDoLease(a), alvoDoLease(b)) : false
}

/** O lease `path:` de um `touch_path` da tarefa. */
export function nomeDoLease(touchPath: string): string {
  return `path:${touchPath}`
}

/** Um lease ativo do retrato: o nome e a thread que o segura. */
export type LeaseAtivo = { nome: string; thread: string }

/** Os leases ativos de uma página da seção `leases` do retrato `ork.maestro-snapshot/v1`, de qualquer família. */
export function leasesDoRetrato(retrato: unknown): LeaseAtivo[] {
  const itens = (retrato as { sections?: { leases?: { items?: unknown } } } | null)?.sections?.leases?.items
  if (!Array.isArray(itens)) throw new Error('ork-portao: o retrato veio sem a seção leases')
  const ativos: LeaseAtivo[] = []
  for (const bruto of itens) {
    const item = bruto as { id?: unknown; status?: unknown; refs?: unknown } | null
    if (!item || typeof item.id !== 'string' || item.status !== 'active' || !Array.isArray(item.refs)) continue
    const ref = (item.refs as Array<{ kind?: unknown; id?: unknown } | null>).find(r => r?.kind === 'thread')
    if (ref && typeof ref.id === 'string') ativos.push({ nome: item.id, thread: ref.id })
  }
  return ativos
}

/** Uma página da seção `leases`: os ativos, o offset da página seguinte (`coverage.nextOffset`) e o que faltou. */
export type PaginaDeLeases = { leases: LeaseAtivo[]; proximo: number | null; lacuna: string | null }

/** A página da seção `leases` de um retrato; seção indisponível lança (sem ela, nenhuma região está livre). */
export function paginaDosLeases(retrato: unknown): PaginaDeLeases {
  type Secao = { state?: unknown; gaps?: unknown; coverage?: { nextOffset?: unknown } }
  const secao = (retrato as { sections?: { leases?: Secao } } | null)?.sections?.leases
  if (!secao || typeof secao !== 'object') throw new Error('ork-portao: o retrato veio sem a seção leases')
  const faltas = Array.isArray(secao.gaps) ? secao.gaps.filter((g): g is string => typeof g === 'string') : []
  if (secao.state === 'unavailable') throw new Error(`ork-portao: a seção leases veio indisponível${faltas.length ? ` (${faltas.join(', ')})` : ''}`)
  const seguinte = secao.coverage?.nextOffset
  const proximo = typeof seguinte === 'number' && Number.isInteger(seguinte) && seguinte > 0 ? seguinte : null
  return { leases: leasesDoRetrato(retrato), proximo, lacuna: faltas.length > 0 ? `a seção leases veio com lacunas (${faltas.join(', ')})` : null }
}

/** Os tetos do piloto lidos do ambiente: teammates inteiro de 1 a 8 e custo de 0 a 500 dólares; `null` sem os dois. */
export function tetosDoAmbiente(teammates: unknown, custo: unknown): { teammates: number; custoUsd: number } | null {
  if (typeof teammates !== 'string' || typeof custo !== 'string') return null
  const t = /^\d+$/.test(teammates.trim()) ? Number(teammates.trim()) : NaN
  const c = /^\d+(?:\.\d+)?$/.test(custo.trim()) ? Number(custo.trim()) : NaN
  if (!Number.isInteger(t) || t < 1 || t > TETO_MAXIMO_DE_TEAMMATES) return null
  if (!Number.isFinite(c) || c <= 0 || c > TETO_MAXIMO_DE_CUSTO_USD) return null
  return { teammates: t, custoUsd: c }
}

const dolares = (v: number) => `US$ ${v.toFixed(2)}`

/** Por que o `agent.spawn` de um teammate é recusado (D10); `null` quando ele passa. */
export function recusaDoTeammate(tetos: { teammates: number; custoUsd: number } | null, vivos: number, custo: number | null): string | null {
  if (!tetos) {
    return 'Portão de Tarefas: teammate recusado. Na sessão de fase, agent teams só rodam no piloto do núcleo, com os tetos de ' +
      `runtime.agent_teams no manifesto, e esta sessão não recebeu ${ENV_TEAMMATES} e ${ENV_CUSTO}.`
  }
  if (vivos >= tetos.teammates) return `Portão de Tarefas: teammate recusado. A sessão já tem ${vivos} teammate(s) vivo(s), e o teto do piloto é ${tetos.teammates}.`
  if (custo === null) return 'Portão de Tarefas: teammate recusado. O custo da sessão não pôde ser lido, e sem ele o teto de custo do piloto não vale.'
  if (custo >= tetos.custoUsd) return `Portão de Tarefas: teammate recusado. O custo da sessão (${dolares(custo)}) chegou ao teto do piloto (${dolares(tetos.custoUsd)}).`
  return null
}

/** O nome do teammate como o evento traz, conferido; `null` quando não serve. */
export function nomeDoTeammate(bruto: unknown): string | null {
  return typeof bruto === 'string' && NOME_DE_TEAMMATE.test(bruto) ? bruto : null
}

/**
 * A próxima tarefa para o teammate (D7 e D8 revista): na ordem do plano, a que serve ao quadro, não fechou, não foi
 * devolvida, não está com outro teammate, não cruza os `touch_paths` das tarefas com outros teammates e não cruza lease
 * `path:` ativo de nenhuma thread, a própria incluída, porque o `ork_git_commit` recusa o commit com qualquer lease no
 * caminho. Sem tarefa livre, `null`.
 */
export function escolherTarefa(entrada: {
  tarefas: readonly PortaoTarefa[]
  quadro: PortaoQuadro
  teammate: string
  leases: readonly LeaseAtivo[]
}): PortaoTarefa | null {
  const { tarefas, quadro, teammate, leases } = entrada
  const comOutros = Object.entries(quadro.atribuicoes)
    .filter(([quem, tarefa]) => quem !== teammate && !quadro.concluidas.includes(tarefa))
    .map(([, tarefa]) => tarefa)
  const regiaoDosOutros = tarefas.filter(t => comOutros.includes(t.id)).flatMap(t => t.touchPaths)
  for (const tarefa of tarefas) {
    const livre = tarefa.touchPaths.length > 0 && tarefa.verify !== null && tarefa.problema === null &&
      !quadro.concluidas.includes(tarefa.id) && !quadro.devolvidas.includes(tarefa.id) && !comOutros.includes(tarefa.id) &&
      !tarefa.touchPaths.some(tp => regiaoDosOutros.some(outro => globsColidem(tp, outro))) &&
      !tarefa.touchPaths.some(tp => leases.some(l => leasesColidem(nomeDoLease(tp), l.nome)))
    if (livre) return tarefa
  }
  return null
}

/** O texto do `block` que entrega a tarefa ao teammate ocioso (D7). */
export function textoDaEntrega(t: PortaoTarefa, teammate: string): string {
  return [
    `Portão de Tarefas: ${teammate}, pegue a tarefa ${t.id} do plano${t.titulo ? ` (${t.titulo})` : ''}.`,
    `  touch_paths: ${t.touchPaths.join(', ')}`,
    `  verify: ${t.verify ?? ''}`,
    'Antes de começar, confira o quadro (TaskList): se ela já está em andamento com outro dono, não a pegue e fique ocioso. ' +
      `Se ela não está no quadro, crie-a com o assunto começando por ${t.id}; marque-a em andamento com você como dono. ` +
      'Quando o Portão a escolheu, nenhum lease path: ativo cruzava essa região, e o commit pelo ork_git_commit toma o lease ' +
      'de cada arquivo na hora. Ela só fecha com o verify aprovado pela conferência do núcleo.',
  ].join('\n')
}
