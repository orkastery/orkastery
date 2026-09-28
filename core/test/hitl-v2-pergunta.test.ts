import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  alvoDoPedido, chaveDaEscolha, chavesAceitas, DecisaoInformada, escolhasDoPedido, estadoDoPedido,
  expiracaoDoPedido, motivoDaRecusaDeFormato, motivoDoPedido, PedidoHitl, PerguntaAoDono, prazoDoPedido,
  recomendacaoDoPedido, textoDoPedido, validarPedidoHitlV2, validarRespostaHitl, vereditoDoGate,
} from '../src/hitl-contract';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { POLITICA_DE_RETRY } from '../src/retry';
import { MotivoGate } from '../src/types';
import { apresentarDecisao, apresentarHitl, pedidoHitlAberto } from '../src/hitl-presentation';
import { nativeOfferSignature, provenNativeOffer } from '../src/hitl-native-offer';
import { mensagemPulse } from '../src/pulse-delivery';
import { ItemPulse } from '../src/pulse';
import { projetoTemporario, commitar } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { abrirPedidoGate } from '../src/hitl-gates';
import { ehV2, ProfundidadeHitl, profundidadeDoModo, profundidadeDoPedido,
  validarPedidoHitlV1 } from '../src/hitl-contract';
import { modoAposentado } from '../src/modos';

const pergunta = (extra: Partial<PerguntaAoDono> = {}): unknown => ({
  contrato: 'ork.hitl/v2', id: 'p-1', thread: 'ork-i41hitlinver', fase: 'GO', modo: 'auto',
  criadoEm: '2026-09-20T19:00:00.000Z', profundidade: 'profunda', classe: 'pergunta',
  alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
  pergunta: 'A entrega do pulse pode passar a mandar um resumo por hora?',
  alternativas: [
    { letra: 'a', texto: 'Sim, um resumo por hora', acao: 'aprovar', consequencia: 'você recebe no máximo 24 por dia', recomendada: true, porque: 'foi o que você pediu' },
    { letra: 'b', texto: 'Não, mantenha por item', acao: 'recusar', consequencia: 'volta a mandar uma mensagem por item' },
  ],
  corpo: ['75 mensagens saíram em minutos em 20/09'],
  tipoDeResposta: 'objetiva', irreversivel: false, codigo: 'K3F9',
  prazo: '2026-09-20T20:00:00.000Z', acaoPadraoAoExpirar: 'seguir-recomendada',
  respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, ...extra,
});

test('hitl.formato entra no catálogo e nos DOIS mapas totais', () => {
  const motivo: MotivoGate = 'hitl.formato';
  assert.equal(typeof DESCRICAO_DO_MOTIVO[motivo], 'string');
  assert.match(DESCRICAO_DO_MOTIVO[motivo], /formato obrigatorio/);
  assert.equal(POLITICA_DE_RETRY[motivo].motivo, motivo);
  // O GOAL mencionava um mapa total; são dois, e esquecer o segundo quebra o build.
  assert.deepEqual(Object.keys(DESCRICAO_DO_MOTIVO).sort(), Object.keys(POLITICA_DE_RETRY).sort());
});

test('formato malformado é defeito do emissor: corrigir-dirigido, nunca escalar para o dono', () => {
  const politica = POLITICA_DE_RETRY['hitl.formato'];
  assert.equal(politica.acao, 'corrigir-dirigido');
  assert.equal(politica.automatica, true);
  assert.notEqual(politica.acao, 'escalar-humano', 'pedir que o dono revise a sintaxe do robô');
  assert.match(politica.porque, /quem errou foi o emissor/);
  assert.match(politica.correcao, /ork fix open/);
});

