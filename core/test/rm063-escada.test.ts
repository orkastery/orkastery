/**
 * RM-063 (F4): a escada de recuperacao do runtime.
 *
 * O incidente de 12/10/2026 (P2 e P3 da pagina da RM-063): o despacho do GO da K7 morreu com o daemon do claude-bg
 * (`cc-daemon`) fora do ar, e o retry so sabia repetir o MESMO destino. Agora `runtime.unavailable` sobe, em ordem e
 * com um `runtime_recuperacao` no ledger por degrau: (1) reerguer o daemon do runtime, (2) o fallback do bloco, (3) outro
 * perfil. So depois dos tres o dono e chamado, com tres alternativas e uma recomendada (RM-057). O prompt e o sha256 nao
 * mudam em nenhum degrau.
 *
 * Prova com runtimes FALSOS: o stub do `claude` (com `daemon status|stop`), o stub por conta (perfis a e b), o
 * `despachar` do claude-bg e do codex trocados por um que falha ou abre a sessao, e um daemon injetado. Nada toca o
 * runtime real.
 */
import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import { projetoTemporario, runtimeFalso, runtimePorConta } from './apoio';
import { lerStatusDoDaemon, SondaDoDaemon } from '../src/adapters/claude-bg';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { montarPulse } from '../src/pulse';
import { executarRetry, planejarRetry } from '../src/retry';
import { ControleDoDaemon, estadoDaEscada, falhaDoDestino } from '../src/runtime-escada';
import { RUNTIMES } from '../src/runtimes';
import { editarBloco } from '../src/setup';
import { dirThread, novaThread } from '../src/thread';
import { EventoLedger } from '../src/types';
import { main } from '../src/index';
import { ativarLocale } from '../src/locale';

const PEDIDO = 'implemente a fatia do GO da escada';
const FALHA_SECA = { ok: false, comando: [], sessionId: null, verificada: false, stdout: '',
  stderr: 'Error: runtime adapter indisponivel (simulado)', erro: 'runtime adapter indisponivel (simulado)' };

/** Um daemon falso: a sequencia de sondas e as derrubadas que recebeu. */
function daemonFalso(sondas: SondaDoDaemon['estado'][]): ControleDoDaemon & { derrubadas: number; sondadas: number } {
  const d = {
    derrubadas: 0, sondadas: 0,
    sondar: () => ({ estado: sondas[Math.min(d.sondadas++, sondas.length - 1)], detalhe: 'control.sock: (simulado)' }),
    derrubar: () => { d.derrubadas++; return { ok: true, detalhe: 'daemon parado (simulado)' }; },
  };
  return d;
}

const doTipo = (dir: string, tipo: string): EventoLedger[] => lerLedger(dir).filter((e) => e.tipo === tipo);
const degraus = (dir: string) => doTipo(dir, TIPOS_DE_EVENTO.recuperacaoDoRuntime)
  .map((e) => [e.degrau, e.resultado, (e.para as { runtime?: string; perfil?: string | null } | null)?.runtime ?? null,
    (e.para as { perfil?: string | null } | null)?.perfil ?? null]);

test('F4: a leitura do claude daemon status separa o daemon que responde, o travado, o parado e o que nao se le', () => {
  const dePe = 'pid:     181309\nversion: 2.1.296\n\nbg sessions:\n  sock dir:     /tmp/cc-daemon-1000/x\n  control.sock: reachable\n';
  assert.equal(lerStatusDoDaemon(dePe, 0).estado, 'responde');
  const travado = dePe.replace('control.sock: reachable', 'control.sock: unreachable (connect ECONNREFUSED /tmp/cc-daemon-1000/x/control.sock)');
  assert.deepEqual(lerStatusDoDaemon(travado, 0),
    { estado: 'nao-responde', detalhe: 'control.sock: unreachable (connect ECONNREFUSED /tmp/cc-daemon-1000/x/control.sock)' });
  const parado = 'not running\n\nbg sessions:\n  control.sock: unreachable (connect ENOENT /tmp/cc-daemon-1000/y/control.sock)\n';
  assert.equal(lerStatusDoDaemon(parado, 0).estado, 'parado');
  assert.equal(lerStatusDoDaemon('Background agent started: 1111', 0).estado, 'nao-lido', 'sem a forma, nada e derrubado');
  assert.equal(lerStatusDoDaemon(travado, 1).estado, 'nao-lido', 'saida diferente de zero nao prova nada');
  assert.equal(falhaDoDestino('runtime.unavailable'), true);
  assert.equal(falhaDoDestino('runtime.workspace-untrusted'), false, 'impedimento do dono para a escada');
});

