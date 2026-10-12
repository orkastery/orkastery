/**
 * RM-059 (fatia F10): a distribuição do Portão de Tarefas para a sessão de fase (T0.7) com o catálogo real deste
 * repositório, em que `adapters/claude-code/mods/` tem a ponte, o Freio e o Portão. O adaptador instalado leva os
 * arquivos do Portão no `INSTALADO.json`, e o despacho `claude-bg` passa o `--plugin-dir` da ponte e, depois dele, o
 * do Portão, logo depois do plugin do Orkastery. Sem rede e sem `claude` (a versão vai no pedido).
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
import { montarComando } from '../src/adapters/claude-bg';

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
const PORTAO = path.join(RAIZ, 'adapters', 'claude-code', 'mods', 'ork-portao');

const pastasDePlugin = (args: string[]) => args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1]] : []));

/** Os arquivos do Portão no catálogo, relativos à pasta dele. */
function arquivosDoPortao(dir = PORTAO, prefixo = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    return e.isDirectory() ? arquivosDoPortao(path.join(dir, e.name), rel) : [rel];
  }).sort();
}

/** Projeto temporário com o adaptador instalado do catálogo real e uma thread com worktree. */
function preparar(nome: string) {
  const p = projetoTemporario(nome);
  try {
    const instalado = instalarAdaptador('claude-code', { projeto: p.dir, catalogo: RAIZ, orkBin: 'ork' });
    instalarMcp({ projeto: p.dir, host: 'claude-code', permissoesFilho: 'interactive' });
    const t = novaThread(p.carregado, { nome: 'portao', modo: 'auto', criarWorktree: true }).thread;
    const contexto = contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id)!;
    // O contexto validado é o que o despacho usa: a instalação conferida e os mods de fase do recibo.
    const validado = validarContextoRuntime(contexto, t.worktree!);
    const comando = (versaoClaude: string | null) =>
      montarComando({ cwd: t.worktree!, nome: 'fase', prompt: 'pedido', contextoRuntime: contexto, versaoClaude });
    return { p, instalado, validado, comando };
  } catch (e) { p.limpar(); throw e; }
}

test('P1 o recibo do adaptador lista cada arquivo do Portão, e o Portão entra nos mods de fase com a ponte como dependência', () => {
  const f = preparar('portao-recibo');
  try {
    const recibo = new Set(lerRecibo(f.instalado.destino)!.arquivos.map((a) => a.arquivo));
    const doPortao = arquivosDoPortao();
    for (const essencial of ['hooks/register.ts', 'hooks/plano.ts', 'hooks/verify.ts', 'hooks/lease.ts', 'orkastery-mod.json']) {
      assert.ok(doPortao.includes(essencial), essencial);
    }
    for (const rel of doPortao) assert.ok(recibo.has(`mods/ork-portao/${rel}`), `mods/ork-portao/${rel} no INSTALADO.json`);
    const portao = f.validado.modsDeFase.find((m) => m.nome === 'ork-portao');
    assert.ok(portao, 'o Portão está nos mods de fase');
    assert.deepEqual(portao!.dependencias, ['ork-ponte']);
    assert.equal(portao!.claudeCodeMinimo, '2.1.287');
  } finally { f.p.limpar(); }
});

test('P2 o despacho da sessão de fase leva o plugin do Orkastery, a ponte e, depois dela, o Portão', () => {
  const f = preparar('portao-despacho');
  try {
    const args = f.comando('2.1.296 (Claude Code)');
    const pastas = pastasDePlugin(args);
    assert.equal(pastas[0], f.validado.instalacao);
    const ponte = pastas.indexOf(path.join(f.validado.instalacao, 'mods', 'ork-ponte'));
    const portao = pastas.indexOf(path.join(f.validado.instalacao, 'mods', 'ork-portao'));
    assert.ok(ponte > 0, 'a ponte vai ao despacho');
    assert.ok(portao > ponte, 'o Portão vai depois da ponte');
    assert.equal(args[args.indexOf(pastas[pastas.length - 1]) + 1], '--strict-mcp-config');
  } finally { f.p.limpar(); }
});

test('P3 com um claude abaixo da API de mods o Portão fica de fora e o despacho segue só com o plugin', () => {
  const f = preparar('portao-velho');
  try {
    for (const versao of ['2.1.286 (Claude Code)', null]) assert.deepEqual(pastasDePlugin(f.comando(versao)), [f.validado.instalacao]);
  } finally { f.p.limpar(); }
});
