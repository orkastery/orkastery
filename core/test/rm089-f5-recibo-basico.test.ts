/** RM-089 F5: projeção versionada e recibo de saída do runner. */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  CAUSAS_DEGRADACAO_REPLAY_CI,
  CODIGO_DA_DEGRADACAO_REPLAY_CI,
  CONTRATO_PROJECAO_REPLAY_CI,
  CONTRATO_RECIBO_RUNNER_CI,
  criarProjecaoReplayCi,
  emitirReciboRunnerCi,
  estadoDoReciboRunnerCi,
  reexecutarProjecaoReplayCi,
  validarProjecaoReplayCi,
} from '../src/ci-recibo-basico';
import { executarCiDaBranchComContexto, publicarAvisoDaPolitica, receitaConfiavelDoDestino } from '../src/ci';
import { comLocale, msg } from '../src/locale';
import type { ManifestoCarregado } from '../src/manifest';
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
  assert.ok(regressao.julgamento?.motivos.includes('verify.failed'));
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

test('R1: o replay recusa preparo ausente ou diferente da receita protegida', () => {
  const receitaConfiavel = {
    commands: [{ name: 'build', command: 'npm --prefix core run build' }],
    preparo: 'npm --prefix core run build:test',
  };
  for (const preparo of [undefined, 'node -e "process.exit(0)"']) {
    const entrada = projecao({ preparo });
    const replay = reexecutarProjecaoReplayCi(entrada, {
      raiz: '/checkout-sintetico', manifesto, head: HEAD_A, casaEfemera: '/tmp/ork-ci-replay-fixture',
      identidadeProduto: () => 'produto-estavel', hermeticidade: () => null,
      executor: ({ nome, comando }) => resultado(nome, comando),
      receitaConfiavel,
    } as Parameters<typeof reexecutarProjecaoReplayCi>[1]);
    assert.equal(replay.invalida, true, preparo ?? 'preparo ausente');
    assert.equal(replay.recibo, undefined, preparo ?? 'preparo ausente');
  }
});

test('R2: baseline projetada não transforma falha atual em dívida preexistente', () => {
  const entrada = projecao({ baselineOk: false });
  const replay = reexecutarProjecaoReplayCi(entrada, {
    raiz: '/checkout-sintetico', manifesto, head: HEAD_A, casaEfemera: '/tmp/ork-ci-replay-fixture',
    identidadeProduto: () => 'produto-estavel', hermeticidade: () => null,
    receitaConfiavel: { commands: entrada.commands },
    executor: ({ nome, comando }) => resultado(nome, comando, nome !== 'build'),
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.julgamento?.ok, false);
  assert.ok(replay.julgamento?.motivos.includes('verify.failed'));
  assert.equal(replay.recibo?.resultado.ok, false);
});

function carregado(raiz: string, nivel?: 'observar' | 'avisar' | 'exigir'): ManifestoCarregado {
  return { raiz, caminho: path.join(raiz, 'orkastery.yaml'), legado: false, bytes: 0, erros: [], avisos: [], manifesto: {
    ...manifesto,
    worktree: { base_branch: 'main' },
    ci: { required_for_ship: false, context: 'ork-verify', external_repositories: {},
      ...(nivel ? { politica_recibo: nivel } : {}) },
  } as Manifesto };
}

function fixtureDaPolitica(branch = 'feature/externa') {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm089-f5-'));
  const entrada = projecao();
  fs.mkdirSync(path.join(raiz, '.ork-ci'), { recursive: true });
  fs.writeFileSync(path.join(raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
    schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch, base: 'main',
    claims: entrada.claims, commands: entrada.commands, recibo: entrada,
  }));
  return { raiz, branch, entrada, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

test('a âncora lê os comandos e o preparo somente do manifesto da ref de destino', () => {
  const lidas: Array<{ ref: string; arquivo: string }> = [];
  const receita = receitaConfiavelDoDestino('/checkout', 'main', (ref, arquivo) => {
    lidas.push({ ref, arquivo });
    return ref === 'refs/remotes/origin/main' && arquivo === 'orkastery.yaml'
      ? 'verify:\n  preparo: npm --prefix core run build:test\n  build: npm --prefix core run build\n  test: npm --prefix core test\n' : null;
  });
  assert.deepEqual(receita, {
    commands: [
      { name: 'build', command: 'npm --prefix core run build' },
      { name: 'test', command: 'npm --prefix core test' },
    ],
    preparo: 'npm --prefix core run build:test',
  });
  assert.deepEqual(lidas, [{ ref: 'refs/remotes/origin/main', arquivo: 'orkastery.yaml' }]);
  assert.equal(receitaConfiavelDoDestino('/checkout', '../main', () => { throw new Error('não lê'); }), null);
});

test('o caminho integrado usa a leitura de produção da receita protegida', () => {
  const f = fixtureDaPolitica();
  try {
    const entrada = projecao({ preparo: 'npm --prefix core run build:test' });
    fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
      schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
      claims: entrada.claims, commands: entrada.commands, recibo: entrada,
    }));
    const lidas: string[] = [];
    const saida = executarCiDaBranchComContexto(carregado(f.raiz, 'exigir'), f.branch, {
      destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
      lerManifestoDestino: (ref, arquivo) => {
        lidas.push(`${ref}:${arquivo}`);
        return ref === 'refs/remotes/origin/main' && arquivo === 'orkastery.yaml'
          ? 'verify:\n  preparo: npm --prefix core run build:test\n  build: npm --prefix core run build\n' : null;
      },
      replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => 'produto',
        hermeticidade: () => null, executor: ({ nome, comando }) => resultado(nome, comando) },
    }) as { ok: boolean; policy: { receipt: string } };
    assert.equal(saida.ok, true);
    assert.equal(saida.policy.receipt, 'presente');
    assert.deepEqual(lidas, ['refs/remotes/origin/main:orkastery.yaml']);
  } finally { f.limpar(); }
});

