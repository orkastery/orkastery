import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { adicionarClaim } from '../src/claims';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { hashDoPrompt } from '../src/phase';
import { prepararPromptDeRetomada } from '../src/retomada-checkpoint';
import { provaDoOrk } from '../src/session-watcher-claude';
import { dirThread, gravarThread, novaThread } from '../src/thread';

test('RM-064 T3: CHECK retoma em CHECK com ponto de parada e preserva o prompt original', () => {
  const p = projetoTemporario('rm064-checkpoint');
  try {
    const t = novaThread(p.carregado, { nome: 'checkpoint', modo: 'auto' }).thread;
    t.faseAtual = 'CHECK'; gravarThread(p.dir, t);
    const dir = dirThread(p.dir, t.id), prompts = path.join(dir, 'prompts');
    fs.mkdirSync(prompts, { recursive: true });
    const original = '# Pedido original\n\nConduza o bloco completo.\n';
    const originalPath = path.join(prompts, 'original.md'), originalSha = hashDoPrompt(original);
    fs.writeFileSync(originalPath, original);
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'goal.md'), '# objetivo anterior\n');
    adicionarClaim(p.dir, t.id, { arquivo: 'alvo.txt', alegacao: 'alvo comprovado', verificar: ['test -f alvo.txt'], fase: 'CHECK' });
    registrar(dir, t.id, TIPOS_DE_EVENTO.verificacao, { fase: 'CHECK', veredito: 'PRECISA DE MUDANCA' });
    registrar(dir, t.id, TIPOS_DE_EVENTO.fixAberto, { fase: 'GO', rodada: 2 });
    fs.writeFileSync(path.join(p.dir, 'interrompido.txt'), 'trabalho parcial\n');

    const retomada = prepararPromptDeRetomada(p.dir, t, 'CHECK',
      { prompt: original, promptPath: originalPath, promptSha256: originalSha });
    assert.equal(fs.readFileSync(originalPath, 'utf8'), original);
    assert.equal(hashDoPrompt(fs.readFileSync(originalPath, 'utf8')), originalSha);
    assert.notEqual(retomada.promptSha256, originalSha);
    assert.equal(hashDoPrompt(fs.readFileSync(retomada.promptPath, 'utf8')), retomada.promptSha256);
    assert.deepEqual(retomada.ponto.fase, 'CHECK');
    assert.deepEqual(retomada.ponto.claimsPendentes, ['C1']);
    assert.equal(retomada.ponto.rodadaCheck, 1);
    assert.equal(retomada.ponto.goFixEmCurso, 2);
    assert.ok(retomada.ponto.gitStatus.some((l) => l.includes('interrompido.txt')));
    assert.match(retomada.prompt, /Continue da fase `CHECK`; não repita GOAL nem PLAN/);
    assert.match(retomada.prompt, new RegExp(originalSha));

    // O GOAL já existia antes da retomada; a prova da sessão retomada olha CHECK e não abre
    // `human.pending` por causa desse arquivo histórico.
    const despachadaEm = new Date(Date.now() - 1000).toISOString();
    const sessao = { sessionId: '11111111-2222-3333-4444-555555555555', fase: 'CHECK' as const, despachadaEm };
    fs.writeFileSync(path.join(dir, 'docs', 'check.md'), '# CHECK\n\nVeredito: PASSOU\n');
    const prova = provaDoOrk(p.dir, t.id, sessao, lerLedger(dir),
      { cwd: p.dir, artefato: { arquivo: 'docs/check.md', sha256: null } });
    assert.equal(prova.ok, true, prova.fonte);
    assert.equal(prova.veredito, 'PASSOU');
  } finally { p.limpar(); }
});
