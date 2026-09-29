/**
 * I-41 (D16): o consentimento que separa a camada 1 da camada 2.
 *
 * O resumo termina perguntando "Posso te mandar as perguntas agora?". Essa pergunta e um pedido
 * HITL como qualquer outro, e obedece as mesmas regras: resposta por letra ou palavra curta, sem
 * identificador longo na mao do humano, e proveniencia provada pelo HMAC do ingresso autenticado.
 *
 * O QUE NAO MUDA, e o motivo: `assinaturaDaResposta` e `autenticarResposta` sao chamadas daqui
 * sem uma linha alterada, e o corpo assinado continua o de sempre. E essa assinatura que impede o
 * agente consentir no lugar do dono, e ela nao se negocia.
 *
 * I-41 (GO-FIX 1, B1): O ENDERECO. O dono digita "P4EJ a" no Telegram, e o gateway que recebe essa
 * mensagem nao conhece identificador de pedido nenhum. Por isso o ingresso assina o endereco do
 * pulse (`ALVO_DO_PULSE` na posicao de thread, `ENDERECO_DA_RESPOSTA` na posicao de pedido) junto
 * com o texto exato que o dono digitou. O codigo esta DENTRO do texto assinado, entao um "sim" a um
 * resumo nao vale para outro: o codigo precisa bater com o pedido aberto, e a janela de 60
 * segundos do ingresso fecha a repeticao. Quem traduz o codigo no pedido e o nucleo.
 *
 * O consentimento nao e de uma thread: ele e do projeto, porque o resumo atravessa todas. O alvo e
 * uma constante e nao um nome de thread: ids de thread deste projeto comecam com o abbrev.
 *
 * Silencio nao perde nada. Consentimento vencido nao nega e nao apaga: o proximo resumo abre
 * outro e cita as perguntas guardadas. Os itens vivem no pulse, nao aqui.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { autenticarResposta, RespostaHumana } from './hitl-gates';

export const CONTRATO_CONSENTIMENTO = 'ork.pulse-consent/v1' as const;

/**
 * Crockford base32 sem os quatro ambiguos (I, L, O, U). Com letra na frente e ao menos um digito,
 * quatro caracteres ainda dao mais de 350.000 codigos, e o escopo de unicidade que importa e um: o
 * consentimento aberto agora. Ambiguo fora do alfabeto importa porque o dono digita isto no
 * celular, onde 0 e O sao a mesma coisa.
 */
export const ALFABETO_DO_CODIGO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TAMANHO_DO_CODIGO = 4;
const DIGITOS_DO_CODIGO = '23456789';
const LETRAS_DO_CODIGO = 'ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * I-41 (GO-FIX 1, B1): o endereco do pulse no corpo assinado.
 *
 * O ingresso poe `ALVO_DO_PULSE` na posicao de thread e `ENDERECO_DA_RESPOSTA` na posicao de
 * pedido, e o texto que o dono digitou na posicao de resposta. Nenhum dos dois e nome de thread
 * ou de pedido: um envelope assinado para uma thread de verdade nao serve aqui, e vice-versa.
 */
export const ALVO_DO_PULSE = 'pulse';
export const ENDERECO_DA_RESPOSTA = 'resposta';

/** Uma hora, a mesma janela do resumo pedido em 20/09. Vencido nao nega: so deixa de valer. */
export const PRAZO_PADRAO_MIN = 60;

/**
 * Um gate que espera o dono, guardado no pedido de consentimento para virar pergunta depois do
 * sim. Guardar o gate, e nao a pergunta pronta, e o que faz a pergunta chegar com prazo novo: o
 * pedido e (re)aberto na hora em que o dono diz sim, nao uma hora antes, quando o resumo saiu.
 */
export interface CandidatoDoLote {
  thread: string;
  fase: string | null;
  /** O motivo tipado com que o gate e aberto: `human.pending` ou uma escalacao comprovada. */
  motivo: string;
  /** O pedido aberto que ja existia quando o resumo saiu, quando havia um. */
  pedidoId?: string;
  /**
   * `pedido` quando nao ha gate a reabrir e a pergunta e o proprio pedido aberto: o sim a serve
   * como esta, e ela so sai se ainda estiver aberta. Ausente, o gate e (re)aberto no sim.
   */
  fonte?: 'pedido';
}

