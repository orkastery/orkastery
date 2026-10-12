import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { criarServidorMcp } from '../src/mcp-server';
import { adicionarClaim, retirarClaim } from '../src/claims';
import { listarClaimsMcp } from '../src/mcp-artifacts';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPorOmissao, registrarMaster } from '../src/master';
import { discoverMaestro } from '../src/maestro-discovery';
import { maestroSnapshot } from '../src/maestro-snapshot';
import { dirThread, novaThread } from '../src/thread';
import { registrarArtefato } from '../src/thread-close';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

// RM-059 (fatia F8): o Ritual do MASTER (`ork-ritual`) testado sem o Claude Code. O sandbox do `ork verify` e o runner
// do CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros do Ritual com o compilador do `core` e os
// roda num escopo proprio, como os testes da ponte, da Torre, da Mesa e da Pista. O fonte do mod e varrido pela AST (as
// entregas so pelo retrato da ponte, a lista fechada de chamadas ao `$` e de ferramentas do nucleo, o botao da nota so
// com o `threadId` e o argv da reserva so do construtor), e o parser do Ritual roda contra o retrato, as claims, a
// ferramenta da nota e o `ork master pedir` de verdade de um projeto temporario.
const raizDoRepo = path.resolve(__dirname, '../../..');
const RITUAL = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ritual');
const MODULOS_PUROS = ['hooks/ritual.ts', 'hooks/replay.tsx', 'hooks/nota.ts'];
/** Tudo que o Ritual chama direto no `$`. */
const CHAMADAS_PERMITIDAS = ['ork.papel', 'ork.faixa', 'ork.retrato', 'ork.mostrado', 'command.register', 'clock.now', 'clock.after',
  'clock.every', 'mcp.call', 'process.run', 'state.get', 'state.set', 'ui.open', 'ui.panes', 'ui.resolve', 'ui.toast'];
/** Nada de disco, de ambiente, de texto como o dono, de agente ou de ferramenta do host. */
const NOUNS_PROIBIDOS = ['store', 'env', 'fs', 'prompt', 'agent', 'tool', 'session'];
/** A lista fechada das ferramentas do nucleo que o Ritual chama no servidor `orkastery`, com o construtor dos argumentos de cada uma. */
const LISTA_FECHADA_DO_MCP: Record<string, string> = { ork_claims_list: 'argsDasClaims', ork_request_master_note: 'argsDaNota' };
/** O unico construtor de argv do Ritual: o pedido de nota pelo Telegram. */
const CONSTRUTORES_DE_ARGV = ['argvDaReserva'];
const EPOCA = 1760000000000;
const DIA = 86400000;

type No = { tipo: string; props: Record<string, unknown>; filhos: unknown[] };
(globalThis as unknown as { h: unknown }).h = (tipo: string, props: Record<string, unknown> | null, ...filhos: unknown[]): No =>
  ({ tipo, props: props ?? {}, filhos: filhos.flat(Infinity) });

const modulos = new Map<string, Record<string, any>>();
function resolver(base: string): string {
  for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error(`modulo do Ritual nao encontrado: ${base}`);
}
/** Transpila e roda um modulo puro do Ritual; o `require` so resolve outro modulo puro dele. */
function carregar(rel: string): Record<string, any> {
  const arquivo = resolver(path.join(RITUAL, rel));
  const pronto = modulos.get(arquivo);
  if (pronto) return pronto;
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  });
  const modulo = { exports: {} as Record<string, any> };
  modulos.set(arquivo, modulo.exports);
  const exigir = (id: string) => {
    const alvo = path.relative(RITUAL, path.join(path.dirname(arquivo), id));
    if (!id.startsWith('./') || !MODULOS_PUROS.includes(path.relative(RITUAL, resolver(path.join(RITUAL, alvo))))) {
      throw new Error(`modulo puro do Ritual nao importa valor de fora dele: ${id}`);
    }
    return carregar(alvo);
  };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(RITUAL, rel), 'utf8'));
const ritual = () => carregar('hooks/ritual.ts');
const replay = () => carregar('hooks/replay.tsx');
const nota = () => carregar('hooks/nota.ts');

/** Os textos de uma arvore desenhada com o `h` deste teste, um por `Text` e um por `Button` (o rotulo). */
function textos(no: unknown): string[] {
  if (!no || typeof no !== 'object') return [];
  const n = no as No;
  const proprios = () => n.filhos.filter((f) => typeof f === 'string' || typeof f === 'number').join('');
  if (n.tipo === 'Text') return [proprios()];
  if (n.tipo === 'Button') return [typeof n.props.label === 'string' ? n.props.label : proprios()];
  return n.filhos.flatMap(textos);
}

