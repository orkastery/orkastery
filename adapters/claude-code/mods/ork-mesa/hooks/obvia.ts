// O teste das quatro condicoes da decisao obvia (M4 do dono, RM-059; D5 da thread ork-rm059mesa), em funcao pura.
// E o mesmo teste do nucleo (`classificarDecisao` em core/src/hitl-contract.ts, I-41): as portas fechadas primeiro
// (irreversivel, dinheiro, escopo ou produto), depois as quatro condicoes na ordem do GOAL. A Mesa so calcula os sinais
// a partir do pedido que o nucleo serve; o teste do nucleo confere que a classe sai igual a do `classificarDecisao`.
// Decidir, para a Mesa, e registrar a decisao autonoma do nucleo (`ork_decision_record`): nunca responder o pedido. Um
// pedido aberto so se resolve pela resposta humana, pela substituicao, pelo prazo com `seguir-recomendada` ou pelo
// fechamento da thread; por isso o criterio escrito que a Mesa le pelo nucleo e o proprio pedido declarar que segue a
// recomendada no prazo. Falhou uma condicao, e pergunta. So importa tipos.
import type { MesaAlternativa, MesaPergunta } from '../types'

/** As portas fechadas e as quatro condicoes, na ordem do `classificarDecisao` do nucleo. */
export type Condicao = 'irreversivel' | 'dinheiro' | 'escopo' | 'criterio' | 'alternativas' | 'reversivel' | 'barato'
export const CONDICOES: readonly Condicao[] = ['irreversivel', 'dinheiro', 'escopo', 'criterio', 'alternativas', 'reversivel', 'barato']

/** Como o cartao diz o que impediu a decisao obvia. */
export const FALHA_DA_CONDICAO: Readonly<Record<Condicao, string>> = {
  irreversivel: 'o ato é irreversível',
  dinheiro: 'o ato gasta dinheiro',
  escopo: 'é decisão de escopo ou produto (GOAL, PLAN ou política)',
  criterio: 'não há critério escrito que a Mesa leia pelo núcleo',
  alternativas: 'as alternativas não são estritamente piores pelo critério',
  reversivel: 'não dá para desfazer antes da entrega',
  barato: 'errar não sai barato, ou só o dono resolve',
}

/** As fases antes da entrega: depois do CHECK, o que se decide vai para a `main`. */
export const FASES_ANTES_DA_ENTREGA: readonly string[] = ['GOAL', 'PLAN', 'GO', 'CHECK']
/**
 * GOAL e PLAN decidem objetivo, premissa e plano: o que se pergunta ali muda escopo ou produto, e e sempre do dono
 * (M4). Por isso o nucleo abre esses pedidos em profundidade `profunda` (`profundidadeDoPedido`).
 */
export const FASES_DE_ESCOPO: readonly string[] = ['GOAL', 'PLAN']
/** Credencial so o dono entrega; o erro de decidir por ele nao e barato. */
export const MOTIVOS_SO_DO_DONO: readonly string[] = ['hitl.credencial']

/** Os sinais do teste, na forma do `SinaisDaDecisao` do nucleo. */
export type SinaisDaObvia = {
  criterio?: { tipo: 'medicao'; referencia: string }
  alternativasEstritamentePiores: boolean
  reversivelAntesDaEntrega: boolean
  erroBaratoEDetectavel: boolean
  irreversivel: boolean
  gastaDinheiro: boolean
  mudaEscopoOuProduto: boolean
}

export type ResultadoDaObvia =
  | { obvia: true; alternativa: MesaAlternativa; referencia: string }
  | { obvia: false; falhou: Condicao[] }

/**
 * A referencia do criterio que a Mesa cita: a medicao como comando que o CHECK roda contra o ledger, onde o pedido fica
 * escrito para sempre (sai 0 so se o pedido declara seguir a recomendada no prazo).
 */
export function referenciaDoCriterio(p: MesaPergunta): string {
  return `grep -F '"id":"${p.pedidoId}"' .orkastery/threads/${p.thread}/ledger.jsonl | grep -qF '"acaoPadraoAoExpirar":"seguir-recomendada"'`
}

/** Os sinais a partir do pedido servido pelo nucleo e do instante da leitura, em ms. */
export function sinaisDaPergunta(p: MesaPergunta, agora: number): SinaisDaObvia {
  const recomendadas = p.alternativas.filter(a => a.recomendada).length
  const prazo = Date.parse(p.prazo ?? '')
  return {
    // Criterio escrito: o pedido v2 declara, no ledger, que a fabrica segue a recomendada no prazo.
    ...(p.contrato === 'ork.hitl/v2' && p.acaoAoExpirar === 'seguir-recomendada' ? { criterio: { tipo: 'medicao', referencia: referenciaDoCriterio(p) } } : {}),
    // Estritamente piores pelo criterio: ha escolha, e o criterio aponta uma so.
    alternativasEstritamentePiores: p.alternativas.length >= 2 && recomendadas === 1,
    // Desfaz antes da entrega: a fase ainda nao entrega (o ato sem volta ja fecha a porta antes).
    reversivelAntesDaEntrega: FASES_ANTES_DA_ENTREGA.includes(p.fase ?? ''),
    // Barato e detectavel: o pedido conferido agora no nucleo (sem isso a evidencia seria inventada), gate (responder
    // sessao e falar pelo dono), escolha objetiva, nada que so o dono resolve, o pedido ainda aberto e o prazo por vir,
    // para o dono poder mudar antes.
    erroBaratoEDetectavel: p.conferida && p.alvo === 'gate' && p.tipoDeResposta === 'objetiva' && p.respostaAceita === 'opcao' &&
      !p.dependenciaTecnica && !MOTIVOS_SO_DO_DONO.includes(p.motivo) && p.estado === 'aberto' && Number.isFinite(prazo) && prazo > agora,
    irreversivel: p.irreversivel || p.ato !== null,
    gastaDinheiro: p.ato === 'dinheiro' || p.motivo === 'cost.violation',
    mudaEscopoOuProduto: p.motivo === 'policy.violation' || FASES_DE_ESCOPO.includes(p.fase ?? ''),
  }
}

/**
 * O teste: as portas fechadas e as quatro condicoes, na ordem do nucleo. Devolve a alternativa recomendada e a
 * referencia do criterio quando a decisao e obvia, ou tudo que falhou, na ordem.
 */
export function testeDaObvia(p: MesaPergunta, agora: number): ResultadoDaObvia {
  const s = sinaisDaPergunta(p, agora)
  const falhou: Condicao[] = []
  if (s.irreversivel) falhou.push('irreversivel')
  if (s.gastaDinheiro) falhou.push('dinheiro')
  if (s.mudaEscopoOuProduto) falhou.push('escopo')
  if (!s.criterio) falhou.push('criterio')
  if (!s.alternativasEstritamentePiores) falhou.push('alternativas')
  if (!s.reversivelAntesDaEntrega) falhou.push('reversivel')
  if (!s.erroBaratoEDetectavel) falhou.push('barato')
  const recomendada = p.alternativas.find(a => a.recomendada)
  if (falhou.length || !s.criterio || !recomendada) return { obvia: false, falhou: falhou.length ? falhou : ['alternativas'] }
  return { obvia: true, alternativa: recomendada, referencia: s.criterio.referencia }
}
