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

test('o resultado forte anterior não permanece no recibo F5 nem na configuração de análise', () => {
  for (const arquivo of ['core/src/ci-fabrica-recibo.ts', 'core/src/ci-recibo-forte.ts',
    'core/test/rm089-f7-recibo-forte.test.ts']) {
    assert.equal(fs.existsSync(path.join(RAIZ, arquivo)), false, arquivo);
  }
  assert.doesNotMatch(ler('core/src/ci-recibo-basico.ts'), /AssinaturaDoReciboForteCi|assinatura\?:/);
  assert.doesNotMatch(ler('.ork-security/eslint.config.mjs'), /rm089-f7-recibo-forte|rm089-f7-transporte-excecao/);
});

test('as superfícies de código e modelos ficam sem o transporte anterior', () => {
  assert.equal(fs.existsSync(path.join(RAIZ, '.github/workflows/ork-excecao-transporte.yml')), false);
  for (const arquivo of ['templates/gitlab/ork-verify.yml', 'templates/ork-verify/template.yml',
    'core/package.json', 'core/package-lock.json', 'core/src/manifest.ts', 'core/src/index.ts']) {
    assert.doesNotMatch(ler(arquivo), /excecao-transporte|transporte_excecao|ORK_TRANSPORTE|ORK_FABRICA_ID_TOKEN|bundleDependencies|inBundle/, arquivo);
  }
  assert.doesNotMatch(ler('core/src/forja/github/ci.ts'), /EvidenciaCanonicaGithubCi|evidenciaCanonicaDoGithub/);
  assert.doesNotMatch(ler('core/src/forja/gitlab/ci.ts'), /EvidenciaCanonicaGitlabCi|evidenciaCanonicaDoGitlab/);
  assert.match(ler('.github/workflows/ci.yml'), /persist-credentials:\s*false/);
});
