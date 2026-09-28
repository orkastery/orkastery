import * as fs from 'node:fs';
import { controleDoController } from './adapters/codex-controller';
/** D4/D19: nenhuma sessão é encerrada por prefixo, nome, PID inferido ou mera ausência. */
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { consultarSessoes } from './adapters/claude-bg';
import { dirThread, lerThread } from './thread';
import { lerLedger, registrar } from './ledger';
import { EventoLedger, Fase } from './types';
import { exec } from './util';
import { comLockHitl, conferirResposta, contextoHitl, dadosDaResposta, receberResposta, RespostaHumana } from './hitl-gates';
import { PedidoHitl, profundidadeDoModo, validarPedidoHitl, validarRespostaHitl } from './hitl-contract';
import { consumirAtestadoLocal, hashPedidoLocal, reciboDoAtestado } from './hitl-local-atestado';
import { gravarEvidenciaLocalSessao } from './hitl-local-receipt';
import { evidenciaDoIngresso, validarEvidenciaReconstruida } from './hitl-ingress-receipt';
import { redigirSegredos } from './hitl';
import { conferirCanalSelecionado } from './hitl-canais';
import { PerguntaNativa, projetarPergunta } from './adapters/codex-question';

export interface IdentidadeSessao {
  sessionId: string; runtime: string; cwd: string; estado: string; instancia: string;
  /** Identificador nativo do prompt bloqueado; não é deduzido da idade da sessão. */
  bloqueio?: string;
  perguntaNativa?: PerguntaNativa;
  limitacao?: { motivo: 'runtime.unavailable'; codigo: string; metodo: string };
}
export interface ControleSessao {
  consultar: (orcamentoMs?: number) => { ok: boolean; sessoes: IdentidadeSessao[] };
  parar: (sessao: IdentidadeSessao) => boolean;
  /** Capacidades apenas do adapter vinculado ao controller. Nunca vindas de argv/env. */
  enviar?: (entrega: EntregaSessao) => void;
  confirmar?: (entrega: Omit<EntregaSessao, 'resposta'>) => ConfirmacaoSessao | null;
}

export interface EntregaSessao {
  contrato: 'ork.session-answer/v1';
  envioId: string; pedidoId: string; thread: string; fase: Fase;
  sessao: IdentidadeSessao; recibo: string; resposta: string;
}
export interface ConfirmacaoSessao extends Omit<EntregaSessao, 'resposta'> {
  estado: 'recebida';
}

