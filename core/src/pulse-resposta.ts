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
import { abrirPedidoGate, autenticarResposta, contextoHitlDosEventos, EnderecoAssinado, MOTIVOS_DE_ESCALACAO_HUMANA,
  prepararPedidoGate, renovarPedidoDoGate, responderGate, RespostaHumana } from './hitl-gates';
import { alvoDoPedido, AtoIrreversivel, chaveDaEscolha, ehV2, escolhasDoPedido, estadoDoPedido, motivoDoPedido,
  PedidoHitlQualquer, PerguntaAoDono, prazoDoPedido, validarPedidoHitl } from './hitl-contract';
import { comLockDaConversa } from './monitor-lock';
import { LETRAS, montarLote, perguntaDoPedido, PerguntaDoLote, TETO_DA_MENSAGEM, TETO_DE_PERGUNTAS_POR_LOTE, textoDoLote } from './hitl-lote';
import { desdeDoPedido, entradaDoPedido, montarPedidoCurto, textoDoPedidoCurto } from './hitl-curto';
import { FORMAS_DO_TEXTO_LIVRE, JANELA_DO_TEXTO_LIVRE_MIN, lerLista, lerSolta, lerTrecho, resolverTrecho, TrechoLivre } from './hitl-texto-livre';
import { apresentarHitl } from './hitl-presentation';
import { CONTRATO_PEDIDO_DE_NOTA, lerNota, mensagemJaUsadaEmNota, PedidoDeNota, pedidoDeNotaDoCodigo, reciboDoCanal } from './master-nota';
import { autoriaHumana, parseClasse, registrarMaster } from './master';
import { ratificarBatch } from './master-batch';
import { responderLoteDigest } from './master-digest';
import { ItemClassificavel, quemDecide } from './hitl-classificacao';
import { CADENCIAS, extrairTagDoPulse, gravarCadencia, lerCadencia, TagDoPulse, textoDaCadencia } from './pulse-cadencia';
import { lerLedger } from './ledger';
import { dirThread, lerThread, listarIds } from './thread';
import { EventoLedger } from './types';
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
  // RM-048 (D9): o texto depois do codigo vai a 200 caracteres, para caber o porque da nota.
  consentimento: '^[ \\t]*(?=[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{0,2}[2-9])[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{3}[ \\t]+[^\\r\\n]{1,200}$',
  lote: '^[ \\t]*[0-9]{1,2}[ \\t]*[a-zA-Z](?:[ \\t,;]*[0-9]{1,2}[ \\t]*[a-zA-Z])*[ \\t]*[.!]?[ \\t]*$',
  cadencia: '^[ \\t]*#OrkPulse(?:On(?:-(?:15|30|60)m)?|Off)[ \\t]*[.!]?[ \\t]*$',
  // RM-048 (D2 e D3): as formas do texto livre, geradas do vocabulario fechado. `lista` e
  // interceptada sempre; `livre` so dentro da janela de escuta (`pulse-escuta.json`).
  lista: FORMAS_DO_TEXTO_LIVRE.lista,
  livre: FORMAS_DO_TEXTO_LIVRE.livre,
  // RM-048 (item 8): o teclado do digest semanal ("ratificar <thread> <assinatura> <classe>" e
  // "ratificar-lote <semana> <assinatura>") passa pelo mesmo endereco assinado, e nao pelo agente.
  ratificacao: '^[ \\t]*ratificar(?:-lote)?(?:[ \\t]+[A-Za-z0-9._-]{1,80}){2,3}[ \\t]*$',
});
const RATIFICACAO = new RegExp(GRAMATICA_DO_PULSE.ratificacao, 'i');
const CONSENTIMENTO = new RegExp(GRAMATICA_DO_PULSE.consentimento, 'i');
const LOTE = new RegExp(GRAMATICA_DO_PULSE.lote);
const CADENCIA = new RegExp(GRAMATICA_DO_PULSE.cadencia, 'i');

export type RespostaInterpretada =
  | { forma: 'consentimento'; codigo: string }
  | { forma: 'lote'; escolhas: { numero: number; letra: string }[] }
  | { forma: 'lista'; itens: { numero: number; trecho: TrechoLivre }[] }
  | { forma: 'livre'; trecho: TrechoLivre }
  | { forma: 'cadencia'; tag: TagDoPulse }
  | { forma: 'ratificacao'; texto: string }
  | { forma: 'desconhecida' };

