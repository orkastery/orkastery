import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { classificarDecisao, exigirSelecaoDeConducao, validarPedidoHitlV2 } from '../src/hitl-contract';
import { criarServidorMcp } from '../src/mcp-server';
import { decisoesParaODono } from '../src/decisao-autonoma';
import { lerLedger } from '../src/ledger';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

// RM-059 (fatia F5): a Mesa do Dono (`ork-mesa`) testada sem o Claude Code. O sandbox do `ork verify` e o runner do
// CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros da Mesa com o compilador do `core` e os
// roda num escopo proprio, como os testes da ponte, da Torre e do Clima. O teste da obvia e cruzado com o
// `classificarDecisao` do nucleo; a decisao obvia passa pelo `ork_decision_record` de um servidor MCP de verdade, em
// memoria, e volta pelo `decisoesParaODono` do pulse; o fonte e varrido pela AST: a Mesa le o nucleo pela ponte e
// por tres ferramentas MCP, e o Decidir leva so os dois ids.
const raizDoRepo = path.resolve(__dirname, '../../..');
const MESA = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-mesa');
const MODULOS_PUROS = ['hooks/fila.ts', 'hooks/obvia.ts', 'hooks/decidir.ts', 'hooks/cartoes.tsx', 'test/apoio.ts'];
/** D2 e D7: as unicas ferramentas do nucleo que a Mesa chama direto, no servidor `orkastery`. */
const LISTA_FECHADA_DO_MCP = ['ork_hitl_pending', 'ork_request_decision', 'ork_decision_record'];
const NOUNS_PROIBIDOS = ['process', 'fs', 'store', 'env', 'prompt', 'session'];
/** Tudo que a Mesa chama direto no `$`; o estado passa pelo `read` e pelo `update` do motor. */
const CHAMADAS_PERMITIDAS = ['ork.papel', 'ork.retrato', 'ork.ler', 'ork.faixa', 'ork.mostrado', 'ork.mostrados', 'command.register',
  'clock.now', 'clock.after', 'clock.every', 'ui.open', 'ui.panes', 'ui.resolve', 'ui.toast', 'ui.notify', 'mcp.call'];
const EPOCA = 1760000000000;

type No = { tipo: string; props: Record<string, unknown>; filhos: unknown[] };
(globalThis as unknown as { h: unknown }).h = (tipo: string, props: Record<string, unknown> | null, ...filhos: unknown[]): No =>
  ({ tipo, props: props ?? {}, filhos: filhos.flat(Infinity) });

const modulos = new Map<string, Record<string, any>>();
function resolver(base: string): string {
  for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error(`modulo da Mesa nao encontrado: ${base}`);
}
/** Transpila e roda um modulo puro da Mesa; o `require` so resolve outro modulo puro da propria Mesa. */
function carregar(rel: string): Record<string, any> {
  const arquivo = resolver(path.join(MESA, rel));
  const pronto = modulos.get(arquivo);
  if (pronto) return pronto;
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  });
  const modulo = { exports: {} as Record<string, any> };
  modulos.set(arquivo, modulo.exports);
  const exigir = (id: string) => {
    const alvo = path.relative(MESA, path.join(path.dirname(arquivo), id));
    if (!id.startsWith('./') || !MODULOS_PUROS.includes(path.relative(MESA, resolver(path.join(MESA, alvo))))) {
      throw new Error(`modulo puro da Mesa nao importa valor de fora dela: ${id}`);
    }
    return carregar(alvo);
  };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(MESA, rel), 'utf8'));
const fila = () => carregar('hooks/fila.ts');
const obvia = () => carregar('hooks/obvia.ts');
const decidir = () => carregar('hooks/decidir.ts');
const cartoes = () => carregar('hooks/cartoes.tsx');
const apoio = () => carregar('test/apoio.ts');

