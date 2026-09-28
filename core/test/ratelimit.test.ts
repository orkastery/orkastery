/**
 * Fila duravel de rate limit (bloco B3).
 *
 * O criterio de sucesso do bloco e duro: "uma fase morta por rate limit e retomada sem
 * intervencao humana na janela seguinte". Provar isso com `--dry-run` provaria so a
 * intencao, entao estes testes rodam o caminho REAL de despacho contra um stub do
 * binario `claude`: o `ork` extrai sessionId de verdade, re-verifica em
 * `claude agents --json` de verdade e grava a sessao no `thread.json` de verdade.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseRateLimit } from '../src/adapters/claude-bg';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { lerFilaDeRetomada, vencidos } from '../src/ratelimit';
import { retomarFila, retomarPorId } from '../src/retry';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { ajustarManifesto, projetoTemporario, runtimeFalso } from './apoio';

/** 2026-09-03T18:00:00Z, o "agora" fixo dos testes de parse. */
const AGORA = Date.parse('2026-09-03T18:00:00Z');

test('parseRateLimit le o horario de reset do stderr e NUNCA inventa hora', () => {
  const epoch = parseRateLimit('Claude AI usage limit reached|1757012400');
  assert.ok(epoch);
  assert.equal(epoch.fonte, 'epoch');
  assert.equal(epoch.resetEm, new Date(1757012400 * 1000).toISOString());

  const iso = parseRateLimit('usage limit reached; resets at 2026-09-03T21:00:00Z');
  assert.ok(iso);
  assert.equal(iso.fonte, 'iso');
  assert.equal(iso.resetEm, '2026-09-03T21:00:00.000Z');

  const duracao = parseRateLimit('Error: rate limit exceeded, try again in 25 minutes', AGORA);
  assert.ok(duracao);
  assert.equal(duracao.fonte, 'duracao');
  assert.equal(duracao.resetEm, new Date(AGORA + 25 * 60 * 1000).toISOString());

  const retryAfter = parseRateLimit('429 Too Many Requests (retry-after: 3600)', AGORA);
  assert.ok(retryAfter);
  assert.equal(retryAfter.fonte, 'duracao');
  assert.equal(retryAfter.resetEm, new Date(AGORA + 3600 * 1000).toISOString());

  const relogio = parseRateLimit('Claude usage limit reached. Resets at 3pm', AGORA);
  assert.ok(relogio);
  assert.equal(relogio.fonte, 'relogio');
  assert.ok(relogio.resetEm);
  assert.ok(new Date(relogio.resetEm).getTime() > AGORA, 'o relogio resolve para a PROXIMA ocorrencia');

  // O texto fala de limite e NAO diz a hora: horario null e fonte declarada, nunca chute.
  const semHora = parseRateLimit('Error: 429 Too Many Requests');
  assert.ok(semHora);
  assert.equal(semHora.fonte, 'sem-horario');
  assert.equal(semHora.resetEm, null);

  // Texto que nao fala de limite nenhum nao vira sinal de rate limit.
  assert.equal(parseRateLimit('erro: arquivo nao encontrado'), null);
  assert.equal(parseRateLimit(''), null);
});

test('fase morta por rate limit vira pedido na fila duravel, com o prompt exato', (t) => {
  const p = projetoTemporario('b3-fila');
  const runtime = runtimeFalso('b3-fila');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'fila de rate limit', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit('Claude AI usage limit reached|1757012400\n');

  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente a fatia 1' });

  assert.equal(r.motivo, 'runtime.rate-limited');
  assert.equal(r.bloqueado, false, 'rate limit nao e reprovacao de gate: e infraestrutura');
  assert.equal(r.sessionId, null);
  assert.ok(r.naFila, 'a fase morta entrou na fila duravel');
  assert.equal(r.naFila.estado, 'aguardando');
  assert.equal(r.naFila.janelaEstimada, false, 'o runtime disse a hora: janela nao e estimada');
  assert.equal(r.naFila.liberaEm, new Date(1757012400 * 1000).toISOString());
  assert.equal(r.naFila.promptSha256, r.promptSha256);

  // O prompt exato ficou em disco, e e ele que sera redespachado.
  const prompt = path.join(p.dir, r.naFila.promptPath);
  assert.ok(fs.existsSync(prompt), 'o prompt da fase morta continua gravado');

  const ledger = lerLedger(dirThread(p.dir, thread.id));
  const detectado = ledger.find((e) => e.tipo === 'rate_limit_detected');
  assert.ok(detectado);
  assert.equal(detectado.fonte, 'epoch');
  const enfileirado = ledger.find((e) => e.tipo === 'rate_limit_queued');
  assert.ok(enfileirado);
  assert.equal(enfileirado.pedido, r.naFila.id);

  // Nenhuma sessao entrou na thread: a fase nao aconteceu.
  assert.equal(lerThread(p.dir, thread.id).sessoes.length, 0);
});

