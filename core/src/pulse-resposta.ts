/**
 * I-41 (GO-FIX 1, B1 e B2): o caminho de volta.
 *
 * Ate aqui o produto mandava um resumo perguntando "Posso te mandar as perguntas agora?" e um lote
 * pedindo "responda com o numero e a letra", e nada no produto sabia receber a resposta. Parecia
 * funcionar, que e pior do que nao funcionar. Este modulo e o receptor das duas coisas que o dono
 * digita no canal em que recebeu o resumo:
 *
 *   "P4EJ a"  responde ao resumo: sim, pode mandar as perguntas (ou "P4EJ b", agora nao);
 *   "1a 2c"   responde as perguntas do lote, uma letra por numero;
 *   "#OrkPulseOn-15m"  troca a cadencia do resumo (I-50, RM-039), sozinha na mensagem.
 *
 * A PROVA NAO MUDA. O ingresso autenticado do Telegram (Hermes ou OpenClaw) assina o texto que o
 * dono digitou com a chave do proprio canal, no endereco do pulse, pelo corpo de sempre, e o
 * nucleo confere com `autenticarResposta` sem uma linha alterada, ANTES de ler o conteudo. Quem
 * traduz "pergunta 1, letra a" no pedido certo e o nucleo, pelo lote que ele mesmo serviu e
 * gravou; cada resposta vira um `human_gate` pelo `responderGate` de sempre, com recibo duravel,
 * uso unico, janela, contexto e memoria. Nao existe um segundo caminho de autenticacao.
 *
 * Quem monta o texto que volta ao dono e o nucleo. O adaptador so transporta.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { formatarHora } from './horario';
import { abrirPedidoGate, autenticarResposta, EnderecoAssinado, MOTIVOS_DE_ESCALACAO_HUMANA,
  prepararPedidoGate, responderGate, RespostaHumana } from './hitl-gates';
import { alvoDoPedido, AtoIrreversivel, chaveDaEscolha, estadoDoPedido, motivoDoPedido,
  PedidoHitlQualquer, prazoDoPedido, validarPedidoHitl } from './hitl-contract';
import { comLockDaConversa } from './monitor-lock';
import { LETRAS, montarLote, PerguntaDoLote, textoDoLote } from './hitl-lote';
import { ItemClassificavel } from './hitl-classificacao';
import { CADENCIAS, extrairTagDoPulse, gravarCadencia, lerCadencia, TagDoPulse, textoDaCadencia } from './pulse-cadencia';
import { lerLedger } from './ledger';
import { dirThread } from './thread';
import { abrirConsentimento, ALVO_DO_PULSE, CandidatoDoLote, ENDERECO_DA_RESPOSTA, lerConsentimento,
  marcarLoteEntregue, PedidoDeConsentimento, PRAZO_PADRAO_MIN, responderConsentimento } from './pulse-consentimento';

export const CONTRATO_RESPOSTA_DO_PULSE = 'ork.pulse-resposta/v1' as const;
export const CONTRATO_LOTE_SERVIDO = 'ork.pulse-lote-servido/v1' as const;

/**
 * As duas formas que o ingresso reconhece, em fonte de expressao regular. As MESMAS strings vivem
 * nos adaptadores do Hermes e do OpenClaw, e um teste do nucleo confere que continuam iguais: se
 * o adaptador reconhecesse uma forma que o nucleo nao entende, a mensagem do dono sumiria.
 *
 * O codigo comeca por letra e tem pelo menos um digito (`gerarCodigo`). Por ter digito, palavra
 * comum de quatro letras nunca tem a forma de resposta ao resumo, e conversa com o assistente
 * continua indo para o assistente. Por comecar com letra, ele nunca e lido como resposta ao lote,
 * que comeca com o numero da pergunta: "22A2 a" seria "22a 2a". As duas formas sao disjuntas pelo
 * primeiro caractere. `consentimento` e lida sem diferenca de caixa; `lote` declara as duas.
 *
 * I-50 (RM-039): a terceira forma e a tag da cadencia, sozinha na mensagem. Ela comeca por `#`,
 * entao tambem e disjunta das outras duas pelo primeiro caractere; e lida sem diferenca de caixa.
 * Tag no meio de uma frase continua sendo conversa com o assistente.
 */
export const GRAMATICA_DO_PULSE = Object.freeze({
  consentimento: '^[ \\t]*(?=[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{0,2}[2-9])[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{3}[ \\t]+[^\\r\\n]{1,40}$',
  lote: '^[ \\t]*[0-9]{1,2}[ \\t]*[a-zA-Z](?:[ \\t,;]*[0-9]{1,2}[ \\t]*[a-zA-Z])*[ \\t]*[.!]?[ \\t]*$',
  cadencia: '^[ \\t]*#OrkPulse(?:On(?:-(?:15|30|60)m)?|Off)[ \\t]*[.!]?[ \\t]*$',
});
const CONSENTIMENTO = new RegExp(GRAMATICA_DO_PULSE.consentimento, 'i');
const LOTE = new RegExp(GRAMATICA_DO_PULSE.lote);
const CADENCIA = new RegExp(GRAMATICA_DO_PULSE.cadencia, 'i');

