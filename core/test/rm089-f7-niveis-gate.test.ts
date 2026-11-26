import assert from 'node:assert/strict';
import test from 'node:test';
import { processarEventoDaFabrica } from '../src/ci-fabrica-servico';
import type { RegistrosParaDecisaoDaFabrica } from '../src/ci-fabrica-registros';

const evento = { id: 'evt', assinaturaValida: true, emitidoEm: '2026-11-26T10:00:00.000Z',
  recebidoEm: '2026-11-26T10:01:00.000Z' };
const incompleto = (): RegistrosParaDecisaoDaFabrica => ({ forja: 'github', projeto: 'p', origem: 'o', destino: 'main',
  head: 'a'.repeat(40), comandosDoManifesto: [], configuracaoDoDestino: null, verifies: [],
  comparacao: { relacao: 'identical', completa: true, arquivosDesdeVerify: [], commits: [] },
  registrosDeCommit: [], checks: [], tags: [] });

test('C125 observar e avisar publicam diagnóstico e exigir bloqueia sem decisão válida', () => {
  for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
    const d = processarEventoDaFabrica(evento, nivel, { reler: incompleto,
      persistir: () => undefined, publicar: () => undefined });
    assert.equal(d.estado, nivel === 'exigir' ? 'bloqueado' : 'diagnostico');
    assert.equal(d.codigo, 'ci.fabrica.prova-ausente');
  }
});

test('códigos próprios distinguem indisponibilidade, prazo, regra, colisão e recusa', () => {
  const falha = (erro: Error) => processarEventoDaFabrica(evento, 'exigir', { reler: () => { throw erro; },
    persistir: () => undefined, publicar: () => undefined });
  assert.equal(falha(new Error()).codigo, 'ci.fabrica.indisponivel');
  const timeout = new Error(); timeout.name = 'TimeoutError';
  assert.equal(falha(timeout).codigo, 'ci.fabrica.prazo-excedido');
  for (const codigo of ['ci.fabrica.regra-destino-invalida', 'ci.fabrica.nome-colidente',
    'ci.fabrica.publicacao-recusada'] as const) {
    const entrada = incompleto(); entrada.configuracaoDoDestino = { github_app_id: 1 };
    entrada.verifies = [{ commit: entrada.head, verde: true, comandos: [], rodadaId: 'r',
      chaveDeProva: 'b'.repeat(64), posicao: 1 }];
    entrada.checks = [{ fase: 'CHECK', origem: 'sessions.watch', sessionId: 'r', despachoEm: evento.emitidoEm,
      despachoRegistrado: true, despachoVerificado: true, promptConferido: true, sensorResultId: 's', favoravel: true,
      parecerSha256: 'c'.repeat(64), shaRevisado: entrada.head, conducaoId: 'c', posicao: 2 }];
    entrada.tags = [{ conducaoId: 'c', head: entrada.head, posicao: 3 }];
    const d = processarEventoDaFabrica(evento, 'exigir', { reler: () => entrada, avaliarDestino: () => codigo,
      persistir: () => undefined, publicar: () => undefined });
    assert.equal(d.codigo, codigo);
  }
});
