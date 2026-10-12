import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { CONTRATO_DA_ENTREGA, lerMensagemDaEntrega, mensagemDaEntrega, novaCaixaDeSaida } from '../src/entrega-por-mod';
import { projetoTemporario } from './apoio';
import { novaThread } from '../src/thread';

// RM-059 (fatia F9): o Mensageiro de Sessoes (`ork-mensageiro`) testado sem o Claude Code. O sandbox do `ork verify` e
// o runner do CI nao tem o `claude`, entao a claim hermetica transpila os modulos puros do Mensageiro com o compilador
// do `core` e os roda num escopo proprio, como os testes da ponte e dos outros mods. O contrato da mensagem e cruzado
// com o do nucleo (`entrega-por-mod.ts`), e o fonte e varrido pela AST: o Mensageiro le o nucleo pela ponte e por duas
// ferramentas MCP, e o envio leva so a mensagem da caixa de saida.
const raizDoRepo = path.resolve(__dirname, '../../..');
const MENSAGEIRO = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-mensageiro');
const MODULOS_PUROS = ['hooks/caixa.ts', 'hooks/painel.tsx', 'test/apoio.ts'];
/** As unicas ferramentas do nucleo que o Mensageiro chama, no servidor `orkastery`. */
const LISTA_FECHADA_DO_MCP = ['ork_session_outbox'];
const NOUNS_PROIBIDOS = ['process', 'fs', 'store', 'env', 'prompt'];
/** Tudo que o Mensageiro chama direto no `$`. */
const CHAMADAS_PERMITIDAS = ['ork.papel', 'ork.retrato', 'ork.faixa', 'ork.mostrado', 'command.register', 'clock.now', 'clock.after',
  'clock.every', 'ui.open', 'ui.panes', 'ui.resolve', 'ui.toast', 'mcp.call', 'session.send', 'state.get', 'state.set'];
const EPOCA = 1760000000000;

type No = { tipo: string; props: Record<string, unknown>; filhos: unknown[] };
(globalThis as unknown as { h: unknown }).h = (tipo: string, props: Record<string, unknown> | null, ...filhos: unknown[]): No =>
  ({ tipo, props: props ?? {}, filhos: filhos.flat(Infinity) });

const modulos = new Map<string, Record<string, any>>();
function resolver(base: string): string {
  for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error(`modulo do Mensageiro nao encontrado: ${base}`);
}
/** Transpila e roda um modulo puro do Mensageiro; o `require` so resolve outro modulo puro dele. */
function carregar(rel: string): Record<string, any> {
  const arquivo = resolver(path.join(MENSAGEIRO, rel));
  const pronto = modulos.get(arquivo);
  if (pronto) return pronto;
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  });
  const modulo = { exports: {} as Record<string, any> };
  modulos.set(arquivo, modulo.exports);
  const exigir = (id: string) => {
    const alvo = path.relative(MENSAGEIRO, path.join(path.dirname(arquivo), id));
    if (!id.startsWith('./') || !MODULOS_PUROS.includes(path.relative(MENSAGEIRO, resolver(path.join(MENSAGEIRO, alvo))))) {
      throw new Error(`modulo puro do Mensageiro nao importa valor de fora dele: ${id}`);
    }
    return carregar(alvo);
  };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(MENSAGEIRO, rel), 'utf8'));
const caixa = () => carregar('hooks/caixa.ts');
const painel = () => carregar('hooks/painel.tsx');
const apoio = () => carregar('test/apoio.ts');

/** Os textos de uma arvore desenhada com o `h` deste teste, um por `Text` e um por `Button` (o rotulo). */
function textos(no: unknown): string[] {
  if (!no || typeof no !== 'object') return [];
  const n = no as No;
  const proprios = () => n.filhos.filter((f) => typeof f === 'string' || typeof f === 'number').join('');
  if (n.tipo === 'Text') return [proprios()];
  if (n.tipo === 'Button') return [typeof n.props.label === 'string' ? n.props.label : proprios()];
  return n.filhos.flatMap(textos);
}

