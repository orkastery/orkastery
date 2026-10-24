/**
 * RM-072 (D20, T11 da ork-check5x): a medicao do Agile Check e do Classic Check (`core/scripts/medir-check.cjs`). A
 * medicao em si e evidencia da thread; aqui ficam a leitura do `verify_run`, a regra das tres rodadas consecutivas, a
 * soma do pico (arvore de processos mais containers), a pasta sem sequencia hexadecimal e as claims representativas. Os
 * nomes comecam por "MCn:".
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { passosDoComando, tirarPassosDoPreparo } from '../src/check-agil';

const RAIZ = path.resolve(__dirname, '..', '..', '..');

interface Rodada {
  modo: string | null;
  origem: string | null;
  ok: boolean;
  motivos: string[];
  duracaoMs: number | null;
  preparoMs: number | null;
  comandos: Array<{ nome: string; ok: boolean; duracaoMs: number | null; lanes?: unknown[] }>;
  claims: Array<{ id: string; duracaoMs: number | null }>;
  pecas: unknown[];
}

const medir = require(path.join(RAIZ, 'core', 'scripts', 'medir-check.cjs')) as {
  lerRodadas: (texto: string) => Rodada[];
  tresConsecutivas: (rodadas: Array<Pick<Rodada, 'modo' | 'ok' | 'duracaoMs'>>, tetoMs: number) => { ok: boolean; rodadas: number[] };
  rssDaArvore: (raiz: number, processos: Map<number, { ppid: number; rss: number }>) => number;
  picoAgregado: (amostras: Array<{ arvore: number; containers: number }>) => { bytes: number; amostra: number; arvore: number; containers: number };
  pastaDeBase: (tmpdir: string) => string;
  CLAIMS_REPRESENTATIVAS: Array<{ arquivo: string; alegacao: string; verificar: string }>;
};

test('MC1: cada verify_run vira uma rodada com o modo, o veredito, a parede e a duracao de cada comando e claim', () => {
  const linhas = [
    { tipo: 'baseline_recorded', commit: 'a' },
    { tipo: 'verify_run', veredito: 'verdade sustentada', motivos: [], check: { modo: 'agile', origem: 'opcao', nome: 'Agile Check' },
      duracaoMs: 170000, preparo: { nome: 'preparo', ok: true, duracaoMs: 9000 },
      comandos: [{ nome: 'build', ok: true, duracaoMs: 0 }, { nome: 'test', ok: true, duracaoMs: 120000, lanes: [{ lane: 'hermetica' }] }],
      claims: [{ id: 'C1', verificado: true, duracaoMs: 4000 }], agile: { pecas: [{ peca: 'tsgo', estado: 'agile' }] } },
    'linha que nao abre',
    { tipo: 'verify_run', veredito: 'reprovado', motivos: ['verify.failed'], check: { modo: 'classic', origem: 'opcao' }, duracaoMs: 900000,
      comandos: [{ nome: 'test', ok: false, duracaoMs: 880000 }], claims: [] },
    { tipo: 'verify_run', veredito: 'verdade sustentada', motivos: [], comandos: [], claims: [] },
  ].map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
  const r = medir.lerRodadas(linhas + '\n');
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { modo: 'agile', origem: 'opcao', ok: true, motivos: [], duracaoMs: 170000, preparoMs: 9000,
    comandos: [{ nome: 'build', ok: true, duracaoMs: 0 }, { nome: 'test', ok: true, duracaoMs: 120000, lanes: [{ lane: 'hermetica' }] }],
    claims: [{ id: 'C1', duracaoMs: 4000 }], pecas: [{ peca: 'tsgo', estado: 'agile' }] });
  assert.equal(r[1].ok, false);
  assert.deepEqual(r[1].motivos, ['verify.failed']);
  assert.equal(r[1].modo, 'classic');
  assert.equal(r[2].modo, null, 'rodada de antes da RM-072, sem check');
  assert.equal(r[2].duracaoMs, null);
});

test('MC2: tres rodadas consecutivas do Agile, aprovadas e dentro do teto; Classic, reprovada ou acima do teto no meio quebra', () => {
  const a = (duracaoMs: number | null, ok = true): Pick<Rodada, 'modo' | 'ok' | 'duracaoMs'> => ({ modo: 'agile', ok, duracaoMs });
  const c = { modo: 'classic', ok: true, duracaoMs: 60000 };
  const teto = 180000;
  assert.deepEqual(medir.tresConsecutivas([a(100000), a(170000), c, a(90000), a(120000), a(180000)], teto), { ok: true, rodadas: [3, 4, 5] });
  assert.equal(medir.tresConsecutivas([a(100000), a(100000), c, a(100000)], teto).ok, false, 'o Classic no meio quebra');
  assert.equal(medir.tresConsecutivas([a(100000), a(100000, false), a(100000), a(100000)], teto).ok, false, 'reprovada quebra');
  assert.equal(medir.tresConsecutivas([a(100000), a(180001), a(100000), a(100000)], teto).ok, false, 'acima do teto quebra');
  assert.equal(medir.tresConsecutivas([a(100000), a(null), a(100000), a(100000)], teto).ok, false, 'sem duracao no ledger quebra');
  assert.equal(medir.tresConsecutivas([a(100000), a(100000)], teto).ok, false);
});

test('MC3: o RSS da arvore soma o processo e todos os descendentes, e so eles', () => {
  const tabela = new Map<number, { ppid: number; rss: number }>([
    [10, { ppid: 1, rss: 100 }], [11, { ppid: 10, rss: 20 }], [12, { ppid: 11, rss: 3 }], [13, { ppid: 10, rss: 4 }],
    [20, { ppid: 1, rss: 1000 }], [21, { ppid: 20, rss: 500 }],
  ]);
  assert.equal(medir.rssDaArvore(10, tabela), 127);
  assert.equal(medir.rssDaArvore(11, tabela), 23);
  assert.equal(medir.rssDaArvore(99, tabela), 0, 'processo que ja acabou');
  tabela.set(10, { ppid: 12, rss: 100 });
  assert.equal(medir.rssDaArvore(10, tabela), 127, 'ciclo na tabela nao prende o laco');
});

test('MC4: o pico agregado e a maior soma da arvore com os containers numa mesma amostra', () => {
  const pico = medir.picoAgregado([{ arvore: 900, containers: 0 }, { arvore: 700, containers: 400 }, { arvore: 1000, containers: 50 }]);
  assert.deepEqual(pico, { bytes: 1100, amostra: 1, arvore: 700, containers: 400 });
  assert.deepEqual(medir.picoAgregado([]), { bytes: 0, amostra: -1, arvore: 0, containers: 0 });
});

test('MC5: a pasta da copia foge do TMPDIR com sequencia hexadecimal de 8 (o id de um job), que os retratos normalizam', () => {
  assert.equal(medir.pastaDeBase('/var/lib/jobs/a1b2c3d4/tmp'), '/tmp');
  assert.equal(medir.pastaDeBase('/var/tmp/x-deadbeef0'), '/tmp');
  assert.equal(medir.pastaDeBase('/tmp'), '/tmp');
  assert.equal(medir.pastaDeBase('/var/tmp/medicao'), '/var/tmp/medicao');
});

test('MC6: as claims representativas existem no repositorio e cobrem o preparo na frente e no meio da cadeia', () => {
  const preparo = passosDoComando('npm --prefix core run build && npm --prefix core run build:test');
  assert.equal(medir.CLAIMS_REPRESENTATIVAS.length, 3);
  for (const c of medir.CLAIMS_REPRESENTATIVAS) {
    assert.ok(fs.existsSync(path.join(RAIZ, c.arquivo)), c.arquivo);
    assert.deepEqual(tirarPassosDoPreparo(c.verificar, preparo).passos, preparo, c.arquivo);
  }
  const naFrente = medir.CLAIMS_REPRESENTATIVAS.filter((c) => c.verificar.startsWith(preparo[0] + ' && '));
  assert.equal(naFrente.length, 2, 'duas com o preparo na frente e uma com ele no meio');
});
