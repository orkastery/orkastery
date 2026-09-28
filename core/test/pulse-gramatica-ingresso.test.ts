/**
 * I-41 (GO-FIX 1): a forma da resposta ao pulse tem UM domicilio, o nucleo, e duas copias
 * obrigatorias, os ingressos do Telegram. Se um adaptador reconhecesse uma forma que o nucleo
 * nao entende, a mensagem do dono sumiria; se deixasse de reconhecer uma que o nucleo entende, ela
 * iria para o assistente em vez de virar resposta. Este teste compara as tres, texto a texto.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GRAMATICA_DO_PULSE } from '../src/pulse-resposta';

test('a gramática do ingresso é a MESMA no núcleo e nos dois adaptadores do Telegram', () => {
  const raiz = path.resolve(__dirname, '../../..');
  const hermes = fs.readFileSync(path.join(raiz, 'adapters/hermes/hitl-ingress/__init__.py'), 'utf8');
  const fonte = fs.readFileSync(path.join(raiz, 'adapters/openclaw/src/hitl-ingress.ts'), 'utf8');
  const dist = fs.readFileSync(path.join(raiz, 'adapters/openclaw/dist/hitl-ingress.js'), 'utf8');
  for (const padrao of Object.values(GRAMATICA_DO_PULSE)) {
    assert.ok(hermes.includes(`r'${padrao}'`), `hermes divergiu: ${padrao}`);
    assert.ok(fonte.includes(JSON.stringify(padrao)), `openclaw (fonte) divergiu: ${padrao}`);
    assert.ok(dist.includes(JSON.stringify(padrao)), `openclaw (dist) divergiu: ${padrao}`);
  }
  // O endereço assinado também é o mesmo nos três.
  assert.match(hermes, /PULSE_ALVO, PULSE_ENDERECO = 'pulse', 'resposta'/);
  assert.match(fonte, /const PULSE_ALVO = 'pulse', PULSE_ENDERECO = 'resposta';/);
});

