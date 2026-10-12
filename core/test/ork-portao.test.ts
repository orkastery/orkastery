import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { FORMATO_DA_CONFERENCIA, PRAZO_MAXIMO_MS, ResultadoDaConferencia, verifyDaTarefa } from '../src/claims-conferir';
import { slugDasFases } from '../src/modos';
import { alvoDoLease, globParaRegex, globsColidem, leasesColidem, tipoDoLease } from '../src/leases';
import { FASES, Fase } from '../src/types';

// RM-059 (fatia F10): o Portão de Tarefas `ork-portao` testado sem o Claude Code. O sandbox do `ork verify` e o
// runner do CI não têm o `claude`, então esta claim hermética transpila os módulos puros do Portão com o compilador
// do `core` (pelo carregador do `checar-mods.cjs`, o mesmo da guarda estática) e os roda num escopo próprio, e cruza
// as regras que o mod reimplementa com as do núcleo: o verify da tarefa (`verifyDaTarefa`) e o slug do bloco
// (`slugDasFases`). Módulo puro só importa tipos: nenhum `require` acontece.
const raizDoRepo = path.resolve(__dirname, '../../..');
const PORTAO = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-portao');
const { carregarModuloDoMod } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
const carregar = (rel: string) => carregarModuloDoMod(path.join(PORTAO, rel));
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(PORTAO, rel), 'utf8'));

/** Os fontes do hooks module do Portão (sem testes nem tipos), com o caminho relativo à pasta do mod. */
function fontesDoMod(): Array<{ rel: string; fonte: ts.SourceFile }> {
  const pasta = path.join(PORTAO, 'hooks');
  return fs.readdirSync(pasta).filter((n) => /\.(ts|tsx)$/.test(n)).sort().map((n) => {
    const arquivo = path.join(pasta, n);
    return { rel: `hooks/${n}`, fonte: ts.createSourceFile(arquivo, fs.readFileSync(arquivo, 'utf8'), ts.ScriptTarget.ES2022, true) };
  });
}

function visitar(no: ts.Node, cada: (n: ts.Node) => void): void {
  cada(no);
  ts.forEachChild(no, (filho) => visitar(filho, cada));
}

/** Os módulos puros: todo `.ts` de `hooks/` menos o `register.ts`, que faz as chamadas ao `$`. */
const modulosPuros = () => fontesDoMod().map((f) => f.rel).filter((rel) => rel !== 'hooks/register.ts');

test('manifesto do Portão: nome, contrato, dependência da ponte e nenhuma chave fora do formato do Claude Code', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-portao');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  assert.equal(typeof m.author?.name, 'string');
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.ts'] });
  assert.ok(fs.existsSync(path.join(PORTAO, 'hooks/register.ts')));
});

test('orkastery-mod.json do Portão: só o papel fase, na convenção ork.mod/v1', () => {
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['fase'], claudeCodeMinimo: '2.1.287' });
});

test('contrato de tipos: o quadro do Portão declarado, sem noun no $, sem import nem referência', () => {
  const contrato = fs.readFileSync(path.join(PORTAO, 'types/index.d.ts'), 'utf8');
  assert.match(contrato, /interface PluginState \{\s*'ork-portao': \{/);
  assert.match(contrato, /quadro: PortaoQuadro/);
  assert.match(contrato, /concluidas: string\[\]/);
  assert.match(contrato, /repeticoes: Record<string, PortaoRepeticao>/);
  assert.match(contrato, /atribuicoes: Record<string, string>/);
  assert.match(contrato, /devolvidas: string\[\]/);
  assert.doesNotMatch(contrato, /leases: Record/);
  assert.doesNotMatch(contrato, /interface EngineInterface/);
  assert.doesNotMatch(contrato, /^\s*import\s/m);
  assert.doesNotMatch(contrato, /\/\/\/\s*<reference/);
});

test('módulo puro do Portão só importa tipos', () => {
  assert.deepEqual(modulosPuros(), ['hooks/lease.ts', 'hooks/plano.ts', 'hooks/verify.ts']);
  for (const rel of modulosPuros()) {
    const fonte = fs.readFileSync(path.join(PORTAO, rel), 'utf8');
    const imports = fonte.split('\n').filter((l) => /^\s*import\s/.test(l));
    assert.deepEqual(imports.filter((l) => !/^\s*import type\s/.test(l)), [], rel);
  }
});

test('lista fechada do MCP: toda chamada mcp.call do Portão usa o servidor orkastery e só a leitura do plano', () => {
  const { SERVIDOR, FERRAMENTA_DO_PLANO, FERRAMENTAS_DO_PORTAO } = carregar('hooks/plano.ts');
  assert.equal(SERVIDOR, 'orkastery');
  assert.deepEqual([...FERRAMENTAS_DO_PORTAO], ['ork_artifact_read']);
  assert.equal(FERRAMENTA_DO_PLANO, 'ork_artifact_read');
  const chamadas: string[] = [];
  for (const { rel, fonte } of fontesDoMod()) {
    visitar(fonte, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== 'call') return;
      const alvo = n.expression.expression;
      if (!ts.isPropertyAccessExpression(alvo) || alvo.name.text !== 'mcp') return;
      const [servidor, ferramenta] = n.arguments;
      const nome = (a: ts.Expression | undefined) => (a && ts.isIdentifier(a) ? a.text : a ? a.getText(fonte) : '');
      chamadas.push(`${rel}: ${nome(servidor)} ${nome(ferramenta)}`);
      assert.equal(nome(servidor), 'SERVIDOR', `${rel}: servidor fora da constante`);
      assert.equal(nome(ferramenta), 'FERRAMENTA_DO_PLANO', `${rel}: ferramenta fora da lista fechada`);
    });
  }
  assert.equal(chamadas.length, 1, `esperava só a leitura do plano, achei ${chamadas.join('; ')}`);
});

