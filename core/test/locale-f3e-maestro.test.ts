/** RM-061 F3e: snapshots pt-BR/en do painel e da ajuda do Maestro. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAESTRO_LIMITS, MAESTRO_SCHEMA, SECTION_NAMES, validateMaestroSnapshot } from '../src/maestro-contract';
import { maestroText, runMaestroCli } from '../src/maestro-cli';
import { msg } from '../src/locale';
import { linhasEmPortugues } from './locale-apoio';

const snapshot = () => validateMaestroSnapshot({
  schema: MAESTRO_SCHEMA, observedAt: '2026-09-18T00:00:00.000Z', fingerprint: 'a'.repeat(64),
  project: { id: 'ork', name: 'Orkastery', origin: 'installation', fingerprint: 'b'.repeat(64), remote: null },
  limits: MAESTRO_LIMITS,
  sections: Object.fromEntries(SECTION_NAMES.map((name) => [name, { state: 'empty', source: name,
    observedAt: '2026-09-18T00:00:00.000Z', fingerprint: 'c'.repeat(64),
    coverage: { total: 0, offset: 0, returned: 0, omitted: 0, nextOffset: null, limit: 50 }, items: [], gaps: [] }])),
  gaps: [], conflicts: [],
});

test('locale pt-BR F3e maestro: painel preserva a moldura publica', () => {
  const texto = maestroText(snapshot(), msg('pt-BR').maestro);
  assert.match(texto, /^Orkastery · panorama Maestro$/m);
  assert.match(texto, /^• Projeto consultado: Orkastery · sem remoto · fixado na instalação$/m);
  assert.match(texto, /^• Recomendo: escolher uma thread para ver o detalhe\.$/m);
  assert.match(texto, /Use ork maestro --json para cobertura e ações/);
});

test('locale en F3e maestro: painel e ajuda saem em ingles; JSON fica identico', () => {
  const s = snapshot(), ptJson = JSON.stringify(s), enJson = JSON.stringify(s);
  const texto = maestroText(s, msg('en').maestro);
  assert.match(texto, /^Orkastery · Maestro overview$/m);
  assert.match(texto, /^• Project read: Orkastery · no remote · fixed by the installation$/m);
  assert.match(texto, /^• Recommendation: choose a thread to read its details\.$/m);
  assert.deepEqual(linhasEmPortugues(texto, SECTION_NAMES), []);
  assert.equal(enJson, ptJson);

  let ajuda = '';
  assert.equal(runMaestroCli(['--help'], process.cwd(), {}, { out: (v) => { ajuda = v; }, err: assert.fail }, msg('en').maestro), 0);
  assert.match(ajuda, /Read without creating or dispatching work/);
  assert.deepEqual(linhasEmPortugues(ajuda, ['orkastery maestro']), []);
});
