/**
 * I-41 (D16), CAMADA 1: o resumo recorrente. UMA mensagem, nunca uma por item.
 *
 * Em 20/09 as 16:00 o cron religado disparou e a entrega mandou 75 mensagens em minutos no
 * Telegram do dono, uma por item. A frase dele foi "de uma forma que humanos simplesmente nao
 * compreendem". A causa nao era volume de perguntas: era `varrerPulse` mandar uma mensagem por
 * item novo. A camada 1 troca isso por um resumo: quantos pendentes, quantos urgentes, quantos
 * travando alguma coisa (e quais), quantos sem volta, e uma pergunta no fim.
 *
 * Quem monta a mensagem e ESTE modulo, no nucleo. Os quatro hosts homologados transportam texto
 * pronto. Se um deles precisasse decidir como escrever um numero, a decisao estaria no arquivo
 * errado, e o dono veria uma coisa no Claude Code e outra no Telegram.
 *
 * O texto para humano nunca sai em JSON. `resumirHitl` devolve dados; `textoDoResumo` devolve a
 * mensagem do canal. Quem entrega chama a segunda.
 */
import { formatarDataHoraRotulada, formatarHora } from './horario';
import { DecisaoParaODono, FaseAcimaDoLimiar, LIMIAR_DE_DECISOES_POR_FASE } from './decisao-autonoma';
import {
  ContagemDeClassificacao, contarClassificacoes, ItemClassificavel, JANELA_PADRAO_MIN, OpcoesDeClassificacao, quemDecide,
} from './hitl-classificacao';

export const CONTRATO_RESUMO = 'ork.hitl-resumo/v1' as const;

/** A pergunta final, palavra por palavra como o dono a escreveu. */
export const PERGUNTA_DO_RESUMO = 'Posso te mandar as perguntas agora?';

/**
 * Quantos nomes curtos de thread cabem no texto antes do "e mais N".
 *
 * Nomear dezoito threads numa mensagem de Telegram devolve o problema pelo outro lado: a
 * mensagem vira uma lista longa de novo. Cinco nomes cabem em duas linhas e o resto vira
 * contagem; o comando que mostra todas fica na ultima linha.
 */
export const TETO_DE_THREADS_NOMEADAS = 5;

/** Os dois jeitos de escrever o mesmo resumo. Lista fechada: host novo nao inventa o seu. */
export type CanalDoResumo = 'telegram' | 'terminal';

/**
 * I-51 (RM-047): uma outra maquina da fabrica, como o resumo a mostra. A pergunta dela nao se
 * responde por este canal: a thread vive la, e e la que o dono responde.
 */
export interface ResumoDeMaquina {
  maquina: string;
  publicadoEm: string;
  /** Threads ativas (nao fechadas e ainda nao entregues na base). */
  ativas: number;
  esperando: { thread: string; fase: string; pergunta: string | null; desdeEm: string | null }[];
}

/**
 * RM-037 (fatia 4): o trabalho parado no condutor depois da entrega, como o resumo o mostra. Nao e
 * pergunta ao dono e nao entra em "Esperando voce": e o proximo passo de quem conduz, com o desde.
 */
export interface LinhaDoCondutor { thread: string; caso: string; desdeEm: string; proximoPasso: string }

