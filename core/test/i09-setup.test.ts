/** T02: fixtures locais, relogio sintetico e fronteiras publicas; nenhum runtime LLM. */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, TestContext } from 'node:test';
import { carregarManifesto, exigirManifesto, validarOptInPlaybook } from '../src/manifest';
import { lerLedger } from '../src/ledger';
import { MODOS, ORDEM_DOS_MODOS } from '../src/modos';
import {
  BLOCO_PADRAO, blocoPadraoDoModo, caminhoSetup, configDoBloco, consumirPrazoDoBloco, editarBloco, ehPadrao,
  gravarSetup, herdarPrazoDoBloco, iniciarPrazoDoBloco, lerSetup, limitesDoBloco,
  resetarSetup, setupPadrao, validarLimitesDeBloco,
} from '../src/setup';
import {
  AtividadeDoPrazo, IdentidadeDoPrazo, LimitesDeBloco, Manifesto, PrazoDeBloco, SetupDeConducao,
} from '../src/types';

// Duracoes sinteticas para aritmetica, sem tornar este valor default das fases.
const LIMITES: LimitesDeBloco = { duracaoMs: 10_000, maxChildren: 2, maxDepth: 1, maxRetries: 2 };
const IDENTIDADE: IdentidadeDoPrazo = { threadId: 'fixture', execucaoId: 'execucao-1', modo: 'classic', bloco: 3 };
const INICIO = 1_000_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

