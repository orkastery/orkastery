/**
 * RM-053, Y4 do CHECK 7: as marcas visiveis da categoria `Cf` (os sinais numericos arabes, o fim de
 * aya, a abreviacao siriaca, as marcas kaithi) passam pelo saneador comum e pela regra da rede; o que
 * ninguem ve (bidi, largura zero, tags, o hifen suave) continua barrado.
 *
 * Antes desta fatia, `INVISIVEL` pegava a categoria `Cf` inteira: o nome `٠١ U+0600` tirava o projeto
 * do retrato e o `emUmaLinha` apagava a marca. Todo caso de "passa" abaixo reprova no codigo anterior.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CF_VISIVEL, emUmaLinha, INVISIVEL, jsonSemInvisivel, valoresEmUmaLinha } from '../src/saida-segura';
import { ehNomeDeProjeto, projetosConhecidos } from '../src/rede-projetos';
import { normalizarRetrato, projetoNoContrato } from '../src/rede';
import { dirTemporario } from './apoio';

const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;

/** As 13 marcas com `Prepended_Concatenation_Mark=Yes` no Unicode 17, escritas a mao (nao copiadas da lista). */
const VISIVEIS = [0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605, 0x06dd, 0x070f, 0x0890, 0x0891, 0x08e2, 0x110bd, 0x110cd];

/** Formato que ninguem ve: bidi (embutir, isolar, marcas), largura zero, juncao, BOM, hifen suave, tags, musica. */
const INVISIVEIS = [0x00ad, 0x061c, 0x180e, 0x200b, 0x200c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff, 0x1d173, 0xe0001, 0xe0041];

test('Y4: a lista fechada e exatamente as 13 marcas, todas Cf, nenhuma Default_Ignorable', () => {
  assert.deepEqual([...CF_VISIVEL], VISIVEIS);
  for (const c of VISIVEIS) {
    const s = String.fromCodePoint(c);
    assert.ok(/\p{Cf}/u.test(s), `${hex(c)} e Cf`);
    assert.ok(!/\p{Default_Ignorable_Code_Point}/u.test(s), `${hex(c)} nao e ignoravel`);
  }
});

test('Y4: cada marca visivel passa pelo INVISIVEL; cada invisivel de verdade segue pego', () => {
  for (const c of VISIVEIS) assert.equal(INVISIVEL.test(String.fromCodePoint(c)), false, `${hex(c)} passa`);
  for (const c of INVISIVEIS) assert.equal(INVISIVEL.test(String.fromCodePoint(c)), true, `${hex(c)} segue barrado`);
});

test('Y4: fora da lista e do ZWJ, nenhum ponto Cf do Unicode inteiro escapa do INVISIVEL', () => {
  const livres = new Set([...VISIVEIS, 0x200d]);
  const escapam: string[] = [];
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const s = String.fromCodePoint(c);
    if (/\p{Cf}/u.test(s) && !livres.has(c) && !INVISIVEL.test(s)) escapam.push(hex(c));
  }
  assert.deepEqual(escapam, []);
});

test('Y4: nome de projeto com U+0600 e U+070F passa intacto; com U+200B, U+202E ou U+2066 sai', () => {
  for (const nome of ['Contas ؀123', 'Sinal ܏', '۝114', 'Kaithi \u{110bd}', 'Libra ࢐ e ࣢']) {
    assert.equal(ehNomeDeProjeto(nome), true, JSON.stringify(nome));
    assert.deepEqual(projetoNoContrato({ nome, remoto: null, caminho: '/srv/p' }), { nome, remoto: null, caminho: '/srv/p' });
  }
  for (const nome of ['Contas​', 'Contas ‮321', 'Contas ⁦x⁩', 'Contas ؀‮']) {
    assert.equal(ehNomeDeProjeto(nome), false, JSON.stringify(nome));
    assert.equal(projetoNoContrato({ nome, remoto: null, caminho: '/srv/p' }), null, JSON.stringify(nome));
  }
});

test('Y4: o retrato com projeto de marca visivel e aceito pelo leitor, com o nome igual; o de bidi e recusado', () => {
  const base = { contrato: 'ork.rede-maquina/v1', maquina: 'pc-a', hostname: 'pc-a', adesao: 'rede', versaoOrk: '0.5.0',
    publicadoEm: new Date().toISOString(), forjas: [], runtimes: [], hosts: [] };
  const lido = normalizarRetrato({ ...base, projetos: [{ nome: 'Contas ؀܏', remoto: null, caminho: '/srv/contas؁' }] });
  assert.ok(lido, 'o leitor aceita');
  assert.deepEqual(lido!.projetos, [{ nome: 'Contas ؀܏', remoto: null, caminho: '/srv/contas؁' }]);
  assert.equal(normalizarRetrato({ ...base, projetos: [{ nome: 'Contas ‮', remoto: null, caminho: '/srv/c' }] }), null);
  assert.equal(normalizarRetrato({ ...base, hostname: 'pc⁦a', projetos: [] }), null);
});

test('Y4: o escritor (registro de projetos) leva o projeto de marca visivel e descarta o de largura zero', () => {
  const raiz = dirTemporario('rm053-y4');
  try {
    const visivel = path.join(raiz, 'visivel'), escondido = path.join(raiz, 'escondido');
    for (const d of [visivel, escondido]) fs.mkdirSync(d, { recursive: true });
    const registro = path.join(raiz, 'projetos.json');
    fs.writeFileSync(registro, JSON.stringify({ contrato: 'ork.projetos/v1', projetos: [
      { nome: 'Contas ؀܏', raiz: visivel }, { nome: 'Contas​', raiz: escondido }] }));
    const nomes = projetosConhecidos({ arquivo: registro }).projetos.map((p) => p.nome);
    assert.deepEqual(nomes, ['Contas ؀܏']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('Y4: a saida em uma linha e o JSON mantem a marca visivel e seguem limpando bidi e largura zero', () => {
  assert.equal(emUmaLinha('Contas ؀۝܏\u{110cd}'), 'Contas ؀۝܏\u{110cd}');
  assert.equal(emUmaLinha('a​b‮c⁦d\u{e0041}e'), 'abcde');
  assert.deepEqual(valoresEmUmaLinha({ projeto: '؀x‮', lista: ['܏⁩'] }), { projeto: '؀x', lista: ['܏'] });
  const json = jsonSemInvisivel({ nome: 'Contas ؀܏', sujo: 'a‮b​c' });
  assert.ok(json.includes('Contas ؀܏'), 'a marca visivel fica como texto');
  assert.ok(json.includes('a\\u202eb\\u200bc'), 'o invisivel vira \\uXXXX');
  assert.deepEqual(JSON.parse(json), { nome: 'Contas ؀܏', sujo: 'a‮b​c' }, 'o valor e o mesmo');
});