test('R1 integrado: exigir recusa preparo ausente ou trocado pelo PR', () => {
  const f = fixtureDaPolitica();
  try {
    for (const preparo of [undefined, 'node -e "process.exit(0)"']) {
      const entrada = projecao({ preparo });
      fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
        schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
        claims: entrada.claims, commands: entrada.commands, recibo: entrada,
      }));
      const saida = executarCiDaBranchComContexto(carregado(f.raiz, 'exigir'), f.branch, {
        destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
        receitaConfiavel: { commands: entrada.commands, preparo: 'npm --prefix core run build:test' },
        replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => 'produto',
          hermeticidade: () => null, executor: () => { throw new Error('preparo inválido não executa'); } },
      }) as { ok: boolean; policy: { receipt: string }; error: { code: string } };
      assert.equal(saida.ok, false, preparo ?? 'preparo ausente');
      assert.equal(saida.policy.receipt, 'invalido', preparo ?? 'preparo ausente');
      assert.equal(saida.error.code, 'ci.recibo.invalido', preparo ?? 'preparo ausente');
    }
  } finally { f.limpar(); }
});

test('R2 integrado: baseline do PR não mascara comando vermelho em nenhum nível', () => {
  const f = fixtureDaPolitica();
  try {
    const entrada = projecao({ baselineOk: false });
    fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
      schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
      claims: entrada.claims, commands: entrada.commands, recibo: entrada,
    }));
    for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
      const saida = executarCiDaBranchComContexto(carregado(f.raiz, nivel), f.branch, {
        destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
        receitaConfiavel: { commands: entrada.commands },
        replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => 'produto',
          hermeticidade: () => null,
          executor: ({ nome, comando }) => resultado(nome, comando, nome !== 'build') },
      }) as unknown as { ok: boolean; verify: { ok: boolean; motivos: string[]; preExistentes: unknown[] } };
      assert.equal(saida.ok, false, nivel);
      assert.equal(saida.verify.ok, false, nivel);
      assert.ok(saida.verify.motivos.includes('verify.failed'), nivel);
      assert.deepEqual(saida.verify.preExistentes, [], nivel);
    }
  } finally { f.limpar(); }
});