test('manifesto do Mensageiro: nome, papeis dono e fase, so a ponte como dependencia e nenhuma chave fora do formato', () => {
  const m = lerJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ork-mensageiro');
  assert.equal(m.types, './types/index.d.ts');
  assert.deepEqual(m.dependencies, ['ork-ponte']);
  for (const chave of ['formato', 'papeis', 'claudeCodeMinimo', 'orkastery']) assert.equal(chave in m, false, chave);
  assert.deepEqual(lerJson('orkastery-mod.json'), { formato: 'ork.mod/v1', papeis: ['dono', 'fase'], claudeCodeMinimo: '2.1.287' });
  assert.deepEqual(lerJson('hooks/hooks.json').modules, ['./register.tsx']);
  assert.ok(fs.existsSync(path.join(MENSAGEIRO, 'hooks/register.tsx')));
});

test('o contrato declara o estado sem import nem referencia, e nenhuma entrega guarda o texto da resposta', () => {
  const tipos = fs.readFileSync(path.join(MENSAGEIRO, 'types/index.d.ts'), 'utf8');
  assert.ok(!/^import /m.test(tipos) && !tipos.includes('/// <reference'));
  for (const chave of ["'ork-mensageiro': {", 'dono: MensageiroDono']) assert.ok(tipos.includes(chave), chave);
  const bloco = (nome: string) => {
    const i = tipos.indexOf(`export type ${nome} =`);
    assert.ok(i >= 0, nome);
    const j = tipos.indexOf('\nexport type ', i + 1);
    return tipos.slice(i, j < 0 ? undefined : j).split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join('\n');
  };
  for (const nome of ['MensageiroEntrega', 'MensageiroDono', 'MensageiroIncerta']) {
    assert.ok(!/\b(texto|mensagem|resposta|text)\??\s*:/.test(bloco(nome)), nome);
  }
});

test('a marca e a mensagem do Mensageiro sao as do nucleo: o kit compoe a mesma mensagem que o nucleo le', () => {
  assert.equal(caixa().CONTRATO_DA_ENTREGA, CONTRATO_DA_ENTREGA);
  assert.equal(apoio().MARCA, CONTRATO_DA_ENTREGA);
  const a = apoio();
  assert.equal(a.mensagemDe(), mensagemDaEntrega(a.PEDIDO, a.ENVIO, a.RESPOSTA));
  assert.deepEqual(lerMensagemDaEntrega(a.mensagemDe()), { pedidoId: a.PEDIDO, envioId: a.ENVIO, corpo: a.RESPOSTA });
});

test('caixa: a lista do nucleo vira entradas do Mensageiro, a anotada tambem, e o que sai do contrato fica de fora', () => {
  const p = projetoTemporario('mensageiro-caixa-contrato');
  try {
    const t = novaThread(p.carregado, { nome: 'mensageiro', modo: 'auto' }).thread;
    const a = apoio(), c = caixa();
    const nucleo = novaCaixaDeSaida(() => EPOCA);
    nucleo.guardar({ thread: t.id, pedidoId: a.PEDIDO, envioId: a.ENVIO, fase: 'GO', sessionId: a.SESSAO, mensagem: a.mensagemDe() });
    const lista = JSON.parse(JSON.stringify({ contrato: CONTRATO_DA_ENTREGA, entregas: nucleo.listar(p.dir) }));
    const [e] = c.lerCaixa(lista);
    assert.equal(e.mensagem, a.mensagemDe());
    assert.equal(e.sessionId, a.SESSAO);
    assert.equal(e.reservada, false);
    assert.equal(e.ultimoEnvio, null);
    const anotada = JSON.parse(JSON.stringify({ contrato: CONTRATO_DA_ENTREGA, entrega: nucleo.anotarEnvio(p.dir, t.id, a.ENVIO, false, 'sem sessão') }));
    assert.deepEqual(c.entradaAnotada(anotada, false).ultimoEnvio, { em: EPOCA, entregue: false, motivo: 'sem sessão' });
    // Mensagem de outro pedido, sessao que nao e uuid e contrato errado ficam de fora ou viram erro.
    assert.deepEqual(c.lerCaixa({ contrato: CONTRATO_DA_ENTREGA, entregas: [{ ...e, mensagem: a.mensagemDe(a.ENVIO, a.PEDIDO) }] }), []);
    assert.deepEqual(c.lerCaixa({ contrato: CONTRATO_DA_ENTREGA, entregas: [{ ...e, sessionId: 'alheia' }] }), []);
    assert.throws(() => c.lerCaixa({ contrato: 'outro', entregas: [] }), /fora do contrato/);
  } finally { p.limpar(); }
});

