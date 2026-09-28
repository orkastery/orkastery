/**
 * Monitor PROATIVO de pausas e impedimentos (`ork orquestracao status`).
 *
 * O incidente que estes testes travam: sessoes ficaram `waiting` esperando veredito
 * humano e o orquestrador so descobriu quando o humano perguntou. O criterio nao e "o
 * comando imprime alguma coisa", e "de UMA chamada da para saber quem esta parado,
 * esperando o que, ha quanto tempo e o que destrava".
 *
 * Por isso quase tudo aqui roda o caminho REAL: despacho pelo runtime falso, fila de
 * lease de verdade, fila de rate limit gravada pelo proprio `ork phase run`.
 */

import { aprovarSimulado } from './hitl-simulado';
import { registrar } from '../src/ledger';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { registrarGateBloqueado } from '../src/gates';
import { adquirirRegiao } from '../src/leases';
import { registrarMaster } from '../src/master';
import {
  ATENCAO_PADRAO_MIN,
  duracaoCurta,
  minutosEntre,
  montarMonitor,
  textoDoMonitor,
} from '../src/orquestracao';
import { TAG_DE_MODO_DESCONHECIDO } from '../src/modos';
import { rodarFase } from '../src/phase';
import { caminhoThread, dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { MonitorDeOrquestracao } from '../src/types';
import { projetoTemporario, runtimeFalso } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');

/** O monitor de um projeto de teste, sem consultar runtime nenhum. */
function monitorar(
  p: ReturnType<typeof projetoTemporario>,
  opcoes: Parameters<typeof montarMonitor>[1] = {}
): MonitorDeOrquestracao {
  return montarMonitor(p.carregado, { semRuntime: true, ...opcoes });
}

/** A linha de uma thread no monitor. */
function linha(m: MonitorDeOrquestracao, id: string) {
  const achada = m.linhas.find((l) => l.thread === id);
  assert.ok(achada, `a thread ${id} nao aparece no monitor`);
  return achada;
}

/** Faz a sessao do runtime falso "terminar": ela some do `claude agents --json`. */
function sessaoTerminou(runtime: ReturnType<typeof runtimeFalso>): void {
  fs.rmSync(path.join(runtime.dir, 'sessao'), { force: true });
}

// ---------------------------------------------------------------------------
// Pausa humana (HITL): o caso que atrasou roadmap.
// ---------------------------------------------------------------------------

test('o bloco que fecha com pausa vira pausa aberta com o que o humano decide', (t) => {
  const p = projetoTemporario('monitor-pausa');
  const runtime = runtimeFalso('monitor-pausa');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  // `#Classic` fecha o bloco PLAN com pausa humana sobre "plano".
  const { thread } = novaThread(p.carregado, { nome: 'Checkout novo', modo: 'classic' });
  const r = rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'desenhe o plano' });
  assert.equal(r.pausaAoFim, true, 'o despacho do PLAN fecha o bloco que pausa');

  // Com a sessao AINDA VIVA no runtime, a pausa e prevista, nao valendo: nao adianta
  // acordar o humano enquanto o agente trabalha.
  const emCurso = montarMonitor(p.carregado);
  assert.equal(emCurso.runtimeConsultado, true, 'o runtime falso foi consultado');
  const viva = linha(emCurso, thread.id);
  assert.equal(viva.pausas.length, 1);
  assert.equal(viva.pausas[0].sessaoViva, true);
  assert.equal(viva.precisaDeHumano, false, 'sessao viva ainda nao e espera de humano');
  assert.equal(emCurso.resumo.aguardandoHumano, 0);
  assert.match(textoDoMonitor(emCurso), /Pausa PREVISTA, sessao ainda viva/);

  // A sessao termina: agora a thread esta REALMENTE parada esperando veredito.
  sessaoTerminou(runtime);
  const parada = montarMonitor(p.carregado);
  const l = linha(parada, thread.id);
  assert.equal(l.precisaDeHumano, true);
  assert.equal(l.situacao, 'pausada');
  assert.equal(l.pausas.length, 1);
  const pausa = l.pausas[0];
  assert.equal(pausa.natureza, 'pausa-humana');
  assert.equal(pausa.motivo, 'human.pending');
  assert.equal(pausa.fase, 'PLAN');
  assert.equal(pausa.bloco, 'PLAN', 'o bloco inteiro que pausa, nao so a fase');
  assert.equal(pausa.pausaSobre, 'plano', 'o que o humano decide vem do bloco');
  assert.equal(pausa.sessaoViva, false);
  assert.equal(pausa.fonte, 'ledger');
  assert.match(pausa.evidencia, /human_gate/);
  assert.match(pausa.correcao, new RegExp(`ork gate request ${thread.id}`));
  assert.equal(parada.resumo.aguardandoHumano, 1);

  const texto = textoDoMonitor(parada);
  assert.match(texto, /Esperando VEREDITO HUMANO agora/);
  assert.match(texto, /o humano decide: plano/);
  assert.match(texto, new RegExp(thread.id));
});

