/**
 * RM-063 (F3): retry que sempre tem o prompt.
 *
 * O incidente de 12/10/2026 (P3 da pagina da RM-063): o GO da K7 morreu no despacho, com o daemon do
 * claude-bg fora do ar, e o `ork retry run` saiu com "nao ha despacho falho registrado em GO com prompt
 * gravado". O observador grava `gate_blocked runtime.unavailable` da sessao que morreu, mas o retry so
 * procurava `phase_dispatch_failed`; e o caminho do prompt no ledger era relativo a worktree.
 *
 * Prova, com adaptador FALSO (o stub do `claude` e o `despachar` trocado por um que falha ou lanca): o
 * `ork phase run` grava `phase_prompt_recorded` com o prompt e o sha256 antes de chamar o adaptador; a falha
 * do despacho fica registrada com eles (`phase_dispatch_failed` e o gate tipado); e o `ork retry run`
 * redespacha com o MESMO sha256, sem pedir o texto, inclusive no caso da K7.
 */
import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario, runtimeFalso } from './apoio';
import { hashDoPrompt, rodarFase } from '../src/phase';
import { despachoParaRedespachar, executarRetry, localizarPromptGravado, planejarRetry, redespachar } from '../src/retry';
import { RUNTIMES } from '../src/runtimes';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { EventoLedger } from '../src/types';
import { main } from '../src/index';

const PEDIDO = 'implemente a fatia 1 do GO';

test('F3: phase run grava o prompt e o sha256 no ledger ANTES de chamar o adaptador; o adaptador que lanca deixa a falha registrada', (t) => {
  const p = projetoTemporario('rm062-f3-antes');
  const runtime = runtimeFalso('rm062-f3-antes');
  const { thread } = novaThread(p.carregado, { nome: 'f3 antes', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  let noDespacho: EventoLedger | undefined;
  const lanca = mock.method(RUNTIMES['claude-bg'], 'despachar', () => {
    noDespacho = lerLedger(dir).find((e) => e.tipo === TIPOS_DE_EVENTO.promptGravado);
    throw new Error('cc-daemon fora do ar (simulado)');
  });
  t.after(() => { lanca.mock.restore(); runtime.restaurar(); p.limpar(); });

  // O erro do adaptador segue para quem chamou, como antes; o ledger guarda o prompt e a falha.
  assert.throws(() => rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO }), /cc-daemon fora do ar/);
  assert.equal(lanca.mock.callCount(), 1);
  assert.ok(noDespacho, 'o phase_prompt_recorded ja estava no ledger quando o adaptador foi chamado');
  const sha = String(noDespacho!.promptSha256);
  assert.equal(noDespacho!.fase, 'GO');
  const arquivo = localizarPromptGravado(p.dir, thread.id, String(noDespacho!.promptPath), sha);
  assert.ok(arquivo, 'o prompt gravado esta no disco, dentro do projeto');
  assert.equal(hashDoPrompt(fs.readFileSync(arquivo, 'utf8')), sha, 'e o arquivo no disco tem o mesmo sha256');

  const eventos = lerLedger(dir);
  const falha = eventos.find((e) => e.tipo === TIPOS_DE_EVENTO.despachoFalhou);
  const gate = eventos.find((e) => e.tipo === TIPOS_DE_EVENTO.gateBloqueado && e.motivo === 'runtime.unavailable');
  assert.match(String(falha?.erro), /runtime adapter lancou no despacho: cc-daemon fora do ar/);
  assert.equal(falha?.promptSha256, sha);
  assert.equal(gate?.promptSha256, sha);
  assert.equal(typeof gate?.promptPath, 'string');
  assert.match(String(gate?.correcao), new RegExp(`ork retry run ${thread.id} redespacha o mesmo prompt`));
  assert.ok(eventos.indexOf(noDespacho as EventoLedger) < eventos.indexOf(falha as EventoLedger), 'o prompt vem antes da falha');
});