export type RespostaInterpretada =
  | { forma: 'consentimento'; codigo: string }
  | { forma: 'lote'; escolhas: { numero: number; letra: string }[] }
  | { forma: 'cadencia'; tag: TagDoPulse }
  | { forma: 'desconhecida' };

/** O que o dono quis dizer, pela forma. Nada aqui le intencao: ou a forma bate, ou nao. */
export function interpretarRespostaDoPulse(texto: unknown): RespostaInterpretada {
  if (typeof texto !== 'string' || texto.length > 200) return { forma: 'desconhecida' };
  if (LOTE.test(texto)) {
    const escolhas = [...texto.matchAll(/([0-9]{1,2})[ \t]*([a-zA-Z])/g)]
      .map(m => ({ numero: Number(m[1]), letra: m[2].toLowerCase() }));
    return { forma: 'lote', escolhas };
  }
  if (CONSENTIMENTO.test(texto)) return { forma: 'consentimento', codigo: texto.trim().slice(0, 4).toUpperCase() };
  const tag = CADENCIA.test(texto) ? extrairTagDoPulse(texto) : null;
  if (tag) return { forma: 'cadencia', tag };
  return { forma: 'desconhecida' };
}

// ---------------------------------------------------------------------------
// O lote servido: o que foi mandado ao dono, com o numero que ele vai digitar.
// ---------------------------------------------------------------------------

export interface PerguntaServida {
  numero: number;
  thread: string;
  fase: string | null;
  pedidoId: string;
  /** O pedido exato que saiu com este numero. Pedido trocado debaixo do numero nao recebe resposta. */
  pedidoSha256: string;
  /** As letras que valem para esta pergunta. */
  letras: string[];
  /** O texto de cada alternativa, para a confirmacao dizer ao dono o que ficou registrado. */
  alternativas: string[];
  consequencias: string[];
  pergunta: string;
  prazo: string | null;
  servidaEm: string;
  respondida?: { letra: string; em: string; mensagem: string; estado: string };
}

export interface LoteServido {
  contrato: typeof CONTRATO_LOTE_SERVIDO;
  versao: 1;
  perguntas: PerguntaServida[];
  /** Os codigos de consentimento ja servidos, para repetir o sim devolver o MESMO lote. */
  porCodigo: Record<string, number[]>;
}

/** Quanto tempo uma pergunta respondida continua no registro, para "ja estava registrada". */
const GUARDA_DO_RESPONDIDO_MS = 24 * 60 * 60 * 1000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function arquivoDoLoteServido(raiz: string, estadoDir?: string): string {
  return path.join(estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor'), 'pulse-lote.json');
}

export function lerLoteServido(raiz: string, estadoDir?: string): LoteServido {
  const arquivo = arquivoDoLoteServido(raiz, estadoDir);
  if (!fs.existsSync(arquivo)) return { contrato: CONTRATO_LOTE_SERVIDO, versao: 1, perguntas: [], porCodigo: {} };
  const salvo = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as LoteServido;
  if (salvo.contrato !== CONTRATO_LOTE_SERVIDO || salvo.versao !== 1 || !Array.isArray(salvo.perguntas)) {
    throw new Error('lote servido do pulse: estado inválido; exige inspeção');
  }
  return { ...salvo, porCodigo: salvo.porCodigo ?? {} };
}

function gravarLoteServido(raiz: string, lote: LoteServido, estadoDir?: string): void {
  const arquivo = arquivoDoLoteServido(raiz, estadoDir);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = arquivo + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lote) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
}

/** Pergunta que ainda pode ser respondida: sem resposta e dentro do prazo do pedido. */
export function perguntaViva(p: PerguntaServida, quando: string): boolean {
  return !p.respondida && (p.prazo === null || Date.parse(quando) < Date.parse(p.prazo));
}

/** O que sai do registro: vencida sem resposta, ou respondida ha mais de um dia. */
function podar(lote: LoteServido, quando: string): LoteServido {
  const agora = Date.parse(quando);
  const perguntas = lote.perguntas.filter(p => perguntaViva(p, quando) ||
    (p.respondida && agora - Date.parse(p.respondida.em) < GUARDA_DO_RESPONDIDO_MS));
  const numeros = new Set(perguntas.map(p => p.numero));
  const porCodigo = Object.fromEntries(Object.entries(lote.porCodigo)
    .map(([codigo, ns]) => [codigo, ns.filter(n => numeros.has(n))] as const).filter(([, ns]) => ns.length));
  return { ...lote, perguntas, porCodigo };
}

