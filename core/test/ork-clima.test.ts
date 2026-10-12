import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