test('nenhum literal do Portão aponta o estado interno do núcleo em .orkastery (dados só pelo núcleo)', () => {
  for (const { rel, fonte } of fontesDoMod()) {
    visitar(fonte, (n) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
        && n.text.includes('.orkastery')) assert.fail(`${rel}: literal com .orkastery: ${n.text}`);
    });
  }
});

/** Planos com as formas que o núcleo aceita e recusa, para cruzar a leitura do mod com o `verifyDaTarefa`. */
const CORPUS: string[] = [
  [
    '### T1 Completa', '', '- **touch_paths:** `src/a.ts`, `docs/`', '- **verify:** `npm test`', '',
    '### T2 Sem touch_paths', '', '- **verify:** `npm test`', '',
    '### T3 Sem verify', '', '- **touch_paths:** `src/c.ts`', '',
    '### T4 Dois comandos', '', '- **touch_paths:** `src/d.ts`', '- **verify:** `npm test` e `npm run lint`', '',
    '### T5 Lista abaixo', '', '- **touch_paths:**', '  - `src/e/**`', '- **verify:** `node --test dist/e.test.js`',
  ].join('\n'),
  [
    '## T10.1 Nível dois com subcabeçalho', '', '- verify: `npm --prefix core run build && node --test x.js`',
    '### Notas', '', 'texto solto', '- touch_paths: `core/src/a.ts`', '',
    '## T10.2: Rótulo com crases', '', '- `verify`: `true`.', '- `touch_paths`: `a/`', '',
    '## T10.3) Verify fora de lista', '', 'Verify: `echo ok`', '',
    '## T10.4 Verify sem crases', '', '- **verify:** rodar os testes', '',
    '## T10.5 Verify quebrado na linha de baixo', '', '- **verify:** `npm test` e o teste da fatia',
    '  (`node --test x.js`)', '',
    '## T10.6 Dois rótulos de verify', '', '- **verify:** `a`', '- **verify:** `b`', '',
    '## T10.7 Rótulo em negrito com dois-pontos fora', '', '- **verify**: `make check`', '',
    '## T10.8 Comando com aspas', '', '- **verify:** `node -e "process.exit(0)"`',
  ].join('\n'),
  [
    '### T7 Repetida', '- **verify:** `a`', '### T7 Repetida de novo', '- **verify:** `b`', '',
    '### T8 Verify recuado com branco', '- **verify:**', '', '    `npm test`', '',
    '#### T9 Nível quatro', '- **verify:** `true`', '### T11 Depois', '- **verify:** `false`',
    '\t- **touch_paths:** `x/y.ts`',
  ].join('\n'),
];

test('plano: a leitura do mod dá o mesmo veredito do verifyDaTarefa do núcleo em cada tarefa do corpus', () => {
  const { tarefasDoPlano } = carregar('hooks/plano.ts');
  let conferidas = 0;
  for (const plano of CORPUS) {
    const tarefas = tarefasDoPlano(plano) as Array<{ id: string; verify: string | null; problema: string | null }>;
    const ids = [...new Set(tarefas.map((t) => t.id)), 'T99'];
    for (const id of ids) {
      const doMod = tarefas.find((t) => t.id === id);
      let doNucleo: { comando: string } | { motivo: string };
      try { doNucleo = { comando: verifyDaTarefa(plano, id).comando }; }
      catch (e) { doNucleo = { motivo: /^claims\.conferir\.([a-z-]+):/.exec((e as Error).message)![1] }; }
      if (!doMod) assert.deepEqual(doNucleo, { motivo: 'tarefa-ausente' }, `${id} ausente no mod`);
      else if (doMod.problema === null) assert.deepEqual(doNucleo, { comando: doMod.verify }, `${id}: o mod aceitou ${doMod.verify}`);
      else assert.deepEqual(doNucleo, { motivo: doMod.problema }, `${id}: o mod recusou com ${doMod.problema}`);
      conferidas++;
    }
  }
  assert.equal(conferidas, 20);
});

