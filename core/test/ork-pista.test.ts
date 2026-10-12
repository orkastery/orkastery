import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ts from 'typescript';
import { prepararBundleCi } from '../src/ci';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { branchDaWorktree } from '../src/worktree';
import { ajustarManifesto, commitar, envPtBr, projetoTemporario, ProjetoDeTeste } from './apoio';

// RM-059 (fatia F7): a Pista de Entrega (`ork-pista`) testada sem o Claude Code. O sandbox do `ork verify` e o runner do
// CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros da Pista com o compilador do `core` e os roda
// num escopo proprio, como os testes da ponte, da Torre e da Sentinela. O fonte do mod tambem e varrido pela AST (D6 e D8
// da thread: so a lista fechada de chamadas ao `$`, e todo argv sai dos construtores dos modulos puros), e a leitura da
// pista roda contra o `ork ship pista --json` de verdade.
const raizDoRepo = path.resolve(__dirname, '../../..');
const PISTA = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-pista');
const CLI = path.resolve(__dirname, '../../dist/index.js');
const MODULOS_PUROS = ['hooks/pista.tsx', 'hooks/acoes.ts', 'hooks/ci.ts'];
/** D8: tudo que a Pista chama direto no `$`. */
const CHAMADAS_PERMITIDAS = ['ork.papel', 'ork.faixa', 'ork.retrato', 'ork.mostrado', 'command.register', 'clock.now', 'clock.after',
  'clock.every', 'process.run', 'state.get', 'state.set', 'ui.open', 'ui.panes', 'ui.resolve', 'ui.toast'];
/** D8: nada de disco, de MCP proprio, de ambiente, de texto como o dono, de agente ou de ferramenta. */
const NOUNS_PROIBIDOS = ['mcp', 'store', 'env', 'fs', 'prompt', 'agent', 'tool', 'session'];
/** D6: os unicos construtores de argv da Pista, nos modulos puros. */
const CONSTRUTORES_DE_ARGV = ['argvDaPista', 'argvDoPublicar', 'argvDoRegistro', 'argvDoCi'];

type No = { tipo: string; props: Record<string, unknown>; filhos: unknown[] };
(globalThis as unknown as { h: unknown }).h = (tipo: string, props: Record<string, unknown> | null, ...filhos: unknown[]): No =>
  ({ tipo, props: props ?? {}, filhos: filhos.flat(Infinity) });

const modulos = new Map<string, Record<string, any>>();
function resolver(base: string): string {
  for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error(`modulo da Pista nao encontrado: ${base}`);
}
/** Transpila e roda um modulo puro da Pista; o `require` so resolve outro modulo puro dela. */
function carregar(rel: string): Record<string, any> {
  const arquivo = resolver(path.join(PISTA, rel));
  const pronto = modulos.get(arquivo);
  if (pronto) return pronto;
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  });
  const modulo = { exports: {} as Record<string, any> };
  modulos.set(arquivo, modulo.exports);
  const exigir = (id: string) => {
    const alvo = path.relative(PISTA, path.join(path.dirname(arquivo), id));
    if (!id.startsWith('./') || !MODULOS_PUROS.includes(path.relative(PISTA, resolver(path.join(PISTA, alvo))))) {
      throw new Error(`modulo puro da Pista nao importa valor de fora dela: ${id}`);
    }
    return carregar(alvo);
  };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(PISTA, rel), 'utf8'));
const saida = (exitCode: number, stdout: unknown, stderr = '') => ({ exitCode, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr });
const SHA = 'a'.repeat(40);
const etapas = (estados: Record<string, string> = {}) => ['check', 'verify', 'bundle', 'branch', 'pr', 'ci', 'conflito', 'entrega']
  .map((id) => ({ id, estado: estados[id] ?? 'feita', texto: `${id} ${estados[id] ?? 'feita'}` }));