test('jsonDoMcp e deveEnviar: o JSON do texto, a recusa com o motivo, e as tres esperas do reenvio (D10)', () => {
  const c = caixa();
  const ok = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v) }], isError: false });
  assert.deepEqual(c.jsonDoMcp(ok({ a: 1 }), 'x'), { a: 1 });
  assert.throws(() => c.jsonDoMcp({ content: [{ type: 'text', text: '{"erro":"mcp.tool.unknown"}' }], isError: true }, 'ork_session_outbox'),
    /ork_session_outbox recusou: mcp\.tool\.unknown/);
  assert.throws(() => c.jsonDoMcp({ content: [{ type: 'text', text: 'nao e json' }] }, 'x'), /fora do JSON/);
  const base = { thread: 'ork-a', pedidoId: 'p', envioId: 'e', sessionId: 's', mensagem: 'm', tentativas: 1, reservada: false };
  assert.equal(c.deveEnviar({ ...base, tentativas: 0, ultimoEnvio: null }, EPOCA), true);
  assert.equal(c.deveEnviar({ ...base, ultimoEnvio: { em: EPOCA, entregue: false, motivo: null } }, EPOCA + 29999), false);
  assert.equal(c.deveEnviar({ ...base, ultimoEnvio: { em: EPOCA, entregue: false, motivo: null } }, EPOCA + 30000), true);
  assert.equal(c.deveEnviar({ ...base, ultimoEnvio: { em: EPOCA, entregue: true, motivo: null } }, EPOCA + 59999), false);
  assert.equal(c.deveEnviar({ ...base, ultimoEnvio: { em: EPOCA, entregue: true, motivo: null } }, EPOCA + 60000), true);
  assert.equal(c.deveEnviar({ ...base, reservada: true, ultimoEnvio: { em: EPOCA, entregue: true, motivo: null } }, EPOCA + 600000), false);
  assert.equal(c.deveEnviar({ ...base, tentativas: 10, ultimoEnvio: { em: EPOCA, entregue: true, motivo: null } }, EPOCA + 600000), false);
  assert.deepEqual(c.argsDoEnvio({ ...base, sessionId: 'sessao', mensagem: 'a mensagem' }), { to: { sessionId: 'sessao' }, text: 'a mensagem' });
  assert.deepEqual(c.resultadoDoEnvio({ isDelivered: true }), { entregue: true, motivo: null });
  assert.deepEqual(c.resultadoDoEnvio({ isDelivered: false, reason: 'gone' }), { entregue: false, motivo: 'gone' });
  assert.deepEqual(c.resultadoDoEnvio(undefined), { entregue: false, motivo: 'a sessão não recebeu a mensagem' });
});

