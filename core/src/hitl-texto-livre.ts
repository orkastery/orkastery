/**
 * RM-048 (item 2, D2 e D3): a resposta em linguagem natural, quando ela e inequivoca.
 *
 * Em 27/09 o dono respondeu "1. I-31. Aprovar, 2. D2 ..." e nada foi ao ledger: o ingresso so
 * conhecia "P4EJ a" e "1a 2c", e a prosa caiu no assistente. A decisao do dono (28/09) foi: a
 * resposta em linguagem natural registra quando for inequivoca ("aprovo", "sim", "pode seguir",
 * "a", "1", "1. B, 2. A"); ambigua, volta como pergunta com as opcoes reais, nunca como veredito
 * chutado; com mais de um pedido aberto na mesma thread, texto livre nao registra.
 *
 * "Inequivoca" nao e julgamento de ninguem. E esta regra, fechada e pura:
 *
 *   1. o texto tem a forma de uma resposta: letra a-e, digito 1-5, ou uma palavra do VOCABULARIO
 *      (que e uma lista, e nao um classificador), sozinha ou numerada ("1. B, 2. aprovo");
 *   2. a palavra casa com UMA alternativa, pela acao dela ("aprovo" casa `aprovar`; "nao" num gate
 *      casa `recusar` e `esperar`, entao e ambigua e volta como pergunta);
 *   3. a palavra sem numero e sem codigo so vale para a pergunta que acabou de sair, sozinha, e
 *      nunca para ato irreversivel (`JANELA_DO_TEXTO_LIVRE_MIN`).
 *
 * Este modulo nao autentica nada e nao registra nada. A prova continua sendo a do ingresso
 * (`autenticarResposta`, no endereco do pulse), conferida ANTES de qualquer leitura de conteudo.
 */

/** As intencoes que uma palavra do dono pode carregar. `detalhe` pede evidencia, nao decide. */
export type IntencaoLivre = 'afirmar' | 'negar' | 'revisar' | 'esperar' | 'detalhe';

/**
 * O vocabulario fechado, ja normalizado (minusculas, sem acento). Palavra fora daqui nao e
 * resposta: vai ao assistente, como sempre foi. Acrescentar uma palavra e decisao de contrato,
 * com teste, e nunca efeito colateral de alguem achar que "entendeu" o dono.
 */
export const VOCABULARIO_LIVRE: Readonly<Record<IntencaoLivre, readonly string[]>> = Object.freeze({
  afirmar: ['sim', 's', 'ok', 'pode', 'pode seguir', 'pode ir', 'segue', 'siga', 'seguir', 'manda', 'aprovo', 'aprovado',
    'aprovada', 'aprovar', 'aprova', 'confirmo', 'confirmado', 'de acordo'],
  negar: ['nao', 'n'],
  revisar: ['recuso', 'recusado', 'recusar', 'reprovo', 'reprovado', 'revisar', 'revisao', 'refazer', 'volta', 'voltar'],
  esperar: ['esperar', 'espera', 'aguardar', 'aguarda', 'aguarde', 'depois', 'mais tarde', 'agora nao'],
  detalhe: ['detalhe', 'detalhes', 'evidencia', 'evidencias'],
});

/** Que acoes de alternativa cada intencao casa. `negar` casa duas de proposito: e ambigua num gate. */
export const ACOES_DA_INTENCAO: Readonly<Record<Exclude<IntencaoLivre, 'detalhe'>, readonly string[]>> = Object.freeze({
  afirmar: ['aprovar', 'responder'],
  negar: ['recusar', 'esperar'],
  revisar: ['recusar'],
  esperar: ['esperar'],
});

/**
 * D3: a palavra solta (sem numero e sem codigo) so vale ate esta quantidade de minutos depois de
 * a pergunta sair. Numero e codigo nao tem janela: a linha que o dono recebeu vale enquanto o gate
 * esperar a mesma pergunta.
 */
export const JANELA_DO_TEXTO_LIVRE_MIN = 60;

/**
 * As palavras em fonte de expressao regular, com as variantes de acento. E daqui que saem as
 * formas `lista` e `livre` de `GRAMATICA_DO_PULSE`, que os adaptadores copiam texto a texto.
 */
const PALAVRAS_DA_FORMA = 'pode seguir|pode ir|pode|sim|s|ok|aprovo|aprovado|aprovada|aprovar|aprova|segue|siga|seguir|manda|' +
  'confirmo|confirmado|de acordo|agora n[aã]o|n[aã]o|n|recuso|recusado|recusar|reprovo|reprovado|revisar|revis[aã]o|refazer|' +
  'volta|voltar|esperar|espera|aguardar|aguarda|aguarde|depois|mais tarde|detalhes?|evid[eê]ncias?';

/** Uma resposta: letra, ou palavra do vocabulario. */
const RESPOSTA_DA_FORMA = `(?:[a-e]|${PALAVRAS_DA_FORMA})`;

/**
 * Um item numerado: "1a", "1 a", "1. B", "1) aprovo", "1 - nao", "1: detalhes".
 *
 * Sem dois quantificadores de espaco lado a lado: o adaptador testa a forma ANTES de conferir a
 * allowlist, e forma com backtracking caro seria uma porta de negacao de servico para quem nao e
 * o dono. Os adaptadores tambem recusam, antes da regex, texto acima de `TETO_DA_FORMA`.
 */