test('plano: touch_paths por tarefa, com lista abaixo e continuação, normalizados e sem nada fora do item', () => {
  const { tarefasDoPlano } = carregar('hooks/plano.ts');
  const t = tarefasDoPlano(CORPUS[0]) as Array<{ id: string; titulo: string; touchPaths: string[] }>;
  assert.deepEqual(t.map((x) => [x.id, x.titulo, x.touchPaths]), [
    ['T1', 'Completa', ['src/a.ts', 'docs']],
    ['T2', 'Sem touch_paths', []],
    ['T3', 'Sem verify', ['src/c.ts']],
    ['T4', 'Dois comandos', ['src/d.ts']],
    ['T5', 'Lista abaixo', ['src/e/**']],
  ]);
  const segundo = tarefasDoPlano(CORPUS[1]) as Array<{ id: string; titulo: string; touchPaths: string[] }>;
  assert.deepEqual(segundo.slice(0, 2).map((x) => [x.id, x.titulo, x.touchPaths]), [
    ['T10.1', 'Nível dois com subcabeçalho', ['core/src/a.ts']],
    ['T10.2', 'Rótulo com crases', ['a']],
  ]);
  assert.equal(tarefasDoPlano(null), null);
  assert.deepEqual(tarefasDoPlano('# PLAN\n\nnada'), []);
});

test('assunto: o id da tarefa do plano como palavra própria, sem repetir, nunca colado a letra', () => {
  const { idsNoAssunto } = carregar('hooks/plano.ts');
  assert.deepEqual(idsNoAssunto('T10.1 Esqueleto'), ['T10.1']);
  assert.deepEqual(idsNoAssunto('[T2] Algo; ver T2 de novo'), ['T2']);
  assert.deepEqual(idsNoAssunto('Fechar T2.1.'), ['T2.1']);
  assert.deepEqual(idsNoAssunto('T1 e T5'), ['T1', 'T5']);
  assert.deepEqual(idsNoAssunto('AT2 T2a t3 xT4'), []);
  assert.deepEqual(idsNoAssunto(undefined), []);
});

test('criação: veredito e texto da recusa para cada motivo, e o que passa', () => {
  const { tarefasDoPlano, decidirCriacao, textoDaRecusa, TETO_DO_TEXTO } = carregar('hooks/plano.ts');
  const tarefas = tarefasDoPlano(CORPUS[0]);
  assert.deepEqual(decidirCriacao('T1 Completa', tarefas), { tipo: 'passa', tarefa: 'T1' });
  const motivos = ['Sem id', 'T1 e T5', 'T9', 'T2 x', 'T3 x', 'T4 x'].map((a) => decidirCriacao(a, tarefas).motivo);
  assert.deepEqual(motivos, ['sem-id', 'ambigua', 'fora-do-plano', 'sem-touch-paths', 'sem-verify', 'sem-verify']);
  const repetida = decidirCriacao('T7 x', tarefasDoPlano(CORPUS[2]));
  assert.equal(repetida.motivo, 'repetida');
  const texto = textoDaRecusa(decidirCriacao('T2 x', tarefas), 'T2 x', tarefas);
  assert.match(texto, /^Portão de Tarefas: a tarefa "T2 x" não entrou no quadro: a tarefa T2 do plano não tem touch_paths/);
  assert.match(texto, /Tarefas do plano que servem: T1 \(Completa\); T5 \(Lista abaixo\)\.$/);
  const nenhuma = textoDaRecusa(decidirCriacao('x', []), 'x', []);
  assert.match(nenhuma, /Nenhuma tarefa do plano serve hoje/);
  const muitas = Array.from({ length: 400 }, (_, i) => ({ id: `T${i}`, titulo: 'x'.repeat(100), touchPaths: ['a'], verify: 'true', problema: null }));
  assert.ok(textoDaRecusa(decidirCriacao('sem', muitas), 'sem', muitas).length <= TETO_DO_TEXTO);
});

test('bloco: o GO no slug do mod é igual ao do slugDasFases do núcleo em todo conjunto de fases', () => {
  const { faseNoBloco } = carregar('hooks/plano.ts');
  let conjuntos = 0;
  for (let mascara = 1; mascara < 1 << FASES.length; mascara++) {
    const fases = FASES.filter((_, i) => mascara & (1 << i)) as Fase[];
    for (const fase of FASES) assert.equal(faseNoBloco(slugDasFases(fases), fase), fases.includes(fase), `${slugDasFases(fases)} ${fase}`);
    conjuntos++;
  }
  assert.equal(conjuntos, 63);
  assert.equal(faseNoBloco(null), null);
  assert.equal(faseNoBloco('f37'), null);
  assert.equal(faseNoBloco('outro'), null);
});