export interface ResumoHitl extends ContagemDeClassificacao {
  contrato: typeof CONTRATO_RESUMO;
  consultadoEm: string;
  /** Minutos ate o proximo resumo, que e o que da sentido a palavra "urgente". */
  janelaMin: number;
  /**
   * I-41 (GO-FIX 1, B3): quantas perguntas vao DE FATO sair se o dono disser sim. Sao os gates
   * que ainda esperam por ele, conferidos pelo nucleo sem escrever nada. "Esperando voce" conta
   * itens; esta linha conta perguntas, e as duas nao sao a mesma coisa: 49 itens de hoje tinham
   * 3 perguntas. Contar como pergunta o que nunca vai sair era o defeito de B3.
   */
  prontas: number;
  /**
   * Das prontas, quantas ja estavam no resumo anterior. "Nao" e silencio nao perdem item: a
   * pergunta continua guardada e o proximo resumo a cita, que e esta contagem.
   */
  acumuladas: number;
  /** Pedidos que existem e nao viram pergunta por defeito de quem escreveu: conserto nosso. */
  consertos: number;
  /** A pergunta final, so quando ha o que mandar. Pedir licenca para mandar zero e mentira. */
  pergunta: typeof PERGUNTA_DO_RESUMO | null;
  /**
   * I-41 (GO-FIX 1, B4): as decisoes tomadas sem perguntar desde o ultimo resumo. Chegam como fato
   * consumado, com o que foi decidido, o porque, como mudar e o custo de reverter agora e depois:
   * nada nelas pede acao, e sem elas o dono nao teria como ajustar o que a fabrica decidiu.
   */
  decisoes: DecisaoParaODono[];
  /** Fases que passaram do limiar de revisao: e aqui que "obvia" merece um segundo olhar. */
  acimaDoLimiar: FaseAcimaDoLimiar[];
  /** I-51 (RM-047): as outras maquinas da fabrica, quando ela e compartilhada e alguma publicou. */
  outrasMaquinas?: ResumoDeMaquina[];
  /**
   * RM-048 (item 6, D6): o que e impedimento tecnico, e por isso do orquestrador. Fica FORA de
   * "Esperando voce" e das contagens do dono, e aparece numa linha propria, "Conosco".
   */
  tecnicos: number;
  threadsTecnicas: string[];
  /** RM-037 (fatia 4): uma linha por thread parada no condutor, fora das contagens do dono. */
  paradosNoCondutor?: LinhaDoCondutor[];
}

export interface OpcoesDeResumo {
  quando: string;
  janelaMin?: number;
  prontas?: number;
  acumuladas?: number;
  consertos?: number;
  /** O ato que o gate de cada item autoriza, quando o pedido ainda vai ser aberto (A1). */
  atoDoItem?: OpcoesDeClassificacao['atoDoItem'];
  decisoes?: readonly DecisaoParaODono[];
  acimaDoLimiar?: readonly FaseAcimaDoLimiar[];
  outrasMaquinas?: readonly ResumoDeMaquina[];
  paradosNoCondutor?: readonly LinhaDoCondutor[];
}

export function resumirHitl(itens: readonly ItemClassificavel[], opcoes: OpcoesDeResumo): ResumoHitl {
  const janelaMin = opcoes.janelaMin ?? JANELA_PADRAO_MIN;
  // RM-048 (D6): o que e do dono e contado para ele; o que e tecnico e dito a parte.
  const doDono = itens.filter(i => quemDecide(i.motivo) === 'dono');
  const tecnicos = itens.filter(i => quemDecide(i.motivo) === 'orquestrador');
  const contagem = contarClassificacoes(doDono, { quando: opcoes.quando, janelaMin, atoDoItem: opcoes.atoDoItem });
  const prontas = opcoes.prontas ?? 0;
  return {
    contrato: CONTRATO_RESUMO, consultadoEm: opcoes.quando, janelaMin, ...contagem,
    prontas, acumuladas: Math.min(opcoes.acumuladas ?? 0, prontas), consertos: opcoes.consertos ?? 0,
    pergunta: prontas > 0 ? PERGUNTA_DO_RESUMO : null,
    decisoes: [...(opcoes.decisoes ?? [])], acimaDoLimiar: [...(opcoes.acimaDoLimiar ?? [])],
    ...(opcoes.outrasMaquinas?.length ? { outrasMaquinas: opcoes.outrasMaquinas.map(m => ({ ...m, esperando: [...m.esperando] })) } : {}),
    tecnicos: tecnicos.length,
    threadsTecnicas: [...new Set(tecnicos.map(i => i.thread).filter((t): t is string => !!t))].sort(),
    ...(opcoes.paradosNoCondutor?.length ? { paradosNoCondutor: opcoes.paradosNoCondutor.map(p => ({ thread: p.thread, caso: p.caso,
      desdeEm: p.desdeEm, proximoPasso: p.proximoPasso })) } : {}),
  };
}

/** Quantas linhas do condutor o resumo mostra antes de contar o resto. */
export const TETO_DE_PARADOS_NO_CONDUTOR = 5;

/**
 * RM-037 (fatia 4): "<thread> parado no condutor desde HH:MM: <proximo passo>", a mesma frase no pulse,
 * no resumo dos dois canais e no status do roadmap. O horario sai no fuso do dono.
 */
