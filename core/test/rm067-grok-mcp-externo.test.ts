/**
 * RM-067 (F4c, thread ork-rm067f4cmcpd): o servidor MCP do `ork` da sessao filha do `grok`, fora do sandbox dele. O
 * despacho o lanca antes do `grok`, como processo do proprio `ork`, e o `grok` se conecta pela forma `url` do guia oficial
 * (G16), com o token so no ambiente (`bearer_token_env_var`, G5). Os casos sobem o servidor de verdade (`iniciarServidorDoGrok`) e falam com ele
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
import { ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { parse } from 'smol-toml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { criarServidorMcp } from '../src/mcp-server';
import { instalarMcp } from '../src/mcp-install';
import { ferramentasDoGrok } from '../src/adapters/grok';
import { arquivosDoServidorGrok, ENV_DO_TOKEN_DO_SERVIDOR_GROK, iniciarServidorDoGrok, lerReciboServidorGrok,
  ServidorDoGrokIniciado } from '../src/adapters/grok-mcp';
import { LIMITE_DE_SESSOES_MCP, LIMITE_DO_CORPO_BYTES } from '../src/adapters/grok-mcp-servidor';
import { estadoProcesso, gravarAtomico, identidadeProcesso, ProcessoCodex } from '../src/adapters/codex-runner';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { adicionarPerfil } from '../src/runtime-profiles';
import { AVISO_DA_RETOMADA_COM_MCP } from '../src/session-watcher-grok';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { grokFalso } from './grok-falso';

const RAIZ = path.resolve(__dirname, '../../..');
const FONTE = (arquivo: string) => fs.readFileSync(path.join(RAIZ, 'core/src', arquivo), 'utf8');

const textoDe = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]).text) as Record<string, unknown>;
const ordenadas = (nomes: readonly string[]) => [...nomes].sort();

/** Os arquivos comuns sob estas pastas (sem seguir link) que contem o texto: o token nunca pode aparecer em nenhum. */
function arquivosCom(texto: string, pastas: string[]): string[] {
  const achados: string[] = [];
  const visitar = (pasta: string) => {
    for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
      const caminho = path.join(pasta, e.name);
      if (e.isDirectory()) visitar(caminho);
      else if (e.isFile() && fs.readFileSync(caminho).includes(texto)) achados.push(caminho);
    }
  };
  for (const pasta of pastas) visitar(pasta);
  return achados;
}

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
  /** O `sleep` no papel do `grok`, quando a bancada nao usa o proprio processo do teste. */
  grok: ChildProcess | null;
  limpar: () => void;
}

/**
 * Um projeto com thread, um processo no papel do `grok` e o servidor do despacho de pe. Por padrao o `grok` e o proprio
 * processo do teste, para as conexoes dele virem da arvore que o servidor confere (D2, GO-FIX 2); com `grok: 'sleep'`, um
 * `sleep` faz o papel, para o caso do `grok` morto e para a conexao de fora da arvore.
 */