test('a recusa de forma do contrato vira o motivo tipado, e só ela', () => {
  const casos: Partial<PerguntaAoDono>[] = [
    { pergunta: 'Uma pergunta.\nE uma segunda linha?' },
    { alternativas: [{ letra: 'a', texto: 'única', acao: 'responder', consequencia: 'nada', recomendada: true, porque: 'p' }] as never },
    { alternativas: [{ letra: 'a', texto: 'x', acao: 'responder', consequencia: 'y' }, { letra: 'b', texto: 'z', acao: 'responder', consequencia: 'w' }] as never },
    { alternativas: [{ letra: 'a', texto: 'x', acao: 'responder' }, { letra: 'b', texto: 'z', acao: 'responder', consequencia: 'w', recomendada: true, porque: 'p' }] as never },
    { corpo: 'um parágrafo inteiro de enfiada' as never },
    { codigo: '6ce589f3-1fd4-4623-8692-cd39e7596bf6' },
  ];
  for (const alteracao of casos) {
    let capturado: unknown;
    try { validarPedidoHitlV2(pergunta(alteracao)); } catch (e) { capturado = e; }
    assert.ok(capturado, JSON.stringify(alteracao));
    assert.equal(motivoDaRecusaDeFormato(capturado), 'hitl.formato', JSON.stringify(alteracao));
  }
  // Contrato desconhecido não é erro de formato: inventar `hitl.formato` para tudo tornaria o
  // motivo tão genérico quanto a string solta que ele substitui.
  let outro: unknown;
  try { validarPedidoHitlV2({ contrato: 'ork.hitl/v9' }); } catch (e) { outro = e; }
  assert.equal(motivoDaRecusaDeFormato(outro), null);
  assert.equal(motivoDaRecusaDeFormato(new Error('qualquer outra coisa')), null);
});

test('o pedido bem formado não produz motivo nenhum', () => {
  assert.doesNotThrow(() => validarPedidoHitlV2(pergunta()));
});

test('todo motivo do catálogo tem descrição e política, sem buraco', () => {
  for (const [motivo, politica] of Object.entries(POLITICA_DE_RETRY)) {
    assert.equal(politica.motivo, motivo, `política de ${motivo} aponta para outro motivo`);
    assert.equal((DESCRICAO_DO_MOTIVO as Record<string, string>)[motivo]?.length > 10, true, motivo);
  }
  // O catálogo é a fonte: nenhum dos dois mapas inventa motivo que não exista nele.
  const catalogo = fs.readFileSync(path.join(__dirname, '../../src/types.ts'), 'utf8');
  const bloco = catalogo.slice(catalogo.indexOf('export type MotivoGate'));
  for (const motivo of Object.keys(POLITICA_DE_RETRY)) {
    assert.ok(bloco.includes(`'${motivo}'`), `${motivo} não está no catálogo MotivoGate`);
  }
});

// ---------------------------------------------------------------------------
// T4, primeira metade: quem consome um pedido deixa de precisar saber a versão dele.
// ---------------------------------------------------------------------------

const v1: PedidoHitl = {
  contrato: 'ork.hitl/v1', id: 'v1-1', thread: 'ork-i41hitlinver', fase: 'GO', modo: 'auto',
  alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
  pergunta: 'Qual é o veredito sobre premissas?',
  opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Revisar', acao: 'recusar' }],
  recomendacao: 'Aprovar', criadoEm: '2026-09-20T19:00:00.000Z', prazo: '2026-09-20T20:00:00.000Z',
  acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'resumo',
};

const decidido: DecisaoInformada = {
  contrato: 'ork.hitl/v2', id: 'd-1', thread: 'ork-i41hitlinver', fase: 'GO', modo: 'auto',
  criadoEm: '2026-09-20T19:00:00.000Z', profundidade: 'resumo', classe: 'decidido',
  decidido: 'O resumo do pulse sai de hora em hora', porque: 'foi o que o dono pediu',
  comoMudar: 'a linha do crontab aceita qualquer cadência',
  custoDeReverter: { agora: 'uma linha', depois: 'uma linha' },
  criterio: { tipo: 'medicao', referencia: 'crontab -l' },
};

test('as escolhas saem na mesma forma nas duas versões; fato consumado não tem nenhuma', () => {
  assert.deepEqual(escolhasDoPedido(v1), v1.opcoes);
  const p = pergunta() as PerguntaAoDono;
  assert.deepEqual(escolhasDoPedido(p), [
    { numero: 1, texto: 'Sim, um resumo por hora', acao: 'aprovar' },
    { numero: 2, texto: 'Não, mantenha por item', acao: 'recusar' },
  ]);
  assert.deepEqual(escolhasDoPedido(decidido), []);
});