export function linhaDoParadoNoCondutor(p: Pick<LinhaDoCondutor, 'thread' | 'desdeEm' | 'proximoPasso'>,
  opcoes: { agora: string; fuso?: string }): string {
  const { desdeEm: desde } = p;
  return `${p.thread} parado no condutor desde ${formatarHora(desde, opcoes)}: ${p.proximoPasso}`;
}

/** As linhas do condutor no resumo, uma por thread, com o resto contado. */
export function linhasDoCondutor(r: ResumoHitl, marcador: string, recuo: string): string[] {
  const parados = r.paradosNoCondutor ?? [];
  const mostradas = parados.slice(0, TETO_DE_PARADOS_NO_CONDUTOR), sobra = parados.length - mostradas.length;
  return [...mostradas.map(p => `${marcador}${linhaDoParadoNoCondutor(p, { agora: r.consultadoEm })}`),
    ...(sobra > 0 ? [`${recuo}e mais ${sobra}: ork pulse`] : [])];
}

/** RM-048 (D6): a linha do que e tecnico, igual nos dois canais. Nao pede nada ao dono. */
export function linhaDosTecnicos(r: ResumoHitl): string {
  const nomes = r.threadsTecnicas.length ? ` (${nomearThreads(r.threadsTecnicas)})` : '';
  return `Conosco, impedimento técnico: ${r.tecnicos}${nomes}. Não precisa de você.`;
}

/** Quantas threads de outra maquina o resumo nomeia antes de contar o resto. */
export const TETO_DE_ESPERAS_POR_MAQUINA = 3;

/**
 * I-51 (RM-047): as linhas das outras maquinas, as mesmas nos dois canais. Informam; a resposta e
 * na maquina onde a thread vive.
 */
export function linhasDasOutrasMaquinas(r: ResumoHitl, marcador: string, recuo: string): string[] {
  const outras = r.outrasMaquinas ?? [];
  if (!outras.length) return [];
  const linhas = [`${marcador}Em outras máquinas:`];
  for (const m of outras) {
    const esperando = m.esperando.length;
    linhas.push(`${recuo}${m.maquina}: ${m.ativas} ${m.ativas === 1 ? 'thread ativa' : 'threads ativas'}` +
      (esperando ? `; esperando você em ${esperando} (responda lá)` : ''));
    const mostradas = m.esperando.slice(0, TETO_DE_ESPERAS_POR_MAQUINA), sobra = esperando - mostradas.length;
    for (const e of mostradas) linhas.push(`${recuo}  • ${e.thread} ${e.fase}${e.pergunta ? `: ${uma(e.pergunta, 80)}` : ''}`);
    if (sobra > 0) linhas.push(`${recuo}  e mais ${sobra}: ork fabrica`);
  }
  return linhas;
}

/** Quantas decisoes o texto detalha antes de contar o resto: o resumo continua sendo UMA mensagem. */
export const TETO_DE_DECISOES_DETALHADAS = 3;

/** Uma linha cortada no teto de uma linha de Telegram, sem quebra. */
const uma = (texto: string, teto = 160): string => {
  const limpo = String(texto).replace(/\s+/g, ' ').trim();
  return limpo.length > teto ? `${limpo.slice(0, teto - 3)}...` : limpo;
};

/**
 * As linhas das decisoes tomadas sem perguntar, as mesmas nos dois canais (so o recuo e o marcador
 * mudam). Efeito antes de mecanismo: primeiro o que foi decidido, depois o porque e o preco.
 */
