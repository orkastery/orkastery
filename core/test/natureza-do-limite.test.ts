/**
 * I-33 (D16, GO-FIX 2 do CHECK aa279e17, A3 decidido pelo dono em 19/09/2026, opcao a): o criterio
 * UNICO entre esgotamento da conta e rate limit comum. Esgotamento de cota, credito ou limite do
 * plano com prazo de horas ou dias tira o perfil do rodizio e pode trocar de perfil no mesmo
 * runtime; rate limit comum de curta janela (429 por minuto, Retry-After curto, overloaded) nunca
 * troca de perfil. Os textos sao os reais dos runtimes: linha 65 do rollout do incidente de 18/09,
 * erros de API das transcricoes locais do Claude Code e frases do proprio binario (Claude Code
 * 2.1.278 e codex instalados na maquina), mais os formatos de erro das APIs.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ligarRotacaoPorCota, projetoTemporario, runtimePorConta } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { JANELA_CURTA_MAX_MS, naturezaDoLimite, parseFalhaDeConta } from '../src/adapters/claude-bg';
import { falhaDeContaDoErroCodex } from '../src/adapters/codex-events';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { executarRetry } from '../src/retry';
import { lerPerfis } from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';

/** 09:00 no fuso da maquina: `resets 3pm` fica 6 h adiante em qualquer fuso. */
const AGORA = new Date(2026, 8, 19, 9, 0, 0, 0).getTime();
const epoch = (ms: number) => Math.floor(ms / 1000);
const FIXTURE = path.resolve(__dirname, '../../test/fixtures/rollout-incidente-2026-09-18-linha65.jsonl');

/** Linha de erro de API no formato real da transcricao do Claude Code. */
const erroDeApi = (error: string, texto: string) => JSON.stringify([error, { content: [{ type: 'text', text: texto }] }]);

test('D16 esgotamento: cota, credito e limite do plano com prazo longo ou sem prazo viram runtime.quota-exhausted', () => {
  const casos: Array<[string, string, string]> = [
    // [texto real, regra esperada, origem]
    ['Your workspace is out of credits. Add credits to continue.', 'esgotamento-explicito', 'codex (binario e incidente de 18/09)'],
    ['You hit your spend cap set in your workspace. Increase your spend cap to continue.', 'esgotamento-explicito', 'codex (binario)'],
    ['429 You exceeded your current quota, please check your plan and billing details. (insufficient_quota)', 'esgotamento-explicito', 'API OpenAI: 429 com insufficient_quota e esgotamento'],
    ['Your credit balance is too low to access the Anthropic API.', 'esgotamento-explicito', 'API Anthropic'],
    ["You're out of extra usage", 'esgotamento-explicito', 'Claude Code (binario)'],
    ['Fable 5 requires usage credits', 'esgotamento-explicito', 'Claude Code (binario)'],
    [erroDeApi('rate_limit', "You've reached your Fable limit. Run /usage-credits to continue or switch models with /model."),
      'limite-do-plano', 'Claude Code: erro rate_limit real das transcricoes locais'],
    ["You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus),", 'limite-do-plano', 'codex (binario)'],
    ["You've hit your limit · resets 3pm", 'limite-do-plano', 'Claude Code (`You have hit your ${e}${n}`), prazo de 6 h'],
    [`Claude AI usage limit reached|${epoch(AGORA + 3 * 3600_000)}`, 'limite-do-plano', 'Claude Code: formato com epoch, prazo de 3 h'],
  ];
  for (const [texto, regra, origem] of casos) {
    const n = naturezaDoLimite(texto, AGORA);
    assert.equal(n?.natureza, 'esgotamento', origem);
    assert.equal(n?.regra, regra, origem);
    assert.equal(parseFalhaDeConta(texto, AGORA)?.motivo, 'runtime.quota-exhausted', origem);
  }
  assert.equal(naturezaDoLimite("You've hit your limit · resets 3pm", AGORA)?.fonte, 'relogio');
  const incidente = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).payload.error;
  assert.equal(falhaDeContaDoErroCodex(incidente, AGORA)?.motivo, 'runtime.quota-exhausted', 'linha 65 do rollout do incidente');
  assert.equal(falhaDeContaDoErroCodex({ codexErrorInfo: 'usageLimitExceeded', message: "You've hit your usage limit." }, AGORA)?.motivo,
    'runtime.quota-exhausted', 'erro do app-server em camelCase');
});

