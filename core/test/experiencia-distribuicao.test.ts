import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
const ensaio = require('../../scripts/testar-experiencia-e2e.cjs');

test('ensaio aponta ao binário instalado e usa tarball/prefixo locais sem instalação neste teste', () => {
  const p = ensaio.comandosDistribuicao('/tmp/fonte', '/tmp/ensaio', '/tmp/ensaio/pacote.tgz');
  assert.equal(p.pack.cwd, '/tmp/fonte/core'); assert.equal(p.pack.bin, 'npm');
  assert.ok(p.pack.args.includes('pack'));
  assert.equal(p.install.args.at(-1), '/tmp/ensaio/pacote.tgz');
  assert.ok(p.install.args.includes('--offline')); assert.ok(p.install.args.includes('--ignore-scripts'));
  assert.equal(p.binario, '/tmp/ensaio/prefixo/node_modules/.bin/ork');
});

test('ambiente filho isolado não altera HOME do condutor nem transporta credenciais', () => {
  const anterior = { HOME: '/tmp/condutor', PATH: '/usr/bin', SECRET_SYNTHETIC: 'fixture' };
  const env = ensaio.ambienteIsolado('/tmp/ensaio', anterior);
  assert.equal(env.HOME, '/tmp/ensaio/home'); assert.equal(anterior.HOME, '/tmp/condutor');
  assert.equal(env.SECRET_SYNTHETIC, undefined); assert.equal(env.ORK_FABRICA_PUBLICAR, '0');
  assert.equal(env.PATH.split(path.delimiter)[0], '/tmp/ensaio/prefixo/node_modules/.bin', 'ork do tarball antes do global');
});

test('prova do ensaio falha para bytes divergentes, arquivo inesperado ou bloco duplicado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensaio-logica-')), arquivo = path.join(dir, 'AGENTS.md');
  try {
    ensaio.conferirBytes(arquivo, null);
    fs.writeFileSync(arquivo, 'antes\r\n'); ensaio.conferirBytes(arquivo, Buffer.from('antes\r\n'));
    assert.throws(() => ensaio.conferirBytes(arquivo, Buffer.from('antes\n')));
    assert.throws(() => ensaio.conferirBytes(arquivo, null));
    assert.throws(() => ensaio.conferirBloco(arquivo));
    const bloco = '<!-- orkastery:experiencia:begin -->\n<!-- orkastery:experiencia:end -->\n';
    fs.writeFileSync(arquivo, bloco); ensaio.conferirBloco(arquivo);
    fs.writeFileSync(arquivo, bloco + bloco); assert.throws(() => ensaio.conferirBloco(arquivo));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
