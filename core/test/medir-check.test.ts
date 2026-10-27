/**
 * RM-072 (D20, T11 da ork-check5x): a medicao do Agile Check e do Classic Check (`core/scripts/medir-check.cjs`). A
 * medicao em si e evidencia da thread; aqui ficam a leitura do `verify_run`, a regra das tres rodadas consecutivas, a
 * soma do pico (arvore de processos mais containers), a pasta sem sequencia hexadecimal e as claims representativas. Os
 * nomes comecam por "MCn:".
 */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
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
  pastaDasCopias: (cache: string, home?: string) => string;
  encerrarArvore: (raiz: number, sinal?: NodeJS.Signals) => number;
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

test('MC5: a copia nasce no cache do usuario, fora de pasta temporaria e sem sequencia hexadecimal de 8 (o id de um job)', () => {
  assert.equal(medir.pastaDasCopias('/srv/u/.cache', '/srv/u'), '/srv/u/.cache/orkastery/medir-check');
  assert.equal(medir.pastaDasCopias('/var/lib/jobs/a1b2c3d4/cache', '/srv/u'), '/srv/u/.cache/orkastery/medir-check');
  assert.ok(!medir.pastaDasCopias('/srv/u/.cache', '/srv/u').startsWith('/tmp'));
});

test('MC6: as claims representativas existem no repositorio: duas com o preparo na frente (reaproveitado) e uma com o build no meio (inteira)', () => {
  const preparo = passosDoComando('npm --prefix core run build && npm --prefix core run build:test');
  assert.equal(medir.CLAIMS_REPRESENTATIVAS.length, 3);
  for (const c of medir.CLAIMS_REPRESENTATIVAS) assert.ok(fs.existsSync(path.join(RAIZ, c.arquivo)), c.arquivo);
  const tirados = medir.CLAIMS_REPRESENTATIVAS.map((c) => tirarPassosDoPreparo(c.verificar, preparo).passos);
  assert.equal(tirados.filter((p) => p.length === preparo.length).length, 2, 'duas reaproveitam o preparo');
  assert.equal(tirados.filter((p) => p.length === 0).length, 1, 'a do build no meio roda inteira (A1 do CHECK)');
});

test('MC7: a rodada reprovada guarda o porque (teste que caiu, trecho, falha sem baseline e o resumo da barreira), para ser lida depois da copia', () => {
  const linha = JSON.stringify({ tipo: 'verify_run', veredito: 'reprovado', motivos: ['verify.failed'], check: { modo: 'agile', origem: 'opcao' },
    duracaoMs: 800000, falhasSemBaseline: ['test'], regressoes: [],
    dadoPrivado: { policy: 'block', achados: 0, padroes: [], onde: [] },
    comandos: [{ nome: 'test', ok: false, causa: 'exit', duracaoMs: 700000, testeQueCaiu: Array.from({ length: 12 }, (_, i) => `t${i}`), trecho: 'x'.repeat(900) }],
    claims: [{ id: 'C2', verificado: false, motivo: 'claims.failed', duracaoMs: 10 }] });
  const [r] = medir.lerRodadas(linha) as unknown as Array<Rodada & { falhasSemBaseline?: string[]; regressoes?: string[]; dadoPrivado?: unknown }>;
  const test = r.comandos[0] as Rodada['comandos'][number] & { causa: string; testeQueCaiu: string[]; trecho: string };
  assert.equal(test.causa, 'exit');
  assert.equal(test.testeQueCaiu.length, 10);
  assert.equal(test.trecho.length, 600);
  assert.deepEqual(r.falhasSemBaseline, ['test']);
  assert.equal(r.regressoes, undefined, 'lista vazia nao entra');
  assert.deepEqual(r.dadoPrivado, { policy: 'block', achados: 0, padroes: [], onde: [] });
  assert.deepEqual(r.claims, [{ id: 'C2', duracaoMs: 10, verificado: false, motivo: 'claims.failed' }]);
});

test('MC8: a parada encerra o processo e os descendentes dele, como o verify e as lanes em grupo proprio', async () => {
  const filho = spawn(process.execPath, ['-e', "const n = require('child_process').spawn('sleep', ['30'], { stdio: 'ignore' }); " +
    "console.log(n.pid); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'pipe', 'ignore'] });
  const neto = await new Promise<number>((ok) => filho.stdout!.once('data', (d) => ok(Number(String(d).trim()))));
  const vivo = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.ok(vivo(filho.pid!) && vivo(neto));
  assert.ok(medir.encerrarArvore(filho.pid!) >= 2);
  await new Promise((ok) => filho.once('exit', ok));
  for (let i = 0; i < 100 && vivo(neto); i++) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(vivo(neto), false, 'o neto tambem recebeu o sinal');
});
