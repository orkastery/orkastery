/**
 * RM-048 (itens 1, 4 e 5): o contrato UNICO de apresentacao de um pedido ao dono.
 *
 * Ate aqui o mesmo pedido saia com tres textos diferentes: o dialogo do host (`apresentarDecisao`),
 * o lote do Telegram (`textoDoLote`) e o item do pulse, que levava um comando com o identificador
 * longo. Cada um gastava de tres a quatro linhas por alternativa, e o dono, que conduz dezenas de
 * frentes ao mesmo tempo, tinha de reler a mensagem para achar a pergunta. O pedido do dono foi
 * este: pergunta curta, alternativas de uma linha, sempre uma recomendada, e uma linha que diz
 * como responder.
 *
 * O contrato tem sete partes e um teto, e o teto e garantido por construcao, nao por revisao:
 *
 *   titulo       de onde vem (thread e fase), em uma linha;
 *   pergunta     o que se decide, em uma frase;
 *   trava        o que esta parado, desde quando, e o que acontece sem resposta;
 *   sem volta    so quando responder autoriza um ato da lista congelada;
 *   corpo        no maximo `TETO_DE_LINHAS_DO_CORPO` linhas de evidencia;
 *   alternativas de 2 a 4, uma linha cada, com a consequencia, e UMA recomendada com o porque;
 *   responder    a ultima linha, dizendo exatamente o que digitar.
 *
 * O detalhe profundo (artefato, claims, riscos, diff) fica a um pedido de distancia: a ultima
 * linha diz como pedir, e o nucleo responde com o bloco de evidencia (`<codigo> detalhes`).
 *
 * Telegram e terminal carregam o MESMO conteudo; muda o marcador (icone no Telegram, texto no
 * terminal). OpenClaw transporta o texto do Telegram. Quem monta e o nucleo; o host so transporta.
 */
import { redigirSegredos } from './hitl';
import { AcaoAoExpirar, AtoIrreversivel, ehV2, PedidoHitlQualquer, prazoDoPedido, expiracaoDoPedido, alvoDoPedido,
  textoDoPedido, validarPedidoHitl } from './hitl-contract';
import { formatarDesde, formatarHora } from './horario';
import { EventoLedger } from './types';

export const CONTRATO_PEDIDO_CURTO = 'ork.hitl-curto/v1' as const;

/** Nenhum pedido passa disto por padrao (RM-048, criterio c). */
export const TETO_DE_LINHAS_DO_PEDIDO = 15;

/** Evidencia que cabe na pergunta curta; o resto vai no detalhe. */
export const TETO_DE_LINHAS_DO_CORPO = 2;

/** Teto de uma linha logica: alternativa com consequencia ainda e leitura rapida. */
const TETO_DA_LINHA = 200;

export type CanalDoPedido = 'telegram' | 'terminal';

/** Como o dono responde a ESTE pedido, dito na ultima linha. */
export type ComoResponder =
  /** Codigo curto do pedido: "DE6H a". Vale enquanto o gate esperar a mesma pergunta. */
  | { tipo: 'codigo'; codigo: string }
  /** Numero da pergunta no lote: "1a". O lote diz como responder uma vez, no fim. */
  | { tipo: 'numero'; numero: number }
  /** Dialogo nativo do host (MCP): o dono seleciona a opcao; a letra digitada tambem vale. */
  | { tipo: 'dialogo' }
  /** Pergunta aberta: o texto e enviado literalmente. */
  | { tipo: 'texto' }
  /**
   * RM-055: o impedimento do despacho que so o dono resolve. Ele roda o comando da pausa no terminal e a
   * recomendada vira o comando que devolve a fase ao runtime, sem reescrever o pedido.
   */
  | { tipo: 'terminal'; comando: string };

export interface AlternativaCurta {
  /** O que o dono digita: a letra no v2. */
  chave: string;
  texto: string;
  /** O que acontece ao escolher, em uma linha. */
  consequencia: string;
  recomendada?: { porque: string };
}

/** A entrada normalizada: um pedido v2, ou uma pergunta do lote que ja traduziu um v1. */
export interface EntradaDoPedidoCurto {
  thread: string | null;
  fase: string | null;
  pergunta: string;
  alternativas: AlternativaCurta[];
  alvo?: { tipo: 'gate' } | { tipo: 'session'; sessionId: string };
  corpo?: readonly string[];
  ato?: AtoIrreversivel;
  expiracao?: AcaoAoExpirar;
  prazo?: string | null;
  /** Desde quando o dono e esperado nesta pergunta (o primeiro pedido com o mesmo codigo). */
  desde?: string | null;
}

