import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

// RM-059 (onda 1, F4): o Clima de Cota testado sem o Claude Code. O sandbox do `ork verify` e o runner do
// CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros do mod com o compilador do
// `core` (pelo carregador do `checar-mods.cjs`, o mesmo da guarda estatica) e os roda num escopo proprio.
// As funcoes puras recebem o fuso explicito: o teste da o mesmo resultado com `TZ=UTC` e com
// `TZ=America/Sao_Paulo`.
const raizDoRepo = path.resolve(__dirname, '../../..');
const CLIMA = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-clima');
const PONTE = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte');
const { carregarModuloDoMod, checarMods } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
const carregar = (rel: string) => carregarModuloDoMod(path.join(CLIMA, rel));
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(CLIMA, rel), 'utf8'));

/** Carrega `contas.ts`, que importa valores de `./previsao`: so esse import e resolvido (D9 da thread). */
function carregarContas() {
  const previsao = carregar('hooks/previsao.ts');
  const arquivo = path.join(CLIMA, 'hooks/contas.ts');
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const modulo = { exports: {} as Record<string, any> };
  const exigir = (id: string) => {
    if (id === './previsao') return previsao;
    throw new Error(`modulo puro do mod nao importa valor: ${id}`);
  };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}

const FUSO = 'America/Sao_Paulo';
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
/** 12/10/2026 17:00 UTC, 14:00 em Brasilia. */
const T0 = Date.UTC(2026, 9, 12, 17, 0);
const RENOVA = T0 + 3 * HORA;
const iso = (ms: number) => new Date(ms).toISOString();
const cinco = (pct: number, renova = RENOVA) => [{ kind: 'five_hour', percentUsed: pct, resetsAt: iso(renova) }];
const sete = (pct: number, renova = T0 + 3 * DIA) => [{ kind: 'seven_day', percentUsed: pct, resetsAt: iso(renova) }];

/** Grava as leituras em ordem, cada uma `[quando, leituras]`, e devolve a serie. */
function serieDe(registrarLeituras: (s: unknown, l: unknown[], agora: number) => unknown, leituras: Array<[number, unknown[]]>): unknown {
  let s: unknown = undefined;
  for (const [quando, l] of leituras) s = registrarLeituras(s, l, quando);
  return s;
}

test('manifesto do Clima: nome, contrato, dependencia da ponte e nenhuma chave fora do formato', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-clima');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.ts'] });
  assert.ok(fs.existsSync(path.join(CLIMA, 'hooks/register.ts')));
});

test('orkastery-mod.json: so o papel dono nesta fatia (D11 do plano dos mods)', () => {
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono'], claudeCodeMinimo: '2.1.287' });
});

