/**
 * RM-059 (fatia F9, T9.1; DD3 do plano dos mods, pela recomendada): a resposta do dono a uma sessao de fase
 * `claude-bg` parada sai pelo Mensageiro de Sessoes (o mod `ork-mensageiro`), com a conferencia pelo nucleo no
 * lado receptor. Contrato `ork.session-delivery/v1`.
 *
 * O caminho, de ponta a ponta:
 *
 *   1. `ork sessions request` abre o pedido de sessao vinculado ao turno que parou: o `uuid` da ultima mensagem do
 *      assistente na transcricao, com a sessao `blocked` no `claude agents` (G2 da thread ork-rm059mensag).
 *   2. A resposta entra pelo ingresso local do Claude Code (o dialogo nativo do `ork_request_decision`). O
 *      `entregarNaSessao` reserva como sempre, e o `enviar` deste controle grava `session_delivery_queued` com o
 *      sha256 do corpo e poe a mensagem na caixa de saida, que so existe na memoria do servidor MCP do dono (G3):
 *      o texto da resposta nunca vai a disco, como no resto do HITL.
 *   3. O Mensageiro da sessao do dono pega a mensagem pela `ork_session_outbox` e a leva por `$.session.send`.
 *   4. O Mensageiro da sessao de fase so deixa a mensagem chegar ao modelo depois que o nucleo confere, pela
 *      `ork_session_inbox` do servidor preso ao despacho, que ela e aquela entrega, para aquela sessao, com aquele
 *      texto, e a reserva uma vez so. Depois de a mensagem entrar na fila, a confirmacao grava o recibo do receptor
 *      e a reconciliacao de sempre grava o `session_answered`.
 *
 * O que isto NAO prova: a mensagem chega ao modelo como mensagem de outra sessao, e o classificador do modo auto do
 * Claude Code nao a le como intencao do dono. A resposta informa a sessao; ela nao destrava acao que so o dono
 * autoriza (para isso, `claude attach`). A reserva e o recibo ficam em disco com o uid dos agentes: um processo do
 * mesmo usuario que escreva em `.orkastery/` forja os dois, como forja o resto do estado.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ambienteDoPerfil, consultarSessoes, ConsultaDeSessoes } from './adapters/claude-bg';
import { PerguntaNativa, projetarPergunta } from './adapters/codex-question';
import { ambienteDeAssinatura } from './runtime-ambiente';
import { PerfilDeDespacho, perfilDoRegistro } from './runtime-profiles';
import { arquivoDaTranscricao } from './session-watcher-claude';
import { comLockHitl } from './hitl-gates';
import { redigirSegredos } from './hitl';
import { dirThread, lerThread } from './thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { exec } from './util';
import { EventoLedger } from './types';
import type { PedidoHitl } from './hitl-contract';
import type { ConfirmacaoSessao, ControleSessao, EntregaSessao, IdentidadeSessao, ResultadoReconciliacaoSessao } from './hitl-sessions';

export const CONTRATO_DA_ENTREGA = 'ork.session-delivery/v1';
/** O mod que leva a mensagem nas duas pontas (o mesmo nome do `plugin.json` dele). */
export const MOD_DA_ENTREGA = 'ork-mensageiro';
/** D9 da thread ork-rm059mensag: o Mensageiro conta como vivo se consultou a caixa nesta janela. */
export const JANELA_DO_MENSAGEIRO_MS = 120000;
/** A cauda da transcricao lida para achar o turno que parou, sem seguir link. */
export const LIMITE_DA_CAUDA = 256 * 1024;
/** A maior mensagem que o receptor confere: a resposta (ate 4096), o cabecalho e o envelope do Claude Code. */
export const LIMITE_DA_MENSAGEM = 8192;
/** O motivo de envio recusado que vai ao ledger, ja redigido. */
const LIMITE_DO_MOTIVO = 200;

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** Os motivos tipados da conferencia no receptor. */
export type MotivoDoReceptor = 'entrega.formato' | 'entrega.despacho' | 'entrega.desconhecida' | 'entrega.outra-sessao' |
  'entrega.texto-diferente' | 'entrega.respondida' | 'entrega.reservada' | 'entrega.turno-mudou' | 'entrega.sem-reserva' |
  'entrega.prazo';