function bancada(nome: string, opcoes: { perfil?: 'interactive' | 'worktree'; plano?: boolean; prazoDaPartidaMs?: number;
    semPartida?: boolean; grok?: 'teste' | 'sleep'; conferirProcesso?: boolean } = {}): Bancada {
  const p = projetoTemporario(nome);
  const t = novaThread(p.carregado, { nome, modo: 'auto', criarWorktree: true }).thread;
  const logPath = path.join(dirThread(p.dir, t.id), 'sessoes', `${randomUUID()}.grok.jsonl`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const perfil = opcoes.perfil ?? 'worktree';
  const ferramentas = ferramentasDoGrok(perfil, opcoes.plano ?? false, false);
  const grok = opcoes.grok === 'sleep' ? spawn('sleep', ['600'], { stdio: 'ignore' }) : null;
  if (!opcoes.semPartida) {
    gravarAtomico(`${logPath}.process.json`, { schema: 'ork.codex-process/v1', iniciadoEm: new Date().toISOString(),
      supervisor: identidadeProcesso(process.pid), filho: identidadeProcesso(grok ? grok.pid! : process.pid) });
  }
  const dispatchId = randomUUID();
  const s = iniciarServidorDoGrok({ projeto: fs.realpathSync(p.dir), threadId: t.id, dispatchId, permissoesFilho: perfil,
    transporteShip: 'github-ssh', ferramentas, logPath, conferirProcesso: opcoes.conferirProcesso ?? true,
    ...(opcoes.prazoDaPartidaMs ? { prazoDaPartidaMs: opcoes.prazoDaPartidaMs } : {}) },
  t.worktree!, process.env);
  return { p, threadId: t.id, dispatchId, logPath, s, token: s.token, ferramentas, grok,
    limpar: () => {
      s.encerrar();
      grok?.kill('SIGKILL');
      esperarCondicao(() => estadoProcesso(s.processo) === 'ausente', 15000);
      p.limpar();
    } };
}

/** Um cliente MCP de verdade, pelo Streamable HTTP, com o cabecalho que o `grok` monta do `bearer_token_env_var`. */
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
  assert.deepEqual(arquivosCom(b.token, [b.p.dir]), [], 'o token nunca foi a arquivo');
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
    assert.notEqual(go.token, plano.token, 'um token por despacho');
    // D2 (GO-FIX 1): o token nao vai a arquivo nenhum nem ao argv do servidor; so ao ambiente dele, que ele esvazia na partida.
    assert.deepEqual(arquivosCom(go.token, [go.p.dir]), [], 'nenhum arquivo do projeto tem o token: recibo, log, estado');
    assert.equal(fs.readFileSync(`/proc/${go.s.processo.pid}/cmdline`, 'utf8').includes(go.token), false, 'nem o argv do servidor');

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
      permissoesFilho: 'worktree', transporteShip: 'github-ssh', ferramentas: ['ork_phase_run'], logPath, conferirProcesso: true }, go.p.dir, process.env),
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
  const ausente = bancada('gx3-ausente', { grok: 'sleep' });
  const semPartida = bancada('gx3-sem-partida', { semPartida: true, prazoDaPartidaMs: 1500 });
  const encerrado = bancada('gx3-encerrar');
  const emCurso = bancada('gx3-em-curso');
  try {
    gravarAtomico(`${recibo.logPath}.exit.json`, { simulado: true });
    await conferirFim(recibo, 'recibo');

    ausente.grok!.kill('SIGKILL');
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
    // O fecho comecou quando a porta deixa de aceitar conexao nova.
    const prazo = Date.now() + 10000;
    while (await conectar('127.0.0.1', emCurso.s.porta) !== 'ECONNREFUSED') {
      if (Date.now() > prazo) throw new Error('a porta seguiu aberta depois do recibo');
      await new Promise((r) => setTimeout(r, 100));
    }
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

/** O `phase_result` do despacho, quando o watcher o grava. */
function resultadoDaFase(p: ProjetoDeTeste, threadId: string, sessionId: string): Record<string, unknown> {
  esperarCondicao(() => lerLedger(dirThread(p.dir, threadId)).some((e) => e.tipo === 'phase_result' && e.sessionId === sessionId), 60000);
  return lerLedger(dirThread(p.dir, threadId)).find((e) => e.tipo === 'phase_result' && e.sessionId === sessionId) as Record<string, unknown>;
}

/** Os arquivos do servidor do despacho, ao lado do log do supervisor. */
const doDespacho = (p: ProjetoDeTeste, threadId: string, sessionId: string) =>
  ({ logPath: path.join(dirThread(p.dir, threadId), 'sessoes', `${sessionId}.grok.jsonl`),
    ...arquivosDoServidorGrok(path.join(dirThread(p.dir, threadId), 'sessoes', `${sessionId}.grok.jsonl`)) });

test('GX4: o despacho real sobe o servidor fora do grok, e o filho no workspace grava decisao, claim e artefato pelo MCP externo; a fase fecha com prova', () => {
  const stub = grokFalso('gx4-despacho');
  const p = projetoTemporario('gx4-despacho');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree' });
    const t = novaThread(p.carregado, { nome: 'gx4', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    stub.stream('fim-normal.jsonl');
    stub.mcp([
      { nome: 'ork_decision_record', argumentos: { threadId: t.id, decidido: 'Fixture SIMULADA de decisao pelo servidor externo',
        porque: 'Conferir que o filho no workspace grava o ledger', comoMudar: 'Nao se aplica', custoAgora: 'Nenhum', custoDepois: 'Nenhum',
        criterio: { tipo: 'medicao', referencia: 'core/test/rm067-grok-mcp-externo.test.ts (GX4)' }, quemDecidiu: 'sessao grok SIMULADA',
        evidencia: 'teste' } },
      { nome: 'ork_claim_add', argumentos: { threadId: t.id, arquivo: 'README.md', alegacao: 'Fixture SIMULADA de claim pelo servidor externo',
        verificar: ['true'] } },
      { nome: 'ork_artifact_write', argumentos: { threadId: t.id, tipo: 'goal', conteudo: '# GOAL SIMULADO pelo grok falso\n', expectedSha256: null } },
    ], { esperar: true });
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Fixture SIMULADA do MCP externo', runtime: 'grok', model: 'grok-modelo' });
    assert.ok(r.sessionId, r.erro);
    const sid = r.sessionId!;
    const arquivos = doDespacho(p, t.id, sid);

    // O grok segue no piso workspace, sem nada que aprove tudo.
    assert.equal(r.comando[r.comando.indexOf('--sandbox') + 1], 'workspace');
    for (const proibido of ['off', 'danger-full-access', '--yolo', '--always-approve', '--permission-mode', 'bypassPermissions'])
      assert.equal(r.comando.includes(proibido), false, proibido);
    const config = fs.readFileSync(path.join(wt, '.grok', 'config.toml'), 'utf8');
    const entrada = (parse(config) as { mcp_servers: Record<string, Record<string, unknown>> }).mcp_servers.orkastery;
    assert.deepEqual(Object.keys(entrada).sort(), ['bearer_token_env_var', 'url'], 'a forma url, com o token so no ambiente (G5)');
    assert.equal(entrada.bearer_token_env_var, ENV_DO_TOKEN_DO_SERVIDOR_GROK);

    // O despacho soltou a trava da thread: a sessao chama as ferramentas.
    stub.liberarMcp();
    const resultado = resultadoDaFase(p, t.id, sid);
    assert.equal(resultado.classificacao, 'fase_concluida', JSON.stringify(resultado.provaOrk));
    assert.equal((resultado.provaOrk as { ok: boolean }).ok, true);
    const mcp = stub.mcpResultado();
    assert.ok(mcp && !mcp.erro, JSON.stringify(mcp));
    // D2 (GO-FIX 1): o filho mandou o token do ambiente, e ele nao esta no argv nem em arquivo nenhum do projeto.
    const token = mcp!.token!;
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(r.comando.some((a) => a.includes(token)), false, 'o token nao vai ao argv');
    assert.deepEqual(arquivosCom(token, [p.dir]), [], 'nem a config, o ledger, as claims, os recibos ou os logs');
    assert.deepEqual(ordenadas(mcp!.ferramentas), ordenadas(ferramentasDoGrok('worktree', false, false)), 'a lista do --allow deste despacho');
    assert.deepEqual(mcp!.chamadas.map((c) => [c.nome, c.isError]),
      [['ork_decision_record', false], ['ork_claim_add', false], ['ork_artifact_write', false]], JSON.stringify(mcp!.chamadas));

    const eventos = lerLedger(dirThread(p.dir, t.id));
    const dispatchId = (eventos.find((e) => e.tipo === 'phase_prompt_recorded')?.identidade as { dispatchId: string }).dispatchId;
    const { eventId } = JSON.parse(mcp!.chamadas[0].texto) as { eventId: string };
    const decisao = eventos.find((e) => e.tipo === 'autonomous_decision' && e.eventId === eventId);
    assert.deepEqual([decisao?.host, decisao?.canal, decisao?.despacho], ['grok', 'grok', dispatchId], 'o ledger, gravado pelo servidor do despacho');
    assert.deepEqual([decisao?.origem, decisao?.decisao], ['mcp', 'Fixture SIMULADA de decisao pelo servidor externo']);
    assert.match(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'claims.jsonl'), 'utf8'), /Fixture SIMULADA de claim pelo servidor externo/);
    assert.equal(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'docs', 'goal.md'), 'utf8'), '# GOAL SIMULADO pelo grok falso\n');

    // O servidor e irmao do grok, filho do processo que despachou: o sandbox do grok, que vale para ele e os filhos, nao o alcanca.
    const recibo = lerReciboServidorGrok(arquivos.reciboPath)!;
    assert.equal(recibo.conferirProcesso, true, 'no workspace, a conexao tem de vir da arvore do grok');
    const supervisor = JSON.parse(fs.readFileSync(`${arquivos.logPath}.process.json`, 'utf8')) as ProcessoCodex;
    const [grok] = stub.pids();
    assert.equal(recibo.pai, process.pid);
    assert.equal(grok.pai, supervisor.supervisor?.pid, 'o grok e filho do supervisor');
    assert.notEqual(recibo.processo?.pid, grok.pid);
    assert.notEqual(recibo.pai, grok.pid);
    esperarCondicao(() => lerReciboServidorGrok(arquivos.reciboPath)?.estado === 'encerrado' && estadoProcesso(recibo.processo) === 'ausente', 20000);
    assert.equal(lerReciboServidorGrok(arquivos.reciboPath)?.motivo, 'recibo', 'o servidor sai com o recibo do supervisor');
  } finally { p.limpar(); stub.restaurar(); }
});

