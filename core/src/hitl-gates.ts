/** D2: pedidos correlacionados; somente o ingresso autenticado pode atestar resposta. */
import * as fs from 'node:fs';
import { comLockInspecionavel } from './hitl-lock';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AlternativaHitlV2, alvoDoPedido, atoDaPausa, CONTRATO_HITL_V2,
  DecisaoInformada, ehV2, estadoDoPedido, LetraDeAlternativa, motivoDoPedido, PedidoHitl,
  PedidoHitlQualquer, PerguntaAoDono, profundidadeDoPedido, TETOS_HITL_V2, validarPedidoHitl,
  validarRespostaHitl, vereditoDoGate } from './hitl-contract';
import { CONSEQUENCIA_DA_ACAO } from './hitl-lote';
import { ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, gerarCodigo } from './pulse-consentimento';
import { exigirManifesto } from './manifest';
import { dirThread, lerThread, blocoDaThread, pausaNaThread } from './thread';
import { lerLedger, registrar } from './ledger';
import { EventoLedger, Thread } from './types';
import { canalDoEnvelope, chaveDoIngresso, contaDoEnvelope, evidenciaDoIngresso, gravarIngresso, instanteDoIngresso } from './hitl-ingress-receipt';
// FX5: `canalDoEnvelope` e `contaDoEnvelope` moraram aqui ate a conta entrar no corpo
// assinado. As duas conferem ENVELOPE contra REGISTRO e ambiente, que e o assunto de
// `hitl-ingress-receipt`; mante-las aqui obrigaria esse modulo a importar este de volta, e
// o ciclo em tempo de execucao so aparece como `undefined is not a function`. A reexportacao
// preserva a superficie publica que adaptadores e testes ja usam.
export { canalDoEnvelope, contaDoEnvelope } from './hitl-ingress-receipt';
import { consumirAtestadoLocal, hashPedidoLocal } from './hitl-local-atestado';
import type { ResultadoDecisaoLocal } from './hitl-local';
import { gravarEvidenciaLocal } from './hitl-local-receipt';
import { publicarAprovacaoHumana, PublicacaoDeAprovacao } from './memoria-humana';
import { Canal, conferirCanalSelecionado } from './hitl-canais';
import { NativeAnswer, NativeContext, authenticateNative, nativeContextSchema, nativeSignature } from './hitl-native';
import { exigirModoVivo } from './modos';

export interface RespostaHumana {
  resposta: string;
  origem: 'telegram' | 'native';
  native?: NativeContext;
  por: string;
  mensagem: string;
  recebidoEm: string;
  prova: string;
  /** D12: qual dos canais homologados entregou a resposta. Ausente é o envelope v1 legado. */
  canal?: Canal;
  /** FX5: a conta homologada do canal, quando ele tem uma. Só o OpenClaw tem hoje. */
  conta?: string;
}

export type ContratoDeResposta = 'ork.hitl-answer/v1' | 'ork.hitl-answer/v2' | 'ork.hitl-native/v1';

/**
 * D12: o canal entra no corpo assinado, e é isso que o torna recibo em vez de rótulo.
 * Hermes e OpenClaw compartilham transporte, mas usam chaves próprias e identidades
 * distintas; sem o canal dentro do HMAC o recibo ainda perderia essa proveniência. O envelope `v1`
 * continua aceito byte a byte, e um `v1` nunca ganha canal por inferência.
 */
export function contratoDaResposta(r: Pick<RespostaHumana, 'canal'> & { origem?: string }): ContratoDeResposta {
  if (r.origem === 'native') return 'ork.hitl-native/v1';
  return r.canal === undefined ? 'ork.hitl-answer/v1' : 'ork.hitl-answer/v2';
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function contextoHitl(raiz: string, id: string): string {
  return contextoHitlDosEventos(lerThread(raiz, id), lerLedger(dirThread(raiz, id)));
}
/** Mesmo contexto na autorização e na projeção, usando as fontes já observadas. */
export function contextoHitlDosEventos(t: Thread, eventos: readonly EventoLedger[]): string {
  const despacho = eventos.filter(e => e.tipo === 'phase_dispatch').at(-1);
  return sha(JSON.stringify([t.modo, t.faseAtual, t.status, t.base, despacho?.sessionId, despacho?.ts]));
}

/** Leitura para o callback; não abre pedido nem recebe resposta ou identidade humana. */
export function contextoDoPedidoNativo(raiz: string, id: string, pedidoId: string) {
  const events = lerLedger(dirThread(raiz, id));
  const matches = events.filter(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl)?.id === pedidoId);
  if (matches.length !== 1) throw Error('hitl.native.request-unavailable');
  const event = matches[0]; validarPedidoHitl(event.pedido);
  const pedido = event.pedido as PedidoHitl;
  if (pedido.thread !== id || event.contexto !== contextoHitl(raiz, id) || estadoDoPedido(pedido) !== 'aberto')
    throw Error('hitl.native.request-stale');
  return { pedido, contexto: event.contexto, pedidoSha256: hashPedidoLocal(pedido) };
}

/** Serializa respostas concorrentes da mesma thread; lock ocupado recusa sem efeito. */
export function comLockHitl<T>(raiz: string, id: string, executar: () => T): T {
  const dir = dirThread(raiz, id);
  lerThread(raiz, id);
  return comLockInspecionavel(dir, 'thread-dispatch-ou-hitl', executar);
}

