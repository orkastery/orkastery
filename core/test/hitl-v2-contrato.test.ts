import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CONTRATO_HITL_V2, DecisaoInformada, ehV2, LETRAS_DE_ALTERNATIVA, PerguntaAoDono, TETOS_HITL_V2,
  validarPedidoHitl, validarPedidoHitlV2,
} from '../src/hitl-contract';
import { ORDEM_DOS_MODOS } from '../src/modos';

const decidido = (extra: Partial<DecisaoInformada> = {}): unknown => ({
  contrato: CONTRATO_HITL_V2, id: 'd-1', thread: 'ork-i41hitlinver', fase: 'GO', modo: 'auto',
  criadoEm: '2026-09-20T19:00:00.000Z', profundidade: 'resumo', classe: 'decidido',
  decidido: 'O resumo do pulse sai de hora em hora',
  porque: 'foi a cadência que o dono pediu em 20/09',
  comoMudar: 'a linha do crontab aceita qualquer cadência',
  custoDeReverter: { agora: 'uma linha de crontab', depois: 'uma linha de crontab' },
  criterio: { tipo: 'medicao', referencia: 'jq -sr ... .orkastery/monitor/hitl.log' },
  ...extra,
});

const pergunta = (extra: Partial<PerguntaAoDono> = {}): unknown => ({
  contrato: CONTRATO_HITL_V2, id: 'p-1', thread: 'ork-i41hitlinver', fase: 'GO', modo: 'auto',
  criadoEm: '2026-09-20T19:00:00.000Z', profundidade: 'profunda', classe: 'pergunta',
  alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
  pergunta: 'A entrega do pulse pode passar a mandar um resumo por hora?',
  alternativas: [
    { letra: 'a', texto: 'Sim, uma mensagem por hora', acao: 'aprovar', consequencia: 'você recebe no máximo 24 por dia', recomendada: true, porque: 'foi o que você pediu' },
    { letra: 'b', texto: 'Não, mantenha por item', acao: 'recusar', consequencia: 'volta a mandar uma mensagem por item' },
  ],
  corpo: ['75 mensagens saíram em minutos em 20/09', 'o cron está desligado até isso mudar'],
  tipoDeResposta: 'objetiva', irreversivel: false, codigo: 'K3F9',
  prazo: '2026-09-20T20:00:00.000Z', acaoPadraoAoExpirar: 'seguir-recomendada',
  respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, ...extra,
});

test('o contrato escrito passa a ser ork.hitl/v2, e as duas classes são estas duas', () => {
  assert.equal(CONTRATO_HITL_V2, 'ork.hitl/v2');
  assert.doesNotThrow(() => validarPedidoHitlV2(decidido()));
  assert.doesNotThrow(() => validarPedidoHitlV2(pergunta()));
  assert.throws(() => validarPedidoHitlV2({ ...(decidido() as object), classe: 'aviso' }),
    /classe precisa ser decidido ou pergunta/);
  const p = pergunta();
  validarPedidoHitl(p);
  assert.equal(ehV2(p as PerguntaAoDono), true);
});

test('a decisão informada exige os quatro campos, e o custo exige os dois lados', () => {
  for (const campo of ['decidido', 'porque', 'comoMudar']) {
    assert.throws(() => validarPedidoHitlV2(decidido({ [campo]: undefined } as never)),
      /exige o que foi decidido, o porquê e como mudar/, campo);
  }
  assert.throws(() => validarPedidoHitlV2(decidido({ custoDeReverter: undefined } as never)), /custo de reverter/);
  assert.throws(() => validarPedidoHitlV2(decidido({ custoDeReverter: { agora: 'barato' } } as never)),
    /agora e depois, os dois presentes/, 'sem o quarto campo, "você pode ajustar" é mentira educada');
  assert.throws(() => validarPedidoHitlV2(decidido({ custoDeReverter: { depois: 'caro' } } as never)),
    /agora e depois, os dois presentes/);
});

test('decisão informada sem critério citado é recusada na origem, não no julgamento do agente', () => {
  assert.throws(() => validarPedidoHitlV2(decidido({ criterio: undefined } as never)),
    /exige critério citado e resolvível/);
  assert.throws(() => validarPedidoHitlV2(decidido({ criterio: { tipo: 'achismo', referencia: 'parece melhor' } } as never)),
    /exige critério citado e resolvível/);
  assert.throws(() => validarPedidoHitlV2(decidido({ criterio: { tipo: 'manifesto', referencia: '' } } as never)),
    /exige critério citado e resolvível/, 'critério que aponta para nada é critério ausente');
  for (const tipo of ['manifesto', 'ledger', 'medicao']) {
    assert.doesNotThrow(() => validarPedidoHitlV2(decidido({ criterio: { tipo, referencia: 'verify.build' } } as never)), tipo);
  }
});

test('decisão informada que traz campo de gate é recusada: fato consumado não pede ação', () => {
  const campos = ['prazo', 'acaoPadraoAoExpirar', 'respostaAceita', 'opcoes', 'alternativas', 'codigo'];
  for (const campo of campos) {
    assert.throws(() => validarPedidoHitlV2(decidido({ [campo]: 'qualquer coisa' } as never)),
      new RegExp(`não pode trazer ${campo}`), campo);
  }
});