/** Um item da secao `master`, com os fatos que o nucleo projeta (T8.2a). */
function item(thread: string, o: Record<string, unknown> = {}) {
  const dias = typeof o.dias === 'number' ? o.dias : 1;
  return {
    id: `master:${thread}`, title: 'MASTER', status: o.status ?? 'recorded', refs: [{ kind: 'thread', id: thread }],
    facts: { score: 4, regime: 'omissao', classes: 'processo', index: 4, indexDetail: 'go_fix_opened x2', reprovals: 1,
      deliveredAt: o.entregue === false ? null : new Date(EPOCA - dias * DIA).toISOString(), deliveredAtLocal: '10/10 14:20 (horário de Brasília)',
      deliveredSha: 'b'.repeat(40), ...(o.facts as Record<string, unknown> ?? {}) },
  };
}

test('manifesto do Ritual: nome, contrato de estado, dependencia da ponte, papel dono e nenhuma chave de papel', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-ritual');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  const conhecidas = new Set(['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'dependencies']);
  assert.deepEqual(Object.keys(m).filter((k) => !conhecidas.has(k)), []);
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono'], claudeCodeMinimo: '2.1.287' });
  assert.deepEqual(lerJson('hooks/hooks.json'), { modules: ['./register.tsx'] });
  assert.ok(fs.readdirSync(path.join(RITUAL, 'test')).some((n) => /\.test\.tsx?$/.test(n)));
});