const uuidCompleto = (s: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const reciboDaProva = (r: RespostaHumana) => createHash('sha256').update(r.prova).digest('hex');
const mesmaInstancia = (a: IdentidadeSessao, b: IdentidadeSessao) =>
  a.sessionId === b.sessionId && a.runtime === b.runtime && a.cwd === b.cwd && a.instancia === b.instancia;

function controleDeResposta(raiz: string, id: string, sessionId: string, runtime: string, controle?: ControleSessao): ControleSessao &
  Required<Pick<ControleSessao, 'enviar' | 'confirmar'>> {
  const ctl = controle ?? controleNativo(runtime, raiz, id, sessionId);
  if (!ctl.enviar || !ctl.confirmar) throw new Error('runtime.unavailable: adapter não comprova entrada e recibo na mesma sessão; attach/resume não são fallback');
  return ctl as ControleSessao & Required<Pick<ControleSessao, 'enviar' | 'confirmar'>>;
}

function observarBloqueio(ctl: ControleSessao, sessionId: string, runtime: string, cwd: string): IdentidadeSessao {
  const consulta = ctl.consultar();
  if (!consulta.ok) throw new Error('runtime.unavailable: consulta falhou; sessão preservada');
  const matches = consulta.sessoes.filter(s => s.sessionId === sessionId);
  const s = matches[0];
  if (matches.length !== 1 || !s || s.runtime !== runtime || s.cwd !== cwd || s.estado !== 'blocked' ||
      !s.instancia || !s.bloqueio) throw new Error('runtime.unavailable: identidade, cwd e prompt bloqueado exatos não comprovados');
  return { sessionId: s.sessionId, runtime: s.runtime, cwd: s.cwd, estado: s.estado, instancia: s.instancia, bloqueio: s.bloqueio, perguntaNativa: s.perguntaNativa };
}

/** Cria somente um pedido vinculado ao despacho corrente e ao prompt nativo observado. */
export function abrirPedidoSessao(raiz: string, id: string, sessionId: string, opcoes: {
  fase: Fase; runtime: string; pergunta?: string; prazo?: string; quando?: string;
}, controle?: ControleSessao): PedidoHitl {
  return comLockHitl(raiz, id, () => {
    if (!uuidCompleto(sessionId)) throw new Error('identidade exige UUID completo');
    const t = lerThread(raiz, id), dir = dirThread(raiz, id), eventos = lerLedger(dir);
    const d = eventos.filter(e => e.tipo === 'phase_dispatch').at(-1);
    if (t.status !== 'aberta' || t.faseAtual !== opcoes.fase || !t.sessoes.some(s =>
      s.sessionId === sessionId && s.fase === opcoes.fase && s.runtime === opcoes.runtime && s.verificada) ||
      d?.sessionId !== sessionId || d?.fase !== opcoes.fase || d?.runtime !== opcoes.runtime ||
      !eventos.some(e => e.tipo === 'phase_dispatch_verified' && e.sessionId === sessionId && e.encontrada === true)) {
      throw new Error('sessão não corresponde ao despacho corrente verificado da thread/fase/runtime');
    }
    const ctl = controleDeResposta(raiz, id, sessionId, opcoes.runtime, controle), cwd = path.resolve(t.worktree ?? raiz);
    const sessao = observarBloqueio(ctl, sessionId, opcoes.runtime, cwd);
    const revalidada = observarBloqueio(ctl, sessionId, opcoes.runtime, cwd);
    if (!mesmaInstancia(sessao, revalidada) || sessao.bloqueio !== revalidada.bloqueio) throw new Error('prompt ou instância mudou durante o pedido');
    const nativa = sessao.perguntaNativa;
    if (!nativa || JSON.stringify(nativa) !== JSON.stringify(revalidada.perguntaNativa) ||
        projetarPergunta({ isBlocking: true, questions: [nativa] }).sha256 !== nativa.sha256)
      throw new Error('runtime.unavailable: conteúdo nativo da pergunta não comprovado');
    if (opcoes.pergunta !== undefined && opcoes.pergunta !== nativa.question)
      throw new Error('pergunta do operador diverge do conteúdo nativo; consentimento recusado');
    const escolhas = nativa.options.map((o, i) => ({ numero: i + 1, texto: `${o.label} — ${o.description}`, acao: 'responder' as const }));
    if (redigirSegredos(nativa.question) !== nativa.question || escolhas.some(o => o.texto.length > 200 || redigirSegredos(o.texto) !== o.texto))
      throw new Error('runtime.unavailable: conteúdo nativo não pode ser publicado integralmente neste canal');
    const contexto = contextoHitl(raiz, id);
    const existente = eventos.find(e => e.tipo === 'hitl_requested' && e.contexto === contexto &&
      (e.sessao as IdentidadeSessao | undefined)?.sessionId === sessionId &&
      (e.sessao as IdentidadeSessao).instancia === sessao.instancia && (e.sessao as IdentidadeSessao).bloqueio === sessao.bloqueio);
    if (existente) {
      const p = existente.pedido as PedidoHitl;
      validarPedidoHitl(p);
      if (p.pergunta !== nativa.question || opcoes.prazo && p.prazo !== opcoes.prazo) throw new Error('prompt já tem pedido; conteúdo divergente recusado');
      return p; // inclusive expirado/respondido: não cria novo envio para o mesmo prompt
    }
    const quando = opcoes.quando ?? new Date().toISOString();
    // O tipo aceito decide o que o canal orienta E o que o receptor recebe: uma coisa só.
    const tipoAceito: 'opcao' | 'texto' = escolhas.length && !nativa.isOther ? 'opcao' : 'texto';
    // I-41 (T4d): a pergunta de SESSAO continua em `ork.hitl/v1`, e a razao e dura.
    //
    // O PLAN previa mover os dois emissores para v2. O gate deu certo porque as tres opcoes sao
    // NOSSAS e a recomendada sai de fato registrado no ledger. Aqui nao: a pergunta e as opcoes
    // vem do HOST, pelo prompt nativo. O v2 exige de 2 a 4 alternativas e EXATAMENTE UMA
    // recomendada com o porque; uma pergunta nativa de texto livre nao tem alternativa nenhuma,
    // uma com sete opcoes nao cabe em a-d, e o nucleo nao tem base para eleger a melhor entre
    // opcoes que ele nao escreveu. Emitir v2 aqui exigiria inventar uma recomendada no chute,
    // que e exatamente o defeito que esta thread existe para consertar; a alternativa seria
    // recusar perguntas de sessao legitimas. v1 continua lido para sempre, e e o contrato certo
    // para um conteudo que nao e nosso. Uma pergunta aberta tambem nao pertence a camada 2, que
    // e de perguntas objetivas de cinco em cinco.
    const pedido: PedidoHitl = { contrato: 'ork.hitl/v1', id: randomUUID(), thread: id, fase: opcoes.fase,
      modo: t.modo, alvo: { tipo: 'session', sessionId, runtime: opcoes.runtime }, motivo: 'hitl.pergunta',
      pergunta: nativa.question, opcoes: escolhas, recomendacao: orientacaoDaResposta(tipoAceito, escolhas.length),
      criadoEm: quando, prazo: opcoes.prazo ?? new Date(Date.parse(quando) + 3600000).toISOString(),
      acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: tipoAceito, maxCaracteres: 4096 }, profundidade: profundidadeDoModo(t.modo) };
    validarPedidoHitl(pedido);
    registrar(dir, id, 'hitl_requested', { fase: pedido.fase, pedido, contexto, sessao,
      evidencia: 'duas consultas do adapter concordam com despacho, instância, cwd e prompt bloqueado' });
    return pedido;
  });
}