test('escopo: thread fechada e bloco sem GO param antes do plano; sem retrato conta como GO; plano sem tarefas para', () => {
  const { decidirEscopo, escopoDoRetrato, threadNoRetrato } = carregar('hooks/plano.ts');
  const tarefas = [{ id: 'T1', titulo: '', touchPaths: ['a'], verify: 'true', problema: null }];
  assert.deepEqual(decidirEscopo({ status: 'aberta', bloco: 'full' }, tarefas), { ativo: true, avisos: [] });
  assert.deepEqual(decidirEscopo({ status: 'fechada', bloco: 'full' }, tarefas), { ativo: false, motivo: 'thread fechada' });
  assert.deepEqual(decidirEscopo({ status: 'aberta', bloco: 'f45' }, tarefas), { ativo: false, motivo: 'o bloco f45 não tem o GO' });
  assert.equal(decidirEscopo(null, tarefas).ativo, true);
  assert.equal(escopoDoRetrato(null).avisos.length, 1);
  assert.equal(decidirEscopo({ status: 'aberta', bloco: null }, tarefas).ativo, true);
  assert.equal(decidirEscopo({ status: 'aberta', bloco: 'go' }, null).ativo, false);
  assert.equal(decidirEscopo({ status: 'aberta', bloco: 'go' }, []).ativo, false);
  const retrato = { sections: { threads: { items: [{ id: 'ork-a', status: 'aberta', facts: { phase: 'GOAL', block: 'full' } }] } } };
  assert.deepEqual(threadNoRetrato(retrato, 'ork-a'), { status: 'aberta', bloco: 'full' });
  assert.deepEqual(threadNoRetrato(retrato, 'ork-b'), { status: null, bloco: null });
  assert.deepEqual(threadNoRetrato(null, 'ork-a'), { status: null, bloco: null });
});

test('leitura do plano: argumentos só com thread válida, JSON do MCP e recusa de erro, de sem texto e de texto que não é JSON', () => {
  const { argsDoPlano, jsonDoMcp, textoDoPlano } = carregar('hooks/plano.ts');
  assert.deepEqual(argsDoPlano('ork-a'), { threadId: 'ork-a', tipo: 'plan' });
  assert.throws(() => argsDoPlano('../x'), /id de thread inválido/);
  assert.deepEqual(jsonDoMcp({ content: [{ type: 'text', text: '{"a":1}' }] }, 'f'), { a: 1 });
  assert.throws(() => jsonDoMcp({ content: [{ type: 'text', text: 'mcp.thread.scope' }], isError: true }, 'f'), /respondeu com erro: mcp\.thread\.scope/);
  assert.throws(() => jsonDoMcp({ content: [] }, 'f'), /não devolveu texto/);
  assert.throws(() => jsonDoMcp({ content: [{ type: 'text', text: 'x' }] }, 'f'), /não é JSON/);
  assert.equal(textoDoPlano({ conteudo: 'p' }), 'p');
  assert.equal(textoDoPlano({ conteudo: null }), null);
  assert.throws(() => textoDoPlano(null), /não é objeto/);
});

test('guarda: o Portão passa na guarda estática, sozinho e junto dos outros mods', () => {
  const { checarMods } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
  const so = checarMods({ pastas: [PORTAO] });
  assert.equal(so.ok, true, JSON.stringify(so.mods[0].achados));
  const todos = checarMods({});
  assert.equal(todos.ok, true, JSON.stringify(todos.mods.filter((m: { ok: boolean }) => !m.ok)));
  assert.ok(todos.mods.some((m: { mod: string }) => m.mod === 'ork-portao'));
});

/** Um resultado de conferência com a forma do núcleo: o tipo `ResultadoDaConferencia` quebra a compilação se mudar. */
function resultadoDoNucleo(tarefa: string, item: ResultadoDaConferencia['itens'][number]): ResultadoDaConferencia {
  return {
    formato: FORMATO_DA_CONFERENCIA, thread: 'ork-a', commit: 'c'.repeat(40), cwd: '/w', executor: 'codex-sandbox', reciboOficial: false,
    prazoTotalMs: 540000, alvo: { tipo: 'tarefa', tarefa, plano: { arquivo: 'docs/plan.md', sha256: 'x'.repeat(64) }, comando: 'npm test' },
    itens: [item], ok: item.verificado, motivos: item.motivo ? [item.motivo] : [],
  };
}

test('conferência: argv do ork claims conferir só com thread e tarefa válidas, prazo dentro do teto do núcleo e vigia no teto do process.run', () => {
  const { argvDaConferencia, PRAZO_DA_CONFERENCIA_S, VIGIA_DA_CONFERENCIA_MS, FORMATO_DA_CONFERENCIA: formato } = carregar('hooks/verify.ts');
  assert.deepEqual(argvDaConferencia('ork-a', 'T2.1'), ['ork', 'claims', 'conferir', 'ork-a', '--tarefa', 'T2.1', '--prazo', '540', '--json']);
  assert.throws(() => argvDaConferencia('-x', 'T1'), /id de thread inválido/);
  assert.throws(() => argvDaConferencia('ork-a', 'C3'), /id de tarefa inválido/);
  assert.equal(formato, FORMATO_DA_CONFERENCIA);
  assert.ok(PRAZO_DA_CONFERENCIA_S * 1000 <= PRAZO_MAXIMO_MS);
  assert.ok(VIGIA_DA_CONFERENCIA_MS > PRAZO_DA_CONFERENCIA_S * 1000 && VIGIA_DA_CONFERENCIA_MS <= 600000);
});

