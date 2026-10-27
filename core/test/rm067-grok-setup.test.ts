/**
 * RM-067 (F4 da ork-rm067f4setup): o `grok` no setup do despacho, com o `grok` falso (a máquina não tem o runtime).
 *
 *   - E7: a postura mais frouxa do manifesto (`danger-full-access`) sem `ork setup sandbox confirmar` recusa com
 *     `runtime.sandbox-nao-confirmado`, no `ork phase run` e no `ork retry`; confirmada, vira o perfil `off`; o piso é
 *     `workspace`, e nenhuma postura leva aprovação automática;
 *   - E8: a worktree da thread vai confiada (`--trust`), e o `AGENTS.md` dela entra na partida headless;
 *   - num projeto com o MCP do `ork`, o `ork retry` troca o perfil do `grok` como troca o dos outros runtimes, e o `grok`
 *     segue fora do fallback de quem tem o MCP; o `ork sessions` lista as sessões do `grok` pela pasta que ele grava.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { commitar, projetoTemporario, ProjetoDeTeste } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { grokFalso } from './grok-falso';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { hashDoPrompt, rodarFase } from '../src/phase';
import { redespachar } from '../src/retry';
import { confirmarPosturaLocal, revogarPosturaLocal } from '../src/postura-local';
import { proximoAlvo } from '../src/retry';
import { capacidadeDaRotacao, capacidadeDoRuntimeNoProjeto, MOTIVO_SEM_HOST_MCP } from '../src/runtime-context';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { adicionarPerfil, lerPerfis, marcarFalhaDePerfil, POLITICA_PADRAO, validarPerfilDeDespacho } from '../src/runtime-profiles';
import { consultarContas, contasDeSessoes, estadosNasContas } from '../src/sessoes-contas';
import { acharSessaoGrok, consultarSessoesGrok } from '../src/adapters/grok';
import { semAutoridadeHitlNoAmbiente } from './apoio';

// A entrada MCP do filho descreve um host sem credencial HITL provisionada (como no runtimes-grok.test).
semAutoridadeHitlNoAmbiente();

const PROMPT = 'Fatia de fixture SIMULADA para o setup do grok';
const APROVACAO_AUTOMATICA = ['--yolo', '--always-approve', '--permission-mode', 'bypassPermissions'];

/** O manifesto do repositório pede o sandbox desligado, como um clone de terceiro poderia pedir. */
function projetoQueAfrouxa(nome: string): ProjetoDeTeste {
  const p = projetoTemporario(nome);
  const manifesto = path.join(p.dir, 'orkastery.yaml');
  fs.writeFileSync(manifesto, fs.readFileSync(manifesto, 'utf8').replace('sandbox: workspace-write', 'sandbox: danger-full-access'));
  p.carregado.manifesto.runtime.sandbox = 'danger-full-access';
  return p;
}

const perfilDoComando = (comando: readonly string[]) => comando[comando.indexOf('--sandbox') + 1];