/** Threads com pergunta servida esperando resposta: elas nao entram de novo no resumo. */
export function threadsComPerguntaViva(raiz: string, quando: string, estadoDir?: string): Set<string> {
  return new Set(lerLoteServido(raiz, estadoDir).perguntas.filter(p => perguntaViva(p, quando)).map(p => p.thread));
}

/** A chave de um gate oferecido: a mesma thread numa fase nova e pergunta nova. */
export const chaveDoGate = (thread: string, fase: string | null): string => `${thread}|${fase ?? ''}`;

/**
 * Os gates que o dono ja recebeu, respondidos ou nao: o de "continuar esperando", o que venceu sem
 * resposta. Eles continuam sendo perguntas e continuam no proximo resumo; o que nao fazem e tocar
 * um resumo sozinhos, porque o dono ja os viu e a resposta dele (ou o silencio) vale.
 */
export function gatesJaServidos(raiz: string, estadoDir?: string): Set<string> {
  return new Set(lerLoteServido(raiz, estadoDir).perguntas.map(p => chaveDoGate(p.thread, p.fase)));
}

// ---------------------------------------------------------------------------
// A fila: quais itens do pulse sao perguntas que vao sair de fato.
// ---------------------------------------------------------------------------

export interface AvaliacaoDaFila {
  /** Os gates que esperam o dono, um por thread, na ordem do pulse. */
  candidatos: CandidatoDoLote[];
  /** Pedidos que existem, esperam e nao viram pergunta por defeito de quem escreveu. */
  consertos: number;
  /** O ato de cada gate candidato, por `thread|fase`, para o resumo contar o que e sem volta. */
  atos: Map<string, AtoIrreversivel>;
}

/**
 * I-41 (GO-FIX 1, B3): o que o resumo pode chamar de pergunta.
 *
 * Um item vira candidato quando o gate da thread dele ainda espera o dono agora, conferido por
 * `prepararPedidoGate`, que nao escreve nada. Pedido velho de thread que ja seguiu em frente e
 * historia e nao conta. Pedido que espera mas nao vira pergunta (formato recusado) conta como
 * conserto nosso, nunca como pergunta. Uma thread com pergunta servida e ainda sem resposta nao
 * entra de novo: o dono ja tem o numero dela.
 */
export function avaliarFila(raiz: string, itens: readonly ItemClassificavel[], quando: string,
  opcoes: { excluir?: ReadonlySet<string> } = {}): AvaliacaoDaFila {
  const porThread = new Map<string, ItemClassificavel[]>();
  for (const item of itens) {
    if (!item.thread || item.classe === 'score_pendente' || opcoes.excluir?.has(item.thread)) continue;
    porThread.set(item.thread, [...(porThread.get(item.thread) ?? []), item]);
  }
  const candidatos: CandidatoDoLote[] = [], atos = new Map<string, AtoIrreversivel>();
  let consertos = 0;
  for (const [thread, doThread] of porThread) {
    const escalacoes = doThread.map(i => i.motivo).filter(m => (MOTIVOS_DE_ESCALACAO_HUMANA as readonly string[]).includes(m));
    let achado: { motivo: string; pedido: PedidoHitlQualquer; aberto: boolean } | undefined;
    for (const motivo of [...new Set([...escalacoes, 'human.pending'])]) {
      try {
        const preparado = prepararPedidoGate(raiz, thread, motivo, quando);
        achado = 'aberto' in preparado ? { motivo, pedido: preparado.aberto, aberto: true } : { motivo, pedido: preparado.novo, aberto: false };
        break;
      } catch { /* este motivo nao abre gate agora; o proximo pode abrir */ }
    }
    if (achado) {
      const lote = montarLote([achado.pedido]);
      if (!lote.perguntas.length) { consertos++; continue; }
      candidatos.push({ thread, fase: achado.pedido.fase, motivo: achado.motivo, ...(achado.aberto ? { pedidoId: achado.pedido.id } : {}) });
      const ato = (achado.pedido as { ato?: AtoIrreversivel }).ato;
      if (ato) atos.set(`${thread}|${achado.pedido.fase}`, ato);
      continue;
    }
    // Sem gate que espere, um pedido aberto ainda e pergunta se for respondivel agora; senao, e
    // conserto quando o formato e o problema, e historia quando o prazo ja passou.
    const pedido = doThread.map(i => i.pedido).find((p): p is PedidoHitlQualquer => !!p);
    if (!pedido) continue;
    let aberto = false;
    try { aberto = estadoDoPedido(pedido, quando) === 'aberto'; } catch { aberto = false; }
    if (!aberto) continue;
    const lote = montarLote([pedido]);
    if (!lote.perguntas.length) { if (lote.recusadas.length) consertos++; continue; }
    candidatos.push({ thread, fase: pedido.fase, motivo: motivoDoPedido(pedido), pedidoId: pedido.id, fonte: 'pedido' });
  }
  return { candidatos, consertos, atos };
}

