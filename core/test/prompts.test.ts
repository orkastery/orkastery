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
  avisosDeLingua,
  carregarTemplates,
  exigirTemplate,
  lintTemplate,
  parseTemplate,
  REGRA_CENTRAL,
  renderizar,
  SECOES_OBRIGATORIAS,
  TEMPLATE_FASE_PADRAO,
  TEMPLATE_FASE_PADRAO_EN,
  templateDaFase,
  threadDeExemplo,
  variaveisUsadas,
} from '../src/prompts';
import {
  CONTRATO_DAS_FASES, fasesDoCicloNoPrompt, montarPrompt, montarPromptComMemoria, REGRA_DAS_ESPERAS, rodarFase, valoresDoPrompt,
} from '../src/phase';
import { FASES, Modo } from '../src/types';
import { ajustarManifesto, projetoTemporario } from './apoio';
import { novaThread } from '../src/thread';
import { abrirMemoria } from '../src/memoria';
import { MODOS_LEGADOS } from '../src/modos';
import { PAUSA_SOBRE_EN } from '../src/locale-thread';
import { linhasEmPortugues } from './locale-apoio';

const RAIZ_DO_PRODUTO = path.resolve(__dirname, '../../..');

test('o template versionado em prompts/ e identico ao embutido no ork', () => {
  const caminho = path.join(RAIZ_DO_PRODUTO, 'prompts', 'fase-padrao.md');
  const emDisco = fs.readFileSync(caminho, 'utf8').replace(/\n$/, '');
  assert.equal(
    emDisco,
    TEMPLATE_FASE_PADRAO,
    'a copia versionada divergiu do embutido: regere com `node -e` a partir de TEMPLATE_FASE_PADRAO'
  );
  const english = fs.readFileSync(path.join(RAIZ_DO_PRODUTO, 'prompts', 'fase-padrao.en.md'), 'utf8').replace(/\n$/, '');
  assert.equal(english, TEMPLATE_FASE_PADRAO_EN, 'a copia inglesa divergiu do template embutido');
  // RM-061 F3c: as duas linguas andam juntas. Variavel ou versao nova no pt-BR (o verify assíncrono levou a v5)
  // entra no ingles no mesmo lugar, para o prompt ingles nunca perder um modulo que o pt-BR ganhou.
  const pt = parseTemplate(TEMPLATE_FASE_PADRAO, 'embutido'), en = parseTemplate(TEMPLATE_FASE_PADRAO_EN, 'embutido');
  assert.equal(en.versao, pt.versao);
  assert.deepEqual(en.fases, pt.fases);
  assert.deepEqual(en.variaveis, pt.variaveis);
  assert.deepEqual(variaveisUsadas(en.corpo), variaveisUsadas(pt.corpo));
});

test('RM-061 F3c: o prompt ingles cobre as seis fases, os cinco modulos e a regra central', () => {
  assert.equal(templateDaFase('GOAL', RAIZ_DO_PRODUTO, 'en').id, 'fase-padrao.en');
  for (const fase of FASES) {
    const prompt = montarPrompt(threadDeExemplo('auto', fase), fase, 'Map the smallest safe slice.', RAIZ_DO_PRODUTO, '', 'en');
    assert.match(prompt, new RegExp(`^# Orkastery, ${fase} phase of thread`, 'm'));
    for (const secao of ['## Canonical cycle', '## Conduction mode:', '## Thread context', '## Builder request', '## Evidence rules']) {
      assert.ok(prompt.includes(secao), `${fase}: ${secao}`);
    }
    assert.ok(prompt.includes('CENTRAL RULE: the mode relaxes the pause, NEVER verification.'));
    assert.ok(prompt.includes(`${fase} (F`), fase);
    assert.ok(prompt.includes('No self-report: every claim includes the command that proves it and its real output.'));
    assert.ok(!prompt.includes('REGRA CENTRAL:'));
    assert.ok(!prompt.includes('Ciclo canonico'));
  }
});

test('RM-061 F3c: o prompt ingles de todo modo e fase sai sem linha em pt-BR, inclusive a da pausa', () => {
  for (const modo of MODOS_LEGADOS) {
    const thread = threadDeExemplo(modo as Modo, 'GOAL');
    for (const fase of thread.fases) {
      const prompt = montarPrompt({ ...thread, faseAtual: fase }, fase, 'Map the change.', RAIZ_DO_PRODUTO, '', 'en');
      assert.deepEqual(linhasEmPortugues(prompt, [thread.nome, thread.id, thread.slug]), [], `${modo}/${fase}`);
    }
  }
  // Todo assunto de pausa dos modos tem par em ingles (premissas no #Maestro e no #Ork; o push antecipado no #Classic).
  const pausas = MODOS_LEGADOS.flatMap((m) => threadDeExemplo(m as Modo, 'GOAL').blocos.filter((b) => b.pausa).map((b) => b.pausaSobre));
  for (const sobre of new Set(pausas)) assert.ok(Object.hasOwn(PAUSA_SOBRE_EN, sobre), sobre);
});