test('GX5: o despacho com o servidor externo nunca abre o auth.json do perfil: um FIFO no lugar dele nao trava nada', () => {
  const stub = grokFalso('gx5-fifo');
  const p = projetoTemporario('gx5-fifo');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok' });
    // O auth.json do perfil e um FIFO: quem o abrisse para ler ficaria preso, e o despacho e o servidor nao terminariam.
    const casa = path.join(stub.dir, 'casa-f');
    fs.mkdirSync(casa, { mode: 0o700 });
    execFileSync('mkfifo', ['-m', '600', path.join(casa, 'auth.json')]);
    adicionarPerfil(p.dir, { id: 'f', runtime: 'grok', dir: casa });
    const t = novaThread(p.carregado, { nome: 'gx5', modo: 'auto', criarWorktree: true }).thread;
    stub.stream('fim-normal.jsonl');
    stub.mcp([{ nome: 'ork_thread_status', argumentos: { threadId: t.id } }]);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Fixture SIMULADA do FIFO', runtime: 'grok', model: 'grok-modelo', perfil: 'f' });
    assert.ok(r.sessionId, r.erro);
    resultadoDaFase(p, t.id, r.sessionId!);
    assert.deepEqual(stub.mcpResultado()?.chamadas.map((c) => c.isError), [false], JSON.stringify(stub.mcpResultado()));
    assert.equal(fs.statSync(path.join(casa, 'auth.json')).isFIFO(), true, 'o FIFO segue no lugar, sem copia');
    // Os modulos novos nao tem caminho de codigo que leia o auth.json: o nome so poderia aparecer em comentario.
    for (const arquivo of ['adapters/grok-mcp.ts', 'adapters/grok-mcp-servidor.ts']) {
      const codigo = FONTE(arquivo).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
      assert.equal(/auth\.json|GROK_HOME/.test(codigo.replace(/\/\/.*$/gm, '')), false, arquivo);
    }
  } finally { p.limpar(); stub.restaurar(); }
});

