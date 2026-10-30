import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SECTION_NAMES } from '../src/maestro-contract';
import { msg } from '../src/locale';

// RM-059 (onda 0): a ponte `ork-ponte` testada sem o Claude Code. O sandbox do `ork verify` e o runner
// do CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros da ponte com o compilador
// do `core` (pelo carregador do `checar-mods.cjs`, o mesmo da guarda estatica) e os roda num escopo
// proprio. Modulo puro so importa tipos: nenhum `require` acontece.
const raizDoRepo = path.resolve(__dirname, '../../..');
const PONTE = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte');
const AUTORIDADE = path.join(raizDoRepo, 'adapters/claude-code/mods/autoridade.json');
const MODULOS_PUROS = ['hooks/papel.ts', 'hooks/nucleo.ts', 'hooks/faixa.tsx', 'hooks/vigia.ts', 'hooks/mostrado.ts', 'hooks/guarda.ts'];
const { carregarModuloDoMod } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
const carregar = (rel: string) => carregarModuloDoMod(path.join(PONTE, rel));

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
  // A ajuda mora no catalogo do locale desde a RM-061 (F2a); as linhas de comando sao as mesmas nas duas linguas.
  const ajuda = msg('pt-BR').ajuda.texto({ versao: '0.0.0', modos: 0, segredos: '', tags: '' });
  const ajudaDoMaestro = msg('pt-BR').maestro.help;
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

test('faixa: uma linha por mod, texto de uma linha, e tirar a linha sem texto', () => {
  const { trocarLinha, nomeDeModValido, TETO_DO_TEXTO } = carregar('hooks/faixa.tsx');
  let linhas = trocarLinha(undefined, 'ork-torre', '  3 threads\n andando  ', 10);
  assert.deepEqual(linhas, [{ mod: 'ork-torre', texto: '3 threads andando', em: 10 }]);
  linhas = trocarLinha(linhas, 'ork-torre', 'outra', 20);
  assert.deepEqual(linhas, [{ mod: 'ork-torre', texto: 'outra', em: 20 }]);
  assert.equal(trocarLinha(linhas, 'ork-clima', 'x'.repeat(500), 30)[1].texto.length, TETO_DO_TEXTO);
  assert.deepEqual(trocarLinha(linhas, 'ork-torre', undefined, 40), []);
  assert.deepEqual(trocarLinha(linhas, 'ork-torre', '   ', 40), []);
  assert.equal(nomeDeModValido('ork-torre'), true);
  for (const ruim of ['Ork', '../x', '', 'a b', 'x'.repeat(65), 7]) assert.equal(nomeDeModValido(ruim), false, String(ruim));
});

test('faixa: ordem de nome, corte a largura, teto de linhas e a linha do que ficou de fora', () => {
  const { comporFaixa, TETO_DE_LINHAS } = carregar('hooks/faixa.tsx');
  const l = (mod: string, texto: string) => ({ mod, texto, em: 0 });
  assert.deepEqual(comporFaixa([l('ork-torre', 'a'), l('ork-clima', 'b')], 80, 6), ['clima: b', 'torre: a']);
  assert.deepEqual(comporFaixa([l('ork-torre', '3 threads andando, 1 parada')], 25, 6), ['torre: 3 threads andando\u2026']);
  assert.equal(TETO_DE_LINHAS, 4);
  const seis = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => l(`ork-${x}`, x));
  assert.deepEqual(comporFaixa(seis, 80, 10), ['a: a', 'b: b', 'c: c', '+3 mods do Orkastery']);
  assert.deepEqual(comporFaixa(seis, 80, 2), ['a: a', '+5 mods do Orkastery']);
  assert.deepEqual(comporFaixa(seis, 80, 0), []);
  assert.deepEqual(comporFaixa([], 80, 6), []);
  assert.deepEqual(comporFaixa([l('outro-mod', 'x')], 80, 6), ['outro-mod: x']);
});

