/**
 * I-37 (P1 e P3): o verify distingue "nao rodou ate o fim" de "rodou e falhou", resolve o prazo
 * do manifesto e grava no ledger o teste que caiu, com a saida redigida.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adicionarClaim, lerClaims } from '../src/claims';
import { carregarManifesto } from '../src/manifest';
import { lerLedger } from '../src/ledger';
import { redigirSaida, testesQueCairam } from '../src/redacao-saida';
import { POLITICA_DE_RETRY } from '../src/retry';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { dirThread, novaThread } from '../src/thread';
import { ambienteDoVerify, causaDoEncerramento, executar, prazoDoComando, TIMEOUT_VERIFY_MS, verificar } from '../src/verify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ajustarManifesto, projetoTemporario } from './apoio';

test('a causa separa estouro de prazo, falha, comando ausente e morte por sinal', () => {
  const estouro = executar('lento', 'sleep 5', process.cwd(), 1000);
  assert.equal(estouro.ok, false);
  assert.equal(estouro.causa, 'timeout');
  assert.equal(estouro.code, -1, 'o contrato antigo do estouro continua valendo');
  assert.equal(estouro.prazoMs, 1000);
  assert.ok((estouro.duracaoMs ?? 0) >= 900 && (estouro.duracaoMs ?? 0) < 5000, `duracao ${estouro.duracaoMs}`);

  const falha = executar('falha', 'echo "not ok 1 - soma negativa"; exit 3', process.cwd(), 10_000);
  assert.equal(falha.causa, 'exit');
  assert.equal(falha.code, 3);
  assert.deepEqual(falha.testeQueCaiu, ['soma negativa']);
  assert.match(falha.trecho ?? '', /soma negativa/);

  assert.equal(executar('ausente', 'comando-que-nao-existe-ork-37', process.cwd(), 10_000).causa, 'nao-encontrado');

  const passou = executar('passou', 'true', process.cwd(), 10_000);
  assert.equal(passou.causa, 'exit');
  assert.equal(passou.trecho, undefined, 'sucesso nao leva trecho: a evidencia e o codigo 0');
});

test('a classificacao da causa, caso a caso, com e sem o timeout(1) na frente', () => {
  const base = { signal: null, comGrupo: true, duracaoMs: 60_000, tetoMs: 60_000 };
  assert.equal(causaDoEncerramento({ ...base, code: 124 }), 'timeout');
  assert.equal(causaDoEncerramento({ ...base, code: 137 }), 'timeout');
  assert.equal(causaDoEncerramento({ ...base, code: 137, duracaoMs: 10 }), 'sinal', 'SIGKILL cedo nao e estouro');
  assert.equal(causaDoEncerramento({ ...base, code: 124, duracaoMs: 10 }), 'exit', 'saida 124 cedo e do proprio comando');
  assert.equal(causaDoEncerramento({ ...base, code: 143, duracaoMs: 10 }), 'sinal');
  assert.equal(causaDoEncerramento({ ...base, code: 127 }), 'nao-encontrado');
  assert.equal(causaDoEncerramento({ ...base, comGrupo: false, code: -1, error: 'ETIMEDOUT' }), 'timeout');
  assert.equal(causaDoEncerramento({ ...base, comGrupo: false, code: -1, error: 'ENOENT' }), 'nao-encontrado');
  assert.equal(causaDoEncerramento({ ...base, comGrupo: false, code: -1, signal: 'SIGTERM' }), 'sinal');
  assert.equal(causaDoEncerramento({ ...base, code: 1, duracaoMs: 10 }), 'exit');
});

test('o comando de verificacao nunca herda a autoridade HITL, e o resto do ambiente chega', () => {
  const antes = { ...process.env };
  process.env.ORK_HITL_INGRESS_KEY = 'chave-SIMULADA-de-teste';
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_INGRESS_KEY_OPENCLAW = 'chave-SIMULADA-openclaw';
  try {
    assert.equal(Object.keys(ambienteDoVerify()).some((k) => k.startsWith('ORK_HITL_')), false);
    const r = executar('ambiente', 'test -z "$ORK_HITL_INGRESS_KEY$ORK_HITL_TELEGRAM_USERS$ORK_HITL_INGRESS_KEY_OPENCLAW" && test -n "$PATH" && test -n "$HOME"',
      process.cwd(), 10_000);
    assert.equal(r.ok, true, r.resumo);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
  }
});

test('o trecho vai redigido: credencial de URL some, e segredo descarta o trecho inteiro', () => {
  assert.match(redigirSaida('erro ao conectar em postgres://app:s3nh4@db:5432/x'), /\[credencial redigida\]@db:5432/);
  assert.match(redigirSaida('token sk-' + 'ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA vazou'), /^\[trecho omitido: padrao chave da Anthropic casou\]$/);
  assert.equal(redigirSaida('x'.repeat(5000)).length, 1024, 'o trecho guarda o fim da saida, ate 1024');
  assert.deepEqual(testesQueCairam('ok 1 - a\nnot ok 2 - b # TODO\nFAIL src/c.test.ts\nnot ok 2 - b'), ['b', 'src/c.test.ts']);
});

test('o motivo verify.timeout existe nos dois mapas, e o retry reexecuta em vez de abrir GO-FIX', () => {
  assert.match(DESCRICAO_DO_MOTIVO['verify.timeout'], /estourou o prazo/);
  assert.equal(POLITICA_DE_RETRY['verify.timeout'].acao, 'reexecutar');
  assert.equal(POLITICA_DE_RETRY['verify.timeout'].automatica, true);
});

test('o prazo sai do manifesto: por comando vence o default, que vence a constante', () => {
  const p = projetoTemporario('verify-prazo');
  try {
    assert.equal(prazoDoComando(p.carregado.manifesto, 'test'), TIMEOUT_VERIFY_MS);
    ajustarManifesto(p, '  # test: nao detectado', '  timeout_ms: 120000\n  timeout_ms_por_comando:\n    test: 300000');
    assert.equal(prazoDoComando(p.carregado.manifesto, 'test'), 300_000);
    assert.equal(prazoDoComando(p.carregado.manifesto, 'build'), 120_000);
    assert.equal(prazoDoComando(p.carregado.manifesto, 'C1.1'), 120_000, 'claim usa o default do projeto');

    const yaml = path.join(p.dir, 'orkastery.yaml');
    fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace('  timeout_ms: 120000', '  timeout_ms: 10'), 'utf8');
    const invalido = carregarManifesto(p.dir);
    assert.ok(invalido?.erros.some((e) => e.includes('verify.timeout_ms precisa ser um inteiro')), invalido?.erros.join(' | '));
  } finally {
    p.limpar();
  }
});

test('verify: estouro vira verify.timeout, fica fora das falhas e nao reprova a alegacao', () => {
  const p = projetoTemporario('verify-estouro');
  try {
    ajustarManifesto(p, '  # test: nao detectado', '  test: "sleep 3"\n  timeout_ms: 1000');
    const t = novaThread(p.carregado, { nome: 'estouro', modo: 'auto' }).thread;
    const lenta = adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'demora', verificar: ['sleep 3'] });
    const quebrada = adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'quebra',
      verificar: ['echo "not ok 1 - caso ruim"; echo "senha em postgres://u:segredo@h/db"; exit 1'] });

    const r = verificar(p.carregado, t.id);
    assert.equal(r.ok, false);
    assert.deepEqual(r.estouros.map((c) => c.nome), ['test']);
    assert.deepEqual(r.falhasSemBaseline, [], 'estouro nao e falha sem baseline');
    assert.ok(r.motivos.includes('verify.timeout') && r.motivos.includes('claims.failed'), r.motivos.join(','));
    assert.equal(r.claims.find((c) => c.claim.id === lenta.id)?.motivo, 'verify.timeout');

    const estados = new Map(lerClaims(p.dir, t.id).map((c) => [c.id, c.estado]));
    assert.equal(estados.get(quebrada.id), 'reprovado');
    assert.notEqual(estados.get(lenta.id), 'reprovado', 'estouro nao desmente a alegacao');

    const evento = lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'verify_run').at(-1) as Record<string, unknown>;
    const comandos = evento.comandos as Record<string, unknown>[];
    assert.equal(comandos[0].causa, 'timeout');
    assert.equal(comandos[0].prazoMs, 1000);
    assert.deepEqual(evento.estouros, ['test']);
    const claimQuebrada = (evento.claims as Record<string, unknown>[]).find((c) => c.id === quebrada.id) as Record<string, Record<string, unknown>>;
    assert.deepEqual(claimQuebrada.execucao.testeQueCaiu, ['caso ruim']);
    assert.match(String(claimQuebrada.execucao.trecho), /\[credencial redigida\]@h\/db/);
    assert.doesNotMatch(JSON.stringify(evento), /segredo@/);
  } finally {
    p.limpar();
  }
});