test('a aprovacao humana registrada fecha a pausa, e o monitor limpa', (t) => {
  const p = projetoTemporario('monitor-aprova');
  const runtime = runtimeFalso('monitor-aprova');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'Pagamentos', modo: 'classic' });
  rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'plano' });
  sessaoTerminou(runtime);
  assert.equal(monitorar(p).resumo.aguardandoHumano, 1);

  aprovarSimulado(p.dir, thread.id, 'PLAN');
  const depois = monitorar(p);
  assert.equal(depois.resumo.aguardandoHumano, 0, 'resposta correlacionada SIMULADA destrava a pausa');
  assert.equal(linha(depois, thread.id).pausas.length, 0);
  assert.match(textoDoMonitor(depois), /Nenhuma thread parada/);
});

test('a conducao que segue para a fase seguinte fecha a pausa sem aprovacao explicita', (t) => {
  const p = projetoTemporario('monitor-seguiu');
  const runtime = runtimeFalso('monitor-seguiu');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  // `#Maestro` pausa so no fim de GOAL-PLAN; o bloco GO-CHECK-SHIP seguinte nao pausa,
  // o que isola exatamente o efeito que este teste mede.
  const { thread } = novaThread(p.carregado, { nome: 'Relatorios', modo: 'maestro' });
  rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'plano' });
  sessaoTerminou(runtime);
  assert.equal(monitorar(p).resumo.aguardandoHumano, 1);

  // Redespachar a MESMA fase nao resolve pausa nenhuma.
  rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'plano, segunda tentativa' });
  sessaoTerminou(runtime);
  assert.equal(monitorar(p).resumo.aguardandoHumano, 1, 'redespacho da mesma fase nao destrava');

  // Um despacho de fase POSTERIOR quer dizer que a conducao passou do bloco.
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente' });
  sessaoTerminou(runtime);
  const depois = monitorar(p);
  assert.equal(depois.resumo.aguardandoHumano, 0, 'a conducao passou do bloco que pausava');
  assert.equal(linha(depois, thread.id).situacao, 'pode-avancar');
});

test('a pausa do bloco seguinte abre sozinha quando o modo pausa varias vezes', (t) => {
  const p = projetoTemporario('monitor-encadeada');
  const runtime = runtimeFalso('monitor-encadeada');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  // `#Classic` pausa em GOAL (objetivo), em PLAN (plano) e de novo em CHECK (evidencias).
  const { thread } = novaThread(p.carregado, { nome: 'Encadeada', modo: 'classic' });
  rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'plano' });
  sessaoTerminou(runtime);
  assert.equal(monitorar(p).linhas[0].pausas[0].pausaSobre, 'plano');

  // O bloco GO-CHECK fecha em CHECK: e ali que a proxima pausa abre sozinha.
  rodarFase(p.carregado, thread.id, { fase: 'CHECK', prompt: 'confira' });
  sessaoTerminou(runtime);
  const m = monitorar(p);
  const l = linha(m, thread.id);
  assert.equal(l.pausas.length, 1, 'a pausa de plano fechou quando o CHECK foi despachado');
  assert.equal(l.pausas[0].fase, 'CHECK');
  assert.equal(l.pausas[0].pausaSobre, 'evidencias, com autorizacao antecipada de push',
    'agora o humano decide as evidencias');
});

