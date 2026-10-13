/**
 * RM-059 (fatia F9, T9.4): o Mensageiro de Sessões na sessão de fase, com o catálogo real deste repositório. O
 * adaptador instalado leva os arquivos do Mensageiro no `INSTALADO.json`; o despacho `claude-bg` passa o `--plugin-dir`
 * da ponte e, depois dele, o do Mensageiro; e o `--settings` que o despacho já monta ganha `crossSessionInbound:
 * accept` só com o Mensageiro entre os mods que vão à sessão e o `ORK_DISPATCH_ID` no env do despacho (D14 da thread
 * ork-rm059mensag). Sem rede e sem `claude` (a versão vai no pedido).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { exigirCatalogo } from '../src/catalogo';
import { instalarAdaptador, lerRecibo } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { novaThread } from '../src/thread';
import { contextoDoProjeto, validarContextoRuntime } from '../src/runtime-context';
import { entradaDoDespacho, MOD_DA_ENTREGA, montarComando } from '../src/adapters/claude-bg';
import { MOD_DA_ENTREGA as MOD_DO_NUCLEO } from '../src/entrega-por-mod';
import { ENV_IDENTIDADE_DE_DESPACHO } from '../src/runtime-ambiente';

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
const MENSAGEIRO = path.join(RAIZ, 'adapters', 'claude-code', 'mods', 'ork-mensageiro');
const DO_DESPACHO = { ORK_DISPATCH_ID: '00000000-0000-4000-8000-000000000000', ORK_DISPATCH_THREAD: 'ork-x', ORK_CANAL: 'cli' };

const pastasDePlugin = (args: string[]) => args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1]] : []));

/** O `--settings` do comando, lido como JSON; `null` sem ele. */
function settings(args: string[]): Record<string, unknown> | null {
  const i = args.indexOf('--settings');
  return i < 0 ? null : JSON.parse(args[i + 1]);
}

/** Os arquivos do Mensageiro no catálogo, relativos à pasta dele. */
function arquivosDoMensageiro(dir = MENSAGEIRO, prefixo = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    return e.isDirectory() ? arquivosDoMensageiro(path.join(dir, e.name), rel) : [rel];
  }).sort();
}

/** Projeto temporário com o adaptador instalado do catálogo real e uma thread com worktree. */
function preparar(nome: string) {
  const p = projetoTemporario(nome);
  try {
    const instalado = instalarAdaptador('claude-code', { projeto: p.dir, catalogo: RAIZ, orkBin: 'ork' });
    instalarMcp({ projeto: p.dir, host: 'claude-code', permissoesFilho: 'interactive' });
    const t = novaThread(p.carregado, { nome: 'mensageiro', modo: 'auto', criarWorktree: true }).thread;
    const contexto = contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id)!;
    // O contexto validado é o que o despacho usa: a instalação conferida e os mods de fase do recibo.
    const validado = validarContextoRuntime(contexto, t.worktree!);
    // `null` e o despacho sem env extra (o `undefined` daria o padrao).
    const comando = (versaoClaude: string | null, ambienteExtra: Record<string, string> | null = DO_DESPACHO) =>
      montarComando({ cwd: t.worktree!, nome: 'fase', prompt: 'pedido', contextoRuntime: contexto, versaoClaude, ambienteExtra: ambienteExtra ?? undefined });
    return { p, instalado, validado, comando };
  } catch (e) { p.limpar(); throw e; }
}

test('M1 o recibo do adaptador lista cada arquivo do Mensageiro, e ele entra nos mods de fase com a ponte como dependência', () => {
  const f = preparar('mensageiro-recibo');
  try {
    const recibo = new Set(lerRecibo(f.instalado.destino)!.arquivos.map((a) => a.arquivo));
    const doMensageiro = arquivosDoMensageiro();
    for (const essencial of ['hooks/register.tsx', 'hooks/caixa.ts', 'hooks/recepcao.ts', 'hooks/painel.tsx', 'orkastery-mod.json']) {
      assert.ok(doMensageiro.includes(essencial), essencial);
    }
    for (const rel of doMensageiro) assert.ok(recibo.has(`mods/ork-mensageiro/${rel}`), `mods/ork-mensageiro/${rel} no INSTALADO.json`);
    const mensageiro = f.validado.modsDeFase.find((m) => m.nome === MOD_DA_ENTREGA);
    assert.ok(mensageiro, 'o Mensageiro está nos mods de fase');
    assert.deepEqual(mensageiro!.dependencias, ['ork-ponte']);
    assert.equal(mensageiro!.claudeCodeMinimo, '2.1.287');
  } finally { f.p.limpar(); }
});

