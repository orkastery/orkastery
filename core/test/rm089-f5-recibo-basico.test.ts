/** RM-089 F5: projeção versionada e recibo de saída do runner. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CONTRATO_PROJECAO_REPLAY_CI,
  CONTRATO_RECIBO_RUNNER_CI,
  criarProjecaoReplayCi,
  emitirReciboRunnerCi,
  estadoDoReciboRunnerCi,
  reexecutarProjecaoReplayCi,
  validarProjecaoReplayCi,
} from '../src/ci-recibo-basico';
import type { Claim, Manifesto, ResultadoDeComando } from '../src/types';

const HEAD_A = 'a'.repeat(40), HEAD_B = 'b'.repeat(40);

const claim = (id = 'C1'): Claim => ({
  id,
  thread: 'ork-rm089f5recib',
  fase: 'GO',
  arquivo: 'core/src/ci.ts',
  alegacao: 'o runner emite o recibo do HEAD executado',
  negativa: false,
  verificar: ['node --test core/dist-test/test/rm089-f5-recibo-basico.test.js'],
  criadoEm: '2026-11-12T00:00:00.000Z',
  estado: 'pendente',
});

function projecao(opcoes: { claims?: Claim[]; commands?: Array<{ name: string; command: string }>;
  preparo?: string; baselineOk?: boolean } = {}) {
  const commands = opcoes.commands ?? [{ name: 'build', command: 'npm --prefix core run build' }];
  return criarProjecaoReplayCi({
    thread: 'ork-rm089f5recib',
    claims: opcoes.claims ?? [claim()],
    check: 'agile',
    baseline: { commit: 'c'.repeat(40), comandos: commands.map((command) => ({
      nome: command.name, comando: command.command, ok: opcoes.baselineOk ?? true,
      code: opcoes.baselineOk === false ? 1 : 0, resumo: '', causa: 'exit', executado: true,
    })), check: { modo: 'agile' } },
    commands,
    preparo: opcoes.preparo,
  });
}

test('a projeção é a entrada versionada e não declara HEAD presente', () => {
  const entrada = projecao();
  assert.equal(entrada.contrato, CONTRATO_PROJECAO_REPLAY_CI);
  assert.equal('head' in entrada, false);
  assert.deepEqual(validarProjecaoReplayCi(entrada), { ok: true, projecao: entrada });

  const adulterada = { ...entrada, commands: [{ name: 'build', command: 'true' }] };
  assert.deepEqual(validarProjecaoReplayCi(adulterada), { ok: false, causa: 'invalida' });
});

test('o runner emite o recibo somente para o HEAD real do checkout', () => {
  const recibo = emitirReciboRunnerCi(projecao(), HEAD_A, { ok: true, motivos: [] });
  assert.equal(recibo.contrato, CONTRATO_RECIBO_RUNNER_CI);
  assert.equal(recibo.head, HEAD_A);
  assert.equal(recibo.resultado.ok, true);
  assert.equal(estadoDoReciboRunnerCi(recibo, HEAD_A), 'presente');
  assert.equal(estadoDoReciboRunnerCi(recibo, HEAD_B), 'sha-divergente');
  assert.equal('assinatura' in recibo, false, 'a F5 apenas reserva o campo no contrato');
});

const manifesto = {
  verify: { timeout_ms: 5_000, timeout_ms_por_comando: {} },
} as unknown as Manifesto;

function resultado(nome: string, comando: string, ok = true): ResultadoDeComando {
  return { nome, comando, ok, code: ok ? 0 : 1, resumo: ok ? 'ok' : 'falhou', causa: 'exit',
    prazoMs: 5_000, duracaoMs: 1, executado: true };
}

test('o replay usa allowlist e o mesmo julgamento do verify sem estado local', () => {
  for (const forja of ['github', 'gitlab'] as const) {
    const segredos = forja === 'github'
      ? { GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'segredo-github', DEPLOY_SECRET: 'segredo-deploy' }
      : { GITLAB_CI: 'true', CI_JOB_TOKEN: 'segredo-gitlab', DEPLOY_SECRET: 'segredo-deploy' };
    const vistos: NodeJS.ProcessEnv[] = [];
    const replay = reexecutarProjecaoReplayCi(projecao({ preparo: 'preparar',
      claims: [{ ...claim(), verificar: ['ler ambiente'] }],
      commands: [{ name: 'build', command: 'compilar' }] }), {
      raiz: '/checkout-sintetico',
      manifesto,
      head: HEAD_A,
      ambiente: { PATH: '/bin', LANG: 'pt_BR.UTF-8', ORK_HITL_KEY: 'autoridade', ...segredos },
      casaEfemera: '/tmp/ork-ci-replay-fixture',
      identidadeProduto: () => 'produto-estavel',
      hermeticidade: () => null,
      executor: ({ nome, comando, ambiente }) => {
        vistos.push(ambiente);
        const bloqueada = Object.keys(ambiente).some((chave) => chave === 'GITHUB_TOKEN' || chave === 'CI_JOB_TOKEN' ||
          chave.endsWith('_TOKEN') || chave.endsWith('_SECRET') || chave.startsWith('ORK_HITL_'));
        return resultado(nome, comando, !bloqueada);
      },
    });
    assert.equal(replay.ok, true, forja);
    assert.equal(replay.julgamento?.ok, true, forja);
    assert.equal(replay.recibo?.head, HEAD_A, forja);
    assert.ok(vistos.every((env) => env.CI === 'true' && env.ORK_CHECK_MODO === 'agile'), forja);
    const serializado = JSON.stringify(replay);
    for (const valor of Object.values(segredos).filter((valor) => valor.startsWith('segredo-'))) {
      assert.doesNotMatch(serializado, new RegExp(valor), `${forja}: segredo ausente da saída`);
    }
    assert.doesNotMatch(serializado, /autoridade/);
  }
});

test('falha real e guarda do produto não viram recibo verde parcial', () => {
  const regressao = reexecutarProjecaoReplayCi(projecao({ commands: [{ name: 'build', command: 'falhar' }] }), {
    raiz: '/checkout-sintetico', manifesto, head: HEAD_A, casaEfemera: '/tmp/ork-ci-replay-fixture',
    identidadeProduto: () => 'produto-estavel', hermeticidade: () => null,
    executor: ({ nome, comando }) => resultado(nome, comando, nome !== 'build'),
  });
  assert.equal(regressao.ok, false);
  assert.ok(regressao.julgamento?.motivos.includes('verify.regression'));
  assert.equal(regressao.recibo?.resultado.ok, false);

  const identidades = ['depois-do-preparo', 'alterado'];
  const alterado = reexecutarProjecaoReplayCi(projecao({ preparo: 'preparar' }), {
    raiz: '/checkout-sintetico', manifesto, head: HEAD_A, casaEfemera: '/tmp/ork-ci-replay-fixture',
    identidadeProduto: () => identidades.shift()!, hermeticidade: () => null,
    executor: ({ nome, comando }) => resultado(nome, comando),
  });
  assert.equal(alterado.degradacao, 'produto-alterado');
  assert.equal(alterado.recibo, undefined);
});
