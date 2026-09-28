/** Recibo durável do callback MCP local, autenticado por chave fora das threads. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { dirThread } from './thread';
import { EventoLedger } from './types';
import { lerLedger } from './ledger';
import { alvoDoPedido, escolhasDoPedido, PedidoHitl, PedidoHitlQualquer, validarPedidoHitl,
  VereditoGate, vereditoDoGate } from './hitl-contract';
import { reciboDoMaterial } from './hitl-local-atestado';

export interface AtestacaoLocal {
  raiz: string; thread: string; pedidoId: string; contexto: string; pedidoSha256: string;
  host: 'claude-code' | 'codex'; connectionId: string; requestId: string;
  /** A resposta literal do humano: numero de opcao OU texto livre de uma pergunta nativa. */
  opcao: string; recebidoEm: string;
  /** D12: `gate` decide o bloco; `session` responde a pergunta nativa de uma sessao. */
  alvo?: 'gate' | 'session';
}

/** D12: o recibo de uma resposta de sessao entregue pelo canal MCP local. */
interface DadosReciboLocalSessao {
  contrato: 'ork.hitl-local-session/v1'; thread: string; pedidoId: string;
  contexto: string; pedidoSha256: string; host: 'claude-code' | 'codex';
  connectionId: string; requestId: string; recebidoEm: string;
  fase: string; sessionId: string; runtime: string; instancia: string; bloqueio: string;
  envioId: string; estado: 'entregue';
  /** O corpo respondido nunca entra no artefato; so o seu hash. */
  respostaSha256: string;
  /** O recibo que o receptor confirmou, derivado do mesmo hash de resposta. */
  reciboEntrega: string;
}

interface DadosReciboLocal {
  contrato: 'ork.hitl-local-ingress/v1'; thread: string; pedidoId: string;
  contexto: string; pedidoSha256: string; host: 'claude-code' | 'codex';
  connectionId: string; requestId: string; recebidoEm: string;
  fase: VereditoGate['fase']; sobre: string; estado: VereditoGate['estado']; opcao: number | null;
}

const sha = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
const uid = (): number => {
  const atual = process.getuid?.();
  if (atual === undefined) throw new Error('hitl.local.evidencia-invalida');
  return atual;
};

function validarDiretorio(file: string, modo: number): fs.Stats {
  const st = fs.lstatSync(file);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid() || (st.mode & 0o777) !== modo ||
      fs.realpathSync(file) !== file) throw new Error('hitl.local.evidencia-invalida');
  return st;
}