test('entregas: o que sai da caixa vira entregue ou saiu-da-caixa pelo retrato, e sem retrato nada se conclui', () => {
  const c = caixa(), a = apoio();
  const entrada = (o: Record<string, unknown> = {}) => ({ thread: 'ork-a', pedidoId: a.PEDIDO, envioId: a.ENVIO, sessionId: a.SESSAO,
    mensagem: a.mensagemDe(), tentativas: 1, ultimoEnvio: { em: EPOCA, entregue: true, motivo: null }, reservada: false, ...o });
  const [aCaminho] = c.atualizarEntregas([], [entrada()], null, EPOCA);
  assert.equal(aCaminho.estado, 'a-caminho');
  assert.equal(c.atualizarEntregas([], [entrada({ reservada: true })], null, EPOCA)[0].estado, 'reservada');
  assert.equal(c.atualizarEntregas([], [entrada({ ultimoEnvio: null, tentativas: 0 })], null, EPOCA)[0].estado, 'na-fila');
  const [naoChegou] = c.atualizarEntregas([], [entrada({ ultimoEnvio: { em: EPOCA, entregue: false, motivo: 'gone' } })], null, EPOCA);
  assert.deepEqual([naoChegou.estado, naoChegou.motivo], ['nao-chegou', 'gone']);
  const [desistiu] = c.atualizarEntregas([], [entrada({ tentativas: 10 })], null, EPOCA);
  assert.deepEqual([desistiu.estado, desistiu.motivo], ['desistiu', 'a sessão de fase não confirmou a entrega depois de 10 envios']);
  // Saiu da caixa: sem retrato, fica como estava; com o pedido fora do retrato, entregue; com ele ainda la, saiu da caixa.
  assert.equal(c.atualizarEntregas([aCaminho], [], null, EPOCA + 1)[0].estado, 'a-caminho');
  assert.equal(c.atualizarEntregas([aCaminho], [], new Set(), EPOCA + 1)[0].estado, 'entregue');
  assert.equal(c.atualizarEntregas([aCaminho], [], new Set([a.PEDIDO]), EPOCA + 1)[0].estado, 'saiu-da-caixa');
  // O que terminou fica 30 min no painel e depois sai; o mesmo estado guarda o instante.
  const entregue = c.atualizarEntregas([aCaminho], [], new Set(), EPOCA + 1)[0];
  assert.equal(c.atualizarEntregas([entregue], [], new Set(), EPOCA + 1 + 30 * 60000).length, 1);
  assert.equal(c.atualizarEntregas([entregue], [], new Set(), EPOCA + 2 + 30 * 60000).length, 0);
  assert.equal(c.atualizarEntregas([aCaminho], [entrada()], null, EPOCA + 5000)[0].em, EPOCA);
  assert.equal(c.threadDoLedger('/p/.orkastery/threads/ork-a/ledger.jsonl'), 'ork-a');
  assert.equal(c.threadDoLedger('/p/.orkastery/threads/ork-a/claims.jsonl'), null);
});

test('faixa: o que nao chegou vem primeiro, depois o que esta a caminho, depois o entregue por 10 min; sem nada, a linha sai', () => {
  const c = caixa();
  const e = (estado: string, thread = 'ork-a', em = EPOCA) => ({ thread, pedidoId: 'p', envioId: `${thread}-${estado}`, sessionId: 's', estado, tentativas: 1, motivo: null, em });
  const dono = (entregas: unknown[]) => ({ entregas, incertas: [], lidoEm: EPOCA, erro: null });
  assert.equal(c.textoDaFaixa(dono([]), EPOCA), undefined);
  assert.equal(c.textoDaFaixa(dono([e('a-caminho')]), EPOCA), 'resposta a caminho da ork-a');
  assert.equal(c.textoDaFaixa(dono([e('a-caminho'), e('na-fila', 'ork-b')]), EPOCA), '2 respostas a caminho das sessões de fase');
  assert.equal(c.textoDaFaixa(dono([e('a-caminho'), e('desistiu', 'ork-b')]), EPOCA), 'a resposta para a ork-b não chegou; responda pelo claude attach');
  assert.equal(c.textoDaFaixa(dono([e('entregue')]), EPOCA + 10 * 60000), 'resposta entregue à ork-a');
  assert.equal(c.textoDaFaixa(dono([e('entregue')]), EPOCA + 10 * 60000 + 1), undefined);
});

test('retrato: as incertas sao so de sessao, com a thread do ref, e a secao que nao veio lida nao conclui nada', () => {
  const c = caixa(), a = apoio();
  const r = a.retratoHitl([{ pedido: a.PEDIDO, incerto: true }, { pedido: a.ENVIO, incerto: false },
    { pedido: 'f9f9f9f9-0a0a-4b1b-8c2c-d3d3d3d3d3d3', incerto: true, alvo: 'gate' }]);
  assert.deepEqual(c.incertasDoRetrato(r), [{ thread: 'ork-a', pedidoId: a.PEDIDO }]);
  assert.deepEqual([...c.pedidosNoRetrato(r)].sort(), [a.ENVIO, a.PEDIDO, 'f9f9f9f9-0a0a-4b1b-8c2c-d3d3d3d3d3d3'].sort());
  assert.equal(c.pedidosNoRetrato({ sections: { hitl: { state: 'unavailable', items: [] } } }), null);
  assert.equal(c.pedidosNoRetrato({}), null);
  assert.deepEqual(c.incertasDoRetrato(null), []);
});