// ---------------------------------------------------------------------------
// Servir o lote: depois do sim, e so depois dele.
// ---------------------------------------------------------------------------

export interface LoteEntregue {
  texto: string;
  numeros: number[];
  /** Candidatos que nao couberam neste lote e vao no proximo. */
  restantes: CandidatoDoLote[];
  /** Candidatos que ja nao esperavam o dono quando ele disse sim. */
  naoEsperam: number;
  proximo?: PedidoDeConsentimento;
}

/** O pedido de um candidato, reaberto agora: prazo novo, contexto de agora, pergunta de agora. */
function pedidoDoCandidato(raiz: string, c: CandidatoDoLote, quando: string): PedidoHitlQualquer {
  if (c.fonte === 'pedido' && c.pedidoId) {
    const evento = lerLedger(dirThread(raiz, c.thread))
      .find(e => e.tipo === 'hitl_requested' && (e.pedido as { id?: string } | undefined)?.id === c.pedidoId);
    validarPedidoHitl(evento?.pedido);
    const pedido = evento!.pedido as PedidoHitlQualquer;
    if (estadoDoPedido(pedido, quando) !== 'aberto') throw new Error('pedido HITL expirado; nenhuma autorização concedida');
    return pedido;
  }
  // `abrirPedidoGate` devolve o pedido aberto que ja existe, ou abre um novo com prazo de agora.
  return abrirPedidoGate(raiz, c.thread, c.motivo, quando);
}

/**
 * Serve UM lote de ate cinco perguntas para os candidatos do consentimento respondido.
 *
 * O pedido de cada gate e (re)aberto AGORA: o dono disse sim agora, e e agora que o prazo da
 * pergunta comeca. Um gate que deixou de esperar entre o resumo e o sim nao vira pergunta. As
 * perguntas ganham numeros que continuam os do lote anterior enquanto ele ainda pode ser
 * respondido, para "1a" nunca querer dizer duas coisas. O que nao coube vai com um codigo novo.
 */
export function servirLote(raiz: string, entrada: {
  pedido: PedidoDeConsentimento; quando: string; canal: 'telegram' | 'terminal'; estadoDir?: string;
}): LoteEntregue {
  const { quando } = entrada;
  let servido = podar(lerLoteServido(raiz, entrada.estadoDir), quando);
  const vivas = new Set(servido.perguntas.filter(p => perguntaViva(p, quando)).map(p => p.thread));
  const inicio = servido.perguntas.reduce((max, p) => Math.max(max, p.numero), 0) + 1;
  const abertos: { candidato: CandidatoDoLote; pedido: PedidoHitlQualquer }[] = [];
  // Thread ocupada agora (despacho ou outra resposta segurando o lock) nao e thread que deixou de
  // esperar: ela vai para o proximo lote, e nao some do que o dono pediu.
  const ocupadas: CandidatoDoLote[] = [];
  let naoEsperam = 0, i = 0;
  const candidatos = entrada.pedido.candidatos;
  for (; i < candidatos.length && abertos.length < 5; i++) {
    const c = candidatos[i];
    if (vivas.has(c.thread)) continue; // o dono ja tem o numero desta; nao pergunto duas vezes
    try {
      const pedido = pedidoDoCandidato(raiz, c, quando);
      if (!alvoDoPedido(pedido)) { naoEsperam++; continue; }
      abertos.push({ candidato: c, pedido });
    } catch (e) {
      if (/ocupad/i.test((e as Error).message)) ocupadas.push(c); else naoEsperam++;
    }
  }
  const lote = montarLote(abertos.map(a => a.pedido), { numeroInicial: inicio });
  const restantes = [...ocupadas, ...candidatos.slice(i)];
  const novas: PerguntaServida[] = lote.perguntas.map(p => {
    const pedido = abertos.find(a => a.pedido.id === p.pedidoId)!.pedido;
    return {
      numero: p.numero, thread: pedido.thread, fase: pedido.fase, pedidoId: pedido.id,
      pedidoSha256: sha(JSON.stringify(pedido)), letras: p.alternativas.map(a => a.letra),
      alternativas: p.alternativas.map(a => a.texto), consequencias: p.alternativas.map(a => a.consequencia),
      pergunta: p.pergunta, prazo: prazoDoPedido(pedido) ?? null, servidaEm: quando,
    };
  });
  const numeros = novas.map(p => p.numero);
  servido = { ...servido, perguntas: [...servido.perguntas, ...novas],
    porCodigo: { ...servido.porCodigo, [entrada.pedido.codigo]: numeros } };
  gravarLoteServido(raiz, servido, entrada.estadoDir);

  // A4: o que sobrou sai com um codigo novo, na mesma mensagem. Sem isto, servido um lote, o resto
  // ficava parado ate algum item mudar, porque o resumo so sai com novidade.
  const proximo = restantes.length ? abrirConsentimento(raiz, {
    quando, resumoSha256: entrada.pedido.resumoSha256, candidatos: restantes,
    prazoMin: PRAZO_PADRAO_MIN, estadoDir: entrada.estadoDir,
  }) : undefined;
  const texto = textoDoLote(lote, { canal: entrada.canal, naoEsperam,
    ...(proximo ? { proximo: { codigo: proximo.codigo, faltam: restantes.length } } : {}) });
  return { texto, numeros, restantes, naoEsperam, ...(proximo ? { proximo } : {}) };
}

