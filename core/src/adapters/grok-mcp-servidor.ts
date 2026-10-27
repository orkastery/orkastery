/**
 * RM-067 (F4c, thread ork-rm067f4cmcpd): o servidor MCP do `ork` da sessão filha do `grok`, num processo do `ork`, fora do
 * sandbox do `grok`. O despacho o lança antes do `grok` (`iniciarServidorDoGrok`, em `grok-mcp.ts`); o `grok` se conecta
 * pela forma `url` do guia oficial (G16), e o sandbox dele, que vale para ele e os filhos (G17), não chega aqui.
 *
 *   - D1: Streamable HTTP do SDK, com sessão e resposta JSON, só em 127.0.0.1, porta efêmera, caminho `/mcp`;
 *   - D2: token de 256 bits do despacho, que chega só no ambiente; e, com o `grok` no sandbox, a conexão tem de vir da
 *     árvore de processos do `grok` deste despacho (GO-FIX 2, R1): o token vazado pela saída de uma ferramenta não serve
 *     a outro processo;
 *   - D3: endereço, caminho, `Host`, `Origin`, token e método conferidos antes de tudo (`recusaDaRequisicao`);
 *   - D4: só as ferramentas do `--allow` deste despacho, pela opção `ferramentas` de `criarServidorMcp`;
 *   - D5: o servidor morre com a sessão (o recibo do supervisor, o processo do `grok`, o prazo da partida ou um sinal) e,
 *     no fecho, para de aceitar conexão e espera a requisição e a ferramenta em andamento, com teto.
 */
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { criarServidorMcp } from '../mcp-server';
import { ehTransporteShipMcp } from '../mcp-transportes';
import { estadoProcesso, gravarAtomico, identidadeProcesso, ProcessoCodex } from './codex-runner';
import { CAMINHO_DO_SERVIDOR_GROK, CONTRATO_DO_SERVIDOR_GROK, ENDERECO_DO_SERVIDOR_GROK, ENV_DO_TOKEN_DO_SERVIDOR_GROK,
  lerJsonPequeno, PedidoServidorGrok, PRAZO_DA_PARTIDA_MS, ReciboServidorGrok } from './grok-mcp';

/** D3: o maior corpo de `POST` aceito; o `ork_artifact_write` leva até 131072 caracteres. */
export const LIMITE_DO_CORPO_BYTES = 4 * 1024 * 1024;
/**
 * D3: sessões MCP abertas ao mesmo tempo. A sessão do `grok` usa uma, e os subagentes herdam a dela (G16). Passado o
 * limite, o `initialize` novo despeja a sessão ociosa usada há mais tempo (GO-FIX 1, achado 4), depois que a nova
 * inicializa, e nunca a que tem pedido ou ferramenta em curso (GO-FIX 2, R2); sem ociosa, 503.
 */
export const LIMITE_DE_SESSOES_MCP = 4;
/** D5: o teto da espera pela requisição e pela ferramenta em andamento no fecho (o `ork_verify` tem prazo de três minutos). */
export const PRAZO_DO_FECHO_MS = 10 * 60_000;
/** D5: o intervalo da vigia sobre os recibos do supervisor. */
export const INTERVALO_DA_VIGIA_MS = 250;
/** D2: quanto a conferência da conexão espera o `.process.json` do supervisor, que nasce logo depois do `grok`. */
const ESPERA_DO_PROCESSO_MS = 2000;

const absoluto = z.string().min(1).max(4096).refine((v) => path.isAbsolute(v), 'caminho absoluto');
const esquemaDoPedido = z.object({
  schema: z.literal(CONTRATO_DO_SERVIDOR_GROK),
  projeto: absoluto,
  threadId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
  dispatchId: z.string().regex(/^[a-f0-9-]{36}$/),
  permissoesFilho: z.enum(['interactive', 'worktree']),
  transporteShip: z.string().refine(ehTransporteShipMcp, 'transporte SHIP desconhecido'),
  ferramentas: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).min(1).max(64),
  conferirProcesso: z.boolean(),
  logPath: absoluto,
  reciboPath: absoluto,
  prazoDaPartidaMs: z.number().int().min(1000).max(600_000).optional(),
}).strict();

/** O pedido do despacho, conferido; fora do contrato recusa. */
export function validarPedidoServidorGrok(bruto: unknown): PedidoServidorGrok {
  return esquemaDoPedido.parse(bruto) as PedidoServidorGrok;
}

