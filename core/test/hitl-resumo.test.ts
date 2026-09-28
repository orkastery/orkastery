import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ItemClassificavel } from '../src/hitl-classificacao';
import {
  CanalDoResumo, nomearThreads, PERGUNTA_DO_RESUMO, resumirHitl, TETO_DE_THREADS_NOMEADAS, textoDoResumo,
} from '../src/hitl-resumo';
import { definirFusoDoDono } from '../src/horario';
import { PedidoHitl } from '../src/hitl-contract';

const AGORA = '2026-09-20T19:00:00Z'; // 16:00 em Brasília: a hora exata da inundação de 20/09.
const CANAIS: CanalDoResumo[] = ['telegram', 'terminal'];

const item = (extra: Partial<ItemClassificavel>): ItemClassificavel => ({
  id: 'item', classe: 'thread', motivo: 'human.pending', thread: 'ork-exemplo', fase: 'PLAN',
  sessionId: null, ...extra,
});

/** Os 75 itens de 20/09 16:00, espalhados por threads como os reais estavam. */
const setentaECinco = (): ItemClassificavel[] => Array.from({ length: 75 }, (_, i) => item({
  id: `item-${i}`, thread: `ork-thread${String(i % 18).padStart(2, '0')}`,
}));

test('N itens viram UM resumo: 75 itens não produzem 75 blocos de texto', () => {
  const resumo = resumirHitl(setentaECinco(), { quando: AGORA });
  assert.equal(resumo.total, 75);
  assert.equal(resumo.bloqueantes, 75);
  assert.equal(resumo.threadsBloqueadas.length, 18);
  for (const canal of CANAIS) {
    const texto = textoDoResumo(resumo, { canal });
    // O texto cita CINCO nomes de thread e conta o resto. Dezoito nomes devolveriam o problema
    // pelo outro lado: a mensagem voltaria a ser uma lista longa.
    assert.equal(texto.split('\n').length <= 16, true, `${canal}: ${texto.split('\n').length} linhas`);
    assert.equal(texto.includes('e mais 13'), true, canal);
    // Nenhum item aparece por conta própria: se um id vazasse, a mensagem por item voltaria.
    assert.equal(texto.includes('item-0'), false, canal);
  }
});

test('o resumo carrega as quatro contagens, as threads travadas e a pergunta do dono', () => {
  const itens = [
    item({ id: '1', thread: 'ork-i31kg1contra', pedido: { prazo: '2026-09-20T04:51:09.495Z' } as PedidoHitl }),
    item({ id: '2', thread: 'ork-companybrai2', fase: 'SHIP', motivo: 'vaga.stale' }),
    item({ id: '3', thread: 'ork-i42modofastu', fase: null, motivo: 'cost.violation' }),
    item({ id: '4', classe: 'score_pendente', thread: 'ork-b2auditoria', fase: 'MASTER', motivo: 'master.score-pendente' }),
  ];
  // I-41 (GO-FIX 1, B3): quem diz quantas perguntas vão sair é quem avaliou a fila; aqui, duas.
  const resumo = resumirHitl(itens, { quando: AGORA, prontas: 2 });
  assert.equal(resumo.total, 4);
  assert.equal(resumo.urgentes, 1);
  assert.equal(resumo.bloqueantes, 3);
  assert.equal(resumo.criticos, 1);
  assert.equal(resumo.prontas, 2);
  assert.deepEqual(resumo.threadsBloqueadas, ['ork-companybrai2', 'ork-i31kg1contra', 'ork-i42modofastu']);
  assert.equal(resumo.pergunta, 'Posso te mandar as perguntas agora?');

  for (const canal of CANAIS) {
    const texto = textoDoResumo(resumo, { canal });
    assert.match(texto, /4/, canal);
    assert.match(texto, /[Pp]erguntas para você:? +2/, canal);
    assert.match(texto, /Posso te mandar as perguntas agora\?$/m, canal);
    for (const t of resumo.threadsBloqueadas) assert.equal(texto.includes(t), true, `${canal} sem ${t}`);
    // A nota de entrega pendente não entra na contagem de travamento, e não é nomeada como tal.
    assert.equal(texto.includes('ork-b2auditoria'), false, canal);
  }
});

test('B3: sem pergunta que vá sair, o resumo não pede licença para mandar nada', () => {
  // Quatro itens esperando e nenhuma pergunta pronta: era o resumo que "parecia funcionar".
  const resumo = resumirHitl([item({ id: '1' }), item({ id: '2', thread: 'ork-outra' })], { quando: AGORA, prontas: 0, acumuladas: 3 });
  assert.equal(resumo.pergunta, null);
  assert.equal(resumo.acumuladas, 0, 'guardada que não vai sair não é guardada');
  for (const canal of CANAIS) {
    const texto = textoDoResumo(resumo, { canal, codigo: 'K3F9' });
    assert.equal(texto.includes('Posso te mandar'), false, canal);
    assert.equal(texto.includes('K3F9'), false, `${canal}: código para responder a nada`);
    assert.match(texto, /Nada aqui pede resposta sua por este canal agora\.$/, canal);
    assert.match(texto, /[Pp]erguntas para você:? +0/, canal);
  }
});