test('`status: pausada` no thread.json sozinho ja e pausa aberta', () => {
  const p = projetoTemporario('monitor-status');
  const { thread } = novaThread(p.carregado, { nome: 'Legado', modo: 'classic' });
  const t = lerThread(p.dir, thread.id);
  t.status = 'pausada';
  gravarThread(p.dir, t);

  const l = linha(monitorar(p), thread.id);
  assert.equal(l.precisaDeHumano, true, 'thread carimbada como pausada nao pode passar batido');
  assert.equal(l.pausas.length, 1);
  assert.equal(l.pausas[0].fonte, 'thread.json');
  assert.equal(l.pausas[0].fase, 'GOAL');
  assert.equal(l.pausas[0].pausaSobre, 'objetivo', 'o bloco GOAL do #Classic pausa sobre objetivo');
  p.limpar();
});

test('a escalada do B3 pausa ate o #Auto, que nao tem pausa prevista', () => {
  const p = projetoTemporario('monitor-escalada');
  const { thread } = novaThread(p.carregado, { nome: 'Migracao', modo: 'auto' });
  assert.equal(thread.blocos.filter((b) => b.pausa).length, 0, '#Auto nao tem pausa prevista');

  // O limite de tentativas do manifesto estourou: `ork retry run` grava exatamente isto.
  registrarGateBloqueado(dirThread(p.dir, thread.id), thread.id, {
    gate: 'phase.dispatch',
    motivo: 'human.pending',
    modo: 'auto',
    detalhe: 'limite de 3 tentativas estourado pelo mesmo motivo na fase GO',
    correcao: `ork gate approve ${thread.id} retry --por <quem>`,
    fase: 'GO',
    pausaQualquerModo: true,
  });

  const l = linha(monitorar(p), thread.id);
  assert.equal(l.precisaDeHumano, true, 'a escalada pausa QUALQUER modo, inclusive #Auto');
  assert.equal(l.pausas.length, 1);
  assert.equal(l.pausas[0].fase, 'GO');
  assert.match(l.pausas[0].detalhe, /limite de 3 tentativas/);
  assert.match(l.pausas[0].correcao, /ork gate approve/);
  p.limpar();
});

// ---------------------------------------------------------------------------
// Impedimentos: lease em colisao, gate tipado, rate limit e paralelismo.
// ---------------------------------------------------------------------------

test('a thread na fila por colisao de regiao aparece como impedimento lease.busy', () => {
  const p = projetoTemporario('monitor-lease');
  const a = novaThread(p.carregado, { nome: 'Nucleo', modo: 'auto' }).thread;
  const b = novaThread(p.carregado, { nome: 'Board', modo: 'auto' }).thread;

  adquirirRegiao(p.dir, 'path:core/src/**', { thread: a.id, motivo: 'GO no nucleo' });
  const barrada = adquirirRegiao(p.dir, 'path:core/src/board.ts', { thread: b.id, motivo: 'GO' });
  assert.equal(barrada.esperando, true);

  const m = monitorar(p);
  const impedida = linha(m, b.id);
  assert.equal(impedida.temImpedimento, true);
  assert.equal(impedida.precisaDeHumano, false, 'colisao de lease nao e veredito humano');
  assert.equal(impedida.impedimentos.length, 1);
  assert.equal(impedida.impedimentos[0].motivo, 'lease.busy');
  assert.equal(impedida.impedimentos[0].fonte, 'fila-de-lease');
  assert.match(impedida.impedimentos[0].detalhe, new RegExp(a.id));
  assert.match(impedida.impedimentos[0].evidencia, /fila\.json/);

  const segurando = linha(m, a.id);
  assert.equal(segurando.temImpedimento, false, 'quem segura o lease nao esta impedido');
  assert.equal(segurando.situacao, 'em-andamento');
  assert.match(textoDoMonitor(m), /Com IMPEDIMENTO/);
  p.limpar();
});

