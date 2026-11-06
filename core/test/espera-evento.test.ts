import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { esperarEvento, esperarEventoAssincrono, esperarEventoAssincronoDepoisDaFronteira,
  esperarEventoDepoisDaFronteira } from './espera-evento';

test('espera por evento síncrona aceita o resultado depois do limite lógico anterior', () => {
  const limiteAnterior = 3;
  let passo = 0;
  const evento = esperarEvento(
    () => passo > limiteAnterior ? { estado: 'publicado', conteudo: 'esperado' } : null,
    'recibo da fixture',
    { pausar: () => { passo++; } },
  );
  assert.ok(passo > limiteAnterior, 'o relógio anterior não decidiu o resultado');
  assert.deepEqual(evento, { estado: 'publicado', conteudo: 'esperado' });
});

test('espera por evento assíncrona aceita o resultado depois do limite lógico anterior', async () => {
  const limiteAnterior = 3;
  let passo = 0;
  const evento = await esperarEventoAssincrono(
    () => passo > limiteAnterior ? 'linha completa' : null,
    'linha da saída',
    { pausar: async () => { passo++; } },
  );
  assert.ok(passo > limiteAnterior, 'o relógio anterior não decidiu o resultado');
  assert.equal(evento, 'linha completa');
});

test('espera por evento assíncrona faz leituras no intervalo crescente injetado, não nas voltas do event loop', async () => {
  const prazoAnterior = 120;
  let relogio = 0;
  let leituras = 0;
  const pausas: number[] = [];
  const evento = await esperarEventoAssincrono(
    () => { leituras++; return relogio > prazoAnterior ? { estado: 'publicado', conteudo: 'inalterado' } : null; },
    'evento sob relógio injetado',
    { intervaloInicialMs: 10, intervaloMaximoMs: 80, pausar: async (intervaloMs) => {
      pausas.push(intervaloMs);
      relogio += intervaloMs;
    } },
  );
  assert.deepEqual(pausas, [10, 20, 40, 80]);
  assert.equal(leituras, pausas.length + 1, 'cada intervalo produz só a próxima leitura');
  assert.ok(relogio > prazoAnterior, 'o evento chegou depois do prazo lógico anterior');
  assert.deepEqual(evento, { estado: 'publicado', conteudo: 'inalterado' });
});

test('espera por evento falha cedo com a evidência terminal do produtor', () => {
  let pausas = 0;
  assert.throws(
    () => esperarEvento(() => null, 'phase_result', {
      falhaTerminal: () => 'processo saiu sem gravar o evento',
      pausar: () => { pausas++; },
    }),
    /phase_result: processo saiu sem gravar o evento/,
  );
  assert.equal(pausas, 0, 'evidência terminal não consome uma espera arbitrária');
});

test('retenção injetada devolve o mesmo evento real somente depois da fronteira anterior', async () => {
  const original = { estado: 'publicado', conteudo: { id: 'mesmo-evento' } };
  let pausasSincronas = 0;
  const sincrono = esperarEventoDepoisDaFronteira(() => original, 'evento síncrono retido', 30_000,
    { pausar: () => { pausasSincronas++; } });
  assert.equal(sincrono, original);
  assert.equal(pausasSincronas, 1);

  const pausasAssincronas: number[] = [];
  const assincrono = await esperarEventoAssincronoDepoisDaFronteira(async () => original,
    'evento assíncrono retido', 20_000, { pausar: async (intervaloMs) => { pausasAssincronas.push(intervaloMs); } });
  assert.equal(assincrono, original);
  assert.deepEqual(pausasAssincronas, [10]);
});