test('sem hora no stderr, a janela vem do manifesto e sai DECLARADA como estimativa', (t) => {
  const p = projetoTemporario('b3-estimada');
  const runtime = runtimeFalso('b3-estimada');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });
  ajustarManifesto(p, /  janela_padrao_min: 60/, '  janela_padrao_min: 15');

  const { thread } = novaThread(p.carregado, { nome: 'janela estimada', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit('Error: 429 Too Many Requests\n');
  const antes = Date.now();
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente' });

  assert.ok(r.naFila);
  assert.equal(r.naFila.janelaEstimada, true);
  assert.equal(r.naFila.sinal.fonte, 'sem-horario');
  assert.equal(r.naFila.sinal.resetEm, null, 'o `ork` nao inventa horario de reset');
  const espera = new Date(r.naFila.liberaEm).getTime() - antes;
  assert.ok(espera > 14 * 60 * 1000 && espera <= 16 * 60 * 1000, `janela de 15 min, veio ${espera}ms`);
});

test('a fase morta por rate limit e retomada SEM humano na janela seguinte', (t) => {
  const p = projetoTemporario('b3-retomada');
  const runtime = runtimeFalso('b3-retomada');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  // `#Auto`: zero pausas humanas previstas. A retomada tem que andar sozinha.
  const { thread } = novaThread(p.carregado, { nome: 'retomada auto', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit(
    'Claude AI usage limit reached|' + Math.floor((Date.now() + 3600_000) / 1000) + '\n'
  );
  const morta = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente a fatia 1' });
  assert.equal(morta.motivo, 'runtime.rate-limited');
  const pedido = morta.naFila;
  assert.ok(pedido);

  // ANTES da janela: a fila nao mexe. Retomar cedo seria bater no limite de novo.
  const cedo = new Date(Date.now() - 60_000).toISOString();
  assert.equal(vencidos(p.dir, cedo).length, 0);
  assert.equal(retomarFila(p.carregado, { quando: cedo }).length, 0);

  // NA JANELA SEGUINTE: o `ork` retoma sozinho, sem toque humano.
  const depois = new Date(new Date(pedido.liberaEm).getTime() + 1000).toISOString();
  const [r] = retomarFila(p.carregado, { quando: depois });
  assert.ok(r, 'a janela liberou e a fila entregou o pedido');
  assert.equal(r.despachada, true);
  assert.equal(r.playbook, 'mesma-sessao');
  assert.equal(r.sessionId, runtime.sessionId);
  assert.equal(r.verificada, true, 're-verificado no runtime, nao self-report');
  assert.equal(r.pedido.estado, 'retomado');

  // A sessao entrou na thread com o MESMO prompt: retomada e o mesmo texto, nao outro.
  const depoisDaRetomada = lerThread(p.dir, thread.id);
  assert.equal(depoisDaRetomada.sessoes.length, 1);
  assert.equal(depoisDaRetomada.sessoes[0].promptSha256, morta.promptSha256);
  assert.equal(depoisDaRetomada.sessoes[0].fase, 'GO');

  const ledger = lerLedger(dirThread(p.dir, thread.id));
  const retomado = ledger.find((e) => e.tipo === 'rate_limit_resumed');
  assert.ok(retomado);
  assert.equal(retomado.playbook, 'mesma-sessao');
  assert.equal(retomado.promptSha256, morta.promptSha256);
  assert.equal(retomado.esperouAte, pedido.liberaEm);

  // Nenhuma autorizacao humana no meio do caminho.
  const humano = ledger.filter((e) => e.tipo === 'human_gate' && e.estado === 'aprovado');
  assert.equal(humano.length, 0, 'a retomada nao pediu autorizacao humana nenhuma');

  // E a fila nao retoma duas vezes o mesmo pedido.
  assert.equal(retomarFila(p.carregado, { quando: depois }).length, 0);
  assert.equal(lerFilaDeRetomada(p.dir).filter((x) => x.estado === 'retomado').length, 1);
});

test('playbook nova-sessao rotaciona o slug quando o gate de tokens manda rotacionar', (t) => {
  const p = projetoTemporario('b3-nova-sessao');
  const runtime = runtimeFalso('b3-nova-sessao');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'nova sessao', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit('rate limit exceeded, try again in 1 minute\n');
  const morta = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente' });
  assert.ok(morta.naFila);

  const depois = new Date(new Date(morta.naFila.liberaEm).getTime() + 1000).toISOString();
  // Janela lotada: o gate de tokens do B1 (nao uma regra nova do B3) manda abrir sessao.
  const r = retomarPorId(p.carregado, morta.naFila.id, {
    quando: depois,
    ocupacao: 0.95,
    fonte: 'informada',
  });

  assert.equal(r.playbook, 'nova-sessao');
  assert.equal(r.despachada, true);
  assert.notEqual(r.slug, morta.naFila.slug, 'a sessao nova nasce com slug proprio');
  assert.equal(runtime.chamadas().at(-1), r.slug, 'o runtime recebeu o slug rotacionado');
});

test('estourado o limite, a retomada escala para humano e pausa ate o modo #Auto', (t) => {
  const p = projetoTemporario('b3-escalada');
  const runtime = runtimeFalso('b3-escalada');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });
  ajustarManifesto(p, /  max_tentativas: 3/, '  max_tentativas: 1');

  const { thread } = novaThread(p.carregado, { nome: 'escalada auto', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit('usage limit reached, try again in 1 minute\n');
  const morta = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente' });
  assert.ok(morta.naFila);
  const depois = new Date(new Date(morta.naFila.liberaEm).getTime() + 1000).toISOString();

  // 1a retomada: dentro do limite, roda sozinha.
  const primeira = retomarPorId(p.carregado, morta.naFila.id, { quando: depois });
  assert.equal(primeira.despachada, true);
  assert.equal(primeira.pedido.tentativas, 1);

  // Forcando uma 2a retomada do mesmo pedido, o limite de escalacao fecha a porta.
  const segunda = retomarPorId(p.carregado, morta.naFila.id, { quando: depois, forcar: true });
  assert.equal(segunda.playbook, 'escalada');
  assert.equal(segunda.despachada, false);
  assert.equal(segunda.motivo, 'human.pending');
  assert.equal(segunda.pedido.estado, 'escalado');

  const ledger = lerLedger(dirThread(p.dir, thread.id));
  const bloqueio = ledger.filter((e) => e.tipo === 'gate_blocked' && e.motivo === 'human.pending');
  assert.equal(bloqueio.length, 1);
  assert.equal(bloqueio[0].pausaQualquerModo, true);
  assert.equal(bloqueio[0].modo, 'auto', 'a escalacao pausa ATE o modo #Auto');
  assert.ok(ledger.some((e) => e.tipo === 'retry_escalated'));
});

test('prompt alterado entre a morte e a janela recusa a retomada', (t) => {
  const p = projetoTemporario('b3-prompt-mudou');
  const runtime = runtimeFalso('b3-prompt-mudou');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'prompt mudou', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit('usage limit reached, try again in 1 minute\n');
  const morta = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente' });
  assert.ok(morta.naFila);

  // Alguem editou o prompt gravado. Isso deixa de ser retomada e vira outro despacho.
  fs.appendFileSync(path.join(p.dir, morta.naFila.promptPath), '\nlinha injetada por fora\n');

  const depois = new Date(new Date(morta.naFila.liberaEm).getTime() + 1000).toISOString();
  const r = retomarPorId(p.carregado, morta.naFila.id, { quando: depois });
  assert.equal(r.despachada, false);
  assert.equal(r.motivo, 'artifact.missing');
  assert.match(r.detalhe, /mudou desde o despacho original/);
  assert.equal(lerThread(p.dir, thread.id).sessoes.length, 0, 'nada foi despachado');
});