test('F4 degrau 1: o daemon de pe com o control.sock mudo e derrubado, e o MESMO prompt volta ao mesmo destino', (t) => {
  const p = projetoTemporario('rm063-f4-degrau1');
  const runtime = runtimeFalso('rm063-f4-degrau1');
  const { thread } = novaThread(p.carregado, { nome: 'f4 degrau 1', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  const falha = mock.method(RUNTIMES['claude-bg'], 'despachar', () => FALHA_SECA);
  t.after(() => { falha.mock.restore(); runtime.restaurar(); p.limpar(); });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO, model: 'opus', effort: 'max' });
  assert.equal(r.motivo, 'runtime.unavailable');
  falha.mock.restore();

  const plano = planejarRetry(p.carregado, thread.id);
  assert.equal(plano.acao, 'reexecutar');
  assert.deepEqual([plano.escada?.degrau, plano.escada?.tipo], [1, 'reerguer-daemon']);
  assert.match(plano.razao, /degrau 1: reerguer o daemon do runtime/);

  const daemon = daemonFalso(['nao-responde', 'responde']);
  const rr = executarRetry(p.carregado, thread.id, { daemon });
  assert.equal(rr.executada, true, rr.detalhe);
  assert.equal(daemon.derrubadas, 1, 'o daemon travado foi derrubado uma vez');
  const [degrau] = doTipo(dir, TIPOS_DE_EVENTO.recuperacaoDoRuntime);
  assert.equal(degrau.degrau, 1);
  assert.equal(degrau.resultado, 'redespachada');
  assert.deepEqual(degrau.daemon && { antes: (degrau.daemon as { antes: string }).antes, acao: (degrau.daemon as { acao: string }).acao },
    { antes: 'nao-responde', acao: 'derrubado' });
  assert.deepEqual(degrau.para, { runtime: 'claude-bg', perfil: null, model: 'opus', effort: 'max' }, 'o mesmo destino do despacho que falhou');
  const despachos = doTipo(dir, TIPOS_DE_EVENTO.faseDespachada);
  assert.equal(despachos.length, 1);
  assert.deepEqual([despachos[0].promptSha256, despachos[0].origem, despachos[0].effort], [r.promptSha256, 'retry.escada', 'max']);
  assert.equal(runtime.chamadas().length, 1, 'o runtime recebeu o redespacho');
});

test('F4 degrau 2: com o claude-bg fora, o mesmo prompt vai ao fallback do bloco (codex), cada degrau no ledger', (t) => {
  const p = projetoTemporario('rm063-f4-degrau2');
  const runtime = runtimeFalso('rm063-f4-degrau2');
  assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:modelo-SIMULADO:high'] }).ok, true);
  const { thread } = novaThread(p.carregado, { nome: 'f4 degrau 2', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  // O codex do bloco com GO pede a baseline; aqui ela ja esta gravada.
  registrar(dir, thread.id, TIPOS_DE_EVENTO.baselineGravada, { commit: 'simulado', comandos: [] });
  const claude = mock.method(RUNTIMES['claude-bg'], 'despachar', () => FALHA_SECA);
  const codex = mock.method(RUNTIMES['codex'], 'despachar', () => ({ ok: true, comando: ['codex', 'exec'],
    sessionId: 'c0dec0de-0000-4000-8000-000000000001', verificada: true, stdout: '', stderr: '' }));
  t.after(() => { claude.mock.restore(); codex.mock.restore(); runtime.restaurar(); p.limpar(); });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });
  assert.equal(r.motivo, 'runtime.unavailable');

  const rr = executarRetry(p.carregado, thread.id, { daemon: daemonFalso(['responde']) });
  assert.equal(rr.executada, true, rr.detalhe);
  assert.deepEqual(degraus(dir), [[1, 'falhou', 'claude-bg', null], [2, 'redespachada', 'codex', null]]);
  assert.equal(codex.mock.callCount(), 1);
  assert.equal(codex.mock.calls[0].arguments[0]!.model, 'modelo-SIMULADO');
  assert.equal(codex.mock.calls[0].arguments[0]!.prompt, claude.mock.calls[0].arguments[0]!.prompt, 'o MESMO texto nos dois runtimes');
  const despacho = doTipo(dir, TIPOS_DE_EVENTO.faseDespachada).at(-1)!;
  assert.deepEqual([despacho.runtime, despacho.promptSha256, despacho.origem], ['codex', r.promptSha256, 'retry.escada']);
  const tentativas = doTipo(dir, TIPOS_DE_EVENTO.retryTentado);
  assert.deepEqual(tentativas.map((e) => [e.degrau, e.tentativa, e.ok]), [[1, 1, false], [2, 2, true]]);
});

