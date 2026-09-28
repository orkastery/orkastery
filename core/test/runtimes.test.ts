/**
 * Registro de runtimes (decisao D1 da thread ork-homologarcod).
 *
 * A garantia central: o despacho resolve o adapter POR NOME num lugar so, o claude-bg
 * segue como padrao intacto (paridade sem downgrade) e runtime desconhecido reprova com
 * erro tipado em vez de cair num fallback silencioso.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ORDEM_DOS_RUNTIMES, resolverRuntime, RUNTIME_PADRAO, RUNTIMES, runtimeConhecido } from '../src/runtimes';

test('os dois runtimes homologados existem e o claude-bg e o padrao', () => {
  assert.equal(RUNTIME_PADRAO, 'claude-bg');
  assert.deepEqual([...ORDEM_DOS_RUNTIMES], ['claude-bg', 'codex']);
  for (const nome of ORDEM_DOS_RUNTIMES) {
    const rt = resolverRuntime(nome);
    assert.equal(rt.nome, nome);
    assert.ok(rt.fonteVerificacao.length > 0, 'todo runtime declara de onde vem a prova da sessao');
  }
});

test('runtime desconhecido reprova com erro tipado, sem fallback silencioso', () => {
  assert.equal(runtimeConhecido('claude-bg'), true);
  assert.equal(runtimeConhecido('codex'), true);
  assert.equal(runtimeConhecido('gemini'), false);
  assert.throws(() => resolverRuntime('gemini'), /runtime de despacho desconhecido: "gemini"/);
});

test('o comando do claude-bg continua byte a byte o que o B0 homologou', () => {
  const comando = RUNTIMES['claude-bg'].montarComando({
    prompt: 'Mapear o objetivo',
    nome: 'ork-x-full',
    cwd: '/tmp',
    model: 'opus',
    effort: 'high',
  });
  assert.deepEqual(comando, [
    'claude',
    '--bg',
    'Mapear o objetivo',
    '--name',
    'ork-x-full',
    '--model',
    'opus',
    '--effort',
    'high',
  ]);
});

test('o comando do codex sai pelo registro identico ao do adapter direto', () => {
  const comando = RUNTIMES.codex.montarComando({ prompt: 'x', nome: 'n', cwd: '/tmp' });
  assert.equal(comando[0], 'codex');
  assert.equal(comando[1], 'exec');
});