/** O corpo não é gravado. A chave pertence somente ao ingresso nativo do gateway. */
export function assinaturaDaResposta(thread: string, pedido: string, resposta: Omit<RespostaHumana, 'prova'>, chave: string): string {
  if (resposta.origem === 'native') return nativeSignature(thread, pedido, resposta as NativeAnswer, chave);
  // FX5: `conta` tem posicao FIXA no corpo v2, e `null` quando o canal nao tem conta. Um
  // campo opcional mudaria a aridade do array conforme o envelope, e dois envelopes
  // diferentes poderiam produzir o mesmo corpo assinado. O v1 segue byte a byte o de antes.
  const corpo = resposta.canal === undefined
    ? ['ork.hitl-answer/v1', thread, pedido, resposta.origem, resposta.por, resposta.mensagem, resposta.recebidoEm, resposta.resposta]
    : ['ork.hitl-answer/v2', thread, pedido, resposta.canal, resposta.conta ?? null,
      resposta.origem, resposta.por, resposta.mensagem, resposta.recebidoEm, resposta.resposta];
  return createHmac('sha256', chave).update(JSON.stringify(corpo)).digest('hex');
}

export function autenticarResposta(thread: string, pedido: string, r: RespostaHumana, quando = new Date().toISOString()): void {
  if (r.origem === 'native') { authenticateNative(thread, pedido, r as NativeAnswer, quando); return; }
  // FX1: o canal decide a chave, e por isso ele e conferido ANTES dela. Um envelope que
  // declara canal fora do registro nunca chega a consultar segredo nenhum.
  const canal = canalDoEnvelope(r);
  contaDoEnvelope(canal, r.conta);
  const chave = chaveDoIngresso(canal);
  const usuarios = (process.env.ORK_HITL_TELEGRAM_USERS ?? '').split(',').map(s => s.trim());
  const chats = (process.env.ORK_HITL_TELEGRAM_CHATS ?? '').split(',').map(s => s.trim());
  const usuario = /^telegram:(\d+)$/.exec(r.por ?? '');
  const mensagem = /^telegram:(-?\d+):([a-zA-Z0-9_-]{1,100})$/.exec(r.mensagem ?? '');
  const idade = Date.parse(quando) - Date.parse(r.recebidoEm);
  if (r.origem !== 'telegram' || !usuario || !mensagem || !usuarios.includes(usuario[1]) || !chats.includes(mensagem[1]) ||
      !Number.isFinite(idade) || idade < 0 || idade > 60000 || typeof r.resposta !== 'string' || r.resposta.length > 4096 ||
      !/^[a-f0-9]{64}$/.test(r.prova ?? '')) throw new Error('resposta humana sem proveniência válida');
  const esperado = assinaturaDaResposta(thread, pedido, r, chave);
  if (!timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(r.prova, 'hex'))) throw new Error('resposta humana não autenticada');
}

/**
 * D2: o criterio de uma decisao informada RESOLVE, ou o pedido nao existe.
 *
 * Duas das tres resolvem de verdade. `manifesto` le a chave pelo caminho pontuado e confere que
 * ela existe e tem valor; `ledger` le o ledger da thread e confere que o evento existe. A
 * terceira, `medicao`, so tem a FORMA conferida, e o buraco esta dito com todas as letras:
 * um comando citado pode nao provar nada, falhar, ou nao ter relacao com a decisao, e o nucleo
 * nao sabe a diferenca na hora de abrir o pedido.
 *
 * Nao se fecha esse buraco executando o comando aqui, e por dois motivos: abrir um pedido HITL
 * viraria executar comando arbitrario, e isto roda sob lock, entao um comando lento travaria a
 * thread inteira. Quem fecha e o CHECK, que percorre os itens `decidido` e EXECUTA os comandos
 * citados. A divisao fica registrada assim: a validacao impede citar NADA; o CHECK impede citar
 * MENTIRA.
 */
export function resolverCriterio(raiz: string, pedido: DecisaoInformada): { resolve: boolean; detalhe: string } {
  const { tipo, referencia } = pedido.criterio;
  if (tipo === 'medicao') {
    return { resolve: true, detalhe: 'comando citado; quem executa e reprova é o CHECK' };
  }
  if (tipo === 'manifesto') {
    let alvo: unknown;
    try { alvo = exigirManifesto(raiz).manifesto as unknown; }
    catch { return { resolve: false, detalhe: 'manifesto do projeto não pôde ser lido' }; }
    for (const parte of referencia.split('.')) {
      if (!alvo || typeof alvo !== 'object' || !(parte in (alvo as Record<string, unknown>))) {
        return { resolve: false, detalhe: `o manifesto não tem a chave ${referencia}` };
      }
      alvo = (alvo as Record<string, unknown>)[parte];
    }
    const vazio = alvo === undefined || alvo === null || alvo === '' ||
      (Array.isArray(alvo) && alvo.length === 0);
    return vazio
      ? { resolve: false, detalhe: `a chave ${referencia} existe mas está vazia` }
      : { resolve: true, detalhe: `chave ${referencia} lida do manifesto` };
  }
  // `ledger`: `<thread>#evento:<n>` (1-based) ou o `eventId` do proprio evento.
  const comIndice = /^([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})#evento:(\d+)$/.exec(referencia);
  const thread = comIndice ? comIndice[1] : pedido.thread;
  let eventos: EventoLedger[];
  try { eventos = lerLedger(dirThread(raiz, thread)); }
  catch { return { resolve: false, detalhe: `a thread ${thread} não tem ledger legível` }; }
  if (comIndice) {
    const n = Number(comIndice[2]);
    return n >= 1 && n <= eventos.length
      ? { resolve: true, detalhe: `evento ${n} de ${thread}` }
      : { resolve: false, detalhe: `${thread} não tem evento ${n}` };
  }
  return eventos.some(e => e.eventId === referencia)
    ? { resolve: true, detalhe: `evento ${referencia} de ${thread}` }
    : { resolve: false, detalhe: `nenhum evento de ${thread} tem esse identificador` };
}

