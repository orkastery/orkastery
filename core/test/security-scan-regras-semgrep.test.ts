/**
 * RM-074 M7 (ork-semgrepincre): as regras do registro do Semgrep que só cruzam arquivos no motor Pro não impedem o
 * reaproveitamento no `semgrep scan` do catálogo. O registro responde em YAML, como no ar. `mode: join`, o motor Pro e
 * a marca fora de `options` e `metadata` continuam forçando a varredura inteira. Os nomes começam por "SR".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolverRegrasSemgrep } from '../src/security-scan/incremental';
import { loadTools } from '../src/security-scan/tools';
import type { ToolSpec } from '../src/security-scan/types';

const SEMGREP = loadTools().find((t) => t.name === 'semgrep')!;
const JS = [{ stack: 'js' as const, dir: '.' }];
const REGRA = 'rules:\n- id: regra\n  languages:\n  - javascript\n  message: achado de teste\n  severity: ERROR\n  pattern: perigo(...)\n';
const registro = (corpo: string) => (): string => REGRA + corpo;
const comArgsJs = (trocar: (args: string[]) => string[]): ToolSpec =>
  ({ ...SEMGREP, argsByStack: { ...SEMGREP.argsByStack, js: trocar([...SEMGREP.argsByStack!.js!]) } });

test('SR1: interfile em options, no semgrep scan sem Pro, deixa o achado por arquivo reaproveitável', () => {
  const r = resolverRegrasSemgrep(SEMGREP, JS, registro('  options:\n    symbolic_propagation: true\n    interfile: true\n'));
  assert.equal(r.reutilizavel, true);
  assert.ok(r.hash);
  assert.equal(r.motivo, undefined);
  assert.deepEqual(r.referencias, ['p/javascript', 'p/nodejs', 'p/typescript']);
});

test('SR2: interfile em metadata é rótulo do registro e não muda o reaproveitamento, nem com o motor Pro', () => {
  const corpo = '  metadata:\n    interfile: true\n    cwe:\n    - "CWE-798"\n';
  assert.equal(resolverRegrasSemgrep(SEMGREP, JS, registro(corpo)).reutilizavel, true);
  assert.equal(resolverRegrasSemgrep(comArgsJs((a) => [...a, '--pro']), JS, registro(corpo)).reutilizavel, true);
});

test('SR3: no motor Pro, interfile em options cruza arquivos e força a varredura inteira', () => {
  const corpo = '  options:\n    interfile: true\n';
  for (const pro of [comArgsJs((a) => [...a, '--pro']), comArgsJs((a) => a.map((x) => x === 'scan' ? 'ci' : x)),
    { ...SEMGREP, env: { ...SEMGREP.env, SEMGREP_APP_TOKEN: 'falso' } }]) {
    const r = resolverRegrasSemgrep(pro, JS, registro(corpo));
    assert.equal(r.reutilizavel, false);
    assert.equal(r.motivo, 'regra-entre-arquivos');
    assert.equal(r.hash, null);
  }
});

test('SR4: mode join cruza arquivos em qualquer motor, em YAML e em JSON', () => {
  for (const resposta of [REGRA + '  mode: join\n  join:\n    on: []\n',
    '{"rules":[{"id":"entre-arquivos","mode":"join","join":{"on":[]}}]}']) {
    assert.equal(resolverRegrasSemgrep(SEMGREP, JS, () => resposta).motivo, 'regra-entre-arquivos');
  }
});

test('SR5: marca fora de options e metadata, em linha de fluxo ou em texto continua conservadora', () => {
  for (const corpo of ['  interfile: true\n', '  options: {interfile: true}\n', '  options:\n    interfile: sempre\n',
    '  metadata:\n    references:\n    - veja como fazer join\n']) {
    assert.equal(resolverRegrasSemgrep(SEMGREP, JS, registro(corpo)).motivo, 'regra-entre-arquivos', corpo);
  }
});

test('SR6: a resposta em JSON segue a mesma regra do lugar da marca', () => {
  const json = (lugar: string): string => JSON.stringify({ rules: [{ id: 'regra', pattern: 'perigo(...)', [lugar]: { interfile: true } }] });
  assert.equal(resolverRegrasSemgrep(SEMGREP, JS, () => json('options')).reutilizavel, true);
  assert.equal(resolverRegrasSemgrep(SEMGREP, JS, () => json('metadata')).reutilizavel, true);
  assert.equal(resolverRegrasSemgrep(comArgsJs((a) => [...a, '--pro']), JS, () => json('options')).reutilizavel, false);
});
