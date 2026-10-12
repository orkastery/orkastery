import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ts from 'typescript';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { envPtBr, projetoTemporario, runtimeFalso } from './apoio';

// RM-059 (fatia F6): a Sentinela do Condutor (`ork-sentinela`) testada sem o Claude Code. O sandbox do `ork verify` e o
// runner do CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros da Sentinela com o compilador do
// `core` e os roda num escopo proprio, como os testes da ponte e do Radar. O fonte do mod tambem e varrido pela AST (D2:
// so a lista fechada de chamadas ao `$`, todo argv sai dos construtores dos modulos puros, so as consultas da lista e
// nada de `conducao assumir`), e a leitura do status roda contra o `ork conducao sentinela status --json` de verdade.
const raizDoRepo = path.resolve(__dirname, '../../..');
const SENTINELA = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-sentinela');
const CLI = path.resolve(__dirname, '../../dist/index.js');
const MODULOS_PUROS = ['hooks/vigia.ts', 'hooks/despacho.ts', 'hooks/alertas.ts'];
/** D2: tudo que a Sentinela chama direto no `$`; o estado passa pelo `read` e pelo `update` do motor. */
const CHAMADAS_PERMITIDAS = ['ork.papel', 'ork.faixa', 'ork.ler', 'ork.retrato', 'ork.mostrado', 'command.register', 'clock.now',
  'clock.after', 'clock.every', 'process.run', 'session.id', 'state.get', 'state.set', 'ui.notify', 'ui.toast'];
const NOUNS_PROIBIDOS = ['mcp', 'store', 'env', 'fs', 'prompt', 'agent', 'tool'];
/** D2: os unicos construtores de argv da Sentinela, nos modulos puros. */
const CONSTRUTORES_DE_ARGV = ['argvDoStatus', 'argvDaBatida', 'argvDoDesligar', 'argvDoRender', 'argvDoDespacho', 'argvDaRetomada'];
/** D9: as consultas da lista fechada da ponte que a Sentinela le. */
const CONSULTAS_PERMITIDAS = ['conducao.status', 'retry.plan', 'pulse'];

type No = { tipo: string; props: Record<string, unknown>; filhos: unknown[] };
(globalThis as unknown as { h: unknown }).h = (tipo: string, props: Record<string, unknown> | null, ...filhos: unknown[]): No =>
  ({ tipo, props: props ?? {}, filhos: filhos.flat(Infinity) });

const modulos = new Map<string, Record<string, any>>();
function resolver(base: string): string {
  for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error(`modulo da Sentinela nao encontrado: ${base}`);
}
/** Transpila e roda um modulo puro da Sentinela; o `require` so resolve outro modulo puro dela. */
function carregar(rel: string): Record<string, any> {
  const arquivo = resolver(path.join(SENTINELA, rel));
  const pronto = modulos.get(arquivo);
  if (pronto) return pronto;
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  });
  const modulo = { exports: {} as Record<string, any> };
  modulos.set(arquivo, modulo.exports);
  const exigir = (id: string) => {
    const alvo = path.relative(SENTINELA, path.join(path.dirname(arquivo), id));
    if (!id.startsWith('./') || !MODULOS_PUROS.includes(path.relative(SENTINELA, resolver(path.join(SENTINELA, alvo))))) {
      throw new Error(`modulo puro da Sentinela nao importa valor de fora dela: ${id}`);
    }
    return carregar(alvo);
  };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(SENTINELA, rel), 'utf8'));
const saida = (exitCode: number, stdout: unknown, stderr = '') => ({ exitCode, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr });
const passo = (thread: string, extra: Record<string, unknown> = {}) => ({
  thread, modo: 'auto', faseAtual: 'GOAL', conduzida: false, acao: 'nada', fase: null, caso: null, proximoPasso: null, porque: 'x',
  desdeEm: null, bloqueio: null, pedidoGuardado: true, ...extra,
});
const statusCom = (threads: unknown[], sessao: string | null = 's1') => ({
  contrato: 'ork.conducao-sentinela/v1', consultadoEm: '2026-10-12T15:00:00.000Z', maquina: 'm',
  presenca: sessao === null ? null : { sessao, ativa: true }, threads,
});

