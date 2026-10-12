import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

// RM-059 (onda 0): a ponte `ork-ponte` testada sem o Claude Code. O sandbox do `ork verify` e o runner
// do CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros da ponte com o compilador
// do `core` e os roda num escopo proprio. Modulo puro so importa tipos: nenhum `require` acontece.
const raizDoRepo = path.resolve(__dirname, '../../..');
const PONTE = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte');
const MODULOS_PUROS = ['hooks/papel.ts'];

function carregar(rel: string): any {
  const arquivo = path.join(PONTE, rel);
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, jsxFactory: 'h', jsxFragmentFactory: 'Fragment',
    },
  });
  const modulo = { exports: {} as Record<string, unknown> };
  const exigir = (id: string) => { throw new Error(`modulo puro da ponte nao importa valor: ${id}`); };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}

const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(PONTE, rel), 'utf8'));

test('manifesto da ponte: nome, contrato e nenhuma chave nova fora do formato do Claude Code', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-ponte');
  assert.equal(m.types, './types/index.d.ts');
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.ts'] });
  assert.ok(fs.existsSync(path.join(PONTE, 'hooks/register.ts')));
});

test('orkastery-mod.json segue a convencao compartilhada com a thread do nucleo', () => {
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono', 'fase'], claudeCodeMinimo: '2.1.287' });
});

test('o contrato declara $.ork sem import nem referencia', () => {
  const contrato = fs.readFileSync(path.join(PONTE, 'types/index.d.ts'), 'utf8');
  assert.match(contrato, /interface EngineInterface \{\s*ork: Ork\s*\}/);
  assert.doesNotMatch(contrato, /^\s*import\s/m);
  assert.doesNotMatch(contrato, /\/\/\/\s*<reference/);
});

test('modulo puro da ponte so importa tipos', () => {
  for (const rel of MODULOS_PUROS) {
    const fonte = fs.readFileSync(path.join(PONTE, rel), 'utf8');
    const imports = fonte.split('\n').filter((l) => /^\s*import\s/.test(l));
    assert.deepEqual(imports.filter((l) => !/^\s*import type\s/.test(l)), [], rel);
  }
});

test('papel: fase pelo despacho, dono so com manifesto e servidor sem thread, dormente no resto', () => {
  const { decidirPapel, FERRAMENTA_DO_DONO } = carregar('hooks/papel.ts');
  assert.equal(FERRAMENTA_DO_DONO, 'mcp__orkastery__ork_request_decision');
  const casos: Array<[Record<string, unknown>, string]> = [
    [{ dispatchId: 'd1', temManifesto: false, ferramentas: [] }, 'fase'],
    [{ dispatchId: '  ', temManifesto: true, ferramentas: [FERRAMENTA_DO_DONO] }, 'dono'],
    [{ dispatchId: undefined, temManifesto: true, ferramentas: ['Bash', FERRAMENTA_DO_DONO] }, 'dono'],
    [{ dispatchId: undefined, temManifesto: true, ferramentas: ['mcp__orkastery__ork_thread_status'] }, 'dormente'],
    [{ dispatchId: undefined, temManifesto: false, ferramentas: [FERRAMENTA_DO_DONO] }, 'dormente'],
    [{ dispatchId: '', temManifesto: false, ferramentas: [] }, 'dormente'],
  ];
  for (const [entrada, esperado] of casos) assert.equal(decidirPapel(entrada), esperado, JSON.stringify(entrada));
});

test('thread do despacho so na fase e com id valido; juntar usa uma barra', () => {
  const { threadDoDespacho, idDeThreadValido, juntar } = carregar('hooks/papel.ts');
  assert.equal(threadDoDespacho('fase', 'ork-exemplo'), 'ork-exemplo');
  assert.equal(threadDoDespacho('fase', '../fora'), null);
  assert.equal(threadDoDespacho('fase', undefined), null);
  assert.equal(threadDoDespacho('dono', 'ork-exemplo'), null);
  assert.equal(idDeThreadValido('a'.repeat(81)), false);
  assert.equal(juntar('/projeto/', '/orkastery.yaml'), '/projeto/orkastery.yaml');
  assert.equal(juntar('/projeto', 'x/y'), '/projeto/x/y');
});
