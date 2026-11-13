import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const raiz = path.resolve(__dirname, '../../..');

test('referências públicas descrevem o comando local nos dois idiomas', () => {
  const pt = fs.readFileSync(path.join(raiz, 'docs/referencia/cli.md'), 'utf8');
  const en = fs.readFileSync(path.join(raiz, 'docs/referencia/cli.en.md'), 'utf8');
  for (const texto of [pt, en]) {
    assert.match(texto, /ork telemetria maturidade --desde ISO --ate ISO \[--json\]/);
    assert.match(texto, /seis indicadores|six agentic indicators/);
    assert.match(texto, /não confirmado|unconfirmed/);
  }
});

test('changelog mantém a F5 em Não publicado e preserva RM-089', () => {
  const texto = fs.readFileSync(path.join(raiz, 'CHANGELOG.md'), 'utf8');
  const naoPublicado = texto.slice(texto.indexOf('## Não publicado'), texto.indexOf('## [0.6.8]'));
  assert.match(naoPublicado, /SDLC Analytics por maestro e por time — F5 \(RM-090\)/);
  assert.match(naoPublicado, /Inscrição na rede coletiva/);
  assert.match(naoPublicado, /Reserva coletiva obrigatória — F2 \(RM-089\)/);
  assert.match(naoPublicado, /sem nota, peso, ranking ou meta/);
});

test('publicação não altera roadmap nem incorpora identidade empresarial', () => {
  const arquivos = ['docs/referencia/cli.md', 'docs/referencia/cli.en.md', 'CHANGELOG.md'];
  const trecho = arquivos.map((arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8'))
    .filter((texto) => texto.includes('telemetria maturidade') || texto.includes('SDLC Analytics')).join('\n');
  assert.equal(trecho.includes('orkastery.team.id'), false);
  assert.equal(trecho.includes('orkastery.maestro.id'), false);
});