/** A pergunta da Mesa a partir de um pedido do kit, conferida como se o `ork_hitl_pending` a trouxesse. */
function perguntaDe(pedido: unknown, canal = 'disponivel') {
  const f = fila();
  const base = f.perguntaDoPedido(pedido, { desdeEm: null, reserva: null });
  assert.ok(base, 'o pedido do kit vira pergunta');
  const p = pedido as { id: string; thread: string };
  return f.conferirNoNucleo(base, apoio().pendentesDe(p.thread, [pedido], canal));
}

/** Os textos de uma arvore desenhada com o `h` deste teste, um por `Text` e um por `Button` (o rotulo). */
function textos(no: unknown): string[] {
  if (!no || typeof no !== 'object') return [];
  const n = no as No;
  const proprios = () => n.filhos.filter((f) => typeof f === 'string' || typeof f === 'number').join('');
  if (n.tipo === 'Text') return [proprios()];
  if (n.tipo === 'Button') return [typeof n.props.label === 'string' ? n.props.label : proprios()];
  return n.filhos.flatMap(textos);
}

test('manifesto da Mesa: nome, contrato, so a ponte como dependencia e nenhuma chave fora do formato', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-mesa');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  for (const chave of ['formato', 'papeis', 'claudeCodeMinimo', 'orkastery']) assert.equal(chave in m, false, chave);
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono'], claudeCodeMinimo: '2.1.287' });
  const h = lerJson('hooks/hooks.json');
  assert.deepEqual(h.modules, ['./register.tsx']);
  assert.ok(fs.existsSync(path.join(MESA, 'hooks/register.tsx')));
});

test('o contrato declara o estado da Mesa sem import nem referencia, e nada nele guarda a resposta do dono', () => {
  const tipos = fs.readFileSync(path.join(MESA, 'types/index.d.ts'), 'utf8');
  assert.ok(!/^import /m.test(tipos) && !tipos.includes('/// <reference'));
  for (const chave of ["'ork-mesa': {", 'fila: MesaFila', 'foco: string | null', 'pagina: number',
    'decidindo: Record<string, MesaDecidindo>', 'obvias: Record<string, MesaObvia>']) assert.ok(tipos.includes(chave), chave);
  // Nenhum campo do estado guarda opcao, letra, resposta ou escolha do dono (os comentarios podem dizer isso).
  const codigo = tipos.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join('\n');
  assert.ok(!/\b(opcao|letra|resposta|escolha)\??\s*:/.test(codigo), codigo);
});

test('os pedidos do kit sao pedidos validos do nucleo: ork.hitl/v2 de 3 a 5 alternativas com uma recomendada', () => {
  const a = apoio();
  for (const pedido of [a.PEDIDO_4, a.PEDIDO_OBVIO]) {
    validarPedidoHitlV2(pedido);
    exigirSelecaoDeConducao(pedido);
  }
  assert.equal(a.PEDIDO_4.alternativas.length, 4);
  assert.equal(a.PEDIDO_OBVIO.acaoPadraoAoExpirar, 'seguir-recomendada');
});

test('fila: o pedido vira pergunta com a recomendada, a decisao informada nao e pergunta, e id ruim nao entra', () => {
  const f = fila();
  const a = apoio();
  const p = perguntaDe(a.PEDIDO_4);
  assert.equal(p.pedidoId, a.PEDIDO_4.id);
  assert.equal(p.recomendacao, 'c) Pedir o GO-FIX das claims velhas');
  assert.deepEqual(p.alternativas.map((x: { chave: string }) => x.chave), ['a', 'b', 'c', 'd']);
  assert.equal(p.canalClaudeCode, 'disponivel');
  assert.equal(p.prazoLocal, '12/10 14:46 (horário de Brasília)');
  assert.equal(p.reserva, 'K7Q2 c');
  assert.equal(perguntaDe(a.PEDIDO_4, 'indisponivel').canalClaudeCode, 'indisponivel');
  assert.equal(f.perguntaDoPedido({ ...a.PEDIDO_4, classe: 'decidido' }), null);
  assert.equal(f.perguntaDoPedido({ ...a.PEDIDO_4, thread: '../fora' }), null);
  assert.equal(f.conferirNoNucleo(p, { pendencias: [] }), null, 'pedido que o nucleo nao lista mais sai da fila');
  const v1 = f.perguntaDoPedido({ contrato: 'ork.hitl/v1', id: 'v1-1', thread: 'ork-a', fase: 'GO', alvo: { tipo: 'session', sessionId: 's1', runtime: 'claude-bg' },
    motivo: 'hitl.pergunta', pergunta: 'Qual pasta?', opcoes: [{ numero: 1, texto: 'a', acao: 'responder' }], recomendacao: 'a primeira' });
  assert.equal(v1.contrato, 'ork.hitl/v1');
  assert.equal(v1.recomendacao, 'a primeira');
  assert.deepEqual(v1.alternativas.map((x: { chave: string }) => x.chave), ['1']);
});

