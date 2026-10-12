/**
 * RM-052 (fatia 2, L3): toda resposta de projeto diz qual projeto leu.
 *
 * Na fatia 1, so maestro, board, fabrica e roadmap status declaravam o projeto consultado. Pela
 * extensao OpenClaw real, com o gateway no cwd de outro projeto e `projeto: orkastery`, dez das
 * catorze tools de projeto respondiam sem nomea-lo; com um so projeto conhecido e a tool chamada sem
 * `projeto`, a resposta era a dele, sem aviso. Agora o comando termina com `Projeto consultado: ...` no
 * stderr quando o leitor nao tem como saber qual projeto foi lido (host, ou projeto fora do cwd), e o
 * comando que monta o proprio cabecalho nao repete a linha. No terminal, dentro do proprio projeto,
 * nada muda. O teste das tools e o de "fora do cwd" reprovam o codigo da fatia 1.
 */
import { strict as assert } from 'node:assert';
import { test, TestContext } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as os from 'node:os';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { novaThread } from '../src/thread';
import { exec } from '../src/util';
import {
  consultaDoProjeto, declaracaoQueFaltou, iniciarDeclaracaoDoProjeto, pedirDeclaracaoDoProjeto, registrarProjeto,
  remotoParaExibir,
} from '../src/projeto-alvo';
import { dirTemporario, projetoTemporario } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const DIST_OPENCLAW = path.resolve(__dirname, '../../../adapters/openclaw/dist');
const LINHA = /^Projeto consultado: orkastery \(ork\) · /m;

type Tool = { name: string; execute: (p: Record<string, unknown>, c: unknown, x: unknown) => Promise<string> };

/** A maquina: o orkastery com uma thread, o alfa e o workspace do gateway, os tres registrados. */
function maquina(t: TestContext) {
  const orkastery = projetoTemporario('declaracao-orkastery');
  const alfa = projetoTemporario('declaracao-alfa');
  init(alfa.dir, { nome: 'alfa', abbrev: 'alf', force: true });
  alfa.carregado = exigirManifesto(alfa.dir);
  const workspace = projetoTemporario('declaracao-workspace');
  init(workspace.dir, { nome: 'workspace', abbrev: 'wor', force: true });
  workspace.carregado = exigirManifesto(workspace.dir);
  const { thread } = novaThread(orkastery.carregado, { nome: 'declaracao', modo: 'auto' });
  const usuario = dirTemporario('declaracao-usuario');
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  for (const p of [orkastery, alfa, workspace]) registrarProjeto(p.dir, 'init');
  t.after(() => {
    if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
    for (const p of [orkastery, alfa, workspace]) p.limpar();
    fs.rmSync(usuario, { recursive: true, force: true });
  });
  return { orkastery, alfa, workspace, thread: thread.id, usuario };
}

