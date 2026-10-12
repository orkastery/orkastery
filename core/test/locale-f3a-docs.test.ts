/**
 * RM-061, fatia F3a: a familia docs init em ingles. Com o locale ingles, `ork docs init` cria os sete arquivos a
 * partir de `core/assets/docs-en/`, nos mesmos caminhos, e imprime em ingles (D5, D6). O contrato do `ork docs
 * verificar` fica igual (D3): pagina de produto e item de roadmap feitos dos modelos em ingles, preenchidos, passam no
 * verificador sem erro. Negativo: em pt-BR os arquivos sao os de `core/assets/docs/`; `ork docs verificar` segue em
 * pt-BR com o locale ingles. Os nomes comecam por "locale F3a docs:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirDosModelos, iniciarDocs, sincronizarDocs, verificarDocs } from '../src/docs';
import { ativarLocale } from '../src/locale';
import { cenario, Cenario, EN, linhasEmPortugues, ork } from './locale-apoio';
import { ARQUIVOS_DO_DOCS_INIT } from './locale-f3a-casos';

const C = { LANG: 'C.UTF-8' };
const AGORA = '2026-09-24T20:00:00-03:00';
/** O arquivo do projeto e o modelo do nucleo de onde ele sai (o `.markdownlint-cli2.jsonc` perde o ponto). */
const ORIGEM: Readonly<Record<string, string>> = Object.fromEntries(ARQUIVOS_DO_DOCS_INIT.map((a) =>
  [a, a === '.markdownlint-cli2.jsonc' ? 'markdownlint-cli2.jsonc' : a.replace(/^docs\//, '')]));

/** O contrato do verificador, que fica em pt-BR nas duas linguas e nao conta como texto para pessoas (D3). */
const CONTRATO = ['Em uma frase', 'Estado com evidências', 'Não iniciados', 'Não iniciado', 'Não implantado', 'Flag desligada',
  'em desenvolvimento', 'Em desenvolvimento'];

/** O texto para pessoas de um arquivo do docs init: sem frontmatter, sem os titulos `##` (secoes do contrato). */
function prosa(texto: string): string {
  const corpo = texto.startsWith('---\n') ? texto.slice(texto.indexOf('\n---\n', 3) + 5) : texto;
  return corpo.split('\n').filter((l) => !l.startsWith('## ')).join('\n');
}

const ler = (dir: string, rel: string): string => fs.readFileSync(path.join(dir, rel), 'utf8');
const escrever = (dir: string, rel: string, texto: string): void => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), texto);
};

/** Troca cada campo `[...]` do corpo por texto, como quem preenche o modelo. */
function preencher(texto: string, trocas: Array<[string | RegExp, string]>): string {
  let t = texto;
  for (const [de, para] of trocas) t = t.replace(de, para);
  const fim = t.indexOf('\n---\n', 3) + 5;
  return t.slice(0, fim) + t.slice(fim).replace(/\[[^\]\n]*\]/g, 'To be defined: Ana, next review');
}

/** A hierarquia minima acima da feature: plataforma, sistema e modulo. */
function hierarquia(dir: string): void {
  for (const [id, tipo, pai, titulo] of [['PLAT-01', 'plataforma', null, 'Platform'], ['SYS-01', 'sistema', 'PLAT-01', 'System'],
    ['MOD-01', 'modulo', 'SYS-01', 'Module']] as const) {
    escrever(dir, `docs/produto/${id}-${titulo.toLowerCase()}.md`, `---\nid: ${id}\ntipo: ${tipo}\ntitulo: ${titulo}\nowner: Ana\n` +
      `estado: vigente\n${pai ? `pai: ${pai}\n` : ''}verificado_em: ${AGORA}\n---\n\n# ${id}: ${titulo}\n\n` +
      `> **Em uma frase:** the ${titulo.toLowerCase()} exists for this test.\n\n## Contexto e limites\n\n- **Goal:** fixture.\n`);
  }
}

test('locale F3a docs: com LANG ingles, ork docs init cria os sete arquivos dos modelos em ingles e imprime em ingles', () => {
  const c = cenario('f3a-docs-en', false);
  try {
    const r = ork(c, EN, false, 'docs', 'init');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, ['Created:', ...ARQUIVOS_DO_DOCS_INIT.map((a) => `  ${a}`), '',
      'Next step: copy `docs/produto/_modelo-feature.md` and `docs/roadmap/_modelo-item.md`, then run `ork docs verificar`.', ''].join('\n'));
    const en = dirDosModelos('en');
    assert.equal(path.basename(en), 'docs-en');
    for (const arquivo of ARQUIVOS_DO_DOCS_INIT) {
      const texto = ler(c.dir, arquivo);
      assert.equal(texto, fs.readFileSync(path.join(en, ORIGEM[arquivo]), 'utf8'), arquivo);
      assert.notEqual(texto, fs.readFileSync(path.join(dirDosModelos(), ORIGEM[arquivo]), 'utf8'), `${arquivo} difere do pt-BR`);
      assert.deepEqual(linhasEmPortugues(prosa(texto), CONTRATO), [], arquivo);
      assert.ok(!texto.includes('—'), `${arquivo} sem travessao`);
    }
    const de = ork(c, EN, false, 'docs', 'init');
    assert.equal(de.stdout, 'Docs as code were already in the project: nothing created.\n');
  } finally { c.limpar(); }
});

