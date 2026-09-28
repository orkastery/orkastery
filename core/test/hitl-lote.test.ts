import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  alternativaRecomendada, CONSEQUENCIA_DA_ACAO, LETRAS, montarLote, perguntaDoPedido,
  TETO_DE_PERGUNTAS_POR_LOTE, textoDoLote,
} from '../src/hitl-lote';
import { DecisaoInformada, PedidoHitl, PerguntaAoDono, validarPedidoHitl } from '../src/hitl-contract';

const CANAIS = ['telegram', 'terminal'] as const;

function pedido(extra: Partial<PedidoHitl> = {}): PedidoHitl {
  const p = {
    contrato: 'ork.hitl/v1', id: '6ce589f3-1fd4-4623-8692-cd39e7596bf6', thread: 'ork-i31kg1contra',
    fase: 'PLAN', modo: 'auto', alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
    pergunta: 'Qual é o veredito sobre premissas?',
    opcoes: [
      { numero: 1, texto: 'Aprovar com as evidências apresentadas', acao: 'aprovar' },
      { numero: 2, texto: 'Solicitar revisão', acao: 'recusar' },
      { numero: 3, texto: 'Continuar esperando', acao: 'esperar' },
    ],
    recomendacao: 'Solicitar revisão: a fase não tem conclusão provada.',
    criadoEm: '2026-09-20T03:51:09.495Z', prazo: '2026-09-20T04:51:09.495Z',
    acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 },
    profundidade: 'resumo', ...extra,
  } as PedidoHitl;
  validarPedidoHitl(p);
  return p;
}

test('as perguntas saem de cinco em cinco, e o que sobra continua guardado', () => {
  const doze = Array.from({ length: 12 }, (_, i) => pedido({ id: `pedido-${i}` }));
  const lote = montarLote(doze);
  assert.equal(lote.perguntas.length, TETO_DE_PERGUNTAS_POR_LOTE);
  assert.equal(lote.restantes, 7);
  assert.equal(lote.recusadas.length, 0);
  assert.deepEqual(lote.perguntas.map(p => p.numero), [1, 2, 3, 4, 5]);
});

test('cada alternativa tem letra, consequência em uma linha, e exatamente uma é recomendada', () => {
  const p = perguntaDoPedido(pedido(), 1);
  assert.equal('motivo' in p, false);
  if ('motivo' in p) return;
  assert.deepEqual(p.alternativas.map(a => a.letra), ['a', 'b', 'c']);
  for (const a of p.alternativas) {
    assert.equal(a.consequencia.includes('\n'), false);
    assert.equal(a.consequencia.length > 0, true);
  }
  const recomendadas = p.alternativas.filter(a => a.recomendada);
  assert.equal(recomendadas.length, 1);
  assert.equal(recomendadas[0].letra, 'b');
  assert.equal(recomendadas[0].recomendada!.porque.includes('\n'), false);
  // A consequência vem da ação, não de texto livre: é o que de fato acontece.
  assert.equal(p.alternativas[0].consequencia, CONSEQUENCIA_DA_ACAO.aprovar);
  assert.equal(p.alternativas[2].consequencia, CONSEQUENCIA_DA_ACAO.esperar);
});

test('a recomendação genérica de hoje não vira recomendada no chute: é recusa de formato', () => {
  // Esta é a frase que o produto emite hoje, e ela não aponta alternativa nenhuma.
  const generico = pedido({ recomendacao: 'Confira artefatos, claims e riscos antes de responder.' });
  const r = perguntaDoPedido(generico, 1);
  assert.equal('motivo' in r, true);
  if (!('motivo' in r)) return;
  assert.equal(r.motivo, 'hitl.formato');
  assert.match(r.detalhe, /não nomeia exatamente uma alternativa/);

  // Recomendação que cita duas é ambígua e também não serve.
  const ambiguo = pedido({ recomendacao: 'Solicitar revisão ou Continuar esperando, tanto faz.' });
  assert.equal('motivo' in perguntaDoPedido(ambiguo, 1), true);
});

