/**
 * I-33 (T8, D6 e D8): ordem de fallback por bloco no `ork.setup/v1` (campo opcional, leitura
 * normalizadora, setup.json antigo intacto) e o CLI `ork accounts list|add|remove|check`, que
 * delega o login ao proprio CLI do runtime e nunca mostra segredo, porque o store nao tem.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { alvosDeFallback } from '../src/retry';
import { lerPerfis } from '../src/runtime-profiles';
import { caminhoSetup, configDoBloco, ConfigDeBlocoComFallback, editarBloco, fallbackDoBloco, lerSetup, normalizarFallback, textoDoSetup } from '../src/setup';

const ORK = path.resolve(__dirname, '../../dist/index.js');

function ork(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): { saida: string; codigo: number } {
  try {
    return { saida: execFileSync(process.execPath, [ORK, ...args], { cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }), codigo: 0 };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string; stderr?: string };
    return { saida: (erro.stdout ?? '') + (erro.stderr ?? ''), codigo: erro.status ?? -1 };
  }
}

test('setup sem fallback continua identico e o fallback entra como campo opcional por bloco', () => {
  const p = projetoTemporario('setup-fallback');
  try {
    const antes = lerSetup(p.dir);
    assert.equal(Object.hasOwn(antes.modos.auto.blocos[0], 'fallback'), false);
    assert.deepEqual(fallbackDoBloco(antes, 'auto', 'GO'), []);
    const r = editarBloco(p.dir, 'auto', 1, { fallback: ['codex:gpt-5.5:high'] });
    assert.equal(r.ok, true, r.erro);
    const gravado = JSON.parse(fs.readFileSync(caminhoSetup(p.dir), 'utf8'));
    assert.equal(gravado.contrato, 'ork.setup/v1');
    assert.deepEqual(gravado.modos.auto.blocos[0].fallback, ['codex:gpt-5.5:high']);
    const setup = lerSetup(p.dir);
    assert.deepEqual(fallbackDoBloco(setup, 'auto', 'GO'), ['codex:gpt-5.5:high']);
    assert.deepEqual(alvosDeFallback(configDoBloco(setup, 'auto', 'GO'), 'claude-bg'), [{ runtime: 'codex', model: 'gpt-5.5', effort: 'high' }],
      'a rotacao do retry le a ordem do bloco');
    assert.match(textoDoSetup(p.dir, 'auto'), /codex:gpt-5\.5:high/);
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: [] }).ok, true);
    assert.equal(Object.hasOwn(lerSetup(p.dir).modos.auto.blocos[0], 'fallback'), false, 'lista vazia remove');
  } finally { p.limpar(); }
});

test('fallback invalido e recusado na edicao e descartado na leitura de setup.json editado a mao', () => {
  const p = projetoTemporario('setup-fallback-invalido');
  try {
    for (const [lista, erro] of [[['gemini:x'], /runtime desconhecido/], [['claude-bg:opus'], /repete o runtime/],
        [['codex'], /fallback invalido/], [['codex:gpt 5'], /fallback invalido/], [['codex:a', 'codex:b'], /repete/]] as const) {
      const r = editarBloco(p.dir, 'auto', 1, { fallback: [...lista] });
      assert.equal(r.ok, false);
      assert.match(r.erro ?? '', erro);
    }
    assert.equal(fs.existsSync(caminhoSetup(p.dir)), false, 'nada gravado');
    const setup = JSON.parse(JSON.stringify(lerSetup(p.dir)));
    setup.modos.auto.blocos[0].fallback = ['codex:gpt-5.5', 'lixo', 'claude-bg:opus', 'codex:outro', 3];
    fs.writeFileSync(caminhoSetup(p.dir), JSON.stringify(setup));
    assert.deepEqual((lerSetup(p.dir).modos.auto.blocos[0] as ConfigDeBlocoComFallback).fallback, ['codex:gpt-5.5']);
    assert.deepEqual(normalizarFallback('codex:x', 'claude-bg'), []);
    // Trocar o runtime do bloco para codex tira o codex da ordem herdada.
    assert.equal(editarBloco(p.dir, 'auto', 1, { runtime: 'codex', model: 'gpt-5.5' }).ok, true);
    assert.equal(Object.hasOwn(lerSetup(p.dir).modos.auto.blocos[0], 'fallback'), false);
  } finally { p.limpar(); }
});

test('CLI: setup --fallback grava a ordem e accounts add/check/remove delegam o login ao proprio CLI', () => {
  const p = projetoTemporario('accounts-cli');
  const bin = path.join(p.dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
if [ "$1" = "auth" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/.stub-logado" ]; then L=true; else L=false; fi
  printf '{"loggedIn":%s,"authMethod":"claude.ai","apiProvider":"firstParty","configDirectory":"%s"}\\n' "$L" "$CLAUDE_CONFIG_DIR"
  [ "$L" = true ] && exit 0 || exit 1
fi
exit 0
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` };
  try {
    const s = ork(p.dir, ['setup', 'auto', '--bloco', '1', '--fallback', 'codex:gpt-5.5'], env);
    assert.equal(s.codigo, 0, s.saida);
    assert.match(s.saida, /codex:gpt-5\.5/);
    assert.equal(ork(p.dir, ['setup', 'auto', '--bloco', '1', '--fallback', 'gemini:x'], env).codigo, 1);
    assert.match(ork(p.dir, ['accounts', 'list'], env).saida, /Nenhum perfil configurado/);

    const dir = path.join(p.dir, 'contas', 'a');
    const add = ork(p.dir, ['accounts', 'add', 'a', '--runtime', 'claude-bg', '--dir', dir], env);
    assert.equal(add.codigo, 0, add.saida);
    assert.ok(add.saida.includes(`Login pendente: rode CLAUDE_CONFIG_DIR='${dir}' claude auth login`), add.saida);
    assert.match(add.saida, /sem login/);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'sem-auth', 'sem login fica fora do rodizio');
    assert.equal(ork(p.dir, ['accounts', 'check'], env).codigo, 1);
    fs.writeFileSync(path.join(dir, '.stub-logado'), '');
    const check = ork(p.dir, ['accounts', 'check', 'a'], env);
    assert.equal(check.codigo, 0, check.saida);
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'ativo');
    const lista = ork(p.dir, ['accounts', 'list', '--json'], env);
    assert.deepEqual(Object.keys(JSON.parse(lista.saida).perfis[0]).sort(),
      ['configDir', 'criadoEm', 'esgotadoAte', 'estado', 'id', 'runtime', 'ultimaFalha', 'ultimoUso']);
    assert.equal(ork(p.dir, ['accounts', 'add', 'a', '--runtime', 'claude-bg', '--dir', dir], env).codigo, 1, 'id repetido');
    assert.equal(ork(p.dir, ['accounts', 'add', 'b', '--runtime', 'claude-bg'], env).codigo, 2);
    const remove = ork(p.dir, ['accounts', 'remove', 'a'], env);
    assert.equal(remove.codigo, 0, remove.saida);
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'desativado');
    assert.ok(fs.existsSync(path.join(dir, '.stub-logado')), 'remove nao apaga o diretorio nem o login');
    assert.equal(ork(p.dir, ['accounts', 'nada'], env).codigo, 2);
  } finally { p.limpar(); }
});

test('A13: a rotacao le a ordem de fallback pelo mesmo parser da leitura do setup', () => {
  const p = projetoTemporario('a13-parser');
  try {
    // Setup editado a mao: esforco fora da regra (maiusculo) e entrada valida depois.
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:gpt-5.5:high'] }).ok, true);
    const setup = JSON.parse(fs.readFileSync(caminhoSetup(p.dir), 'utf8'));
    setup.modos.auto.blocos[0].fallback = ['codex:gpt-5.5:HIGH', ' codex:gpt-5.5', 'codex:gpt-5.5:high:x'];
    fs.writeFileSync(caminhoSetup(p.dir), JSON.stringify(setup));
    const lido = lerSetup(p.dir);
    const bloco = lido.modos.auto.blocos[0] as ConfigDeBlocoComFallback;
    assert.equal(Object.hasOwn(bloco, 'fallback'), false, 'a leitura do setup descarta as tres entradas');
    assert.deepEqual(alvosDeFallback({ fallback: setup.modos.auto.blocos[0].fallback }, 'claude-bg'), [],
      'a rotacao descarta as mesmas entradas (antes aceitava o esforco HIGH)');
    const validas = ['codex:gpt-5.5:high'];
    assert.deepEqual(alvosDeFallback({ fallback: validas }, 'claude-bg'), [{ runtime: 'codex', model: 'gpt-5.5', effort: 'high' }]);
    assert.deepEqual(alvosDeFallback({ fallback: validas }, 'claude-bg').map(a => `${a.runtime}:${a.model}${a.effort ? `:${a.effort}` : ''}`),
      normalizarFallback(validas, 'claude-bg'));
    const fonte = fs.readFileSync(path.resolve(__dirname, '../../src/retry.ts'), 'utf8');
    assert.equal(fonte.includes("item.split(':')"), false, 'o retry nao tem parser proprio');
  } finally { p.limpar(); }
});
