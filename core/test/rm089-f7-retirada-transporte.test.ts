import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (arquivo: string) => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

test('o runtime retirado não deixa módulo, tipo, ambiente ou entrada executável', () => {
  assert.equal(fs.existsSync(path.join(RAIZ, 'core/src/ci-fabrica-transporte.ts')), false);
  assert.doesNotMatch(ler('core/src/types.ts'), /ConfiguracaoPublicaDoTransporteCi|transporte_excecao/);
  assert.doesNotMatch(ler('core/src/forja/ambiente-de-ci.ts'), /identidadeNativaDoAmbienteCi/);
  assert.doesNotMatch(ler('core/src/ci.ts'), /integrarResultadoDoTransporteNoCi|transporteProtegido/);
  assert.doesNotMatch(ler('core/test/horario-entradas.test.ts'), /ci-fabrica-transporte/);
});