test('vigia: padroes por papel, ledgers recentes e pedidos conferidos', () => {
  const v = carregar('hooks/vigia.ts');
  assert.deepEqual(v.caminhosPadrao('fase', '/p', 'ork-a', []), ['/p/.orkastery/threads/ork-a/ledger.jsonl']);
  assert.deepEqual(v.caminhosPadrao('fase', '/p', null, []), []);
  assert.deepEqual(v.caminhosPadrao('dono', '/p', null, ['/l1']), ['/p/.orkastery/threads', '/l1']);
  assert.deepEqual(v.caminhosPadrao('dormente', '/p', 'ork-a', ['/l1']), []);
  assert.deepEqual(v.caminhosPadrao('dono', null, null, ['/l1']), []);
  assert.deepEqual(v.idsDeThread([{ name: 'ork-a', kind: 'dir' }, { name: 'x.json', kind: 'file' }, { name: '.oculto', kind: 'dir' }]), ['ork-a']);
  assert.deepEqual(v.ledgersRecentes([{ caminho: '/a', mtimeMs: 1 }, { caminho: '/b', mtimeMs: 3 }, { caminho: '/c' }], 1), ['/b']);
  assert.deepEqual(v.registrarPedido({ 'ork-x': ['/x'] }, 'ork-y', ['/y', '/y']), { 'ork-x': ['/x'], 'ork-y': ['/y'] });
  assert.deepEqual(v.registrarPedido({ 'ork-x': ['/x'] }, 'ork-x', []), {});
  assert.throws(() => v.registrarPedido({}, 'ork-x', ['rel/x']), /absoluto/);
  assert.throws(() => v.registrarPedido({}, 'ork-x', ['/a/../b']), /absoluto/);
  assert.throws(() => v.registrarPedido({}, 'ork-x', Array.from({ length: 17 }, (_, i) => `/c${i}`)), /no maximo 16/);
  assert.throws(() => v.registrarPedido({}, 'X', ['/x']), /nome de mod invalido/);
});

test('vigia: o watchPaths guarda o de baixo inteiro, sem duplicata e com teto para o resto', () => {
  const { fundirCaminhos, TETO_DE_CAMINHOS } = carregar('hooks/vigia.ts');
  assert.equal(TETO_DE_CAMINHOS, 64);
  assert.deepEqual(fundirCaminhos(['/b', '/a'], ['/a', '/p'], { 'ork-z': ['/z'], 'ork-m': ['/m', '/p'] }), ['/b', '/a', '/p', '/m', '/z']);
  assert.deepEqual(fundirCaminhos(undefined, ['/p'], undefined), ['/p']);
  const muitos = Array.from({ length: 70 }, (_, i) => `/d${i}`);
  assert.equal(fundirCaminhos(muitos, ['/p'], undefined).length, 70);
  assert.equal(fundirCaminhos([], muitos, undefined).length, 64);
});

test('mostrado: um item por mod, chave e texto, com vezes, teto e formato versionado', () => {
  const m = carregar('hooks/mostrado.ts');
  assert.equal(m.FORMATO_DO_MOSTRADO, 'ork.mod-mostrado/v1');
  let r = m.registrarMostrado(undefined, { mod: 'ork-mesa', canal: 'faixa', texto: 'a' }, 't1');
  r = m.registrarMostrado(r, { mod: 'ork-mesa', canal: 'painel', texto: 'a' }, 't2');
  assert.deepEqual(r.itens, [{ mod: 'ork-mesa', canal: 'painel', chave: null, thread: null, texto: 'a', primeiraVez: 't1', ultimaVez: 't2', vezes: 2 }]);
  r = m.registrarMostrado(r, { mod: 'ork-mesa', canal: 'painel', chave: 'hitl:p1', thread: 'ork-a', texto: 'a' }, 't3');
  assert.equal(r.itens.length, 2);
  for (let i = 0; i < m.TETO_DE_MOSTRADOS + 5; i++) r = m.registrarMostrado(r, { mod: 'ork-x', canal: 'toast', texto: `t${i}` }, `u${i}`);
  assert.equal(r.itens.length, m.TETO_DE_MOSTRADOS);
  assert.equal(r.itens[r.itens.length - 1].texto, `t${m.TETO_DE_MOSTRADOS + 4}`);
  assert.deepEqual(m.lerRegistro({ formato: 'outro', itens: [] }), { formato: 'ork.mod-mostrado/v1', itens: [] });
  assert.equal(m.registrarMostrado(undefined, { mod: 'ork-x', canal: 'toast', texto: 'y'.repeat(900) }, 't').itens[0].texto.length, 500);
});

test('mostrado: o que o mod declara e conferido', () => {
  const { conferirMostrado } = carregar('hooks/mostrado.ts');
  assert.deepEqual(conferirMostrado({ mod: 'ork-mesa', canal: 'painel', texto: 'x', chave: 'k', thread: 'ork-a' }),
    { mod: 'ork-mesa', canal: 'painel', texto: 'x', chave: 'k', thread: 'ork-a' });
  assert.throws(() => conferirMostrado({ mod: 'ork-mesa', canal: 'telegram', texto: 'x' }), /canal desconhecido/);
  assert.throws(() => conferirMostrado({ mod: 'ork-mesa', canal: 'painel', texto: ' ' }), /vazio/);
  assert.throws(() => conferirMostrado({ mod: 'ork-mesa', canal: 'painel', texto: 'x', thread: '../a' }), /thread invalido/);
  assert.throws(() => conferirMostrado(undefined), /nome de mod invalido/);
});

