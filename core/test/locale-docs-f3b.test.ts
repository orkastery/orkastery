/**
 * RM-061, fatia F3b: `ork docs verificar|sincronizar` em ingles. O resumo, os achados, a sincronizacao, o escopo e o uso
 * saem pelo catalogo; o `--json` leva a mensagem e a correcao de cada achado em pt-BR nas duas linguas. Negativo: o
 * contrato que o verificador le nas paginas (chaves, valores, secoes, `Em uma frase`) nao muda com a lingua. Os nomes
 * comecam por "locale en F3b docs:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cobreLocale } from '../src/locale';
import { cenario, Cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

/** O contrato do verificador, que fica em pt-BR nas duas linguas: secoes, a linha de abertura e o nome da tabela. */
const CONTRATO = ['Em uma frase', 'Estado com evidências', 'Comportamento', 'Dados e contratos', 'Operação e controle', 'Histórico',
  'Problema e resultado', 'Escopo e validação', 'Plano e decisões', 'Responsabilidades e histórico'];
/** O campo do modelo esquecido na pagina (`[o que entra]`) e dado da pagina, nao texto do CLI. */
const semCampos = (t: string) => t.replace(/\[[^\]\n]*\]/g, '[x]');

/** As paginas do snapshot da F3b: um item do modelo, um item sem nada e uma feature com paragrafo longo e link quebrado. */
function paginas(c: Cenario): void {
  assert.equal(ork(c, PT, false, 'docs', 'init').status, 0);
  const modelo = fs.readFileSync(path.join(c.dir, 'docs', 'roadmap', '_modelo-item.md'), 'utf8');
  fs.writeFileSync(path.join(c.dir, 'docs', 'roadmap', 'RM-001-teste.md'), modelo.replace(/RM-NNN/g, 'RM-001'));
  fs.writeFileSync(path.join(c.dir, 'docs', 'roadmap', 'RM-02-ruim.md'), '---\nid: RM-02\ntipo: roadmap\n---\n\n# Sem nada\n\nTexto.\n');
  fs.writeFileSync(path.join(c.dir, 'docs', 'produto', 'FEAT-01-x.md'), '---\nid: FEAT-01\ntipo: feature\npai: MOD-09\n---\n\n# FEAT-01 x\n\n' +
    `${'palavra '.repeat(130)}\n\n[link](nao-existe.md)\n`);
}

test('locale en F3b docs: verificar sai em ingles, com o --json em pt-BR igual nas duas linguas', () => {
  const c = cenario('docs-f3b');
  try {
    paginas(c);
    const en = ork(c, EN, false, 'docs', 'verificar');
    assert.equal(en.status, 2, en.stderr);
    assert.match(en.stdout, /^Documentation: 3 pages \(1 feature\(s\), 2 roadmap item\(s\), 0 context page\(s\)\)\nFAILED: \d+ error\(s\) · 3 warning\(s\)\n\nErrors\n/);
    assert.match(en.stdout, /\n {2}RM-02 {5}ID "RM-02" does not follow the roadmap pattern\n {12}→ expected format: RM-d\{3\}\n/);
    assert.match(en.stdout, /\n {2}FEAT-01 {3}missing key "titulo"\n {12}→ copy the key from the template; a gap is written as `To be defined` with an owner and a deadline\n/);
    assert.match(en.stdout, /\n {2}FEAT-01 {3}missing section "## Comportamento"\n {12}→ if it does not apply, write inside it: `Not applicable: reason`\n/);
    assert.match(en.stdout, /\n {2}FEAT-01 {3}broken link: nao-existe\.md\n/);
    assert.match(en.stdout, /\n\nWarnings\n {2}FEAT-01 {3}paragraph with \d+ characters\n {12}→ break it into bullets: one idea per line\n/);
    assert.deepEqual(linhasEmPortugues(semCampos(en.stdout), CONTRATO), []);
    // `--pr` segue o locale, com o mesmo codigo de saida.
    const pr = ork(c, EN, false, 'docs', 'verificar', '--pr');
    assert.equal(pr.status, 2);
    assert.deepEqual(linhasEmPortugues(semCampos(pr.stdout), CONTRATO), []);
    // O --json e o mesmo nas duas linguas, com a mensagem e a correcao em pt-BR.
    const json = ork(c, EN, false, 'docs', 'verificar', '--json');
    assert.equal(json.stdout, ork(c, PT, false, 'docs', 'verificar', '--json').stdout);
    const achados = (JSON.parse(json.stdout) as { achados: { regra: string; mensagem: string; correcao?: string }[] }).achados;
    assert.ok(achados.some((a) => a.regra === 'docs.id.formato' && a.mensagem === 'ID "RM-02" fora do padrão de roadmap'
      && a.correcao === 'formato esperado: RM-d{3}'));
    assert.ok(achados.some((a) => a.regra === 'docs.link' && a.mensagem === 'link quebrado: nao-existe.md'));
  } finally { c.limpar(); }
});

