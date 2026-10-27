/**
 * RM-067 (F4c, thread ork-rm067f4cmcpd): o servidor MCP do `ork` da sessao filha do `grok`, fora do sandbox dele. O
 * despacho o lanca antes do `grok`, como processo do proprio `ork`, e o `grok` se conecta pela forma `url` do guia oficial
 * (G16), com o token do `bearer_token_file`. Os casos sobem o servidor de verdade (`iniciarServidorDoGrok`) e falam com ele
 * pelo cliente Streamable HTTP do SDK e por HTTP cru; o `grok` e o falso de `grok-falso.ts`, ou um `sleep` no lugar do
 * processo dele, porque a maquina nao tem o runtime instalado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { ChildProcess, spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { criarServidorMcp } from '../src/mcp-server';
import { ferramentasDoGrok } from '../src/adapters/grok';
import { iniciarServidorDoGrok, lerReciboServidorGrok, ServidorDoGrokIniciado } from '../src/adapters/grok-mcp';
import { LIMITE_DO_CORPO_BYTES } from '../src/adapters/grok-mcp-servidor';
import { estadoProcesso, gravarAtomico, identidadeProcesso } from '../src/adapters/codex-runner';
import { dirThread, novaThread } from '../src/thread';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { esperarCondicao } from './controller-simulado';

const textoDe = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]).text) as Record<string, unknown>;
const ordenadas = (nomes: readonly string[]) => [...nomes].sort();

/** Espera assincrona, para quando o proprio processo do teste precisa receber dados enquanto espera. */
async function esperarAte(f: () => boolean, ms: number): Promise<void> {
  const fim = Date.now() + ms;
  while (!f()) {
    if (Date.now() >= fim) throw new Error('condicao de fixture nao ocorreu');
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface Bancada {
  p: ProjetoDeTeste;
  threadId: string;
  dispatchId: string;
  logPath: string;
  s: ServidorDoGrokIniciado;
  token: string;
  ferramentas: string[];
  /** O processo no papel do `grok`, registrado no `.process.json` como o supervisor faria. */
  grok: ChildProcess;
  limpar: () => void;
}

/** Um projeto com thread, um processo no papel do `grok` e o servidor do despacho de pe. */
function bancada(nome: string, opcoes: { perfil?: 'interactive' | 'worktree'; plano?: boolean; prazoDaPartidaMs?: number;
    semPartida?: boolean } = {}): Bancada {
  const p = projetoTemporario(nome);
  const t = novaThread(p.carregado, { nome, modo: 'auto', criarWorktree: true }).thread;
  const logPath = path.join(dirThread(p.dir, t.id), 'sessoes', `${randomUUID()}.grok.jsonl`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const perfil = opcoes.perfil ?? 'worktree';
  const ferramentas = ferramentasDoGrok(perfil, opcoes.plano ?? false, false);
  const grok = spawn('sleep', ['600'], { stdio: 'ignore' });
  if (!opcoes.semPartida) {
    gravarAtomico(`${logPath}.process.json`, { schema: 'ork.codex-process/v1', iniciadoEm: new Date().toISOString(),
      supervisor: identidadeProcesso(process.pid), filho: identidadeProcesso(grok.pid!) });
  }
  const dispatchId = randomUUID();
  const s = iniciarServidorDoGrok({ projeto: fs.realpathSync(p.dir), threadId: t.id, dispatchId, permissoesFilho: perfil,
    transporteShip: 'github-ssh', ferramentas, logPath, ...(opcoes.prazoDaPartidaMs ? { prazoDaPartidaMs: opcoes.prazoDaPartidaMs } : {}) },
  t.worktree!, process.env);
  const token = fs.readFileSync(s.tokenPath, 'utf8');
  return { p, threadId: t.id, dispatchId, logPath, s, token, ferramentas, grok,
    limpar: () => {
      s.encerrar();
      grok.kill('SIGKILL');
      esperarCondicao(() => estadoProcesso(s.processo) === 'ausente', 15000);
      p.limpar();
    } };
}

/** Um cliente MCP de verdade, pelo Streamable HTTP, com o cabecalho que o `grok` monta do `bearer_token_file`. */
async function comCliente<T>(url: string, token: string, corpo: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'fixture-grok-SIMULADO', version: '1' }, { capabilities: {} });
  const transporte = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  try { await client.connect(transporte); return await corpo(client); }
  finally { await client.close(); }
}

const INICIO = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-SIMULADA', version: '1' } } };

/** Um pedido HTTP cru ao servidor, para os casos que o cliente do SDK nao monta. */
function pedir(porta: number, opcoes: { metodo?: string; caminho?: string; cabecalhos?: Record<string, string>; corpo?: string | Buffer } = {}):
    Promise<{ status: number; corpo: string; cabecalhos: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: opcoes.metodo ?? 'POST', path: opcoes.caminho ?? '/mcp',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...opcoes.cabecalhos } }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (parte: Buffer) => partes.push(parte));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8'), cabecalhos: res.headers }));
    });
    req.on('error', reject);
    req.end(opcoes.corpo ?? JSON.stringify(INICIO));
  });
}

