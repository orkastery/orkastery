/**
 * I-33 (N5 do CHECK-REVERIFY 8924757a): os prazos nas formas reais dos runtimes viram `resetEm`.
 * Codex 0.153.4 (binario): "You've hit your usage limit. ... or try again at %b %-d<sufixo>, %Y %-I:%M %p."
 * e, no mesmo dia, so a hora. Claude Code 2.1.278 (formatador do reset): acima de 24 h
 * "resets Sep 22, 3pm (America/Sao_Paulo)" e, em outro ano, "resets Sep 22, 2027, 3:05pm"; duracoes
 * compostas ("2d 5h 30m"). API da OpenAI: "Please try again in 1m30s". Limite do plano com prazo longo
 * continua esgotamento; com prazo curto continua rate limit comum (regra 3 da D16).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { naturezaDoLimite, parseFalhaDeConta, parseRateLimit } from '../src/adapters/claude-bg';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { lerPerfis } from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';
import { projetoTemporario, runtimePorConta } from './apoio';

/** Agora fixo no relogio local: os runtimes escrevem a hora no fuso da maquina. */
const AGORA = new Date(2026, 8, 19, 12, 0, 0, 0).getTime();
const local = (a: number, m: number, d: number, h: number, min = 0) => new Date(a, m, d, h, min, 0, 0).toISOString();
const CODEX_CREDITOS = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at";
const CODEX_PLUS = "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at";

test('N5 codex: "try again at Sep 22nd, 2026 3:05 PM" (com e sem sufixo ordinal) vira resetEm e o limite do plano longo e esgotamento', () => {
  for (const data of ['Sep 22nd, 2026 3:05 PM', 'Sep 22, 2026 3:05 PM']) {
    const texto = `${CODEX_CREDITOS} ${data}.`;
    const n = naturezaDoLimite(texto, AGORA);
    assert.deepEqual([n?.natureza, n?.regra, n?.resetEm, n?.fonte], ['esgotamento', 'limite-do-plano', local(2026, 8, 22, 15, 5), 'relogio'], data);
    const f = parseFalhaDeConta(texto, AGORA);
    assert.deepEqual([f?.motivo, f?.resetEm], ['runtime.quota-exhausted', local(2026, 8, 22, 15, 5)], data);
  }
  assert.equal(naturezaDoLimite(`${CODEX_CREDITOS} Jan 3rd, 2027 9:00 AM.`, AGORA)?.resetEm, local(2027, 0, 3, 9, 0));
});

test('N5 codex no mesmo dia: so a hora; a 5 minutos e rate limit comum, a 6 horas e esgotamento com o prazo dito', () => {
  const curto = `${CODEX_PLUS} 12:05 PM.`;
  assert.deepEqual([naturezaDoLimite(curto, AGORA)?.natureza, naturezaDoLimite(curto, AGORA)?.resetEm], ['rate-limit', local(2026, 8, 19, 12, 5)]);
  assert.equal(parseFalhaDeConta(curto, AGORA), null, 'prazo curto nunca tira o perfil do rodizio');
  const longo = `${CODEX_PLUS} 6:30 PM.`;
  assert.deepEqual([parseFalhaDeConta(longo, AGORA)?.motivo, parseFalhaDeConta(longo, AGORA)?.resetEm],
    ['runtime.quota-exhausted', local(2026, 8, 19, 18, 30)]);
});

test('N5 duracoes reais: dias e partes compostas somam; a de minuto da API continua rate limit comum', () => {
  const dias = parseFalhaDeConta("You've hit your usage limit. Try again in 4 days 3 hours.", AGORA);
  assert.deepEqual([dias?.motivo, dias?.resetEm, dias?.fonte], ['runtime.quota-exhausted', new Date(AGORA + (4 * 24 + 3) * 3600e3).toISOString(), 'duracao']);
  const claude = parseFalhaDeConta("You've hit your limit · resets in 2d 5h 30m", AGORA);
  assert.equal(claude?.resetEm, new Date(AGORA + ((2 * 24 + 5) * 60 + 30) * 60e3).toISOString());
  const api = naturezaDoLimite('Rate limit reached for gpt-5 in organization org-x on tokens per min (TPM): Limit 30000, Used 29000, ' +
    'Requested 2000. Please try again in 1m30s.', AGORA);
  assert.deepEqual([api?.natureza, api?.resetEm], ['rate-limit', new Date(AGORA + 90e3).toISOString()]);
  assert.equal(parseRateLimit('Rate limit reached. Please try again in 20ms.', AGORA)?.resetEm, new Date(AGORA + 20).toISOString());
  assert.equal(parseRateLimit('429 Too Many Requests. Try again in 2 hours.', AGORA)?.resetEm, new Date(AGORA + 2 * 3600e3).toISOString(),
    'forma antiga segue igual');
});

test('N5 Claude Code: "resets Sep 22, 3pm (fuso)" e "resets Sep 22, 2027, 3:05pm" viram resetEm; virada de ano sem ano dito', () => {
  const semAno = parseFalhaDeConta("You've hit your limit · resets Sep 22, 3pm (America/Sao_Paulo)", AGORA);
  assert.deepEqual([semAno?.motivo, semAno?.resetEm], ['runtime.quota-exhausted', local(2026, 8, 22, 15, 0)]);
  const comAno = parseFalhaDeConta("You've hit your limit · resets Sep 22, 2027, 3:05pm (America/Sao_Paulo)", AGORA);
  assert.equal(comAno?.resetEm, local(2027, 8, 22, 15, 5));
  const reveillon = new Date(2026, 11, 31, 23, 0, 0, 0).getTime();
  assert.equal(parseFalhaDeConta("You've hit your limit · resets Jan 2, 3pm (America/Sao_Paulo)", reveillon)?.resetEm, local(2027, 0, 2, 15, 0));
  assert.equal(parseFalhaDeConta("You've hit your limit · resets 7pm (America/Sao_Paulo)", AGORA)?.resetEm, local(2026, 8, 19, 19, 0),
    'a forma so com a hora segue igual');
  assert.equal(parseRateLimit('Rate limit reached; try again at Sep 22nd, 2026 3:05 PM.', AGORA)?.resetEm, local(2026, 8, 22, 15, 5),
    'a fila do rate limit comum le a mesma data');
});

test('N5 despacho: a recusa com o prazo real do Claude Code marca o perfil ate o prazo dito, nao pela janela padrao', () => {
  const p = projetoTemporario('n5-prazo-real');
  const claude = runtimePorConta('n5');
  try {
    const alvo = new Date(Date.now() + 3 * 24 * 3600e3);
    alvo.setHours(15, 0, 0, 0);
    const mes = alvo.toLocaleString('en-US', { month: 'short' });
    claude.conta(p.dir, 'a', { falha: `You've hit your limit · resets ${mes} ${alvo.getDate()}, 3pm (America/Sao_Paulo)` });
    claude.conta(p.dir, 'b');
    const t = novaThread(p.carregado, { nome: 'n5', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(r.motivo, 'runtime.quota-exhausted');
    const a = lerPerfis(p.dir).perfis.find(q => q.id === 'a')!;
    assert.equal(a.estado, 'esgotado');
    assert.equal(a.esgotadoAte, alvo.toISOString(), 'o prazo dito pelo runtime, nao a janela padrao de 60 min');
    const gate = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'gate_blocked').at(-1)!;
    assert.equal((gate.falhaDeConta as { resetEm: string }).resetEm, alvo.toISOString());
  } finally { p.limpar(); claude.restaurar(); }
});