test('o contrato declara o estado do Ritual sem import nem referencia, e nada nele guarda a nota ou o porque do dono', () => {
  const tipos = fs.readFileSync(path.join(RITUAL, 'types/index.d.ts'), 'utf8');
  assert.match(tipos, /interface PluginState \{\s*'ork-ritual': \{/);
  for (const chave of ['quadro: RitualQuadro', 'foco: string | null', 'passo: number', 'prova: RitualProva | null', 'notas: Record<string, RitualNota>',
    'reservas: Record<string, RitualReserva>']) assert.ok(tipos.includes(chave), chave);
  assert.doesNotMatch(tipos, /^\s*import\s/m);
  assert.doesNotMatch(tipos, /\/\/\/\s*<reference/);
  assert.doesNotMatch(tipos, /interface EngineInterface/);
  // Nenhum campo do estado guarda o porque, a justificativa, a resposta ou a opcao do dono (os comentarios podem citar).
  const codigo = tipos.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join('\n');
  assert.doesNotMatch(codigo, /\b(porque|justificativa|resposta|opcao|escolha)\??\s*:/);
});

test('modulo puro do Ritual so importa tipos ou outro modulo puro dele, e nao chama o $', () => {
  for (const rel of MODULOS_PUROS) {
    const fonte = fs.readFileSync(path.join(RITUAL, rel), 'utf8');
    for (const linha of fonte.split('\n').filter((l) => /^\s*import\s/.test(l))) {
      if (/^\s*import type\s/.test(linha)) continue;
      const de = /from '(\.\/[a-z]+)'/.exec(linha)?.[1];
      assert.ok(de && MODULOS_PUROS.includes(path.relative(RITUAL, resolver(path.join(RITUAL, 'hooks', de)))), `${rel}: ${linha}`);
    }
    assert.doesNotMatch(fonte, /\$\./, `${rel} chama o $`);
  }
});

test('entregas: entra a sem MASTER, a proposta e a aceita por omissao da janela; sai a nota humana, a sem entrega e a velha', () => {
  const r = ritual();
  const itens = [
    item('ork-a', { dias: 2 }), item('ork-b', { status: 'pending', facts: { regime: null, classes: null, score: null } }),
    item('ork-c', { facts: { regime: 'batch', score: 5 } }), item('ork-d', { dias: 8 }), item('ork-e', { status: 'ratificacao-pendente', dias: 0 }),
    item('ork-f', { status: 'pending', entregue: false }), item('ork-g', { status: 'esquisito' }), { id: 'master:../fora', status: 'pending', facts: {} },
    item('ork-h', { facts: { regime: 'pausa' } }), null, 'texto',
  ];
  const { entregas, fora, alemDoTeto } = r.entregasDaJanela(itens, EPOCA);
  assert.deepEqual(entregas.map((e: { thread: string }) => e.thread), ['ork-e', 'ork-b', 'ork-a']);
  assert.equal(fora, 1);
  assert.equal(alemDoTeto, 0);
  const a = entregas.find((e: { thread: string }) => e.thread === 'ork-a');
  assert.deepEqual(a, { thread: 'ork-a', status: 'recorded', regime: 'omissao', score: 4, indice: 4, parcelas: 'go_fix_opened x2', reprovacoes: 1,
    classes: 'processo', entregueEm: new Date(EPOCA - 2 * DIA).toISOString(), entregueEmLocal: '10/10 14:20 (horário de Brasília)', merge: 'b'.repeat(40),
    artefato: null });
  // A entrega por artefato (sem merge) entra com o arquivo.
  const porArtefato = r.entregaDoItem(item('ork-p', { facts: { deliveredSha: null, deliveredArtifact: 'docs/plano.md' } }));
  assert.equal(porArtefato.merge, null);
  assert.equal(porArtefato.artefato, 'docs/plano.md');
  // A janela e de 7 dias: exatamente no limite ainda entra.
  assert.equal(r.entregasDaJanela([item('ork-x', { dias: 7 })], EPOCA).entregas.length, 1);
  assert.equal(r.JANELA_DIAS, 7);
  // O teto do painel: o resto vira contagem.
  const muitas = Array.from({ length: r.TETO_DE_ENTREGAS + 3 }, (_, i) => item(`ork-m${i}`, { dias: 0 }));
  const teto = r.entregasDaJanela(muitas, EPOCA);
  assert.equal(teto.entregas.length, r.TETO_DE_ENTREGAS);
  assert.equal(teto.alemDoTeto, 3);
});

test('faixa, lacunas, paginas, json do MCP, ledger e numero', () => {
  const r = ritual();
  const quadro = (threads: string[], lidoEm: number | null = EPOCA) => ({ entregas: threads.map((t) => ({ thread: t })), lidoEm, erro: null, avisos: [], foraDaJanela: 0 });
  assert.equal(r.textoDaFaixa(quadro(['ork-a'])), '1 entrega espera a sua nota: ork-a · /nota');
  assert.equal(r.textoDaFaixa(quadro(['ork-a', 'ork-b', 'ork-c', 'ork-d', 'ork-e'])), '5 entregas esperam a sua nota: ork-a, ork-b, ork-c e +2 · /nota');
  assert.equal(r.textoDaFaixa(quadro([])), undefined);
  assert.equal(r.textoDaFaixa(quadro(['ork-a'], null)), undefined);
  assert.equal(r.textoDaFaixa({ ...quadro(['ork-a', 'ork-b']), semLeitura: 3 }), 'pelo menos 2 entregas esperam a sua nota: ork-a, ork-b · /nota');
  assert.deepEqual(r.avisosDasLacunas([]), []);
  assert.deepEqual(r.avisosDasLacunas(['a', 'b', 'a', 'c', 'd']), ['o retrato do MASTER veio incompleto: 4 lacunas (a, b, c, ...)']);
  // O corte da pagina por bytes nao falta nada; as threads sem leitura somam as nomeadas e as omitidas (de todas as paginas).
  assert.deepEqual(r.avisosDasLacunas(['maestro.page.byte_limit']), []);
  assert.equal(r.threadsSemLeitura(['maestro.page.byte_limit']), 0);
  const repetidas = ['ledger.unavailable:ork-x', 'master.invalid:ork-y', 'ledger.unavailable:ork-z', 'ledger.unavailable:ork-w', 'maestro.messages.omitted:23',
    'maestro.page.byte_limit'];
  assert.deepEqual(r.avisosDasLacunas([...repetidas, ...repetidas]),
    ['o retrato não leu 27 threads (ork-x, ork-y, ork-z e +24): a lista pode estar incompleta; ork master lista todas']);
  assert.equal(r.threadsSemLeitura([...repetidas, ...repetidas]), 27);
  assert.deepEqual(r.avisosDasLacunas(['maestro.messages.omitted:2']), ['o retrato não leu 2 threads: a lista pode estar incompleta; ork master lista todas']);
  assert.deepEqual(r.avisosDasLacunas(['ledger.unavailable:ork-x', 'maestro.snapshot.stale']),
    ['o retrato não leu 1 thread (ork-x): a lista pode estar incompleta; ork master lista todas', 'o retrato do MASTER veio incompleto: 1 lacuna (maestro.snapshot.stale)']);
  // A nota registrada (ou repetida) nesta sessao tira a entrega; a entrega mais nova que a nota volta.
  const entregas = [{ thread: 'ork-a', entregueEm: new Date(EPOCA - DIA).toISOString() }, { thread: 'ork-b', entregueEm: new Date(EPOCA - DIA).toISOString() },
    { thread: 'ork-c', entregueEm: new Date(EPOCA + DIA).toISOString() }, { thread: 'ork-d', entregueEm: new Date(EPOCA - DIA).toISOString() }];
  const notas = { 'ork-a': { estado: 'registrada', texto: '', em: EPOCA }, 'ork-b': { estado: 'pendente', texto: '', em: EPOCA },
    'ork-c': { estado: 'registrada', texto: '', em: EPOCA }, 'ork-d': { estado: 'repetida', texto: '', em: EPOCA } };
  assert.deepEqual(r.semNotaDada(entregas, notas).map((e: { thread: string }) => e.thread), ['ork-b', 'ork-c']);
  const pagina = r.paginaDoMaster({ retrato: { sections: { master: { items: [1], gaps: ['g', 3], coverage: { nextOffset: 50 } } } } });
  assert.deepEqual(pagina, { itens: [1], proxima: 50, lacunas: ['g'] });
  assert.equal(r.paginaDoMaster({ retrato: { sections: { master: { items: [], coverage: { nextOffset: null } } } } }).proxima, null);
  assert.throws(() => r.paginaDoMaster({ retrato: { sections: {} } }), /não trouxe a seção master/);
  const resposta = (valor: unknown, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(valor) }], isError });
  assert.deepEqual(r.jsonDoMcp(resposta([1, 2])), [1, 2]);
  assert.throws(() => r.jsonDoMcp(resposta({ erro: 'mcp.thread.scope: outra' }, true)), /^Error: mcp\.thread\.scope: outra$/);
  assert.throws(() => r.jsonDoMcp({ content: [{ type: 'text', text: 'nao e json' }], isError: true }), /o núcleo respondeu com erro/);
  assert.equal(r.threadDoLedger('/p/.orkastery/threads/ork-a/ledger.jsonl'), 'ork-a');
  assert.equal(r.threadDoLedger('/p/.orkastery/threads/ork-a/thread.json'), null);
  assert.equal(r.numero(3.75), '3,75');
  assert.deepEqual(r.argsDasClaims('ork-a'), { threadId: 'ork-a' });
  assert.throws(() => r.argsDasClaims('../fora'), /id de thread invalido/);
});

