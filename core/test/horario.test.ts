/**
 * I-35: horário do dono em toda superfície humana (T1: fonte única e módulo formatador).
 *
 * Os valores esperados valem para qualquer `TZ` do processo: a claim roda este arquivo com
 * `TZ=UTC` e com `TZ=America/Sao_Paulo`, e um teste daqui confere as duas saídas lado a lado.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ajustarManifesto, projetoTemporario } from './apoio';
import {
  definirFusoDoDono, duracaoCurta, duracaoRelativa, formatarDataHora, formatarDataHoraRotulada, formatarDesde, formatarHora,
  formatarPrazo, fusoDoDono, fusoDoManifesto, fusoDoSistema, legendaDoFuso, lerFusoDoDono, localizarTexto,
  normalizarFuso, registrarFonteDoFuso, rotuloDoFuso,
} from '../src/horario';
import { duracaoCurta as duracaoDoRadar } from '../src/hitl';
import { duracaoCurta as duracaoDoMonitor } from '../src/orquestracao';
import { checar } from '../src/doctor';

const SP = 'America/Sao_Paulo';
/** 19/09/2026 15:16 em Brasília. */
const AGORA = '2026-09-19T18:16:00Z';

test('normalizarFuso aceita só o que o Intl aceita e devolve a forma canônica', () => {
  assert.equal(normalizarFuso(SP), SP);
  assert.equal(normalizarFuso('america/sao_paulo'), SP);
  assert.equal(normalizarFuso('Brazil/East'), SP);
  assert.equal(normalizarFuso(' Etc/UTC '), 'UTC');
  for (const ruim of ['Marte/Olimpo', '', '   ', 42, null, undefined, {}]) assert.equal(normalizarFuso(ruim), undefined);
});

test('lerFusoDoDono: válido vale, ausente cai no sistema sem aviso, inválido cai no sistema com aviso', () => {
  assert.deepEqual(lerFusoDoDono('america/sao_paulo'), { fuso: SP, origem: 'manifesto' });
  assert.deepEqual(lerFusoDoDono(undefined), { fuso: fusoDoSistema(), origem: 'sistema' });
  assert.deepEqual(lerFusoDoDono(''), { fuso: fusoDoSistema(), origem: 'sistema' });
  const ruim = lerFusoDoDono('Marte/Olimpo');
  assert.equal(ruim.fuso, fusoDoSistema());
  assert.equal(ruim.origem, 'sistema');
  assert.match(ruim.aviso ?? '', /^owner\.timezone invalido \("Marte\/Olimpo"\): usando o fuso do sistema/);
});

test('fuso do sistema segue o TZ do processo e tem piso UTC quando o TZ não resolve', () => {
  const horario = path.join(__dirname, '..', 'src', 'horario.js');
  const rodar = (tz: string) => spawnSync(process.execPath, ['-e',
    `process.stdout.write(require(${JSON.stringify(horario)}).fusoDoSistema())`],
  { encoding: 'utf8', env: { ...process.env, TZ: tz } }).stdout;
  assert.equal(rodar('Europe/Lisbon'), 'Europe/Lisbon');
  assert.equal(rodar('UTC'), 'UTC');
  assert.equal(rodar('Bogus/Zone'), 'UTC');
});

test('manifesto: owner.timezone só aparece quando válido; inválido vira aviso, nunca erro', () => {
  const p = projetoTemporario('horario-manifesto');
  try {
    assert.equal(p.carregado.manifesto.owner, undefined);
    assert.deepEqual(fusoDoManifesto(p.carregado), { fuso: fusoDoSistema(), origem: 'sistema' });
    assert.ok(checar(p.dir).some(c => c.nome === 'fuso do dono' && c.nivel === 'ok' && c.detalhe.includes('fuso do sistema')));

    ajustarManifesto(p, 'owner:\n', 'owner:\n  timezone: "america/sao_paulo"\n');
    assert.deepEqual(p.carregado.manifesto.owner, { timezone: SP });
    assert.deepEqual(p.carregado.erros, []);
    assert.deepEqual(fusoDoManifesto(p.carregado), { fuso: SP, origem: 'manifesto' });
    assert.ok(checar(p.dir).some(c => c.nome === 'fuso do dono' && c.nivel === 'ok' && c.detalhe.includes('horário de Brasília')));

    ajustarManifesto(p, 'timezone: "america/sao_paulo"', 'timezone: "Marte/Olimpo"');
    assert.equal(p.carregado.manifesto.owner, undefined);
    assert.deepEqual(p.carregado.erros, []);
    assert.ok(p.carregado.avisos.some(a => a.startsWith('owner.timezone invalido')));
    const f = fusoDoManifesto(p.carregado);
    assert.equal(f.fuso, fusoDoSistema());
    assert.match(f.aviso ?? '', /Marte\/Olimpo/);
    assert.ok(checar(p.dir).some(c => c.nome === 'fuso do dono' && c.nivel === 'warn' && /Marte/.test(c.detalhe)));
  } finally { p.limpar(); }
});