function fixture(t: TestContext, playbook = '\nplaybook:\n  ativo: true\n'): { dir: string; manifesto: Manifesto } {
  // Sob o diretorio do proprio teste compilado: nao escreve setup operacional ou home.
  const dir = fs.mkdtempSync(path.join(__dirname, 'i09-setup-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'orkastery.yaml'), 'project:\n  name: fixture\n  abbrev: fix\n' + playbook);
  const carregado = carregarManifesto(dir);
  assert.ok(carregado);
  assert.deepEqual(carregado.erros, []);
  return { dir, manifesto: exigirManifesto(dir).manifesto };
}

function setupCompleto(): SetupDeConducao {
  const setup = setupPadrao();
  for (const modo of ORDEM_DOS_MODOS) {
    for (const bloco of setup.modos[modo].blocos) bloco.limites = { ...LIMITES };
  }
  return setup;
}

function prazo(t: TestContext): PrazoDeBloco {
  const p = fixture(t);
  const resultado = iniciarPrazoDoBloco(p.manifesto, setupCompleto(), IDENTIDADE, 'GO', INICIO);
  assert.ok(resultado);
  return resultado;
}

function gravarBruto(dir: string, bruto: unknown): void {
  fs.mkdirSync(path.dirname(caminhoSetup(dir)), { recursive: true });
  fs.writeFileSync(caminhoSetup(dir), JSON.stringify(bruto));
}

for (const modo of ORDEM_DOS_MODOS) {
  for (const [indice, bloco] of MODOS[modo].blocos.entries()) {
    test(`roundtrip publico ${modo}/${indice + 1}, fases ${bloco.fases.join(',')}`, t => {
      const p = fixture(t);
      const setup = setupCompleto();
      // Caso positivo acima de uma hora, dimensionado apenas para esta fixture.
      const limites = { ...LIMITES, duracaoMs: 7_200_000 + indice * 60_000 };
      const editado = { runtime: 'codex', model: 'fixture-model', effort: 'high', limites };
      setup.modos[modo].blocos[indice] = editado;
      gravarSetup(p.dir, setup);
      const relido = lerSetup(p.dir);
      assert.deepEqual(relido, setup);
      assert.equal(ehPadrao(relido.modos[modo].blocos[indice]), false);
      const identidade = { ...IDENTIDADE, modo, bloco: indice + 1 };
      let anterior: PrazoDeBloco | null = null;
      for (const [n, fase] of bloco.fases.entries()) {
        assert.deepEqual(configDoBloco(relido, modo, fase), editado);
        assert.deepEqual(limitesDoBloco(p.manifesto, relido, modo, fase), limites);
        anterior = anterior === null
          ? iniciarPrazoDoBloco(p.manifesto, relido, identidade, fase, INICIO)
          : herdarPrazoDoBloco(anterior, identidade, INICIO + n);
        assert.ok(anterior);
        const consumo = consumirPrazoDoBloco(anterior, identidade, INICIO + n);
        assert.equal(consumo.estado, 'ativo');
        assert.equal(consumo.restanteMs, limites.duracaoMs - n);
        assert.equal(consumo.prazo.iniciadaEmMs, INICIO);
        assert.equal(consumo.prazo.deadlineOriginalMs, INICIO + limites.duracaoMs);
        assert.deepEqual(consumo.prazo.identidade, identidade);
      }
      assert.ok(anterior, 'bloco deve ter executado pelo menos uma fase');
    });
  }
}

test('perfil ausente/desativado mantem defaults e nenhuma janela implicita', t => {
  for (const yaml of ['', '\nplaybook:\n  ativo: false\n']) {
    const p = fixture(t, yaml);
    assert.equal(fs.existsSync(caminhoSetup(p.dir)), false);
    const setup = lerSetup(p.dir);
    for (const modo of ORDEM_DOS_MODOS) {
      for (const [i, bloco] of MODOS[modo].blocos.entries()) {
        for (const fase of bloco.fases) {
          // I-42: o default e o do modo (o `#Fast` nasce em Sonnet com fallback).
          assert.deepEqual(configDoBloco(setup, modo, fase), blocoPadraoDoModo(modo));
          assert.equal(limitesDoBloco(p.manifesto, setup, modo, fase), null);
          assert.equal(iniciarPrazoDoBloco(p.manifesto, setup, { ...IDENTIDADE, modo, bloco: i + 1 }, fase, INICIO), null);
        }
      }
    }
    assert.equal(fs.existsSync(caminhoSetup(p.dir)), false);
  }
});

test('opt-in true sem limites nao ativa silenciosamente nem escreve setup', t => {
  const p = fixture(t);
  assert.equal(p.manifesto.playbook?.ativo, true);
  assert.throws(() => iniciarPrazoDoBloco(p.manifesto, lerSetup(p.dir), IDENTIDADE, 'GO', INICIO), /limites/);
  assert.equal(fs.existsSync(caminhoSetup(p.dir)), false);
});

test('ativo exige todos os blocos dos modos permitidos, mesmo alem do selecionado', t => {
  const p = fixture(t);
  const setup = setupCompleto();
  delete setup.modos.auto.blocos[0].limites;
  assert.throws(() => limitesDoBloco(p.manifesto, setup, 'classic', 'GO'), /limites/);
  p.manifesto.conduction.allowed_modes = ['classic'];
  assert.deepEqual(limitesDoBloco(p.manifesto, setup, 'classic', 'GO'), LIMITES);
  assert.throws(() => limitesDoBloco(p.manifesto, setup, 'auto', 'GO'), /modo permitido/);
  setup.modos.classic.blocos.pop();
  assert.throws(() => limitesDoBloco(p.manifesto, setup, 'classic', 'GO'), /todos os blocos/);
});

test('fase desconhecida e identidade de outro bloco nao selecionam uma janela', t => {
  const p = fixture(t), setup = setupCompleto();
  assert.equal(configDoBloco(setup, 'classic', 'FIX'), null);
  assert.throws(() => limitesDoBloco(p.manifesto, setup, 'classic', 'FIX'), /fase.*fora/);
  assert.throws(() => iniciarPrazoDoBloco(p.manifesto, setup, IDENTIDADE, 'PLAN', INICIO), /diverge da fase/);
});

for (const valor of ['true', 'null', '[]', '17', '\n  ativo: null', '\n  ativo: "true"', '\n  ativo: 1', '\n  enabled: true', '\n  ativo: false\n  extra: true']) {
  test(`manifesto recusa opt-in invalido ${JSON.stringify(valor)}`, t => {
    const p = fixture(t, '');
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nplaybook: ' + valor + '\n');
    const carregado = carregarManifesto(p.dir);
    assert.ok(carregado);
    assert.ok(carregado.erros.some(e => e.includes('playbook')));
    assert.throws(() => exigirManifesto(p.dir), /manifesto invalido/);
  });
}

test('fronteira publica de opt-in em memoria nao aceita coercoes', t => {
  const p = fixture(t);
  assert.equal(validarOptInPlaybook(undefined), false);
  assert.equal(validarOptInPlaybook({ ativo: false }), false);
  assert.equal(validarOptInPlaybook({ ativo: true }), true);
  for (const valor of [null, false, { ativo: 'false' }, { ativo: true, extra: 1 }, {}]) {
    assert.throws(() => validarOptInPlaybook(valor), /playbook/);
    p.manifesto.playbook = valor as Manifesto['playbook'];
    assert.throws(() => limitesDoBloco(p.manifesto, setupCompleto(), 'classic', 'GO'), /playbook/);
  }
});

test('YAML malformado com opt-in nao retorna manifesto exigivel', t => {
  const p = fixture(t);
  fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nlinha sem dois pontos\n');
  assert.ok(carregarManifesto(p.dir)?.erros.some(e => e.includes('YAML invalido')));
  assert.throws(() => exigirManifesto(p.dir), /manifesto invalido/);
});

const DURACOES_INVALIDAS: [string, unknown][] = [
  ['zero', 0], ['negativa', -1], ['NaN', NaN], ['infinita', Infinity], ['menos infinita', -Infinity],
  ['fracionaria', 0.5], ['overflow seguro', Number.MAX_SAFE_INTEGER + 1], ['overflow Date', MAX_DATE_MS + 1],
  ['nula', null], ['string', '1000'], ['undefined explicito', undefined],
];
for (const [nome, valor] of DURACOES_INVALIDAS) {
  test(`duracao ${nome} recusada em gravar/editar/ler e selecao publica`, t => {
    const p = fixture(t), setup = setupCompleto();
    gravarSetup(p.dir, setup);
    const antes = fs.readFileSync(caminhoSetup(p.dir), 'utf8');
    const atualizadoEm = setup.atualizadoEm;
    const limites = { ...LIMITES, duracaoMs: valor } as LimitesDeBloco;
    setup.modos.classic.blocos[2].limites = limites;
    assert.throws(() => gravarSetup(p.dir, setup), /limites/);
    assert.equal(setup.atualizadoEm, atualizadoEm, 'erro nao muda timestamp nem arquivo');
    assert.equal(fs.readFileSync(caminhoSetup(p.dir), 'utf8'), antes);
    assert.throws(() => configDoBloco(setup, 'classic', 'GO'), /limites/);
    assert.throws(() => limitesDoBloco(p.manifesto, setup, 'classic', 'GO'), /limites/);
    const edicao = editarBloco(p.dir, 'classic', 3, { limites });
    assert.equal(edicao.ok, false);
    assert.match(edicao.erro ?? '', /limites/);
    assert.equal(fs.readFileSync(caminhoSetup(p.dir), 'utf8'), antes);
    assert.deepEqual(lerLedger(path.join(p.dir, '.orkastery')), []);
    gravarBruto(p.dir, setup);
    assert.throws(() => lerSetup(p.dir), /limites/);
  });
}

for (const campo of ['maxChildren', 'maxDepth', 'maxRetries'] as const) {
  for (const valor of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
    test(`${campo} invalido ${String(valor)} recusado na fronteira de persistencia`, t => {
      const p = fixture(t), setup = setupCompleto();
      setup.modos.auto.blocos[0].limites = { ...LIMITES, [campo]: valor } as LimitesDeBloco;
      assert.throws(() => gravarSetup(p.dir, setup), /limites/);
      assert.equal(fs.existsSync(caminhoSetup(p.dir)), false);
      gravarBruto(p.dir, setup);
      assert.throws(() => lerSetup(p.dir), /limites/);
    });
  }
}

for (const campo of ['duracaoMs', 'maxChildren', 'maxDepth', 'maxRetries'] as const) {
  test(`limites incompletos sem ${campo} nao viram defaults`, t => {
    const p = fixture(t), setup = setupCompleto();
    const limites = { ...LIMITES } as Partial<LimitesDeBloco>;
    delete limites[campo];
    setup.modos.auto.blocos[0].limites = limites as LimitesDeBloco;
    assert.throws(() => gravarSetup(p.dir, setup), /limites/);
    gravarBruto(p.dir, setup);
    assert.throws(() => lerSetup(p.dir), /limites/);
  });
}

test('zero filhos/profundidade/retries e duracao minima explicita sao validos', t => {
  const p = fixture(t), setup = setupCompleto();
  const limites = { duracaoMs: 1, maxChildren: 0, maxDepth: 0, maxRetries: 0 };
  assert.deepEqual(validarLimitesDeBloco(limites), limites);
  setup.modos.classic.blocos[2].limites = limites;
  gravarSetup(p.dir, setup);
  const execucao = iniciarPrazoDoBloco(p.manifesto, lerSetup(p.dir), IDENTIDADE, 'GO', 0);
  assert.ok(execucao);
  assert.equal(consumirPrazoDoBloco(execucao, IDENTIDADE, 0).restanteMs, 1);
  assert.equal(consumirPrazoDoBloco(execucao, IDENTIDADE, 1).estado, 'expirado');
});

test('campo extra ou limites explicitamente undefined/null nao sao descartados', t => {
  const p = fixture(t);
  for (const valor of [{ ...LIMITES, timeoutMs: 1 }, undefined, null, []]) {
    const setup = setupCompleto();
    setup.modos.classic.blocos[2].limites = valor as LimitesDeBloco;
    assert.throws(() => gravarSetup(p.dir, setup), /limites/);
    assert.throws(() => limitesDoBloco({ ...p.manifesto, playbook: { ativo: false } }, setup, 'classic', 'GO'), /limites/);
  }
});

for (const bruto of ['', '{', '{"modos":', 'null', '[]', 'true', '{"modos":null}', '{"modos":{"auto":null}}', '{"modos":{"auto":{"blocos":{}}}}', '{"modos":{"auto":{"blocos":[null]}}}', '{"contrato":"ork.setup/v2"}']) {
  test(`arquivo setup malformado ${JSON.stringify(bruto)} nao retorna sucesso`, t => {
    const p = fixture(t);
    fs.mkdirSync(path.dirname(caminhoSetup(p.dir)), { recursive: true });
    fs.writeFileSync(caminhoSetup(p.dir), bruto);
    assert.throws(() => lerSetup(p.dir));
    assert.throws(() => editarBloco(p.dir, 'auto', 1, { model: 'novo' }));
    assert.equal(fs.readFileSync(caminhoSetup(p.dir), 'utf8'), bruto);
  });
}

test('limites fora da matriz ou sem contrato sao recusados antes de normalizar', t => {
  const p = fixture(t);
  const config = { ...BLOCO_PADRAO, limites: LIMITES };
  for (const bruto of [
    { modos: { auto: { blocos: [config] } } },
    { contrato: 'ork.setup/v1', modos: { desconhecido: { blocos: [config] } } },
    { contrato: 'ork.setup/v1', modos: { auto: { blocos: [config, config] } } },
  ]) {
    gravarBruto(p.dir, bruto);
    assert.throws(() => lerSetup(p.dir), /limites exigem/);
  }
});

test('array esparso nao e gravado como null para falhar apenas na releitura', t => {
  const p = fixture(t), setup = setupCompleto();
  delete setup.modos.classic.blocos[2];
  assert.throws(() => gravarSetup(p.dir, setup), /bloco.*deve ser objeto/);
  assert.equal(fs.existsSync(caminhoSetup(p.dir)), false);
});

test('legado parcial normaliza; bloco novo quebrado nao ganha runtime/model/effort defaults', t => {
  const p = fixture(t, '');
  const bruto = { contrato: 'ork.setup/v1', modos: { auto: { blocos: [{ runtime: 'inexistente', model: '', effort: '' }] } } };
  gravarBruto(p.dir, bruto);
  assert.deepEqual(configDoBloco(lerSetup(p.dir), 'auto', 'GO'), BLOCO_PADRAO);
  for (const edicao of [{ runtime: 'inexistente' }, { model: '' }, { effort: null }, { model: undefined }]) {
    gravarBruto(p.dir, { contrato: 'ork.setup/v1', modos: { auto: { blocos: [{ ...BLOCO_PADRAO, limites: LIMITES, ...edicao }] } } });
    assert.throws(() => lerSetup(p.dir), /runtime conhecido, model e effort/);
  }
});

test('editar preserva limites, registra de/para real e reset remove somente o modo pedido', t => {
  const p = fixture(t), setup = setupCompleto();
  gravarSetup(p.dir, setup);
  const edicao = editarBloco(p.dir, 'classic', 3, { model: 'novo' }, 'fixture');
  assert.equal(edicao.ok, true, edicao.erro);
  assert.deepEqual(edicao.para?.limites, LIMITES);
  assert.equal(configDoBloco(lerSetup(p.dir), 'classic', 'GO')?.model, 'novo');
  const eventos = lerLedger(path.join(p.dir, '.orkastery'));
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'setup_configured');
  assert.deepEqual(eventos[0].de, edicao.de);
  assert.deepEqual(eventos[0].para, edicao.para);
  const menor = { ...LIMITES, duracaoMs: 9000 };
  assert.equal(editarBloco(p.dir, 'classic', 3, { limites: menor }).ok, true);
  menor.duracaoMs = 1;
  assert.equal(lerSetup(p.dir).modos.classic.blocos[2].limites?.duracaoMs, 9000);
  resetarSetup(p.dir, 'classic');
  const relido = lerSetup(p.dir);
  assert.deepEqual(relido.modos.classic.blocos[2], BLOCO_PADRAO);
  assert.deepEqual(relido.modos.auto, setup.modos.auto);
  assert.throws(() => limitesDoBloco(p.manifesto, relido, 'auto', 'GO'), /limites/);
  resetarSetup(p.dir);
  assert.equal(ehPadrao(lerSetup(p.dir).modos.auto.blocos[0]), true);
});

test('consumo, roundtrip do snapshot, filhos e retries preservam origem e saldo', t => {
  const original = prazo(t), antes = structuredClone(original);
  const consumo = consumirPrazoDoBloco(original, IDENTIDADE, INICIO + 1000);
  assert.equal(consumo.restanteMs, 9000);
  const filho = herdarPrazoDoBloco(consumo.prazo, IDENTIDADE, INICIO + 2000);
  const retry = herdarPrazoDoBloco(JSON.parse(JSON.stringify(filho)), IDENTIDADE, INICIO + 4000);
  assert.deepEqual(retry.identidade, IDENTIDADE);
  assert.equal(retry.iniciadaEmMs, INICIO);
  assert.equal(retry.deadlineOriginalMs, INICIO + 10_000);
  assert.equal(retry.deadlineMs, INICIO + 10_000);
  assert.equal(consumirPrazoDoBloco(retry, IDENTIDADE, INICIO + 4500).restanteMs, 5500);
  assert.deepEqual(original, antes);
  retry.identidade.execucaoId = 'mutada';
  retry.limites.duracaoMs = 1;
  retry.limitesOriginais.maxChildren = 99;
  assert.deepEqual(original, antes);
  assert.equal(filho.limites.duracaoMs, 10_000);
  assert.equal(filho.limitesOriginais.maxChildren, 2);
});

for (const campo of ['duracaoMs', 'maxChildren', 'maxDepth', 'maxRetries'] as const) {
  test(`filho nao amplia ${campo}, inclusive depois de reducao herdada`, t => {
    const original = prazo(t);
    assert.throws(() => herdarPrazoDoBloco(original, IDENTIDADE, INICIO + 1,
      { ...LIMITES, [campo]: LIMITES[campo] + 1 }), /nao pode ampliar/);
    const menor = { ...LIMITES, [campo]: LIMITES[campo] - 1 };
    const filho = herdarPrazoDoBloco(original, IDENTIDADE, INICIO + 1, menor);
    assert.deepEqual(filho.limites, menor);
    assert.equal(filho.deadlineOriginalMs, original.deadlineOriginalMs);
    assert.deepEqual(filho.limitesOriginais, LIMITES);
    assert.throws(() => herdarPrazoDoBloco(filho, IDENTIDADE, INICIO + 2, LIMITES), /nao pode ampliar/);
  });
}

test('reduzir duracao usa inicio original e nao agora; nao aceita saldo ja consumido', t => {
  const original = prazo(t);
  const filho = herdarPrazoDoBloco(original, IDENTIDADE, INICIO + 3000, { ...LIMITES, duracaoMs: 4000 });
  assert.equal(filho.deadlineMs, INICIO + 4000);
  assert.equal(consumirPrazoDoBloco(filho, IDENTIDADE, INICIO + 3000).restanteMs, 1000);
  assert.throws(() => herdarPrazoDoBloco(original, IDENTIDADE, INICIO + 4000, { ...LIMITES, duracaoMs: 4000 }), /ja expirado/);
});

for (const edicao of [{ threadId: 'outra' }, { execucaoId: 'outra' }, { modo: 'maestro' as const }, { bloco: 4 }]) {
  test(`identidade divergente ${JSON.stringify(edicao)} recusada no consumo e heranca`, t => {
    const original = prazo(t), esperada = { ...IDENTIDADE, ...edicao };
    assert.throws(() => consumirPrazoDoBloco(original, esperada, INICIO + 1), /identidade.*divergente/);
    assert.throws(() => herdarPrazoDoBloco(original, esperada, INICIO + 1), /identidade.*divergente/);
  });
}

test('identidade vazia, extra ou modo/bloco invalido nao abre escopo', t => {
  const p = fixture(t), setup = setupCompleto();
  for (const id of [
    { ...IDENTIDADE, execucaoId: '' }, { ...IDENTIDADE, threadId: ' ' },
    { ...IDENTIDADE, bloco: 0 }, { ...IDENTIDADE, bloco: 1.5 },
    { ...IDENTIDADE, modo: 'inexistente' }, { ...IDENTIDADE, sessionId: 'filho' },
  ]) assert.throws(() => iniciarPrazoDoBloco(p.manifesto, setup, id as IdentidadeDoPrazo, 'GO', INICIO));
});

test('relogio regressivo e instantes nao representaveis sao recusados', t => {
  const original = prazo(t);
  const observado = consumirPrazoDoBloco(original, IDENTIDADE, INICIO + 2000).prazo;
  assert.throws(() => consumirPrazoDoBloco(observado, IDENTIDADE, INICIO + 1000), /relogio regressivo/);
  for (const agora of [NaN, Infinity, -1, 0.5, MAX_DATE_MS + 1]) {
    assert.throws(() => consumirPrazoDoBloco(original, IDENTIDADE, agora), /instante/);
  }
});

test('soma da deadline recusa overflow e aceita a fronteira Date representavel', t => {
  const p = fixture(t), setup = setupCompleto();
  assert.throws(() => iniciarPrazoDoBloco(p.manifesto, setup, IDENTIDADE, 'GO', MAX_DATE_MS - 9999), /overflow/);
  const ultimo = iniciarPrazoDoBloco(p.manifesto, setup, IDENTIDADE, 'GO', MAX_DATE_MS - 10_000);
  assert.ok(ultimo);
  assert.equal(ultimo.deadlineMs, MAX_DATE_MS);
  assert.equal(consumirPrazoDoBloco(ultimo, IDENTIDADE, MAX_DATE_MS - 1).restanteMs, 1);
  assert.equal(consumirPrazoDoBloco(ultimo, IDENTIDADE, MAX_DATE_MS).estado, 'expirado');
  for (const agora of [NaN, Infinity, -1, 0.5]) {
    assert.throws(() => iniciarPrazoDoBloco(p.manifesto, setup, IDENTIDADE, 'GO', agora), /instante/);
  }
});

test('snapshot inconsistente nao vira sucesso ao recarregar', t => {
  const original = prazo(t);
  for (const edicao of [
    { versao: 2 }, { iniciadaEmMs: INICIO + 1 }, { observadoEmMs: INICIO - 1 },
    { deadlineOriginalMs: original.deadlineOriginalMs + 1 }, { deadlineMs: original.deadlineMs + 1 },
    { limites: { ...LIMITES, maxChildren: 3 } }, { limitesOriginais: null }, { extra: true },
  ]) {
    assert.throws(() => consumirPrazoDoBloco({ ...original, ...edicao } as PrazoDeBloco, IDENTIDADE, INICIO + 1));
  }
});

test('fronteira exata e posterior expiram trabalho e impedem novo filho/retry', t => {
  const original = prazo(t);
  assert.equal(consumirPrazoDoBloco(original, IDENTIDADE, original.deadlineMs - 1).estado, 'ativo');
  for (const agora of [original.deadlineMs, original.deadlineMs + 1]) {
    const consumo = consumirPrazoDoBloco(original, IDENTIDADE, agora);
    assert.equal(consumo.estado, 'expirado');
    assert.equal(consumo.restanteMs, 0);
    assert.throws(() => herdarPrazoDoBloco(original, IDENTIDADE, agora), /prazo expirado/);
  }
});

for (const tipo of ['espera_lease', 'espera_score'] as const) {
  test(`${tipo} sem processo sobrevive a deadline sem renova-la`, t => {
    const original = prazo(t);
    const espera = consumirPrazoDoBloco(original, IDENTIDADE, original.deadlineMs + 100_000,
      { tipo, processosAtivos: 0 });
    assert.equal(espera.estado, 'espera_sem_processo');
    assert.equal(espera.restanteMs, 0);
    assert.equal(espera.prazo.deadlineMs, original.deadlineMs);
    assert.equal(espera.prazo.deadlineOriginalMs, original.deadlineOriginalMs);
    assert.equal(consumirPrazoDoBloco(espera.prazo, IDENTIDADE, espera.prazo.observadoEmMs).estado, 'expirado');
    assert.throws(() => herdarPrazoDoBloco(espera.prazo, IDENTIDADE, espera.prazo.observadoEmMs), /prazo expirado/);
    for (const processosAtivos of [1, -1, NaN, '0', undefined]) {
      assert.throws(() => consumirPrazoDoBloco(original, IDENTIDADE, INICIO + 1,
        { tipo, processosAtivos } as AtividadeDoPrazo), /espera exige/);
    }
  });
}

test('atividade desconhecida ou campo extra nao suspende o prazo', t => {
  const original = prazo(t);
  for (const atividade of [{ tipo: 'pausa' }, { tipo: 'trabalho', processosAtivos: 0 }, { tipo: 'espera_score' }]) {
    assert.throws(() => consumirPrazoDoBloco(original, IDENTIDADE, INICIO, atividade as AtividadeDoPrazo));
  }
});