test('recusa de formato é defeito do emissor: o item não vira pergunta e não vira cobrança ao dono', () => {
  const lote = montarLote([
    pedido({ id: 'bom' }),
    pedido({ id: 'ruim', recomendacao: 'Confira artefatos, claims e riscos antes de responder.' }),
  ]);
  assert.equal(lote.perguntas.length, 1);
  assert.equal(lote.recusadas.length, 1);
  assert.equal(lote.recusadas[0].pedidoId, 'ruim');
  assert.equal(lote.restantes, 0);
  for (const canal of CANAIS) {
    const texto = textoDoLote(lote, { canal });
    assert.match(texto, /o conserto é nosso, não seu/, canal);
    assert.equal(texto.includes('ruim'), false, `${canal}: pedido recusado não aparece como pergunta`);
  }
});

test('de 2 a 4 alternativas: uma só e cinco são recusadas', () => {
  const uma = pedido({ opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }], recomendacao: 'Aprovar' });
  assert.equal('motivo' in perguntaDoPedido(uma, 1), true);
  const cinco = pedido({
    opcoes: LETRAS.map((_, i) => ({ numero: i + 1, texto: `Opção ${i + 1}`, acao: 'responder' as const }))
      .concat([{ numero: 5, texto: 'Opção 5', acao: 'responder' as const }]),
    recomendacao: 'Opção 1', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 },
  });
  const r = perguntaDoPedido(cinco, 1);
  assert.equal('motivo' in r, true);
  if ('motivo' in r) assert.match(r.detalhe, /mais de 4 alternativas/);
});

test('pedido que já traz alternativas prontas usa as dele, e uma só pode ser recomendada', () => {
  const v2 = { ...pedido(), alternativas: [
    { texto: 'Seguir com o plano', consequencia: 'a entrega sai hoje', recomendada: true, porque: 'o risco medido é baixo' },
    { texto: 'Adiar', consequencia: 'a entrega sai depois' },
  ] } as unknown as PedidoHitl;
  const p = perguntaDoPedido(v2, 1);
  assert.equal('motivo' in p, false);
  if ('motivo' in p) return;
  assert.deepEqual(p.alternativas.map(a => a.texto), ['Seguir com o plano', 'Adiar']);
  assert.equal(p.alternativas[0].recomendada!.porque, 'o risco medido é baixo');

  // Duas recomendadas não é escolha, é indecisão: cai para as opções do v1.
  const duas = { ...pedido(), alternativas: [
    { texto: 'A', consequencia: 'x', recomendada: true, porque: 'p' },
    { texto: 'B', consequencia: 'y', recomendada: true, porque: 'q' },
  ] } as unknown as PedidoHitl;
  const q = perguntaDoPedido(duas, 1);
  assert.equal('motivo' in q, false);
  if (!('motivo' in q)) assert.equal(q.alternativas.length, 3, 'caiu para as opções do pedido v1');

  // Recomendada sem porquê também não serve: "recomendo" sem motivo é ordem, não recomendação.
  const semPorque = { ...pedido(), alternativas: [
    { texto: 'A', consequencia: 'x', recomendada: true },
    { texto: 'B', consequencia: 'y' },
  ] } as unknown as PedidoHitl;
  const s = perguntaDoPedido(semPorque, 1);
  if (!('motivo' in s)) assert.equal(s.alternativas.length, 3, 'caiu para as opções do pedido v1');
});