export function registrarPedidoHitl(raiz: string, pedido: PedidoHitlQualquer): PedidoHitlQualquer {
  validarPedidoHitl(pedido);
  // R1, camada 1: um `decidido` cujo critério não resolve não chega a existir.
  if (ehV2(pedido) && pedido.classe === 'decidido') {
    const { resolve, detalhe } = resolverCriterio(raiz, pedido);
    if (!resolve) throw new Error(`decisão informada: critério não resolve (${detalhe})`);
  }
  return comLockHitl(raiz, pedido.thread, () => {
    const t = lerThread(raiz, pedido.thread), dir = dirThread(raiz, t.id);
    if (t.status === 'fechada' || t.faseAtual !== pedido.fase || t.modo !== pedido.modo) throw new Error('pedido não corresponde à thread corrente');
    const eventos = lerLedger(dir), existente = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl)?.id === pedido.id);
    if (existente) {
      if (JSON.stringify(existente.pedido) !== JSON.stringify(pedido)) throw new Error('id de pedido reutilizado com outro conteúdo');
      return existente.pedido as PedidoHitlQualquer;
    }
    registrar(dir, t.id, 'hitl_requested', { fase: pedido.fase, pedido, contexto: contextoHitl(raiz, t.id) });
    return pedido;
  });
}

/**
 * D18: diagnóstico de um `phase_result` `human.pending` que não é conclusão provada. O watcher
 * claude-bg grava `diagnostico`; resultado anterior a ele cai no `provaOrk.fonte` sem prova.
 * Texto limpo de controle e com teto, para caber no pedido HITL.
 */
function diagnosticoSemConclusao(resultado: EventoLedger): string | null {
  const prova = resultado.provaOrk as { ok?: unknown; fonte?: unknown } | undefined;
  const bruto = typeof resultado.diagnostico === 'string' ? resultado.diagnostico
    : prova?.ok === false && typeof prova.fonte === 'string' ? `sem prova do ork: ${prova.fonte}` : null;
  const limpo = bruto === null ? '' : Array.from(bruto.replace(/\p{Cc}/gu, ' ').trim()).slice(0, 600).join('');
  return limpo === '' ? null : limpo;
}

/**
 * As escalacoes tipadas que abrem gate para o dono. Lista fechada, domicilio unico: quem abre o
 * gate e quem pergunta se um gate ainda espera o dono leem a mesma.
 */
export const MOTIVOS_DE_ESCALACAO_HUMANA = ['policy.violation', 'cost.violation', 'retry.max_tentativas',
  'hitl.credencial', 'runtime.unavailable'] as const;

/** Uma pausa do modo cria pedido, nunca human_gate. Escalação exige evento tipado. */
export function abrirPedidoGate(raiz: string, id: string, motivo = 'human.pending', quando = new Date().toISOString()): PedidoHitlQualquer {
  const preparado = prepararPedidoGate(raiz, id, motivo, quando);
  return 'aberto' in preparado ? preparado.aberto : registrarPedidoHitl(raiz, preparado.novo);
}

/**
 * I-41 (GO-FIX 1, B3): o gate que ainda espera o dono, SEM escrever nada.
 *
 * Faz todas as conferencias de `abrirPedidoGate` e devolve o pedido aberto que ja existe, ou o
 * pedido novo que seria registrado. Nao grava, nao toma lock e nao mexe no ledger. E por aqui que
 * o resumo sabe quantas perguntas vao de fato sair: um gate que ainda espera o dono e pergunta; um
 * pedido velho cuja thread ja seguiu em frente e historia, e contar historia como pergunta era o
 * defeito de B3 (o dono via "esperando voce" e, ao consentir, recebia zero perguntas).
 *
 * Lanca, com a mesma mensagem de sempre, quando o gate nao espera ninguem: modo sem pausa nesta
 * fase, conclusao da fase ainda nao registrada, ou escalacao sem evento tipado que a prove.
 */