test('a única diferença que o dono percebe é o que ele digita: número no v1, letra no v2', () => {
  assert.equal(chaveDaEscolha(v1, 1), '1');
  assert.equal(chaveDaEscolha(v1, 2), '2');
  assert.equal(chaveDaEscolha(pergunta() as PerguntaAoDono, 1), 'a');
  assert.equal(chaveDaEscolha(pergunta() as PerguntaAoDono, 2), 'b');
});

test('a resposta é validada nas duas versões, e o v2 aceita letra e número', () => {
  assert.equal(validarRespostaHitl(v1, '2', v1.criadoEm)?.acao, 'recusar');
  assert.throws(() => validarRespostaHitl(v1, 'b', v1.criadoEm), /opção explícita/);

  const p = pergunta() as PerguntaAoDono;
  assert.equal(validarRespostaHitl(p, 'b', p.criadoEm)?.acao, 'recusar');
  assert.equal(validarRespostaHitl(p, 'B', p.criadoEm)?.acao, 'recusar', 'o celular capitaliza sozinho');
  assert.equal(validarRespostaHitl(p, '2', p.criadoEm)?.acao, 'recusar', 'o número continua aceito');
  assert.throws(() => validarRespostaHitl(p, 'z', p.criadoEm), /opção explícita/);

  // Responder a um fato consumado não é recusa de conteúdo: é não haver o que responder.
  assert.throws(() => validarRespostaHitl(decidido, 'a', decidido.criadoEm), /não aceita resposta/);
});

test('fato consumado não tem relógio: não expira, não escala e não avança', () => {
  assert.equal(estadoDoPedido(decidido, '2030-01-01T00:00:00.000Z'), 'aberto');
  assert.equal(estadoDoPedido(v1, '2030-01-01T00:00:00.000Z'), 'esperar');
  const p = pergunta() as PerguntaAoDono;
  assert.equal(estadoDoPedido(p, '2030-01-01T00:00:00.000Z'), 'seguir-recomendada');
  assert.equal(estadoDoPedido(p, p.criadoEm), 'aberto');
  // A frase que prova que expirar nunca autoriza continua valendo, nas duas versões.
  for (const alvo of [v1, p]) {
    assert.throws(() => validarRespostaHitl(alvo, 'a', '2030-01-01T00:00:00.000Z'),
      /pedido HITL expirado; nenhuma autorização concedida/);
  }
});

test('o veredito do gate sai igual nas duas versões, e fato consumado não tem gate', () => {
  const p = pergunta() as PerguntaAoDono;
  const porV1 = vereditoDoGate(v1, validarRespostaHitl(v1, '1', v1.criadoEm));
  const porV2 = vereditoDoGate(p, validarRespostaHitl(p, 'a', p.criadoEm));
  assert.deepEqual(porV1, { fase: 'GO', sobre: 'premissas', estado: 'aprovado', opcao: 1 });
  assert.deepEqual(porV2, porV1);
  assert.throws(() => vereditoDoGate(decidido, null), /não tem gate: ela não pede nada/);
});

test('prazo, expiração, alvo e texto são lidos sem o consumidor saber a versão', () => {
  const p = pergunta() as PerguntaAoDono;
  assert.equal(prazoDoPedido(v1), v1.prazo);
  assert.equal(prazoDoPedido(p), p.prazo);
  assert.equal(prazoDoPedido(decidido), undefined);
  assert.equal(expiracaoDoPedido(decidido), undefined);
  assert.deepEqual(alvoDoPedido(p), { tipo: 'gate', sobre: 'premissas' });
  assert.equal(alvoDoPedido(decidido), undefined);
  assert.equal(textoDoPedido(v1), v1.pergunta);
  assert.equal(textoDoPedido(p), p.pergunta);
  assert.equal(textoDoPedido(decidido), decidido.decidido);
});

// ---------------------------------------------------------------------------
// T4, segunda metade: a superfície lê as duas versões, e o fato consumado não vira ação.
// ---------------------------------------------------------------------------