const ITEM_DA_FORMA = `[0-9]{1,2}(?:[ \\t]*[.):-])?[ \\t]*${RESPOSTA_DA_FORMA}`;

/** Maior texto que o ingresso testa contra as formas do pulse. */
export const TETO_DA_FORMA = 300;

/** As fontes das duas formas novas do ingresso. Ambas sao lidas sem diferenca de caixa. */
export const FORMAS_DO_TEXTO_LIVRE = Object.freeze({
  /** Resposta numerada, uma ou varias, separadas por virgula, ponto e virgula, espaco ou linha. */
  lista: `^[ \\t]*${ITEM_DA_FORMA}(?:[ \\t\\r\\n,;]*${ITEM_DA_FORMA})*[ \\t]*(?:[.!][ \\t]*)?$`,
  /** Resposta solta: letra, digito ou palavra, sozinha na mensagem. */
  livre: `^[ \\t]*(?:[1-5]|${RESPOSTA_DA_FORMA})[ \\t]*(?:[.!]+[ \\t]*)?$`,
});

/** Minusculas, sem acento, espaco unico, sem pontuacao final. */
export function normalizarLivre(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').trim();
}

export type TrechoLivre =
  | { tipo: 'letra'; letra: string }
  | { tipo: 'digito'; numero: number }
  | { tipo: 'intencao'; intencao: IntencaoLivre; palavra: string };

/** O que um pedaco de resposta quer dizer, ou `null` quando ele nao e resposta. */
export function lerTrecho(bruto: string): TrechoLivre | null {
  const t = normalizarLivre(bruto);
  if (/^[a-e]$/.test(t)) return { tipo: 'letra', letra: t };
  if (/^[1-5]$/.test(t)) return { tipo: 'digito', numero: Number(t) };
  for (const [intencao, palavras] of Object.entries(VOCABULARIO_LIVRE) as [IntencaoLivre, readonly string[]][]) {
    if (palavras.includes(t)) return { tipo: 'intencao', intencao, palavra: t };
  }
  return null;
}

/** Os itens de uma resposta numerada, na ordem em que o dono escreveu. */
export function lerLista(texto: string): { numero: number; trecho: TrechoLivre }[] | null {
  if (texto.length > TETO_DA_FORMA || !new RegExp(FORMAS_DO_TEXTO_LIVRE.lista, 'i').test(texto)) return null;
  const itens: { numero: number; trecho: TrechoLivre }[] = [];
  const item = new RegExp(`([0-9]{1,2})(?:[ \\t]*[.):-])?[ \\t]*(${RESPOSTA_DA_FORMA})(?=[ \\t\\r\\n,;]*(?:[0-9]|[.!]?[ \\t]*$))`, 'gi');
  for (const m of texto.matchAll(item)) {
    const trecho = lerTrecho(m[2]);
    if (!trecho) return null;
    itens.push({ numero: Number(m[1]), trecho });
  }
  return itens.length ? itens : null;
}

/** A resposta solta, ou `null` quando o texto nao tem a forma de uma. */
export function lerSolta(texto: string): TrechoLivre | null {
  return texto.length <= TETO_DA_FORMA && new RegExp(FORMAS_DO_TEXTO_LIVRE.livre, 'i').test(texto) ? lerTrecho(texto) : null;
}

export type Resolucao =
  | { tipo: 'escolha'; indice: number }
  | { tipo: 'detalhe' }
  | { tipo: 'ambigua'; indices: number[] }
  | { tipo: 'nenhuma' };

/**
 * Qual alternativa o trecho escolhe, pelas acoes das alternativas (na ordem do pedido). Letra e
 * digito escolhem pela posicao; palavra, pela acao, e so quando exatamente uma casa.
 */
export function resolverTrecho(trecho: TrechoLivre, acoes: readonly string[], letras: readonly string[]): Resolucao {
  if (trecho.tipo === 'letra') { const i = letras.indexOf(trecho.letra); return i >= 0 ? { tipo: 'escolha', indice: i } : { tipo: 'nenhuma' }; }
  if (trecho.tipo === 'digito') return trecho.numero <= acoes.length ? { tipo: 'escolha', indice: trecho.numero - 1 } : { tipo: 'nenhuma' };
  const intencao = trecho.intencao;
  if (intencao === 'detalhe') return { tipo: 'detalhe' };
  const casam = acoes.map((a, i) => ACOES_DA_INTENCAO[intencao].includes(a) ? i : -1).filter(i => i >= 0);
  if (casam.length === 1) return { tipo: 'escolha', indice: casam[0] };
  return casam.length ? { tipo: 'ambigua', indices: casam } : { tipo: 'nenhuma' };
}

/** O que o dono respondeu ao resumo ("posso mandar as perguntas?"), pela mesma regra. */
export function consentimentoDoTrecho(trecho: TrechoLivre | null): 'sim' | 'nao' | undefined {
  if (!trecho) return undefined;
  if (trecho.tipo === 'letra') return trecho.letra === 'a' ? 'sim' : trecho.letra === 'b' ? 'nao' : undefined;
  if (trecho.tipo === 'digito') return trecho.numero === 1 ? 'sim' : trecho.numero === 2 ? 'nao' : undefined;
  if (trecho.intencao === 'afirmar') return 'sim';
  if (trecho.intencao === 'negar' || trecho.intencao === 'esperar') return 'nao';
  return undefined;
}
