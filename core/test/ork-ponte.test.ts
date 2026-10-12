import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { SECTION_NAMES } from '../src/maestro-contract';

// RM-059 (onda 0): a ponte `ork-ponte` testada sem o Claude Code. O sandbox do `ork verify` e o runner
// do CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros da ponte com o compilador
// do `core` e os roda num escopo proprio. Modulo puro so importa tipos: nenhum `require` acontece.
const raizDoRepo = path.resolve(__dirname, '../../..');
const PONTE = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte');
const MODULOS_PUROS = ['hooks/papel.ts', 'hooks/nucleo.ts'];

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

test('nucleo: as secoes da ponte sao as do contrato do retrato do nucleo', () => {
  const { SECOES } = carregar('hooks/nucleo.ts');
  assert.deepEqual([...SECOES], [...SECTION_NAMES]);
});

test('nucleo: cada consulta da lista fechada existe no CLI com --json', () => {
  const { CONSULTAS } = carregar('hooks/nucleo.ts');
  const ajuda = fs.readFileSync(path.join(raizDoRepo, 'core/src/index.ts'), 'utf8');
  const ajudaDoMaestro = fs.readFileSync(path.join(raizDoRepo, 'core/src/maestro-cli.ts'), 'utf8');
  for (const [consulta, modelo] of Object.entries(CONSULTAS) as Array<[string, { argv: string[] }]>) {
    const palavras = modelo.argv.filter((a) => !a.startsWith('-') && a !== '<thread>');
    if (consulta === 'maestro') { assert.match(ajudaDoMaestro, /ork maestro \[--json\]/); continue; }
    // A entrada da ajuda e a linha do comando mais as linhas de continuacao (opcoes recuadas).
    const linhas = ajuda.split('\n');
    const i = linhas.findIndex((l) => new RegExp(`^\\s+${palavras.join(' ')}\\b`).test(l));
    assert.ok(i >= 0, `${consulta}: ${palavras.join(' ')} na ajuda do CLI`);
    let entrada = linhas[i];
    for (let j = i + 1; j < linhas.length && /^\s{6,}\[/.test(linhas[j]); j++) entrada += linhas[j];
    assert.ok(entrada.includes('--json'), `${consulta}: ${palavras.join(' ')} aceita --json`);
  }
});

test('nucleo: argv so da lista fechada, thread no lugar certo e maestro com secao e offset juntos', () => {
  const { argvDaConsulta } = carregar('hooks/nucleo.ts');
  assert.deepEqual(argvDaConsulta({ consulta: 'thread.status', thread: 'ork-a' }), ['ork', 'thread', 'status', 'ork-a', '--json']);
  assert.deepEqual(argvDaConsulta({ consulta: 'pulse' }), ['ork', 'pulse', '--json']);
  assert.deepEqual(argvDaConsulta({ consulta: 'maestro', thread: 'ork-a', secao: 'hitl' }),
    ['ork', 'maestro', '--json', '--thread', 'ork-a', '--section', 'hitl', '--offset', '0']);
  for (const consulta of ['gate.answer', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => argvDaConsulta({ consulta }), /fora da lista fechada/, consulta);
  }
  assert.throws(() => argvDaConsulta({ consulta: 'decisao.placar' }), /exige thread/);
  assert.throws(() => argvDaConsulta({ consulta: 'thread.status', thread: 'a b' }), /id de thread invalido/);
});

test('nucleo: pedido de retrato conferido e argumentos do ork_maestro', () => {
  const { conferirPedidoDeRetrato, argsDoMaestro } = carregar('hooks/nucleo.ts');
  assert.deepEqual(conferirPedidoDeRetrato(undefined), {});
  assert.deepEqual(conferirPedidoDeRetrato({ secao: 'ship' }), { secao: 'ship', offset: 0 });
  assert.throws(() => conferirPedidoDeRetrato({ secao: 'roadmap' }), /secao desconhecida/);
  assert.throws(() => conferirPedidoDeRetrato({ offset: 1 }), /offset so vale com secao/);
  assert.throws(() => conferirPedidoDeRetrato({ secao: 'ship', offset: -1 }), /offset fora da faixa/);
  assert.deepEqual(argsDoMaestro({ thread: 'ork-a', secao: 'ship', offset: 50 }), { threadId: 'ork-a', section: 'ship', offset: 50 });
  assert.deepEqual(argsDoMaestro({}), {});
});

test('nucleo: interpretar a resposta do MCP e a saida do CLI', () => {
  const { interpretarMcp, interpretarCli } = carregar('hooks/nucleo.ts');
  assert.deepEqual(interpretarMcp({ content: [{ type: 'text', text: '{"a":1}' }], isError: false }), { a: 1 });
  assert.throws(() => interpretarMcp({ content: [{ type: 'text', text: '{}' }], isError: true }), /respondeu com erro/);
  assert.throws(() => interpretarMcp({ content: [], isError: false }), /nao devolveu texto/);
  assert.deepEqual(interpretarCli(['ork', 'pulse', '--json'], { exitCode: 0, stdout: '[1]', stderr: '' }), [1]);
  assert.throws(() => interpretarCli(['ork', 'pulse', '--json'], { exitCode: 2, stdout: '', stderr: 'x\ny' }), /ork pulse --json saiu 2: x y/);
});

test('nucleo: o cache vale com a mesma assinatura e dentro de 60 s', () => {
  const { cacheValido, TETO_DO_CACHE_MS } = carregar('hooks/nucleo.ts');
  const assinatura = [{ caminho: '/l', tamanho: 1, mtimeMs: 2 }];
  const entrada = { fonte: 'mcp', lidoEm: 1000, retrato: {}, caminhos: ['/l'], assinatura };
  assert.equal(TETO_DO_CACHE_MS, 60000);
  assert.equal(cacheValido(entrada, assinatura, 1500), true);
  assert.equal(cacheValido(entrada, [{ caminho: '/l', tamanho: 1, mtimeMs: 3 }], 1500), false);
  assert.equal(cacheValido(entrada, [{ caminho: '/l', ausente: true }], 1500), false);
  assert.equal(cacheValido(entrada, assinatura, 1000 + 60000), false);
  assert.equal(cacheValido(entrada, assinatura, 999), false);
  assert.equal(cacheValido({ ...entrada, caminhos: [] }, assinatura, 1500), false);
  assert.equal(cacheValido(undefined, assinatura, 1500), false);
});

test('nucleo: ledgers cobertos pelo retrato e teto das entradas guardadas', () => {
  const { caminhosCobertos, guardar, TETO_DE_ENTRADAS } = carregar('hooks/nucleo.ts');
  const retrato = { sections: { threads: { items: [{ id: 'ork-a' }, { id: '../x' }, { id: 'ork-b' }, { id: 'ork-a' }] } } };
  assert.deepEqual(caminhosCobertos('/p', { thread: 'ork-z' }, retrato), ['/p/.orkastery/threads/ork-z/ledger.jsonl']);
  assert.deepEqual(caminhosCobertos('/p/', {}, retrato), ['/p/.orkastery/threads', '/p/.orkastery/threads/ork-a/ledger.jsonl',
    '/p/.orkastery/threads/ork-b/ledger.jsonl']);
  assert.deepEqual(caminhosCobertos(null, {}, retrato), []);
  let cache = {};
  for (let i = 0; i < TETO_DE_ENTRADAS + 4; i++) cache = guardar(cache, `k${i}`, { fonte: 'mcp', lidoEm: i, retrato: {}, caminhos: ['/l'], assinatura: [] });
  assert.equal(Object.keys(cache).length, TETO_DE_ENTRADAS);
  assert.ok(!('k0' in cache) && `k${TETO_DE_ENTRADAS + 3}` in cache);
});

test('nucleo: a raiz do estado sobe da worktree ao checkout principal, e o git e a reserva', async () => {
  const { subirAteOEstado, raizPeloGit } = carregar('hooks/nucleo.ts');
  const existe = (lista: string[]) => async (c: string) => lista.includes(c);
  const principal = existe(['/srv/proj/orkastery.yaml', '/srv/proj/.orkastery']);
  assert.equal(await subirAteOEstado('/srv/proj/.claude/worktrees/ork-a', principal), '/srv/proj');
  assert.equal(await subirAteOEstado('/srv/proj', principal), '/srv/proj');
  assert.equal(await subirAteOEstado('/srv/outro', principal), null);
  assert.equal(await subirAteOEstado('/srv/proj/a/b/c/d/e/f/g/h/i/j', principal), null);
  assert.equal(raizPeloGit('/srv/proj/.git\n'), '/srv/proj');
  assert.equal(raizPeloGit('.git'), null);
  assert.equal(raizPeloGit('/srv/proj/.git/worktrees/ork-a'), null);
});