test('o contrato declara o estado do Clima sem import nem referencia', () => {
  const contrato = fs.readFileSync(path.join(CLIMA, 'types/index.d.ts'), 'utf8');
  assert.match(contrato, /interface PluginState \{\s*'ork-clima': \{/);
  assert.match(contrato, /faixa: string \| null/);
  assert.match(contrato, /naoCabem: ClimaNaoCabe\[\]/);
  assert.doesNotMatch(contrato, /^\s*import\s/m);
  assert.doesNotMatch(contrato, /\/\/\/\s*<reference/);
});

test('o modulo puro so importa tipos, e o registro nao abre processo nem le disco ou ambiente', () => {
  const fonte = fs.readFileSync(path.join(CLIMA, 'hooks/previsao.ts'), 'utf8');
  const imports = fonte.split('\n').filter((l) => /^\s*import\s/.test(l));
  assert.deepEqual(imports.filter((l) => !/^\s*import type\s/.test(l)), []);
  const registro = fs.readFileSync(path.join(CLIMA, 'hooks/register.ts'), 'utf8');
  assert.doesNotMatch(registro, /\$\.(process|fs|env)\./);
  assert.doesNotMatch(registro, /\.orkastery\//);
  for (const gancho of ["on('session.start'", "on('session.measure'", "on('command.run', { command: 'clima' }"]) {
    assert.ok(registro.includes(gancho), gancho);
  }
  // O nucleo so pela ponte: a fila inteira, o retrato, as threads abertas e o registro de contas (D3, D13).
  for (const chamada of ["$.ork.ler({ consulta: 'retry.list' })", '$.ork.retrato()', "$.ork.ler({ consulta: 'thread.list' })",
    "$.ork.ler({ consulta: 'accounts.esgotamentos' })", '$.ork.mostrado(']) {
    assert.ok(registro.includes(chamada), chamada);
  }
  // `contas.ts` so importa tipos e o `./previsao` do proprio mod.
  const contas = fs.readFileSync(path.join(CLIMA, 'hooks/contas.ts'), 'utf8').split('\n').filter((l) => /^\s*import\s/.test(l));
  assert.deepEqual(contas.filter((l) => !/^\s*import type\s/.test(l)),
    ["import { duracao, emAlerta, formatarHora, rotuloDaJanela, textoDaFaixa } from './previsao'"]);
});

test('serie: uma janela por kind, corrida plana compacta, renovacao, janela que sai da leitura e tetos', () => {
  const { registrarLeituras, lerSerie, FORMATO_DA_SERIE, TETO_DE_PONTOS } = carregar('hooks/previsao.ts');
  let s = registrarLeituras(undefined, cinco(60), T0);
  assert.deepEqual(s, { formato: FORMATO_DA_SERIE, janelas: [{ kind: 'five_hour', renovaEm: RENOVA, pontos: [{ em: T0, pct: 60 }] }] });
  s = registrarLeituras(s, cinco(60), T0 + 10 * MIN);
  s = registrarLeituras(s, cinco(60), T0 + 20 * MIN);
  s = registrarLeituras(s, cinco(61), T0 + 30 * MIN);
  assert.deepEqual(s.janelas[0].pontos, [{ em: T0, pct: 60 }, { em: T0 + 20 * MIN, pct: 60 }, { em: T0 + 30 * MIN, pct: 61 }]);
  // O `resetsAt` mudou: serie nova. Dentro da tolerancia de 60 s, a mesma janela.
  assert.deepEqual(registrarLeituras(s, cinco(62, RENOVA + 5 * HORA), T0 + 40 * MIN).janelas[0].pontos, [{ em: T0 + 40 * MIN, pct: 62 }]);
  assert.equal(registrarLeituras(s, cinco(62, RENOVA + 30 * 1000), T0 + 40 * MIN).janelas[0].pontos.length, 4);
  // Queda de um ponto renova; meio ponto, nao.
  assert.deepEqual(registrarLeituras(s, cinco(60), T0 + 40 * MIN).janelas[0].pontos, [{ em: T0 + 40 * MIN, pct: 60 }]);
  assert.equal(registrarLeituras(s, cinco(60.5), T0 + 40 * MIN).janelas[0].pontos.length, 4);
  // A medicao traz todas as janelas: a que saiu da leitura deixa a serie, e a vencida tambem (D13).
  const duas = registrarLeituras(undefined, [...cinco(10), ...sete(5)], T0);
  assert.deepEqual(registrarLeituras(duas, sete(6), T0 + 10 * MIN).janelas.map((j: { kind: string }) => j.kind), ['seven_day']);
  assert.deepEqual(registrarLeituras(duas, [], T0 + 10 * MIN).janelas, []);
  // Leitura invalida nao entra.
  const invalidas = [{ kind: '../x', percentUsed: 1 }, { kind: 'five_hour', percentUsed: 'muito' }, { kind: 'five_hour', percentUsed: 5, resetsAt: 'ontem' }, null];
  assert.deepEqual(registrarLeituras(undefined, invalidas, T0).janelas, []);
  // Teto de pontos por janela.
  let longa: unknown = undefined;
  for (let i = 0; i < TETO_DE_PONTOS + 30; i++) longa = registrarLeituras(longa, [{ kind: 'seven_day', percentUsed: i / 10 }], T0 + i * MIN);
  assert.equal((longa as { janelas: Array<{ pontos: unknown[] }> }).janelas[0].pontos.length, TETO_DE_PONTOS);
  // O que nao e deste formato vira serie vazia.
  assert.deepEqual(lerSerie({ formato: 'outro', janelas: [] }), { formato: FORMATO_DA_SERIE, janelas: [] });
  assert.deepEqual(lerSerie('lixo').janelas, []);
});

test('previsao: 60% as 14:00 e 70% as 14:30 acabam as 16:00, antes de renovar as 17:00 (CS3)', () => {
  const { registrarLeituras, prever, formatarHora } = carregar('hooks/previsao.ts');
  const s = registrarLeituras(registrarLeituras(undefined, cinco(60), T0), cinco(70), T0 + 30 * MIN);
  const [p] = prever(s, T0 + 30 * MIN);
  assert.equal(p.estado, 'acaba-antes');
  assert.equal(p.rotulo, '5 h');
  assert.equal(p.ritmoPorHora, 20);
  assert.equal(p.acabaEm, T0 + 2 * HORA);
  assert.equal(formatarHora(p.acabaEm, FUSO, T0), '16:00');
  assert.equal(formatarHora(p.renovaEm, FUSO, T0), '17:00');
  assert.equal(formatarHora(p.acabaEm, 'UTC', T0), '19:00');
});

test('previsao: folga, sem ritmo, esgotada, janela vencida e ordem', () => {
  const { registrarLeituras, prever } = carregar('hooks/previsao.ts');
  const duas = (a: number, b: number, depois = 30 * MIN, renova = RENOVA) =>
    registrarLeituras(registrarLeituras(undefined, cinco(a, renova), T0), cinco(b, renova), T0 + depois);
  // 10 pontos por hora so acabariam depois de renovar.
  assert.equal(prever(duas(20, 25), T0 + 30 * MIN)[0].estado, 'folga');
  // Ritmo zero: folga, sem hora de acabar.
  assert.deepEqual([prever(duas(40, 40), T0 + 30 * MIN)[0].estado, prever(duas(40, 40), T0 + 30 * MIN)[0].acabaEm], ['folga', null]);
  // Um ponto so, ou serie jovem com menos de um sexto do intervalo (10 min na de 5 h): sem ritmo.
  assert.equal(prever(registrarLeituras(undefined, cinco(60), T0), T0)[0].estado, 'sem-ritmo');
  assert.equal(prever(duas(60, 70, 5 * MIN), T0 + 5 * MIN)[0].ritmoPorHora, null);
  // 100% ou mais: esgotada.
  assert.equal(prever(registrarLeituras(undefined, cinco(100), T0), T0)[0].estado, 'esgotada');
  // A janela que ja renovou nao entra na previsao.
  assert.deepEqual(prever(duas(60, 70), RENOVA + 2 * MIN), []);
  // A mais urgente vem primeiro.
  const mista = registrarLeituras(undefined, [...cinco(30), { kind: 'seven_day', percentUsed: 100, resetsAt: iso(T0 + 2 * DIA) }], T0);
  assert.deepEqual(prever(mista, T0).map((p: { kind: string }) => p.kind), ['seven_day', 'five_hour']);
});

test('ritmo (D13): o valor no inicio do intervalo sai dos pontos que o cercam, e serie jovem precisa de um sexto dele', () => {
  const { registrarLeituras, prever, ritmoDaJanela } = carregar('hooks/previsao.ts');
  const ritmo = (leituras: Array<[number, unknown[]]>, agora: number) => prever(serieDe(registrarLeituras, leituras), agora)[0];
  // 7 d: 70,0 ha 30 h, 70,0 repetido 10 min antes (ou 9) e 70,1 agora. O valor no inicio do intervalo e exato:
  // o ritmo e de 0,1 ponto em 24 h, e nao um decimo em 10 min projetado por dias.
  for (const antes of [10, 9]) {
    const p = ritmo([[T0 - 30 * HORA, sete(70)], [T0 - antes * MIN, sete(70)], [T0, sete(70.1)]], T0);
    assert.deepEqual([p.estado, p.ritmoPorHora], ['folga', 0], `repeticao ${antes} min antes`);
  }
  // 7 d no comeco da semana: 0,5% e 1% a 15 min um do outro nao dao ritmo, e 5 h de serie tambem nao (D14):
  // a janela de 7 d so tem ritmo com um dia inteiro de serie, noite incluida. Com 25 h, da.
  assert.equal(ritmo([[T0 - 15 * MIN, sete(0.5)], [T0, sete(1)]], T0).estado, 'sem-ritmo');
  assert.equal(ritmo([[T0 - 5 * HORA, sete(0.5)], [T0, sete(3)]], T0).estado, 'sem-ritmo');
  assert.equal(ritmo([[T0 - 25 * HORA, sete(0.5)], [T0, sete(3)]], T0).ritmoPorHora, 0.1);
  // Semana de dia util (N1 da revisao 2): 1,5% por hora das 09:00 as 18:00, nada a noite. Na segunda nao ha alerta;
  // na terca as 09:00, com a noite no meio, o ritmo de 0,56 por hora so acabaria depois de renovar.
  const segunda = Date.UTC(2026, 9, 12, 12, 0);
  const renovaNaSemana = segunda + 7 * DIA;
  const util: Array<[number, unknown[]]> = [];
  for (let h = 0; h <= 9; h++) util.push([segunda + h * HORA, sete(1.5 * h, renovaNaSemana)]);
  for (const [quando, esperado] of [[segunda + 4 * HORA, 'sem-ritmo'], [segunda + 8 * HORA + 40 * MIN, 'sem-ritmo']] as Array<[number, string]>) {
    assert.equal(prever(serieDe(registrarLeituras, util.filter(([t]) => t <= quando)), quando)[0].estado, esperado);
  }
  const terca = segunda + DIA;
  const comTerca = prever(serieDe(registrarLeituras, [...util, [terca, sete(13.5, renovaNaSemana)]]), terca)[0];
  assert.deepEqual([comTerca.estado, comTerca.ritmoPorHora], ['folga', 0.56]);
  // A compactacao da corrida plana nao muda o ritmo: com ou sem o ponto do meio, o mesmo resultado.
  const com = [[T0 - 30 * HORA, sete(70)], [T0 - 20 * HORA, sete(70)], [T0 - 10 * MIN, sete(70)], [T0, sete(70.1)]] as Array<[number, unknown[]]>;
  const sem = [com[0], com[2], com[3]] as Array<[number, unknown[]]>;
  assert.deepEqual(ritmo(com, T0), ritmo(sem, T0));
  // Leitura esparsa (D12): 70% as 14:00 e 85% as 15:30, com o dono parado, dao 10 por hora.
  const esparsa = ritmo([[T0, cinco(70, T0 + 4 * HORA)], [T0 + 90 * MIN, cinco(85, T0 + 4 * HORA)]], T0 + 90 * MIN);
  assert.deepEqual([esparsa.estado, esparsa.ritmoPorHora, esparsa.acabaEm], ['acaba-antes', 10, T0 + 3 * HORA]);
  // Interpolacao quando os pontos que cercam o inicio diferem: 10% as 12:00, 50% as 14:00, 80% as 15:58 e 81% as 16:05.
  const cedo = T0 - 2 * HORA;
  const p = ritmo([[cedo, cinco(10, T0 + 5 * HORA)], [cedo + 2 * HORA, cinco(50, T0 + 5 * HORA)], [cedo + 238 * MIN, cinco(80, T0 + 5 * HORA)],
    [cedo + 245 * MIN, cinco(81, T0 + 5 * HORA)]], cedo + 245 * MIN);
  assert.equal(p.ritmoPorHora, 14.5);
  // O intervalo da janela de 5 h e de 60 min: 0% as 14:00, 60% as 15:00 e 70% as 16:00 dao 10 por hora (com 120 min, dariam 35).
  const umaHora = ritmo([[T0, cinco(0, T0 + 5 * HORA)], [T0 + HORA, cinco(60, T0 + 5 * HORA)], [T0 + 2 * HORA, cinco(70, T0 + 5 * HORA)]], T0 + 2 * HORA);
  assert.equal(umaHora.ritmoPorHora, 10);
  assert.equal(ritmoDaJanela({ kind: 'five_hour', pontos: [] }), null);
});

test('formato: hora truncada no fuso explicito, outro dia e outro ano, distancias como o nucleo escreve', () => {
  const { formatarHora, duracao, distancia, numeroBr, percentualEmDegrau } = carregar('hooks/previsao.ts');
  assert.equal(formatarHora(T0, FUSO, T0), '14:00');
  assert.equal(formatarHora(T0, 'UTC', T0), '17:00');
  assert.equal(formatarHora(T0 + DIA, FUSO, T0), '13/10 14:00');
  assert.equal(formatarHora(Date.UTC(2027, 0, 2, 12, 0), FUSO, T0), '02/01/2027 09:00');
  // Truncada como no nucleo (S1 da revisao): 14:00:45 ainda e 14:00.
  assert.equal(formatarHora(T0 + 45 * 1000, FUSO, T0), '14:00');
  assert.equal(duracao(20 * 1000), 'menos de 1 min');
  assert.equal(duracao(45 * MIN), '45min');
  assert.equal(duracao(90 * MIN), '1h30');
  assert.equal(duracao((2 * 24 + 5) * HORA), '2d 05h');
  assert.equal(distancia(T0 + 80 * MIN, T0), 'em 1h20');
  assert.equal(distancia(T0 - 10 * MIN, T0), 'há 10min');
  assert.equal(numeroBr(82.5), '82,5');
  assert.equal(numeroBr(70), '70');
  assert.equal(numeroBr(0.04, 2), '0,04');
  assert.deepEqual([percentualEmDegrau(5), percentualEmDegrau(70), percentualEmDegrau(79.9), percentualEmDegrau(92)],
    ['menos de 10%', '70% ou mais', '70% ou mais', '90% ou mais']);
});

test('faixa (D5, D13): so no alerta, em degraus e com a hora arredondada, o que nao cabe na frente e teto de 200', () => {
  const { registrarLeituras, prever, textoDaFaixa } = carregar('hooks/previsao.ts');
  const alerta = registrarLeituras(registrarLeituras(undefined, cinco(60), T0), cinco(70), T0 + 30 * MIN);
  assert.equal(textoDaFaixa(prever(alerta, T0 + 30 * MIN), FUSO, T0 + 30 * MIN), '5 h com 70% ou mais, acaba ~16:00, renova 17:00');
  assert.equal(textoDaFaixa(prever(alerta, T0 + 50 * MIN), FUSO, T0 + 50 * MIN), '5 h com 70% ou mais, acaba ~16:00, renova 17:00');
  // Um ponto e meio a mais no mesmo ritmo nao muda o texto.
  const maisUm = registrarLeituras(alerta, cinco(71.5), T0 + 34.5 * MIN);
  assert.equal(textoDaFaixa(prever(maisUm, T0 + 35 * MIN), FUSO, T0 + 35 * MIN), '5 h com 70% ou mais, acaba ~16:00, renova 17:00');
  // A hora de acabar vai para baixo, ao quarto de hora: 16:12 e 16:14 viram 16:00, e 16:16, 16:15.
  for (const [ate, esperado] of [[33, '16:00'], [33.5, '16:00'], [34, '16:15']] as Array<[number, string]>) {
    const s = registrarLeituras(registrarLeituras(undefined, cinco(60), T0), cinco(70), T0 + ate * MIN);
    assert.match(textoDaFaixa(prever(s, T0 + 34 * MIN), FUSO, T0 + 34 * MIN), new RegExp(`acaba ~${esperado},`), `70% as 14:${ate}`);
  }
  // E nunca passa da renovacao (N2 da revisao 2): renovacao as 16:40 e esgotamento as 16:3x dao 16:30.
  const ate1640 = registrarLeituras(registrarLeituras(undefined, cinco(60, T0 + 160 * MIN), T0), cinco(70, T0 + 160 * MIN), T0 + 38 * MIN);
  assert.equal(textoDaFaixa(prever(ate1640, T0 + 38 * MIN), FUSO, T0 + 38 * MIN), '5 h com 70% ou mais, acaba ~16:30, renova 16:40');
  assert.equal(textoDaFaixa(prever(alerta, T0 + 30 * MIN), FUSO, T0 + 30 * MIN, ['ork-x']), 'não cabe: ork-x; 5 h com 70% ou mais, acaba ~16:00, renova 17:00');
  assert.match(textoDaFaixa(prever(alerta, T0 + 30 * MIN), FUSO, T0 + 30 * MIN, ['a', 'b', 'c', 'd', 'e']), /^não cabe: a, b, c e mais 2; /);
  const longo = textoDaFaixa(prever(alerta, T0 + 30 * MIN), FUSO, T0 + 30 * MIN, ['ork-' + 'x'.repeat(75), 'ork-' + 'y'.repeat(75), 'ork-' + 'z'.repeat(75)]);
  assert.equal(longo.length, 200);
  assert.ok(longo.endsWith('…'));
  const calma = registrarLeituras(registrarLeituras(undefined, cinco(20), T0), cinco(25), T0 + 30 * MIN);
  assert.equal(textoDaFaixa(prever(calma, T0 + 30 * MIN), FUSO, T0 + 30 * MIN), null);
  const limiar = registrarLeituras(undefined, [...cinco(92), { kind: 'seven_day', percentUsed: 100, resetsAt: iso(T0 + 2 * DIA) }], T0);
  assert.equal(textoDaFaixa(prever(limiar, T0), FUSO, T0), '7 d esgotou, renova 14/10 14:00 · 5 h com 90% ou mais, renova 17:00');
});

test('faixa: a linha do Clima passa pela composicao real da ponte', () => {
  const { comporFaixa } = carregarModuloDoMod(path.join(PONTE, 'hooks/faixa.tsx'));
  const { registrarLeituras, prever, textoDaFaixa } = carregar('hooks/previsao.ts');
  const alerta = registrarLeituras(registrarLeituras(undefined, cinco(60), T0), cinco(70), T0 + 30 * MIN);
  const texto = textoDaFaixa(prever(alerta, T0 + 30 * MIN), FUSO, T0 + 30 * MIN, ['ork-x']);
  assert.deepEqual(comporFaixa([{ mod: 'ork-clima', texto, em: T0 }], 120, 6), ['clima: não cabe: ork-x; 5 h com 70% ou mais, acaba ~16:00, renova 17:00']);
  assert.deepEqual(comporFaixa([{ mod: 'ork-clima', texto, em: T0 }], 30, 6), ['clima: não cabe: ork-x; 5 h c…']);
});

test('/clima: cada janela com ritmo, previsao, renovacao, distancias e hora da leitura; sem leitura e fora do dono dizem por que', () => {
  const { registrarLeituras, prever, textoDoClima, textoForaDoDono, TEXTO_SEM_PONTE } = carregar('hooks/previsao.ts');
  const s = serieDe(registrarLeituras, [[T0, [...cinco(60), ...sete(40, T0 + 4 * DIA)]], [T0 + 30 * MIN, [...cinco(70), ...sete(40, T0 + 4 * DIA)]]]);
  assert.equal(textoDoClima(prever(s, T0 + 40 * MIN), FUSO, T0 + 40 * MIN), [
    'Clima de cota da conta desta sessão',
    '- 5 h: 70%, ritmo de 20 pontos por hora, acaba ~16:00 (em 1h20), antes de renovar, renova 17:00 (em 2h20). Lida às 14:30.',
    '- 7 d: 40%, ritmo ainda sem leituras suficientes, sem previsão ainda, renova 16/10 14:00 (em 3d 23h). Lida às 14:30.',
    'O Clima só lê e avisa: troca de conta, de runtime ou de modelo fica com o núcleo e com você.',
  ].join('\n'));
  // O ritmo lento da semana vem com duas casas, e nao como zero (D14).
  const lenta = serieDe(registrarLeituras, [[T0 - 30 * HORA, sete(40)], [T0, sete(41.2)]]);
  assert.match(textoDoClima(prever(lenta, T0), FUSO, T0), /- 7 d: 41,2%, ritmo de 0,04 pontos por hora, folga no ritmo atual/);
  assert.match(textoDoClima([], FUSO, T0), /Sem leitura de cota ainda\..*só existe em conta de assinatura/);
  assert.equal(textoForaDoDono('fase'), 'O Clima de Cota só roda na sessão do dono de um projeto do Orkastery; o papel desta sessão é fase.');
  assert.match(textoForaDoDono('dormente'), /é dormente\. Se o servidor orkastery ainda está conectando, tente de novo em instantes\.$/);
  assert.equal(TEXTO_SEM_PONTE, 'O Clima de Cota depende da ponte ork-ponte, que não respondeu nesta sessão; confira se ela está instalada e carregada.');
});

test('cruzamento: a fila inteira com a ultima gravacao de cada id, as threads abertas, as paradas e as marcas', () => {
  const c = carregarContas();
  const pedido = (id: string, thread: string, estado: string, liberaEm: number, tentativas = 1) => ({ id, thread, estado, liberaEm: iso(liberaEm), tentativas });
  assert.deepEqual(c.retomadasDaFila([
    pedido('R3', 'ork-x', 'aguardando', T0 + HORA, 2), pedido('R4', 'ork-y', 'aguardando', T0 - MIN),
    pedido('R70', 'ork-k', 'aguardando', T0 + HORA), pedido('R4', 'ork-y', 'retomado', T0 - MIN),
    pedido('X1', 'ork-q', 'aguardando', T0), pedido('R6', '../fora', 'aguardando', T0),
  ]), [
    { id: 'R3', thread: 'ork-x', liberaEm: T0 + HORA, tentativas: 2 },
    { id: 'R70', thread: 'ork-k', liberaEm: T0 + HORA, tentativas: 1 },
  ]);
  assert.equal(c.retomadasDaFila({ nao: 'lista' }), null);
  assert.deepEqual(c.threadsAbertas({ todas: false, threads: [{ id: 'ork-a', status: 'aberta' }, { id: 'ork-b', status: 'fechada' }] }), ['ork-a']);
  assert.equal(c.threadsAbertas([]), null);
  const retrato = { sections: { blockers: { state: 'unavailable', coverage: { nextOffset: 50 },
    gaps: ['ledger.unavailable:ork-q', 'ledger.unavailable:ork-r', 'outra'], items: [
      { id: 'gate:ork-a', refs: [{ kind: 'thread', id: 'ork-a' }], facts: { reason: 'runtime.quota-exhausted' } },
      { id: 'gate:ork-b', refs: [{ kind: 'thread', id: 'ork-b' }], facts: { reason: 'runtime.silencio' } },
      { id: 'gate:ork-c', refs: [{ kind: 'thread', id: 'ork-c' }], facts: { reason: 'runtime.rate-limited' } },
      { id: 'gate:ork-d', refs: [{ kind: 'thread', id: 'ork-d' }], facts: { reason: 'runtime.quota-exhausted' } },
    ] } } };
  assert.deepEqual(c.paradasDoRetrato(retrato, ['ork-a', 'ork-b', 'ork-c']), { paginaCortada: true, lacunas: 2, lacunasCortadas: false, itens: [
    { thread: 'ork-a', motivo: 'runtime.quota-exhausted' }, { thread: 'ork-c', motivo: 'runtime.rate-limited' },
  ] });
  assert.equal(c.paradasDoRetrato(retrato, null).itens.length, 3);
  assert.deepEqual(c.paradasDoRetrato(null, null), { itens: [], paginaCortada: false, lacunas: 0, lacunasCortadas: false });
  // O retrato guarda 4 lacunas e conta o resto: o numero vira piso (N6 da revisao 2).
  const cortadas = { sections: { blockers: { items: [], coverage: { nextOffset: null }, gaps: ['ledger.unavailable:a', 'ledger.unavailable:b',
    'ledger.unavailable:c', 'ledger.unavailable:d', 'maestro.messages.omitted:3'] } } };
  assert.deepEqual(c.paradasDoRetrato(cortadas, []), { itens: [], paginaCortada: false, lacunas: 4, lacunasCortadas: true });
  assert.deepEqual(c.marcasDoRelatorio({ contrato: 'ork.esgotamentos/v1', marcas: [
    { conta: '1a2b3c4d5e6f', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', esgotadoAte: iso(RENOVA), projeto: 'orkastery' },
    { conta: '/caminho/de/conta', runtime: 'codex', estado: 'esgotado' },
    { conta: 'abcdefabcdef', runtime: 'codex', estado: 'sem-auth', esgotadoAte: null },
  ] }), [
    { conta: '1a2b3c4d5e6f', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', esgotadoAte: RENOVA, projeto: 'orkastery' },
    { conta: 'abcdefabcdef', runtime: 'codex', estado: 'sem-auth', motivo: 'sem motivo', esgotadoAte: null, projeto: 'nao registrado' },
  ]);
  assert.equal(c.marcasDoRelatorio({ contrato: 'outro', marcas: [] }), null);
  assert.equal(c.textoDaMarca({ conta: 'abcdefabcdef', runtime: 'codex', estado: 'sem-auth', motivo: 'sem motivo', esgotadoAte: null, projeto: 'nao registrado' }, FUSO, T0),
    'conta abcdefabcdef (codex): sem-auth sem prazo, visto em projeto não registrado (sem motivo).');
});

test('cruzamento (D7): nao cabe entre o esgotamento e a renovacao, cabe antes com folga, depois de renovar', () => {
  const p = carregar('hooks/previsao.ts');
  const c = carregarContas();
  const agora = T0 + 30 * MIN;
  const previsoes = p.prever(p.registrarLeituras(p.registrarLeituras(undefined, cinco(60), T0), cinco(70), agora), agora);
  const r = (id: string, thread: string, liberaEm: number | null) => ({ id, thread, liberaEm, tentativas: null });
  const d = c.cruzar(previsoes, [r('R4', 'ork-y', T0 + 60 * MIN), r('R3', 'ork-x', T0 + 150 * MIN), r('R5', 'ork-z', T0 + 4 * HORA),
    r('R8', 'ork-v', T0 - 10 * MIN), r('R9', 'ork-u', RENOVA)], agora);
  // Na hora exata da renovacao a janela ja renovou (R9).
  assert.deepEqual(d.map((x: any) => [x.retomada.id, x.classe, x.folgaMs]),
    [['R3', 'nao-cabe', null], ['R8', 'cabe', 90 * MIN], ['R4', 'cabe', 60 * MIN], ['R9', 'depois-de-renovar', null], ['R5', 'depois-de-renovar', null]]);
  assert.equal(c.textoDoDespacho(d[0], FUSO, agora), 'R3 da ork-x volta 16:30 e não cabe: a janela de 5 h acaba ~16:00 e renova 17:00.');
  assert.equal(c.textoDoDespacho(d[1], FUSO, agora), 'R8 da ork-v volta agora, com ~1h30 de cota no ritmo atual.');
  assert.equal(c.textoDoDespacho(d[4], FUSO, agora), 'R5 da ork-z volta 18:00, depois de a janela de 5 h renovar.');
  assert.equal(c.textoDoNaoCabe(d[0], FUSO, agora), 'R3 da ork-x não cabe na janela de 5 h, que renova 17:00.');
  assert.deepEqual(c.threadsQueNaoCabem(d), ['ork-x']);
  // Janela esgotada: tudo que despacha antes de renovar nao cabe.
  const esgotada = p.prever(p.registrarLeituras(undefined, cinco(100), T0), T0 + 5 * MIN);
  const e = c.cruzar(esgotada, [r('R9', 'ork-u', T0 + 10 * MIN)], T0 + 5 * MIN);
  assert.equal(c.textoDoDespacho(e[0], FUSO, T0 + 5 * MIN), 'R9 da ork-u volta 14:10 e não cabe: a janela de 5 h já esgotou e renova 17:00.');
  // Sem janela em alerta: cabe, sem folga.
  const calma = p.prever(p.registrarLeituras(p.registrarLeituras(undefined, cinco(20), T0), cinco(25), agora), agora);
  const sem = c.cruzar(calma, [r('R4', 'ork-y', T0 + 60 * MIN)], agora);
  assert.deepEqual([sem[0].classe, sem[0].folgaMs, sem[0].janela], ['cabe', null, null]);
  assert.equal(c.textoDoDespacho(sem[0], FUSO, agora), 'R4 da ork-y volta 15:00.');
  assert.equal(c.resumoDoClima(previsoes, ['ork-x'], FUSO, agora), 'não cabe: ork-x; 5 h com 70% ou mais, acaba ~16:00, renova 17:00');
  assert.equal(c.resumoDoClima(calma, [], FUSO, agora), 'nenhuma janela pede atenção');
});

test('cruzamento no /clima: linhas separadas, leitura que falhou vira aviso, e sugestoes do nucleo sem --por', () => {
  const p = carregar('hooks/previsao.ts');
  const c = carregarContas();
  const agora = T0 + 30 * MIN;
  const previsoes = p.prever(p.registrarLeituras(p.registrarLeituras(undefined, cinco(60), T0), cinco(70), agora), agora);
  const d = c.cruzar(previsoes, [{ id: 'R3', thread: 'ork-x', liberaEm: T0 + 150 * MIN, tentativas: 1 }], agora);
  const marca = { conta: '1a2b3c4d5e6f', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', esgotadoAte: RENOVA, projeto: 'orkastery' };
  assert.deepEqual(c.linhasDoCruzamento({ despachos: d, erroDaFila: null, erroDoRetrato: null, erroDoRegistro: null, marcas: [marca],
    paradas: { itens: [{ thread: 'ork-a', motivo: 'runtime.quota-exhausted' }], paginaCortada: true, lacunas: 2, lacunasCortadas: true } }, previsoes, FUSO, agora), [
    'Despachos que dependem da cota (fila de retomada do núcleo):',
    '- R3 da ork-x volta 16:30 e não cabe: a janela de 5 h acaba ~16:00 e renova 17:00.',
    'Threads abertas paradas por cota (retrato do núcleo):',
    '- ork-a parada por runtime.quota-exhausted.',
    '- Os bloqueios vieram em mais de uma página; o Clima leu a primeira.',
    '- O retrato não leu o ledger de pelo menos 2 thread(s).',
    'Contas no registro do núcleo (ork accounts esgotamentos):',
    '- conta 1a2b3c4d5e6f (claude-bg): esgotado até 17:00, visto em orkastery (runtime.quota-exhausted).',
    'O que o núcleo já sabe fazer:',
    ...c.SUGESTOES.map((s: string) => '- ' + s),
  ]);
  assert.deepEqual(c.linhasDoCruzamento({ despachos: null, erroDaFila: 'f', paradas: null, erroDoRetrato: 'x', marcas: null, erroDoRegistro: 'y' }, [], FUSO, agora), [
    'Despachos que dependem da cota (fila de retomada do núcleo):', '- Fila de retomada indisponível (f).',
    'Threads abertas paradas por cota (retrato do núcleo):', '- Não deu para conferir as paradas (x).',
    'Contas no registro do núcleo (ork accounts esgotamentos):', '- Registro de contas indisponível (y).',
  ]);
  assert.equal(c.SUGESTOES.length, 3);
  for (const s of c.SUGESTOES) assert.doesNotMatch(s, /--por/);
  assert.ok(c.SUGESTOES.some((s: string) => s.includes('ork accounts list') && s.includes('ork retry run <thread>')));
  // A guarda da ponte, com a lista real, nao acusa os comandos citados e acusa o `--por` quando o texto comeca pelo
  // comando; dentro de uma frase ela nao o pegaria, e quem segura as sugestoes e o `doesNotMatch` acima (S6 da revisao).
  const guarda = carregarModuloDoMod(path.join(PONTE, 'hooks/guarda.ts'));
  const autoridade = guarda.lerAutoridade(fs.readFileSync(path.join(raizDoRepo, 'adapters/claude-code/mods/autoridade.json'), 'utf8'));
  for (const s of [...c.SUGESTOES, 'ork retry run ork-x', 'ork accounts list', 'ork retry list']) assert.equal(guarda.avaliarTexto(autoridade, s), null, s);
  assert.notEqual(guarda.avaliarTexto(autoridade, 'ork retry run ork-x --por dono'), null);
});

test('guarda: o Clima passa na guarda estatica, sozinho e junto dos outros mods', () => {
  const so = checarMods({ pastas: [CLIMA] });
  assert.equal(so.ok, true, JSON.stringify(so.mods[0].achados));
  const todos = checarMods({});
  assert.equal(todos.ok, true, JSON.stringify(todos.mods.filter((m: { ok: boolean }) => !m.ok)));
  assert.ok(todos.mods.some((m: { mod: string }) => m.mod === 'ork-clima'));
});
