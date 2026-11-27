import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderMarkdown } from '../src/security-scan/report';
import type { Finding, ScanReport } from '../src/security-scan/types';

const finding = (over: Partial<Finding>): Finding => ({
  tool: 'semgrep', rule: 'r', category: 'sast', severity: 'high', file: 'a.js', message: 'm',
  fingerprint: 'fp', status: 'new', loop: true, ...over,
});

const report = (findings: Finding[], excluded: string[]): ScanReport => ({
  schema: 'ork.security-scan/v1', base: 'b'.repeat(40), head: 'a'.repeat(40), generatedAt: '2026-11-27T00:00:00.000Z',
  stacks: ['js'], tools: [], findings, excluded,
});

test('report.md: loop, warn and excluded sections handle collections above the call argument limit', () => {
  const amount = 400_000;
  const loop = Array.from({ length: amount }, (_, i) => finding({ rule: `loop-${i}`, line: i + 1, fingerprint: `l${i}` }));
  const warn = Array.from({ length: amount }, (_, i) => finding({
    rule: `warn-${i}`, category: 'quality', severity: 'medium', line: i + 1, fingerprint: `w${i}`, loop: false,
  }));
  const excluded = Array.from({ length: amount }, (_, i) => `dist/excluded-${i}.js`);
  const md = renderMarkdown(report([...loop, ...warn], excluded));
  assert.ok(md.includes(`loop-${amount - 1}`));
  assert.ok(md.includes(`warn-${amount - 1}`));
  assert.ok(md.includes(`dist/excluded-${amount - 1}.js`));
});
