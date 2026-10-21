/**
 * RM-061 (D3 da thread ork-rm061f2a): o contador de mensagens de saida (`core/scripts/contar-mensagens-de-saida.cjs`),
 * que reimplementa o metodo do PR #113, com uma fixture em que cada regra tem um caso que conta e outro que
 * nao conta. Os nomes comecam por "contador F2a:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/contar-mensagens-de-saida.cjs');

const FONTE = [
  "export function a(): string {",
  "  console.log('saida no console');",          // conta: console
  "  process.stderr.write(`erro de escrita`);",  // conta: process.std*.write
  "  const linhas: string[] = [];",
  "  linhas.push(`linha do relatorio ${1}`);",   // conta: push, template com interpolacao
  "  if (linhas.length > 3) throw new Error('falhou de verdade');", // conta: Error
  "  const nada = 'texto que nao sai';",          // nao conta: variavel solta
  "  console.log('palavra');",                    // nao conta: uma palavra so
  "  console.log('core/src');",                   // nao conta: caminho, sem espaco
  "  const r = { detalhe: 'campo de texto', id: 'campo de dado' };", // conta so o detalhe
  "  void nada; void r;",
  "  return erro('codigo.tipado', 'mensagem dentro de chamada');",  // conta: chamada comum que vai ao return
  "}",
  "function erro(c: string, m: string): string { return c + m; }",
  "export const f = (x: boolean) => x ? 'arrow que devolve' : 'outro ramo dela';", // conta 2: corpo de arrow e ternario
].join('\n');

const CATALOGO = [
  "const PT_BR = { a: 'um', b: { c: 'dois' } };",
  "declare const FAMILIA_EN: object;",
  "const EN = {",
  "  texto: 'one',",
  "  funcao: (n: number) => `n ${n}`,",
  "  concat: 'a' + 'b',",
  "  aninhado: { um: 'one', dois: 'two' },",
  "  lista: ['when', 'event'],",
  "  largura: 10,",
  "  familia: FAMILIA_EN,",
  "};",
  "void PT_BR; void EN;",
].join('\n');

function medir(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('contador F2a: cada regra do metodo conta o que deve e deixa de fora o resto', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-contador-')));
  try {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'a.ts'), FONTE);
    fs.writeFileSync(path.join(dir, 'locale.ts'), CATALOGO);
    fs.writeFileSync(path.join(dir, 'locale-familia.ts'), "export const FAMILIA_PT_BR = { x: 'um', y: 'dois' };\nexport const FAMILIA_EN = { x: 'one', y: 'two' };\n");
    fs.writeFileSync(path.join(dir, 'locale-familia-composta.ts'), "export const COMPOSTA_EN = { x: 'three' };\n");
    fs.writeFileSync(path.join(dir, 'tipos.d.ts'), "export declare const x: 'nao entra na conta';\n");
    const r = medir('--json', dir);
    assert.equal(r.status, 0, r.stderr);
    const m = JSON.parse(r.stdout);
    assert.equal(m.schema, 'ork.locale-cobertura/v1');
    assert.equal(m.arquivos, 4);
    // Saida: console, write, push, Error, detalhe, chamada que vai ao return e os dois ramos da arrow.
    assert.equal(m.emPosicaoDeSaida, 8);
    // Com texto de pessoa, em qualquer posicao: os 8 de saida, a variavel solta e o campo de dado.
    assert.equal(m.literaisComTexto, 10);
    assert.deepEqual(m.porArquivo, [{ arquivo: 'sub/a.ts', saida: 8 }]);
    // Catalogo: texto, funcao, concatenacao, as duas folhas aninhadas e os dois itens da lista; numero,
    // referencia a outra familia (contada no arquivo dela) e objeto que nao e o ingles nao contam.
    assert.deepEqual(m.catalogo.arquivos, [
      { arquivo: 'locale-familia-composta.ts', entradas: 1 },
      { arquivo: 'locale-familia.ts', entradas: 2 },
      { arquivo: 'locale.ts', entradas: 7 },
    ]);
    assert.equal(m.catalogo.entradas, 10);
    assert.equal(m.cobertura, Number((10 / 18).toFixed(4)));
    const texto = medir(dir);
    assert.match(texto.stdout, /^Arquivos \.ts: 4\n/);
    assert.match(texto.stdout, /\nCobertura: 55\.6%\n/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('contador F2a: uso errado e diretorio inexistente saem 2', () => {
  assert.equal(medir('--nada').status, 2);
  assert.equal(medir('/nao/existe/mesmo').status, 2);
  assert.equal(medir('a', 'b').status, 2);
});
