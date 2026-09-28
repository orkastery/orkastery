/**
 * I-33 (T2, D1 e D11b): cota esgotada e auth ausente deixam de ser `runtime.unavailable`
 * generico. O reconhecimento e por frase da saida real do runtime; pelo criterio unico da D16, o
 * limite do plano com prazo longo (ou sem prazo) e esgotamento, o rate limit comum continua rate
 * limit (fila), e `cost.violation` continua sem retry.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { despachar as despacharClaude, parseFalhaDeConta, parseRateLimit } from '../src/adapters/claude-bg';
import { despachar as despacharCodex } from '../src/adapters/codex';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { podeReexecutar, POLITICA_DE_RETRY, tabelaDaPolitica } from '../src/retry';
import { dirTemporario, runtimeFalso } from './apoio';

const AGORA = Date.parse('2026-09-19T12:00:00Z');

test('frases de cota esgotada viram runtime.quota-exhausted, inclusive o incidente de 18/09', () => {
  for (const saida of [
    'Your workspace is out of credits',
    'error: {"type":"usage_limit_exceeded","message":"usage limit exceeded for workspace"}',
    'HTTP 429 insufficient_quota: You exceeded your current quota, please check your plan and billing details',
    'Credit balance is too low',
  ]) {
    const s = parseFalhaDeConta(saida, AGORA);
    assert.ok(s, saida);
    assert.equal(s.motivo, 'runtime.quota-exhausted', saida);
    assert.equal(s.resetEm, null, 'sem horario na saida, nenhum horario inventado');
    assert.equal(s.fonte, 'sem-horario');
  }
});

test('cota esgotada com horario usa os mesmos padroes do rate limit', () => {
  const s = parseFalhaDeConta('Your workspace is out of credits. Try again in 2 hours.', AGORA);
  assert.ok(s);
  assert.equal(s.fonte, 'duracao');
  assert.equal(s.resetEm, new Date(AGORA + 2 * 3600 * 1000).toISOString());
  const iso = parseFalhaDeConta('insufficient_quota; available again at 2026-09-20T00:00:00Z', AGORA);
  assert.equal(iso?.fonte, 'iso');
  assert.equal(iso?.resetEm, '2026-09-20T00:00:00.000Z');
});

test('frases de auth ausente viram runtime.auth-missing, antes de qualquer cota', () => {
  for (const saida of [
    'Not logged in · Please run /login',
    'Invalid API key · Please run /login',
    'Error: 401 Unauthorized',
    'Please run `codex login` to authenticate',
    'OAuth token has expired',
    'refresh_token was already used (refresh token reused)',
    'out of credits? no: authentication_error',
  ]) {
    const s = parseFalhaDeConta(saida, AGORA);
    assert.equal(s?.motivo, 'runtime.auth-missing', saida);
    assert.equal(s?.resetEm, null);
  }
});

test('rate limit comum continua rate limit, limite do plano e esgotamento (D16) e texto comum nao e falha de conta', () => {
  for (const saida of ['rate limit exceeded, try again in 25 minutes', 'Too Many Requests (429)',
    'usage limit reached, try again in 1 minute']) {
    assert.equal(parseFalhaDeConta(saida, AGORA), null, saida);
    assert.ok(parseRateLimit(saida, AGORA), saida);
  }
  for (const saida of ['Claude AI usage limit reached|1757012400', "You've hit your usage limit"]) {
    assert.equal(parseFalhaDeConta(saida, AGORA)?.motivo, 'runtime.quota-exhausted', saida);
  }
  assert.ok(parseRateLimit('Claude AI usage limit reached|1757012400', AGORA), 'o parser da fila ainda le o horario');
  assert.equal(parseFalhaDeConta('Background agent started: 1111', AGORA), null);
  assert.equal(parseFalhaDeConta('', AGORA), null);
});

test('politica minima: os dois motivos reexecutam com limite e cost.violation segue sem retry', () => {
  for (const motivo of ['runtime.quota-exhausted', 'runtime.auth-missing'] as const) {
    assert.equal(POLITICA_DE_RETRY[motivo].motivo, motivo);
    assert.equal(POLITICA_DE_RETRY[motivo].acao, 'reexecutar');
    assert.equal(podeReexecutar(motivo), true);
    assert.ok(DESCRICAO_DO_MOTIVO[motivo].length > 0);
    assert.match(tabelaDaPolitica(), new RegExp(motivo.replace('.', '\\.')));
  }
  assert.equal(POLITICA_DE_RETRY['cost.violation'].acao, 'sem-retry');
  assert.equal(podeReexecutar('cost.violation'), false);
});

test('despacho claude-bg real contra stub: out of credits volta tipado e nao vira rate limit', () => {
  const rt = runtimeFalso('classificacao');
  const cwd = dirTemporario('classificacao-cwd');
  try {
    rt.proximoDespachoMorreDeRateLimit('Error: Your workspace is out of credits');
    const r = despacharClaude({ prompt: 'x', nome: 'ork-teste-f3', cwd });
    assert.equal(r.ok, false);
    assert.equal(r.falhaDeConta?.motivo, 'runtime.quota-exhausted');
    assert.equal(r.rateLimit, null);
    assert.match(r.erro ?? '', /^runtime\.quota-exhausted: /);

    rt.proximoDespachoMorreDeRateLimit('Not logged in · Please run /login');
    const auth = despacharClaude({ prompt: 'x', nome: 'ork-teste-f3', cwd });
    assert.equal(auth.falhaDeConta?.motivo, 'runtime.auth-missing');

    // D16: com perfil, o limite do plano sem prazo futuro e esgotamento; o 429 transitorio continua rate limit.
    // N6 (P8): sem perfil nada muda, e o texto legado segue como rate limit para a fila do B3.
    rt.proximoDespachoMorreDeRateLimit('Claude AI usage limit reached|1757012400');
    const perfil = { id: 'a', runtime: 'claude-bg' as const, configDir: path.join(cwd, 'conta-a') };
    const plano = despacharClaude({ prompt: 'x', nome: 'ork-teste-f3', cwd, perfil });
    assert.equal(plano.falhaDeConta?.motivo, 'runtime.quota-exhausted');
    assert.equal(plano.falhaDeConta?.fonte, 'epoch');
    assert.equal(plano.rateLimit, null);
    rt.proximoDespachoMorreDeRateLimit('Claude AI usage limit reached|1757012400');
    const semPerfil = despacharClaude({ prompt: 'x', nome: 'ork-teste-f3', cwd });
    assert.equal(semPerfil.falhaDeConta, null);
    assert.equal(semPerfil.rateLimit?.fonte, 'epoch');

    rt.proximoDespachoMorreDeRateLimit('API Error: Request rejected (429) · this may be a temporary capacity issue.');
    const limite = despacharClaude({ prompt: 'x', nome: 'ork-teste-f3', cwd });
    assert.equal(limite.falhaDeConta, null);
    assert.equal(limite.rateLimit?.fonte, 'sem-horario');
  } finally {
    rt.restaurar();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('despacho codex recusado sem frase de conta continua sem falha de conta', () => {
  const cwd = dirTemporario('classificacao-codex');
  try {
    const r = despacharCodex({ prompt: 'x', nome: 'ork-teste-f3', cwd,
      vinculo: { thread: 't', fase: 'GO', promptSha256: '0'.repeat(64) }, logDir: path.join(cwd, 'sessoes') });
    assert.equal(r.ok, false);
    assert.equal(r.falhaDeConta, undefined);
    assert.match(r.erro ?? '', /runtime\.unavailable/);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
