/**
 * I-33 (D12, GO-FIX 1 do CHECK aa279e17, achado A1): o caminho REAL do incidente de 18/09. O
 * turno codex INICIA e termina com erro de cota; a linha 65 do rollout real do incidente e a
 * fixture. O observador classifica `runtime.quota-exhausted` no caminho terminal (rollout e erro
 * nativo do controller), marca o perfil e o retry segue a politica. O equivalente do claude-bg e o
 * turno que termina pelo limite de uso ou sem credito registrado como erro de API na transcricao.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, projetoTemporario, runtimePorConta } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { encerrarController, erroNativoDoTurno, erroNativoValido } from '../src/adapters/codex-controller';
import { falhaDeContaDoErroCodex, ParserCodex } from '../src/adapters/codex-events';
import { lerLedger, registrar } from '../src/ledger';
import { ManifestoCarregado } from '../src/manifest';
import { observarSessao } from '../src/session-watcher';
import { rodarFase } from '../src/phase';
import { executarRetry, retomarFila } from '../src/retry';
import { aguardando } from '../src/ratelimit';
import { adicionarPerfil, lerPerfis } from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/rollout-incidente-2026-09-18-linha65.jsonl');
const LINHA_65 = fs.readFileSync(FIXTURE, 'utf8').trim();
const TURNO_REAL = '01a0b34b-2fab-7e23-a541-dfa2d3bf8444';
const HORA = 60 * 60 * 1000;

function inicioDoTurno(turnId: string): string {
  return JSON.stringify({ timestamp: '2026-09-18T06:54:04.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } }) + '\n';
}
function fimDoTurno(payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: '2026-09-18T06:55:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: TURNO_REAL, ...payload } }) + '\n';
}
const AGORA = Date.parse('2026-09-19T00:00:00.000Z');

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

function contaCodex(raiz: string, runtimeHome: string, id: string): string {
  const dir = path.join(raiz, 'contas', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(runtimeHome, 'cenario.json'), path.join(dir, 'cenario.json'));
  fs.writeFileSync(path.join(dir, '.stub-logado'), '');
  adicionarPerfil(raiz, { id, runtime: 'codex', dir });
  return dir;
}

function encerrarControllers(dir: string): void {
  if (!dir) return;
  for (const e of lerLedger(dir)) {
    if (e.tipo !== 'phase_dispatch' || typeof e.controlador !== 'string') continue;
    try {
      const launch = JSON.parse(fs.readFileSync(path.join(e.controlador, 'launch.json'), 'utf8'));
      encerrarController(e.controlador, launch.vinculo, launch.instancia, 8000);
    } catch { /* controller ja terminal */ }
  }
}

/**
 * Espera o `phase_result` da sessao. Alem do watcher destacado, a observacao e conduzida aqui mesmo
 * (idempotente pelo `sensorResultId`, serializada pelo lock do watcher), para a prova nao depender
 * da prontidao de um processo destacado sob carga. A falha mostra os eventos do ledger.
 */
function esperarResultado(carregado: ManifestoCarregado, dir: string, sessionId: string, ms = 30000): void {
  const pronto = () => lerLedger(dir).some(e => e.tipo === 'phase_result');
  try {
    esperarCondicao(() => {
      if (!pronto()) { try { observarSessao(carregado, sessionId); } catch { /* ocupado ou fonte ainda sem terminal */ } }
      return pronto();
    }, ms);
  } catch (e) {
    throw new Error(`${(e as Error).message}; ledger: ${lerLedger(dir).map(x => x.tipo).join(', ')}`);
  }
}

/** Stubs fora do git e o que o `ork init` gerou commitado: so a producao da sessao conta na D11c. */
function ignorarStubs(raiz: string): void {
  fs.writeFileSync(path.join(raiz, '.gitignore'), 'fake-bin/\nruntime/\ncontas/\ncodex-conta-bin/\n');
  exec('git', ['add', '-A'], raiz);
  exec('git', ['commit', '-m', 'base do teste com os stubs ignorados'], raiz);
  assert.equal(exec('git', ['status', '--porcelain', '--', '.', ':(exclude).orkastery'], raiz).stdout.trim(), '');
}

