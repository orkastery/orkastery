import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { consultarCiDoRepositorio } from '../src/ci';

const TOKENS = ['ghp_' + 'a'.repeat(36), 'github_pat_' + 'b'.repeat(30), 'glpat-' + 'c'.repeat(20), 'https://u:segredo@h.example/x'];

for (const token of TOKENS) {
  test(`stderr com ${token.slice(0, 6)}… não chega ao detalhe da CI`, () => {
    const r = consultarCiDoRepositorio('o/r', 'a'.repeat(40), 'ork-verify', () => ({ ok: false, code: 1, stdout: '', stderr: `falhou: ${token}` }));
    assert.equal(r.state, 'unavailable');
    assert.doesNotMatch(r.detail, /a{36}|b{30}|c{20}|segredo/);
  });
}