test('GX6: a config que ficaria visivel ao git recusa depois de o servidor subir, e o despacho o encerra sem deixar o token', () => {
  const stub = grokFalso('gx6-falha');
  const p = projetoTemporario('gx6-falha');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok' });
    const t = novaThread(p.carregado, { nome: 'gx6', modo: 'auto', criarWorktree: true }).thread;
    // Um .gitignore de .grok que nao ignora a config: a escrita volta atras e recusa (F4b, D3).
    fs.mkdirSync(path.join(t.worktree!, '.grok'));
    fs.writeFileSync(path.join(t.worktree!, '.grok', '.gitignore'), 'outro-arquivo\n');
    stub.stream('fim-normal.jsonl');
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Fixture SIMULADA da falha', runtime: 'grok', model: 'grok-modelo' });
    assert.equal(r.sessionId, null);
    assert.match(String(r.erro), /^runtime\.unavailable: runtime\.context\.conflict: a config da sessao ficaria visivel ao git/);
    assert.deepEqual(stub.chamadas(), [], 'o grok nao rodou');
    const sessoes = path.join(dirThread(p.dir, t.id), 'sessoes');
    const recibos = fs.readdirSync(sessoes).filter((f) => f.endsWith('.grok-mcp.json')).map((f) => path.join(sessoes, f));
    assert.equal(recibos.length, 1, 'o servidor deste despacho chegou a subir');
    esperarCondicao(() => lerReciboServidorGrok(recibos[0])?.estado === 'encerrado', 20000);
    const recibo = lerReciboServidorGrok(recibos[0])!;
    assert.equal(recibo.motivo, 'sinal', 'encerrado pelo despacho');
    esperarCondicao(() => estadoProcesso(recibo.processo) === 'ausente', 20000);
    assert.deepEqual(fs.readdirSync(sessoes).filter((f) => f.includes('token')), [], 'nenhum arquivo de token');
  } finally { p.limpar(); stub.restaurar(); }
});

