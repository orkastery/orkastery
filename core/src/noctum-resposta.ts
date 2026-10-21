/**
 * RM-057 (resposta curta, ork-rm057respost): a resposta curta do dono contra as perguntas dos arcos #Noctum.
 *
 * Quem chega aqui já provou a origem: o receptor do pulse conferiu o envelope assinado do Telegram, e o ingresso do
 * terminal conferiu a origem da sessão. Este módulo só acha a pergunta (pelo código, ou a única que cabe), lê a escolha
 * pela letra ou pela palavra do vocabulário fechado, chama o ato do arco com a prova e devolve a frase ao dono. Ele nunca
 * escolhe pelo dono: ambígua, fora do vocabulário ou sem pergunta, a resposta volta como pergunta e nada é gravado.
 *
 * As alternativas b (adiar) e c (mudar algo) não gravam nada no arco (D13): a pergunta segue pendente até o prazo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { formatarHora } from './horario';
import { TrechoLivre } from './hitl-texto-livre';
import { autorizarPelaResposta, InfoDaRespostaCurta, PerguntaNoLog, perguntasDoArco, ProvaDaRespostaCurta, RespostaAPergunta,
  revogarPelaResposta } from './noctum-arco';
import { ID_DO_ARCO, RecusaDoArco } from './noctum-envelope';
import { alternativasDaPergunta, detalhesDaPergunta, escolhaDaPergunta, LetraDaPergunta, opcoesDaPergunta } from './noctum-pergunta';

/** Os arcos desta raiz de estado, pelos nomes das pastas. */
function arcosDaRaiz(raiz: string): string[] {
  try { return fs.readdirSync(path.join(raizDoEstado(raiz), '.orkastery', 'noctum', 'arcos')).filter(n => ID_DO_ARCO.test(n)).sort(); }
  catch { return []; }
}

/** Todas as perguntas de todos os arcos, com a situação de cada uma no instante. Arco que não se lê fica de fora. */
export function perguntasDosArcos(raiz: string, quando: string): PerguntaNoLog[] {
  const todas: PerguntaNoLog[] = [];
  for (const arco of arcosDaRaiz(raiz)) {
    try { todas.push(...perguntasDoArco(raiz, arco, quando)); } catch { /* arco ilegível não responde por pergunta */ }
  }
  return todas;
}

/** As perguntas que ainda esperam o dono agora. */
export function perguntasPendentes(raiz: string, quando: string): PerguntaNoLog[] {
  return perguntasDosArcos(raiz, quando).filter(p => p.situacao === 'pendente');
}

/** As perguntas com este código, em qualquer situação: a resposta atrasada ouve o porquê, e o código em dois lugares é ambíguo. */
export function perguntasPorCodigo(raiz: string, codigo: string, quando: string): PerguntaNoLog[] {
  const alvo = codigo.trim().toUpperCase();
  return perguntasDosArcos(raiz, quando).filter(p => p.codigo === alvo);
}

/** O rótulo da pergunta para a lista de "qual?": o código e a letra, com o arco e o ato. */
export function rotuloDaPergunta(p: Pick<PerguntaNoLog, 'codigo' | 'arco' | 'ato'>): string {
  return `${p.codigo} a (arco ${p.arco}: ${p.ato === 'autorizar' ? 'autorizar' : 'revogar'})`;
}

export type DesfechoDaRespostaAoArco =
  /** O ato foi gravado agora (ou já valia: `repetida`; pela mesma prova: `mesmaProva`). */
  | { tipo: 'registrada'; ato: 'autorizar' | 'revogar'; letra: 'a'; repetida: boolean; mesmaProva: boolean; mensagem: string }
  /** Adiar ou mudar algo: nada é gravado no arco. */
  | { tipo: 'sem-efeito'; letra: Exclude<LetraDaPergunta, 'a'>; mensagem: string }
  /** O envelope inteiro, a um pedido de distância. */
  | { tipo: 'detalhe'; mensagem: string }
  /** Nada gravado, com o porquê e o que responder. */
  | { tipo: 'recusada'; motivo: string; mensagem: string };

export interface OpcoesDaRespostaAoArco {
  quando: string;
  canal: 'telegram' | 'terminal';
  /** A prova da via, montada com a letra que o núcleo leu. */
  provar: (r: Omit<RespostaAPergunta, 'respostaSha256'>) => ProvaDaRespostaCurta;
  /** O número do lote servido, quando o dono respondeu por ele. */
  numero?: number;
}

const marca = (canal: 'telegram' | 'terminal', tipo: 'ok' | 'aviso') => canal === 'telegram' ? (tipo === 'ok' ? '✅ ' : '⚠️ ') : (tipo === 'ok' ? '' : '! ');

