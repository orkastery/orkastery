/** verify.security_scan: a chave opcional e o 4o comando do verify. */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { carregarManifesto, comandosDoTextoDoManifesto, NOME_MANIFESTO } from '../src/manifest';
import { comandosDoManifesto, prazoDoComando } from '../src/verify';

/** Troca o bloco `verify:` do manifesto do projeto temporario pelo texto dado. */
function comVerify(p: ProjetoDeTeste, linhas: string): void {
  const yaml = path.join(p.dir, NOME_MANIFESTO);
  const bruto = fs.readFileSync(yaml, 'utf8');
  const novo = bruto.replace(/^verify:\n(?:[ \t].*\n|\n)*?(?=\S)/m, `verify:\n${linhas}\n\n`);
  assert.notEqual(novo, bruto);
  fs.writeFileSync(yaml, novo, 'utf8');
}

test('manifesto aceita verify.security_scan', () => {
  const p = projetoTemporario('security-scan-manifesto');
  try {
    comVerify(p, '  test: "npm test"\n  security_scan: "ork security-scan"');
    const c = carregarManifesto(p.dir);
    assert.ok(c);
    assert.deepEqual(c.erros, []);
    assert.equal(c.manifesto.verify.security_scan, 'ork security-scan');
  } finally { p.limpar(); }
});

test('prazo proprio do security_scan', () => {
  const p = projetoTemporario('security-scan-prazo');
  try {
    comVerify(p, '  test: "npm test"\n  security_scan: "ork security-scan"\n  timeout_ms_por_comando:\n    security_scan: 900000');
    const c = carregarManifesto(p.dir);
    assert.ok(c);
    assert.deepEqual(c.erros, []);
    assert.equal(prazoDoComando(c.manifesto, 'security_scan'), 900000);
  } finally { p.limpar(); }
});

test('security_scan e o ultimo comando', () => {
  const p = projetoTemporario('security-scan-ordem');
  try {
    comVerify(p, '  security_scan: "ork security-scan"\n  test: "npm test"\n  build: "npm run build"\n  typecheck: "npm run typecheck"');
    const c = carregarManifesto(p.dir);
    assert.ok(c);
    assert.deepEqual(comandosDoManifesto(c.manifesto).map((x) => x.nome), ['typecheck', 'build', 'test', 'security_scan']);
  } finally { p.limpar(); }
});

test('sem a chave nada muda', () => {
  const p = projetoTemporario('security-scan-ausente');
  try {
    comVerify(p, '  test: "npm test"');
    const c = carregarManifesto(p.dir);
    assert.ok(c);
    assert.equal(c.manifesto.verify.security_scan, undefined);
    assert.deepEqual(comandosDoManifesto(c.manifesto), [{ nome: 'test', comando: 'npm test' }]);
  } finally { p.limpar(); }
});

test('texto do manifesto', () => {
  const r = comandosDoTextoDoManifesto('verify:\n  test: "npm test"\n  security_scan: "ork security-scan"\n');
  assert.equal(r?.securityScan, 'ork security-scan');
  assert.equal(comandosDoTextoDoManifesto('verify:\n  test: "npm test"\n')?.securityScan, undefined);
});