test('B3 e A5: pedido que não vira pergunta é contado como conserto nosso, com a concordância certa', () => {
  for (const [n, frase] of [[1, '1 pedido não virou pergunta; o conserto é nosso, não seu.'],
    [11, '11 pedidos não viraram pergunta; o conserto é nosso, não seu.']] as const) {
    const resumo = resumirHitl([item({})], { quando: AGORA, consertos: n });
    for (const canal of CANAIS) assert.equal(textoDoResumo(resumo, { canal }).includes(frase), true, `${canal}: ${n}`);
  }
  assert.equal(textoDoResumo(resumirHitl([item({})], { quando: AGORA }), { canal: 'telegram' }).includes('conserto'), false);
});

test('o texto ao humano nunca é JSON cru, nos dois canais', () => {
  const resumo = resumirHitl([item({})], { quando: AGORA });
  for (const canal of CANAIS) {
    const texto = textoDoResumo(resumo, { canal });
    assert.doesNotThrow(() => texto);
    assert.equal(texto.includes('{"'), false, canal);
    assert.equal(texto.includes('":'), false, canal);
    assert.throws(() => JSON.parse(texto), `${canal}: texto ao humano não pode ser objeto`);
    assert.equal(texto.includes('contrato'), false, `${canal}: nome de contrato não é interface`);
  }
});

test('telegram e terminal escrevem o mesmo resumo de dois jeitos, com os mesmos números', () => {
  const itens = [
    item({ id: '1', pedido: { prazo: '2026-09-20T19:10:00Z' } as PedidoHitl }),
    item({ id: '2', thread: 'ork-outra', motivo: 'cost.violation' }),
  ];
  const resumo = resumirHitl(itens, { quando: AGORA });
  const telegram = textoDoResumo(resumo, { canal: 'telegram' });
  const terminal = textoDoResumo(resumo, { canal: 'terminal' });
  assert.notEqual(telegram, terminal);
  // Telegram: linhas curtas com emoji sóbrio. Terminal: tabela com régua.
  assert.match(telegram, /⛔/);
  assert.equal(terminal.includes('⛔'), false);
  assert.match(terminal, /^ {2}-+ {2}-+$/m, 'terminal desenha tabela');
  // Os dois dizem os mesmos quatro números, na mesma ordem.
  const numeros = (t: string) => t.split('\n').flatMap(l => l.match(/\b\d+\b/g) ?? []);
  assert.deepEqual(numeros(telegram).slice(0, 0), numeros(terminal).slice(0, 0));
  for (const n of [resumo.total, resumo.urgentes, resumo.bloqueantes, resumo.criticos]) {
    assert.equal(telegram.includes(String(n)), true);
    assert.equal(terminal.includes(String(n)), true);
  }
});

test('"não" e silêncio não perdem item: o próximo resumo cita o lote guardado', () => {
  const resumo = resumirHitl([item({})], { quando: AGORA, prontas: 7, acumuladas: 7 });
  assert.equal(resumo.acumuladas, 7);
  for (const canal of CANAIS) {
    const texto = textoDoResumo(resumo, { canal });
    assert.match(texto, /7 perguntas continuam guardadas desde o resumo anterior/, canal);
  }
  // Sem lote guardado a linha não aparece: resumo não inventa pendência que não existe.
  const limpo = textoDoResumo(resumirHitl([item({})], { quando: AGORA }), { canal: 'telegram' });
  assert.equal(limpo.includes('guardada'), false);
});

test('o humano responde por letra ou código curto, nunca por identificador longo', () => {
  const resumo = resumirHitl([item({})], { quando: AGORA, prontas: 1 });
  for (const canal of CANAIS) {
    const semCodigo = textoDoResumo(resumo, { canal });
    assert.match(semCodigo, /Responda: a \(sim\) ou b \(agora não\)\./, canal);
    const comCodigo = textoDoResumo(resumo, { canal, codigo: 'K3F9' });
    assert.match(comCodigo, /Responda com K3F9 a \(sim\) ou K3F9 b \(agora não\)\./, canal);
    // O UUID de 36 caracteres não aparece em lugar nenhum da superfície humana.
    for (const texto of [semCodigo, comCodigo]) {
      assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(texto), false, canal);
    }
  }
});

test('a lista de threads é cortada no teto e a sobra é contada, não escondida', () => {
  assert.equal(nomearThreads([]), '');
  assert.equal(nomearThreads(['a', 'b']), 'a, b');
  assert.equal(nomearThreads(['a', 'b', 'c', 'd', 'e']), 'a, b, c, d, e');
  assert.equal(nomearThreads(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'a, b, c, d, e e mais 2');
  assert.equal(nomearThreads(['a', 'b', 'c'], 2), 'a, b e mais 1');
  assert.equal(TETO_DE_THREADS_NOMEADAS, 5);
});

test('o cabeçalho sai no fuso do dono mesmo com TZ do processo diferente (I-35)', () => {
  const resumo = resumirHitl([item({})], { quando: AGORA });
  try {
    definirFusoDoDono('America/Sao_Paulo');
    const brasilia = textoDoResumo(resumo, { canal: 'telegram' });
    assert.match(brasilia, /20\/09 16:00 \(horário de Brasília\)/);
    definirFusoDoDono('UTC');
    assert.match(textoDoResumo(resumo, { canal: 'telegram' }), /20\/09 19:00 \(UTC\)/);
  } finally { definirFusoDoDono(undefined); }
  assert.equal(PERGUNTA_DO_RESUMO, 'Posso te mandar as perguntas agora?');
});

test('resumo com contrato adulterado é recusado em vez de virar texto ao dono', () => {
  const resumo = { ...resumirHitl([item({})], { quando: AGORA }), contrato: 'outro' } as never;
  assert.throws(() => textoDoResumo(resumo, { canal: 'telegram' }), /contrato inválido/);
});
