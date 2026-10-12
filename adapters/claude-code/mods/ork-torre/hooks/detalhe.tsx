// O detalhe de uma thread na Torre de Controle (RM-059, fatia F1, T1.2; D4 da thread). Apertar a linha abre o
// detalhe: sessoes, bloqueio, pedidos, entrega e MASTER, os ultimos eventos e as claims com estado. Cada acao
// que o retrato declara disponivel vira um botao de leitura, que mostra o resultado aqui, ou, se tem efeito,
// o atalho para o mod dono dela (que aplica as proprias regras) ou o comando do `ork` em texto, para o dono
// rodar. Nenhuma acao com efeito roda pela Torre. Modulo puro: o `$` fica no register.tsx.
import type { TorreDetalhe, TorreLeitura, TorreLinha } from '../types'
import type { ItemDoPainel } from './painel'
import { acoesRelevantes, cabecalhoDaLinha, emPortugues, idade, LEITURAS, ROTULO_DA_ACAO } from './painel'

export type Dono = { plugin: string; comando: string; nome: string }
export type ClasseDaAcao =
  | { tipo: 'leitura' }
  | { tipo: 'efeito'; dono: Dono | null; comando: ((thread: string) => string) | null; nota: string | null }

/**
 * D4: a classe de cada operacao do retrato (o enum `operation` do nucleo), o mod dono da acao com efeito
 * (o nome do comando sai das fichas do plano dos mods) e o comando do `ork` que o dono roda sem ele.
 */
export const CLASSE_DA_ACAO: Readonly<Record<string, ClasseDaAcao>> = {
  'thread.status': { tipo: 'leitura' },
  'thread.observe': { tipo: 'leitura' },
  'git.status': { tipo: 'leitura' },
  'hitl.decide': { tipo: 'efeito', dono: { plugin: 'ork-mesa', comando: 'mesa', nome: 'a Mesa do Dono' },
    comando: () => 'ork sessions hitl', nota: 'a resposta vai pelo Telegram ou pelo diálogo nativo' },
  'ship': { tipo: 'efeito', dono: { plugin: 'ork-pista', comando: 'pista', nome: 'a Pista de Entrega' },
    comando: t => `ork ship ${t} --para main`, nota: 'troque main pela branch base do projeto, se for outra' },
  'phase': { tipo: 'efeito', dono: { plugin: 'ork-sentinela', comando: 'sentinela', nome: 'a Sentinela do Condutor' },
    comando: t => `ork conducao status ${t}`, nota: 'a fase seguinte sai pelo condutor' },
  'retry': { tipo: 'efeito', dono: { plugin: 'ork-sentinela', comando: 'sentinela', nome: 'a Sentinela do Condutor' },
    comando: t => `ork retry plan ${t}`, nota: null },
  'master': { tipo: 'efeito', dono: { plugin: 'ork-ritual', comando: 'nota', nome: 'o Ritual do MASTER' },
    comando: t => `ork master pedir ${t}`, nota: null },
  'verify': { tipo: 'efeito', dono: null, comando: t => `ork verify ${t}`, nota: null },
  'git.commit': { tipo: 'efeito', dono: null, comando: null, nota: 'o commit é da sessão de GO, pelo ork_git_commit' },
  'creation': { tipo: 'efeito', dono: null, comando: null, nota: 'não é ação de uma thread' },
}

/** Os comandos dos mods donos, um por mod: o que a Torre procura na lista de comandos da sessao. */
export const COMANDOS_DOS_DONOS: readonly Dono[] = Object.values(CLASSE_DA_ACAO)
  .flatMap(c => (c.tipo === 'efeito' && c.dono ? [c.dono] : []))
  .filter((d, i, todos) => todos.findIndex(x => x.comando === d.comando) === i)

/** Dos comandos da sessao (`$.command.list()`), os dos mods donos, com o plugin que registrou cada um. */
export function donosCarregados(comandos: ReadonlyArray<{ name?: unknown; plugin?: unknown }>): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const d of COMANDOS_DOS_DONOS) {
    const achado = comandos.find(c => c.name === d.comando && typeof c.plugin === 'string')
    if (achado) saida[d.comando] = achado.plugin as string
  }
  return saida
}

