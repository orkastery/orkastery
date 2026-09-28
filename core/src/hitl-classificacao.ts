/**
 * I-41 (D16): as tres classificacoes que o resumo recorrente conta, cada uma com definicao
 * verificavel e domicilio unico aqui.
 *
 * A ordem do dono era "urgente, bloqueando, critico", e a armadilha declarada era inventar tres
 * nomes para a mesma coisa. Os tres predicados abaixo perguntam coisas diferentes:
 *
 *   BLOQUEANTE pergunta sobre ESTRUTURA: tem alguem parado esperando por isso?
 *   URGENTE    pergunta sobre RELOGIO:   isso vence antes do proximo resumo?
 *   CRITICO    pergunta sobre NATUREZA:  responder isso autoriza um ato que nao se desfaz?
 *
 * Elas nao sao independentes nos dados de hoje, e esconder isso seria pior que dizer. Com
 * `ork.hitl/v1`, prazo so existe dentro de um pedido, e pedido so e anexado a item que tem
 * sessao ou fase parada (`core/src/pulse.ts`, laco de `precisaDeHumanoAgora`): logo hoje
 * URGENTE esta contido em BLOQUEANTE. Sob `ork.hitl/v2` isso se separa, porque uma pergunta
 * com `seguir-recomendada` corre contra o relogio SEM segurar ninguem: a fabrica segue com a
 * recomendada quando o prazo vence. O teste desta entrega prova os dois fatos, o de hoje e o
 * de depois, em vez de prometer independencia que a medicao nega.
 *
 * I-41 (GO-FIX 1, A2), a resposta a "as duas colapsam?": NAO colapsam, porque BLOQUEANTE e
 * estritamente maior. Hoje URGENTE esta contido nele (nenhum emissor usa `seguir-recomendada`,
 * entao nenhum prazo corre sem alguem parado), mas a maioria do que trava nao vence antes do
 * proximo resumo. As duas linhas ficam porque respondem perguntas diferentes: "tem alguem
 * parado?" e "isso acaba antes do proximo aviso?". Somar as duas e o erro que o texto nao convida.
 *
 * I-41 (GO-FIX 1, A1): CRITICO deixou de ser zero por construcao. O emissor do gate declara o ato
 * quando a pausa libera push na base protegida (`atoDaPausa`), e o item que espera nesse gate e
 * contado como sem volta mesmo antes de o pedido nascer (`atoDoItem`).
 *
 * Nenhum dos tres predicado olha para texto. Todos leem campo estruturado.
 */
import { ATO_IRREVERSIVEL_DO_MOTIVO, ATOS_IRREVERSIVEIS, AtoIrreversivel, PedidoHitlQualquer,
  prazoDoPedido } from './hitl-contract';
import { MotivoGate } from './types';

/**
 * O recorte que a classificacao le de um item pendente. `ItemPulse` satisfaz esta forma sem
 * conversao. A interface existe para que este modulo nao dependa de `pulse.ts`, que depende do
 * contrato HITL: o ciclo em tempo de execucao so apareceria como `undefined is not a function`.
 */
export interface ItemClassificavel {
  id: string;
  classe: string;
  motivo: string;
  thread: string | null;
  fase: string | null;
  sessionId: string | null;
  /** As duas versoes do contrato; `decidido` nao tem prazo e por isso nunca e urgente. */
  pedido?: PedidoHitlQualquer;
}

/**
 * Janela default da cadencia do resumo, em minutos. O dono pediu de hora em hora em 20/09; as
 * tags dele preveem 8h, 2h, 60min, 30min e 15min, entao a janela e parametro, nao constante
 * escondida. Ela entra em URGENTE porque "urgente" so quer dizer alguma coisa em relacao ao
 * proximo aviso: o que vence depois do proximo resumo pode esperar por ele.
 */
export const JANELA_PADRAO_MIN = 60;

/**
 * A unica classe de item que NAO bloqueia ninguem, e por isso a unica excecao escrita aqui.
 * O score pendente nasce depois do `ship_done`: a entrega ja aconteceu, nenhuma fase espera por
 * ele. Chamar 13 scores de "bloqueio" foi parte do que fez o produto dizer que 45 itens
 * precisavam do dono agora quando 44 deles nao eram decisao dele.
 */
export const CLASSES_QUE_NAO_BLOQUEIAM: readonly string[] = ['score_pendente'];

export interface Classificacao {
  urgente: boolean;
  bloqueante: boolean;
  critico: boolean;
  /** O ato da lista congelada que este item autoriza, quando ha um. */
  ato?: AtoIrreversivel;
  /** Uma linha por predicado, dizendo por que deu o que deu. O CHECK le isto, nao o booleano. */
  porque: { urgente: string; bloqueante: string; critico: string };
}