function diretorioPrivado(file: string): fs.Stats {
  try { fs.mkdirSync(file, { mode: 0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  return validarDiretorio(file, 0o700);
}

function chaveLocal(raiz: string, criar: boolean): Buffer {
  const estado = path.join(raizDoEstado(raiz), '.orkastery');
  const stEstado = fs.lstatSync(estado);
  if (!stEstado.isDirectory() || stEstado.isSymbolicLink() || fs.realpathSync(estado) !== estado) {
    throw new Error('hitl.local.chave-invalida');
  }
  const pasta = path.join(estado, 'private');
  const pastaSt = criar ? diretorioPrivado(pasta) : validarDiretorio(pasta, 0o700);
  const dfd = fs.openSync(pasta, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const file = `/proc/self/fd/${dfd}/hitl-local-signing.key`;
  try {
    if (criar) {
      const temp = `/proc/self/fd/${dfd}/.${randomUUID()}.tmp`;
      try {
        const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT |
          fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        try {
          fs.writeFileSync(fd, randomBytes(32).toString('hex') + '\n');
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        try { fs.linkSync(temp, file); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
        finally { fs.unlinkSync(temp); }
        fs.fsyncSync(dfd);
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd), atual = fs.lstatSync(pasta);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== uid() || (st.mode & 0o777) !== 0o600 ||
          atual.dev !== pastaSt.dev || atual.ino !== pastaSt.ino) throw new Error('hitl.local.chave-invalida');
      const raw = fs.readFileSync(fd, 'utf8');
      if (!/^[a-f0-9]{64}\n$/.test(raw)) throw new Error('hitl.local.chave-invalida');
      return Buffer.from(raw.trim(), 'hex');
    } finally { fs.closeSync(fd); }
  } finally { fs.closeSync(dfd); }
}

const assinatura = (chave: Buffer, dados: DadosReciboLocal | DadosReciboLocalSessao): string =>
  createHmac('sha256', chave).update(JSON.stringify(dados)).digest('hex');

function referencia(thread: string, nome: string): string {
  return `.orkastery/threads/${thread}/hitl-ingress-local/${nome}`;
}

function lerRecibo<D>(raiz: string, thread: string, nome: string): { bytes: Buffer; dados: D; assinatura: string } {
  const pasta = path.join(dirThread(raiz, thread), 'hitl-ingress-local');
  const pastaSt = validarDiretorio(pasta, 0o700);
  const dfd = fs.openSync(pasta, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const fd = fs.openSync(`/proc/self/fd/${dfd}/${nome}`, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd), atual = fs.lstatSync(pasta);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== uid() || (st.mode & 0o777) !== 0o600 ||
          atual.dev !== pastaSt.dev || atual.ino !== pastaSt.ino) throw new Error('hitl.local.evidencia-invalida');
      const bytes = fs.readFileSync(fd);
      const recibo = JSON.parse(bytes.toString('utf8')) as { dados?: D; assinatura?: string };
      if (!recibo.dados || !/^[a-f0-9]{64}$/.test(recibo.assinatura ?? '') ||
          Object.keys(recibo).sort().join(',') !== 'assinatura,dados') throw new Error('hitl.local.evidencia-invalida');
      return { bytes, dados: recibo.dados, assinatura: recibo.assinatura! };
    } finally { fs.closeSync(fd); }
  } finally { fs.closeSync(dfd); }
}

/** O nome do recibo e determinado pela conexao e pela solicitacao, nunca pelo conteudo. */
const nomeDoRecibo = (a: AtestacaoLocal): string =>
  sha(JSON.stringify([a.connectionId, a.requestId])) + '.json';

/**
 * Escrita atomica e conferida do recibo assinado. Extraida porque gate e sessao gravam a
 * mesma coisa em lugares diferentes do contrato: duplicar aqui seria duplicar o cofre.
 */
function gravarRecibo<D extends DadosReciboLocal | DadosReciboLocalSessao>(
  raiz: string, thread: string, nome: string, dados: D
): { arquivo: string; sha256: string; recibo: string } {
  const chave = chaveLocal(raiz, true);
  const pasta = path.join(dirThread(raiz, thread), 'hitl-ingress-local');
  const pastaSt = diretorioPrivado(pasta);
  const sig = assinatura(chave, dados), bytes = Buffer.from(JSON.stringify({ dados, assinatura: sig }) + '\n');
  const dfd = fs.openSync(pasta, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const file = `/proc/self/fd/${dfd}/${nome}`;
    const temp = `/proc/self/fd/${dfd}/.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT |
        fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      try { fs.linkSync(temp, file); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      finally { fs.unlinkSync(temp); }
      fs.fsyncSync(dfd);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const atual = fs.lstatSync(pasta);
    if (atual.dev !== pastaSt.dev || atual.ino !== pastaSt.ino) throw new Error('hitl.local.evidencia-invalida');
  } finally { fs.closeSync(dfd); }
  const lido = lerRecibo<D>(raiz, thread, nome);
  if (!lido.bytes.equals(bytes)) throw new Error('hitl.local.evidencia-invalida');
  return { arquivo: referencia(thread, nome), sha256: sha(bytes), recibo: sha(sig) };
}

/** Persiste a decisão normalizada que já entra no ledger; nunca o texto bruto respondido. */
export function gravarEvidenciaLocal(atestado: AtestacaoLocal, veredito: VereditoGate): { arquivo: string; sha256: string; recibo: string } {
  const dados: DadosReciboLocal = { contrato: 'ork.hitl-local-ingress/v1', thread: atestado.thread,
    pedidoId: atestado.pedidoId, contexto: atestado.contexto, pedidoSha256: atestado.pedidoSha256,
    host: atestado.host, connectionId: atestado.connectionId, requestId: atestado.requestId,
    recebidoEm: atestado.recebidoEm, ...veredito };
  return gravarRecibo(atestado.raiz, atestado.thread, nomeDoRecibo(atestado), dados);
}

/** D12: resposta de SESSAO pelo canal MCP local. Guarda o hash da resposta, nunca o texto. */
export interface EntregaLocalDeSessao {
  fase: string; sessionId: string; runtime: string; instancia: string; bloqueio: string; envioId: string;
}

export function gravarEvidenciaLocalSessao(atestado: AtestacaoLocal, entrega: EntregaLocalDeSessao): { arquivo: string; sha256: string; recibo: string } {
  const dados: DadosReciboLocalSessao = { contrato: 'ork.hitl-local-session/v1', thread: atestado.thread,
    pedidoId: atestado.pedidoId, contexto: atestado.contexto, pedidoSha256: atestado.pedidoSha256,
    host: atestado.host, connectionId: atestado.connectionId, requestId: atestado.requestId,
    recebidoEm: atestado.recebidoEm, ...entrega, estado: 'entregue', respostaSha256: sha(atestado.opcao),
    reciboEntrega: reciboDoMaterial(atestado.connectionId, atestado.requestId, atestado.pedidoSha256, sha(atestado.opcao)) };
  return gravarRecibo(atestado.raiz, atestado.thread, nomeDoRecibo(atestado), dados);
}

/** Revalida no sync o recibo de uma resposta de sessao entregue pelo canal MCP local. */
export function validarEvidenciaLocalSessao(raiz: string, thread: string, evento: EventoLedger): boolean {
  try {
    if (evento.tipo !== 'session_answered' || evento.origem !== 'mcp-local' ||
        !['mcp-local:codex', 'mcp-local:claude-code'].includes(String(evento.autorizadoPor)) ||
        typeof evento.pedidoId !== 'string' || typeof evento.contexto !== 'string' ||
        typeof evento.pedidoSha256 !== 'string' || typeof evento.conexao !== 'string' ||
        typeof evento.solicitacao !== 'string' || typeof evento.recebidoEm !== 'string' ||
        typeof evento.envioId !== 'string' || typeof evento.evidencia !== 'string' ||
        !/^[a-f0-9]{64}$/.test(String(evento.evidenciaSha256 ?? ''))) return false;
    const host = String(evento.autorizadoPor).slice('mcp-local:'.length) as 'claude-code' | 'codex';
    // `canal` e `contratoResposta` sao campos publicos do evento: se nao forem conferidos
    // contra o host que assinou, da para adulterar o canal do recibo sem reprovar nada.
    if (evento.canal !== host || evento.contratoResposta !== 'ork.hitl-local-session/v1') return false;
    const nome = sha(JSON.stringify([evento.conexao, evento.solicitacao])) + '.json';
    if (evento.evidencia !== referencia(thread, nome)) return false;
    const lido = lerRecibo<DadosReciboLocalSessao>(raiz, thread, nome);
    const eventos = lerLedger(dirThread(raiz, thread));
    const solicitados = eventos.filter(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl | undefined)?.id === evento.pedidoId);
    const respostas = eventos.filter(e => e.tipo === 'session_answered' && e.pedidoId === evento.pedidoId);
    if (solicitados.length !== 1 || respostas.length !== 1 || JSON.stringify(respostas[0]) !== JSON.stringify(evento)) return false;
    const pedido = solicitados[0].pedido as PedidoHitl;
    validarPedidoHitl(pedido);
    if (pedido.thread !== thread || pedido.alvo.tipo !== 'session' ||
        sha(JSON.stringify(pedido)) !== evento.pedidoSha256 ||
        pedido.alvo.sessionId !== evento.sessionId || pedido.alvo.runtime !== evento.runtime) return false;
    const esperado: DadosReciboLocalSessao = { contrato: 'ork.hitl-local-session/v1', thread,
      pedidoId: evento.pedidoId, contexto: evento.contexto, pedidoSha256: evento.pedidoSha256,
      host, connectionId: evento.conexao, requestId: evento.solicitacao, recebidoEm: evento.recebidoEm,
      fase: String(evento.fase), sessionId: String(evento.sessionId), runtime: String(evento.runtime),
      instancia: String(evento.instancia), bloqueio: String(evento.bloqueio), envioId: evento.envioId,
      estado: 'entregue', respostaSha256: String(lido.dados.respostaSha256),
      reciboEntrega: reciboDoMaterial(String(evento.conexao), String(evento.solicitacao),
        String(evento.pedidoSha256), String(lido.dados.respostaSha256)) };
    // O recibo confirmado pelo receptor tem de derivar do MESMO hash de resposta: sem isso
    // o recibo provaria so que alguem respondeu daquela conexao, nunca o que ele recebeu.
    if (evento.reciboEntrega !== esperado.reciboEntrega) return false;
    const sig = assinatura(chaveLocal(raiz, false), esperado);
    return JSON.stringify(lido.dados) === JSON.stringify(esperado) &&
      timingSafeEqual(Buffer.from(lido.assinatura, 'hex'), Buffer.from(sig, 'hex')) &&
      evento.evidenciaSha256 === sha(lido.bytes) && evento.recibo === sha(lido.assinatura);
  } catch { return false; }
}

/** Revalida no sync a prova criptográfica e o vínculo exato entre recibo e ledger. */
export function validarEvidenciaLocal(raiz: string, thread: string, evento: EventoLedger): boolean {
  try {
    if (evento.origem !== 'mcp-local' || evento.proveniencia !== 'ork.mcp-elicitation/v1' ||
        !['mcp-local:codex', 'mcp-local:claude-code'].includes(String(evento.autorizadoPor)) ||
        typeof evento.pedidoId !== 'string' || typeof evento.contexto !== 'string' ||
        typeof evento.pedidoSha256 !== 'string' || typeof evento.conexao !== 'string' ||
        typeof evento.solicitacao !== 'string' || typeof evento.recebidoEm !== 'string' ||
        !Number.isInteger(evento.opcao) || typeof evento.evidencia !== 'string' ||
        !/^[a-f0-9]{64}$/.test(String(evento.evidenciaSha256 ?? '')) ||
        !/^[a-f0-9]{64}$/.test(String(evento.recibo ?? ''))) return false;
    const host = String(evento.autorizadoPor).slice('mcp-local:'.length) as 'claude-code' | 'codex';
    if (evento.canal !== host || evento.contratoResposta !== 'ork.mcp-elicitation/v1') return false;
    const nome = sha(JSON.stringify([evento.conexao, evento.solicitacao])) + '.json';
    if (evento.evidencia !== referencia(thread, nome)) return false;
    const lido = lerRecibo<DadosReciboLocal>(raiz, thread, nome);
    const eventos = lerLedger(dirThread(raiz, thread));
    const solicitados = eventos.filter(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl | undefined)?.id === evento.pedidoId);
    const gates = eventos.filter(e => e.tipo === 'human_gate' && e.pedidoId === evento.pedidoId);
    if (solicitados.length !== 1 || gates.length !== 1 || JSON.stringify(gates[0]) !== JSON.stringify(evento) || Object.hasOwn(evento, 'observacao')) return false;
    const pedido = solicitados[0].pedido as PedidoHitlQualquer;
    validarPedidoHitl(pedido);
    const escolhas = escolhasDoPedido(pedido);
    if (pedido.thread !== thread || alvoDoPedido(pedido)?.tipo !== 'gate' || sha(JSON.stringify(pedido)) !== evento.pedidoSha256 ||
        escolhas.every(o => o.numero !== evento.opcao)) return false;
    const opcao = escolhas.find(o => o.numero === evento.opcao)!;
    const veredito = vereditoDoGate(pedido, opcao);
    if (evento.fase !== veredito.fase || evento.sobre !== veredito.sobre || evento.estado !== veredito.estado) return false;
    const esperado: DadosReciboLocal = { contrato: 'ork.hitl-local-ingress/v1', thread,
      pedidoId: evento.pedidoId, contexto: evento.contexto, pedidoSha256: evento.pedidoSha256,
      host, connectionId: evento.conexao, requestId: evento.solicitacao,
      recebidoEm: evento.recebidoEm, ...veredito };
    const sig = assinatura(chaveLocal(raiz, false), esperado);
    return JSON.stringify(lido.dados) === JSON.stringify(esperado) &&
      timingSafeEqual(Buffer.from(lido.assinatura, 'hex'), Buffer.from(sig, 'hex')) &&
      evento.evidenciaSha256 === sha(lido.bytes) && evento.recibo === sha(lido.assinatura);
  } catch { return false; }
}
