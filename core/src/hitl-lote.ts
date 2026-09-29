/**
 * I-41 (D4 e D16), CAMADA 2: o lote que so sai depois do sim.
 *
 * O dono desenhou assim: "so depois do SIM. Ai sim chegam as perguntas, topificadas, DE 5 EM 5,
 * cada uma com alternativas a, b, c, d e UMA recomendada com o porque em uma linha, e a
 * consequencia de cada alternativa em uma linha."
 *
 * O que muda em relacao ao lote que o PLAN ja previa (D4) e uma coisa so: ele nao sai sozinho.
 * `loteLiberado` do consentimento e a porta.
 *
 * A REGRA QUE FECHA O BURACO DE E5. Um pedido so entra no lote quando da para dizer, sem
 * adivinhar, qual alternativa e a recomendada. Hoje o produto emite "Confira artefatos, claims e
 * riscos antes de responder.", que nao aponta alternativa nenhuma; pedido assim e RECUSADO com
 * motivo `hitl.formato` e contado a parte, em vez de sair com uma recomendada escolhida no chute
 * pelo agente. Recusa de formato e defeito do EMISSOR, corrigivel por spec dirigida, e nunca
 * escalacao para o dono: escalar formato para o humano seria pedir que ele revise a sintaxe do
 * robo. O item continua na fila e continua contado no resumo; ele so nao vira pergunta.
 *
 * A consequencia de cada alternativa NAO e inventada: ela sai da acao que a alternativa executa,
 * por mapa congelado. Acao e o que de fato acontece; texto livre seria opiniao.
 */
import { AcaoAoExpirar, AtoIrreversivel, alvoDoPedido, ehV2, escolhasDoPedido, expiracaoDoPedido, PedidoHitl,
  PedidoHitlQualquer, prazoDoPedido, recomendacaoDoPedido, textoDoPedido } from './hitl-contract';
import { MotivoGate } from './types';
import { redigirSegredos } from './hitl';
import { montarPedidoCurto, textoDoPedidoCurto } from './hitl-curto';

export const CONTRATO_LOTE = 'ork.hitl-lote/v1' as const;

/** De cinco em cinco, como o dono pediu. As que sobram continuam guardadas, nao somem. */
export const TETO_DE_PERGUNTAS_POR_LOTE = 5;

/** De 2 a 4 alternativas, rotuladas em sequencia. Cinco nao cabem numa escolha rapida. */
export const LETRAS = ['a', 'b', 'c', 'd'] as const;
export type Letra = typeof LETRAS[number];

/**
 * O que acontece ao escolher, por acao. Mapa TOTAL sobre as acoes do pedido: acao nova quebra o
 * build aqui, que e o comportamento desejado. Uma alternativa sem consequencia dita e uma
 * escolha feita no escuro.
 */
export const CONSEQUENCIA_DA_ACAO: Readonly<Record<PedidoHitl['opcoes'][number]['acao'], string>> =
  Object.freeze({
    aprovar: 'a fase segue e o bloco avança',
    recusar: 'a fase volta para revisão',
    responder: 'a resposta é encaminhada à sessão que perguntou',
    esperar: 'nada muda; o item continua na fila',
  });

/** Teto de uma linha. Consequência que vira parágrafo deixa de ser leitura rápida. */
const LIMITE_DE_LINHA = 140;

export interface Alternativa {
  letra: Letra;
  texto: string;
  /** O que acontece se escolher, em uma linha. */
  consequencia: string;
  /** Exatamente uma alternativa do lote tem isto preenchido. */
  recomendada?: { porque: string };
}

export interface PerguntaDoLote {
  /** Posicao no lote. E por ela que o dono responde: `1b`, `2a`. */
  numero: number;
  thread: string | null;
  fase: string | null;
  pergunta: string;
  alternativas: Alternativa[];
  /** O identificador longo do pedido. Fica nos dados, nunca no texto ao dono. */
  pedidoId: string;
  /**
   * RM-048 (D1): o que o contrato curto precisa para dizer o que trava e o que acontece sem
   * resposta. Opcionais porque um lote reenviado do registro antigo nao os tem, e o texto sai
   * completo sem eles.
   */
  alvo?: { tipo: 'gate' } | { tipo: 'session'; sessionId: string };
  corpo?: string[];
  ato?: AtoIrreversivel;
  expiracao?: AcaoAoExpirar;
  prazo?: string | null;
  /** Desde quando o dono e esperado nesta pergunta. */
  desde?: string | null;
}

