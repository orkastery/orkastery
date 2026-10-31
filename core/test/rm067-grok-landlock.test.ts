/**
 * RM-067 (F4c, D11, thread ork-rm067f4cmcpd): a prova com o confinamento de verdade. O `grok` falso roda pelo Landlock do
 * kernel como o perfil `workspace` do `grok` (G7 e G17 da RM-067): escrita so na worktree, na casa do `grok` e na pasta do
 * stub, e os filhos herdam. Com a config stdio da F4b, o servidor MCP do `ork` e filho dele e nao grava o ledger, o limite
 * que a pagina documentou; pelo despacho da F4c, o servidor e do `ork`, fora do confinamento, e a fase fecha com prova. E a
 * sessao de outra thread, confinada no proprio dominio, nao acha o token desta: ele nao esta em arquivo, e o Landlock nega a
 * ela o `environ` do `grok` e o do supervisor (GO-FIX 1, achado 1 da revisao); e o token que vazasse nao serve fora da
 * arvore de processos do `grok` (GO-FIX 2, R1).
 *
 * Integracao local (`core/src/integracoes-locais.ts`): o runner hospedado nao garante Landlock nem `python3`. Sem eles o caso
 * pula com o motivo tipado, `ORK_TESTE_EXIGE_AMBIENTE=1` o reprova, e a claim (pelo `conferir-casos.cjs`) reprova o pulado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { configuracaoServidorMcp, instalarMcp } from '../src/mcp-install';
import { MARCA_DA_CONFIG_DO_FILHO } from '../src/adapters/grok';
import { arquivosDoServidorGrok, ENV_DO_TOKEN_DO_SERVIDOR_GROK, iniciarServidorDoGrok, lerReciboServidorGrok } from '../src/adapters/grok-mcp';
import { estadoProcesso, gravarAtomico, identidadeProcesso } from '../src/adapters/codex-runner';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { dirTemporario, projetoTemporario } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { grokFalso } from './grok-falso';
import { LANCADOR_DO_LANDLOCK, semLandlock } from './ambiente-de-teste';

/** Os arquivos comuns sob estas pastas (sem seguir link) que contem o texto. */
function arquivosCom(texto: string, pastas: string[]): string[] {
  const achados: string[] = [];
  const visitar = (pasta: string) => {
    let entradas: fs.Dirent[];
    try { entradas = fs.readdirSync(pasta, { withFileTypes: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    for (const e of entradas) {
      const caminho = path.join(pasta, e.name);
      if (e.isDirectory()) visitar(caminho);
      else if (e.isFile()) {
        try { if (fs.readFileSync(caminho).includes(texto)) achados.push(caminho); }
        catch (erro) { if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') throw erro; }
      }
    }
  };
  for (const pasta of pastas) visitar(pasta);
  return achados;
}

const decisao = (threadId: string, decidido: string) => ({ nome: 'ork_decision_record', argumentos: { threadId, decidido,
  porque: 'Conferir o servidor MCP do ork sob o confinamento do workspace', comoMudar: 'Nao se aplica', custoAgora: 'Nenhum',
  custoDepois: 'Nenhum', criterio: { tipo: 'medicao', referencia: 'core/test/rm067-grok-landlock.test.ts' },
  quemDecidiu: 'sessao grok SIMULADA', evidencia: 'teste' } });

test('GL1: confinado como o workspace, o grok falso nao grava o ledger pelo servidor stdio filho dele, o limite da F4b', { skip: semLandlock() }, () => {
  const stub = grokFalso('gl1-stdio');
  const p = projetoTemporario('gl1-stdio');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok' });
    const t = novaThread(p.carregado, { nome: 'gl1', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    // A config da F4b: o servidor stdio do ork, que o grok sobe como filho e que herda o confinamento dele.
    const servidor = configuracaoServidorMcp(fs.realpathSync(p.dir), 'grok', t.id);
    fs.mkdirSync(path.join(wt, '.grok'));
    fs.writeFileSync(path.join(wt, '.grok', 'config.toml'), [MARCA_DA_CONFIG_DO_FILHO, '[mcp_servers.orkastery]',
      `command = ${JSON.stringify(servidor.command)}`, `args = ${JSON.stringify(servidor.args)}`].join('\n') + '\n');
    const sonda = path.join(dirThread(p.dir, t.id), 'sonda-do-grok');
    stub.confinar([wt, stub.casa, stub.dir]);
    stub.sonda(sonda);
    stub.mcp([{ nome: 'ork_thread_status', argumentos: { threadId: t.id } }, decisao(t.id, 'Fixture SIMULADA pelo servidor stdio confinado')]);
    const antes = lerLedger(dirThread(p.dir, t.id)).length;
    const r = spawnSync('grok', ['-p', 'Fixture SIMULADA', '--output-format', 'streaming-json', '-s', randomUUID(), '--cwd', wt,
      '--trust', '--sandbox', 'workspace'], { encoding: 'utf8', env: process.env, timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(stub.sondaResultado(), 'recusada', 'o filho confinado nao cria arquivo no estado do ork');
    assert.equal(fs.existsSync(sonda), false);
    const mcp = stub.mcpResultado();
    assert.ok(mcp && !mcp.erro, JSON.stringify(mcp));
    assert.equal(mcp!.chamadas[0].isError, false, 'a consulta funciona: o servidor filho le o estado');
    assert.equal(mcp!.chamadas[1].isError, true, 'a decisao nao grava');
    assert.match(mcp!.chamadas[1].texto, /EACCES|permission denied/i, mcp!.chamadas[1].texto);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).length, antes, 'o ledger nao ganhou evento');
  } finally { p.limpar(); stub.restaurar(); }
});

test('GL2: com o mesmo confinamento, pelo despacho da F4c o filho grava decisao, claim e artefato pelo servidor do ork, e a fase fecha com prova', { skip: semLandlock() }, () => {
  const stub = grokFalso('gl2-externo');
  const p = projetoTemporario('gl2-externo');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree' });
    const t = novaThread(p.carregado, { nome: 'gl2', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    const sonda = path.join(dirThread(p.dir, t.id), 'sonda-do-grok');
    stub.confinar([wt, stub.casa, stub.dir]);
    stub.sonda(sonda);
    stub.stream('fim-normal.jsonl');
    stub.mcp([decisao(t.id, 'Fixture SIMULADA pelo servidor externo confinado'),
      { nome: 'ork_claim_add', argumentos: { threadId: t.id, arquivo: 'README.md', alegacao: 'Fixture SIMULADA de claim sob o Landlock',
        verificar: ['true'] } },
      { nome: 'ork_artifact_write', argumentos: { threadId: t.id, tipo: 'goal', conteudo: '# GOAL SIMULADO sob o Landlock\n', expectedSha256: null } },
    ], { esperar: true });
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Fixture SIMULADA sob o Landlock', runtime: 'grok', model: 'grok-modelo' });
    assert.ok(r.sessionId, r.erro);
    assert.equal(r.comando[r.comando.indexOf('--sandbox') + 1], 'workspace');
    stub.liberarMcp();
    const sid = r.sessionId!;
    esperarCondicao(() => lerLedger(dirThread(p.dir, t.id)).some((e) => e.tipo === 'phase_result' && e.sessionId === sid), 60000);
    assert.equal(stub.sondaResultado(), 'recusada', 'o filho seguia confinado');
    assert.equal(fs.existsSync(sonda), false);
    const mcp = stub.mcpResultado();
    assert.ok(mcp && !mcp.erro, JSON.stringify(mcp));
    assert.deepEqual(mcp!.chamadas.map((c) => c.isError), [false, false, false], JSON.stringify(mcp!.chamadas));
    const eventos = lerLedger(dirThread(p.dir, t.id));
    const resultado = eventos.find((e) => e.tipo === 'phase_result' && e.sessionId === sid)!;
    assert.equal(resultado.classificacao, 'fase_concluida', JSON.stringify(resultado.provaOrk));
    const { eventId } = JSON.parse(mcp!.chamadas[0].texto) as { eventId: string };
    assert.equal(eventos.find((e) => e.eventId === eventId)?.host, 'grok', 'a decisao entrou no ledger pelo servidor do ork');
    assert.match(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'claims.jsonl'), 'utf8'), /Fixture SIMULADA de claim sob o Landlock/);
    assert.equal(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'docs', 'goal.md'), 'utf8'), '# GOAL SIMULADO sob o Landlock\n');
  } finally { p.limpar(); stub.restaurar(); }
});

test('GL3: a sessao de outra thread, confinada no proprio dominio, nao acha o token desta: nenhum arquivo o tem, e o environ do grok e do supervisor lhe e negado; o token vazado nao serve fora da arvore do grok', { skip: semLandlock() }, async () => {
  const stub = grokFalso('gl3-irma');
  const p = projetoTemporario('gl3-irma');
  const irma = dirTemporario('gl3-irma-confinada');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree' });
    const t = novaThread(p.carregado, { nome: 'gl3', modo: 'auto', criarWorktree: true }).thread;
    stub.confinar([t.worktree!, stub.casa, stub.dir]);
    stub.stream('fim-normal.jsonl');
    stub.mcp([{ nome: 'ork_thread_status', argumentos: { threadId: t.id } }], { esperar: true });
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Fixture SIMULADA da sessao irma', runtime: 'grok', model: 'grok-modelo' });
    assert.ok(r.sessionId, r.erro);
    const sid = r.sessionId!;
    // O grok desta thread esta vivo, esperando a liberacao. O processo do teste, sem confinamento, ve o token no environ dele.
    const [grok] = stub.pids();
    const environ = fs.readFileSync(`/proc/${grok.pid}/environ`, 'utf8');
    const token = environ.split('\0').find((v) => v.startsWith(`${ENV_DO_TOKEN_DO_SERVIDOR_GROK}=`))?.slice(ENV_DO_TOKEN_DO_SERVIDOR_GROK.length + 1);
    assert.match(String(token), /^[a-f0-9]{64}$/, 'o controle: o token esta no ambiente do grok');
    assert.deepEqual(arquivosCom(token!, [p.dir]), [], 'nenhum arquivo do projeto tem o token: recibo, config, log, estado');
    // A pasta que some durante a varredura (o vigia apaga o watch.lock) nao e erro: o caso deterministico da mesma corrida.
    assert.deepEqual(arquivosCom(token!, [path.join(p.dir, 'pasta-que-sumiu')]), [], 'pasta que sumiu nao reprova a varredura');
    // A sessao irma: outro dominio do Landlock, com escrita so na pasta dela, como a sessao grok de outra thread.
    const lista = path.join(irma, 'pastas');
    fs.writeFileSync(lista, `${irma}\n`);
    for (const [quem, pid] of [['grok', grok.pid], ['supervisor', grok.pai]] as const) {
      const leitura = spawnSync('python3', ['-I', LANCADOR_DO_LANDLOCK, lista, '/bin/cat', `/proc/${pid}/environ`], { encoding: 'utf8', timeout: 60000 });
      assert.notEqual(leitura.status, 0, `a irma confinada nao le o environ do ${quem}`);
      assert.equal(leitura.stdout.includes(token!), false);
    }
    // GO-FIX 2 (R1): mesmo vazado, por exemplo pela saida de uma ferramenta num log, o token nao serve fora da arvore do grok.
    const recibo = lerReciboServidorGrok(arquivosDoServidorGrok(path.join(dirThread(p.dir, t.id), 'sessoes', `${sid}.grok.jsonl`)).reciboPath)!;
    assert.equal(recibo.conferirProcesso, true);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: recibo.porta, method: 'POST', path: '/mcp', headers: { 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'irma-SIMULADA', version: '1' } } }));
    });
    assert.equal(status, 403, 'o token certo, de um processo fora da arvore do grok, recusa');
    stub.liberarMcp();
    esperarCondicao(() => lerLedger(dirThread(p.dir, t.id)).some((e) => e.tipo === 'phase_result' && e.sessionId === sid), 60000);
    assert.deepEqual(stub.mcpResultado()?.chamadas.map((c) => c.isError), [false], 'e a sessao desta thread segue com o MCP');
  } finally { p.limpar(); stub.restaurar(); fs.rmSync(irma, { recursive: true, force: true }); }
});