test('GS1: a postura mais frouxa sem a confirmacao local recusa o grok com runtime.sandbox-nao-confirmado, no phase run e no retry', () => {
  const p = projetoQueAfrouxa('gs1-postura');
  try {
    const t = novaThread(p.carregado, { nome: 'gs1', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: PROMPT, dryRun: true, runtime: 'grok', model: 'grok-modelo' });
    assert.equal(r.bloqueado, true, 'o despacho grok com danger-full-access do manifesto nao sai');
    assert.equal(r.motivo, 'policy.violation');
    assert.match(String(r.erro), /^runtime\.sandbox-nao-confirmado: /);
    assert.ok(String(r.erro).includes('ork setup sandbox confirmar danger-full-access'), 'a recusa diz o comando que confirma');
    assert.deepEqual(r.comando, [], 'nada foi montado para o runtime');

    const texto = 'prompt gravado SIMULADO\n';
    const rel = path.relative(p.dir, path.join(dirThread(p.dir, t.id), 'prompts', 'retomada.md'));
    fs.mkdirSync(path.dirname(path.join(p.dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(p.dir, rel), texto);
    const retry = redespachar(p.carregado, lerThread(p.dir, t.id), 'GO', rel, hashDoPrompt(texto),
      { runtime: 'grok', model: 'grok-modelo', dryRun: true });
    assert.equal(retry.ok, false);
    assert.equal(retry.motivo, 'policy.violation');
    assert.match(retry.detalhe, /^runtime\.sandbox-nao-confirmado: /);
  } finally { p.limpar(); }
});

test('GS2: confirmada nesta maquina, a postura frouxa vira o perfil off; o padrao e workspace, e nenhuma postura aprova tudo', () => {
  const p = projetoQueAfrouxa('gs2-postura');
  const padrao = projetoTemporario('gs2-padrao');
  try {
    const t = novaThread(p.carregado, { nome: 'gs2', modo: 'auto' }).thread;
    confirmarPosturaLocal(p.dir, 'danger-full-access', 'teste');
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: PROMPT, dryRun: true, runtime: 'grok', model: 'grok-modelo' });
    assert.equal(r.bloqueado, false, r.erro);
    assert.equal(perfilDoComando(r.comando), 'off');
    for (const proibida of APROVACAO_AUTOMATICA) assert.equal(r.comando.includes(proibida), false, proibida);

    // Confirmar outra postura nao vale para esta, e revogar volta a recusar.
    confirmarPosturaLocal(p.dir, 'workspace-write', 'teste');
    const outra = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: PROMPT, dryRun: true, runtime: 'grok', model: 'grok-modelo' });
    assert.match(String(outra.erro), /^runtime\.sandbox-nao-confirmado: .*confirmou workspace-write/);
    assert.equal(revogarPosturaLocal(p.dir), true);
    const revogada = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: PROMPT, dryRun: true, runtime: 'grok', model: 'grok-modelo' });
    assert.equal(revogada.motivo, 'policy.violation');

    const tp = novaThread(padrao.carregado, { nome: 'gs2 padrao', modo: 'auto' }).thread;
    const piso = rodarFase(padrao.carregado, tp.id, { fase: 'GO', prompt: PROMPT, dryRun: true, runtime: 'grok', model: 'grok-modelo' });
    assert.equal(piso.bloqueado, false, piso.erro);
    assert.equal(perfilDoComando(piso.comando), 'workspace', 'o piso sem postura frouxa e workspace, sem confirmacao');
    for (const proibida of APROVACAO_AUTOMATICA) assert.equal(piso.comando.includes(proibida), false, proibida);
  } finally { p.limpar(); padrao.limpar(); }
});

test('GS3: a worktree da thread vai confiada, e o AGENTS.md dela entra na partida headless do grok', () => {
  const stub = grokFalso('gs3-agents');
  const p = projetoTemporario('gs3-agents');
  try {
    const instrucoes = '# Regras SIMULADAS do projeto\n\nResponda em pt-BR.\n';
    commitar(p.dir, 'AGENTS.md', instrucoes, 'regras do projeto');
    const t = novaThread(p.carregado, { nome: 'gs3', modo: 'auto', criarWorktree: true }).thread;
    const wt = lerThread(p.dir, t.id).worktree!;
    assert.equal(fs.readFileSync(path.join(wt, 'AGENTS.md'), 'utf8'), instrucoes, 'a worktree traz o AGENTS.md do projeto');
    stub.stream('fim-normal.jsonl');
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'grok', model: 'grok-modelo' });
    assert.equal(r.bloqueado, false, r.erro);
    const chamada = stub.chamadas()[0];
    assert.equal(chamada[chamada.indexOf('--cwd') + 1], wt);
    assert.equal(chamada[chamada.indexOf('--cwd') + 2], '--trust', 'a confianca e da pasta do --cwd, a worktree da thread');
    assert.equal(stub.agentsCarregado(), instrucoes, 'o AGENTS.md da worktree entrou na partida headless');
    const sid = r.sessionId!;
    esperarCondicao(() => lerLedger(dirThread(p.dir, t.id)).some((e) => e.tipo === 'phase_result' && e.sessionId === sid), 60000);
  } finally { p.limpar(); stub.restaurar(); }
});

