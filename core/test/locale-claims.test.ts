/**
 * RM-061, fatia F3b: `ork claims add|conferir|verificar|retirar|ausente|list` em ingles. O texto, a tabela, os avisos e
 * as recusas saem pelo catalogo; o estado da claim e a regra do lint so se traduzem na impressao. A alegacao, o arquivo,
 * o comando e o motivo digitado sao dado. O `claims.jsonl` e o ledger ficam iguais nas duas linguas, e o `--json` do
 * `conferir` leva a recusa em pt-BR nas duas. Negativo: o lint do `ci prepare` segue em pt-BR. Os nomes comecam por
 * "locale en F3b claims:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cobreLocale, comLocale, ligarRemontagem, mensagemDoErro, msg } from '../src/locale';
import { conferirClaims, FabricaDeExecutor, textoDaConferencia } from '../src/claims-conferir';
import { dirThread, novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';
import { analisarComando, linhaDoLintDeClaim } from '../src/claim-lint';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

/** O `claims.jsonl` e o ledger da thread sem horario, id de evento e o id da thread. */
function estado(dir: string, id: string): string {
  const pasta = path.join(dir, '.orkastery', 'threads', id);
  return ['claims.jsonl', 'ledger.jsonl'].map((a) => fs.readFileSync(path.join(pasta, a), 'utf8'))
    .join('\n').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>').replace(/"eventId":"[^"]*"/g, '"eventId":"<ID>"')
    .split(id).join('<THREAD>');
}

