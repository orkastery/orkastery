/**
 * I-35 (T6): demais textos do CLI no fuso do dono (janela ociosa, leases, ledger stats,
 * thread status e ship). Os esperados valem com `TZ=UTC` e `TZ=America/Sao_Paulo`.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { janelaDeCusto } from '../src/auditoria';
import { dirRodada, rodarAuditoria, tabelaDoLedgerDaRodada } from '../src/auditrun';
import { registrar } from '../src/ledger';
import { adquirirRegiao, tabelaDeLeases } from '../src/leases';
import { coletarEstatisticas, textoDasEstatisticas } from '../src/ledger-stats';
import { novaThread, resumoDaThread } from '../src/thread';
import { textoDoShip } from '../src/ship';
import { definirFusoDoDono, localizarTextoRotulado } from '../src/horario';
import { Manifesto } from '../src/types';

const SP = 'America/Sao_Paulo';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ANO = '(?:/2026)?';

test('localizarTextoRotulado rotula só quando trocou algum horário', () => {
  const o = { fuso: SP, agora: '2026-09-19T18:16:00Z' };
  assert.equal(localizarTextoRotulado('registrada no ledger em 2026-09-19T14:00:30.843Z', o),
    'registrada no ledger em 19/09 11:00 (horário de Brasília)');
  assert.equal(localizarTextoRotulado('sem horario', o), 'sem horario');
});

test('janela ociosa é avaliada e mostrada no fuso do dono, não no TZ do processo', () => {
  const p = projetoTemporario('horario-janela');
  try {
    const base = p.carregado.manifesto;
    const com = (timezone?: string): Manifesto => ({ ...base, ...(timezone ? { owner: { timezone } } : {}),
      audit: { ...base.audit, janela_ociosa: '22:00-06:00' } });
    // 23:30 UTC de 19/09 = 20:30 em Brasília: fora da janela para o dono em Brasília, dentro para o dono em UTC.
    const quando = new Date('2026-09-19T23:30:00Z');
    const sp = janelaDeCusto(com(SP), quando);
    assert.equal(sp.dentro, false);
    assert.equal(sp.agora, '20:30');
    assert.equal(sp.detalhe, '20:30 (horário de Brasília) esta FORA da janela ociosa 22:00-06:00');
    const utc = janelaDeCusto(com('UTC'), quando);
    assert.equal(utc.dentro, true);
    assert.equal(utc.detalhe, '23:30 (UTC) esta dentro da janela ociosa 22:00-06:00');
    // Sem owner.timezone vale o fuso do sistema: a mesma decisão de antes (horas locais do processo).
    const semDono = janelaDeCusto(com(undefined), quando);
    assert.equal(semDono.agora, `${String(quando.getHours()).padStart(2, '0')}:${String(quando.getMinutes()).padStart(2, '0')}`);
  } finally { p.limpar(); }
});

test('leases, ledger stats e thread status sem ISO, com rótulo', () => {
  const p = projetoTemporario('horario-cli');
  definirFusoDoDono(SP);
  try {
    const t = novaThread(p.carregado, { nome: 'Lease', modo: 'auto' }).thread;
    assert.equal(adquirirRegiao(p.dir, 'path:core/src/**', { thread: t.id, motivo: 'SIMULADO' }).ok, true);
    const leases = tabelaDeLeases(p.dir);
    assert.match(leases, new RegExp(`desde \\d{2}/\\d{2}${ANO} \\d{2}:\\d{2} ate \\d{2}/\\d{2}${ANO} \\d{2}:\\d{2} \\(pid \\d+\\)`));
    assert.match(leases, /\nHorários de Brasília\.$/);
    assert.doesNotMatch(leases, ISO);

    const stats = textoDasEstatisticas(coletarEstatisticas(p.dir, { desde: '2026-09-12T18:16:00.000Z', ate: '2026-09-20T02:30:00.000Z' }));
    assert.match(stats, new RegExp(`^Ledger stats {2}12/09${ANO} 15:16 ate 19/09${ANO} 23:30 \\(horário de Brasília\\) \\[desde,ate\\)`));
    assert.doesNotMatch(stats, ISO);

    const resumo = resumoDaThread({ ...t, score: { valor: 4, avaliadoPor: 'julio', regime: 'humano', avaliadoEm: '2026-09-20T02:30:00.000Z' } } as unknown as typeof t);
    assert.match(resumo, new RegExp(`score {5}4/5 por julio \\(humano\\) em 19/09${ANO} 23:30 \\(horário de Brasília\\)`));
    assert.doesNotMatch(resumo, ISO);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});

test('ship: razão, lease ocupado e detalhe localizados, fuso dito uma vez e sem parênteses aninhados, dado com ISO', () => {
  definirFusoDoDono(SP);
  try {
    const r = { ok: false, bloqueado: true, motivo: 'lease.busy', detalhe: 'lease main-tree esta com a thread ork-a desde 2026-09-19T14:00:30.843Z',
      correcao: 'espere a vez na fila', thread: 'ork-b', de: 'ork/b', para: 'main', shaDe: '', shaParaAntes: '', mergeSha: null,
      jaIncorporado: false, remoto: null, shaRemoto: null, pushVerificado: false,
      autorizacao: { autorizado: true, tipo: 'humano-antecipado', por: 'julio', razao: 'autorizacao antecipada de push registrada no ledger em 2026-09-19T14:00:30.843Z' },
      verificacao: null, ci: null, violacoes: [], lease: null,
      leaseOcupadoPor: { nome: 'main-tree', thread: 'ork-a', motivo: 'ship', pid: 1, adquiridoEm: '2026-09-19T14:00:30.843Z', expiraEm: '2026-09-19T15:00:30.843Z' },
      passos: [], dryRun: false } as unknown as Parameters<typeof textoDoShip>[0];
    const texto = textoDoShip(r);
    assert.match(texto, new RegExp(`registrada no ledger em 19/09${ANO} 11:00\\n`));
    assert.match(texto, new RegExp(`OCUPADO pela thread ork-a \\(desde 19/09${ANO} 11:00\\)\\n`));
    assert.match(texto, new RegExp(`detalhe {3}lease main-tree esta com a thread ork-a desde 19/09${ANO} 11:00\\n`));
    // P3-3 do CHECK c655cb5e: um rótulo por mensagem, no fim, e nenhum parêntese dentro de outro.
    assert.equal((texto.match(/horário de Brasília|Horários de Brasília/g) ?? []).length, 1, texto);
    assert.match(texto, /\nHorários de Brasília\.$/);
    assert.doesNotMatch(texto, /\([^()\n]*\(/);
    assert.doesNotMatch(texto, ISO);
    assert.match(r.detalhe, /2026-09-19T14:00:30\.843Z$/);
    // Mensagem sem horário não ganha legenda.
    const semHorario = textoDoShip({ ...r, detalhe: 'claims reprovadas', leaseOcupadoPor: null,
      autorizacao: { ...r.autorizacao, razao: 'autorizado pelo gate humano' } });
    assert.doesNotMatch(semHorario, /Brasília/);
  } finally { definirFusoDoDono(undefined); }
});

test('audit show --ledger: QUANDO no fuso do dono com segundos e legenda', () => {
  const p = projetoTemporario('horario-audit');
  definirFusoDoDono(SP);
  try {
    const rodada = rodarAuditoria(p.carregado, 'clean-code', { quando: new Date('2026-09-20T02:30:00Z'), dryRun: true });
    registrar(dirRodada(p.dir, rodada.id), rodada.id, 'audit_dispatch', { ts: '2026-09-20T02:30:45.000Z', pack: 'clean-code',
      detalhe: 'despacho SIMULADO em 2026-09-20T02:30:45.000Z' });
    const texto = tabelaDoLedgerDaRodada(p.dir, rodada.id);
    assert.match(texto, new RegExp(`19/09${ANO} 23:30:45 +audit_dispatch +clean-code \\| despacho SIMULADO em 19/09${ANO} 23:30`));
    assert.match(texto, /\nHorários de Brasília\.$/);
    assert.doesNotMatch(texto, ISO);
    assert.doesNotMatch(texto, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});