export interface RecusaDeFormato {
  pedidoId: string;
  thread: string | null;
  /** I-41 (D10): motivo do catalogo, nao string solta. Politica: corrigir-dirigido, automatica. */
  motivo: Extract<MotivoGate, 'hitl.formato'>;
  detalhe: string;
}

export interface LoteDePerguntas {
  contrato: typeof CONTRATO_LOTE;
  perguntas: PerguntaDoLote[];
  /** Quantas perguntas em formato respondível ficaram para o próximo lote. */
  restantes: number;
  /** Pedidos que não viraram pergunta por defeito do emissor, não do dono. */
  recusadas: RecusaDeFormato[];
  /**
   * I-41 (GO-FIX 1, A3): perguntas ABERTAS que ficaram fora deste lote. O lote de letras e de
   * perguntas objetivas; uma aberta nunca sai misturada com elas e nunca e respondida por letra.
   */
  abertas: number;
}

const linha = (texto: string): string =>
  redigirSegredos(String(texto)).replace(/\s+/g, ' ').trim().slice(0, LIMITE_DE_LINHA);

/** As alternativas de um pedido v2, quando ele ja traz as suas prontas. */
function alternativasDeclaradas(pedido: PedidoHitlQualquer): Alternativa[] | undefined {
  const brutas = (pedido as { alternativas?: unknown }).alternativas;
  if (!Array.isArray(brutas) || brutas.length < 2 || brutas.length > LETRAS.length) return undefined;
  const alternativas: Alternativa[] = [];
  let recomendadas = 0;
  for (const [i, bruta] of brutas.entries()) {
    const o = bruta as { texto?: unknown; consequencia?: unknown; recomendada?: unknown; porque?: unknown };
    if (typeof o.texto !== 'string' || typeof o.consequencia !== 'string') return undefined;
    const recomendada = o.recomendada === true;
    if (recomendada) {
      if (typeof o.porque !== 'string' || !o.porque.trim()) return undefined;
      recomendadas++;
    }
    alternativas.push({
      letra: LETRAS[i], texto: linha(o.texto), consequencia: linha(o.consequencia),
      ...(recomendada ? { recomendada: { porque: linha(String(o.porque)) } } : {}),
    });
  }
  return recomendadas === 1 ? alternativas : undefined;
}

/**
 * Qual alternativa a recomendacao do pedido NOMEIA, ou -1 quando ela nao nomeia nenhuma.
 *
 * A regra e literal de proposito: a recomendacao precisa conter o texto de uma das opcoes. Uma
 * recomendacao que cita duas e ambigua e tambem nao serve. Nada aqui interpreta intencao.
 */
export function alternativaRecomendada(pedido: PedidoHitlQualquer): number {
  const recomendacao = recomendacaoDoPedido(pedido).toLowerCase();
  const citadas = escolhasDoPedido(pedido)
    .map((o, i) => ({ i, achou: !!o.texto.trim() && recomendacao.includes(o.texto.trim().toLowerCase()) }))
    .filter(o => o.achou);
  return citadas.length === 1 ? citadas[0].i : -1;
}

/** O que o contrato curto le do pedido alem das alternativas: alvo, corpo, ato e expiracao. */
function contextoDaPergunta(pedido: PedidoHitlQualquer): Pick<PerguntaDoLote, 'alvo' | 'corpo' | 'ato' | 'expiracao' | 'prazo'> {
  const alvo = alvoDoPedido(pedido);
  const v2 = ehV2(pedido) && pedido.classe === 'pergunta' ? pedido : undefined;
  return {
    alvo: alvo?.tipo === 'session' ? { tipo: 'session', sessionId: alvo.sessionId } : { tipo: 'gate' },
    ...(v2 ? { corpo: [...v2.corpo] } : {}), ...(v2?.ato ? { ato: v2.ato } : {}),
    expiracao: expiracaoDoPedido(pedido), prazo: prazoDoPedido(pedido) ?? null,
  };
}

/**
 * Traduz um pedido em pergunta do lote, ou diz por que ele nao virou uma.
 *
 * Duas fontes de alternativa, nesta ordem: as declaradas pelo proprio pedido (`ork.hitl/v2`) e,
 * na falta delas, as opcoes de um pedido `ork.hitl/v1` com a consequencia vinda do mapa
 * congelado e a recomendada sendo a que a recomendacao do pedido NOMEIA.
 */
