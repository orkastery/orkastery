import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { maestroActionSchema, validateMaestroSnapshot } from '../src/maestro-contract';

// RM-059 (fatia F1): a Torre de Controle (`ork-torre`) testada sem o Claude Code. O sandbox do `ork verify` e o
// runner do CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros da Torre com o compilador
// do `core` e os roda num escopo proprio, como o teste da ponte. Um modulo puro so importa tipos ou outro
// modulo puro da Torre; o `h` do JSX e um construtor de arvore deste teste. O fonte do mod tambem e varrido
// pela AST: a Torre so le o nucleo pela ponte e por uma lista fechada de ferramentas MCP de leitura (D3).
const raizDoRepo = path.resolve(__dirname, '../../..');
const TORRE = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-torre');
const MODULOS_PUROS = ['hooks/frases.ts', 'hooks/agenda.ts', 'hooks/painel.tsx', 'hooks/detalhe.tsx', 'hooks/rede.ts'];
/** D3: as unicas ferramentas que a Torre chama direto no servidor `orkastery`, todas de leitura no nucleo. */
const LISTA_FECHADA_DO_MCP = ['ork_phase_list', 'ork_claims_list', 'ork_observe', 'ork_git_status', 'ork_network_roadmap'];
const NOUNS_PROIBIDOS = ['process', 'fs', 'store', 'env'];

type No = { tipo: string; props: Record<string, unknown>; filhos: unknown[] };
(globalThis as unknown as { h: unknown }).h = (tipo: string, props: Record<string, unknown> | null, ...filhos: unknown[]): No =>
  ({ tipo, props: props ?? {}, filhos: filhos.flat(Infinity) });

const modulos = new Map<string, Record<string, any>>();
function resolver(base: string): string {
  for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error(`modulo da Torre nao encontrado: ${base}`);
}
/** Transpila e roda um modulo puro da Torre; o `require` so resolve outro modulo puro da propria Torre. */
function carregar(rel: string): Record<string, any> {
  const arquivo = resolver(path.join(TORRE, rel));
  const pronto = modulos.get(arquivo);
  if (pronto) return pronto;
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  });
  const modulo = { exports: {} as Record<string, any> };
  modulos.set(arquivo, modulo.exports);
  const exigir = (id: string) => {
    const alvo = path.relative(TORRE, path.join(path.dirname(arquivo), id));
    if (!id.startsWith('./') || !MODULOS_PUROS.includes(path.relative(TORRE, resolver(path.join(TORRE, alvo))))) {
      throw new Error(`modulo puro da Torre nao importa valor de fora dela: ${id}`);
    }
    return carregar(alvo);
  };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(TORRE, rel), 'utf8'));

/** Os textos de uma arvore desenhada com o `h` deste teste, um por `Text` e um por `Button` (o rotulo). */
function textos(no: unknown): string[] {
  if (!no || typeof no !== 'object') return [];
  const n = no as No;
  const proprios = () => n.filhos.filter((f) => typeof f === 'string' || typeof f === 'number').join('');
  if (n.tipo === 'Text') return [proprios()];
  if (n.tipo === 'Button') return [typeof n.props.label === 'string' ? n.props.label : proprios()];
  return n.filhos.flatMap(textos);
}

/** O botao de uma arvore pela chave. */
function botao(no: unknown, chave: string): No | undefined {
  if (!no || typeof no !== 'object') return undefined;
  const n = no as No;
  if (n.tipo === 'Button' && n.props.key === chave) return n;
  for (const f of n.filhos) {
    const achado = botao(f, chave);
    if (achado) return achado;
  }
  return undefined;
}

/** Um retrato de thread valido pelo contrato do nucleo (`validateMaestroSnapshot`). */
function retratoDe(t: { thread: string; fase: string; modo: string; conducao?: string; motivo?: string; pedidos?: Array<{ id: string; texto: string; prazo?: string; status?: string }>; acoes?: string[] }) {
  const refs = [{ kind: 'thread', id: t.thread }];
  const operacoes = ['thread.status', 'thread.observe', 'git.status', 'git.commit', 'verify', 'ship', 'hitl.decide', 'retry', 'master', 'phase'];
  const secao = (items: unknown[]) => ({ state: items.length ? 'available' : 'empty', source: 'teste', observedAt: '2026-01-01T00:00:00.000Z', fingerprint: null,
    coverage: { total: items.length, offset: 0, returned: items.length, omitted: 0, nextOffset: null, limit: 50 }, items, gaps: [] });
  return validateMaestroSnapshot({
    schema: 'ork.maestro-snapshot/v1', observedAt: '2026-01-01T00:00:00.000Z', fingerprint: 'a'.repeat(64),
    project: { id: 'ork', name: 'orkastery', origin: 'installation', fingerprint: 'b'.repeat(64) },
    limits: { items: 50, bytes: 65536, sourceMs: 2000, totalMs: 10000 },
    sections: {
      portfolio: secao([]), demands: secao([]), leases: secao([]), retries: secao([]), ship: secao([]), master: secao([]),
      threads: secao([{ id: t.thread, title: t.thread, status: 'aberta', refs: [], facts: { phase: t.fase, mode: t.modo, sessionCount: 1, block: 'full' } }]),
      sessions: secao([{ id: 's-1', title: `claude-bg · ${t.fase}`, status: 'working', refs,
        facts: { runtime: 'claude-bg', phase: t.fase, nativeConfirmed: true, phaseResult: false, ...(t.conducao ? { conduction: t.conducao } : {}), reason: '' } }]),
      blockers: secao(t.motivo ? [{ id: `gate:${t.thread}`, title: t.motivo, status: 'blocked', refs, facts: { reason: t.motivo } }] : []),
      hitl: secao((t.pedidos ?? []).map((p) => ({ id: p.id, title: p.texto, status: p.status ?? 'open', refs,
        facts: { deadline: '', deadlineLocal: p.prazo ?? '', target: 'gate', recommendation: 'A', deliveryUncertain: false, reason: '' } }))),
      nextActions: secao(operacoes.map((op) => ({ id: `${op}:${t.thread}`, title: op, status: 'proposed', refs, facts: {},
        action: { operation: op, available: (t.acoes ?? []).includes(op), reason: '', preconditions: [], readback: 'ork_thread_status' } }))),
    },
    gaps: [], conflicts: [],
  });
}

