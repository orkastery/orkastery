/**
 * RM-072 (D20, T11 da ork-check5x): a medicao do Agile Check e do Classic Check (`core/scripts/medir-check.cjs`). A
 * medicao em si e evidencia da thread; aqui ficam a leitura do `verify_run`, a regra das tres rodadas consecutivas, a
 * soma do pico (arvore de processos mais containers), a pasta sem sequencia hexadecimal e as claims representativas. Os
 * nomes comecam por "MCn:". RM-074 (M0): de MC9 em diante, as contas da bancada (a razao, a eficiencia de paralelismo, o
 * corte de CPU, a variacao, o roubo de CPU, a espera por carga quieta e as sondas 1 a 5) com numeros sinteticos.
 */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
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
  MIN_PARES_CONFIAVEIS: number;
  DESEQUILIBRIO_CPU_MAX_PP: number;
  CV_RAZAO_AJUSTADA_MAX: number;
  ordemDosPares: (total: number) => string[][];
  paredeSemPreparo: (rodada: unknown) => number | null;
  correcaoDaRodada: (rodada: unknown) => Record<string, any>;
  validarPar: (agile: unknown, classic: unknown, ordem: string[], esperada: string[], desequilibrioCpuMaxPp?: number) => Record<string, any>;
  lerPressaoCpu: (texto: string) => number | null;
  conferirExclusividadeDaPressao: (raiz: number,
    tabela: Map<number, { ppid: number; cgroup: string }>, containers: Array<Record<string, any>>, cgroup: string) => string | null;
  validarOpcoesDaBancada: (opcoes: { pares: number }) => void;
  razao: (classicMs: unknown, agileMs: unknown) => number | null;
  eficiencia: (cpuMs: unknown, nucleos: number, paredeMs: unknown) => number | null;
  corte: (cpuMs: unknown, baseMs: unknown) => number | null;
  variacao: (valores: unknown[]) => { n: number; min: number; max: number; media: number; desvio: number; cv: number | null; amplitude: number | null } | null;
  quantil: (valores: number[], q: number) => number | null;
  lerCpuStat: (texto: string) => { total: number; steal: number } | null;
  stealPct: (antes: { total: number; steal: number } | null, depois: { total: number; steal: number } | null) => number | null;
  quieta: (amostras: Array<{ t: number; carga: number; outros: number }>, limite: number, janelaMs: number) => boolean;
  eSuite: (args: string[]) => boolean;
  lerTempo: (texto: string) => { paredeMs: number; userMs: number; sysMs: number; picoKb: number } | null;
  contarTap: (texto: string) => Record<string, number>;
  concentracao: (duracoes: Record<string, number>, lanes?: Record<string, string[]>) => Record<string, any> | null;
  custoDosMaiores: (porArquivo: Record<string, Record<string, number | null>>, concorrente?: Record<string, number>, n?: number) => Record<string, any> | null;
  claimsQueRepetem: (comandos: string[], arquivos: string[]) => { total: number; comNodeTest: number; repetemALane: number; comBuild: number };
  pesoNaRodada: (rodada: unknown) => Record<string, any> | null;
  selecionarPorDiff: (fechos: Record<string, Set<string>>, sobe: string[], alterados: string[]) => { estatico: string[]; conservador: string[] };
  sondaDoGrafo: (fechos: Record<string, Set<string>>, sobe: string[], diffs: string[][], duracoes: Record<string, number>, janelas?: number[]) => Record<string, any>;
  pecasEmFallback: (rodada: unknown) => { total: number; fallback: string[] };
  redigir: (valor: unknown, trocas: Array<[string, string]>) => any;
  comandosDeClaims: (texto: string) => string[];
  fechosDeRequire: (distTest: string) => { fechos: Record<string, Set<string>>; sobeProcesso: string[] };
  analisarBancada: (dados: Record<string, unknown>) => Record<string, any>;
  jsonRaso: (valor: unknown, nivel?: number) => string;
  resumirCargaExterna: (amostras: Array<Array<{ chave: string; nome: string; cpuMs: number }>>, paredeMs: number, cpus: number) =>
    { cpuMs: number; pct: number | null; processos: Array<{ nome: string; cpuMs: number }>; amostras: number };
  resumirCpuDosContainers: (amostras: Array<Array<{ id: string; parte: 'integracao' | 'varredura' | 'fora'; daRodada?: boolean; cpuMs: number | null }>>) =>
    { integracaoMs: number; varreduraMs: number; rodadaMs: number; foraMs: number; foraPresentes: boolean;
      proporcaoMensuravel: boolean; fontesSemMedida: { rodada: boolean; fora: boolean } };
  processosExternos: (tabela: Map<number, { ppid: number; rss: number; cpuMs: number; inicio: string; nome: string; cgroup: string }>,
    containers: Array<{ id: string; pid: number }>) => Array<{ chave: string; nome: string; cpuMs: number }>;
  classificarProcessos: (tabela: Map<number, { ppid: number; rss: number; cpuMs: number; inicio: string; nome: string; cgroup: string }>,
    containers: Array<{ id: string; pid: number }>) => { externos: Array<{ chave: string; nome: string; cpuMs: number }>;
      infraestrutura: Array<{ chave: string; nome: string; cpuMs: number }> };
  atribuirCpuDaInfraestrutura: (amostras: Array<Array<{ chave: string; nome: string; cpuMs: number }>>,
    containers: ReturnType<typeof medir.resumirCpuDosContainers>, paredeMs: number, cpus: number) => Record<string, any>;
  cargaExternaComInfraestrutura: (carga: ReturnType<typeof medir.resumirCargaExterna>, infraestrutura: Record<string, any>,
    paredeMs: number, cpus: number) => ReturnType<typeof medir.resumirCargaExterna>;
};