test('locale en F3b claims: add, verificar, retirar, ausente e list saem em ingles, e o que se grava nao muda', () => {
  const c = cenario('claims-f3b');
  try {
    for (const nome of ['loc-en', 'loc-pt']) assert.equal(ork(c, PT, false, 'thread', 'new', nome, '--sem-worktree').status, 0);
    const roteiro = (locale: Record<string, string>, id: string) => {
      const r = (...args: string[]) => ork(c, locale, false, 'claims', ...args);
      return [
        r('add', id, 'README.md', '--claim', 'o readme existe', '--verificar', 'test -f README.md'),
        r('add', id, 'README.md', '--claim', 'nenhum teste quebrou'),
        r('add', id, 'README.md', '--claim', 'a suite passa', '--verificar', 'npm --prefix core test'),
        r('verificar', id, 'C2', '--comando', 'test -f README.md'),
        r('retirar', id, 'C3', '--motivo', 'suite inteira'),
        r('ausente', id, '--paths', 'a.ts,b.ts', '--motivo', 'so docs'),
        r('list', id),
      ];
    };
    const en = roteiro(EN, 'loc-locen'), pt = roteiro(PT, 'loc-locpt');
    assert.deepEqual(en.map((s) => s.status), [0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(pt.map((s) => s.status), en.map((s) => s.status));
    assert.equal(en[0].stdout, 'Claim C1 recorded in thread loc-locen.\n  file       README.md\n  statement  o readme existe\n' +
      '  negative   no\n  verify     test -f README.md\n  state      pending\n');
    assert.match(en[1].stdout, /\n {2}negative {3}yes \(needs a verification command\)\n {2}verify {5}\(no command declared\)\n {2}state {6}unverifiable\n\n/);
    assert.match(en[1].stdout, /\nWARNING: a negative statement without a verification command fails in `ork verify`\.\n/);
    assert.match(en[2].stdout, /\n\nWARNING: C3 runs the whole suite \(npm --prefix core test\); run only the claim test \(`node --test` on the test file, or the project command that runs one file\) or a hermetic project script\. `ci prepare` refuses this claim\.\n$/);
    assert.equal(en[3].stdout, 'Claim C2 now has a verification command.\n  verify     test -f README.md\n  state      pending\n\n' +
      'Prove it now: `ork verify loc-locen`\n');
    assert.equal(en[4].stdout, 'Claim C3 withdrawn from thread loc-locen.\n  statement  a suite passa\n  reason     suite inteira\n' +
      '  the history of the statement stays in claims.jsonl and in the ledger.\n');
    assert.equal(en[5].stdout, 'Missing proof recorded in thread loc-locen: a.ts, b.ts.\n  reason     so docs\n');
    const tabela = en[6].stdout.split('\n');
    assert.match(tabela[0], /^ {2}ID {2}PHASE {2}STATE {6}NEGATIVE {2}FILE {7}VERIFY {18}STATEMENT\s*$/);
    assert.match(en[6].stdout, /\n {2}C3 {2}GOAL {3}withdrawn {2}no {8}README\.md {2}npm --prefix core test {2}a suite passa\n/);
    // Fora do que e dado (alegacao, motivo digitado), nada em pt-BR.
    const dado = ['o readme existe', 'nenhum teste quebrou', 'a suite passa', 'suite inteira', 'so docs'];
    assert.deepEqual(linhasEmPortugues(en.map((s) => s.stdout + s.stderr).join('\n'), dado), []);
    // O claims.jsonl e o ledger que o ingles gravou sao os que o pt-BR gravou, inclusive a correcao do lint.
    assert.equal(estado(c.dir, 'loc-locen'), estado(c.dir, 'loc-locpt'));
    assert.match(fs.readFileSync(path.join(c.dir, '.orkastery', 'threads', 'loc-locen', 'claims.jsonl'), 'utf8'), /"correcao":"rode só o teste da claim/);
  } finally { c.limpar(); }
});

test('locale en F3b claims: usos, recusas e a conferencia sem alvo saem em ingles; o --json do conferir e igual nas duas linguas', () => {
  const c = cenario('claims-f3b-recusas');
  try {
    assert.equal(ork(c, PT, false, 'thread', 'new', 'loc-r', '--sem-worktree').status, 0);
    const erro = (...args: string[]) => ork(c, EN, false, 'claims', ...args).stderr;
    assert.equal(erro('add', 'loc-locr'), 'usage: ork claims add <thread-id> <file> --claim "<statement>" [--verificar "<command>"]\n');
    assert.equal(erro('verificar', 'loc-locr'), 'usage: ork claims verificar <thread-id> <claim-id> --comando "<command>"\n');
    assert.equal(erro('retirar', 'loc-locr'), 'usage: ork claims retirar <thread-id> <claim-id> --motivo "<reason>"\n');
    assert.equal(erro('ausente', 'loc-locr'), 'usage: ork claims ausente <thread-id> --paths A,B --motivo "<reason>" [--commit SHA]\n');
    assert.equal(erro('list'), 'usage: ork claims list <thread-id>\n');
    assert.equal(erro(), 'usage: ork claims list <thread-id>\n');
    assert.equal(erro('conferir', 'loc-locr'), 'usage: ork claims conferir <thread-id> --claims C1,C2 | --tarefa T1 [--prazo S] [--json]\n');
    assert.equal(erro('voar'), 'unknown subcommand: claims voar\n');
    assert.equal(erro('verificar', 'loc-locr', 'C9', '--comando', 'true'), 'error: claim "C9" does not exist in thread loc-locr\n');
    assert.equal(ork(c, EN, false, 'claims', 'list', 'loc-locr').stdout,
      'No claim in thread loc-locr.\nRecord one with: ork claims add loc-locr <file> --claim "<statement>" --verificar "<command>"\n');
    // A recusa da conferencia: no texto, em ingles; no --json, como nasceu (pt-BR), nas duas linguas.
    const texto = ork(c, EN, false, 'claims', 'conferir', 'loc-locr', '--claims', 'X1');
    assert.equal(texto.status, 2);
    assert.equal(texto.stderr, 'claims.conferir.uso: invalid claim id: X1\n');
    const jsonEn = ork(c, EN, false, 'claims', 'conferir', 'loc-locr', '--claims', 'X1', '--json');
    const jsonPt = ork(c, PT, false, 'claims', 'conferir', 'loc-locr', '--claims', 'X1', '--json');
    assert.equal(jsonEn.stdout, jsonPt.stdout);
    assert.equal(JSON.parse(jsonEn.stdout).erro, 'claims.conferir.uso: id de claim invalido: X1');
    // owner.language en-US vence o LANG pt-BR.
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.equal(ork(c, PT, false, 'claims', 'conferir', 'loc-locr', '--claims', 'C1,C1').stderr, 'claims.conferir.repetida: C1 requested twice\n');
  } finally { c.limpar(); }
});

test('locale en F3b claims (negativo): o lint grava a correcao em pt-BR e o ci prepare segue em pt-BR', () => {
  const [achado] = analisarComando('npm --prefix core test');
  assert.equal(achado.correcao, msg('pt-BR').claims.correcoesDoLint['suite-inteira']);
  assert.match(linhaDoLintDeClaim('C1', achado), /^C1 roda a suite inteira \(npm --prefix core test\); rode só o teste da claim /);
  assert.equal(cobreLocale(['ci', 'prepare', 'x'], {}), false);
  assert.equal(cobreLocale(['claims', 'conferir', 'x'], { json: true }), false);
  for (const sub of ['add', 'conferir', 'verificar', 'retirar', 'ausente', 'list']) assert.ok(cobreLocale(['claims', sub, 'x'], {}), sub);
  assert.ok(cobreLocale(['claims'], {}));
});

test('locale en F3b claims: o conferir --tarefa mostra a alegacao sintetica e o sandbox indisponivel em ingles, e o --json em pt-BR (GO-FIX 1)', () => {
  const p = projetoTemporario('locale-conferir-tarefa');
  ligarRemontagem(true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'conferir', modo: 'auto', criarWorktree: true });
    fs.mkdirSync(path.join(dirThread(p.dir, thread.id), 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dirThread(p.dir, thread.id), 'docs', 'plan.md'), '# PLAN\n\n### T1: algo\n\n- **verify:** `true`\n');
    const fabrica: FabricaDeExecutor = () => ({ executar: (nome, comando) => ({ nome, comando, ok: true, code: 0, resumo: 'ok' }), fechar: () => {} });
    // Como o CLI: a conferencia no escopo pt-BR (o --json), o texto no locale do comando.
    const r = comLocale('pt-BR', () => conferirClaims(p.carregado, thread.id, { tarefa: 'T1', fabrica }));
    assert.equal(r.itens[0].alegacao, 'verify da tarefa T1 do plano');
    assert.match(comLocale('en', () => textoDaConferencia(r)), /\n {2}T1 {2}passed {2}the plan verify of task T1\n/);
    const semSandbox: FabricaDeExecutor = () => { throw new Error('executor VERIFY sandbox disponível somente em Linux'); };
    let erro: unknown;
    try { comLocale('pt-BR', () => conferirClaims(p.carregado, thread.id, { tarefa: 'T1', fabrica: semSandbox })); } catch (e) { erro = e; }
    assert.equal(comLocale('en', () => mensagemDoErro(erro)),
      'claims.conferir.sandbox-indisponivel: the VERIFY sandbox executor is only available on Linux; the spot check only runs confined, with no fallback');
    assert.equal(mensagemDoErro(erro),
      'claims.conferir.sandbox-indisponivel: executor VERIFY sandbox disponível somente em Linux; a conferencia so roda confinada, sem fallback');
  } finally { ligarRemontagem(false); p.limpar(); }
});