test('F4 degrau 3: sem fallback no bloco, o degrau 2 e pulado e o mesmo prompt vai a outro perfil do runtime', (t) => {
  const p = projetoTemporario('rm063-f4-degrau3');
  const contas = runtimePorConta('rm063-f4-degrau3');
  t.after(() => { contas.restaurar(); p.limpar(); });
  contas.conta(p.dir, 'a', { falha: 'Error: erro generico do runtime (simulado)' });
  contas.conta(p.dir, 'b');
  const { thread } = novaThread(p.carregado, { nome: 'f4 degrau 3', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });
  assert.equal(r.motivo, 'runtime.unavailable');

  const rr = executarRetry(p.carregado, thread.id, { daemon: daemonFalso(['responde']) });
  assert.equal(rr.executada, true, rr.detalhe);
  assert.deepEqual(degraus(dir), [[1, 'falhou', 'claude-bg', 'a'], [2, 'pulado', null, null], [3, 'redespachada', 'claude-bg', 'b']]);
  assert.equal(doTipo(dir, TIPOS_DE_EVENTO.recuperacaoDoRuntime)[1].motivoDoDegrau, 'sem-fallback');
  const despacho = doTipo(dir, TIPOS_DE_EVENTO.faseDespachada).at(-1)!;
  assert.deepEqual([(despacho.perfil as { id: string }).id, despacho.promptSha256], ['b', r.promptSha256]);
  assert.equal(doTipo(dir, TIPOS_DE_EVENTO.retryTentado).filter((e) => e.conta !== false).length, 2, 'o degrau pulado nao gasta tentativa');
});