export interface PedidoDeConsentimento {
  contrato: typeof CONTRATO_CONSENTIMENTO;
  /** Identificador longo. Fica nos dados; o humano nunca o ve. */
  id: string;
  /** O que o dono digita, junto com a letra. */
  codigo: string;
  criadoEm: string;
  prazo: string;
  /** Quantas perguntas estavam prontas quando este resumo saiu. */
  acumuladas: number;
  /** Qual resumo gerou este pedido: dizer sim a um resumo de ontem nao libera o lote de hoje. */
  resumoSha256: string;
  /** Os gates que viram pergunta depois do sim, na ordem do resumo. */
  candidatos: CandidatoDoLote[];
  /** A assinatura do conjunto de candidatos, para o resumo nao oferecer duas vezes o mesmo. */
  candidatosSha256: string;
}

export type RespostaDoConsentimento = 'sim' | 'nao';

export interface ConsentimentoRespondido {
  resposta: RespostaDoConsentimento;
  respondidoEm: string;
  /** O envelope que respondeu, guardado para o recibo. */
  mensagem: string;
  por: string;
  recibo: string;
  /** Quando o lote consentido foi entregue. Um sim libera UM lote, nao um canal aberto. */
  loteEntregueEm?: string;
  /** Os numeros das perguntas que este sim serviu, para repetir o MESMO lote e nunca outro. */
  numeros?: number[];
}

