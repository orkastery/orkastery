import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
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
    assert.equal(ok.termosExternos, 0, 'sem lista externa, a saída diz que nomes pessoais não foram procurados');
    assert.equal(scan.varrer({ raiz, arquivos: ['publico'], termos: ['A', 'B'], executar: () => ({ status: 1, stdout: '' }) }).termosExternos, 2);
    const achado = scan.varrer({ raiz, arquivos: ['publico'], executar: () => ({ status: 0, stdout: 'publico\n' }) });
    assert.equal(achado.ok, false); assert.deepEqual(achado.arquivos, ['publico']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('sem binário no PATH, como no runner hospedado, a varredura acha o padrão e aprova o limpo', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-sem-path-'));
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-path-vazio-')), anterior = process.env.PATH;
  process.env.PATH = vazio;
  try {
    fs.writeFileSync(path.join(raiz, 'limpo'), 'produto genérico FIXTUREXPRIVADA\n');
    fs.writeFileSync(path.join(raiz, 'sujo'), 'contato ' + ['fixture', 'example.invalid'].join('@') + '\n');
    const achado = scan.varrer({ raiz, arquivos: ['limpo', 'sujo'] });
    assert.equal(achado.ok, false); assert.deepEqual(achado.arquivos, ['sujo']);
    assert.equal(scan.varrer({ raiz, arquivos: ['limpo'], termos: ['FIXTURE.PRIVADA'] }).ok, true, 'termo externo é literal');
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/checar-experiencia-publica.cjs')],
      { env: { PATH: vazio }, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
  } finally {
    if (anterior === undefined) delete process.env.PATH; else process.env.PATH = anterior;
    fs.rmSync(raiz, { recursive: true, force: true }); fs.rmSync(vazio, { recursive: true, force: true });
  }
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

test('a lista cobre os arquivos novos e os alterados pela RM-051', () => {
  for (const arquivo of ['core/src/hosts.ts', 'core/src/onboarding.ts', 'CHANGELOG.md', 'adapters/claude-code/.claude-plugin/plugin.json',
    'skills/core/orchestration-experience/SKILL.md', 'docs/produto/FEAT-034-pacote-de-experiencia.md']) {
    assert.ok(scan.ARQUIVOS.includes(arquivo), arquivo);
  }
  assert.equal(new Set(scan.ARQUIVOS).size, scan.ARQUIVOS.length);
});