test('a fase morta por rate limit vira impedimento com a hora que o runtime disse', (t) => {
  const p = projetoTemporario('monitor-rate');
  const runtime = runtimeFalso('monitor-rate');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'Indexador', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit('Claude AI usage limit reached|4102444800\n');
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'indexe' });
  assert.ok(r.naFila, 'o despacho morto entrou na fila duravel');

  const l = linha(monitorar(p), thread.id);
  assert.equal(l.temImpedimento, true);
  const rate = l.impedimentos.find((i) => i.motivo === 'runtime.rate-limited');
  assert.ok(rate, 'o pedido na fila de rate limit e um impedimento');
  assert.equal(rate.fonte, 'fila-de-rate-limit');
  assert.equal(rate.fase, 'GO');
  assert.match(rate.detalhe, /libera em|libera ja liberou/);
  assert.match(rate.correcao, /ork retry resume --id R1/);
  assert.match(rate.evidencia, /fila\.jsonl/);
});

test('gate tipado reprovado fica aberto ate a fase voltar a ser despachada', (t) => {
  const p = projetoTemporario('monitor-gate');
  const runtime = runtimeFalso('monitor-gate');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'Verdade', modo: 'auto' });
  registrarGateBloqueado(dirThread(p.dir, thread.id), thread.id, {
    gate: 'verify',
    motivo: 'claims.failed',
    modo: 'auto',
    detalhe: 'a claim C1 reprovou na reexecucao no HEAD real',
    correcao: `ork fix open ${thread.id}`,
    fase: 'CHECK',
  });

  const l = linha(monitorar(p), thread.id);
  assert.equal(l.temImpedimento, true);
  assert.equal(l.precisaDeHumano, false, 'gate tipado nao e pausa humana');
  assert.equal(l.impedimentos[0].motivo, 'claims.failed');
  assert.match(l.impedimentos[0].correcao, /ork fix open/);

  // O despacho seguinte so acontece porque o bloqueio deixou de valer.
  rodarFase(p.carregado, thread.id, { fase: 'CHECK', prompt: 'reverifique' });
  assert.equal(linha(monitorar(p), thread.id).temImpedimento, false);
});

test('o limite de paralelismo da maquina tambem e impedimento, com a correcao do manifesto', () => {
  const p = projetoTemporario('monitor-concorrencia');
  const a = novaThread(p.carregado, { nome: 'Uma', modo: 'auto' }).thread;
  const b = novaThread(p.carregado, { nome: 'Duas', modo: 'auto' }).thread;

  const apertado = { ...p.carregado, manifesto: { ...p.carregado.manifesto } };
  apertado.manifesto.concurrency = { ...apertado.manifesto.concurrency, max_parallel_threads: 1 };
  const m = montarMonitor(apertado, { semRuntime: true });

  assert.equal(linha(m, a.id).temImpedimento, false, 'a primeira da fila avanca');
  const segunda = linha(m, b.id);
  assert.equal(segunda.temImpedimento, true);
  assert.equal(segunda.impedimentos[0].motivo, 'concurrency.limite');
  assert.equal(segunda.impedimentos[0].fonte, 'escalonador');
  assert.match(segunda.impedimentos[0].correcao, /max_parallel_threads/);
  p.limpar();
});

// ---------------------------------------------------------------------------
// Tempo parado, ordenacao, filtros e o que NAO deve aparecer.
// ---------------------------------------------------------------------------

