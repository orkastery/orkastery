/**
 * RM-067 (F4b, thread ork-rm067f4bhost): o host MCP do `grok`. A instalacao grava a entrada `orkastery` no
 * `.grok/config.toml` do projeto, como o codex; o servidor `--host grok` so serve a sessao filha vinculada a uma thread,
 * com as ferramentas do perfil filho; o despacho leva o `--allow` dessas ferramentas e grava a config da worktree, fora
 * do git. O `grok` e o falso de `grok-falso.ts`: a maquina nao tem o runtime instalado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'smol-toml';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { configuracaoServidorMcp, instalarMcp } from '../src/mcp-install';
import { criarServidorMcp } from '../src/mcp-server';
import { CONSULTAS_MCP, MUTACOES_WORKTREE } from '../src/adapters/claude-bg';
import { ferramentasDoGrok, ferramentasServidasAoGrok } from '../src/adapters/grok';
import { TOOLS_DO_GRAFO } from '../src/mcp-grafo';
import { dirThread, novaThread } from '../src/thread';
import { capacidadeDoRuntimeNoProjeto, contextoDoProjeto, novaIdentidadeDeDespacho, validarContextoDoGrok,
  validarContextoRuntime } from '../src/runtime-context';
import { lerLedger } from '../src/ledger';
import { projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../src/index.js');
const grokDe = (raiz: string) => path.join(raiz, '.grok', 'config.toml');
const entradaDe = (texto: string) => (parse(texto) as { mcp_servers: Record<string, Record<string, unknown>> }).mcp_servers.orkastery;
const semPrefixo = (nomes: readonly string[]) => nomes.map((n) => n.replace(/^mcp__orkastery__/, ''));
const CONSULTAS = ['ork_thread_status', 'ork_phase_list', 'ork_hitl_pending', 'ork_observe', 'ork_artifact_read', 'ork_claims_list'];
const MUTACOES = ['ork_artifact_write', 'ork_claim_add', 'ork_decision_record', 'ork_git_commit', 'ork_verify', 'ork_ship'];

/** Um cliente MCP em memoria ligado ao servidor, fechado no fim. */
async function comCliente<T>(server: Server, corpo: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'fixture-MCP-SIMULADA', version: '1' }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try { await server.connect(st); await client.connect(ct); return await corpo(client); }
  finally { await client.close(); await server.close(); }
}
const textoDe = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]).text) as Record<string, unknown>;