test('F3: falha do adaptador no despacho: retry plan ve o runtime.unavailable e retry run redespacha o MESMO sha256 sem pedir o texto', (t) => {
  const p = projetoTemporario('rm062-f3-retry');
  const runtime = runtimeFalso('rm062-f3-retry');
  const { thread } = novaThread(p.carregado, { nome: 'f3 retry', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  const falha = mock.method(RUNTIMES['claude-bg'], 'despachar', () => ({ ok: false, comando: [], sessionId: null, verificada: false,
    stdout: '', stderr: 'Error: runtime adapter indisponivel (simulado)', erro: 'runtime adapter indisponivel' }));
  t.after(() => { falha.mock.restore(); runtime.restaurar(); p.limpar(); });

  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });
  assert.equal(r.sessionId, null);
  assert.equal(r.motivo, 'runtime.unavailable');
  falha.mock.restore();

  // Antes da F3 a falha seca so gravava phase_dispatch_failed: o plano nao via gate nenhum.
  const plano = planejarRetry(p.carregado, thread.id);
  assert.equal(plano.motivo, 'runtime.unavailable');
  assert.equal(plano.acao, 'reexecutar');
  assert.equal(plano.automatica, true);

  const rr = executarRetry(p.carregado, thread.id);
  assert.equal(rr.executada, true, rr.detalhe);
  assert.equal(rr.redespacho?.ok, true);
  assert.match(rr.detalhe, new RegExp(`mesmo prompt sha256 ${r.promptSha256.slice(0, 12)}`));
  const despachos = lerLedger(dir).filter((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada);
  assert.equal(despachos.length, 1);
  assert.equal(despachos[0].promptSha256, r.promptSha256, 'o mesmo prompt, nem uma virgula a mais');
  assert.equal(despachos[0].origem, 'retry.run');
  assert.equal(runtime.chamadas().length, 1, 'o runtime recebeu o redespacho');
});

test('F3: a sessao que morre depois do despacho (a K7) volta pelo prompt do despacho dela, mesmo com o caminho relativo a outra raiz', (t) => {
  const p = projetoTemporario('rm062-f3-k7');
  const runtime = runtimeFalso('rm062-f3-k7');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'f3 k7', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);

  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });
  assert.ok(r.sessionId, r.erro);
  // Como na K7: o despacho gravou o caminho relativo a raiz da worktree de onde ele saiu.
  const despacho = lerLedger(dir).find((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada)!;
  const daWorktree = path.relative(path.join(p.dir, '.claude', 'worktrees', thread.id), r.promptPath);
  assert.ok(daWorktree.startsWith('../../../'), daWorktree);
  fs.appendFileSync(path.join(dir, 'ledger.jsonl'), JSON.stringify({ ...despacho, promptPath: daWorktree, eventId: 'despacho-da-worktree' }) + '\n');

  // A sessao morre sem Stop: o observador grava o gate e o fim da fase com o sessionId, e nenhum phase_dispatch_failed.
  runtime.estadoDaSessao('blocked'); runtime.pidDaSessao(null);
  const morte = { fase: 'GO', sessionId: r.sessionId, motivo: 'runtime.unavailable', gate: 'phase.dispatch', origem: 'sessions.watch',
    classificacao: 'gate_blocked', ok: false, fonte: 'processo da sessão morreu sem terminal nativo nem Stop correlacionado (simulado)' };
  registrar(dir, thread.id, TIPOS_DE_EVENTO.gateBloqueado, morte);
  registrar(dir, thread.id, 'phase_result', morte);
  assert.equal(lerLedger(dir).some((e) => e.tipo === TIPOS_DE_EVENTO.despachoFalhou), false);

  const rr = executarRetry(p.carregado, thread.id);
  assert.equal(rr.executada, true, rr.detalhe);
  const depois = lerLedger(dir).filter((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada && e.origem === 'retry.run');
  assert.equal(depois.length, 1);
  assert.equal(depois[0].promptSha256, r.promptSha256);
});

