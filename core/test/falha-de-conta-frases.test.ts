/**
 * I-33 (GO-FIX 1 do CHECK aa279e17): frases reais de falha da conta. A6 (D15): o erro do Claude Code
 * `authentication_failed` com "OAuth session expired and could not be refreshed", achado nas
 * transcricoes locais, vira `runtime.auth-missing`, pelo parser e pelo observador. A11: a mencao
 * ampla a `codex login` nao vence a frase de cota no mesmo texto.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario, runtimePorConta } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { parseFalhaDeConta } from '../src/adapters/claude-bg';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { lerPerfis } from '../src/runtime-profiles';
import { falhaDeContaDaTranscricao } from '../src/session-watcher-claude';
import { dirThread, novaThread } from '../src/thread';

/** Linha de erro de API no formato real da transcricao do Claude Code. */
function linhaDeErro(error: string, texto: string): string {
  return JSON.stringify({ type: 'assistant', isApiErrorMessage: true, error, message: { content: [{ type: 'text', text: texto }] } });
}
function transcricao(conta: string, cwd: string, sessionId: string, linhas: string[]): void {
  const pasta = path.join(conta, 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${sessionId}.jsonl`), linhas.join('\n') + '\n');
}
const SESSAO = '12345678-aaaa-4bbb-8ccc-1234567890ab';
const OAUTH = 'Failed to authenticate: OAuth session expired and could not be refreshed';

test('A6: authentication_failed com OAuth session expired e auth ausente; erros que nao sao da conta nao sao', () => {
  assert.equal(parseFalhaDeConta(JSON.stringify(['authentication_failed', { content: [{ type: 'text', text: OAUTH }] }]))?.motivo, 'runtime.auth-missing');
  assert.equal(parseFalhaDeConta(OAUTH)?.motivo, 'runtime.auth-missing', 'a frase sozinha tambem');
  const raiz = dirTemporario('a6-transcricao');
  try {
    const conta = path.join(raiz, 'conta');
    const perfil = { id: 'a', runtime: 'claude-bg' as const, configDir: conta };
    transcricao(conta, raiz, SESSAO, [linhaDeErro('authentication_failed', OAUTH)]);
    const falha = falhaDeContaDaTranscricao(perfil, raiz, SESSAO);
    assert.equal(falha?.motivo, 'runtime.auth-missing');
    assert.equal(falha?.resetEm, null);
    for (const [error, texto] of [
      ['model_not_found', "There's an issue with the selected model (fable-5.1). It may not exist or you may not have access to it."],
      ['oauth_org_not_allowed', 'Your organization has disabled Claude subscription access for Claude Code'],
    ]) {
      transcricao(conta, raiz, SESSAO, [linhaDeErro(error, texto)]);
      assert.equal(falhaDeContaDaTranscricao(perfil, raiz, SESSAO), null, error);
    }
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('A6 observador: sessao que morre com OAuth expirado vira runtime.auth-missing e o perfil sai do rodizio', () => {
  const p = projetoTemporario('a6-observador');
  const claude = runtimePorConta('a6');
  try {
    const contaA = claude.conta(p.dir, 'a');
    const t = novaThread(p.carregado, { nome: 'a6', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    transcricao(contaA, p.dir, r.sessionId as string, [linhaDeErro('authentication_failed', OAUTH)]);
    claude.estadoDaSessao('failed');
    esperarCondicao(() => lerLedger(dir).some(e => e.tipo === 'phase_result'), 20000);
    const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result');
    assert.equal(resultado?.motivo, 'runtime.auth-missing');
    assert.equal(lerPerfis(p.dir).perfis.find(q => q.id === 'a')?.estado, 'sem-auth');
  } finally { p.limpar(); claude.restaurar(); }
});

test('A11: cota vence a mencao ampla a codex login; sem cota, a mencao ainda e auth ausente; auth forte vence a cota', () => {
  const misto = parseFalhaDeConta('Rode codex login status para conferir. Error: Your workspace is out of credits.');
  assert.equal(misto?.motivo, 'runtime.quota-exhausted');
  assert.match(misto?.trecho ?? '', /out of credits/);
  assert.equal(parseFalhaDeConta('Erro: rode codex login antes de continuar')?.motivo, 'runtime.auth-missing');
  assert.equal(parseFalhaDeConta('Not logged in. Your workspace is out of credits.')?.motivo, 'runtime.auth-missing',
    'frase forte de login ausente continua antes da cota');
  assert.equal(parseFalhaDeConta('usage_limit_exceeded (veja codex login status); try again in 2 hours')?.resetEm !== null, true);
});