export interface EstadoDoConsentimento {
  versao: 1;
  pedido: PedidoDeConsentimento;
  respondido?: ConsentimentoRespondido;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function arquivoDoConsentimento(raiz: string, estadoDir?: string): string {
  return path.join(estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor'), 'pulse-consentimento.json');
}

/**
 * Codigo novo, uniforme, diferente dos que estiverem em uso agora.
 *
 * I-41 (GO-FIX 1): todo codigo comeca por LETRA e tem pelo menos um DIGITO. O ingresso do Telegram
 * reconhece a resposta ao resumo pela forma "codigo + resposta". Com digito, palavra comum de
 * quatro letras ("HMMM ok") nunca tem essa forma, e a conversa com o assistente continua indo para
 * o assistente. Com letra na frente, o codigo nunca e lido como resposta ao lote, que comeca pelo
 * numero da pergunta: "22A2 a" seria "22a 2a".
 */
export function gerarCodigo(emUso: readonly string[] = []): string {
  const usados = new Set(emUso.map(c => c.toUpperCase()));
  for (let tentativa = 0; tentativa < 256; tentativa++) {
    let codigo = LETRAS_DO_CODIGO[randomInt(LETRAS_DO_CODIGO.length)];
    for (let i = 1; i < TAMANHO_DO_CODIGO; i++) codigo += ALFABETO_DO_CODIGO[randomInt(ALFABETO_DO_CODIGO.length)];
    if (![...codigo].some(c => DIGITOS_DO_CODIGO.includes(c))) continue;
    if (!usados.has(codigo)) return codigo;
  }
  // 810.000 combinacoes contra um punhado em uso: chegar aqui e defeito, nao azar.
  throw new Error('consentimento do pulse: não foi possível gerar código curto livre');
}

/**
 * O que o dono pode digitar. Letra `a`/`b`, ou palavra curta, com ou sem o codigo na frente,
 * em qualquer caixa. O que ele NAO precisa digitar e identificador longo.
 *
 * Quando o codigo vem escrito, ele precisa bater: um "sim" digitado para o resumo anterior nao
 * consente com o resumo de agora. Quando nao vem, o pedido aberto e um so e a letra basta.
 */
export function interpretarResposta(bruto: unknown, codigo: string): RespostaDoConsentimento | undefined {
  if (typeof bruto !== 'string' || bruto.length > 64) return undefined;
  const limpo = bruto.trim().toLowerCase().replace(/[.,!]+$/, '');
  const prefixo = codigo.toLowerCase();
  const corpo = limpo.startsWith(prefixo) ? limpo.slice(prefixo.length).trim() : limpo;
  if (limpo !== corpo && corpo === '') return undefined; // só o código, sem escolha, não é resposta
  if (['a', 's', 'sim', 'pode', 'manda'].includes(corpo)) return 'sim';
  if (['b', 'n', 'nao', 'não', 'agora nao', 'agora não'].includes(corpo)) return 'nao';
  return undefined;
}

/**
 * A assinatura de um conjunto de candidatos: os mesmos gates, a mesma oferta. O pedido aberto nao
 * entra: ele vence e renasce sem que a pergunta mude, e vencer nao e noticia para o dono.
 */
export function assinaturaDosCandidatos(candidatos: readonly CandidatoDoLote[]): string {
  return sha(JSON.stringify(candidatos.map(c => [c.thread, c.fase, c.motivo, c.fonte ?? 'gate'])));
}

export function lerConsentimento(raiz: string, estadoDir?: string): EstadoDoConsentimento | undefined {
  const arquivo = arquivoDoConsentimento(raiz, estadoDir);
  if (!fs.existsSync(arquivo)) return undefined;
  const salvo = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as EstadoDoConsentimento;
  if (salvo.versao !== 1 || salvo.pedido?.contrato !== CONTRATO_CONSENTIMENTO) {
    throw new Error('consentimento do pulse: estado inválido; exige inspeção');
  }
  // Estado gravado antes do GO-FIX 1 nao guardava candidatos: sem eles, o sim nao tem o que servir.
  if (!Array.isArray(salvo.pedido.candidatos)) {
    salvo.pedido = { ...salvo.pedido, candidatos: [], candidatosSha256: assinaturaDosCandidatos([]) };
  }
  return salvo;
}

function gravar(raiz: string, estado: EstadoDoConsentimento, estadoDir?: string): void {
  const arquivo = arquivoDoConsentimento(raiz, estadoDir);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = arquivo + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(estado) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
}

/** O pedido que ainda vale agora: aberto, dentro do prazo e sem resposta gravada. */
export function consentimentoVigente(
  raiz: string, quando: string, estadoDir?: string,
): PedidoDeConsentimento | undefined {
  const estado = lerConsentimento(raiz, estadoDir);
  if (!estado || estado.respondido) return undefined;
  return Date.parse(quando) < Date.parse(estado.pedido.prazo) ? estado.pedido : undefined;
}

/**
 * Abre o pedido que acompanha um resumo. Um pedido vigente NAO e substituido: trocar o codigo
 * debaixo de quem esta digitando e o defeito que fez a mesma pergunta sair com tres
 * identificadores diferentes entre 16/09 e 20/09.
 */
export function abrirConsentimento(raiz: string, entrada: {
  quando: string; resumoSha256: string; candidatos?: readonly CandidatoDoLote[]; prazoMin?: number; estadoDir?: string;
}): PedidoDeConsentimento {
  const candidatos = [...(entrada.candidatos ?? [])];
  const candidatosSha256 = assinaturaDosCandidatos(candidatos);
  const vigente = consentimentoVigente(raiz, entrada.quando, entrada.estadoDir);
  if (vigente && vigente.resumoSha256 === entrada.resumoSha256 && vigente.candidatosSha256 === candidatosSha256) return vigente;
  const anterior = lerConsentimento(raiz, entrada.estadoDir)?.pedido.codigo;
  const prazoMin = entrada.prazoMin ?? PRAZO_PADRAO_MIN;
  const pedido: PedidoDeConsentimento = {
    contrato: CONTRATO_CONSENTIMENTO, id: randomUUID(),
    // O codigo novo nunca repete o anterior: um "sim" atrasado ao resumo velho nao vale para o novo.
    codigo: gerarCodigo(anterior ? [anterior] : []),
    criadoEm: entrada.quando,
    prazo: new Date(Date.parse(entrada.quando) + prazoMin * 60000).toISOString(),
    acumuladas: candidatos.length, resumoSha256: entrada.resumoSha256, candidatos, candidatosSha256,
  };
  gravar(raiz, { versao: 1, pedido }, entrada.estadoDir);
  return pedido;
}

/**
 * Recebe a resposta do dono pelo codigo curto.
 *
 * A ordem importa e e a mesma do gate: primeiro proveniencia, depois conteudo. Um envelope sem
 * assinatura valida nunca chega a ser interpretado como "sim", e por isso texto malformado de
 * origem nao autenticada nao consegue liberar lote nenhum. O envelope e o que o ingresso assinou
 * para o endereco do pulse, com o texto que o dono digitou ("P4EJ a").
 *
 * Repetir a MESMA resposta devolve o que ja foi decidido, inclusive por outra mensagem: o dono que
 * nao viu o lote chegar manda "P4EJ a" de novo e recebe o mesmo lote, nunca um lote novo. Mudar
 * de ideia sobre o mesmo resumo e recusado com o que ja vale.
 */
export function responderConsentimento(raiz: string, entrada: {
  codigo: string; envelope: RespostaHumana; quando?: string; estadoDir?: string;
  /**
   * RM-048 (D5): o "sim" ao resumo MAIS RECENTE vale depois do prazo. O lote que ele libera
   * reconfere cada gate na hora (`servirLote`), entao o prazo so fazia o dono receber outro
   * codigo. O padrao continua estrito para quem chama sem pedir isto.
   */
  aceitarVencido?: boolean;
}): { resposta: RespostaDoConsentimento; repetida: boolean; pedido: PedidoDeConsentimento; respondido: ConsentimentoRespondido } {
  const quando = entrada.quando ?? new Date().toISOString();
  const estado = lerConsentimento(raiz, entrada.estadoDir);
  if (!estado) throw new Error('consentimento do pulse: não há pedido aberto');
  const { pedido } = estado;
  if (pedido.codigo.toUpperCase() !== String(entrada.codigo).trim().toUpperCase()) {
    throw new Error('consentimento do pulse: código não confere com o pedido aberto');
  }

  // Proveniencia primeiro, pelo caminho de sempre, no endereco do pulse.
  autenticarResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, entrada.envelope, entrada.envelope.recebidoEm);
  autenticarResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, entrada.envelope, quando);