test('conferência: a leitura do JSON do núcleo para aprovada, reprovada, sem veredito, recusa tipada, condução alheia e o resto', () => {
  const { lerConferencia } = carregar('hooks/verify.ts');
  const execucao = (ok: boolean, code: number, fim = '') => ({ nome: 'T1.1', comando: 'npm test', ok, code, executado: true, fim });
  const aprovada = resultadoDoNucleo('T1', { id: 'T1', alegacao: 'a', arquivo: 'docs/plan.md', verificado: true, motivo: null, detalhe: 'ok', execucoes: [execucao(true, 0)] });
  assert.deepEqual(lerConferencia('T1', JSON.stringify(aprovada), 0, ''), { tipo: 'aprovada', comando: 'npm test' });
  const reprovada = resultadoDoNucleo('T1', { id: 'T1', alegacao: 'a', arquivo: null, verificado: false, motivo: 'claims.failed', detalhe: 'x', execucoes: [execucao(false, 1, 'not ok 1')] });
  assert.deepEqual(lerConferencia('T1', JSON.stringify(reprovada), 1, ''), { tipo: 'reprovada', comando: 'npm test', codigo: 1, fim: 'not ok 1' });
  const prazo = resultadoDoNucleo('T1', { id: 'T1', alegacao: 'a', arquivo: null, verificado: false, motivo: 'verify.timeout', detalhe: 'estourou', execucoes: [execucao(false, -1)] });
  assert.deepEqual(lerConferencia('T1', JSON.stringify(prazo), 1, ''), { tipo: 'sem-veredito', comando: 'npm test', motivo: 'verify.timeout', detalhe: 'estourou' });
  assert.equal(lerConferencia('T2', JSON.stringify(aprovada), 0, '').tipo, 'indisponivel', 'resposta de outra tarefa');
  assert.equal(lerConferencia('T1', JSON.stringify(aprovada), 1, '').tipo, 'sem-veredito', 'item aprovado com saída 1 não fecha');
  let erro = '';
  try { verifyDaTarefa('### T1 x\n', 'T1'); } catch (e) { erro = (e as Error).message; }
  assert.match(erro, /^claims\.conferir\.tarefa-sem-verify: /);
  const recusa = JSON.stringify({ formato: FORMATO_DA_CONFERENCIA, thread: 'ork-a', ok: false, erro });
  assert.deepEqual(lerConferencia('T1', recusa, 2, ''), { tipo: 'recusada', motivo: erro });
  assert.deepEqual(lerConferencia('T1', '', 3, 'conducao em andamento\n'), { tipo: 'ocupada', motivo: 'conducao em andamento' });
  assert.deepEqual(lerConferencia('T1', 'texto solto', 2, 'uso: ork\ncomando desconhecido\n'),
    { tipo: 'indisponivel', motivo: 'ork claims conferir sem resultado: comando desconhecido' });
  assert.deepEqual(lerConferencia('T1', '', null, ''), { tipo: 'indisponivel', motivo: 'ork claims conferir sem resultado: saiu com código desconhecido' });
});