export function linhasDasDecisoes(r: ResumoHitl, marcador: string, recuo: string): string[] {
  if (!r.decisoes.length && !r.acimaDoLimiar.length) return [];
  const mostradas = r.decisoes.slice(-TETO_DE_DECISOES_DETALHADAS), sobra = r.decisoes.length - mostradas.length;
  return [
    ...(r.decisoes.length ? [`${marcador}Decidi sem te perguntar: ${r.decisoes.length}`] : []),
    // RM-048 (item 4): duas linhas por decisao, efeito primeiro; o resto do detalhe esta no placar.
    ...mostradas.flatMap(d => [
      `${recuo}• ${d.thread} ${d.fase}: ${uma(d.decidido)}`,
      `${recuo}  porquê: ${uma(d.porque, 120)}. Para mudar: ${uma(d.comoMudar, 120)}; ` +
        `reverter agora: ${uma(d.custoDeReverter.agora, 80)}; depois: ${uma(d.custoDeReverter.depois, 80)}.`,
    ]),
    ...(sobra > 0 ? [`${recuo}e mais ${sobra}: ork decisao placar <thread>`] : []),
    ...r.acimaDoLimiar.map(f => `${recuo}${marcador ? '⚠️ ' : '! '}${f.thread} ${f.fase} já tomou ${f.decididas} decisões sozinha, ` +
      `acima do limiar de ${LIMIAR_DE_DECISOES_POR_FASE}: vale revisar.`),
  ];
}

/** Quando nao ha pergunta, o resumo diz isso em vez de pedir licenca para mandar nada. */
export const SEM_PERGUNTA_NO_RESUMO = 'Nada aqui pede resposta sua por este canal agora.';

/** A linha das perguntas prontas, uma so para os dois canais, pelo mesmo motivo da de baixo. */
export function linhaDasPerguntas(n: number): string {
  return `Perguntas para você: ${n}`;
}

/** A linha dos pedidos que nao viraram pergunta, com a concordancia certa (A5). */
export function linhaDosConsertos(n: number): string {
  return n === 1
    ? '1 pedido não virou pergunta; o conserto é nosso, não seu.'
    : `${n} pedidos não viraram pergunta; o conserto é nosso, não seu.`;
}

/**
 * Os nomes curtos que entram no texto, mais a sobra contada.
 *
 * O nome curto e o `id` da thread, que e o que o dono ja le em `ork board`. O nome longo
 * ("I-41 HITL invertido: decisao tomada, lote e pergunta rara") e titulo, nao endereco.
 */
export function nomearThreads(threads: readonly string[], teto = TETO_DE_THREADS_NOMEADAS): string {
  if (threads.length === 0) return '';
  const mostradas = threads.slice(0, teto), sobra = threads.length - mostradas.length;
  return mostradas.join(', ') + (sobra > 0 ? ` e mais ${sobra}` : '');
}

/**
 * A frase do lote guardado, uma so para os dois canais.
 *
 * Ela existe em um lugar de proposito: se cada canal escrevesse a sua, o dono leria uma coisa no
 * Telegram e outra no terminal, e a paridade que o nucleo existe para garantir se perderia na
 * primeira frase que alguem achou que podia melhorar so de um lado.
 */
export function linhaDoLoteGuardado(n: number): string {
  return n === 1
    ? '1 pergunta continua guardada desde o resumo anterior.'
    : `${n} perguntas continuam guardadas desde o resumo anterior.`;
}

/** Como o humano responde. Letra ou palavra curta; nunca identificador longo para colar. */
function linhaDeResposta(codigo?: string): string[] {
  return codigo
    ? [`Responda com ${codigo} a (sim) ou ${codigo} b (agora não).`]
    : ['Responda: a (sim) ou b (agora não).'];
}

/**
 * RM-048 (item 4): a pergunta sai no ALTO, logo depois do titulo, com a linha de como responder.
 * Em 27/09 ela ficou escondida no fim, depois de tres blocos de decisoes informadas. Sem pergunta,
 * a frase honesta continua sendo a ultima linha.
 */
function abertura(r: ResumoHitl, codigo: string | undefined, marca: string, resposta: string): string[] {
  return r.pergunta ? [`${marca}${r.pergunta}`, ...linhaDeResposta(codigo).map(l => `${resposta}${l}`), ''] : [];
}

function fecho(r: ResumoHitl): string[] {
  return r.pergunta ? [] : ['', SEM_PERGUNTA_NO_RESUMO];
}