/** O codigo da tentativa de conexao TCP (`ECONNREFUSED` quando ninguem escuta). */
function conectar(host: string, porta: number): Promise<string> {
  return new Promise((resolve) => {
    const c = net.connect({ host, port: porta });
    c.setTimeout(5000, () => { c.destroy(); resolve('ETIMEDOUT'); });
    c.on('connect', () => { c.destroy(); resolve('conectou'); });
    c.on('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? 'erro'));
  });
}

/** O servidor saiu: recibo `encerrado` com o motivo, processo ausente, token apagado e a porta sem ninguem. */
async function conferirFim(b: Bancada, motivo: string): Promise<void> {
  esperarCondicao(() => lerReciboServidorGrok(b.s.reciboPath)?.estado === 'encerrado' && estadoProcesso(b.s.processo) === 'ausente', 20000);
  assert.equal(lerReciboServidorGrok(b.s.reciboPath)?.motivo, motivo);
  assert.equal(fs.existsSync(b.s.tokenPath), false, 'o token some com o servidor');
  assert.equal(await conectar('127.0.0.1', b.s.porta), 'ECONNREFUSED', 'a porta fica sem ninguem');
}

test('GX1: o servidor do grok escuta so no loopback, com token 0600 fora da worktree, e lista exatamente as ferramentas do despacho', async () => {
  const go = bancada('gx1-go');
  const plano = bancada('gx1-plano', { plano: true });
  try {
    const recibo = lerReciboServidorGrok(go.s.reciboPath)!;
    assert.equal(recibo.estado, 'pronto');
    assert.equal(recibo.url, `http://127.0.0.1:${go.s.porta}/mcp`);
    assert.equal(go.s.url, recibo.url);
    assert.equal(recibo.pai, process.pid, 'o pai do servidor e o processo que despachou, nunca o grok');
    assert.equal(recibo.threadId, go.threadId);
    assert.equal(recibo.dispatchId, go.dispatchId);
    assert.match(go.token, /^[a-f0-9]{64}$/, '256 bits em hexadecimal');
    assert.equal(fs.statSync(go.s.tokenPath).mode & 0o777, 0o600);
    assert.equal(go.s.tokenPath.startsWith(dirThread(go.p.dir, go.threadId) + path.sep), true, 'o token mora no estado da thread');
    assert.notEqual(go.token, plano.token, 'um token por despacho');

    const doGo = await comCliente(go.s.url, go.token, async (c) => (await c.listTools()).tools.map((x) => x.name));
    assert.deepEqual(ordenadas(doGo), ordenadas(ferramentasDoGrok('worktree', false, false)), 'o GO do worktree: o --allow dele');
    await comCliente(plano.s.url, plano.token, async (c) => {
      const nomes = (await c.listTools()).tools.map((x) => x.name);
      assert.deepEqual(ordenadas(nomes), ordenadas(ferramentasDoGrok('worktree', true, false)), 'o PLAN: so o --allow dele, nunca a uniao');
      assert.equal(nomes.includes('ork_git_commit'), false);
      const fora = await c.callTool({ name: 'ork_git_commit', arguments: { threadId: plano.threadId } });
      assert.equal(fora.isError, true);
      assert.match(JSON.stringify(fora), /mcp\.tool\.unknown/);
      const outra = await c.callTool({ name: 'ork_thread_status', arguments: { threadId: go.threadId } });
      assert.equal(outra.isError, true);
      assert.match(JSON.stringify(outra), /mcp\.thread\.scope/, 'o token certo nao abre outra thread');
      const propria = await c.callTool({ name: 'ork_thread_status', arguments: { threadId: plano.threadId } });
      assert.equal(propria.isError, undefined, JSON.stringify(propria));
      assert.equal((textoDe(propria).thread as { id: string }).id, plano.threadId);
    });

    // A lista do despacho so vale no host grok e dentro do perfil filho.
    assert.throws(() => criarServidorMcp({ projeto: go.p.dir, host: 'grok', threadId: go.threadId, ferramentas: ['ork_thread_new'] }),
      /mcp\.tools\.invalid/);
    assert.throws(() => criarServidorMcp({ projeto: go.p.dir, host: 'claude-code', threadId: go.threadId, ferramentas: ['ork_thread_status'] }),
      /mcp\.tools\.invalid/);
    assert.throws(() => criarServidorMcp({ projeto: go.p.dir, host: 'grok', threadId: go.threadId, permissoesFilho: 'interactive',
      ferramentas: ['ork_git_commit'] }), /mcp\.tools\.invalid/, 'o interactive nao commita');
    const logPath = path.join(dirThread(go.p.dir, go.threadId), 'sessoes', `${randomUUID()}.grok.jsonl`);
    assert.throws(() => iniciarServidorDoGrok({ projeto: fs.realpathSync(go.p.dir), threadId: go.threadId, dispatchId: randomUUID(),
      permissoesFilho: 'worktree', transporteShip: 'github-ssh', ferramentas: ['ork_phase_run'], logPath }, go.p.dir, process.env),
    /runtime\.unavailable: o servidor MCP do ork para o grok saiu antes de ficar pronto \(grok-mcp: mcp\.tools\.invalid/);
  } finally { go.limpar(); plano.limpar(); }
});

test('GX2: o canal recusa outro processo e outra sessao: token ausente, errado ou de outro despacho, Host, Origin, caminho, metodo e corpo', async (t) => {
  const a = bancada('gx2-a');
  const b = bancada('gx2-b');
  try {
    const porta = a.s.porta;
    const autorizado = { Authorization: `Bearer ${a.token}` };
    const semToken = await pedir(porta);
    assert.equal(semToken.status, 401);
    assert.equal(semToken.cabecalhos['www-authenticate'], 'Bearer');
    assert.match(semToken.corpo, /mcp\.grok\.token/);
    assert.equal((await pedir(porta, { cabecalhos: { Authorization: `Bearer ${b.token}` } })).status, 401, 'o token de outro despacho');
    assert.equal((await pedir(porta, { cabecalhos: { Authorization: `Bearer ${randomBytes(32).toString('hex')}` } })).status, 401,
      'outro token do mesmo tamanho');
    assert.equal((await pedir(porta, { cabecalhos: { Authorization: `bearer ${a.token}` } })).status, 401, 'o esquema exato');
    assert.equal((await pedir(porta, { cabecalhos: { Authorization: a.token } })).status, 401, 'sem o esquema');
    assert.equal((await pedir(porta, { cabecalhos: { ...autorizado, Host: `localhost:${porta}` } })).status, 403, 'outro Host');
    assert.equal((await pedir(porta, { cabecalhos: { ...autorizado, Origin: 'http://pagina.invalid' } })).status, 403, 'navegador');
    assert.equal((await pedir(porta, { caminho: '/mcp/outro', cabecalhos: autorizado })).status, 404);
    assert.equal((await pedir(porta, { caminho: '/mcp?x=1', cabecalhos: autorizado })).status, 404, 'sem consulta');
    const get = await pedir(porta, { metodo: 'GET', cabecalhos: autorizado, corpo: '' });
    assert.equal(get.status, 405, 'sem fluxo SSE proprio, como a especificacao manda');
    assert.equal(get.cabecalhos.allow, 'POST, DELETE');
    assert.equal((await pedir(porta, { metodo: 'PUT', cabecalhos: autorizado })).status, 405);
    const grande = await pedir(porta, { cabecalhos: autorizado, corpo: Buffer.alloc(LIMITE_DO_CORPO_BYTES + 1, 0x20) });
    assert.equal(grande.status, 413);
    assert.equal((await pedir(porta, { cabecalhos: autorizado, corpo: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) })).status,
      400, 'sem sessao MCP, so o initialize abre uma');
    assert.equal((await pedir(porta, { cabecalhos: { ...autorizado, 'Mcp-Session-Id': randomUUID() } })).status, 404, 'sessao desconhecida');
    const aberto = await pedir(porta, { cabecalhos: autorizado });
    assert.equal(aberto.status, 200, aberto.corpo);
    assert.match(String(aberto.cabecalhos['mcp-session-id']), /^[0-9a-f-]{36}$/);

    // Nenhuma porta na rede: o mesmo numero num endereco que nao e o loopback recusa a conexao.
    const externo = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (externo) assert.equal(await conectar(externo, porta), 'ECONNREFUSED', 'a porta nao escuta no endereco externo');
    else t.diagnostic('sem endereco IPv4 fora do loopback nesta maquina: o listen em 127.0.0.1 segue conferido pelo recibo');
  } finally { a.limpar(); b.limpar(); }
});

test('GX3: o servidor morre com a sessao: recibo do supervisor, grok ausente, sem partida, encerrar do despacho e a requisicao em andamento', async () => {
  const recibo = bancada('gx3-recibo');
  const ausente = bancada('gx3-ausente');
  const semPartida = bancada('gx3-sem-partida', { semPartida: true, prazoDaPartidaMs: 1500 });
  const encerrado = bancada('gx3-encerrar');
  const emCurso = bancada('gx3-em-curso');
  try {
    gravarAtomico(`${recibo.logPath}.exit.json`, { simulado: true });
    await conferirFim(recibo, 'recibo');

    ausente.grok.kill('SIGKILL');
    await conferirFim(ausente, 'grok-ausente');

    await conferirFim(semPartida, 'sem-partida');

    encerrado.s.encerrar();
    await conferirFim(encerrado, 'sinal');

    // Uma requisicao autenticada com o corpo pela metade segura o fecho: o servidor apaga o token e para de aceitar
    // conexao, mas so sai depois de responder a ela.
    const corpo = JSON.stringify(INICIO);
    const resposta: Buffer[] = [];
    let fechou = false;
    const sock = net.connect({ host: '127.0.0.1', port: emCurso.s.porta });
    sock.on('data', (parte: Buffer) => resposta.push(parte));
    sock.on('close', () => { fechou = true; });
    sock.on('error', () => { fechou = true; });
    await new Promise<void>((r) => sock.once('connect', () => r()));
    sock.write(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${emCurso.s.porta}\r\nAuthorization: Bearer ${emCurso.token}\r\n` +
      `Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: ${Buffer.byteLength(corpo)}\r\n\r\n` +
      corpo.slice(0, 10));
    await new Promise((r) => setTimeout(r, 3000));
    gravarAtomico(`${emCurso.logPath}.exit.json`, { simulado: true });
    await esperarAte(() => !fs.existsSync(emCurso.s.tokenPath), 10000);
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(estadoProcesso(emCurso.s.processo), 'vivo', 'a requisicao em andamento segura o processo');
    assert.equal(await conectar('127.0.0.1', emCurso.s.porta), 'ECONNREFUSED', 'conexao nova recusada no fecho');
    sock.write(corpo.slice(10));
    await esperarAte(() => fechou, 20000);
    const texto = Buffer.concat(resposta).toString('utf8');
    assert.match(texto, /^HTTP\/1\.1 200 /, texto.slice(0, 200));
    assert.match(texto, /"serverInfo"/, 'a requisicao em andamento recebeu a resposta inteira');
    await conferirFim(emCurso, 'recibo');
  } finally { for (const b of [recibo, ausente, semPartida, encerrado, emCurso]) b.limpar(); }
});