export function prepararPedidoGate(raiz: string, id: string, motivo = 'human.pending', quando = new Date().toISOString()):
  { aberto: PedidoHitlQualquer } | { novo: PerguntaAoDono } {
  const t = lerThread(raiz, id), bloco = blocoDaThread(t, t.faseAtual);
  const eventos = lerLedger(dirThread(raiz, id));
  let semConclusao: string | null = null;
  let parecerNegativo = '';
  if (motivo === 'human.pending') {
    if (!pausaNaThread(t, t.faseAtual) || bloco.fases.at(-1) !== t.faseAtual) throw new Error('modo não prevê pausa humana nesta fase');
    // I-34 (D7, GO-FIX 1): vale o resultado do despacho corrente da fase, e só a falha de
    // execução não é conclusão (o turno não terminou ou não entregou o artefato; cada motivo tem
    // retry ou escalação própria). Parecer negativo (`claims.failed`, `verify.*`, `ci.failed`)
    // é fase concluída e abre a pausa. Resultado legado sem classificação ou sem sessão vale.
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.fase === t.faseAtual).at(-1);
    const falhaDeExecucao = ['runtime.unavailable', 'runtime.silencio', 'runtime.rate-limited', 'artifact.missing'];
    const doDespacho = (e: EventoLedger) => !e.sessionId || !despacho?.sessionId || e.sessionId === despacho.sessionId;
    const conclusao = (e: EventoLedger) => e.tipo === 'phase_result' &&
      !(e.classificacao === 'gate_blocked' && falhaDeExecucao.includes(String(e.motivo)));
    if (!eventos.some(e => e.fase === t.faseAtual && doDespacho(e) && (conclusao(e) ||
      e.tipo === 'gate_blocked' && e.motivo === 'human.pending'))) throw new Error('a conclusão da fase precisa estar registrada antes da pausa');
    // D18: `human.pending` sem conclusão provada (falta de prova do ork, ou `failed` depois do
    // Stop) leva o diagnóstico ao pedido, que não se apresenta como fase concluída.
    const resultado = eventos.filter(e => e.tipo === 'phase_result' && e.fase === t.faseAtual && doDespacho(e)).at(-1);
    if (resultado?.motivo === 'human.pending') semConclusao = diagnosticoSemConclusao(resultado);
    else if (PARECERES_QUE_PEDEM_REVISAO.includes(String(resultado?.motivo ?? ''))) parecerNegativo = String(resultado?.motivo);
  } else if (!(MOTIVOS_DE_ESCALACAO_HUMANA as readonly string[]).includes(motivo) ||
      !eventos.some(e => e.fase === t.faseAtual && (e.tipo === 'gate_blocked' && e.motivo === motivo ||
        e.tipo === 'retry_escalated' && motivo === 'retry.max_tentativas'))) throw new Error('escalação tipada não comprovada');
  // I-41 (T4d): pedido aberto e lido pelos leitores das duas versoes. Ler `.alvo.tipo` direto
  // lancaria TypeError diante de um `decidido`, que nao tem alvo e pode estar no mesmo ledger.
  // GO-FIX 1: o contexto e calculado uma vez sobre o que ja foi lido; reler thread e ledger por
  // pedido deixava a conferencia quadratica, e o resumo agora a faz para cada thread da fila.
  const contexto = contextoHitlDosEventos(t, eventos);
  const atual = eventos.filter(e => e.tipo === 'hitl_requested' && e.contexto === contexto &&
    alvoDoPedido(e.pedido as PedidoHitlQualquer)?.tipo === 'gate' &&
    motivoDoPedido(e.pedido as PedidoHitlQualquer) === motivo).at(-1);
  const pedidoAtual = atual?.pedido as PedidoHitlQualquer | undefined;
  if (pedidoAtual && estadoDoPedido(pedidoAtual, quando) === 'aberto' &&
      !eventos.some(e => e.tipo === 'human_gate' && e.pedidoId === pedidoAtual.id)) return { aberto: pedidoAtual };
  const sobre = motivo === 'human.pending' ? bloco.pausaSobre : `escalacao:${motivo}`;
  const primeira = semConclusao ? 'Aprovar sem conclusão provada (conferi a entrega)'
    : motivo === 'human.pending' ? 'Aprovar com as evidências apresentadas' : 'Reconhecer e encaminhar a correção';
  const recomendada = recomendadaDoGate(motivo, semConclusao, parecerNegativo);
  const alternativas: AlternativaHitlV2[] = ([
    [primeira, motivo === 'human.pending' ? 'aprovar' : 'responder'],
    ['Solicitar revisão', 'recusar'],
    ['Continuar esperando', 'esperar'],
  ] as const).map(([texto, acao], i) => {
    const letra = LETRAS_DO_GATE[i];
    return { letra, texto, acao, consequencia: CONSEQUENCIA_DA_ACAO[acao],
      ...(letra === recomendada.letra ? { recomendada: true as const, porque: recomendada.porque } : {}) };
  });
  // A1: o ato vem do motivo ou do que a pausa declara. A pausa que libera push na base protegida
  // e sem volta, e dizer isso e o que tira `criticos` do zero por construcao.
  const ato = atoDaPausa(motivo, bloco.pausaSobre);
  // O codigo curto e unico contra os que ja estao no ledger desta thread. T11 acrescenta o
  // comando que o resolve; a unicidade precisa nascer com o primeiro pedido que o carrega.
  // RM-048 (D4): o gate reaberto no MESMO contexto e pelo mesmo motivo reaproveita o codigo do
  // pedido anterior. Era a troca de codigo a cada hora que fazia a linha recebida virar po.
  const anterior = (pedidoAtual as { codigo?: unknown } | undefined)?.codigo;
  const codigo = typeof anterior === 'string' ? anterior : gerarCodigo(eventos.flatMap(e => {
    const c = (e.pedido as { codigo?: unknown } | undefined)?.codigo;
    return typeof c === 'string' ? [c] : [];
  }));
  // I-43: thread em modo aposentado e lida para sempre, mas nao escreve pergunta nova.
  const modo = exigirModoVivo(t.modo);
  const pedido: PerguntaAoDono = { contrato: CONTRATO_HITL_V2, classe: 'pergunta', id: randomUUID(),
    thread: id, fase: t.faseAtual, modo, criadoEm: quando,
    // T6: GOAL e PLAN nascem em `profunda`. Um gate sobre premissa sem artefato e sem diff e
    // decidido no escuro, e o modo nao sabe sobre o que se esta perguntando; a fase sabe.
    profundidade: profundidadeDoPedido(t.faseAtual, modo),
    alvo: { tipo: 'gate', sobre }, motivo,
    // I-41 (D1/T6): a pergunta e uma frase e a evidencia mora no corpo. O diagnostico de uma
    // fase sem conclusao chega a 600 caracteres e estourava o teto da pergunta; separado, ele
    // cabe e passa a ser lido como evidencia, que e o que ele sempre foi.
    pergunta: `Qual é o veredito sobre ${sobre}?`,
    alternativas,
    corpo: [`Fase ${t.faseAtual}, motivo ${motivo}`,
      ...(semConclusao ? [linhaDoCorpo(`Sem conclusão provada: ${semConclusao}`)] : []),
      ...(parecerNegativo ? [`Parecer registrado da fase: ${parecerNegativo}`] : [])],
    tipoDeResposta: 'objetiva', irreversivel: ato !== undefined, ...(ato ? { ato } : {}), codigo,
    prazo: new Date(Date.parse(quando) + 60 * 60 * 1000).toISOString(), acaoPadraoAoExpirar: 'esperar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 100 } };
  // RM-048 (D4): um codigo quer dizer UMA pergunta. Se o que sairia agora nao e o que o dono leu
  // com este codigo (a recomendada mudou, o diagnostico mudou), o codigo e outro: "DE6H a" nunca
  // se aplica a uma pergunta que o dono nao viu.
  if (typeof anterior === 'string' && pedidoAtual && essenciaDoPedido(pedido) !== essenciaDoPedido(pedidoAtual)) {
    pedido.codigo = gerarCodigo(eventos.flatMap(e => {
      const c = (e.pedido as { codigo?: unknown } | undefined)?.codigo;
      return typeof c === 'string' ? [c] : [];
    }));
  }
  return { novo: pedido };
}