/**
 * A orientação do canal diz exatamente o que o receptor vai receber, e nada além disso.
 * Quando a pergunta nativa aceita texto, um número digitado continua sendo esse texto.
 */
function orientacaoDaResposta(tipo: 'opcao' | 'texto', quantasOpcoes: number): string {
  const fecho = 'A resposta não aprova gates do bloco.';
  if (tipo === 'opcao') return `Responda com o número de uma das ${quantasOpcoes} opções desta sessão; o receptor recebe o rótulo nativo correspondente. ${fecho}`;
  const contexto = quantasOpcoes
    ? ` As opções listadas são o conteúdo nativo da pergunta, não um seletor: digitar um número envia esse número.`
    : '';
  return `Esta pergunta aceita texto livre: o receptor recebe a sua resposta literal, inclusive quando ela for um número.${contexto} ${fecho}`;
}

export interface ResultadoEntregaSessao {
  ok: true; pedidoId: string; sessionId: string; estado: 'entregue'; repetida: boolean;
}

/**
 * D12: a origem de uma resposta de sessão, igual para os quatro canais.
 *
 * O que muda entre Telegram e MCP local é como a resposta foi autenticada, não o que
 * acontece depois dela. Antes de D12 só existia o caminho do Telegram, e a autenticação
 * estava entrelaçada com a entrega; separar as duas é o que permite Codex e Claude Code
 * responderem à mesma pergunta nativa sem um segundo protocolo de entrega.
 */
export interface ProvenienciaDeResposta {
  /** Campos de origem que vão ao ledger, já com `canal` e `contratoResposta`. */
  dados: Record<string, unknown>;
  /** O texto literal que o humano respondeu. */
  resposta: string;
  /** Recibo criptográfico da entrada; único por resposta e estável entre repetições. */
  recibo: string;
  /** Identidade única da entrada, usada na reserva e na idempotência. */
  mensagem: string;
  autorizadoPor: string;
  /** Grava a evidência durável depois da confirmação do receptor, quando o canal tem uma. */
  evidenciar?: (entrega: Omit<EntregaSessao, 'resposta'>) => { arquivo: string; sha256: string; recibo: string };
}

/**
 * O núcleo da entrega, comum aos quatro canais: conferência do vínculo nativo, reserva
 * durável, envio único e confirmação correlacionada. Nenhum canal ganha atalho aqui.
 */
