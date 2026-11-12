import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const raiz = path.resolve(__dirname, '../../..');
const arquivos = ['collector-loki.yaml', 'collector-otlp.yaml'];

for (const arquivo of arquivos) test(`${arquivo} mantém pipeline DORA separada e fechada`, () => {
  const texto = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', arquivo), 'utf8');
  assert.match(texto, /logs\/orkastery:[\s\S]*logs\/dora:/);
  assert.match(texto, /logs\/dora:[\s\S]*filter\/dora, transform\/dora-sanitize, transform\/dora-policy/);
  assert.match(texto, /orkastery\.sdlc\.deployment\.v1/);
  assert.match(texto, /orkastery\.sdlc\.incident\.v1/);
  assert.match(texto, /Len\(log\.attributes\) != 9/);
  assert.match(texto, /Len\(resource\.attributes\) != 2/);
  assert.match(texto, /log\.attributes\["user\.hash"\] != nil or resource\.attributes\["service\.namespace"\] != nil/);
  assert.match(texto, /ORK_DORA_USER_HASH/);
  assert.match(texto, /ORK_DORA_SERVICE_NAMESPACE/);
  assert.match(texto, /team_source_missing/);
});

test('pipeline original recusa DORA e preserva os fatos analíticos publicados', () => {
  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', arquivo), 'utf8');
    assert.match(texto, /IsMatch\(log\.event_name, "\^orkastery\\\\\.sdlc/);
    for (const atributo of ['orkastery.receipt.contract', 'orkastery.receipt.policy.version',
      'orkastery.push.verified', 'orkastery.go_fix.round', 'orkastery.finding.id']) {
      assert.equal(texto.includes(`"${atributo}"`), true, atributo);
    }
  }
});

test('README exige overlay privado e não promete validação operacional hermética', () => {
  const texto = fs.readFileSync(path.join(raiz, 'templates', 'telemetria', 'README.md'), 'utf8');
  assert.match(texto, /overlay privado com TLS e autenticação/);
  assert.match(texto, /conferência externa fica fora do gate hermético/);
  assert.match(texto, /proximidade de horário não cria vínculo/);
});