test('locale en F3b docs: sincronizar sai em ingles, com o escopo, as mudancas, o uso e o --json igual', () => {
  const c = cenario('docs-f3b-sync');
  try {
    paginas(c);
    assert.equal(ork(c, EN, false, 'docs', 'sincronizar').stdout, ['Scope: every roadmap item.', 'To update: 1 roadmap item(s), 2 index(es).',
      '  RM-000  state tables: outdated → regenerated  (frontmatter)', '  index   docs/roadmap/README.md', '  index   docs/produto/README.md', '',
      'Nothing was written. To write: `ork docs sincronizar --escrever`', ''].join('\n'));
    assert.match(ork(c, EN, false, 'docs', 'sincronizar', '--so', 'RM-001').stdout, /^Scope: only RM-001 \(`--so`\)\.\nTo update: 0 roadmap item\(s\), 2 index\(es\)\.\n/);
    const semItem = ork(c, EN, false, 'docs', 'sincronizar', '--so');
    assert.equal(semItem.status, 2);
    assert.equal(semItem.stderr, 'usage: ork docs sincronizar --so RM-NNN[,RM-MMM] (the item after `--so` is missing)\n');
    assert.equal(ork(c, EN, false, 'docs', 'sincronizar', '--so', 'XX').stderr, 'usage: ork docs sincronizar --so RM-NNN[,RM-MMM] (got: XX)\n');
    assert.equal(ork(c, EN, false, 'docs', 'voar').stderr,
      'usage: ork docs verificar [--json] [--pr] | sincronizar [--escrever] [--so RM-NNN] [--todos] | init\n');
    // O --json da sincronizacao e o mesmo nas duas linguas: o campo e os valores da mudanca sao dado, em pt-BR.
    const json = ork(c, EN, false, 'docs', 'sincronizar', '--json').stdout;
    assert.equal(json, ork(c, PT, false, 'docs', 'sincronizar', '--json').stdout);
    assert.match(json, /"campo": "tabelas de estado",\n {6}"de": "desatualizadas",\n {6}"para": "regeradas"/);
    assert.match(ork(c, EN, false, 'docs', 'sincronizar', '--todos', '--escrever').stdout, /^Scope: every roadmap item\.\nUpdated: 1 roadmap item\(s\), 2 index\(es\)\.\n/);
    assert.equal(ork(c, EN, false, 'docs', 'sincronizar').stdout, 'Scope: every roadmap item.\nIn sync: the documentation already matches the ledger and git.\n');
  } finally { c.limpar(); }
});

test('locale en F3b docs: owner.language en-US vence o LANG pt-BR, e o --json nunca ativa o locale', () => {
  for (const args of [['docs'], ['docs', 'verificar'], ['docs', 'sincronizar'], ['docs', 'voar']]) assert.ok(cobreLocale(args, {}), args.join(' '));
  assert.equal(cobreLocale(['docs', 'verificar'], { json: true }), false);
  const c = cenario('docs-f3b-dono');
  try {
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.equal(ork(c, PT, false, 'docs').stdout, 'Documentation: 0 pages (0 feature(s), 0 roadmap item(s), 0 context page(s))\nOK: no parity error\n');
  } finally { c.limpar(); }
});

test('locale en F3b docs (negativo): o contrato das paginas nao muda com a lingua; a secao traduzida reprova nas duas', () => {
  const c = cenario('docs-f3b-contrato');
  try {
    assert.equal(ork(c, EN, false, 'docs', 'init').status, 0);
    // A pagina com a secao em ingles nao cumpre o contrato: a regra e a secao cobrada sao as mesmas nas duas linguas.
    const modelo = fs.readFileSync(path.join(c.dir, 'docs', 'produto', '_modelo-feature.md'), 'utf8');
    fs.writeFileSync(path.join(c.dir, 'docs', 'produto', 'FEAT-001-x.md'), modelo.replace('id: FEAT-000', 'id: FEAT-001')
      .replace('## Comportamento', '## Behavior'));
    const regras = (args: string[], env: Record<string, string>) =>
      (JSON.parse(ork(c, env, false, ...args).stdout) as { achados: { regra: string; mensagem: string }[] }).achados
        .filter((a) => a.regra === 'docs.secao').map((a) => a.mensagem);
    assert.deepEqual(regras(['docs', 'verificar', '--json'], EN), ['falta a seção "## Comportamento"']);
    assert.deepEqual(regras(['docs', 'verificar', '--json'], PT), ['falta a seção "## Comportamento"']);
    assert.match(ork(c, EN, false, 'docs', 'verificar').stdout, /\n {2}FEAT-001 {2}missing section "## Comportamento"\n/);
    assert.match(ork(c, PT, false, 'docs', 'verificar').stdout, /\n {2}FEAT-001 {2}falta a seção "## Comportamento"\n/);
  } finally { c.limpar(); }
});