test('GM1: ork mcp install --host grok grava a entrada orkastery no .grok/config.toml com o perfil filho, preserva o resto e repete igual', () => {
  const p = projetoTemporario('gm1-install');
  try {
    const ensaio = instalarMcp({ projeto: p.dir, host: 'grok', dryRun: true });
    assert.equal(ensaio.arquivo, grokDe(fs.realpathSync(p.dir)));
    assert.equal(ensaio.estado, 'novo');
    assert.equal(fs.existsSync(path.dirname(ensaio.arquivo)), false, 'o ensaio nao cria a pasta .grok');
    fs.mkdirSync(path.dirname(ensaio.arquivo));
    const original = '# comentario preservado\n[permission]\nallow = ["Read"]\n[mcp_servers.outro]\ncommand = "outro"\n';
    fs.writeFileSync(ensaio.arquivo, original, { mode: 0o640 });
    const r = instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree' });
    assert.equal(r.estado, 'atualizado');
    const texto = fs.readFileSync(r.arquivo, 'utf8');
    assert.ok(texto.startsWith(original), 'o arquivo so ganha a tabela no fim');
    assert.equal(fs.statSync(r.arquivo).mode & 0o777, 0o640, 'o modo do arquivo fica');
    const entrada = entradaDe(texto);
    assert.deepEqual(entrada, configuracaoServidorMcp(fs.realpathSync(p.dir), 'grok', undefined, 'github-ssh', 'worktree'));
    assert.deepEqual(Object.keys(entrada).sort(), ['args', 'command'], 'sem env_vars, que e do codex');
    const args = entrada.args as string[];
    assert.deepEqual(args.slice(args.indexOf('--host'), args.indexOf('--host') + 2), ['--host', 'grok']);
    assert.deepEqual(args.slice(-2), ['--child-permissions', 'worktree'], 'o perfil filho vai na entrada');
    assert.equal(args.includes('--thread'), false, 'a entrada do projeto nao e de thread nenhuma');
    assert.equal(((parse(texto) as { mcp_servers: Record<string, unknown> }).mcp_servers.outro as { command: string }).command, 'outro');
    const bytes = fs.readFileSync(r.arquivo);
    assert.equal(instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree' }).estado, 'igual');
    assert.equal(instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree', dryRun: true }).estado, 'igual');
    assert.deepEqual(fs.readFileSync(r.arquivo), bytes, 'repetir nao muda um byte');
  } finally { p.limpar(); }
});

test('GM2: a instalacao do grok recusa entrada divergente, TOML ilegivel ou fechado, link e o opt-in do dono, sem mudar bytes', () => {
  const p = projetoTemporario('gm2-recusas');
  try {
    const arquivo = grokDe(fs.realpathSync(p.dir));
    fs.mkdirSync(path.dirname(arquivo));
    for (const [original, erro] of [
      ['[mcp_servers.orkastery]\ncommand = "diferente"\n', /mcp\.install\.conflict: entrada orkastery divergente/],
      ['{ invalido', /mcp\.install\.config\.invalid/],
      ['mcp_servers = { outro = { command = "x" } }\n', /mcp\.install\.conflict/],
      ['x'.repeat(262145), /mcp\.install\.config\.unsafe/],
    ] as const) {
      fs.writeFileSync(arquivo, original);
      assert.throws(() => instalarMcp({ projeto: p.dir, host: 'grok' }), erro);
      assert.equal(fs.readFileSync(arquivo, 'utf8'), original);
    }
    // Com a entrada do grok instalada, outro perfil filho e conflito, como nos outros hosts.
    fs.rmSync(arquivo);
    instalarMcp({ projeto: p.dir, host: 'grok' });
    const bytes = fs.readFileSync(arquivo);
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree' }), /mcp\.install\.conflict/);
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'grok', permissoesDono: 'orchestrate' }), /owner-permissions\.invalid: opt-in exclusivo Codex/);
    assert.deepEqual(fs.readFileSync(arquivo), bytes);
    fs.rmSync(arquivo);
    const alvo = path.join(p.dir, 'alvo');
    fs.writeFileSync(alvo, 'sentinela');
    fs.symlinkSync(alvo, arquivo);
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'grok' }), /mcp\.install\.config\.unsafe/);
    assert.equal(fs.readFileSync(alvo, 'utf8'), 'sentinela');
    fs.rmSync(arquivo);
    fs.rmdirSync(path.dirname(arquivo));
    const outro = path.join(p.dir, 'outro');
    fs.mkdirSync(outro);
    fs.symlinkSync(outro, path.dirname(arquivo));
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'grok' }), /mcp\.install\.directory\.unsafe/);
    assert.deepEqual(fs.readdirSync(outro), [], 'nada escrito pelo link');
  } finally { p.limpar(); }
});

test('GM3: pela CLI, mcp install --host grok grava a entrada, e o --owner-permissions segue so do Codex', () => {
  const p = projetoTemporario('gm3-cli');
  try {
    const ok = spawnSync(process.execPath, [CLI, 'mcp', 'install', '--project', p.dir, '--host', 'grok', '--child-permissions', 'worktree'],
      { encoding: 'utf8', timeout: 30000 });
    assert.equal(ok.status, 0, ok.stderr);
    const arquivo = grokDe(fs.realpathSync(p.dir));
    const bytes = fs.readFileSync(arquivo);
    assert.deepEqual((entradaDe(bytes.toString()).args as string[]).slice(-2), ['--child-permissions', 'worktree']);
    const dono = spawnSync(process.execPath, [CLI, 'mcp', 'install', '--project', p.dir, '--host', 'grok', '--owner-permissions', 'orchestrate'],
      { encoding: 'utf8', timeout: 30000 });
    assert.equal(dono.status, 1);
    assert.match(dono.stderr, /uso: ork mcp/);
    assert.deepEqual(fs.readFileSync(arquivo), bytes, 'a recusa nao escreve');
    // A entrada da raiz nao serve sessao nenhuma: sem --thread, o servidor do grok recusa sem iniciar.
    const serve = spawnSync(process.execPath, [CLI, 'mcp', 'serve', '--project', p.dir, '--host', 'grok'],
      { encoding: 'utf8', timeout: 30000, input: '' });
    assert.equal(serve.status, 1);
    assert.match(serve.stderr, /^mcp: mcp\.host\.child-only: --host grok serve so a sessao filha/m);
  } finally { p.limpar(); }
});

