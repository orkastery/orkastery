/**
 * RM-063 (fatia 3): o que o nucleo da aos hosts (Hermes e OpenClaw).
 *
 *  H1: o `ork doctor --json` (`ork.doctor/v1`) que a batida do host le de forma deterministica, com a idade da ultima
 *      rodada da varredura e o aviso pronto quando ela passou de 30 min; e o doctor que reprova a batida parada mesmo com
 *      a linha no crontab (antes, a linha instalada bastava, e o cron parado passava como "ok");
 *  H4: o transporte do pulse que tenta o outro host configurado quando o principal falha, cada entrega no
 *      `transporte.log`, e o `ork doctor` que mostra a falha (o desvio e aviso; nenhum transporte e falha).
 *
 * Crontab, transportes e projeto simulados: nada toca o crontab da maquina nem um canal de verdade.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';
import { batidaNoDoctor, checarCronDoPulse, checarTransporteDoPulse, ultimaEntrega } from '../src/doctor-pulse-cron';
import { caminhoDaBatida } from '../src/fabrica-batida';
import { novaThread } from '../src/thread';
import { ItemPulse, Pulse } from '../src/pulse';
import { varrerPulse } from '../src/pulse-delivery';
import { pastaDoUsuario } from '../src/maquina';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const MIN = 60_000;

function comThreadEBatida(nome: string, rodadaHaMin: number | null): { p: ProjetoDeTeste; monitor: string } {
  const p = projetoTemporario(nome);
  novaThread(p.carregado, { nome: `${nome}-t`, modo: 'auto' });
  const monitor = path.join(p.dir, '.orkastery', 'monitor');
  fs.mkdirSync(monitor, { recursive: true });
  if (rodadaHaMin !== null) {
    fs.writeFileSync(path.join(monitor, 'hitl.log'), JSON.stringify({ ts: new Date(Date.now() - rodadaHaMin * MIN).toISOString(),
      tipo: 'pulse_scan', code: 0, novas: 0, enviadas: 0, detalhe: 'sem novidade' }) + '\n');
  }
  return { p, monitor };
}

const crontabCom = (raiz: string) => () => ({ ok: true as const,
  texto: `*/15 * * * * ORK_PULSE_PROJECT=${raiz} /opt/ork/monitor/varredura-pulse.sh # ork-batida\n` });

test('H1: com a linha no crontab e thread aberta, a ultima rodada de 45 min atras reprova; a de 10 min passa', () => {
  const { p, monitor } = comThreadEBatida('rm063-h1-atrasada', 45);
  try {
    const parada = checarCronDoPulse(monitor, p.dir, crontabCom(p.dir), null, 1);
    assert.equal(parada?.nivel, 'fail', JSON.stringify(parada));
    assert.match(String(parada?.detalhe), /ultima rodada foi ha 45 min \(hitl\.log\): a batida parou/);
    assert.match(String(parada?.correcao), /ork fabrica batida status/);
    const r = batidaNoDoctor(monitor, p.dir, { projeto: 'orkastery', maquina: 'maquina-b', ler: crontabCom(p.dir), abertas: 1 });
    assert.deepEqual([r.instalada, r.haMin, r.atrasada, r.limiteMin], [true, 45, true, 30]);
    assert.match(String(r.aviso), /^Orkastery: a fabrica orkastery na maquina maquina-b esta sem batida ha 45 min \(ultima rodada em .*\), com 1 thread\(s\) aberta\(s\)\. Confira com: ork fabrica batida status$/);
    fs.writeFileSync(path.join(monitor, 'hitl.log'), JSON.stringify({ ts: new Date(Date.now() - 10 * MIN).toISOString(), tipo: 'pulse_scan', code: 0 }) + '\n');
    assert.equal(checarCronDoPulse(monitor, p.dir, crontabCom(p.dir), null, 1)?.nivel, 'ok');
    const viva = batidaNoDoctor(monitor, p.dir, { projeto: 'orkastery', maquina: 'maquina-b', ler: crontabCom(p.dir), abertas: 1 });
    assert.deepEqual([viva.atrasada, viva.aviso], [false, null]);
  } finally { p.limpar(); }
});