function entregarNaSessao(raiz: string, id: string, pedido: PedidoHitl,
  prov: ProvenienciaDeResposta, controle?: ControleSessao): ResultadoEntregaSessao {
  if (pedido.alvo.tipo !== 'session') throw new Error('pedido destina-se ao gate, não à sessão');
  const pedidoId = pedido.id;
  const { sessionId, runtime } = pedido.alvo;
  const resultado = { ok: true as const, pedidoId, sessionId, estado: 'entregue' as const };
  const dir = dirThread(raiz, id), eventos = lerLedger(dir);
  const solicitado = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl)?.id === pedidoId);
  const sessao = solicitado?.sessao as IdentidadeSessao | undefined;
  if (!sessao || !uuidCompleto(sessionId) || sessao.sessionId !== sessionId || sessao.runtime !== runtime ||
      !sessao.instancia || !sessao.bloqueio || sessao.cwd !== path.resolve(lerThread(raiz, id).worktree ?? raiz)) {
    throw new Error('runtime.unavailable: pedido sem vínculo nativo exato');
  }
  const ctl = controleDeResposta(raiz, id, sessionId, runtime, controle);
  const pendente = eventos.find(e => e.tipo === 'session_answer_sending' && e.pedidoId === pedidoId);
  if (pendente && (pendente.recibo !== prov.recibo || pendente.mensagem !== prov.mensagem || pendente.autorizadoPor !== prov.autorizadoPor)) {
    throw new Error('envio já iniciado; resposta divergente recusada');
  }
  if (eventos.some(e => e.tipo === 'session_answer_sending' && e.pedidoId !== pedidoId && e.mensagem === prov.mensagem)) {
    throw new Error('mensagem já reservada para outro pedido');
  }
  const entrega: Omit<EntregaSessao, 'resposta'> = { contrato: 'ork.session-answer/v1',
    envioId: pendente ? String(pendente.envioId) : randomUUID(), pedidoId, thread: id, fase: pedido.fase, sessao, recibo: prov.recibo };
  if (!pendente) {
    for (let i = 0; i < 2; i++) {
      const atual = observarBloqueio(ctl, sessionId, runtime, sessao.cwd);
      if (!mesmaInstancia(atual, sessao) || atual.bloqueio !== sessao.bloqueio || JSON.stringify(atual.perguntaNativa) !== JSON.stringify(sessao.perguntaNativa)) throw new Error('prompt ou instância mudou antes do envio');
    }
    registrar(dir, id, 'session_answer_sending', { ...prov.dados, sessionId, runtime,
      instancia: sessao.instancia, bloqueio: sessao.bloqueio, envioId: entrega.envioId });
    // O número só vira rótulo nativo quando o pedido aceita OPÇÃO. Em texto livre a
    // resposta humana chega literal ao receptor, inclusive quando é "1" ou "12".
    const numero = pedido.respostaAceita.tipo === 'opcao' && /^(?:[1-9]|1[0-2])$/.test(prov.resposta.trim())
      ? Number(prov.resposta.trim()) - 1 : -1;
    const respostaNativa = (numero < 0 ? undefined : sessao.perguntaNativa?.options[numero]?.label) ?? prov.resposta;
    try { ctl.enviar({ ...entrega, resposta: respostaNativa }); }
    catch { throw new Error('runtime.unavailable: resultado do envio incerto; não reenviar; consultar recibo do controller'); }
  }
  let ack: ConfirmacaoSessao | null;
  try { ack = ctl.confirmar(entrega); }
  catch { throw new Error('runtime.unavailable: consulta do recibo falhou; envio não será repetido'); }
  if (!ack || ack.estado !== 'recebida' || ack.contrato !== entrega.contrato || ack.envioId !== entrega.envioId ||
      ack.pedidoId !== pedidoId || ack.thread !== id || ack.fase !== pedido.fase || ack.recibo !== entrega.recibo ||
      !ack.sessao || !mesmaInstancia(ack.sessao, sessao) || ack.sessao.bloqueio !== sessao.bloqueio) {
    throw new Error('runtime.unavailable: receptor não confirmou recebimento correlacionado na mesma sessão; não reenviar');
  }
  const evidencia = prov.evidenciar?.({ ...entrega, sessao });
  registrar(dir, id, 'session_answered', { ...prov.dados, sessionId, runtime,
    instancia: sessao.instancia, bloqueio: sessao.bloqueio, envioId: entrega.envioId, estado: 'entregue',
    ...(evidencia ? { evidencia: evidencia.arquivo, evidenciaSha256: evidencia.sha256, recibo: evidencia.recibo } : {
      evidencia: 'recibo do controller confirma envioId, pedido, thread/fase, UUID, instância, cwd, prompt e envelope' }) });
  return { ...resultado, repetida: !!pendente };
}

/** Uma intenção durável impede reenvio após crash, timeout ou confirmação divergente. */
export function responderSessao(raiz: string, id: string, pedidoId: string, r: RespostaHumana,
  controle?: ControleSessao, quando?: string): ResultadoEntregaSessao {
  receberResposta(raiz, id, pedidoId, r, quando);
  return comLockHitl(raiz, id, () => {
    const { pedido, anterior } = conferirResposta(raiz, id, pedidoId, r, quando);
    if (pedido.alvo.tipo !== 'session') throw new Error('pedido destina-se ao gate, não à sessão');
    if (anterior) return { ok: true as const, pedidoId, sessionId: pedido.alvo.sessionId, estado: 'entregue' as const, repetida: true };
    return entregarNaSessao(raiz, id, pedido, { dados: dadosDaResposta(pedido, r), resposta: r.resposta,
      recibo: reciboDaProva(r), mensagem: r.mensagem, autorizadoPor: r.por,
      // FX4: o ingresso duravel ja foi gravado e autenticado por `receberResposta`. Sem
      // referencia-lo no `session_answered`, a prova existia em disco e nao chegava ao
      // recibo: metade do HITL ficava com a palavra do controller e nada mais.
      evidenciar: () => ({ ...evidenciaDoIngresso(raiz, id, pedidoId, r), recibo: reciboDaProva(r) }) }, controle);
  });
}

