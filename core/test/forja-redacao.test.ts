import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { consultarCiDoRepositorio } from '../src/ci';
import { detalheDoPush, detalheSeguro } from '../src/forja';

const TOKENS = ['ghp_' + 'a'.repeat(36), 'github_pat_' + 'b'.repeat(30), 'glpat-' + 'c'.repeat(20), 'https://u:segredo@h.example/x'];

for (const token of TOKENS) {
  test(`stderr com ${token.slice(0, 6)}… não chega ao detalhe da CI`, () => {
    const r = consultarCiDoRepositorio('o/r', 'a'.repeat(40), 'ork-verify', () => ({ ok: false, code: 1, stdout: '', stderr: `falhou: ${token}` }));
    assert.equal(r.state, 'unavailable');
    assert.doesNotMatch(r.detail, /a{36}|b{30}|c{20}|segredo/);
  });
}

test('token roteável do GitLab (com ponto) e tokens de runner saem inteiros do detalhe', () => {
  const roteavel = `glpat-${'d'.repeat(27)}.01.${'e'.repeat(9)}`;
  const runnerLegado = `GR1348941${'f'.repeat(20)}`;
  const runner = `glrt-${'g'.repeat(20)}`;
  for (const bruto of [`glab: 401 ${roteavel}`, `registro: ${runnerLegado}`, `runner: ${runner}`]) {
    for (const d of [detalheSeguro(bruto), detalheDoPush(bruto)]) {
      assert.match(d, /\[redigido\]/, d);
      assert.doesNotMatch(d, /d{27}|\.01\.|e{9}|f{20}|g{20}/, d);
    }
  }
});