test('H1: sem rodada nenhuma, a batida instalada agora nao e atraso; sem linha e sem rodada, e', () => {
  const { p, monitor } = comThreadEBatida('rm063-h1-nunca', null);
  try {
    const instalada = batidaNoDoctor(monitor, p.dir, { projeto: 'x', maquina: 'm', ler: crontabCom(p.dir), abertas: 2 });
    assert.deepEqual([instalada.instalada, instalada.atrasada], [true, false]);
    const nenhuma = batidaNoDoctor(monitor, p.dir, { projeto: 'x', maquina: 'm', ler: () => ({ ok: true as const, texto: '' }), abertas: 2 });
    assert.deepEqual([nenhuma.instalada, nenhuma.atrasada], [false, true]);
    assert.match(String(nenhuma.aviso), /nao tem batida .* Instale com: ork fabrica batida instalar$/);
    const semThread = batidaNoDoctor(monitor, p.dir, { projeto: 'x', maquina: 'm', ler: () => ({ ok: true as const, texto: '' }), abertas: 0 });
    assert.deepEqual([semThread.atrasada, semThread.aviso], [false, null], 'sem thread aberta, nada a vigiar');
  } finally { p.limpar(); }
});

test('H1: ork doctor --json e o contrato ork.doctor/v1, com a batida atrasada e o aviso que o host manda', () => {
  const { p } = comThreadEBatida('rm063-h1-json', 50);
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C.UTF-8' };
    for (const k of ['ORK_PROJETO', 'ORK_PROJETO_EXPLICITO', 'LC_ALL']) delete env[k];
    const r = spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: p.dir, encoding: 'utf8', env, timeout: 120_000 });
    const j = JSON.parse(r.stdout) as { contrato: string; veredito: string; projeto: string; checks: { nome: string; nivel: string }[];
      batida: { atrasada: boolean; haMin: number; aviso: string } };
    assert.equal(j.contrato, 'ork.doctor/v1');
    assert.equal(r.status, j.veredito === 'bloqueado' ? 1 : 0, 'o codigo de saida segue o veredito');
    assert.equal(j.projeto, p.carregado.manifesto.project.name);
    assert.ok(j.checks.some((c) => c.nome === 'cadencia do pulse no cron' && c.nivel === 'fail'));
    assert.deepEqual([j.batida.atrasada, j.batida.haMin], [true, 50]);
    assert.match(j.batida.aviso, /esta sem batida ha 50 min/);
  } finally { p.limpar(); }
});

/** Um transporte simulado: o script grava a mensagem e sai com o codigo pedido. */
function transporte(dir: string, nome: string, codigo: number): { executavel: string; argumentos: string[]; recebidas: () => string[] } {
  const bin = path.join(dir, nome);
  const saida = path.join(dir, `${nome}.recebidas`);
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n---\\n' "$2" >> '${saida}'\necho "${nome} saiu ${codigo}" >&2\nexit ${codigo}\n`, { mode: 0o755 });
  return { executavel: bin, argumentos: ['--message', '{{mensagem}}'],
    recebidas: () => fs.existsSync(saida) ? fs.readFileSync(saida, 'utf8').split('\n---\n').filter(Boolean) : [] };
}

const item: ItemPulse = { id: 'sessao:fake', classe: 'hitl', motivo: 'hitl.pergunta', thread: null, fase: null, sessionId: 'fake',
  desdeEm: '2026-10-13T10:01:00Z', paradaHaMin: 4, impacto: 0, pergunta: 'Qual opção?', opcoes: ['1. Continuar'],
  recomendacao: 'Revisar.', comandoResposta: 'claude attach fake', evidencia: [], fontes: ['sessions hitl'], contextoLogs: [] };
const radar = (consultadoEm: string, itens: ItemPulse[]): Pulse => ({ contrato: 'ork.pulse/v1', consultadoEm, runtime: { ok: true, detalhe: '' },
  precisaDeHumanoAgora: itens, acoesAutomaticas: [], resumo: { humanos: itens.length, automaticas: 0, scores: 0, fasesOrfas: 0 } });