/** O token do despacho: 32 bytes em hexadecimal. */
const TOKEN = /^[a-f0-9]{64}$/;

/** O mínimo de uma requisição que a conferência lê. */
export type RequisicaoConferida = Pick<http.IncomingMessage, 'method' | 'url' | 'headers'> & { socket?: { remoteAddress?: string } };

/**
 * D3: a conferência de cada requisição, antes de qualquer leitura de corpo ou sessão, nesta ordem: endereço remoto do
 * loopback (403), caminho exato (404), `Host` exato (403, contra DNS rebinding), nenhum `Origin` (403, o navegador não
 * entra), o `Authorization` inteiro em tempo constante (401) e o método (405). `GET` fica de fora: o servidor não abre
 * fluxo SSE próprio, e a especificação do Streamable HTTP manda responder 405 nesse caso.
 */
export function recusaDaRequisicao(req: RequisicaoConferida, porta: number, esperado: Buffer): { status: number; motivo: string } | null {
  const remoto = req.socket?.remoteAddress ?? '';
  if (remoto !== ENDERECO_DO_SERVIDOR_GROK && remoto !== `::ffff:${ENDERECO_DO_SERVIDOR_GROK}`)
    return { status: 403, motivo: 'mcp.grok.loopback: o servidor do grok so atende conexao local' };
  if (req.url !== CAMINHO_DO_SERVIDOR_GROK) return { status: 404, motivo: 'mcp.grok.path: caminho fora do servidor do grok' };
  if (req.headers.host !== `${ENDERECO_DO_SERVIDOR_GROK}:${porta}`)
    return { status: 403, motivo: 'mcp.grok.host: Host fora do servidor local do grok' };
  if (req.headers.origin !== undefined) return { status: 403, motivo: 'mcp.grok.origin: pedido de navegador recusado' };
  const dado = Buffer.from(String(req.headers.authorization ?? ''), 'utf8');
  if (dado.length !== esperado.length || !timingSafeEqual(dado, esperado))
    return { status: 401, motivo: 'mcp.grok.token: token ausente ou de outra sessao' };
  if (req.method !== 'POST' && req.method !== 'DELETE')
    return { status: 405, motivo: 'mcp.grok.method: o servidor do grok aceita POST e DELETE' };
  return null;
}

/** O endereço `127.0.0.1:<porta>` como o `/proc/net/tcp` o escreve, nas duas ordens de byte. */
function enderecoDoProc(porta: number): string[] {
  const p = porta.toString(16).toUpperCase().padStart(4, '0');
  return [`0100007F:${p}`, `7F000001:${p}`];
}

/** O inode do socket do lado do cliente de uma conexão local: a linha cujo endereço local é a porta do cliente. */
function inodeDoCliente(portaDoCliente: number, portaDoServidor: number): string | null {
  const local = enderecoDoProc(portaDoCliente), remoto = enderecoDoProc(portaDoServidor);
  let texto: string;
  try { texto = fs.readFileSync('/proc/net/tcp', 'utf8'); } catch { return null; }
  for (const linha of texto.split('\n').slice(1)) {
    const c = linha.trim().split(/\s+/);
    if (local.includes(c[1]) && remoto.includes(c[2]) && /^[1-9]\d*$/.test(c[9] ?? '')) return c[9];
  }
  return null;
}

