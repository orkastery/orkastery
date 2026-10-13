/**
 * RM-059 (fatia F10, T10.4): agent teams no despacho do GO, só no piloto. O manifesto da raiz liga com
 * `runtime.agent_teams` (`ligado`, `teammates`, `custo_usd`), desligado por padrão; o contexto validado leva os tetos
 * só com o GO no bloco da fase atual; e o `montarComando` do `claude-bg` só os põe no `--settings` (com a variável do
 * Claude Code e `teammateMode` `in-process`) quando o Portão de Tarefas vai à sessão, porque é ele quem aplica os tetos.
 * Com o catálogo real deste repositório, sem rede e sem `claude` (a versão vai no pedido). RM-059 (T9.4): o Mensageiro
 * de Sessões também vai à sessão despachada, e o mesmo `--settings` leva `crossSessionInbound: accept` junto.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { exigirCatalogo } from '../src/catalogo';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { carregarManifesto, TETO_MAXIMO_DE_CUSTO_USD, TETO_MAXIMO_DE_TEAMMATES } from '../src/manifest';
import { novaThread } from '../src/thread';
import { contextoDoProjeto, validarContextoRuntime } from '../src/runtime-context';
import { agentTeamsDoDespacho, MOD_DOS_TETOS, montarComando } from '../src/adapters/claude-bg';

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
const { carregarModuloDoMod } = require(path.join(RAIZ, 'core/scripts/checar-mods.cjs'));
const DO_DESPACHO = { ORK_DISPATCH_ID: '00000000-0000-4000-8000-000000000000', ORK_DISPATCH_THREAD: 'ork-x', ORK_CANAL: 'cli' };

/** Acrescenta o bloco `agent_teams` ao `runtime:` do manifesto do projeto de teste. */
function comAgentTeams(dir: string, linhas: string[]): void {
  const arquivo = path.join(dir, 'orkastery.yaml');
  const texto = fs.readFileSync(arquivo, 'utf8');
  assert.match(texto, /^runtime:$/m);
  fs.writeFileSync(arquivo, texto.replace(/^runtime:$/m, ['runtime:', '  agent_teams:', ...linhas.map((l) => `    ${l}`)].join('\n')));
}

/** O `--settings` do comando, lido como JSON; `null` sem ele. */
function settings(args: string[]): Record<string, unknown> | null {
  const i = args.indexOf('--settings');
  return i < 0 ? null : JSON.parse(args[i + 1]);
}

/** Projeto com o adaptador instalado do catálogo real, a chave pedida no manifesto e uma thread com worktree. */
function preparar(nome: string, opcoes: { modo?: 'auto' | 'classic'; teams?: string[] } = {}) {
  const p = projetoTemporario(nome);
  try {
    if (opcoes.teams) comAgentTeams(p.dir, opcoes.teams);
    instalarAdaptador('claude-code', { projeto: p.dir, catalogo: RAIZ, orkBin: 'ork' });
    instalarMcp({ projeto: p.dir, host: 'claude-code', permissoesFilho: 'interactive' });
    const t = novaThread(p.carregado, { nome: 'teams', modo: opcoes.modo ?? 'auto', criarWorktree: true }).thread;
    const contexto = contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id)!;
    const validado = validarContextoRuntime(contexto, t.worktree!);
    const comando = (versaoClaude: string | null) => montarComando({
      cwd: t.worktree!, nome: 'fase', prompt: 'pedido', contextoRuntime: contexto, versaoClaude, ambienteExtra: DO_DESPACHO,
    });
    return { p, comando, validado };
  } catch (e) { p.limpar(); throw e; }
}

const LIGADO = ['ligado: true', 'teammates: 2', 'custo_usd: 10'];

test('A1 sem runtime.agent_teams o despacho do GO sai como hoje: o --settings só com o env do despacho e a entrada do Mensageiro', () => {
  const f = preparar('teams-sem-chave');
  try {
    const args = f.comando('2.1.296 (Claude Code)');
    assert.deepEqual(settings(args), { env: DO_DESPACHO, crossSessionInbound: 'accept' });
    assert.ok(args.includes(path.join(f.validado.instalacao, 'mods', MOD_DOS_TETOS)), 'o Portão vai à sessão de fase');
    assert.equal(f.validado.agentTeams, null);
  } finally { f.p.limpar(); }
});

