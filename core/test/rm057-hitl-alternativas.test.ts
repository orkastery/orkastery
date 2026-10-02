/**
 * RM-057 (fatia 1): o HITL de conducao que parte do ork e uma selecao de 3 a 5 alternativas, com
 * exatamente uma marcada com o selo "Recomendação", e nunca depende de o dono escrever ou colar
 * texto, salvo a dependencia tecnica tipada (um comando que so ele pode rodar no terminal).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cenarioDoPulse, QUANDO } from './apoio-pulse';
import {
  CONTRATO_HITL_V2, exigirSelecaoDeConducao, MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO, MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO,
  PedidoHitl, PerguntaAoDono, SelecaoRecusada, validarPedidoHitlV2,
} from '../src/hitl-contract';
import { prepararPedidoGate, registrarPedidoHitl } from '../src/hitl-gates';
import { montarPedidoCurto, SELO_DA_RECOMENDADA, textoDoPedidoCurto, TETO_DE_LINHAS_DO_PEDIDO } from '../src/hitl-curto';
import { lerSolta, lerTrecho } from '../src/hitl-texto-livre';
import { lintTemplate, parseTemplate, TEMPLATE_FASE_PADRAO } from '../src/prompts';
import { lerLedger } from '../src/ledger';
import { dirThread } from '../src/thread';

const LETRAS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

function alternativas(n: number, recomendadas: number[] = [0]): PerguntaAoDono['alternativas'] {
  return Array.from({ length: n }, (_, i) => ({
    letra: LETRAS[i] as PerguntaAoDono['alternativas'][number]['letra'], texto: `Opção ${i + 1}`,
    acao: i === 0 ? 'aprovar' as const : i === 1 ? 'recusar' as const : 'esperar' as const,
    consequencia: `consequência ${i + 1}`,
    ...(recomendadas.includes(i) ? { recomendada: true as const, porque: 'o fato registrado aponta esta' } : {}),
  }));
}

function pergunta(extra: Partial<PerguntaAoDono> = {}): PerguntaAoDono {
  return {
    contrato: CONTRATO_HITL_V2, id: 'p-rm057', thread: 'ork-rm057alterna', fase: 'GO', modo: 'auto',
    criadoEm: '2026-10-02T18:00:00.000Z', profundidade: 'resumo', classe: 'pergunta',
    alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
    pergunta: 'Qual é o veredito sobre premissas?', alternativas: alternativas(3),
    corpo: ['Fase GO, motivo human.pending'], tipoDeResposta: 'objetiva', irreversivel: false, codigo: 'K3F9',
    prazo: '2026-10-02T19:00:00.000Z', acaoPadraoAoExpirar: 'esperar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, ...extra,
  };
}

const motivo = (f: () => void): string => {
  try { f(); } catch (e) { assert.ok(e instanceof SelecaoRecusada, String(e)); return e.motivo; }
  return 'passou';
};

test('o pedido de condução tem de 3 a 5 alternativas, e cada uma das pontas vale', () => {
  assert.equal(MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO, 3);
  assert.equal(MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO, 5);
  for (const n of [3, 4, 5]) {
    const p = pergunta({ alternativas: alternativas(n) });
    assert.doesNotThrow(() => validarPedidoHitlV2(p), `${n} alternativas passam no contrato`);
    assert.equal(motivo(() => exigirSelecaoDeConducao(p)), 'passou', `${n} alternativas são uma seleção`);
  }
  assert.equal(motivo(() => exigirSelecaoDeConducao(pergunta({ alternativas: alternativas(2) }))), 'hitl.selecao.fora-da-faixa');
  assert.equal(motivo(() => exigirSelecaoDeConducao(pergunta({ alternativas: alternativas(6) }))), 'hitl.selecao.fora-da-faixa');
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: alternativas(6) })), /de 2 a 5 alternativas/);
});

test('exatamente uma alternativa leva o selo Recomendação: nenhuma e duas são recusadas com motivo tipado', () => {
  assert.equal(motivo(() => exigirSelecaoDeConducao(pergunta({ alternativas: alternativas(3, []) }))), 'hitl.selecao.recomendada');
  assert.equal(motivo(() => exigirSelecaoDeConducao(pergunta({ alternativas: alternativas(4, [0, 2]) }))), 'hitl.selecao.recomendada');
});

test('resposta em texto só passa com a dependência técnica tipada, com o comando exato', () => {
  const aberta = pergunta({ tipoDeResposta: 'aberta', respostaAceita: { tipo: 'texto', maxCaracteres: 500 } });
  assert.equal(motivo(() => exigirSelecaoDeConducao(aberta)), 'hitl.selecao.texto-livre');
  assert.equal(motivo(() => exigirSelecaoDeConducao(pergunta({ respostaAceita: { tipo: 'texto', maxCaracteres: 500 } }))),
    'hitl.selecao.texto-livre');
  const comDependencia = { ...aberta, dependenciaTecnica: { comando: 'gh auth login', porque: 'o login do gh é interativo e só o dono pode fazer' } };
  assert.doesNotThrow(() => validarPedidoHitlV2(comDependencia));
  assert.equal(motivo(() => exigirSelecaoDeConducao(comDependencia)), 'passou');
  assert.throws(() => validarPedidoHitlV2({ ...aberta, dependenciaTecnica: { comando: '', porque: 'x' } }), /dependência técnica exige/);
  assert.throws(() => validarPedidoHitlV2({ ...aberta, dependenciaTecnica: { comando: 'a\nb', porque: 'x' } }), /dependência técnica exige/);
});

test('decisão informada não pergunta nada e passa; v1 nunca é a forma de um pedido novo do ork', () => {
  const v1 = { contrato: 'ork.hitl/v1' } as unknown as PedidoHitl;
  assert.equal(motivo(() => exigirSelecaoDeConducao(v1)), 'hitl.selecao.versao');
  const decidido = { contrato: CONTRATO_HITL_V2, classe: 'decidido' } as never;
  assert.equal(motivo(() => exigirSelecaoDeConducao(decidido)), 'passou');
});

test('o gate que o ork abre já sai como seleção, e o registro recusa a pergunta de duas alternativas', () => {
  const c = cenarioDoPulse('rm057-gate', 1);
  try {
    const t = c.itens[0].thread!;
    const preparado = prepararPedidoGate(c.p.dir, t, 'human.pending', QUANDO);
    assert.ok('novo' in preparado);
    const gate = preparado.novo as PerguntaAoDono;
    assert.ok(gate.alternativas.length >= 3 && gate.alternativas.length <= 5);
    assert.equal(gate.alternativas.filter(a => a.recomendada).length, 1);
    assert.doesNotThrow(() => exigirSelecaoDeConducao(gate));

    const antes = lerLedger(dirThread(c.p.dir, t)).length;
    const duas = { ...gate, id: 'p-duas', alternativas: gate.alternativas.slice(0, 2).map((a, i) =>
      i === 0 ? { ...a, recomendada: true as const, porque: a.porque ?? 'o fato registrado aponta esta' } : { letra: a.letra, texto: a.texto, acao: a.acao, consequencia: a.consequencia }) };
    assert.throws(() => registrarPedidoHitl(c.p.dir, duas), (e: unknown) => e instanceof SelecaoRecusada && e.motivo === 'hitl.selecao.fora-da-faixa');
    assert.equal(lerLedger(dirThread(c.p.dir, t)).length, antes, 'a recusa não grava nada no ledger');
  } finally { c.limpar(); }
});

test('o texto ao dono numera as cinco opções e mostra o selo Recomendação uma vez, nos dois canais', () => {
  assert.equal(SELO_DA_RECOMENDADA, 'Recomendação');
  const curto = montarPedidoCurto({
    thread: 'ork-rm057alterna', fase: 'GO', pergunta: 'Qual é o veredito sobre premissas?', corpo: ['Fase GO'],
    alternativas: alternativas(5, [1]).map(a => ({ chave: a.letra, texto: a.texto, consequencia: a.consequencia,
      ...(a.recomendada ? { recomendada: { porque: a.porque! } } : {}) })),
  }, { quando: QUANDO, responder: { tipo: 'codigo', codigo: 'K3F9' } });
  for (const canal of ['telegram', 'terminal'] as const) {
    const linhas = textoDoPedidoCurto(curto, canal).split('\n');
    assert.ok(linhas.length <= TETO_DE_LINHAS_DO_PEDIDO, canal);
    for (const letra of ['a', 'b', 'c', 'd', 'e']) assert.ok(linhas.some(l => l.startsWith(`${letra}) `)), `${canal} ${letra}`);
    const marca = canal === 'telegram' ? '✅ Recomendação' : '[Recomendação]';
    const marcadas = linhas.filter(l => l.includes(marca));
    assert.equal(marcadas.length, 1, canal);
    assert.ok(marcadas[0].startsWith('b) '), canal);
  }
});

test('a quinta alternativa se responde pela letra e e pelo dígito 5', () => {
  assert.deepEqual(lerTrecho('e'), { tipo: 'letra', letra: 'e' });
  assert.deepEqual(lerTrecho('5'), { tipo: 'digito', numero: 5 });
  assert.deepEqual(lerSolta('E.'), { tipo: 'letra', letra: 'e' });
  assert.equal(lerTrecho('f'), null);
});

test('o lint de prompt reprova o template que pede confirmação em texto livre ou texto colado', () => {
  const base = parseTemplate(TEMPLATE_FASE_PADRAO, 'embutido');
  assert.deepEqual(lintTemplate(base).filter(p => p.regra === 'hitl-texto-livre'), [], 'o template embutido passa');
  const comLinha = (linha: string) => lintTemplate({ ...base, corpo: `${base.corpo}\n${linha}\n`, bruto: `${base.bruto}\n${linha}\n` })
    .filter(p => p.regra === 'hitl-texto-livre');
  for (const ruim of [
    'Antes de seguir, peça ao dono que cole aqui o texto do pedido.',
    'Responda "confirmo" para eu continuar.',
    'Digite confirmo no chat.',
    'Paste the request below.',
    'Peça a confirmação por escrito antes do push.',
  ]) assert.equal(comLinha(ruim).length, 1, ruim);
  for (const bom of [
    'Pergunte ao dono com de 3 a 5 alternativas, uma com o selo Recomendação.',
    'Registre a dúvida com ork decisao registrar e siga.',
    'Se o login for interativo, mostre o comando exato que o dono roda no terminal.',
  ]) assert.equal(comLinha(bom).length, 0, bom);
});