test('o texto do lote é topificado, responde por número e letra, e não mostra identificador longo', () => {
  const lote = montarLote([pedido({ id: 'a1' }), pedido({ id: 'a2' }), pedido({ id: 'a3' })]);
  for (const canal of CANAIS) {
    const texto = textoDoLote(lote, { canal });
    assert.match(texto, /^ {3}a\) Aprovar com as evidências apresentadas/m, canal);
    assert.match(texto, /^ {6}→ a fase segue e o bloco avança$/m, canal);
    assert.match(texto, /^ {6}porquê: /m, canal);
    // O exemplo tem a forma que o dono digita e que o ingresso reconhece: "1a 2c".
    assert.match(texto, /Responda com o número e a letra, por exemplo: 1a 2a 3a\./, canal);
    // Sem identificador longo e sem JSON, igual à camada 1.
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(texto), false, canal);
    assert.throws(() => JSON.parse(texto), canal);
  }
  // O identificador longo continua nos dados, que é onde a máquina precisa dele.
  assert.equal(lote.perguntas[0].pedidoId, 'a1');
});

test('telegram e terminal marcam a recomendada de jeitos diferentes, com o mesmo conteúdo', () => {
  const lote = montarLote([pedido()]);
  const telegram = textoDoLote(lote, { canal: 'telegram' });
  const terminal = textoDoLote(lote, { canal: 'terminal' });
  assert.match(telegram, /✅ recomendada/);
  assert.match(terminal, /← recomendada/);
  assert.equal(terminal.includes('✅'), false);
  const semMarca = (t: string) => t.replace(/[📋✅]|←/g, '')
    .split('\n').map(l => l.replace(/ +/g, ' ').trimEnd()).join('\n').replace(/^ /gm, '');
  assert.equal(semMarca(telegram), semMarca(terminal));
});

test('lote vazio diz que não há pergunta em vez de mandar um bloco vazio', () => {
  const lote = montarLote([]);
  assert.deepEqual(lote.perguntas, []);
  for (const canal of CANAIS) {
    assert.match(textoDoLote(lote, { canal }), /Nenhuma pergunta em formato respondível agora\./, canal);
  }
});

test('a recomendação que nomeia uma alternativa é achada por texto literal, sem interpretar intenção', () => {
  assert.equal(alternativaRecomendada(pedido()), 1);
  assert.equal(alternativaRecomendada(pedido({ recomendacao: 'solicitar revisão' })), 1, 'caixa não importa');
  assert.equal(alternativaRecomendada(pedido({ recomendacao: 'recomendo recusar' })), -1, 'sinônimo não conta');
});

test('lote com contrato adulterado é recusado em vez de virar texto ao dono', () => {
  const lote = { ...montarLote([pedido()]), contrato: 'outro' } as never;
  assert.throws(() => textoDoLote(lote, { canal: 'telegram' }), /contrato inválido/);
});

// ---------------------------------------------------------------------------
// T4c: a camada 2 lê `ork.hitl/v2` sem passar pelo parser da recomendação.
// ---------------------------------------------------------------------------

function perguntaV2(extra: Partial<PerguntaAoDono> = {}): PerguntaAoDono {
  const p = {
    contrato: 'ork.hitl/v2', id: 'v2-lote-1', thread: 'ork-i41hitlinver', fase: 'GO', modo: 'auto',
    criadoEm: '2026-09-20T19:00:00.000Z', profundidade: 'resumo', classe: 'pergunta',
    alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
    pergunta: 'Qual é o veredito sobre premissas?',
    alternativas: [
      { letra: 'a', texto: 'Aprovar com as evidências apresentadas', acao: 'aprovar',
        consequencia: 'a fase segue e o bloco avança' },
      { letra: 'b', texto: 'Solicitar revisão', acao: 'recusar',
        consequencia: 'a fase volta para revisão', recomendada: true,
        porque: 'a fase não tem conclusão provada' },
    ],
    corpo: ['o parecer da fase saiu como claims.failed'],
    tipoDeResposta: 'objetiva', irreversivel: false, codigo: 'K3F9',
    prazo: '2026-09-20T20:00:00.000Z', acaoPadraoAoExpirar: 'esperar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, ...extra,
  } as PerguntaAoDono;
  validarPedidoHitl(p);
  return p;
}