test('GX7: a sessao com o MCP interrompida vai ao dono com a retomada, e o aviso diz que o servidor terminou com ela', () => {
  const stub = grokFalso('gx7-retomada');
  const p = projetoTemporario('gx7-retomada');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok' });
    const t = novaThread(p.carregado, { nome: 'gx7', modo: 'auto', criarWorktree: true }).thread;
    stub.stream('cortado.jsonl');
    stub.sinal('TERM');
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Fixture SIMULADA da interrupcao', runtime: 'grok', model: 'grok-modelo' });
    assert.ok(r.sessionId, r.erro);
    const resultado = resultadoDaFase(p, t.id, r.sessionId!);
    assert.equal(resultado.motivo, 'human.pending');
    const detalhe = String(resultado.detalhe);
    const aviso = detalhe.indexOf(AVISO_DA_RETOMADA_COM_MCP);
    assert.ok(aviso >= 0, detalhe);
    assert.ok(aviso < detalhe.indexOf('; retomada: '), 'o aviso vem antes do comando, que as telas cortam no fim');
    assert.match(AVISO_DA_RETOMADA_COM_MCP, /servidor MCP do ork terminou com a sessao/);
    assert.match(AVISO_DA_RETOMADA_COM_MCP, /ork retry, que sobe outro servidor e reescreve a config/);
    // O servidor terminou com a sessao: a config que a retomada manual reusa aponta para um token que nao existe mais.
    const arquivos = doDespacho(p, t.id, r.sessionId!);
    esperarCondicao(() => lerReciboServidorGrok(arquivos.reciboPath)?.estado === 'encerrado', 20000);
    const entrada = (parse(fs.readFileSync(path.join(t.worktree!, '.grok', 'config.toml'), 'utf8')) as
      { mcp_servers: Record<string, Record<string, unknown>> }).mcp_servers.orkastery;
    assert.deepEqual(Object.keys(entrada).sort(), ['bearer_token_env_var', 'url'], 'a config so nomeia a variavel do token');
    assert.equal(entrada.bearer_token_env_var, ENV_DO_TOKEN_DO_SERVIDOR_GROK, 'que so existia no ambiente da sessao encerrada');
  } finally { p.limpar(); stub.restaurar(); }
});