/**
 * RM-048 (D4): o que faz dois pedidos de gate serem a MESMA pergunta para o dono. O identificador,
 * o instante e o prazo mudam a cada renovacao; o que o dono leu e respondeu nao pode mudar.
 */
export function essenciaDoPedido(p: PedidoHitlQualquer): string {
  if (!ehV2(p) || p.classe !== 'pergunta') return JSON.stringify(['v1', p.id]);
  return JSON.stringify([p.thread, p.fase, p.modo, p.alvo, p.motivo, p.pergunta, p.alternativas, p.corpo,
    p.tipoDeResposta, p.irreversivel, p.ato ?? null, p.codigo]);
}

/**
 * RM-048 (D4): a resposta a um pedido de gate vencido vai para o pedido RENOVADO, e so quando a
 * pergunta e a mesma.
 *
 * O prazo de uma hora existe para que uma aprovacao velha nao se aplique a um mundo novo. Aqui o
 * mundo e conferido de novo, e nao presumido: o contexto da thread (modo, fase, status, base,
 * despacho) tem de ser o do pedido original, o gate tem de continuar esperando o dono agora
 * (`prepararPedidoGate`, com as mesmas recusas de sempre), e a essencia do pedido que sairia
 * agora tem de ser identica a do que o dono leu. Qualquer diferenca e recusa com "pedido antigo":
 * a letra que o dono digitou nunca e aplicada a uma pergunta que ele nao viu.
 *
 * Nao escolhe resposta, nao aprova nada e nao toca a prova: quem registra e `responderGate`, com
 * o envelope assinado pelo ingresso, contra o pedido que esta funcao devolve.
 */
export function renovarPedidoDoGate(raiz: string, original: PedidoHitlQualquer, quando: string): PedidoHitlQualquer {
  validarPedidoHitl(original);
  if (alvoDoPedido(original)?.tipo !== 'gate') throw new Error('pedido antigo: só pedido de gate é renovado');
  const t = lerThread(raiz, original.thread), eventos = lerLedger(dirThread(raiz, original.thread));
  const evento = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as { id?: string } | undefined)?.id === original.id);
  if (!evento || evento.contexto !== contextoHitlDosEventos(t, eventos)) throw new Error('pedido antigo: fase, modo ou sessão mudou');
  const preparado = prepararPedidoGate(raiz, original.thread, motivoDoPedido(original), quando);
  const candidato = 'aberto' in preparado ? preparado.aberto : preparado.novo;
  if (essenciaDoPedido(candidato) !== essenciaDoPedido(original)) throw new Error('pedido antigo: a pergunta mudou desde que saiu');
  return 'aberto' in preparado ? preparado.aberto : registrarPedidoHitl(raiz, preparado.novo);
}

const LETRAS_DO_GATE = ['a', 'b', 'c'] as const satisfies readonly LetraDeAlternativa[];