/**
 * D12: responder a pergunta nativa de uma sessão pelo canal MCP local.
 *
 * O HITL do Orkastery não é só gate de fase. Uma sessão bloqueada numa pergunta nativa é
 * HITL igual, e antes desta função ela só podia ser respondida pelo Telegram: Codex e
 * Claude Code tinham `mcp-local` para decidir bloco e não tinham para responder à própria
 * sessão que o dono estava olhando. O canal, a correlação e o recibo vêm da CONEXÃO, nunca
 * de argumento de ferramenta: é isso que impede o agente de responder por quem pediu.
 *
 * Aceita texto livre quando a pergunta nativa aceita, porque uma pergunta aberta respondida
 * por menu vira outra pergunta.
 */
export function responderSessaoLocal(raiz: string, id: string, pedidoId: string, token: unknown,
  controle?: ControleSessao): ResultadoEntregaSessao {
  const atestado = consumirAtestadoLocal(token, raiz, id, pedidoId);
  return comLockHitl(raiz, id, () => {
    const eventos = lerLedger(dirThread(raiz, id));
    const evento = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl)?.id === pedidoId);
    validarPedidoHitl(evento?.pedido);
    const pedido = evento!.pedido as PedidoHitl;
    if (pedido.thread !== id || pedido.alvo.tipo !== 'session') throw new Error('hitl.local.somente-sessoes');
    const anterior = eventos.find(e => e.tipo === 'session_answered' && e.pedidoId === pedidoId);
    if (anterior) return { ok: true as const, pedidoId, sessionId: pedido.alvo.sessionId, estado: 'entregue' as const, repetida: true };
    conferirCanalSelecionado(eventos, pedidoId, atestado.host, 'mcp-local', atestado.connectionId, atestado.requestId);
    if (evento!.contexto !== atestado.contexto || contextoHitl(raiz, id) !== atestado.contexto ||
        hashPedidoLocal(pedido) !== atestado.pedidoSha256) throw new Error('hitl.local.pedido-antigo');
    // Opção numerada continua sendo conferida contra o pedido; texto livre passa pelo
    // mesmo limite de tamanho. Em nenhum dos dois casos o corpo é gravado.
    validarRespostaHitl(pedido, atestado.opcao);
    const identidade = `mcp-local:${atestado.connectionId}:${atestado.requestId}`;
    const dados = { contrato: pedido.contrato, pedidoId, fase: pedido.fase, origem: 'mcp-local',
      source: 'human', proveniencia: 'ork.mcp-elicitation/v1',
      canal: atestado.host, contratoResposta: 'ork.hitl-local-session/v1',
      autorizadoPor: `mcp-local:${atestado.host}`, conexao: atestado.connectionId,
      solicitacao: atestado.requestId, contexto: atestado.contexto, pedidoSha256: atestado.pedidoSha256,
      recebidoEm: atestado.recebidoEm, mensagem: identidade,
      // Amarra conteudo: o recibo que o controller confirmou deriva do hash da resposta.
      reciboEntrega: reciboDoAtestado(atestado) };
    return entregarNaSessao(raiz, id, pedido, {
      dados, resposta: atestado.opcao, mensagem: identidade,
      autorizadoPor: `mcp-local:${atestado.host}`,
      // O recibo que o controller confirma amarra o CONTEUDO, nao so a conexao.
      recibo: reciboDoAtestado(atestado),
      evidenciar: (entrega) => gravarEvidenciaLocalSessao(atestado, { fase: String(pedido.fase),
        sessionId: entrega.sessao.sessionId, runtime: entrega.sessao.runtime,
        instancia: entrega.sessao.instancia, bloqueio: String(entrega.sessao.bloqueio), envioId: entrega.envioId }),
    }, controle);
  });
}

/** FX3: o desfecho possivel de reconciliar um envio pendente, so com (thread, pedido). */
export interface ResultadoReconciliacaoSessao {
  ok: boolean; pedidoId: string; sessionId: string; envioId: string;
  estado: 'entregue' | 'pendente'; repetida: boolean;
  /** Que prova sustenta o `entregue`. `nenhuma` so aparece com estado `pendente`. */
  prova: 'ingresso-duravel' | 'recibo-do-controller' | 'nenhuma';
}