function textoTelegram(r: ResumoHitl, codigo: string | undefined): string {
  const quando = formatarDataHoraRotulada(r.consultadoEm, { agora: r.consultadoEm });
  const linhas = [
    `🔔 Orkastery, resumo de ${quando}`,
    ...abertura(r, codigo, '❓ ', '↩️ '),
    ...(r.pergunta ? [] : ['']),
    `Esperando você: ${r.total}`,
    `⏱ Urgentes: ${r.urgentes}`,
    `⛔ Travando o avanço: ${r.bloqueantes}${r.threadsBloqueadas.length ? `, em ${r.threadsBloqueadas.length} threads` : ''}`,
    ...(r.threadsBloqueadas.length ? [`   ${nomearThreads(r.threadsBloqueadas)}`] : []),
    `🔒 Sem volta depois de feito: ${r.criticos}`,
    `❓ ${linhaDasPerguntas(r.prontas)}`,
    ...(r.tecnicos ? [`🔧 ${linhaDosTecnicos(r)}`] : []),
    ...(r.consertos ? [`🔧 ${linhaDosConsertos(r.consertos)}`] : []),
    ...(r.paradosNoCondutor?.length ? ['', ...linhasDoCondutor(r, '🚧 ', '   ')] : []),
    ...(r.acumuladas ? ['', `📥 ${linhaDoLoteGuardado(r.acumuladas)}`] : []),
    ...(r.decisoes.length || r.acimaDoLimiar.length ? ['', ...linhasDasDecisoes(r, '🧭 ', '   ')] : []),
    ...(r.outrasMaquinas?.length ? ['', ...linhasDasOutrasMaquinas(r, '🖥️ ', '   ')] : []),
    ...fecho(r),
  ];
  return linhas.join('\n');
}

function textoTerminal(r: ResumoHitl, codigo: string | undefined): string {
  const quando = formatarDataHoraRotulada(r.consultadoEm, { agora: r.consultadoEm });
  const celulas: [string, number][] = [
    ['esperando você', r.total],
    ['urgentes', r.urgentes],
    ['travando o avanço', r.bloqueantes],
    ['sem volta depois de feito', r.criticos],
    ['perguntas para você', r.prontas],
  ];
  const largura = Math.max(...celulas.map(([nome]) => nome.length));
  const numero = Math.max(7, ...celulas.map(([, n]) => String(n).length));
  const regua = `  ${'-'.repeat(largura)}  ${'-'.repeat(numero)}`;
  const linhas = [
    `Orkastery, resumo de ${quando}`,
    ...abertura(r, codigo, '', ''),
    ...(r.pergunta ? [] : ['']),
    `  ${'o que'.padEnd(largura)}  ${'quantos'.padStart(numero)}`,
    regua,
    ...celulas.map(([nome, n]) => `  ${nome.padEnd(largura)}  ${String(n).padStart(numero)}`),
    ...(r.threadsBloqueadas.length
      ? ['', `  threads travadas (${r.threadsBloqueadas.length}): ${nomearThreads(r.threadsBloqueadas)}`] : []),
    ...(r.tecnicos ? ['', `  ${linhaDosTecnicos(r)}`] : []),
    ...(r.consertos ? ['', `  ${linhaDosConsertos(r.consertos)}`] : []),
    ...(r.paradosNoCondutor?.length ? ['', ...linhasDoCondutor(r, '  ', '  ')] : []),
    ...(r.acumuladas ? ['', `  ${linhaDoLoteGuardado(r.acumuladas)}`] : []),
    ...(r.decisoes.length || r.acimaDoLimiar.length ? ['', ...linhasDasDecisoes(r, '', '  ').map(l => l.startsWith('  ') ? l : `  ${l}`)] : []),
    ...(r.outrasMaquinas?.length ? ['', ...linhasDasOutrasMaquinas(r, '', '  ').map(l => l.startsWith('  ') ? l : `  ${l}`)] : []),
    ...fecho(r),
  ];
  return linhas.join('\n');
}

/**
 * A mensagem do canal. Nunca JSON: o dono le texto, e o Telegram nao formata objeto.
 *
 * `codigo` e o codigo curto do pedido de consentimento, quando ja existe um. Sem ele o texto
 * ainda sai completo e diz como responder; o que nunca aparece e identificador longo para colar.
 */
export function textoDoResumo(resumo: ResumoHitl, opcoes: { canal: CanalDoResumo; codigo?: string }): string {
  if (resumo.contrato !== CONTRATO_RESUMO) throw new Error('resumo HITL: contrato inválido');
  return opcoes.canal === 'telegram' ? textoTelegram(resumo, opcoes.codigo) : textoTerminal(resumo, opcoes.codigo);
}