test('manifesto da Torre: nome, contrato de estado, dependencia da ponte e nenhuma chave de papel', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-torre');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  assert.equal(typeof m.author?.name, 'string');
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono'], claudeCodeMinimo: '2.1.287' });
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.tsx'] });
  assert.ok(fs.existsSync(path.join(TORRE, 'hooks/register.tsx')));
});

test('o contrato declara o estado da Torre em PluginState, sem import nem referencia', () => {
  const contrato = fs.readFileSync(path.join(TORRE, 'types/index.d.ts'), 'utf8');
  assert.match(contrato, /interface PluginState \{\s*'ork-torre': \{/);
  for (const chave of ['quadro: TorreQuadro', 'rede: TorreRede | null', 'aberta: string | null', 'detalhes: Record<string, TorreDetalhe>', 'donos: Record<string, string>']) {
    assert.ok(contrato.includes(chave), chave);
  }
  assert.doesNotMatch(contrato, /^\s*import\s/m);
  assert.doesNotMatch(contrato, /\/\/\/\s*<reference/);
});

test('modulo puro da Torre so importa tipos ou outro modulo puro dela', () => {
  for (const rel of MODULOS_PUROS) {
    const fonte = fs.readFileSync(path.join(TORRE, rel), 'utf8');
    for (const linha of fonte.split('\n').filter((l) => /^\s*import\s/.test(l))) {
      if (/^\s*import type\s/.test(linha)) continue;
      const de = /from '(\.\/[a-z]+)'/.exec(linha)?.[1];
      assert.ok(de && MODULOS_PUROS.includes(path.relative(TORRE, resolver(path.join(TORRE, 'hooks', de)))), `${rel}: ${linha}`);
    }
  }
});

test('frases: uma por motivo tipado do nucleo, nem mais nem menos, e motivo desconhecido aparece cru', () => {
  const { FRASE_DO_MOTIVO, MOTIVOS_DO_DONO, fraseDoMotivo } = carregar('hooks/frases.ts');
  assert.deepEqual(Object.keys(FRASE_DO_MOTIVO).sort(), Object.keys(DESCRICAO_DO_MOTIVO).sort());
  for (const [motivo, frase] of Object.entries(FRASE_DO_MOTIVO)) {
    assert.ok(typeof frase === 'string' && frase.length > 0 && frase.length <= 60 && !/[\n.]$/.test(frase), motivo);
  }
  for (const m of MOTIVOS_DO_DONO) assert.ok(m in DESCRICAO_DO_MOTIVO, m);
  assert.equal(fraseDoMotivo('claims.failed'), 'uma claim reprovou no HEAD');
  assert.equal(fraseDoMotivo('motivo.novo'), 'motivo.novo');
  assert.equal(fraseDoMotivo('constructor'), 'constructor');
});

test('agenda: o evento de arquivo marca a thread do ledger ou a lista, e nada mais', () => {
  const { marcaDoArquivo } = carregar('hooks/agenda.ts');
  assert.deepEqual(marcaDoArquivo('/p/.orkastery/threads/ork-a/ledger.jsonl'), { tipo: 'thread', thread: 'ork-a' });
  assert.deepEqual(marcaDoArquivo('/p/.orkastery/threads'), { tipo: 'lista' });
  assert.deepEqual(marcaDoArquivo('/p/.orkastery/threads/'), { tipo: 'lista' });
  assert.equal(marcaDoArquivo('/p/.orkastery/threads/ork-a/thread.json'), null);
  assert.equal(marcaDoArquivo('/p/.orkastery/threads/..%2Fx/ledger.jsonl'), null);
  assert.equal(marcaDoArquivo('/p/outro/ledger.jsonl'), null);
  assert.equal(marcaDoArquivo(undefined), null);
});

test('agenda: cada thread e lida no maximo a cada 10 s, e o tique pega o que ficou velho', () => {
  const { escolher, vencidas, INTERVALO_POR_THREAD_MS, IDADE_MAXIMA_MS, ESPERA_DO_LOTE_MS, PERIODO_DO_TIQUE_MS } = carregar('hooks/agenda.ts');
  assert.deepEqual([ESPERA_DO_LOTE_MS, INTERVALO_POR_THREAD_MS, PERIODO_DO_TIQUE_MS, IDADE_MAXIMA_MS], [2000, 10000, 60000, 300000]);
  assert.deepEqual(escolher(['ork-b', 'ork-a', 'ork-b', 'ork-c'], { 'ork-a': 1000, 'ork-c': 5000 }, 12000),
    { ler: ['ork-a', 'ork-b'], adiadas: ['ork-c'], proximaEm: 15000 });
  assert.deepEqual(escolher([], {}, 0), { ler: [], adiadas: [], proximaEm: null });
  assert.deepEqual(vencidas(['ork-a', 'ork-b', 'ork-c'], { 'ork-a': 0, 'ork-b': 200000 }, 400000), ['ork-a', 'ork-c']);
});

test('painel: a lista das abertas vem da consulta thread.list, sem fechada, sem id ruim, em ordem e com teto', () => {
  const { abertasDaLista, TETO_DE_THREADS } = carregar('hooks/painel.tsx');
  const lista = { todas: false, total: 5, threads: [{ id: 'ork-b', status: 'aberta' }, { id: 'ork-a', status: 'pausada' }, { id: 'ork-c', status: 'fechada' },
    { id: '../x', status: 'aberta' }, { id: 'ork-b', status: 'aberta' }, null] };
  assert.deepEqual(abertasDaLista(lista), { ids: ['ork-a', 'ork-b'], omitidas: 0 });
  assert.deepEqual(abertasDaLista(lista, 1), { ids: ['ork-a'], omitidas: 1 });
  assert.equal(TETO_DE_THREADS, 40);
  assert.throws(() => abertasDaLista({ erro: 'x' }), /sem o campo threads/);
});

test('painel: a linha da thread sai do retrato dela, com a frase do bloqueio, os pedidos e as acoes disponiveis', () => {
  const { linhaDaThread } = carregar('hooks/painel.tsx');
  const r = retratoDe({ thread: 'ork-a', fase: 'SHIP', modo: 'classic', motivo: 'human.pending',
    pedidos: [{ id: 'p1', texto: 'Autorizar o SHIP', prazo: '12/10 14:00' }, { id: 'p2', texto: 'velho', status: 'stale' }],
    acoes: ['hitl.decide', 'thread.status', 'ship'] });
  const l = linhaDaThread('ork-a', r, { fonte: 'mcp', lidoEm: 5 });
  assert.equal(l.fase, 'SHIP');
  assert.equal(l.modo, 'classic');
  assert.deepEqual(l.bloqueio, { motivo: 'human.pending', frase: 'espera a sua autorização' });
  assert.deepEqual(l.pedidos, [{ id: 'p1', texto: 'Autorizar o SHIP', prazo: '12/10 14:00', recomendacao: 'A' }]);
  assert.deepEqual(l.acoes.map((a: { operacao: string }) => a.operacao), ['thread.status', 'hitl.decide', 'ship']);
  assert.equal(l.estado, 'espera-voce');
  assert.deepEqual(l.sessoes, [{ id: 's-1', rotulo: 'claude-bg · SHIP', estado: 'working', conduz: false, confirmada: true }]);
  assert.deepEqual(l.lacunas, []);
  assert.equal(l.fonte, 'mcp');
  const outra = linhaDaThread('ork-b', r, { fonte: 'mcp', lidoEm: 5 });
  assert.deepEqual([outra.bloqueio, outra.pedidos, outra.acoes, outra.lacunas], [null, [], [], ['a thread não veio no retrato']]);
});

test('painel: o estado da linha segue a D6 e a ordem poe o que espera o dono primeiro', () => {
  const { linhaDaThread, estadoDaLinha, ordenarLinhas } = carregar('hooks/painel.tsx');
  const vazia = { pedidos: [], bloqueio: null, conducao: null };
  assert.equal(estadoDaLinha({ ...vazia, bloqueio: { motivo: 'runtime.consent-pending', frase: '' } }, true), 'espera-voce');
  assert.equal(estadoDaLinha({ ...vazia, bloqueio: { motivo: 'lease.busy', frase: '' } }, true), 'parada');
  assert.equal(estadoDaLinha({ ...vazia, conducao: 'conduzido agora' }, true), 'andando');
  assert.equal(estadoDaLinha(vazia, true), 'quieta');
  assert.equal(estadoDaLinha({ ...vazia, conducao: 'x' }, false), 'sem-leitura');
  const linhas = [
    linhaDaThread('ork-q', retratoDe({ thread: 'ork-q', fase: 'PLAN', modo: 'auto' }), { fonte: 'mcp', lidoEm: 1 }),
    linhaDaThread('ork-s', null, { fonte: null, lidoEm: null, erro: 'falhou' }),
    linhaDaThread('ork-b', retratoDe({ thread: 'ork-b', fase: 'GO', modo: 'auto', conducao: 'conduzido agora por cli' }), { fonte: 'mcp', lidoEm: 1 }),
    linhaDaThread('ork-p', retratoDe({ thread: 'ork-p', fase: 'CHECK', modo: 'auto', motivo: 'verify.regression' }), { fonte: 'mcp', lidoEm: 1 }),
    linhaDaThread('ork-e', retratoDe({ thread: 'ork-e', fase: 'SHIP', modo: 'auto', motivo: 'human.pending' }), { fonte: 'mcp', lidoEm: 1 }),
    linhaDaThread('ork-a', retratoDe({ thread: 'ork-a', fase: 'GO', modo: 'auto', conducao: 'conduzido agora por cli' }), { fonte: 'mcp', lidoEm: 1 }),
  ];
  assert.deepEqual(ordenarLinhas(linhas).map((l: { thread: string }) => l.thread), ['ork-e', 'ork-p', 'ork-a', 'ork-b', 'ork-q', 'ork-s']);
  const semLeitura = linhas[1];
  assert.deepEqual([semLeitura.estado, semLeitura.fase, semLeitura.lacunas], ['sem-leitura', null, ['falhou']]);
});

test('painel: trilho, modo, idade e placar', () => {
  const { trilho, modoComTag, idade, placar } = carregar('hooks/painel.tsx');
  assert.equal(trilho('GOAL'), '◉○○○○○');
  assert.equal(trilho('CHECK'), '●●●◉○○');
  assert.equal(trilho('MASTER'), '●●●●●◉');
  assert.equal(trilho('OUTRA'), '······');
  assert.equal(trilho(null), '······');
  assert.deepEqual(['auto', 'classic', 'maestro', 'fast', 'novo'].map(modoComTag), ['#Auto', '#Classic', '#Maestro', '#Fast', '#novo']);
  assert.equal(modoComTag(null), '');
  assert.deepEqual([idade(-5), idade(59999), idade(60000), idade(3599999), idade(7200000)], ['0 s', '59 s', '1 min', '59 min', '2 h']);
  const linha = (estado: string) => ({ estado });
  assert.equal(placar({ linhas: [], omitidas: 0, lidoEm: null, erro: null }, 0), 'Torre: lendo o núcleo…');
  assert.equal(placar({ linhas: [], omitidas: 0, lidoEm: null, erro: 'sem ponte' }, 0), 'Torre: não li o núcleo (sem ponte)');
  assert.equal(placar({ linhas: [], omitidas: 0, lidoEm: 0, erro: null }, 1000), 'nenhuma thread aberta nesta máquina · lido há 1 s');
  assert.equal(placar({ linhas: [linha('espera-voce'), linha('espera-voce'), linha('parada'), linha('andando'), linha('sem-leitura')], omitidas: 2, lidoEm: 0, erro: 'x' }, 120000),
    '7 threads abertas · 2 esperam você · 1 parada · 1 andando · 1 sem leitura · lido há 2 min · a lista não foi relida: x');
  assert.equal(placar({ linhas: [linha('quieta')], omitidas: 0, lidoEm: 0, erro: null }, 0), '1 thread aberta · lido há 0 s');
});

test('painel: o desenho tem o placar, a linha de cada thread e as linhas de baixo, sem acao de leitura nas de baixo', () => {
  const { linhaDaThread, ordenarLinhas, desenharPainel, mostradosDoQuadro } = carregar('hooks/painel.tsx');
  const linhas = ordenarLinhas([
    linhaDaThread('ork-a', retratoDe({ thread: 'ork-a', fase: 'SHIP', modo: 'classic', pedidos: [{ id: 'p1', texto: 'Autorizar o SHIP', prazo: '12/10 14:00' }],
      acoes: ['thread.status', 'hitl.decide'] }), { fonte: 'mcp', lidoEm: 0 }),
    linhaDaThread('ork-b', retratoDe({ thread: 'ork-b', fase: 'CHECK', modo: 'auto', motivo: 'claims.failed', acoes: ['thread.observe', 'retry'] }), { fonte: 'mcp', lidoEm: 0 }),
  ]);
  const q = { linhas, omitidas: 1, lidoEm: 0, erro: null };
  const abertas: string[] = [];
  const arvore = desenharPainel({ Box: 'Box', Text: 'Text', Button: 'Button' }, q, { agora: 3000, abrir: (t: string) => abertas.push(t) });
  assert.deepEqual(textos(arvore), [
    '3 threads abertas · 1 espera você · 1 parada · lido há 3 s',
    'rede: não lida',
    'Ler a rede',
    '!  ork-a  ●●●●◉○ SHIP  #Classic',
    '  espera você: Autorizar o SHIP (prazo 12/10 14:00)',
    '  ninguém conduz agora',
    '  ações: Decidir',
    'x  ork-b  ●●●◉○○ CHECK  #Auto',
    '  parada: uma claim reprovou no HEAD (claims.failed)',
    '  ninguém conduz agora',
    '  ações: Retomar',
    '+1 threads abertas além do teto de 40',
  ]);
  (botao(arvore, 'abrir:ork-b')?.props.onPress as () => void)();
  assert.deepEqual(abertas, ['ork-b']);
  assert.deepEqual(mostradosDoQuadro(q), [
    { chave: 'hitl:p1', thread: 'ork-a', texto: 'ork-a: espera você: Autorizar o SHIP' },
    { chave: 'bloqueio:ork-b:claims.failed', thread: 'ork-b', texto: 'ork-b: uma claim reprovou no HEAD' },
  ]);
});

const raizDaPonte = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte');
const { carregarModuloDoMod } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));