/**
 * FX3: reconciliar um `session_answer_sending` orfao, sem o envelope original.
 *
 * O buraco que C-CHECK3 nomeou: a reserva duravel guardava `sha(prova)`, nunca a `prova`.
 * Isso esta certo e continua assim. O problema era outro: o UNICO caminho que fechava um
 * envio pendente exigia que o MESMO chamador reapresentasse a `RespostaHumana` inteira. Se
 * o processo que originou o envio morresse com o `r` so na memoria, o pendente ficava para
 * sempre: nao dava para confirmar, nem para saber se o receptor recebeu, e qualquer
 * tentativa nova batia em "envio ja iniciado; resposta divergente recusada".
 *
 * Aqui a reconciliacao usa apenas o que ESTA no ledger: `envioId`, `recibo`, `mensagem`,
 * `autorizadoPor` e o vinculo nativo do pedido. Com isso ela reconstroi a entrega e pergunta
 * ao receptor, pelo recibo correlacionado, se ele recebeu aquele `envioId`. Ela NUNCA envia
 * nada: reenviar as cegas e justamente o que a reserva duravel existe para impedir.
 *
 * Nao existe desfecho "cancelado". Nada observavel prova que o receptor NAO recebeu, e
 * inventar essa prova seria o oposto do que este nucleo faz. Sem confirmacao, o pendente
 * continua pendente, e a proxima chamada tenta de novo, sem efeito acumulado.
 */
export function reconciliarEnvioDeSessao(raiz: string, id: string, pedidoId: string,
  controle?: ControleSessao): ResultadoReconciliacaoSessao {
  return comLockHitl(raiz, id, () => {
    const dir = dirThread(raiz, id), eventos = lerLedger(dir);
    const solicitado = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl | undefined)?.id === pedidoId);
    validarPedidoHitl(solicitado?.pedido);
    const pedido = solicitado!.pedido as PedidoHitl;
    if (pedido.thread !== id || pedido.alvo.tipo !== 'session') throw new Error('hitl.sessao.pedido-nao-e-de-sessao');
    const { sessionId, runtime } = pedido.alvo;
    const respondido = eventos.find(e => e.tipo === 'session_answered' && e.pedidoId === pedidoId);
    const pendente = eventos.find(e => e.tipo === 'session_answer_sending' && e.pedidoId === pedidoId);
    if (!pendente) throw new Error('hitl.sessao.sem-envio-pendente');
    const envioId = String(pendente.envioId);
    // Idempotencia: ja respondido nao reabre envio, nao consulta receptor e nao regrava.
    if (respondido) {
      return { ok: true, pedidoId, sessionId, envioId, estado: 'entregue' as const, repetida: true,
        prova: respondido.evidenciaSha256 ? 'ingresso-duravel' as const : 'recibo-do-controller' as const };
    }
    const sessao = solicitado!.sessao as IdentidadeSessao | undefined;
    if (!sessao || sessao.sessionId !== sessionId || sessao.runtime !== runtime || !sessao.instancia || !sessao.bloqueio ||
        sessao.cwd !== path.resolve(lerThread(raiz, id).worktree ?? raiz)) {
      throw new Error('runtime.unavailable: pedido sem vinculo nativo exato');
    }
    const ctl = controleDeResposta(raiz, id, sessionId, runtime, controle);
    const entrega: Omit<EntregaSessao, 'resposta'> = { contrato: 'ork.session-answer/v1', envioId,
      pedidoId, thread: id, fase: pedido.fase, sessao, recibo: String(pendente.recibo) };
    let ack: ConfirmacaoSessao | null;
    try { ack = ctl.confirmar(entrega); }
    catch { throw new Error('runtime.unavailable: consulta do recibo falhou; envio nao sera repetido'); }
    const confirmado = !!ack && ack.estado === 'recebida' && ack.contrato === entrega.contrato &&
      ack.envioId === envioId && ack.pedidoId === pedidoId && ack.thread === id && ack.fase === pedido.fase &&
      ack.recibo === entrega.recibo && !!ack.sessao && mesmaInstancia(ack.sessao, sessao) &&
      ack.sessao.bloqueio === sessao.bloqueio;
    const { ts: _ts, thread: _thread, tipo: _tipo, eventId: _eventId, ...origem } = pendente;
    if (!confirmado) {
      registrar(dir, id, 'session_answer_reconciled', { pedidoId, fase: pedido.fase, sessionId, runtime, envioId,
        estado: 'pendente', decididoPor: 'nucleo ork',
        razao: 'receptor nao confirmou recebimento correlacionado; envio preservado e nunca repetido' });
      return { ok: false, pedidoId, sessionId, envioId, estado: 'pendente' as const, repetida: false, prova: 'nenhuma' as const };
    }
    // A evidencia duravel do canal, quando existe, e derivavel SO do ledger: o nome do
    // arquivo sai de `mensagem`. FX10: derivar nao e provar. O evento que esta prestes a ser
    // gravado passa pelo MESMO MAC que o sync exige, ANTES de existir no ledger. Sem isso um
    // byte trocado no pendente (ou no proprio arquivo de ingresso) virava `session_answered`
    // com etiqueta de prova duravel, e a mentira so aparecia dias depois, no sync.
    const evidencia = evidenciaReconciliada(raiz, id, origem);
    const candidato = { ...origem, estado: 'entregue', reconciliado: true, ...evidencia.dados } as unknown as EventoLedger;
    if (evidencia.prova === 'sem-prova-duravel' ||
        evidencia.prova === 'ingresso-duravel' && !validarEvidenciaReconstruida(raiz, id, candidato)) {
      // Falha FECHADA: nenhuma resposta gravada, o pendente continua pendente e a recusa
      // fica auditavel. Reconciliar de novo com o estado consertado ainda funciona.
      registrar(dir, id, 'session_answer_reconciled', { pedidoId, fase: pedido.fase, sessionId, runtime, envioId,
        estado: 'recusado', decididoPor: 'nucleo ork',
        razao: evidencia.prova === 'sem-prova-duravel'
          ? 'envio por telegram sem ingresso duravel correspondente; nenhuma resposta foi gravada'
          : 'evidencia duravel reconstruida nao revalidou o MAC do canal; nenhuma resposta foi gravada' });
      throw new Error('hitl.sessao.evidencia-duravel-invalida: envio pendente nao revalida; nada foi gravado');
    }
    registrar(dir, id, 'session_answer_reconciled', { pedidoId, fase: pedido.fase, sessionId, runtime, envioId,
      estado: 'entregue', decididoPor: 'nucleo ork',
      razao: 'recibo do controller confirmou envioId, pedido, thread/fase, instancia e prompt, e o MAC duravel revalidou' });
    registrar(dir, id, 'session_answered', candidato as unknown as Record<string, unknown>);
    return { ok: true, pedidoId, sessionId, envioId, estado: 'entregue' as const, repetida: false, prova: evidencia.prova };
  });
}