test('A1 parser: a linha 65 real do incidente vira cota esgotada tipada pelo erro estruturado do runtime', () => {
  const parser = new ParserCodex();
  assert.deepEqual(parser.push(inicioDoTurno(TURNO_REAL), AGORA), []);
  const [terminal] = parser.push(LINHA_65 + '\n', AGORA);
  assert.equal(terminal.classificacao, 'gate_blocked');
  assert.equal(terminal.motivo, 'runtime.quota-exhausted');
  assert.equal(terminal.falhaDeConta?.motivo, 'runtime.quota-exhausted');
  assert.equal(terminal.falhaDeConta?.resetEm, null, 'a mensagem real nao traz horario: o prazo vem da janela padrao');
  assert.equal(terminal.falhaDeConta?.trecho, 'usage_limit_exceeded: Your workspace is out of credits. Add credits to continue.');
  assert.equal(terminal.fonte, 'rollout.task_complete');
});

test('A1 parser negativo: texto do agente nao vira motivo da conta; erro sem conta e falha comum; turno sem erro conclui', () => {
  const agente = new ParserCodex();
  agente.push(inicioDoTurno(TURNO_REAL), AGORA);
  const [dito] = agente.push(fimDoTurno({ last_agent_message: 'Parei aqui.\n\nmotivo: runtime.quota-exhausted' }), AGORA);
  assert.deepEqual([dito.classificacao, dito.motivo, dito.falhaDeConta], ['gate_blocked', 'runtime.unavailable', undefined]);

  const outro = new ParserCodex();
  outro.push(inicioDoTurno(TURNO_REAL), AGORA);
  const [servidor] = outro.push(fimDoTurno({ last_agent_message: null, error: { message: 'upstream overloaded', codex_error_info: 'server_overloaded' } }), AGORA);
  assert.deepEqual([servidor.classificacao, servidor.motivo, servidor.falhaDeConta], ['gate_blocked', 'runtime.unavailable', undefined]);

  const limpo = new ParserCodex();
  limpo.push(inicioDoTurno(TURNO_REAL), AGORA);
  const [concluido] = limpo.push(fimDoTurno({ last_agent_message: 'Concluido.' }), AGORA);
  assert.deepEqual([concluido.classificacao, concluido.motivo], ['fase_concluida', null]);
});

test('A1 erro nativo do app-server: camelCase do turn.error, forma exata no state.json', () => {
  const cota = falhaDeContaDoErroCodex({ message: 'Your workspace is out of credits. Add credits to continue.', codexErrorInfo: 'usageLimitExceeded' });
  assert.equal(cota?.motivo, 'runtime.quota-exhausted');
  assert.match(cota?.trecho ?? '', /^usage_limit_exceeded: Your workspace is out of credits/);
  assert.equal(falhaDeContaDoErroCodex({ message: 'token revoked', codexErrorInfo: 'unauthorized' })?.motivo, 'runtime.auth-missing');
  assert.equal(falhaDeContaDoErroCodex({ message: 'bad gateway', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } }), null);
  assert.equal(falhaDeContaDoErroCodex(null), null);

  const nativo = erroNativoDoTurno({ message: 'linha 1\nlinha 2 ' + 'x'.repeat(400), codexErrorInfo: 'usageLimitExceeded', additionalDetails: 'y' });
  assert.equal(nativo?.codigo, 'usageLimitExceeded');
  assert.equal(Array.from(nativo?.mensagem ?? '').length <= 300, true);
  assert.equal(/\p{Cc}/u.test(nativo?.mensagem ?? ''), false);
  assert.equal(erroNativoValido(nativo), true);
  assert.equal(erroNativoValido({ ...nativo, extra: 1 }), false, 'campo fora da forma gravada pelo worker e recusado');
  assert.equal(erroNativoValido({ codigo: 'a b', mensagem: 'x' }), false);
});