test('o tempo parado sai do carimbo da parada e passa do limite de atencao', (t) => {
  const p = projetoTemporario('monitor-tempo');
  const runtime = runtimeFalso('monitor-tempo');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'Esquecida', modo: 'classic' });
  rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'plano' });
  sessaoTerminou(runtime);

  const agora = monitorar(p);
  assert.equal(linha(agora, thread.id).acimaDoLimite, false, 'recem-parada nao e alarme');
  assert.equal(agora.atencaoMin, ATENCAO_PADRAO_MIN);

  // Tres horas depois, no mesmo estado em disco: e exatamente o caso do incidente.
  const daquiATresHoras = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const depois = monitorar(p, { agora: daquiATresHoras });
  const l = linha(depois, thread.id);
  assert.equal(l.acimaDoLimite, true);
  assert.ok((l.paradaHaMin ?? 0) >= 179, `parada ha ${l.paradaHaMin} min`);
  assert.equal(depois.resumo.acimaDoLimite, 1);
  assert.match(textoDoMonitor(depois), /3h0\d !/);

  // O limite e ajustavel: com 4 horas de tolerancia, a mesma parada nao alarma.
  assert.equal(monitorar(p, { agora: daquiATresHoras, atencaoMin: 240 }).resumo.acimaDoLimite, 0);
});

test('quem espera humano vem primeiro, e a parada mais velha vem no topo', (t) => {
  const p = projetoTemporario('monitor-ordem');
  const runtime = runtimeFalso('monitor-ordem');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const pausada = novaThread(p.carregado, { nome: 'Espera humano', modo: 'classic' }).thread;
  const livre = novaThread(p.carregado, { nome: 'Livre', modo: 'auto' }).thread;
  const impedida = novaThread(p.carregado, { nome: 'Impedida', modo: 'auto' }).thread;

  adquirirRegiao(p.dir, 'path:core/**', { thread: livre.id, motivo: 'GO' });
  adquirirRegiao(p.dir, 'path:core/src/x.ts', { thread: impedida.id, motivo: 'GO' });
  rodarFase(p.carregado, pausada.id, { fase: 'PLAN', prompt: 'plano' });
  sessaoTerminou(runtime);

  const m = monitorar(p);
  assert.equal(m.linhas[0].thread, pausada.id, 'veredito humano e o primeiro da fila');
  assert.equal(m.linhas[1].thread, impedida.id, 'depois vem o impedimento');
  assert.equal(m.linhas[2].thread, livre.id);

  // `--so-paradas` deixa so o que exige acao; o resumo continua contando tudo.
  const filtrado = monitorar(p, { soParadas: true });
  assert.equal(filtrado.linhas.length, 2);
  assert.equal(filtrado.resumo.threads, 3, 'o resumo conta o projeto inteiro');
  assert.equal(filtrado.linhas.some((l) => l.thread === livre.id), false);
});

test('thread fechada nao inventa parada, e o monitor limpo diz isso em texto', () => {
  const p = projetoTemporario('monitor-fechada');
  const { thread } = novaThread(p.carregado, { nome: 'Entregue', modo: 'classic' });
  const t = lerThread(p.dir, thread.id);
  t.status = 'pausada';
  gravarThread(p.dir, t);
  assert.equal(monitorar(p).resumo.aguardandoHumano, 1);

  registrar(dirThread(p.dir, thread.id), thread.id, 'ship_done', { mergeSha: 'a'.repeat(40), pushVerificado: true });
  registrarMaster(p.dir, thread.id, { por: 'julio',
    score: 5,
    justificativa: 'entrega limpa',
    classes: ['sem-falha'],
  });
  const m = monitorar(p);
  const l = linha(m, thread.id);
  assert.equal(l.situacao, 'fechada');
  assert.equal(l.paradas.length, 0, 'thread fechada nao espera ninguem');
  assert.equal(m.resumo.aguardandoHumano, 0);
  assert.equal(m.resumo.fechadas, 1);
  assert.match(textoDoMonitor(m), /Nenhuma thread parada/);
  p.limpar();
});

test('sem runtime o monitor declara a fonte e avisa A MAIS, nunca a menos', (t) => {
  const p = projetoTemporario('monitor-sem-runtime');
  const runtime = runtimeFalso('monitor-sem-runtime');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'Sem medida', modo: 'classic' });
  rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'plano' });
  // A sessao continua VIVA no runtime falso; o monitor apenas nao pergunta.
  const m = monitorar(p);
  assert.equal(m.runtimeConsultado, false);
  assert.match(m.runtimeDetalhe, /sem-runtime/);
  const l = linha(m, thread.id);
  assert.equal(l.pausas[0].sessaoViva, null, 'sem medida, o campo e null e nao um chute');
  assert.equal(l.precisaDeHumano, true, 'na duvida o monitor avisa: perder pausa custa roadmap');
});

