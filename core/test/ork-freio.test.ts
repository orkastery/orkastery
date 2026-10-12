import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

// RM-059 (fatia F2): o Freio de Lote `ork-freio` testado sem o Claude Code. O sandbox do `ork verify` e o
// runner do CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros do Freio com o
// compilador do `core` (pelo carregador do `checar-mods.cjs`, o mesmo da guarda estatica e da ponte) e os
// roda num escopo proprio. Modulo puro so importa tipos: nenhum `require` acontece.
const raizDoRepo = path.resolve(__dirname, '../../..');
const FREIO = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-freio');
const MODULOS_PUROS = ['hooks/carga.ts'];
const { carregarModuloDoMod } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
const carregar = (rel: string) => carregarModuloDoMod(path.join(FREIO, rel));
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(FREIO, rel), 'utf8'));

/** Os fontes do hooks module do Freio (sem testes nem tipos), com o caminho relativo a pasta do mod. */
function fontesDoMod(): Array<{ rel: string; fonte: ts.SourceFile }> {
  const pasta = path.join(FREIO, 'hooks');
  return fs.readdirSync(pasta).filter((n) => /\.(ts|tsx)$/.test(n)).sort().map((n) => {
    const arquivo = path.join(pasta, n);
    return { rel: `hooks/${n}`, fonte: ts.createSourceFile(arquivo, fs.readFileSync(arquivo, 'utf8'), ts.ScriptTarget.ES2022, true) };
  });
}

function visitar(no: ts.Node, cada: (n: ts.Node) => void): void {
  cada(no);
  ts.forEachChild(no, (filho) => visitar(filho, cada));
}

test('manifesto do Freio: nome, contrato, dependencia da ponte e nenhuma chave fora do formato do Claude Code', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-freio');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  assert.equal(typeof m.author?.name, 'string');
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.ts'] });
  assert.ok(fs.existsSync(path.join(FREIO, 'hooks/register.ts')));
});

test('orkastery-mod.json do Freio: so o papel fase, na convencao ork.mod/v1', () => {
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['fase'], claudeCodeMinimo: '2.1.287' });
});

test('contrato de tipos: o estado do Freio declarado, sem noun no $, sem import nem referencia', () => {
  const contrato = fs.readFileSync(path.join(FREIO, 'types/index.d.ts'), 'utf8');
  assert.match(contrato, /interface PluginState \{\s*'ork-freio': \{/);
  assert.match(contrato, /carga: FreioCarga/);
  assert.match(contrato, /vigia: FreioVigia/);
  assert.doesNotMatch(contrato, /interface EngineInterface/);
  assert.doesNotMatch(contrato, /^\s*import\s/m);
  assert.doesNotMatch(contrato, /\/\/\/\s*<reference/);
});

test('modulo puro do Freio so importa tipos', () => {
  for (const rel of MODULOS_PUROS) {
    const fonte = fs.readFileSync(path.join(FREIO, rel), 'utf8');
    const imports = fonte.split('\n').filter((l) => /^\s*import\s/.test(l));
    assert.deepEqual(imports.filter((l) => !/^\s*import type\s/.test(l)), [], rel);
  }
});

test('lista fechada do MCP: toda chamada mcp.call do Freio usa o servidor orkastery e uma das duas ferramentas de leitura', () => {
  const { SERVIDOR, FERRAMENTA_DAS_CLAIMS, FERRAMENTA_DO_PLANO, FERRAMENTAS_DO_FREIO } = carregar('hooks/carga.ts');
  assert.equal(SERVIDOR, 'orkastery');
  assert.deepEqual([...FERRAMENTAS_DO_FREIO], ['ork_claims_list', 'ork_artifact_read']);
  assert.equal(FERRAMENTA_DAS_CLAIMS, 'ork_claims_list');
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
      assert.ok(['FERRAMENTA_DAS_CLAIMS', 'FERRAMENTA_DO_PLANO'].includes(nome(ferramenta)), `${rel}: ferramenta fora da lista fechada: ${nome(ferramenta)}`);
    });
  }
  assert.ok(chamadas.length >= 2, `esperava as chamadas de leitura do Freio, achei ${chamadas.length}`);
});

test('nenhum literal do Freio aponta o estado interno do nucleo em .orkastery (dados so pelo nucleo, D2)', () => {
  for (const { rel, fonte } of fontesDoMod()) {
    visitar(fonte, (n) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
        && n.text.includes('.orkastery')) assert.fail(`${rel}: literal com .orkastery: ${n.text}`);
    });
  }
});

test('carga: claims do nucleo sem as retiradas, a ultima versao de cada id vence e o arquivo sai normalizado', () => {
  const { claimsDoNucleo } = carregar('hooks/carga.ts');
  const lista = [
    { id: 'C10', arquivo: './src/z.ts', verificar: ['npm test', '', 3], estado: 'pendente' },
    { id: 'C2', arquivo: 'src/a.ts', verificar: ['grep -c a src/a.ts'], estado: 'verificada' },
    { id: 'C3', arquivo: 'src/b.ts', verificar: ['x'], estado: 'pendente' },
    { id: 'C3', arquivo: 'src/b.ts', verificar: ['x'], estado: 'retirada' },
    { id: 'C4', arquivo: '', verificar: 'nao e lista', estado: 'pendente' },
    { id: 'T1', arquivo: 'src/t.ts', verificar: ['y'] },
    null,
  ];
  assert.deepEqual(claimsDoNucleo(lista), [
    { id: 'C2', arquivo: 'src/a.ts', comandos: ['grep -c a src/a.ts'] },
    { id: 'C4', arquivo: null, comandos: [] },
    { id: 'C10', arquivo: 'src/z.ts', comandos: ['npm test'] },
  ]);
  assert.throws(() => claimsDoNucleo({ claims: [] }), /nao e lista/);
});