test('guarda: argv da lista real, com embrulho, shell, stdin, interpretador e entradas do ork', () => {
  const guarda = carregar('hooks/guarda.ts');
  const a = guarda.lerAutoridade(fs.readFileSync(AUTORIDADE, 'utf8'));
  const regra = (argv: string[], stdin?: string) => guarda.avaliarArgv(a, argv, stdin)?.regra ?? null;
  const casos: Array<[string[], string | null, string?]> = [
    [['git', 'push', 'origin', 'x'], 'git-push'],
    [['/usr/bin/git', '-C', '/r', '-c', 'k=v', 'push'], 'git-push'],
    [['git', '--git-dir=/r/.git', 'tag', '-l'], 'git-tag'],
    [['git', 'status', '--porcelain'], null],
    [['git', 'log', '--grep', 'push'], null],
    [['git', 'merge-tree', '--write-tree', 'a', 'b'], null],
    [['gh', 'pr', 'create'], 'gh'],
    [['/usr/local/bin/gh'], 'gh'],
    [['env', 'A=1', '-u', 'B', 'git', 'push'], 'git-push'],
    [['timeout', '-k', '5', '30', 'git', 'push'], 'git-push'],
    [['nohup', 'sudo', '-u', 'x', 'gh', 'auth'], 'gh'],
    [['bash', '-lc', 'cd /r && git push origin'], 'git-push'],
    [['sh', '-c', 'echo ok | xargs -n 1 gh'], 'gh'],
    [['bash'], 'git-tag', 'git tag v2'],
    [['bash', '-s'], 'gh', 'gh api user'],
    [['bash', 'script.sh'], null, 'gh api user'],
    [['eval', 'git push'], 'git-push'],
    [['env', '-S', 'git push'], 'git-push'],
    [['node', '-e', "require('child_process').execSync('gh pr merge 1')"], 'gh'],
    [['python3', '-c', 'import os; os.system("git push")'], 'git-push'],
    [['node', 'core/dist/index.js', 'gate', 'answer', 'ork-a', 'p1'], 'gate-answer'],
    [['npx', '@orkastery/cli', 'ship', 'ork-a', '--autorizar-push', 'x'], 'ship-autorizar-push'],
    [['npm', 'exec', '--', 'ork', 'pulse', 'responder'], 'pulse-responder'],
    [['ork', '--projeto', 'x', 'gate', 'answer'], 'gate-answer'],
    [['ork', 'decisao', 'registrar', 'ork-a', '--decidido', 'gate', '--porque', 'answer'], null],
    [['ork', 'retry', 'run', 'ork-a'], null],
    [['ork', 'retry', 'run', 'ork-a', '--por', 'x'], 'retry-run-por'],
    [['ork', 'master', 'ork-a', '--aceitar-omissao'], null],
    [['ork', 'master', 'ork-a', '--score', '4'], 'master-nota'],
    [['ork', 'ship', 'registrar-pr', 'ork-a'], null],
    [['ork', 'maestro', '--json'], null],
    [['cat', '/srv/u/.hermes//.env'], 'hermes-env'],
    [['cat', '~/.hermes/./.env'], 'hermes-env'],
    [['eval', 'eval eval eval eval eval eval true'], 'profundidade'],
  ];
  for (const [argv, esperado, stdin] of casos) assert.equal(regra(argv, stdin), esperado, JSON.stringify(argv));
});