test('exigir recusa de forma tipada projeção vazia ou com receita trocada pelo PR', () => {
  const f = fixtureDaPolitica();
  try {
    const executar = (commands: Array<{ name: string; command: string }>) => {
      const entrada = projecao({ claims: [claim()], commands });
      fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
        schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
        claims: entrada.claims, commands, recibo: entrada,
      }));
      return executarCiDaBranchComContexto(carregado(f.raiz, 'exigir'), f.branch, {
        destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
        receitaConfiavel: { commands: [{ name: 'build', command: 'npm --prefix core run build' }] },
        replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => 'produto',
          hermeticidade: () => null, executor: () => { throw new Error('receita inválida não executa'); } },
      } as Parameters<typeof executarCiDaBranchComContexto>[2]) as {
        ok: boolean; policy: { receipt: string }; error: { code: string };
      };
    };

    const vazia = projecao({ claims: [], commands: [] });
    fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
      schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
      claims: [], commands: [], recibo: vazia,
    }));
    const resultadoVazio = executarCiDaBranchComContexto(carregado(f.raiz, 'exigir'), f.branch, {
      destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
      receitaConfiavel: { commands: [{ name: 'build', command: 'npm --prefix core run build' }] },
      replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => 'produto',
        hermeticidade: () => null, executor: () => { throw new Error('receita vazia não executa'); } },
    } as Parameters<typeof executarCiDaBranchComContexto>[2]) as {
      ok: boolean; policy: { receipt: string }; error: { code: string };
    };
    assert.equal(resultadoVazio.ok, false);
    assert.equal(resultadoVazio.policy.receipt, 'invalido');
    assert.equal(resultadoVazio.error.code, 'ci.recibo.invalido');

    const trocada = executar([{ name: 'build', command: 'node -e "process.exit(0)"' }]);
    assert.equal(trocada.ok, false);
    assert.equal(trocada.policy.receipt, 'invalido');
    assert.equal(trocada.error.code, 'ci.recibo.invalido');
  } finally { f.limpar(); }
});

test('GitHub e GitLab aplicam a mesma política a branch ork, externa, interna e fork', () => {
  for (const branch of ['ork/ork-rm089f5recib-full', 'feature/externa']) for (const fork of [false, true]) {
    const f = fixtureDaPolitica(branch);
    try {
      const origem = fork ? 'fork/projeto' : 'empresa/projeto';
      const evento = path.join(f.raiz, 'evento.json');
      fs.writeFileSync(evento, JSON.stringify({ pull_request: { head: { repo: { full_name: origem } },
        base: { repo: { full_name: 'empresa/projeto' } } } }));
      const ambientes = [
        { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: evento,
          GITHUB_REPOSITORY: 'empresa/projeto', GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: f.branch },
        { GITLAB_CI: 'true', CI_PROJECT_PATH: 'empresa/projeto', CI_PROJECT_ID: '1',
          CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: origem, CI_MERGE_REQUEST_SOURCE_PROJECT_ID: fork ? '2' : '1',
          CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: f.branch, CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main' },
      ];
      for (const env of ambientes) for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
        const saida = executarCiDaBranchComContexto(carregado(f.raiz, nivel), f.branch, {
          env, destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
          receitaConfiavel: { commands: f.entrada.commands },
          replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => 'produto',
            hermeticidade: () => null, executor: ({ nome, comando }) => resultadoComando(nome, comando) },
        }) as { ok: boolean; commit: string; recibo?: { head: string }; policy: { receipt: string } };
        assert.equal(saida.ok, true, `${branch}/${fork}/${nivel}/${'GITHUB_ACTIONS' in env ? 'github' : 'gitlab'}`);
        assert.equal(saida.commit, HEAD_A);
        assert.equal(saida.recibo?.head, HEAD_A);
        assert.equal(saida.policy.receipt, 'presente');
      }
    } finally { f.limpar(); }
  }
});

