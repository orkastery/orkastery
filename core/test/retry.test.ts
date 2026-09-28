import { aprovarSimulado, comCredencialSimulada } from './hitl-simulado';
/**
 * Politica de retry TIPADA (bloco B3).
 *
 * As tres regras que estes testes existem para travar:
 *   1. `cost.violation` NUNCA recebe retry automatico;
 *   2. o modo afrouxa a PAUSA, nunca a verificacao (a politica e a mesma em `#Look` e
 *      em `#Auto`; o que muda e a autorizacao para executa-la sozinho);
 *   3. o limite de escalacao do manifesto pausa QUALQUER modo, inclusive `#Auto`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import {
  ESCADA_DE_ESFORCO,
  escalarEsforco,
  executarRetry,
  planejarRetry,
  podeReexecutar,
  POLITICA_DE_RETRY,
  politicaDoMotivo,
  proximoEsforco,
  tabelaDaPolitica,
} from '../src/retry';
import { adicionarClaim } from '../src/claims';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { AcaoDeRetry, MotivoGate } from '../src/types';
import { verificar } from '../src/verify';
import { ajustarManifesto, projetoTemporario, runtimeFalso } from './apoio';

test('runtime.silencio retoma despacho bem-sucedido, conta tentativa e escala no limite em Auto', t => {
  const runtime=runtimeFalso('retry-silencio');
  const p=projetoTemporario('retry-silencio');
  t.after(()=>{runtime.restaurar();p.limpar();});
  ajustarManifesto(p,/  max_tentativas: 3/,'  max_tentativas: 1');
  const thread=novaThread(p.carregado,{nome:'silencio',modo:'auto'}).thread;
  assert.equal(rodarFase(p.carregado,thread.id,{fase:'GO',prompt:'Implementar slice verificável'}).bloqueado,false);
  runtime.estadoDaSessao('completed');
  const result=executarRetry(p.carregado,thread.id,{motivo:'runtime.silencio',fase:'GO'});
  assert.equal(result.executada,true);
  assert.equal(result.redespacho?.verificada,true);
  const next=executarRetry(p.carregado,thread.id,{motivo:'runtime.silencio',fase:'GO'});
  assert.equal(next.executada,false); assert.equal(next.plano.tentativas,1);
  assert.equal(next.plano.acao,'escalar-humano');
  assert.ok(lerLedger(dirThread(p.dir,thread.id)).some(e=>e.tipo==='retry_escalated'&&e.motivo==='runtime.silencio'));
});

test('liveness tem padrão de 10 minutos e recusa limite não positivo', () => {
  const p=projetoTemporario('liveness-config');
  try {
    assert.equal(p.carregado.manifesto.liveness?.silencio_max_min,10);
    assert.throws(()=>ajustarManifesto(p,'project:', 'liveness:\n  silencio_max_min: 0\n\nproject:'),/liveness.silencio_max_min/);
  } finally {p.limpar();}
});

test('a politica cobre TODO motivo tipado do catalogo do gate, sem buraco', () => {
  const doCatalogo = Object.keys(DESCRICAO_DO_MOTIVO) as MotivoGate[];
  assert.ok(doCatalogo.length >= 12, 'o catalogo do B1 ganhou os motivos do B3');
  for (const motivo of doCatalogo) {
    const politica = politicaDoMotivo(motivo);
    assert.ok(politica, `motivo ${motivo} sem politica de retry`);
    assert.equal(politica.motivo, motivo);
    assert.ok(politica.porque.length > 20, `${motivo} sem razao escrita`);
    assert.ok(politica.correcao.length > 10, `${motivo} sem correcao acionavel`);
  }

  // As 5 acoes do plano do B3 existem todas, mais `esperar-janela` e `sem-retry`.
  const acoes = new Set(Object.values(POLITICA_DE_RETRY).map((p) => p.acao));
  for (const acao of [
    'reexecutar',
    'corrigir-dirigido',
    'sincronizar-worktree',
    'esperar-janela',
    'escalar-humano',
    'sem-retry',
  ] as AcaoDeRetry[]) {
    assert.ok(acoes.has(acao), `a politica nunca usa a acao ${acao}`);
  }
  assert.match(tabelaDaPolitica(), /cost\.violation/);
});

test('violacao de custo NUNCA recebe retry automatico', () => {
  assert.equal(podeReexecutar('cost.violation'), false);
  assert.equal(politicaDoMotivo('cost.violation').acao, 'sem-retry');
  assert.equal(politicaDoMotivo('cost.violation').automatica, false);

  // Todo outro motivo tem alguma acao; so o custo nao tem nenhuma.
  const semRetry = Object.values(POLITICA_DE_RETRY).filter((p) => p.acao === 'sem-retry');
  assert.deepEqual(semRetry.map((p) => p.motivo), ['cost.violation']);
});

test('despacho por provider pago reprova como cost.violation e o retry recusa reexecutar', (t) => {
  const p = projetoTemporario('b3-custo');
  const anterior = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-' + 'ant-api03-CHAVEFALSADETESTE1234567890';
  t.after(() => {
    if (anterior === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = anterior;
    p.limpar();
  });

  // `#Auto`: nem o modo mais autonomo do espectro pode reexecutar gasto.
  const { thread } = novaThread(p.carregado, { nome: 'custo auto', modo: 'auto' });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente a fatia' });
  assert.equal(r.bloqueado, true);
  assert.equal(r.motivo, 'cost.violation', 'a policy provider sai tipada como CUSTO');

  const plano = planejarRetry(p.carregado, thread.id);
  assert.equal(plano.motivo, 'cost.violation');
  assert.equal(plano.acao, 'sem-retry');
  assert.equal(plano.automatica, false);
  assert.equal(plano.bloqueio, 'politica.nao-automatica');
  assert.match(plano.razao, /gastaria de novo/);

  const execucao = executarRetry(p.carregado, thread.id);
  assert.equal(execucao.executada, false);
  assert.equal(execucao.redespacho, null);
  assert.equal(lerThread(p.dir, thread.id).sessoes.length, 0, 'nenhum despacho novo aconteceu');

  const ledger = lerLedger(dirThread(p.dir, thread.id));
  assert.equal(
    ledger.filter((e) => e.tipo === 'retry_attempt').length,
    0,
    'custo nao gasta nem uma tentativa'
  );
  const bloqueio = ledger.filter(
    (e) => e.tipo === 'gate_blocked' && e.motivo === 'cost.violation' && e.origem === 'retry.run'
  );
  assert.equal(bloqueio.length, 1);
  assert.equal(bloqueio[0].pausaQualquerModo, true);
});

test('o modo afrouxa a pausa e nunca a politica: #Default espera, #Maestro anda', (t) => {
  const p = projetoTemporario('b3-modos');
  t.after(p.limpar);

  const claim = { arquivo: 'alvo.txt', alegacao: 'alvo.txt existe', verificar: ['test -f alvo.txt'] };

  // #Default: o bloco GO-CHECK pausa sobre evidencias, entao o retry fica planejado.
  const padrao = novaThread(p.carregado, { nome: 'modo default', modo: 'classic' }).thread;
  adicionarClaim(p.dir, padrao.id, { ...claim, fase: 'CHECK' });
  verificar(p.carregado, padrao.id);
  const planoDefault = planejarRetry(p.carregado, padrao.id);
  assert.equal(planoDefault.motivo, 'claims.failed');
  assert.equal(planoDefault.acao, 'corrigir-dirigido', 'a POLITICA e a mesma em todo modo');
  assert.equal(planoDefault.automatica, false);
  assert.equal(planoDefault.bloqueio, 'modo.bloco-pausa');
  assert.match(planoDefault.razao, /afrouxa a pausa, nunca a verificacao/);

  // Texto arbitrário no CLI não autentica humano. A prova abaixo é SIMULADA.
  assert.equal(planejarRetry(p.carregado, padrao.id, { autorizadoPor: 'julio' }).automatica, false);
  aprovarSimulado(p.dir, padrao.id, 'CHECK');
  // FX2: o retry reconfere o MAC do ingresso. Sem a credencial no ambiente a aprovacao
  // registrada nao autoriza nada, e o bloqueio do modo continua de pe.
  assert.equal(planejarRetry(p.carregado, padrao.id, { autorizadoPor: 'telegram:42' }).automatica, false);
  const autorizado = comCredencialSimulada(() => planejarRetry(p.carregado, padrao.id, { autorizadoPor: 'telegram:42' }));
  assert.equal(autorizado.automatica, true);
  assert.equal(autorizado.bloqueio, null);

  // #Maestro: o bloco GO-CHECK-SHIP nao pausa, e o mesmo motivo anda sozinho.
  const maestro = novaThread(p.carregado, { nome: 'modo maestro', modo: 'maestro' }).thread;
  adicionarClaim(p.dir, maestro.id, { ...claim, fase: 'CHECK' });
  verificar(p.carregado, maestro.id);
  const planoMaestro = planejarRetry(p.carregado, maestro.id);
  assert.equal(planoMaestro.acao, 'corrigir-dirigido');
  assert.equal(planoMaestro.automatica, true);
  assert.equal(planoMaestro.bloqueio, null);

  const r = executarRetry(p.carregado, maestro.id, { reverify: true });
  assert.equal(r.executada, true);
  assert.ok(r.rodada);
  assert.equal(r.rodada.correcoes.length, 1);
  assert.ok(r.reverify);
  assert.equal(r.reverify.veredito, 'PRECISA DE MUDANCA');
  assert.equal(
    lerLedger(dirThread(p.dir, maestro.id)).filter(
      (e) => e.tipo === 'human_gate' && e.estado === 'aprovado'
    ).length,
    0,
    '#Maestro atravessou o gate reprovado sem pausa humana'
  );
});

test('o limite de escalacao pausa QUALQUER modo, inclusive #Auto', (t) => {
  const p = projetoTemporario('b3-escalacao');
  t.after(p.limpar);
  ajustarManifesto(p, /  max_tentativas: 3/, '  max_tentativas: 2');

  const { thread } = novaThread(p.carregado, { nome: 'escalacao auto', modo: 'auto' });
  adicionarClaim(p.dir, thread.id, {
    arquivo: 'alvo.txt',
    alegacao: 'alvo.txt existe',
    verificar: ['test -f alvo.txt'],
    fase: 'CHECK',
  });
  verificar(p.carregado, thread.id);

  // Duas tentativas automaticas cabem no limite.
  for (const esperada of [1, 2]) {
    const r = executarRetry(p.carregado, thread.id);
    assert.equal(r.executada, true, `tentativa ${esperada} deveria rodar`);
    assert.equal(r.plano.automatica, true);
  }

  // A terceira bate no limite e vira escalacao para humano, mesmo em #Auto.
  const plano = planejarRetry(p.carregado, thread.id);
  assert.equal(plano.tentativas, 2);
  assert.equal(plano.acao, 'escalar-humano');
  assert.equal(plano.automatica, false);
  assert.equal(plano.bloqueio, 'escalacao.limite');
  assert.match(plano.razao, /pausa qualquer modo, inclusive #Auto/);

  const r = executarRetry(p.carregado, thread.id);
  assert.equal(r.executada, false);
  const ledger = lerLedger(dirThread(p.dir, thread.id));
  assert.equal(ledger.filter((e) => e.tipo === 'retry_attempt').length, 2, 'a 3a nao gastou tentativa');
  const escalado = ledger.filter((e) => e.tipo === 'retry_escalated' && e.origem === 'retry.run');
  assert.equal(escalado.length, 1);
  assert.equal(escalado[0].modo, 'auto');
});

test('a escada de esforco sobe um degrau por tentativa e para no topo', () => {
  assert.deepEqual([...ESCADA_DE_ESFORCO], ['eco', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(proximoEsforco('eco'), 'low');
  assert.equal(proximoEsforco('high'), 'xhigh');
  assert.equal(proximoEsforco('xhigh'), 'xhigh', 'no topo nao se inventa degrau novo');
  assert.equal(proximoEsforco('desconhecido'), 'desconhecido', 'esforco fora da escada fica como esta');
  assert.equal(escalarEsforco('eco', 2), 'medium');
  assert.equal(escalarEsforco('high', 5), 'xhigh');
});

test('runtime indisponivel reexecuta o MESMO prompt e escala o esforco na 2a tentativa', (t) => {
  const p = projetoTemporario('b3-reexecutar');
  const runtime = runtimeFalso('b3-reexecutar');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'reexecutar auto', modo: 'auto' });
  // Sem rate limit no stderr: o adapter falha como `runtime.unavailable`.
  runtime.proximoDespachoMorreDeRateLimit('erro generico do runtime, sem sessao\n');
  const morta = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente a fatia 1' });
  assert.equal(morta.motivo, 'runtime.unavailable');
  assert.equal(morta.naFila, null, 'sem sinal de rate limit nao ha fila');

  // `runtime.unavailable` nao passa pelo gate tipado, entao o motivo entra explicito.
  const plano = planejarRetry(p.carregado, thread.id, { motivo: 'runtime.unavailable', fase: 'GO' });
  assert.equal(plano.acao, 'reexecutar');
  assert.equal(plano.automatica, true);
  assert.equal(plano.effort, p.carregado.manifesto.runtime.effort, '1a tentativa nao escala esforco');

  const r = executarRetry(p.carregado, thread.id, { motivo: 'runtime.unavailable', fase: 'GO' });
  assert.equal(r.executada, true);
  assert.ok(r.redespacho);
  assert.equal(r.redespacho.sessionId, runtime.sessionId);

  const depois = lerThread(p.dir, thread.id);
  assert.equal(depois.sessoes.length, 1);
  assert.equal(depois.sessoes[0].promptSha256, morta.promptSha256, 'o MESMO prompt voltou ao runtime');

  // Segunda tentativa pelo mesmo motivo: o esforco sobe um degrau.
  const segundo = planejarRetry(p.carregado, thread.id, { motivo: 'runtime.unavailable', fase: 'GO' });
  assert.equal(segundo.tentativas, 1);
  assert.equal(segundo.acao, 'escalar-esforco');
  assert.equal(segundo.effort, proximoEsforco(p.carregado.manifesto.runtime.effort));
  assert.equal(segundo.effortAnterior, p.carregado.manifesto.runtime.effort);
});

test('thread sem reprovacao pendente nao inventa retry', (t) => {
  const p = projetoTemporario('b3-sem-gate');
  t.after(p.limpar);

  const { thread } = novaThread(p.carregado, { nome: 'sem gate', modo: 'auto' });
  const plano = planejarRetry(p.carregado, thread.id);
  assert.equal(plano.motivo, null);
  assert.equal(plano.acao, 'sem-retry');
  assert.equal(plano.bloqueio, 'gate.sem-reprovacao');

  const r = executarRetry(p.carregado, thread.id);
  assert.equal(r.executada, false);
  assert.equal(
    lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'retry_attempt').length,
    0
  );
});


test('retry de silencio recusa sessao viva e prova injetada; reconsulta antes de despachar', t => {
  const runtime = runtimeFalso('retry-viva'), p = projetoTemporario('retry-viva');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const thread = novaThread(p.carregado, { nome: 'viva', modo: 'auto' }).thread;
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'Slice de fixture' });
  const antes = runtime.chamadas().filter(l => l.startsWith('--bg')).length;
  const opcoes = { motivo: 'runtime.silencio' as const, fase: 'GO' as const };
  for (const estado of ['working', 'blocked', 'unknown', '']) {
    runtime.estadoDaSessao(estado);
    const plano = planejarRetry(p.carregado, thread.id, { ...opcoes,
      estadoDaSessao: { sessionId: runtime.sessionId, estado } });
    assert.equal(plano.automatica, false);
    const resultado = executarRetry(p.carregado, thread.id, { ...opcoes,
      estadoDaSessao: { sessionId: runtime.sessionId, estado: 'completed' } });
    assert.equal(resultado.executada, false, 'prova injetada nao substitui consulta atual');
  }
  assert.equal(runtime.chamadas().filter(l => l.startsWith('--bg')).length, antes);
  assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter(e => e.tipo === 'retry_attempt').length, 0);
  assert.equal(planejarRetry(p.carregado, thread.id, { ...opcoes,
    estadoDaSessao: { sessionId: 'outra', estado: 'completed' } }).automatica, false);
});