test('minutosEntre e duracaoCurta nao inventam numero', () => {
  assert.equal(minutosEntre('2026-09-04T10:00:00.000Z', '2026-09-04T10:45:00.000Z'), 45);
  assert.equal(minutosEntre('2026-09-04T10:00:00.000Z', '2026-09-04T09:00:00.000Z'), 0);
  assert.equal(minutosEntre('nao e data', '2026-09-04T10:00:00.000Z'), 0);
  assert.equal(duracaoCurta(0), '0min');
  assert.equal(duracaoCurta(59), '59min');
  assert.equal(duracaoCurta(60), '1h00');
  assert.equal(duracaoCurta(185), '3h05');
  assert.equal(duracaoCurta(60 * 52), '2d 04h');
});

// ---------------------------------------------------------------------------
// Pelo BINARIO: quem consome isto e uma linha de shell do orquestrador.
// ---------------------------------------------------------------------------

function ork(cwd: string, args: string[]): { saida: string; codigo: number } {
  try {
    return {
      saida: execFileSync(process.execPath, [ORK, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
      codigo: 0,
    };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string; stderr?: string };
    return { saida: (erro.stdout ?? '') + (erro.stderr ?? ''), codigo: erro.status ?? -1 };
  }
}

test('a ajuda anuncia o monitor de orquestracao', () => {
  const { saida, codigo } = ork(process.cwd(), ['--help']);
  assert.equal(codigo, 0);
  assert.ok(saida.includes('orquestracao status'), 'a ajuda nao cita o comando');
  assert.ok(saida.includes('ork monitor'), 'a ajuda nao cita o alias curto');
});

test('`ork orquestracao status --json` e parseavel e `--exigir-limpo` sai != 0 com gente parada', (t) => {
  const p = projetoTemporario('monitor-cli');
  const runtime = runtimeFalso('monitor-cli');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'Pelo binario', modo: 'classic' });

  // Projeto sem ninguem parado: o watchdog passa.
  const limpo = ork(p.dir, ['orquestracao', 'status', '--sem-runtime', '--exigir-limpo']);
  assert.equal(limpo.codigo, 0, limpo.saida);

  rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'plano' });
  sessaoTerminou(runtime);

  const json = ork(p.dir, ['monitor', 'status', '--sem-runtime', '--json']);
  assert.equal(json.codigo, 0, json.saida);
  const m = JSON.parse(json.saida) as MonitorDeOrquestracao;
  assert.equal(m.resumo.aguardandoHumano, 1);
  assert.equal(m.linhas[0].thread, thread.id);
  assert.equal(m.linhas[0].pausas[0].pausaSobre, 'plano');
  assert.ok(m.linhas[0].pausas[0].correcao.startsWith('ork gate request'));
  assert.ok(m.consultadoEm.length > 0);

  // O alias curto sem subcomando faz a mesma coisa, e a tabela sai em texto.
  const tabela = ork(p.dir, ['monitor', '--sem-runtime']);
  assert.equal(tabela.codigo, 0, tabela.saida);
  assert.ok(tabela.saida.includes('AGUARDA DO HUMANO'), tabela.saida);
  assert.ok(tabela.saida.includes('plano'), tabela.saida);

  // Com gente esperando veredito, o watchdog reprova.
  const sujo = ork(p.dir, ['orquestracao', 'status', '--sem-runtime', '--exigir-limpo']);
  assert.equal(sujo.codigo, 1, sujo.saida);

  // Subcomando errado e `--atencao` invalido reclamam com codigo de uso.
  assert.equal(ork(p.dir, ['orquestracao', 'stauts']).codigo, 2);
  assert.equal(ork(p.dir, ['monitor', '--atencao', 'depois']).codigo, 2);
});