test('RM-061 F3c: com o dono em ingles, o template do projeto vence o embutido, e sem par .en a fase sai em pt-BR com aviso', () => {
  const projeto = projetoTemporario('prompt-projeto-en');
  try {
    const dir = path.join(projeto.dir, 'prompts');
    fs.mkdirSync(dir, { recursive: true });
    const proprio = TEMPLATE_FASE_PADRAO.replace('id: fase-padrao', 'id: fase-goal')
      .replace('# Orkastery, fase {{fase}} da thread {{thread}}', '# Orkastery no projeto X, fase {{fase}} da thread {{thread}}');
    fs.writeFileSync(path.join(dir, 'fase-goal.md'), proprio + '\n', 'utf8');
    assert.equal(templateDaFase('GOAL', projeto.dir, 'en').id, 'fase-goal');
    assert.equal(templateDaFase('PLAN', projeto.dir, 'en').id, 'fase-padrao.en');
    assert.equal(templateDaFase('GOAL', projeto.dir, 'pt-BR').id, 'fase-goal');
    const exemplo = threadDeExemplo('classic', 'GOAL');
    // Sem o par `.en`, a fase usa o template do projeto, e os valores falam a lingua dele: nada de prompt misturado.
    const goal = montarPrompt(exemplo, 'GOAL', 'Map it.', projeto.dir, '', 'en');
    assert.match(goal, /^# Orkastery no projeto X, fase GOAL da thread/m);
    assert.match(goal, /^> GOAL \(F1\): objetivo verificavel/m);
    assert.doesNotMatch(goal, /CENTRAL RULE|## Canonical cycle|Does not implement/);
    assert.match(montarPrompt(exemplo, 'PLAN', 'Plan it.', projeto.dir, '', 'en'), /^# Orkastery, PLAN phase of thread/m);
    const avisos = avisosDeLingua(carregarTemplates(projeto.dir), 'en');
    assert.deepEqual(avisos.map((a) => [a.template, a.regra, a.gravidade]), [['fase-goal', 'idioma', 'aviso']]);
    assert.deepEqual(avisosDeLingua(carregarTemplates(projeto.dir), 'pt-BR'), []);
    // Com o par `.en` do projeto, a fase volta ao ingles e o aviso some.
    fs.writeFileSync(path.join(dir, 'fase-goal.en.md'), TEMPLATE_FASE_PADRAO_EN.replace('id: fase-padrao.en', 'id: fase-goal.en') + '\n', 'utf8');
    assert.equal(templateDaFase('GOAL', projeto.dir, 'en').id, 'fase-goal.en');
    assert.deepEqual(lintTemplate(templateDaFase('GOAL', projeto.dir, 'en')), []);
    assert.deepEqual(avisosDeLingua(carregarTemplates(projeto.dir), 'en'), []);
    // O `fase-padrao` do projeto sem o par `.en` vale para o dono em ingles, e o aviso diz isso.
    fs.rmSync(path.join(dir, 'fase-goal.md')); fs.rmSync(path.join(dir, 'fase-goal.en.md'));
    fs.writeFileSync(path.join(dir, 'fase-padrao.md'), TEMPLATE_FASE_PADRAO + '\n', 'utf8');
    const padraoDoProjeto = templateDaFase('PLAN', projeto.dir, 'en');
    assert.equal(padraoDoProjeto.id, 'fase-padrao');
    assert.notEqual(padraoDoProjeto.origem, 'embutido');
    assert.deepEqual(avisosDeLingua(carregarTemplates(projeto.dir), 'en').map((a) => a.template), ['fase-padrao']);
  } finally {
    projeto.limpar();
  }
});

test('RM-061 F3c: o phase run monta o prompt na lingua atual do dono', () => {
  const p = projetoTemporario('prompt-owner-language');
  try {
    ajustarManifesto(p, 'owner:\n', 'owner:\n  language: en-US\n');
    const { thread } = novaThread(p.carregado, { nome: 'english-owner', modo: 'auto' });
    const { prompt } = montarPromptComMemoria(p.carregado, thread, 'GOAL', 'Map the change.', abrirMemoria(p.carregado));
    assert.match(prompt, /^# Orkastery, GOAL phase of thread/m);
    assert.match(prompt, /## Builder request\nMap the change\./);
    assert.match(prompt, /CENTRAL RULE: the mode relaxes the pause, NEVER verification\./);
    assert.doesNotMatch(prompt, /## Pedido do builder|REGRA CENTRAL:/);
  } finally {
    p.limpar();
  }
});

test('RM-061 F3c: sem owner.language, o prompt despachado segue em pt-BR com qualquer LANG (dado da F2a)', () => {
  const p = projetoTemporario('prompt-sem-owner-language');
  const lcAll = process.env.LC_ALL, lang = process.env.LANG;
  try {
    process.env.LC_ALL = 'en_US.UTF-8'; process.env.LANG = 'en_US.UTF-8';
    const { thread } = novaThread(p.carregado, { nome: 'sem-lingua', modo: 'auto' });
    const { prompt } = montarPromptComMemoria(p.carregado, thread, 'GOAL', 'Mapear a mudanca.', abrirMemoria(p.carregado));
    assert.match(prompt, /^# Orkastery, fase GOAL da thread/m);
    assert.match(prompt, /## Pedido do builder\nMapear a mudanca\./);
    assert.match(prompt, /REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao\./);
    assert.doesNotMatch(prompt, /CENTRAL RULE|## Builder request/);
  } finally {
    if (lcAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = lcAll;
    if (lang === undefined) delete process.env.LANG; else process.env.LANG = lang;
    p.limpar();
  }
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

test('N2: o prompt de toda fase traz a regra contra & em verify, build e suite (aprendizado 1 da RM-058)', () => {
  // RM-037 (ork-rm037esperas, D3): a linha da N2 virou a regra das esperas, que guarda os dois pontos dela.
  for (const fase of FASES) {
    const prompt = renderizar(templateDaFase(fase), valoresDoPrompt(threadDeExemplo('auto', fase), fase, 'pedido do builder'));
    assert.ok(prompt.split('\n').includes(`- ${REGRA_DAS_ESPERAS}`), fase);
    assert.ok(prompt.includes('nunca dispare verify, build ou suite com `&` dentro do comando'), fase);
    assert.ok(prompt.includes('prefira `ork_verify` assíncrono e consulte `ork_verify_status` a cada 30–60 s'), fase);
    assert.ok(prompt.includes('rode o `ork verify` em primeiro plano, com `timeout` (ele espera a vez na fila de recursos pesados)'), fase);
  }
});

test('RM-016: Claude Code e Codex recebem o mesmo fecho obrigatório no prompt renderizado do GO', () => {
  for (const runtime of ['claude-bg', 'codex']) {
    const projeto = projetoTemporario(`prompt-fecho-${runtime}`);
    try {
      const { thread } = novaThread(projeto.carregado, { nome: `fecho ${runtime}`, modo: 'fast' });
      const r = rodarFase(projeto.carregado, thread.id, {
        fase: 'GO', prompt: 'implementar a fatia', runtime, model: 'modelo-simulado', effort: 'high', dryRun: true,
      });
      assert.equal(r.runtime, runtime);
      const prompt = fs.readFileSync(r.promptPath, 'utf8');
      assert.match(prompt, /## Fecho obrigatório do GO/);
      assert.match(prompt, /use `ork_verify` e aguarde o veredito verde por `ork_verify_status`/);
      assert.ok(prompt.includes(`\`ork verify ${thread.id}\``));
      assert.ok(prompt.includes(`\`ork ci prepare ${thread.id}\``));
      assert.ok(prompt.includes(`\`ci(${thread.id}): bundle ...\``));
      assert.ok(prompt.includes(`\`.orkastery/threads/${thread.id}/pr-body.md\``));
      assert.match(prompt, /O rito é idêntico em Claude Code e Codex/);
    } finally { projeto.limpar(); }
  }
});

test('RM-061 F3c: com o dono em ingles, o GO dos dois runtimes recebe o mesmo fecho obrigatorio da RM-016', () => {
  for (const runtime of ['claude-bg', 'codex']) {
    const projeto = projetoTemporario(`prompt-fecho-en-${runtime}`);
    try {
      ajustarManifesto(projeto, 'owner:\n', 'owner:\n  language: en-US\n');
      const { thread } = novaThread(projeto.carregado, { nome: `closing ${runtime}`, modo: 'fast' });
      const r = rodarFase(projeto.carregado, thread.id, {
        fase: 'GO', prompt: 'implement the slice', runtime, model: 'modelo-simulado', effort: 'high', dryRun: true,
      });
      assert.equal(r.runtime, runtime);
      const prompt = fs.readFileSync(r.promptPath, 'utf8');
      assert.match(prompt, /\n## Mandatory GO closing\n\nBefore ending a block that includes GO, use `ork_verify` and wait for its green verdict through `ork_verify_status`/);
      assert.ok(prompt.includes(`\`ork verify ${thread.id}\``));
      assert.ok(prompt.includes(`\`ork ci prepare ${thread.id}\``));
      assert.ok(prompt.includes(`\`ci(${thread.id}): bundle ...\``));
      assert.ok(prompt.includes(`\`.orkastery/threads/${thread.id}/pr-body.md\``));
      assert.match(prompt, /The ritual is identical in Claude Code and Codex\. It closes GO, but it does not authorize SHIP/);
      assert.doesNotMatch(prompt, /Fecho obrigatório do GO|O rito é idêntico/);
    } finally { projeto.limpar(); }
  }
  // Bloco sem GO: o fecho fica fora nas duas linguas, e a linha vazia da variavel some.
  for (const locale of ['pt-BR', 'en'] as const) {
    const goal = montarPrompt(threadDeExemplo('classic', 'GOAL'), 'GOAL', 'pedido', RAIZ_DO_PRODUTO, '', locale);
    assert.doesNotMatch(goal, /Fecho obrigatório do GO|Mandatory GO closing/, locale);
    assert.ok(!goal.includes('\n\n\n'), `${locale}: sobrou linha vazia`);
  }
});
