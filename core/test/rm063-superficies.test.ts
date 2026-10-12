/**
 * RM-063 (F2): superficies honestas.
 *
 * O incidente de 12/10/2026 (P2 da pagina da RM-063): com o despacho do GO da K7 morto e o daemon do
 * claude-bg fora do ar, o `ork roadmap status` disse "Precisa de voce: nada agora" e "sigo ork-rm026k7conhe
 * na fase GO", enquanto o `ork pulse` contava 3 itens que precisavam do dono.
 *
 * Prova: o "sigo" so sai com sessao viva verificada no runtime (stub do `claude` com e sem processo);
 * sessao fantasma, despacho falho e nenhuma sessao viram "<thread> parada desde HH:MM: <motivo>"; o fecho le
 * a mesma fila do `ork pulse` e nunca diz "Nada agora" com item do dono nela; e o `ork fabrica` mostra a
 * sessao de cada thread. Projeto, itens, threads e runtime SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimeFalso } from './apoio';
import { FatoDeThread, FilaDoDono, montarStatusDeFatos, montarStatusDoRoadmap, textoDoStatusDoRoadmap } from '../src/roadmap-status';
import { carregarDocs } from '../src/docs';
import { rodarFase } from '../src/phase';
import { RUNTIMES } from '../src/runtimes';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { definirFusoDoDono } from '../src/horario';
import { painelDaFabricaEmMarkdown, retratoDaMaquina, textoDaFabrica } from '../src/fabrica-estado';
import { LeituraDoRuntime, paradaDesde, VALIDADE_DA_VIDA_NO_RETRATO_MS, vidaDaThread, vidaDoRetrato } from '../src/vida-da-thread';
import { EventoLedger, Thread } from '../src/types';
import { main } from '../src/index';
import { ativarLocale } from '../src/locale';

const RESPONDEU: LeituraDoRuntime = { responderam: ['claude-bg', 'codex'], falhas: [], sessoes: [] };

function item(dir: string, id: string, thread: string): void {
  const fm = ['---', `id: ${id}`, 'tipo: roadmap', `titulo: "Item ${id} simulado"`, 'categoria: melhoria', 'pai: null', 'features: []',
    'owner: Dono', 'atualizado_em: 2026-10-12T00:00:00-03:00', 'estado:', '  ciclo: Em desenvolvimento', '  documentacao: Rascunho',
    '  codigo: Não iniciado', '  testes: Não iniciados', '  deploy: Não implantado', '  exposicao: Flag desligada',
    '  habilitacao: Pendente', 'evidencias:', '  codigo:', '    commit: null', '    pr: null',
    'sdlc:', `  thread: ${thread}`, '---', '', `# ${id}`, ''].join('\n');
  fs.mkdirSync(path.join(dir, 'docs', 'roadmap'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'roadmap', `${id}-simulado.md`), fm);
}

const fecho = (texto: string): { precisa: string[]; seguir: string[] } => {
  const linhas = texto.split('\n');
  const p = linhas.indexOf('O que precisa de você'), s = linhas.indexOf('O que eu faço em seguida');
  return { precisa: linhas.slice(p + 1, s).filter(Boolean), seguir: linhas.slice(s + 1).filter(Boolean) };
};

test('F2: sessao fantasma em GO nao produz "sigo"; a mesma sessao viva produz', (t) => {
  const p = projetoTemporario('rm062-f2-fantasma');
  const runtime = runtimeFalso('rm062-f2-fantasma');
  t.after(() => { runtime.restaurar(); p.limpar(); definirFusoDoDono(undefined); });
  definirFusoDoDono('America/Sao_Paulo');
  const { thread } = novaThread(p.carregado, { nome: 'k7 simulada', modo: 'auto' });
  item(p.dir, 'RM-026', thread.id);
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente o GO' });
  assert.ok(r.sessionId, r.erro);

  // Viva: o `claude agents` traz a sessao com o pid de um processo que existe.
  const viva = fecho(textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { projeto: 'orkastery' })));
  assert.deepEqual(viva.seguir, [`• RM-026: sigo ${thread.id} na fase GO.`]);

  // Fantasma: o registro continua no runtime, sem processo (o daemon caiu). O lease da sessao segue de pe.
  runtime.pidDaSessao(null);
  const quando = new Date().toISOString();
  const s = montarStatusDoRoadmap(p.dir, { quando, projeto: 'orkastery' });
  const fantasma = fecho(textoDoStatusDoRoadmap(s));
  assert.ok(!fantasma.seguir.some((l) => l.includes('sigo')), fantasma.seguir.join('\n'));
  const ultimoDaSessao = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.sessionId === r.sessionId).at(-1)!;
  assert.deepEqual(fantasma.seguir, [`• RM-026: ${thread.id} ${paradaDesde({ desdeEm: ultimoDaSessao.ts,
    motivo: `sessão ${r.sessionId!.slice(0, 8)} sem processo (fantasma)` }, { agora: quando })}.`]);
  assert.deepEqual(s.emSeguida[0].vida, { viva: false, sessionId: r.sessionId, desdeEm: ultimoDaSessao.ts,
    motivo: `sessão ${r.sessionId!.slice(0, 8)} sem processo (fantasma)`, causa: { tipo: 'fantasma', sessao: r.sessionId!.slice(0, 8) } });
});

test('F2: despacho falho e nenhuma sessao viram "parada desde HH:MM: <motivo>"', (t) => {
  const p = projetoTemporario('rm062-f2-falho');
  const runtime = runtimeFalso('rm062-f2-falho');
  const falha = mock.method(RUNTIMES['claude-bg'], 'despachar', () => ({ ok: false, comando: [], sessionId: null, verificada: false,
    stdout: '', stderr: '', erro: 'runtime adapter indisponivel' }));
  t.after(() => { falha.mock.restore(); runtime.restaurar(); p.limpar(); });
  const { thread: falhou } = novaThread(p.carregado, { nome: 'despacho falho', modo: 'auto' });
  const { thread: nunca } = novaThread(p.carregado, { nome: 'sem sessao', modo: 'auto' });
  item(p.dir, 'RM-001', falhou.id);
  item(p.dir, 'RM-002', nunca.id);
  rodarFase(p.carregado, falhou.id, { fase: 'GO', prompt: 'implemente o GO' });
  const quando = new Date().toISOString();
  const s = montarStatusDoRoadmap(p.dir, { quando, projeto: 'orkastery', runtime: () => RESPONDEU });
  const { seguir } = fecho(textoDoStatusDoRoadmap(s));
  const falhaNoLedger = lerLedger(dirThread(p.dir, falhou.id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.despachoFalhou).at(-1)!;
  const ultimoDeNunca = lerLedger(dirThread(p.dir, nunca.id)).at(-1)!;
  assert.deepEqual(seguir, [
    `• RM-001: ${falhou.id} ${paradaDesde({ desdeEm: falhaNoLedger.ts, motivo: 'despacho de GO falhou (runtime.unavailable: runtime adapter indisponivel)' }, { agora: quando })}.`,
    `• RM-002: ${nunca.id} ${paradaDesde({ desdeEm: ultimoDeNunca.ts, motivo: 'nenhuma sessão despachada na fase GOAL' }, { agora: quando })}.`,
  ]);
});

test('F2: com item do dono na fila do pulse, o fecho nunca diz "Nada agora", e a thread que espera sai do "sigo"', () => {
  const p = projetoTemporario('rm062-f2-fila');
  try {
    const { thread: k7 } = novaThread(p.carregado, { nome: 'k7 na fila', modo: 'auto' });
    const { thread: fora } = novaThread(p.carregado, { nome: 'fora do roadmap', modo: 'auto' });
    item(p.dir, 'RM-026', k7.id);
    const quando = new Date().toISOString();
    // Sem fila (biblioteca pura) e sem nada do dono, o fecho continua dizendo "Nada agora".
    assert.equal(fecho(textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { quando, runtime: () => RESPONDEU }))).precisa[0], '• Nada agora.');

    // A fila do incidente: tres itens que precisam do dono, nenhum com pergunta de gate.
    const fila: FilaDoDono = { lida: true, detalhe: null, itens: [
      { id: `thread:${k7.id}:GO:runtime.unavailable:ledger`, thread: k7.id, sessionId: null, fase: 'GO', classe: 'thread',
        motivo: 'runtime.unavailable', pergunta: 'runtime.unavailable: processo da sessão morreu sem Stop', comando: `ork retry run ${k7.id}`, paradaHaMin: 318 },
      { id: `thread:${fora.id}:GOAL:runtime.unavailable:ledger`, thread: fora.id, sessionId: null, fase: 'GOAL', classe: 'thread',
        motivo: 'runtime.unavailable', pergunta: 'runtime.unavailable: despacho falhou', comando: `ork retry run ${fora.id}`, paradaHaMin: 30 },
      { id: 'sessao:abcdef12-0000-0000-0000-000000000000', thread: null, sessionId: 'abcdef12-0000-0000-0000-000000000000', fase: null,
        classe: 'hitl', motivo: 'permission_prompt', pergunta: 'Permitir o comando?', comando: 'claude attach abcdef12', paradaHaMin: 12 },
    ] };
    const s = montarStatusDoRoadmap(p.dir, { quando, projeto: 'orkastery', runtime: () => RESPONDEU, fila: () => fila });
    const { precisa, seguir } = fecho(textoDoStatusDoRoadmap(s));
    assert.ok(!precisa.includes('• Nada agora.'), precisa.join('\n'));
    assert.deepEqual(precisa, [
      `• RM-026 (${k7.id}, GO): runtime.unavailable: processo da sessão morreu sem Stop. Responder: ork retry run ${k7.id}`,
      `• ${fora.id} (GOAL): runtime.unavailable: despacho falhou. Responder: ork retry run ${fora.id}`,
      '• sessão abcdef12: Permitir o comando? Responder: claude attach abcdef12',
    ]);
    assert.deepEqual(seguir, ['• Nada em andamento; sigo o que você priorizar.'], 'a thread que espera o dono nao e "sigo"');
    assert.equal(s.filaDoDono?.itens.length, 3);
    assert.equal(s.filaDoDono?.itens[0].item, 'RM-026');

    // Fila que nao foi lida inteira tambem nao e "Nada agora".
    const naoLida = montarStatusDoRoadmap(p.dir, { quando, runtime: () => RESPONDEU,
      fila: () => ({ lida: false, detalhe: 'claude agents falhou (simulado)', itens: [] }) });
    assert.deepEqual(fecho(textoDoStatusDoRoadmap(naoLida)).precisa,
      ['• Fila do pulse não lida inteira (claude agents falhou (simulado)): confira com ork pulse.']);
  } finally { p.limpar(); }
});

test('F2: CLI: ork roadmap status le a mesma fila do ork pulse, e nao diz "Nada agora" com o pulse contando itens', (t) => {
  const p = projetoTemporario('rm062-f2-cli');
  const runtime = runtimeFalso('rm062-f2-cli');
  const cwd = process.cwd(), log = console.log;
  // O CLI ativa o locale do ambiente; os testes seguintes do arquivo voltam ao pt-BR.
  const lingua = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, LC_MESSAGES: process.env.LC_MESSAGES };
  Object.assign(process.env, { LANG: 'pt_BR.UTF-8', LC_ALL: '', LC_MESSAGES: '' });
  t.after(() => {
    console.log = log; process.chdir(cwd); runtime.restaurar(); p.limpar(); ativarLocale(undefined);
    for (const [k, v] of Object.entries(lingua)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const { thread: a } = novaThread(p.carregado, { nome: 'parada no runtime', modo: 'auto' });
  const { thread: b } = novaThread(p.carregado, { nome: 'outra parada', modo: 'auto' });
  item(p.dir, 'RM-026', a.id);
  for (const id of [a.id, b.id]) {
    registrar(dirThread(p.dir, id), id, TIPOS_DE_EVENTO.gateBloqueado, { fase: 'GOAL', motivo: 'runtime.unavailable', gate: 'phase.dispatch',
      modo: 'auto', detalhe: 'runtime.unavailable: daemon do runtime fora do ar (simulado)', correcao: `ork retry run ${id}` });
  }
  process.chdir(p.dir);
  let saida = '';
  console.log = (s: unknown) => { saida += `${String(s)}\n`; };
  main(['pulse', '--json']);
  const pulse = JSON.parse(saida) as { precisaDeHumanoAgora: { thread: string | null }[] };
  const doPulse = pulse.precisaDeHumanoAgora.map((i) => i.thread).filter((x): x is string => !!x).sort();
  assert.deepEqual(doPulse, [a.id, b.id].sort(), 'o pulse conta as duas threads');
  saida = '';
  assert.equal(main(['roadmap', 'status', '--json']), 0);
  const status = JSON.parse(saida);
  const ditas = [...status.precisaDeVoce.map((x: { espera: { thread: string } }) => x.espera.thread),
    ...(status.filaDoDono?.itens ?? []).map((x: { thread: string | null }) => x.thread),
    ...(status.foraDoRoadmap?.threads ?? [])].filter(Boolean).sort();
  assert.deepEqual([...new Set(ditas)], doPulse, 'as duas superficies, a mesma fila');
  saida = '';
  assert.equal(main(['roadmap', 'status']), 0);
  assert.doesNotMatch(saida, /• Nada agora\./);
});

test('F2: ork fabrica mostra a sessao de cada thread: viva, parada desde HH:MM, ou - no retrato antigo', () => {
  const p = projetoTemporario('rm062-f2-fabrica');
  try {
    const { thread: andando } = novaThread(p.carregado, { nome: 'andando', modo: 'auto' });
    const { thread: fantasma } = novaThread(p.carregado, { nome: 'fantasma', modo: 'auto' });
    const despacho = (id: string, sessionId: string) => registrar(dirThread(p.dir, id), id, TIPOS_DE_EVENTO.faseDespachada,
      { fase: 'GOAL', runtime: 'claude-bg', model: 'opus', effort: 'high', sessionId });
    despacho(andando.id, 'aaaaaaaa-1111-2222-3333-444444444444');
    const ultimo = despacho(fantasma.id, 'bbbbbbbb-1111-2222-3333-444444444444');
    const leitura: LeituraDoRuntime = { responderam: ['claude-bg'], falhas: [], sessoes: [
      { sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', runtime: 'claude-bg', viva: true, fantasma: false, estado: 'working' },
      { sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', runtime: 'claude-bg', viva: false, fantasma: true, estado: 'blocked' },
    ] };
    const retrato = retratoDaMaquina(p.carregado, { maquina: 'srv', runtime: () => leitura });
    const porId = new Map(retrato.threads.map((x) => [x.id, x]));
    assert.deepEqual(porId.get(andando.id)?.sessao, { viva: true, desdeEm: null, motivo: null });
    assert.deepEqual(porId.get(fantasma.id)?.sessao, { viva: false, desdeEm: ultimo.ts, motivo: 'sessão bbbbbbbb sem processo (fantasma)' });

    const texto = textoDaFabrica({ maquinas: [retrato], atualizado: true, ponta: null }, 'srv');
    assert.match(texto, /THREAD\s+MODO\s+FASE\s+RUNTIME\s+ITEM\s+ESPERA VOCE\s+SESSAO/);
    assert.match(texto, new RegExp(`${andando.id}\\s.*\\sviva$`, 'm'));
    assert.match(texto, new RegExp(`${fantasma.id}\\s.*\\sparada desde .*: sessão bbbbbbbb sem processo \\(fantasma\\)$`, 'm'));
    assert.match(painelDaFabricaEmMarkdown([retrato]), /\| Publicado \| Sessão \|/);
    assert.match(painelDaFabricaEmMarkdown([retrato]), new RegExp(`\\| ${fantasma.id} \\|.*\\| parada desde .*: sessão bbbbbbbb sem processo \\(fantasma\\) \\|`));
    // O retrato de antes, sem o campo, nao diz que a thread anda.
    const antigo = { ...retrato, threads: retrato.threads.map(({ sessao: _s, ...resto }) => resto) };
    assert.match(textoDaFabrica({ maquinas: [antigo], atualizado: true, ponta: null }, 'srv'), new RegExp(`${andando.id}\\s.*\\s-$`, 'm'));
  } finally { p.limpar(); }
});

test('F2: na visao da rede, so a sessao viva publicada pela outra maquina vira "sigo"; retrato sem o campo nao', () => {
  const p = projetoTemporario('rm062-f2-rede');
  try {
    item(p.dir, 'RM-010', 'ork-na-outra');
    const quando = '2026-10-12T15:00:00.000Z';
    const fato = (vida: unknown): FatoDeThread => ({ id: 'ork-na-outra', roadmap: 'RM-010', aberta: true, fase: 'GO', maquina: 'pc-b',
      entregueHoje: () => false, espera: () => undefined, vida: () => vidaDoRetrato(vida) });
    const linha = (vida: unknown) => fecho(textoDoStatusDoRoadmap(montarStatusDeFatos(carregarDocs(p.dir).docs, [fato(vida)], { quando }))).seguir[0];
    assert.equal(linha({ viva: true, desdeEm: null, motivo: null }), '• RM-010: sigo ork-na-outra na fase GO (pc-b).');
    assert.equal(linha({ viva: false, desdeEm: '2026-10-12T14:00:00.000Z', motivo: 'sessão 054e042e sem processo (fantasma)' }),
      `• RM-010: ork-na-outra (pc-b) ${paradaDesde({ desdeEm: '2026-10-12T14:00:00.000Z', motivo: 'sessão 054e042e sem processo (fantasma)' }, { agora: quando })}.`);
    assert.equal(linha(undefined), '• RM-010: ork-na-outra na fase GO (pc-b), sem sessão verificada no runtime.');
    assert.equal(linha({ viva: 'sim' }), '• RM-010: ork-na-outra na fase GO (pc-b), sem sessão verificada no runtime.', 'campo fora do formato nao vale');
  } finally { p.limpar(); }
});

test('F2 (GO-FIX): falha superada nao derruba; conta que nao respondeu nao vira "nao aparece"; codex parado diz ha quanto tempo', () => {
  const t = { id: 'ork-x', faseAtual: 'GO', sessoes: [], atualizadaEm: '2026-10-12T08:00:00.000Z', criadaEm: '2026-10-12T07:00:00.000Z' } as unknown as Thread;
  const S = 'aaaaaaaa-1111-2222-3333-444444444444';
  const ev = (ts: string, tipo: string, extra: Record<string, unknown> = {}): EventoLedger =>
    ({ ts: `2026-10-12T${ts}:00.000Z`, thread: 'ork-x', tipo, eventId: `${tipo}-${ts}`, ...extra });
  const despacho = ev('08:30', 'phase_dispatch', { fase: 'GO', runtime: 'claude-bg', sessionId: S });
  const leitura = (sessoes: LeituraDoRuntime['sessoes'], responderam = ['claude-bg', 'claude-bg:']): () => LeituraDoRuntime =>
    () => ({ responderam, falhas: responderam.length > 1 ? [] : ['claude agents (perfil p1): sem resposta (simulado)'], sessoes });
  const encerrada = [{ sessionId: S, runtime: 'claude-bg', viva: false, fantasma: false, estado: 'done' }];

  // O silencio que voltou (gate liberado) e a fase que terminou bem nao sao "caiu".
  const superada = vidaDaThread(t, [despacho, ev('08:40', 'gate_blocked', { fase: 'GO', motivo: 'runtime.silencio', sessionId: S }),
    ev('08:50', 'gate_passed', { fase: 'GO', motivo: 'runtime.silencio', sessionId: S }), ev('09:10', 'phase_result', { fase: 'GO', sessionId: S, ok: true })],
    leitura(encerrada));
  assert.deepEqual([superada.viva, superada.motivo], [false, 'sessão aaaaaaaa encerrada (done)']);

  // O despacho saiu pelo perfil p1, cuja conta nao respondeu (a do processo respondeu): nao verificada, nao "nao aparece".
  const pelaConta = vidaDaThread(t, [{ ...despacho, perfil: { id: 'p1', runtime: 'claude-bg' } }], leitura([], ['claude-bg', 'claude-bg:']));
  assert.match(String(pelaConta.motivo), /^runtime claude-bg sem resposta/);
  const contaRespondeu = vidaDaThread(t, [{ ...despacho, perfil: { id: 'p1', runtime: 'claude-bg' } }], leitura([], ['claude-bg', 'claude-bg:p1']));
  assert.equal(contaRespondeu.motivo, 'sessão aaaaaaaa não aparece no runtime');

  // O codex sem atividade recente no rollout e sem estado final: ha quanto tempo esta parado, nao "encerrada (unknown)".
  const agora = Date.parse('2026-10-12T10:00:00.000Z');
  const codex = vidaDaThread(t, [{ ...despacho, runtime: 'codex' }], leitura([{ sessionId: S, runtime: 'codex', viva: false, fantasma: false,
    estado: 'unknown', atividadeEm: agora - 45 * 60000 }], ['codex', 'codex:']), agora);
  assert.deepEqual([codex.motivo, codex.desdeEm], ['sessão aaaaaaaa sem atividade no rollout há 45 min', '2026-10-12T09:15:00.000Z']);

  // O "desde" e o ultimo sinal da sessao, nao o evento que o proprio ork gravou depois sobre ela.
  const fantasma = [{ sessionId: S, runtime: 'claude-bg', viva: false, fantasma: true, estado: 'blocked' }];
  const desde = vidaDaThread(t, [despacho, ev('08:45', 'session_stop', { sessionId: S }), ev('09:30', 'despacho_idempotente', { sessionId: S }),
    ev('09:31', 'conducao_renovada', { sessionId: S })], leitura(fantasma));
  assert.equal(desde.desdeEm, '2026-10-12T08:45:00.000Z');
});

test('F2 (GO-FIX): a sessao viva de um retrato velho da outra maquina nao vira "sigo"', () => {
  const publicado = '2026-10-12T08:00:00.000Z';
  const viva = { viva: true, desdeEm: null, motivo: null };
  assert.equal(vidaDoRetrato(viva, publicado, new Date(Date.parse(publicado) + 30 * 60000).toISOString()).viva, true, 'recente vale');
  const velho = vidaDoRetrato(viva, publicado, new Date(Date.parse(publicado) + VALIDADE_DA_VIDA_NO_RETRATO_MS + 60000).toISOString());
  assert.deepEqual([velho.viva, velho.desdeEm, velho.motivo], [false, publicado,
    'retrato da máquina sem atualização há 76 min; a sessão não foi reverificada']);
});