test('falha real de claim e comando reprova os três níveis mesmo junto de degradação', () => {
  const f = fixtureDaPolitica();
  try {
    const entrada = projecao({ claims: [{ ...claim(), verificar: ['falhar claim'] }],
      commands: [{ name: 'build', command: 'falhar comando' }] });
    fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
      schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
      claims: entrada.claims, commands: entrada.commands, recibo: entrada,
    }));
    for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
      const identidades = ['antes', 'depois'];
      const saida = executarCiDaBranchComContexto(carregado(f.raiz, nivel), f.branch, {
        destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
        receitaConfiavel: { commands: entrada.commands },
        replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => identidades.shift()!,
          hermeticidade: () => null, executor: ({ nome, comando }) => resultado(nome, comando, false) },
      } as Parameters<typeof executarCiDaBranchComContexto>[2]) as unknown as {
        ok: boolean; verify: { ok: boolean; motivos: string[] }; error: { code: string };
      };
      assert.equal(saida.ok, false, nivel);
      assert.equal(saida.verify.ok, false, nivel);
      assert.ok(saida.verify.motivos.includes('claims.failed'), nivel);
      assert.ok(saida.verify.motivos.includes('verify.failed'), nivel);
      assert.equal(saida.error.code, 'ci.recibo.produto-alterado', nivel);
    }
  } finally { f.limpar(); }
});

test('recibo inválido descreve receita, recibo do runner e HEAD exato em pt-BR e inglês', () => {
  const f = fixtureDaPolitica();
  try {
    const entrada = projecao();
    fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
      schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
      claims: entrada.claims, commands: entrada.commands, recibo: { ...entrada, sha256: '0'.repeat(64) },
    }));
    const executar = () => executarCiDaBranchComContexto(carregado(f.raiz, 'exigir'), f.branch, {
      destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
      receitaConfiavel: { commands: entrada.commands },
    } as Parameters<typeof executarCiDaBranchComContexto>[2]) as { error: { message: string } };
    const pt = comLocale('pt-BR', executar).error.message;
    const en = comLocale('en', executar).error.message;
    assert.match(pt, /receita.*recibo do runner.*HEAD exato/i);
    assert.match(en, /recipe.*runner receipt.*exact HEAD/i);
    assert.doesNotMatch(pt, /ancestral/i);
    assert.doesNotMatch(en, /ancestor/i);
  } finally { f.limpar(); }
});

function resultadoComando(nome: string, comando: string, opcoes: { causa?: 'exit' | 'timeout' | 'nao-encontrado';
  executado?: boolean } = {}): ResultadoDeComando {
  const causa = opcoes.causa ?? 'exit';
  const ok = causa === 'exit';
  return { nome, comando, ok, code: ok ? 0 : -1, resumo: '', causa, prazoMs: 5_000,
    duracaoMs: 1, executado: opcoes.executado ?? causa !== 'nao-encontrado' };
}

test('as seis causas de degradação formam união fechada e nunca geram recibo', () => {
  const base = { raiz: '/checkout-sintetico', manifesto, head: HEAD_A,
    casaEfemera: '/tmp/ork-ci-replay-fixture', identidadeProduto: () => 'produto', hermeticidade: () => null };
  const enorme = projecao({ claims: [], commands: [{ name: 'build', command: 'x'.repeat(1024 * 1024) }] });
  const identidades = ['produto', 'alterado'];
  const casos = [
    reexecutarProjecaoReplayCi(enorme, base),
    reexecutarProjecaoReplayCi(projecao({ claims: [{ ...claim(), arquivo: '.orkastery/claims.jsonl' }] }),
      { ...base, hermeticidade: undefined }),
    reexecutarProjecaoReplayCi(projecao(), { ...base, capacidade: () => false }),
    reexecutarProjecaoReplayCi(projecao(), { ...base,
      executor: ({ nome, comando }) => resultadoComando(nome, comando, { causa: 'nao-encontrado', executado: false }) }),
    reexecutarProjecaoReplayCi(projecao(), { ...base,
      executor: ({ nome, comando }) => resultadoComando(nome, comando, { causa: 'timeout' }) }),
    reexecutarProjecaoReplayCi(projecao(), { ...base, identidadeProduto: () => identidades.shift()!,
      executor: ({ nome, comando }) => resultadoComando(nome, comando) }),
  ];
  assert.deepEqual(casos.map((caso) => caso.degradacao), [...CAUSAS_DEGRADACAO_REPLAY_CI]);
  assert.ok(casos.every((caso) => caso.recibo === undefined));
  assert.deepEqual(Object.keys(CODIGO_DA_DEGRADACAO_REPLAY_CI).sort(), [...CAUSAS_DEGRADACAO_REPLAY_CI].sort());
});