test('detalhe: a classe de cada acao cobre exatamente o enum operation do nucleo, e a leitura e so leitura', () => {
  const { CLASSE_DA_ACAO } = carregar('hooks/detalhe.tsx');
  const { ROTULO_DA_ACAO, LEITURAS } = carregar('hooks/painel.tsx');
  const operacoes = [...maestroActionSchema.shape.operation.options].sort();
  assert.deepEqual(Object.keys(CLASSE_DA_ACAO).sort(), operacoes);
  assert.deepEqual(Object.keys(ROTULO_DA_ACAO).sort(), operacoes);
  assert.deepEqual(Object.entries(CLASSE_DA_ACAO).filter(([, c]) => (c as { tipo: string }).tipo === 'leitura').map(([op]) => op).sort(), [...LEITURAS].sort());
  assert.deepEqual([...LEITURAS].sort(), ['git.status', 'thread.observe', 'thread.status']);
});

test('detalhe: mod dono por acao com efeito, e todo comando do ork mostrado passa pela guarda da ponte', () => {
  const { CLASSE_DA_ACAO, COMANDOS_DOS_DONOS } = carregar('hooks/detalhe.tsx');
  assert.deepEqual(COMANDOS_DOS_DONOS.map((d: { plugin: string; comando: string }) => `${d.plugin}:${d.comando}`),
    ['ork-mesa:mesa', 'ork-pista:pista', 'ork-sentinela:sentinela', 'ork-ritual:nota']);
  const guarda = carregarModuloDoMod(path.join(raizDaPonte, 'hooks/guarda.ts'));
  const autoridade = guarda.lerAutoridade(fs.readFileSync(path.join(raizDoRepo, 'adapters/claude-code/mods/autoridade.json'), 'utf8'));
  for (const [op, classe] of Object.entries(CLASSE_DA_ACAO) as Array<[string, { tipo: string; comando?: ((t: string) => string) | null; nota?: string | null }]>) {
    if (classe.tipo !== 'efeito') continue;
    for (const texto of [classe.comando ? classe.comando('ork-exemplo') : null, classe.nota].filter((t): t is string => !!t)) {
      assert.equal(guarda.avaliarTexto(autoridade, texto), null, `${op}: ${texto}`);
    }
  }
  assert.deepEqual(['hitl.decide', 'ship', 'phase', 'retry', 'master'].map((op) => CLASSE_DA_ACAO[op].dono.comando), ['mesa', 'pista', 'sentinela', 'sentinela', 'nota']);
  assert.equal(CLASSE_DA_ACAO.verify.dono, null);
  assert.equal(CLASSE_DA_ACAO['git.commit'].comando, null);
});

