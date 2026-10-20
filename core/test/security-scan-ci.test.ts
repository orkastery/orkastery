/** O security_scan no bundle do CI: junto do ci.command, e obrigatorio no runner. */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { comandosDoBundle } from '../src/ci';
import type { ManifestoCarregado } from '../src/manifest';

function comVerifyECi(p: ProjetoDeTeste, verify: Record<string, string | undefined>, ciCommand?: string): ManifestoCarregado {
  const base = p.carregado;
  return {
    ...base,
    manifesto: {
      ...base.manifesto,
      verify: { ...verify },
      ci: { ...base.manifesto.ci, command: ciCommand },
    },
  };
}

const PREFIXO = 'ORK_SECURITY_SCAN_REQUIRED=1 ';

test('com ci.command e security_scan, o bundle leva os dois', () => {
  const p = projetoTemporario('security-scan-ci-ambos');
  try {
    const c = comVerifyECi(p, { test: 'npm test', security_scan: 'ork security-scan' }, 'npm run ci');
    assert.deepEqual(comandosDoBundle(c), [
      { name: 'ci', command: 'npm run ci' },
      { name: 'security_scan', command: `${PREFIXO}ork security-scan` },
    ]);
  } finally { p.limpar(); }
});

test('sem ci.command, os comandos do manifesto levam o security_scan prefixado', () => {
  const p = projetoTemporario('security-scan-ci-sem-ci');
  try {
    const c = comVerifyECi(p, { build: 'npm run build', test: 'npm test', security_scan: 'ork security-scan' });
    assert.deepEqual(comandosDoBundle(c), [
      { name: 'build', command: 'npm run build' },
      { name: 'test', command: 'npm test' },
      { name: 'security_scan', command: `${PREFIXO}ork security-scan` },
    ]);
  } finally { p.limpar(); }
});

test('sem security_scan o bundle e o de hoje', () => {
  const p = projetoTemporario('security-scan-ci-ausente');
  try {
    assert.deepEqual(comandosDoBundle(comVerifyECi(p, { test: 'npm test' }, 'npm run ci')), [{ name: 'ci', command: 'npm run ci' }]);
    assert.deepEqual(comandosDoBundle(comVerifyECi(p, { test: 'npm test' })), [{ name: 'test', command: 'npm test' }]);
  } finally { p.limpar(); }
});