/** Corta uma linha de evidencia no teto do corpo, sem deixar o pedido inteiro ser recusado. */
const linhaDoCorpo = (texto: string): string => texto.slice(0, TETOS_HITL_V2.corpoLinha);

/**
 * Pareceres que ja sao conclusao da fase E pedem revisao. Um `phase_result` com qualquer um
 * deles abre a pausa (I-34/D7), e recomendar "aprovar" em cima dele seria recomendar aprovar
 * uma fase que o proprio produto reprovou.
 */
const PARECERES_QUE_PEDEM_REVISAO: readonly string[] =
  ['claims.failed', 'claims.unverifiable', 'verify.failed', 'verify.regression', 'verify.timeout', 'verify.sem-veredito', 'ci.failed'];

/**
 * Qual alternativa o nucleo recomenda neste gate, e por que, em uma linha.
 *
 * I-41: ate aqui a recomendacao era "Confira artefatos, claims e riscos antes de responder.",
 * que nao aponta alternativa nenhuma e por isso nao e recomendacao: e um aviso. Os tres casos
 * abaixo saem de FATO REGISTRADO no ledger, nunca de julgamento do agente, e e essa derivacao
 * que faz a recomendada ser verificavel em vez de escolhida no chute.
 */
function recomendadaDoGate(motivo: string, semConclusao: string | null, parecer: string):
  { letra: LetraDeAlternativa; porque: string } {
  if (motivo !== 'human.pending') {
    return { letra: 'a', porque: `escalação tipada ${motivo}: reconhecer encaminha a correção dirigida` };
  }
  if (semConclusao) return { letra: 'b', porque: 'a fase não tem conclusão provada; o diagnóstico está no corpo' };
  if (parecer) return { letra: 'b', porque: `o parecer registrado da fase foi ${parecer}` };
  return { letra: 'a', porque: 'a fase registrou conclusão e as evidências acompanham o pedido' };
}

/**
 * I-41 (GO-FIX 1, B1 e B2): o endereco que o ingresso assinou, quando o dono nao digitou o pedido.
 *
 * O corpo assinado continua o de sempre, e `autenticarResposta` continua sem uma linha alterada.
 * O que muda e o ENDERECO dentro do corpo. Pelo caminho antigo o dono colava thread e
 * identificador longo, e o ingresso assinava esses dois. Pelo pulse o dono digita "P4EJ a" ou
 * "1a 2c", e o ingresso assina o endereco do pulse junto com o texto que o dono digitou: o
 * gateway nao conhece identificador de pedido, e nao deveria conhecer. Quem traduz "pergunta 1,
 * letra a" no pedido certo e o nucleo, pelo lote que ele mesmo serviu e gravou.
 *
 * A prova continua sendo a mesma chave do canal, as mesmas allowlists, a mesma janela de 60
 * segundos e o mesmo corpo. A resposta derivada tem de ser o proprio envelope com outra
 * `resposta`: qualquer outro campo divergente e recusa, senao o recibo diria que a prova cobre
 * algo que ela nao cobre. So o ingresso Telegram usa endereco; o nativo amarra contexto e hash
 * do pedido no proprio corpo e nao passa por aqui.
 */
export interface EnderecoAssinado {
  /** O que o ingresso pos na posicao `thread` do corpo assinado. */
  alvo: string;
  /** O que o ingresso pos na posicao `pedido`. */
  endereco: string;
  /** O envelope exatamente como o ingresso o assinou, com o texto que o dono digitou. */
  envelope: RespostaHumana;
  /** O que o nucleo traduziu, gravado junto do veredito para a auditoria refazer o caminho. */
  rastro: Record<string, unknown>;
}

const CAMPOS_QUE_A_DERIVADA_PRESERVA = ['origem', 'por', 'mensagem', 'recebidoEm', 'prova', 'canal', 'conta'] as const;

/** Quem prova que a resposta veio do dono: o envelope do proprio pedido, ou o do endereco assinado. */
function provaDaResposta(id: string, pedidoId: string, resposta: RespostaHumana, assinado?: EnderecoAssinado):
  (instante?: string) => void {
  if (!assinado) return instante => autenticarResposta(id, pedidoId, resposta, instante);
  const { envelope } = assinado;
  // So o endereco do pulse e aceito. Um envelope assinado para OUTRO pedido nunca serve de prova
  // para este: sem esta porta, quem tivesse um envelope legitimo de um gate poderia aponta-lo
  // para outro pedido, e a assinatura continuaria batendo com o endereco que ela de fato cobre.
  if (assinado.alvo !== ALVO_DO_PULSE || assinado.endereco !== ENDERECO_DA_RESPOSTA) {
    throw new Error('endereço assinado fora do pulse não prova resposta a outro pedido');
  }
  if (envelope.origem !== 'telegram' || resposta.native !== undefined || envelope.native !== undefined ||
      CAMPOS_QUE_A_DERIVADA_PRESERVA.some(c => resposta[c] !== envelope[c])) {
    throw new Error('resposta derivada diverge do envelope assinado pelo ingresso');
  }
  return instante => autenticarResposta(assinado.alvo, assinado.endereco, envelope, instante);
}

