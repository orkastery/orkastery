/**
 * RM-061, fatia F3a: a familia do bloco da experiencia em ingles. Com o dono em `en-US`, `ork adapter install
 * claude-code` (e `codex`) escreve o bloco do `CLAUDE.md` (do `AGENTS.md`) em ingles; reinstalar nao muda nada;
 * trocar a lingua atualiza o bloco no lugar; sem recibo, o bloco e adotado nas duas linguas (D8); `ork experiencia
 * uninstall` remove o bloco ingles. Negativo: bloco ingles editado e conflito e nada e escrito; dono em pt-BR (ou
 * sem lingua, com `C.UTF-8`) recebe o bloco pt-BR; a funcao chamada sem locale segue em pt-BR (D2). Os nomes
 * comecam por "locale F3a experiencia:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { aplicarExperiencia, FIM_EXPERIENCIA, HostComBloco, INICIO_EXPERIENCIA, planejarExperiencia } from '../src/experiencia-instalacao';
import { instalarAdaptador } from '../src/hosts';
import { ativarLocale } from '../src/locale';
import { ajustarManifesto, projetoTemporario } from './apoio';
import { cenario, Cenario, EN, linhasEmPortugues, ork } from './locale-apoio';

const C = { LANG: 'C.UTF-8' };
const CATALOGO = path.resolve(__dirname, '../../..');
const ARQUIVO: Readonly<Record<HostComBloco, string>> = { 'claude-code': 'CLAUDE.md', codex: 'AGENTS.md' };

/** O bloco da experiencia dentro de um arquivo de instrucoes, com os marcadores. */
function blocoDe(texto: string): string {
  const inicio = texto.indexOf(INICIO_EXPERIENCIA), fim = texto.indexOf(FIM_EXPERIENCIA);
  assert.ok(inicio >= 0 && fim > inicio, `sem bloco da experiencia:\n${texto}`);
  return texto.slice(inicio, fim + FIM_EXPERIENCIA.length);
}