/** Um cliente MCP que tambem se marca nao despejavel antes de conectar: o servidor nao acha o dono do socket dele. */
const CLIENTE_NAO_DESPEJAVEL = [
  'import ctypes, http.client, json, os, sys',
  'ctypes.CDLL(None).prctl(4, 0, 0, 0, 0)',
  'c = http.client.HTTPConnection("127.0.0.1", int(sys.argv[1]), timeout=20)',
  'inicio = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {},',
  '  "clientInfo": {"name": "fixture-SIMULADA", "version": "1"}}}',
  'c.request("POST", "/mcp", body=json.dumps(inicio), headers={"Content-Type": "application/json",',
  '  "Accept": "application/json, text/event-stream", "Authorization": "Bearer " + os.environ["ORK_TESTE_TOKEN"]})',
  'print(c.getresponse().status)',
].join('\n');

test('GL4: com o grok nao despejavel, o dono legivel de fora da arvore recusa, e o dono que tambem nao se le vale so pelo token, com aviso no log', { skip: semLandlock() }, async () => {
  const p = projetoTemporario('gl4-nao-despejavel');
  // Um processo que se marca nao despejavel, como um CLI que guarda credencial: o /proc/<pid>/fd dele fica negado.
  const grok = spawn('python3', ['-I', '-c', 'import ctypes,time; ctypes.CDLL(None).prctl(4,0,0,0,0); time.sleep(120)'], { stdio: 'ignore' });
  try {
    const t = novaThread(p.carregado, { nome: 'gl4', modo: 'auto', criarWorktree: true }).thread;
    const logPath = path.join(dirThread(p.dir, t.id), 'sessoes', `${randomUUID()}.grok.jsonl`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    esperarCondicao(() => { try { fs.readdirSync(`/proc/${grok.pid}/fd`); return false; } catch { return true; } }, 10000);
    gravarAtomico(`${logPath}.process.json`, { schema: 'ork.codex-process/v1', iniciadoEm: new Date().toISOString(),
      supervisor: identidadeProcesso(process.pid), filho: identidadeProcesso(grok.pid!) });
    const s = iniciarServidorDoGrok({ projeto: fs.realpathSync(p.dir), threadId: t.id, dispatchId: randomUUID(), permissoesFilho: 'worktree',
      transporteShip: 'github-ssh', ferramentas: ['ork_thread_status'], logPath, conferirProcesso: true }, t.worktree!, process.env);
    try {
      // GO-FIX 4: sem os descritores do grok, o servidor procura o socket entre os processos que se leem. O processo do
      // teste se le e esta fora da arvore do "grok": o token certo dele recusa.
      const doTeste = await new Promise<number>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: s.porta, method: 'POST', path: '/mcp', headers: { 'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream', Authorization: `Bearer ${s.token}` } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-SIMULADA', version: '1' } } }));
      });
      assert.equal(doTeste, 403, 'o dono legivel de fora da arvore recusa, mesmo com o token certo');
      // O cliente que tambem nao se le, como o proprio grok nao despejavel: vale so o token, e o log diz isso.
      const cliente = spawnSync('python3', ['-I', '-c', CLIENTE_NAO_DESPEJAVEL, String(s.porta)],
        { encoding: 'utf8', timeout: 30000, env: { ...process.env, ORK_TESTE_TOKEN: s.token } });
      assert.equal(cliente.stdout.trim(), '200', cliente.stderr);
      const log = fs.readFileSync(arquivosDoServidorGrok(logPath).stderrPath, 'utf8');
      assert.match(log, /conexao recusada: conexao de processo fora da arvore do grok/);
      assert.match(log, /o grok nao deixa ler os descritores dele; a conexao vale so pelo token/);
    } finally { s.encerrar(); esperarCondicao(() => estadoProcesso(s.processo) === 'ausente', 15000); }
  } finally { grok.kill('SIGKILL'); p.limpar(); }
});