test('claims: o ultimo registro de cada id, as retiradas a parte, na ordem dos ids, e o que esta fora do contrato fica de fora', () => {
  const r = ritual();
  const c = (id: string, estado: string, extra: Record<string, unknown> = {}) => ({ id, estado, arquivo: `f/${id}`, alegacao: `a ${id}`, verificar: [`cmd ${id}`], ...extra });
  const { claims, retiradas } = r.claimsDaProva([c('C10', 'pendente'), c('C2', 'pendente'), c('C1', 'pendente'), c('C2', 'retirada'), c('C1', 'verificado'),
    c('C3', 'reprovado', { verificar: ['um', 2, 'dois'] }), { id: 'X1', estado: 'verificado' }, { id: 'C4' }, null]);
  assert.deepEqual(claims.map((x: { id: string; estado: string }) => `${x.id}:${x.estado}`), ['C1:verificado', 'C3:reprovado', 'C10:pendente']);
  assert.equal(retiradas, 1);
  assert.deepEqual(claims[1].comandos, ['um', 'dois']);
  assert.throws(() => r.claimsDaProva({ claims: [] }), /não devolveu a lista/);
});

test('painel: a lista com o cartao de cada entrega e o replay com a claim do passo, estado com glifo e rotulo', () => {
  const r = ritual(), p = replay();
  const { entregas } = r.entregasDaJanela([item('ork-a', { facts: { index: 2.75, indexDetail: 'go_fix_opened x3', reprovals: 2 } }),
    item('ork-b', { status: 'pending', facts: { regime: null, classes: null, score: null, index: 5, indexDetail: '', reprovals: 0 } })], EPOCA);
  const quadro = { entregas, lidoEm: EPOCA, erro: null, avisos: [], foraDaJanela: 2 };
  const lista = p.linhasDoPainel(quadro, { agora: EPOCA + 3000 });
  assert.deepEqual(lista.map((l: { texto: string }) => l.texto), [
    'Ritual do MASTER · 2 entregas esperam a sua nota · lido há 3 s',
    '2 entregas sem a sua nota ficaram fora da janela de 7 dias (ork master)',
    '● espera sua nota · ork-a · entregue 10/10 14:20 (horário de Brasília) · merge bbbbbbbb',
    '  aceita por omissão com 4/5; a sua nota sobrescreve',
    '  índice derivado do ledger: 2,75 de 5 (go_fix_opened x3) · ork master',
    '  POSTMORTEM: classes processo · 2 reprovações tipadas',
    'Ver a prova | Dar a nota',
    '● espera sua nota · ork-b · entregue 10/10 14:20 (horário de Brasília) · merge bbbbbbbb',
    '  sem nota: sem a sua, o MASTER fecha por omissão',
    '  índice derivado do ledger: 5 de 5 (sem desconto) · ork master',
    '  POSTMORTEM: nasce no fechamento · 0 reprovações tipadas',
    'Ver a prova | Dar a nota',
  ]);
  assert.deepEqual(lista.filter((l: { mostrado?: unknown }) => l.mostrado).map((l: { mostrado: unknown }) => l.mostrado), [
    { chave: 'nota:ork-a', thread: 'ork-a', texto: 'ork-a: entregue, espera sua nota (índice 2,75 de 5)' },
    { chave: 'nota:ork-b', thread: 'ork-b', texto: 'ork-b: entregue, espera sua nota (índice 5 de 5)' },
  ]);
  const prova = { thread: 'ork-a', claims: [{ id: 'C1', estado: 'verificado', arquivo: 'f/C1', alegacao: 'a C1', comandos: ['cmd C1'] },
    { id: 'C2', estado: 'nao-verificavel', arquivo: '', alegacao: '', comandos: [] }], retiradas: 0, lidoEm: EPOCA, erro: null };
  const passo0 = p.linhasDoPainel(quadro, { agora: EPOCA, foco: 'ork-a', prova, passo: 0 }).map((l: { texto: string }) => l.texto);
  assert.deepEqual(passo0.slice(-5), ['  claim 1 de 2 · ork claims list ork-a', '  ✓ C1 · verificada · f/C1', '  a C1', '  $ cmd C1', '|proxima']);
  const passo1 = p.linhasDoPainel(quadro, { agora: EPOCA, foco: 'ork-a', prova, passo: 9 }).map((l: { texto: string }) => l.texto);
  assert.deepEqual(passo1.slice(-4), ['  claim 2 de 2 · ork claims list ork-a', '  ? C2 · não verificável', '  sem comando registrado', 'anterior|']);
  // A prova de outra thread, ou ainda nao lida, nao aparece como se fosse desta.
  assert.deepEqual(p.linhasDaProva('ork-b', prova, 0).map((l: { texto: string }) => l.texto), ['lendo as claims no núcleo...']);
  const desenho = p.desenharRitual({ Box: 'Box', Text: 'Text', Button: 'Button' }, p.linhasDoPainel(quadro, { agora: EPOCA, foco: 'ork-a', prova, passo: 1 }), { foco: 'ork-a' });
  assert.deepEqual(textos(desenho).slice(0, 3), ['Ritual do MASTER · prova da ork-a', 'Voltar', 'Atualizar']);
  assert.equal(textos(desenho).at(-1), 'Anterior');
  // A janela de rolagem: so o que esta inteiro dentro dela conta como mostrado.
  assert.deepEqual(p.mostradosVisiveis(lista, { offset: 0, bodyRows: 5 }), [lista[4].mostrado]);
  assert.deepEqual(p.mostradosVisiveis(lista, { offset: 5, bodyRows: 100 }), [lista[9].mostrado]);
  assert.deepEqual(p.mostradosVisiveis(lista, undefined), []);
});