/** Usado sob lock tanto por gates como por sessões. Repetição não executa novamente. */
export function conferirResposta(raiz: string, id: string, pedidoId: string, resposta: RespostaHumana, quando?: string,
  assinado?: EnderecoAssinado): {
  pedido: PedidoHitl; anterior?: EventoLedger; opcao: PedidoHitl['opcoes'][number] | null;
} {
  const eventos = lerLedger(dirThread(raiz, id));
  const anterior = eventos.find(e => ['human_gate', 'session_answered'].includes(e.tipo) && e.pedidoId === pedidoId);
  if (!anterior) conferirCanalSelecionado(eventos, pedidoId, resposta.canal, resposta.origem,
    resposta.native?.connectionId);
  const pendente = eventos.find(e => e.tipo === 'session_answer_sending' && e.pedidoId === pedidoId);
  const conhecido = anterior ?? pendente;
  const replay = conhecido && typeof resposta.prova === 'string' && conhecido.mensagem === resposta.mensagem &&
    conhecido.autorizadoPor === resposta.por && conhecido.recibo === sha(resposta.prova);
  // Recibo persistido de um envelope idêntico já prova sua janela original. Replay
  // ainda verifica assinatura/allowlists, mas não volta a executar após os 60 segundos.
  // Primeiro verifica chave, allowlists e assinatura; a janela real é exigida logo abaixo.
  const provar = provaDaResposta(id, pedidoId, resposta, assinado);
  provar(resposta.recebidoEm);
  const ingresso = instanteDoIngresso(raiz, id, pedidoId, resposta);
  provar(replay ? resposta.recebidoEm : ingresso ?? quando);
  const evento = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl)?.id === pedidoId);
  if (!evento) throw new Error('pedido HITL não encontrado nesta thread');
  const pedido = evento.pedido as PedidoHitl;
  validarPedidoHitl(pedido);
  if (resposta.origem === 'native' && (resposta.native?.pedidoSha256 !== hashPedidoLocal(pedido) ||
      resposta.native.context !== evento.contexto || resposta.native.expiresAt !== pedido.prazo))
    throw Error('hitl.native.request-mismatch');
  if (anterior) {
    if (anterior.mensagem !== resposta.mensagem || anterior.autorizadoPor !== resposta.por || anterior.recibo !== sha(resposta.prova)) throw new Error('pedido já respondido; resposta divergente recusada');
    return { pedido, anterior, opcao: null };
  }
  if (pendente && pedido.alvo.tipo === 'session') {
    if (!replay) throw new Error('envio já iniciado; resposta divergente recusada');
    // responderSessao apenas consulta o envioId persistido neste caminho. Não
    // reaplica o conteúdo, não responde à sessão nova e não autoriza o bloco.
    return { pedido, opcao: null };
  }
  if (eventos.some(e => ['human_gate', 'session_answered', 'session_answer_sending'].includes(e.tipo) &&
      e.pedidoId !== pedidoId && e.mensagem === resposta.mensagem)) throw new Error('mensagem já usada ou reservada em outro pedido');
  if (evento.contexto !== contextoHitl(raiz, id)) throw new Error('pedido antigo: fase, modo ou sessão mudou');
  return { pedido, opcao: validarRespostaHitl(pedido, resposta.resposta, quando) };
}

export function dadosDaResposta(pedido: PedidoHitl, r: RespostaHumana): Record<string, unknown> {
  const canal = canalDoEnvelope(r);
  return { contrato: pedido.contrato, pedidoId: pedido.id, fase: pedido.fase, origem: r.origem,
    autorizadoPor: r.por, mensagem: r.mensagem, recebidoEm: r.recebidoEm, recibo: sha(r.prova),
    canal, conta: r.origem === 'native' ? r.conta : contaDoEnvelope(canal, r.conta), contratoResposta: contratoDaResposta(r),
    ...(r.origem === 'native' ? { native: nativeContextSchema.parse(r.native) } : {}) };
}

export function receberResposta(raiz: string, id: string, pedidoId: string, r: RespostaHumana, quando = new Date().toISOString(),
  assinado?: EnderecoAssinado): void {
  // Consulta sem efeito: prova a janela antes da contenção, mas não autoriza efeito fora do lock.
  const conferida = conferirResposta(raiz, id, pedidoId, r, quando, assinado);
  if (conferida.anterior || instanteDoIngresso(raiz, id, pedidoId, r)) return;
  const pendente = lerLedger(dirThread(raiz, id)).some(e => e.tipo === 'session_answer_sending' && e.pedidoId === pedidoId);
  if (!pendente) gravarIngresso(raiz, id, pedidoId, r, quando);
}