const consumado: DecisaoInformada = {
  contrato: 'ork.hitl/v2', id: 'v2-decidido-1', thread: 'ork-i41hitlinver', fase: 'GO', modo: 'auto',
  criadoEm: '2026-09-20T19:00:00.000Z', profundidade: 'resumo', classe: 'decidido',
  decidido: 'O resumo do pulse sai de hora em hora', porque: 'foi o que o dono pediu',
  comoMudar: 'a linha do crontab aceita qualquer cadência',
  custoDeReverter: { agora: 'uma linha', depois: 'uma linha' },
  criterio: { tipo: 'medicao', referencia: 'crontab -l' },
};

test('um pedido v2 vira pergunta pelas alternativas que ele já declara', () => {
  const r = perguntaDoPedido(perguntaV2(), 1);
  assert.equal('motivo' in r, false);
  if ('motivo' in r) return;
  assert.deepEqual(r.alternativas.map(a => a.letra), ['a', 'b']);
  // A consequência é a declarada pelo pedido, não a derivada da ação: no v2 ela é do emissor.
  assert.equal(r.alternativas[0].consequencia, 'a fase segue e o bloco avança');
  assert.equal(r.alternativas[1].recomendada?.porque, 'a fase não tem conclusão provada');
  assert.equal(r.alternativas.filter(a => a.recomendada).length, 1);
});

test('o v2 não depende da recomendação nomear alternativa: ela já vem marcada', () => {
  // `alternativaRecomendada` é o parser do v1. No v2 ele nem é consultado, e é por isso que
  // um pedido v2 entra no lote sem precisar que a recomendação cite o texto de uma opção.
  const p = perguntaV2();
  const r = perguntaDoPedido(p, 1);
  assert.equal('motivo' in r, false);
  if ('motivo' in r) return;
  assert.equal(r.alternativas.find(a => a.recomendada)?.letra, 'b');
});

test('um pedido v2 malformado cai na mesma recusa tipada de sempre', () => {
  // Duas recomendadas: o lote não escolhe entre elas, recusa por formato.
  const duas = { ...perguntaV2(), alternativas: [
    { letra: 'a', texto: 'Aprovar', acao: 'aprovar', consequencia: 'segue', recomendada: true, porque: 'x' },
    { letra: 'b', texto: 'Revisar', acao: 'recusar', consequencia: 'volta', recomendada: true, porque: 'y' },
  ] } as unknown as PerguntaAoDono;
  const r = perguntaDoPedido(duas, 1);
  assert.equal('motivo' in r, true);
  if (!('motivo' in r)) return;
  assert.equal(r.motivo, 'hitl.formato');
  // E a recusa é pela porta certa: um v2 não cai no parser da recomendação do v1, onde o texto
  // da primeira recomendada citaria o rótulo de uma opção e a escolheria por acidente.
  assert.match(r.detalhe, /não cai no parser do v1/);
});

test('um fato consumado nunca entra na camada 2: ele não pergunta nada', () => {
  const r = perguntaDoPedido(consumado, 1);
  assert.equal('motivo' in r, true);
  if (!('motivo' in r)) return;
  assert.equal(r.motivo, 'hitl.formato');
  assert.match(r.detalhe, /não é pergunta/);
  // E no lote inteiro ele sai da conta de perguntas, não vira a sexta.
  const lote = montarLote([consumado, perguntaV2(), pedido()]);
  assert.equal(lote.perguntas.length, 2);
  assert.equal(lote.recusadas.length, 1);
  assert.equal(lote.recusadas[0].pedidoId, consumado.id);
});

test('as duas versões saem no mesmo texto para o dono, sem identificador longo', () => {
  const lote = montarLote([pedido(), perguntaV2()]);
  for (const canal of CANAIS) {
    const texto = textoDoLote(lote, { canal });
    assert.ok(texto.includes('Qual é o veredito sobre premissas?'));
    assert.ok(!texto.includes('6ce589f3-1fd4-4623-8692-cd39e7596bf6'), 'id longo do v1 vazou');
    assert.ok(!texto.includes('v2-lote-1'), 'id do v2 vazou');
  }
});