test('as seis degradações têm código, mensagem e ação em pt-BR e inglês', () => {
  for (const causa of CAUSAS_DEGRADACAO_REPLAY_CI) {
    const pt = comLocale('pt-BR', () => msg().operacao.produto.ci.degradacaoReplay[causa]);
    const en = comLocale('en', () => msg().operacao.produto.ci.degradacaoReplay[causa]);
    assert.equal(CODIGO_DA_DEGRADACAO_REPLAY_CI[causa], `ci.recibo.${causa}`);
    assert.notEqual(pt.mensagem, en.mensagem, causa);
    assert.notEqual(pt.acao, en.acao, causa);
  }
});

test('as cinco degradações de execução percorrem a política integrada nas duas línguas', () => {
  const f = fixtureDaPolitica();
  try {
    const naoHermetica = projecao({ claims: [{ ...claim(), arquivo: '.orkastery/claims.jsonl' }] });
    const casos: Array<{
      causa: typeof CAUSAS_DEGRADACAO_REPLAY_CI[number];
      entrada: ReturnType<typeof projecao>;
      replay: () => NonNullable<Parameters<typeof executarCiDaBranchComContexto>[2]>['replay'];
    }> = [
      { causa: 'claim-nao-hermetica', entrada: naoHermetica,
        replay: () => ({ hermeticidade: () => 'artifact-not-in-checkout' }) },
      { causa: 'runner-sem-capacidade', entrada: projecao(), replay: () => ({ capacidade: () => false }) },
      { causa: 'comando-nao-iniciado', entrada: projecao(), replay: () => ({
        executor: ({ nome, comando }) => nome === 'build'
          ? resultadoComando(nome, comando, { causa: 'nao-encontrado', executado: false })
          : resultadoComando(nome, comando),
      }) },
      { causa: 'prazo-excedido', entrada: projecao(), replay: () => ({
        executor: ({ nome, comando }) => nome === 'build'
          ? resultadoComando(nome, comando, { causa: 'timeout' })
          : resultadoComando(nome, comando),
      }) },
      { causa: 'produto-alterado', entrada: projecao(), replay: () => {
        const identidades = ['antes', 'depois'];
        return { identidadeProduto: () => identidades.shift()!,
          executor: ({ nome, comando }) => resultadoComando(nome, comando) };
      } },
    ];
    for (const caso of casos) {
      fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
        schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
        claims: caso.entrada.claims, commands: caso.entrada.commands, recibo: caso.entrada,
      }));
      const executar = () => executarCiDaBranchComContexto(carregado(f.raiz, 'exigir'), f.branch, {
        destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
        receitaConfiavel: { commands: caso.entrada.commands },
        replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => 'produto',
          hermeticidade: () => null,
          ...caso.replay() },
      }) as { policy: { receipt: string; message: string; action: string };
        error: { code: string; message: string; action: string } };
      const pt = comLocale('pt-BR', executar), en = comLocale('en', executar);
      const codigo = CODIGO_DA_DEGRADACAO_REPLAY_CI[caso.causa];
      assert.equal(pt.policy.receipt, 'invalido', caso.causa);
      assert.equal(pt.error.code, codigo, caso.causa);
      assert.equal(en.error.code, codigo, caso.causa);
      assert.notEqual(pt.policy.message, en.policy.message, caso.causa);
      assert.notEqual(pt.policy.action, en.policy.action, caso.causa);
    }
  } finally { f.limpar(); }
});

