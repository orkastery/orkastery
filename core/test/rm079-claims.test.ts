import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analisarComando, regraFatalDeClaim } from '../src/claim-lint';
import { adicionarClaim, lerClaims, montarClaim, retirarClaim, retirarClaimTipada } from '../src/claims';
import { lintDoBundle } from '../src/ci';
import { abrirPedidoGate } from '../src/hitl-gates';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
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

test('RM079 retirada: substituta ativa precisa ter passado no ultimo verify_run', () => {
  const p = projetoTemporario('rm079-retirada-substituta');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'retirada substituta', modo: 'auto' });
    const antiga = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'regra anterior', semProvaLocal: true });
    const nova = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'regra corrigida', semProvaLocal: true });
    const autor = { tipo: 'sessao' as const, id: 'dispatch-teste' };
    assert.throws(() => retirarClaimTipada(p.dir, thread.id, antiga.id, {
      motivoTipo: 'substituicao', substituidaPor: nova.id, motivo: 'regra corrigida', autor,
    }), /nao passou no ultimo verify_run/);

    registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao, {
      commit: 'head-teste', claims: [{ id: antiga.id, verificado: false }, { id: nova.id, verificado: true }],
      motivos: [], veredito: 'verdade sustentada',
    });
    const resultado = retirarClaimTipada(p.dir, thread.id, antiga.id, {
      motivoTipo: 'substituicao', substituidaPor: nova.id, motivo: 'regra corrigida', autor,
    });
    assert.equal(resultado.estado, 'retirada');
    assert.equal(lerClaims(p.dir, thread.id).find((c) => c.id === antiga.id)?.estado, 'retirada');
    const evento = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.claimRegistrada).at(-1)!;
    assert.equal(evento.tipada, true);
    assert.equal(evento.substituidaPor, nova.id);
    assert.deepEqual(evento.autor, autor);
  } finally { p.limpar(); }
});

test('RM079 retirada: sem substituta preserva a claim e abre pedido tipado ao dono', () => {
  const p = projetoTemporario('rm079-retirada-dono');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'retirada dono', modo: 'auto' });
    const claim = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'regra vigente', semProvaLocal: true });
    const resultado = retirarClaimTipada(p.dir, thread.id, claim.id, {
      motivoTipo: 'obsoleta', motivo: 'o contrato mudou sem regra substituta',
      autor: { tipo: 'sessao', id: 'dispatch-teste' },
    });
    assert.equal(resultado.estado, 'pendente-do-dono');
    assert.notEqual(lerClaims(p.dir, thread.id).find((c) => c.id === claim.id)?.estado, 'retirada');
    const pedido = abrirPedidoGate(p.dir, thread.id, 'claims.retirada-sem-substituta');
    if (!('alvo' in pedido)) assert.fail('a retirada precisa abrir um pedido de gate');
    assert.equal(pedido.alvo?.tipo, 'gate');
    assert.equal(pedido.motivo, 'claims.retirada-sem-substituta');
  } finally { p.limpar(); }
});

test('RM079 retirada: forma livre segue aceita e o ledger declara que nao e tipada', () => {
  const p = projetoTemporario('rm079-retirada-livre');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'retirada livre', modo: 'auto' });
    const claim = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'regra antiga', semProvaLocal: true });
    retirarClaim(p.dir, thread.id, claim.id, 'compatibilidade', { tipo: 'dono', id: 'terminal-local' });
    const evento = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.claimRegistrada).at(-1)!;
    assert.equal(evento.tipada, false);
    assert.deepEqual(evento.autor, { tipo: 'dono', id: 'terminal-local' });
  } finally { p.limpar(); }
});