test('fila do pulse: perguntas, paradas, decisoes novas so das ultimas 24 h e nao vistas, nova primeiro; score fica de fora', () => {
  const f = fila();
  const a = apoio();
  const decisoes = [a.decisaoDe({ id: 'd1', thread: 'ork-a', minutos: 30 }), a.decisaoDe({ id: 'd2', thread: 'ork-c', minutos: 90 }),
    a.decisaoDe({ id: 'd3', thread: 'ork-c', minutos: 2000 })];
  const pulse = a.pulseCom({ pedidos: [a.PEDIDO_4], outros: [a.PARADA, { id: 'score:x', classe: 'score_pendente', motivo: 'master.score-pendente' }], decisoes });
  const r = f.filaDoPulse(pulse, new Set(['d1']), EPOCA);
  assert.deepEqual(r.perguntas.map((p: { pedidoId: string }) => p.pedidoId), [a.PEDIDO_4.id]);
  assert.deepEqual(r.outros.map((o: { motivo: string }) => o.motivo), ['claims.failed']);
  assert.deepEqual(r.decisoes.map((d: { id: string; nova: boolean }) => [d.id, d.nova]), [['d2', true], ['d1', false], ['d3', false]]);
  assert.equal(r.totalDeDecisoes, 3);
  assert.deepEqual([...f.decisoesVistas({ itens: [{ mod: 'ork-mesa', chave: 'decisao:d9' }, { mod: 'ork-torre', chave: 'decisao:d8' }] })], ['d9']);
});

test('retrato: a assinatura muda quando um pedido abre ou muda de estado, e so por isso', () => {
  const f = fila();
  const a = apoio();
  const vazio = f.assinaturaDoRetrato(a.retratoHitl([]));
  const um = f.assinaturaDoRetrato(a.retratoHitl(['p1']));
  assert.notEqual(vazio, um);
  assert.equal(um, f.assinaturaDoRetrato(a.retratoHitl(['p1'])));
  const mudou = a.retratoHitl(['p1']);
  mudou.sections.hitl.items[0].status = 'esperar';
  assert.notEqual(f.assinaturaDoRetrato(mudou), um);
  assert.equal(f.assinaturaDoRetrato(null), '');
});

test('faixa: quem espera (com a thread), paradas e decisoes novas; sem nada a linha sai; a obvia registrada nao espera o dono', () => {
  const f = fila();
  const a = apoio();
  const p = perguntaDe(a.PEDIDO_4);
  const base = { perguntas: [p], outros: [], decisoes: [], totalDeDecisoes: 0, lidoEm: EPOCA, erro: null, avisos: [] };
  assert.equal(f.textoDaFaixa(base, {}), 'mesa: 1 espera você (ork-a)');
  assert.equal(f.textoDaFaixa({ ...base, lidoEm: null }, {}), undefined);
  assert.equal(f.textoDaFaixa({ ...base, perguntas: [] }, {}), undefined);
  assert.equal(f.textoDaFaixa(base, { [p.pedidoId]: { estado: 'registrada', texto: '', em: 0 } }), undefined);
  assert.equal(f.textoDaFaixa(base, { [p.pedidoId]: { estado: 'recusada', texto: '', em: 0 } }), 'mesa: 1 espera você (ork-a)');
  const decisao = { id: 'd', thread: 'ork-a', fase: 'GO', em: '', decidido: '', porque: '', comoMudar: '', custoAgora: '', custoDepois: '', quemDecidiu: '', nova: true };
  assert.equal(f.textoDaFaixa({ ...base, perguntas: [p, { ...p, pedidoId: 'outro' }], outros: [{}], decisoes: [decisao, decisao] }, {}),
    'mesa: 2 esperam você (ork-a) · 1 parada · 2 decididas por você');
});