test('F4: os tres degraus sem sessao chamam o dono com tres alternativas e uma recomendada; o pedido novo recomeca a escada', (t) => {
  const p = projetoTemporario('rm063-f4-esgotada');
  const runtime = runtimeFalso('rm063-f4-esgotada');
  assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:modelo-SIMULADO'] }).ok, true);
  const { thread } = novaThread(p.carregado, { nome: 'f4 esgotada', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.baselineGravada, { commit: 'simulado', comandos: [] });
  const claude = mock.method(RUNTIMES['claude-bg'], 'despachar', () => FALHA_SECA);
  const codex = mock.method(RUNTIMES['codex'], 'despachar', () => ({ ...FALHA_SECA, stderr: 'codex fora (simulado)' }));
  t.after(() => { claude.mock.restore(); codex.mock.restore(); runtime.restaurar(); p.limpar(); });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });

  const rr = executarRetry(p.carregado, thread.id, { daemon: daemonFalso(['parado']) });
  assert.equal(rr.executada, false);
  assert.match(rr.detalhe, /a escada de recuperacao do runtime acabou sem sessao/);
  assert.deepEqual(degraus(dir), [[1, 'falhou', 'claude-bg', null], [2, 'falhou', 'codex', null], [3, 'pulado', null, null]]);
  // O mesmo prompt em todo degrau: o claude-bg e o codex receberam o mesmo texto.
  const textos = new Set([...claude.mock.calls, ...codex.mock.calls].map((c) => c.arguments[0]!.prompt));
  assert.equal(textos.size, 1);
  for (const e of doTipo(dir, TIPOS_DE_EVENTO.recuperacaoDoRuntime)) assert.equal(e.promptSha256, r.promptSha256);

  const gate = doTipo(dir, TIPOS_DE_EVENTO.gateBloqueado).at(-1)!;
  assert.deepEqual([gate.motivo, gate.origem, gate.pausaQualquerModo], ['human.pending', 'retry.escada', true]);
  const escada = gate.escada as { alternativas: { chave: string; recomendada?: unknown }[]; retomar: string; conferir: string };
  assert.equal(escada.alternativas.length, 3);
  assert.deepEqual(escada.alternativas.filter((a) => a.recomendada).map((a) => a.chave), ['a']);
  assert.equal(escada.retomar, `ork phase run ${thread.id} GO --prompt "$(cat ${r.promptPath.slice(p.dir.length + 1)})"`);
  assert.equal(escada.conferir, 'claude daemon status');
  assert.equal(doTipo(dir, TIPOS_DE_EVENTO.retryEscalado).at(-1)?.origem, 'retry.escada');

  // A escada nao roda de novo sozinha: o plano diz que o passo e do dono.
  const depois = planejarRetry(p.carregado, thread.id, { motivo: 'runtime.unavailable', fase: 'GO' });
  assert.deepEqual([depois.acao, depois.automatica, depois.bloqueio, depois.escada?.degrau], ['escalar-humano', false, 'escalacao.limite', null]);

  // O pulse leva o pedido ao dono: o comando que confere, o que retoma e o pedido curto da RM-057.
  const pulse = montarPulse(p.carregado, { consulta: { ok: true, sessoes: [], detalhe: '' } });
  const item = pulse.precisaDeHumanoAgora.find((i) => i.thread === thread.id);
  assert.ok(item, JSON.stringify(pulse.precisaDeHumanoAgora));
  assert.deepEqual(item!.impedimento, { motivo: 'human.pending', comando: 'claude daemon status', retry: escada.retomar });
  assert.equal(item!.comandoResposta, escada.retomar);
  assert.match(item!.apresentacaoCurta!.terminal, /a\) Conferir o runtime e despachar de novo com o mesmo pedido \[Recomendação\]/);
  assert.match(item!.apresentacaoCurta!.terminal, /c\) Deixar parada/);

  // O pedido novo da fase (o dono retomando) abre outro episodio: a escada recomeca no degrau 1.
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });
  const novo = planejarRetry(p.carregado, thread.id);
  assert.deepEqual([novo.motivo, novo.escada?.degrau, novo.tentativas, novo.automatica], ['runtime.unavailable', 1, 0, true]);
  assert.equal(estadoDaEscada(lerLedger(dir), 'GO').consumidos.length, 0);
});

test('F4: CLI: ork retry run sobe o degrau 1 pelo claude daemon do stub e o plano diz o degrau', (t) => {
  const p = projetoTemporario('rm063-f4-cli');
  const runtime = runtimeFalso('rm063-f4-cli');
  const cwd = process.cwd(), log = console.log, lang = process.env.LANG;
  t.after(() => {
    console.log = log; process.chdir(cwd); runtime.restaurar(); p.limpar();
    if (lang === undefined) delete process.env.LANG; else process.env.LANG = lang;
    ativarLocale(undefined);
  });
  process.env.LANG = 'pt_BR.UTF-8';
  const { thread } = novaThread(p.carregado, { nome: 'f4 cli', modo: 'auto' });
  runtime.proximoDespachoMorreDeRateLimit('erro generico do runtime, sem sessao\n');
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });
  assert.equal(r.motivo, 'runtime.unavailable');
  runtime.daemonPreso(true);
  process.chdir(p.dir);
  let saida = '';
  console.log = (s: unknown) => { saida += `${String(s)}\n`; };
  assert.equal(main(['retry', 'plan', thread.id]), 0, saida);
  assert.match(saida, /escada {10}degrau 1 de 3, reerguer o daemon do runtime/);
  saida = '';
  assert.equal(main(['retry', 'run', thread.id]), 0, saida);
  assert.deepEqual(runtime.chamadasDoDaemon(), ['daemon status', 'daemon stop', 'daemon status']);
  const [degrau] = doTipo(dirThread(p.dir, thread.id), TIPOS_DE_EVENTO.recuperacaoDoRuntime);
  assert.deepEqual([degrau.resultado, (degrau.daemon as { acao: string }).acao], ['redespachada', 'derrubado']);
  assert.match(saida, new RegExp(r.promptSha256.slice(0, 12)));
});