// ---------------------------------------------------------------------------
// Thread torta em disco: o bug que os testes em memoria nao pegavam.
// ---------------------------------------------------------------------------

/** Reescreve o `thread.json` cru, como faria uma versao antiga ou uma edicao a mao. */
function adulterarThreadEmDisco(raiz: string, id: string, mexer: (t: any) => void): void {
  const caminho = caminhoThread(raiz, id);
  const cru = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  mexer(cru);
  fs.writeFileSync(caminho, JSON.stringify(cru, null, 2) + '\n', 'utf8');
}

test('thread com modo desconhecido ou ausente em disco nao derruba o monitor', (t) => {
  const p = projetoTemporario('monitor-modo-torto');
  t.after(() => p.limpar());

  // As tres nascem validas; duas sao adulteradas EM DISCO, que e o caminho real:
  // `lerThread` faz `lerJson<Thread>` sem validar, entao `thread.modo` chega como o
  // arquivo mandar. `MODOS[thread.modo].tag` estourava e derrubava o comando inteiro.
  const { thread: boa } = novaThread(p.carregado, { nome: 'Modo valido', modo: 'classic' });
  const { thread: antiga } = novaThread(p.carregado, { nome: 'Modo de versao antiga', modo: 'classic' });
  const { thread: semModo } = novaThread(p.carregado, { nome: 'Thread sem modo', modo: 'classic' });

  adulterarThreadEmDisco(p.dir, antiga.id, (t) => {
    t.modo = 'default';
  });
  adulterarThreadEmDisco(p.dir, semModo.id, (t) => {
    delete t.modo;
  });

  const m = monitorar(p);
  assert.equal(m.linhas.length, 3, 'o monitor precisa listar as tres, inclusive as tortas');
  assert.equal(linha(m, boa.id).tag, '#Classic');
  assert.equal(linha(m, antiga.id).tag, `${TAG_DE_MODO_DESCONHECIDO}default`);
  assert.equal(linha(m, semModo.id).tag, TAG_DE_MODO_DESCONHECIDO);

  // A tabela em texto tambem passa pela tag; nenhuma das duas pode lancar.
  const texto = textoDoMonitor(m);
  assert.ok(texto.includes(antiga.id), texto);
  assert.ok(texto.includes(semModo.id), texto);
});

test('pelo binario, `orquestracao status` le thread sem modo sem erro, com --json e --all', (t) => {
  const p = projetoTemporario('monitor-modo-torto-cli');
  t.after(() => p.limpar());

  const { thread } = novaThread(p.carregado, { nome: 'Thread sem modo', modo: 'classic' });
  adulterarThreadEmDisco(p.dir, thread.id, (t) => {
    delete t.modo;
  });

  // Um segundo perfil de board com a mesma thread torta: e o caminho que `--all` varre
  // (`threadsDeTodosOsPerfis`), e onde o modo mais provavelmente vem de outra versao.
  const raizPerfil = path.join(p.dir, '.orkastery', 'perfis', 'legado');
  const origem = dirThread(p.dir, thread.id);
  const destino = dirThread(raizPerfil, thread.id);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.cpSync(origem, destino, { recursive: true });

  const tabela = ork(p.dir, ['orquestracao', 'status', '--sem-runtime']);
  assert.equal(tabela.codigo, 0, tabela.saida);
  assert.ok(!tabela.saida.includes('Cannot read properties'), tabela.saida);
  assert.ok(tabela.saida.includes(thread.id), tabela.saida);

  const json = ork(p.dir, ['orquestracao', 'status', '--sem-runtime', '--json']);
  assert.equal(json.codigo, 0, json.saida);
  const m = JSON.parse(json.saida) as MonitorDeOrquestracao;
  assert.equal(m.linhas.length, 1);
  assert.equal(m.linhas[0].tag, TAG_DE_MODO_DESCONHECIDO);

  const todos = ork(p.dir, ['orquestracao', 'status', '--sem-runtime', '--all', '--json']);
  assert.equal(todos.codigo, 0, todos.saida);
  const mTodos = JSON.parse(todos.saida) as MonitorDeOrquestracao;
  assert.equal(mTodos.linhas.length, 2, 'o perfil legado tambem tem de aparecer');
  assert.deepEqual(
    mTodos.linhas.map((l) => l.perfil).sort(),
    ['default', 'legado'],
    todos.saida
  );
  for (const l of mTodos.linhas) assert.equal(l.tag, TAG_DE_MODO_DESCONHECIDO);

  // O board e o `thread list` liam a mesma tag e caiam pelo mesmo motivo.
  const board = ork(p.dir, ['board', '--all']);
  assert.equal(board.codigo, 0, board.saida);
  assert.ok(board.saida.includes(TAG_DE_MODO_DESCONHECIDO), board.saida);
  assert.equal(ork(p.dir, ['thread', 'list']).codigo, 0);
});