test('D16 rate limit comum: 429 transitorio, requisicoes por minuto, Retry-After curto e overloaded nunca viram cota', () => {
  const casos: Array<[string, string, string]> = [
    ['API Error: Server is temporarily limiting requests (not your usage limit) · this may be a temporary capacity issue.', 'janela-curta',
      'Claude Code (binario): 429 transitorio, com "usage limit" no texto'],
    ['API Error: Request rejected (429) · this may be a temporary capacity issue.', 'janela-curta', 'Claude Code (binario)'],
    [erroDeApi('rate_limit', 'Opus is experiencing high load, please use /model to switch to Sonnet'), 'janela-curta',
      'Claude Code (binario): sobrecarga com codigo rate_limit'],
    ['Repeated 529 Overloaded errors', 'janela-curta', 'Claude Code (binario)'],
    ['429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your per-minute rate limit"}}',
      'janela-curta', 'API Anthropic: rate_limit_error'],
    ['exceeded retry limit, last status: 429 Too Many Requests', 'janela-curta', 'codex (binario)'],
    ['usage limit reached, try again in 1 minute', 'limite-do-plano', 'frase do plano com prazo abaixo da janela curta'],
    [`Claude AI usage limit reached|${epoch(AGORA + 5 * 60_000)}`, 'limite-do-plano', 'plano com prazo de 5 min'],
    ['HTTP 429; Retry-After: 30', 'generico', 'Retry-After curto'],
    ['rate limit exceeded, try again in 25 minutes', 'generico', 'rate limit sem frase do plano'],
  ];
  for (const [texto, regra, origem] of casos) {
    const n = naturezaDoLimite(texto, AGORA);
    assert.equal(n?.natureza, 'rate-limit', origem);
    assert.equal(n?.regra, regra, origem);
    assert.equal(parseFalhaDeConta(texto, AGORA), null, origem);
  }
  for (const erro of [
    { codex_error_info: 'rate_limit_exceeded', message: 'Rate limit reached for gpt-5 in organization org-x on tokens per min (TPM): ' +
      'Limit 30000, Used 29000, Requested 2000. Please try again in 2.5s.' },
    { codex_error_info: 'server_overloaded', message: 'Server overloaded; retry later.' },
  ]) {
    assert.equal(falhaDeContaDoErroCodex(erro, AGORA), null, erro.codex_error_info);
  }
  assert.equal(naturezaDoLimite('erro: arquivo nao encontrado', AGORA), null);
  assert.equal(naturezaDoLimite('API Error: 500 Internal server error', AGORA), null);
});

test('D16 fronteira da janela curta: o limite do plano so espera quando o prazo dito e menor que JANELA_CURTA_MAX_MS', () => {
  assert.equal(JANELA_CURTA_MAX_MS, 15 * 60 * 1000);
  const plano = (ms: number) => naturezaDoLimite(`Claude AI usage limit reached|${epoch(AGORA + ms)}`, AGORA)?.natureza;
  assert.equal(plano(JANELA_CURTA_MAX_MS - 60_000), 'rate-limit');
  assert.equal(plano(JANELA_CURTA_MAX_MS), 'esgotamento');
  assert.equal(plano(-3600_000), 'esgotamento', 'prazo no passado nao e prazo futuro: a janela do plano e de horas ou dias');
});