test('conferência: texto do bloqueio com a saída sempre dita, fim da saída nos tetos e a terceira vez igual', () => {
  const { textoDoBloqueio, textoDeOutraConferencia, textoDoStatus, fimDaSaida, assinatura, contarRepeticao, TETO_DE_LINHAS_DA_SAIDA, TETO_DE_CARACTERES_DA_SAIDA } = carregar('hooks/verify.ts');
  const reprovada = { tipo: 'reprovada', comando: 'npm test', codigo: 1, fim: Array.from({ length: 40 }, (_, i) => `linha ${i}`).join('\n') };
  const texto = textoDoBloqueio('T1', reprovada, 1);
  assert.match(texto, /^Portão de Tarefas: a tarefa T1 não fecha: o verify do plano reprovou/);
  assert.match(texto, /  \| linha 39$/m);
  assert.doesNotMatch(texto, /linha 24\n/);
  assert.match(texto, /devolva a tarefa para pending \(TaskUpdate\) e siga: o ork verify continua sendo quem verifica\.$/);
  assert.equal(fimDaSaida(reprovada.fim).length, TETO_DE_LINHAS_DA_SAIDA);
  assert.ok(fimDaSaida('x'.repeat(5000)).join('').length <= TETO_DE_CARACTERES_DA_SAIDA);
  assert.deepEqual(fimDaSaida('   '), []);
  assert.match(textoDoBloqueio('T1', reprovada, 3), /É a 3ª vez seguida com o mesmo resultado/);
  assert.match(textoDoBloqueio('T1', { tipo: 'reprovada', comando: '', codigo: null, fim: '' }), /saiu com código desconhecido, sem saída/);
  for (const l of [{ tipo: 'sem-veredito', motivo: 'm', comando: 'c', detalhe: '' }, { tipo: 'recusada', motivo: 'm' }, { tipo: 'ocupada', motivo: 'm' }, { tipo: 'indisponivel', motivo: 'm' }]) {
    assert.match(textoDoBloqueio('T1', l), /devolva a tarefa para pending/, l.tipo);
    assert.match(textoDoStatus('T1', l), /^portão: T1 não fechou \(/);
  }
  assert.equal(textoDoStatus('T1', { tipo: 'aprovada', comando: '' }), undefined);
  assert.match(textoDeOutraConferencia('T5', 'T1'), /conferindo a tarefa T1 no núcleo, uma conferência por vez/);
  const a = assinatura(reprovada);
  assert.deepEqual(contarRepeticao(contarRepeticao(undefined, a), a), { assinatura: a, vezes: 2 });
  assert.deepEqual(contarRepeticao({ assinatura: a, vezes: 2 }, assinatura({ ...reprovada, fim: 'outro' })).vezes, 1);
  assert.notEqual(assinatura({ tipo: 'ocupada', motivo: 'a' }), assinatura({ tipo: 'indisponivel', motivo: 'a' }));
});

const PARES_DE_GLOB: Array<[string, string]> = [
  ['src/a.ts', 'src/**'], ['docs', 'docs/x.md'], ['docs/', 'docs/x.md'], ['core/s', 'core/src'], ['a/*.ts', 'a/b.ts'],
  ['a/*.ts', 'a/b/c.ts'], ['**', 'x'], ['a?c', 'abc'], ['src/e/**', 'src/a.ts'], ['x.y', 'x-y'], ['core/src/**', 'core/test/**'],
  ['', 'a'], ['a/**/b', 'a/x/y/b'], ['a/(b)', 'a/(b)/c'], ['docs/b.md', 'docs/b.md'], ['marketplaces/claude-code/mods/ork-portao', 'marketplaces/**'],
];

test('lease: a colisão de glob e de nome de lease do mod é a do núcleo, nos dois sentidos', () => {
  const m = carregar('hooks/lease.ts');
  for (const [a, b] of PARES_DE_GLOB) {
    assert.equal(m.globsColidem(a, b), globsColidem(a, b), `${a} x ${b}`);
    assert.equal(m.globsColidem(b, a), globsColidem(b, a), `${b} x ${a}`);
    assert.equal(String(m.globParaRegex(a)), String(globParaRegex(a)), a);
  }
  const nomes = ['path:a', 'path:a/b', 'board:a', 'main-tree', 'exec:t', 'foo', 'path:foo', 'service:5173', 'service:5174',
    'worktree-write:t', 'path:src/**', 'path:src/e/x.ts', 'x:y'];
  for (const a of nomes) {
    assert.equal(m.familiaDoLease(a), tipoDoLease(a), a);
    assert.equal(m.alvoDoLease(a), alvoDoLease(a), a);
    for (const b of nomes) assert.equal(m.leasesColidem(a, b), leasesColidem(a, b), `${a} x ${b}`);
  }
});

test('lease: os leases ativos de uma página do retrato, a página seguinte, a lacuna e a seção indisponível', () => {
  const { leasesDoRetrato, paginaDosLeases, nomeDoTeammate } = carregar('hooks/lease.ts');
  const item = (id: string, status: string, thread?: string) => ({ id, title: 'Região reservada', status, refs: thread ? [{ kind: 'thread', id: thread }] : [], facts: {} });
  const secao = (extra: object) => ({ sections: { leases: { state: 'available', gaps: [], items: [item('path:a', 'active', 'ork-a'), item('path:b', 'expired', 'ork-a'),
    item('path:c', 'active'), item('exec:ork-a', 'active', 'ork-a')], ...extra } } });
  assert.deepEqual(leasesDoRetrato(secao({})), [{ nome: 'path:a', thread: 'ork-a' }, { nome: 'exec:ork-a', thread: 'ork-a' }]);
  assert.deepEqual(paginaDosLeases(secao({ coverage: { nextOffset: 50 } })).proximo, 50);
  assert.deepEqual(paginaDosLeases(secao({ coverage: { nextOffset: null } })).proximo, null);
  assert.match(paginaDosLeases(secao({ gaps: ['lease.invalid:x'] })).lacuna, /veio com lacunas \(lease\.invalid:x\)/);
  assert.throws(() => paginaDosLeases({ sections: { leases: { state: 'unavailable', gaps: ['leases.unavailable'], items: [] } } }), /indisponível \(leases\.unavailable\)/);
  assert.throws(() => paginaDosLeases({ sections: {} }), /sem a seção leases/);
  assert.throws(() => leasesDoRetrato(null), /sem a seção leases/);
  assert.equal(nomeDoTeammate('ana'), 'ana');
  assert.equal(nomeDoTeammate('ana@time'), 'ana@time');
  for (const ruim of ['-x', '', 3, 'a b']) assert.equal(nomeDoTeammate(ruim), null, String(ruim));
});

test('lease: o Portão nunca pede lease e lê os leases pela consulta maestro da ponte, página a página', () => {
  const registro = fs.readFileSync(path.join(PORTAO, 'hooks/register.ts'), 'utf8');
  for (const { rel, fonte } of fontesDoMod()) {
    visitar(fonte, (n) => {
      if (!ts.isArrayLiteralExpression(n)) return;
      const textos = n.elements.map((el) => (ts.isStringLiteral(el) ? el.text : ''));
      assert.ok(!(textos.includes('ork') && textos.includes('lease')), `${rel}: argv de ork lease`);
    });
  }
  assert.match(registro, /consulta: 'maestro' as const, secao: 'leases' as const, offset/);
  assert.match(registro, /paginaDosLeases\(await \$\.ork\.ler\(pedido\)\)/);
  assert.doesNotMatch(registro, /retrato\(\{ secao: 'leases'/);
});

test('tetos: lidos do ambiente nos limites do piloto, e a recusa do teammate por teto, por custo e sem tetos', () => {
  const { tetosDoAmbiente, recusaDoTeammate, ENV_TEAMMATES, ENV_CUSTO, VIVOS } = carregar('hooks/lease.ts');
  assert.deepEqual(tetosDoAmbiente('2', '10'), { teammates: 2, custoUsd: 10 });
  assert.deepEqual(tetosDoAmbiente(' 8 ', '500'), { teammates: 8, custoUsd: 500 });
  assert.deepEqual(tetosDoAmbiente('1', '0.5'), { teammates: 1, custoUsd: 0.5 });
  for (const [t, c] of [['0', '1'], ['9', '1'], ['2.5', '1'], ['2', '0'], ['2', '501'], ['2', '-1'], ['2', 'x'], [undefined, '1'], ['2', undefined]]) {
    assert.equal(tetosDoAmbiente(t, c), null, `${t} ${c}`);
  }
  assert.match(recusaDoTeammate(null, 0, 0), /esta sessão não recebeu ORK_AGENT_TEAMS_TEAMMATES e ORK_AGENT_TEAMS_CUSTO_USD/);
  assert.match(recusaDoTeammate({ teammates: 2, custoUsd: 10 }, 2, 0), /já tem 2 teammate\(s\) vivo\(s\), e o teto do piloto é 2/);
  assert.match(recusaDoTeammate({ teammates: 2, custoUsd: 10 }, 1, 10), /chegou ao teto do piloto \(US\$ 10\.00\)/);
  assert.match(recusaDoTeammate({ teammates: 2, custoUsd: 10 }, 1, null), /não pôde ser lido/);
  assert.equal(recusaDoTeammate({ teammates: 2, custoUsd: 10 }, 1, 9.99), null);
  // O validador pede o nome literal no $.env.get: o register.ts precisa ler exatamente os nomes das constantes.
  const registro = fs.readFileSync(path.join(PORTAO, 'hooks/register.ts'), 'utf8');
  assert.equal(ENV_TEAMMATES, 'ORK_AGENT_TEAMS_TEAMMATES');
  assert.equal(ENV_CUSTO, 'ORK_AGENT_TEAMS_CUSTO_USD');
  assert.ok(registro.includes(`$.env.get('${ENV_TEAMMATES}')`) && registro.includes(`$.env.get('${ENV_CUSTO}')`));
  assert.deepEqual([...VIVOS], ['pending', 'running', 'waiting', 'idle']);
});

test('escolha: a próxima tarefa livre na ordem do plano, sem a de outro teammate, sem região cruzada e sem lease path: ativo de thread nenhuma', () => {
  const { escolherTarefa, textoDaEntrega } = carregar('hooks/lease.ts');
  const t = (id: string, touchPaths: string[], extra: Record<string, unknown> = {}) => ({ id, titulo: `tarefa ${id}`, touchPaths, verify: 'true', problema: null, ...extra });
  const tarefas = [t('T1', ['src/a.ts', 'docs']), t('T2', ['src/**']), t('T3', ['docs/b.md']), t('T4', ['x'], { verify: null, problema: 'tarefa-sem-verify' }), t('T5', ['y/z.ts'])];
  const vazio = { thread: 'ork-a', tarefas: {}, concluidas: [], repeticoes: {}, atribuicoes: {}, devolvidas: [], ultimaFalha: null };
  const escolher = (quadro: object, leases: Array<{ nome: string; thread: string }> = []) =>
    escolherTarefa({ tarefas, quadro: { ...vazio, ...quadro }, teammate: 'ana', leases })?.id ?? null;
  assert.equal(escolher({}), 'T1');
  assert.equal(escolher({ atribuicoes: { bia: 'T1' } }), 'T5', 'T2 e T3 cruzam a região de T1');
  assert.equal(escolher({ atribuicoes: { bia: 'T1' }, concluidas: ['T1'] }), 'T2', 'tarefa concluída não segura região');
  assert.equal(escolher({ concluidas: ['T1'], devolvidas: ['T2'] }), 'T3');
  assert.equal(escolher({}, [{ nome: 'path:src/**', thread: 'ork-b' }]), 'T3');
  assert.equal(escolher({}, [{ nome: 'path:docs', thread: 'ork-a' }]), 'T2', 'o lease path: da própria thread também barra: barra o commit');
  assert.equal(escolher({}, [{ nome: 'exec:ork-a', thread: 'ork-a' }, { nome: 'worktree-write:ork-a', thread: 'ork-a' }, { nome: 'main-tree', thread: 'ork-b' }]), 'T1',
    'família que não é path não cruza região');
  assert.equal(escolher({}, [{ nome: 'path:**', thread: 'ork-b' }]), null);
  assert.equal(escolher({ atribuicoes: { ana: 'T1' } }), 'T1', 'a própria atribuição não bloqueia o teammate');
  const texto = textoDaEntrega(tarefas[0], 'ana');
  assert.match(texto, /^Portão de Tarefas: ana, pegue a tarefa T1 do plano \(tarefa T1\)\.\n  touch_paths: src\/a\.ts, docs\n  verify: true\n/);
  assert.match(texto, /crie-a com o assunto começando por T1/);
  assert.match(texto, /nenhum lease path: ativo cruzava essa região/);
});

test('escopo do plano: só com ao menos uma tarefa que serve ao quadro', () => {
  const { escopoDoPlano, tarefasDoPlano } = carregar('hooks/plano.ts');
  const q = String.fromCharCode(96);
  const so = (linhas: string[]) => escopoDoPlano(tarefasDoPlano(linhas.join('\n')));
  assert.deepEqual(so(['### T1 a', `- **verify:** ${q}true${q}`, '### T2 b', `- **touch_paths:** ${q}src/b.ts${q}`]),
    { ativo: false, motivo: 'nenhuma tarefa do plano tem touch_paths e verify conferível' });
  assert.equal(so(['### T1 a', `- **verify:** ${q}true${q}`, `- **touch_paths:** ${q}src/a.ts${q}`]).ativo, true);
  assert.equal(escopoDoPlano(null).ativo, false);
  assert.equal(escopoDoPlano([]).ativo, false);
});

test('touch_paths: rótulo com contagem entre parênteses e só trecho com cara de caminho', () => {
  const { tarefasDoPlano } = carregar('hooks/plano.ts');
  const q = String.fromCharCode(96);
  const t = tarefasDoPlano([
    '### T1 a', `- touch_paths (4): ${q}core/src/a.ts${q}, ${q}docs/${q}, ${q}README.md${q} e ${q}src/**${q}`,
    '### T2 b', `- **touch_paths:** o ${q}Modo${q}, o ${q}fast${q} e ${q}ORDEM_DOS_MODOS${q}`,
    '### T3 c', `- ${q}touch_paths${q} (2): ${q}a/b.ts${q}`, '### T4 d', `- **touch_paths (1):** ${q}x.y${q}`,
  ].join('\n')) as Array<{ id: string; touchPaths: string[] }>;
  assert.deepEqual(t.map((x) => [x.id, x.touchPaths]), [['T1', ['core/src/a.ts', 'docs', 'README.md', 'src/**']], ['T2', []], ['T3', ['a/b.ts']], ['T4', ['x.y']]]);
});

test('conferência: a recusa de condução com --json vem no stdout com o texto da recusa', () => {
  const { lerConferencia } = carregar('hooks/verify.ts');
  const recusa = JSON.stringify({ contrato: 'ork.conducao-recusa/v1', motivo: 'conducao.em-andamento', texto: 'conduzida por outra sessao\nespere' });
  assert.deepEqual(lerConferencia('T1', recusa, 3, ''), { tipo: 'ocupada', motivo: 'conduzida por outra sessao' });
  assert.deepEqual(lerConferencia('T1', '', 3, 'erro: outra conducao\n'), { tipo: 'ocupada', motivo: 'erro: outra conducao' });
});

test('os testes do kit cobrem os três portões: criação sem touch_paths, conclusão reprovada e teammate com lease ocupado', () => {
  const kit = (rel: string) => fs.readFileSync(path.join(PORTAO, 'test', rel), 'utf8');
  const nomes = (rel: string) => [...kit(rel).matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.ok(nomes('portao.test.ts').includes('criacao sem touch_paths no plano devolve block com o motivo e as tarefas que servem'));
  assert.ok(nomes('portao.test.ts').includes('criacao sem verify conferivel devolve block: sem linha de verify e verify com dois comandos'));
  assert.ok(nomes('verify.test.ts').includes('conclusao com a conferencia reprovada devolve block com o comando e o fim da saida'));
  assert.ok(nomes('verify.test.ts').includes('conclusao com a conferencia aprovada passa e a tarefa fica concluida no quadro'));
  assert.ok(nomes('lease.test.ts').includes('teammate ocioso com o lease da proxima tarefa ocupado por outra thread nao a recebe e recebe a seguinte livre'));
  assert.ok(nomes('lease.test.ts').includes('sem tarefa livre o teammate fica ocioso e nenhum lease e pedido'));
  // O kit roda nos dois lugares em que o `claude` existe: o host e o job `mods` do CI (canário com --com-plugin).
  assert.ok(nomes('portao.test.ts').length + nomes('verify.test.ts').length + nomes('lease.test.ts').length >= 30);
  for (const rel of ['portao.test.ts', 'verify.test.ts', 'lease.test.ts']) assert.doesNotMatch(kit(rel), /\$\.process\.(run|spawn)\(/, `${rel}: o teste não roda processo`);
  assert.ok(kit('lease.test.ts').split('expect(leases).toEqual([])').length >= 4, 'os testes do teammate conferem que nenhum lease é pedido');
  assert.ok(nomes('lease.test.ts').includes('dois teammates ociosos ao mesmo tempo nao recebem regioes que se cruzam'));
  assert.ok(nomes('verify.test.ts').includes('quando o proprio Portao falha na conclusao, a tarefa que cita um id do plano nao fecha; a sem id passa'));
});