test('GS4: sem --trust o grok falso nao le o AGENTS.md, como o guia de regras de projeto diz da partida headless', () => {
  const stub = grokFalso('gs4-sem-confianca');
  const p = projetoTemporario('gs4-sem-confianca');
  try {
    commitar(p.dir, 'AGENTS.md', '# Regras SIMULADAS\n', 'regras do projeto');
    const r = spawnSync('grok', ['-p', 'x', '--output-format', 'streaming-json', '--cwd', p.dir],
      { encoding: 'utf8', env: process.env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(stub.agentsCarregado(), null, 'o dente do GS3: sem a confianca, nada do AGENTS.md entra');
  } finally { p.limpar(); stub.restaurar(); }
});

/** Um perfil grok com a casa na pasta do stub, como o `grok login` deixaria. */
function perfilGrok(p: ProjetoDeTeste, stubDir: string, id: string): string {
  const casa = path.join(stubDir, `casa-${id}`);
  fs.mkdirSync(casa, { mode: 0o700 });
  adicionarPerfil(p.dir, { id, runtime: 'grok', dir: casa });
  return casa;
}

test('GS5: num projeto com o MCP do ork, o retry troca o perfil do grok, e o grok segue fora do fallback de quem tem o MCP', () => {
  const stub = grokFalso('gs5-rotacao');
  const p = projetoTemporario('gs5-rotacao');
  try {
    instalarAdaptador('claude-code', { projeto: p.dir });
    instalarMcp({ projeto: p.dir, host: 'claude-code' });
    const t = novaThread(p.carregado, { nome: 'gs5', modo: 'auto', criarWorktree: true }).thread;
    const casaA = perfilGrok(p, stub.dir, 'a'), casaB = perfilGrok(p, stub.dir, 'b');
    assert.deepEqual(capacidadeDoRuntimeNoProjeto(p.dir, 'grok'),
      { runtime: 'grok', host: null, preparado: true, capaz: false, motivo: MOTIVO_SEM_HOST_MCP });
    assert.equal(capacidadeDaRotacao(p.dir, 'grok', true).capaz, true, 'a troca de conta dentro do grok vale');
    assert.equal(capacidadeDaRotacao(p.dir, 'grok', false).capaz, false, 'como alvo de fallback, nao');
    assert.equal(capacidadeDaRotacao(p.dir, 'codex', true).capaz, false, 'o codex sem adaptador instalado segue incapaz');

    marcarFalhaDePerfil(p.dir, 'a', { estado: 'esgotado', esgotadoAte: new Date(Date.now() + 3600_000).toISOString(),
      motivo: 'runtime.quota-exhausted', detalhe: 'simulado' });
    const perfilA = validarPerfilDeDespacho({ id: 'a', runtime: 'grok', grokHome: casaA });
    const alvo = proximoAlvo(p.dir, { runtime: 'grok', perfil: perfilA }, [], { perfis: [], runtimesImplicitos: [] }, POLITICA_PADRAO);
    assert.deepEqual(alvo, { runtime: 'grok', perfil: { id: 'b', runtime: 'grok', grokHome: casaB }, model: null, effort: null });

    // O redespacho da thread vai ao perfil b, com a sessao na casa dele.
    stub.stream('fim-normal.jsonl');
    const texto = 'prompt gravado SIMULADO\n';
    const rel = path.relative(p.dir, path.join(dirThread(p.dir, t.id), 'prompts', 'rotacao.md'));
    fs.mkdirSync(path.dirname(path.join(p.dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(p.dir, rel), texto);
    const r = redespachar(p.carregado, lerThread(p.dir, t.id), 'GOAL', rel, hashDoPrompt(texto),
      { runtime: 'grok', perfil: 'b', model: 'grok-modelo', origem: 'retry.rotacao' });
    assert.ok(r.sessionId, r.detalhe);
    assert.ok(acharSessaoGrok(r.sessionId!, casaB), 'a sessao esta na casa do perfil b');
    const sid = r.sessionId!;
    esperarCondicao(() => lerLedger(dirThread(p.dir, t.id)).some((e) => e.tipo === 'phase_result' && e.sessionId === sid), 60000);

    // Um claude-bg sem conta livre nao cai no grok do fallback: a sessao perderia o contexto do MCP.
    const semDestino = proximoAlvo(p.dir, { runtime: 'claude-bg', perfil: null }, [{ runtime: 'grok', model: 'grok-modelo' }],
      { perfis: [], runtimesImplicitos: [] }, POLITICA_PADRAO);
    assert.equal(semDestino, null);
  } finally { p.limpar(); stub.restaurar(); }
});

test('GS6: o ork sessions lista as sessoes do grok por perfil, pela pasta que o runtime grava, sem abrir arquivo dela', () => {
  const stub = grokFalso('gs6-sessoes');
  const p = projetoTemporario('gs6-sessoes');
  const ids = ['0193c4a2-7b1e-7c3d-9f00-1234567890ab', '0193c4a2-7b1e-7c3d-9f00-1234567890cd'];
  try {
    const casaA = perfilGrok(p, stub.dir, 'a'), casaB = perfilGrok(p, stub.dir, 'b');
    const sessao = (casa: string, id: string, mtimeMs: number) => {
      const dir = path.join(casa, 'sessions', '-srv-wt', id);
      fs.mkdirSync(dir, { recursive: true });
      // Um FIFO no lugar do updates.jsonl travaria quem o abrisse: o inventario so le o tipo e o mtime.
      spawnSync('mkfifo', [path.join(dir, 'updates.jsonl')]);
      fs.writeFileSync(path.join(dir, 'outro.txt'), 'x');
      fs.utimesSync(dir, mtimeMs / 1000, mtimeMs / 1000);
      return dir;
    };
    sessao(casaA, ids[0], Date.now());
    const comArquivo = path.join(casaB, 'sessions', '-srv-wt', ids[1]);
    fs.mkdirSync(comArquivo, { recursive: true });
    fs.writeFileSync(path.join(comArquivo, 'updates.jsonl'), '{"sessionUpdate":"user_message_chunk"}\n');
    const antigo = (Date.now() - 2 * 3600_000) / 1000;
    fs.utimesSync(path.join(comArquivo, 'updates.jsonl'), antigo, antigo);
    fs.mkdirSync(path.join(casaB, 'sessions', '-srv-wt', 'nao-e-sessao'));

    const a = consultarSessoesGrok(casaA);
    assert.equal(a.ok, false, 'o FIFO no lugar do updates.jsonl deixa a conta parcial, sem travar nem contar zero');
    const r = consultarContas(p.dir);
    const grok = r.sessoes.filter((s) => s.runtime === 'grok');
    assert.deepEqual(grok.map((s) => [s.sessionId, s.perfil, s.viva]), [[ids[1], 'b', false]],
      'a sessao do perfil b aparece com o id do perfil, ociosa pela escrita antiga');
    assert.ok(r.fontes.some((f) => f.origem === 'grok sessions (perfil a)' && !f.ok));
    assert.ok(r.fontes.some((f) => f.origem === 'grok sessions (perfil b)' && f.ok));
    assert.equal(r.fontes.some((f) => f.origem.includes(stub.dir)), false, 'a fonte do perfil vai pelo id, nunca pela pasta');
    assert.equal(estadosNasContas(p.dir)?.get(ids[1]), 'idle');

    // Escrita recente torna a sessao viva, e a conta do processo so entra quando a pasta sessions dela existe.
    fs.utimesSync(path.join(comArquivo, 'updates.jsonl'), new Date(), new Date());
    assert.deepEqual(consultarContas(p.dir).sessoes.filter((s) => s.runtime === 'grok').map((s) => s.viva), [true]);
    assert.equal(estadosNasContas(p.dir)?.get(ids[1]), 'working');
    assert.equal(contasDeSessoes(p.dir).contas.some((c) => c.runtime === 'grok' && c.perfil === null), false,
      'a casa do processo sem sessions nao vira fonte');
    fs.mkdirSync(path.join(stub.casa, 'sessions'));
    assert.equal(contasDeSessoes(p.dir).contas.some((c) => c.runtime === 'grok' && c.perfil === null), true);
    assert.equal(lerPerfis(p.dir).perfis.length, 2);
  } finally { p.limpar(); stub.restaurar(); }
});
