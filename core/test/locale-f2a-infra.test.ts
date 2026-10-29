/**
 * RM-061, fatia F2a: a ativacao do locale por comando e subcomando (D6) e o escopo pt-BR do dado
 * gravado (`comLocale`). Os nomes comecam por "locale F2a infra:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ativarLocale, chaveDoLocale, cobreLocale, comLocale, COMANDOS_COM_LOCALE, localeAtivo, msg } from '../src/locale';
import { linhasEmPortugues } from './locale-apoio';

test('locale F2a infra: a chave de cada linha de comando, com o subcomando padrao', () => {
  assert.equal(chaveDoLocale(['doctor'], {}), 'doctor');
  assert.equal(chaveDoLocale(['onboarding'], {}), 'onboarding show');
  assert.equal(chaveDoLocale(['onboarding', 'set', 'maestro'], {}), 'onboarding set');
  assert.equal(chaveDoLocale(['onboarding'], { reset: 'maestro' }), 'onboarding reset');
  assert.equal(chaveDoLocale(['experiencia'], {}), 'experiencia show');
  assert.equal(chaveDoLocale(['thread'], {}), 'thread list');
  assert.equal(chaveDoLocale(['thread', 'status', 'x'], {}), 'thread status');
  assert.equal(chaveDoLocale(['phase', 'run', 'x', 'GO'], {}), 'phase run');
  // Subcomando desconhecido (ou ausente onde nao ha padrao) e `?`: o erro de uso e do proprio comando.
  assert.equal(chaveDoLocale(['phase'], {}), 'phase ?');
  assert.equal(chaveDoLocale(['thread', 'qualquer'], {}), 'thread ?');
  assert.equal(chaveDoLocale(['onboarding', 'qualquer'], {}), 'onboarding ?');
  assert.equal(chaveDoLocale(['experiencia', 'qualquer'], {}), 'experiencia ?');
  assert.equal(chaveDoLocale(['constructor'], {}), 'constructor');
  assert.equal(chaveDoLocale([], {}), '');
});

test('locale F2a infra: cobreLocale so com a entrada na lista e nunca com --json', () => {
  // A chave e a linha de comando partida em palavras, salvo a rota que vem de opcao (F2b: o aceite por omissao).
  const linhaDaChave: Record<string, [string[], Record<string, unknown>]> = { 'master aceitar-omissao': [['master'], { 'aceitar-omissao': true }] };
  for (const chave of COMANDOS_COM_LOCALE) {
    const [posicionais, opcoes] = linhaDaChave[chave] ?? [chave.split(' '), {}];
    assert.ok(cobreLocale(posicionais, opcoes), chave);
    // Nenhuma rota localiza o --json (F3c: `network roadmap`, `decisao registrar` e `prompt` tambem nao).
    assert.equal(cobreLocale(posicionais, { ...opcoes, json: true }), false, `${chave} --json`);
  }
  assert.equal(cobreLocale(['doctor'], { json: true }), false);
  assert.ok(cobreLocale(['doctor'], { modo: 'fast' }));
  assert.equal(cobreLocale(['init'], { json: true }), false);
  assert.ok(cobreLocale(['thread', 'new', 'x'], { 'from-finding': 'A1' }));
  assert.ok(cobreLocale(['thread', 'new', 'x'], { 'do-achado': 'A1' }));
  // A F3e levou estas rotas ao catalogo. Noctum e o comando privado seguem fora desta entrega.
  for (const fora of [['noctum'], ['noctum', 'status'], ['privado', 'varrer']]) {
    assert.equal(cobreLocale(fora, {}), false, fora.join(' '));
  }
  // F3d e F3e: estas rotas eram sondas do que seguia em pt-BR e entraram na lista de proposito.
  for (const dentro of [['retry', 'list'], ['retry', 'policy'], ['pulse', 'cadencia'], ['master', 'classes'], ['master', 'x'],
    ['projetos'], ['modos'], ['onboarding', 'sync'], ['experiencia', 'uninstall', 'codex'], ['master', 'digest'],
    ['master', 'audit'], ['master', 'migrar'], ['master', 'ratificar'], ['master', 'propor', 'x'], ['brain'],
    ['brain', 'status'], ['activation', 'status'], ['mcp', 'serve']]) {
    assert.ok(cobreLocale(dentro, {}), dentro.join(' '));
  }
});

test('locale F2a infra: comLocale roda no locale pedido e volta ao anterior, mesmo com erro', () => {
  ativarLocale('en');
  try {
    assert.equal(comLocale('pt-BR', () => localeAtivo()), 'pt-BR');
    assert.equal(localeAtivo(), 'en');
    assert.throws(() => comLocale('pt-BR', () => { throw new Error(msg().cli.erro('x')); }), /^Error: erro: x$/);
    assert.equal(localeAtivo(), 'en');
    assert.equal(msg().cli.erro('x'), 'error: x');
  } finally { ativarLocale(undefined); }
  assert.equal(msg().cli.erro('x'), 'erro: x');
});

test('locale F2a infra: o detector de pt-BR dos testes ignora sha, uuid e identificador e acha a palavra solta', () => {
  // D14: "de" e "da" sao letras hexadecimais; coladas a digito nao sao palavra.
  for (const linha of [
    '  sha256         : 2bebefe8f34a2484fcf33d39f922b8ae70da4efb69c63f484cbc28a38edcedec',
    '  base           : 1de2da3f',
    'session 11111111-2222-3333-4444-5555de555555',
    'Request already in progress (sha256 0de9da1b2c3d) since 2000-01-01 00:00.',
    'see `ork thread status --sem-worktree` and "pausa-humana" in github.com/rede.log',
  ]) assert.deepEqual(linhasEmPortugues(linha), [], linha);
  // Controle: a palavra solta segue acusada, inclusive antes do ponto final da frase.
  for (const linha of ['Thread criada com sucesso', 'erro: nada foi gravado', 'falha (de rede)', 'passo 3 de 5', 'Thread criada.',
    'O pedido segue pendente. Next']) {
    assert.deepEqual(linhasEmPortugues(linha), [linha], linha);
  }
});
