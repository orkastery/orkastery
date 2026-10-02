/**
 * RM-037 (fatia 4, item 1 no pulse): o trabalho parado no condutor sai do "Esperando voce" e vira linha
 * propria, "parado no condutor desde HH:MM: <proximo passo>", sem pergunta ao dono.
 *
 * O pulse de 01/10 as 23:53 dizia "Precisa de humano agora: 3", e uma delas era a ork-estadodoroad, cujo
 * PR tinha os quatro checks verdes: o `human.pending` que o observador grava quando a sessao claude-bg
 * encerra o turno em `blocked` contava como pergunta do dono. Projeto, threads, sessoes, PRs e canal
 * SIMULADOS; o executor do `gh` nunca toca a rede.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { exec } from '../src/util';
import { definirFusoDoDono } from '../src/horario';
import { comporPulse, montarPulse, textoDoPulse } from '../src/pulse';
import { resumirHitl, textoDoResumo } from '../src/hitl-resumo';
import { varrerPulse } from '../src/pulse-delivery';
import { montarMonitor } from '../src/orquestracao';
import { ExecutorDoGh, lerRetratoDePrs, ParadoNoCondutor } from '../src/parado-no-condutor';
import { RadarDeSessoes, SessaoNoRadar } from '../src/types';
import { itemDoGate, pulseCom } from './apoio-pulse';

const AGORA = '2026-10-02T01:21:00.000Z'; // 22:21 de 01/10 em Brasilia
const FIM = '2026-10-01T07:28:00.000Z';   // 04:28
const SHA_DO_SENSOR = 'b'.repeat(64);
const git = (dir: string, ...args: string[]) => {
  const r = exec('git', args, dir);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const SIMULADA = { ok: true, sessoes: [], detalhe: 'SIMULADO' };

function cenario(nome: string, opcoes: { publicar?: boolean; pausaAoFim?: boolean } = {}) {
  const p = projetoTemporario(nome, true);
  definirFusoDoDono('America/Sao_Paulo');
  const { thread: t } = novaThread(p.carregado, { nome: 'entregue sem push', modo: 'auto' });
  const branch = `ork/${t.slug}`, dir = dirThread(p.dir, t.id);
  git(p.dir, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(p.dir, 'produto.txt'), 'produto SIMULADO\n');
  git(p.dir, 'add', '--', 'produto.txt');
  git(p.dir, 'commit', '-q', '-m', 'produto SIMULADO');
  git(p.dir, 'checkout', '-q', 'main');
  if (opcoes.publicar) git(p.dir, 'push', '-q', 'origin', branch);
  const sessionId = '00000000-0000-4000-8000-0000000000aa', despachoEm = '2026-10-01T05:06:17.008Z';
  registrar(dir, t.id, 'phase_dispatch', { ts: '2026-10-01T05:06:17.000Z', fase: 'GOAL', modo: 'auto', bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER',
    pausaAoFim: opcoes.pausaAoFim ?? false, runtime: 'claude-bg', sessionId });
  registrar(dir, t.id, 'runtime_stop', { ts: '2026-10-01T07:27:48.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg', despachoEm,
    fonte: 'ork sessions event', sensor: 'stop', sensorEventId: SHA_DO_SENSOR });
  const comum = { ts: FIM, fase: 'GOAL', sessionId, despachoEm, classificacao: 'gate_blocked', motivo: 'human.pending', runtime: 'claude-bg',
    fonte: 'Stop correlacionado e sessão viva à espera humana (blocked); SIMULADO; o humano decide', estadoNativo: 'blocked',
    statusNativo: 'idle', ok: false, estado: 'bloqueada', stop: { ts: '2026-10-01T07:27:48.000Z', sensorEventId: SHA_DO_SENSOR },
    provaOrk: { ok: true, fonte: 'SIMULADO' }, gate: 'phase.dispatch', origem: 'sessions.watch' };
  registrar(dir, t.id, 'gate_blocked', comum);
  registrar(dir, t.id, 'phase_result', comum);
  const head = git(p.dir, 'rev-parse', branch);
  return { p, t, branch, dir, head, limpar: () => { p.limpar(); definirFusoDoDono(undefined); } };
}

test('o fim de turno sem pergunta sai do dono e vira "parado no condutor", no JSON, no ork pulse e no resumo', () => {
  const c = cenario('fatia4-pulse');
  try {
    const pulse = montarPulse(c.p.carregado, { quando: AGORA, consulta: SIMULADA });
    assert.ok(!pulse.precisaDeHumanoAgora.some(i => i.thread === c.t.id), JSON.stringify(pulse.precisaDeHumanoAgora.map(i => i.id)));
    assert.equal(pulse.resumo.humanos, 0);
    assert.equal(pulse.paradoNoCondutor?.length, 1);
    assert.equal(pulse.paradoNoCondutor![0].caso, 'sem-push');
    const linha = `${c.t.id} parado no condutor desde 04:27: publicar a branch ${c.branch} e abrir o PR`;
    const texto = textoDoPulse(pulse);
    assert.match(texto, /^Precisa de humano agora: 0$/m);
    assert.match(texto, /^Parado no condutor: 1$/m);
    assert.ok(texto.split('\n').includes(linha), texto);
    // O resumo dos dois canais: a linha propria, fora de "Esperando voce", sem pergunta nenhuma.
    const resumo = resumirHitl(pulse.precisaDeHumanoAgora, { quando: AGORA, paradosNoCondutor: pulse.paradoNoCondutor });
    const telegram = textoDoResumo(resumo, { canal: 'telegram' }).split('\n');
    assert.ok(telegram.includes('Esperando você: 0'), telegram.join('\n'));
    assert.ok(telegram.includes(`🚧 ${linha}`), telegram.join('\n'));
    assert.ok(telegram.includes('Nada aqui pede resposta sua por este canal agora.'));
    const terminal = textoDoResumo(resumo, { canal: 'terminal' }).split('\n');
    assert.ok(terminal.includes(`  ${linha}`), terminal.join('\n'));
    assert.ok(terminal.some(l => /^ {2}esperando você +0$/.test(l)), terminal.join('\n'));
  } finally { c.limpar(); }
});

test('contraprova: com a pausa prevista ao fim do bloco, o veredito continua do dono e nao ha linha do condutor', () => {
  const c = cenario('fatia4-pulse-pausa', { pausaAoFim: true });
  try {
    const pulse = montarPulse(c.p.carregado, { quando: AGORA, consulta: SIMULADA });
    assert.ok(pulse.precisaDeHumanoAgora.some(i => i.thread === c.t.id && i.motivo === 'human.pending'));
    assert.equal(pulse.paradoNoCondutor, undefined);
  } finally { c.limpar(); }
});

test('a varredura entrega a linha uma vez, sem abrir pedido ao dono', () => {
  const c = cenario('fatia4-pulse-entrega');
  try {
    const pulse = montarPulse(c.p.carregado, { quando: AGORA, consulta: SIMULADA });
    const mensagens: string[] = [];
    const enviar = (m: string) => { mensagens.push(m); return true; };
    const primeira = varrerPulse({ raiz: c.p.dir, consultar: () => pulse, quando: AGORA, enviar });
    assert.equal(primeira.enviadas, 1);
    assert.match(mensagens[0], /parado no condutor desde 04:27: publicar a branch/);
    assert.match(mensagens[0], /^Esperando você: 0$/m);
    assert.doesNotMatch(mensagens[0], /Posso te mandar as perguntas agora/);
    const segunda = varrerPulse({ raiz: c.p.dir, consultar: () => pulse, quando: AGORA, enviar });
    assert.equal(segunda.enviadas, 0, 'a mesma parada nao e noticia duas vezes');
    assert.ok(!lerLedger(c.dir).some(e => e.tipo === 'hitl_requested'), 'nenhum pedido aberto ao dono');
  } finally { c.limpar(); }
});

test('PR verde lido da forja vira "mergear o PR" e o retrato fica para o status; falha da forja vira diagnostico', () => {
  const c = cenario('fatia4-pulse-forja', { publicar: true });
  try {
    git(c.p.dir, 'remote', 'set-url', 'origin', 'https://github.com/exemplo/simulado.git');
    let chamadas = 0;
    const verde: ExecutorDoGh = () => { chamadas++; return { status: 0, stderr: '', stdout: JSON.stringify([{ number: 41, state: 'OPEN',
      headRefName: c.branch, headRefOid: c.head, baseRefName: 'main', isDraft: false, isCrossRepository: false,
      url: 'https://github.com/exemplo/simulado/pull/41', createdAt: '2026-10-01T22:00:09Z', mergedAt: null, statusCheckRollup: [
        { __typename: 'CheckRun', name: 'ork-verify', status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: '2026-10-01T22:01:39Z' }] }]) }; };
    const pulse = montarPulse(c.p.carregado, { quando: AGORA, consulta: SIMULADA, executorDoGh: verde });
    assert.equal(chamadas, 2, 'duas leituras por batida: os abertos e os recentes');
    assert.equal(pulse.paradoNoCondutor?.[0].caso, 'pr-verde');
    assert.ok(textoDoPulse(pulse).includes(`${c.t.id} parado no condutor desde 19:01: mergear o PR #41`), textoDoPulse(pulse));
    assert.equal(lerRetratoDePrs(c.p.dir)?.prs[0].numero, 41, 'o retrato da leitura boa fica para o status do roadmap');
    const falha: ExecutorDoGh = () => ({ status: 4, stdout: '', stderr: 'gh auth login: SIMULADO' });
    const semForja = montarPulse(c.p.carregado, { quando: AGORA, consulta: SIMULADA, executorDoGh: falha });
    assert.ok(!semForja.paradoNoCondutor?.some(x => x.caso === 'sem-pr'), 'sem leitura nao se afirma "sem PR"');
    assert.equal(semForja.paradoNoCondutor?.[0].proximoPasso, `conferir o PR da branch ${c.branch} (PR não lido) e seguir`,
      'o fim de turno que saiu do dono volta como linha');
    assert.match(semForja.runtime.detalhe, /prs\.nao-lidos: gh pr list falhou \(código 4\)/);
    assert.match(textoDoPulse(semForja), /^\[diagnostico\] .*prs\.nao-lidos/m);
    assert.ok(!semForja.precisaDeHumanoAgora.some(i => i.thread === c.t.id), 'o fim de turno continua fora do dono');
  } finally { c.limpar(); }
});

test('radar: sessao blocked sem menu de thread fechada sai do dono; com menu, a pergunta continua dele', () => {
  const c = cenario('fatia4-pulse-radar');
  try {
    const { thread: velha } = novaThread(c.p.carregado, { nome: 'fechada', modo: 'auto' });
    const fechada = lerThread(c.p.dir, velha.id); fechada.status = 'fechada'; gravarThread(c.p.dir, fechada);
    const sessionId = '00000000-0000-4000-8000-0000000000bb';
    const sessao = (alternativas: string[]): SessaoNoRadar => ({ id: sessionId.slice(0, 8), sessionId, nome: 'SIMULADA', cwd: '/tmp/simulada',
      kind: 'background', estadoBruto: 'blocked', classe: 'hitl', tipoDeHitl: alternativas.length ? 'hitl.pergunta' : 'hitl.desconhecido',
      jobVivo: true, precisaDeHumano: true, detalhe: 'SIMULADO', desdeEm: '2026-10-01T03:00:00.000Z', idadeMin: 1300, pergunta: '',
      alternativas, thread: { id: velha.id, fase: 'CHECK', slug: velha.slug }, recomendacao: '', comandos: { logs: '', attach: '', parar: '' },
      acimaDoLimite: true, bloqueadaDesdeEm: '2026-10-01T09:00:00.000Z', paradaHaMin: 980 });
    const radar = (alternativas: string[]): RadarDeSessoes => ({ consultadoEm: AGORA, atencaoMin: 30, runtimeConsultado: true, runtimeDetalhe: '',
      logsLidos: true, raiz: c.p.dir, sessoes: [sessao(alternativas)], resumo: { total: 1, precisamDeHumano: 1, hitl: 1, abandonadas: 0,
        falhas: 0, trabalhando: 0, desconhecidas: 0, acimaDoLimite: 1, foraDoOrk: 0 } });
    const monitor = montarMonitor(c.p.carregado, { agora: AGORA, estados: new Map() });
    const sem = comporPulse(c.p.carregado, { radar: radar([]), monitor, batch: [], orfas: [] });
    assert.ok(!sem.precisaDeHumanoAgora.some(i => i.sessionId === sessionId));
    assert.ok(sem.paradoNoCondutor?.some(x => x.thread === velha.id && x.proximoPasso.startsWith(`encerrar a sessão ${sessionId.slice(0, 8)}`)));
    const com = comporPulse(c.p.carregado, { radar: radar(['1. Sim', '2. Não']), monitor, batch: [], orfas: [] });
    assert.ok(com.precisaDeHumanoAgora.some(i => i.sessionId === sessionId), 'menu na tela e pergunta de verdade');
  } finally { c.limpar(); }
});

test('aviso 6 do CHECK: a parada que some por uma batida e volta nao e noticia de novo; outra, horas depois, e', () => {
  const p = projetoTemporario('fatia4-pulse-retem');
  try {
    const parado: ParadoNoCondutor = { thread: 'ork-simulada', caso: 'pr-verde', desdeEm: '2026-10-01T22:01:00.000Z', paradoHaMin: 200,
      proximoPasso: 'mergear o PR #41', evidencia: [], branch: 'ork/ork-simulada-full', pr: 41, sessionId: null, prLidoEm: AGORA };
    const mensagens: string[] = [];
    const varrer = (quando: string, comParada: boolean) => varrerPulse({ raiz: p.dir, quando, enviar: m => { mensagens.push(m); return true; },
      consultar: () => ({ ...pulseCom([], quando), ...(comParada ? { paradoNoCondutor: [parado] } : {}) }) });
    const t0 = Date.parse(AGORA), min = (n: number) => new Date(t0 + n * 60000).toISOString();
    assert.equal(varrer(min(0), true).enviadas, 1);
    assert.equal(varrer(min(15), false).enviadas, 0, 'a batida em que o gh falhou nao manda nada');
    assert.equal(varrer(min(30), true).enviadas, 0, 'a mesma parada, de volta, nao e noticia');
    assert.equal(varrer(min(45 + 7 * 60), false).enviadas, 0);
    assert.equal(varrer(min(60 + 7 * 60), true).enviadas, 1, 'sumida por mais de 6 h, volta como episodio novo');
    assert.equal(mensagens.length, 2);
  } finally { p.limpar(); }
});

test('o transporte passa a mensagem como texto: $& nela nao vira padrao de substituicao', () => {
  const p = projetoTemporario('fatia4-pulse-transporte');
  try {
    const sink = path.join(p.dir, 'sink.txt');
    const r = varrerPulse({ raiz: p.dir, quando: AGORA, consultar: () => pulseCom([itemDoGate('ork-$&-simulada', 0)], AGORA),
      transporte: { executavel: process.execPath, argumentos: ['-e', 'require("fs").writeFileSync(process.argv[1],process.argv[2])', sink, '{{mensagem}}'] } });
    assert.equal(r.enviadas, 1);
    const enviado = fs.readFileSync(sink, 'utf8');
    assert.match(enviado, /ork-\$&-simulada/);
    assert.doesNotMatch(enviado, /\{\{mensagem\}\}/);
  } finally { p.limpar(); }
});

test('B1 do CHECK: a sessao nativa do Codex em blocked e pergunta estruturada e continua em "Esperando voce"', () => {
  const c = cenario('fatia4-pulse-codex');
  try {
    const { thread: outra } = novaThread(c.p.carregado, { nome: 'codex', modo: 'auto' });
    const sessionId = '00000000-0000-4000-8000-0000000000cc';
    const sessao: SessaoNoRadar = { id: sessionId.slice(0, 8), sessionId, nome: 'SIMULADA', cwd: '/tmp/simulada', kind: 'codex-controller',
      estadoBruto: 'blocked', classe: 'hitl', tipoDeHitl: null, jobVivo: true, precisaDeHumano: true, detalhe: 'SIMULADO',
      desdeEm: '2026-10-01T20:00:00.000Z', idadeMin: 300, pergunta: '', alternativas: [], thread: { id: outra.id, fase: 'CHECK', slug: outra.slug },
      recomendacao: '', comandos: { logs: '', attach: '', parar: '' }, acimaDoLimite: true, bloqueadaDesdeEm: '2026-10-01T20:10:00.000Z', paradaHaMin: 300 };
    const radar: RadarDeSessoes = { consultadoEm: AGORA, atencaoMin: 30, runtimeConsultado: true, runtimeDetalhe: '', logsLidos: true, raiz: c.p.dir,
      sessoes: [sessao], resumo: { total: 1, precisamDeHumano: 1, hitl: 1, abandonadas: 0, falhas: 0, trabalhando: 0, desconhecidas: 0,
        acimaDoLimite: 1, foraDoOrk: 0 } };
    const pulse = comporPulse(c.p.carregado, { radar, monitor: montarMonitor(c.p.carregado, { agora: AGORA, estados: new Map() }), batch: [], orfas: [] });
    assert.ok(pulse.precisaDeHumanoAgora.some(i => i.sessionId === sessionId));
    assert.ok(!pulse.paradoNoCondutor?.some(x => x.thread === outra.id));
  } finally { c.limpar(); }
});