test('detalhe: o botao do mod dono so com o comando registrado pelo plugin esperado; senao o comando em texto', () => {
  const { acoesDoDetalhe, donosCarregados } = carregar('hooks/detalhe.tsx');
  const { linhaDaThread } = carregar('hooks/painel.tsx');
  assert.deepEqual(donosCarregados([{ name: 'mesa', plugin: 'ork-mesa' }, { name: 'pista' }, { name: 'nota', plugin: 'outro' }, { name: 'help', plugin: 'x' }]),
    { mesa: 'ork-mesa', nota: 'outro' });
  const linha = linhaDaThread('ork-a', retratoDe({ thread: 'ork-a', fase: 'SHIP', modo: 'auto', acoes: ['thread.status', 'hitl.decide', 'ship', 'master', 'git.commit'] }),
    { fonte: 'mcp', lidoEm: 0 });
  const acoes = acoesDoDetalhe(linha, { mesa: 'ork-mesa', nota: 'outro' });
  assert.deepEqual(acoes.map((a: { operacao: string; tipo: string }) => `${a.operacao}=${a.tipo}`),
    ['thread.status=leitura', 'hitl.decide=mod', 'ship=texto', 'master=texto', 'git.commit=texto']);
  assert.equal(acoes[2].texto, 'Entregar: rode ork ship ork-a --para <base>');
  assert.equal(acoes[3].texto, 'Nota do MASTER: rode ork master pedir ork-a');
  assert.equal(acoes[4].texto, 'Commit: o commit é da sessão de GO, pelo ork_git_commit');
  assert.deepEqual(acoesDoDetalhe({ ...linha, acoes: [{ operacao: 'operacao.nova' }] }, {}), []);
});