export function responderGate(raiz: string, id: string, pedidoId: string, r: RespostaHumana, quando?: string,
  assinado?: EnderecoAssinado): { ok: true; pedidoId: string; estado: string; repetida: boolean; publicacaoMemoria?: PublicacaoDeAprovacao } {
  receberResposta(raiz, id, pedidoId, r, quando, assinado);
  const resultado = comLockHitl(raiz, id, () => {
    const { pedido, anterior, opcao } = conferirResposta(raiz, id, pedidoId, r, quando, assinado);
    if (pedido.alvo.tipo !== 'gate') throw new Error('pedido destina-se à sessão, não ao gate');
    if (anterior) return { ok: true as const, pedidoId, estado: String(anterior.estado), repetida: true, evento: anterior };
    const evidencia = evidenciaDoIngresso(raiz, id, pedidoId, r);
    const veredito = registrarVereditoGate(raiz, id, pedido, opcao, {
      ...dadosDaResposta(pedido, r), source: 'human', evidencia: evidencia.arquivo, evidenciaSha256: evidencia.sha256,
      // O caminho que o numero da pergunta percorreu ate este pedido, para a auditoria refazer.
      ...(assinado ? { enderecoAssinado: { alvo: assinado.alvo, endereco: assinado.endereco, ...assinado.rastro } } : {}),
    });
    return { ok: true as const, pedidoId, estado: String(veredito.estado), repetida: false, evento: veredito };
  });
  if (resultado.repetida || resultado.estado !== 'aprovado') {
    const { evento: _evento, ...publico } = resultado; return publico;
  }
  const publicacaoMemoria = publicarAprovacaoHumana(raiz, id, resultado.evento);
  const { evento: _evento, ...publico } = resultado;
  return { ...publico, publicacaoMemoria };
}

/** Transição única para ambos os ingressos: reconhecer escalação não libera policy. */
function registrarVereditoGate(raiz: string, id: string, pedido: PedidoHitl,
  opcao: PedidoHitl['opcoes'][number] | null, proveniencia: Record<string, unknown>): EventoLedger {
  return registrar(dirThread(raiz, id), id, 'human_gate', { ...proveniencia, ...vereditoDoGate(pedido, opcao) });
}

/** Não aceita envelope JSON: o servidor fornece capacidade local de uso único. */
export function responderGateLocal(raiz: string, id: string, pedidoId: string, token: unknown): ResultadoDecisaoLocal {
  const atestado = consumirAtestadoLocal(token, raiz, id, pedidoId);
  const resultado = comLockHitl(raiz, id, () => {
    const eventos = lerLedger(dirThread(raiz, id));
    const anterior = eventos.find(e => e.tipo === 'human_gate' && e.pedidoId === pedidoId);
    if (anterior) return { ok: true, pedidoId, estado: String(anterior.estado), repetida: true };
    conferirCanalSelecionado(eventos, pedidoId, atestado.host, 'mcp-local', atestado.connectionId, atestado.requestId);
    const evento = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl)?.id === pedidoId);
    validarPedidoHitl(evento?.pedido);
    const pedido = evento!.pedido as PedidoHitl;
    if (pedido.thread !== id || evento!.contexto !== atestado.contexto || contextoHitl(raiz, id) !== atestado.contexto ||
        hashPedidoLocal(pedido) !== atestado.pedidoSha256) throw new Error('hitl.local.pedido-antigo');
    const opcao = validarRespostaHitl(pedido, atestado.opcao);
    const evidencia = gravarEvidenciaLocal(atestado, vereditoDoGate(pedido, opcao));
    const veredito = registrarVereditoGate(raiz, id, pedido, opcao, {
      contrato: pedido.contrato, pedidoId, fase: pedido.fase, origem: 'mcp-local', source: 'human',
      proveniencia: 'ork.mcp-elicitation/v1',
      // D12: os quatro canais gravam `canal`; aqui ele vem da conexão, não de argumento.
      canal: atestado.host, contratoResposta: 'ork.mcp-elicitation/v1',
      autorizadoPor: `mcp-local:${atestado.host}`, conexao: atestado.connectionId, solicitacao: atestado.requestId,
      contexto: atestado.contexto, pedidoSha256: atestado.pedidoSha256,
      recebidoEm: atestado.recebidoEm, recibo: evidencia.recibo,
      evidencia: evidencia.arquivo, evidenciaSha256: evidencia.sha256,
    });
    return { ok: true, pedidoId, estado: String(veredito.estado), repetida: false, evento: veredito };
  });
  const evento = 'evento' in resultado ? resultado.evento : undefined;
  const {evento:_evento,...publico}=resultado as typeof resultado & { evento?: EventoLedger };
  if (resultado.repetida || resultado.estado !== 'aprovado' || !evento) return publico;
  const publicacaoMemoria=publicarAprovacaoHumana(raiz,id,evento);
  return {...publico,publicacaoMemoria};
}

/** Stdin contém um envelope assinado pelo ingresso; argv só carrega identificadores. */
export function lerRespostaStdin(meta: { por?: string; mensagem?: string; origem?: string; canal?: string; conta?: string }): RespostaHumana {
  const partes: Buffer[] = []; let total = 0;
  while (true) {
    const buf = Buffer.alloc(4096), n = fs.readSync(0, buf, 0, buf.length, null);
    if (!n) break;
    total += n; if (total > 32768) throw new Error('envelope HITL excede limite');
    partes.push(buf.subarray(0, n));
  }
  let r: RespostaHumana;
  try { r = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { throw new Error('ingresso autenticado exige envelope JSON em stdin'); }
  // D12: o canal tambem e proveniencia. Envelope que declara canal sem `--canal` em argv,
  // ou com canal diferente, e recusado antes de qualquer conferencia de assinatura.
  if (!r || r.por !== meta.por || r.mensagem !== meta.mensagem || r.origem !== meta.origem ||
      (r.canal ?? undefined) !== (meta.canal ?? undefined) ||
      (r.conta ?? undefined) !== (meta.conta ?? undefined)) throw new Error('proveniência em argv diverge do envelope');
  return r;
}
