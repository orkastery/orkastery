/**
 * I-35 (T7): Maestro e onboarding. O texto do panorama diz quando consultou no fuso do dono;
 * o JSON ganha fatos `*Local` absolutos ao lado dos ISO, sem mudar o fingerprint entre leituras.
 * Os esperados valem com `TZ=UTC` e `TZ=America/Sao_Paulo`.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ajustarManifesto, projetoTemporario } from './apoio';
import { novaThread } from '../src/thread';
import { discoverMaestro } from '../src/maestro-discovery';
import { maestroSnapshot } from '../src/maestro-snapshot';
import { maestroText } from '../src/maestro-cli';
import { validateMaestroSnapshot } from '../src/maestro-contract';
import { adquirirRegiao } from '../src/leases';
import { registrarPedidoHitl } from '../src/hitl-gates';
import { PedidoHitl } from '../src/hitl-contract';
import { gravarEtapa, PAUTA_ONBOARDING } from '../src/onboarding';
import { checar } from '../src/doctor';
import { definirFusoDoDono, formatarDataHoraRotulada } from '../src/horario';

const SP = 'America/Sao_Paulo';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

test('texto do Maestro: horário da consulta no fuso do dono, com rótulo', () => {
  const p = projetoTemporario('horario-maestro-texto');
  definirFusoDoDono(SP);
  try {
    const snapshot = { ...maestroSnapshot(discoverMaestro({ cwd: p.dir })), observedAt: '2026-09-20T02:30:00.000Z' };
    const texto = maestroText(snapshot);
    assert.equal(texto.split('\n')[1], '• Consulta: 19/09 23:30 (horário de Brasília)');
    assert.doesNotMatch(texto, ISO);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});

test('JSON do Maestro: fatos *Local absolutos ao lado do ISO, schema válido e fingerprint estável', () => {
  const p = projetoTemporario('horario-maestro-fatos');
  definirFusoDoDono(SP);
  try {
    const t = novaThread(p.carregado, { nome: 'Panorama', modo: 'classic' }).thread;
    assert.equal(adquirirRegiao(p.dir, 'path:core/src/**', { thread: t.id, motivo: 'SIMULADO' }).ok, true);
    const fila = path.join(p.dir, '.orkastery/retry/fila.jsonl');
    fs.mkdirSync(path.dirname(fila), { recursive: true });
    fs.writeFileSync(fila, JSON.stringify({ id: 'R1', thread: t.id, estado: 'aguardando', liberaEm: '2026-09-20T02:30:00Z', tentativas: 0 }) + '\n');
    const agora = Date.now();
    const q: PedidoHitl = { contrato: 'ork.hitl/v1', id: 'q-maestro', thread: t.id, fase: t.faseAtual, modo: t.modo,
      alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending', pergunta: 'Aprovar fixture SIMULADA?',
      opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Esperar', acao: 'esperar' }],
      recomendacao: 'Somente fixture', criadoEm: new Date(agora).toISOString(), prazo: new Date(agora + 3600000).toISOString(),
      acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'detalhada' };
    registrarPedidoHitl(p.dir, q);

    const ctx = discoverMaestro({ cwd: p.dir });
    const s1 = maestroSnapshot(ctx), s2 = maestroSnapshot(ctx);
    validateMaestroSnapshot(s1);
    assert.equal(s1.fingerprint, s2.fingerprint);

    const retry = s1.sections.retries.items[0].facts;
    assert.equal(retry.availableAt, '2026-09-20T02:30:00Z');
    assert.match(String(retry.availableAtLocal), /^19\/09(?:\/2026)? 23:30 \(horário de Brasília\)$/);
    const lease = s1.sections.leases.items[0].facts;
    assert.equal(lease.expiresAtLocal, formatarDataHoraRotulada(String(lease.expiresAt)));
    const hitl = s1.sections.hitl.items.find(i => i.id === q.id)!.facts;
    assert.equal(hitl.deadline, q.prazo);
    assert.equal(hitl.deadlineLocal, formatarDataHoraRotulada(q.prazo));
    for (const valor of [retry.availableAtLocal, lease.expiresAtLocal, hitl.deadlineLocal]) assert.doesNotMatch(String(valor), ISO);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});

test('onboarding: a etapa maestro pergunta o fuso, recusa fuso inválido e o doctor aponta divergência', () => {
  const p = projetoTemporario('horario-onboarding');
  try {
    const pergunta = PAUTA_ONBOARDING.find(e => e.etapa === 'maestro')!.pergunta;
    assert.match(pergunta, /fuso horário/);
    assert.match(pergunta, /owner\.timezone/);
    assert.throws(() => gravarEtapa(p.dir, 'maestro', { responsavel: 'Julio', fuso: 'Marte/Olimpo' }, 'julio'), /onboarding\.input\.invalid/);
    gravarEtapa(p.dir, 'maestro', { responsavel: 'Julio', fuso: 'america/sao_paulo' }, 'julio');
    const aviso = checar(p.dir).find(c => c.nome === 'onboarding fuso');
    assert.equal(aviso?.nivel, 'warn');
    assert.match(aviso?.detalhe ?? '', /entrevista informou America\/Sao_Paulo; manifesto declara owner\.timezone ausente/);
    ajustarManifesto(p, 'owner:\n', `owner:\n  timezone: "${SP}"\n`);
    assert.equal(checar(p.dir).some(c => c.nome === 'onboarding fuso'), false);
  } finally { p.limpar(); }
});