test('GM4: o servidor --host grok so existe com a thread, lista so as ferramentas do perfil filho e declara o canal grok', async () => {
  const p = projetoTemporario('gm4-servidor');
  try {
    assert.throws(() => criarServidorMcp({ projeto: p.dir, host: 'grok' }), /mcp\.host\.child-only/);
    const t = novaThread(p.carregado, { nome: 'gm4', modo: 'auto', criarWorktree: true }).thread;
    const interativo = await comCliente(criarServidorMcp({ projeto: p.dir, host: 'grok', threadId: t.id }),
      async (c) => (await c.listTools()).tools.map((x) => x.name).sort());
    assert.deepEqual(interativo, [...CONSULTAS, 'ork_artifact_write', 'ork_decision_record'].sort(),
      'interactive: as consultas e o que o PLAN grava; nada do dono, do brain, do maestro ou da caixa');
    await comCliente(criarServidorMcp({ projeto: p.dir, host: 'grok', threadId: t.id, permissoesFilho: 'worktree' }), async (c) => {
      const nomes = (await c.listTools()).tools.map((x) => x.name).sort();
      assert.deepEqual(nomes, [...CONSULTAS, 'ork_git_status', ...MUTACOES].sort(), 'worktree: mais o ork_git_status e as seis mutacoes');
      const r = await c.callTool({ name: 'ork_decision_record', arguments: { threadId: t.id,
        decidido: 'Fixture SIMULADA de decisao pelo servidor do grok', porque: 'Conferir o canal do host',
        comoMudar: 'Nao se aplica', custoAgora: 'Nenhum', custoDepois: 'Nenhum',
        criterio: { tipo: 'medicao', referencia: 'core/test/rm067-grok-mcp.test.ts (GM4)' },
        quemDecidiu: 'sessao de fixture SIMULADA', evidencia: 'teste' } });
      assert.equal(r.isError, undefined, JSON.stringify(r));
    });
    const evento = lerLedger(dirThread(p.dir, t.id)).find((e) => e.tipo === 'autonomous_decision');
    assert.equal(evento?.host, 'grok');
    assert.equal(evento?.canal, 'grok', 'a porta e o host do servidor, como no codex');
  } finally { p.limpar(); }
});

test('GM5: as listas do grok saem das constantes do claude-bg, sem o prefixo, nos tres casos e com o grafo', () => {
  assert.deepEqual(ferramentasDoGrok('interactive', false, false), semPrefixo(CONSULTAS_MCP));
  assert.deepEqual(ferramentasDoGrok('worktree', false, false), [...semPrefixo(CONSULTAS_MCP), 'ork_git_status', ...semPrefixo(MUTACOES_WORKTREE)]);
  for (const perfil of ['interactive', 'worktree'] as const)
    assert.deepEqual(ferramentasDoGrok(perfil, true, false), [...semPrefixo(CONSULTAS_MCP), 'ork_artifact_write', 'ork_decision_record']);
  assert.deepEqual(ferramentasDoGrok('interactive', false, true), [...semPrefixo(CONSULTAS_MCP), ...TOOLS_DO_GRAFO]);
  assert.deepEqual(semPrefixo(CONSULTAS_MCP), CONSULTAS, 'as consultas sao as seis de sempre');
  assert.deepEqual(semPrefixo(MUTACOES_WORKTREE), MUTACOES, 'as mutacoes sao as seis de sempre');
  assert.deepEqual(ferramentasServidasAoGrok('interactive', false).sort(), [...CONSULTAS, 'ork_artifact_write', 'ork_decision_record'].sort());
  assert.deepEqual(ferramentasServidasAoGrok('worktree', true).sort(), [...CONSULTAS, ...TOOLS_DO_GRAFO, 'ork_git_status', ...MUTACOES].sort());
});