test('data-hora brasileira no fuso do dono, com virada de dia e ano diferente', () => {
  const o = { fuso: SP, agora: AGORA };
  assert.equal(formatarDataHora('2026-09-19T18:16:34.123Z', o), '19/09 15:16');
  assert.equal(formatarDataHora('2026-09-19T18:16:34.123Z', { ...o, segundos: true }), '19/09 15:16:34');
  // 23:30 em Brasília já é o dia seguinte em UTC.
  assert.equal(formatarDataHora('2026-09-20T02:30:00Z', o), '19/09 23:30');
  assert.equal(formatarDataHora('2026-09-20T02:30:00Z', { fuso: 'UTC', agora: AGORA }), '20/09 02:30');
  assert.equal(formatarDataHora('2025-12-31T12:00:00Z', o), '31/12/2025 09:00');
  assert.equal(formatarDataHora('2026-09-19T15:13:00-03:00', o), '19/09 15:13');
  assert.equal(formatarDataHora(Date.parse('2026-09-19T18:16:00Z'), o), '19/09 15:16');
});

test('hora sozinha só quando é hoje no fuso do dono', () => {
  assert.equal(formatarHora('2026-09-19T18:00:00Z', { fuso: SP, agora: AGORA }), '15:00');
  assert.equal(formatarHora('2026-09-18T18:00:00Z', { fuso: SP, agora: AGORA }), '18/09 15:00');
  // 22:00 de 19/09 em Brasília; 23:30 do mesmo dia local, embora UTC já esteja em 20/09.
  const noite = { fuso: SP, agora: '2026-09-20T01:00:00Z' };
  assert.equal(formatarHora('2026-09-20T02:30:00Z', noite), '23:30');
  assert.equal(formatarHora('2026-09-19T12:00:00Z', noite), '09:00');
  assert.equal(formatarHora('2026-09-20T03:30:00Z', noite), '20/09 00:30');
});

test('prazo com relativo e rótulo; desde com relativo', () => {
  const o = { fuso: SP, agora: AGORA };
  assert.equal(formatarPrazo('2026-09-19T19:16:00Z', { ...o, rotulo: true }), '19/09 16:16 (horário de Brasília), em 1h00');
  assert.equal(formatarPrazo('2026-09-19T18:17:30Z', o), '19/09 15:17, em 2min');
  assert.equal(formatarPrazo('2026-09-19T18:11:00Z', o), '19/09 15:11, venceu há 5min');
  // O "desde 2026-09-17 01:53" que o monitor mostrava era UTC: no fuso do dono é 16/09 22:53.
  assert.equal(formatarDesde('2026-09-17T01:53:00Z', o), '16/09 22:53 (há 2d 16h)');
  assert.equal(formatarDesde('2026-09-19T14:00:00Z', { ...o, rotulo: true }), '11:00 (horário de Brasília, há 4h16)');
  assert.equal(formatarDataHoraRotulada('2026-09-19T14:00:30.843Z', o), '19/09 11:00 (horário de Brasília)');
});

test('rótulo e legenda do fuso', () => {
  assert.equal(rotuloDoFuso(SP), 'horário de Brasília');
  assert.equal(rotuloDoFuso('UTC'), 'UTC');
  assert.equal(rotuloDoFuso('Europe/Lisbon', '2026-09-19T12:00:00Z'), 'Europe/Lisbon, GMT+1');
  assert.equal(legendaDoFuso(SP), 'Horários de Brasília.');
  assert.equal(legendaDoFuso('UTC'), 'Horários em UTC.');
});

test('localizarTexto troca só ISO com fuso; entrada não parseável volta como veio', () => {
  const o = { fuso: SP, agora: AGORA };
  assert.equal(localizarTexto('libera em 2026-09-19T18:13:00.000Z (janela estimada)', o), 'libera em 19/09 15:13 (janela estimada)');
  assert.equal(localizarTexto('ledger gate_blocked em 2026-09-19T14:00:30.843Z.', o), 'ledger gate_blocked em 19/09 11:00.');
  assert.equal(localizarTexto('offset 2026-09-19T15:13:00-03:00 e 2026-09-19T15:13:00+0000', o), 'offset 19/09 15:13 e 19/09 12:13');
  for (const intacto of ['sem fuso 2026-09-19T15:13:00', 'truncado 2026-09-19 18:13', 'data 2026-09-19', 'id ork-clean-code-2026-09-19-1']) {
    assert.equal(localizarTexto(intacto, o), intacto);
  }
  assert.equal(formatarDataHora('', o), '');
  assert.equal(formatarDataHora(undefined, o), '');
  assert.equal(formatarDataHora(null, o), '');
  assert.equal(formatarDataHora('abc', o), 'abc');
  assert.equal(formatarDataHora('2026-09-19T15:13:00', o), '2026-09-19T15:13:00');
  assert.equal(formatarPrazo('x', o), 'x');
  assert.equal(formatarDesde('', o), '');
});