/** Uma thread #Auto entregue, com o tropeco que o indice desconta. */
function entregue(p: ProjetoDeTeste, nome: string) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.fixAberto, { fase: 'GO' });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, { fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: 'd'.repeat(40), pushVerificado: false });
  return thread;
}

test('o parser do Ritual casa com o retrato e as claims de verdade do nucleo', () => {
  const p = projetoTemporario('ork-ritual-retrato');
  try {
    const omissao = entregue(p, 'omissao');
    aceitarPorOmissao(p.dir, omissao.id);
    const pendente = entregue(p, 'pendente');
    const humana = entregue(p, 'humana');
    registrarMaster(p.dir, humana.id, { score: 5, justificativa: 'entregou tudo', por: 'Dono Simulado' });
    const snapshot = maestroSnapshot(discoverMaestro({ cwd: p.dir }));
    const pagina = ritual().paginaDoMaster({ fonte: 'mcp', lidoEm: Date.now(), retrato: snapshot });
    const { entregas } = ritual().entregasDaJanela(pagina.itens, Date.now());
    assert.deepEqual(entregas.map((e: { thread: string }) => e.thread).sort(), [omissao.id, pendente.id].sort());
    const daOmissao = entregas.find((e: { thread: string }) => e.thread === omissao.id);
    assert.equal(daOmissao.status, 'recorded');
    assert.equal(daOmissao.regime, 'omissao');
    assert.equal(daOmissao.indice, 4.5);
    assert.equal(daOmissao.parcelas, 'go_fix_opened x1');
    assert.equal(daOmissao.merge, 'd'.repeat(40));
    assert.equal(typeof daOmissao.entregueEmLocal, 'string');
    const daPendente = entregas.find((e: { thread: string }) => e.thread === pendente.id);
    assert.equal(daPendente.status, 'pending');
    assert.equal(daPendente.classes, null);
    // A entrega por artefato (thread so de planejamento), aceita por omissao ou sem MASTER, tambem espera a nota.
    fs.writeFileSync(path.join(p.dir, 'plano-entregue.md'), '# plano\n');
    const sha = createHash('sha256').update('# plano\n').digest('hex');
    const artefatos = ['artefato omissao', 'artefato pendente'].map((nome) => novaThread(p.carregado, { nome, modo: 'auto' }).thread);
    for (const t of artefatos) registrarArtefato(p.dir, t.id, 'plano-entregue.md', sha, 'Dono Simulado');
    aceitarPorOmissao(p.dir, artefatos[0]!.id);
    const comArtefato = ritual().entregasDaJanela(ritual().paginaDoMaster({ retrato: maestroSnapshot(discoverMaestro({ cwd: p.dir })) }).itens, Date.now()).entregas;
    for (const [t, status] of [[artefatos[0]!, 'recorded'], [artefatos[1]!, 'pending']] as const) {
      const e = comArtefato.find((x: { thread: string }) => x.thread === t.id);
      assert.ok(e, `a entrega por artefato da ${t.id} aparece`);
      assert.equal(e.status, status);
      assert.equal(e.merge, null);
      assert.equal(e.artefato, 'plano-entregue.md');
    }
    // As claims de verdade: duas registradas, uma retirada; o replay ve uma, e a retirada vira contagem.
    adicionarClaim(p.dir, pendente.id, { arquivo: 'README.md', alegacao: 'o README existe', verificar: ['test -s README.md'] });
    adicionarClaim(p.dir, pendente.id, { arquivo: 'README.md', alegacao: 'o README diz projeto', verificar: ['grep -q projeto README.md'] });
    retirarClaim(p.dir, pendente.id, 'C2', 'retirada no teste');
    const { claims, retiradas } = ritual().claimsDaProva(JSON.parse(JSON.stringify(listarClaimsMcp(p.dir, pendente.id))));
    assert.deepEqual(claims.map((c: { id: string; comandos: string[] }) => [c.id, c.comandos]), [['C1', ['test -s README.md']]]);
    assert.equal(retiradas, 1);
  } finally { p.limpar(); }
});