export type AcaoNoDetalhe =
  | { operacao: string; rotulo: string; tipo: 'leitura' }
  | { operacao: string; rotulo: string; tipo: 'mod'; dono: Dono }
  | { operacao: string; rotulo: string; tipo: 'texto'; texto: string }

/**
 * Como cada acao que a Torre oferece aparece no detalhe (D4 e D15): leitura vira botao; efeito pedido pelo
 * estado abre o mod dono so quando o comando dele esta carregado pelo plugin esperado; senao, o comando do
 * `ork` (ou a nota) aparece em texto.
 */
export function acoesDoDetalhe(linha: TorreLinha, donos: Readonly<Record<string, string>>): AcaoNoDetalhe[] {
  const saida: AcaoNoDetalhe[] = []
  for (const { operacao } of acoesRelevantes(linha)) {
    const classe = Object.prototype.hasOwnProperty.call(CLASSE_DA_ACAO, operacao) ? CLASSE_DA_ACAO[operacao] : undefined
    if (!classe) continue
    const rotulo = ROTULO_DA_ACAO[operacao] ?? operacao
    if (classe.tipo === 'leitura') { saida.push({ operacao, rotulo, tipo: 'leitura' }); continue }
    if (classe.dono && donos[classe.dono.comando] === classe.dono.plugin) { saida.push({ operacao, rotulo, tipo: 'mod', dono: classe.dono }); continue }
    const comando = classe.comando ? classe.comando(linha.thread) : null
    const texto = [comando ? `rode ${comando}` : null, classe.nota].filter((p): p is string => !!p).join('; ')
    saida.push({ operacao, rotulo, tipo: 'texto', texto: `${rotulo}: ${texto}` })
  }
  return saida
}

/** O JSON do primeiro bloco de texto de uma resposta MCP; resposta com erro vira erro. */
export function jsonDoMcp(r: { content?: ReadonlyArray<{ type?: string; text?: string }>; isError?: boolean } | null | undefined): unknown {
  if (!r || r.isError) throw new Error('o núcleo respondeu com erro')
  const texto = (r.content ?? []).find(c => c.type === 'text' && typeof c.text === 'string')?.text
  if (texto === undefined) throw new Error('o núcleo não devolveu texto')
  return JSON.parse(texto)
}

