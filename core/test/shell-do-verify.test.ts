import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { argvDoItem } from '../src/check-paralelo';
import { resolverShellDoVerify } from '../src/shell-do-verify';
import { executar, verificarClaim } from '../src/verify';
import type { Claim } from '../src/types';

test('resolver escolhe caminho absoluto fixo sem consultar PATH ou override', () => {
  const antigoPath = process.env.PATH, antigoOverride = process.env.ORK_BASH;
  process.env.PATH = '/caminho/hostil'; process.env.ORK_BASH = '/fora/da/fabrica/bash';
  try {
    const shell = resolverShellDoVerify({ candidatos: ['/bin/bash', '/usr/bin/bash'], seguro: () => true,
      versao: (caminho) => caminho === '/bin/bash' ? '3.2.57' : '5.2.0' });
    assert.deepEqual(shell, { caminho: '/bin/bash', versao: '3.2.57' });
  } finally {
    if (antigoPath === undefined) delete process.env.PATH; else process.env.PATH = antigoPath;
    if (antigoOverride === undefined) delete process.env.ORK_BASH; else process.env.ORK_BASH = antigoOverride;
  }
});

test('executor registra shell e o grupo paralelo usa o mesmo caminho', () => {
  const shell = { caminho: '/bin/bash', versao: '3.2.57' };
  const resultado = executar('fixture', 'true', process.cwd(), 5000, undefined, undefined, shell);
  assert.equal(resultado.ok, true); assert.deepEqual(resultado.shell, shell);
  assert.ok(argvDoItem({ nome: 'fixture', comando: 'true', cwd: process.cwd(), prazoMs: 5000 }, false, false, shell)[0] === shell.caminho);
});

test('shell ausente deixa a claim sem veredito, nunca claims.failed', () => {
  assert.equal(resolverShellDoVerify({ candidatos: [] }), null);
  const executor = (nome: string, comando: string, cwd: string) => executar(nome, comando, cwd, 5000, undefined, undefined, null);
  const claim: Claim = { id: 'C1', thread: 'ork-fixture', fase: 'GO', arquivo: 'core/src/verify.ts', alegacao: 'fixture',
    negativa: false, verificar: ['true'], criadoEm: new Date().toISOString(), estado: 'pendente' };
  const veredito = verificarClaim(claim, process.cwd(), executor);
  assert.equal(veredito.verificado, false); assert.equal(veredito.motivo, 'verify.sem-veredito');
  assert.equal(veredito.execucoes[0].executado, false); assert.equal(veredito.execucoes[0].causa, 'nao-encontrado');
  assert.throws(() => argvDoItem({ nome: 'fixture', comando: 'true', cwd: process.cwd(), prazoMs: 5000 }, false, false, null),
    /shell do verify/);
});