export interface PedidoCurto {
  contrato: typeof CONTRATO_PEDIDO_CURTO;
  titulo: string;
  pergunta: string;
  trava: string;
  semVolta?: string;
  corpo: string[];
  alternativas: AlternativaCurta[];
  responder: ComoResponder;
}

/** O texto de cada ato congelado, como o dono o le. */
export const TEXTO_DO_ATO: Readonly<Record<AtoIrreversivel, string>> = Object.freeze({
  dinheiro: 'gasta dinheiro',
  'publicacao-externa': 'publica fora do projeto',
  'apagar-dado': 'apaga dado',
  'push-base-protegida': 'faz push na base protegida',
});

const linha = (texto: unknown, teto = TETO_DA_LINHA): string => {
  const limpo = redigirSegredos(String(texto ?? '')).replace(/\s+/g, ' ').trim();
  return limpo.length > teto ? `${limpo.slice(0, teto - 3)}...` : limpo;
};

/** A entrada de um pedido v2 `pergunta`. Um v1 chega pelo lote, que ja o traduziu. */
export function entradaDoPedido(pedido: PedidoHitlQualquer, desde?: string | null): EntradaDoPedidoCurto {
  validarPedidoHitl(pedido);
  if (!ehV2(pedido) || pedido.classe !== 'pergunta') {
    throw new Error('pedido curto: só uma pergunta ork.hitl/v2 tem alternativas declaradas');
  }
  const alvo = alvoDoPedido(pedido);
  return {
    thread: pedido.thread, fase: pedido.fase, pergunta: textoDoPedido(pedido),
    alternativas: pedido.alternativas.map(a => ({ chave: a.letra, texto: a.texto, consequencia: a.consequencia,
      ...(a.recomendada ? { recomendada: { porque: a.porque ?? '' } } : {}) })),
    alvo: alvo?.tipo === 'session' ? { tipo: 'session', sessionId: alvo.sessionId } : { tipo: 'gate' },
    corpo: pedido.corpo, ...(pedido.ato ? { ato: pedido.ato } : {}),
    expiracao: expiracaoDoPedido(pedido), prazo: prazoDoPedido(pedido) ?? null, desde: desde ?? null,
  };
}

/** O que acontece sem resposta, em meia linha. Expirar nunca autoriza. */
function semResposta(e: EntradaDoPedidoCurto, agora: string): string {
  const ate = e.prazo ? ` até ${formatarHora(e.prazo, { agora })}` : '';
  if (e.expiracao === 'seguir-recomendada') return `Sem resposta${ate}, sigo com a recomendada.`;
  if (e.expiracao === 'escalar') return `Sem resposta${ate}, o pedido é escalado.`;
  return e.alvo?.tipo === 'session' ? 'Sem resposta, a sessão continua parada.' : 'Sem resposta, nada avança.';
}

/**
 * Monta o pedido curto. Recusa, em vez de cortar em silencio, o que o contrato nao aceita: menos
 * de duas alternativas, mais de quatro, ou recomendada diferente de exatamente uma.
 */
export function montarPedidoCurto(e: EntradaDoPedidoCurto, opcoes: { quando: string; responder: ComoResponder }): PedidoCurto {
  if (e.alternativas.length < 2 || e.alternativas.length > 4) throw new Error('pedido curto: de 2 a 4 alternativas');
  if (e.alternativas.filter(a => a.recomendada).length !== 1) throw new Error('pedido curto: exatamente uma alternativa é recomendada');
  const onde = e.alvo?.tipo === 'session'
    ? `A sessão ${e.alvo.sessionId.slice(0, 8)} está parada esperando você`
    : `${e.fase ? `A fase ${e.fase}` : 'A thread'} está parada esperando você`;
  const desde = e.desde ? ` desde ${formatarDesde(e.desde, { agora: opcoes.quando })}` : '';
  return {
    contrato: CONTRATO_PEDIDO_CURTO,
    titulo: linha([e.thread, e.fase].filter(Boolean).join(' · ') || 'sem thread'),
    pergunta: linha(e.pergunta),
    trava: linha(`${onde}${desde}. ${semResposta(e, opcoes.quando)}`),
    ...(e.ato ? { semVolta: `Sem volta depois de feito: ${TEXTO_DO_ATO[e.ato]}.` } : {}),
    corpo: (e.corpo ?? []).slice(0, TETO_DE_LINHAS_DO_CORPO).map(l => linha(l)).filter(Boolean),
    alternativas: e.alternativas.map(a => ({ chave: a.chave, texto: linha(a.texto, 140), consequencia: linha(a.consequencia, 140),
      ...(a.recomendada ? { recomendada: { porque: linha(a.recomendada.porque, 140) } } : {}) })),
    responder: opcoes.responder,
  };
}

