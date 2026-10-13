/**
 * RM-061, fatia F3b (sugestao 2 da rodada 2 do CHECK): as tres tabelas que traduzem, so na impressao e pela frase exata,
 * o texto que outro modulo escreve em pt-BR (o erro do executor do sandbox, o detalhe da conferencia de login e o motivo
 * da confirmacao local) cobrem toda frase que a origem escreve. As frases do sandbox saem do proprio fonte, entao uma
 * frase nova la acusa aqui; as outras duas listam a frase e conferem que o trecho fixo dela segue no fonte. Os nomes
 * comecam por "locale en F3b frases:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { msg } from '../src/locale';

const FONTE = (arquivo: string) => fs.readFileSync(path.resolve(__dirname, '../../src', arquivo), 'utf8');

test('locale en F3b frases: todo erro do executor do sandbox sai traduzido no claims conferir', () => {
  const fonte = FONTE('verify-sandbox.ts');
  // `throw (new )?Error('...')`, inclusive com `+ valor` depois da aspa: o trecho fixo ganha um valor de exemplo.
  const frases = [...fonte.matchAll(/Error\('([^']+)'(\s*\+)?/g)].map(([, frase, mais]) => mais ? `${frase}x` : frase);
  frases.push('supervisor saiu 3');
  assert.ok(frases.length >= 15, `${frases.length} frases`);
  const en = msg('en').claims, pt = msg('pt-BR').claims;
  for (const frase of frases) {
    assert.equal(pt.erroDoSandbox(frase), frase, frase);
    assert.notEqual(en.erroDoSandbox(frase), frase, `sem traducao: ${frase}`);
  }
});

test('locale en F3b frases: todo detalhe da conferencia de login que o ork escreve sai traduzido no accounts', () => {
  // A frase de exemplo e o trecho fixo dela no fonte; o que e igual de proposito (saida do proprio CLI) fica de fora.
  const casos: Array<[string, string, string]> = [
    ['adapters/claude-bg.ts', 'claude auth status sem resposta (timeout, sinal ou binario ausente)', 'claude auth status sem resposta (timeout, sinal ou binario ausente)'],
    ['adapters/claude-bg.ts', 'claude auth status sem JSON legivel (codigo 0)', 'claude auth status sem JSON legivel (codigo '],
    ['adapters/claude-bg.ts', 'claude auth status sem JSON legivel', "'claude auth status sem JSON legivel'"],
    ['adapters/claude-bg.ts', 'claude auth status respondeu por outro diretorio de configuracao; perfil nao aplicado',
      'claude auth status respondeu por outro diretorio de configuracao; perfil nao aplicado'],
    ['adapters/claude-bg.ts', 'claude auth status: provider pago (authMethod console); so a assinatura claude.ai despacha',
      '; so a assinatura claude.ai despacha'],
    ['adapters/codex.ts', 'codex login status sem resposta (timeout, sinal ou binario ausente)', 'codex login status sem resposta (timeout, sinal ou binario ausente)'],
    ['adapters/codex.ts', 'codex login status saiu 1: x', 'codex login status saiu '],
    ['adapters/codex.ts', 'codex login status: login por API key (provider pago)', 'codex login status: login por API key (provider pago)'],
    ['adapters/codex.ts', 'codex login status: login sem assinatura ChatGPT comprovada (tratado como provider pago)',
      'codex login status: login sem assinatura ChatGPT comprovada (tratado como provider pago)'],
  ];
  const en = msg('en').accounts, pt = msg('pt-BR').accounts;
  for (const [arquivo, frase, trecho] of casos) {
    assert.ok(FONTE(arquivo).includes(trecho), `${arquivo} mudou a frase: ${trecho}`);
    assert.equal(pt.detalheDoLogin(frase), frase, frase);
    assert.notEqual(en.detalheDoLogin(frase), frase, `sem traducao: ${frase}`);
  }
  // As frases do conferirAuth que nao estao na lista sao as iguais de proposito (o login aprovado e o loggedIn false).
  const detalhes = [...FONTE('adapters/claude-bg.ts').matchAll(/detalhe: ['`](claude auth status[^'`$]*)/g)].map((m) => m[1]);
  assert.ok(detalhes.length >= 6, `${detalhes.length} detalhes`);
  for (const d of detalhes) assert.ok(casos.some(([, frase]) => frase.startsWith(d)) || /loggedIn/.test(d), `frase nova: ${d}`);
});

test('locale en F3b frases: todo motivo da confirmacao local sai traduzido na recusa da pasta das worktrees', () => {
  const casos: Array<[string, string, string]> = [
    ['postura-local.ts', 'sem confirmação local', "'sem confirmação local'"],
    ['postura-local.ts', '.orkastery/private precisa ser pasta 0700 do próprio usuário', '.orkastery/private precisa ser pasta 0700 do próprio usuário'],
    ['postura-local.ts', 'worktree-local.json precisa ser arquivo 0600 do próprio usuário', ' precisa ser arquivo 0600 do próprio usuário'],
    ['postura-local.ts', 'worktree-local.json está versionado no git e não vale como confirmação local', ' está versionado no git e não vale como confirmação local'],
    ['postura-local.ts', 'worktree-local.json com JSON inválido', ' com JSON inválido'],
    ['worktree-local.ts', 'worktree-local.json fora do contrato ork.worktree-local/v1', ' fora do contrato '],
    ['worktree-local.ts', 'a confirmação local é de outro checkout', 'a confirmação local é de outro checkout'],
  ];
  const en = msg('en').worktree;
  for (const [arquivo, motivo, trecho] of casos) {
    assert.ok(FONTE(arquivo).includes(trecho), `${arquivo} mudou a frase: ${trecho}`);
    const texto = en.dirForaDaRaiz('"x"', '/d', null, motivo, 'c');
    assert.ok(!texto.includes(`(${motivo})`), `sem traducao: ${motivo}`);
  }
});