/**
 * O lote de um sim ja servido, para quem pede de novo, ou o aviso de que ele ja nao serve. Reenviar
 * pergunta morta (toda respondida ou vencida) seria pedir uma resposta que o gate vai recusar.
 */
function loteDeNovo(servido: LoteServido, numeros: readonly number[], codigo: string, quando: string,
  canal: 'telegram' | 'terminal', aberto?: PedidoDeConsentimento): string {
  const vivas = servido.perguntas.filter(p => numeros.includes(p.numero) && perguntaViva(p, quando)).map(p => p.numero);
  if (vivas.length) return reenviarLote(servido, vivas, canal);
  return `As perguntas do código ${codigo} já foram respondidas ou venceram. ` +
    (aberto ? `Para as de agora, responda ${aberto.codigo} a.` : 'O próximo resumo traz as que ainda esperarem você.');
}

/** O MESMO lote de novo, para quem repete o sim porque nao viu a mensagem chegar. */
function reenviarLote(servido: LoteServido, numeros: readonly number[], canal: 'telegram' | 'terminal'): string {
  const perguntas: PerguntaDoLote[] = servido.perguntas.filter(p => numeros.includes(p.numero)).map(p => ({
    numero: p.numero, thread: p.thread, fase: p.fase, pergunta: p.pergunta, pedidoId: p.pedidoId,
    alternativas: p.letras.map((letra, i) => ({ letra: letra as typeof LETRAS[number], texto: p.alternativas[i],
      consequencia: p.consequencias[i] })),
  }));
  return textoDoLote({ contrato: 'ork.hitl-lote/v1', perguntas, restantes: 0, recusadas: [], abertas: 0 }, { canal });
}

// ---------------------------------------------------------------------------
// O receptor.
// ---------------------------------------------------------------------------

export interface RegistroDaResposta {
  numero: number;
  thread: string;
  letra: string;
  estado: string;
  repetida: boolean;
}

export interface ResultadoDaRespostaDoPulse {
  contrato: typeof CONTRATO_RESPOSTA_DO_PULSE;
  ok: true;
  tipo: 'consentimento' | 'lote' | 'cadencia' | 'nao-entendida';
  resposta?: 'sim' | 'nao';
  /** I-50: a cadencia gravada, quando a mensagem era a tag. */
  cadencia?: TagDoPulse;
  repetida: boolean;
  registradas: RegistroDaResposta[];
  recusas: { numero?: number; motivo: string }[];
  /** O texto que volta ao dono pelo mesmo canal. Montado aqui; o adaptador so transporta. */
  mensagem: string;
}

const EXEMPLO = 'Responda ao resumo com o código e a letra, por exemplo: P4EJ a. Às perguntas, com o número e a letra, por exemplo: 1a 2c. ' +
  'Para trocar a cadência, mande só a tag: #OrkPulseOn, #OrkPulseOn-15m, -30m, -60m ou #OrkPulseOff.';

function resultado(tipo: ResultadoDaRespostaDoPulse['tipo'], mensagem: string,
  extra: Partial<Omit<ResultadoDaRespostaDoPulse, 'contrato' | 'ok' | 'tipo' | 'mensagem'>> = {}): ResultadoDaRespostaDoPulse {
  return { contrato: CONTRATO_RESPOSTA_DO_PULSE, ok: true, tipo, repetida: false, registradas: [], recusas: [], mensagem, ...extra };
}

/**
 * Recebe o que o dono digitou no canal do resumo.
 *
 * A ordem e a de sempre, e ela e o que impede um agente responder pelo dono: primeiro a
 * proveniencia do envelope (a mesma `autenticarResposta`, a mesma chave, as mesmas allowlists e a
 * mesma janela), depois o conteudo. Envelope sem prova lanca e nao recebe resposta nenhuma; texto
 * do dono que nao da para cumprir recebe uma resposta util, nunca silencio nem erro cru.
 */
