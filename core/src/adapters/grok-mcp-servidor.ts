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
/**
 * D2 (GO-FIX 3): a conexão do `grok` fica aberta entre os turnos do modelo, para a conferência da árvore não se repetir a
 * cada ferramenta (o padrão do Node, 5 s, a derrubava).
 */
const CONEXAO_OCIOSA_MS = 60_000;
/** D2 (GO-FIX 4): as recusas da conferência da árvore que vão ao stderr por minuto; depois delas, uma linha só diz que há mais. */
export const LIMITE_DE_RECUSAS_NO_LOG = 20;
const JANELA_DO_LOG_MS = 60_000;
/** D2 (GO-FIX 4): a varredura dos donos legíveis cede o event loop a cada tantos processos lidos. */
const PROCESSOS_POR_VEZ = 16;

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

/** O endereço v4-mapeado `::ffff:127.0.0.1:<porta>` como o `/proc/net/tcp6` o escreve, nas duas ordens de byte. */
function enderecoMapeadoDoProc(porta: number): string[] {
  const p = porta.toString(16).toUpperCase().padStart(4, '0');
  return [`0000000000000000FFFF00000100007F:${p}`, `00000000000000000000FFFF7F000001:${p}`];
}

/**
 * O inode do socket do lado do cliente de uma conexão local: a linha cujo endereço local é a porta do cliente, no
 * `/proc/net/tcp` ou, para o cliente IPv6 que conecta ao endereço v4-mapeado, no `/proc/net/tcp6` (GO-FIX 3).
 */
function inodeDoCliente(portaDoCliente: number, portaDoServidor: number): string | null {
  const tabelas: [string, string[], string[]][] = [
    ['/proc/net/tcp', enderecoDoProc(portaDoCliente), enderecoDoProc(portaDoServidor)],
    ['/proc/net/tcp6', enderecoMapeadoDoProc(portaDoCliente), enderecoMapeadoDoProc(portaDoServidor)],
  ];
  for (const [tabela, local, remoto] of tabelas) {
    let texto: string;
    try { texto = fs.readFileSync(tabela, 'utf8'); } catch { continue; }
    for (const linha of texto.split('\n').slice(1)) {
      const c = linha.trim().split(/\s+/);
      if (local.includes(c[1]) && remoto.includes(c[2]) && /^[1-9]\d*$/.test(c[9] ?? '')) return c[9];
    }
  }
  return null;
}

/**
 * Os descendentes do processo (GO-FIX 3): pelos `children` de cada tarefa, que o kernel mantém; sem eles, pela varredura
 * do pai de cada processo em `/proc/<pid>/stat`.
 */