test('H4: o openclaw falha e o resumo sai pelo hermes configurado; o doctor mostra o desvio; nenhum transporte e falha', () => {
  const p = projetoTemporario('rm063-h4-transporte');
  try {
    const bins = dirTemporario('rm063-h4-bins');
    const openclaw = transporte(bins, 'openclaw', 1), hermes = transporte(bins, 'python3-hermes', 0);
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ host: 'openclaw', destino: 'telegram:123',
      executavel: openclaw.executavel, argumentos: openclaw.argumentos,
      alternativos: [{ host: 'hermes', destino: 'telegram:123', executavel: hermes.executavel, argumentos: hermes.argumentos }] }));
    const quando = new Date().toISOString();
    const r = varrerPulse({ raiz: p.dir, consultar: () => radar(quando, [item]), quando });
    assert.deepEqual([r.code, r.enviadas], [0, 1], r.detalhe);
    assert.equal(openclaw.recebidas().length, 1, 'o principal foi tentado primeiro');
    assert.match(hermes.recebidas()[0], /^🔔 Orkastery, resumo de /, 'o hermes entregou o resumo');
    const entrega = ultimaEntrega(monitor);
    assert.deepEqual([entrega?.ok, entrega?.host, entrega?.tentativas.map((t) => [t.host, t.ok, t.codigo])],
      [true, 'hermes', [['openclaw', false, 1], ['hermes', true, 0]]]);
    assert.match(String(entrega?.tentativas[0].detalhe), /openclaw saiu 1/);
    const desvio = checarTransporteDoPulse(monitor);
    assert.equal(desvio?.nivel, 'warn');
    assert.match(String(desvio?.detalhe), /o transporte openclaw falhou em .*, e o resumo saiu pelo hermes/);
    // Os dois falham: a novidade fica guardada, e o doctor reprova.
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ host: 'openclaw', executavel: openclaw.executavel,
      argumentos: openclaw.argumentos, alternativos: [{ host: 'hermes', executavel: transporte(bins, 'hermes-quebrado', 2).executavel,
        argumentos: ['--message', '{{mensagem}}'] }] }));
    const r2 = varrerPulse({ raiz: p.dir, consultar: () => radar(new Date().toISOString(), [{ ...item, pergunta: 'Outra?' }]) });
    assert.equal(r2.code, 1);
    assert.match(r2.detalhe, /transporte não confirmou o resumo; novidade preservada/);
    const falha = checarTransporteDoPulse(monitor);
    assert.equal(falha?.nivel, 'fail');
    assert.match(String(falha?.detalhe), /nao saiu por nenhum transporte configurado \(openclaw: 1; hermes: 2\)/);
    // A batida do cron acha os dois executaveis no PATH dela.
    const caminho = caminhoDaBatida({ node: '/usr/bin/node', transporte: [openclaw.executavel, hermes.executavel], achar: () => null });
    assert.ok(caminho.split(':').includes(bins), caminho);
  } finally { p.limpar(); }
});

test('H4: sem pulse-host.json ou sem entrega nas ultimas 24 h, o doctor nao fala de transporte', () => {
  const p = projetoTemporario('rm063-h4-sem');
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    assert.equal(checarTransporteDoPulse(monitor), null);
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), '{}');
    fs.writeFileSync(path.join(monitor, 'transporte.log'), JSON.stringify({ ts: new Date(Date.now() - 30 * 3600_000).toISOString(),
      tipo: 'transporte_entrega', oQue: 'o resumo', ok: false, host: null, tentativas: [{ host: 'openclaw', ok: false, codigo: 1, detalhe: '' }] }) + '\n');
    assert.equal(checarTransporteDoPulse(monitor), null, 'a falha de ontem nao e noticia de hoje');
  } finally { p.limpar(); }
});

test('GO-FIX: logo depois do batida instalar, o hitl.log velho de antes da instalacao nao e atraso', () => {
  const { p, monitor } = comThreadEBatida('rm063-gofix-recem', 45);
  try {
    const ledger = path.join(pastaDoUsuario(), 'ledger.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    const instalada = (haMin: number) => JSON.stringify({ ts: new Date(Date.now() - haMin * MIN).toISOString(), thread: 'maquina',
      tipo: 'batida_instalada', projeto: p.dir }) + '\n';
    fs.appendFileSync(ledger, instalada(5));
    assert.equal(checarCronDoPulse(monitor, p.dir, crontabCom(p.dir), null, 1)?.nivel, 'ok');
    assert.equal(batidaNoDoctor(monitor, p.dir, { projeto: 'x', maquina: 'm', ler: crontabCom(p.dir), abertas: 1 }).atrasada, false);
    // Instalada ha 40 min e ainda sem rodada nova: agora e atraso.
    fs.appendFileSync(ledger, instalada(40));
    assert.equal(checarCronDoPulse(monitor, p.dir, crontabCom(p.dir), null, 1)?.nivel, 'fail');
  } finally { p.limpar(); }
});