const perto = (atual: number | null | undefined, esperado: number, msg?: string): void => {
  assert.ok(typeof atual === 'number' && Math.abs(atual - esperado) < 1e-9, `${msg ?? ''} esperava ${esperado}, veio ${atual}`);
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

test('MC9: a razao e a parede do Classic sobre a do Agile no mesmo commit; sem numero positivo nos dois, nao ha razao', () => {
  perto(medir.razao(900000, 300000), 3, 'o Agile tres vezes mais rapido');
  perto(medir.razao(600000, 400000), 1.5);
  assert.equal(medir.razao(600000, 0), null);
  assert.equal(medir.razao(null, 300000), null);
  assert.equal(medir.razao(600000, undefined), null);
});

test('MC10: a eficiencia de paralelismo e a CPU dividida pelos nucleos, contra a parede; o corte e a CPU que saiu contra a base', () => {
  perto(medir.eficiencia(8 * 60000, 8, 60000), 1, 'oito nucleos ocupados a parede inteira');
  perto(medir.eficiencia(4 * 60000 * 0.65 * 2, 8, 60000), 0.65);
  perto(medir.eficiencia(120000, 8, 60000), 0.25, 'a lane de integracao, dois arquivos por vez, fica baixa');
  assert.equal(medir.eficiencia(0, 8, 60000), null);
  assert.equal(medir.eficiencia(1000, 0, 60000), null);
  assert.equal(medir.eficiencia(1000, 8, 0), null);
  perto(medir.corte(51, 100), 0.49, 'o corte de 49% da aritmetica do piso');
  perto(medir.corte(100, 100), 0);
  perto(medir.corte(110, 100), -0.1, 'mais CPU que a base e corte negativo');
  assert.equal(medir.corte(50, 0), null);
  assert.equal(medir.corte(null, 100), null);
});

test('MC11: a variacao entre rodadas traz a media, o desvio amostral, o coeficiente e a amplitude; o que nao e numero sai', () => {
  const v = medir.variacao([1.4, 1.5, 1.6, null, Number.NaN, 'x'])!;
  assert.equal(v.n, 3);
  perto(v.min, 1.4);
  perto(v.max, 1.6);
  perto(v.media, 1.5);
  perto(v.desvio, 0.1);
  perto(v.cv, 0.1 / 1.5);
  perto(v.amplitude, 0.2 / 1.5);
  assert.deepEqual(medir.variacao([7]), { n: 1, min: 7, max: 7, media: 7, desvio: 0, cv: 0, amplitude: 0 });
  assert.equal(medir.variacao([]), null);
  perto(medir.quantil([4, 1, 3, 2], 0.5), 2.5);
  perto(medir.quantil([1, 2, 3, 4, 5], 0.75), 4);
  assert.equal(medir.quantil([], 0.5), null);
});

test('MC12: o roubo de CPU sai do /proc/stat: o steal do intervalo sobre o total das oito colunas', () => {
  const antes = medir.lerCpuStat('cpu  100 0 100 700 0 0 0 100 0 0\ncpu0 1 2 3 4 5 6 7 8 0 0\n');
  assert.deepEqual(antes, { total: 1000, steal: 100 });
  const depois = medir.lerCpuStat('cpu  200 0 200 1300 0 0 0 300 50 0\n');
  assert.deepEqual(depois, { total: 2000, steal: 300 }, 'o guest ja esta no user e nao entra no total');
  perto(medir.stealPct(antes, depois), 20);
  assert.equal(medir.stealPct(antes, antes), null, 'sem intervalo');
  assert.equal(medir.stealPct(null, depois), null);
  assert.equal(medir.lerCpuStat('intr 1 2 3\n'), null);
});

test('MC13: a maquina esta quieta com a carga de 1 minuto abaixo do limite e sem outra suite durante a janela inteira', () => {
  const s = (t: number, carga: number, outros = 0) => ({ t: t * 1000, carga, outros });
  assert.equal(medir.quieta([s(0, 1), s(60, 1.5), s(120, 1.9)], 2, 120000), true);
  assert.equal(medir.quieta([s(0, 1), s(60, 1.5), s(115, 1.9)], 2, 120000), false, 'janela ainda curta');
  assert.equal(medir.quieta([s(0, 1), s(60, 2), s(120, 1), s(180, 1)], 2, 120000), false, 'a carga de 2 reinicia a janela');
  assert.equal(medir.quieta([s(0, 1), s(60, 2), s(120, 1), s(240, 1)], 2, 120000), true);
  assert.equal(medir.quieta([s(0, 0.5), s(60, 0.5, 1), s(120, 0.5), s(200, 0.5)], 2, 120000), false, 'outra suite reinicia a janela');
  assert.equal(medir.eSuite(['/usr/bin/node', '/x/core/dist/index.js', 'verify', 'ork-a', '--check', 'agile']), true);
  assert.equal(medir.eSuite(['node', '/home/x/.local/bin/ork', 'verify', 't']), true);
  assert.equal(medir.eSuite(['ork', 'verify', 't']), true);
  assert.equal(medir.eSuite(['/usr/bin/node', '--test', '--test-reporter=tap', 'dist-test/test/a.test.js']), true);
  assert.equal(medir.eSuite(['node', 'scripts/test-lanes.cjs', 'hermetica']), true);
  assert.equal(medir.eSuite(['node', 'core/scripts/medir-check.cjs', '--bancada']), false);
  assert.equal(medir.eSuite(['bash', '-c', 'echo verify --test']), false);
  assert.equal(medir.eSuite(['git', 'verify-commit', 'x']), false);
  assert.equal(medir.eSuite([]), false);
});

test('MC14: o /usr/bin/time e o rodape do TAP viram parede, CPU, pico e contagem de testes', () => {
  assert.deepEqual(medir.lerTempo('12.34 10.50 1.25 153600\n'), { paredeMs: 12340, userMs: 10500, sysMs: 1250, picoKb: 153600 });
  assert.deepEqual(medir.lerTempo('Command exited with non-zero status 1\n3.00 2.00 0.50 1000\n'),
    { paredeMs: 3000, userMs: 2000, sysMs: 500, picoKb: 1000 }, 'a saida diferente de zero vem antes');
  assert.equal(medir.lerTempo('Command terminated by signal 9\n'), null);
  assert.equal(medir.lerTempo(''), null);
  assert.deepEqual(medir.contarTap('ok 1 - a\n# tests 9\n# suites 0\n# pass 8\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 5\n'),
    { tests: 9, suites: 0, pass: 8, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual(medir.contarTap('not tap'), {});
});

test('MC15: sonda 1, a concentracao da parede por arquivo: os mais caros, a parte de cada lane, o orcamento e a cauda', () => {
  const duracoes: Record<string, number> = { 'a.test.js': 500, 'b.test.js': 200, 'c.test.js': 150, 'd.test.js': 100, 'e.test.js': 49 };
  for (let i = 0; i < 10; i++) duracoes[`z${i}.test.js`] = 0.1;
  const c = medir.concentracao(duracoes, { hermetica: Object.keys(duracoes).filter((a) => a !== 'b.test.js'), integracao: ['b.test.js'] })!;
  assert.equal(c.arquivos, 15);
  perto(c.porLane.integracao, 0.2);
  perto(c.porLane.hermetica, 0.8);
  perto(c.topo[5], 0.999);
  perto(c.topo[100], 1);
  assert.equal(c.maiores[0].arquivo, 'a.test.js');
  perto(c.maiores[0].parte, 0.5);
  assert.deepEqual(c.acimaDoOrcamento.map((x: { arquivo: string }) => x.arquivo), ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js', 'e.test.js']);
  assert.equal(c.acimaDaMeta, 5);
  assert.equal(c.comPeloMenos022, 5);
  assert.equal(c.abaixoDe0022, 10, '0,1 em 1000 e 0,01% da soma');
  assert.equal(medir.concentracao({}), null);
});

test('MC16: sonda 2, os maiores da sonda 1: CPU da suite, sistema, CPU por parede e sozinho contra concorrente', () => {
  const m = (userMs: number, sysMs: number, paredeMs: number, testes: number) => ({ userMs, sysMs, paredeMs, testes, picoKb: 1000 });
  const nomes = [...'abcdefghijkl'];
  const medidas: Record<string, Record<string, number | null>> = Object.fromEntries(
    nomes.map((nome, i) => [`${nome}.test.js`, m(300 - i * 10, 20 + i, 200 + i * 10, i + 1)]));
  const concorrente: Record<string, number> = Object.fromEntries(nomes.map((nome, i) => [`${nome}.test.js`, (i + 1) * 100]));
  medidas['z-invalido.test.js'] = { userMs: null, sysMs: null, paredeMs: 5, testes: 1, picoKb: null };
  concorrente['z-invalido.test.js'] = 10_000;
  const c = medir.custoDosMaiores(medidas, concorrente)!;
  assert.deepEqual(c.arquivos.map((x: { arquivo: string }) => x.arquivo),
    ['l.test.js', 'k.test.js', 'j.test.js', 'i.test.js', 'h.test.js', 'g.test.js', 'f.test.js', 'e.test.js', 'd.test.js', 'c.test.js'],
    'o padrão escolhe exatamente dez pela parede concorrente, em ordem; CPU inversa e medição inválida não mudam o conjunto');
  assert.equal(c.arquivos.length, 10);
  perto(c.arquivos[0].parteDaCpu, 221 / 3246);
  assert.equal(c.arquivos[0].cpuMs, 221);
  assert.equal(c.arquivos[0].sistemaMs, 31);
  perto(c.arquivos[0].parteDoSistema, 31 / 221);
  perto(c.arquivos[0].cpuPorParede, 221 / 310);
  perto(c.arquivos[0].sozinhoContraConcorrente, 310 / 1200);
  assert.equal(c.soma.testes, 75);
  perto(c.soma.parteDosTestes, 75 / 78, 'a medição inválida fica fora das duas somas');
  perto(c.soma.parteDaCpu, 2615 / 3246);
});

test('MC17: sonda 3, as claims que repetem a lane e o peso das claims, das lanes e da varredura na parede da rodada', () => {
  const r = medir.claimsQueRepetem([
    'npm --prefix core run build && node --test core/dist-test/test/a.test.js',
    "node --test-reporter=tap core/dist-test/test/b.test.js | awk '{p++}'",
    'node --test core/dist-test/test/fora.test.js',
    'grep -q x docs/a.md',
  ], ['a.test.js', 'b.test.js']);
  assert.deepEqual(r, { total: 4, comNodeTest: 3, repetemALane: 2, comBuild: 1 }, 'o node com o arquivo .test.js roda os casos sem --test');
  assert.equal(medir.claimsQueRepetem(['echo dist-test/test/a.test.js', 'node core/dist/index.js verify t'], ['a.test.js']).comNodeTest, 0);
  assert.equal(medir.claimsQueRepetem(medir.CLAIMS_REPRESENTATIVAS.map((c) => c.verificar), ['verify.test.js', 'rm044-paridade-cli-md.test.js']).repetemALane, 2);
  const peso = medir.pesoNaRodada({ duracaoMs: 1000, preparoMs: 50, claims: [{ duracaoMs: 300 }, { duracaoMs: 100 }, { duracaoMs: null }],
    comandos: [{ nome: 'security_scan', duracaoMs: 200 }, { nome: 'test', duracaoMs: 600, lanes: [{ lane: 'hermetica', duracaoMs: 600 }, { lane: 'integracao', duracaoMs: 250 }] }] })!;
  perto(peso.claims, 0.4);
  perto(peso.test, 0.6);
  perto(peso.lanes.integracao, 0.25);
  perto(peso.varredura, 0.2);
  perto(peso.preparo, 0.05);
  assert.equal(medir.pesoNaRodada({ duracaoMs: null, claims: [], comandos: [] }), null);
  const claims = [{ id: 'C1', verificar: ['a', 'b'] }, { id: 'C2', verificar: 'x' }, { id: 'C1', verificar: ['c'] }]
    .map((c) => JSON.stringify(c)).join('\n') + '\nquebrada\n';
  assert.deepEqual(medir.comandosDeClaims(claims), ['c', 'x'], 'o ultimo registro de cada id');
});

test('MC18: sonda 4, a selecao pelo grafo: estatica pelo fecho, conservadora com quem sobe processo se o diff toca core/src', () => {
  const fechos = { 'a.test.js': new Set(['core/test/a.test.ts', 'core/src/locale-x.ts', 'core/src/m.ts']),
    'b.test.js': new Set(['core/test/b.test.ts', 'core/src/m.ts']), 'c.test.js': new Set(['core/test/c.test.ts']),
    'd.test.js': new Set(['core/test/d.test.ts', 'core/src/n.ts']) };
  assert.deepEqual(medir.selecionarPorDiff(fechos, ['c.test.js'], ['core/src/m.ts']), { estatico: ['a.test.js', 'b.test.js'], conservador: ['a.test.js', 'b.test.js', 'c.test.js'] });
  assert.deepEqual(medir.selecionarPorDiff(fechos, ['c.test.js'], ['core/test/d.test.ts']), { estatico: ['d.test.js'], conservador: ['d.test.js'] }, 'so teste: sem o conservador');
  const g = medir.sondaDoGrafo(fechos, ['c.test.js', 'sumiu.test.js'], [['core/src/m.ts'], ['docs/x.md'], ['core/src/n.ts']],
    { 'a.test.js': 10, 'b.test.js': 20, 'c.test.js': 30, 'd.test.js': 40 }, [2, 60]);
  assert.equal(g.testes, 4);
  assert.equal(g.sobeProcesso, 1);
  assert.equal(g.modulosAlcancados, 3);
  assert.equal(g.modulosDaMaioria, 1, 'core/src/m.ts em 2 de 4');
  assert.equal(g.cadeiaLocale, 1);
  assert.deepEqual(g.janelas[2].estatico, { mediana: 1, min: 0, max: 2, tempoMediana: 0.15 });
  assert.equal(g.janelas[2].conservador.max, 3);
  perto(g.janelas[2].conservador.tempoMediana, 0.3);
  assert.equal(g.janelas[60].commits, 3);
  perto(g.janelas[60].conservador.tempoTerceiroQuartil, 0.65);
});

test('MC19: sonda 4, o fecho de require segue os relativos ate a fonte e marca o teste que sobe processo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-fecho-'));
  try {
    fs.mkdirSync(path.join(dir, 'test'));
    fs.mkdirSync(path.join(dir, 'src', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), 'require("../src/m"); require("node:fs"); require("./apoio");');
    fs.writeFileSync(path.join(dir, 'test', 'apoio.js'), 'require("../src/sub");');
    fs.writeFileSync(path.join(dir, 'test', 'b.test.js'), "const c = require('child_process'); c.spawnSync('x');");
    fs.writeFileSync(path.join(dir, 'src', 'm.js'), 'require("./m");');
    fs.writeFileSync(path.join(dir, 'src', 'sub', 'index.js'), 'require("../../../fora");');
    const r = medir.fechosDeRequire(dir);
    assert.deepEqual([...r.fechos['a.test.js']].sort(), ['core/src/m.ts', 'core/src/sub/index.ts', 'core/test/a.test.ts', 'core/test/apoio.ts']);
    assert.deepEqual([...r.fechos['b.test.js']], ['core/test/b.test.ts']);
    assert.deepEqual(r.sobeProcesso, ['b.test.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MC20: sonda 5 e a redacao: as pecas em fallback de uma rodada; a casa, a maquina e a copia saem de todo texto', () => {
  assert.deepEqual(medir.pecasEmFallback({ pecas: [{ peca: 'tsgo', estado: 'fallback', motivo: 'ausente', fallback: 'tsc' },
    { peca: 'cache-semgrep', estado: 'agile' }, null] }),
  { total: 3, fallback: ['tsgo'], detalhes: [{ peca: 'tsgo', motivo: 'ausente', fallback: 'tsc' }] });
  assert.deepEqual(medir.pecasEmFallback(null), { total: 0, fallback: [], detalhes: [] });
  const r = medir.redigir({ trecho: '/srv/u/.cache/x/projeto/core: falhou em vm-1', lista: ['/srv/u/a', 3], '/srv/u': true },
    [['/srv/u', '~'], ['/srv/u/.cache/x/projeto', '<copia>'], ['vm-1', '<maquina>'], ['', 'nada'], [undefined as unknown as string, 'x']]);
  assert.deepEqual(r, { trecho: '<copia>/core: falhou em <maquina>', lista: ['~/a', 3], '~': true }, 'o trecho mais longo troca primeiro');
});

test('MC21: a bancada inteira com tres pares ABBA validos: razao sem preparo, CPU com steal, eficiencia, corte e lista por lane', () => {
  const lanes = { hermetica: ['a.test.js', 'b.test.js'], integracao: ['c.test.js'] };
  const verifyRun = (modo: string, duracaoMs: number, lanesMs: Record<string, number> | null, steal: number) => ({
    pedido: modo, ok: true, duracaoMs, stealPct: steal, cpuDaArvoreMs: duracaoMs * 2, picoBytes: modo === 'agile' ? 1200 : 1000, preparoMs: 10,
    cargaExterna: { pct: 1, cpuMs: 20, processos: [{ nome: 'antivirus', cpuMs: 20 }] },
    contencaoCpu: { estado: 'indisponivel', fonte: 'cgroup-v2-cpu.pressure.full', motivo: 'cgroup-nao-exclusivo',
      atrasoTotalMs: null, janelaMs: duracaoMs },
    claims: [{ id: 'C1', duracaoMs: 100 }], pecas: modo === 'agile' ? [{ peca: 'tsgo', estado: 'fallback' }] : [],
    comandos: [{ nome: 'test', ok: true, duracaoMs: lanesMs ? Math.max(...Object.values(lanesMs)) : duracaoMs / 2,
      ...(lanesMs ? { lanes: Object.entries(lanesMs).map(([lane, ms]) => ({ lane, duracaoMs: ms })) } : {}) }],
    duracoesPorArquivo: modo === 'agile' ? { 'a.test.js': 60, 'b.test.js': 30, 'c.test.js': 10 } : undefined });
  const rodadas = [
    { par: 1, temperatura: 'frio', ...verifyRun('agile', 1010, { hermetica: 500, integracao: 200 }, 10) },
    { par: 1, temperatura: 'morno', ...verifyRun('agile', 1010, { hermetica: 500, integracao: 200 }, 11) },
    { par: 1, ...verifyRun('classic', 2010, null, 12) },
    { par: 2, ...verifyRun('classic', 2510, null, 9) },
    { par: 2, temperatura: 'frio', ...verifyRun('agile', 1260, { hermetica: 625, integracao: 250 }, 8) },
    { par: 2, temperatura: 'morno', ...verifyRun('agile', 1260, { hermetica: 625, integracao: 250 }, 8.5) },
    { par: 3, temperatura: 'frio', ...verifyRun('agile', 1010, { hermetica: 500, integracao: 200 }, 5) },
    { par: 3, temperatura: 'morno', ...verifyRun('agile', 1010, { hermetica: 500, integracao: 200 }, 5.5) },
    { par: 3, ...verifyRun('classic', 2010, null, 6) },
  ];
  const medidas = (fator: number) => ({ 'a.test.js': { userMs: 2000 * fator, sysMs: 1000 * fator, paredeMs: 30, picoKb: 1, testes: 3, saida: 0 },
    'b.test.js': { userMs: 600 * fator, sysMs: 400 * fator, paredeMs: 10, picoKb: 1, testes: 2, saida: 0 },
    'c.test.js': { userMs: 400 * fator, sysMs: 400 * fator, paredeMs: 5, picoKb: 1, testes: 1, saida: 1 } });
  const passes = [{ passe: 1, stealPct: 11, medidas: medidas(1) }, { passe: 2, stealPct: 9, medidas: medidas(1.2) },
    { passe: 3, stealPct: 5.5, medidas: medidas(0.8) }];
  const b = medir.analisarBancada({ rodadas, passes, lanes, nucleos: 2 });
  assert.equal(b.confianca.fria.estado, 'com-confianca');
  assert.equal(b.confianca.morna.estado, 'com-confianca');
  assert.equal(b.confianca.fria.paresValidos, 3);
  assert.equal(b.confianca.fria.desequilibrioCpuMaxPp, 5);
  assert.equal(b.confianca.fria.cvRazaoAjustadaMax, 0.1);
  assert.ok(b.confianca.fria.cvRazaoAjustada < 0.1);
  perto(b.pares[0].razaoBruta, 2);
  perto(b.pares[0].razaoAjustada, 2);
  perto(b.pares[0].razao, b.pares[0].razaoAjustada, 'a razao oficial e a ajustada');
  perto(b.pares[1].razao, 2);
  perto(b.pares[2].razao, 2);
  perto(b.pares[0].morna.razao, 2);
  perto(b.variacao.razaoFria.media, b.variacao.razaoAjustadaFria.media);
  perto(b.variacao.razaoBrutaFria.media, 2);
  assert.deepEqual(b.pares.map((p: { ordem: string[] }) => p.ordem),
    [['agile', 'classic'], ['classic', 'agile'], ['agile', 'classic']]);
  assert.deepEqual(b.pares[0].preparoMs, { agile: 10, classic: 10 });
  assert.deepEqual(b.pares[0].paredesSemPreparoMs, { agile: 1000, classic: 2000 });
  assert.deepEqual(b.pares[0].paredesAjustadasMs, { agile: 1000, classic: 2000 });
  assert.deepEqual(b.pares[0].correcao, {
    agile: { stealPct: 10, cargaExternaPct: 1, estado: 'sem-credito', fonte: 'cgroup-v2-cpu.pressure.full',
      motivo: 'cgroup-nao-exclusivo', atrasoTotalMs: null, janelaMs: null, janelaExcluidaMs: null,
      atrasoCausalMs: 0, atrasoCausalPct: 0, paredeAjustadaMs: 1000 },
    classic: { stealPct: 12, cargaExternaPct: 1, estado: 'sem-credito', fonte: 'cgroup-v2-cpu.pressure.full',
      motivo: 'cgroup-nao-exclusivo', atrasoTotalMs: null, janelaMs: null, janelaExcluidaMs: null,
      atrasoCausalMs: 0, atrasoCausalPct: 0, paredeAjustadaMs: 2000 },
    desequilibrioCpuMaxPp: 5,
  });
  assert.deepEqual(b.pares[0].cpuDaArvore, { agile: { ms: 2020, stealPct: 10 }, classic: { ms: 4020, stealPct: 12 } });
  perto(b.pares[0].eficiencia.hermetica, 4000 / 2 / 500);
  perto(b.pares[0].eficiencia.integracao, 800 / 2 / 200);
  perto(b.pares[1].eficiencia.hermetica, 4800 / 2 / 625, 'o par 2 usa a CPU do passe 2');
  perto(b.pares[0].eficiencia.suiteNoAgile, 4800 / 2 / 500);
  perto(b.pares[0].eficiencia.suiteNoClassic, 4800 / 2 / 1005);
  perto(b.pares[0].picoAgileSobreClassic, 1.2);
  assert.deepEqual(b.lanes.hermetica, { arquivos: 2, testes: 5, lista: lanes.hermetica });
  assert.equal(b.lanes.integracao.testes, 1);
  assert.equal(b.corte.base, 'media desta medicao');
  perto(b.corte.baseMs, 4800);
  perto(b.corte.porPasse[0].corte, 0);
  assert.equal(b.cpuDaSuite.porPasse[0].stealPct, 11, 'CPU da suite vem com o steal do passe');
  assert.deepEqual(b.cpuDaSuite.arquivosComFalha, ['c.test.js']);
  perto(b.variacao.stealPct.max, 12);
  assert.deepEqual(b.sondas[5].map((s: { fallback: string[] }) => s.fallback), [['tsgo'], ['tsgo'], ['tsgo']]);
  perto(b.sondas[1][0].porLane.integracao, 0.1);
  perto(b.sondas[2][0].arquivos[0].sozinhoContraConcorrente, 0.5);
  perto(b.sondas[3].peso[0].claims, 100 / 1010);
  assert.deepEqual(b.porArquivo[2], { arquivo: 'c.test.js', lane: 'integracao', testes: 1,
    passes: [medidas(1)['c.test.js'], medidas(1.2)['c.test.js'], medidas(0.8)['c.test.js']], concorrenteMs: [10, 10, 10] });
  assert.ok(!('duracoesPorArquivo' in b.rodadas[0]), 'a parede por arquivo vai so na tabela por arquivo');
  const comBase = medir.analisarBancada({ rodadas, passes, lanes, nucleos: 2, linhaDeBase: { cpuDaSuite: { variacao: { media: 9600 } } } });
  assert.equal(comBase.corte.base, 'linha de base');
  perto(comBase.corte.porPasse[0].corte, 0.5);
});

test('MC23: so o atraso causal corrige a parede; carga ociosa e fonte indisponivel nao recebem credito', () => {
  assert.equal(medir.MIN_PARES_CONFIAVEIS, 3);
  assert.equal(medir.DESEQUILIBRIO_CPU_MAX_PP, 5);
  assert.equal(medir.CV_RAZAO_AJUSTADA_MAX, 0.1);
  assert.deepEqual(medir.ordemDosPares(4), [
    ['agile', 'classic'], ['classic', 'agile'], ['agile', 'classic'], ['classic', 'agile'],
  ]);
  assert.equal(medir.paredeSemPreparo({ duracaoMs: 110, preparoMs: 10 }), 100);
  assert.equal(medir.paredeSemPreparo({ duracaoMs: 110, preparoMs: null }), null);
  const rodada = (parede: number, carga: number, atrasoPct: number | null, estado = atrasoPct === null ? 'indisponivel' : 'medida') => ({
    ok: true, duracaoMs: parede + 10, preparoMs: 10, stealPct: 2, cargaExterna: { pct: carga, cpuMs: carga, processos: [] },
    contencaoCpu: { estado, fonte: 'cgroup-v2-cpu.pressure.full', motivo: estado === 'medida' ? null : 'cgroup-nao-exclusivo',
      atrasoTotalMs: atrasoPct === null ? 50 : parede * atrasoPct / 100 + 10, janelaMs: parede + 10 },
  });

  const contraexemplo = medir.validarPar(rodada(100, 0, null), rodada(110, 20, null),
    ['agile', 'classic'], ['agile', 'classic']);
  perto(contraexemplo.razaoBruta, 1.1);
  perto(contraexemplo.razaoAjustada, 1.1, 'carga agregada sem atraso causal nao troca o vencedor');
  assert.deepEqual(contraexemplo.motivos, ['carga-de-fora-desequilibrada']);
  assert.equal(contraexemplo.correcao.classic.estado, 'sem-credito');
  assert.equal(contraexemplo.correcao.classic.motivo, 'cgroup-nao-exclusivo');
  assert.equal(contraexemplo.correcao.classic.atrasoCausalMs, 0);

  const ociosa = medir.validarPar(rodada(100, 0, null), rodada(110, 4, null),
    ['agile', 'classic'], ['agile', 'classic']);
  assert.equal(ociosa.valido, true);
  perto(ociosa.razaoAjustada, 1.1, 'CPU de fora em capacidade ociosa nao cria vantagem');

  const atrasoIgual = medir.validarPar(rodada(100, 1, 10), rodada(200, 1, 10),
    ['agile', 'classic'], ['agile', 'classic']);
  perto(atrasoIgual.razaoBruta, 2);
  perto(atrasoIgual.razaoAjustada, 2, 'a mesma fracao causal nos dois modos conserva a razao');
  assert.deepEqual(atrasoIgual.paredesAjustadasMs, { agile: 90, classic: 180 });

  const atrasoClassic = medir.validarPar(rodada(100, 1, 0), rodada(110, 1, 10),
    ['agile', 'classic'], ['agile', 'classic']);
  perto(atrasoClassic.razaoAjustada, 0.99, 'o atraso medido so no Classic corrige somente o Classic');
  assert.equal(atrasoClassic.correcao.agile.atrasoCausalMs, 0);
  perto(atrasoClassic.correcao.classic.atrasoCausalMs, 11);

  const estrutural = { ...rodada(100, 1, null), ok: false, preparoMs: null, stealPct: null };
  assert.deepEqual(medir.validarPar(estrutural, rodada(100, 1, null), ['classic', 'agile'], ['agile', 'classic']).motivos,
    ['rodada-reprovada', 'preparo-ou-parede-ausente', 'ordem-nao-ABBA', 'steal-ausente']);
  assert.throws(() => medir.validarOpcoesDaBancada({ pares: 2 }), /exige pelo menos 3 pares/);
  assert.doesNotThrow(() => medir.validarOpcoesDaBancada({ pares: 3 }));
});

test('MC24: a coleta escolhe PSI full exclusivo e a carga agregada so valida a diferenca entre as rodadas', () => {
  assert.equal(medir.lerPressaoCpu('some avg10=1.00 total=9000\nfull avg10=0.10 total=1000\n'), 1000,
    'PSI some inclui disputa propria e nunca vira credito');
  assert.equal(medir.lerPressaoCpu('some avg10=1.00 total=9000\n'), null);
  const exclusivos = new Map([
    [900001, { ppid: 1, cgroup: '0::/medida' }],
    [900002, { ppid: 900001, cgroup: '0::/medida/filhos' }],
  ]);
  assert.equal(medir.conferirExclusividadeDaPressao(900001, exclusivos, [], '/sys/fs/cgroup/medida'), null);
  const compartilhado = new Map(exclusivos);
  compartilhado.set(900003, { ppid: 1, cgroup: '0::/medida' });
  assert.equal(medir.conferirExclusividadeDaPressao(900001, compartilhado, [], '/sys/fs/cgroup/medida'), 'cgroup-nao-exclusivo');
  const carga = medir.resumirCargaExterna([
    [{ chave: '1:a', nome: 'antivirus', cpuMs: 100 }, { chave: '2:b', nome: 'indexador', cpuMs: 20 }],
    [{ chave: '1:a', nome: 'antivirus', cpuMs: 260 }, { chave: '3:c', nome: 'curto', cpuMs: 40 }],
  ], 1000, 2);
  assert.deepEqual(carga.processos, [{ nome: 'antivirus', cpuMs: 160 }, { nome: 'curto', cpuMs: 40 }]);
  assert.equal(carga.cpuMs, 200);
  perto(carga.pct, 10);
  assert.deepEqual(medir.resumirCpuDosContainers([
    [{ id: 'scan', parte: 'varredura', cpuMs: 100 }, { id: 'int', parte: 'integracao', cpuMs: 40 }],
    [{ id: 'scan', parte: 'varredura', cpuMs: 260 }, { id: 'int', parte: 'integracao', cpuMs: 100 },
      { id: 'novo', parte: 'varredura', cpuMs: 30 }],
  ]), { integracaoMs: 60, varreduraMs: 190, rodadaMs: 250, foraMs: 0, foraPresentes: false,
    proporcaoMensuravel: true, fontesSemMedida: { rodada: false, fora: false } },
  'contêiner preexistente perde a baseline; o que nasceu na rodada entra inteiro');
  const processos = new Map([
    [900001, { ppid: 1, rss: 1, cpuMs: 90, inicio: 'a', nome: 'semgrep-core', cgroup: '/docker/abc' }],
    [900002, { ppid: 1, rss: 1, cpuMs: 20, inicio: 'b', nome: 'antivirus', cgroup: '/system.slice/fora' }],
    [900003, { ppid: 1, rss: 1, cpuMs: 70, inicio: 'c', nome: 'dockerd', cgroup: '/system.slice/docker.service' }],
    [900004, { ppid: 1, rss: 1, cpuMs: 30, inicio: 'd', nome: 'containerd-shim-runc-v2', cgroup: '/system.slice/containerd.service' }],
  ]);
  assert.deepEqual(medir.processosExternos(processos, [{ id: 'abc', pid: 0 }]),
    [{ chave: '900002:b', nome: 'antivirus', cpuMs: 20 }],
  'processo no cgroup de contêiner criado pela rodada não vira carga de fora');
  assert.deepEqual(medir.classificarProcessos(processos, [{ id: 'abc', pid: 0 }]).infraestrutura,
    [{ chave: '900003:c', nome: 'dockerd', cpuMs: 70 },
      { chave: '900004:d', nome: 'containerd-shim-runc-v2', cpuMs: 30 }], 'daemon e runtime têm linha própria');
  const amostrasInfra = [
    [{ chave: 'd:a', nome: 'dockerd', cpuMs: 100 }, { chave: 'c:b', nome: 'containerd', cpuMs: 20 }],
    [{ chave: 'd:a', nome: 'dockerd', cpuMs: 260 }, { chave: 'c:b', nome: 'containerd', cpuMs: 60 }],
  ];
  const semFora = medir.atribuirCpuDaInfraestrutura(amostrasInfra, medir.resumirCpuDosContainers([
    [{ id: 'scan', parte: 'varredura', cpuMs: 10 }], [{ id: 'scan', parte: 'varredura', cpuMs: 110 }],
  ]), 1000, 2);
  assert.deepEqual(semFora, { estado: 'integral', cpuMs: 200, rodadaMs: 200, cargaExternaMs: 0, proporcaoDaRodada: 1,
    processos: [{ nome: 'dockerd', cpuMs: 160 }, { nome: 'containerd', cpuMs: 40 }],
    cgroup: { rodadaMs: 100, foraMs: 0, foraPresentes: false, proporcaoMensuravel: true,
      fontesSemMedida: { rodada: false, fora: false } } });
  const comFora = medir.atribuirCpuDaInfraestrutura(amostrasInfra, medir.resumirCpuDosContainers([
    [{ id: 'scan', parte: 'varredura', cpuMs: 10 }, { id: 'alheio', parte: 'fora', daRodada: false, cpuMs: 20 }],
    [{ id: 'scan', parte: 'varredura', cpuMs: 160 }, { id: 'alheio', parte: 'fora', daRodada: false, cpuMs: 70 }],
  ]), 1000, 2);
  assert.equal(comFora.estado, 'proporcional');
  assert.equal(comFora.rodadaMs, 150);
  assert.equal(comFora.cargaExternaMs, 50);
  perto(comFora.proporcaoDaRodada, 0.75);
  const parcial = medir.atribuirCpuDaInfraestrutura(amostrasInfra, medir.resumirCpuDosContainers([
    [{ id: 'scan', parte: 'varredura', cpuMs: 10 }, { id: 'alheio', parte: 'fora', daRodada: false, cpuMs: null }],
    [{ id: 'scan', parte: 'varredura', cpuMs: 160 }, { id: 'alheio', parte: 'fora', daRodada: false, cpuMs: null }],
  ]), 1000, 2);
  assert.equal(parcial.estado, 'parcial');
  assert.equal(parcial.rodadaMs, 0);
  assert.equal(parcial.cargaExternaMs, 200, 'toda parte em dúvida vira carga de fora');
  assert.equal(parcial.proporcaoDaRodada, null);
  const externaComDuvida = medir.cargaExternaComInfraestrutura(carga, parcial, 1000, 2);
  assert.equal(externaComDuvida.cpuMs, 400);
  perto(externaComDuvida.pct, 20);
  assert.deepEqual(externaComDuvida.processos[0], { nome: 'infraestrutura-de-contêiner-não-atribuída', cpuMs: 200 });
  const rodada = (pct: number, stealPct: number) => ({ ok: true, duracaoMs: 110, preparoMs: 10, stealPct,
    cargaExterna: { pct, cpuMs: pct, processos: [{ nome: 'antivirus', cpuMs: pct }] },
    contencaoCpu: { estado: 'indisponivel', fonte: 'cgroup-v2-cpu.pressure.full', motivo: 'psi-cpu-indisponivel',
      atrasoTotalMs: 20, janelaMs: 110 } });
  const naFronteira = medir.validarPar(rodada(7, 6), rodada(2, 1), ['agile', 'classic'], ['agile', 'classic']);
  assert.equal(naFronteira.valido, true, 'cinco pontos percentuais ainda sao comparaveis');
  assert.deepEqual(naFronteira.motivos, []);
  assert.equal(naFronteira.correcao.agile.atrasoCausalMs, 0, 'medida indisponivel nao usa valor residual');
  const desequilibrado = medir.validarPar(rodada(7.01, 6.01), rodada(2, 1), ['agile', 'classic'], ['agile', 'classic']);
  assert.equal(desequilibrado.valido, false);
  assert.deepEqual(desequilibrado.motivos, ['steal-desequilibrado', 'carga-de-fora-desequilibrada']);
  assert.deepEqual(desequilibrado.cargaDeFora, { agilePct: 7.01, classicPct: 2, divergenciaPp: 5.01 });
  assert.equal(desequilibrado.correcao.desequilibrioCpuMaxPp, 5);
});

test('MC25: CV exatamente igual ao limite deixa a bancada sem confianca', () => {
  const rodada = (par: number, pedido: string, parede: number) => ({ par, pedido, ok: true, duracaoMs: parede + 10, preparoMs: 10,
    stealPct: 5, cargaExterna: { pct: 5, cpuMs: 1, processos: [] },
    contencaoCpu: { estado: 'indisponivel', fonte: 'cgroup-v2-cpu.pressure.full', motivo: 'psi-cpu-indisponivel' },
    cpuDaArvoreMs: 100, comandos: [], claims: [], pecas: [] });
  const rodadas = [
    rodada(1, 'agile', 100), rodada(1, 'classic', 900),
    rodada(2, 'classic', 1000), rodada(2, 'agile', 100),
    rodada(3, 'agile', 100), rodada(3, 'classic', 1100),
  ];
  const b = medir.analisarBancada({ rodadas, passes: [], lanes: {}, nucleos: 2 });
  assert.equal(b.confianca.fria.paresValidos, 3);
  assert.equal(b.confianca.fria.estado, 'sem-confianca');
  assert.deepEqual(b.confianca.fria.motivos, ['variacao-da-razao-ajustada-acima-do-limite']);
  perto(b.confianca.fria.cvRazaoAjustada, medir.CV_RAZAO_AJUSTADA_MAX);
  assert.deepEqual(b.pares.map((p: Record<string, unknown>) => p.razao), [null, null, null]);
  assert.deepEqual(b.pares.map((p: Record<string, unknown>) => p.razaoAjustada), [9, 10, 11]);
});

test('MC22: o JSON da bancada e indentado ate o nivel pedido e compacto abaixo dele, e volta ao mesmo valor', () => {
  const valor = { a: 1, b: [{ c: [1, 2], d: null }], e: {}, f: [] };
  const texto = medir.jsonRaso(valor, 2);
  assert.deepEqual(JSON.parse(texto), valor);
  assert.match(texto, /^ "b": \[\n  \{"c":\[1,2\],"d":null\}\n \]/m);
  assert.equal(medir.jsonRaso([1, 2], 0), '[1,2]');
});
