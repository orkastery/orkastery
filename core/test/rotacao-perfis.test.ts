/**
 * I-33 (T9, CS8): ciclo simulado fim a fim pelo caminho REAL do nucleo. O perfil esgota, o
 * retry rotaciona para o proximo perfil, cai para o runtime de fallback do bloco (codex pelo
 * controller simulado, com o CODEX_HOME do perfil) e, sem destino, entra na fila duravel, que
 * retoma o MESMO prompt quando o prazo passa. A prova de conta e a captura de env dos stubs e o
 * rollout gravado no diretorio do perfil. Inclui a D11c com o observador destacado de verdade
 * e a regressao da D9 (perfil nao e eixo de independencia do CHECK).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, ligarRotacaoPorCota, projetoTemporario, runtimePorConta } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { encerrarController } from '../src/adapters/codex-controller';
import { lerLedger, registrar } from '../src/ledger';
import { requireSessionReviewRuntime, verifySessionReview } from '../src/maestro-authority';
import { rodarFase } from '../src/phase';
import { lerFilaDeRetomada, PedidoComPerfil } from '../src/ratelimit';
import { executarRetry, retomarFila } from '../src/retry';
import { adicionarPerfil, lerPerfis, marcarFalhaDePerfil } from '../src/runtime-profiles';
import { editarBloco } from '../src/setup';
import { dirThread, novaThread } from '../src/thread';

const PROMPT = 'FINALIZAR-SIMULADO: fatia do ciclo de perfis';
const SEM_CREDITO = 'Error: Your workspace is out of credits';

/** `codex` por conta na frente do simulado: `login status` pelo marcador do CODEX_HOME, resto no simulado. */
function codexPorConta(raiz: string, simulado: string): { restaurar: () => void } {
  const bin = path.join(raiz, 'codex-conta-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh
if [ "$1" = "login" ]; then
  if [ -f "$CODEX_HOME/.stub-logado" ]; then echo "Logged in using ChatGPT"; exit 0; fi
  echo "Not logged in"; exit 1
fi
exec ${JSON.stringify(path.join(simulado, 'codex'))} "$@"
`, { mode: 0o755 });
  const anterior = process.env.PATH;
  process.env.PATH = `${bin}:${anterior ?? ''}`;
  return { restaurar: () => { process.env.PATH = anterior; } };
}

/** Conta codex do perfil: mesmo cenario do simulado, diretorio proprio. */
function contaCodex(raiz: string, runtimeHome: string, id: string, logado = true): string {
  const dir = path.join(raiz, 'contas', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(runtimeHome, 'cenario.json'), path.join(dir, 'cenario.json'));
  if (logado) fs.writeFileSync(path.join(dir, '.stub-logado'), '');
  adicionarPerfil(raiz, { id, runtime: 'codex', dir });
  return dir;
}

function encerrarControllers(dir: string): void {
  for (const e of lerLedger(dir)) {
    if (e.tipo !== 'phase_dispatch' || typeof e.controlador !== 'string') continue;
    try {
      const launch = JSON.parse(fs.readFileSync(path.join(e.controlador, 'launch.json'), 'utf8'));
      encerrarController(e.controlador, launch.vinculo, launch.instancia, 8000);
    } catch { /* controller ja terminal */ }
  }
}

test('CS8: perfil esgota, rotaciona, cai para o codex de fallback pelo CODEX_HOME do perfil, mesmo prompt', () => {
  const p = projetoTemporario('ciclo-perfis');
  const f = controllerSimulado(p.dir);
  const claude = runtimePorConta('ciclo');
  const codex = codexPorConta(p.dir, path.join(p.dir, 'fake-bin'));
  let dir = '';
  try {
    // D5 com a troca por cota ligada no manifesto (D14): o padrao desligado tem teste proprio.
    ligarRotacaoPorCota(p);
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:modelo-SIMULADO'] }).ok, true);
    const contaA = claude.conta(p.dir, 'a', { falha: SEM_CREDITO });
    const contaB = claude.conta(p.dir, 'b', { falha: SEM_CREDITO });
    const casaX = contaCodex(p.dir, f.runtimeHome, 'x');
    const t = novaThread(p.carregado, { nome: 'ciclo', modo: 'auto' }).thread;
    dir = dirThread(p.dir, t.id);

    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: PROMPT });
    assert.equal(r.runtime, 'claude-bg');
    assert.equal(r.motivo, 'runtime.quota-exhausted');

    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.executada, true, retry.detalhe);
    const eventos = lerLedger(dir);
    const rotacoes = eventos.filter(e => e.tipo === 'runtime_profile_rotated').map(e => [e.de, e.para]);
    assert.deepEqual(rotacoes, [
      [{ runtime: 'claude-bg', perfil: 'a' }, { runtime: 'claude-bg', perfil: 'b' }],
      [{ runtime: 'claude-bg', perfil: 'b' }, { runtime: 'codex', perfil: 'x' }],
    ]);
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal(despacho?.runtime, 'codex');
    assert.equal(despacho?.model, 'modelo-SIMULADO');
    assert.deepEqual(despacho?.perfil, { id: 'x', runtime: 'codex', codexHome: casaX });
    assert.equal(despacho?.promptSha256, r.promptSha256, 'o MESMO prompt atravessou a rotacao');
    // Captura de env: o claude foi chamado pelas contas A e B, nunca pela do processo; o app-server
    // do codex rodou com o CODEX_HOME do perfil x (o rollout nasceu la, nao na casa do processo).
    assert.ok(claude.envs().includes(`--bg ${contaA}`) && claude.envs().includes(`--bg ${contaB}`));
    assert.equal(claude.envs().some(l => l.endsWith('conta-do-processo')), false);
    esperarCondicao(() => fs.existsSync(path.join(casaX, 'rollout.jsonl')), 10000);
    assert.equal(fs.existsSync(path.join(f.runtimeHome, 'rollout.jsonl')), false);
    const perfis = lerPerfis(p.dir).perfis;
    assert.deepEqual(perfis.map(q => [q.id, q.estado]), [['a', 'esgotado'], ['b', 'esgotado'], ['x', 'ativo']]);
    assert.ok(perfis.find(q => q.id === 'x')?.ultimoUso);
    assert.equal(eventos.filter(e => e.tipo === 'retry_attempt').length, 2);
  } finally {
    if (dir) encerrarControllers(dir);
    codex.restaurar(); claude.restaurar(); f.restaurar(); p.limpar();
  }
});

test('CS8: sem perfil ativo em nenhum runtime, fila ate o menor prazo e retomada do MESMO prompt quando a conta volta', () => {
  const p = projetoTemporario('ciclo-fila');
  const f = controllerSimulado(p.dir);
  const claude = runtimePorConta('fila');
  try {
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:modelo-SIMULADO'] }).ok, true);
    const contaA = claude.conta(p.dir, 'a', { falha: `${SEM_CREDITO}. Try again in 2 hours.` });
    claude.conta(p.dir, 'b', { falha: `${SEM_CREDITO}. Try again in 3 hours.` });
    contaCodex(p.dir, f.runtimeHome, 'x');
    marcarFalhaDePerfil(p.dir, 'x', { estado: 'esgotado', esgotadoAte: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      motivo: 'runtime.quota-exhausted', detalhe: 'usage_limit_exceeded' });
    const t = novaThread(p.carregado, { nome: 'fila', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: PROMPT });
    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.fila.length, 1, retry.detalhe);
    const pedido = retry.fila[0] as PedidoComPerfil;
    const prazoA = lerPerfis(p.dir).perfis.find(q => q.id === 'a')?.esgotadoAte;
    assert.equal(pedido.liberaEm, prazoA, 'o menor esgotadoAte entre os perfis (o de A, 2 horas)');
    assert.equal(pedido.promptSha256, r.promptSha256);
    assert.deepEqual([pedido.runtime, pedido.motivo], ['claude-bg', 'runtime.quota-exhausted']);

    // Antes do prazo nada acontece; depois, a conta A voltou (prazo vencido e credito reposto).
    assert.equal(retomarFila(p.carregado, { quando: new Date().toISOString() }).length, 0);
    marcarFalhaDePerfil(p.dir, 'a', { estado: 'esgotado', esgotadoAte: new Date(Date.now() - 1000).toISOString(),
      motivo: 'runtime.quota-exhausted', detalhe: 'prazo vencido no teste' });
    claude.falhaDaConta(contaA, null);
    const [retomada] = retomarFila(p.carregado, { quando: pedido.liberaEm });
    assert.equal(retomada.despachada, true, retomada.detalhe);
    const despacho = lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal((despacho?.perfil as { id: string }).id, 'a');
    assert.equal(despacho?.promptSha256, r.promptSha256);
    assert.equal(lerFilaDeRetomada(p.dir).filter(q => q.id === pedido.id).at(-1)?.estado, 'retomado');
    assert.equal(lerPerfis(p.dir).perfis.find(q => q.id === 'a')?.estado, 'ativo', 'uso depois do prazo devolve ao rodizio');
  } finally { claude.restaurar(); f.restaurar(); p.limpar(); }
});

test('D11c fim a fim: observador destacado classifica a morte por cota; commit no intervalo vira human.pending sem rotacao', () => {
  const p = projetoTemporario('ciclo-producao');
  const claude = runtimePorConta('producao');
  try {
    const contaA = claude.conta(p.dir, 'a');
    claude.conta(p.dir, 'b');
    const t = novaThread(p.carregado, { nome: 'producao', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: PROMPT });
    assert.equal(r.verificada, true, r.erro);
    assert.ok(lerLedger(dir).some(e => e.tipo === 'session_watcher_started'), 'observador destacado iniciado pelo despacho');
    // A sessao produziu (commit conferivel no git e registrado pelo nucleo) e depois morreu por cota.
    const sha = commitar(p.dir, 'produto.txt', 'fatia\n', 'fatia do GO');
    registrar(dir, t.id, 'mcp_git_committed', { fase: 'GO', commit: sha });
    const pasta = path.join(contaA, 'projects', p.dir.replace(/[^a-zA-Z0-9-]/g, '-'));
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, `${r.sessionId}.jsonl`),
      JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: SEM_CREDITO }] } }) + '\n');
    claude.estadoDaSessao('failed');
    esperarCondicao(() => lerLedger(dir).some(e => e.tipo === 'phase_result'), 20000);
    const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result');
    assert.equal(resultado?.motivo, 'runtime.quota-exhausted', 'sem Stop, a falha de conta da transcricao do perfil e o motivo');
    assert.equal((resultado?.perfil as { id: string }).id, 'a');

    const antes = lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').length;
    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.executada, false);
    assert.match(retry.detalhe, /producao parcial sob cota esgotada/);
    const eventos = lerLedger(dir);
    assert.equal(eventos.filter(e => e.tipo === 'phase_dispatch').length, antes, 'nenhum redespacho sobre a worktree alterada');
    assert.equal(eventos.some(e => e.tipo === 'runtime_profile_rotated'), false);
    assert.equal(eventos.filter(e => e.tipo === 'gate_blocked').at(-1)?.motivo, 'human.pending');
    assert.equal(claude.envs().filter(l => l.startsWith('--bg')).length, 1);
    assert.ok(claude.envs().filter(l => l.startsWith('agents')).every(l => l === `agents ${contaA}`), 'observador pela conta A');
  } finally { p.limpar(); claude.restaurar(); }
});

test('D9: perfil nao e eixo de independencia do CHECK', () => {
  // A mesma sessao nao vira dois avaliadores por ter perfis diferentes registrados.
  const ref = { threadId: 'ork-x', sessionId: 'sessao-unica', worktree: '/tmp/wt' };
  assert.throws(() => verifySessionReview('/tmp', { conductor: { ...ref, sessionId: 'condutor' }, executor: ref, reviewer: ref }),
    /maestro\.authority\.self-review/);
  // O revisor independente continua exigindo o runtime com recibo de CHECK, com ou sem perfil.
  assert.throws(() => requireSessionReviewRuntime('claude-bg'), /runtime-unsupported/);
  requireSessionReviewRuntime('codex');
  // A autoridade nao consulta perfil: independencia vem do despacho persistido (sessao e runtime).
  const fonte = fs.readFileSync(path.resolve(__dirname, '../../src/maestro-authority.ts'), 'utf8');
  assert.equal(/perfil|runtime-profiles/i.test(fonte), false);
});