test('locale F3a docs: owner.language en-US vence o C.UTF-8 no docs init', () => {
  const c = cenario('f3a-docs-owner', false);
  try {
    assert.equal(ork(c, C, false, 'init', '--name', 'loja', '--abbrev', 'loj').status, 0);
    const yaml = path.join(c.dir, 'orkastery.yaml');
    fs.writeFileSync(yaml, ler(c.dir, 'orkastery.yaml').replace('  # language: pt-BR  # ausente: locale do sistema', '  language: en-US'));
    const r = ork(c, C, false, 'docs', 'init');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Created:\n/);
    assert.equal(ler(c.dir, 'docs/roadmap/_modelo-item.md'), fs.readFileSync(path.join(dirDosModelos('en'), 'roadmap/_modelo-item.md'), 'utf8'));
  } finally { c.limpar(); }
});

test('locale F3a docs: pagina e item feitos dos modelos em ingles, preenchidos, passam no ork docs verificar sem erro', () => {
  const c: Cenario = cenario('f3a-docs-verificar', false);
  try {
    assert.equal(ork(c, EN, false, 'docs', 'init').status, 0);
    hierarquia(c.dir);
    escrever(c.dir, 'docs/produto/FEAT-001-login.md', preencher(ler(c.dir, 'docs/produto/_modelo-feature.md'), [
      ['id: FEAT-000', 'id: FEAT-001'], ['titulo: <Feature name>', 'titulo: Login'], ['pai: MOD-00', 'pai: MOD-01'],
      ['roadmap: [RM-000]', 'roadmap: [RM-001]'], [/owner: <name>/, 'owner: Ana'], [/aprovador: <name>/, 'aprovador: Bia'],
      ['versao: main@0000000', 'versao: main@abc1234'], ['# FEAT-000: Feature name', '# FEAT-001: Login']]));
    escrever(c.dir, 'docs/roadmap/RM-001-login.md', preencher(ler(c.dir, 'docs/roadmap/_modelo-item.md'), [
      ['id: RM-000', 'id: RM-001'], ['titulo: <Intended result>', 'titulo: Login'], ['features: []', 'features: [FEAT-001]'],
      [/owner: <name>/, 'owner: Ana'], ['# RM-000: Intended result', '# RM-001: Login']]));
    sincronizarDocs(c.dir, { escrever: true, agora: () => AGORA, itens: ['RM-001'] });
    const { docs, achados } = verificarDocs(c.dir, { semGit: true });
    assert.equal(docs.length, 5);
    assert.deepEqual(achados.filter((a) => a.gravidade === 'erro'), []);
    // O modelo em ingles copiado sem preencher reprova, como o de pt-BR.
    escrever(c.dir, 'docs/produto/FEAT-009-x.md', ler(c.dir, 'docs/produto/_modelo-feature.md').replace('id: FEAT-000', 'id: FEAT-009'));
    const esquecidos = verificarDocs(c.dir, { semGit: true }).achados.filter((a) => a.arquivo.endsWith('FEAT-009-x.md') && a.regra === 'docs.modelo');
    assert.ok(esquecidos.length >= 6, esquecidos.map((a) => a.mensagem).join('\n'));
  } finally { c.limpar(); }
});

test('locale F3a docs (negativo): em pt-BR os arquivos sao os de core/assets/docs, e ork docs verificar segue em pt-BR com LANG ingles', () => {
  const c = cenario('f3a-docs-pt', false);
  try {
    assert.equal(ork(c, C, false, 'docs', 'init').status, 0);
    for (const arquivo of ARQUIVOS_DO_DOCS_INIT) {
      assert.equal(ler(c.dir, arquivo), fs.readFileSync(path.join(dirDosModelos(), ORIGEM[arquivo]), 'utf8'), arquivo);
    }
    const pt = ork(c, C, false, 'docs', 'verificar'), en = ork(c, EN, false, 'docs', 'verificar');
    assert.equal(en.status, pt.status);
    assert.equal(en.stdout, pt.stdout, 'docs verificar nao segue o locale (F3b)');
  } finally { c.limpar(); }
  // A funcao sem locale segue em pt-BR mesmo com o locale ativo em ingles (D2).
  const d = cenario('f3a-docs-funcao', false);
  ativarLocale('en');
  try {
    iniciarDocs(d.dir);
    assert.equal(ler(d.dir, 'docs/roadmap/README.md'), fs.readFileSync(path.join(dirDosModelos(), 'roadmap/README.md'), 'utf8'));
  } finally { ativarLocale(undefined); d.limpar(); }
});
