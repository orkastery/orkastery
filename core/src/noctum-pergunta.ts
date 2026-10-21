/**
 * RM-057 (resposta curta, ork-rm057respost): a pergunta do arco #Noctum ao dono, no contrato curto da RM-048.
 *
 * Até aqui, autorizar um arco exigia copiar `/ork noctum <arco> autorizar <sha256>` no Telegram: uma linha de 90
 * caracteres, só num canal, o que a própria RM-057 proíbe, e duas propostas do piloto venceram assim em 20/10/2026. O
 * dono decidiu: ele aprova onde estiver, com resposta curta. Autorizar e revogar viram perguntas com código curto e três
 * alternativas, uma recomendada; o dono responde "a", "sim", "1a" ou "<código> a", em reply no Telegram, no terminal do
 * Claude Code ou pelo diálogo nativo, e o núcleo resolve contra a pergunta pendente.
 *
 * O hash do envelope continua sendo o que é autorizado: ele mora na pergunta (a proposta do log do arco), nunca na
 * resposta, e a resposta só vale para a pergunta de agora (a proposta que mudou tem outro código).
 *
 * Este módulo é puro: monta a pergunta, o texto e a escolha. Quem guarda a pergunta é o log do arco (`noctum-arco.ts`);
 * quem resolve a resposta contra as pendentes é `noctum-resposta.ts`.
 */
import { formatarHora } from './horario';
import { CanalDoPedido, montarPedidoCurto, textoDoPedidoCurto } from './hitl-curto';
import { resolverTrecho, Resolucao, TrechoLivre } from './hitl-texto-livre';
import { ConteudoDoEnvelope, envelopeComTrabalhos, resumoDoEnvelope } from './noctum-envelope';

export const CONTRATO_PERGUNTA_DO_ARCO = 'ork.noctum-pergunta/v1' as const;

export type AtoDaPergunta = 'autorizar' | 'revogar';

/** Uma pergunta do arco ao dono, derivada do log do arco a cada leitura. */
export interface PerguntaDoArco {
  contrato: typeof CONTRATO_PERGUNTA_DO_ARCO;
  arco: string;
  ato: AtoDaPergunta;
  /** O código curto, do mesmo alfabeto dos gates e do resumo do pulse. */
  codigo: string;
  /** A versão da proposta (autorizar) ou a vigente (revogar). */
  versao: number | null;
  /** O hash do envelope que a resposta autoriza (autorizar) ou o vigente (revogar). Mora aqui, nunca na resposta. */
  envelopeSha256: string | null;
  /** Quando a pergunta nasceu e até quando ela vale. Depois do prazo, nenhuma resposta a ela vale. */
  criadaEm: string;
  prazo: string;
  /** O envelope da proposta (autorizar) ou o vigente (revogar), para o resumo e para o detalhe. */
  conteudo: ConteudoDoEnvelope | null;
}

export type LetraDaPergunta = 'a' | 'b' | 'c';

export interface AlternativaDoArco {
  letra: LetraDaPergunta;
  texto: string;
  /** A ação, para a palavra do vocabulário fechado escolher sem adivinhar ("sim" e "autorizo" casam `aprovar`). */
  acao: 'aprovar' | 'esperar' | 'recusar';
  consequencia: string;
  /** Só a recomendada tem o porquê. */
  porque?: string;
}

/** A recomendada é a primeira: a proposta é a que o dono pediu. Só ela age; b e c não gravam nada (D13). */
export const ALTERNATIVAS_DE_AUTORIZAR: readonly AlternativaDoArco[] = Object.freeze([
  { letra: 'a', texto: 'Autorizo', acao: 'aprovar', consequencia: 'o arco passa a valer na janela, com este envelope',
    porque: 'é a proposta pedida, com os valores do envelope; revogar segue valendo a qualquer hora' },
  { letra: 'b', texto: 'Adiar', acao: 'esperar', consequencia: 'nada muda; a proposta vence no prazo dela' },
  { letra: 'c', texto: 'Mudar algo', acao: 'recusar', consequencia: 'nada é autorizado; diga o que mudar e uma proposta nova sai' },
]);

export const ALTERNATIVAS_DE_REVOGAR: readonly AlternativaDoArco[] = Object.freeze([
  { letra: 'a', texto: 'Revogo agora', acao: 'aprovar', consequencia: 'nenhum efeito novo passa, e o arco não reabre',
    porque: 'a revogação foi pedida, e ela é o ato de segurança do arco' },
  { letra: 'b', texto: 'Manter o arco', acao: 'esperar', consequencia: 'nada muda; o arco segue até o fim da janela' },
  { letra: 'c', texto: 'Mudar algo', acao: 'recusar', consequencia: 'nada é revogado; diga o que mudar e uma emenda é proposta' },
]);

export function alternativasDaPergunta(p: Pick<PerguntaDoArco, 'ato'>): readonly AlternativaDoArco[] {
  return p.ato === 'autorizar' ? ALTERNATIVAS_DE_AUTORIZAR : ALTERNATIVAS_DE_REVOGAR;
}

/** A pergunta em uma frase. */
export function fraseDaPergunta(p: Pick<PerguntaDoArco, 'ato' | 'arco' | 'versao'>): string {
  return p.ato === 'autorizar' ? `Autorizar o arco ${p.arco} (proposta ${p.versao})?` : `Revogar o arco ${p.arco}?`;
}

