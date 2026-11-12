import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { CONTRATO_SDLC_ANALYTICS, REGISTRO_DE_INDICADORES_AGENTICOS } from '../src/telemetria-maturidade-registro';

const raiz = path.resolve(__dirname, '../../..');
const arquivos = ['docs/guias/telemetria-opentelemetry.pt-BR.md', 'docs/guias/telemetria-opentelemetry.md'];

for (const arquivo of arquivos) test(`${arquivo} publica fórmulas, fontes, cobertura e lacunas`, () => {
  const texto = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
  for (const definicao of REGISTRO_DE_INDICADORES_AGENTICOS) {
    assert.equal(texto.includes(`${definicao.id}/v1`), true, definicao.id);
  }
  assert.match(texto, /popula|population/i);
  assert.match(texto, /cobertura|coverage/i);
  assert.match(texto, /lacuna|gap/i);
  assert.match(texto, /deduplic/i);
});

test('contratos DORA e identidade de política aparecem nos dois idiomas', () => {
  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    assert.equal(texto.includes(CONTRATO_SDLC_ANALYTICS.eventos.deployment), true);
    assert.equal(texto.includes(CONTRATO_SDLC_ANALYTICS.eventos.incident), true);
    for (const atributo of ['incidentId', 'incidentState', 'incidentDeploymentId',
      'incidentRecoveryDeploymentId'] as const) assert.equal(texto.includes(CONTRATO_SDLC_ANALYTICS.atributos[atributo]), true);
    assert.match(texto, /service\.namespace/);
    assert.match(texto, /team_source_missing/);
    assert.match(texto, /TLS/);
  }
});

test('documentação separa DORA e não promete dado ou equivalência ausente', () => {
  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(raiz, arquivo), 'utf8').toLowerCase();
    assert.match(texto, /dora.*separad|dora remains separate/s);
    assert.match(texto, /não confirmad|unconfirmed/);
    assert.equal(texto.includes('orkastery.team.id` é'), false);
  }
});