test('carga: o JSON do resultado MCP, e a recusa de erro, de resultado sem texto e de texto que nao e JSON', () => {
  const { jsonDoMcp } = carregar('hooks/carga.ts');
  assert.deepEqual(jsonDoMcp({ content: [{ type: 'image' }, { type: 'text', text: '[1]' }] }, 'f'), [1]);
  assert.throws(() => jsonDoMcp({ content: [{ type: 'text', text: 'mcp.thread.unknown' }], isError: true }, 'f'), /f respondeu com erro: mcp.thread.unknown/);
  assert.throws(() => jsonDoMcp({ content: [] }, 'f'), /f nao devolveu texto/);
  assert.throws(() => jsonDoMcp({ content: [{ type: 'text', text: '{' }] }, 'f'), /nao e JSON/);
  assert.throws(() => jsonDoMcp(null, 'f'), /nao devolveu texto/);
});

test('carga: argumentos so da lista fechada e com id de thread valido', () => {
  const { argsDaFerramenta } = carregar('hooks/carga.ts');
  assert.deepEqual(argsDaFerramenta('ork_claims_list', 'ork-a'), { threadId: 'ork-a' });
  assert.deepEqual(argsDaFerramenta('ork_artifact_read', 'ork-a'), { threadId: 'ork-a', tipo: 'plan' });
  assert.throws(() => argsDaFerramenta('ork_git_commit', 'ork-a'), /fora da lista fechada/);
  assert.throws(() => argsDaFerramenta('ork_claims_list', '../fora'), /id de thread invalido/);
});

test('carga: touch_paths do plano pelos rotulos das tarefas, com itens de lista abaixo e nada fora deles', () => {
  const { touchPathsDoPlano, textoDoPlano } = carregar('hooks/carga.ts');
  const plano = [
    '# PLAN',
    'Texto que cita `touch_paths` e `src/fora.ts` sem ser rotulo.',
    '### T1 Uma',
    '- **touch_paths:** `src/a.ts`, `./docs/`, `com espaco`, `-opcao`, `../fora`',
    '- **verify:** `npm test`',
    '### T2 Outra',
    '- **touch_paths**: `src/b.ts`',
    '- `touch_paths`: `src/c/**`',
    'touch_paths: `src/d.ts`',
    '- **touch_paths:**',
    '  - `src/e.ts`',
    '  * `src/f.ts`',
    '- `src/fora-da-lista.ts`',
    '### D9. `touch_paths` do plano',
    'Vale `*` e `**`.',
  ].join('\n');
  assert.deepEqual(touchPathsDoPlano(plano), ['docs', 'src/a.ts', 'src/b.ts', 'src/c/**', 'src/d.ts', 'src/e.ts', 'src/f.ts']);
  assert.equal(touchPathsDoPlano('# PLAN sem tarefas'), null);
  assert.equal(touchPathsDoPlano(null), null);
  assert.equal(textoDoPlano({ tipo: 'plan', conteudo: 'x' }), 'x');
  assert.equal(textoDoPlano({ tipo: 'plan', conteudo: null }), null);
  assert.throws(() => textoDoPlano('texto'), /nao e objeto/);
});

test('carga: status da thread no retrato e o Freio dormente so com a thread fechada', () => {
  const { statusNoRetrato, threadAtiva } = carregar('hooks/carga.ts');
  const retrato = { sections: { threads: { items: [{ id: 'ork-b', status: 'fechada' }, { id: 'ork-a', status: 'aberta' }] } } };
  assert.equal(statusNoRetrato(retrato, 'ork-a'), 'aberta');
  assert.equal(statusNoRetrato(retrato, 'ork-b'), 'fechada');
  assert.equal(statusNoRetrato(retrato, 'ork-c'), null);
  assert.equal(statusNoRetrato({ sections: {} }, 'ork-a'), null);
  assert.equal(statusNoRetrato(null, 'ork-a'), null);
  assert.equal(threadAtiva('aberta'), true);
  assert.equal(threadAtiva(null), true);
  assert.equal(threadAtiva('fechada'), false);
});

test('carga: claims e plano velhos pela idade, por nunca lidos ou pelo lote que mexeu neles', () => {
  const { cargaVazia, claimsVelhas, planoVelho, IDADE_DAS_CLAIMS_MS, IDADE_DO_PLANO_MS } = carregar('hooks/carga.ts');
  const vazia = cargaVazia('ork-a');
  assert.equal(claimsVelhas(vazia, 0, false), true);
  assert.equal(planoVelho(vazia, 0, false), true);
  const lida = { ...vazia, claims: [], claimsEm: 1000, planoLido: true, planoEm: 1000 };
  assert.equal(claimsVelhas(lida, 1000 + IDADE_DAS_CLAIMS_MS - 1, false), false);
  assert.equal(claimsVelhas(lida, 1000 + IDADE_DAS_CLAIMS_MS, false), true);
  assert.equal(claimsVelhas(lida, 1001, true), true);
  assert.equal(claimsVelhas(lida, 999, false), true);
  assert.equal(planoVelho(lida, 1000 + IDADE_DO_PLANO_MS - 1, false), false);
  assert.equal(planoVelho(lida, 1000 + IDADE_DO_PLANO_MS, false), true);
  assert.equal(planoVelho(lida, 1001, true), true);
});