/** O diretorio das skills que o bloco aponta (a linha 3, em JSON, nas duas linguas). */
function diretorioDo(bloco: string): string {
  const m = /^(?:If active|Se ativo)[^"\n]*("[^"\n]*")\.$/m.exec(bloco);
  assert.ok(m, bloco);
  return JSON.parse(m[1]) as string;
}

/** O bloco que a instalacao escreve num arquivo novo, na lingua pedida, para o diretorio dado. */
function blocoEsperado(host: HostComBloco, diretorio: string, locale: 'pt-BR' | 'en'): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-locale-f3a-esperado-')));
  try {
    const plano = planejarExperiencia(dir, host, diretorio, locale);
    const arquivo = plano.mudancas.find((m) => m.arquivo === path.join(dir, ARQUIVO[host]));
    assert.ok(arquivo?.depois);
    return blocoDe(arquivo.depois.toString('utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function confereBlocoIngles(bloco: string): void {
  assert.ok(bloco.includes('\n## Orchestration experience\n'), bloco);
  assert.ok(bloco.includes('\nRun `ork experiencia show --json` in this project. If `experience` is false, do not activate the package.\n'), bloco);
  assert.match(bloco, /\nIf active, read the skill selected by the `skill` field in the directory "[^"\n]+"\.\n/);
  assert.ok(bloco.includes('\nPreferences are core data; preserve gates, human provenance and host permissions.\n'), bloco);
  assert.deepEqual(linhasEmPortugues(bloco), [], 'nenhuma linha em pt-BR');
}

/** Projeto com manifesto do `ork init` (pt-BR) e a lingua do dono gravada no manifesto. */
function projetoComDono(nome: string, lingua: string | null): Cenario {
  const c = cenario(nome, false);
  assert.equal(ork(c, C, false, 'init', '--name', 'loja', '--abbrev', 'loj').status, 0);
  if (lingua) definirLingua(c, lingua);
  return c;
}

function definirLingua(c: Cenario, lingua: string): void {
  const yaml = path.join(c.dir, 'orkastery.yaml');
  const texto = fs.readFileSync(yaml, 'utf8').replace(/^ {2}#? ?language: \S+.*$/m, `  language: ${lingua}`);
  assert.ok(texto.includes(`\n  language: ${lingua}\n`), texto);
  fs.writeFileSync(yaml, texto);
}

const ler = (c: Cenario, arquivo: string): string => fs.readFileSync(path.join(c.dir, arquivo), 'utf8');

test('locale F3a experiencia: dono en-US, ork adapter install escreve o bloco em ingles nos dois hosts, e reinstalar nao muda nada', () => {
  for (const host of ['claude-code', 'codex'] as const) {
    const c = projetoComDono(`f3a-exp-en-${host}`, 'en-US');
    try {
      const r = ork(c, C, false, 'adapter', 'install', host);
      assert.equal(r.status, 0, r.stderr);
      const texto = ler(c, ARQUIVO[host]), bloco = blocoDe(texto);
      confereBlocoIngles(bloco);
      assert.equal(bloco, blocoEsperado(host, diretorioDo(bloco), 'en'));
      assert.ok(fs.existsSync(path.join(c.dir, '.orkastery', 'experiencia', `${host}.json`)), 'recibo gravado');
      assert.equal(ork(c, C, false, 'adapter', 'install', host).status, 0);
      assert.equal(ler(c, ARQUIVO[host]), texto, 'reinstalar na mesma lingua nao muda o arquivo');
    } finally { c.limpar(); }
  }
});

test('locale F3a experiencia: trocar a lingua do dono atualiza o bloco no lugar, e ork experiencia uninstall remove o bloco ingles', () => {
  const c = projetoComDono('f3a-exp-troca', 'en-US');
  try {
    fs.writeFileSync(path.join(c.dir, 'CLAUDE.md'), '# Instrucoes do time\n\nTexto humano.\n');
    assert.equal(ork(c, C, false, 'adapter', 'install', 'claude-code').status, 0);
    const ingles = blocoDe(ler(c, 'CLAUDE.md'));
    confereBlocoIngles(ingles);
    definirLingua(c, 'pt-BR');
    assert.equal(ork(c, EN, false, 'adapter', 'install', 'claude-code').status, 0);
    const texto = ler(c, 'CLAUDE.md');
    assert.ok(texto.startsWith('# Instrucoes do time\n\nTexto humano.\n\n'), 'o texto humano fica');
    assert.equal(blocoDe(texto), blocoEsperado('claude-code', diretorioDo(ingles), 'pt-BR'), 'o bloco volta ao pt-BR no lugar');
    definirLingua(c, 'en-US');
    assert.equal(ork(c, C, false, 'adapter', 'install', 'claude-code').status, 0);
    confereBlocoIngles(blocoDe(ler(c, 'CLAUDE.md')));
    const u = ork(c, C, false, 'experiencia', 'uninstall', 'claude-code');
    assert.equal(u.status, 0, u.stderr);
    assert.equal(ler(c, 'CLAUDE.md'), '# Instrucoes do time\n\nTexto humano.\n', 'a remocao devolve o arquivo de antes');
    assert.equal(fs.existsSync(path.join(c.dir, '.orkastery', 'experiencia', 'claude-code.json')), false);
  } finally { c.limpar(); }
});

test('locale F3a experiencia: sem recibo, o bloco e adotado nas duas linguas e a remocao reconhece o ingles', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-locale-f3a-adocao-')));
  const recibo = path.join(dir, '.orkastery', 'experiencia', 'claude-code.json'), claude = path.join(dir, 'CLAUDE.md');
  try {
    aplicarExperiencia(planejarExperiencia(dir, 'claude-code', 'skills/core', 'en'));
    const ingles = fs.readFileSync(claude, 'utf8');
    fs.unlinkSync(recibo);
    // Mesma lingua: so o recibo volta; o arquivo fica igual.
    const mesma = planejarExperiencia(dir, 'claude-code', 'skills/core', 'en');
    assert.deepEqual(mesma.mudancas.map((m) => path.relative(dir, m.arquivo)), ['.orkastery/experiencia/claude-code.json']);
    // Outra lingua, sem recibo: o bloco ingles e adotado e trocado no lugar pelo pt-BR.
    const outra = planejarExperiencia(dir, 'claude-code', 'skills/core', 'pt-BR');
    const novo = outra.mudancas.find((m) => m.arquivo === claude);
    assert.ok(novo?.depois);
    assert.equal(blocoDe(novo.depois.toString('utf8')), blocoEsperado('claude-code', 'skills/core', 'pt-BR'));
    // Remocao sem recibo do bloco ingles: o arquivo, que so tinha o bloco, some.
    assert.equal(fs.readFileSync(claude, 'utf8'), ingles);
    const remocao = planejarExperiencia(dir, 'claude-code', null);
    assert.deepEqual(remocao.mudancas.map((m) => [path.relative(dir, m.arquivo), m.depois]), [['CLAUDE.md', null]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('locale F3a experiencia (negativo): bloco ingles editado e conflito, com e sem recibo, e nada e escrito', () => {
  const c = projetoComDono('f3a-exp-editado', 'en-US');
  try {
    assert.equal(ork(c, C, false, 'adapter', 'install', 'claude-code').status, 0);
    const editado = ler(c, 'CLAUDE.md').replace('do not activate the package', 'never activate the package');
    fs.writeFileSync(path.join(c.dir, 'CLAUDE.md'), editado);
    for (const semRecibo of [false, true]) {
      if (semRecibo) fs.unlinkSync(path.join(c.dir, '.orkastery', 'experiencia', 'claude-code.json'));
      const r = ork(c, C, false, 'adapter', 'install', 'claude-code');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Pacote de experiência pulado: o bloco de instruções ou o recibo .* foi editado ou está duplicado; nada foi escrito/);
      assert.equal(ler(c, 'CLAUDE.md'), editado, semRecibo ? 'sem recibo' : 'com recibo');
      assert.throws(() => planejarExperiencia(c.dir, 'claude-code', null), /experiencia\.bloco\.conflict/);
    }
  } finally { c.limpar(); }
});

test('locale F3a experiencia (negativo): dono pt-BR com LANG ingles, e dono sem lingua com C.UTF-8, recebem o bloco pt-BR', () => {
  for (const [nome, lingua, locale] of [['pt-owner', 'pt-BR', EN], ['sem-lingua', null, C]] as const) {
    const c = projetoComDono(`f3a-exp-${nome}`, lingua);
    try {
      assert.equal(ork(c, locale, false, 'adapter', 'install', 'claude-code').status, 0, nome);
      const bloco = blocoDe(ler(c, 'CLAUDE.md'));
      assert.equal(bloco, blocoEsperado('claude-code', diretorioDo(bloco), 'pt-BR'), nome);
      assert.ok(bloco.includes('\n## Experiência de orquestração\n'), nome);
    } finally { c.limpar(); }
  }
});

test('locale F3a experiencia (negativo): instalarAdaptador sem locale segue em pt-BR com o dono en-US e o locale ativo en; com locale en, ingles', () => {
  const p = projetoTemporario('locale-f3a-exp-funcao');
  try {
    ajustarManifesto(p, '  # language: pt-BR  # ausente: locale do sistema', '  language: en-US');
    // O locale ativo em ingles (o que um `main` anterior deixa no processo) nao escolhe a lingua do bloco (D2, W2 do CHECK).
    ativarLocale('en');
    let r: ReturnType<typeof instalarAdaptador>;
    try { r = instalarAdaptador('claude-code', { projeto: p.dir, catalogo: CATALOGO, orkBin: 'ork' }); } finally { ativarLocale(undefined); }
    assert.equal(r.ok, true);
    const pt = blocoDe(fs.readFileSync(path.join(p.dir, 'CLAUDE.md'), 'utf8'));
    assert.equal(pt, blocoEsperado('claude-code', diretorioDo(pt), 'pt-BR'));
    const en = instalarAdaptador('claude-code', { projeto: p.dir, catalogo: CATALOGO, orkBin: 'ork', locale: 'en' });
    assert.equal(en.ok, true);
    confereBlocoIngles(blocoDe(fs.readFileSync(path.join(p.dir, 'CLAUDE.md'), 'utf8')));
  } finally { p.limpar(); }
});