test('M2 o despacho da sessão de fase leva a ponte e, depois dela, o Mensageiro, e o --settings ganha crossSessionInbound accept', () => {
  const f = preparar('mensageiro-despacho');
  try {
    const args = f.comando('2.1.296 (Claude Code)');
    const pastas = pastasDePlugin(args);
    assert.equal(pastas[0], f.validado.instalacao);
    const ponte = pastas.indexOf(path.join(f.validado.instalacao, 'mods', 'ork-ponte'));
    const mensageiro = pastas.indexOf(path.join(f.validado.instalacao, 'mods', MOD_DA_ENTREGA));
    assert.ok(ponte > 0, 'a ponte vai ao despacho');
    assert.ok(mensageiro > ponte, 'o Mensageiro vai depois da ponte');
    assert.deepEqual(settings(args), { env: DO_DESPACHO, crossSessionInbound: 'accept' });
    assert.ok(args.indexOf('--settings') < args.indexOf('--plugin-dir'), 'o --settings segue antes dos plugins, como antes');
    // As ferramentas da entrega ficam fora do --allowedTools: só o mod as chama (D8).
    const permitidas = args[args.indexOf('--allowedTools') + 1].split(',');
    assert.ok(!permitidas.some((t) => t.includes('ork_session_inbox') || t.includes('ork_session_outbox')), permitidas.join(','));
  } finally { f.p.limpar(); }
});

test('M3 com um claude abaixo da API de mods ou ilegível, nem o Mensageiro nem o crossSessionInbound vão à sessão', () => {
  const f = preparar('mensageiro-velho');
  try {
    for (const versao of ['2.1.286 (Claude Code)', null]) {
      const args = f.comando(versao);
      assert.deepEqual(pastasDePlugin(args), [f.validado.instalacao], String(versao));
      assert.deepEqual(settings(args), { env: DO_DESPACHO }, String(versao));
    }
  } finally { f.p.limpar(); }
});

test('M4 fora da sessão despachada o campo não entra: sem env do despacho, sem ORK_DISPATCH_ID ou com ele vazio', () => {
  const f = preparar('mensageiro-sem-despacho');
  try {
    assert.equal(settings(f.comando('2.1.296 (Claude Code)', null)), null);
    assert.deepEqual(settings(f.comando('2.1.296 (Claude Code)', { ORK_CANAL: 'cli' })), { env: { ORK_CANAL: 'cli' } });
    assert.deepEqual(settings(f.comando('2.1.296 (Claude Code)', { ...DO_DESPACHO, ORK_DISPATCH_ID: '  ' })),
      { env: { ...DO_DESPACHO, ORK_DISPATCH_ID: '  ' } });
  } finally { f.p.limpar(); }
});

test('M5 a regra pura: só com o Mensageiro entre os mods e o ORK_DISPATCH_ID no env do despacho', () => {
  const ponte = { nome: 'ork-ponte', dir: '/x/ork-ponte', claudeCodeMinimo: '2.1.287', dependencias: [] };
  const mensageiro = { nome: MOD_DA_ENTREGA, dir: '/x/ork-mensageiro', claudeCodeMinimo: '2.1.287', dependencias: ['ork-ponte'] };
  const outro = { nome: 'ork-portao', dir: '/x/ork-portao', claudeCodeMinimo: '2.1.287', dependencias: ['ork-ponte'] };
  assert.deepEqual(entradaDoDespacho([ponte, mensageiro], DO_DESPACHO), { crossSessionInbound: 'accept' });
  assert.equal(entradaDoDespacho([ponte, outro], DO_DESPACHO), null);
  assert.equal(entradaDoDespacho([], DO_DESPACHO), null);
  assert.equal(entradaDoDespacho([ponte, mensageiro], undefined), null);
  assert.equal(entradaDoDespacho([ponte, mensageiro], { ORK_DISPATCH_THREAD: 'ork-x' }), null);
  assert.equal(entradaDoDespacho([ponte, mensageiro], { ORK_DISPATCH_ID: '' }), null);
  assert.equal(ENV_IDENTIDADE_DE_DESPACHO, 'ORK_DISPATCH_ID');
});

test('M6 o nome do mod da entrega é o mesmo no adaptador, no núcleo e no manifesto do Mensageiro', () => {
  assert.equal(MOD_DA_ENTREGA, MOD_DO_NUCLEO);
  const manifesto = JSON.parse(fs.readFileSync(path.join(MENSAGEIRO, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifesto.name, MOD_DA_ENTREGA);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(MENSAGEIRO, 'orkastery-mod.json'), 'utf8')).papeis, ['dono', 'fase']);
});