test('GX8: a sessao MCP que passa do limite despeja a usada ha mais tempo, sem recusar o cliente que reabre o initialize', async () => {
  const b = bancada('gx8-sessoes');
  try {
    const autorizado = { Authorization: `Bearer ${b.token}` };
    const ids: string[] = [];
    for (let i = 0; i <= LIMITE_DE_SESSOES_MCP; i++) {
      const r = await pedir(b.s.porta, { cabecalhos: autorizado });
      assert.equal(r.status, 200, r.corpo);
      ids.push(String(r.cabecalhos['mcp-session-id']));
    }
    assert.equal(new Set(ids).size, LIMITE_DE_SESSOES_MCP + 1);
    const lista = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const versao = { 'Mcp-Protocol-Version': '2025-06-18' };
    const naPrimeira = await pedir(b.s.porta, { cabecalhos: { ...autorizado, ...versao, 'Mcp-Session-Id': ids[0] }, corpo: lista });
    assert.equal(naPrimeira.status, 404, 'a mais antiga, ociosa, saiu');
    const naUltima = await pedir(b.s.porta, { cabecalhos: { ...autorizado, ...versao, 'Mcp-Session-Id': ids.at(-1)! }, corpo: lista });
    assert.equal(naUltima.status, 200, naUltima.corpo);

    // GO-FIX 2 (R2): a sessao com pedido em curso nao e despejada, mesmo sendo a usada ha mais tempo.
    const resposta: Buffer[] = [];
    let fechou = false;
    const sock = net.connect({ host: '127.0.0.1', port: b.s.porta });
    sock.on('data', (parte: Buffer) => resposta.push(parte));
    sock.on('close', () => { fechou = true; });
    sock.on('error', () => { fechou = true; });
    await new Promise<void>((r) => sock.once('connect', () => r()));
    sock.write(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${b.s.porta}\r\nAuthorization: Bearer ${b.token}\r\nContent-Type: application/json\r\n` +
      `Accept: application/json, text/event-stream\r\nMcp-Session-Id: ${ids[1]}\r\nMcp-Protocol-Version: 2025-06-18\r\n` +
      `Content-Length: ${Buffer.byteLength(lista)}\r\nConnection: close\r\n\r\n${lista.slice(0, 5)}`);
    await new Promise((r) => setTimeout(r, 1500));
    // As outras tres sao usadas depois: a ocupada fica com o uso mais antigo de todas.
    for (const outra of ids.slice(2))
      assert.equal((await pedir(b.s.porta, { cabecalhos: { ...autorizado, ...versao, 'Mcp-Session-Id': outra }, corpo: lista })).status, 200);
    const sexta = await pedir(b.s.porta, { cabecalhos: autorizado });
    assert.equal(sexta.status, 200, sexta.corpo);
    assert.equal((await pedir(b.s.porta, { cabecalhos: { ...autorizado, ...versao, 'Mcp-Session-Id': ids[2] }, corpo: lista })).status, 404,
      'saiu a ociosa seguinte, nao a ocupada');
    sock.write(lista.slice(5));
    await esperarAte(() => fechou, 20000);
    assert.match(Buffer.concat(resposta).toString('utf8'), /^HTTP\/1\.1 200 /, 'a sessao ocupada seguiu de pe e respondeu');
  } finally { b.limpar(); }
});

test('GX9: no sandbox, a conexao tem de vir da arvore de processos do grok do despacho: o token certo de fora dela recusa', async (t) => {
  const fora = bancada('gx9-fora', { grok: 'sleep' });
  const semConferir = bancada('gx9-sem-conferir', { grok: 'sleep', conferirProcesso: false });
  const dentro = bancada('gx9-dentro');
  try {
    // O "grok" e um sleep: o processo do teste, com o token certo, esta fora da arvore dele.
    const recusada = await pedir(fora.s.porta, { cabecalhos: { Authorization: `Bearer ${fora.token}` } });
    assert.equal(recusada.status, 403);
    assert.match(recusada.corpo, /mcp\.grok\.process/);
    assert.equal(lerReciboServidorGrok(fora.s.reciboPath)?.conferirProcesso, true);
    // Sem a conferencia (o perfil off, em que o guia nao diz quem conecta), vale so o token.
    assert.equal((await pedir(semConferir.s.porta, { cabecalhos: { Authorization: `Bearer ${semConferir.token}` } })).status, 200);
    assert.equal(lerReciboServidorGrok(semConferir.s.reciboPath)?.conferirProcesso, false);
    // Um descendente do "grok" (aqui, um filho do processo do teste) e da sessao e entra.
    const filho = spawnSync(process.execPath, ['-e', `
      const req = require('node:http').request({ host: '127.0.0.1', port: ${dentro.s.porta}, method: 'POST', path: '/mcp',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ${dentro.token}' } },
        (res) => { process.stdout.write(String(res.statusCode)); res.resume(); });
      req.end(${JSON.stringify(JSON.stringify(INICIO))});`], { encoding: 'utf8', timeout: 30000 });
    assert.equal(filho.stdout, '200', filho.stderr);
    // GO-FIX 3: o cliente da arvore com socket IPv6, no endereco v4-mapeado, aparece no /proc/net/tcp6 e tambem entra.
    const v6 = await new Promise<number | string>((resolve) => {
      const req = http.request({ host: '::ffff:127.0.0.1', family: 6, port: dentro.s.porta, method: 'POST', path: '/mcp',
        headers: { Host: `127.0.0.1:${dentro.s.porta}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${dentro.token}` } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? 'erro'));
      req.end(JSON.stringify(INICIO));
    });
    if (typeof v6 === 'number') assert.equal(v6, 200, 'o cliente IPv6 da arvore entra');
    else t.diagnostic(`sem socket IPv6 nesta maquina (${v6}): o caminho do tcp6 fica sem o caso`);
    // O recusado deixa o motivo no log do servidor, sem o token.
    const log = fs.readFileSync(path.join(path.dirname(fora.logPath), path.basename(fora.logPath).replace(/\.grok\.jsonl$/, '.grok-mcp.log')), 'utf8');
    assert.match(log, /conexao recusada: conexao de processo fora da arvore do grok/);
    assert.equal(log.includes(fora.token), false);
  } finally { fora.limpar(); semConferir.limpar(); dentro.limpar(); }
});

test('GX10: a conexao que chega antes do .process.json do supervisor espera por ele e entra; a recusa so vem depois de ve-lo', async () => {
  const b = bancada('gx10-corrida', { semPartida: true, prazoDaPartidaMs: 20000 });
  try {
    const pedido = pedir(b.s.porta, { cabecalhos: { Authorization: `Bearer ${b.token}` } });
    await new Promise((r) => setTimeout(r, 1500));
    // O supervisor grava o .process.json depois: o "grok" e o proprio processo do teste.
    gravarAtomico(`${b.logPath}.process.json`, { schema: 'ork.codex-process/v1', iniciadoEm: new Date().toISOString(),
      supervisor: identidadeProcesso(process.pid), filho: identidadeProcesso(process.pid) });
    const r = await pedido;
    assert.equal(r.status, 200, r.corpo);
    // Na mesma conexao reaproveitada e em conexao nova, o aceite segue.
    assert.equal((await pedir(b.s.porta, { cabecalhos: { Authorization: `Bearer ${b.token}` } })).status, 200);
  } finally { b.limpar(); }
});