test('painel: glifo e rotulo em cada estado, sem o texto da resposta; so o que esta na janela vai ao registro', () => {
  const p = painel(), a = apoio();
  const entrega = (estado: string, motivo: string | null = null) => ({ thread: 'ork-a', pedidoId: a.PEDIDO, envioId: `${estado}-x`, sessionId: a.SESSAO, estado,
    tentativas: 2, motivo, em: EPOCA });
  const dono = { entregas: [entrega('a-caminho'), entrega('desistiu', 'sem reserva'), entrega('entregue')], incertas: [{ thread: 'ork-b', pedidoId: a.ENVIO }],
    lidoEm: EPOCA, erro: null };
  const linhas = p.linhasDoDono(dono, EPOCA + 120000);
  const desenho = textos(p.desenharPainel({ Box: 'Box', Text: 'Text', Button: 'Button' }, linhas, {}));
  assert.deepEqual(desenho.slice(0, 2), ['Mensageiro de Sessões', 'Atualizar']);
  for (const estado of ['a-caminho', 'desistiu', 'entregue']) {
    assert.ok(desenho.some((t) => t.includes(p.ROTULO_DO_ESTADO[estado])), estado);
  }
  assert.ok(desenho.includes(`✓ ork-a · pedido ${a.PEDIDO.slice(0, 8)} · entregue, com o recibo da sessão · 2 envios · há 2 min`));
  assert.ok(desenho.includes('  sem reserva'));
  assert.ok(desenho.includes(`· ork-b · pedido ${a.ENVIO.slice(0, 8)} · a entrega segue noutra sessão do dono`));
  assert.ok(!desenho.some((t) => t.includes(a.RESPOSTA)));
  for (const estado of Object.keys(p.ROTULO_DO_ESTADO)) assert.ok(p.ROTULO_DO_ESTADO[estado].length > 0, estado);
  // A janela de tres linhas nao chega a primeira entrega (titulo, o que faz, secao); a de quatro chega so a ela.
  assert.deepEqual(p.mostradosVisiveis(linhas, { offset: 0, bodyRows: 3 }), []);
  assert.deepEqual(p.mostradosVisiveis(linhas, { offset: 0, bodyRows: 4 }).map((m: { texto: string }) => m.texto), ['ork-a: resposta do dono entregue, com o recibo da sessão']);
  assert.deepEqual(p.mostradosVisiveis(linhas, undefined), []);
  assert.equal(p.idade(59999), 'agora');
  assert.equal(p.idade(3 * 3600000), 'há 3 h');
});

