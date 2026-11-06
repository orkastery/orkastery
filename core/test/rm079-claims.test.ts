import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analisarComando, regraFatalDeClaim } from '../src/claim-lint';
import { adicionarClaim, lerClaims, montarClaim } from '../src/claims';
import { lintDoBundle } from '../src/ci';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

const regras = (comando: string) => analisarComando(comando).map((a) => a.regra);

test('RM079 lint: contexto artificial recebe aviso sem recusar a claim', () => {
  const comandos = [
    `node -e "require('typescript').createSourceFile('x.ts', 'const x=1', 99)"`,
    `node -e "require('vm').runInNewContext('1 + 1')"`,
    `node -e "const f = new Function('return 1'); f()"`,
  ];
  for (const comando of comandos) {
    assert.ok(regras(comando).includes('contexto-artificial'), comando);
  }
  assert.equal(regraFatalDeClaim('contexto-artificial'), false);

  const p = projetoTemporario('rm079-lint-contexto');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'lint contexto', modo: 'auto' });
    const claim = adicionarClaim(p.dir, thread.id, {
      arquivo: 'README.md', alegacao: 'a API publica preserva o resultado esperado',
      verificar: [comandos[0]], semProvaLocal: true,
    });
    assert.deepEqual(claim.lint?.map((a) => a.regra), ['contexto-artificial']);
    assert.equal(lerClaims(p.dir, thread.id).at(-1)?.id, claim.id);
    assert.deepEqual(lintDoBundle([claim]).recusas, []);
  } finally { p.limpar(); }
});

test('RM079 lint: artefato de fechamento recebe aviso sem recusar a claim', () => {
  const comandos = [
    'grep -q verificado .ork-ci/ork-exemplo.json',
    'grep -q PASSOU docs/check.md',
    'node -e "require(\'fs\').readFileSync(\'POSTMORTEM.json\')"',
  ];
  for (const comando of comandos) {
    assert.ok(regras(comando).includes('artefato-de-fechamento'), comando);
  }
  assert.equal(regraFatalDeClaim('artefato-de-fechamento'), false);
  const claim = montarClaim({ id: 'C1', dono: 'ork-x', fase: 'GO', arquivo: 'README.md',
    alegacao: 'a fonte versionada gera o recibo esperado', verificar: [comandos[0]] });
  const lint = lintDoBundle([claim]);
  assert.deepEqual(lint.recusas, []);
  assert.ok(lint.avisos.some((linha) => linha.includes('artefato gerado pelo fechamento')));
});

test('RM079 lint: comandos no contexto real permanecem sem os avisos novos', () => {
  for (const comando of [
    'node --test core/dist-test/test/rm079-claims.test.js',
    'grep -q contexto-artificial core/src/claim-lint.ts',
    'node core/dist/index.js claims list ork-exemplo',
  ]) {
    assert.equal(regras(comando).includes('contexto-artificial'), false, comando);
    assert.equal(regras(comando).includes('artefato-de-fechamento'), false, comando);
  }
});
