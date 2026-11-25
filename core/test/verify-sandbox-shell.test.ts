import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { criarExecutorSandbox, ResultadoSandbox } from '../src/verify-sandbox';

test('executor sandbox usa na execução e no recibo o shell medido', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-sandbox-shell-'));
  const wt = path.join(base, 'wt');
  fs.mkdirSync(wt);
  const shell = { caminho: '/usr/bin/bash', versao: '5.3.0-rc1' };
  let entrada: { args: string[] } | undefined;
  const executor = criarExecutorSandbox({
    worktree: wt,
    shellDoVerify: shell,
    executarSupervisor: (recebida) => {
      entrada = recebida;
      return {
        status: 0,
        stdout: JSON.stringify({ code: 0, stdout: '', stderr: '', failure: null, cleanupComplete: true }),
        stderr: '',
      };
    },
  });
  try {
    const resultado = executor.executar('fixture', 'true', wt) as ResultadoSandbox;
    assert.deepEqual(entrada?.args.slice(-3), ['/usr/bin/bash', '-c', 'true']);
    assert.deepEqual(resultado.shell, shell);
  } finally {
    executor.fechar();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