test('detalhe: a leitura de cada resposta do nucleo, e resposta fora do formato vira erro', () => {
  const d = carregar('hooks/detalhe.tsx');
  assert.deepEqual(d.jsonDoMcp({ content: [{ type: 'text', text: '{"a":1}' }], isError: false }), { a: 1 });
  assert.throws(() => d.jsonDoMcp({ content: [{ type: 'text', text: '{}' }], isError: true }), /respondeu com erro/);
  assert.throws(() => d.jsonDoMcp({ content: [] }), /não devolveu texto/);
  const agora = Date.parse('2026-01-01T00:10:00.000Z');
  const eventos = { phases: { eventos: [{ tipo: 'phase_dispatch', ts: '2026-01-01T00:00:00.000Z', fase: 'GO' },
    { tipo: 'phase_result', ts: '2026-01-01T00:09:00.000Z', fase: 'GO', classificacao: 'fase_concluida' }, { tipo: 'x', ts: 'ruim' }] } };
  assert.deepEqual(d.linhasDosEventos(eventos, agora), ['x · sem hora', 'phase_result · GO · fase_concluida · há 1 min', 'phase_dispatch · GO · há 10 min']);
  assert.deepEqual(d.linhasDosEventos({ phases: { eventos: [] } }, agora), ['nenhum evento de fase registrado']);
  assert.throws(() => d.linhasDosEventos({}, agora), /sem eventos/);
  assert.deepEqual(d.linhasDasClaims([{ id: 'C1', estado: 'verificado', alegacao: 'a' }, { id: 'C2', estado: 'pendente', alegacao: 'b' },
    { id: 'C3', estado: 'retirada', alegacao: 'c' }]), ['3 claims: 1 pendente, 1 retirada, 1 verificado', 'C2 pendente: b']);
  assert.deepEqual(d.linhasDasClaims([]), ['nenhuma claim registrada']);
  assert.throws(() => d.linhasDasClaims({}), /outro formato/);
  assert.deepEqual(d.linhasDoEstado({ id: 'ork-a', status: 'aberta', faseAtual: 'GO', sessoes: [1, 2], claims: [], atualizadaEm: '2026-01-01T00:05:00.000Z',
    baseline: { commit: 'abcdef0123456789', comandos: [{ nome: 'build', ok: true }, { nome: 'test', ok: false }] } }, agora),
  ['status aberta · fase GO · 2 sessões · 0 claims · atualizada há 5 min', 'baseline em abcdef01: build passava, test falhava']);
  assert.deepEqual(d.linhasDoEstado({ id: 'ork-a' }, agora)[1], 'sem baseline gravada');
  assert.throws(() => d.linhasDoEstado({}, agora), /sem id/);
  assert.deepEqual(d.linhasDaObservacao({ pendencias: [1], nativas: [{ sessionId: '12345678-aaaa', runtime: 'codex', disponivel: false }] }),
    ['1 pedido pendente', 'sessão 12345678 codex: não confirmada']);
  assert.throws(() => d.linhasDaObservacao({}), /sessões nativas/);
  assert.deepEqual(d.linhasDoGit({ source: { branch: 'b', head: 'a'.repeat(40) }, destination: { branch: 'main', head: 'a'.repeat(40) } }),
    ['b @ aaaaaaaa', 'destino main @ aaaaaaaa (iguais)']);
  assert.throws(() => d.linhasDoGit({}), /origem e destino/);
});

