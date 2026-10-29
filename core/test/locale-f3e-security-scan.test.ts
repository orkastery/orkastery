/** RM-061 F3e: o security-scan traduz só a apresentação humana; report.json continua sendo dado. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { comLocale, msg } from '../src/locale';
import { renderMarkdown } from '../src/security-scan/report';
import type { ScanReport, ToolRun } from '../src/security-scan/types';
import { linhasEmPortugues } from './locale-apoio';

const report: ScanReport = {
  schema: 'ork.security-scan/v1', base: 'b'.repeat(40), head: 'a'.repeat(40), generatedAt: '2026-10-29T00:00:00.000Z',
  stacks: [], excluded: [], findings: [],
  tools: [{ name: 'scanner', category: 'sast', version: '1', executor: null, state: 'failed',
    reason: 'security-scan.parse: scanner: expected a JSON object', counts: {} as ToolRun['counts'] }],
};

test('locale pt-BR F3e security-scan: motivos conhecidos são traduzidos só no humano', () => {
  const jsonAntes = JSON.stringify(report);
  const md = comLocale('pt-BR', () => renderMarkdown(report));
  assert.match(md, /security-scan\.parse: scanner: era esperado um objeto JSON/);
  assert.equal(msg('pt-BR').securityScan.error('security-scan.dismissal-invalid: (no fingerprint)'),
    'security-scan.dismissal-invalid: (sem fingerprint)');
  assert.equal(JSON.stringify(report), jsonAntes);
});

test('locale en F3e security-scan: apresentação inglesa e dado canônico coincidem', () => {
  const md = comLocale('en', () => renderMarkdown(report));
  assert.match(md, /security-scan\.parse: scanner: expected a JSON object/);
  assert.deepEqual(linhasEmPortugues(md, ['security-scan.parse']), []);
  assert.equal(msg('en').securityScan.error('security-scan.config-invalid: config.json: expected an object'),
    'security-scan.config-invalid: config.json: expected an object');
});