/** O processo e os descendentes dele, pelo pai de cada processo em `/proc/<pid>/stat`. */
function arvoreDoProcesso(raiz: number): Set<number> {
  const filhos = new Map<number, number[]>();
  for (const nome of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(nome)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${nome}/stat`, 'utf8');
      const pai = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      filhos.set(pai, [...(filhos.get(pai) ?? []), Number(nome)]);
    } catch { /* o processo saiu durante a leitura */ }
  }
  const arvore = new Set<number>([raiz]);
  for (const pid of arvore) for (const filho of filhos.get(pid) ?? []) arvore.add(filho);
  return arvore;
}

/** O processo segura este socket entre os descritores dele? */
function seguraOSocket(pid: number, inode: string): boolean {
  const alvo = `socket:[${inode}]`;
  let descritores: string[];
  try { descritores = fs.readdirSync(`/proc/${pid}/fd`); } catch { return false; }
  return descritores.some((fd) => { try { return fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === alvo; } catch { return false; } });
}

/**
 * D2 (GO-FIX 2, R1): a conexão vem da árvore de processos do `grok` deste despacho? O `grok` vivo sai do `.process.json` do
 * supervisor (pid, início e boot); o socket do cliente, do `/proc/net/tcp`; e o dono dele, dos descritores da árvore. O
 * cliente MCP do `grok` roda no próprio processo dele (G16: a forma `url` não abre subprocesso), e o agente com sandbox
 * roda em processo, sem o líder compartilhado (G17). O token vazado pela saída de uma ferramenta da sessão chega a outro
 * processo, mas a conexão dele não sai dessa árvore.
 */
export function conexaoDaSessao(portaDoCliente: number, portaDoServidor: number, logPath: string): boolean {
  const processo = lerJsonPequeno<ProcessoCodex>(`${logPath}.process.json`);
  if (!processo?.filho || estadoProcesso(processo.filho) !== 'vivo') return false;
  const inode = inodeDoCliente(portaDoCliente, portaDoServidor);
  if (!inode) return false;
  for (const pid of arvoreDoProcesso(processo.filho.pid)) if (seguraOSocket(pid, inode)) return true;
  return false;
}

function responder(res: http.ServerResponse, status: number, motivo: string, cabecalhos: Record<string, string> = {}): void {
  if (res.destroyed || res.socket?.destroyed) return;
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json', ...cabecalhos });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: motivo }, id: null }));
}

/**
 * O corpo inteiro até o limite; acima dele, `null` (o pedido recebe 413). O excesso é drenado sem guardar, para a resposta
 * chegar a quem ainda envia; acima de quatro vezes o limite, a conexão cai. Só a sessão com o token chega aqui.
 */
function lerCorpo(req: http.IncomingMessage, limite: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (parte: Buffer) => {
      total += parte.length;
      if (total > limite * 4) { req.destroy(); return; }
      if (total <= limite) partes.push(parte);
    });
    req.on('end', () => resolve(total > limite ? null : Buffer.concat(partes)));
    req.on('close', () => resolve(null));
    req.on('error', reject);
  });
}

/** O recibo do supervisor no disco, sem seguir link. */
function existe(arquivo: string): boolean {
  return fs.lstatSync(arquivo, { throwIfNoEntry: false }) !== undefined;
}

/** Roda um passo do fecho sem deixar a exceção dele impedir os seguintes. */
function semFalhar(passo: () => void): void {
  try { passo(); } catch { /* o fecho segue: a porta e o recibo vêm depois */ }
}

/** O servidor de pé, dentro do processo: a porta, o fecho e a promessa que resolve com o motivo do fim. */
export interface ServidorGrokEmCurso {
  porta: number;
  url: string;
  fechar: (motivo: string) => void;
  fechado: Promise<string>;
}

/** Uma sessão MCP: o transporte, o último uso e o que há em curso nela (pedidos HTTP e ferramentas), para o despejo. */
interface SessaoMcp { transporte: StreamableHTTPServerTransport; usadaEm: number; emCurso: number }

/**
 * Sobe o servidor do pedido com o token do despacho: confere o projeto, a thread e a lista criando um servidor MCP antes de
 * abrir a porta, escuta no loopback e grava o recibo `pronto`. Cada sessão MCP (`initialize`) ganha o próprio servidor do
 * núcleo, vinculado à thread e ao despacho; a vigia fecha tudo quando a sessão do `grok` termina.
 */
export async function servirGrok(pedido: PedidoServidorGrok, token: string): Promise<ServidorGrokEmCurso> {
  if (!TOKEN.test(token)) throw new Error('mcp.grok.token: token do despacho ausente ou fora do formato');
  // D5 (GO-FIX 1, achado 2): conta a requisição até a resposta fechar (enviada ou com a conexão caída) e, à parte, a
  // ferramenta até ela assentar; a cancelada que nunca responde não segura o fecho, e o commit em curso não é cortado.
  let emAndamento = 0, fechando = false;
  const fabricar = (sessao: SessaoMcp | null) => criarServidorMcp({ projeto: pedido.projeto, host: 'grok',
    threadId: pedido.threadId, dispatchId: pedido.dispatchId, permissoesFilho: pedido.permissoesFilho,
    transporteShip: pedido.transporteShip, ferramentas: pedido.ferramentas,
    emCurso: (delta) => { emAndamento += delta; if (sessao) sessao.emCurso += delta; } });
  await fabricar(null).close();
  const sessoes = new Map<string, SessaoMcp>();
  const esperado = Buffer.from(`Bearer ${token}`, 'utf8');
  // D2 (GO-FIX 2, R1): o veredito de cada conexão, uma vez por socket; a espera curta cobre o `.process.json` que ainda nasce.
  const daSessao = new WeakMap<object, Promise<boolean>>();
  const conferirConexao = (socket: { remotePort?: number; localPort?: number }): Promise<boolean> => {
    const pronto = daSessao.get(socket);
    if (pronto) return pronto;
    const veredito = (async () => {
      const limite = Date.now() + ESPERA_DO_PROCESSO_MS;
      for (;;) {
        if (conexaoDaSessao(socket.remotePort ?? 0, socket.localPort ?? 0, pedido.logPath)) return true;
        if (Date.now() >= limite || lerJsonPequeno<ProcessoCodex>(`${pedido.logPath}.process.json`)) return false;
        await new Promise((r) => setTimeout(r, 100));
      }
    })();
    daSessao.set(socket, veredito);
    return veredito;
  };
  let porta = 0;
  const servidor = http.createServer((req, res) => { void atender(req, res); });
  async function atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const recusa = recusaDaRequisicao(req, porta, esperado);
    if (recusa) {
      responder(res, recusa.status, recusa.motivo, recusa.status === 401 ? { 'WWW-Authenticate': 'Bearer' }
        : recusa.status === 405 ? { Allow: 'POST, DELETE' } : {});
      return;
    }
    if (fechando) { responder(res, 503, 'mcp.grok.closing: a sessao do grok terminou'); return; }
    const id = req.headers['mcp-session-id'];
    const sessao = typeof id === 'string' ? sessoes.get(id) : undefined;
    emAndamento++;
    if (sessao) { sessao.emCurso++; sessao.usadaEm = Date.now(); }
    res.once('close', () => { emAndamento--; if (sessao) sessao.emCurso--; });
    try {
      if (pedido.conferirProcesso && !(await conferirConexao(req.socket))) {
        responder(res, 403, 'mcp.grok.process: conexao de processo fora da sessao do grok deste despacho');
        return;
      }
      let corpo: unknown;
      if (req.method === 'POST') {
        const lido = await lerCorpo(req, LIMITE_DO_CORPO_BYTES);
        if (lido === null) { responder(res, 413, 'mcp.grok.body: corpo acima do limite', { Connection: 'close' }); return; }
        try { corpo = JSON.parse(lido.toString('utf8')); }
        catch { responder(res, 400, 'mcp.grok.body: corpo nao e JSON'); return; }
      }
      if (typeof id === 'string') {
        if (!sessao) { responder(res, 404, 'mcp.grok.session: sessao MCP desconhecida'); return; }
        await sessao.transporte.handleRequest(req, res, corpo);
        return;
      }
      if (req.method !== 'POST' || !isInitializeRequest(corpo)) { responder(res, 400, 'mcp.grok.session: pedido sem sessao MCP'); return; }
      // D3 (GO-FIX 2, R2): a vítima é a ociosa usada há mais tempo, e o despejo só vem depois que a nova inicializa.
      let vitima: string | null = null;
      if (sessoes.size >= LIMITE_DE_SESSOES_MCP) {
        const ociosas = [...sessoes.entries()].filter(([, s]) => s.emCurso === 0).sort((a, b) => a[1].usadaEm - b[1].usadaEm);
        if (!ociosas.length) { responder(res, 503, 'mcp.grok.session: limite de sessoes MCP, todas com pedido em curso'); return; }
        vitima = ociosas[0][0];
      }
      const transporte: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(), enableJsonResponse: true,
        onsessioninitialized: (novo) => {
          sessoes.set(novo, nova);
          const despejada = vitima === null ? undefined : sessoes.get(vitima);
          if (vitima !== null && despejada && despejada.emCurso === 0) {
            sessoes.delete(vitima);
            void despejada.transporte.close().catch(() => undefined);
          }
        },
      });
      const nova: SessaoMcp = { transporte, usadaEm: Date.now(), emCurso: 0 };
      transporte.onclose = () => { if (transporte.sessionId && sessoes.get(transporte.sessionId) === nova) sessoes.delete(transporte.sessionId); };
      await fabricar(nova).connect(transporte);
      await transporte.handleRequest(req, res, corpo);
    } catch {
      responder(res, 500, 'mcp.grok.internal: erro no servidor do grok');
    }
  }
  await new Promise<void>((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, ENDERECO_DO_SERVIDOR_GROK, () => { servidor.off('error', reject); resolve(); });
  });
  porta = (servidor.address() as { port: number }).port;
  const url = `http://${ENDERECO_DO_SERVIDOR_GROK}:${porta}${CAMINHO_DO_SERVIDOR_GROK}`;
  const recibo: ReciboServidorGrok = { schema: CONTRATO_DO_SERVIDOR_GROK, estado: 'pronto', url, porta,
    processo: identidadeProcesso(process.pid), pai: process.ppid, threadId: pedido.threadId, dispatchId: pedido.dispatchId,
    conferirProcesso: pedido.conferirProcesso, iniciadoEm: new Date().toISOString() };
  gravarAtomico(pedido.reciboPath, recibo);

  let encerrado: (motivo: string) => void = () => undefined;
  const fechado = new Promise<string>((resolve) => { encerrado = resolve; });
  const inicio = Date.now(), prazoDaPartida = pedido.prazoDaPartidaMs ?? PRAZO_DA_PARTIDA_MS;
  // GO-FIX 1 (achado 3): cada passo do fecho sem lançar, e a porta, o recibo e o fim sempre alcançados.
  const fechar = (motivo: string) => {
    if (fechando) return;
    fechando = true;
    clearInterval(vigia);
    semFalhar(() => servidor.close());
    const limite = Date.now() + PRAZO_DO_FECHO_MS;
    const terminar = () => {
      if (emAndamento > 0 && Date.now() < limite) { setTimeout(terminar, 100); return; }
      try {
        for (const { transporte } of sessoes.values()) void transporte.close().catch(() => undefined);
        semFalhar(() => servidor.closeAllConnections());
        semFalhar(() => gravarAtomico(pedido.reciboPath, { ...recibo, estado: 'encerrado', encerradoEm: new Date().toISOString(), motivo }));
      } finally { encerrado(motivo); }
    };
    terminar();
  };
  const vigiar = () => {
    if (existe(`${pedido.logPath}.exit.json`)) { fechar('recibo'); return; }
    const processo = lerJsonPequeno<ProcessoCodex>(`${pedido.logPath}.process.json`);
    if (!processo) { if (Date.now() - inicio > prazoDaPartida) fechar('sem-partida'); return; }
    if (!processo.filho || estadoProcesso(processo.filho) === 'ausente') fechar('grok-ausente');
  };
  const vigia = setInterval(vigiar, INTERVALO_DA_VIGIA_MS);
  return { porta, url, fechar, fechado };
}

/** O processo lançado por `iniciarServidorDoGrok`: o pedido vem no descritor 0, o token no ambiente, e o fim é o do servidor. */
async function principal(): Promise<void> {
  // D2: o token sai do `process.env` antes de tudo, para nenhum processo que este servidor lance (o worker do commit, o
  // verify) o herdar. O `/proc/<pid>/environ` deste processo guarda o valor de partida, que o Landlock nega à sessão irmã.
  const token = process.env[ENV_DO_TOKEN_DO_SERVIDOR_GROK] ?? '';
  delete process.env[ENV_DO_TOKEN_DO_SERVIDOR_GROK];
  let emCurso: ServidorGrokEmCurso | null = null;
  const sair = (motivo: string) => {
    if (emCurso) { emCurso.fechar(motivo); return; }
    process.exit(1);
  };
  for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(sinal, () => sair('sinal'));
  process.on('uncaughtException', (e) => {
    process.stderr.write(`grok-mcp: ${String((e as Error)?.message ?? e).split('\n')[0]}\n`);
    sair('erro');
  });
  let pedido: PedidoServidorGrok;
  try { pedido = validarPedidoServidorGrok(JSON.parse(fs.readFileSync(0, 'utf8'))); }
  catch (e) {
    process.stderr.write(`grok-mcp: pedido invalido (${(e as Error).message.split('\n')[0]})\n`);
    process.exit(2);
  }
  try { emCurso = await servirGrok(pedido, token); }
  catch (e) {
    process.stderr.write(`grok-mcp: ${(e as Error).message.split('\n')[0]}\n`);
    process.exit(1);
  }
  await emCurso.fechado;
  process.exit(0);
}

if (require.main === module && process.argv[2] === '--run') void principal();
