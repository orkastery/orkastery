import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { verifyDaTarefa } from '../src/claims-conferir';
import { slugDasFases } from '../src/modos';
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
  assert.doesNotMatch(contrato, /interface EngineInterface/);
  assert.doesNotMatch(contrato, /^\s*import\s/m);
  assert.doesNotMatch(contrato, /\/\/\/\s*<reference/);
});

test('módulo puro do Portão só importa tipos', () => {
  assert.ok(modulosPuros().includes('hooks/plano.ts'));
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
