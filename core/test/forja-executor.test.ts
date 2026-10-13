import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { rodarCli } from '../src/forja/executor';
import * as antigo from '../src/forja';
import * as contrato from '../src/forja/contrato';
import { ghPadrao } from '../src/parado-no-condutor';

/** Um `gh` falso que devolve o proprio ambiente e o stdin, para o teste ver o que chegou ao processo. */
function ghEspiao(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-exec-'));
  fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\nprintf "HOST=%s PROMPT=%s ENTRADA=" "$GH_HOST" "$GH_PROMPT_DISABLED"; cat\n', { mode: 0o755 });
  return dir;
}

test('rodarCli passa o stdin, acrescenta e apaga variaveis do ambiente', () => {
  const dir = ghEspiao();
  const antes = process.env.PATH, host = process.env.GH_HOST;
  process.env.PATH = `${dir}:${antes}`; process.env.GH_HOST = 'herdado.example';
  try {
    const r = rodarCli({ cmd: 'gh', args: [], entrada: 'corpo', prazoMs: 5000, maxBuffer: 1024 * 1024,
      apagar: ['GH_HOST'], acrescentar: { GH_PROMPT_DISABLED: '1' } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'HOST= PROMPT=1 ENTRADA=corpo');
  } finally { process.env.PATH = antes; if (host === undefined) delete process.env.GH_HOST; else process.env.GH_HOST = host; }
});

test('CLI ausente sai como ENOENT, que o classificarFalha ja trata', () => {
  const r = rodarCli({ cmd: 'glab', args: ['--version'], prazoMs: 5000, maxBuffer: 1024,
    acrescentar: { PATH: '/nao/existe', ORK_BINARIOS_EXTRA: '' } });
  assert.equal(antigo.classificarFalha('glab', r).codigo, 'forja.ausente');
});

test('forja.ts reexporta os tipos de forja/contrato sem mudar o nome', () => {
  const tipo: contrato.TipoDeForja = 'github';
  const mesmo: antigo.TipoDeForja = tipo;
  assert.equal(mesmo, 'github');
  assert.equal(typeof antigo.executorPadrao, 'function');
});

test('procurarBinario:false nao acha binario so de ORK_BINARIOS_EXTRA; o padrao acha', () => {
  const dir = ghEspiao();
  const base = { cmd: 'gh' as const, args: [], prazoMs: 5000, maxBuffer: 1024 };
  const amb = { PATH: '/nao/existe', ORK_BINARIOS_EXTRA: dir };
  assert.equal(rodarCli({ ...base, acrescentar: amb, procurarBinario: false }).erro, 'ENOENT');
  assert.equal(rodarCli({ ...base, acrescentar: amb }).erro, undefined);
});

test('ghPadrao mapeia erro de spawn para stderr com a mensagem do erro', () => {
  const antes = process.env.PATH, extra = process.env.ORK_BINARIOS_EXTRA;
  process.env.PATH = '/nao/existe'; process.env.ORK_BINARIOS_EXTRA = '';
  try {
    const r = ghPadrao(['--version'], 5000);
    assert.equal(r.status, null);
    assert.match(r.stderr, /ENOENT/);
    assert.notEqual(r.stderr, 'ENOENT');
  } finally {
    process.env.PATH = antes;
    if (extra === undefined) delete process.env.ORK_BINARIOS_EXTRA; else process.env.ORK_BINARIOS_EXTRA = extra;
  }
});