/** Referencia duravel reconstruida so com o que o ledger ja guardava do envio pendente. */
function evidenciaReconciliada(raiz: string, id: string, origem: Record<string, unknown>): {
  prova: 'ingresso-duravel' | 'recibo-do-controller' | 'sem-prova-duravel'; dados: Record<string, unknown>;
} {
  const mensagem = typeof origem.mensagem === 'string' ? origem.mensagem : '';
  const nome = createHash('sha256').update(mensagem).digest('hex') + '.json';
  const file = path.join(dirThread(raiz, id), 'hitl-ingress', nome);
  if (origem.origem === 'telegram' || origem.origem === 'native') {
    // FX10: um envio de telegram SEM ingresso duravel nao pode cair no recibo do controller.
    // Esse desvio transformava o sumico do arquivo de prova em um caminho mais permissivo,
    // que e exatamente o contrario do que apagar a prova deveria causar.
    if (!mensagem || !fs.existsSync(file)) return { prova: 'sem-prova-duravel', dados: {} };
    const bytes = fs.readFileSync(file, 'utf8');
    return { prova: 'ingresso-duravel', dados: { evidencia: `.orkastery/threads/${id}/hitl-ingress/${nome}`,
      evidenciaSha256: createHash('sha256').update(bytes).digest('hex') } };
  }
  // O ingresso MCP local grava o recibo duravel DEPOIS da confirmacao, e o atestado de uso
  // unico morreu com o processo. Reconciliar nao reemite esse recibo: diz, com nome, que a
  // prova aqui e o recibo do controller, e nao uma evidencia duravel que ninguem assinou.
  return { prova: 'recibo-do-controller', dados: { evidencia:
    'reconciliacao: recibo do controller confirma envioId, pedido, thread/fase, instancia e prompt; evidencia duravel do ingresso nao foi reemitida' } };
}

export function controleNativo(runtime: string, raiz: string, id: string, sessionId: string): ControleSessao {
  if (runtime === 'codex') {
    const t = lerThread(raiz, id), sessao = t.sessoes.find(s => s.sessionId === sessionId && s.runtime === runtime);
    const d = lerLedger(dirThread(raiz, id)).find(e => e.tipo === 'phase_dispatch' && e.sessionId === sessionId);
    if (sessao?.controlador && d?.controlador === sessao.controlador && d.promptSha256 === sessao.promptSha256) {
      const base = fs.realpathSync(path.join(dirThread(raiz, id), 'sessoes')) + path.sep;
      const dir = fs.realpathSync(sessao.controlador);
      if (!dir.startsWith(base)) throw new Error('runtime.unavailable: controller fora do despacho canônico');
      return controleDoController(dir, { thread: id, fase: sessao.fase, promptSha256: sessao.promptSha256 }, sessionId, path.resolve(t.worktree ?? raiz));
    }
  }
  if (runtime !== 'claude-bg') {
    throw new Error('runtime.unavailable: Codex exige identidade de controller vinculada pelo adapter; nenhum PID será inferido ou sinalizado');
  }
  return {
    consultar: () => {
      const r = consultarSessoes(undefined, true);
      return { ok: r.ok, sessoes: r.sessoes.map(s => ({ sessionId: s.sessionId, runtime, cwd: s.cwd ?? '',
        estado: s.state ?? s.status ?? '', instancia: s.id && Number.isFinite(s.startedAt) ? JSON.stringify([s.id, s.startedAt]) : '' })) };
    },
    parar: s => exec('claude', ['stop', s.sessionId], undefined, 10000).ok,
  };
}

