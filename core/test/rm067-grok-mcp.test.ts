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
import { parse } from 'smol-toml';
import { configuracaoServidorMcp, instalarMcp } from '../src/mcp-install';
import { projetoTemporario } from './apoio';

const grokDe = (raiz: string) => path.join(raiz, '.grok', 'config.toml');
const entradaDe = (texto: string) => (parse(texto) as { mcp_servers: Record<string, Record<string, unknown>> }).mcp_servers.orkastery;
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
