/**
 * Testes de claims, `ork verify` com baseline e policies executaveis.
 *
 * A regra que estes testes protegem: self-report nao vale. Toda alegacao e reexecutada
 * no HEAD real, e a diferenca contra a baseline separa REGRESSAO de divida pre-existente.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  adicionarClaim,
  anexarComando,
  ehAlegacaoNegativa,
  lerClaims,
  retirarClaim,
} from '../src/claims';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { avaliarPolicies, policiesDesconhecidas } from '../src/policies';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { gravarBaseline, verificar } from '../src/verify';
import { projetoTemporario } from './apoio';

test('claim verdadeira passa e claim falsa reprova, com motivo tipado', () => {
  const projeto = projetoTemporario('verify-claims');
  const { thread } = novaThread(projeto.carregado, { nome: 'claims', modo: 'auto' });
  fs.writeFileSync(path.join(projeto.dir, 'artefato.md'), '# artefato\nconteudo real\n', 'utf8');

  adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'artefato.md',
    alegacao: 'o artefato contem o conteudo real',
    verificar: ['grep -q "conteudo real" artefato.md'],
  });
  adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'artefato.md',
    alegacao: 'o artefato menciona a secao de rollback',
    verificar: ['grep -q "rollback" artefato.md'],
  });

  const r = verificar(projeto.carregado, thread.id);

  assert.equal(r.claims.length, 2);
  const c1 = r.claims.find((c) => c.claim.id === 'C1');
  const c2 = r.claims.find((c) => c.claim.id === 'C2');
  assert.equal(c1?.verificado, true);
  assert.equal(c1?.motivo, null);
  assert.equal(c2?.verificado, false);
  assert.equal(c2?.motivo, 'claims.failed');
  assert.match(c2?.detalhe ?? '', /codigo 1/);
  assert.equal(r.ok, false);
  assert.deepEqual(r.motivos, ['claims.failed']);
  assert.match(r.commit, /^[0-9a-f]{40}$/, 'a verificacao carimba o HEAD real');

  // O estado da claim fica carimbado no proprio claims.jsonl.
  const gravadas = lerClaims(projeto.dir, thread.id);
  assert.equal(gravadas.find((c) => c.id === 'C1')?.estado, 'verificado');
  assert.equal(gravadas.find((c) => c.id === 'C2')?.estado, 'reprovado');

  // Ledger: verify_run com o veredito, e gate_blocked com o motivo tipado.
  const eventos = lerLedger(dirThread(projeto.dir, thread.id));
  const run = eventos.find((e) => e.tipo === 'verify_run');
  assert.ok(run);
  assert.equal(run.veredito, 'reprovado');
  const bloqueio = eventos.find((e) => e.tipo === 'gate_blocked');
  assert.equal(bloqueio?.motivo, 'claims.failed');
  assert.equal(bloqueio?.gate, 'verify');

  projeto.limpar();
});

test('alegacao negativa sem comando de verificacao reprova (o caso EvoJ6)', () => {
  const projeto = projetoTemporario('verify-negativa');
  const { thread } = novaThread(projeto.carregado, { nome: 'evoj6', modo: 'auto' });

  const negativa = adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'relatorio.md',
    alegacao: 'nenhum teste do projeto falha depois da mudanca',
    verificar: [],
  });
  const positiva = adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'relatorio.md',
    alegacao: 'o relatorio descreve a mudanca',
    verificar: [],
  });
  assert.equal(negativa.negativa, true);
  assert.equal(positiva.negativa, false);

  const r = verificar(projeto.carregado, thread.id);
  const cNegativa = r.claims.find((c) => c.claim.id === negativa.id);
  const cPositiva = r.claims.find((c) => c.claim.id === positiva.id);

  // Negativa sem comando BLOQUEIA; positiva sem comando so avisa.
  assert.equal(cNegativa?.verificado, false);
  assert.equal(cNegativa?.motivo, 'claims.failed');
  assert.match(cNegativa?.detalhe ?? '', /nao ha como comprova-la/);
  assert.equal(cPositiva?.motivo, 'claims.unverifiable');
  assert.equal(r.ok, false);
  assert.ok(r.motivos.includes('claims.failed'));
  assert.ok(r.motivos.includes('claims.unverifiable'));

  // Correcao 1: anexar o comando que comprova a alegacao. A claim volta a valer.
  anexarComando(projeto.dir, thread.id, negativa.id, 'true');
  const comComando = verificar(projeto.carregado, thread.id);
  assert.equal(comComando.claims.find((c) => c.claim.id === negativa.id)?.verificado, true);
  assert.equal(comComando.motivos.includes('claims.failed'), false);

  // Correcao 2: retirar a alegacao, com motivo. Ela sai do gate e fica no historico.
  retirarClaim(projeto.dir, thread.id, positiva.id, 'a fase seguinte reescreveu o relatorio');
  const depoisDaRetirada = verificar(projeto.carregado, thread.id);
  assert.equal(
    depoisDaRetirada.claims.some((c) => c.claim.id === positiva.id),
    false,
    'claim retirada sai do gate'
  );
  assert.equal(depoisDaRetirada.ok, true);
  const historico = lerClaims(projeto.dir, thread.id).find((c) => c.id === positiva.id);
  assert.equal(historico?.estado, 'retirada');
  assert.equal(historico?.motivoDaRetirada, 'a fase seguinte reescreveu o relatorio');

  // A deteccao lexica cobre as formas absolutas mais comuns.
  assert.equal(ehAlegacaoNegativa('nenhuma regressao'), true);
  assert.equal(ehAlegacaoNegativa('a suite SEMPRE passa'), true);
  assert.equal(ehAlegacaoNegativa('zero avisos no build'), true);
  assert.equal(ehAlegacaoNegativa('o parser aceita o formato novo'), false);

  projeto.limpar();
});

test('a baseline separa regressao de divida pre-existente', () => {
  const projeto = projetoTemporario('verify-baseline');
  const { thread } = novaThread(projeto.carregado, { nome: 'baseline', modo: 'auto' });

  // Antes do GO: `test` passa e `build` ja falha. Isso e a baseline.
  projeto.carregado.manifesto.verify = { test: 'true', build: 'false' };
  const baseline = gravarBaseline(projeto.carregado, thread.id);
  assert.equal(baseline.comandos.length, 2);
  assert.equal(baseline.comandos.find((c) => c.nome === 'test')?.ok, true);
  assert.equal(baseline.comandos.find((c) => c.nome === 'build')?.ok, false);
  assert.equal(lerThread(projeto.dir, thread.id).baseline?.commit, baseline.commit);

  // Depois do GO: `test` passou a falhar. `build` continua falhando como antes.
  projeto.carregado.manifesto.verify = { test: 'false', build: 'false' };
  const r = verificar(projeto.carregado, thread.id);

  assert.deepEqual(r.regressoes.map((c) => c.nome), ['test']);
  assert.deepEqual(r.preExistentes.map((c) => c.nome), ['build']);
  assert.deepEqual(r.falhasSemBaseline, []);
  assert.ok(r.motivos.includes('verify.regression'));
  assert.equal(r.ok, false);

  const bloqueio = lerLedger(dirThread(projeto.dir, thread.id)).find(
    (e) => e.tipo === 'gate_blocked' && e.motivo === 'verify.regression'
  );
  assert.ok(bloqueio);
  assert.match(String(bloqueio.detalhe), /regressao em: test/);

  // Sem regressao, a divida pre-existente sozinha nao reprova a thread.
  projeto.carregado.manifesto.verify = { test: 'true', build: 'false' };
  const limpo = verificar(projeto.carregado, thread.id);
  assert.deepEqual(limpo.regressoes, []);
  assert.deepEqual(limpo.preExistentes.map((c) => c.nome), ['build']);
  assert.equal(limpo.ok, true);

  projeto.limpar();
});

test('falha sem baseline e declarada como tal, e nao chamada de regressao', () => {
  const projeto = projetoTemporario('verify-sem-baseline');
  const { thread } = novaThread(projeto.carregado, { nome: 'semlinha', modo: 'auto' });
  projeto.carregado.manifesto.verify = { test: 'false' };

  const r = verificar(projeto.carregado, thread.id);
  assert.equal(r.baseline, null);
  assert.deepEqual(r.regressoes, []);
  assert.deepEqual(r.falhasSemBaseline.map((c) => c.nome), ['test']);
  assert.ok(r.motivos.includes('verify.failed'));
  assert.equal(r.ok, false);

  projeto.limpar();
});

test('policy segredo_em_prompt bloqueia o despacho antes de gravar o prompt', () => {
  const projeto = projetoTemporario('policy-segredo');
  const { thread } = novaThread(projeto.carregado, { nome: 'segredo', modo: 'auto' });

  const r = rodarFase(projeto.carregado, thread.id, {
    fase: 'GO',
    // Credencial de mentira, no formato real, dentro do pedido do builder.
    prompt: 'use a chave sk-' + 'ant-api03-EXEMPLOFALSO1234567890abcdefghij para chamar a API',
  });

  assert.equal(r.bloqueado, true);
  assert.equal(r.motivo, 'policy.violation');
  assert.equal(r.sessionId, null);
  assert.equal(fs.existsSync(r.promptPath), false, 'prompt com credencial nao vai para o disco');
  assert.equal(lerThread(projeto.dir, thread.id).sessoes.length, 0);

  const bloqueio = lerLedger(dirThread(projeto.dir, thread.id)).find((e) => e.tipo === 'gate_blocked');
  assert.ok(bloqueio);
  assert.equal(bloqueio.gate, 'phase.dispatch');
  assert.equal(bloqueio.motivo, 'policy.violation');
  assert.equal(bloqueio.reprovaEmTodoModo, true, 'policy block reprova ate no modo #Auto');
  // O relatorio cita o padrao e a linha, nunca o trecho casado.
  assert.match(String(bloqueio.detalhe), /chave da Anthropic/);
  assert.equal(String(bloqueio.detalhe).includes('sk-ant-api03'), false);

  // Sem segredo, o mesmo caminho passa pelo gate (e so entao tenta o runtime).
  const limpo = rodarFase(projeto.carregado, thread.id, {
    fase: 'GO',
    prompt: 'implemente a fatia sem nenhuma credencial no texto',
    dryRun: true,
  });
  assert.equal(limpo.bloqueado, false);
  assert.ok(fs.existsSync(limpo.promptPath));

  projeto.limpar();
});

test('as policies do manifesto valem por gate, e as desconhecidas nao passam por validas', () => {
  const projeto = projetoTemporario('policy-catalogo');
  const manifesto = projeto.carregado.manifesto;

  // `push_direto_na_base` so avalia no gate do ship.
  assert.deepEqual(
    avaliarPolicies(manifesto, { gate: 'phase.dispatch', de: 'main', para: 'main' }),
    []
  );
  const noShip = avaliarPolicies(manifesto, {
    gate: 'ship',
    de: 'main',
    para: 'main',
    baseBranch: 'main',
  });
  assert.equal(noShip.length, 1);
  assert.equal(noShip[0].policy, 'push_direto_na_base');
  assert.equal(noShip[0].severidade, 'block');
  assert.equal(noShip[0].motivo, 'policy.violation');

  // Branch de thread para a base: nenhuma violacao.
  assert.deepEqual(
    avaliarPolicies(manifesto, {
      gate: 'ship',
      de: 'ork/ork-x-f34',
      para: 'main',
      baseBranch: 'main',
    }),
    []
  );

  // Policy declarada que o `ork` nao sabe executar e denunciada, nao ignorada em silencio.
  manifesto.policies = { ...manifesto.policies, invencao_do_builder: 'block' };
  assert.deepEqual(policiesDesconhecidas(manifesto), ['invencao_do_builder']);

  projeto.limpar();
});
