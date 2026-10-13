import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { rodarCli } from '../src/forja/executor';
import * as antigo from '../src/forja';
import * as contrato from '../src/forja/contrato';

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