test('jsonDoMcp: o JSON do primeiro texto, o erro do nucleo com o motivo, e texto que nao e JSON vira erro', () => {
  const f = fila();
  assert.deepEqual(f.jsonDoMcp({ content: [{ type: 'text', text: '{"a":1}' }], isError: false }), { a: 1 });
  assert.throws(() => f.jsonDoMcp({ content: [{ type: 'text', text: '{"erro":"lease.busy: x"}' }], isError: true }), /lease\.busy: x/);
  assert.throws(() => f.jsonDoMcp({ content: [{ type: 'text', text: 'nao' }], isError: false }), /nao e JSON/);
  assert.throws(() => f.jsonDoMcp({ content: [], isError: false }), /nao devolveu texto/);
});

test('obvia: o pedido que declara seguir-recomendada passa nas quatro; cada porta e cada condicao falham sozinhas', () => {
  const o = obvia();
  const a = apoio();
  const certa = perguntaDe(a.PEDIDO_OBVIO);
  const r = o.testeDaObvia(certa, EPOCA);
  assert.equal(r.obvia, true);
  assert.equal(r.alternativa.chave, 'a');
  assert.equal(r.referencia, 'ork pulse --json: o pedido B2X9 da ork-b declara acaoPadraoAoExpirar seguir-recomendada, sem ato irreversível');
  const casos: Array<[string, Record<string, unknown>]> = [
    ['irreversivel', { irreversivel: true, ato: 'push-base-protegida' }],
    ['dinheiro', { motivo: 'cost.violation' }],
    ['escopo', { motivo: 'policy.violation' }],
    ['criterio', { acaoAoExpirar: 'esperar' }],
    ['criterio', { contrato: 'ork.hitl/v1' }],
    ['alternativas', { alternativas: certa.alternativas.map((x: Record<string, unknown>) => ({ ...x, recomendada: true })) }],
    ['alternativas', { alternativas: certa.alternativas.slice(0, 1) }],
    ['reversivel', { fase: 'SHIP' }],
    ['reversivel', { fase: 'MASTER' }],
    ['barato', { alvo: 'session' }],
    ['barato', { tipoDeResposta: 'aberta' }],
    ['barato', { dependenciaTecnica: true }],
    ['barato', { motivo: 'hitl.credencial' }],
    ['barato', { estado: 'esperar' }],
    ['barato', { prazo: new Date(EPOCA - 1000).toISOString() }],
  ];
  for (const [condicao, mudanca] of casos) {
    const t = o.testeDaObvia({ ...certa, ...mudanca }, EPOCA);
    assert.equal(t.obvia, false, JSON.stringify(mudanca));
    assert.equal(t.falhou[0], condicao, JSON.stringify(mudanca));
    assert.ok(o.FALHA_DA_CONDICAO[condicao], condicao);
  }
  assert.equal(o.testeDaObvia(perguntaDe(a.PEDIDO_4), EPOCA).obvia, false, 'o gate que espera o dono nunca e obvio');
});