// ---------------------------------------------------------------------------
// Regressao do incidente de 05/09/2026: "viva" nao e "trabalhando".
// ---------------------------------------------------------------------------

test('sessao BLOCKED no runtime e pausa VALENDO, e nao uma sessao que ainda vai terminar', (t) => {
  const p = projetoTemporario('monitor-blocked');
  const runtime = runtimeFalso('monitor-blocked');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'Publicar pacote', modo: 'classic' });
  const r = rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'desenhe o plano' });
  assert.equal(r.pausaAoFim, true);

  // Trabalhando: a pausa e prevista, nao chegou, e ninguem e acordado.
  const trabalhando = linha(montarMonitor(p.carregado), thread.id);
  assert.equal(trabalhando.pausas[0].sessaoViva, true);
  assert.equal(trabalhando.precisaDeHumano, false);

  // A sessao trava esperando o humano (foi o codigo 2FA do `npm publish`). Ela CONTINUA
  // aparecendo no `claude agents`, e era exatamente ai que o monitor errava: ele lia a
  // presenca na lista como "ainda trabalha" e nao avisava ninguem.
  runtime.estadoDaSessao('blocked');
  const m = montarMonitor(p.carregado);
  const l = linha(m, thread.id);
  assert.equal(l.pausas[0].sessaoViva, false, 'sessao bloqueada nao esta trabalhando');
  assert.equal(l.pausas[0].sessaoEstado, 'blocked', 'o estado cru do runtime fica declarado');
  assert.equal(l.precisaDeHumano, true, 'o incidente: isto tinha de acordar o orquestrador');
  assert.equal(l.situacao, 'pausada');
  assert.equal(m.resumo.aguardandoHumano, 1);
  assert.match(l.pausas[0].detalhe, /BLOQUEADA no runtime/);
  assert.match(l.pausas[0].correcao, /ork sessions logs/, 'a correcao leva ao que a sessao pede');
  assert.match(l.pausas[0].evidencia, /state=blocked/);

  const texto = textoDoMonitor(m);
  assert.match(texto, /Esperando VEREDITO HUMANO agora/);
  assert.doesNotMatch(texto, /Pausa PREVISTA, sessao ainda viva/);
});

test('sessao que voltou a trabalhar sai da fila do humano sem intervencao', (t) => {
  const p = projetoTemporario('monitor-destrava');
  const runtime = runtimeFalso('monitor-destrava');
  t.after(() => {
    runtime.restaurar();
    p.limpar();
  });

  const { thread } = novaThread(p.carregado, { nome: 'Retomada', modo: 'classic' });
  rodarFase(p.carregado, thread.id, { fase: 'PLAN', prompt: 'plano' });
  runtime.estadoDaSessao('blocked');
  assert.equal(montarMonitor(p.carregado).resumo.aguardandoHumano, 1);

  // O humano respondeu o prompt e a sessao seguiu: o monitor tem de esfriar sozinho.
  runtime.estadoDaSessao('working');
  const m = montarMonitor(p.carregado);
  assert.equal(m.resumo.aguardandoHumano, 0);
  assert.equal(linha(m, thread.id).pausas[0].sessaoViva, true);
});