/** A frase de uma recusa tipada do arco, para o dono, sem caminho de máquina e sem mensagem interna crua. */
function textoDaRecusa(raiz: string, p: PerguntaNoLog, e: RecusaDoArco, o: OpcoesDaRespostaAoArco): string {
  const aviso = marca(o.canal, 'aviso');
  const nada = p.ato === 'autorizar' ? 'nada foi autorizado' : 'nada foi revogado';
  switch (e.motivo) {
    case 'noctum.efeito.hash-antigo': {
      const agora = perguntasDoArco(raiz, p.arco, o.quando).find(q => q.situacao === 'pendente' && q.ato === p.ato);
      return `${aviso}A proposta do arco ${p.arco} mudou desde a pergunta ${p.codigo}; ${nada}.` +
        (agora ? ` A pergunta de agora é ${agora.codigo}: responda ${agora.codigo} a para a proposta ${agora.versao}.` : '');
    }
    case 'noctum.envelope.invalido':
    case 'noctum.pergunta.vencida': {
      const venceuAs = formatarHora(p.prazo, { fuso: p.conteudo?.janela.fuso, agora: o.quando });
      return `${aviso}A pergunta ${p.codigo} venceu às ${venceuAs}; ${nada}. ` +
        (p.ato === 'autorizar' ? 'Para seguir, a proposta precisa sair de novo, com outra pergunta.' : 'Para revogar, peça a revogação de novo.');
    }
    case 'noctum.pergunta.substituida':
      return `${aviso}A pergunta ${p.codigo} foi substituída por outra; ${nada}.`;
    case 'noctum.efeito.expirado':
      return `${aviso}O arco ${p.arco} já terminou; ${nada}.`;
    case 'noctum.efeito.encerrado':
      return `${aviso}O arco ${p.arco} está encerrado, e encerrado é terminal; ${nada}.`;
    case 'noctum.efeito.revogado':
      return `${aviso}O arco ${p.arco} foi revogado, e a revogação é terminal; ${nada}.`;
    case 'noctum.origem.sem-prova':
      return `${aviso}Não consegui provar que a resposta a ${p.codigo} veio de você, a tempo; ${nada}. Mande de novo.`;
    default:
      return `${aviso}Não consegui registrar a resposta a ${p.codigo} (${e.motivo}); ${nada}.`;
  }
}

/**
 * Responde à pergunta do arco com o trecho que o dono digitou. A prova é montada só depois de a letra ser lida, e o ato
 * (autorizar ou revogar) confere tudo de novo sob o lock do arco: a pergunta de agora, o prazo, a janela e a prova.
 */
export function responderPerguntaDoArco(raiz: string, p: PerguntaNoLog, trecho: TrechoLivre, o: OpcoesDaRespostaAoArco): DesfechoDaRespostaAoArco {
  const r = escolhaDaPergunta(p, trecho);
  const aviso = marca(o.canal, 'aviso');
  if (r.tipo === 'detalhe') return { tipo: 'detalhe', mensagem: detalhesDaPergunta(p) };
  if (r.tipo === 'ambigua' || r.tipo === 'nenhuma') {
    const dito = trecho.tipo === 'intencao' ? trecho.palavra : trecho.tipo === 'letra' ? trecho.letra : String(trecho.numero);
    return { tipo: 'recusada', motivo: r.tipo === 'ambigua' ? 'ambigua' : 'nao-entendida',
      mensagem: `${aviso}${r.tipo === 'ambigua' ? `"${dito}" serve para mais de uma alternativa de ${p.codigo}` : `Não entendi "${dito}" para ${p.codigo}`}; ` +
        `nada foi registrado. Responda com uma destas: ${opcoesDaPergunta(p)}.` };
  }
  const alternativa = alternativasDaPergunta(p)[r.indice];
  if (alternativa.letra !== 'a') {
    const hora = formatarHora(p.prazo, { fuso: p.conteudo?.janela.fuso, agora: o.quando });
    const seguir = alternativa.letra === 'b'
      ? (p.ato === 'autorizar' ? `nada muda, e a proposta vence às ${hora} se você não autorizar antes.` : 'nada muda; o arco segue até o fim da janela.')
      : (p.ato === 'autorizar' ? 'nada foi autorizado. Diga o que mudar, e uma proposta nova sai com outra pergunta.'
        : 'nada foi revogado. Diga o que mudar, e uma emenda é proposta.');
    return { tipo: 'sem-efeito', letra: alternativa.letra, mensagem: `${p.codigo} → ${alternativa.letra}) ${alternativa.texto}: ${seguir}` };
  }
  const info: InfoDaRespostaCurta = { repetida: false, mesmaProva: false };
  const prova = o.provar({ codigo: p.codigo, letra: 'a', ...(o.numero ? { numero: o.numero } : {}) });
  try {
    const estado = p.ato === 'autorizar'
      ? autorizarPelaResposta(raiz, p.arco, p.codigo, prova, o.quando, info)
      : revogarPelaResposta(raiz, p.arco, p.codigo, prova, o.quando, info);
    const ok = marca(o.canal, 'ok');
    const fim = estado.conteudo ? formatarHora(estado.conteudo.janela.fim, { fuso: estado.conteudo.janela.fuso, agora: o.quando }) : '';
    const mensagem = p.ato === 'autorizar'
      ? (info.repetida ? `${p.codigo}: o arco ${p.arco} já estava autorizado; nada muda.`
        : `${ok}${p.codigo} → a) ${alternativa.texto}: o arco ${p.arco} está autorizado (${estado.situacao}), até ${fim}.`)
      : (info.repetida ? `${p.codigo}: o arco ${p.arco} já estava revogado; nada muda.`
        : `${ok}${p.codigo} → a) ${alternativa.texto}: o arco ${p.arco} está revogado; nenhum efeito novo passa.`);
    return { tipo: 'registrada', ato: p.ato, letra: 'a', repetida: info.repetida, mesmaProva: info.mesmaProva, mensagem };
  } catch (e) {
    if (e instanceof RecusaDoArco) return { tipo: 'recusada', motivo: e.motivo, mensagem: textoDaRecusa(raiz, p, e, o) };
    throw e;
  }
}
