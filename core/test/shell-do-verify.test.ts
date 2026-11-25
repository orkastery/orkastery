import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { argvDoItem, rodarEmParalelo } from '../src/check-paralelo';
import { resolverShellDoVerify, versaoDoBashValida } from '../src/shell-do-verify';
import { executar, verificarClaim } from '../src/verify';
import type { Claim } from '../src/types';

test('resolver escolhe caminho absoluto fixo sem consultar PATH ou override', () => {
  const antigoPath = process.env.PATH, antigoOverride = process.env.ORK_BASH;
  process.env.PATH = '/caminho/hostil'; process.env.ORK_BASH = '/fora/da/fabrica/bash';
  try {
    const shell = resolverShellDoVerify();
    assert.ok(shell); assert.equal(['/bin/bash', '/usr/bin/bash'].includes(shell.caminho), true);
    assert.notEqual(shell.caminho, process.env.ORK_BASH);
  } finally {
    if (antigoPath === undefined) delete process.env.PATH; else process.env.PATH = antigoPath;
    if (antigoOverride === undefined) delete process.env.ORK_BASH; else process.env.ORK_BASH = antigoOverride;
  }
});

test('versão aceita sufixos oficiais do Bash sem aceitar texto livre', () => {
  for (const versao of ['5.3.0(1)-rc1', '5.2.37(1)-release', '5.2.37-maint'])
    assert.equal(versaoDoBashValida(versao), true, versao);
  for (const versao of ['5.2.37 texto', 'bash 5.2.37', '5.2.37;id'])
    assert.equal(versaoDoBashValida(versao), false, versao);
});

test('executor registra shell e o grupo paralelo usa o mesmo caminho', () => {
  const shell = { caminho: '/bin/bash', versao: '3.2.57' };
  const resultado = executar('fixture', 'true', process.cwd(), 5000, undefined, undefined, shell);
  assert.equal(resultado.ok, true); assert.deepEqual(resultado.shell, shell);
  assert.ok(argvDoItem({ nome: 'fixture', comando: 'true', cwd: process.cwd(), prazoMs: 5000 }, false, false, shell)[0] === shell.caminho);
  const esperado = resolverShellDoVerify(); assert.ok(esperado);
  const [paralelo] = rodarEmParalelo([{ nome: 'default', comando: 'true', cwd: process.cwd(), prazoMs: 5000 }], process.env);
  assert.equal(paralelo.ok, true); assert.deepEqual(paralelo.shell, esperado);
});

test('sonda da versão e comando do verify não executam BASH_ENV nem ENV do chamador', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-shell-env-'));
  const marca = path.join(dir, 'executou');
  const antigo = { BASH_ENV: process.env.BASH_ENV, ENV: process.env.ENV };
  fs.writeFileSync(path.join(dir, 'init.sh'), `printf executou > ${JSON.stringify(marca)}\n`);
  process.env.BASH_ENV = path.join(dir, 'init.sh'); process.env.ENV = path.join(dir, 'init.sh');
  try {
    assert.ok(resolverShellDoVerify());
    assert.equal(executar('sem-init', 'true', process.cwd(), 5000).ok, true);
    assert.equal(fs.existsSync(marca), false);
  } finally {
    if (antigo.BASH_ENV === undefined) delete process.env.BASH_ENV; else process.env.BASH_ENV = antigo.BASH_ENV;
    if (antigo.ENV === undefined) delete process.env.ENV; else process.env.ENV = antigo.ENV;
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  const [paralelo] = rodarEmParalelo([
    { nome: 'sem-shell', comando: 'true', cwd: process.cwd(), prazoMs: 5000 },
  ], process.env, { shellDoVerify: null });
  assert.equal(paralelo.ok, false); assert.equal(paralelo.error, 'ENOENT');
});