test('detalhe: o desenho tem voltar, atualizar, o texto e um botao por acao de leitura ou de mod dono, com o gesto certo', () => {
  const { desenharDetalhe } = carregar('hooks/detalhe.tsx');
  const { linhaDaThread } = carregar('hooks/painel.tsx');
  const linha = linhaDaThread('ork-a', retratoDe({ thread: 'ork-a', fase: 'CHECK', modo: 'auto', motivo: 'claims.failed',
    acoes: ['thread.status', 'retry', 'verify'] }), { fonte: 'mcp', lidoEm: 0 });
  const gestos: string[] = [];
  const detalhe = { eventos: { lidoEm: 0, linhas: ['phase_dispatch · GO · há 1 min'], erro: null }, claims: null,
    leituras: { 'thread.status': { lidoEm: 0, linhas: [], erro: 'falhou' } } };
  const arvore = desenharDetalhe({ Box: 'Box', Text: 'Text', Button: 'Button' }, linha, detalhe, { sentinela: 'ork-sentinela' }, {
    agora: 60000, voltar: () => gestos.push('voltar'), atualizar: () => gestos.push('atualizar'),
    ler: (op: string) => gestos.push(`ler:${op}`), abrirMod: (dono: { comando: string }) => gestos.push(`mod:${dono.comando}`),
  });
  assert.deepEqual(textos(arvore), [
    'Voltar', 'Atualizar',
    'x  ork-a  ●●●◉○○ CHECK  #Auto', 'ninguém conduz agora', 'bloqueio: uma claim reprovou no HEAD (claims.failed)',
    'sessão s-1 claude-bg · CHECK: working',
    'últimos eventos', '  phase_dispatch · GO · há 1 min', '  (lido há 1 min)', 'claims', '  lendo…', 'Estado', '  não leu: falhou',
    'ações', 'Estado', 'Retomar: abrir a Sentinela do Condutor', 'Verificar: rode ork verify ork-a',
  ]);
  for (const chave of ['voltar', 'atualizar', 'acao:thread.status', 'acao:retry']) (botao(arvore, chave)?.props.onPress as () => void)();
  assert.equal(botao(arvore, 'acao:verify'), undefined);
  assert.deepEqual(gestos, ['voltar', 'atualizar', 'ler:thread.status', 'mod:sentinela']);
});

const PANORAMA = {
  texto: 'status',
  panorama: {
    contrato: 'ork.network-roadmap/v1', projetos: [{
      maquinas: [
        { maquina: 'maquina-a', estaMaquina: true, threadsLidas: true, idadeMin: 0, ativas: [{ id: 'ork-a', fase: 'GO', modo: '#Auto', status: 'aberta' }] },
        { maquina: 'maquina-b', estaMaquina: false, threadsLidas: true, idadeMin: 3.4, semBatida: false, ativas: [
          { id: 'ork-a', fase: 'GO', modo: '#Auto', status: 'aberta' }, { id: 'ork-z', fase: 'PLAN', modo: '#Fast', status: 'aberta' },
          { id: 'ork-x', fase: 'CHECK', modo: '#Auto', status: 'aberta', esperaVoce: true, pergunta: ' Aprovar o merge ' },
          { id: '../ruim', fase: 'GO', modo: '#Auto', status: 'aberta' }, { id: 'ork-f', fase: 'GO', modo: '#Auto', status: 'fechada' }] },
        { maquina: 'maquina-c', estaMaquina: false, threadsLidas: true, semBatida: true, ativas: [{ id: 'ork-x', fase: 'CHECK', modo: '#Auto', status: 'aberta' }] },
        { maquina: 'maquina-d', estaMaquina: false, threadsLidas: false, ativas: [{ id: 'ork-d', fase: 'GO', modo: '#Auto', status: 'aberta' }] },
      ],
      lacunas: [{ tipo: 'forja.nao-consultada' }],
    }, { maquinas: null, lacunas: [{ tipo: 'projeto.sem-clone' }] }],
    lacunas: [{ tipo: 'registro.invalido' }],
  },
};

