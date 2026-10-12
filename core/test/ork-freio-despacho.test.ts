/**
 * RM-059 (fatia F2): a distribuicao do Freio de Lote para a sessao de fase (T0.7) com o catalogo real deste
 * repositorio, em que `adapters/claude-code/mods/` tem a ponte e o Freio. O adaptador instalado leva os
 * arquivos do Freio no `INSTALADO.json`, e o despacho `claude-bg` passa o `--plugin-dir` da ponte e, depois
 * dele, o do Freio, logo depois do plugin do Orkastery. Sem rede e sem `claude` (a versao vai no pedido).
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
const FREIO = path.join(RAIZ, 'adapters', 'claude-code', 'mods', 'ork-freio');

const pastasDePlugin = (args: string[]) => args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1]] : []));

/** Os arquivos do Freio no catalogo, relativos a pasta dele. */
function arquivosDoFreio(dir = FREIO, prefixo = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    return e.isDirectory() ? arquivosDoFreio(path.join(dir, e.name), rel) : [rel];
  }).sort();
}

/** Projeto temporario com o adaptador instalado do catalogo real e uma thread com worktree. */
function preparar(nome: string) {
  const p = projetoTemporario(nome);
  try {
    const instalado = instalarAdaptador('claude-code', { projeto: p.dir, catalogo: RAIZ, orkBin: 'ork' });
    instalarMcp({ projeto: p.dir, host: 'claude-code', permissoesFilho: 'interactive' });
    const t = novaThread(p.carregado, { nome: 'freio', modo: 'auto', criarWorktree: true }).thread;
    const contexto = contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id)!;
    // O contexto validado e o que o despacho usa: a instalacao conferida e os mods de fase do recibo.
    const validado = validarContextoRuntime(contexto, t.worktree!);
    const comando = (versaoClaude: string | null) =>
      montarComando({ cwd: t.worktree!, nome: 'fase', prompt: 'pedido', contextoRuntime: contexto, versaoClaude });
    return { p, instalado, validado, comando };
  } catch (e) { p.limpar(); throw e; }
}

test('D1 o recibo do adaptador lista cada arquivo do Freio, e o Freio entra nos mods de fase com a ponte como dependencia', () => {
  const f = preparar('freio-recibo');
  try {
    const recibo = new Set(lerRecibo(f.instalado.destino)!.arquivos.map((a) => a.arquivo));
    const doFreio = arquivosDoFreio();
    assert.ok(doFreio.includes('hooks/register.ts') && doFreio.includes('orkastery-mod.json'));
    for (const rel of doFreio) assert.ok(recibo.has(`mods/ork-freio/${rel}`), `mods/ork-freio/${rel} no INSTALADO.json`);
    const freio = f.validado.modsDeFase.find((m) => m.nome === 'ork-freio');
    assert.ok(freio, 'o Freio esta nos mods de fase');
    assert.deepEqual(freio!.dependencias, ['ork-ponte']);
    assert.equal(freio!.claudeCodeMinimo, '2.1.287');
  } finally { f.p.limpar(); }
});

test('D2 o despacho da sessao de fase leva o plugin do Orkastery, a ponte e, depois dela, o Freio', () => {
  const f = preparar('freio-despacho');
  try {
    const args = f.comando('2.1.296 (Claude Code)');
    const pastas = pastasDePlugin(args);
    assert.equal(pastas[0], f.validado.instalacao);
    const ponte = pastas.indexOf(path.join(f.validado.instalacao, 'mods', 'ork-ponte'));
    const freio = pastas.indexOf(path.join(f.validado.instalacao, 'mods', 'ork-freio'));
    assert.ok(ponte > 0, 'a ponte vai ao despacho');
    assert.ok(freio > ponte, 'o Freio vai depois da ponte');
    assert.equal(args[args.indexOf(pastas[pastas.length - 1]) + 1], '--strict-mcp-config');
  } finally { f.p.limpar(); }
});

test('D3 com um claude abaixo da API de mods o Freio fica de fora e o despacho segue so com o plugin', () => {
  const f = preparar('freio-velho');
  try {
    for (const versao of ['2.1.286 (Claude Code)', null]) assert.deepEqual(pastasDePlugin(f.comando(versao)), [f.validado.instalacao]);
  } finally { f.p.limpar(); }
});