test('manifesto da Sentinela: nome, contrato de estado, dependencia da ponte, papel dono e nenhuma chave de papel', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-sentinela');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  assert.equal(typeof m.author?.name, 'string');
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono'], claudeCodeMinimo: '2.1.287' });
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.ts'] });
  assert.ok(fs.readdirSync(path.join(SENTINELA, 'test')).some((n) => /\.test\.tsx?$/.test(n)));
});

test('o contrato declara o estado da Sentinela em PluginState, sem import nem referencia', () => {
  const contrato = fs.readFileSync(path.join(SENTINELA, 'types/index.d.ts'), 'utf8');
  assert.match(contrato, /interface PluginState \{\s*'ork-sentinela': \{/);
  for (const chave of ['diario: SentinelaEntrada[]', 'pausada: boolean', 'despachados: string[]', 'retomados: string[]', 'avisados: string[]',
    'resumo: SentinelaResumo']) assert.ok(contrato.includes(chave), chave);
  assert.doesNotMatch(contrato, /^\s*import\s/m);
  assert.doesNotMatch(contrato, /\/\/\/\s*<reference/);
  assert.doesNotMatch(contrato, /interface EngineInterface/);
});

test('modulo puro da Sentinela so importa tipos ou outro modulo puro dela, e nao chama o $', () => {
  for (const rel of MODULOS_PUROS) {
    const fonte = fs.readFileSync(path.join(SENTINELA, rel), 'utf8');
    for (const linha of fonte.split('\n').filter((l) => /^\s*import\s/.test(l))) {
      if (/^\s*import type\s/.test(linha)) continue;
      const de = /from '(\.\/[a-z]+)'/.exec(linha)?.[1];
      assert.ok(de && MODULOS_PUROS.includes(path.relative(SENTINELA, resolver(path.join(SENTINELA, 'hooks', de)))), `${rel}: ${linha}`);
    }
    assert.doesNotMatch(fonte, /\$\./, `${rel} chama o $`);
  }
});

test('vigia: o argv do status, da batida e do desligar, e a sessao invalida recusada', () => {
  const v = carregar('hooks/vigia.ts');
  assert.deepEqual(v.argvDoStatus(), ['ork', 'conducao', 'sentinela', 'status', '--json']);
  assert.deepEqual(v.argvDaBatida('d7f74517-7a23'), ['ork', 'conducao', 'sentinela', 'bater', '--sessao', 'd7f74517-7a23', '--json']);
  assert.deepEqual(v.argvDoDesligar('s1'), ['ork', 'conducao', 'sentinela', 'desligar', '--sessao', 's1', '--json']);
  for (const ruim of ['', 'com espaco', '--json', '-x', 'a'.repeat(129), 3, null]) {
    assert.throws(() => v.argvDaBatida(ruim), /id de sessao invalido/, String(ruim));
  }
  assert.equal(v.BATIDA_MS, 60000, 'a mesma cadencia do nucleo (BATIDA_DA_SENTINELA_MS)');
});

test('vigia: a leitura do status recusa o que nao e o contrato, diz de quem e a presenca e tira o passo torto', () => {
  const v = carregar('hooks/vigia.ts');
  const lido = v.lerStatus(saida(0, statusCom([
    passo('ork-a', { acao: 'despachar', fase: 'PLAN', desdeEm: '2026-10-12T14:00:00.000Z' }),
    passo('ork-b', { acao: 'despachar', fase: null }), passo('../x'), passo('ork-c', { acao: 'assumir' }), null,
    passo('ork-d', { bloqueio: { motivo: 'runtime.quota-exhausted', em: '2026-10-12T14:00:00.000Z' }, acao: 'retomar' }),
  ])), 's1');
  assert.equal(lido.presenca, 'minha');
  assert.deepEqual(lido.passos.map((p: { thread: string }) => p.thread), ['ork-a', 'ork-d']);
  assert.deepEqual(lido.passos[1].bloqueio, { motivo: 'runtime.quota-exhausted', em: '2026-10-12T14:00:00.000Z' });
  assert.equal(v.lerStatus(saida(0, statusCom([], 'outra')), 's1').presenca, 'outra');
  assert.equal(v.lerStatus(saida(0, statusCom([], null)), 's1').presenca, 'nenhuma');
  assert.throws(() => v.lerStatus(saida(0, { contrato: 'outro', threads: [] }), 's1'), /nao e o contrato ork\.conducao-sentinela\/v1/);
  assert.throws(() => v.lerStatus(saida(0, 'nao e json'), 's1'), /nao e JSON/);
  assert.throws(() => v.lerStatus(saida(2, '', 'linha 1\nerro: o fim\n'), 's1'), /saiu 2: erro: o fim/);
  assert.equal(v.lerBatida(saida(0, { ok: true })), 'minha');
  assert.equal(v.lerBatida(saida(3, { ok: false })), 'outra');
  assert.throws(() => v.lerBatida(saida(1, '', 'conducao.sentinela.trava')), /saiu 1: conducao\.sentinela\.trava/);
  assert.throws(() => v.lerBatida(saida(0, { ok: false })), /saiu 0/);
});

test('vigia: a thread de um ledger, o diario e as chaves com teto', () => {
  const v = carregar('hooks/vigia.ts');
  assert.equal(v.threadDoLedger('/p/.orkastery/threads/ork-a/ledger.jsonl'), 'ork-a');
  for (const ruim of ['/p/.orkastery/threads/ork-a/thread.json', '/p/.orkastery/threads/../ledger.jsonl', '/p/src/ledger.jsonl', 3, undefined]) {
    assert.equal(v.threadDoLedger(ruim), null, String(ruim));
  }
  assert.deepEqual(v.acrescentar([1, 2, 3], 4, 3), [2, 3, 4]);
  assert.deepEqual(v.guardarChave(['a', 'b'], 'a', 5), ['b', 'a']);
  assert.deepEqual(v.guardarChave(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
  assert.deepEqual(v.entrada(1, 'erro', null, '  duas\n linhas  '), { em: 1, tipo: 'erro', thread: null, texto: 'duas linhas' });
});

test('vigia: a linha da faixa em degraus, pausada, com outra sessao e sem leitura', () => {
  const v = carregar('hooks/vigia.ts');
  const agora = Date.parse('2026-10-12T15:00:00.000Z');
  const resumo = (passos: unknown[], extra = {}) => ({ lidoEm: agora, presenca: 'minha', passos, erro: null, ...extra });
  const parada = (min: number) => passo(`ork-p${min}`, { acao: 'avisar', desdeEm: new Date(agora - min * 60000).toISOString() });
  assert.deepEqual(['', 'há mais de 15 min', 'há mais de 45 min', 'há mais de 1 h', 'há mais de 3 h'],
    [10, 16, 59, 61, 200].map((m) => v.haQuantoTempo(m)));
  assert.equal(v.textoDaFaixa(resumo([passo('ork-a', { conduzida: true }), parada(42), parada(5)]), false, agora),
    '1 thread andando, 2 paradas há mais de 30 min');
  assert.equal(v.textoDaFaixa(resumo([passo('ork-a', { acao: 'despachar', fase: 'PLAN' })]), false, agora), '0 threads andando, 1 na vez da Sentinela');
  assert.equal(v.textoDaFaixa(resumo([passo('ork-a')]), false, agora), undefined, 'sem nada a dizer, a linha sai');
  assert.equal(v.textoDaFaixa(resumo([]), true, agora), 'pausada; o condutor externo conduz');
  assert.equal(v.textoDaFaixa(resumo([], { presenca: 'outra' }), false, agora), 'outra sessão conduz nesta máquina; esta só olha');
  assert.equal(v.textoDaFaixa(resumo([], { lidoEm: null, erro: 'falhou' }), false, agora), 'sem leitura do núcleo (falhou)');
  const texto = v.textoDoDiario(resumo([passo('ork-a', { conduzida: true }), parada(42)]), [v.entrada(agora - 120000, 'despacho', 'ork-b', 'PLAN')], false, agora);
  assert.match(texto, /^Sentinela conduzindo nesta máquina/);
  assert.match(texto, /ork-a: andando/);
  assert.match(texto, /ork-p42: parada há 42 min/);
  assert.match(texto, /há 2 min despacho ork-b: PLAN/);
});

test('vigia: a leitura da Sentinela casa com o ork conducao sentinela status de verdade e com a batida dele', (t) => {
  const v = carregar('hooks/vigia.ts');
  const p = projetoTemporario('ork-sentinela-contrato');
  t.after(() => p.limpar());
  const env = envPtBr({ ...process.env, ORK_MAQUINA: 'maquina-de-teste' });
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO']) delete env[nome];
  const rodar = (argv: string[]) => {
    assert.equal(argv[0], 'ork');
    const r = spawnSync(process.execPath, [CLI, ...argv.slice(1)], { cwd: p.dir, encoding: 'utf8', env });
    return { exitCode: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  };
  assert.equal(v.lerBatida(rodar(v.argvDaBatida('sessao-a'))), 'minha');
  assert.equal(v.lerBatida(rodar(v.argvDaBatida('sessao-b'))), 'outra');
  assert.deepEqual(v.lerStatus(rodar(v.argvDoStatus()), 'sessao-a'), { presenca: 'minha', passos: [] });
  assert.equal(v.lerStatus(rodar(v.argvDoStatus()), 'sessao-b').presenca, 'outra');
  assert.equal(rodar(v.argvDoDesligar('sessao-a')).exitCode, 0);
  assert.equal(v.lerStatus(rodar(v.argvDoStatus()), 'sessao-a').presenca, 'nenhuma');
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

test('D2: a Sentinela so chama no $ a lista fechada, todo argv sai dos construtores e nada de conducao assumir', () => {
  const fontes = fontesDoMod(SENTINELA);
  assert.ok(fontes.some((f) => f.endsWith('hooks/register.ts')));
  const vistas = new Set<string>();
  let processos = 0;
  for (const arquivo of fontes) {
    const { chamadas, fonte } = chamadasDoFonte(arquivo);
    for (const c of chamadas) {
      const onde = `${path.relative(raizDoRepo, arquivo)}:${c.linha} ${c.cadeia.join('.')}`;
      if (c.cadeia[0] !== '$') continue;
      const chamada = c.cadeia.slice(1).join('.');
      assert.ok(!NOUNS_PROIBIDOS.includes(c.cadeia[1] ?? ''), `noun proibido: ${onde}`);
      assert.ok(CHAMADAS_PERMITIDAS.includes(chamada), `chamada fora da lista fechada do $: ${onde}`);
      vistas.add(chamada);
      if (chamada === 'ork.ler') {
        const pedido = c.no.arguments[0];
        const consulta = pedido && ts.isObjectLiteralExpression(pedido)
          ? pedido.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && x.name.getText(fonte) === 'consulta') : undefined;
        assert.ok(consulta && ts.isStringLiteral(consulta.initializer) && CONSULTAS_PERMITIDAS.includes(consulta.initializer.text), `consulta fora da lista: ${onde}`);
      }
      if (chamada === 'process.run') {
        processos++;
        const argv = c.no.arguments[0];
        assert.ok(argv && ts.isCallExpression(argv) && ts.isIdentifier(argv.expression) && CONSTRUTORES_DE_ARGV.includes(argv.expression.text),
          `argv que nao sai de um construtor: ${onde}: ${argv?.getText(fonte)}`);
      }
    }
    // A Sentinela nunca toma a conducao de ninguem: nenhum literal do fonte forma o subcomando de handoff.
    assert.doesNotMatch(fs.readFileSync(arquivo, 'utf8'), /'assumir'/, `${path.relative(raizDoRepo, arquivo)} cita o handoff`);
  }
  assert.ok(processos >= 6, `process.run achados: ${processos}`);
  for (const esperada of ['ork.papel', 'ork.faixa', 'ork.ler', 'ork.retrato', 'ork.mostrado', 'ui.notify', 'process.run', 'session.id', 'command.register',
    'clock.every']) {
    assert.ok(vistas.has(esperada), esperada);
  }
  const v = carregar('hooks/vigia.ts');
  const d = carregar('hooks/despacho.ts');
  for (const argv of [v.argvDoStatus(), v.argvDaBatida('s'), v.argvDoDesligar('s')]) {
    assert.deepEqual(argv.slice(0, 3), ['ork', 'conducao', 'sentinela']);
    assert.ok(!argv.includes('assumir'));
  }
  for (const argv of [d.argvDoRender('ork-a', 'PLAN'), d.argvDoDespacho('ork-a', 'PLAN', 'p', 's'), d.argvDaRetomada('ork-a')]) {
    assert.ok(!argv.includes('assumir') && !argv.includes('--por') && !argv.includes('--autorizar-push'), argv.join(' '));
  }
});

test('despacho: so o passo despachar do #Auto, sem conducao, com fase do ciclo e turno novo; retomar so com bloqueio', () => {
  const d = carregar('hooks/despacho.ts');
  const fim = '2026-10-12T14:00:00.000Z';
  const despachar = (thread: string, extra = {}) => passo(thread, { acao: 'despachar', fase: 'PLAN', desdeEm: fim, ...extra });
  const passos = [despachar('ork-a'), despachar('ork-b', { conduzida: true }), despachar('ork-c', { modo: 'classic' }), despachar('ork-d', { fase: 'X' }),
    despachar('ork-e', { desdeEm: null }), despachar('ork-f'), passo('ork-g', { acao: 'avisar' })];
  assert.equal(d.chaveDoDespacho(passos[0]), `ork-a|PLAN|${fim}`);
  assert.deepEqual(d.paraDespachar(passos, [`ork-f|PLAN|${fim}`]).map((p: { thread: string }) => p.thread), ['ork-a']);
  const retomar = (thread: string, extra = {}) => passo(thread, { acao: 'retomar', bloqueio: { motivo: 'runtime.quota-exhausted', em: fim }, ...extra });
  assert.equal(d.chaveDaRetomada(retomar('ork-a')), `ork-a|runtime.quota-exhausted|${fim}`);
  assert.deepEqual(d.paraRetomar([retomar('ork-a'), retomar('ork-b', { conduzida: true }), retomar('ork-c', { bloqueio: null }),
    retomar('ork-d', { modo: 'maestro' }), retomar('ork-e')], [`ork-e|runtime.quota-exhausted|${fim}`]).map((p: { thread: string }) => p.thread), ['ork-a']);
  assert.equal(d.retomadaAutomatica({ automatica: true, bloqueio: null }), true);
  for (const nao of [{ automatica: true, bloqueio: 'escalacao.limite' }, { automatica: false, bloqueio: null }, null, 'x']) {
    assert.equal(d.retomadaAutomatica(nao), false, JSON.stringify(nao));
  }
  assert.deepEqual(d.argvDaRetomada('ork-a'), ['ork', 'retry', 'run', 'ork-a']);
  assert.deepEqual({ ...d.AMBIENTE_DA_RETOMADA }, { ORK_CANAL: 'claude-code' });
  assert.equal(d.ADIAMENTO_MS, 180000, 'a recusa que passa volta em 3 min');
  assert.equal(d.pedidoAbertoNoRetrato({ sections: { hitl: { items: [{ status: 'aberto', refs: [{ kind: 'thread', id: 'ork-a' }], facts: { target: 'gate' } }] } } }, 'ork-a'), true);
  for (const item of [{ status: 'stale', refs: [{ kind: 'thread', id: 'ork-a' }] }, { status: 'aberto', refs: [{ kind: 'thread', id: 'ork-b' }] },
    { status: 'aberto', refs: [{ kind: 'thread', id: 'ork-a' }], facts: { target: 'decidido' } }]) {
    assert.equal(d.pedidoAbertoNoRetrato({ sections: { hitl: { items: [item] } } }, 'ork-a'), false, JSON.stringify(item));
  }
  assert.equal(d.pedidoAbertoNoRetrato(null, 'ork-a'), false);
  for (const [r, esperado] of [[saida(0, 'Fase despachada.\n  sessionId      : 11111111-2222-3333-4444-555555555555\n'), 'despachada'],
    [saida(0, 'Pedido ja em andamento: a fase PLAN da thread ork-a roda'), 'repetida'], [saida(3, 'Thread ork-a: conduzida'), 'ocupada'],
    [saida(1, '', 'erro: HITL ocupado; exclusao do kernel'), 'ocupada'], [saida(1, '', 'erro: runtime.unavailable'), 'falhou']] as const) {
    assert.equal(d.lerDespacho(r).resultado, esperado, JSON.stringify(r));
  }
  assert.equal(d.lerDespacho(saida(0, 'x\n  sessionId      : 11111111-2222-3333-4444-555555555555')).detalhe, 'sessão 11111111');
  assert.throws(() => d.argvDoDespacho('ork-a', 'PLAN', '  ', 's'), /prompt vazio/);
  assert.throws(() => d.argvDoDespacho('../x', 'PLAN', 'p', 's'), /id de thread invalido/);
  assert.throws(() => d.argvDoRender('ork-a', 'FIM'), /fase fora do ciclo/);
});

test('despacho: o render, o phase run e a conducao de verdade casam com a leitura da Sentinela, e o pedido repetido nao abre sessao', (t) => {
  const v = carregar('hooks/vigia.ts');
  const d = carregar('hooks/despacho.ts');
  const p = projetoTemporario('ork-sentinela-despacho');
  const runtime = runtimeFalso('ork-sentinela-despacho');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const env = envPtBr({ ...process.env, ORK_MAQUINA: 'maquina-de-teste' });
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO']) delete env[nome];
  const rodar = (argv: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...argv.slice(1)], { cwd: p.dir, encoding: 'utf8', env });
    return { exitCode: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  };
  const { thread } = novaThread(p.carregado, { nome: 'com pedido', modo: 'auto', pedido: 'Implementar a fatia da Sentinela. #Auto' });
  const { thread: semPedido } = novaThread(p.carregado, { nome: 'sem pedido', modo: 'auto' });
  assert.match(String((d.promptDoRender(rodar(d.argvDoRender(semPedido.id, 'PLAN'))) as { motivo: string }).motivo), /nao tem o pedido guardado|não tem o pedido guardado/);
  const render = d.promptDoRender(rodar(d.argvDoRender(thread.id, 'PLAN')));
  assert.ok('prompt' in render, JSON.stringify(render));
  assert.match(render.prompt, /Implementar a fatia da Sentinela/);
  assert.equal(d.conducaoLivre(JSON.parse(rodar(['ork', 'conducao', 'status', thread.id, '--json']).stdout)), true);
  assert.equal(d.lerDespacho(rodar(d.argvDoDespacho(thread.id, 'PLAN', render.prompt, 'sessao-a'))).resultado, 'despachada');
  assert.equal(d.conducaoLivre(JSON.parse(rodar(['ork', 'conducao', 'status', thread.id, '--json']).stdout)), false);
  assert.equal(d.lerDespacho(rodar(d.argvDoDespacho(thread.id, 'PLAN', render.prompt, 'sessao-a'))).resultado, 'repetida');
  assert.equal(d.lerDespacho(rodar(d.argvDoDespacho(thread.id, 'PLAN', 'outro prompt', 'sessao-a'))).resultado, 'ocupada');
  assert.equal(runtime.chamadas().length, 1, 'uma sessao so');
  const despacho = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'phase_dispatch')!;
  assert.deepEqual([despacho.canal, despacho.correlacao], ['claude-code', 'sentinela:sessao-a']);
  assert.ok(v.lerStatus(rodar(v.argvDoStatus()), 'sessao-a').passos.some((x: { thread: string; conduzida: boolean }) => x.thread === thread.id && x.conduzida));
});

test('alertas: o pulse vira aviso do que so o dono resolve e do parado que ninguem faz sozinho, sem pedir gate em #Auto', () => {
  const a = carregar('hooks/alertas.ts');
  const v = carregar('hooks/vigia.ts');
  const passos = [passo('ork-a'), passo('ork-b', { modo: 'classic' }), passo('ork-c', { conduzida: true })];
  const pulse = {
    contrato: 'ork.pulse/v1',
    precisaDeHumanoAgora: [
      { thread: 'ork-a', motivo: 'human.pending', comandoResposta: 'rode ork gate request ork-a; depois siga' },
      { thread: 'ork-b', motivo: 'human.pending', comandoResposta: 'ork gate request ork-b' },
      { thread: 'ork-c', motivo: 'claims.failed', comandoResposta: 'rode ork verify' },
      { thread: 'ork-a', motivo: 'verify.timeout', comandoResposta: 'ork retry run ork-a' },
      { thread: null, motivo: 'runtime.unavailable', comandoResposta: '', recomendacao: 'faca login no runtime' },
    ],
    paradoNoCondutor: ['sem-push', 'pr-verde', 'fase-seguinte', 'check-sem-veredito', 'sessao-sem-pergunta'].map((caso) =>
      ({ thread: 'ork-a', caso, proximoPasso: `passo de ${caso}` })),
  };
  assert.deepEqual(a.avisosDoPulse(pulse, passos), [
    { chave: 'dono:ork-a:human.pending', thread: 'ork-a', texto: 'ork-a (human.pending): rode; depois siga (em #Auto o núcleo não abre gate; resolva pela ação da thread)' },
    { chave: 'dono:ork-b:human.pending', thread: 'ork-b', texto: 'ork-b (human.pending): ork gate request ork-b' },
    { chave: 'dono:-:runtime.unavailable', thread: null, texto: 'fábrica (runtime.unavailable): faca login no runtime' },
    { chave: 'parado:ork-a:sessao-sem-pergunta', thread: 'ork-a', texto: 'ork-a parado no condutor (sessao-sem-pergunta): passo de sessao-sem-pergunta' },
  ]);
  assert.throws(() => a.avisosDoPulse({ contrato: 'outro' }, passos), /nao e o contrato ork\.pulse\/v1/);
  const avisos = a.avisosDoPulse(pulse, passos);
  assert.deepEqual(a.avisosNovos(avisos, [a.marcaDoAviso(avisos[0])], 2).map((x: { chave: string }) => x.chave),
    ['dono:ork-b:human.pending', 'dono:-:runtime.unavailable']);
  assert.equal(a.semPedirGate('ork gate request ork-a', 'maestro'), 'ork gate request ork-a');
  assert.deepEqual(a.CASOS_DE_OUTRO, ['sem-push', 'pr-verde', 'fase-seguinte', 'check-sem-veredito']);
  assert.match(a.avisoDoDespacho(passo('ork-a', { fase: 'PLAN', desdeEm: 'x' }), 'sem pedido').texto, /^ork-a: a Sentinela não despachou o PLAN \(sem pedido\)$/);
  assert.equal(v.textoDaFaixa({ lidoEm: 1, presenca: 'minha', passos: [], erro: null }, false, 1, 2), '0 threads andando, 2 avisos para você');
});

test('alertas: o pulse de verdade casa com o contrato que a Sentinela le', (t) => {
  const a = carregar('hooks/alertas.ts');
  const p = projetoTemporario('ork-sentinela-pulse');
  t.after(() => p.limpar());
  const env = envPtBr({ ...process.env });
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO']) delete env[nome];
  const r = spawnSync(process.execPath, [CLI, 'pulse', '--json', '--sem-runtime'], { cwd: p.dir, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(a.avisosDoPulse(JSON.parse(r.stdout), []), []);
});