/** O que o dono quis dizer, pela forma. Nada aqui le intencao: ou a forma bate, ou nao. */
export function interpretarRespostaDoPulse(texto: unknown): RespostaInterpretada {
  if (typeof texto !== 'string' || texto.length > 260) return { forma: 'desconhecida' };
  if (LOTE.test(texto)) {
    const escolhas = [...texto.matchAll(/([0-9]{1,2})[ \t]*([a-zA-Z])/g)]
      .map(m => ({ numero: Number(m[1]), letra: m[2].toLowerCase() }));
    return { forma: 'lote', escolhas };
  }
  const lista = lerLista(texto);
  if (lista) return { forma: 'lista', itens: lista };
  if (RATIFICACAO.test(texto)) return { forma: 'ratificacao', texto: texto.trim() };
  if (CONSENTIMENTO.test(texto)) return { forma: 'consentimento', codigo: texto.trim().slice(0, 4).toUpperCase() };
  const tag = CADENCIA.test(texto) ? extrairTagDoPulse(texto) : null;
  if (tag) return { forma: 'cadencia', tag };
  const solta = lerSolta(texto);
  if (solta) return { forma: 'livre', trecho: solta };
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
  /** RM-048 (D1): a recomendada e o que o contrato curto mostra, para o reenvio sair igual. */
  recomendada?: { letra: string; porque: string };
  corpo?: string[];
  ato?: AtoIrreversivel;
  desde?: string | null;
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

/**
 * RM-048 (D4): quanto tempo o NUMERO de uma pergunta nao respondida continua valendo depois de
 * servido. O prazo do pedido e de uma hora; o numero que o dono recebeu nao pode vencer junto:
 * respondido depois, ele vai ao pedido renovado quando a pergunta e a mesma.
 */
export const GUARDA_DA_PERGUNTA_MS = 24 * 60 * 60 * 1000;

/** O maior numero que a gramatica do ingresso le (dois digitos). */
const MAIOR_NUMERO = 99;

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

/**
 * RM-048 (D4): a pergunta que o dono ainda pode responder pelo numero. Sem resposta e dentro da
 * guarda de 24 h desde que saiu: depois do prazo do pedido ela vai ao pedido renovado.
 */
export function perguntaEmAberto(p: PerguntaServida, quando: string): boolean {
  return !p.respondida && (perguntaViva(p, quando) || Date.parse(quando) - Date.parse(p.servidaEm) < GUARDA_DA_PERGUNTA_MS);
}

/** O que sai do registro: vencida sem resposta, ou respondida ha mais de um dia. */
function podar(lote: LoteServido, quando: string): LoteServido {
  const agora = Date.parse(quando);
  const perguntas = lote.perguntas.filter(p => perguntaViva(p, quando) ||
    (!p.respondida && agora - Date.parse(p.servidaEm) < GUARDA_DA_PERGUNTA_MS) ||
    (p.respondida && agora - Date.parse(p.respondida.em) < GUARDA_DO_RESPONDIDO_MS));
  const numeros = new Set(perguntas.map(p => p.numero));
  const porCodigo = Object.fromEntries(Object.entries(lote.porCodigo)
    .map(([codigo, ns]) => [codigo, ns.filter(n => numeros.has(n))] as const).filter(([, ns]) => ns.length));
  return { ...lote, perguntas, porCodigo };
}

/**
 * O primeiro numero do proximo lote. Continua os do registro, para "1a" nunca querer dizer duas
 * perguntas; quando passaria de 99, que a gramatica nao le, volta ao menor bloco livre.
 */
function numeroInicialLivre(servido: LoteServido): number {
  const usados = new Set(servido.perguntas.map(p => p.numero));
  const seguinte = Math.max(0, ...usados) + 1;
  if (seguinte + TETO_DE_PERGUNTAS_POR_LOTE - 1 <= MAIOR_NUMERO) return seguinte;
  for (let n = 1; n + TETO_DE_PERGUNTAS_POR_LOTE - 1 <= MAIOR_NUMERO; n++) {
    if (Array.from({ length: TETO_DE_PERGUNTAS_POR_LOTE }, (_, i) => n + i).every(k => !usados.has(k))) return n;
  }
  return 1;
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
    // RM-048 (D6): escalacao tecnica nao vira pergunta ao dono; o resumo a mostra como "Conosco".
    const escalacoes = doThread.map(i => i.motivo).filter(m => (MOTIVOS_DE_ESCALACAO_HUMANA as readonly string[]).includes(m) &&
      quemDecide(m) === 'dono');
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
    if (!pedido || quemDecide(motivoDoPedido(pedido)) !== 'dono') continue;
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
  const inicio = numeroInicialLivre(servido);
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
  // RM-048 (D1): "desde" sai do ledger, do primeiro pedido com o mesmo codigo; renovar nao zera.
  for (const p of lote.perguntas) {
    const pedido = abertos.find(a => a.pedido.id === p.pedidoId)!.pedido;
    try { p.desde = desdeDoPedido(lerLedger(dirThread(raiz, pedido.thread)), pedido); } catch { p.desde = pedido.criadoEm; }
  }
  const novas: PerguntaServida[] = lote.perguntas.map(p => {
    const pedido = abertos.find(a => a.pedido.id === p.pedidoId)!.pedido;
    const recomendada = p.alternativas.find(a => a.recomendada);
    return {
      numero: p.numero, thread: pedido.thread, fase: pedido.fase, pedidoId: pedido.id,
      pedidoSha256: sha(JSON.stringify(pedido)), letras: p.alternativas.map(a => a.letra),
      alternativas: p.alternativas.map(a => a.texto), consequencias: p.alternativas.map(a => a.consequencia),
      ...(recomendada ? { recomendada: { letra: recomendada.letra, porque: recomendada.recomendada!.porque } } : {}),
      ...(p.corpo ? { corpo: p.corpo } : {}), ...(p.ato ? { ato: p.ato } : {}), desde: p.desde ?? null,
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
  const texto = textoDoLote(lote, { canal: entrada.canal, naoEsperam, quando,
    ...(proximo ? { proximo: { codigo: proximo.codigo, faltam: restantes.length } } : {}) });
  return { texto, numeros, restantes, naoEsperam, ...(proximo ? { proximo } : {}) };
}

/**
 * O lote de um sim ja servido, para quem pede de novo, ou o aviso de que ele ja nao serve. Reenviar
 * pergunta morta (toda respondida ou vencida) seria pedir uma resposta que o gate vai recusar.
 */
function loteDeNovo(raiz: string, servido: LoteServido, numeros: readonly number[], codigo: string, quando: string,
  canal: 'telegram' | 'terminal', aberto?: PedidoDeConsentimento): string {
  const vivas = servido.perguntas.filter(p => numeros.includes(p.numero) && perguntaEmAberto(p, quando)).map(p => p.numero);
  if (vivas.length) return reenviarLote(raiz, servido, vivas, canal, quando);
  return `As perguntas do código ${codigo} já foram respondidas ou venceram. ` +
    (aberto ? `Para as de agora, responda ${aberto.codigo} a.` : 'O próximo resumo traz as que ainda esperarem você.');
}

/** O MESMO lote de novo, para quem repete o sim porque nao viu a mensagem chegar. */
function reenviarLote(raiz: string, servido: LoteServido, numeros: readonly number[], canal: 'telegram' | 'terminal',
  quando: string): string {
  const semRecomendada: number[] = [];
  const perguntas: PerguntaDoLote[] = servido.perguntas.filter(p => numeros.includes(p.numero)).flatMap(p => {
    // Registro gravado antes do RM-048 nao tem a recomendada: ela sai de novo do pedido servido.
    // Sem ela, a pergunta nao e reenviada no contrato curto (que exige uma recomendada), e o
    // nucleo nunca inventa uma: o dono recebe a linha para responder pelo numero.
    const recomendada = p.recomendada ?? recomendadaDoRegistro(raiz, p);
    if (!recomendada) { semRecomendada.push(p.numero); return []; }
    return [{
      numero: p.numero, thread: p.thread, fase: p.fase, pergunta: p.pergunta, pedidoId: p.pedidoId,
      ...(p.corpo ? { corpo: p.corpo } : {}), ...(p.ato ? { ato: p.ato } : {}), desde: p.desde ?? null,
      alternativas: p.letras.map((letra, i) => ({ letra: letra as typeof LETRAS[number], texto: p.alternativas[i],
        consequencia: p.consequencias[i], ...(recomendada?.letra === letra ? { recomendada: { porque: recomendada.porque } } : {}) })),
    }];
  });
  const aviso = semRecomendada.length
    ? [`Pergunta${semRecomendada.length === 1 ? '' : 's'} ${semRecomendada.join(', ')}: responda pelo número e a letra, por exemplo ${semRecomendada[0]}a.`] : [];
  if (!perguntas.length) return aviso.join('\n') || 'Nenhuma pergunta para reenviar agora.';
  return [textoDoLote({ contrato: 'ork.hitl-lote/v1', perguntas, restantes: 0, recusadas: [], abertas: 0 }, { canal, quando }), ...aviso].join('\n');
}

/** A recomendada de uma pergunta servida, relida do pedido exato que saiu com o numero. */
function recomendadaDoRegistro(raiz: string, p: PerguntaServida): { letra: string; porque: string } | undefined {
  try {
    const evento = lerLedger(dirThread(raiz, p.thread))
      .find(e => e.tipo === 'hitl_requested' && (e.pedido as { id?: string } | undefined)?.id === p.pedidoId);
    const pergunta = perguntaDoPedido(evento!.pedido as PedidoHitlQualquer, p.numero);
    if ('motivo' in pergunta) return undefined;
    const r = pergunta.alternativas.find(a => a.recomendada);
    return r ? { letra: r.letra, porque: r.recomendada!.porque } : undefined;
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// RM-048 (D4): a linha que o dono recebeu vale enquanto o gate esperar a mesma pergunta.
// ---------------------------------------------------------------------------

/**
 * O pedido que recebe a resposta: o proprio, quando ainda esta aberto ou ja foi respondido (ai o
 * caminho de sempre diz "repetida" ou "divergente"), ou o renovado, quando venceu sem resposta.
 */
export function pedidoParaResponder(raiz: string, pedido: PedidoHitlQualquer, quando: string):
  { vigente: PedidoHitlQualquer; renovadoDe?: string } {
  const respondido = lerLedger(dirThread(raiz, pedido.thread))
    .some(e => ['human_gate', 'session_answered'].includes(e.tipo) && e.pedidoId === pedido.id);
  if (respondido || estadoDoPedido(pedido, quando) === 'aberto') return { vigente: pedido };
  return { vigente: renovarPedidoDoGate(raiz, pedido, quando), renovadoDe: pedido.id };
}

export interface PedidoComCodigo { thread: string; pedido: PerguntaAoDono; eventos: EventoLedger[] }

/**
 * As threads abertas cujo ultimo pedido de gate com este codigo existe. Codigo que casa com mais
 * de uma thread e devolvido inteiro: quem chama pergunta de volta, nunca escolhe (R3).
 */
export function pedidosComCodigo(raiz: string, codigo: string): PedidoComCodigo[] {
  const alvo = codigo.trim().toUpperCase(), achados: PedidoComCodigo[] = [];
  for (const id of listarIds(raiz)) {
    try {
      if (lerThread(raiz, id).status === 'fechada') continue;
      const eventos = lerLedger(dirThread(raiz, id));
      const ultimo = eventos.filter(e => e.tipo === 'hitl_requested').map(e => e.pedido as PedidoHitlQualquer)
        .filter(q => ehV2(q) && q.classe === 'pergunta' && q.alvo.tipo === 'gate' && String(q.codigo).toUpperCase() === alvo).at(-1);
      if (ultimo) achados.push({ thread: id, pedido: ultimo as PerguntaAoDono, eventos });
    } catch { /* thread ilegivel nao responde por codigo */ }
  }
  return achados;
}

/** O bloco de evidencia a um pedido de distancia (item 4): artefato, claims, riscos e diff. */
export function textoDoDetalhe(raiz: string, pedido: PedidoHitlQualquer, chave: string, canal: 'telegram' | 'terminal'): string {
  const a = apresentarHitl(raiz, pedido.thread, pedido.profundidade);
  const tg = canal === 'telegram';
  return [
    `${tg ? '🔎 ' : ''}Evidências de ${chave} (${pedido.thread} · ${pedido.fase})`,
    ...(a.artefato ? ['', 'Artefato:', a.artefato] : []),
    '', 'Claims:', a.claims, '', 'Riscos:', a.riscos,
    ...(a.diff ? ['', 'Diff:', a.diff] : []),
  ].join('\n').slice(0, TETO_DA_MENSAGEM);
}

/** As alternativas reais em uma linha, para devolver a pergunta sem chutar veredito. */
export function opcoesReais(pedido: PedidoHitlQualquer, prefixo: string): string {
  return escolhasDoPedido(pedido).map(o => `${prefixo}${chaveDaEscolha(pedido, o.numero)} (${o.texto})`).join(', ');
}

/**
 * "DE6H a": a resposta a um gate pelo codigo curto que o dono recebeu, sem numero de lote e sem
 * identificador longo. A prova e a do endereco do pulse, a mesma do lote: o codigo esta DENTRO do
 * texto assinado, e o rastro grava o que o nucleo traduziu. Devolve `undefined` quando nenhum gate
 * aberto usa o codigo, para o chamador dizer isso com as palavras dele.
 */
function responderPorCodigoDeGate(raiz: string, envelope: RespostaHumana, codigo: string,
  opcoes: { quando: string; canal: 'telegram' | 'terminal' }): ResultadoDaRespostaDoPulse | undefined {
  const { quando, canal } = opcoes, tg = canal === 'telegram';
  const achados = pedidosComCodigo(raiz, codigo);
  if (!achados.length) return undefined;
  if (achados.length > 1) {
    return resultado('codigo', `O código ${codigo} está em ${achados.length} threads (${achados.map(a => a.thread).join(', ')}). ` +
      'Responda pelo número da pergunta no lote, por exemplo 1a.', { recusas: [{ motivo: 'codigo.ambiguo' }] });
  }
  const { thread, pedido, eventos } = achados[0];
  const resto = envelope.resposta.trim().slice(codigo.length).trim();
  if (/^(detalhes?|evid[eê]ncias?|\?)[.!]?$/i.test(resto)) return resultado('codigo', textoDoDetalhe(raiz, pedido, codigo, canal));
  const anterior = eventos.find(e => e.tipo === 'human_gate' && e.pedidoId === pedido.id);
  if (anterior && anterior.estado !== 'aguardando') {
    return resultado('codigo', `${tg ? '⚠️ ' : '! '}${codigo} já foi respondido (${String(anterior.estado)}) às ` +
      `${formatarHora(anterior.ts, { agora: quando })}; a resposta não muda.`, { recusas: [{ motivo: 'ja-respondido' }] });
  }
  const trecho = lerTrecho(resto);
  const r = trecho ? resolverTrecho(trecho, escolhasDoPedido(pedido).map(o => o.acao), escolhasDoPedido(pedido).map(o => chaveDaEscolha(pedido, o.numero)))
    : { tipo: 'nenhuma' as const };
  if (r.tipo === 'detalhe') return resultado('codigo', textoDoDetalhe(raiz, pedido, codigo, canal));
  if (r.tipo !== 'escolha') {
    return resultado('codigo', `${r.tipo === 'ambigua' ? `"${resto.slice(0, 40)}" serve para mais de uma alternativa de ${codigo}` : `Não entendi "${resto.slice(0, 40)}" para ${codigo}`}; ` +
      `nada foi registrado. Responda com uma destas: ${opcoesReais(pedido, `${codigo} `)}.`, { recusas: [{ motivo: r.tipo === 'ambigua' ? 'ambigua' : 'nao-entendida' }] });
  }
  // D2: com mais de um pedido aberto na mesma thread, palavra nao registra; letra continua.
  if (trecho!.tipo === 'intencao') {
    const abertos = pedidosAbertosDaThread(raiz, thread, quando);
    if (abertos > 1) {
      return resultado('codigo', `A thread de ${codigo} tem ${abertos} pedidos abertos; resposta por palavra não registra. ` +
        `Responda com a letra: ${opcoesReais(pedido, `${codigo} `)}.`, { recusas: [{ motivo: 'varios-pedidos-na-thread' }] });
    }
  }
  return registrarPorCodigo(raiz, envelope, { thread, pedido, codigo, indice: r.indice, quando, canal,
    rastroExtra: trecho!.tipo === 'intencao' ? { textoLivre: trecho!.palavra } : {} });
}

/** Registra a escolha num pedido achado pelo codigo, renovando-o se venceu. Nao escolhe nada. */
export function registrarPorCodigo(raiz: string, envelope: RespostaHumana, e: {
  thread: string; pedido: PedidoHitlQualquer; codigo: string; indice: number; quando: string; canal: 'telegram' | 'terminal';
  rastroExtra: Record<string, unknown>;
}): ResultadoDaRespostaDoPulse {
  const tg = e.canal === 'telegram';
  let vigente: PedidoHitlQualquer, renovadoDe: string | undefined;
  try {
    const anterior = lerLedger(dirThread(raiz, e.thread)).find(x => x.tipo === 'human_gate' && x.pedidoId === e.pedido.id);
    // Respondido com "continuar esperando", o gate ainda espera: a nova resposta vai ao renovado.
    ({ vigente, renovadoDe } = anterior && anterior.estado === 'aguardando'
      ? { vigente: renovarPedidoDoGate(raiz, e.pedido, e.quando), renovadoDe: e.pedido.id }
      : pedidoParaResponder(raiz, e.pedido, e.quando));
  } catch (erro) {
    const m = (erro as Error).message;
    if (m.includes('a pergunta mudou')) {
      // A pergunta de agora e outra, com outro codigo: ela e aberta e mostrada, nunca respondida.
      try {
        const agora = abrirPedidoGate(raiz, e.thread, motivoDoPedido(e.pedido), e.quando);
        const novo = (agora as { codigo?: unknown }).codigo;
        const texto = typeof novo === 'string' ? textoDoPedidoCurto(montarPedidoCurto(entradaDoPedido(agora),
          { quando: e.quando, responder: { tipo: 'codigo', codigo: novo } }), e.canal) : '';
        return resultado('codigo', [`${tg ? '⚠️ ' : '! '}A pergunta de ${e.codigo} mudou desde que saiu; nada foi registrado. A de agora:`, '', texto].join('\n'),
          { recusas: [{ motivo: 'pergunta-mudou' }] });
      } catch { /* cai na frase de baixo */ }
    }
    return resultado('codigo', `${tg ? '⚠️ ' : '! '}${e.codigo} já não espera você: a fase mudou desde que a pergunta saiu. Nada foi registrado.`,
      { recusas: [{ motivo: 'pedido-antigo' }] });
  }
  const chave = chaveDaEscolha(vigente, e.indice + 1);
  const derivada: RespostaHumana = { ...envelope, resposta: chave };
  const assinado: EnderecoAssinado = { alvo: ALVO_DO_PULSE, endereco: ENDERECO_DA_RESPOSTA, envelope,
    rastro: { contrato: CONTRATO_RESPOSTA_DO_PULSE, codigo: e.codigo, letra: chave, respostaDoDonoSha256: sha(envelope.resposta),
      ...(renovadoDe ? { renovadoDe } : {}), ...e.rastroExtra } };
  try {
    const r = responderGate(raiz, e.thread, vigente.id, derivada, e.quando, assinado);
    const o = escolhasDoPedido(vigente)[e.indice];
    const consequencia = ehV2(vigente) && vigente.classe === 'pergunta' ? vigente.alternativas[e.indice]?.consequencia : undefined;
    return resultado('codigo', `${tg ? '✅ ' : ''}${e.codigo} → ${chave}) ${o.texto}${consequencia ? `: ${consequencia}` : ''}.`,
      { registradas: [{ numero: 0, thread: e.thread, letra: chave, estado: r.estado, repetida: r.repetida }], repetida: r.repetida });
  } catch (erro) {
    const m = (erro as Error).message;
    const motivo = m.includes('ocupado') ? `a thread de ${e.codigo} estava ocupada; mande de novo em um minuto.`
      : m.includes('proveniência') || m.includes('não autenticada') ? `não consegui provar a origem da resposta a tempo; mande ${e.codigo} ${chave} de novo.`
      : m.includes('já respondido') ? `${e.codigo} já tinha resposta registrada; a resposta não muda.`
      : m.includes('pedido antigo') ? `${e.codigo} já não espera você: a fase mudou desde que a pergunta saiu. Nada foi registrado.`
      : `não consegui registrar ${e.codigo}: ${m.slice(0, 120)}`;
    return resultado('codigo', `${tg ? '⚠️ ' : '! '}${motivo}`, { recusas: [{ motivo }] });
  }
}

// ---------------------------------------------------------------------------
// RM-048 (item 2): o texto livre, quando e inequivoco.
// ---------------------------------------------------------------------------

/**
 * Quantos pedidos (gate ou sessao) estao abertos agora nesta thread: sem resposta, dentro do
 * prazo e no contexto corrente. D2: com mais de um, palavra nao registra.
 */
export function pedidosAbertosDaThread(raiz: string, thread: string, quando: string): number {
  const t = lerThread(raiz, thread), eventos = lerLedger(dirThread(raiz, thread));
  const contexto = contextoHitlDosEventos(t, eventos);
  const respondidos = new Set(eventos.filter(e => ['human_gate', 'session_answered'].includes(e.tipo)).map(e => String(e.pedidoId)));
  const abertos = new Set<string>();
  for (const e of eventos) {
    if (e.tipo !== 'hitl_requested' || e.contexto !== contexto) continue;
    const q = e.pedido as PedidoHitlQualquer;
    try {
      if (!alvoDoPedido(q) || respondidos.has(q.id) || estadoDoPedido(q, quando) !== 'aberto') continue;
      abertos.add(q.id);
    } catch { /* pedido invalido nao conta */ }
  }
  return abertos.size;
}

/** O pedido exato que saiu com o numero, relido do ledger. */
function pedidoDaServida(raiz: string, p: PerguntaServida): PedidoHitlQualquer | undefined {
  try {
    const evento = lerLedger(dirThread(raiz, p.thread))
      .find(e => e.tipo === 'hitl_requested' && (e.pedido as { id?: string } | undefined)?.id === p.pedidoId);
    validarPedidoHitl(evento?.pedido);
    return evento!.pedido as PedidoHitlQualquer;
  } catch { return undefined; }
}

/**
 * Traduz uma palavra numa letra para a pergunta servida, ou devolve por que nao da. Nunca escolhe
 * pelo dono: ambigua, fora do vocabulario ou com mais de um pedido aberto na thread volta como
 * pergunta, com as letras reais.
 */
function letraDaPalavra(raiz: string, p: PerguntaServida, trecho: TrechoLivre, quando: string):
  { letra: string; palavra?: string } | { detalhe: PedidoHitlQualquer } | { recusa: string } {
  const pedido = pedidoDaServida(raiz, p);
  if (!pedido) return { recusa: `não consegui ler a pergunta ${p.numero}; responda com o número e a letra.` };
  const acoes = escolhasDoPedido(pedido).map(o => o.acao);
  const r = resolverTrecho(trecho, acoes, p.letras);
  const reais = p.letras.map((l, i) => `${p.numero}${l} (${p.alternativas[i]})`).join(', ');
  if (r.tipo === 'detalhe') return { detalhe: pedido };
  if (r.tipo === 'ambigua') return { recusa: `para a pergunta ${p.numero}, "${trecho.tipo === 'intencao' ? trecho.palavra : ''}" serve para mais de uma alternativa; mande uma: ${reais}.` };
  if (r.tipo === 'nenhuma') return { recusa: `a pergunta ${p.numero} não tem alternativa para essa resposta; mande uma destas: ${reais}.` };
  if (trecho.tipo === 'intencao') {
    const abertos = pedidosAbertosDaThread(raiz, p.thread, quando);
    if (abertos > 1) return { recusa: `a thread da pergunta ${p.numero} tem ${abertos} pedidos abertos; resposta por palavra não registra. Mande a letra: ${reais}.` };
    return { letra: p.letras[r.indice], palavra: trecho.palavra };
  }
  return { letra: p.letras[r.indice] };
}

/** "1. B, 2. aprovo, 3 detalhes": cada item vira letra, detalhe ou recusa, e as letras seguem o lote. */
function responderALista(raiz: string, envelope: RespostaHumana, itens: { numero: number; trecho: TrechoLivre }[],
  opcoes: { quando: string; canal: 'telegram' | 'terminal'; estadoDir?: string }): ResultadoDaRespostaDoPulse {
  const { quando, canal, estadoDir } = opcoes, tg = canal === 'telegram';
  const servido = lerLoteServido(raiz, estadoDir);
  const escolhas: { numero: number; letra: string; palavra?: string }[] = [], avisos: string[] = [], detalhes: string[] = [];
  for (const { numero, trecho } of itens) {
    const p = servido.perguntas.find(q => q.numero === numero);
    if (trecho.tipo === 'letra' || !p) { escolhas.push({ numero, letra: trecho.tipo === 'letra' ? trecho.letra : '?' }); continue; }
    const r = letraDaPalavra(raiz, p, trecho, quando);
    if ('detalhe' in r) detalhes.push(textoDoDetalhe(raiz, r.detalhe, String(numero), canal));
    else if ('recusa' in r) avisos.push(`${tg ? '⚠️ ' : '! '}${r.recusa}`);
    else escolhas.push({ numero, letra: r.letra, ...(r.palavra ? { palavra: r.palavra } : {}) });
  }
  if (!escolhas.length) {
    return resultado('lote', [...avisos, ...detalhes].join('\n\n') || 'Nada para registrar.',
      { recusas: avisos.map(motivo => ({ motivo })) });
  }
  const r = responderAsPerguntas(raiz, envelope, escolhas, { quando, canal, estadoDir, avisos });
  return detalhes.length ? { ...r, mensagem: [r.mensagem, ...detalhes].join('\n\n').slice(0, TETO_DA_MENSAGEM) } : r;
}

/** Uma pergunta que acabou de sair e ainda espera: a unica a que a palavra solta pode se referir. */
interface PedidoRecente { tipo: 'consentimento'; codigo: string }
interface PerguntaRecente { tipo: 'pergunta'; servida: PerguntaServida }

/** D3: o que a palavra solta pode querer dizer agora. Janela curta, sem resposta ainda. */
export function pedidosRecentes(raiz: string, quando: string, estadoDir?: string): (PedidoRecente | PerguntaRecente)[] {
  const janela = JANELA_DO_TEXTO_LIVRE_MIN * 60000, agora = Date.parse(quando);
  const recentes: (PedidoRecente | PerguntaRecente)[] = [];
  const estado = lerConsentimento(raiz, estadoDir);
  if (estado && !estado.respondido && estado.pedido.candidatos.length && agora - Date.parse(estado.pedido.criadoEm) < janela) {
    recentes.push({ tipo: 'consentimento', codigo: estado.pedido.codigo });
  }
  for (const p of lerLoteServido(raiz, estadoDir).perguntas) {
    if (perguntaEmAberto(p, quando) && agora - Date.parse(p.servidaEm) < janela) recentes.push({ tipo: 'pergunta', servida: p });
  }
  return recentes;
}

/**
 * "aprovo", "sim", "a", "1": a palavra solta. Registra quando ha UMA pergunta recente e ela nao e
 * sem volta; senao devolve a pergunta com as opcoes reais. A prova ja foi conferida por quem chama.
 */
function responderLivre(raiz: string, envelope: RespostaHumana, trecho: TrechoLivre,
  opcoes: { quando: string; canal: 'telegram' | 'terminal'; estadoDir?: string }): ResultadoDaRespostaDoPulse {
  const { quando, canal, estadoDir } = opcoes, tg = canal === 'telegram';
  const recentes = pedidosRecentes(raiz, quando, estadoDir);
  const volta = (mensagem: string, motivo: string) => resultado('nao-entendida', mensagem, { recusas: [{ motivo }] });
  if (!recentes.length) {
    return volta('Não há pergunta recente para responder só com uma palavra; nada foi registrado. ' +
      'Responda com o número e a letra (por exemplo 1a) ou com o código da pergunta (por exemplo DE6H a).', 'sem-pergunta-recente');
  }
  if (recentes.length > 1) {
    const lista = recentes.map(r => r.tipo === 'consentimento' ? `${r.codigo} a (receber as perguntas)`
      : `${r.servida.numero} (${[r.servida.thread, r.servida.fase].filter(Boolean).join(' · ')})`).join('; ');
    return volta(`Há ${recentes.length} perguntas esperando você, e uma palavra só não diz qual; nada foi registrado. ` +
      `Responda pelo número e a letra: ${lista}.`, 'varias-perguntas');
  }
  const [unico] = recentes;
  if (unico.tipo === 'consentimento') {
    // O resumo pergunta sim ou nao: a palavra vira a letra, e o caminho e o do codigo, com a prova de sempre.
    return responderAoResumo(raiz, envelope, unico.codigo, { quando, canal, estadoDir, palavra: trecho });
  }
  const p = unico.servida;
  const pedido = pedidoDaServida(raiz, p);
  if (pedido && ehV2(pedido) && pedido.classe === 'pergunta' && pedido.irreversivel) {
    return volta(`${tg ? '🔒 ' : '! '}A pergunta ${p.numero} é sem volta; palavra solta não registra. Responda com o número e a letra: ` +
      `${p.letras.map((l, i) => `${p.numero}${l} (${p.alternativas[i]})`).join(', ')}.`, 'irreversivel');
  }
  // D2: a resposta solta nao diz a qual pedido se refere; com mais de um aberto na thread, nem
  // letra nem digito soltos registram. Numerados ("1a") e por codigo ("DE6H a") continuam valendo.
  const abertos = pedidosAbertosDaThread(raiz, p.thread, quando);
  if (abertos > 1) {
    return volta(`${tg ? '⚠️ ' : '! '}a thread da pergunta ${p.numero} tem ${abertos} pedidos abertos; resposta solta não registra. ` +
      `Mande o número e a letra: ${p.letras.map((l, i) => `${p.numero}${l} (${p.alternativas[i]})`).join(', ')}.`, 'varios-pedidos-na-thread');
  }
  const r = letraDaPalavra(raiz, p, trecho, quando);
  if ('detalhe' in r) return resultado('lote', textoDoDetalhe(raiz, r.detalhe, String(p.numero), canal));
  if ('recusa' in r) return volta(`${tg ? '⚠️ ' : '! '}${r.recusa}`, 'nao-registrou');
  return responderAsPerguntas(raiz, envelope, [{ numero: p.numero, letra: r.letra, palavra: r.palavra ?? normalizarTrecho(trecho) }],
    { quando, canal, estadoDir });
}

const normalizarTrecho = (t: TrechoLivre): string => t.tipo === 'letra' ? t.letra : t.tipo === 'digito' ? String(t.numero) : t.palavra;

export const CONTRATO_ESCUTA = 'ork.pulse-escuta/v1' as const;

export function arquivoDaEscuta(raiz: string, estadoDir?: string): string {
  return path.join(estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor'), 'pulse-escuta.json');
}

/**
 * D3: a janela da palavra solta, para o adaptador decidir a ROTA de "sim", "ok", "a". Nao e prova:
 * a mensagem interceptada ainda passa pela assinatura do ingresso e por esta mesma regra no nucleo.
 * Janela fechada (ou arquivo ausente), a palavra vai ao assistente, como sempre foi.
 */
export function atualizarEscuta(raiz: string, quando: string, estadoDir?: string): { livreAte: string | null } {
  const janela = JANELA_DO_TEXTO_LIVRE_MIN * 60000;
  const limites: number[] = [];
  const estado = lerConsentimento(raiz, estadoDir);
  if (estado && !estado.respondido && estado.pedido.candidatos.length) limites.push(Date.parse(estado.pedido.criadoEm) + janela);
  for (const p of lerLoteServido(raiz, estadoDir).perguntas) if (perguntaEmAberto(p, quando)) limites.push(Date.parse(p.servidaEm) + janela);
  const ate = limites.filter(l => l > Date.parse(quando)).sort((a, b) => b - a)[0];
  const escuta = { contrato: CONTRATO_ESCUTA, livreAte: ate ? new Date(ate).toISOString() : null, atualizadoEm: quando };
  const arquivo = arquivoDaEscuta(raiz, estadoDir);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(escuta) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
  return { livreAte: escuta.livreAte };
}

// ---------------------------------------------------------------------------
// RM-048 (item 8): a nota do MASTER e a ratificacao, pelo mesmo endereco assinado.
// ---------------------------------------------------------------------------

/**
 * "K7QX 4 entregou o que pedi": a nota vai ao ledger com `por` = o remetente autenticado e com o
 * recibo do canal. Quem chama ja conferiu a prova; aqui so se le o conteudo. Nota humana que ja
 * existe nao e trocada por este caminho; a aceita por omissao e, porque a nota do dono sobrescreve.
 */
function responderNota(raiz: string, envelope: RespostaHumana, p: PedidoDeNota,
  opcoes: { canal: 'telegram' | 'terminal'; estadoDir?: string }): ResultadoDaRespostaDoPulse {
  const tg = opcoes.canal === 'telegram';
  const nota = lerNota(envelope.resposta.trim().slice(p.codigo.length));
  if (!nota) {
    return resultado('nota', `Para dar a nota de ${p.thread}, responda ${p.codigo} <0 a 5> <porquê>, por exemplo: ` +
      `${p.codigo} 4 entregou o que pedi. Nada foi registrado.`, { recusas: [{ motivo: 'nota.formato' }] });
  }
  if (mensagemJaUsadaEmNota(raiz, p.thread, envelope.mensagem)) {
    return resultado('nota', `A nota de ${p.thread} desta mensagem já estava registrada.`, { repetida: true });
  }
  const t = lerThread(raiz, p.thread);
  if (t.score && t.score.regime !== 'omissao' && autoriaHumana(t.score.avaliadoPor)) {
    return resultado('nota', `${tg ? '⚠️ ' : '! '}${p.thread} já tem nota humana ${t.score.valor}/5; a nota não muda por aqui.`,
      { recusas: [{ motivo: 'nota.ja-dada' }] });
  }
  try {
    const prova = reciboDoCanal(raiz, envelope, { notaPedida: { contrato: CONTRATO_PEDIDO_DE_NOTA, pedidoId: p.pedidoId, codigo: p.codigo },
      enderecoAssinado: { alvo: ALVO_DO_PULSE, endereco: ENDERECO_DA_RESPOSTA, contrato: CONTRATO_RESPOSTA_DO_PULSE, codigo: p.codigo,
        respostaDoDonoSha256: sha(envelope.resposta) } }, opcoes.estadoDir);
    registrarMaster(raiz, p.thread, { score: nota.score, justificativa: nota.justificativa, por: envelope.por, refazer: !!t.score, prova });
    return resultado('nota', `${tg ? '🧾 ' : ''}Nota ${nota.score}/5 registrada para ${p.thread}, por ${envelope.por}. ` +
      'O índice derivado do ledger continua ao lado.', { registradas: [{ numero: 0, thread: p.thread, letra: String(nota.score), estado: 'nota', repetida: false }] });
  } catch (e) {
    return resultado('nota', `${tg ? '⚠️ ' : '! '}não consegui registrar a nota de ${p.thread}: ${(e as Error).message.slice(0, 160)}`,
      { recusas: [{ motivo: 'nota.recusada' }] });
  }
}

/** O teclado do digest: a ratificacao da proposta, com o remetente autenticado e o recibo. */
function responderRatificacao(raiz: string, envelope: RespostaHumana, texto: string,
  opcoes: { canal: 'telegram' | 'terminal'; estadoDir?: string }): ResultadoDaRespostaDoPulse {
  const tg = opcoes.canal === 'telegram';
  const partes = texto.split(/\s+/);
  const prova = () => reciboDoCanal(raiz, envelope, { ratificacao: { contrato: CONTRATO_PEDIDO_DE_NOTA, texto },
    enderecoAssinado: { alvo: ALVO_DO_PULSE, endereco: ENDERECO_DA_RESPOSTA, contrato: CONTRATO_RESPOSTA_DO_PULSE,
      respostaDoDonoSha256: sha(envelope.resposta) } }, opcoes.estadoDir);
  try {
    let feitas: { thread: string; score: number }[];
    if (partes[0].toLowerCase() === 'ratificar-lote' && partes.length === 3) {
      feitas = responderLoteDigest(raiz, ['ratificar-lote', partes[1], partes[2]].join(' '), envelope.por, prova())
        .map(r => ({ thread: r.thread.id, score: r.masterLog.score }));
    } else {
      const classe = parseClasse(partes[3]);
      if (partes[0].toLowerCase() !== 'ratificar' || partes.length !== 4 || !classe) {
        return resultado('nota', 'Para ratificar, use a linha do teclado do digest: ratificar <thread> <assinatura> <classe>.',
          { recusas: [{ motivo: 'ratificacao.formato' }] });
      }
      feitas = ratificarBatch(raiz, [{ thread: partes[1], assinatura: partes[2], classe }], envelope.por, prova())
        .map(r => ({ thread: r.thread.id, score: r.masterLog.score }));
    }
    return resultado('nota', `${tg ? '🧾 ' : ''}Ratificado por ${envelope.por}: ${feitas.map(f => `${f.thread} ${f.score}/5`).join(', ')}.`,
      { registradas: feitas.map(f => ({ numero: 0, thread: f.thread, letra: String(f.score), estado: 'nota', repetida: false })) });
  } catch (e) {
    return resultado('nota', `${tg ? '⚠️ ' : '! '}não consegui ratificar: ${(e as Error).message.slice(0, 160)}`,
      { recusas: [{ motivo: 'ratificacao.recusada' }] });
  }
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
  tipo: 'consentimento' | 'lote' | 'cadencia' | 'codigo' | 'nota' | 'nao-entendida';
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
  return comLockDaConversa(estadoDir, () => {
    const r = lido.forma === 'lote' ? responderAsPerguntas(raiz, envelope, lido.escolhas, { quando, canal, estadoDir })
      : lido.forma === 'lista' ? responderALista(raiz, envelope, lido.itens, { quando, canal, estadoDir })
        : lido.forma === 'livre' ? responderLivre(raiz, envelope, lido.trecho, { quando, canal, estadoDir })
          : lido.forma === 'ratificacao' ? responderRatificacao(raiz, envelope, lido.texto, { canal, estadoDir })
            : responderAoResumo(raiz, envelope, lido.codigo, { quando, canal, estadoDir });
    // RM-048 (D3): a janela da palavra solta acompanha o que ainda espera o dono agora.
    try { atualizarEscuta(raiz, quando, estadoDir); } catch { /* dica de rota; a prova nao depende dela */ }
    return r;
  });
}

function responderAoResumo(raiz: string, envelope: RespostaHumana, codigo: string,
  opcoes: { quando: string; canal: 'telegram' | 'terminal'; estadoDir?: string; palavra?: TrechoLivre }): ResultadoDaRespostaDoPulse {
  const { quando, canal, estadoDir } = opcoes;
  const estado = lerConsentimento(raiz, estadoDir);
  if (!estado || estado.pedido.codigo !== codigo) {
    const servido = lerLoteServido(raiz, estadoDir);
    const numeros = servido.porCodigo[codigo];
    // Sim repetido a um codigo que ja serviu lote: devolve o MESMO lote, nunca um novo.
    if (numeros?.length) {
      // O dono pediu de novo, por outra mensagem: ele recebe o mesmo lote, e nao silencio.
      // RM-048 (D5): o resumo mais recente nao vence para o sim; o codigo dele continua valendo.
      const aberto = estado && !estado.respondido && estado.pedido.candidatos.length ? estado.pedido : undefined;
      return resultado('consentimento', loteDeNovo(raiz, servido, numeros, codigo, quando, canal, aberto), { resposta: 'sim', repetida: false });
    }
    // RM-048 (D4): o codigo curto de um gate ("DE6H a") responde ao gate, pelo mesmo endereco assinado.
    const peloGate = responderPorCodigoDeGate(raiz, envelope, codigo, { quando, canal });
    if (peloGate) return peloGate;
    // RM-048 (item 8): o codigo de um pedido de nota do MASTER ("K7QX 4 entregou o que pedi").
    const nota = pedidoDeNotaDoCodigo(raiz, codigo, estadoDir);
    if (nota) return responderNota(raiz, envelope, nota, { canal, estadoDir });
    if (!estado) return resultado('consentimento', `Não reconheço o código ${codigo} agora: nenhum resumo ou pergunta aberta usa ele. ` +
      'Quando houver pergunta para você, o resumo avisa.');
    return resultado('consentimento', `O código ${codigo} não é o do resumo aberto nem de uma pergunta aberta. O resumo aberto usa ` +
      `${estado.pedido.codigo}: responda ${estado.pedido.codigo} a para receber as perguntas.`);
  }
  let r: ReturnType<typeof responderConsentimento>;
  try {
    // RM-048 (D5): o sim ao resumo mais recente vale depois do prazo; o lote reconfere cada gate.
    r = responderConsentimento(raiz, { codigo, envelope, quando, estadoDir, aceitarVencido: true });
  } catch (e) {
    const m = (e as Error).message;
    if (!m.startsWith('consentimento do pulse: ')) throw e;
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
    return resultado('consentimento', loteDeNovo(raiz, lerLoteServido(raiz, estadoDir), r.respondido.numeros, codigo, quando, canal),
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
  if (m.includes('a pergunta mudou')) return `a pergunta ${n} mudou desde que saiu; nada foi registrado, e ela volta no próximo resumo com o texto de agora.`;
  if (m.includes('pedido antigo')) return `a pergunta ${n} já não espera você: a fase mudou desde que ela saiu.`;
  // RM-048 (D4): vencida, a renovacao so acontece se o gate ainda espera; senao, ela e historia.
  if (/pausa humana nesta fase|conclusão da fase|escalação tipada não comprovada/.test(m)) return `a pergunta ${n} já não espera você.`;
  if (m.includes('já respondido')) return `a pergunta ${n} já tinha resposta registrada; a resposta não muda.`;
  if (m.includes('ocupado')) return `a thread da pergunta ${n} estava ocupada; mande ${n}${letra} de novo em um minuto.`;
  if (m.includes('proveniência') || m.includes('não autenticada')) return `não consegui provar a origem da resposta ${n} a tempo; mande ${n}${letra} de novo.`;
  return `não consegui registrar a pergunta ${n}: ${m.slice(0, 120)}`;
}

function responderAsPerguntas(raiz: string, envelope: RespostaHumana, escolhas: { numero: number; letra: string; palavra?: string }[],
  opcoes: { quando: string; canal: 'telegram' | 'terminal'; estadoDir?: string; avisos?: string[] }): ResultadoDaRespostaDoPulse {
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
  for (const { numero, letra, palavra } of escolhas) {
    if (vistos.has(numero)) continue;
    vistos.add(numero);
    const letras = [...porNumero.get(numero)!];
    if (letras.length > 1) {
      const motivo = `você respondeu a pergunta ${numero} duas vezes (${letras.map(l => `${numero}${l}`).join(' e ')}); mande de novo só a que vale.`;
      recusas.push({ numero, motivo }); linhas.push(`${telegram ? '⚠️ ' : '! '}${motivo}`); continue;
    }
    const p = servido.perguntas.find(q => q.numero === numero);
    if (!p) {
      const abertas = servido.perguntas.filter(q => perguntaEmAberto(q, quando)).map(q => q.numero);
      const motivo = `não há pergunta ${numero} ${abertas.length ? `aberta; as abertas são ${abertas.join(', ')}` : 'aberta agora'}.`;
      recusas.push({ numero, motivo }); linhas.push(`${telegram ? '⚠️ ' : '! '}${motivo}`); continue;
    }
    const indice = p.letras.indexOf(letra);
    if (indice < 0) {
      const motivo = `a pergunta ${numero} vai de a até ${p.letras.at(-1)}; "${letra}" não é uma das alternativas.`;
      recusas.push({ numero, motivo }); linhas.push(`${telegram ? '⚠️ ' : '! '}${motivo}`); continue;
    }
    if (!p.respondida && !perguntaEmAberto(p, quando)) {
      const motivo = `a pergunta ${numero} saiu há mais de 24 h; ela volta no próximo resumo se ainda esperar você.`;
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
      // RM-048 (D4): vencido e sem resposta, o numero vai ao pedido renovado, e so quando a
      // pergunta e o contexto sao os mesmos. Respondido, segue o caminho de sempre (repetida).
      const { vigente, renovadoDe } = pedidoParaResponder(raiz, pedido, quando);
      const derivada: RespostaHumana = { ...envelope, resposta: chaveDaEscolha(vigente, indice + 1) };
      const assinado: EnderecoAssinado = { alvo: ALVO_DO_PULSE, endereco: ENDERECO_DA_RESPOSTA, envelope,
        rastro: { contrato: CONTRATO_RESPOSTA_DO_PULSE, numero, letra, respostaDoDonoSha256: sha(envelope.resposta),
          ...(renovadoDe ? { renovadoDe } : {}), ...(palavra ? { textoLivre: palavra } : {}) } };
      const r = responderGate(raiz, p.thread, vigente.id, derivada, quando, assinado);
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
  const pendentes = servido.perguntas.filter(q => perguntaEmAberto(q, quando)).map(q => q.numero);
  const aberto = lerConsentimento(raiz, estadoDir);
  // RM-048 (D5): o codigo do resumo mais recente continua valendo depois do prazo.
  const proximo = aberto && !aberto.respondido && aberto.pedido.candidatos.length ? aberto.pedido : undefined;
  const texto = [
    cabecalho, '', ...(opcoes.avisos ?? []), ...linhas,
    ...(pendentes.length ? ['', `Ainda sem resposta: ${pendentes.join(', ')}.`] : []),
    ...(proximo ? [`Faltam ${proximo.candidatos.length}. Para receber as próximas, responda ${proximo.codigo} a.`] : []),
  ].join('\n');
  return resultado('lote', texto, { registradas, recusas: [...(opcoes.avisos ?? []).map(motivo => ({ motivo })), ...recusas],
    repetida: registradas.length > 0 && recusas.length === 0 && registradas.every(r => r.repetida) });
}
