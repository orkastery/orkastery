/**
 * RM-048 (itens 1, 4 e 5): o contrato UNICO de apresentacao de um pedido ao dono.
 *
 * O que se prova aqui, sempre pelo texto que o dono le e nunca por estrutura interna:
 *  - no pior caso (4 alternativas, corpo cheio, ato sem volta, expiracao que avanca) o pedido
 *    cabe em 15 linhas, nos dois canais;
 *  - exatamente uma alternativa sai recomendada, com o porque;
 *  - a ultima linha diz o que digitar, com o codigo curto e nunca com identificador longo;
 *  - Telegram e terminal carregam o mesmo conteudo, com marcadores diferentes;
 *  - o pedido v1 continua saindo com o texto de antes.
 *
 * Identidades e threads SIMULADAS; nenhum canal real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { CONTRATO_PEDIDO_CURTO, entradaDoPedido, montarPedidoCurto, TETO_DE_LINHAS_DO_PEDIDO,
  textoDoPedidoCurto } from '../src/hitl-curto';
import { PerguntaAoDono, PedidoHitl } from '../src/hitl-contract';
import { apresentarDecisao } from '../src/hitl-presentation';
import { apresentacaoCurtaDoItem } from '../src/pulse';
import { dirThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { main } from '../src/index';

const QUANDO = '2026-09-28T22:10:00.000Z';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function pior(): PerguntaAoDono {
  return {
    contrato: 'ork.hitl/v2', classe: 'pergunta', id: '5fdcb00b-0000-4000-8000-000000000001', thread: 'ork-simulada',
    fase: 'SHIP', modo: 'classic', criadoEm: '2026-09-28T19:00:00.000Z', profundidade: 'detalhada',
    alvo: { tipo: 'gate', sobre: 'push' }, motivo: 'human.pending',
    pergunta: 'Qual é o veredito sobre push?',
    alternativas: (['a', 'b', 'c', 'd'] as const).map((letra, i) => ({
      letra, texto: `Alternativa ${letra} com um texto de tamanho razoável para o celular`,
      acao: (['aprovar', 'recusar', 'esperar', 'responder'] as const)[i],
      consequencia: `consequência da alternativa ${letra}, em uma linha só`,
      ...(i === 1 ? { recomendada: true as const, porque: 'o parecer da fase pede revisão antes do push' } : {}),
    })),
    corpo: Array.from({ length: 8 }, (_, i) => `evidência ${i + 1} da fase, que só cabe no detalhe`),
    tipoDeResposta: 'objetiva', irreversivel: true, ato: 'push-base-protegida', codigo: 'DE6H',
    prazo: '2026-09-28T23:00:00.000Z', acaoPadraoAoExpirar: 'escalar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 100 },
  };
}

const semMarcadores = (t: string) => t
  .replace(/🔔 |❓ |⏳ |↩️ |🔒 |✅ |• |\[|\]|Orkastery · |Pergunta: |Situação: |^! |^- /gm, '')
  .split('\n').map(l => l.replace(/ +/g, ' ').trim()).join('\n');

test('pior caso: 4 alternativas, corpo cheio e ato sem volta cabem em 15 linhas nos dois canais', () => {
  const curto = montarPedidoCurto(entradaDoPedido(pior(), '2026-09-28T19:00:00.000Z'),
    { quando: QUANDO, responder: { tipo: 'codigo', codigo: 'DE6H' } });
  assert.equal(curto.contrato, CONTRATO_PEDIDO_CURTO);
  for (const canal of ['telegram', 'terminal'] as const) {
    const texto = textoDoPedidoCurto(curto, canal);
    const linhas = texto.split('\n');
    assert.ok(linhas.length <= TETO_DE_LINHAS_DO_PEDIDO, `${canal}: ${linhas.length} linhas`);
    // O corpo cheio (8 linhas) fica no detalhe: só 2 entram na pergunta curta.
    assert.equal(linhas.filter(l => /evidência \d da fase/.test(l)).length, 2, canal);
    // Uma alternativa por linha, com a consequência junto.
    for (const letra of ['a', 'b', 'c', 'd']) {
      assert.ok(linhas.some(l => l.startsWith(`${letra}) Alternativa ${letra}`) && l.includes(`consequência da alternativa ${letra}`)), `${canal} ${letra}`);
    }
    // Exatamente uma recomendada, e é a declarada no pedido, com o porquê logo abaixo.
    const marca = canal === 'telegram' ? '✅ Recomendação' : '[Recomendação]';
    assert.equal(linhas.filter(l => l.includes(marca)).length, 1, canal);
    const i = linhas.findIndex(l => l.includes(marca));
    assert.ok(linhas[i].startsWith('b) '), canal);
    assert.equal(linhas[i + 1], '   porquê: o parecer da fase pede revisão antes do push');
    // O que trava, desde quando e o que acontece sem resposta, em uma linha.
    assert.ok(linhas.some(l => /A fase SHIP está parada esperando você desde .*\(há 3h10\)\. Sem resposta até .*, o pedido é escalado\./.test(l)), canal);
    // O ato sem volta é dito, nunca escondido.
    assert.ok(linhas.some(l => l.includes('Sem volta depois de feito: faz push na base protegida.')), canal);
    // A última linha diz o que digitar: o código curto e a letra recomendada. Nada de UUID.
    assert.match(linhas.at(-1)!, /DE6H b \(ou outra letra\).*Evidências: DE6H detalhes\./, canal);
    assert.equal(UUID.test(texto), false, `${canal}: identificador longo vazou`);
  }
});

test('Telegram e terminal dizem a mesma coisa: só o marcador muda', () => {
  const curto = montarPedidoCurto(entradaDoPedido(pior()), { quando: QUANDO, responder: { tipo: 'codigo', codigo: 'DE6H' } });
  const telegram = textoDoPedidoCurto(curto, 'telegram'), terminal = textoDoPedidoCurto(curto, 'terminal');
  assert.equal(terminal.includes('✅'), false);
  assert.match(telegram, /^🔔 ork-simulada · SHIP$/m);
  assert.match(terminal, /^Orkastery · ork-simulada · SHIP$/m);
  // Tirados os marcadores, as linhas batem uma a uma, menos a de resposta, que diz o canal.
  const t = semMarcadores(telegram).split('\n'), r = semMarcadores(terminal).split('\n');
  assert.equal(t.length, r.length);
  assert.deepEqual(t.slice(0, -1), r.slice(0, -1));
  assert.match(r.at(-1)!, /^Responda pelo Telegram: DE6H b/);
});

test('o contrato recusa em vez de cortar: 0 ou 2 recomendadas, 1 ou 6 alternativas', () => {
  const base = entradaDoPedido(pior());
  const responder = { tipo: 'codigo', codigo: 'DE6H' } as const;
  assert.throws(() => montarPedidoCurto({ ...base, alternativas: base.alternativas.map(a => ({ ...a, recomendada: undefined })) },
    { quando: QUANDO, responder }), /exatamente uma/);
  assert.throws(() => montarPedidoCurto({ ...base, alternativas: base.alternativas.map(a => ({ ...a, recomendada: { porque: 'x' } })) },
    { quando: QUANDO, responder }), /exatamente uma/);
  assert.throws(() => montarPedidoCurto({ ...base, alternativas: base.alternativas.slice(0, 1) }, { quando: QUANDO, responder }), /de 2 a 5/);
  assert.throws(() => montarPedidoCurto({ ...base, alternativas: [...base.alternativas, base.alternativas[1], base.alternativas[1]] },
    { quando: QUANDO, responder }), /de 2 a 5/);
});

test('o item do pulse leva o texto curto e a linha com o código estável, não o UUID', () => {
  const p = pior();
  const curta = apresentacaoCurtaDoItem(p, '2026-09-28T19:00:00.000Z', QUANDO)!;
  assert.equal(curta.comando, 'DE6H b');
  assert.equal(UUID.test(curta.textos.telegram), false);
  assert.equal(UUID.test(curta.textos.terminal), false);
  assert.match(curta.textos.telegram, /↩️ Responda: DE6H b/);
  // Pedido de sessão não tem código de gate: o item continua com o comando de antes.
  assert.equal(apresentacaoCurtaDoItem({ ...p, alvo: { tipo: 'session', sessionId: 'sessao-SIMULADA', runtime: 'claude-bg' } },
    null, QUANDO), undefined);
});

test('o diálogo do host usa o contrato curto no v2 e mantém o texto do v1 byte a byte', () => {
  const v2 = apresentarDecisao(pior(), QUANDO).mensagem.split('\n');
  assert.ok(v2.length <= TETO_DE_LINHAS_DO_PEDIDO);
  assert.equal(v2.at(-1), 'Responda selecionando a opção no diálogo; digitar a letra também vale.');
  const v1: PedidoHitl = { contrato: 'ork.hitl/v1', id: 'v1-SIMULADO', thread: 'ork-simulada', fase: 'GO', modo: 'classic',
    alvo: { tipo: 'gate', sobre: 'evidencias' }, motivo: 'human.pending', pergunta: 'Aprovar?',
    opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Revisar', acao: 'recusar' }],
    recomendacao: 'Aprovar', criadoEm: '2026-09-28T19:00:00.000Z', prazo: '2026-09-28T20:00:00.000Z',
    acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'detalhada' };
  const linhas = apresentarDecisao(v1, v1.criadoEm).mensagem.split('\n');
  assert.deepEqual(linhas.slice(0, 6), ['Orkastery · GO', '• Decisão: Aprovar?', '• Recomendo: Aprovar', '  1. Aprovar', '  2. Revisar',
    '• Resposta: selecione uma opção no diálogo. Se necessário, digite o número.']);
});

test('ork gate request --formato devolve o gate no contrato curto, com o código e sem UUID', () => {
  const p = projetoTemporario('hitl-curto-cli');
  const cwd = process.cwd(), log = console.log;
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'curto classic', modo: 'classic' });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    process.chdir(p.dir);
    let saida = ''; console.log = (s: unknown) => { saida += String(s) + '\n'; };
    assert.equal(main(['gate', 'request', t.id, '--formato', 'telegram']), 0);
    const linhas = saida.trim().split('\n');
    assert.match(linhas[0], new RegExp(`^🔔 ${t.id} · GOAL$`));
    assert.ok(linhas.length <= TETO_DE_LINHAS_DO_PEDIDO);
    assert.match(linhas.at(-1)!, /^↩️ Responda: [A-Z2-9]{4} a \(ou outra letra\)\. Evidências: [A-Z2-9]{4} detalhes\.$/);
    assert.equal(UUID.test(saida), false);
    // A mesma chamada sem --formato continua devolvendo o JSON de sempre, para quem integra.
    saida = '';
    assert.equal(main(['gate', 'request', t.id]), 0);
    assert.equal(JSON.parse(saida).contrato, 'ork.hitl/v2');
    assert.throws(() => main(['gate', 'request', t.id, '--formato', 'html']), /--formato telegram\|terminal/);
  } finally { console.log = log; process.chdir(cwd); p.limpar(); }
});