  const resposta = interpretarResposta(entrada.envelope.resposta, pedido.codigo);
  const recibo = sha(entrada.envelope.prova);
  if (estado.respondido) {
    // Uso unico por significado: a mesma resposta do mesmo dono devolve o que ja foi decidido.
    if (resposta !== estado.respondido.resposta || estado.respondido.por !== entrada.envelope.por) {
      throw new Error('consentimento do pulse: já respondido; resposta divergente recusada');
    }
    return { resposta: estado.respondido.resposta, repetida: true, pedido, respondido: estado.respondido };
  }
  if (Date.parse(quando) >= Date.parse(pedido.prazo) && entrada.aceitarVencido !== true) {
    throw new Error('consentimento do pulse: pedido vencido; nenhuma autorização concedida');
  }
  if (!resposta) throw new Error('consentimento do pulse: responda com a (sim) ou b (agora não)');
  const respondido: ConsentimentoRespondido = {
    resposta, respondidoEm: quando, mensagem: entrada.envelope.mensagem, por: entrada.envelope.por, recibo,
  };
  gravar(raiz, { ...estado, respondido }, entrada.estadoDir);
  return { resposta, repetida: false, pedido, respondido };
}

/**
 * Marca o lote consentido como entregue, com os numeros que ele levou. Sem isto, um sim viraria
 * autorizacao permanente e a cada resposta sairia um lote novo, que e a inundacao voltando por
 * outra porta. Com os numeros, repetir o sim devolve o MESMO lote.
 */
export function marcarLoteEntregue(raiz: string, quando: string, estadoDir: string | undefined, numeros: readonly number[]): void {
  const estado = lerConsentimento(raiz, estadoDir);
  if (!estado?.respondido || estado.respondido.resposta !== 'sim') throw new Error('consentimento do pulse: não há sim para servir');
  if (estado.respondido.loteEntregueEm) throw new Error('consentimento do pulse: este sim já serviu um lote');
  gravar(raiz, { ...estado, respondido: { ...estado.respondido, loteEntregueEm: quando, numeros: [...numeros] } }, estadoDir);
}