test('GM6: o ork_phase_run do MCP aceita o runtime grok, como o --runtime do CLI, e sem model recusa', async () => {
  const p = projetoTemporario('gm6-phase-run');
  try {
    const t = novaThread(p.carregado, { nome: 'gm6', modo: 'auto', criarWorktree: true }).thread;
    await comCliente(criarServidorMcp({ projeto: p.dir, host: 'claude-code' }), async (c) => {
      const ferramenta = (await c.listTools()).tools.find((x) => x.name === 'ork_phase_run');
      const runtime = (ferramenta?.inputSchema.properties as Record<string, { enum?: string[] }>).runtime;
      assert.deepEqual(runtime.enum, ['claude-bg', 'codex', 'grok']);
      const r = await c.callTool({ name: 'ork_phase_run', arguments: { threadId: t.id, fase: 'GOAL',
        prompt: 'Fixture SIMULADA do ork_phase_run', runtime: 'grok', model: 'grok-modelo', dryRun: true } });
      assert.equal(r.isError, undefined, JSON.stringify(r));
      const dados = textoDe(r);
      assert.equal(dados.runtime, 'grok');
      assert.equal((dados.comando as string[])[0], 'grok');
      assert.equal(dados.bloqueado, false, String(dados.erro));
      const semModelo = await c.callTool({ name: 'ork_phase_run', arguments: { threadId: t.id, fase: 'GOAL',
        prompt: 'Fixture SIMULADA do ork_phase_run', runtime: 'grok', dryRun: true } });
      assert.equal(semModelo.isError, true);
      assert.match(JSON.stringify(semModelo), /setup\.model\.required/);
    });
  } finally { p.limpar(); }
});

test('GM7: num projeto preparado, o grok recebe o contexto do host grok, com o servidor vinculado a thread e ao despacho', () => {
  const p = projetoTemporario('gm7-contexto');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree' });
    const t = novaThread(p.carregado, { nome: 'gm7', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    assert.deepEqual(capacidadeDoRuntimeNoProjeto(p.dir, 'grok'), { runtime: 'grok', host: 'grok', preparado: true, capaz: true, motivo: null });
    assert.equal(capacidadeDoRuntimeNoProjeto(p.dir, 'claude-bg').capaz, false, 'o claude-bg segue exigindo o adaptador dele');
    const ctx = contextoDoProjeto(p.dir, 'grok', wt, t.id)!;
    assert.equal(ctx.host, 'grok');
    assert.equal(ctx.permissoesFilho, 'worktree');
    const identidade = novaIdentidadeDeDespacho(t.id, 'GO');
    const v = validarContextoDoGrok({ ...ctx, identidade }, wt);
    assert.equal(v.permissoesFilho, 'worktree');
    assert.equal(v.grafoMcp, false);
    const args = v.servidor.args;
    assert.equal(args[args.indexOf('--host') + 1], 'grok');
    assert.deepEqual(args.slice(-6), ['--child-permissions', 'worktree', '--thread', t.id, '--dispatch', identidade.dispatchId]);
    assert.throws(() => validarContextoRuntime({ ...ctx, identidade }, wt), /runtime\.context\.invalid: host desconhecido/,
      'o host grok nao passa pela validacao do adaptador instalado dos outros hosts');
    assert.throws(() => validarContextoDoGrok({ ...ctx, host: 'codex' }, wt), /host grok esperado/);
    // Um segundo host com outro perfil filho deixa o projeto em conflito, como entre o codex e o claude-code.
    instalarMcp({ projeto: p.dir, host: 'claude-code' });
    assert.throws(() => contextoDoProjeto(p.dir, 'grok', wt, t.id), /perfis de filho divergentes entre hosts/);
  } finally { p.limpar(); }
});
