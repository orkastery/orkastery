#!/usr/bin/env node
/**
 * RM-031 KG4 (D10): agente simulado para testar o harness da rodada paga sem abrir sessao paga.
 *
 * Le o prompt no stdin e escreve telemetria no formato `stream-json`: o `init` com a sessao, duas
 * mensagens do assistente com uso (a primeira repetida, como o runtime faz por bloco) e uma chamada de
 * ferramenta, e o resultado com o texto de `ORK_KG4_RESPOSTA` (sem ela, o proprio prompt). O braco B
 * (o prompt cita o grafo deterministico) gasta menos, para o veredito ter o que comparar. Com
 * `ORK_KG4_MARCA`, anota cada sessao aberta nesse arquivo.
 */
'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');

let entrada = '';
process.stdin.on('data', (c) => {
  entrada += c;
});
process.stdin.on('end', () => {
  if (process.env.ORK_KG4_MARCA) fs.appendFileSync(process.env.ORK_KG4_MARCA, 'sessao\n');
  const id = createHash('sha256').update(`${entrada}\u0000${process.pid}\u0000${process.hrtime.bigint()}`).digest('hex').slice(0, 16);
  const b = entrada.includes('pelo grafo deterministico');
  const uso1 = { input_tokens: b ? 60 : 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 };
  const uso2 = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: b ? 50 : 150, output_tokens: 25 };
  const linhas = [
    { type: 'system', subtype: 'init', session_id: `sim-${id}` },
    { type: 'assistant', message: { id: `msg_${id}_1`, usage: uso1, content: [{ type: 'tool_use', id: `tu_${id}_1`, name: 'Bash', input: {} }] } },
    { type: 'assistant', message: { id: `msg_${id}_1`, usage: uso1, content: [{ type: 'text', text: 'lendo' }] } },
    { type: 'assistant', message: { id: `msg_${id}_2`, usage: uso2, content: [{ type: 'text', text: 'pronto' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: process.env.ORK_KG4_RESPOSTA ?? entrada },
  ];
  process.stdout.write(`${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`);
});