test('D16 no despacho: limite do plano troca de perfil no mesmo runtime; 429 transitorio vai a fila sem trocar', () => {
  const claude = runtimePorConta('d16-despacho');
  const plano = projetoTemporario('d16-plano');
  const curta = projetoTemporario('d16-curta');
  try {
    ligarRotacaoPorCota(plano);
    claude.conta(plano.dir, 'a', { falha: `Claude AI usage limit reached|${epoch(Date.now() + 3 * 3600_000)}` });
    claude.conta(plano.dir, 'b');
    const t = novaThread(plano.carregado, { nome: 'plano', modo: 'auto' }).thread;
    const r = rodarFase(plano.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.motivo, 'runtime.quota-exhausted');
    assert.equal(lerPerfis(plano.dir).perfis.find(p => p.id === 'a')?.estado, 'esgotado');
    const retry = executarRetry(plano.carregado, t.id);
    assert.equal(retry.executada, true, retry.detalhe);
    const rotacao = lerLedger(dirThread(plano.dir, t.id)).filter(e => e.tipo === 'runtime_profile_rotated').at(-1);
    assert.deepEqual(rotacao?.de, { runtime: 'claude-bg', perfil: 'a' });
    assert.deepEqual(rotacao?.para, { runtime: 'claude-bg', perfil: 'b' });

    ligarRotacaoPorCota(curta);
    claude.conta(curta.dir, 'a', { falha: 'API Error: Request rejected (429) · this may be a temporary capacity issue.' });
    claude.conta(curta.dir, 'b');
    const u = novaThread(curta.carregado, { nome: 'curta', modo: 'auto' }).thread;
    const s = rodarFase(curta.carregado, u.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(s.motivo, 'runtime.rate-limited');
    assert.ok(s.naFila, 'o rate limit comum espera a janela na fila duravel');
    assert.equal(lerPerfis(curta.dir).perfis.find(p => p.id === 'a')?.estado, 'ativo', 'rate limit comum nao marca o perfil');
    assert.equal(s.naFila.estado, 'aguardando');
    const espera = executarRetry(curta.carregado, u.id);
    assert.equal(espera.redespacho, null, 'o retry nao redespacha o rate limit comum');
    const eventos = lerLedger(dirThread(curta.dir, u.id));
    assert.equal(eventos.some(e => e.tipo === 'runtime_profile_rotated'), false, 'nenhuma troca de perfil no rate limit comum');
    assert.equal(eventos.filter(e => e.tipo === 'phase_dispatch').length, 0, 'nenhum redespacho antes da janela');
  } finally { plano.limpar(); curta.limpar(); claude.restaurar(); }
});

/** Transcricao do Claude Code na conta do perfil, com uma linha de erro de API. */
function erroNaTranscricao(conta: string, cwd: string, sessionId: string, error: string, texto: string): void {
  const pasta = path.join(conta, 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${sessionId}.jsonl`),
    JSON.stringify({ type: 'assistant', isApiErrorMessage: true, error, message: { content: [{ type: 'text', text: texto }] } }) + '\n');
}

for (const caso of [
  { nome: 'limite do plano real (rate_limit, Fable limit)', texto: "You've reached your Fable limit. Run /usage-credits to continue or switch models with /model.",
    motivo: 'runtime.quota-exhausted', estado: 'esgotado' },
  { nome: '429 transitorio (rate_limit, Request rejected)', texto: 'API Error: Request rejected (429) · this may be a temporary capacity issue.',
    motivo: 'runtime.unavailable', estado: 'ativo' },
] as const) {
  test(`D16 no caminho terminal claude-bg: ${caso.nome}`, () => {
    const p = projetoTemporario('d16-terminal');
    const claude = runtimePorConta('d16-terminal');
    try {
      const contaA = claude.conta(p.dir, 'a');
      claude.conta(p.dir, 'b');
      const t = novaThread(p.carregado, { nome: 'terminal', modo: 'auto' }).thread;
      const dir = dirThread(p.dir, t.id);
      const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'turno SIMULADO claude-bg' });
      assert.equal(r.verificada, true, r.erro);
      erroNaTranscricao(contaA, p.dir, r.sessionId as string, 'rate_limit', caso.texto);
      claude.estadoDaSessao('failed');
      esperarCondicao(() => lerLedger(dir).some(e => e.tipo === 'phase_result'), 20000);
      const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result')!;
      assert.equal(resultado.motivo, caso.motivo);
      assert.equal(lerPerfis(p.dir).perfis.find(q => q.id === 'a')?.estado, caso.estado);
      assert.equal(lerPerfis(p.dir).perfis.find(q => q.id === 'b')?.estado, 'ativo');
    } finally { p.limpar(); claude.restaurar(); }
  });
}