// ---------------------------------------------------------------------------
// I-41 (GO-FIX 1): o que o dono lê no lote, e o que o lote nunca faz.
// ---------------------------------------------------------------------------

test('o mesmo pedido que chega por dois itens do pulse vira UMA pergunta, não duas', () => {
  // A sessão e a fase param pelo mesmo gate: dois itens do pulse, um pedido só.
  const um = pedido({ id: 'mesmo-pedido' });
  const lote = montarLote([um, um, perguntaV2()]);
  assert.equal(lote.perguntas.length, 2);
  assert.deepEqual(lote.perguntas.map(p => p.numero), [1, 2]);
  assert.equal(lote.restantes, 0);
});

test('A3: pergunta aberta não entra no lote de letras e nunca sai misturada com as objetivas', () => {
  const aberta = perguntaV2({ id: 'aberta-1', tipoDeResposta: 'aberta' });
  const lote = montarLote([aberta, perguntaV2({ id: 'objetiva-1' }), perguntaV2({ id: 'aberta-2', tipoDeResposta: 'aberta' })]);
  assert.deepEqual(lote.perguntas.map(p => p.pedidoId), ['objetiva-1']);
  assert.equal(lote.abertas, 2);
  for (const canal of CANAIS) {
    assert.match(textoDoLote(lote, { canal }), /2 perguntas abertas ficam para depois das objetivas, uma por vez\./, canal);
  }
});

test('A5: a contagem de pedidos que não viraram pergunta concorda com o número', () => {
  const recusado = (id: string) => pedido({ id, recomendacao: 'Confira artefatos, claims e riscos antes de responder.' });
  const um = textoDoLote(montarLote([recusado('r1')]), { canal: 'telegram' });
  assert.match(um, /1 pedido não virou pergunta por defeito de quem escreveu; o conserto é nosso, não seu\./);
  const onze = textoDoLote(montarLote(Array.from({ length: 11 }, (_, i) => recusado(`r${i}`))), { canal: 'telegram' });
  assert.match(onze, /11 pedidos não viraram pergunta por defeito de quem escreveu; o conserto é nosso, não seu\./);
  assert.equal(onze.includes('pedidos não virou'), false);
});

test('A4: o lote que deixa perguntas para depois traz o código para buscá-las, e os números continuam', () => {
  const pedidos = Array.from({ length: 3 }, (_, i) => perguntaV2({ id: `p${i}` }));
  const lote = montarLote(pedidos, { numeroInicial: 6 });
  assert.deepEqual(lote.perguntas.map(p => p.numero), [6, 7, 8]);
  const texto = textoDoLote(lote, { canal: 'telegram', proximo: { codigo: 'K7M2', faltam: 4 } });
  assert.match(texto, /^6\. /m);
  assert.match(texto, /Faltam 4\. Para receber as próximas, responda K7M2 a\./);
  assert.match(texto, /por exemplo: 6a 7a 8a\./);
  // Sem código novo, o texto só conta o que sobra; com um só, a concordância acompanha.
  assert.match(textoDoLote(montarLote(pedidos, { teto: 2 }), { canal: 'telegram' }), /Sobra 1 para o próximo lote\./);
  assert.match(textoDoLote(lote, { canal: 'telegram', proximo: { codigo: 'K7M2', faltam: 1 } }), /Falta 1\. Para receber/);
});

test('o lote cabe numa mensagem de Telegram', () => {
  const longa = 'x'.repeat(140);
  const pedidos = Array.from({ length: 5 }, (_, i) => perguntaV2({ id: `longo${i}`, pergunta: `${longa}?`.slice(0, 200) }));
  assert.equal(textoDoLote(montarLote(pedidos), { canal: 'telegram' }).length <= 3900, true);
});