test('degradação não reprova observar ou avisar, exige no protegido e sai com ação bilíngue', () => {
  const f = fixtureDaPolitica();
  try {
    for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
      const executar = () => executarCiDaBranchComContexto(carregado(f.raiz, nivel), f.branch, {
        destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A,
        env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'empresa/projeto', GITHUB_BASE_REF: 'main' },
        receitaConfiavel: { commands: f.entrada.commands },
        replay: { casaEfemera: path.join(f.raiz, 'casa'), identidadeProduto: () => 'produto',
          hermeticidade: () => null, capacidade: () => false },
      }) as { ok: boolean; policy: { receipt: string; message: string; action: string };
        error: { code: string; message: string; action: string } };
      const pt = comLocale('pt-BR', executar), en = comLocale('en', executar);
      assert.equal(pt.ok, nivel !== 'exigir', nivel);
      assert.equal(pt.policy.receipt, 'invalido');
      assert.equal(pt.error.code, 'ci.recibo.runner-sem-capacidade');
      assert.match(pt.policy.action, /Disponibilize/);
      assert.match(en.policy.action, /Provide/);
      assert.notEqual(pt.policy.message, en.policy.message);
    }

    fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
      schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main', claims: [], commands: [],
    }));
    const historico = executarCiDaBranchComContexto(carregado(f.raiz), f.branch,
      { preflightEmpresa: null, head: HEAD_A });
    assert.deepEqual(Object.keys(historico).sort(),
      ['branch', 'bundle', 'claims', 'commands', 'commit', 'ok', 'preparo', 'schema', 'thread']);
    assert.equal(historico.ok, true);
  } finally { f.limpar(); }
});

test('avisar publica diagnóstico sem expor os segredos sintéticos do ambiente', () => {
  const f = fixtureDaPolitica();
  try {
    const entrada = projecao();
    fs.writeFileSync(path.join(f.raiz, '.ork-ci/ork-rm089f5recib.json'), JSON.stringify({
      schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f5recib', branch: f.branch, base: 'main',
      claims: entrada.claims, commands: entrada.commands, recibo: { ...entrada, sha256: '0'.repeat(64) },
    }));
    for (const env of [
      { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'empresa/projeto', GITHUB_BASE_REF: 'main',
        GITHUB_TOKEN: 'segredo-github', DEPLOY_SECRET: 'segredo-deploy' },
      { GITLAB_CI: 'true', CI_PROJECT_PATH: 'empresa/projeto', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
        CI_JOB_TOKEN: 'segredo-gitlab', DEPLOY_SECRET: 'segredo-deploy' },
    ]) {
      const resultado = executarCiDaBranchComContexto(carregado(f.raiz, 'avisar'), f.branch, {
        destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD_A, env,
        receitaConfiavel: { commands: entrada.commands },
      } as Parameters<typeof executarCiDaBranchComContexto>[2]);
      const linhas: string[] = [];
      publicarAvisoDaPolitica(resultado, env, (linha) => linhas.push(linha));
      assert.ok(linhas.length > 0);
      assert.doesNotMatch(JSON.stringify(linhas), /segredo-(?:github|gitlab|deploy)/);
    }
  } finally { f.limpar(); }
});

test('guias e contrato distinguem projeção, replay e recibo sem prometer autoria', () => {
  const raiz = path.resolve(__dirname, '../../..');
  const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
  const pt = ler('docs/guias/politica-de-recibo-da-empresa.pt-BR.md');
  const en = ler('docs/guias/politica-de-recibo-da-empresa.md');
  const forja = ler('docs/referencia/contratos/forja.md');
  for (const texto of [pt, en, forja]) {
    assert.match(texto, /ork\.ci-projecao-replay\/v1/);
    assert.match(texto, /ork\.ci-recibo-runner\/v1/);
    assert.match(texto, /resultado\.recibo\.head/);
    assert.match(texto, /assinatura/);
    assert.match(texto, /ci\.recibo\.claim-nao-hermetica/);
  }
  assert.match(pt, /não prova a autoria/);
  assert.match(en, /does not prove who authored/);
  assert.match(forja, /não usa\s+ancestralidade nem diff posterior/);
});

test('referência do CLI e Não publicado descrevem o recibo emitido pelo runner', () => {
  const raiz = path.resolve(__dirname, '../../..');
  const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
  const cliPt = ler('docs/referencia/cli.md'), cliEn = ler('docs/referencia/cli.en.md');
  assert.match(cliPt, /ork ci run.*ork\.ci-recibo-runner\/v1.*HEAD executado/s);
  assert.match(cliEn, /ork ci run.*ork\.ci-recibo-runner\/v1.*executed HEAD/s);
  const naoPublicado = ler('CHANGELOG.md').split('## [', 1)[0];
  assert.match(naoPublicado, /Recibo básico no HEAD executado.*F5 \(RM-089\)/);
  assert.match(naoPublicado, /ambiente allowlisted.*branch externa.*fork.*GitHub.*GitLab/s);
});