test('F3 (GO-FIX): o despacho que falha depois de abrir a sessao (claude --bg lento) nao vira segunda sessao no retry', (t) => {
  const p = projetoTemporario('rm063-f3-lento');
  const runtime = runtimeFalso('rm063-f3-lento');
  const { thread } = novaThread(p.carregado, { nome: 'f3 lento', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  // O `claude --bg` estoura o prazo depois de dizer o id: a sessao existe e trabalha (pid vivo no stub).
  const lento = mock.method(RUNTIMES['claude-bg'], 'despachar', () => {
    fs.writeFileSync(path.join(runtime.dir, 'sessao'), runtime.sessionId);
    fs.writeFileSync(path.join(runtime.dir, 'cwd'), p.dir);
    fs.writeFileSync(path.join(runtime.dir, 'nome'), 'ork-f3lento-full');
    return { ok: false, comando: [], sessionId: runtime.sessionId, verificada: false, stdout: '', stderr: '',
      erro: 'claude --bg passou de 180 s depois de imprimir a sessao (simulado)' };
  });
  t.after(() => { lento.mock.restore(); runtime.restaurar(); p.limpar(); });

  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });
  lento.mock.restore();
  assert.equal(r.motivo, 'runtime.unavailable');
  const eventos = lerLedger(dir);
  assert.equal(eventos.find((e) => e.tipo === TIPOS_DE_EVENTO.despachoFalhou)?.sessionId, runtime.sessionId, 'a falha guarda a sessao');
  assert.equal(eventos.find((e) => e.tipo === TIPOS_DE_EVENTO.gateBloqueado)?.sessionId, runtime.sessionId, 'o gate tambem');

  const recusa = executarRetry(p.carregado, thread.id);
  assert.equal(recusa.executada, false);
  assert.match(recusa.detalhe, /a sessao 11111111 ainda trabalha na thread no runtime; nada foi redespachado/);
  assert.equal(lerLedger(dir).some((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada), false, 'nenhuma segunda sessao');
  assert.equal(lerLedger(dir).filter((e) => e.tipo === 'retry_attempt').at(-1)?.conta, false, 'a recusa nao gasta tentativa');
  assert.deepEqual(runtime.chamadas(), []);

  // A sessao morre (o processo some): agora o retry redespacha o mesmo prompt.
  runtime.pidDaSessao(null);
  const rr = executarRetry(p.carregado, thread.id);
  assert.equal(rr.executada, true, rr.detalhe);
  const despachos = lerLedger(dir).filter((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada);
  assert.equal(despachos.length, 1);
  assert.equal(despachos[0].promptSha256, r.promptSha256);
});

test('F3: o prompt e achado pelo sha256, so dentro do projeto; o arquivo que mudou depois do despacho e recusado, nunca redespachado', (t) => {
  const p = projetoTemporario('rm062-f3-sha');
  t.after(() => p.limpar());
  const { thread } = novaThread(p.carregado, { nome: 'f3 sha', modo: 'auto' });
  const prompts = path.join(dirThread(p.dir, thread.id), 'prompts');
  fs.mkdirSync(prompts, { recursive: true });
  const arquivo = path.join(prompts, 'x-go-12345678.md');
  fs.writeFileSync(arquivo, PEDIDO);
  const sha = hashDoPrompt(PEDIDO);
  assert.equal(localizarPromptGravado(p.dir, thread.id, '../../../.orkastery/threads/x/prompts/x-go-12345678.md', sha), arquivo);
  assert.equal(localizarPromptGravado(p.dir, thread.id, path.relative(p.dir, arquivo), sha), arquivo);

  // A escolha do despacho: o da sessao do gate, o proprio gate, a tentativa mais recente da fase.
  const ev = (tipo: string, extra: Record<string, unknown>): EventoLedger => ({ ts: '2026-10-12T07:00:00.000Z', thread: thread.id, tipo, eventId: tipo, ...extra });
  const gravado = ev(TIPOS_DE_EVENTO.promptGravado, { fase: 'GO', promptPath: 'a', promptSha256: 'sha-a' });
  const despacho = ev(TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', sessionId: 'S1', promptPath: 'b', promptSha256: 'sha-b' });
  const doObservador = ev(TIPOS_DE_EVENTO.gateBloqueado, { fase: 'GO', sessionId: 'S1', motivo: 'runtime.unavailable' });
  assert.equal(despachoParaRedespachar([gravado, despacho, doObservador], 'GO', doObservador), despacho);
  assert.equal(despachoParaRedespachar([gravado], 'GO', ev(TIPOS_DE_EVENTO.gateBloqueado, { fase: 'GO', motivo: 'runtime.unavailable' })), gravado);
  assert.equal(despachoParaRedespachar([gravado], 'CHECK', null), null, 'prompt de outra fase nao serve');

  // O texto mudou depois do despacho: o retry nao redespacha outro prompt com o sha256 antigo.
  fs.writeFileSync(arquivo, `${PEDIDO} e mais uma coisa`);
  assert.equal(localizarPromptGravado(p.dir, thread.id, path.relative(p.dir, arquivo), sha), arquivo, 'o que existe, para a recusa dizer que mudou');
  const recusa = redespachar(p.carregado, lerThread(p.dir, thread.id), 'GO', '../../../.orkastery/threads/x/prompts/x-go-12345678.md', sha);
  assert.equal(recusa.ok, false);
  assert.equal(recusa.motivo, 'artifact.missing');
  assert.match(recusa.detalhe, /mudou desde o despacho original/);

  // O ponteiro do estado so le arquivo comum de dentro do projeto (RM-047): o de fora, mesmo com o sha256 certo, e o
  // dispositivo (um /dev/zero travaria a leitura) nao sao lidos, e o redespacho recusa como prompt que sumiu.
  const fora = path.join(dirTemporario('rm063-f3-fora'), 'prompt.md');
  fs.writeFileSync(fora, PEDIDO);
  assert.equal(localizarPromptGravado(p.dir, thread.id, fora, sha), null);
  assert.equal(localizarPromptGravado(p.dir, thread.id, '/dev/zero', sha), null);
  const semLer = redespachar(p.carregado, lerThread(p.dir, thread.id), 'GO', '/dev/zero', sha);
  assert.equal(semLer.motivo, 'artifact.missing');
  assert.match(semLer.detalhe, /sumiu do disco: \/dev\/zero/);
  fs.rmSync(path.dirname(fora), { recursive: true, force: true });
});

test('F3: CLI: ork retry run redespacha sem --prompt depois da falha do despacho', (t) => {
  const p = projetoTemporario('rm062-f3-cli');
  const runtime = runtimeFalso('rm062-f3-cli');
  const { thread } = novaThread(p.carregado, { nome: 'f3 cli', modo: 'auto' });
  const falha = mock.method(RUNTIMES['claude-bg'], 'despachar', () => ({ ok: false, comando: [], sessionId: null, verificada: false,
    stdout: '', stderr: '', erro: 'runtime adapter indisponivel' }));
  const cwd = process.cwd(), log = console.log;
  t.after(() => { console.log = log; process.chdir(cwd); falha.mock.restore(); runtime.restaurar(); p.limpar(); });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: PEDIDO });
  falha.mock.restore();
  process.chdir(p.dir);
  let saida = '';
  console.log = (s: unknown) => { saida += `${String(s)}\n`; };
  assert.equal(main(['retry', 'run', thread.id]), 0, saida);
  assert.doesNotMatch(saida, /nao ha despacho falho registrado/);
  assert.match(saida, new RegExp(r.promptSha256.slice(0, 12)));
});