test('obvia: a classe sai igual a do classificarDecisao do nucleo para os mesmos sinais', () => {
  const o = obvia();
  const a = apoio();
  const certa = perguntaDe(a.PEDIDO_OBVIO);
  const variacoes: Array<Record<string, unknown>> = [{}, { irreversivel: true }, { ato: 'dinheiro' }, { motivo: 'cost.violation' },
    { motivo: 'policy.violation' }, { acaoAoExpirar: 'esperar' }, { fase: 'SHIP' }, { alvo: 'session' }, { estado: 'escalar' },
    { prazo: null }, { alternativas: [] }];
  for (const v of variacoes) {
    const p = { ...certa, ...v };
    const doNucleo = classificarDecisao(o.sinaisDaPergunta(p, EPOCA));
    assert.equal(doNucleo.classe === 'decidido', o.testeDaObvia(p, EPOCA).obvia, JSON.stringify(v));
  }
});

test('Decidir: os argumentos sao so threadId e pedidoId; a marca do pedido acha a decisao da Mesa no pulse', () => {
  const d = decidir();
  const args = d.argsDoDecidir({ thread: 'ork-a', pedidoId: 'p1', pergunta: 'x', alternativas: [{ chave: 'a' }] });
  assert.deepEqual(args, { threadId: 'ork-a', pedidoId: 'p1' });
  assert.deepEqual(d.FERRAMENTAS_DA_MESA, LISTA_FECHADA_DO_MCP);
  assert.equal(d.marcaDoPedido('ob000000-0000-4000-8000-000000000002'), '(ob000000)');
  const da = { thread: 'ork-b', pedidoId: 'ob000000-0000-4000-8000-000000000002' };
  const decisao = { thread: 'ork-b', quemDecidiu: d.QUEM_DECIDIU, decidido: 'Sem te chamar: o pedido B2X9 (ob000000) da ork-b segue' };
  assert.equal(d.jaDecidida([decisao], da), true);
  assert.equal(d.jaDecidida([{ ...decisao, quemDecidiu: 'sessão de fase' }], da), false, 'so a decisao da propria Mesa conta');
  assert.equal(d.jaDecidida([{ ...decisao, thread: 'ork-x' }], da), false);
  assert.deepEqual(d.resultadoDoDecidir({ ok: true, estado: 'aprovado', repetida: true }, 5), { estado: 'respondido', texto: 'respondido pelo diálogo: aprovado (já estava respondido)', em: 5 });
  assert.equal(d.resultadoDoDecidir({ ok: false, estado: 'pendente' }, 5).estado, 'sem-resposta');
});

test('decisao obvia: o ork_decision_record de um servidor MCP de verdade aceita os argumentos da Mesa, e o pulse a traz de volta', async () => {
  const d = decidir();
  const o = obvia();
  const a = apoio();
  const certa = perguntaDe(a.PEDIDO_OBVIO);
  const teste = o.testeDaObvia(certa, EPOCA);
  assert.equal(teste.obvia, true);
  const p = projetoTemporario('ork-mesa-obvia');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'mesa obvia', modo: 'classic' });
    thread.faseAtual = 'GO';
    gravarThread(p.dir, thread);
    const args = d.argsDaDecisaoObvia({ ...certa, thread: thread.id }, teste.alternativa, teste.referencia, new Date(EPOCA).toISOString());
    assert.deepEqual(Object.keys(args).sort(), ['comoMudar', 'criterio', 'custoAgora', 'custoDepois', 'decidido', 'evidencia', 'porque', 'quemDecidiu', 'threadId']);
    for (const campo of ['decidido', 'porque', 'comoMudar']) assert.ok(args[campo].length <= 200 && !/[\r\n]/.test(args[campo]), campo);
    for (const campo of ['custoAgora', 'custoDepois']) assert.ok(args[campo].length <= 140, campo);
    const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code' });
    const client = new Client({ name: 'cliente-da-mesa-no-teste', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      const r = await client.callTool({ name: 'ork_decision_record', arguments: args });
      const texto = (r.content as Array<{ text?: string }>)[0]?.text ?? '';
      assert.equal(r.isError === true, false, texto);
      assert.equal(JSON.parse(texto).ok, true);
    } finally {
      await client.close();
      await server.close();
    }
    const evento = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'autonomous_decision').at(-1);
    assert.equal(evento?.quemDecidiu, d.QUEM_DECIDIU);
    assert.equal((evento?.pedido as { classe?: string } | undefined)?.classe, 'decidido');
    // O resumo do dono traz a decisao, e a Mesa a reconhece pela marca: nao registra de novo.
    const { decisoes } = decisoesParaODono(p.dir, '2000-01-01T00:00:00.000Z');
    const daMesa = fila().filaDoPulse({ decisoes }, new Set(), Date.now()).decisoes;
    assert.equal(d.jaDecidida(daMesa, { thread: thread.id, pedidoId: certa.pedidoId }), true);
  } finally {
    p.limpar();
  }
});