// ---------------------------------------------------------------------------------------------------------------
// A mensagem (D5): o nucleo compoe e o nucleo confere; o mod so a carrega.
// ---------------------------------------------------------------------------------------------------------------

export function cabecalhoDaEntrega(pedidoId: string, envioId: string): string {
  return `[${CONTRATO_DA_ENTREGA} pedido=${pedidoId} entrega=${envioId}] Resposta do dono à pergunta deste turno, conferida pelo núcleo do Orkastery:`;
}

export function mensagemDaEntrega(pedidoId: string, envioId: string, resposta: string): string {
  return `${cabecalhoDaEntrega(pedidoId, envioId)}\n${resposta}`;
}

/** O corpo que o hash cobre: quebra de linha unica (LF) e sem o espaco do fim, nos dois lados. */
export function normalizarCorpo(texto: string): string {
  return texto.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

export function hashDoCorpo(texto: string): string {
  return sha(normalizarCorpo(texto));
}

/** Um valor de atributo do envelope: uma linha so, sem aspas nem sinal de tag. */
const VALOR_DE_LINHA = '[^"<>\\n\\r\\v\\f\\u0085\\u2028\\u2029]{1,200}';
/**
 * O envelope que o Claude Code 2.1.296 escreve em volta da mensagem de outra sessao, e so ele: os atributos que o motor
 * conhece, na ordem em que ele os escreve (`from`, `from-session`, `hop-chain`, `from-name`, `from-mode`,
 * `from-plugin`), cada valor numa linha so, depois a quebra de linha, o corpo e o fecho exato no fim. Qualquer outra
 * forma recusa (D5, D20 da thread ork-rm059mensag): texto posto dentro ou antes da tag chegaria ao modelo da fase sem
 * ter passado pelo nucleo, porque o receptor deixa a mensagem entrar como chegou.
 */
const ENVELOPE_DO_MOTOR = new RegExp('^<cross-session-message' +
  '(?: from="[^"<>\\s]{1,300}")?' +
  '(?: from-session="[A-Za-z0-9_-]{1,80}")?' +
  '(?: hop-chain="[0-9a-f]{24}(?:,[0-9a-f]{24}){0,31}")?' +
  `(?: from-name="${VALOR_DE_LINHA}")?` +
  '(?: from-mode="[A-Za-z-]{1,40}")?' +
  `(?: from-plugin="${VALOR_DE_LINHA}")?` +
  '>\\n([\\s\\S]*)\\n</cross-session-message>$');
const CABECALHO = /^\[ork\.session-delivery\/v1 pedido=([0-9a-f-]{36}) entrega=([0-9a-f-]{36})\] /;

/**
 * Le a mensagem que chegou ao receptor. Com o envelope `<cross-session-message ...>` do Claude Code, ele so passa na
 * forma exata que o motor escreve, e sai; depois disso, o cabecalho tem de ser a primeira linha e exatamente o que o
 * nucleo compoe. Qualquer texto a mais antes dele, dentro da tag ou na linha dele recusa: quem sabe a resposta nao poe
 * nada antes.
 */
export function lerMensagemDaEntrega(bruto: unknown): { pedidoId: string; envioId: string; corpo: string } | null {
  if (typeof bruto !== 'string' || bruto.length > LIMITE_DA_MENSAGEM) return null;
  let texto = bruto.replace(/\r\n?/g, '\n');
  if (texto.startsWith('<')) {
    const envelope = ENVELOPE_DO_MOTOR.exec(texto);
    if (!envelope) return null;
    texto = envelope[1];
  }
  const quebra = texto.indexOf('\n');
  if (quebra < 0) return null;
  const linha = texto.slice(0, quebra);
  const m = CABECALHO.exec(linha);
  if (!m || !UUID.test(m[1]) || !UUID.test(m[2]) || linha !== cabecalhoDaEntrega(m[1], m[2])) return null;
  return { pedidoId: m[1], envioId: m[2], corpo: texto.slice(quebra + 1) };
}

export function rotuloDaEntrega(pedidoId: string): string {
  return `Resposta do dono ao pedido ${pedidoId.slice(0, 8)}, conferida pelo núcleo`;
}

// ---------------------------------------------------------------------------------------------------------------
// O turno que parou (G2): a transcricao que o proprio Claude Code grava.
// ---------------------------------------------------------------------------------------------------------------

export interface TurnoQueParou { uuid: string; texto: string }

type LinhaDaConversa = { tipo: 'user' | 'assistant'; uuid: string; idDaMensagem: string | null; conteudo: unknown };

/**
 * As ultimas linhas `assistant` da conversa principal (as do mesmo `message.id`, porque o Claude Code grava uma
 * linha por bloco), sem linha `user` depois, com texto e sem `tool_use`: e o turno em que a sessao parou para
 * esperar o dono. Linha que nao e JSON (a primeira da cauda, cortada) e linha de metadado (`system`,
 * `last-prompt`, `cost-state`, ...) nao contam.
 */
export function turnoQueParou(cauda: string): TurnoQueParou | null {
  const conversa: LinhaDaConversa[] = [];
  for (const linha of cauda.split('\n')) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(linha) as Record<string, unknown>; } catch { continue; }
    if (!e || typeof e !== 'object' || Array.isArray(e) || (e.type !== 'user' && e.type !== 'assistant') || e.isSidechain === true) continue;
    const mensagem = e.message && typeof e.message === 'object' ? e.message as Record<string, unknown> : {};
    conversa.push({ tipo: e.type, uuid: typeof e.uuid === 'string' ? e.uuid.toLowerCase() : '',
      idDaMensagem: typeof mensagem.id === 'string' ? mensagem.id : null, conteudo: mensagem.content });
  }
  const fim = conversa.at(-1);
  if (!fim || fim.tipo !== 'assistant' || !UUID.test(fim.uuid)) return null;
  const trecho: LinhaDaConversa[] = [];
  for (let i = conversa.length - 1; i >= 0; i--) {
    const c = conversa[i];
    if (c.tipo !== 'assistant' || (i !== conversa.length - 1 && (fim.idDaMensagem === null || c.idDaMensagem !== fim.idDaMensagem))) break;
    trecho.unshift(c);
  }
  const blocos = trecho.flatMap((c): unknown[] => Array.isArray(c.conteudo) ? c.conteudo
    : typeof c.conteudo === 'string' ? [{ type: 'text', text: c.conteudo }] : []);
  const tipo = (b: unknown) => b && typeof b === 'object' ? (b as { type?: unknown }).type : undefined;
  if (blocos.some(b => tipo(b) === 'tool_use' || tipo(b) === 'server_tool_use')) return null;
  const textos = blocos.flatMap(b => {
    const t = b && typeof b === 'object' ? (b as { text?: unknown }).text : undefined;
    return tipo(b) === 'text' && typeof t === 'string' && t.trim() ? [t] : [];
  });
  return textos.length ? { uuid: fim.uuid, texto: textos.join('\n\n') } : null;
}