test('A2 ligado, com tetos válidos, GO no bloco e o Portão na sessão: a variável, os tetos e o teammateMode in-process', () => {
  const f = preparar('teams-ligado', { teams: LIGADO });
  try {
    const args = f.comando('2.1.296 (Claude Code)');
    assert.deepEqual(settings(args), {
      env: { ...DO_DESPACHO, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', ORK_AGENT_TEAMS_TEAMMATES: '2', ORK_AGENT_TEAMS_CUSTO_USD: '10' },
      teammateMode: 'in-process',
      crossSessionInbound: 'accept',
    });
    assert.ok(args.indexOf('--settings') < args.indexOf('--plugin-dir'), 'o --settings segue antes dos plugins, como antes');
    assert.deepEqual(f.validado.agentTeams, { teammates: 2, custo_usd: 10 });
  } finally { f.p.limpar(); }
});

test('A3 sem o GO no bloco da fase atual (#Classic no GOAL), agent teams fica desligado', () => {
  const f = preparar('teams-sem-go', { modo: 'classic', teams: LIGADO });
  try {
    assert.deepEqual(settings(f.comando('2.1.296 (Claude Code)')), { env: DO_DESPACHO, crossSessionInbound: 'accept' });
    assert.equal(f.validado.agentTeams, null);
  } finally { f.p.limpar(); }
});

test('A4 com um claude abaixo da API de mods ou ilegível, o Portão fica fora e agent teams também (e o Mensageiro e a entrada dele)', () => {
  const f = preparar('teams-claude-velho', { teams: LIGADO });
  try {
    for (const versao of ['2.1.286 (Claude Code)', null]) assert.deepEqual(settings(f.comando(versao)), { env: DO_DESPACHO });
  } finally { f.p.limpar(); }
});

test('A5 o manifesto: desligado sem aviso; ligado com teto inválido, outro tipo ou chave desconhecida avisa e desliga', () => {
  const casos: Array<{ linhas: string[]; teams: unknown; aviso: RegExp | null }> = [
    { linhas: LIGADO, teams: { teammates: 2, custo_usd: 10 }, aviso: null },
    { linhas: ['ligado: false', 'teammates: 2', 'custo_usd: 10'], teams: undefined, aviso: null },
    { linhas: ['teammates: 2', 'custo_usd: 10'], teams: undefined, aviso: null },
    { linhas: ['ligado: true', 'teammates: 2'], teams: undefined, aviso: /ligado sem teto valido/ },
    { linhas: ['ligado: true', 'teammates: 9', 'custo_usd: 10'], teams: undefined, aviso: /ligado sem teto valido/ },
    { linhas: ['ligado: true', 'teammates: 2', 'custo_usd: 0'], teams: undefined, aviso: /ligado sem teto valido/ },
    { linhas: ['ligado: true', 'teammates: 2', 'custo_usd: 501'], teams: undefined, aviso: /ligado sem teto valido/ },
    { linhas: ['ligado: true', 'teammates: "2"', 'custo_usd: 10'], teams: undefined, aviso: /ligado sem teto valido/ },
    { linhas: ['ligado: sim', 'teammates: 2', 'custo_usd: 10'], teams: undefined, aviso: /ligado deve ser true ou false/ },
    { linhas: ['ligado: true', 'teammates: 2', 'custo_usd: 10', 'modo: tmux'], teams: { teammates: 2, custo_usd: 10 }, aviso: /agent_teams\.modo desconhecida/ },
  ];
  for (const c of casos) {
    const p = projetoTemporario('teams-manifesto');
    try {
      comAgentTeams(p.dir, c.linhas);
      const m = carregarManifesto(p.dir)!;
      assert.deepEqual(m.erros, [], c.linhas.join(', '));
      assert.deepEqual(m.manifesto.runtime.agent_teams, c.teams, c.linhas.join(', '));
      const avisos = m.avisos.filter((a) => a.includes('agent_teams'));
      if (c.aviso) assert.ok(avisos.some((a) => c.aviso!.test(a)), `${c.linhas.join(', ')}: ${avisos.join(' | ')}`);
      else assert.deepEqual(avisos, [], c.linhas.join(', '));
    } finally { p.limpar(); }
  }
});

test('A6 sem o Portão entre os mods, ou sem tetos, o despacho não liga agent teams (a regra pura)', () => {
  const portao = { nome: MOD_DOS_TETOS, dir: '/x/ork-portao', claudeCodeMinimo: '2.1.287', dependencias: ['ork-ponte'] };
  const ponte = { nome: 'ork-ponte', dir: '/x/ork-ponte', claudeCodeMinimo: '2.1.287', dependencias: [] };
  assert.equal(agentTeamsDoDespacho({ teammates: 2, custo_usd: 10 }, [ponte]), null);
  assert.equal(agentTeamsDoDespacho(null, [ponte, portao]), null);
  assert.equal(agentTeamsDoDespacho(undefined, [ponte, portao]), null);
  assert.deepEqual(agentTeamsDoDespacho({ teammates: 3, custo_usd: 2.5 }, [ponte, portao]), {
    env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', ORK_AGENT_TEAMS_TEAMMATES: '3', ORK_AGENT_TEAMS_CUSTO_USD: '2.5' },
    teammateMode: 'in-process',
  });
});

test('A7 os limites do manifesto e os nomes do env são os que o Portão aceita do ambiente', () => {
  const lease = carregarModuloDoMod(path.join(RAIZ, 'adapters/claude-code/mods/ork-portao/hooks/lease.ts'));
  assert.equal(lease.TETO_MAXIMO_DE_TEAMMATES, TETO_MAXIMO_DE_TEAMMATES);
  assert.equal(lease.TETO_MAXIMO_DE_CUSTO_USD, TETO_MAXIMO_DE_CUSTO_USD);
  const env = agentTeamsDoDespacho({ teammates: 8, custo_usd: 0.25 }, [{ nome: MOD_DOS_TETOS, dir: '/x', claudeCodeMinimo: '2.1.287', dependencias: [] }])!.env;
  assert.deepEqual(lease.tetosDoAmbiente(env[lease.ENV_TEAMMATES], env[lease.ENV_CUSTO]), { teammates: 8, custoUsd: 0.25 });
  const limite = agentTeamsDoDespacho({ teammates: TETO_MAXIMO_DE_TEAMMATES, custo_usd: TETO_MAXIMO_DE_CUSTO_USD },
    [{ nome: MOD_DOS_TETOS, dir: '/x', claudeCodeMinimo: '2.1.287', dependencias: [] }])!.env;
  assert.notEqual(lease.tetosDoAmbiente(limite[lease.ENV_TEAMMATES], limite[lease.ENV_CUSTO]), null);
});