test('a apresentação do v1 continua a de antes, linha por linha', () => {
  const { mensagem, escolhas } = apresentarDecisao(v1, v1.criadoEm);
  const linhas = mensagem.split('\n');
  assert.deepEqual(linhas.slice(0, 5), [
    'Orkastery · GO',
    '• Decisão: Qual é o veredito sobre premissas?',
    '• Recomendo: Aprovar',
    '  1. Aprovar',
    '  2. Revisar',
  ]);
  assert.equal(linhas[5], '• Resposta: selecione uma opção no diálogo. Se necessário, digite o número.');
  // O fuso do processo não entra na asserção; o que a T4 muda é a palavra da expiração.
  assert.ok(linhas[6].startsWith('• Prazo: '), linhas[6]);
  assert.ok(linhas[6].endsWith('. Sem resposta, aguardamos.'), linhas[6]);
  assert.equal(linhas.length, 7);
  assert.deepEqual(escolhas, [{ const: '1', title: 'Aprovar' }, { const: '2', title: 'Revisar' }]);
});

test('a apresentação do v2 acrescenta a consequência de cada alternativa e troca o número pela letra', () => {
  const p = pergunta() as PerguntaAoDono;
  const { mensagem, escolhas } = apresentarDecisao(p, p.criadoEm);
  const linhas = mensagem.split('\n');
  assert.deepEqual(linhas.slice(0, 7), [
    'Orkastery · GO',
    '• Decisão: A entrega do pulse pode passar a mandar um resumo por hora?',
    '• Recomendo: a) Sim, um resumo por hora: foi o que você pediu',
    '  a. Sim, um resumo por hora',
    '     → você recebe no máximo 24 por dia',
    '  b. Não, mantenha por item',
    '     → volta a mandar uma mensagem por item',
  ]);
  assert.equal(linhas[7], '• Resposta: selecione uma opção no diálogo. Se necessário, digite a letra.');
  assert.ok(linhas[8].endsWith('. Sem resposta, sigo com a recomendada.'), linhas[8]);
  assert.deepEqual(escolhas, [
    { const: 'a', title: 'Sim, um resumo por hora' },
    { const: 'b', title: 'Não, mantenha por item' },
  ]);
});

test('um fato consumado não vira diálogo: montar um pediria ação por engano', () => {
  assert.throws(() => apresentarDecisao(decidido), /não tem diálogo: ela não pede nada/);
});

test('a recomendação deixa de ser texto solto: ela nomeia uma alternativa que existe', () => {
  const p = pergunta() as PerguntaAoDono;
  const recomendacao = recomendacaoDoPedido(p);
  const letra = recomendacao.slice(0, 1);
  assert.ok(p.alternativas.some(a => a.letra === letra), `a recomendação cita "${letra}", que não é alternativa`);
  assert.equal(p.alternativas.find(a => a.letra === letra)?.recomendada, true);
  assert.match(recomendacao, /: foi o que você pediu$/, 'o porquê vem junto, em uma linha');
  // v1 continua devolvendo o campo livre: esta tarefa não reescreve pedido já gravado.
  assert.equal(recomendacaoDoPedido(v1), v1.recomendacao);
  // A frase genérica de 20/09 não nomeava alternativa nenhuma; era exatamente isto que faltava.
  assert.ok(!/^[a-d]\)/.test('Confira artefatos, claims e riscos antes de responder.'));
  assert.equal(recomendacaoDoPedido(decidido), decidido.porque);
});

test('o motivo tipado é lido nas duas versões, e um fato consumado não tem gate para motivar', () => {
  assert.equal(motivoDoPedido(v1), 'human.pending');
  assert.equal(motivoDoPedido(pergunta() as PerguntaAoDono), 'human.pending');
  assert.equal(motivoDoPedido(decidido), '');
});

test('quem confere recibo aceita a letra E o número: recusar o número não protegeria nada', () => {
  assert.deepEqual(chavesAceitas(v1, 1), ['1']);
  assert.deepEqual(chavesAceitas(v1, 2), ['2']);
  const p = pergunta() as PerguntaAoDono;
  assert.deepEqual(chavesAceitas(p, 1), ['a', '1']);
  assert.deepEqual(chavesAceitas(p, 2), ['b', '2']);
  // Quem lê uma mensagem antiga do terminal digita o número sem saber que a forma mudou.
  for (const chave of chavesAceitas(p, 2)) {
    assert.equal(validarRespostaHitl(p, chave, p.criadoEm)?.acao, 'recusar');
  }
});