export function responderPeloPulse(raiz: string, envelope: RespostaHumana, opcoes: {
  quando?: string; canal?: 'telegram' | 'terminal'; estadoDir?: string;
} = {}): ResultadoDaRespostaDoPulse {
  const quando = opcoes.quando ?? new Date().toISOString();
  const canal = opcoes.canal ?? 'telegram';
  autenticarResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, envelope, envelope.recebidoEm);
  autenticarResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, envelope, quando);

  const lido = interpretarRespostaDoPulse(envelope.resposta);
  if (lido.forma === 'desconhecida') return resultado('nao-entendida', `Não entendi. ${EXEMPLO}`);
  if (lido.forma === 'cadencia') {
    // I-50: preferencia de entrega, nao decisao de gate. Grava quem mandou, pelo remetente autenticado.
    const repetida = lerCadencia(raiz, opcoes.estadoDir).gravada?.tag === lido.tag;
    gravarCadencia(raiz, lido.tag, { por: envelope.por, canal: envelope.canal ?? envelope.origem, em: quando }, opcoes.estadoDir);
    return resultado('cadencia', textoDaCadencia(CADENCIAS[lido.tag], quando), { cadencia: lido.tag, repetida });
  }
  // A conversa do pulse tem dois escritores (a varredura e este receptor): um de cada vez.
  const estadoDir = opcoes.estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor');
  return comLockDaConversa(estadoDir, () => lido.forma === 'lote'
    ? responderAsPerguntas(raiz, envelope, lido.escolhas, { quando, canal, estadoDir })
    : responderAoResumo(raiz, envelope, lido.codigo, { quando, canal, estadoDir }));
}

function responderAoResumo(raiz: string, envelope: RespostaHumana, codigo: string,
  opcoes: { quando: string; canal: 'telegram' | 'terminal'; estadoDir?: string }): ResultadoDaRespostaDoPulse {
  const { quando, canal, estadoDir } = opcoes;
  const estado = lerConsentimento(raiz, estadoDir);
  if (!estado) return resultado('consentimento', 'Não há resumo esperando resposta agora. Quando houver pergunta para você, o resumo avisa.');
  if (estado.pedido.codigo !== codigo) {
    const servido = lerLoteServido(raiz, estadoDir);
    const numeros = servido.porCodigo[codigo];
    // Sim repetido a um codigo que ja serviu lote: devolve o MESMO lote, nunca um novo.
    if (numeros?.length) {
      // O dono pediu de novo, por outra mensagem: ele recebe o mesmo lote, e nao silencio.
      const aberto = !estado.respondido && Date.parse(quando) < Date.parse(estado.pedido.prazo) && estado.pedido.candidatos.length
        ? estado.pedido : undefined;
      return resultado('consentimento', loteDeNovo(servido, numeros, codigo, quando, canal, aberto), { resposta: 'sim', repetida: false });
    }
    return resultado('consentimento', `O código ${codigo} não é o do resumo aberto. O resumo aberto usa ${estado.pedido.codigo}: ` +
      `responda ${estado.pedido.codigo} a para receber as perguntas.`);
  }
  let r: ReturnType<typeof responderConsentimento>;
  try {
    r = responderConsentimento(raiz, { codigo, envelope, quando, estadoDir });
  } catch (e) {
    const m = (e as Error).message;
    if (!m.startsWith('consentimento do pulse: ')) throw e;
    if (m.includes('vencido')) {
      // Vencido nao autoriza, e o dono nao fica sem caminho: o mesmo conjunto ganha codigo novo.
      if (!estado.pedido.candidatos.length) return resultado('consentimento', `Este resumo venceu às ${formatarHora(estado.pedido.prazo, { agora: quando })}.`);
      const novo = abrirConsentimento(raiz, { quando, resumoSha256: estado.pedido.resumoSha256,
        candidatos: estado.pedido.candidatos, prazoMin: PRAZO_PADRAO_MIN, estadoDir });
      return resultado('consentimento', `Este resumo venceu às ${formatarHora(estado.pedido.prazo, { agora: quando })}. ` +
        `Para receber as perguntas agora, responda ${novo.codigo} a.`);
    }
    if (m.includes('divergente')) {
      const antes = estado.respondido!;
      return resultado('consentimento', antes.resposta === 'sim'
        ? `Você já respondeu sim a este resumo às ${formatarHora(antes.respondidoEm, { agora: quando })}, e as perguntas já foram. Responda a elas pelo número e a letra.`
        : `Você já respondeu "agora não" a este resumo às ${formatarHora(antes.respondidoEm, { agora: quando })}. O próximo resumo pergunta de novo.`);
    }
    return resultado('consentimento', `Responda com ${codigo} a (sim) ou ${codigo} b (agora não).`);
  }
  // `repetida` para o canal quer dizer "esta MESMA mensagem ja foi tratada" (entrega repetida do
  // gateway): ai nao se reenvia nada. O dono que manda de novo, por outra mensagem, e respondido.
  const mesmaMensagem = r.repetida && r.respondido.mensagem === envelope.mensagem;
  if (r.resposta === 'nao') {
    const n = r.pedido.candidatos.length;
    return resultado('consentimento', `Combinado, não mando agora. ${n === 1 ? 'A pergunta continua guardada' :
      `As ${n} perguntas continuam guardadas`}, e o próximo resumo lembra ${n === 1 ? 'dela' : 'delas'}.`,
    { resposta: 'nao', repetida: mesmaMensagem });
  }
  if (r.repetida && r.respondido.numeros) {
    return resultado('consentimento', loteDeNovo(lerLoteServido(raiz, estadoDir), r.respondido.numeros, codigo, quando, canal),
      { resposta: 'sim', repetida: mesmaMensagem });
  }
  const entregue = servirLote(raiz, { pedido: r.pedido, quando, canal, estadoDir });
  marcarLoteEntregueSeAindaFor(raiz, quando, estadoDir, r.pedido.id, entregue.numeros);
  return resultado('consentimento', entregue.texto, { resposta: 'sim', repetida: false });
}