test('o quemDecidiu da Mesa passa na regra do nucleo que recusa rastro assinado pelo dono', () => {
  const servidor = fs.readFileSync(path.join(raizDoRepo, 'core/src/mcp-server.ts'), 'utf8');
  const m = /if\(\/(.+?)\/i\.test\(e\.quemDecidiu\)\)/.exec(servidor);
  assert.ok(m, 'a regra do quemDecidiu esta no ork_decision_record');
  const regra = new RegExp(m![1], 'i');
  assert.equal(regra.test('o dono'), true, 'a regra recusa o dono');
  assert.equal(regra.test(decidir().QUEM_DECIDIU), false);
});

test('cartoes: a recomendada vem primeiro, com o porque; a obvia registrada diz o que foi decidido; Decidir so com o canal', () => {
  const c = cartoes();
  const a = apoio();
  const p = perguntaDe(a.PEDIDO_4);
  const vazio = { fila: { perguntas: [p], outros: [], decisoes: [], totalDeDecisoes: 0, lidoEm: EPOCA, erro: null, avisos: [] }, foco: null, pagina: 0, decidindo: {}, obvias: {} };
  const linhas = c.linhasDaPergunta(p, vazio, EPOCA).map((l: { texto: string }) => l.texto);
  const i = linhas.findIndex((t: string) => t.startsWith('  Recomendada:'));
  assert.equal(linhas[i], '  Recomendada: c) Pedir o GO-FIX das claims velhas');
  assert.ok(linhas.findIndex((t: string) => t.startsWith('  a) ')) > i, 'as outras alternativas vem depois da recomendada');
  assert.ok(linhas.includes('Decidir'));
  assert.ok(!c.linhasDaPergunta({ ...p, canalClaudeCode: 'indisponivel' }, vazio, EPOCA).some((l: { tipo: string }) => l.tipo === 'decidir'));
  const comObvia = { ...vazio, obvias: { [p.pedidoId]: { estado: 'registrada', texto: '', em: 0 } } };
  const decidida = c.linhasDaPergunta(p, comObvia, EPOCA).map((l: { texto: string }) => l.texto);
  assert.ok(decidida[0].startsWith('✓ '));
  assert.ok(decidida.includes('  decidido por você: segue a recomendada no prazo, sem te chamar; para mudar, Decidir'));
  const abrindo = { ...vazio, decidindo: { [p.pedidoId]: { estado: 'abrindo', texto: '', em: 0 } } };
  assert.ok(!c.linhasDaPergunta(p, abrindo, EPOCA).some((l: { tipo: string }) => l.tipo === 'decidir'), 'um Decidir por vez');
  const arvore = c.desenharMesa({ Box: 'Box', Text: 'Text', Button: 'Button' }, c.linhasDaMesa(vazio, { agora: EPOCA }), {});
  const desenhados = textos(arvore);
  assert.equal(desenhados[0], '1 espera você (a mais antiga há 14 min) · 0 decididas por você · 0 paradas · lido há 0 s');
  assert.ok(desenhados.includes('Atualizar') && desenhados.includes('Decidir'));
});