function descendentes(raiz: number): number[] {
  const achados: number[] = [];
  const pelasTarefas = (pid: number): number[] | null => {
    try {
      return fs.readdirSync(`/proc/${pid}/task`).flatMap((tarefa) =>
        fs.readFileSync(`/proc/${pid}/task/${tarefa}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number));
    } catch { return null; }
  };
  if (pelasTarefas(raiz) !== null) {
    const fila = [raiz];
    while (fila.length) for (const filho of pelasTarefas(fila.shift()!) ?? []) { achados.push(filho); fila.push(filho); }
    return achados;
  }
  const filhos = new Map<number, number[]>();
  for (const nome of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(nome)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${nome}/stat`, 'utf8');
      const pai = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      filhos.set(pai, [...(filhos.get(pai) ?? []), Number(nome)]);
    } catch { /* o processo saiu durante a leitura */ }
  }
  const fila = [raiz];
  while (fila.length) for (const filho of filhos.get(fila.shift()!) ?? []) { achados.push(filho); fila.push(filho); }
  return achados;
}

/** O processo segura este socket entre os descritores dele? `null` quando os descritores não se leem (EACCES, EPERM). */
function seguraOSocket(pid: number, inode: string): boolean | null {
  const alvo = `socket:[${inode}]`;
  let descritores: string[];
  try { descritores = fs.readdirSync(`/proc/${pid}/fd`); }
  catch (e) { const codigo = (e as NodeJS.ErrnoException).code; return codigo === 'EACCES' || codigo === 'EPERM' ? null : false; }
  return descritores.some((fd) => { try { return fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === alvo; } catch { return false; } });
}

/** O veredito da conferência da árvore, com o motivo da recusa para o log do servidor. */
export type VereditoDaConexao = { aceita: true; soToken?: true } | { aceita: false; motivo: string };

const FORA_DA_ARVORE: VereditoDaConexao = { aceita: false, motivo: 'conexao de processo fora da arvore do grok' };

/**
 * D2 (GO-FIX 2, R1; GO-FIX 3 e 4): a conexão vem da árvore de processos do `grok` deste despacho? O `grok` vivo sai do
 * `.process.json` do supervisor, já lido por quem chama (pid, início e boot); o socket do cliente, do `/proc/net/tcp` ou do
 * `tcp6`; e o dono dele, dos descritores do `grok` primeiro (o caso esperado: a forma `url` não abre subprocesso, G16, e o
 * agente com sandbox roda no próprio processo, G17) e depois dos descendentes. O token vazado pela saída de uma ferramenta
 * da sessão chega a outro processo, mas a conexão dele não sai dessa árvore. Se o próprio `grok` não deixa ler os
 * descritores (não despejável), o socket se procura entre os outros processos que se leem (GO-FIX 4): o de fora da árvore
 * que o segura é recusado; sem dono legível, vale só o token, e o veredito diz isso para o log.
 */
export async function conferirArvore(processo: ProcessoCodex, portaDoCliente: number, portaDoServidor: number): Promise<VereditoDaConexao> {
  if (!processo.filho || estadoProcesso(processo.filho) !== 'vivo') return { aceita: false, motivo: 'processo do grok ausente' };
  const inode = inodeDoCliente(portaDoCliente, portaDoServidor);
  if (!inode) return { aceita: false, motivo: 'socket do cliente fora do /proc/net/tcp e do tcp6' };
  const grok = processo.filho.pid;
  const doGrok = seguraOSocket(grok, inode);
  if (doGrok) return { aceita: true };
  const arvore = descendentes(grok);
  if (arvore.some((pid) => seguraOSocket(pid, inode))) return { aceita: true };
  if (doGrok === false) return FORA_DA_ARVORE;
  return (await donoLegivelDeFora(inode, new Set([grok, ...arvore]))) ? FORA_DA_ARVORE : { aceita: true, soToken: true };
}

/**
 * D2 (GO-FIX 4): com o `grok` não despejável, algum processo do mesmo usuário, fora da árvore, segura o socket? A varredura
 * cede o event loop a cada `PROCESSOS_POR_VEZ` processos lidos, para a conexão nova não travar as respostas da sessão, e
 * pula sem ler o processo de outro dono (o não despejável tem o `/proc/<pid>` do root, e os descritores dele não se leem).
 */
async function donoLegivelDeFora(inode: string, naArvore: Set<number>): Promise<boolean> {
  const usuario = process.getuid?.();
  let lidos = 0;
  for (const nome of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(nome) || naArvore.has(Number(nome))) continue;
    try { if (usuario !== undefined && fs.statSync(`/proc/${nome}`).uid !== usuario) continue; } catch { continue; }
    if (seguraOSocket(Number(nome), inode)) return true;
    if (++lidos % PROCESSOS_POR_VEZ === 0) await new Promise((r) => setImmediate(r));
  }
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
  // D2 (GO-FIX 2, R1; GO-FIX 3): a conferência da árvore por socket. Só o aceite fica guardado; a recusa só vem depois de
  // uma conferência que viu o `.process.json`, que o supervisor grava logo depois do `grok`, esperado até o prazo da partida.
  const aceitas = new WeakMap<object, Promise<boolean>>();
  let avisouSoToken = false;
  // GO-FIX 4: o log das recusas tem teto por minuto, para quem tem o token vazado não encher o stderr abrindo conexões
  // nem calar de vez a recusa que vier depois.
  let recusas = 0, janelaDesde = Date.now();
  const anotarRecusa = (motivo: string) => {
    if (Date.now() - janelaDesde >= JANELA_DO_LOG_MS) { recusas = 0; janelaDesde = Date.now(); }
    recusas++;
    if (recusas <= LIMITE_DE_RECUSAS_NO_LOG) process.stderr.write(`grok-mcp: conexao recusada: ${motivo}\n`);
    else if (recusas === LIMITE_DE_RECUSAS_NO_LOG + 1) process.stderr.write('grok-mcp: mais conexoes recusadas neste minuto, sem log\n');
  };
  const conferirConexao = (socket: { remotePort?: number; localPort?: number }): Promise<boolean> => {
    const pendente = aceitas.get(socket);
    if (pendente) return pendente;
    // GO-FIX 4: a conferência nunca rejeita; o erro dela (um EMFILE na leitura do `/proc`) recusa só esta conexão, sem a
    // exceção não tratada derrubar o servidor da sessão.
    const veredito = (async () => {
      try {
        const limite = Date.now() + (pedido.prazoDaPartidaMs ?? PRAZO_DA_PARTIDA_MS);
        let processo = lerJsonPequeno<ProcessoCodex>(`${pedido.logPath}.process.json`);
        while (!processo && Date.now() < limite) {
          await new Promise((r) => setTimeout(r, 100));
          processo = lerJsonPequeno<ProcessoCodex>(`${pedido.logPath}.process.json`);
        }
        if (!processo) { anotarRecusa('sem o .process.json do supervisor no prazo'); return false; }
        const v = await conferirArvore(processo, socket.remotePort ?? 0, socket.localPort ?? 0);
        if (!v.aceita) { anotarRecusa(v.motivo); return false; }
        if (v.soToken && !avisouSoToken) {
          avisouSoToken = true;
          process.stderr.write('grok-mcp: o grok nao deixa ler os descritores dele; a conexao vale so pelo token\n');
        }
        return true;
      } catch (e) {
        const erro = e as NodeJS.ErrnoException | undefined;
        anotarRecusa(`erro na conferencia (${erro?.code ?? String(erro?.message ?? e).split('\n')[0].slice(0, 200)})`);
        return false;
      }
    })();
    aceitas.set(socket, veredito);
    void veredito.then((aceita) => { if (!aceita) aceitas.delete(socket); }, () => { aceitas.delete(socket); });
    return veredito;
  };
  // GO-FIX 5: um ouvinte de `close` por socket, que solta os pedidos pendentes dele, e não um por pedido: com dez ou mais
  // pedidos em pipeline, o aviso de ouvintes demais do Node iria ao log por fora do teto das recusas.
  const pendentesPorSocket = new WeakMap<object, Set<() => void>>();
  const aoFecharOSocket = (socket: NodeJS.EventEmitter, soltar: () => void): (() => void) => {
    let pendentes = pendentesPorSocket.get(socket);
    if (!pendentes) {
      const novos = new Set<() => void>();
      pendentesPorSocket.set(socket, novos);
      socket.once('close', () => { for (const f of [...novos]) f(); });
      pendentes = novos;
    }
    const doSocket = pendentes;
    doSocket.add(soltar);
    return () => { doSocket.delete(soltar); };
  };
  let porta = 0;
  const servidor = http.createServer((req, res) => { void atender(req, res); });
  servidor.keepAliveTimeout = CONEXAO_OCIOSA_MS;
  servidor.headersTimeout = CONEXAO_OCIOSA_MS + 5000;
  async function atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const recusa = recusaDaRequisicao(req, porta, esperado);
    if (recusa) {
      responder(res, recusa.status, recusa.motivo, recusa.status === 401 ? { 'WWW-Authenticate': 'Bearer' }
        : recusa.status === 405 ? { Allow: 'POST, DELETE' } : {});
      return;
    }
    if (fechando) { responder(res, 503, 'mcp.grok.closing: a sessao do grok terminou'); return; }
    const id = req.headers['mcp-session-id'];
    // GO-FIX 4: o pedido conta até a resposta fechar ou, no pipeline cuja resposta nunca ganha o socket (depois de um
    // `Connection: close`, ou com o cliente caindo no meio), até o socket fechar; uma vez só, na sessão também.
    let contada: SessaoMcp | undefined;
    let descontado = false;
    let largarDoSocket: () => void = () => undefined;
    const descontar = () => {
      if (descontado) return;
      descontado = true;
      emAndamento--;
      if (contada) contada.emCurso--;
      largarDoSocket();
    };
    emAndamento++;
    res.once('close', descontar);
    largarDoSocket = aoFecharOSocket(req.socket, descontar);
    try {
      // GO-FIX 4: a recusa fecha a conexão, e cada nova tentativa custa outra conexão e outra conferência.
      if (pedido.conferirProcesso && !(await conferirConexao(req.socket))) {
        responder(res, 403, 'mcp.grok.process: conexao de processo fora da sessao do grok deste despacho', { Connection: 'close' });
        return;
      }
      // GO-FIX 3: a sessão só conta o pedido que passou pela conferência; o recusado não mexe no despejo dela.
      const sessao = typeof id === 'string' ? sessoes.get(id) : undefined;
      if (sessao && !descontado) {
        contada = sessao;
        sessao.emCurso++;
        sessao.usadaEm = Date.now();
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
    // O `close` real do filho ocorre depois que ele ja aparece ausente e, dentro dele, o supervisor grava o recibo
    // atomicamente antes de sair. Enquanto o supervisor vive, a ausencia do filho e so essa janela: o evento certo ainda
    // e o recibo. `grok-ausente` fica para a queda do supervisor sem recibo, comprovada pela ausencia dos dois processos.
    if ((!processo.filho || estadoProcesso(processo.filho) === 'ausente') &&
        estadoProcesso(processo.supervisor) === 'ausente') fechar('grok-ausente');
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