/**
 * Marca o sim como servido quando ele ainda e o pedido aberto. Quando sobraram perguntas, o
 * proximo codigo ja substituiu este pedido, e o registro de quais numeros ele serviu fica no lote.
 */
function marcarLoteEntregueSeAindaFor(raiz: string, quando: string, estadoDir: string | undefined, pedidoId: string,
  numeros: readonly number[]): void {
  const estado = lerConsentimento(raiz, estadoDir);
  if (estado?.pedido.id === pedidoId && estado.respondido?.resposta === 'sim' && !estado.respondido.loteEntregueEm) {
    marcarLoteEntregue(raiz, quando, estadoDir, numeros);
  }
}

/** O motivo, em uma linha para o dono, de uma resposta que o gate nao aceitou. */
function motivoParaODono(p: PerguntaServida, letra: string, erro: Error, quando: string): string {
  const m = erro.message, n = p.numero;
  if (m.includes('expirado')) return `a pergunta ${n} venceu às ${formatarHora(p.prazo, { agora: quando })}; o próximo resumo a traz de novo se ela ainda esperar você.`;
  if (m.includes('pedido antigo')) return `a pergunta ${n} já não espera você: a fase mudou desde que ela saiu.`;
  if (m.includes('já respondido')) return `a pergunta ${n} já tinha resposta registrada; a resposta não muda.`;
  if (m.includes('ocupado')) return `a thread da pergunta ${n} estava ocupada; mande ${n}${letra} de novo em um minuto.`;
  if (m.includes('proveniência') || m.includes('não autenticada')) return `não consegui provar a origem da resposta ${n} a tempo; mande ${n}${letra} de novo.`;
  return `não consegui registrar a pergunta ${n}: ${m.slice(0, 120)}`;
}