export interface OpcoesDeClassificacao {
  quando: string;
  /** Minutos ate o proximo resumo. Default `JANELA_PADRAO_MIN`. */
  janelaMin?: number;
  /**
   * I-41 (GO-FIX 1, A1): o ato que o gate deste item autoriza quando o pedido ainda vai ser
   * aberto. O item que espera o dono num gate de push nao tem pedido vivo ate o dono dizer sim, e
   * sem esta fonte ele sairia como "reversivel" so porque o pedido ainda nao nasceu. Vem depois do
   * pedido e do mapa por motivo, e nunca libera nada: so acende a marca de critico.
   */
  atoDoItem?: (item: ItemClassificavel) => AtoIrreversivel | undefined;
}

/**
 * O ato irreversivel que responder este item autoriza, ou `undefined`.
 *
 * Duas fontes, nesta ordem. Primeiro o proprio pedido, quando ele declara (`ork.hitl/v2`);
 * depois o mapa congelado por motivo, que e o que existe para um pedido `ork.hitl/v1`, que nao
 * tem onde declarar. A declaracao vence o mapa porque e mais especifica: dois pedidos do mesmo
 * motivo podem autorizar atos diferentes.
 */
export function atoIrreversivelDoItem(item: ItemClassificavel): AtoIrreversivel | undefined {
  const declarado = (item.pedido as { ato?: unknown } | undefined)?.ato;
  if (typeof declarado === 'string' && (ATOS_IRREVERSIVEIS as readonly string[]).includes(declarado)) {
    return declarado as AtoIrreversivel;
  }
  return ATO_IRREVERSIVEL_DO_MOTIVO[item.motivo as MotivoGate];
}

/** Nome curto da sessao, do jeito que o dono ja ve em `ork board` e nos comandos de log. */
const sessaoCurta = (id: string): string => id.slice(0, 8);

export function classificarItem(item: ItemClassificavel, opcoes: OpcoesDeClassificacao): Classificacao {
  const agoraMs = Date.parse(opcoes.quando);
  if (!Number.isFinite(agoraMs)) throw new Error('classificação HITL: instante de consulta inválido');
  const janelaMin = opcoes.janelaMin ?? JANELA_PADRAO_MIN;
  if (!Number.isFinite(janelaMin) || janelaMin <= 0) throw new Error('classificação HITL: janela da cadência inválida');

  // BLOQUEANTE: existe sessao ou fase parada esperando por ele.
  let bloqueante: boolean, porqueBloqueante: string;
  if (CLASSES_QUE_NAO_BLOQUEIAM.includes(item.classe)) {
    bloqueante = false;
    porqueBloqueante = 'a entrega já aconteceu; a nota é fila, não bloqueio';
  } else if (item.sessionId) {
    bloqueante = true;
    porqueBloqueante = `a sessão ${sessaoCurta(item.sessionId)} está parada esperando`;
  } else if (item.thread) {
    bloqueante = true;
    porqueBloqueante = item.fase
      ? `a fase ${item.fase} de ${item.thread} está parada esperando`
      : `${item.thread} está parada esperando`;
  } else {
    bloqueante = false;
    porqueBloqueante = 'não aponta sessão nem fase parada';
  }

  // URGENTE: o prazo vence antes do proximo resumo, ou ja venceu.
  const prazoMs = item.pedido ? Date.parse(prazoDoPedido(item.pedido) ?? '') : NaN;
  const urgente = Number.isFinite(prazoMs) && prazoMs <= agoraMs + janelaMin * 60000;
  const porqueUrgente = !Number.isFinite(prazoMs)
    ? 'não tem prazo correndo; antiguidade sozinha não cria urgência'
    : prazoMs <= agoraMs ? 'o prazo já venceu' : `o prazo vence dentro dos próximos ${janelaMin} min`;

  // CRITICO: responder autoriza um ato que nao se desfaz.
  const ato = atoIrreversivelDoItem(item) ?? opcoes.atoDoItem?.(item);
  const critico = ato !== undefined;

  return {
    urgente, bloqueante, critico, ...(ato ? { ato } : {}),
    porque: {
      urgente: porqueUrgente,
      bloqueante: porqueBloqueante,
      critico: ato ? `responder autoriza um ato que não se desfaz: ${ato}` : 'não autoriza nenhum ato da lista congelada',
    },
  };
}

/**
 * Contagem agregada sobre uma lista, e a lista de threads bloqueadas pelo nome curto.
 *
 * As threads saem ordenadas e sem repeticao: um item por thread no texto, mesmo quando a mesma
 * thread aparece em cinco itens. Era exatamente essa repeticao que enchia o canal.
 */
export interface ContagemDeClassificacao {
  total: number;
  urgentes: number;
  bloqueantes: number;
  criticos: number;
  threadsBloqueadas: string[];
}

export function contarClassificacoes(
  itens: readonly ItemClassificavel[], opcoes: OpcoesDeClassificacao,
): ContagemDeClassificacao {
  const threads = new Set<string>();
  let urgentes = 0, bloqueantes = 0, criticos = 0;
  for (const item of itens) {
    const c = classificarItem(item, opcoes);
    if (c.urgente) urgentes++;
    if (c.critico) criticos++;
    if (c.bloqueante) { bloqueantes++; if (item.thread) threads.add(item.thread); }
  }
  return { total: itens.length, urgentes, bloqueantes, criticos, threadsBloqueadas: [...threads].sort() };
}
