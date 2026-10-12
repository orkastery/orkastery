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
/** 12/10/2026 17:00 UTC, 14:00 em Brasilia. */
const T0 = Date.UTC(2026, 9, 12, 17, 0);
const RENOVA = T0 + 3 * HORA;
const iso = (ms: number) => new Date(ms).toISOString();
const cinco = (pct: number, renova = RENOVA) => [{ kind: 'five_hour', percentUsed: pct, resetsAt: iso(renova) }];

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
  // T4.2: o nucleo so pela ponte, e o que foi mostrado vai ao registro dela.
  for (const chamada of ['$.ork.retrato()', "$.ork.ler({ consulta: 'accounts.esgotamentos' })", '$.ork.mostrado(']) {
    assert.ok(registro.includes(chamada), chamada);
  }
  // `contas.ts` so importa tipos e o `./previsao` do proprio mod.
  const contas = fs.readFileSync(path.join(CLIMA, 'hooks/contas.ts'), 'utf8').split('\n').filter((l) => /^\s*import\s/.test(l));
  assert.deepEqual(contas.filter((l) => !/^\s*import type\s/.test(l)), ["import { duracao, emAlerta, formatarHora, rotuloDaJanela, textoDaFaixa } from './previsao'"]);
});

test('serie: uma janela por kind, corrida plana compacta, janela que renova recomeca e a vencida sai', () => {
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
  // O percentual caiu um ponto ou mais: a janela renovou.
  assert.deepEqual(registrarLeituras(s, cinco(3), T0 + 40 * MIN).janelas[0].pontos, [{ em: T0 + 40 * MIN, pct: 3 }]);
  // A janela vencida sai na gravacao seguinte.
  const depois = registrarLeituras(s, [{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(T0 + 5 * 24 * HORA) }], RENOVA + 2 * MIN);
  assert.deepEqual(depois.janelas.map((j: { kind: string }) => j.kind), ['seven_day']);
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

test('previsao: folga, sem ritmo, esgotada, intervalo recente por janela e janela vencida', () => {
  const { registrarLeituras, prever } = carregar('hooks/previsao.ts');
  const duas = (a: number, b: number, depois = 30 * MIN, renova = RENOVA) =>
    registrarLeituras(registrarLeituras(undefined, cinco(a, renova), T0), cinco(b, renova), T0 + depois);
  // 10 pontos por hora so acabariam depois de renovar.
  assert.equal(prever(duas(20, 25), T0 + 30 * MIN)[0].estado, 'folga');
  // Ritmo zero: folga, sem hora de acabar.
  assert.deepEqual([prever(duas(40, 40), T0 + 30 * MIN)[0].estado, prever(duas(40, 40), T0 + 30 * MIN)[0].acabaEm], ['folga', null]);
  // Um ponto so, ou dois com menos de 10 min entre eles: sem ritmo.
  assert.equal(prever(registrarLeituras(undefined, cinco(60), T0), T0)[0].estado, 'sem-ritmo');
  assert.equal(prever(duas(60, 70, 5 * MIN), T0 + 5 * MIN)[0].ritmoPorHora, null);
  // 100% ou mais: esgotada.
  assert.equal(prever(registrarLeituras(undefined, cinco(100), T0), T0)[0].estado, 'esgotada');
  // O ritmo da janela de 5 h sai da ultima hora: 10% as 14:00, 60% as 16:00 e 70% as 16:30 dao 20 por hora.
  let s = registrarLeituras(undefined, cinco(10, T0 + 4 * HORA), T0);
  s = registrarLeituras(s, cinco(60, T0 + 4 * HORA), T0 + 2 * HORA);
  s = registrarLeituras(s, cinco(70, T0 + 4 * HORA), T0 + 150 * MIN);
  assert.equal(prever(s, T0 + 150 * MIN)[0].ritmoPorHora, 20);
  // A de 7 d mede no ultimo dia: os mesmos pontos dao 24 por hora.
  const sete = (pct: number) => [{ kind: 'seven_day', percentUsed: pct, resetsAt: iso(T0 + 5 * 24 * HORA) }];
  let semana = registrarLeituras(undefined, sete(10), T0);
  semana = registrarLeituras(semana, sete(60), T0 + 2 * HORA);
  semana = registrarLeituras(semana, sete(70), T0 + 150 * MIN);
  assert.equal(prever(semana, T0 + 150 * MIN)[0].ritmoPorHora, 24);
  // A janela que ja renovou nao entra na previsao.
  assert.deepEqual(prever(duas(60, 70), RENOVA + 2 * MIN), []);
  // A mais urgente vem primeiro.
  const mista = registrarLeituras(undefined, [...cinco(30), { kind: 'seven_day', percentUsed: 100, resetsAt: iso(T0 + 2 * 24 * HORA) }], T0);
  assert.deepEqual(prever(mista, T0).map((p: { kind: string }) => p.kind), ['seven_day', 'five_hour']);
});

test('formato: hora no fuso explicito, outro dia e outro ano, distancias como o nucleo escreve', () => {
  const { formatarHora, duracao, distancia, numeroBr } = carregar('hooks/previsao.ts');
  assert.equal(formatarHora(T0, FUSO, T0), '14:00');
  assert.equal(formatarHora(T0, 'UTC', T0), '17:00');
  assert.equal(formatarHora(T0 + 24 * HORA, FUSO, T0), '13/10 14:00');
  assert.equal(formatarHora(Date.UTC(2027, 0, 2, 12, 0), FUSO, T0), '02/01/2027 09:00');
  assert.equal(formatarHora(T0 + 29 * 1000, FUSO, T0), '14:00');
  assert.equal(formatarHora(T0 + 31 * 1000, FUSO, T0), '14:01');
  assert.equal(duracao(20 * 1000), 'menos de 1 min');
  assert.equal(duracao(45 * MIN), '45min');
  assert.equal(duracao(90 * MIN), '1h30');
  assert.equal(duracao((2 * 24 + 5) * HORA), '2d 05h');
  assert.equal(distancia(T0 + 80 * MIN, T0), 'em 1h20');
  assert.equal(distancia(T0 - 10 * MIN, T0), 'há 10min');
  assert.equal(numeroBr(82.5), '82,5');
  assert.equal(numeroBr(70), '70');
});

test('faixa: so no alerta, com horas absolutas que nao mudam com o relogio, e a esgotada primeiro (D5)', () => {
  const { registrarLeituras, prever, textoDaFaixa } = carregar('hooks/previsao.ts');
  const alerta = registrarLeituras(registrarLeituras(undefined, cinco(60), T0), cinco(70), T0 + 30 * MIN);
  assert.equal(textoDaFaixa(prever(alerta, T0 + 30 * MIN), FUSO, T0 + 30 * MIN), '5 h em 70%, acaba ~16:00, renova 17:00');
  assert.equal(textoDaFaixa(prever(alerta, T0 + 50 * MIN), FUSO, T0 + 50 * MIN), '5 h em 70%, acaba ~16:00, renova 17:00');
  assert.equal(textoDaFaixa(prever(alerta, T0 + 30 * MIN), FUSO, T0 + 30 * MIN, '; x'), '5 h em 70%, acaba ~16:00, renova 17:00; x');
  const calma = registrarLeituras(registrarLeituras(undefined, cinco(20), T0), cinco(25), T0 + 30 * MIN);
  assert.equal(textoDaFaixa(prever(calma, T0 + 30 * MIN), FUSO, T0 + 30 * MIN), null);
  const limiar = registrarLeituras(undefined, [...cinco(92), { kind: 'seven_day', percentUsed: 100, resetsAt: iso(T0 + 2 * 24 * HORA) }], T0);
  assert.equal(textoDaFaixa(prever(limiar, T0), FUSO, T0), '7 d esgotada, renova 14/10 14:00 · 5 h em 92%, renova 17:00');
});

test('faixa: a linha do Clima passa pela composicao real da ponte', () => {
  const { comporFaixa } = carregarModuloDoMod(path.join(PONTE, 'hooks/faixa.tsx'));
  const { registrarLeituras, prever, textoDaFaixa } = carregar('hooks/previsao.ts');
  const alerta = registrarLeituras(registrarLeituras(undefined, cinco(60), T0), cinco(70), T0 + 30 * MIN);
  const texto = textoDaFaixa(prever(alerta, T0 + 30 * MIN), FUSO, T0 + 30 * MIN);
  assert.deepEqual(comporFaixa([{ mod: 'ork-clima', texto, em: T0 }], 80, 6), ['clima: 5 h em 70%, acaba ~16:00, renova 17:00']);
  assert.deepEqual(comporFaixa([{ mod: 'ork-clima', texto, em: T0 }], 20, 6), ['clima: 5 h em 70%, …']);
});

test('/clima: cada janela com ritmo, previsao, renovacao, distancias e hora da leitura; sem leitura diz por que', () => {
  const { registrarLeituras, prever, textoDoClima, textoForaDoDono, textoSemPonte } = carregar('hooks/previsao.ts');
  const sete = T0 + 4 * 24 * HORA;
  let s = registrarLeituras(undefined, [...cinco(60), { kind: 'seven_day', percentUsed: 40, resetsAt: iso(sete) }], T0);
  s = registrarLeituras(s, [...cinco(70), { kind: 'seven_day', percentUsed: 40, resetsAt: iso(sete) }], T0 + 30 * MIN);
  assert.equal(textoDoClima(prever(s, T0 + 40 * MIN), FUSO, T0 + 40 * MIN), [
    'Clima de cota da conta desta sessão',
    '- 5 h: 70%, ritmo de 20 pontos por hora, acaba ~16:00 (em 1h20), antes de renovar, renova 17:00 (em 2h20). Lida às 14:30.',
    '- 7 d: 40%, ritmo de 0 pontos por hora, folga no ritmo atual, renova 16/10 14:00 (em 3d 23h). Lida às 14:30.',
    'O Clima só lê e avisa: troca de conta, de runtime ou de modelo fica com o núcleo e com você.',
  ].join('\n'));
  assert.match(textoDoClima([], FUSO, T0), /Sem leitura de cota ainda\..*só existe em conta de assinatura/);
  assert.equal(textoForaDoDono('fase'), 'O Clima de Cota só roda na sessão do dono de um projeto do Orkastery; o papel desta sessão é fase.');
  assert.match(textoSemPonte('sem $.ork'), /depende da ponte ork-ponte, que não respondeu \(sem \$\.ork\)/);
});

test('guarda: o Clima passa na guarda estatica, sozinho e junto dos outros mods', () => {
  const so = checarMods({ pastas: [CLIMA] });
  assert.equal(so.ok, true, JSON.stringify(so.mods[0].achados));
  const todos = checarMods({});
  assert.equal(todos.ok, true, JSON.stringify(todos.mods.filter((m: { ok: boolean }) => !m.ok)));
  assert.ok(todos.mods.some((m: { mod: string }) => m.mod === 'ork-clima'));
});

test('cruzamento: retomadas e paradas do retrato, com a parcialidade, e as marcas do registro de contas', () => {
  const c = carregarContas();
  const retrato = { sections: {
    retries: { state: 'available', coverage: { nextOffset: null }, items: [
      { id: 'R3', status: 'aguardando', refs: [{ kind: 'thread', id: 'ork-x' }], facts: { availableAt: iso(T0 + HORA), attempts: 2 } },
      { id: 'R4', status: 'due', refs: [{ kind: 'thread', id: 'ork-y' }], facts: { availableAt: iso(T0 - MIN) } },
      { id: 'R5', status: 'retomado', refs: [{ kind: 'thread', id: 'ork-z' }], facts: {} },
      { id: 'X1', status: 'aguardando', refs: [{ kind: 'thread', id: 'ork-q' }], facts: {} },
      { id: 'R6', status: 'aguardando', refs: [{ kind: 'thread', id: '../fora' }], facts: {} },
    ] },
    blockers: { state: 'unavailable', coverage: { nextOffset: null }, items: [
      { id: 'gate:ork-a', refs: [{ kind: 'thread', id: 'ork-a' }], facts: { reason: 'runtime.quota-exhausted' } },
      { id: 'gate:ork-b', refs: [{ kind: 'thread', id: 'ork-b' }], facts: { reason: 'runtime.silencio' } },
      { id: 'gate:ork-c', refs: [{ kind: 'thread', id: 'ork-c' }], facts: { reason: 'runtime.rate-limited' } },
    ] },
  } };
  assert.deepEqual(c.retomadasDoRetrato(retrato), { parcial: false, itens: [
    { id: 'R3', thread: 'ork-x', estado: 'aguardando', liberaEm: T0 + HORA, tentativas: 2 },
    { id: 'R4', thread: 'ork-y', estado: 'due', liberaEm: T0 - MIN, tentativas: null },
  ] });
  assert.deepEqual(c.paradasDoRetrato(retrato), { parcial: true, itens: [
    { thread: 'ork-a', motivo: 'runtime.quota-exhausted' }, { thread: 'ork-c', motivo: 'runtime.rate-limited' },
  ] });
  assert.deepEqual(c.retomadasDoRetrato(null), { itens: [], parcial: true });
  assert.equal(c.retomadasDoRetrato({ sections: { retries: { state: 'available', coverage: { nextOffset: 50 }, items: [] } } }).parcial, true);
  assert.deepEqual(c.marcasDoRelatorio({ contrato: 'ork.esgotamentos/v1', marcas: [
    { conta: '1a2b3c4d5e6f', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', esgotadoAte: iso(RENOVA), projeto: 'orkastery' },
    { conta: '/caminho/de/conta', runtime: 'codex', estado: 'esgotado' },
    { conta: 'abcdefabcdef', runtime: 'codex', estado: 'sem-auth', esgotadoAte: null },
  ] }), [
    { conta: '1a2b3c4d5e6f', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', esgotadoAte: RENOVA, projeto: 'orkastery' },
    { conta: 'abcdefabcdef', runtime: 'codex', estado: 'sem-auth', motivo: 'sem motivo', esgotadoAte: null, projeto: 'nao registrado' },
  ]);
  assert.equal(c.marcasDoRelatorio({ contrato: 'outro', marcas: [] }), null);
});

test('cruzamento: nao cabe entre o esgotamento e a renovacao, cabe antes com folga, depois de renovar (D7)', () => {
  const p = carregar('hooks/previsao.ts');
  const c = carregarContas();
  const agora = T0 + 30 * MIN;
  const previsoes = p.prever(p.registrarLeituras(p.registrarLeituras(undefined, cinco(60), T0), cinco(70), agora), agora);
  const r = (id: string, thread: string, liberaEm: number | null, estado = 'aguardando') => ({ id, thread, estado, liberaEm, tentativas: null });
  const d = c.cruzar(previsoes, [r('R4', 'ork-y', T0 + 60 * MIN), r('R3', 'ork-x', T0 + 150 * MIN), r('R5', 'ork-z', T0 + 4 * HORA),
    r('R8', 'ork-v', T0 - 10 * MIN, 'due')], agora);
  assert.deepEqual(d.map((x: any) => [x.retomada.id, x.classe, x.folgaMs]),
    [['R3', 'nao-cabe', null], ['R8', 'cabe', 90 * MIN], ['R4', 'cabe', 60 * MIN], ['R5', 'depois-de-renovar', null]]);
  assert.equal(c.textoDoDespacho(d[0], FUSO, agora), 'R3 da ork-x volta 16:30 e não cabe: a janela de 5 h acaba ~16:00 e renova 17:00.');
  assert.equal(c.textoDoDespacho(d[1], FUSO, agora), 'R8 da ork-v volta agora, com ~1h30 de cota no ritmo atual.');
  assert.equal(c.textoDoDespacho(d[3], FUSO, agora), 'R5 da ork-z volta 18:00, depois de a janela de 5 h renovar.');
  assert.equal(c.sufixoDaFaixa(d), '; não cabe: ork-x');
  // Janela esgotada: tudo que despacha antes de renovar nao cabe.
  const esgotada = p.prever(p.registrarLeituras(undefined, cinco(100), T0), T0 + 5 * MIN);
  const e = c.cruzar(esgotada, [r('R9', 'ork-u', T0 + 10 * MIN)], T0 + 5 * MIN);
  assert.equal(c.textoDoDespacho(e[0], FUSO, T0 + 5 * MIN), 'R9 da ork-u volta 14:10 e não cabe: a janela de 5 h já se esgotou e renova 17:00.');
  // Sem janela em alerta: cabe, sem folga.
  const calma = p.prever(p.registrarLeituras(p.registrarLeituras(undefined, cinco(20), T0), cinco(25), agora), agora);
  const sem = c.cruzar(calma, [r('R4', 'ork-y', T0 + 60 * MIN)], agora);
  assert.deepEqual([sem[0].classe, sem[0].folgaMs, sem[0].janela], ['cabe', null, null]);
  assert.equal(c.textoDoDespacho(sem[0], FUSO, agora), 'R4 da ork-y volta 15:00.');
  // A faixa nomeia ate tres threads.
  const muitas = c.cruzar(previsoes, ['a', 'b', 'c', 'd', 'e'].map((x, i) => r('R' + (i + 1), 'ork-' + x, T0 + 150 * MIN)), agora);
  assert.equal(c.sufixoDaFaixa(muitas), '; não cabe: ork-a, ork-b, ork-c e mais 2');
  assert.equal(c.resumoDoClima(previsoes, d, FUSO, agora), '5 h em 70%, acaba ~16:00, renova 17:00; não cabe: ork-x');
  assert.equal(c.resumoDoClima(calma, [], FUSO, agora), 'nenhuma janela pede atenção');
});

test('cruzamento no /clima: linhas, leitura que falhou vira aviso, e sugestoes do nucleo sem --por que a guarda aceita', () => {
  const p = carregar('hooks/previsao.ts');
  const c = carregarContas();
  const agora = T0 + 30 * MIN;
  const previsoes = p.prever(p.registrarLeituras(p.registrarLeituras(undefined, cinco(60), T0), cinco(70), agora), agora);
  const d = c.cruzar(previsoes, [{ id: 'R3', thread: 'ork-x', estado: 'aguardando', liberaEm: T0 + 150 * MIN, tentativas: 1 }], agora);
  const marca = { conta: '1a2b3c4d5e6f', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', esgotadoAte: RENOVA, projeto: 'orkastery' };
  assert.deepEqual(c.linhasDoCruzamento({ despachos: d, paradas: [{ thread: 'ork-a', motivo: 'runtime.quota-exhausted' }], parcial: true,
    erroDoRetrato: null, marcas: [marca], erroDoRegistro: null }, previsoes, FUSO, agora), [
    'Despachos que dependem da cota (retrato do núcleo):',
    '- R3 da ork-x volta 16:30 e não cabe: a janela de 5 h acaba ~16:00 e renova 17:00.',
    '- ork-a parada por runtime.quota-exhausted.',
    '- Retrato parcial: a fila de retomada ou os bloqueios vieram incompletos.',
    'Contas no registro do núcleo (ork accounts esgotamentos):',
    '- conta 1a2b3c4d5e6f (claude-bg): esgotado até 17:00, visto em orkastery (runtime.quota-exhausted).',
    'O que o núcleo já sabe fazer:',
    ...c.SUGESTOES.map((s: string) => '- ' + s),
  ]);
  assert.deepEqual(c.linhasDoCruzamento({ despachos: null, paradas: [], parcial: false, erroDoRetrato: 'x', marcas: null, erroDoRegistro: 'y' }, [], FUSO, agora), [
    'Despachos que dependem da cota (retrato do núcleo):', '- Retrato do núcleo indisponível (x).',
    'Contas no registro do núcleo (ork accounts esgotamentos):', '- Registro de contas indisponível (y).',
  ]);
  assert.equal(c.SUGESTOES.length, 3);
  for (const s of c.SUGESTOES) assert.doesNotMatch(s, /--por/);
  assert.ok(c.SUGESTOES.some((s: string) => s.includes('ork accounts list') && s.includes('ork retry run <thread>')));
  // A guarda da ponte, com a lista real, nao acusa as sugestoes nem os comandos citados, e acusa o --por.
  const guarda = carregarModuloDoMod(path.join(PONTE, 'hooks/guarda.ts'));
  const autoridade = guarda.lerAutoridade(fs.readFileSync(path.join(raizDoRepo, 'adapters/claude-code/mods/autoridade.json'), 'utf8'));
  for (const s of [...c.SUGESTOES, 'ork retry run ork-x', 'ork accounts list', 'ork retry list']) assert.equal(guarda.avaliarTexto(autoridade, s), null, s);
  assert.notEqual(guarda.avaliarTexto(autoridade, 'ork retry run ork-x --por dono'), null);
});