function responderAsPerguntas(raiz: string, envelope: RespostaHumana, escolhas: { numero: number; letra: string }[],
  opcoes: { quando: string; canal: 'telegram' | 'terminal'; estadoDir?: string }): ResultadoDaRespostaDoPulse {
  const { quando, canal, estadoDir } = opcoes;
  let servido = lerLoteServido(raiz, estadoDir);
  if (!servido.perguntas.length) {
    return resultado('lote', 'Não há pergunta aberta agora. Quando houver, o resumo avisa.');
  }
  const registradas: RegistroDaResposta[] = [], recusas: { numero?: number; motivo: string }[] = [];
  const linhas: string[] = [];
  const telegram = canal === 'telegram';
  // Duas letras para o mesmo numero na mesma mensagem: nao escolho por ele.
  const porNumero = new Map<number, Set<string>>();
  for (const e of escolhas) porNumero.set(e.numero, new Set([...(porNumero.get(e.numero) ?? []), e.letra]));
  const vistos = new Set<number>();
  for (const { numero, letra } of escolhas) {
    if (vistos.has(numero)) continue;
    vistos.add(numero);
    const letras = [...porNumero.get(numero)!];
    if (letras.length > 1) {
      const motivo = `você respondeu a pergunta ${numero} duas vezes (${letras.map(l => `${numero}${l}`).join(' e ')}); mande de novo só a que vale.`;
      recusas.push({ numero, motivo }); linhas.push(`${telegram ? '⚠️ ' : '! '}${motivo}`); continue;
    }
    const p = servido.perguntas.find(q => q.numero === numero);
    if (!p) {
      const abertas = servido.perguntas.filter(q => perguntaViva(q, quando)).map(q => q.numero);
      const motivo = `não há pergunta ${numero} ${abertas.length ? `aberta; as abertas são ${abertas.join(', ')}` : 'aberta agora'}.`;
      recusas.push({ numero, motivo }); linhas.push(`${telegram ? '⚠️ ' : '! '}${motivo}`); continue;
    }
    const indice = p.letras.indexOf(letra);
    if (indice < 0) {
      const motivo = `a pergunta ${numero} vai de a até ${p.letras.at(-1)}; "${letra}" não é uma das alternativas.`;
      recusas.push({ numero, motivo }); linhas.push(`${telegram ? '⚠️ ' : '! '}${motivo}`); continue;
    }
    if (p.respondida) {
      if (p.respondida.letra === letra) {
        // Repetida para o canal so quando e a MESMA mensagem; o dono que manda de novo e respondido.
        registradas.push({ numero, thread: p.thread, letra, estado: p.respondida.estado, repetida: p.respondida.mensagem === envelope.mensagem });
        linhas.push(`${telegram ? '✅ ' : ''}${numero} → ${letra}) ${p.alternativas[indice]}: já estava registrada.`);
      } else {
        const motivo = `a pergunta ${numero} já foi respondida com ${p.respondida.letra} às ${formatarHora(p.respondida.em, { agora: quando })}; a resposta não muda.`;
        recusas.push({ numero, motivo }); linhas.push(`${telegram ? '⚠️ ' : '! '}${motivo}`);
      }
      continue;
    }
    try {
      const evento = lerLedger(dirThread(raiz, p.thread))
        .find(e => e.tipo === 'hitl_requested' && (e.pedido as { id?: string } | undefined)?.id === p.pedidoId);
      validarPedidoHitl(evento?.pedido);
      const pedido = evento!.pedido as PedidoHitlQualquer;
      // O numero aponta para o pedido que saiu, byte a byte. Pedido trocado nao recebe a letra.
      if (sha(JSON.stringify(pedido)) !== p.pedidoSha256) throw new Error('pedido antigo: fase, modo ou sessão mudou');
      const derivada: RespostaHumana = { ...envelope, resposta: chaveDaEscolha(pedido, indice + 1) };
      const assinado: EnderecoAssinado = { alvo: ALVO_DO_PULSE, endereco: ENDERECO_DA_RESPOSTA, envelope,
        rastro: { contrato: CONTRATO_RESPOSTA_DO_PULSE, numero, letra, respostaDoDonoSha256: sha(envelope.resposta) } };
      const r = responderGate(raiz, p.thread, p.pedidoId, derivada, quando, assinado);
      registradas.push({ numero, thread: p.thread, letra, estado: r.estado, repetida: r.repetida });
      linhas.push(`${telegram ? '✅ ' : ''}${numero} → ${letra}) ${p.alternativas[indice]}: ${p.consequencias[indice]}.`);
      servido = { ...servido, perguntas: servido.perguntas.map(q => q.numero === numero
        ? { ...q, respondida: { letra, em: quando, mensagem: envelope.mensagem, estado: r.estado } } : q) };
      gravarLoteServido(raiz, servido, estadoDir);
    } catch (e) {
      const motivo = motivoParaODono(p, letra, e as Error, quando);
      recusas.push({ numero, motivo }); linhas.push(`${telegram ? '⚠️ ' : '! '}${motivo}`);
    }
  }
  const cabecalho = registradas.length
    ? `${telegram ? '📝 ' : ''}Orkastery, ${registradas.length === 1 ? '1 resposta registrada' : `${registradas.length} respostas registradas`}`
    : `${telegram ? '📝 ' : ''}Orkastery, nenhuma resposta registrada`;
  const pendentes = servido.perguntas.filter(q => perguntaViva(q, quando)).map(q => q.numero);
  const aberto = lerConsentimento(raiz, estadoDir);
  const proximo = aberto && !aberto.respondido && aberto.pedido.candidatos.length && Date.parse(quando) < Date.parse(aberto.pedido.prazo)
    ? aberto.pedido : undefined;
  const texto = [
    cabecalho, '', ...linhas,
    ...(pendentes.length ? ['', `Ainda sem resposta: ${pendentes.join(', ')}.`] : []),
    ...(proximo ? [`Faltam ${proximo.candidatos.length}. Para receber as próximas, responda ${proximo.codigo} a.`] : []),
  ].join('\n');
  return resultado('lote', texto, { registradas, recusas,
    repetida: registradas.length > 0 && recusas.length === 0 && registradas.every(r => r.repetida) });
}
