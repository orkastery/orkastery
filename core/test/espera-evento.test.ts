import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { esperarEvento, esperarEventoAssincrono } from './espera-evento';

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