test('rede: as threads das outras maquinas vem do panorama, sem a local, sem repetir, sem id ruim nem fechada, e as lacunas contam', () => {
  const { redeDoPanorama, redeComErro, CONTRATO_DA_REDE, PERIODO_DA_REDE_MS } = carregar('hooks/rede.ts');
  assert.equal(CONTRATO_DA_REDE, 'ork.network-roadmap/v1');
  assert.equal(PERIODO_DA_REDE_MS, 600000);
  const r = redeDoPanorama(PANORAMA, ['ork-a'], 5000);
  assert.deepEqual(r, {
    lidoEm: 5000, maquinas: 2, lacunas: 3, erro: null,
    linhas: [
      { thread: 'ork-x', maquina: 'maquina-b', fase: 'CHECK', modo: '#Auto', esperaVoce: true, pergunta: 'Aprovar o merge', idadeMin: 3, semBatida: false },
      { thread: 'ork-z', maquina: 'maquina-b', fase: 'PLAN', modo: '#Fast', esperaVoce: false, pergunta: null, idadeMin: 3, semBatida: false },
    ],
  });
  assert.throws(() => redeDoPanorama({ panorama: { contrato: 'outro', projetos: [] } }, [], 0), /fora do contrato/);
  assert.throws(() => redeDoPanorama({ texto: 'x' }, [], 0), /fora do contrato/);
  assert.deepEqual(redeComErro(r, 'falhou'), { ...r, erro: 'falhou' });
  assert.deepEqual(redeComErro(null, 'falhou'), { lidoEm: null, linhas: [], maquinas: 0, lacunas: 0, erro: 'falhou' });
});

test('rede: a linha da faixa resume o quadro e a rede numa linha, com teto, e some sem quadro lido', () => {
  const { textoDaFaixa, TETO_DO_TEXTO_DA_FAIXA } = carregar('hooks/rede.ts');
  const { linhaDaThread } = carregar('hooks/painel.tsx');
  const l = (thread: string, extra: Record<string, unknown>) => linhaDaThread(thread, retratoDe({ thread, fase: 'GO', modo: 'auto', ...extra }), { fonte: 'mcp', lidoEm: 0 });
  const q = { linhas: [l('ork-e', { motivo: 'human.pending' }), l('ork-f', { pedidos: [{ id: 'p', texto: 't' }] }), l('ork-p', { motivo: 'tree.blocked' }),
    l('ork-g', { conducao: 'conduzido agora' })], omitidas: 0, lidoEm: 0, erro: null };
  assert.equal(textoDaFaixa(q, null), '4 threads abertas · 2 esperam você (ork-e) · 1 parada (ork-p: a árvore de destino do merge está ocupada)');
  assert.equal(textoDaFaixa({ ...q, linhas: [l('ork-g', { conducao: 'conduzido agora' })] }, null), '1 thread aberta · 1 andando');
  assert.equal(textoDaFaixa({ linhas: [], omitidas: 0, lidoEm: 0, erro: null }, null), 'nenhuma thread aberta nesta máquina');
  assert.equal(textoDaFaixa({ linhas: [], omitidas: 0, lidoEm: null, erro: 'x' }, null), undefined);
  const rede = { lidoEm: 1, linhas: [{ thread: 'ork-x', esperaVoce: true }, { thread: 'ork-y', esperaVoce: false }], maquinas: 1, lacunas: 0, erro: null };
  assert.equal(textoDaFaixa({ linhas: [], omitidas: 0, lidoEm: 0, erro: null }, rede), 'nenhuma thread aberta nesta máquina · rede: 2 em outras máquinas, 1 espera você');
  assert.equal(textoDaFaixa({ linhas: [], omitidas: 0, lidoEm: 0, erro: null }, { ...rede, lidoEm: null }), 'nenhuma thread aberta nesta máquina');
  const longa = { ...q, linhas: [l(`ork-${'x'.repeat(70)}`, { motivo: 'tree.blocked' }), l(`ork-${'y'.repeat(70)}`, { motivo: 'human.pending' })] };
  const texto = textoDaFaixa(longa, null) as string;
  assert.equal(texto.length, TETO_DO_TEXTO_DA_FAIXA);
  assert.ok(texto.endsWith('…') && !texto.includes('\n'));
});