function chamadasDoFonte(arquivo: string) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2022, true, /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const saida: Array<{ cadeia: string[]; literais: Array<string | null>; argumentos: string[]; linha: number }> = [];
  const descrever = (a: ts.Expression) => ts.isCallExpression(a) && ts.isIdentifier(a.expression) ? `chamada:${a.expression.text}`
    : ts.isIdentifier(a) ? `nome:${a.text}` : ts.isObjectLiteralExpression(a)
      ? `objeto:${a.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : '?')).join(',')}` : 'outro';
  const visitar = (no: ts.Node) => {
    if (ts.isCallExpression(no)) {
      const cadeia: string[] = [];
      let e: ts.Expression = no.expression;
      while (ts.isPropertyAccessExpression(e)) { cadeia.unshift(e.name.text); e = e.expression; }
      if (ts.isIdentifier(e)) cadeia.unshift(e.text);
      saida.push({ cadeia, literais: no.arguments.map((a) => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : null)),
        argumentos: no.arguments.map(descrever), linha: fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1 });
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

test('o Mensageiro so chama no $ uma lista fechada; o MCP so as ferramentas da entrega; o envio leva so a mensagem da caixa', () => {
  const fontes = fontesDoMod(MENSAGEIRO);
  assert.ok(fontes.some((f) => f.endsWith('hooks/register.tsx')));
  const vistas = new Set<string>();
  const ferramentas: Record<string, string[]> = {};
  const envios: string[] = [];
  for (const arquivo of fontes) {
    for (const c of chamadasDoFonte(arquivo)) {
      const onde = `${path.relative(raizDoRepo, arquivo)}:${c.linha} ${c.cadeia.join('.')}`;
      assert.ok(!c.cadeia.slice(1, -1).some((n) => NOUNS_PROIBIDOS.includes(n)), `chamada proibida: ${onde}`);
      if (c.cadeia[0] === '$') {
        const chamada = c.cadeia.slice(1).join('.');
        assert.ok(CHAMADAS_PERMITIDAS.includes(chamada), `chamada fora da lista fechada do $: ${onde}`);
        vistas.add(chamada);
        if (chamada === 'session.send') envios.push(c.argumentos[0]);
      }
      if (c.cadeia.slice(-2).join('.') === 'mcp.call') {
        assert.equal(c.literais[0], 'orkastery', `servidor nao literal ou outro: ${onde}`);
        const ferramenta = c.literais[1];
        assert.ok(ferramenta !== null && LISTA_FECHADA_DO_MCP.includes(ferramenta), `ferramenta fora da lista fechada: ${onde}`);
        (ferramentas[ferramenta] ??= []).push(c.argumentos[2]);
      }
    }
  }
  assert.deepEqual(Object.keys(ferramentas).sort(), [...LISTA_FECHADA_DO_MCP].sort());
  assert.deepEqual(ferramentas.ork_session_outbox.sort(), ['chamada:argsDaAnotacao', 'objeto:operacao'].sort());
  assert.deepEqual(envios, ['chamada:argsDoEnvio'], 'o envio monta o argumento so pelo argsDoEnvio, com a mensagem da caixa');
  for (const chamada of ['ork.retrato', 'ork.faixa', 'ork.mostrado', 'session.send', 'mcp.call']) assert.ok(vistas.has(chamada), chamada);
  const registro = fs.readFileSync(path.join(MENSAGEIRO, 'hooks/register.tsx'), 'utf8');
  assert.ok(!/\$\.(fs|env|process|store|prompt)\./.test(registro));
  assert.ok(!registro.includes('session.append'), 'o Mensageiro nunca grava linha de usuario');
});

test('as ferramentas da lista existem no nucleo: a caixa so no servidor do dono do Claude Code', () => {
  const servidor = fs.readFileSync(path.join(raizDoRepo, 'core/src/mcp-server.ts'), 'utf8');
  assert.ok(servidor.includes("if(caixa) registrarTool('ork_session_outbox',"));
  assert.match(servidor, /const caixa = opcoes\.host==='claude-code' && !opcoes\.threadId \? novaCaixaDeSaida\(\) : null;/);
});

test('os modulos puros nao importam o motor nem valor de fora', () => {
  for (const rel of MODULOS_PUROS) assert.ok(carregar(rel), rel);
  for (const rel of ['hooks/caixa.ts', 'hooks/painel.tsx']) {
    const fonte = fs.readFileSync(path.join(MENSAGEIRO, rel), 'utf8');
    assert.ok(!/from 'claude-code'/.test(fonte), `${rel} nao importa o motor`);
  }
});

test('os testes do kit cobrem terminal e desktop e os casos do lado do dono', () => {
  const entrega = fs.readFileSync(path.join(MENSAGEIRO, 'test/entrega.test.ts'), 'utf8');
  const doPainel = fs.readFileSync(path.join(MENSAGEIRO, 'test/painel.test.tsx'), 'utf8');
  assert.ok((entrega.match(/^test\(/gm) ?? []).length >= 9);
  assert.ok((doPainel.match(/^test\(/gm) ?? []).length >= 4);
  assert.ok(doPainel.includes("for (const surface of ['terminal', 'desktop'] as const)"));
  assert.ok(entrega.includes("for (const surface of ['terminal', 'desktop'] as const)"));
  for (const titulo of ['a resposta da caixa vai a sessao de fase como o nucleo a compos', 'o que o receptor reservou nao vai de novo',
    'na sessao de fase e na dormente o lado do dono nao liga']) assert.ok(entrega.includes(titulo), titulo);
});

test('guarda: o Mensageiro passa na guarda estatica, sozinho e junto dos outros mods', () => {
  const { checarMods } = require(path.join(raizDoRepo, 'core/scripts/checar-mods.cjs'));
  const so = checarMods({ pastas: [MENSAGEIRO] });
  assert.equal(so.ok, true, JSON.stringify(so.mods[0].achados));
  const todos = checarMods({});
  assert.equal(todos.ok, true, JSON.stringify(todos.mods.filter((m: { ok: boolean }) => !m.ok)));
  assert.ok(todos.mods.some((m: { mod: string }) => m.mod === 'ork-mensageiro'));
});