test('nota: os argumentos do botao so com o threadId, o argv da reserva, a leitura do resultado e a autoridade da ponte', () => {
  const n = nota();
  assert.deepEqual(n.argsDaNota('ork-a'), { threadId: 'ork-a' });
  assert.deepEqual(Object.keys(n.argsDaNota('ork-a')), ['threadId']);
  assert.deepEqual(n.argvDaReserva('ork-a'), ['ork', 'master', 'pedir', 'ork-a', '--formato', 'json']);
  for (const ruim of ['../x', '--score', '', 'a b']) {
    assert.throws(() => n.argsDaNota(ruim), /id de thread invalido/, ruim);
    assert.throws(() => n.argvDaReserva(ruim), /id de thread invalido/, ruim);
  }
  assert.equal(n.FERRAMENTA_DA_NOTA, 'ork_request_master_note');
  assert.ok(n.PRAZO_DA_NOTA_MS > 300000, 'o botao espera mais que o dialogo do nucleo');
  assert.deepEqual(n.resultadoDaNota({ ok: true, estado: 'registrada', repetida: false, score: 3 }, 'ork-a', 7),
    { estado: 'registrada', texto: 'nota 3/5 da ork-a registrada pelo diálogo nativo', em: 7 });
  assert.equal(n.resultadoDaNota({ ok: true, estado: 'registrada', repetida: true, score: 5 }, 'ork-a', 7).estado, 'repetida');
  assert.equal(n.resultadoDaNota({ ok: false, estado: 'pendente' }, 'ork-a', 7).estado, 'pendente');
  assert.equal(n.resultadoDaNota(null, 'ork-a', 7).estado, 'pendente');
  assert.equal(n.notaDoErro(new Error('master.nota.sem-dialogo: x'), 1).estado, 'sem-dialogo');
  assert.equal(n.notaDoErro(new Error('mcp.tool.unknown'), 1).estado, 'sem-dialogo');
  assert.equal(n.notaDoErro(new Error('hitl.local.chave-invalida'), 1).estado, 'erro');
  assert.equal(n.pedeReserva({ estado: 'sem-dialogo' }), true);
  assert.equal(n.pedeReserva({ estado: 'erro' }), true);
  for (const estado of ['abrindo', 'registrada', 'repetida', 'pendente']) assert.equal(n.pedeReserva({ estado }), false, estado);
  assert.equal(n.pedeReserva(undefined), false);
  assert.deepEqual(n.soltarAbrindo({ a: { estado: 'abrindo', texto: '', em: 1 }, b: { estado: 'registrada', texto: 'x', em: 2 } }).a.estado, 'pendente');
  const pronta = n.lerReserva({ exitCode: 0, stdout: JSON.stringify({ contrato: 'ork.master-nota/v1', thread: 'ork-a', codigo: 'K7QX' }), stderr: '' }, 'ork-a', 3);
  assert.deepEqual(pronta, { estado: 'pronta', texto: 'pelo Telegram, responda: K7QX <0 a 5> <porquê>', codigo: 'K7QX', em: 3 });
  assert.equal(n.lerReserva({ exitCode: 0, stdout: JSON.stringify({ contrato: 'ork.master-nota/v1', thread: 'ork-b', codigo: 'K7QX' }), stderr: '' }, 'ork-a', 3).estado, 'erro');
  assert.equal(n.lerReserva({ exitCode: 1, stdout: '', stderr: 'linha 1\nMASTER exige entrega' }, 'ork-a', 3).texto, 'o pedido pelo Telegram falhou: linha 1 MASTER exige entrega');
  // A guarda da ponte (a mesma lista que ela aplica em tempo de execucao) deixa passar o pedido e barra a nota no argv.
  const { carregarModuloDoMod } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
  const guarda = carregarModuloDoMod(path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte/hooks/guarda.ts'), raizDoRepo);
  const autoridade = guarda.lerAutoridade(fs.readFileSync(path.join(raizDoRepo, 'adapters/claude-code/mods/autoridade.json'), 'utf8'));
  assert.equal(guarda.avaliarArgv(autoridade, n.argvDaReserva('ork-a')), null);
  assert.notEqual(guarda.avaliarArgv(autoridade, ['ork', 'master', 'ork-a', '--score', '4', '--justificativa', 'pelo mod']), null);
});

test('o Ritual casa com a ferramenta da nota e com o ork master pedir de verdade do nucleo', async () => {
  const p = projetoTemporario('ork-ritual-nota');
  try {
    const t = entregue(p, 'nota');
    aceitarPorOmissao(p.dir, t.id);
    const n = nota(), r = ritual();
    // O pedido pelo Telegram: a saida real do `ork master pedir --formato json` vira o codigo no cartao.
    const env = { ...process.env };
    for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO', 'CLAUDECODE']) delete env[nome];
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/index.js'), ...n.argvDaReserva(t.id).slice(1)], { cwd: p.dir, env, encoding: 'utf8' });
    const reserva = n.lerReserva({ exitCode: cli.status ?? 1, stdout: cli.stdout, stderr: cli.stderr }, t.id, 1);
    assert.equal(reserva.estado, 'pronta', `${cli.stdout}\n${cli.stderr}`);
    assert.match(reserva.texto, /^pelo Telegram, responda: [0-9A-Za-z]{3,8} <0 a 5> <porquê>$/);
    // O "Dar a nota": sem formulario no cliente, o erro real vira a reserva; com o formulario, a resposta real vira a nota registrada.
    const chamar = async (formulario: boolean) => {
      const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code' });
      const client = new Client({ name: 'cliente-sintetico-do-ritual', version: '1' }, formulario ? { capabilities: { elicitation: { form: {} } } } : {});
      if (formulario) client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept' as const, content: { nota: '4', porque: 'entregou com prova' } }));
      const [ct, st] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(st);
        await client.connect(ct);
        return await client.callTool({ name: n.FERRAMENTA_DA_NOTA, arguments: n.argsDaNota(t.id) });
      } finally { await client.close(); await server.close(); }
    };
    let semDialogo: unknown;
    try { r.jsonDoMcp(await chamar(false)); } catch (erro) { semDialogo = erro; }
    assert.equal(n.notaDoErro(semDialogo, 1).estado, 'sem-dialogo');
    const feita = n.resultadoDaNota(r.jsonDoMcp(await chamar(true)), t.id, 2);
    assert.deepEqual(feita, { estado: 'registrada', texto: `nota 4/5 da ${t.id} registrada pelo diálogo nativo`, em: 2 });
    // Depois da nota, o retrato do nucleo tira a entrega da lista do Ritual.
    const pagina = r.paginaDoMaster({ retrato: maestroSnapshot(discoverMaestro({ cwd: p.dir })) });
    assert.deepEqual(r.entregasDaJanela(pagina.itens, Date.now()).entregas, []);
  } finally { p.limpar(); }
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

test('o Ritual so chama no $ a lista fechada, le as entregas so pelo retrato e chama do nucleo so a lista fechada de ferramentas', () => {
  const fontes = fontesDoMod(RITUAL);
  assert.ok(fontes.some((f) => f.endsWith('hooks/register.tsx')));
  const vistas = new Set<string>();
  const ferramentas = new Set<string>();
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
      if (chamada === 'mcp.call') {
        const [servidor, ferramenta, args] = c.no.arguments;
        assert.ok(servidor && ts.isIdentifier(servidor) && servidor.text === 'SERVIDOR', `servidor que nao e o do nucleo: ${onde}`);
        assert.ok(ferramenta && ts.isStringLiteral(ferramenta) && Object.hasOwn(LISTA_FECHADA_DO_MCP, ferramenta.text),
          `ferramenta fora da lista fechada: ${onde}: ${ferramenta?.getText(fonte)}`);
        const construtor = LISTA_FECHADA_DO_MCP[(ferramenta as ts.StringLiteral).text];
        // Os argumentos saem so do construtor da ferramenta: o do botao da nota leva o threadId e nada mais.
        assert.ok(args && ts.isCallExpression(args) && ts.isIdentifier(args.expression) && args.expression.text === construtor,
          `argumentos que nao saem de ${construtor}: ${onde}: ${args?.getText(fonte)}`);
        ferramentas.add((ferramenta as ts.StringLiteral).text);
      }
      if (chamada === 'process.run') {
        processos++;
        const argv = c.no.arguments[0];
        assert.ok(argv && ts.isCallExpression(argv) && ts.isIdentifier(argv.expression) && CONSTRUTORES_DE_ARGV.includes(argv.expression.text),
          `argv que nao sai de um construtor: ${onde}: ${argv?.getText(fonte)}`);
      }
    }
    const texto = fs.readFileSync(arquivo, 'utf8');
    assert.doesNotMatch(texto, /'(git|gh)'/, `${path.relative(raizDoRepo, arquivo)} cita git ou gh como argv`);
    assert.doesNotMatch(texto, /--score/, `${path.relative(raizDoRepo, arquivo)} cita a nota no argv do ork master`);
    assert.doesNotMatch(texto, /\.orkastery\/threads\/[^\\]*['`]\s*\)/, `${path.relative(raizDoRepo, arquivo)} monta caminho de estado para ler`);
  }
  assert.deepEqual([...ferramentas].sort(), Object.keys(LISTA_FECHADA_DO_MCP).sort());
  assert.equal(processos, 1, `process.run achados: ${processos}`);
  for (const esperada of ['ork.papel', 'ork.faixa', 'ork.retrato', 'ork.mostrado', 'command.register', 'clock.every', 'ui.open', 'mcp.call', 'process.run']) {
    assert.ok(vistas.has(esperada), esperada);
  }
  assert.ok(!vistas.has('ork.ler'), 'as entregas saem do retrato, nao de consulta do CLI');
});

test('a guarda estatica dos mods aprova o Ritual', () => {
  const r = spawnSync(process.execPath, [path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'), RITUAL], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ok ork-ritual/);
});
