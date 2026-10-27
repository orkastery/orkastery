/**
 * RM-067 (F2 da ork-grokbuild, D7): o parser do stream `streaming-json` do Grok Build. As fixtures de
 * `core/test/fixtures/grok/` foram escritas a partir do formato do guia `14-headless-mode` do repositório
 * `xai-org/grok-build`, lido em 25/10/2026 (o `grok` não está instalado nesta máquina): `<SESSAO>` é trocado pelo id da
 * sessão do caso. Chave de API de teste só nasce em tempo de execução e com baixa entropia, para nenhum varredor de
 * segredo achar uma credencial no repositório.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  falhaDoErroGrok, LIMITE_ERRO_GROK, LIMITE_LINHA_GROK, lerStreamGrok, ParserGrok, redigirErroGrok, redigirTextoGrok, tokensDoFim,
} from '../src/adapters/grok-events';
import { dirTemporario } from './apoio';

const RAIZ = path.resolve(__dirname, '../../..');
const SESSAO = '0193c4a2-7b1e-7c3d-9f00-1234567890ab';

function fixture(nome: string, id = SESSAO): string {
  return fs.readFileSync(path.join(RAIZ, 'core/test/fixtures/grok', nome), 'utf8').replaceAll('<SESSAO>', id);
}

const linha = (e: unknown): string => `${JSON.stringify(e)}\n`;

test('GE1: o fim normal do guia vira o end com stopReason, id, turnos e tokens, sem erro nem linha invalida', () => {
  const p = new ParserGrok(SESSAO);
  p.push(fixture('fim-normal.jsonl'));
  const e = p.estado;
  assert.equal(e.invalido, false);
  assert.equal(e.sessaoDivergente, false);
  assert.equal(e.erro, null);
  assert.equal(e.fim?.stopReason, 'end_turn');
  assert.equal(e.fim?.sessionId, SESSAO);
  assert.equal(e.fim?.requestId, 'xyz789');
  assert.equal(e.fim?.numTurnos, 7);
  assert.equal(e.fim?.custoUsd, null, 'custo ausente nao vira zero');
  assert.deepEqual(e.fim?.tokens, { disponivel: true, input: 1200, cachedInput: 800, output: 340, total: 1540,
    unidade: 'tokens', escopo: 'sessao', fonte: 'grok.end.usage' });
  assert.equal(e.eventos, 8);
  assert.equal(p.eventosValidos, 8);
});

test('GE2: tipos desconhecidos e de progresso sao ignorados sem invalidar e contam como eventos', () => {
  const p = new ParserGrok(SESSAO);
  p.push(linha({ type: 'max_turns_reached', maxTurns: 3 }) + linha({ type: 'auto_compact_start' }) +
    linha({ type: 'novidade_do_runtime', campo: 1 }) + linha({ type: 'text', data: 'Pronto?' }));
  assert.equal(p.estado.invalido, false);
  assert.equal(p.estado.fim, null);
  assert.equal(p.estado.erro, null);
  assert.equal(p.estado.eventos, 4);
});

test('GE3: a linha parcial espera o resto, e a linha que nao e evento ou passa do limite invalida', () => {
  const p = new ParserGrok(SESSAO);
  p.push('{"type":"text","data":"meio');
  assert.equal(p.estado.eventos, 0);
  assert.equal(p.estado.invalido, false);
  p.push(' do texto"}\n');
  assert.equal(p.estado.eventos, 1);
  assert.equal(p.estado.invalido, false);
  p.push('isto nao e json\n');
  assert.equal(p.estado.invalido, true);
  for (const bruto of ['{"data":"sem tipo"}', '[1,2]', '42', '{"type":""}', 'null']) {
    const r = new ParserGrok(SESSAO);
    r.push(`${bruto}\n`);
    assert.equal(r.estado.invalido, true, bruto);
  }
  const utf8 = new ParserGrok(SESSAO);
  utf8.push(Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));
  assert.equal(utf8.estado.invalido, true, 'utf-8 invalido');
  const longa = new ParserGrok(SESSAO);
  longa.push(Buffer.alloc(LIMITE_LINHA_GROK + 10, 0x61));
  assert.equal(longa.estado.invalido, true, 'linha acima do limite');
  longa.push(`\n${linha({ type: 'text', data: 'depois da linha longa' })}`);
  assert.equal(longa.estado.eventos, 1, 'o descarte termina na quebra de linha');
});

test('GE4: o error vira a mensagem redigida e limitada, e vale o ultimo', () => {
  const chave = ['xai', 'Z'.repeat(24)].join('-');
  const p = new ParserGrok(SESSAO);
  p.push(linha({ type: 'error', message: 'primeiro erro' }));
  p.push(linha({ type: 'error', message: `Unauthorized: invalid key ${chave}\u0007 token=segredo-${'q'.repeat(12)} ${'x'.repeat(400)}` }));
  const m = p.estado.erro!.mensagem;
  assert.ok(m.startsWith('Unauthorized: invalid key [redigido]'), m.slice(0, 60));
  assert.equal(m.includes(chave), false, 'a chave da xAI nao vai ao ledger');
  assert.equal(m.includes('segredo-'), false, 'o token nao vai ao ledger');
  assert.equal(/\p{Cc}/u.test(m), false, 'sem caractere de controle');
  assert.ok(Array.from(m).length <= LIMITE_ERRO_GROK);
  const semMensagem = new ParserGrok(SESSAO);
  semMensagem.push(linha({ type: 'error' }));
  assert.equal(semMensagem.estado.erro?.mensagem, 'erro do grok sem mensagem');
  assert.equal(redigirErroGrok(undefined), '');
  assert.equal(redigirErroGrok(`chave ${chave} no fim`), 'chave [redigido] no fim');
});

test('GE5: o end de outra sessao ou sem id marca a sessao divergente, e o stopReason fora do formato vira desconhecido', () => {
  const outra = new ParserGrok(SESSAO);
  outra.push(fixture('fim-normal.jsonl', 'outra-sessao-qualquer'));
  assert.equal(outra.estado.sessaoDivergente, true);
  assert.equal(outra.estado.fim?.sessionId, 'outra-sessao-qualquer');
  const semId = new ParserGrok(SESSAO);
  semId.push(linha({ type: 'end', stopReason: 'end_turn' }));
  assert.equal(semId.estado.sessaoDivergente, true);
  assert.equal(semId.estado.fim?.sessionId, null);
  const torto = new ParserGrok(SESSAO);
  torto.push(linha({ type: 'end', stopReason: 'End Turn!', sessionId: SESSAO }));
  assert.equal(torto.estado.fim?.stopReason, 'desconhecido');
  assert.equal(torto.estado.sessaoDivergente, false);
});

test('GE6: depois do end, outro end ou um error invalidam o stream; outro tipo e ignorado', () => {
  const doisFins = new ParserGrok(SESSAO);
  doisFins.push(fixture('fim-normal.jsonl'));
  doisFins.push(linha({ type: 'end', stopReason: 'end_turn', sessionId: SESSAO }));
  assert.equal(doisFins.estado.invalido, true);
  const erroTarde = new ParserGrok(SESSAO);
  erroTarde.push(fixture('fim-normal.jsonl'));
  erroTarde.push(linha({ type: 'error', message: 'tarde demais' }));
  assert.equal(erroTarde.estado.invalido, true);
  assert.equal(erroTarde.estado.erro, null);
  const usoTarde = new ParserGrok(SESSAO);
  usoTarde.push(fixture('fim-normal.jsonl'));
  usoTarde.push(linha({ type: 'usage', messageId: 'msg_9' }));
  assert.equal(usoTarde.estado.invalido, false);
  assert.equal(usoTarde.estado.fim?.stopReason, 'end_turn');
});

test('GE7: o uso fora do formato deixa os tokens indisponiveis, e o custo so vale numero finito nao negativo', () => {
  for (const uso of [{ input_tokens: -1, output_tokens: 2 }, { input_tokens: 1.5, output_tokens: 2 },
    { input_tokens: 10, output_tokens: 5, total_tokens: 12 }, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 'x' },
    null, [1], 'uso']) {
    assert.equal(tokensDoFim(uso).disponivel, false, JSON.stringify(uso));
  }
  assert.deepEqual(tokensDoFim({ input_tokens: 10, output_tokens: 5 }), { disponivel: true, input: 10, cachedInput: null,
    output: 5, total: 15, unidade: 'tokens', escopo: 'sessao', fonte: 'grok.end.usage' });
  const comCusto = new ParserGrok(SESSAO);
  comCusto.push(linha({ type: 'end', stopReason: 'end_turn', sessionId: SESSAO, total_cost_usd: 0.0123 }));
  assert.equal(comCusto.estado.fim?.custoUsd, 0.0123);
  const custoNegativo = new ParserGrok(SESSAO);
  custoNegativo.push(linha({ type: 'end', stopReason: 'end_turn', sessionId: SESSAO, total_cost_usd: -1 }));
  assert.equal(custoNegativo.estado.fim?.custoUsd, null);
});

test('GE8: a falha da conta sai da frase do proprio runtime no error, a cota nunca sai de texto, e o resto fica sem motivo de conta', () => {
  assert.equal(falhaDoErroGrok({ mensagem: 'Not logged in: run grok login' })?.motivo, 'runtime.auth-missing');
  assert.equal(falhaDoErroGrok({ mensagem: '401 Unauthorized' })?.motivo, 'runtime.auth-missing');
  // RM-067 (F3): o formato da cota esgotada do grok nao esta confirmado; a frase nao tipa a cota nem marca o perfil.
  assert.equal(falhaDoErroGrok({ mensagem: 'usage_limit_exceeded: weekly pool used' }), null);
  assert.equal(falhaDoErroGrok({ mensagem: 'network error: connection reset by peer' }), null);
  assert.equal(falhaDoErroGrok(null), null);
  const login = new ParserGrok(SESSAO);
  login.push(fixture('erro-login.jsonl'));
  assert.equal(falhaDoErroGrok(login.estado.erro)?.motivo, 'runtime.auth-missing');
  const rede = new ParserGrok(SESSAO);
  rede.push(fixture('erro-rede.jsonl'));
  assert.equal(rede.estado.erro?.mensagem, 'network error: connection reset by peer');
  assert.equal(falhaDoErroGrok(rede.estado.erro), null);
});

test('GE9: o estado serializado retoma a leitura, e o stream curto e lido sem seguir link', () => {
  const linhas = fixture('fim-normal.jsonl').split('\n');
  const p = new ParserGrok(SESSAO);
  p.push(`${linhas.slice(0, 4).join('\n')}\n`);
  const salvo = JSON.parse(JSON.stringify(p.estado));
  const q = new ParserGrok(SESSAO, salvo);
  q.push(linhas.slice(4).join('\n'));
  assert.equal(q.estado.fim?.stopReason, 'end_turn');
  assert.equal(q.estado.eventos, 8);
  assert.throws(() => new ParserGrok('outra-sessao', salvo), /outra sessão/);
  const dir = dirTemporario('grok-stream');
  try {
    const arquivo = path.join(dir, 'stream.grok.jsonl');
    fs.writeFileSync(arquivo, fixture('cancelado.jsonl').trimEnd());
    const lido = lerStreamGrok(arquivo, SESSAO);
    assert.equal(lido?.fim?.stopReason, 'cancelled', 'a ultima linha sem quebra tambem e lida');
    const link = path.join(dir, 'link.jsonl');
    fs.symlinkSync(arquivo, link);
    assert.equal(lerStreamGrok(link, SESSAO), null, 'link nao e seguido');
    assert.equal(lerStreamGrok(path.join(dir, 'ausente.jsonl'), SESSAO), null);
    fs.writeFileSync(arquivo, '{"type":"text","data":"cortado no mei');
    assert.equal(lerStreamGrok(arquivo, SESSAO)?.invalido, true, 'a ultima linha incompleta de processo encerrado e invalida');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('GE10: o texto do runtime e redigido sem corte, e a mensagem de erro corta so depois de redigir', () => {
  const chave = ['xai', 'W'.repeat(30)].join('-');
  const longo = `${'a'.repeat(400)} fim com a chave ${chave}`;
  const inteiro = redigirTextoGrok(longo);
  assert.ok(inteiro.endsWith('fim com a chave [redigido]'), inteiro.slice(-40));
  assert.equal(inteiro.includes('WWWWW'), false);
  assert.equal(Array.from(redigirErroGrok(longo)).length, LIMITE_ERRO_GROK);
  assert.equal(redigirTextoGrok(42), '');
});