test('fato consumado não ganha canal nativo provado: não há o que responder ali', () => {
  const saved = { ...process.env };
  const binding = { host: 'hermes' as const, installationId: 'installation', connectionId: 'connection',
    sessionId: 'session', accountId: 'account', channelId: 'discord', conversationId: 'conversation', personId: 'human' };
  const key = 'fixture-hermes-key-'.repeat(4);
  try {
    process.env = { ...saved };
    for (const name of Object.keys(process.env)) if (name.startsWith('ORK_HITL_')) delete process.env[name];
    Object.assign(process.env, {
      ORK_HITL_NATIVE_KEY_HERMES: key, ORK_HITL_NATIVE_BINDING_HERMES: JSON.stringify(binding),
    });
    const p = pergunta({ prazo: new Date(Date.now() + 600000).toISOString() }) as PerguntaAoDono;
    const assinar = (thread: string, id: string) => {
      const offer = { native: { ...binding, messageId: 'message' }, recebidoEm: new Date().toISOString(), prova: '' };
      offer.prova = nativeOfferSignature(thread, id, offer, key);
      return offer;
    };
    // A mesma oferta, assinada corretamente para cada pedido: o que separa os dois é o relógio.
    assert.equal(provenNativeOffer(p, assinar(p.thread, p.id)), 'hermes');
    assert.equal(provenNativeOffer(decidido, assinar(decidido.thread, decidido.id)), undefined);
  } finally { process.env = saved; }
});

test('o pulse oferece a pergunta das duas versões e nunca o fato consumado', () => {
  const projeto = projetoTemporario('hitl-v2-aberto');
  try {
    const t = novaThread(projeto.carregado, { nome: 'leitura v2', modo: 'auto' }).thread;
    const dir = dirThread(projeto.dir, t.id);
    const consumado = { ...decidido, thread: t.id, fase: 'GO' };
    const aberta = pergunta({ thread: t.id, fase: 'GO' }) as PerguntaAoDono;
    registrar(dir, t.id, 'hitl_requested', { pedido: consumado });
    assert.equal(pedidoHitlAberto(projeto.dir, t.id, 'GO', null), undefined,
      'um fato consumado não segura fase e não pode aparecer como coisa a responder');
    registrar(dir, t.id, 'hitl_requested', { pedido: aberta });
    assert.equal(pedidoHitlAberto(projeto.dir, t.id, 'GO', null)?.id, aberta.id);
    // Respondida deixa de estar aberta, como sempre foi no v1.
    registrar(dir, t.id, 'human_gate', { pedidoId: aberta.id, fase: 'GO', estado: 'aprovado' });
    assert.equal(pedidoHitlAberto(projeto.dir, t.id, 'GO', null), undefined);
  } finally { projeto.limpar(); }
});

test('a linha do relógio só sai para quem tem relógio', () => {
  const base: ItemPulse = {
    id: 'thread:x:GO:human.pending:gate', classe: 'thread', motivo: 'human.pending', thread: 'ork-i41hitlinver',
    fase: 'GO', sessionId: null, desdeEm: '2026-09-20T19:00:00.000Z', paradaHaMin: 12, impacto: 3,
    pergunta: 'Qual é o veredito sobre premissas?', opcoes: ['1. Aprovar'], recomendacao: 'Aprovar',
    comandoResposta: '/ork gate x y <resposta>', evidencia: [], fontes: [], contextoLogs: [],
  };
  const comV1 = mensagemPulse({ ...base, pedido: v1 }, v1.criadoEm);
  assert.match(comV1, /^Pedido: v1-1; prazo: .+; expirar: esperar$/m);
  // Um `decidido` não tem prazo nem ação ao expirar: a linha inteira sai, e com ela o
  // identificador longo, que nunca foi para a superfície humana.
  const comDecidido = mensagemPulse({ ...base, pedido: decidido }, decidido.criadoEm);
  assert.ok(!comDecidido.includes('Pedido: '), comDecidido);
  assert.ok(!comDecidido.includes('prazo: '), comDecidido);
  assert.ok(!mensagemPulse({ ...base }, v1.criadoEm).includes('Pedido: '), 'item sem pedido continua sem a linha');
});

// ---------------------------------------------------------------------------
// T4d: o gate emite v2, e a recomendação passa a nomear uma alternativa.
// ---------------------------------------------------------------------------