const pista = (thread: string, extra: Record<string, unknown> = {}) => ({
  thread, nome: thread, modo: 'auto', tag: '#Auto', publicavel: true, conduzida: false, branch: `ork/${thread}-full`, head: SHA, remota: null, pr: null,
  etapas: etapas(), proximo: { acao: 'publicar', disponivel: true, texto: 'publique a branch e abra o PR', comando: `ork ship publicar ${thread}` }, ...extra,
});
const contrato = (pistas: unknown[], extra: Record<string, unknown> = {}) => ({ contrato: 'ork.ship-pista/v1', lidoEm: '2026-10-12T15:00:00.000Z',
  base: 'main', remoto: 'origin', remotoLido: true, prsLidos: true, prsNaoLidos: null, ciExigido: true, contextoDoCi: 'ork-verify', pistas, ...extra });

test('manifesto da Pista: nome, contrato de estado, dependencia da ponte, papel dono e nenhuma chave de papel', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-pista');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  assert.equal(typeof m.author?.name, 'string');
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono'], claudeCodeMinimo: '2.1.287' });
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.tsx'] });
  assert.ok(fs.readdirSync(path.join(PISTA, 'test')).some((n) => /\.test\.tsx?$/.test(n)));
});

test('o contrato declara o estado da Pista em PluginState, sem import nem referencia', () => {
  const contratoDoEstado = fs.readFileSync(path.join(PISTA, 'types/index.d.ts'), 'utf8');
  assert.match(contratoDoEstado, /interface PluginState \{\s*'ork-pista': \{/);
  for (const chave of ['quadro: PistaQuadro', 'foco: string | null', 'acoes: Record<string, PistaAcao>', 'ci: Record<string, PistaCi>']) {
    assert.ok(contratoDoEstado.includes(chave), chave);
  }
  assert.doesNotMatch(contratoDoEstado, /^\s*import\s/m);
  assert.doesNotMatch(contratoDoEstado, /\/\/\/\s*<reference/);
  assert.doesNotMatch(contratoDoEstado, /interface EngineInterface/);
});

test('modulo puro da Pista so importa tipos ou outro modulo puro dela, e nao chama o $', () => {
  for (const rel of MODULOS_PUROS) {
    const fonte = fs.readFileSync(path.join(PISTA, rel), 'utf8');
    for (const linha of fonte.split('\n').filter((l) => /^\s*import\s/.test(l))) {
      if (/^\s*import type\s/.test(linha)) continue;
      const de = /from '(\.\/[a-z]+)'/.exec(linha)?.[1];
      assert.ok(de && MODULOS_PUROS.includes(path.relative(PISTA, resolver(path.join(PISTA, 'hooks', de)))), `${rel}: ${linha}`);
    }
    assert.doesNotMatch(fonte, /\$\./, `${rel} chama o $`);
  }
});

test('pista: o argv da leitura, a conferencia do contrato e o que fica de fora', () => {
  const p = carregar('hooks/pista.tsx');
  assert.deepEqual(p.argvDaPista(), ['ork', 'ship', 'pista', '--json']);
  assert.deepEqual(p.argvDaPista('ork-a'), ['ork', 'ship', 'pista', 'ork-a', '--json']);
  for (const ruim of ['', '../x', '--json', '-x', 'a b', 'a'.repeat(81), 3, null]) {
    assert.throws(() => p.argvDaPista(ruim), /id de thread invalido/, String(ruim));
  }
  const agora = Date.parse('2026-10-12T15:00:00.000Z');
  const q = p.lerPista(saida(0, contrato([
    pista('ork-b', { proximo: { acao: null, disponivel: true, texto: 'esperando', comando: null } }),
    pista('ork-a'),
    pista('../x'),
    pista('ork-c', { etapas: etapas().slice(0, 7) }),
    pista('ork-d', { proximo: { acao: 'merge', disponivel: true, texto: 'mergear', comando: null } }),
    pista('ork-e', { pr: { numero: 0, url: null, estado: 'aberto', rascunho: false, head: SHA } }),
  ], { prsLidos: false, prsNaoLidos: 'gh sem login' })), agora);
  assert.deepEqual(q.linhas.map((l: { thread: string }) => l.thread), ['ork-a', 'ork-b']);
  assert.equal(q.linhas[1].proximo.disponivel, false, 'so acao conhecida pode estar disponivel');
  assert.equal(q.lidoEm, agora);
  assert.deepEqual(q.avisos, ['os PRs não foram lidos: gh sem login', '4 pista(s) fora do contrato ficaram de fora']);
  assert.throws(() => p.lerPista(saida(0, { contrato: 'outro', pistas: [] }), agora), /não é o contrato ork\.ship-pista\/v1/);
  assert.throws(() => p.lerPista(saida(0, 'nao e json'), agora), /não devolveu JSON/);
  assert.throws(() => p.lerPista(saida(2, '', 'subcomando desconhecido: ship pista'), agora), /o ork deste PATH não tem ork ship pista/);
  assert.throws(() => p.lerPista(saida(1, '', 'linha\nerro: ship.remoto-invalido'), agora), /saída 1\): linha erro: ship\.remoto-invalido/);
});

test('pista: a ordem, a marca, a faixa e as linhas do painel com o que fica a vista', () => {
  const p = carregar('hooks/pista.tsx');
  const comBotao = pista('ork-z');
  const doDono = pista('ork-y', { publicavel: false, proximo: { acao: 'publicar', disponivel: false, texto: 'publique do seu terminal', comando: 'o comando do dono' } });
  const vermelha = pista('ork-x', { etapas: etapas({ ci: 'falhou' }), proximo: { acao: null, disponivel: false, texto: 'CI vermelho', comando: null } });
  const andando = pista('ork-w', { etapas: etapas({ ci: 'pendente', entrega: 'pendente' }), proximo: { acao: null, disponivel: false, texto: 'esperando o CI', comando: null } });
  const entregue = pista('ork-v', { proximo: { acao: null, disponivel: false, texto: 'entregue', comando: null } });
  const registrar = pista('ork-u', { proximo: { acao: 'registrar', disponivel: true, texto: 'registre a entrega', comando: 'ork ship registrar-pr ork-u' } });
  const q = p.lerPista(saida(0, contrato([entregue, andando, vermelha, doDono, comBotao, registrar])), 0);
  assert.deepEqual(q.linhas.map((l: { thread: string }) => `${p.marcaDaPista(l)} ${l.thread}`), ['! ork-u', '! ork-z', '? ork-y', 'x ork-x', '> ork-w', '- ork-v']);
  assert.equal(p.textoDaFaixa(q), '1 pronta para publicar · 1 pede o seu push · 1 para registrar · 1 com CI vermelho ou conflito · /pista');
  assert.equal(p.textoDaFaixa({ linhas: [andando, entregue].map(p.linhaDaPista), lidoEm: 0, erro: null, avisos: [] }), undefined, 'sem nada do dono, a linha sai');
  const linhas = p.linhasDoPainel(q, { agora: 120000, foco: 'ork-w' });
  assert.equal(linhas[0].texto, 'Pista de Entrega · 6 entregas · 2 com botão · lida há 2 min');
  assert.equal(linhas[1].texto, '>  ork-w  #Auto  ork/ork-w-full  (em foco)');
  assert.equal(linhas[2].texto, '  CHECK ✓ · verify ✓ · bundle ✓ · branch ✓ · PR ✓ · CI · · conflito ✓ · entrega ·');
  assert.ok(linhas.some((l: { texto: string }) => l.texto === '  no seu terminal: o comando do dono'));
  assert.ok(!linhas.some((l: { texto: string }) => l.texto.includes('ork ship publicar ork-z')), 'o comando do botao nao aparece como texto');
  const vistos = p.mostradosVisiveis(linhas, { offset: 0, bodyRows: 6 });
  assert.deepEqual(vistos, [{ chave: 'pista:ork-w', thread: 'ork-w', texto: 'ork-w: esperando o CI' }]);
  assert.deepEqual(p.mostradosVisiveis(linhas, undefined), []);
  assert.equal(p.threadDoLedger('/p/.orkastery/threads/ork-a/ledger.jsonl'), 'ork-a');
  for (const ruim of ['/p/.orkastery/threads/ork-a/thread.json', '/p/.orkastery/threads/../ledger.jsonl', 3, undefined]) {
    assert.equal(p.threadDoLedger(ruim), null, String(ruim));
  }
  const retrato = (itens: unknown[]) => ({ retrato: { sections: { ship: { items: itens } } } });
  assert.equal(p.assinaturaDoRetrato(null), null);
  assert.equal(p.assinaturaDoRetrato(retrato([])), '');
  assert.notEqual(p.assinaturaDoRetrato(retrato([{ id: 'ship:ork-a', status: 'delivered', facts: { receiptAt: 'x' } }])), p.assinaturaDoRetrato(retrato([])));
  const botoesDe = (arvore: No) => (arvore.filhos as No[]).flatMap((n) => (n.tipo === 'Button' ? [n] : (n.filhos as No[]).filter((x) => x?.tipo === 'Button')));
  assert.deepEqual(botoesDe(p.desenharPista({ Box: 'Box', Text: 'Text', Button: 'Button' }, q, { agora: 0 }) as No).map((b) => b.props.label), ['Atualizar'],
    'sem botoes decididos, so o de releitura');
  const comBotoes = p.desenharPista({ Box: 'Box', Text: 'Text', Button: 'Button' }, q,
    { agora: 0, botoes: { 'ork-z': { acao: 'publicar', rotulo: 'Publicar' }, 'ork-u': { acao: 'registrar', rotulo: 'Registrar a entrega' } },
      acoes: { 'ork-u': { acao: 'registrar', estado: 'rodando', texto: '', em: 0 } } }) as No;
  assert.deepEqual(botoesDe(comBotoes).map((b) => `${String(b.props.key ?? '')}|${String(b.props.label)}`), ['atualizar|Atualizar', 'publicar:ork-z|Publicar'],
    'o botao da thread com clique rodando some ate o resultado');
});

/** Uma thread pronta para publicar num projeto temporario: produto, verify verde, bundle e CHECK com PASSOU. */
function prontaParaPublicar(p: ProjetoDeTeste, nome: string): { id: string; branch: string } {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const branch = branchDaWorktree(thread);
  exec('git', ['checkout', '-q', '-b', branch, 'main'], p.dir);
  const produto = commitar(p.dir, `${nome}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao, { commit: produto, veredito: 'verdade sustentada', motivos: [] });
  const arquivo = prepararBundleCi(p.carregado, thread.id);
  exec('git', ['add', '--', path.relative(p.dir, arquivo)], p.dir);
  exec('git', ['commit', '-q', '-m', `ci(${thread.id}): bundle`], p.dir);
  exec('git', ['checkout', '-q', 'main'], p.dir);
  const doc = path.join(dirThread(p.dir, thread.id), 'docs', 'check.md');
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, '# CHECK\n\nVeredito: PASSOU\n');
  const depois = new Date(Date.now() + 5000);
  fs.utimesSync(doc, depois, depois);
  return { id: thread.id, branch };
}

test('pista: a leitura da Pista casa com o ork ship pista --json de verdade', (t) => {
  const pm = carregar('hooks/pista.tsx');
  const p = projetoTemporario('ork-pista-contrato', true);
  t.after(() => p.limpar());
  const e = prontaParaPublicar(p, 'pronta');
  const env = envPtBr();
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO']) delete env[nome];
  const rodar = (argv: string[]) => {
    assert.equal(argv[0], 'ork');
    const r = spawnSync(process.execPath, [CLI, ...argv.slice(1)], { cwd: p.dir, encoding: 'utf8', env });
    return { exitCode: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  };
  const q = pm.lerPista(rodar(pm.argvDaPista()), 1);
  assert.deepEqual(q.linhas.map((l: { thread: string }) => l.thread), [e.id]);
  const l = q.linhas[0];
  assert.equal(l.branch, e.branch);
  assert.deepEqual(l.etapas.map((x: { id: string }) => x.id), ['check', 'verify', 'bundle', 'branch', 'pr', 'ci', 'conflito', 'entrega']);
  assert.deepEqual(l.etapas.slice(0, 4).map((x: { estado: string }) => x.estado), ['feita', 'feita', 'feita', 'pendente']);
  assert.equal(l.proximo.acao, 'publicar');
  assert.equal(l.proximo.disponivel, true);
  assert.match(q.avisos.join(' '), /os PRs não foram lidos/, 'o remoto do teste e um bare local, sem forja');
  assert.deepEqual(pm.lerPista(rodar(pm.argvDaPista(e.id)), 1).linhas.map((x: { thread: string }) => x.thread), [e.id]);
});

test('acoes: o botao so com a acao declarada, o argv dos dois comandos e a autoridade da ponte', () => {
  const a = carregar('hooks/acoes.ts');
  const p = carregar('hooks/pista.tsx');
  const linha = (extra: Record<string, unknown>) => p.linhaDaPista(pista('ork-a', extra));
  assert.equal(a.botaoDaPista(linha({})), 'publicar');
  assert.equal(a.botaoDaPista(linha({ publicavel: false })), null, 'fora de #Auto e #Maestro, nenhum botao de publicar');
  assert.equal(a.botaoDaPista(linha({ proximo: { acao: 'publicar', disponivel: false, texto: 'x', comando: null } })), null);
  assert.equal(a.botaoDaPista(linha({ proximo: { acao: 'registrar', disponivel: true, texto: 'x', comando: null } })), 'registrar');
  assert.equal(a.botaoDaPista(linha({ proximo: { acao: null, disponivel: false, texto: 'x', comando: 'ork verify ork-a' } })), null);
  assert.deepEqual(a.argvDoPublicar('ork-a'), ['ork', 'ship', 'publicar', 'ork-a', '--json']);
  assert.deepEqual(a.argvDoRegistro('ork-a'), ['ork', 'ship', 'registrar-pr', 'ork-a', '--json']);
  for (const ruim of ['../x', '--autorizar-push', '', 'a b']) {
    assert.throws(() => a.argvDoPublicar(ruim), /id de thread invalido/, ruim);
    assert.throws(() => a.argvDoRegistro(ruim), /id de thread invalido/, ruim);
  }
  // A guarda da ponte (a mesma lista que ela aplica em tempo de execucao) deixa passar os dois, e barra a autorizacao.
  const { carregarModuloDoMod } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
  const guarda = carregarModuloDoMod(path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte/hooks/guarda.ts'), raizDoRepo);
  const autoridade = guarda.lerAutoridade(fs.readFileSync(path.join(raizDoRepo, 'adapters/claude-code/mods/autoridade.json'), 'utf8'));
  for (const argv of [p.argvDaPista(), p.argvDaPista('ork-a'), a.argvDoPublicar('ork-a'), a.argvDoRegistro('ork-a')]) {
    assert.equal(guarda.avaliarArgv(autoridade, argv), null, argv.join(' '));
  }
  assert.notEqual(guarda.avaliarArgv(autoridade, [...a.argvDoPublicar('ork-a'), ['--autorizar', 'push'].join('-'), 'eu']), null);
});

test('acoes: a leitura do publicar e do registro, com a recusa, o CLI sem o comando e a saida fora do contrato', () => {
  const a = carregar('hooks/acoes.ts');
  const base = { contrato: 'ork.ship-publicar/v1', thread: 'ork-a', head: SHA, motivo: null, detalhe: 'd', correcao: '', pr: { numero: 9, criado: true } };
  assert.deepEqual(a.lerPublicacao(saida(0, { ...base, acao: 'publicou' })),
    { estado: 'feita', texto: 'publicada no HEAD aaaaaaa, push provado pelo ls-remote; PR #9 aberto agora' });
  assert.deepEqual(a.lerPublicacao(saida(0, { ...base, acao: 'ja-publicada', pr: { numero: 9, criado: false }, correcao: 'registre a entrega' })),
    { estado: 'feita', texto: 'já estava publicada no HEAD aaaaaaa; PR #9; registre a entrega' });
  assert.deepEqual(a.lerPublicacao(saida(1, { ...base, acao: 'recusada', motivo: 'human.pending', detalhe: 'o modo pede o dono', correcao: 'publique do terminal' })),
    { estado: 'recusada', texto: 'recusada (human.pending): o modo pede o dono; publique do terminal' });
  assert.equal(a.lerPublicacao(saida(0, { ...base, acao: 'publicaria' })).estado, 'falhou', 'o botao nunca roda o ensaio');
  assert.equal(a.lerPublicacao(saida(0, { contrato: 'outro' })).estado, 'falhou');
  assert.throws(() => a.lerPublicacao(saida(2, '', 'subcomando desconhecido: ship publicar')), /o ork deste PATH não tem ork ship publicar/);
  const item = (acao: string) => [{ thread: 'ork-a', acao, motivo: `motivo de ${acao}` }, { thread: 'ork-b', acao: 'registrou', motivo: 'outra' }];
  assert.deepEqual(a.lerRegistro(saida(0, item('registrou')), 'ork-a'), { estado: 'feita', texto: 'ship_done registrado: motivo de registrou' });
  assert.equal(a.lerRegistro(saida(0, item('ja-registrada')), 'ork-a').estado, 'feita');
  assert.deepEqual(a.lerRegistro(saida(0, item('sem-merge')), 'ork-a'), { estado: 'recusada', texto: 'sem-merge: motivo de sem-merge' });
  assert.equal(a.lerRegistro(saida(1, item('recusada')), 'ork-a').estado, 'recusada');
  assert.equal(a.lerRegistro(saida(0, item('registrou')), 'ork-c').estado, 'falhou');
  assert.equal(a.lerRegistro(saida(0, item('registraria')), 'ork-a').estado, 'falhou');
});

test('acoes: a leitura casa com o ork ship publicar e o ork ship registrar-pr de verdade, sem push quando o nucleo recusa', (t) => {
  const a = carregar('hooks/acoes.ts');
  const p = projetoTemporario('ork-pista-acoes', true);
  t.after(() => p.limpar());
  const env = envPtBr();
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO']) delete env[nome];
  const rodar = (argv: string[]) => {
    assert.equal(argv[0], 'ork');
    const r = spawnSync(process.execPath, [CLI, ...argv.slice(1)], { cwd: p.dir, encoding: 'utf8', env });
    return { exitCode: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  };
  const auto = prontaParaPublicar(p, 'pronta');
  // O remoto do teste e um bare local: sem GitHub, o nucleo recusa antes do push, e a Pista mostra o motivo.
  const r = a.lerPublicacao(rodar(a.argvDoPublicar(auto.id)));
  assert.equal(r.estado, 'recusada');
  assert.match(r.texto, /^recusada \(runtime\.unavailable\): o remoto origin não é um repositório do GitHub/);
  assert.equal(exec('git', ['ls-remote', 'origin', `refs/heads/${auto.branch}`], p.dir).stdout.trim(), '', 'nada foi empurrado');
  const reg = a.lerRegistro(rodar(a.argvDoRegistro(auto.id)), auto.id);
  assert.equal(reg.estado, 'recusada');
  assert.match(reg.texto, /^sem-merge: nenhum merge ship\(/);
});

test('ci: o argv no sha exato, as pistas que o evento cita so por campo asserido e a reserva por intervalo', () => {
  const c = carregar('hooks/ci.ts');
  const p = carregar('hooks/pista.tsx');
  const B = 'b'.repeat(40);
  assert.deepEqual(c.argvDoCi(B), ['ork', 'ci', 'status', '--sha', B, '--json']);
  for (const ruim of ['HEAD', 'b'.repeat(39), 'B'.repeat(40), `${B} --remoto x`, 3]) assert.throws(() => c.argvDoCi(ruim), /sha invalido/, String(ruim));
  const aberta = p.linhaDaPista(pista('ork-c', { pr: { numero: 7, url: null, estado: 'aberto', rascunho: false, head: B },
    etapas: etapas({ ci: 'pendente', entrega: 'pendente' }), proximo: { acao: null, disponivel: false, texto: 'esperando', comando: null } }));
  const verde = p.linhaDaPista(pista('ork-d', { pr: { numero: 8, url: null, estado: 'aberto', rascunho: false, head: SHA }, etapas: etapas(),
    proximo: { acao: null, disponivel: false, texto: 'pronto', comando: null } }));
  const semPr = p.linhaDaPista(pista('ork-a'));
  const linhas = [aberta, verde, semPr];
  const evento = (data: Record<string, unknown>, untrustedKeys: string[] = [], source = 'github') => ({ source, kind: 'x', data, untrustedKeys });
  assert.deepEqual(c.pistasDoEvento(evento({ pr: 'acme/app#7' }), linhas), ['ork-c']);
  assert.deepEqual(c.pistasDoEvento(evento({ number: 8 }), linhas), ['ork-d']);
  assert.deepEqual(c.pistasDoEvento(evento({ head_sha: B }), linhas), ['ork-c']);
  assert.deepEqual(c.pistasDoEvento(evento({ branch: 'ork/ork-a-full' }), linhas), ['ork-a']);
  assert.deepEqual(c.pistasDoEvento(evento({ pr: 'acme/app#7' }, ['pr']), linhas), [], 'campo de terceiros nao cita');
  assert.deepEqual(c.pistasDoEvento(evento({ pr: 'acme/app#7' }, [], 'artifact-room'), linhas), [], 'so o GitHub');
  assert.deepEqual(c.pistasDoEvento(evento({ comment: '#7' }), linhas), [], 'numero solto em campo qualquer nao cita');
  assert.deepEqual(c.pistasDoEvento(null, linhas), []);
  assert.deepEqual(c.vencidasDoCi(linhas, {}, 0, 120000), ['ork-c'], 'so a pista com PR aberto e CI aberto');
  const lido = { sha: B, estado: 'pending', texto: 't', url: null, lidoEm: 1000, motivo: 'consulta' };
  assert.deepEqual(c.vencidasDoCi(linhas, { 'ork-c': lido }, 120999, 120000), []);
  assert.deepEqual(c.vencidasDoCi(linhas, { 'ork-c': lido }, 121000, 120000), ['ork-c']);
  assert.deepEqual(c.vencidasDoCi(linhas, { 'ork-c': { ...lido, sha: SHA } }, 1001, 120000), ['ork-c'], 'leitura de outro head nao conta');
  const q = { linhas, lidoEm: 0, erro: null, avisos: [] };
  const comVerde = c.comCi(q, { 'ork-c': { ...lido, estado: 'success', texto: 'verde', motivo: 'evento' } });
  assert.deepEqual(comVerde.linhas[0].etapas.find((e: { id: string }) => e.id === 'ci'), { id: 'ci', estado: 'feita', texto: 'verde (pelo evento do GitHub)' });
  assert.equal(c.comCi(q, { 'ork-c': { ...lido, sha: SHA, estado: 'failure' } }).linhas[0].etapas.find((e: { id: string }) => e.id === 'ci').estado, 'pendente',
    'leitura de outro head nao muda a etapa');
  assert.equal(c.fechouOCi(aberta, { ...lido, estado: 'failure' }), true);
  assert.equal(c.fechouOCi(aberta, lido), false);
  assert.equal(c.fechouOCi(verde, { ...lido, estado: 'success' }), false);
});

test('ci: a leitura casa com o ork ci status de verdade, com o CI desligado e com o remoto que nao e GitHub', (t) => {
  const c = carregar('hooks/ci.ts');
  const p = projetoTemporario('ork-pista-ci', true);
  t.after(() => p.limpar());
  const env = envPtBr();
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO']) delete env[nome];
  const rodar = (argv: string[]) => {
    assert.equal(argv[0], 'ork');
    const r = spawnSync(process.execPath, [CLI, ...argv.slice(1)], { cwd: p.dir, encoding: 'utf8', env });
    return { exitCode: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  };
  const head = exec('git', ['rev-parse', 'HEAD'], p.dir).stdout.trim();
  const desligado = c.lerCi(rodar(c.argvDoCi(head)), head, 5, 'consulta');
  assert.deepEqual({ estado: desligado.estado, texto: desligado.texto }, { estado: 'disabled', texto: 'CI não exigido pelo manifesto' });
  ajustarManifesto(p, /required_for_ship: false/, 'required_for_ship: true');
  const semGithub = c.lerCi(rodar(c.argvDoCi(head)), head, 5, 'evento');
  assert.equal(semGithub.estado, 'unavailable');
  assert.match(semGithub.texto, /^o CI não foi lido: remoto origin não é um repositório GitHub reconhecível/);
  assert.throws(() => c.lerCi(rodar(c.argvDoCi(head)), 'f'.repeat(40), 5, 'evento'), /respondeu pelo commit/);
});

type Chamada = { cadeia: string[]; no: ts.CallExpression; linha: number };
function chamadasDoFonte(arquivo: string): { chamadas: Chamada[]; fonte: ts.SourceFile } {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2022, true, /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const chamadas: Chamada[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isCallExpression(no)) {
      const cadeia: string[] = [];
      let e: ts.Expression = no.expression;
      while (ts.isPropertyAccessExpression(e)) { cadeia.unshift(e.name.text); e = e.expression; }
      if (ts.isIdentifier(e)) cadeia.unshift(e.text);
      chamadas.push({ cadeia, no, linha: fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1 });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return { chamadas, fonte };
}

function fontesDoMod(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'test' || e.name === 'node_modules' || e.name === 'types' ? [] : fontesDoMod(abs);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && !e.name.endsWith('.d.ts') ? [abs] : [];
  });
}

test('D6 e D8: a Pista so chama no $ a lista fechada, e todo argv sai dos construtores, sem git nem gh', () => {
  const fontes = fontesDoMod(PISTA);
  assert.ok(fontes.some((f) => f.endsWith('hooks/register.tsx')));
  const vistas = new Set<string>();
  let processos = 0;
  for (const arquivo of fontes) {
    const { chamadas, fonte } = chamadasDoFonte(arquivo);
    for (const c of chamadas) {
      if (c.cadeia[0] !== '$') continue;
      const onde = `${path.relative(raizDoRepo, arquivo)}:${c.linha} ${c.cadeia.join('.')}`;
      const chamada = c.cadeia.slice(1).join('.');
      assert.ok(!NOUNS_PROIBIDOS.includes(c.cadeia[1] ?? ''), `noun proibido: ${onde}`);
      assert.ok(CHAMADAS_PERMITIDAS.includes(chamada), `chamada fora da lista fechada do $: ${onde}`);
      vistas.add(chamada);
      if (chamada === 'process.run') {
        processos++;
        const argv = c.no.arguments[0];
        assert.ok(argv && ts.isCallExpression(argv) && ts.isIdentifier(argv.expression) && CONSTRUTORES_DE_ARGV.includes(argv.expression.text),
          `argv que nao sai de um construtor: ${onde}: ${argv?.getText(fonte)}`);
      }
    }
    // Nenhum literal do fonte forma argv de git ou de gh, nem a autorizacao de push pelo dono.
    const texto = fs.readFileSync(arquivo, 'utf8');
    assert.doesNotMatch(texto, /'(git|gh)'/, `${path.relative(raizDoRepo, arquivo)} cita git ou gh como argv`);
    assert.doesNotMatch(texto, /autorizar-push/, `${path.relative(raizDoRepo, arquivo)} cita a autorizacao de push`);
  }
  assert.ok(processos >= 1, `process.run achados: ${processos}`);
  for (const esperada of ['ork.papel', 'ork.faixa', 'ork.retrato', 'ork.mostrado', 'process.run', 'command.register', 'clock.every', 'ui.open']) {
    assert.ok(vistas.has(esperada), esperada);
  }
});

test('a guarda estatica dos mods aprova a Pista', () => {
  const r = spawnSync(process.execPath, [path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'), PISTA], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ok ork-pista/);
});