export function perguntaDoPedido(pedido: PedidoHitlQualquer, numero: number): PerguntaDoLote | RecusaDeFormato {
  const recusa = (detalhe: string): RecusaDeFormato =>
    ({ pedidoId: pedido.id, thread: pedido.thread ?? null, motivo: 'hitl.formato', detalhe });
  // I-41 (T4c): um fato consumado nao e pergunta. Ele nao tem alvo, nao tem escolha e nao pede
  // nada; deixar `textoDoPedido` devolver o que foi decidido faria a camada 2 perguntar sobre
  // algo que ja aconteceu. A recusa e por ausencia de alvo, que e o criterio estrutural.
  if (!alvoDoPedido(pedido)) return recusa('decisão informada não é pergunta');
  const pergunta = linha(textoDoPedido(pedido));
  if (!pergunta) return recusa('pergunta vazia');

  const declaradas = alternativasDeclaradas(pedido);
  if (declaradas) {
    return { numero, thread: pedido.thread ?? null, fase: pedido.fase ?? null, pergunta, alternativas: declaradas, pedidoId: pedido.id,
      ...contextoDaPergunta(pedido) };
  }
  // I-41 (T4c): o parser da recomendacao e exclusivo do v1, e a porta se fecha aqui.
  //
  // Um v2 com duas recomendadas, ou sem consequencia, nao produz alternativas declaradas. Sem
  // esta linha ele cairia no caminho de baixo, onde `recomendacaoDoPedido` devolve o texto da
  // PRIMEIRA recomendada; esse texto cita o rotulo de uma opcao, o parser acha exatamente uma e
  // o pedido malformado entraria no lote com uma recomendada escolhida por acidente. E
  // exatamente o chute que a camada 2 existe para recusar, so que vindo por dentro.
  if (ehV2(pedido)) return recusa('alternativas declaradas inválidas: v2 não cai no parser do v1');

  const opcoes = escolhasDoPedido(pedido);
  if (opcoes.length < 2) return recusa('menos de 2 alternativas');
  if (opcoes.length > LETRAS.length) return recusa(`mais de ${LETRAS.length} alternativas`);
  const recomendada = alternativaRecomendada(pedido);
  if (recomendada < 0) return recusa('a recomendação não nomeia exatamente uma alternativa');

  return {
    numero, thread: pedido.thread ?? null, fase: pedido.fase ?? null, pergunta, pedidoId: pedido.id, ...contextoDaPergunta(pedido),
    alternativas: opcoes.map((o, i) => ({
      letra: LETRAS[i], texto: linha(o.texto), consequencia: CONSEQUENCIA_DA_ACAO[o.acao],
      ...(i === recomendada ? { recomendada: { porque: linha(recomendacaoDoPedido(pedido)) } } : {}),
    })),
  };
}

/**
 * O lote de ate cinco perguntas. O que sobra continua guardado e vai no proximo, e o que foi
 * recusado por formato e contado a parte, para que ninguem confunda "nao perguntei" com
 * "perguntei e nao houve resposta".
 */
export function montarLote(pedidos: readonly PedidoHitlQualquer[],
  opcoes: { teto?: number; numeroInicial?: number } = {}): LoteDePerguntas {
  const teto = opcoes.teto ?? TETO_DE_PERGUNTAS_POR_LOTE;
  // O numero continua de um lote para o outro enquanto o anterior ainda pode ser respondido:
  // "1a" nunca pode querer dizer duas perguntas diferentes ao mesmo tempo.
  const inicio = opcoes.numeroInicial ?? 1;
  const perguntas: PerguntaDoLote[] = [], recusadas: RecusaDeFormato[] = [];
  const vistos = new Set<string>();
  let elegiveis = 0, abertas = 0;
  for (const pedido of pedidos) {
    // O mesmo pedido chega por dois itens do pulse quando a sessao e a fase param pelo mesmo gate.
    // Perguntar duas vezes a mesma coisa, com dois numeros, era um jeito de o dono responder errado.
    if (vistos.has(pedido.id)) continue;
    vistos.add(pedido.id);
    // A3: `tipoDeResposta` e lido. Aberta nao se responde por letra e nao sai no meio das
    // objetivas: fica fora deste lote e e contada, para ninguem confundir fora com perdida.
    if (ehV2(pedido) && pedido.classe === 'pergunta' && pedido.tipoDeResposta === 'aberta') { abertas++; continue; }
    const resultado = perguntaDoPedido(pedido, inicio + perguntas.length);
    if ('motivo' in resultado) { recusadas.push(resultado); continue; }
    elegiveis++;
    if (perguntas.length < teto) perguntas.push(resultado);
  }
  return { contrato: CONTRATO_LOTE, perguntas, restantes: elegiveis - perguntas.length, recusadas, abertas };
}

/** Quantas perguntas continuam guardadas depois deste lote, para o resumo citar. */
export function guardadasDepoisDoLote(lote: LoteDePerguntas): number {
  return lote.restantes;
}

