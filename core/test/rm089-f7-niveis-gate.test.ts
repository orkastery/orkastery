import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executarCiDaBranchComContexto } from '../src/ci';
import { criarProjecaoReplayCi } from '../src/ci-recibo-basico';
import { processarEventoDaFabrica } from '../src/ci-fabrica-servico';
import type { RegistrosParaDecisaoDaFabrica } from '../src/ci-fabrica-registros';
import type { ManifestoCarregado } from '../src/manifest';
import type { Manifesto } from '../src/types';

const evento = { id: 'evt', assinaturaValida: true, emitidoEm: '2026-11-26T10:00:00.000Z',
  recebidoEm: '2026-11-26T10:01:00.000Z' };
const incompleto = (): RegistrosParaDecisaoDaFabrica => ({ forja: 'github', projeto: 'p', origem: 'o', destino: 'main',
  head: 'a'.repeat(40), nivelDoDestino: 'exigir', comandosDoManifesto: [], configuracaoDoDestino: null,
  configuracaoDoCheckout: null, identidadeRelidaDaFabrica: null, chaveDeProvaDoArtefato: null, verifies: [],
  comparacao: { relacao: 'identical', completa: true, arquivosDesdeVerify: [], commits: [] },
  registrosDeCommit: [], checks: [], tags: [] });

test('C125 observar e avisar publicam diagnóstico e exigir bloqueia sem decisão válida', () => {
  for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
    const d = processarEventoDaFabrica(evento, { reler: () => { const e = incompleto(); e.nivelDoDestino = nivel; return e; },
      persistir: () => undefined, publicar: () => undefined });
    assert.equal(d.estado, nivel === 'exigir' ? 'bloqueado' : 'diagnostico');
    assert.equal(d.codigo, 'ci.fabrica.prova-ausente');
  }

  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm089-f7-niveis-'));
  const branch = 'feature/niveis-fabrica';
  const head = 'a'.repeat(40);
  const claim = { id: 'C125', thread: 'ork-rm089f7recib', fase: 'GO' as const,
    arquivo: 'core/test/rm089-f7-niveis-gate.test.ts', alegacao: 'o runner aplica os três níveis', negativa: false,
    verificar: ['node --test core/dist-test/test/rm089-f7-niveis-gate.test.js'],
    criadoEm: '2026-11-26T00:00:00.000Z', estado: 'pendente' as const };
  const entrada = criarProjecaoReplayCi({ thread: claim.thread, claims: [claim], check: 'agile',
    baseline: { commit: 'b'.repeat(40), comandos: [{ nome: 'build', comando: 'true', ok: true, code: 0,
      resumo: '', causa: 'exit', executado: true }], check: { modo: 'agile' } },
    commands: [{ name: 'build', command: 'true' }] });
  fs.mkdirSync(path.join(raiz, '.ork-ci'));
  fs.writeFileSync(path.join(raiz, '.ork-ci/ork-rm089f7recib.json'), JSON.stringify({
    schema: 'ork.ci-bundle/v1', thread: claim.thread, branch, base: 'main', claims: [claim],
    commands: entrada.commands, recibo: entrada,
  }));
  try {
    for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
      const manifesto = { verify: { timeout_ms: 5_000, timeout_ms_por_comando: {} },
        worktree: { base_branch: 'main' }, ci: { required_for_ship: false, context: 'ork-verify',
          external_repositories: {}, politica_recibo: nivel } } as Manifesto;
      const carregado = { raiz, caminho: path.join(raiz, 'orkastery.yaml'), legado: false, bytes: 0,
        erros: [], avisos: [], manifesto } as ManifestoCarregado;
      const saida = executarCiDaBranchComContexto(carregado, branch, { destino: 'main', pullRequest: true,
        preflightEmpresa: null, head, receitaConfiavel: { commands: entrada.commands, check: 'agile' },
        replay: { casaEfemera: path.join(raiz, 'casa'), identidadeProduto: () => 'produto',
          hermeticidade: () => null, capacidade: () => false } }) as { ok: boolean;
            policy: { level: string; receipt: string } };
      assert.equal(saida.ok, nivel !== 'exigir', nivel);
      assert.equal(saida.policy.level, nivel);
      assert.equal(saida.policy.receipt, 'invalido');
    }
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('códigos próprios distinguem indisponibilidade, prazo, regra, colisão e recusa', () => {
  const falha = (erro: Error) => processarEventoDaFabrica(evento, { reler: () => { throw erro; },
    persistir: () => undefined, publicar: () => undefined });
  assert.equal(falha(new Error()).codigo, 'ci.fabrica.indisponivel');
  const timeout = new Error(); timeout.name = 'TimeoutError';
  assert.equal(falha(timeout).codigo, 'ci.fabrica.prazo-excedido');
  for (const codigo of ['ci.fabrica.regra-destino-invalida', 'ci.fabrica.nome-colidente',
    'ci.fabrica.publicacao-recusada'] as const) {
    const entrada = incompleto(); entrada.configuracaoDoDestino = { github_app_id: 1 };
    entrada.identidadeRelidaDaFabrica = 1;
    entrada.verifies = [{ commit: entrada.head, verde: true, comandos: [], rodadaId: 'r',
      chaveDeProva: 'b'.repeat(64), posicao: 1 }];
    entrada.chaveDeProvaDoArtefato = 'b'.repeat(64);
    entrada.checks = [{ fase: 'CHECK', origem: 'sessions.watch', sessionId: 'r', despachoEm: evento.emitidoEm,
      despachoRegistrado: true, despachoVerificado: true, promptConferido: true, sensorResultId: 's', favoravel: true,
      parecerSha256: 'c'.repeat(64), shaRevisado: entrada.head, conducaoId: 'c', posicao: 2 }];
    entrada.tags = [{ conducaoId: 'c', head: entrada.head, posicao: 3 }];
    const d = processarEventoDaFabrica(evento, { reler: () => entrada, avaliarDestino: () => codigo,
      persistir: () => undefined, publicar: () => undefined });
    assert.equal(d.codigo, codigo);
  }
});