/** Somente despacho posterior verificado torna uma sessão da mesma fase superável. */
function superarSobLock(raiz: string, id: string, sessionId: string, fase: Fase, runtime: string,
  controle?: ControleSessao): { ok: true; sessionId: string; repetida: boolean } {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId)) throw new Error('identidade exige UUID completo');
  const t = lerThread(raiz, id), dir = dirThread(raiz, id), eventos = lerLedger(dir);
  if (!t.sessoes.some(s => s.sessionId === sessionId && s.fase === fase && s.runtime === runtime)) {
    throw new Error('sessão não pertence à thread/fase/runtime informados');
  }
  const despachos = eventos.filter(e => e.tipo === 'phase_dispatch');
  const i = despachos.findIndex(e => e.sessionId === sessionId && e.fase === fase && e.runtime === runtime);
  const posterior = despachos.slice(i + 1).find(e => e.sessionId !== sessionId && e.fase === fase &&
    eventos.some(v => v.tipo === 'phase_dispatch_verified' && v.sessionId === e.sessionId && v.encontrada === true));
  if (i < 0 || !posterior) throw new Error('superação exige despacho posterior da mesma fase verificado no runtime');
  const ctl = controle ?? controleNativo(runtime, raiz, id, sessionId);
  const observar = () => {
    const r = ctl.consultar();
    if (!r.ok) throw new Error('runtime.unavailable: consulta falhou; alerta e sessão preservados');
    const matches = r.sessoes.filter(s => s.sessionId === sessionId);
    if (matches.length > 1) throw new Error('identidade ambígua no runtime');
    return matches[0];
  };
  const antes = observar();
  const recibo = eventos.filter(e => e.tipo === 'session_superseded' && e.sessionId === sessionId && e.fase === fase && e.runtime === runtime).at(-1);
  const terminou = (s: IdentidadeSessao | undefined) => !s || ['stopped', 'done', 'completed', 'exited'].includes(s.estado);
  if (recibo && terminou(antes)) return { ok: true, sessionId, repetida: true };
  if (!antes || antes.estado !== 'blocked' || antes.runtime !== runtime || !antes.instancia || !antes.cwd ||
      path.resolve(antes.cwd) !== path.resolve(t.worktree ?? raiz)) throw new Error('sessão bloqueada com identidade e cwd correspondentes não comprovada');
  const revalidada = observar();
  if (JSON.stringify(revalidada) !== JSON.stringify(antes)) throw new Error('identidade ou estado mudou antes do encerramento');
  registrar(dir, id, 'session_superseding', { fase, sessionId, runtime, instancia: antes.instancia, cwd: antes.cwd,
    superadaPor: posterior.sessionId, evidencia: 'duas consultas nativas concordam: mesma identidade, cwd e estado blocked',
    decididoPor: 'núcleo ork', razao: 'despacho posterior da mesma fase verificado; não encerrar sessão trabalhando' });
  if (!ctl.parar(antes)) throw new Error('runtime.unavailable: encerramento não confirmado; alerta preservado');
  const depois = observar();
  if (!terminou(depois) || depois && (depois.instancia !== antes.instancia || depois.cwd !== antes.cwd || depois.runtime !== runtime)) {
    throw new Error('runtime.unavailable: observação posterior não confirma encerramento da mesma instância');
  }
  registrar(dir, id, 'session_superseded', { fase, sessionId, runtime, instancia: antes.instancia, cwd: antes.cwd,
    confirmacao: depois?.estado ?? 'ausente',
    superadaPor: posterior.sessionId, evidencia: depois ? `runtime confirmou ${depois.estado}` : 'consulta nativa bem-sucedida confirmou ausência após stop',
    decididoPor: 'núcleo ork', razao: 'encerramento confirmado após comando oficial do runtime' });
  return { ok: true, sessionId, repetida: false };
}

export function superarSessao(raiz: string, id: string, sessionId: string, fase: Fase, runtime: string,
  controle?: ControleSessao): { ok: true; sessionId: string; repetida: boolean } {
  return comLockHitl(raiz, id, () => superarSobLock(raiz, id, sessionId, fase, runtime, controle));
}