test('A1 fim a fim: turno codex iniciado termina sem credito; o observador grava quota-exhausted, marca o perfil e o retry vai a fila', () => {
  const p = projetoTemporario('cota-terminal');
  const f = controllerSimulado(p.dir, { cenario: 'sem-credito', fixture: FIXTURE });
  const codex = codexPorConta(p.dir, path.join(p.dir, 'fake-bin'));
  let dir = '';
  try {
    ignorarStubs(p.dir);
    const casaX = contaCodex(p.dir, f.runtimeHome, 'x');
    const t = novaThread(p.carregado, { nome: 'cota', modo: 'auto' }).thread;
    dir = dirThread(p.dir, t.id);
    const antes = Date.now();
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'turno SIMULADO do incidente de 18/09', runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    esperarResultado(p.carregado, dir, r.sessionId as string);
    const depois = Date.now();

    // O turno iniciou de verdade: a falha nao veio do despacho, veio do fim do turno.
    const eventos = lerLedger(dir);
    assert.equal(eventos.some(e => e.tipo === 'phase_dispatch_failed'), false);
    assert.ok(fs.readFileSync(path.join(casaX, 'rollout.jsonl'), 'utf8').includes('usage_limit_exceeded'), 'rollout nasce na casa do perfil');
    const resultado = eventos.find(e => e.tipo === 'phase_result')!;
    assert.equal(resultado.classificacao, 'gate_blocked');
    assert.equal(resultado.motivo, 'runtime.quota-exhausted');
    assert.equal((resultado.perfil as { id: string }).id, 'x');
    const falha = resultado.falhaDeConta as { motivo: string; trecho: string; resetEm: string | null };
    assert.equal(falha.motivo, 'runtime.quota-exhausted');
    assert.match(falha.trecho, /usage_limit_exceeded: Your workspace is out of credits/);
    assert.equal(resultado.conclusaoNativa, false, 'bloqueio nunca alega conclusao nativa');
    const gate = eventos.filter(e => e.tipo === 'gate_blocked').at(-1)!;
    assert.equal(gate.motivo, 'runtime.quota-exhausted');
    assert.ok(gate.falhaDeConta, 'o gate carrega a evidencia para o retry');

    // O perfil saiu do rodizio pela janela padrao do manifesto (60 min), sem horario inventado.
    const x = lerPerfis(p.dir).perfis.find(q => q.id === 'x')!;
    assert.equal(x.estado, 'esgotado');
    const prazo = Date.parse(x.esgotadoAte as string);
    assert.ok(prazo >= antes + HORA - 1000 && prazo <= depois + HORA + 1000, `esgotadoAte ${x.esgotadoAte}`);
    assert.equal(x.ultimaFalha?.motivo, 'runtime.quota-exhausted');

    // Politica: sem outro perfil nem fallback, a fila espera o prazo do perfil; o MESMO prompt.
    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.plano.motivo, 'runtime.quota-exhausted');
    assert.equal(retry.fila.length, 1, retry.detalhe);
    assert.equal(retry.fila[0].liberaEm, x.esgotadoAte);
    assert.equal(retry.fila[0].promptSha256, r.promptSha256);
    const rotacoes = lerLedger(dir).filter(e => e.tipo === 'runtime_profile_rotated');
    assert.ok(rotacoes.every(e => e.para === null), 'nenhum redespacho: o perfil esgotado nao recebe o prompt de novo');
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').length, 1);
  } finally {
    encerrarControllers(dir);
    codex.restaurar(); f.restaurar(); p.limpar();
  }
});

test('A1 regra da prova (D11c): turno codex que morre sem credito depois de commit vira human.pending, sem redespacho', () => {
  const p = projetoTemporario('cota-terminal-producao');
  const f = controllerSimulado(p.dir, { cenario: 'sem-credito', fixture: FIXTURE });
  const codex = codexPorConta(p.dir, path.join(p.dir, 'fake-bin'));
  let dir = '';
  try {
    ignorarStubs(p.dir);
    contaCodex(p.dir, f.runtimeHome, 'x');
    contaCodex(p.dir, f.runtimeHome, 'y');
    const t = novaThread(p.carregado, { nome: 'producao', modo: 'auto' }).thread;
    dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'turno SIMULADO com producao', runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    const sha = commitar(p.dir, 'produto.txt', 'fatia\n', 'fatia do GO antes da cota');
    registrar(dir, t.id, 'mcp_git_committed', { fase: 'GO', commit: sha });
    esperarResultado(p.carregado, dir, r.sessionId as string);
    assert.equal(lerLedger(dir).find(e => e.tipo === 'phase_result')?.motivo, 'runtime.quota-exhausted');
    assert.equal(lerPerfis(p.dir).perfis.find(q => q.id === 'x')?.estado, 'esgotado', 'a conta esgotou mesmo com producao');

    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.executada, false);
    assert.match(retry.detalhe, /producao parcial sob cota esgotada/);
    const eventos = lerLedger(dir);
    assert.equal(eventos.filter(e => e.tipo === 'phase_dispatch').length, 1, 'nenhum redespacho sobre a worktree alterada');
    assert.equal(eventos.some(e => e.tipo === 'runtime_profile_rotated'), false);
    assert.equal(eventos.filter(e => e.tipo === 'gate_blocked').at(-1)?.motivo, 'human.pending');
    assert.equal(eventos.some(e => e.tipo === 'fase_concluida'), false, 'morte por cota nunca conclui a fase');
  } finally {
    encerrarControllers(dir);
    codex.restaurar(); f.restaurar(); p.limpar();
  }
});

