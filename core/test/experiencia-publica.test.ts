import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const scan = require('../../scripts/checar-experiencia-publica.cjs');

test('padrões públicos detectam fixtures sintéticas e não confundem referências de pacote', () => {
  const padrao = new RegExp(scan.PADROES.join('|'), 'i');
  for (const exemplo of [ ['fixture', 'example.invalid'].join('@'), ['/home', 'fixture', 'repo'].join('/'),
    ['chat_id', '-123456'].join('='), [192, 168, 1, 2].join('.'), ['fixture', 'internal'].join('.') ]) {
    assert.equal(padrao.test(exemplo), true);
  }
  assert.equal(padrao.test('@orkastery/cli, owner.language, exemplos públicos'), false);
});

test('arquivo ausente e falha de execução não podem produzir varredura verde', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-publico-'));
  try {
    assert.throws(() => scan.varrer({ raiz, arquivos: ['ausente'] }));
    fs.writeFileSync(path.join(raiz, 'publico'), 'produto genérico');
    for (const r of [{ status: 2, stderr: 'fixture' }, { status: 1, error: Error('EPERM') }, { status: 0, stdout: '' }]) {
      assert.throws(() => scan.varrer({ raiz, arquivos: ['publico'], executar: () => r }));
    }
    const ok = scan.varrer({ raiz, arquivos: ['publico'], executar: () => ({ status: 1, stdout: '' }) });
    assert.equal(ok.ok, true); assert.equal(ok.examinados, 1);
    const achado = scan.varrer({ raiz, arquivos: ['publico'], executar: () => ({ status: 0, stdout: 'publico\n' }) });
    assert.equal(achado.ok, false); assert.deepEqual(achado.arquivos, ['publico']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('lista complementar permanece fora do repositório e conteúdo não aparece no resultado', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-repo-'));
  const externo = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-externo-'));
  try {
    const interno = path.join(raiz, 'termos'); fs.writeFileSync(interno, 'FIXTURE_PRIVADA');
    assert.throws(() => scan.termosExternos(interno, raiz), /externo/);
    const arquivo = path.join(externo, 'termos'); fs.writeFileSync(arquivo, 'FIXTURE_PRIVADA\n');
    assert.deepEqual(scan.termosExternos(arquivo, raiz), ['FIXTURE_PRIVADA']);
    const resultado = scan.varrer({ raiz, arquivos: ['termos'], termos: ['FIXTURE_PRIVADA'], executar: () => ({ status: 0, stdout: 'termos\n' }) });
    assert.ok(!JSON.stringify(resultado).includes('FIXTURE_PRIVADA'));
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); fs.rmSync(externo, { recursive: true, force: true }); }
});