test('painel: o placar da rede, a linha de outra maquina e a local que vence no desenho', () => {
  const { placarDaRede, cabecalhoDaRede, linhasDaRedeVisiveis, desenharPainel, linhaDaThread } = carregar('hooks/painel.tsx');
  const { redeDoPanorama, redeComErro } = carregar('hooks/rede.ts');
  const rede = redeDoPanorama(PANORAMA, ['ork-a'], 0);
  assert.equal(placarDaRede(null, 0), 'rede: não lida');
  assert.equal(placarDaRede(redeComErro(null, 'sem servidor'), 0), 'rede: não lida (sem servidor)');
  assert.equal(placarDaRede(rede, 120000), 'rede: 2 threads em 2 outras máquinas, lida há 2 min · 3 lacunas');
  assert.equal(placarDaRede(redeComErro(rede, 'falhou'), 0), 'rede: 2 threads em 2 outras máquinas, lida há 0 s · 3 lacunas · a última leitura falhou: falhou');
  assert.equal(placarDaRede({ lidoEm: 0, linhas: [], maquinas: 1, lacunas: 0, erro: null }, 0), 'rede: nenhuma thread ativa em 1 outra máquina, lida há 0 s');
  assert.equal(cabecalhoDaRede(rede.linhas[0]), '!  ork-x  ●●●◉○○ CHECK  #Auto  @maquina-b, batida há 3 min');
  assert.equal(cabecalhoDaRede({ ...rede.linhas[1], semBatida: true }), '~  ork-z  ●◉○○○○ PLAN  #Fast  @maquina-b, sem batida');
  assert.equal(cabecalhoDaRede({ ...rede.linhas[1], idadeMin: null }), '~  ork-z  ●◉○○○○ PLAN  #Fast  @maquina-b, batida ilegível');
  const local = linhaDaThread('ork-z', retratoDe({ thread: 'ork-z', fase: 'PLAN', modo: 'fast' }), { fonte: 'mcp', lidoEm: 0 });
  const q = { linhas: [local], omitidas: 0, lidoEm: 0, erro: null };
  assert.deepEqual(linhasDaRedeVisiveis(rede, q).map((x: { thread: string }) => x.thread), ['ork-x']);
  const lidas: string[] = [];
  const arvore = desenharPainel({ Box: 'Box', Text: 'Text', Button: 'Button' }, q, { agora: 0, rede, lerRede: () => lidas.push('rede') });
  assert.deepEqual(textos(arvore).slice(1), [
    'rede: 2 threads em 2 outras máquinas, lida há 0 s · 3 lacunas', 'Ler a rede',
    '-  ork-z  ●◉○○○○ PLAN  #Fast', '  ninguém conduz agora',
    '!  ork-x  ●●●◉○○ CHECK  #Auto  @maquina-b, batida há 3 min', '  espera você: Aprovar o merge',
  ]);
  (botao(arvore, 'ler-rede')?.props.onPress as () => void)();
  assert.deepEqual(lidas, ['rede']);
});

/** As chamadas `x.noun.metodo(...)` de um fonte, com os argumentos literais de texto quando ha. */
function chamadasDoFonte(arquivo: string): Array<{ cadeia: string[]; literais: Array<string | null>; linha: number }> {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2022, true, /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const saida: Array<{ cadeia: string[]; literais: Array<string | null>; linha: number }> = [];
  const visitar = (no: ts.Node) => {
    if (ts.isCallExpression(no)) {
      const cadeia: string[] = [];
      let e: ts.Expression = no.expression;
      while (ts.isPropertyAccessExpression(e)) { cadeia.unshift(e.name.text); e = e.expression; }
      if (ts.isIdentifier(e)) cadeia.unshift(e.text);
      const literais = no.arguments.map((a) => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : null));
      saida.push({ cadeia, literais, linha: fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1 });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return saida;
}

function fontesDoMod(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'test' || e.name === 'node_modules' || e.name === 'types' ? [] : fontesDoMod(abs);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && !e.name.endsWith('.d.ts') ? [abs] : [];
  });
}

test('D3: a Torre nao usa processo, disco, store nem ambiente, e chama o MCP so na lista fechada de leitura', () => {
  const fontes = fontesDoMod(TORRE);
  assert.ok(fontes.some((f) => f.endsWith('hooks/register.tsx')));
  for (const arquivo of fontes) {
    for (const c of chamadasDoFonte(arquivo)) {
      const onde = `${path.relative(raizDoRepo, arquivo)}:${c.linha} ${c.cadeia.join('.')}`;
      const nouns = c.cadeia.slice(1, -1);
      assert.ok(!nouns.some((n) => NOUNS_PROIBIDOS.includes(n)), `chamada proibida: ${onde}`);
      if (c.cadeia.slice(-2).join('.') === 'mcp.call') {
        assert.equal(c.literais[0], 'orkastery', `servidor nao literal ou outro: ${onde}`);
        assert.ok(c.literais[1] !== null && LISTA_FECHADA_DO_MCP.includes(c.literais[1]), `ferramenta fora da lista fechada: ${onde}`);
      }
    }
  }
});

test('D3: cada ferramenta da lista fechada e de leitura no nucleo (readOnlyHint)', () => {
  const servidor = fs.readFileSync(path.join(raizDoRepo, 'core/src/mcp-server.ts'), 'utf8');
  for (const ferramenta of LISTA_FECHADA_DO_MCP) {
    const i = servidor.indexOf(`registrarTool('${ferramenta}',`);
    assert.ok(i >= 0, `${ferramenta} registrada no servidor MCP`);
    const j = servidor.indexOf('registrarTool(', i + 1);
    const registro = servidor.slice(i, j < 0 ? undefined : j);
    assert.match(registro, /annotations:\{readOnlyHint:true/, ferramenta);
  }
});