/** Transcricao do Claude Code na conta do perfil, com uma linha de erro de API. */
function erroNaTranscricao(conta: string, cwd: string, sessionId: string, error: string, texto: string): void {
  const pasta = path.join(conta, 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${sessionId}.jsonl`),
    JSON.stringify({ type: 'assistant', isApiErrorMessage: true, error, message: { content: [{ type: 'text', text: texto }] } }) + '\n');
}

for (const caso of [
  { nome: 'limite de uso com horario (rate_limit)', error: 'rate_limit', texto: (epoch: number) => `Claude AI usage limit reached|${epoch}`,
    motivo: 'runtime.quota-exhausted', prazo: 'dito' },
  { nome: 'sem credito (billing_error)', error: 'billing_error', texto: () => 'API Error: billing issue on this organization',
    motivo: 'runtime.quota-exhausted', prazo: 'janela' },
  { nome: 'erro de servidor (negativo)', error: 'server_error', texto: () => 'API Error: 500 Internal server error',
    motivo: 'runtime.unavailable', prazo: null },
] as const) {
  test(`A1 equivalente claude-bg: turno termina por ${caso.nome}`, () => {
    const p = projetoTemporario('cota-terminal-claude');
    const claude = runtimePorConta('cota-terminal');
    try {
      const contaA = claude.conta(p.dir, 'a');
      claude.conta(p.dir, 'b');
      const t = novaThread(p.carregado, { nome: 'claude', modo: 'auto' }).thread;
      const dir = dirThread(p.dir, t.id);
      const antes = Date.now();
      const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'turno SIMULADO claude-bg' });
      assert.equal(r.verificada, true, r.erro);
      const epoch = Math.floor(Date.now() / 1000) + 3 * 3600;
      erroNaTranscricao(contaA, p.dir, r.sessionId as string, caso.error, caso.texto(epoch));
      claude.estadoDaSessao('failed');
      esperarCondicao(() => lerLedger(dir).some(e => e.tipo === 'phase_result'), 20000);
      const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result')!;
      assert.equal(resultado.motivo, caso.motivo);
      const a = lerPerfis(p.dir).perfis.find(q => q.id === 'a')!;
      const b = lerPerfis(p.dir).perfis.find(q => q.id === 'b')!;
      assert.equal(b.estado, 'ativo', 'so o perfil que falhou e marcado');
      if (caso.prazo === null) {
        assert.equal(resultado.falhaDeConta, undefined);
        assert.equal(a.estado, 'ativo', 'erro sem evidencia da conta nao marca o perfil');
        return;
      }
      assert.equal((resultado.falhaDeConta as { motivo: string }).motivo, 'runtime.quota-exhausted');
      assert.equal(a.estado, 'esgotado');
      if (caso.prazo === 'dito') assert.equal(a.esgotadoAte, new Date(epoch * 1000).toISOString(), 'prazo dito pelo runtime');
      else assert.ok(Date.parse(a.esgotadoAte as string) >= antes + HORA - 1000, 'sem horario: janela padrao do manifesto');
    } finally { p.limpar(); claude.restaurar(); }
  });
}

// ---------------------------------------------------------------------------
// I-33 (N1, CHECK-REVERIFY 8924757a): commit feito pela sessao PELO SHELL, sem `mcp_git_committed` nem
// sensor `commit` no ledger, antes de morrer por cota. So o HEAD do despacho revela a producao. Nos dois
// runtimes, com e sem perfis, o retry escala ao humano, nao redespacha o mesmo prompt e a fila duravel
// nao ganha pedido; o mesmo caminho sem commit segue a politica (positivo).
// ---------------------------------------------------------------------------

function headDe(raiz: string): string {
  return exec('git', ['rev-parse', 'HEAD'], raiz).stdout.trim();
}

/** A D11c segurou a sessao: `human.pending`, nenhum redespacho, nenhuma troca e nada na fila para retomar sozinho. */
function assegurarEscalada(carregado: ManifestoCarregado, dir: string, detalhe: string, evidencia: RegExp): void {
  assert.match(detalhe, /producao parcial sob cota esgotada/);
  assert.match(detalhe, evidencia);
  const eventos = lerLedger(dir);
  assert.equal(eventos.filter(e => e.tipo === 'phase_dispatch').length, 1, 'o mesmo prompt nao volta sobre a worktree commitada');
  assert.equal(eventos.some(e => e.tipo === 'runtime_profile_rotated'), false, 'nenhuma troca de perfil nem ida a fila');
  assert.equal(eventos.some(e => e.tipo === 'rate_limit_queued'), false);
  assert.equal(eventos.filter(e => e.tipo === 'gate_blocked').at(-1)?.motivo, 'human.pending');
  assert.equal(aguardando(carregado.raiz).length, 0, 'a fila duravel nao ganhou pedido');
  assert.deepEqual(retomarFila(carregado, { forcar: true }), [], 'nada para a fila retomar sozinha');
  assert.equal(lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').length, 1);
  assert.equal(eventos.some(e => e.tipo === 'fase_concluida'), false, 'morte por cota nunca conclui a fase');
}

for (const perfis of [true, false]) {
  for (const commit of [true, false]) {
    const rotulo = commit ? 'commit pelo shell antes da cota vira human.pending, sem redespacho nem fila' : 'sem commit segue a politica (positivo)';
    test(`N1 codex ${perfis ? 'com perfis x,y' : 'sem perfis'}: ${rotulo}`, () => {
      const p = projetoTemporario('cota-n1-codex');
      const f = controllerSimulado(p.dir, { cenario: commit ? 'sem-credito-commit' : 'sem-credito', fixture: FIXTURE });
      const codex = perfis ? codexPorConta(p.dir, path.join(p.dir, 'fake-bin')) : null;
      let dir = '';
      try {
        ignorarStubs(p.dir);
        if (perfis) { contaCodex(p.dir, f.runtimeHome, 'x'); contaCodex(p.dir, f.runtimeHome, 'y'); }
        const t = novaThread(p.carregado, { nome: 'n1', modo: 'auto' }).thread;
        dir = dirThread(p.dir, t.id);
        const antes = headDe(p.dir);
        const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'turno SIMULADO do N1', runtime: 'codex', model: 'modelo-SIMULADO' });
        assert.equal(r.verificada, true, r.erro);
        esperarResultado(p.carregado, dir, r.sessionId as string);
        const registro = lerLedger(dir).find(e => e.tipo === 'session_sensor_registered' && e.sessionId === r.sessionId)!;
        assert.equal(registro.head, antes, 'o registro do despacho codex guarda o HEAD de antes da sessao');
        assert.equal(lerLedger(dir).find(e => e.tipo === 'phase_result')?.motivo, 'runtime.quota-exhausted');
        assert.equal(headDe(p.dir) !== antes, commit, 'so o cenario com commit move o HEAD');
        assert.equal(exec('git', ['status', '--porcelain', '--', '.', ':(exclude).orkastery'], p.dir).stdout.trim(), '', 'worktree limpa');
        assert.equal(lerLedger(dir).some(e => e.tipo === 'mcp_git_committed' || e.tipo === 'commit'), false, 'nenhum commit pelo ledger');

        const retry = executarRetry(p.carregado, t.id);
        if (commit) {
          assert.equal(retry.executada, false);
          assegurarEscalada(p.carregado, dir, retry.detalhe, /HEAD da worktree mudou desde o despacho/);
        } else if (perfis) {
          assert.equal(retry.executada, true, retry.detalhe);
          const eventos = lerLedger(dir);
          assert.deepEqual(eventos.filter(e => e.tipo === 'runtime_profile_rotated').map(e => [e.de, e.para]),
            [[{ runtime: 'codex', perfil: 'x' }, { runtime: 'codex', perfil: 'y' }]]);
          const despachos = eventos.filter(e => e.tipo === 'phase_dispatch');
          assert.equal(despachos.length, 2);
          const segundo = eventos.filter(e => e.tipo === 'session_sensor_registered' && e.sessionId === despachos[1].sessionId).at(-1);
          assert.equal(segundo?.head, antes, 'o redespacho do retry tambem registra o HEAD de antes da sessao');
        } else {
          assert.equal(retry.fila.length, 1, retry.detalhe);
          assert.equal(lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').length, 1);
        }
      } finally {
        encerrarControllers(dir);
        codex?.restaurar(); f.restaurar(); p.limpar();
      }
    });
  }
}

test('N1 codex: registro de despacho sem HEAD (sessao anterior a correcao) e duvida, que conta como producao', () => {
  const p = projetoTemporario('cota-n1-sem-head');
  const f = controllerSimulado(p.dir, { cenario: 'sem-credito', fixture: FIXTURE });
  const codex = codexPorConta(p.dir, path.join(p.dir, 'fake-bin'));
  let dir = '';
  try {
    ignorarStubs(p.dir);
    contaCodex(p.dir, f.runtimeHome, 'x');
    contaCodex(p.dir, f.runtimeHome, 'y');
    const t = novaThread(p.carregado, { nome: 'n1-sem-head', modo: 'auto' }).thread;
    dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'turno SIMULADO sem HEAD', runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    esperarResultado(p.carregado, dir, r.sessionId as string);
    // O registro que vale e o ultimo do despacho: a forma que o GO codex gravava antes do N1, sem `head`.
    const { eventId: _id, ts: _ts, tipo: _tipo, thread: _thread, head: _head, ...semHead } =
      lerLedger(dir).find(e => e.tipo === 'session_sensor_registered' && e.sessionId === r.sessionId)!;
    registrar(dir, t.id, 'session_sensor_registered', semHead);
    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.executada, false);
    assegurarEscalada(p.carregado, dir, retry.detalhe, /HEAD da worktree no despacho desconhecido/);
  } finally {
    encerrarControllers(dir);
    codex.restaurar(); f.restaurar(); p.limpar();
  }
});

for (const perfis of [true, false]) {
  for (const commit of [true, false]) {
    const rotulo = commit ? 'commit pelo shell antes da cota vira human.pending, sem redespacho nem fila' : 'sem commit segue a politica (positivo)';
    test(`N1 claude-bg ${perfis ? 'com perfis a,b' : 'sem perfis'}: ${rotulo}`, () => {
      const p = projetoTemporario('cota-n1-claude');
      const claude = runtimePorConta('cota-n1');
      try {
        const contaA = perfis ? claude.conta(p.dir, 'a') : process.env.CLAUDE_CONFIG_DIR as string;
        if (perfis) claude.conta(p.dir, 'b');
        ignorarStubs(p.dir);
        const t = novaThread(p.carregado, { nome: 'n1-claude', modo: 'auto' }).thread;
        const dir = dirThread(p.dir, t.id);
        const antes = headDe(p.dir);
        const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'turno SIMULADO claude-bg do N1' });
        assert.equal(r.verificada, true, r.erro);
        if (commit) commitar(p.dir, 'produto-da-sessao.txt', 'fatia da sessao\n', 'commit da sessao pelo shell antes da cota');
        erroNaTranscricao(contaA, p.dir, r.sessionId as string, 'rate_limit', "You've hit your limit \u00b7 resets in 3 hours");
        claude.estadoDaSessao('failed');
        esperarCondicao(() => lerLedger(dir).some(e => e.tipo === 'phase_result'), 20000);
        assert.equal(lerLedger(dir).find(e => e.tipo === 'phase_result')?.motivo, 'runtime.quota-exhausted');
        assert.equal(lerLedger(dir).find(e => e.tipo === 'session_sensor_registered')?.head, antes);
        assert.equal(headDe(p.dir) !== antes, commit);
        assert.equal(lerLedger(dir).some(e => e.tipo === 'mcp_git_committed' || e.tipo === 'commit'), false, 'nenhum commit pelo ledger');

        const retry = executarRetry(p.carregado, t.id);
        if (commit) {
          assert.equal(retry.executada, false);
          assegurarEscalada(p.carregado, dir, retry.detalhe, /HEAD da worktree mudou desde o despacho/);
        } else if (perfis) {
          assert.equal(retry.executada, true, retry.detalhe);
          assert.deepEqual(lerLedger(dir).filter(e => e.tipo === 'runtime_profile_rotated').map(e => [e.de, e.para]),
            [[{ runtime: 'claude-bg', perfil: 'a' }, { runtime: 'claude-bg', perfil: 'b' }]]);
          assert.equal(lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').length, 2);
        } else {
          assert.equal(retry.fila.length, 1, retry.detalhe);
          assert.equal(lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').length, 1);
        }
      } finally { p.limpar(); claude.restaurar(); }
    });
  }
}