/** A cauda de um arquivo comum, sem seguir link e sem travar em FIFO; `null` quando nao ha o que ler. */
export function lerCaudaDaTranscricao(arquivo: string, limite = LIMITE_DA_CAUDA): string | null {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    const n = Math.min(st.size, limite), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, st.size - n);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

/** A pergunta nativa de texto livre do turno que parou, ou o codigo do que impede projeta-la. */
export function perguntaDoTurno(turno: TurnoQueParou): { pergunta: PerguntaNativa } | { codigo: 'pergunta.longa' | 'pergunta.invalida' } {
  const texto = turno.texto.replace(/\r\n?/g, '\n');
  try {
    return { pergunta: projetarPergunta({ isBlocking: true, questions: [{ id: turno.uuid, question: texto, isOther: true }] }) };
  } catch {
    return { codigo: texto.length > 2000 ? 'pergunta.longa' : 'pergunta.invalida' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A caixa de saida (G3): so na memoria do servidor MCP do dono que recebeu a resposta.
// ---------------------------------------------------------------------------------------------------------------

export interface EntradaDaCaixa {
  thread: string; pedidoId: string; envioId: string; fase: string; sessionId: string;
  /** A mensagem inteira, com o cabecalho: o texto que o Mensageiro leva sem mexer. */
  mensagem: string;
  criadaEm: string; tentativas: number;
  ultimoEnvio: { em: string; entregue: boolean; motivo: string | null } | null;
  /**
   * O receptor ja conferiu e reservou esta entrega (`session_delivery_reserved`): nada mais a enviar (D10). Sem
   * reserva, a mensagem que entrou na fila pode ir de novo depois da espera: o receptor reserva uma vez so.
   */
  reservada: boolean;
}

export interface CaixaDeSaida {
  /** O motivo de nao levar resposta agora (sem Mensageiro vivo), ou `null`. */
  impedimento: () => string | null;
  guardar: (e: Pick<EntradaDaCaixa, 'thread' | 'pedidoId' | 'envioId' | 'fase' | 'sessionId' | 'mensagem'>) => void;
  /** Marca o Mensageiro vivo e devolve o que ainda espera ir, com a reserva do receptor; o pedido respondido sai. */
  listar: (raiz: string) => EntradaDaCaixa[];
  /** Anota o resultado do `$.session.send` e grava `session_delivery_sent` na thread (sem a reserva, que o `listar` le). */
  anotarEnvio: (raiz: string, thread: string, envioId: string, entregue: boolean, motivo?: string) => Omit<EntradaDaCaixa, 'reservada'>;
}

export const SEM_CAIXA = 'runtime.unavailable: a resposta para a sessão claude-bg sai pelo Mensageiro de Sessões, pelo ' +
  'ingresso local do Claude Code (a Mesa ou o diálogo nativo); este processo não tem caixa de saída. Responda pela sessão ' +
  'do dono com o ork-mensageiro ligado, ou pelo claude attach';
export const SEM_MENSAGEIRO = 'runtime.unavailable: nenhum Mensageiro de Sessões consultou a caixa de saída desta sessão do ' +
  'dono nos últimos 120 s; ligue o mod ork-mensageiro nesta sessão, ou responda pelo claude attach';

export function novaCaixaDeSaida(agora: () => number = Date.now): CaixaDeSaida {
  const entradas = new Map<string, Omit<EntradaDaCaixa, 'reservada'>>();
  let consultadaEm = Number.NEGATIVE_INFINITY;
  return {
    impedimento: () => agora() - consultadaEm <= JANELA_DO_MENSAGEIRO_MS ? null : SEM_MENSAGEIRO,
    guardar: (e) => {
      if (entradas.has(e.envioId)) return;
      entradas.set(e.envioId, { ...e, criadaEm: new Date(agora()).toISOString(), tentativas: 0, ultimoEnvio: null });
    },
    listar: (raiz) => {
      consultadaEm = agora();
      const ledgers = new Map<string, EventoLedger[] | null>();
      const ledger = (thread: string) => {
        if (!ledgers.has(thread)) {
          try { ledgers.set(thread, lerLedger(dirThread(raiz, thread))); } catch { ledgers.set(thread, null); }
        }
        return ledgers.get(thread)!;
      };
      const saida: EntradaDaCaixa[] = [];
      for (const [id, e] of entradas) {
        const eventos = ledger(e.thread);
        // Respondido (ou a thread sumiu): a entrega acabou e sai da caixa. Thread fechada fica: o envio falha sozinho.
        if (eventos === null || eventos.some(x => x.tipo === 'session_answered' && x.pedidoId === e.pedidoId)) {
          entradas.delete(id);
          continue;
        }
        saida.push({ ...e, ultimoEnvio: e.ultimoEnvio && { ...e.ultimoEnvio },
          reservada: eventos.some(x => x.tipo === TIPOS_DE_EVENTO.entregaReservada && x.envioId === e.envioId) });
      }
      return saida;
    },
    anotarEnvio: (raiz, thread, envioId, entregue, motivo) => {
      const e = entradas.get(envioId);
      if (!e || e.thread !== thread) throw new Error('entrega.desconhecida: esta caixa de saída não tem essa entrega');
      const limpo = motivo === undefined ? null : redigirSegredos(motivo.replace(/\s+/g, ' ').trim()).slice(0, LIMITE_DO_MOTIVO);
      e.tentativas += 1;
      e.ultimoEnvio = { em: new Date(agora()).toISOString(), entregue, motivo: limpo };
      registrar(dirThread(raiz, thread), thread, TIPOS_DE_EVENTO.entregaEnviada, { pedidoId: e.pedidoId, fase: e.fase,
        sessionId: e.sessionId, envioId, entregue, motivo: limpo, via: MOD_DA_ENTREGA, tentativa: e.tentativas });
      return { ...e, ultimoEnvio: { ...e.ultimoEnvio } };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// O disco do receptor (D6): a reserva e o recibo, sem o texto.
// ---------------------------------------------------------------------------------------------------------------

export function pastaDasEntregas(raiz: string, thread: string): string {
  return path.join(dirThread(raiz, thread), 'entregas-de-sessao');
}

function garantirPasta(raiz: string, thread: string): string {
  const pasta = pastaDasEntregas(raiz, thread);
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(pasta);
  if (!st.isDirectory() || st.isSymbolicLink() || (process.getuid && st.uid !== process.getuid()) || (st.mode & 0o077))
    throw new Error('runtime.unavailable: a pasta entregas-de-sessao precisa ser 0700 do usuário do núcleo');
  return pasta;
}

/** Grava o arquivo uma vez so (criacao exclusiva). `false` quando ele ja existia. */
function escreverUmaVez(arquivo: string, dados: unknown): boolean {
  let fd: number;
  try { fd = fs.openSync(arquivo, 'wx', 0o600); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
  try { fs.writeFileSync(fd, JSON.stringify(dados)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return true;
}

/** Le um JSON privado da pasta: arquivo comum, sem link, do usuario do nucleo e sem permissao para outros. */
function lerPrivado(arquivo: string): Record<string, unknown> | null {
  try {
    const st = fs.lstatSync(arquivo);
    if (!st.isFile() || st.isSymbolicLink() || (process.getuid && st.uid !== process.getuid()) || (st.mode & 0o077)) return null;
    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as unknown;
    return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto as Record<string, unknown> : null;
  } catch { return null; }
}

const mesmaInstancia = (a: IdentidadeSessao | undefined, b: IdentidadeSessao | undefined) => !!a && !!b &&
  a.sessionId === b.sessionId && a.runtime === b.runtime && a.cwd === b.cwd && a.instancia === b.instancia && a.bloqueio === b.bloqueio;

// ---------------------------------------------------------------------------------------------------------------
// O controle de sessao claude-bg por mod.
// ---------------------------------------------------------------------------------------------------------------

export interface DependenciasDaEntrega {
  /** A consulta ao `claude agents --json --all` com o ambiente do perfil; por omissao, a do adaptador. */
  consultarAgentes?: (ambiente: NodeJS.ProcessEnv, prazoMs: number) => ConsultaDeSessoes;
  /** A cauda da transcricao de uma sessao; por omissao, a do arquivo do perfil. */
  lerTranscricao?: (perfil: PerfilDeDespacho | null, cwd: string, sessionId: string) => string | null;
  /** O relogio do receptor (ms desde a epoca); por omissao, `Date.now`. */
  agora?: () => number;
}

/** O prazo mais longo que o receptor aceita no `ate` da conferencia: o mod pede bem menos (15 s). */
export const PRAZO_MAXIMO_DA_CONFERENCIA_MS = 60000;

const lerTranscricaoPadrao = (perfil: PerfilDeDespacho | null, cwd: string, sessionId: string): string | null => {
  const arquivo = arquivoDaTranscricao(perfil, cwd, sessionId);
  return arquivo ? lerCaudaDaTranscricao(arquivo) : null;
};

function perfilDaSessao(raiz: string, thread: string, sessionId: string, eventos: EventoLedger[]): PerfilDeDespacho | null {
  const registrada = lerThread(raiz, thread).sessoes.find(s => s.sessionId === sessionId && s.runtime === 'claude-bg');
  return perfilDoRegistro(eventos, { sessionId, despachadaEm: registrada?.despachadaEm });
}

/**
 * O controle de resposta de sessao `claude-bg` (D2): consulta e para como o adaptador, com o ambiente do perfil da
 * sessao; o vinculo do turno sai da transcricao; o envio poe a mensagem na caixa de saida e o recibo e o do
 * receptor. Sem caixa no processo (o CLI, o Telegram), o controle declara o impedimento e o nucleo recusa antes de
 * reservar (D4).
 */
export function controleClaudeBgPorMod(raiz: string, thread: string, sessionId: string, caixa: CaixaDeSaida | null | undefined,
  deps: DependenciasDaEntrega = {}): ControleSessao {
  const eventos = lerLedger(dirThread(raiz, thread));
  const perfil = perfilDaSessao(raiz, thread, sessionId, eventos);
  const ambiente = perfil ? ambienteDoPerfil(perfil) : ambienteDeAssinatura();
  const consultarAgentes = deps.consultarAgentes ?? ((env: NodeJS.ProcessEnv, prazoMs: number) => consultarSessoes(undefined, true, env, prazoMs));
  const lerTranscricao = deps.lerTranscricao ?? lerTranscricaoPadrao;
  return {
    consultar: (orcamentoMs = 60000) => {
      const r = consultarAgentes(ambiente, Math.max(1, Math.min(60000, orcamentoMs)));
      if (!r.ok) return { ok: false, sessoes: [] };
      return { ok: true, sessoes: r.sessoes.map((s): IdentidadeSessao => {
        const base: IdentidadeSessao = { sessionId: s.sessionId, runtime: 'claude-bg', cwd: s.cwd ?? '', estado: s.state ?? s.status ?? '',
          instancia: s.id && Number.isFinite(s.startedAt) ? JSON.stringify([s.id, s.startedAt]) : '' };
        if (s.sessionId !== sessionId || base.estado !== 'blocked' || !base.cwd) return base;
        const cauda = lerTranscricao(perfil, base.cwd, sessionId);
        const turno = cauda === null ? null : turnoQueParou(cauda);
        if (!turno) return { ...base, limitacao: { motivo: 'runtime.unavailable', codigo: 'turno.ausente', metodo: 'transcricao' } };
        const projetada = perguntaDoTurno(turno);
        return 'pergunta' in projetada ? { ...base, bloqueio: turno.uuid, perguntaNativa: projetada.pergunta }
          : { ...base, bloqueio: turno.uuid, limitacao: { motivo: 'runtime.unavailable', codigo: projetada.codigo, metodo: 'transcricao' } };
      }) };
    },
    parar: s => exec('claude', ['stop', s.sessionId], undefined, 10000, ambiente).ok,
    enviar: (e: EntregaSessao) => {
      if (!caixa) throw new Error(SEM_CAIXA);
      registrar(dirThread(raiz, thread), thread, TIPOS_DE_EVENTO.entregaNaFila, { contrato: CONTRATO_DA_ENTREGA, pedidoId: e.pedidoId,
        fase: e.fase, sessionId: e.sessao.sessionId, runtime: 'claude-bg', envioId: e.envioId, instancia: e.sessao.instancia,
        bloqueio: e.sessao.bloqueio, textoSha256: hashDoCorpo(e.resposta), transporte: 'mod', via: MOD_DA_ENTREGA });
      caixa.guardar({ thread, pedidoId: e.pedidoId, envioId: e.envioId, fase: e.fase, sessionId: e.sessao.sessionId,
        mensagem: mensagemDaEntrega(e.pedidoId, e.envioId, e.resposta) });
    },
    confirmar: (e) => {
      if (!UUID.test(e.envioId)) return null;
      const r = lerPrivado(path.join(pastaDasEntregas(raiz, thread), `${e.envioId}.recibo.json`));
      if (!r || r.contrato !== 'ork.session-answer/v1' || r.estado !== 'recebida' || r.envioId !== e.envioId ||
          r.pedidoId !== e.pedidoId || r.thread !== thread || r.fase !== e.fase || r.recibo !== e.recibo ||
          !mesmaInstancia(r.sessao as IdentidadeSessao | undefined, e.sessao)) return null;
      return r as unknown as ConfirmacaoSessao;
    },
    assincrono: true,
    impedimentoDoEnvio: () => (caixa ? caixa.impedimento() : SEM_CAIXA),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// O lado receptor: a conferencia e a confirmacao pela `ork_session_inbox` do servidor preso ao despacho.
// ---------------------------------------------------------------------------------------------------------------

export type ConferenciaNoReceptor =
  | { confirmada: true; pedidoId: string; envioId: string; rotulo: string }
  | { confirmada: false; motivo: MotivoDoReceptor };

export type ConfirmacaoNoReceptor =
  | { ok: boolean; estado: 'entregue' | 'pendente'; pedidoId: string; envioId: string; repetida: boolean;
      prova: ResultadoReconciliacaoSessao['prova'] }
  | { ok: false; estado: 'recusada'; motivo: MotivoDoReceptor };

interface ContextoDoReceptor {
  sessionId: string; pedido: PedidoHitl; sessao: IdentidadeSessao; envio: EventoLedger; textoSha256: string;
  perfil: PerfilDeDespacho | null; respondida: boolean;
}

/** O que o ledger diz da entrega lida, para a sessao do despacho deste servidor; o motivo quando nao bate. */
function contextoDoReceptor(raiz: string, thread: string, dispatchId: string,
  lida: { pedidoId: string; envioId: string; corpo: string }): ContextoDoReceptor | { motivo: MotivoDoReceptor } {
  const eventos = lerLedger(dirThread(raiz, thread));
  const despachos = eventos.filter(e => e.tipo === 'phase_dispatch' &&
    (e.identidade as { dispatchId?: unknown } | undefined)?.dispatchId === dispatchId);
  const despacho = despachos[0];
  if (despachos.length !== 1 || despacho.runtime !== 'claude-bg' || typeof despacho.sessionId !== 'string' ||
      !UUID.test(despacho.sessionId)) return { motivo: 'entrega.despacho' };
  const sessionId = despacho.sessionId;
  const filas = eventos.filter(e => e.tipo === TIPOS_DE_EVENTO.entregaNaFila && e.envioId === lida.envioId);
  if (filas.length !== 1 || filas[0].pedidoId !== lida.pedidoId) return { motivo: 'entrega.desconhecida' };
  if (filas[0].sessionId !== sessionId) return { motivo: 'entrega.outra-sessao' };
  const textoSha256 = hashDoCorpo(lida.corpo);
  if (filas[0].textoSha256 !== textoSha256) return { motivo: 'entrega.texto-diferente' };
  const envios = eventos.filter(e => e.tipo === 'session_answer_sending' && e.pedidoId === lida.pedidoId);
  if (envios.length !== 1 || envios[0].envioId !== lida.envioId) return { motivo: 'entrega.desconhecida' };
  const solicitado = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl | undefined)?.id === lida.pedidoId);
  const pedido = solicitado?.pedido as PedidoHitl | undefined;
  const sessao = solicitado?.sessao as IdentidadeSessao | undefined;
  if (!pedido || pedido.thread !== thread || pedido.alvo?.tipo !== 'session' || pedido.alvo.sessionId !== sessionId ||
      pedido.alvo.runtime !== 'claude-bg' || !sessao || sessao.sessionId !== sessionId || !sessao.bloqueio) return { motivo: 'entrega.outra-sessao' };
  return { sessionId, pedido, sessao, envio: envios[0], textoSha256, perfil: perfilDaSessao(raiz, thread, sessionId, eventos),
    respondida: eventos.some(e => e.tipo === 'session_answered' && e.pedidoId === lida.pedidoId) };
}

/**
 * Confere e reserva, uma vez so, a entrega que chegou a sessao do despacho deste servidor. A sessao sai do
 * despacho (`phase_dispatch` com o `dispatchId` do servidor), nunca de argumento; antes de reservar, a transcricao
 * tem de seguir no turno do pedido (D7), para uma resposta velha nao entrar num turno que andou. Com `ate` (o prazo
 * que o mod da a conferencia, D21), o receptor so reserva antes dele: a conferencia que chega depois de o mod ter
 * desistido e consumido a mensagem nao deixa uma reserva sem ninguem para confirma-la.
 */
export function conferirNoReceptor(raiz: string, thread: string, dispatchId: string, texto: unknown, ate?: unknown,
  deps: DependenciasDaEntrega = {}): ConferenciaNoReceptor {
  const agora = deps.agora ?? Date.now;
  const prazo = ate === undefined ? null : typeof ate === 'string' ? Date.parse(ate) : NaN;
  if (prazo !== null && !(Number.isFinite(prazo) && prazo - agora() <= PRAZO_MAXIMO_DA_CONFERENCIA_MS)) {
    return { confirmada: false, motivo: 'entrega.formato' };
  }
  const lida = lerMensagemDaEntrega(texto);
  if (!lida) return { confirmada: false, motivo: 'entrega.formato' };
  return comLockHitl(raiz, thread, (): ConferenciaNoReceptor => {
    const ctx = contextoDoReceptor(raiz, thread, dispatchId, lida);
    if ('motivo' in ctx) return { confirmada: false, motivo: ctx.motivo };
    if (ctx.respondida) return { confirmada: false, motivo: 'entrega.respondida' };
    const cauda = (deps.lerTranscricao ?? lerTranscricaoPadrao)(ctx.perfil, ctx.sessao.cwd, ctx.sessionId);
    const turno = cauda === null ? null : turnoQueParou(cauda);
    if (!turno || turno.uuid !== ctx.sessao.bloqueio) return { confirmada: false, motivo: 'entrega.turno-mudou' };
    // O prazo e conferido aqui, dentro da trava e logo antes de reservar: a espera pela trava tambem conta.
    if (prazo !== null && agora() > prazo) return { confirmada: false, motivo: 'entrega.prazo' };
    const reservadaEm = new Date(agora()).toISOString();
    if (!escreverUmaVez(path.join(garantirPasta(raiz, thread), `${lida.envioId}.reserva.json`), { contrato: CONTRATO_DA_ENTREGA,
      envioId: lida.envioId, pedidoId: lida.pedidoId, sessionId: ctx.sessionId, dispatchId, textoSha256: ctx.textoSha256, reservadaEm }))
      return { confirmada: false, motivo: 'entrega.reservada' };
    registrar(dirThread(raiz, thread), thread, TIPOS_DE_EVENTO.entregaReservada, { pedidoId: lida.pedidoId, fase: ctx.pedido.fase,
      sessionId: ctx.sessionId, envioId: lida.envioId, dispatchId, textoSha256: ctx.textoSha256 });
    return { confirmada: true, pedidoId: lida.pedidoId, envioId: lida.envioId, rotulo: rotuloDaEntrega(lida.pedidoId) };
  });
}

/**
 * Confirma, depois de a mensagem entrar na fila do modelo, a entrega que este despacho reservou: grava o recibo do
 * receptor (o `ConfirmacaoSessao` que o controle por mod le) e, fora da trava, a reconciliacao de sempre grava o
 * `session_answered`. O turno nao e conferido de novo aqui: a mensagem ja entrou, e a reserva prova a conferencia.
 */
export function confirmarNoReceptor(raiz: string, thread: string, dispatchId: string, envioId: unknown, texto: unknown,
  deps: DependenciasDaEntrega = {}): ConfirmacaoNoReceptor {
  const lida = lerMensagemDaEntrega(texto);
  if (!lida || lida.envioId !== envioId) return { ok: false, estado: 'recusada', motivo: 'entrega.formato' };
  const preparo = comLockHitl(raiz, thread, (): { sessionId: string } | { motivo: MotivoDoReceptor } => {
    const ctx = contextoDoReceptor(raiz, thread, dispatchId, lida);
    if ('motivo' in ctx) return ctx;
    const reserva = lerPrivado(path.join(pastaDasEntregas(raiz, thread), `${lida.envioId}.reserva.json`));
    if (!reserva || reserva.contrato !== CONTRATO_DA_ENTREGA || reserva.envioId !== lida.envioId || reserva.pedidoId !== lida.pedidoId ||
        reserva.sessionId !== ctx.sessionId || reserva.dispatchId !== dispatchId || reserva.textoSha256 !== ctx.textoSha256)
      return { motivo: 'entrega.sem-reserva' };
    const recibo: ConfirmacaoSessao = { contrato: 'ork.session-answer/v1', envioId: lida.envioId, pedidoId: lida.pedidoId, thread,
      fase: ctx.pedido.fase, sessao: ctx.sessao, recibo: String(ctx.envio.recibo), estado: 'recebida' };
    escreverUmaVez(path.join(garantirPasta(raiz, thread), `${lida.envioId}.recibo.json`), recibo);
    return { sessionId: ctx.sessionId };
  });
  if ('motivo' in preparo) return { ok: false, estado: 'recusada', motivo: preparo.motivo };
  // Carregado na chamada: `hitl-sessions` importa este modulo para o controle de resposta.
  const { reconciliarEnvioDeSessao } = require('./hitl-sessions') as typeof import('./hitl-sessions');
  const r = reconciliarEnvioDeSessao(raiz, thread, lida.pedidoId, controleClaudeBgPorMod(raiz, thread, preparo.sessionId, null, deps));
  return { ok: r.ok, estado: r.estado, pedidoId: lida.pedidoId, envioId: lida.envioId, repetida: r.repetida, prova: r.prova };
}