const curto = (v: unknown, n = 8) => (typeof v === 'string' ? v.slice(0, n) : '?')
const cortar = (v: unknown, n: number) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`
}
function haQuanto(ts: unknown, agora: number): string {
  const ms = typeof ts === 'string' ? Date.parse(ts) : NaN
  return Number.isFinite(ms) ? `há ${idade(agora - ms)}` : 'sem hora'
}

/** Os ultimos eventos (`ork_phase_list`), do mais novo ao mais velho. */
export function linhasDosEventos(resultado: unknown, agora: number, teto = 6): string[] {
  const eventos = (resultado as { phases?: { eventos?: unknown } } | null)?.phases?.eventos
  if (!Array.isArray(eventos)) throw new Error('a lista de eventos veio sem eventos')
  if (eventos.length === 0) return ['nenhum evento de fase registrado']
  return eventos.slice(-teto).reverse().map(e => {
    const x = (e ?? {}) as Record<string, unknown>
    return [String(x.tipo ?? '?'), typeof x.fase === 'string' ? x.fase : null, typeof x.classificacao === 'string' ? x.classificacao : null,
      typeof x.motivo === 'string' ? x.motivo : null, haQuanto(x.ts, agora)].filter(p => p !== null).join(' · ')
  })
}

/** As claims com estado (`ork_claims_list`): a conta por estado e as que ainda nao foram verificadas. */
export function linhasDasClaims(resultado: unknown, teto = 5): string[] {
  if (!Array.isArray(resultado)) throw new Error('a lista de claims veio em outro formato')
  if (resultado.length === 0) return ['nenhuma claim registrada']
  const conta = new Map<string, number>()
  for (const c of resultado) conta.set(String(c?.estado ?? '?'), (conta.get(String(c?.estado ?? '?')) ?? 0) + 1)
  const resumo = [...conta.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([e, n]) => `${n} ${e}`).join(', ')
  const abertas = resultado.filter(c => c?.estado !== 'verificado' && c?.estado !== 'retirada').slice(-teto)
  return [`${resultado.length} claims: ${resumo}`, ...abertas.map(c => `${String(c?.id ?? '?')} ${String(c?.estado ?? '?')}: ${cortar(c?.alegacao, 90)}`)]
}

/** O estado da thread (`ork thread status --json`, pela ponte). */
export function linhasDoEstado(resultado: unknown, agora: number): string[] {
  const t = (resultado ?? {}) as Record<string, unknown>
  if (typeof t.id !== 'string') throw new Error('o estado da thread veio sem id')
  const sessoes = Array.isArray(t.sessoes) ? t.sessoes.length : 0
  const claims = Array.isArray(t.claims) ? t.claims.length : 0
  const saida = [`status ${String(t.status ?? '?')} · fase ${String(t.faseAtual ?? '?')} · ${sessoes} sessões · ${claims} claims · atualizada ${haQuanto(t.atualizadaEm, agora)}`]
  const b = t.baseline as { commit?: unknown; comandos?: Array<{ nome?: unknown; ok?: unknown }> } | null | undefined
  if (b && Array.isArray(b.comandos)) {
    saida.push(`baseline em ${curto(b.commit)}: ${b.comandos.map(c => `${String(c.nome ?? '?')} ${c.ok === true ? 'passava' : 'falhava'}`).join(', ')}`)
  } else saida.push('sem baseline gravada')
  return saida
}

/** A observacao da thread (`ork_observe`): os pedidos pendentes e cada sessao nativa. */
export function linhasDaObservacao(resultado: unknown): string[] {
  const o = (resultado ?? {}) as { pendencias?: unknown; nativas?: unknown }
  if (!Array.isArray(o.nativas)) throw new Error('a observação veio sem as sessões nativas')
  const pendencias = Array.isArray(o.pendencias) ? o.pendencias.length : 0
  const saida = [pendencias === 0 ? 'nenhum pedido pendente' : pendencias === 1 ? '1 pedido pendente' : `${pendencias} pedidos pendentes`]
  for (const n of o.nativas as Array<Record<string, unknown>>) {
    const sessao = (n.sessao ?? {}) as Record<string, unknown>
    const estado = n.disponivel === true ? String(sessao.estado ?? sessao.state ?? sessao.status ?? 'confirmada') : 'não confirmada'
    const turno = (n.turno ?? {}) as Record<string, unknown>
    saida.push(`sessão ${curto(n.sessionId)} ${String(n.runtime ?? '?')}: ${estado}${typeof turno.conclusaoDeFase === 'string' ? ` · ${turno.conclusaoDeFase}` : ''}`)
  }
  return saida
}

/** O estado do git da thread (`ork_git_status`): a branch da thread e a de destino, com os HEADs. */
export function linhasDoGit(resultado: unknown): string[] {
  const g = (resultado ?? {}) as { source?: { branch?: unknown; head?: unknown }; destination?: { branch?: unknown; head?: unknown } }
  if (!g.source || !g.destination) throw new Error('o estado do git veio sem origem e destino')
  return [`${String(g.source.branch ?? '?')} @ ${curto(g.source.head)}`,
    `destino ${String(g.destination.branch ?? '?')} @ ${curto(g.destination.head)}${g.source.head === g.destination.head ? ' (iguais)' : ''}`]
}

export function leituraFeita(linhas: string[], agora: number): TorreLeitura {
  return { lidoEm: agora, linhas, erro: null }
}
export function leituraFalha(erro: string, agora: number): TorreLeitura {
  return { lidoEm: agora, linhas: [], erro }
}

/** As linhas de uma secao lida: lendo, o erro, ou o que veio. */
function linhasDaLeitura(l: TorreLeitura | null | undefined, agora: number): string[] {
  if (!l) return ['  lendo…']
  if (l.erro) return [`  não leu: ${l.erro}`]
  return [...l.linhas.map(x => `  ${x}`), `  (lido há ${idade(agora - l.lidoEm)})`]
}

/**
 * O texto do detalhe, linha a linha, na ordem em que aparece, com o que cada linha mostra ao dono (D10).
 * Thread sem leitura so diz que nao leu e por que: nada de quem conduz nem de acao (D6).
 */
export function linhasDoDetalhe(linha: TorreLinha, detalhe: TorreDetalhe | undefined, agora: number): ItemDoPainel[] {
  const saida: ItemDoPainel[] = [{ texto: cabecalhoDaLinha(linha) }]
  if (linha.estado === 'sem-leitura') {
    saida.push({ texto: `não li o retrato: ${linha.lacunas.join('; ')}` })
  } else {
    saida.push({ texto: linha.conducao ?? 'ninguém conduz agora' })
    if (linha.bloqueio) {
      saida.push({ texto: `bloqueio: ${linha.bloqueio.frase} (${linha.bloqueio.motivo})`,
        mostrado: { chave: `bloqueio:${linha.thread}:${linha.bloqueio.motivo}`, thread: linha.thread, texto: `${linha.thread}: ${linha.bloqueio.frase}` } })
    }
    for (const p of linha.pedidos) {
      saida.push({ texto: `pedido ${p.id}: ${p.texto}`,
        mostrado: { chave: `hitl:${p.id}`, thread: linha.thread, texto: `${linha.thread}: espera você: ${p.texto || p.id}` } })
      const sub = [p.prazo ? `prazo ${p.prazo}` : null, p.recomendacao ? `recomendação: ${p.recomendacao}` : null].filter(Boolean)
      if (sub.length) saida.push({ texto: `  ${sub.join(' · ')}` })
    }
    for (const s of linha.sessoes) {
      saida.push({ texto: `sessão ${curto(s.id)} ${s.rotulo}: ${emPortugues(s.estado)}${s.conduz ? ' · conduz' : ''}${s.confirmada ? '' : ' · não confirmada'}` })
    }
    if (linha.entrega) saida.push({ texto: `entrega: ${emPortugues(linha.entrega)}` })
    if (linha.master) saida.push({ texto: `MASTER: ${emPortugues(linha.master)}` })
    if (linha.lacunas.length) saida.push({ texto: `lacuna: ${linha.lacunas.join('; ')}` })
  }
  for (const t of ['últimos eventos', ...linhasDaLeitura(detalhe?.eventos, agora), 'claims', ...linhasDaLeitura(detalhe?.claims, agora)]) saida.push({ texto: t })
  for (const op of LEITURAS) {
    const l = detalhe?.leituras?.[op]
    if (l) for (const t of [ROTULO_DA_ACAO[op] ?? op, ...linhasDaLeitura(l, agora)]) saida.push({ texto: t })
  }
  return saida
}

export type Gestos = {
  voltar?: () => void
  atualizar?: () => void
  ler?: (operacao: string) => void
  abrirMod?: (dono: Dono) => void
}

/** A arvore do detalhe: os botoes de voltar e atualizar, o texto, e uma linha por acao oferecida. */
export function desenharDetalhe(el: { Box: any; Text: any; Button: any }, linha: TorreLinha, detalhe: TorreDetalhe | undefined,
  donos: Readonly<Record<string, string>>, opcoes: { agora: number } & Gestos) {
  const { Box, Text, Button } = el
  const acoes = acoesDoDetalhe(linha, donos)
  const lida = linha.estado !== 'sem-leitura'
  return (
    <Box flexDirection="column">
      <Box key="gestos" flexDirection="row">
        <Button key="voltar" label="Voltar" onPress={() => opcoes.voltar?.()} />
        <Button key="atualizar" label="Atualizar" onPress={() => opcoes.atualizar?.()} />
      </Box>
      {linhasDoDetalhe(linha, detalhe, opcoes.agora).map((t, i) => (
        <Text key={`detalhe:${i}`} dimColor={i > 0} wrap="truncate">{t.texto}</Text>
      ))}
      {acoes.length > 0 && <Text key="acoes-titulo" bold>ações</Text>}
      {acoes.map(a => (a.tipo === 'leitura'
        ? <Button key={`acao:${a.operacao}`} label={a.rotulo} onPress={() => opcoes.ler?.(a.operacao)} />
        : a.tipo === 'mod'
          ? <Button key={`acao:${a.operacao}`} label={`${a.rotulo}: abrir ${a.dono.nome}`} onPress={() => opcoes.abrirMod?.(a.dono)} />
          : <Text key={`acao:${a.operacao}`} wrap="truncate">{a.texto}</Text>))}
      {lida && acoes.length === 0 && <Text key="sem-acoes" dimColor>nenhuma ação pedida pelo estado desta thread</Text>}
    </Box>
  )
}