/** Abre um gate real e devolve o pedido, para não testar sobre fixture inventada. */
function gateReal(nome: string, preparar: (dir: string, threadId: string) => void, motivo?: string) {
  const projeto = projetoTemporario(nome);
  const t = novaThread(projeto.carregado, { nome, modo: 'classic' }).thread;
  preparar(dirThread(projeto.dir, t.id), t.id);
  const pedido = abrirPedidoGate(projeto.dir, t.id, motivo, '2026-09-20T19:00:00.000Z');
  return { projeto, pedido };
}

const concluida = (dir: string, id: string) => registrar(dir, id, 'phase_result', { fase: 'GOAL' });

test('o gate passa a emitir ork.hitl/v2, e a frase genérica não existe mais no código', () => {
  const { projeto, pedido } = gateReal('gate-v2', concluida);
  try {
    assert.equal(pedido.contrato, 'ork.hitl/v2');
    assert.ok(ehV2(pedido) && pedido.classe === 'pergunta');
    // A frase de 20/09 saiu do CÓDIGO do emissor. Ela sobrevive só onde é citada como o defeito
    // que era: apagar a citação apagaria o registro de por que esta tarefa existiu.
    const generica = 'Confira artefatos, claims e riscos antes de responder.';
    assert.equal(JSON.stringify(pedido).includes(generica), false, 'a frase ainda é emitida');
    const fonte = fs.readFileSync(path.join(__dirname, '../../src/hitl-gates.ts'), 'utf8');
    const emCodigo = fonte.split('\n')
      .filter(l => l.includes(generica) && !/^\s*(\*|\/\/|\/\*)/.test(l));
    assert.deepEqual(emCodigo, [], 'a frase voltou para uma linha de código');
  } finally { projeto.limpar(); }
});

test('a recomendação nomeia uma alternativa que existe, e o porquê sai de fato registrado', () => {
  const casos: [string, (dir: string, id: string) => void, string | undefined, string, RegExp][] = [
    ['conclusao-limpa', concluida, undefined, 'a', /registrou conclusão/],
    ['parecer-negativo', (dir, id) => registrar(dir, id, 'phase_result', { fase: 'GOAL', motivo: 'claims.failed' }),
      undefined, 'b', /o parecer registrado da fase foi claims\.failed/],
    ['escalacao', (dir, id) => registrar(dir, id, 'gate_blocked', { fase: 'GOAL', motivo: 'policy.violation' }),
      'policy.violation', 'a', /escalação tipada policy\.violation/],
  ];
  for (const [nome, preparar, motivo, letra, porque] of casos) {
    const { projeto, pedido } = gateReal(nome, preparar, motivo);
    try {
      assert.ok(ehV2(pedido) && pedido.classe === 'pergunta', nome);
      if (!ehV2(pedido) || pedido.classe !== 'pergunta') continue;
      const recomendadas = pedido.alternativas.filter(a => a.recomendada);
      assert.equal(recomendadas.length, 1, nome);
      assert.equal(recomendadas[0].letra, letra, nome);
      assert.match(recomendacaoDoPedido(pedido), porque, nome);
      // A recomendação começa pela letra de uma alternativa QUE EXISTE: era isso que faltava.
      const citada = recomendacaoDoPedido(pedido).slice(0, 1);
      assert.ok(pedido.alternativas.some(a => a.letra === citada), `${nome}: ${citada}`);
    } finally { projeto.limpar(); }
  }
});

test('cada alternativa do gate diz o que executa e o que acontece', () => {
  const { projeto, pedido } = gateReal('gate-consequencias', concluida);
  try {
    if (!ehV2(pedido) || pedido.classe !== 'pergunta') return assert.fail('pedido não é pergunta v2');
    assert.deepEqual(pedido.alternativas.map(a => a.letra), ['a', 'b', 'c']);
    assert.deepEqual(pedido.alternativas.map(a => a.acao), ['aprovar', 'recusar', 'esperar']);
    for (const a of pedido.alternativas) assert.ok(a.consequencia.length > 0 && !a.consequencia.includes('\n'), a.letra);
    // O corpo carrega a evidência, e a pergunta continua sendo uma frase.
    assert.equal(pedido.pergunta.includes('\n'), false);
    assert.ok(pedido.corpo.some(l => l.startsWith('Fase GOAL, motivo human.pending')), JSON.stringify(pedido.corpo));
  } finally { projeto.limpar(); }
});