test('guarda: gerenciador de pacotes sem exec, ambiente por processo filho e caminho em maiusculas (revisao 1)', () => {
  const guarda = carregar('hooks/guarda.ts');
  const a = guarda.lerAutoridade(fs.readFileSync(AUTORIDADE, 'utf8'));
  const regra = (argv: string[], stdin?: string) => guarda.avaliarArgv(a, argv, stdin)?.regra ?? null;
  const casos: Array<[string[], string | null, string?]> = [
    [['yarn', 'ork', 'gate', 'answer', 'ork-a', 'p1'], 'gate-answer'],
    [['yarn', 'run', 'ork', 'gate', 'answer'], 'gate-answer'],
    [['pnpm', 'ork', 'gate', 'answer'], 'gate-answer'],
    [['bun', 'ork', 'gate', 'answer'], 'gate-answer'],
    [['yarn', '--cwd', 'x', 'ork', 'master', 'ork-a', '--score', '3'], 'master-nota'],
    [['yarn', 'gh', 'pr', 'merge'], 'gh'],
    [['npm', '--prefix', 'core', 'run', 'build'], null],
    [['yarn', 'install'], null],
    [['printenv', 'ORK_HITL_TOKEN'], 'hitl-env'],
    [['sh', '-c', 'echo $ORK_HITL_TOKEN'], 'hitl-env'],
    [['bash'], 'hitl-env', 'echo $ORK_HITL_X'],
    [['printenv'], 'hitl-env'],
    [['env'], 'hitl-env'],
    [['env', '-i'], 'hitl-env'],
    [['sh', '-c', 'export -p'], 'hitl-env'],
    [['bash', '-c', 'declare -x'], 'hitl-env'],
    [['cat', '/proc/self/environ'], 'hitl-env'],
    [['printenv', 'HOME'], null],
    [['env', 'A=1', 'node', 'x.js'], null],
    [['cat', '/srv/.HERMES/.Env'], 'hermes-env'],
  ];
  for (const [argv, esperado, stdin] of casos) assert.equal(regra(argv, stdin), esperado, JSON.stringify(argv));
  assert.equal(guarda.avaliarCitacao(a, '/srv/x/.hermes/.env')?.regra, 'hermes-env');
  assert.equal(guarda.avaliarCitacao(a, 'ORK_HITL_TOKEN')?.regra, 'hitl-env');
  assert.equal(guarda.avaliarCitacao(a, 'gh pr merge 1'), null);
});

test('guarda: separar argumentos como o parseArgs do CLI e cortar comandos de shell', () => {
  const guarda = carregar('hooks/guarda.ts');
  const s = guarda.separarArgs(['--projeto', 'x', 'gate', '--y=1', 'answer', '--flag']);
  assert.deepEqual(s.posicionais, ['gate', 'answer']);
  assert.deepEqual([...s.opcoes].sort(), ['flag', 'projeto', 'y']);
  assert.deepEqual(guarda.comandosDoTexto("a 'b c' && d \"e;f\" | g $(h i) `j`"), [['a', 'b c'], ['d', 'e;f'], ['g'], ['h', 'i'], ['j']]);
});

test('guarda: ganchos proibidos, reservados a ponte e o que o motor escaneou no registro', () => {
  const guarda = carregar('hooks/guarda.ts');
  const a = guarda.lerAutoridade(fs.readFileSync(AUTORIDADE, 'utf8'));
  const { sobrepoe } = guarda;
  assert.equal(sobrepoe('*', 'classic.Elicitation'), true);
  assert.equal(sobrepoe('classic.*', 'classic.PermissionRequest'), true);
  assert.equal(sobrepoe('classic.Stop', 'classic.Elicitation'), false);
  assert.equal(sobrepoe('fs.read', 'fs.*'), true);
  assert.equal(sobrepoe('fs.*', 'fs.read'), true);
  assert.equal(sobrepoe('!fs.read', 'fs.*'), false);
  assert.equal(sobrepoe('session.start', 'session.root'), false);
  assert.equal(sobrepoe('session.*', 'session.root'), true);
  assert.equal(sobrepoe('telemetry.*', 'process.*'), false);
  const evento = (eventos: string[], ehPonte = false) => guarda.avaliarEventos(a, eventos, ehPonte)?.regra ?? null;
  assert.equal(evento(['session.start', 'ui.render', 'classic.PostToolBatch', 'command.run']), null);
  assert.equal(evento(['process.run']), 'processos');
  assert.equal(evento(['process.run'], true), null);
  assert.equal(evento(['classic.Elicitation'], true), 'elicitation');
  const uses = (u: Record<string, unknown>) => guarda.avaliarUses(a, u)?.regra ?? null;
  assert.equal(uses({ events: ['session.start'], calls: ['prompt.submit'] }), 'prompt-submit');
  assert.equal(uses({ events: ['session.start'], env: { reads: ['ORK_HITL_TOKEN'], writes: [] } }), 'hitl-env');
  assert.equal(uses({ events: ['turn.complete'], calls: ['session.append', 'ui.toast'] }), null);
  assert.equal(guarda.ehModDoOrkastery('ork-torre'), true);
  assert.equal(guarda.ehModDoOrkastery('meu-mod'), false);
  assert.equal(guarda.ehModDoOrkastery('meu-mod', new Set(['meu-mod'])), true);
  assert.equal(guarda.avaliarAmbiente(a, 'ORK_DISPATCH_ID'), null);
  assert.equal(guarda.avaliarCaminho(a, '/srv/projeto/orkastery.yaml'), null);
});