test('fuso do processo: fonte preguiçosa, fixação para testes e aviso único no stderr', () => {
  const escrito: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => { escrito.push(String(s)); return true; };
  try {
    definirFusoDoDono(undefined);
    let leituras = 0;
    registrarFonteDoFuso(() => { leituras++; return lerFusoDoDono('Marte/Olimpo'); });
    assert.equal(leituras, 0);
    assert.equal(fusoDoDono().fuso, fusoDoSistema());
    assert.equal(fusoDoDono().fuso, fusoDoSistema());
    assert.equal(leituras, 1);
    assert.equal(escrito.filter(s => s.includes('owner.timezone invalido')).length, 1);

    definirFusoDoDono(SP);
    registrarFonteDoFuso(() => ({ fuso: 'UTC', origem: 'manifesto' }));
    assert.equal(fusoDoDono().fuso, SP);
    assert.equal(formatarDataHora('2026-09-20T02:30:00Z', { agora: AGORA }), '19/09 23:30');

    definirFusoDoDono(undefined);
    registrarFonteDoFuso(() => { throw new Error('manifesto ilegível'); });
    assert.equal(fusoDoDono().fuso, fusoDoSistema());
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
    definirFusoDoDono(undefined);
  }
});

test('relativo no limite do minuto: menos de 1 min por extenso, nunca 0min; desde no futuro avisa o relógio', () => {
  // P3-4 do CHECK c655cb5e: "venceu há 0min", "em 0min" e "(há 0min)" com o relógio adiantado.
  const o = { fuso: SP, agora: AGORA };
  const saidas = [
    formatarPrazo('2026-09-19T18:16:30Z', o), formatarPrazo(AGORA, o), formatarPrazo('2026-09-19T18:15:30Z', o),
    formatarPrazo('2026-09-19T18:15:00Z', { ...o, rotulo: true }), formatarDesde('2026-09-19T18:15:30Z', o),
    formatarDesde(AGORA, o), formatarDesde('2026-09-19T18:16:40Z', o), formatarDesde('2026-09-19T18:21:00Z', { ...o, rotulo: true }),
    duracaoRelativa(0), duracaoRelativa(1), duracaoRelativa(125),
  ];
  assert.deepEqual(saidas, [
    '19/09 15:16, em menos de 1 min', '19/09 15:16, em menos de 1 min', '19/09 15:15, venceu há menos de 1 min',
    '19/09 15:15 (horário de Brasília), venceu há 1min', '15:15 (há menos de 1 min)',
    '15:16 (há menos de 1 min)', '15:16 (há menos de 1 min)', '15:21 (horário de Brasília, relógio adiantado: 5min no futuro)',
    'menos de 1 min', '1min', '2h05',
  ]);
  for (const texto of saidas) assert.doesNotMatch(texto, /\b0min/);
});

test('duracaoCurta mora em horario.ts; radar e monitor reexportam a mesma função', () => {
  assert.equal(duracaoDoRadar, duracaoCurta);
  assert.equal(duracaoDoMonitor, duracaoCurta);
  assert.equal(duracaoCurta(0), '0min');
  assert.equal(duracaoCurta(125), '2h05');
  assert.equal(duracaoCurta(3863), '2d 16h');
});

test('mesma saída para o dono em Brasília com TZ=UTC e com TZ=America/Sao_Paulo', () => {
  const horario = path.join(__dirname, '..', 'src', 'horario.js');
  const script = `const h = require(${JSON.stringify(horario)}); h.definirFusoDoDono('America/Sao_Paulo');
    const o = { agora: '2026-09-20T01:00:00Z' };
    process.stdout.write(JSON.stringify([h.formatarDataHora('2026-09-20T02:30:00Z', o), h.formatarHora('2026-09-20T02:30:00Z', o),
      h.formatarPrazo('2026-09-20T02:30:00Z', { ...o, rotulo: true }), h.formatarDesde('2026-09-19T14:00:00Z', o),
      h.localizarTexto('desde 2026-09-19T14:00:30.843Z', o), h.legendaDoFuso()]));`;
  const saidas = ['UTC', SP].map(tz => spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ: tz } }).stdout);
  assert.equal(saidas[0], saidas[1]);
  assert.deepEqual(JSON.parse(saidas[0]), ['19/09 23:30', '23:30', '19/09 23:30 (horário de Brasília), em 1h30',
    '11:00 (há 11h00)', 'desde 19/09 11:00', 'Horários de Brasília.']);
});