test('o gate de motivo irreversível declara o ato, e um gate comum não declara nenhum', () => {
  const escalado = gateReal('gate-dinheiro',
    (dir, id) => registrar(dir, id, 'gate_blocked', { fase: 'GOAL', motivo: 'cost.violation' }), 'cost.violation');
  try {
    if (!ehV2(escalado.pedido) || escalado.pedido.classe !== 'pergunta') return assert.fail('não é pergunta v2');
    assert.equal(escalado.pedido.irreversivel, true);
    assert.equal(escalado.pedido.ato, 'dinheiro');
    // D5, primeira barreira: irreversível nunca combina com avanço por expiração.
    assert.notEqual(escalado.pedido.acaoPadraoAoExpirar, 'seguir-recomendada');
  } finally { escalado.projeto.limpar(); }
  const comum = gateReal('gate-comum', concluida);
  try {
    if (!ehV2(comum.pedido) || comum.pedido.classe !== 'pergunta') return assert.fail('não é pergunta v2');
    assert.equal(comum.pedido.irreversivel, false);
    assert.equal(comum.pedido.ato, undefined);
  } finally { comum.projeto.limpar(); }
});

test('o código curto do gate é curto, digitável e único contra os pedidos da thread', () => {
  const projeto = projetoTemporario('gate-codigo');
  try {
    const codigos = new Set<string>();
    for (const nome of ['um', 'dois', 'tres']) {
      const t = novaThread(projeto.carregado, { nome, modo: 'classic' }).thread;
      registrar(dirThread(projeto.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
      const p = abrirPedidoGate(projeto.dir, t.id, undefined, '2026-09-20T19:00:00.000Z');
      if (!ehV2(p) || p.classe !== 'pergunta') return assert.fail('não é pergunta v2');
      assert.match(p.codigo, /^[0-9A-Za-z]{3,8}$/);
      // O alfabeto não tem o que o dono erraria no celular: I, L, O, U, 0 e 1.
      assert.equal(/[ILOU01]/.test(p.codigo), false, p.codigo);
      assert.notEqual(p.codigo, p.id, 'o código curto não é o identificador longo');
      codigos.add(p.codigo);
    }
    assert.equal(codigos.size, 3);
  } finally { projeto.limpar(); }
});

// ---------------------------------------------------------------------------
// T6: a profundidade é escolha do pedido, e governa SÓ o bloco de evidência.
// ---------------------------------------------------------------------------

test('a profundidade é aceita nas três formas nos cinco modos, e só o v1 ainda a amarra ao modo', () => {
  const modos = ['look', 'ork', 'classic', 'maestro', 'auto'] as const;
  const fundos: ProfundidadeHitl[] = ['resumo', 'detalhada', 'profunda'];
  for (const modo of modos) {
    // Desde a I-43 o v2 so e ESCRITO para modo vivo: thread em #Look ou #Ork e lida para sempre,
    // mas nao abre pedido novo. O v1, congelado, continua julgando os cinco (bloco abaixo).
    if (!modoAposentado(modo)) {
      for (const profundidade of fundos) {
        assert.doesNotThrow(() => validarPedidoHitlV2(pergunta({ modo, profundidade })),
          `v2 recusou ${modo}/${profundidade}`);
      }
    }
    // O validador de v1 continua CONGELADO, e é por isso que a regra antiga sobrevive nele: os
    // três recibos gravados em disco foram julgados por ela, e afrouxá-la mudaria o passado.
    // O que a T6 entrega é que ela deixou de julgar pedido NOVO, porque pedido novo é v2.
    const divergente = fundos.find(f => f !== profundidadeDoModo(modo))!;
    assert.throws(() => validarPedidoHitlV1({ ...v1, modo, profundidade: divergente }),
      /profundidade incompatível com o modo/, modo);
  }
});

test('premissas de GOAL e PLAN nascem em profunda; as outras fases seguem o default do modo', () => {
  for (const modo of ['look', 'ork', 'classic', 'maestro', 'auto'] as const) {
    assert.equal(profundidadeDoPedido('GOAL', modo), 'profunda', modo);
    assert.equal(profundidadeDoPedido('PLAN', modo), 'profunda', modo);
    for (const fase of ['GO', 'CHECK', 'SHIP', 'MASTER'] as const) {
      assert.equal(profundidadeDoPedido(fase, modo), profundidadeDoModo(modo), `${modo}/${fase}`);
    }
  }
  // E o gate real nasce com isso: em 20/09 um pedido de PLAN sobre premissas saiu em `resumo`,
  // sem artefato e sem diff, porque quem mandava era o modo.
  const projeto = projetoTemporario('gate-profundidade');
  try {
    const t = novaThread(projeto.carregado, { nome: 'premissas', modo: 'classic' }).thread;
    registrar(dirThread(projeto.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const pedido = abrirPedidoGate(projeto.dir, t.id, undefined, '2026-09-20T19:00:00.000Z');
    assert.equal(profundidadeDoModo('classic'), 'detalhada', 'o modo sozinho daria detalhada');
    assert.equal(pedido.profundidade, 'profunda', 'a fase sobrepõe o modo em GOAL');
  } finally { projeto.limpar(); }
});

test('a profundidade muda a evidência e NÃO muda uma vírgula da pergunta', () => {
  const projeto = projetoTemporario('profundidade-paridade');
  try {
    const t = novaThread(projeto.carregado, { nome: 'paridade', modo: 'classic' }).thread;
    const dir = dirThread(projeto.dir, t.id);
    fs.writeFileSync(path.join(dir, 'GOAL.md'), '# Objetivo\nRisco: entrega SIMULADA\n');
    commitar(projeto.dir, 'core/src/produto.txt', 'produto\n', 'fixture');
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
    const pedido = abrirPedidoGate(projeto.dir, t.id, undefined, '2026-09-20T19:00:00.000Z');

    const fundos: ProfundidadeHitl[] = ['resumo', 'detalhada', 'profunda'];
    const decisoes = fundos.map(f => apresentarDecisao({ ...pedido, profundidade: f }, pedido.criadoEm));
    // O que o dono LÊ como pergunta é idêntico byte a byte nas três: a profundidade não toca nela.
    assert.equal(new Set(decisoes.map(d => d.mensagem)).size, 1, JSON.stringify(decisoes.map(d => d.mensagem)));
    assert.equal(new Set(decisoes.map(d => JSON.stringify(d.escolhas))).size, 1);

    const evidencias = fundos.map(f => apresentarHitl(projeto.dir, t.id, f));
    assert.deepEqual(evidencias.map(e => e.profundidade), fundos);
    // `resumo` não carrega artefato nem diff; `profunda` carrega os dois. É só isto que varia.
    assert.equal(evidencias[0].artefato, '');
    assert.equal(evidencias[0].diff, '');
    assert.ok(evidencias[2].artefato.includes('Objetivo'));
    assert.ok(evidencias[2].diff.includes('produto.txt'));
    // Os riscos saem do artefato e não dependem da profundidade: o mesmo texto nas três.
    assert.equal(new Set(evidencias.map(e => e.riscos)).size, 1);
  } finally { projeto.limpar(); }
});

test('o pulse compõe a evidência na profundidade do pedido, não na do modo', () => {
  const projeto = projetoTemporario('pulse-profundidade');
  try {
    const t = novaThread(projeto.carregado, { nome: 'evidencia', modo: 'classic' }).thread;
    const dir = dirThread(projeto.dir, t.id);
    fs.writeFileSync(path.join(dir, 'GOAL.md'), '# Objetivo\nPremissa SIMULADA\n');
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
    const pedido = abrirPedidoGate(projeto.dir, t.id, undefined, '2026-09-20T19:00:00.000Z');
    // Sem o pedido, quem manda é o modo. Com ele, manda o pedido, e este nasceu `profunda`
    // por ser GOAL: é exatamente a troca que a T6 entrega.
    assert.equal(apresentarHitl(projeto.dir, t.id).profundidade, 'detalhada');
    assert.equal(apresentarHitl(projeto.dir, t.id, pedido.profundidade).profundidade, 'profunda');
    assert.ok(apresentarHitl(projeto.dir, t.id, pedido.profundidade).artefato.includes('Objetivo'));
  } finally { projeto.limpar(); }
});