function ork(cwd: string, args: string[], env: NodeJS.ProcessEnv, entrada?: string) {
  const r = spawnSync(process.execPath, [ORK, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000, input: entrada });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const vezes = (texto: string) => (texto.match(/Projeto consultado:/g) ?? []).length;

test('L3: no terminal, dentro do projeto e sem pedido explicito, nada muda; fora dele, uma linha no fim', (t) => {
  const m = maquina(t);
  const env = { ...process.env, ORK_USUARIO_DIR: m.usuario };
  for (const [nome, extra] of [['sem pedido', {}], ['ORK_PROJETO do proprio cwd', { ORK_PROJETO: 'orkastery' }]] as const) {
    const r = ork(m.orkastery.dir, ['thread', 'status', m.thread], { ...env, ...extra });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(vezes(r.stdout + r.stderr), 0, `${nome}: ${r.stderr}`);
  }
  const opcao = ork(m.alfa.dir, ['--projeto', 'orkastery', 'thread', 'status', m.thread], env);
  assert.equal(opcao.status, 0, opcao.stdout + opcao.stderr);
  assert.match(opcao.stdout, new RegExp(`Thread ${m.thread}`));
  assert.equal(vezes(opcao.stdout), 0, 'o stdout segue o de sempre');
  assert.match(opcao.stderr, /^Projeto consultado: orkastery \(ork\) · .* · sem remoto · pela opção --projeto$/m);
  assert.equal(vezes(opcao.stderr), 1);
  const ambiente = ork(m.alfa.dir, ['thread', 'status', m.thread], { ...env, ORK_PROJETO: 'orkastery' });
  assert.match(ambiente.stderr, /^Projeto consultado: orkastery \(ork\) .* por ORK_PROJETO$/m);
  // No host, a linha vem mesmo com o gateway parado dentro do proprio projeto.
  const host = ork(m.orkastery.dir, ['--projeto', 'orkastery', 'thread', 'status', m.thread], { ...env, ORK_PROJETO_EXPLICITO: '1' });
  assert.equal(vezes(host.stderr), 1, host.stderr);
  // O comando que falha tambem diz qual projeto leu: a thread que nao existe NESTE projeto.
  const falha = ork(m.alfa.dir, ['--projeto', 'orkastery', 'thread', 'status', 'ork-nao-existe'], env);
  assert.notEqual(falha.status, 0);
  assert.match(falha.stderr, LINHA);
  assert.match(falha.stderr, /nao encontrada/);
});

test('L3: os comandos com cabecalho proprio declaram uma vez so; maestro e sessions event nao ganham a linha', (t) => {
  const m = maquina(t);
  const env = { ...process.env, ORK_USUARIO_DIR: m.usuario };
  for (const args of [['board'], ['board', 'plan'], ['fabrica'], ['roadmap', 'status'], ['roadmap', 'reservas'], ['maestro']]) {
    const r = ork(m.alfa.dir, ['--projeto', 'orkastery', ...args], env);
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.equal(vezes(r.stdout + r.stderr), 1, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
    assert.equal(vezes(r.stderr), 0, `${args.join(' ')} declara no proprio cabecalho, no stdout`);
  }
  const maestro = ork(m.alfa.dir, ['--projeto', 'orkastery', 'maestro', '--json'], env);
  assert.equal(JSON.parse(maestro.stdout).project.name, 'orkastery');
  assert.equal(vezes(maestro.stderr), 0);
  // O sensor dos hooks compara o stderr da recusa; ele nao ganha a linha.
  const evento = ork(m.alfa.dir, ['--projeto', 'orkastery', 'sessions', 'event', '--tipo', 'stop',
    '--sessao', '11111111-2222-3333-4444-555555555555'], env, '{}');
  assert.equal(vezes(evento.stderr), 0, evento.stderr);
});

test('L3 (sugestao T1 do CHECK): no host, o unico projeto conhecido responde e diz que foi ele', (t) => {
  const p = projetoTemporario('declaracao-unico');
  const { thread } = novaThread(p.carregado, { nome: 'unico', modo: 'auto' });
  const usuario = dirTemporario('declaracao-unico-usuario');
  const gatewaySemProjeto = dirTemporario('declaracao-unico-gateway');
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  registrarProjeto(p.dir, 'init');
  t.after(() => {
    if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
    p.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); fs.rmSync(gatewaySemProjeto, { recursive: true, force: true });
  });
  // A tool chamada sem `projeto` numa maquina que so conhece um: a resposta e dele, e o diz.
  const r = ork(gatewaySemProjeto, ['thread', 'status', thread.id], { ...process.env, ORK_USUARIO_DIR: usuario, ORK_PROJETO_EXPLICITO: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /^Projeto consultado: orkastery \(ork\) · .* · único projeto conhecido nesta máquina$/m);
});

test('L3 (sugestao A3 do CHECK): a consulta de outro projeto nao apaga a declaracao pedida', (t) => {
  const a = projetoTemporario('declaracao-a3-a');
  const b = projetoTemporario('declaracao-a3-b');
  init(b.dir, { nome: 'beta', abbrev: 'bet', force: true });
  b.carregado = exigirManifesto(b.dir);
  t.after(() => { iniciarDeclaracaoDoProjeto(); a.limpar(); b.limpar(); });
  const alvo = { raiz: fs.realpathSync(a.dir), origem: 'opcao' as const, pedido: 'orkastery' };
  pedirDeclaracaoDoProjeto(alvo, { ambiente: { ORK_PROJETO_EXPLICITO: '1' }, cwd: b.dir });
  consultaDoProjeto(b.carregado, { lido: [], naoLido: [] });
  assert.match(declaracaoQueFaltou() ?? '', /^Projeto consultado: orkastery \(ork\) /);
  pedirDeclaracaoDoProjeto(alvo, { ambiente: { ORK_PROJETO_EXPLICITO: '1' }, cwd: b.dir });
  consultaDoProjeto(a.carregado, { lido: [], naoLido: [] });
  assert.equal(declaracaoQueFaltou(), null, 'o cabecalho do proprio alvo dispensa a linha');
});

test('L3 (sugestao S1 do CHECK): o remoto exibido perde query, fragmento e a pasta da conta; segredo sai omitido', (t) => {
  assert.equal(remotoParaExibir('https://gitlab.example.com/dono/repo.git?private_token=glpat-FAKE0123456789#x'),
    'https://gitlab.example.com/dono/repo.git');
  assert.equal(remotoParaExibir(path.join(os.homedir(), 'repos', 'privado', 'repo.git')), `~${path.sep}repos${path.sep}privado${path.sep}repo.git`);
  assert.equal(remotoParaExibir('https://github.com/dono/ghp_0123456789abcdefghij0123/repo.git'), 'remoto omitido (parece carregar segredo)');
  assert.equal(remotoParaExibir('git@github.com:orkastery/orkastery.git'), 'git@github.com:orkastery/orkastery.git');
  assert.equal(remotoParaExibir(null), null);
  // Pelo CLI: a linha do stderr e o cabecalho nao carregam o token da query.
  const m = maquina(t);
  exec('git', ['remote', 'add', 'origin', 'https://gitlab.example.com/dono/repo.git?private_token=glpat-FAKE0123456789'], m.orkastery.dir);
  const env = { ...process.env, ORK_USUARIO_DIR: m.usuario };
  for (const args of [['thread', 'status', m.thread], ['board']]) {
    const r = ork(m.alfa.dir, ['--projeto', 'orkastery', ...args], env);
    assert.match(r.stdout + r.stderr, /Projeto consultado: orkastery \(ork\) · .* · https:\/\/gitlab\.example\.com\/dono\/repo\.git · /, args.join(' '));
    assert.doesNotMatch(r.stdout + r.stderr, /glpat-FAKE|private_token/, args.join(' '));
  }
});

/** A extensao OpenClaw instalada, com o gateway parado no cwd do workspace. */
async function gateway(cwd: string, corpo: (tools: Map<string, Tool>) => Promise<void>): Promise<void> {
  const dir = dirTemporario('declaracao-openclaw');
  const nomes = ['ORK_BIN', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO'];
  const antes = { cwd: process.cwd(), env: Object.fromEntries(nomes.map((n) => [n, process.env[n]])) };
  try {
    const sdk = path.join(dir, 'node_modules/openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['index.js', 'hitl-ingress.js']) fs.copyFileSync(path.join(DIST_OPENCLAW, f), path.join(dir, f));
    process.env.ORK_BIN = ORK;
    delete process.env.ORK_PROJETO; delete process.env.ORK_PROJETO_EXPLICITO;
    for (const nome of Object.keys(process.env)) if (nome.startsWith('ORK_HITL_')) delete process.env[nome];
    process.chdir(cwd);
    const importar = new Function('u', 'return import(u)') as (u: string) => Promise<{ default: { tools: (f: (d: Tool) => Tool) => Tool[] } }>;
    const plugin = (await importar(pathToFileURL(path.join(dir, 'index.js')).href)).default;
    await corpo(new Map(plugin.tools((d) => d).map((tool) => [tool.name, tool])));
  } finally {
    process.chdir(antes.cwd);
    for (const [k, v] of Object.entries(antes.env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('L3: pela extensao OpenClaw real, toda tool de projeto nomeia o projeto que leu', async (t) => {
  const m = maquina(t);
  // Estas nao chegam ao CLI num teste: despacham runtime, entregam, ou exigem o update do Telegram.
  const fora = new Set(['ork_phase_run', 'ork_ship', 'ork_gate_answer', 'ork_session_answer']);
  // O roadmap da rede tem a propria declaracao ("Consultado: orkastery"); a rede da pessoa nao tem projeto.
  const daRede = new Set(['ork_network_roadmap', 'ork_network_status']);
  const parametros: Record<string, Record<string, unknown>> = {
    ork_onboarding: { acao: 'show' }, ork_modo_do_pedido: { pedido: 'continuar #Auto' },
    ork_thread_new: { nome: 'nova pela tool', modo: 'auto' },
    ork_claims_add: { thread: m.thread, arquivo: 'README.md', alegacao: 'o README existe', comando: 'test -f README.md' },
    ork_brain_query: { thread: m.thread, kinds: 'prod' }, ork_brain_get: { thread: m.thread, id: 'prod-x' },
    ork_brain_context: { thread: m.thread, ids: 'prod-x' },
  };
  await gateway(m.workspace.dir, async (tools) => {
    const conferidas: string[] = [];
    for (const [nome, tool] of tools) {
      if (fora.has(nome) || daRede.has(nome)) continue;
      const params = { thread: m.thread, ...(parametros[nome] ?? {}), projeto: 'orkastery' };
      const aceitos = new Set(Object.keys(((tool as unknown as { parameters: { properties: object } }).parameters).properties));
      const r = await tool.execute(Object.fromEntries(Object.entries(params).filter(([k]) => aceitos.has(k))), {}, {});
      if (nome === 'ork_maestro') assert.equal(JSON.parse(r).project.name, 'orkastery', r);
      else {
        assert.match(r, LINHA, `${nome}: ${r.slice(-600)}`);
        assert.equal(vezes(r), 1, `${nome}: ${r.slice(-600)}`);
      }
      assert.doesNotMatch(r, /workspace \(wor\)/, `${nome} nao relata o workspace do gateway`);
      conferidas.push(nome);
    }
    assert.ok(conferidas.length >= 20, `tools conferidas: ${conferidas.join(', ')}`);
  });
});