/**
 * RM-048 (D1): cada pergunta do lote sai pelo contrato curto, com o numero no titulo. A linha de
 * como responder e uma so, no fim do lote, porque o dono responde todas numa mensagem: "1a 2c".
 */
function corpoDaPergunta(p: PerguntaDoLote, canal: 'telegram' | 'terminal', quando: string): string[] {
  const curto = montarPedidoCurto({
    thread: p.thread, fase: p.fase, pergunta: p.pergunta, alvo: p.alvo, corpo: p.corpo, ato: p.ato,
    expiracao: p.expiracao, prazo: p.prazo, desde: p.desde,
    alternativas: p.alternativas.map(a => ({ chave: a.letra, texto: a.texto, consequencia: a.consequencia,
      ...(a.recomendada ? { recomendada: { porque: a.recomendada.porque } } : {}) })),
  }, { quando, responder: { tipo: 'numero', numero: p.numero } });
  return textoDoPedidoCurto(curto, canal).split('\n');
}

/** A5: a frase dos pedidos que nao viraram pergunta, com a concordancia certa para o dono ler. */
export function linhaDasRecusas(n: number): string {
  return n === 1
    ? '1 pedido não virou pergunta por defeito de quem escreveu; o conserto é nosso, não seu.'
    : `${n} pedidos não viraram pergunta por defeito de quem escreveu; o conserto é nosso, não seu.`;
}

/** Teto de uma mensagem de Telegram, com folga: o mesmo que a mensagem por item ja usava. */
export const TETO_DA_MENSAGEM = 3900;

export interface OpcoesDoTextoDoLote {
  canal: 'telegram' | 'terminal';
  /**
   * I-41 (GO-FIX 1, A4): quando sobram perguntas, o codigo do proximo lote. Sem ele, servido um
   * lote, o resto ficava parado ate algum item mudar, porque o resumo so sai com novidade.
   */
  proximo?: { codigo: string; faltam: number };
  /** Gates que estavam no resumo e ja nao esperavam o dono quando ele disse sim. */
  naoEsperam?: number;
  /** O instante da mensagem, para "desde" e "ate" sairem no relogio do dono. */
  quando?: string;
}

/**
 * O texto do lote no canal. Mesma regra da camada 1: quem monta e o nucleo, e o humano nunca
 * recebe JSON nem identificador longo. Ele responde pelo numero da pergunta mais a letra.
 */
export function textoDoLote(lote: LoteDePerguntas, opcoes: OpcoesDoTextoDoLote): string {
  if (lote.contrato !== CONTRATO_LOTE) throw new Error('lote HITL: contrato inválido');
  const telegram = opcoes.canal === 'telegram';
  const quando = opcoes.quando ?? new Date().toISOString();
  const n = lote.perguntas.length;
  const exemplo = lote.perguntas.map(p => `${p.numero}${p.alternativas[0].letra}`).join(' ');
  const faltam = opcoes.proximo?.faltam ?? lote.restantes;
  return [
    `${telegram ? '📋 ' : ''}Orkastery, ${n === 1 ? '1 pergunta' : `${n} perguntas`}`,
    '',
    ...lote.perguntas.flatMap((p, i) => [...corpoDaPergunta(p, opcoes.canal, quando), ...(i < n - 1 ? [''] : [])]),
    '',
    ...(n ? [`${telegram ? '↩️ ' : ''}Responda com o número e a letra, por exemplo: ${exemplo}. Evidências: ${lote.perguntas[0].numero} detalhes.`]
      : ['Nenhuma pergunta em formato respondível agora.']),
    ...(opcoes.proximo && faltam
      ? [`Falta${faltam === 1 ? '' : 'm'} ${faltam}. Para receber as próximas, responda ${opcoes.proximo.codigo} a.`]
      : faltam ? [`Sobra${faltam === 1 ? '' : 'm'} ${faltam} para o próximo lote.`] : []),
    ...(lote.abertas
      ? [`${lote.abertas === 1 ? '1 pergunta aberta fica' : `${lote.abertas} perguntas abertas ficam`} para depois das objetivas, uma por vez.`]
      : []),
    ...(opcoes.naoEsperam
      ? [`${opcoes.naoEsperam === 1 ? '1 pergunta do resumo já não esperava' : `${opcoes.naoEsperam} perguntas do resumo já não esperavam`} você quando fui buscar.`]
      : []),
    ...(lote.recusadas.length ? [linhaDasRecusas(lote.recusadas.length)] : []),
  ].join('\n').slice(0, TETO_DA_MENSAGEM);
}