/** As duas linhas de contexto: o que o dono decide, sem o envelope inteiro (ele fica no detalhe). */
function corpoDaPergunta(p: PerguntaDoArco, quando: string): string[] {
  const c = p.conteudo;
  if (!c) return [];
  const fuso = c.janela.fuso;
  const hora = (iso: string) => formatarHora(iso, { fuso, agora: quando });
  if (p.ato === 'revogar') {
    return [`Vigente até ${hora(c.janela.fim)} (${fuso}), proposta ${p.versao}`,
      'Revogar nega todo efeito novo na hora; o arco não reabre'];
  }
  const destinos = c.destinos.map(d => `${d.repositorio} (${d.base}): ${d.permissoes.join(', ')}`).join('; ');
  const trabalhos = envelopeComTrabalhos(c) ? `; ${c.trabalhos.length} trabalho${c.trabalhos.length === 1 ? '' : 's'}` : '';
  return [`Janela de ${hora(c.janela.inicio)} a ${hora(c.janela.fim)} (${fuso}); ${destinos}`,
    `Teto do arco: ${c.orcamento.arco.valor} ${c.orcamento.arco.unidade}${trabalhos}; relatório às ${c.relatorio.horario} por ` +
      `${c.relatorio.canal}`];
}

/** O que está parado e o que acontece sem resposta. Expirar nunca autoriza nem revoga. */
function travaDaPergunta(p: PerguntaDoArco, quando: string): string {
  const prazo = formatarHora(p.prazo, { fuso: p.conteudo?.janela.fuso, agora: quando });
  return p.ato === 'autorizar'
    ? `A proposta ${p.versao} vale até ${prazo}. Sem resposta, nada é autorizado.`
    : `A pergunta vale até ${prazo}. Sem resposta, o arco segue como está.`;
}

/**
 * O texto da pergunta no canal, no contrato curto: o título com o arco e o código, a pergunta, a trava, duas linhas de
 * contexto, as três alternativas com a recomendada e o porquê, e a linha "responda a, b ou c". Nunca o hash, nunca um
 * comando para copiar. Com o número do lote servido, ele vai na frente do título.
 */
export function textoDaPerguntaDoArco(p: PerguntaDoArco, canal: CanalDoPedido, opcoes: { quando: string; numero?: number }): string {
  const curto = montarPedidoCurto({
    thread: null, fase: null, titulo: `arco ${p.arco} · ${p.codigo}`, pergunta: fraseDaPergunta(p), trava: travaDaPergunta(p, opcoes.quando),
    corpo: corpoDaPergunta(p, opcoes.quando), prazo: p.prazo,
    alternativas: alternativasDaPergunta(p).map(a => ({ chave: a.letra, texto: a.texto, consequencia: a.consequencia,
      ...(a.porque ? { recomendada: { porque: a.porque } } : {}) })),
  }, { quando: opcoes.quando, responder: { tipo: 'letras', codigo: p.codigo, ...(opcoes.numero ? { numero: opcoes.numero } : {}) } });
  return textoDoPedidoCurto(curto, canal);
}

/**
 * O texto da pergunta no diálogo nativo do host (D7 da ork-rm057respost): o mesmo contrato curto, com a linha do diálogo no
 * lugar da das letras. O código vai no título quando a pergunta tem um (a proposta de antes da resposta curta não tem).
 */
export function textoDoDialogoDoArco(p: PerguntaDoArco, quando: string): string {
  return textoDoPedidoCurto(montarPedidoCurto({
    thread: null, fase: null, titulo: p.codigo ? `arco ${p.arco} · ${p.codigo}` : `arco ${p.arco}`, pergunta: fraseDaPergunta(p),
    trava: travaDaPergunta(p, quando), corpo: corpoDaPergunta(p, quando), prazo: p.prazo,
    alternativas: alternativasDaPergunta(p).map(a => ({ chave: a.letra, texto: a.texto, consequencia: a.consequencia,
      ...(a.porque ? { recomendada: { porque: a.porque } } : {}) })),
  }, { quando, responder: { tipo: 'dialogo' } }), 'terminal');
}

/** O detalhe a um pedido de distância ("<código> detalhes"): o envelope inteiro, com o hash, como o dono o autoriza. */
export function detalhesDaPergunta(p: PerguntaDoArco): string {
  if (!p.conteudo || !p.envelopeSha256) return `A pergunta ${p.codigo} do arco ${p.arco} não tem envelope para mostrar.`;
  return [`Envelope da pergunta ${p.codigo} (arco ${p.arco}, proposta ${p.versao}):`, ...resumoDoEnvelope(p.conteudo, p.envelopeSha256)].join('\n');
}

/** A escolha pela letra, pelo dígito ou pela palavra do vocabulário fechado, pelas ações. Ambígua volta como ambígua. */
export function escolhaDaPergunta(p: Pick<PerguntaDoArco, 'ato'>, trecho: TrechoLivre): Resolucao {
  const alternativas = alternativasDaPergunta(p);
  return resolverTrecho(trecho, alternativas.map(a => a.acao), alternativas.map(a => a.letra));
}

/** As alternativas reais em uma linha, para a resposta que não deu para registrar. */
export function opcoesDaPergunta(p: Pick<PerguntaDoArco, 'ato' | 'codigo'>): string {
  return alternativasDaPergunta(p).map(a => `${a.letra} (${a.texto})`).join(', ');
}