test('ato irreversível nunca é decisão informada, e nunca avança por expiração', () => {
  assert.throws(() => validarPedidoHitlV2(decidido({ irreversivel: true } as never)),
    /ato irreversível nunca é decisão informada/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ irreversivel: true, ato: 'dinheiro' })),
    /nunca avança por expiração/);
  assert.doesNotThrow(() => validarPedidoHitlV2(pergunta({
    irreversivel: true, ato: 'dinheiro', acaoPadraoAoExpirar: 'esperar',
  })));
  assert.throws(() => validarPedidoHitlV2(pergunta({ irreversivel: true, ato: 'mandar-email' as never, acaoPadraoAoExpirar: 'esperar' })),
    /nomear um da lista congelada/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ ato: 'dinheiro' })), /só pedido irreversível nomeia ato/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ irreversivel: undefined } as never)), /precisa ser declarado/);
});

test('o formato da pergunta é verificado na origem, alternativa por alternativa', () => {
  const uma = [{ letra: 'a', texto: 'Só esta', acao: 'responder', consequencia: 'nada a escolher', recomendada: true, porque: 'única' }];
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: uma as never })), /de 2 a 4 alternativas/);
  const cinco = ['a', 'b', 'c', 'd', 'e'].map(letra => ({ letra, texto: 'x', acao: 'responder', consequencia: 'y' }));
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: cinco as never })), /de 2 a 4 alternativas/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: [
    { letra: 'a', texto: 'x', acao: 'responder', consequencia: 'y' }, { letra: 'c', texto: 'z', acao: 'responder', consequencia: 'w', recomendada: true, porque: 'p' },
  ] as never })), /de 2 a 4 alternativas/, 'letras precisam ser consecutivas');

  const semRecomendada = [{ letra: 'a', texto: 'x', acao: 'responder', consequencia: 'y' }, { letra: 'b', texto: 'z', acao: 'responder', consequencia: 'w' }];
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: semRecomendada as never })), /exatamente uma alternativa é recomendada/);
  const duasRecomendadas = semRecomendada.map(a => ({ ...a, recomendada: true, porque: 'p' }));
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: duasRecomendadas as never })), /exatamente uma alternativa é recomendada/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: [
    { letra: 'a', texto: 'x', acao: 'responder', consequencia: 'y', recomendada: true }, { letra: 'b', texto: 'z', acao: 'responder', consequencia: 'w' },
  ] as never })), /precisa dizer o porquê em uma linha/, 'recomendar sem motivo é ordem, não recomendação');
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: [
    { letra: 'a', texto: 'x', acao: 'responder' }, { letra: 'b', texto: 'z', acao: 'responder', consequencia: 'w', recomendada: true, porque: 'p' },
  ] as never })), /sem consequência em uma linha/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ alternativas: [
    { letra: 'a', texto: 'x', acao: 'responder', consequencia: 'y', porque: 'não sou a recomendada' },
    { letra: 'b', texto: 'z', acao: 'responder', consequencia: 'w', recomendada: true, porque: 'p' },
  ] as never })), /só a alternativa recomendada diz o porquê/);
  assert.deepEqual([...LETRAS_DE_ALTERNATIVA], ['a', 'b', 'c', 'd']);
});

test('a pergunta é uma frase e o corpo é lista de linhas, nunca prosa corrida', () => {
  assert.throws(() => validarPedidoHitlV2(pergunta({ pergunta: 'Primeira linha.\nSegunda linha?' })),
    /a pergunta é uma frase, sem quebra de linha/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ pergunta: 'x'.repeat(TETOS_HITL_V2.pergunta + 1) })),
    /a pergunta é uma frase/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ corpo: 'um parágrafo inteiro escrito de enfiada' as never })),
    /lista de linhas, nunca prosa corrida/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ corpo: ['linha com\nquebra dentro'] })),
    /lista de linhas, nunca prosa corrida/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ corpo: Array.from({ length: TETOS_HITL_V2.corpoLinhas + 1 }, () => 'linha') })),
    /lista de linhas, nunca prosa corrida/);
  assert.doesNotThrow(() => validarPedidoHitlV2(pergunta({ corpo: [] })));
});

test('a profundidade é escolha do pedido e vale em todos os modos vivos', () => {
  for (const modo of ORDEM_DOS_MODOS) {
    for (const profundidade of ['resumo', 'detalhada', 'profunda']) {
      assert.doesNotThrow(() => validarPedidoHitlV2(pergunta({ modo, profundidade } as never)), `${modo}/${profundidade}`);
      assert.doesNotThrow(() => validarPedidoHitlV2(decidido({ modo, profundidade } as never)), `${modo}/${profundidade}`);
    }
  }
  // O laco percorre os modos vivos por construcao; o guarda so impede que ele seja vazio.
  // Contar modos era afirmar o numero de um artefato vivo: quebrou quando a I-43 aposentou
  // dois, e quebraria de novo quando o #Fast entrar.
  assert.ok(ORDEM_DOS_MODOS.length > 0, 'o laco de modos nao pode ser vazio');
  assert.throws(() => validarPedidoHitlV2(pergunta({ profundidade: 'raso' } as never)), /profundidade inválidos/);
});

test('o código curto é curto: identificador longo não entra no campo que o dono digita', () => {
  assert.throws(() => validarPedidoHitlV2(pergunta({ codigo: '' })), /código curto inválido/);
  assert.throws(() => validarPedidoHitlV2(pergunta({ codigo: '6ce589f3-1fd4-4623-8692-cd39e7596bf6' })), /código curto inválido/);
  assert.doesNotThrow(() => validarPedidoHitlV2(pergunta({ codigo: 'K3F9' })));
});