test('cartoes: so o que esta na janela de rolagem vai ao registro; lotes de cinco', () => {
  const c = cartoes();
  const linhas = [{ tipo: 'titulo', chave: 't', texto: 't' }, { tipo: 'cabecalho', chave: 'a', texto: 'a', mostrado: { chave: 'hitl:a', thread: 'x', texto: 'a' } },
    { tipo: 'cabecalho', chave: 'b', texto: 'b', mostrado: { chave: 'hitl:b', thread: 'x', texto: 'b' } }];
  assert.deepEqual(c.mostradosVisiveis(linhas, { offset: 0, bodyRows: 2 }).map((m: { chave: string }) => m.chave), ['hitl:a']);
  assert.deepEqual(c.mostradosVisiveis(linhas, { offset: 2, bodyRows: 5 }).map((m: { chave: string }) => m.chave), ['hitl:b']);
  assert.deepEqual(c.mostradosVisiveis(linhas, undefined), []);
  assert.deepEqual(c.paginaDoLote(7, 5), { pagina: 1, paginas: 2 });
  assert.deepEqual(c.paginaDoLote(0, 3), { pagina: 0, paginas: 1 });
  assert.deepEqual(c.paginaDoLote(11, -2), { pagina: 0, paginas: 3 });
});

/** As chamadas `x.noun.metodo(...)` de um fonte, com os literais de texto e a forma do terceiro argumento. */
function chamadasDoFonte(arquivo: string) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2022, true, /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const saida: Array<{ cadeia: string[]; literais: Array<string | null>; terceiro: string | null; linha: number }> = [];
  const visitar = (no: ts.Node) => {
    if (ts.isCallExpression(no)) {
      const cadeia: string[] = [];
      let e: ts.Expression = no.expression;
      while (ts.isPropertyAccessExpression(e)) { cadeia.unshift(e.name.text); e = e.expression; }
      if (ts.isIdentifier(e)) cadeia.unshift(e.text);
      const literais = no.arguments.map((a) => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : null));
      const t = no.arguments[2];
      const terceiro = !t ? null : ts.isCallExpression(t) && ts.isIdentifier(t.expression) ? `chamada:${t.expression.text}`
        : ts.isIdentifier(t) ? `nome:${t.text}` : ts.isObjectLiteralExpression(t)
          ? `objeto:${t.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : '?')).join(',')}` : 'outro';
      saida.push({ cadeia, literais, terceiro, linha: fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1 });
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

test('D2 e D7: a Mesa so chama no $ uma lista fechada; o MCP so as tres ferramentas; o Decidir leva so os dois ids', () => {
  const fontes = fontesDoMod(MESA);
  assert.ok(fontes.some((f) => f.endsWith('hooks/register.tsx')));
  const vistas = new Set<string>();
  const ferramentas: Record<string, string[]> = {};
  for (const arquivo of fontes) {
    for (const c of chamadasDoFonte(arquivo)) {
      const onde = `${path.relative(raizDoRepo, arquivo)}:${c.linha} ${c.cadeia.join('.')}`;
      assert.ok(!c.cadeia.slice(1, -1).some((n) => NOUNS_PROIBIDOS.includes(n)), `chamada proibida: ${onde}`);
      if (c.cadeia[0] === '$') {
        const chamada = c.cadeia.slice(1).join('.');
        assert.ok(CHAMADAS_PERMITIDAS.includes(chamada), `chamada fora da lista fechada do $: ${onde}`);
        vistas.add(chamada);
      }
      if (c.cadeia.slice(-2).join('.') === 'mcp.call') {
        assert.equal(c.literais[0], 'orkastery', `servidor nao literal ou outro: ${onde}`);
        const ferramenta = c.literais[1];
        assert.ok(ferramenta !== null && LISTA_FECHADA_DO_MCP.includes(ferramenta), `ferramenta fora da lista fechada: ${onde}`);
        (ferramentas[ferramenta] ??= []).push(String(c.terceiro));
      }
    }
  }
  assert.deepEqual(Object.keys(ferramentas).sort(), [...LISTA_FECHADA_DO_MCP].sort());
  assert.deepEqual(ferramentas.ork_request_decision, ['chamada:argsDoDecidir'], 'o Decidir monta os argumentos so pelo argsDoDecidir');
  assert.deepEqual(ferramentas.ork_hitl_pending, ['objeto:threadId']);
  assert.deepEqual(ferramentas.ork_decision_record, ['nome:args']);
  const registro = fs.readFileSync(path.join(MESA, 'hooks/register.tsx'), 'utf8');
  assert.ok(registro.includes('const args = argsDaDecisaoObvia('), 'a decisao obvia monta os argumentos so pelo argsDaDecisaoObvia');
  for (const chamada of ['ork.retrato', 'ork.ler', 'ork.faixa', 'ork.mostrado', 'ui.notify', 'mcp.call']) assert.ok(vistas.has(chamada), chamada);
});

test('D7: cada ferramenta da lista fechada existe no servidor; so a de leitura e readOnly e o Decidir aceita so os dois ids', () => {
  const servidor = fs.readFileSync(path.join(raizDoRepo, 'core/src/mcp-server.ts'), 'utf8');
  const registro = (ferramenta: string) => {
    const i = servidor.indexOf(`registrarTool('${ferramenta}',`);
    assert.ok(i >= 0, `${ferramenta} registrada no servidor MCP`);
    const j = servidor.indexOf('registrarTool(', i + 1);
    return servidor.slice(i, j < 0 ? undefined : j);
  };
  assert.match(registro('ork_hitl_pending'), /annotations:\{readOnlyHint:true/);
  assert.match(registro('ork_request_decision'), /inputSchema:daDecisao/);
  assert.match(servidor, /const daDecisao = daThread\.extend\(\{ pedidoId: identidade \}\)\.strict\(\);/);
  assert.match(registro('ork_decision_record'), /quemDecidiu e a sessao que decidiu, nunca o dono/);
});

test('o modulo de ganchos nao le disco, ambiente nem processo, e nenhum modulo puro importa valor de fora', () => {
  for (const rel of MODULOS_PUROS) assert.ok(carregar(rel), rel);
  const registro = fs.readFileSync(path.join(MESA, 'hooks/register.tsx'), 'utf8');
  assert.ok(!/\$\.(fs|env|process|store|prompt|session)\./.test(registro));
  for (const rel of ['hooks/fila.ts', 'hooks/obvia.ts', 'hooks/decidir.ts', 'hooks/cartoes.tsx']) {
    const fonte = fs.readFileSync(path.join(MESA, rel), 'utf8');
    assert.ok(!/from 'claude-code'/.test(fonte), `${rel} nao importa o motor`);
  }
});

test('os testes do kit cobrem terminal e desktop, a obvia, a pergunta e o caso negativo', () => {
  const cartoesDoKit = fs.readFileSync(path.join(MESA, 'test/cartoes.test.tsx'), 'utf8');
  const decidirDoKit = fs.readFileSync(path.join(MESA, 'test/decidir.test.ts'), 'utf8');
  assert.ok((cartoesDoKit.match(/^test\(/gm) ?? []).length >= 12);
  assert.ok((decidirDoKit.match(/^test\(/gm) ?? []).length >= 9);
  assert.ok(cartoesDoKit.includes("for (const surface of ['terminal', 'desktop'] as const)"));
  for (const titulo of ['caso negativo: nenhum caminho do modulo responde ao pedido', 'decisao obvia: as quatro condicoes',
    'Decidir chama ork_request_decision com exatamente threadId e pedidoId']) assert.ok(decidirDoKit.includes(titulo), titulo);
});

test('guarda: a Mesa passa na guarda estatica, sozinha e junto dos outros mods', () => {
  const { checarMods } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
  const so = checarMods({ pastas: [MESA] });
  assert.equal(so.ok, true, JSON.stringify(so.mods[0].achados));
  const todos = checarMods({});
  assert.equal(todos.ok, true, JSON.stringify(todos.mods.filter((m: { ok: boolean }) => !m.ok)));
  assert.ok(todos.mods.some((m: { mod: string }) => m.mod === 'ork-mesa'));
});