/** A ultima linha: exatamente o que digitar, sem identificador longo. */
export function linhaDeResposta(p: PedidoCurto, canal: CanalDoPedido): string | null {
  const r = p.responder, recomendada = p.alternativas.find(a => a.recomendada)!.chave;
  if (r.tipo === 'numero') return null;
  if (r.tipo === 'texto') return `${canal === 'telegram' ? '↩️ ' : ''}Responda escrevendo o texto; ele é enviado como está.`;
  if (r.tipo === 'terminal') return `${canal === 'telegram' ? '↩️ ' : 'Responder: '}feito o comando, ${recomendada}) é \`${r.comando}\`.`;
  if (r.tipo === 'dialogo') return `${canal === 'telegram' ? '↩️ ' : ''}Responda selecionando a opção no diálogo; digitar a letra também vale.`;
  return canal === 'telegram'
    ? `↩️ Responda: ${r.codigo} ${recomendada} (ou outra letra). Evidências: ${r.codigo} detalhes.`
    : `Responda pelo Telegram: ${r.codigo} ${recomendada} (ou outra letra); aqui, pelo diálogo do host. Evidências: ${r.codigo} detalhes.`;
}

/**
 * O texto do pedido no canal. Telegram e terminal dizem a mesma coisa com marcadores diferentes;
 * nenhum dos dois passa de `TETO_DE_LINHAS_DO_PEDIDO` linhas.
 */
export function textoDoPedidoCurto(p: PedidoCurto, canal: CanalDoPedido): string {
  if (p.contrato !== CONTRATO_PEDIDO_CURTO) throw new Error('pedido curto: contrato inválido');
  const tg = canal === 'telegram';
  const numero = p.responder.tipo === 'numero' ? `${p.responder.numero}. ` : '';
  const linhas = [
    `${tg && !numero ? '🔔 ' : ''}${numero}${tg || numero ? '' : 'Orkastery · '}${p.titulo}`,
    `${tg ? '❓ ' : 'Pergunta: '}${p.pergunta}`,
    `${tg ? '⏳ ' : 'Situação: '}${p.trava}`,
    ...(p.semVolta ? [`${tg ? '🔒 ' : '! '}${p.semVolta}`] : []),
    ...p.corpo.map(l => `${tg ? '• ' : '- '}${l}`),
    ...p.alternativas.flatMap(a => [
      `${a.chave}) ${a.texto}${a.recomendada ? (tg ? ' ✅ recomendada' : ' [recomendada]') : ''}: ${a.consequencia}`,
      ...(a.recomendada ? [`   porquê: ${a.recomendada.porque}`] : []),
    ]),
  ];
  const resposta = linhaDeResposta(p, canal);
  if (resposta) linhas.push(resposta);
  if (linhas.length > TETO_DE_LINHAS_DO_PEDIDO) throw new Error('pedido curto: acima do teto de linhas');
  return linhas.join('\n');
}

/**
 * Desde quando o dono e esperado nesta pergunta: o primeiro pedido do ledger com o mesmo codigo
 * no mesmo contexto. Com o codigo estavel (D4), renovar o pedido nao zera o relogio que o dono ve.
 */
export function desdeDoPedido(eventos: readonly EventoLedger[], pedido: PedidoHitlQualquer): string | null {
  const codigo = (pedido as { codigo?: unknown }).codigo;
  const doPedido = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as { id?: string } | undefined)?.id === pedido.id);
  if (typeof codigo !== 'string' || !doPedido) return pedido.criadoEm;
  const primeiro = eventos.find(e => e.tipo === 'hitl_requested' && e.contexto === doPedido.contexto &&
    (e.pedido as { codigo?: unknown } | undefined)?.codigo === codigo);
  return (primeiro?.pedido as { criadoEm?: string } | undefined)?.criadoEm ?? pedido.criadoEm;
}
