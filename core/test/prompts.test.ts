/**
 * Testes dos prompts como templates versionados (bloco B4).
 *
 * O que precisa ficar provado aqui: o template embutido e a copia versionada no repositorio
 * sao o MESMO texto, o lint reprova template que perdeu contrato, e um projeto consegue
 * sobrescrever o prompt sem que o `ork` deixe de exigir o que ele exige.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  carregarTemplates,
  exigirTemplate,
  lintTemplate,
  parseTemplate,
  REGRA_CENTRAL,
  renderizar,
  SECOES_OBRIGATORIAS,
  TEMPLATE_FASE_PADRAO,
  templateDaFase,
  threadDeExemplo,
  variaveisUsadas,
} from '../src/prompts';
import { CONTRATO_DAS_FASES, fasesDoCicloNoPrompt, montarPrompt, valoresDoPrompt } from '../src/phase';
import { FASES } from '../src/types';
import { projetoTemporario } from './apoio';
import { novaThread } from '../src/thread';

const RAIZ_DO_PRODUTO = path.resolve(__dirname, '../../..');

test('o template versionado em prompts/ e identico ao embutido no ork', () => {
  const caminho = path.join(RAIZ_DO_PRODUTO, 'prompts', 'fase-padrao.md');
  const emDisco = fs.readFileSync(caminho, 'utf8').replace(/\n$/, '');
  assert.equal(
    emDisco,
    TEMPLATE_FASE_PADRAO,
    'a copia versionada divergiu do embutido: regere com `node -e` a partir de TEMPLATE_FASE_PADRAO'
  );
});

test('o lint aprova os templates do produto e reprova o que perde o contrato', () => {
  const templates = carregarTemplates(RAIZ_DO_PRODUTO);
  assert.ok(templates.length >= 1);
  for (const t of templates) {
    assert.deepEqual(lintTemplate(t), [], `template ${t.id} deveria passar no lint`);
  }

  const padrao = exigirTemplate('fase-padrao', RAIZ_DO_PRODUTO);
  const mutar = (bruto: string): ReturnType<typeof lintTemplate> =>
    lintTemplate(parseTemplate(bruto, 'embutido'));

  // Perder a regra central dos modos e o defeito mais caro possivel neste arquivo.
  const semRegra = mutar(padrao.bruto.replace(REGRA_CENTRAL, 'siga o bom senso'));
  assert.ok(
    semRegra.some((p) => p.regra === 'regra-central' && p.gravidade === 'erro'),
    'template sem a regra central precisa reprovar'
  );

  // Sem o pedido do builder, o prompt despacharia uma fase sem demanda nenhuma.
  const semPedido = mutar(padrao.bruto.replace('{{pedido}}', '(o de sempre)'));
  assert.ok(semPedido.some((p) => p.regra === 'pedido'));
  assert.ok(semPedido.some((p) => p.regra === 'variaveis'));

  for (const secao of SECOES_OBRIGATORIAS) {
    const sem = mutar(padrao.bruto.replace(secao, '## outra coisa'));
    assert.ok(
      sem.some((p) => p.regra === 'secoes'),
      `remover "${secao}" precisa reprovar`
    );
  }

  // Credencial no template e o mesmo vazamento que a policy bloqueia no prompt montado.
  const comSegredo = mutar(
    padrao.bruto.replace('## Pedido do builder', '## Pedido do builder\nuse sk-ant-abcdefghijklmnopqrst')
  );
  assert.ok(comSegredo.some((p) => p.regra === 'segredo' && p.gravidade === 'erro'));
  assert.ok(
    comSegredo.every((p) => !p.detalhe.includes('sk-ant-abcdefghijklmnopqrst')),
    'o lint nao pode imprimir o segredo que encontrou'
  );

  // A regex mantem o teste valido quando o template sobe de versao (o B6 levou o
  // `fase-padrao` para a v2 ao acrescentar `{{memoria_injetada}}`).
  const versaoInvalida = mutar(padrao.bruto.replace(/versao: \d+/, 'versao: zero'));
  assert.ok(versaoInvalida.some((p) => p.regra === 'versao'));
});

test('a renderizacao exige toda variavel e some com a linha do campo vazio', () => {
  const t = exigirTemplate('fase-padrao', RAIZ_DO_PRODUTO);
  const usadas = variaveisUsadas(t.corpo);
  assert.ok(usadas.includes('pedido') && usadas.includes('linha_variante'));

  assert.throws(
    () => renderizar(t, { pedido: 'so isso' }),
    /variavel sem valor na renderizacao/,
    'faltar variavel e erro, nunca string vazia silenciosa'
  );

  const exemplo = threadDeExemplo('classic', 'GOAL');
  const semVariante = renderizar(t, valoresDoPrompt(exemplo, 'GOAL', 'pedido do builder'));
  assert.ok(!semVariante.includes('Variante de ciclo:'));
  assert.ok(!semVariante.includes('\n\n\nREGRA'), 'a linha vazia do campo opcional nao pode sobrar');

  const comVariante = renderizar(t, {
    ...valoresDoPrompt({ ...exemplo, variante: 'gap' }, 'GOAL', 'pedido do builder'),
  });
  assert.ok(comVariante.includes('Variante de ciclo: gap'));
});

test('um projeto sobrescreve o prompt da fase sem perder o que o ork exige', () => {
  const projeto = projetoTemporario('prompt-override');
  try {
    const { thread } = novaThread(projeto.carregado, { nome: 'override', modo: 'classic' });

    // Sem prompts/ no projeto, vale o template embutido.
    assert.equal(templateDaFase('GOAL', projeto.dir).origem, 'embutido');
    const antes = montarPrompt(thread, 'GOAL', 'mapear o objetivo', projeto.dir);
    assert.ok(antes.includes('# Orkastery, fase GOAL'));
    assert.match(antes, /GOAL e a fase de entrada, nao uma nova orquestracao/);
    assert.match(antes, /Execute as fases deste bloco na ordem canonica/);
    assert.match(antes, /ork_artifact_read\/write/);
    assert.match(antes, /ork_git_commit/);
    assert.match(antes, /ork_verify/);
    assert.match(antes, /ork_ship/);

    // Com um `prompts/fase-goal.md`, a fase GOAL passa a usar o do projeto, e so ela.
    const dir = path.join(projeto.dir, 'prompts');
    fs.mkdirSync(dir, { recursive: true });
    const proprio = TEMPLATE_FASE_PADRAO.replace('id: fase-padrao', 'id: fase-goal').replace(
      '# Orkastery, fase {{fase}} da thread {{thread}}',
      '# Orkastery no projeto X, fase {{fase}} da thread {{thread}}'
    );
    fs.writeFileSync(path.join(dir, 'fase-goal.md'), proprio + '\n', 'utf8');

    const goal = templateDaFase('GOAL', projeto.dir);
    assert.equal(goal.id, 'fase-goal');
    assert.deepEqual(lintTemplate(goal), []);
    assert.ok(montarPrompt(thread, 'GOAL', 'mapear', projeto.dir).includes('no projeto X'));

    // O PLAN continua no embutido: a resolucao e por fase, nao global.
    assert.equal(templateDaFase('PLAN', projeto.dir).id, 'fase-padrao');
    assert.ok(!montarPrompt(thread, 'PLAN', 'planejar', projeto.dir).includes('no projeto X'));
  } finally {
    projeto.limpar();
  }
});

test('I-42: o bloco unico e parcial descreve so as proprias fases; os outros ciclos ficam byte a byte', () => {
  const t = exigirTemplate('fase-padrao', RAIZ_DO_PRODUTO);
  const fast = valoresDoPrompt(threadDeExemplo('fast', 'GO'), 'GO', 'corrigir duas linhas');
  assert.deepEqual(fasesDoCicloNoPrompt(threadDeExemplo('fast', 'GO')), ['GO']);
  assert.equal(fast.ciclo_canonico, `> ${CONTRATO_DAS_FASES.GO}`);

  // #Auto tambem tem bloco unico, mas percorre as seis: continua com as seis linhas.
  const auto = valoresDoPrompt(threadDeExemplo('auto', 'GO'), 'GO', 'corrigir duas linhas');
  assert.equal(auto.ciclo_canonico, FASES.map((f) => `> ${CONTRATO_DAS_FASES[f]}`).join('\n'));

  // Varios blocos: as seis linhas, marcando so as do bloco, como sempre.
  const classic = valoresDoPrompt(threadDeExemplo('classic', 'GO'), 'GO', 'corrigir duas linhas');
  assert.equal(
    classic.ciclo_canonico,
    FASES.map((f) => `${f === 'GO' || f === 'CHECK' ? '>' : ' '} ${CONTRATO_DAS_FASES[f]}`).join('\n')
  );

  // O teto de cerimonia: o prompt do #Fast na GO e menor que o do #Auto na mesma fase.
  const tamanho = (v: Record<string, string>) => Buffer.byteLength(renderizar(t, v));
  assert.ok(tamanho(fast) < tamanho(auto), `${tamanho(fast)} >= ${tamanho(auto)}`);
  assert.deepEqual(lintTemplate(t), []);
});
