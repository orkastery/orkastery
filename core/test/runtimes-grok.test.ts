/**
 * RM-067 (F1 da ork-grokbuild, D1 e D15): o `grok` no registro de runtimes, só por pedido explícito. Ele resolve por nome
 * no despacho (`--runtime grok`), mas não é padrão de bloco, nem fallback, nem `runtime.adapter` do manifesto; a ordem e
 * o padrão dos runtimes de bloco não mudam, e o comando do `claude-bg` e do `codex` sai igual pelo registro (paridade
 * sem downgrade). Num projeto com o MCP do Orkastery, o `grok` despacha sem contexto MCP até a F4.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as claudeBg from '../src/adapters/claude-bg';
import * as codex from '../src/adapters/codex';
import * as grok from '../src/adapters/grok';
import {
  ORDEM_DOS_RUNTIMES, resolverRuntime, RUNTIME_PADRAO, RUNTIMES, RUNTIMES_SO_POR_PEDIDO, runtimeConhecido, runtimeDeBloco,
} from '../src/runtimes';
import { alvosDaOrdemDeFallback, caminhoSetup, editarBloco, lerSetup, normalizarFallback, validarFallback } from '../src/setup';
import { carregarManifesto } from '../src/manifest';
import { resolverDespacho, rodarFase } from '../src/phase';
import { capacidadeDoRuntimeNoProjeto, contextoDoProjeto } from '../src/runtime-context';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { novaThread } from '../src/thread';
import { projetoTemporario, semAutoridadeHitlNoAmbiente } from './apoio';

// A forma da entrada MCP do filho descreve um host sem credencial HITL provisionada (como no runtime-context.test).
semAutoridadeHitlNoAmbiente();

test('GR1: o grok resolve por nome com a fonte da prova, e a ordem e o padrao dos runtimes de bloco nao mudam', () => {
  const rt = resolverRuntime('grok');
  assert.equal(rt.nome, 'grok');
  assert.equal(rt.fonteVerificacao, 'pasta da sessao em $GROK_HOME/sessions');
  assert.equal(runtimeConhecido('grok'), true);
  assert.equal(runtimeDeBloco('grok'), false);
  assert.deepEqual([...RUNTIMES_SO_POR_PEDIDO], ['grok']);
  assert.deepEqual([...ORDEM_DOS_RUNTIMES], ['claude-bg', 'codex']);
  assert.equal(RUNTIME_PADRAO, 'claude-bg');
  assert.equal(runtimeDeBloco('claude-bg') && runtimeDeBloco('codex'), true);
  assert.equal(runtimeConhecido('toString'), false, 'nome herdado do Object nao e runtime');
  assert.throws(() => resolverRuntime('toString'), /runtime de despacho desconhecido: "toString"/);
});

test('GR2: paridade sem downgrade: os comandos de claude-bg e codex saem pelo registro iguais aos dos adaptadores', () => {
  const pedido = { prompt: 'Mapear o objetivo', nome: 'ork-x-full', cwd: '/tmp', model: 'opus', effort: 'high' };
  assert.deepEqual(RUNTIMES['claude-bg'].montarComando(pedido), claudeBg.montarComando(pedido));
  assert.deepEqual(RUNTIMES['claude-bg'].montarComando(pedido),
    ['claude', '--bg', 'Mapear o objetivo', '--name', 'ork-x-full', '--model', 'opus', '--effort', 'high']);
  assert.deepEqual(RUNTIMES.codex.montarComando(pedido), codex.montarComando(pedido));
  // O literal do codex dá dente ao caso: comparar a função com ela mesma não pegaria uma mudança no adaptador.
  assert.deepEqual(RUNTIMES.codex.montarComando(pedido), ['codex', 'exec', '--sandbox', 'workspace-write', '-c', 'approval_policy=never',
    '--skip-git-repo-check', '-C', '/tmp', '--json', '-m', 'opus', '-c', 'model_reasoning_effort="high"', 'Mapear o objetivo']);
  assert.deepEqual(RUNTIMES.grok.montarComando(pedido), grok.montarComando(pedido));
  assert.equal(RUNTIMES['claude-bg'].fonteVerificacao, 'claude agents --json');
  assert.equal(RUNTIMES.codex.fonteVerificacao, 'rollout do codex em $CODEX_HOME/sessions');
});

test('GR3: a recusa de runtime desconhecido lista os tres homologados, sem fallback silencioso', () => {
  assert.throws(() => resolverRuntime('gemini'), /runtime de despacho desconhecido: "gemini" \(homologados: claude-bg, codex, grok\)/);
});

test('GR4: o setup recusa o grok no bloco e no fallback, e a leitura do setup.json o descarta', () => {
  const p = projetoTemporario('grok-setup');
  try {
    assert.throws(() => validarFallback(['grok:grok-modelo'], 'claude-bg'),
      /fallback com runtime so de despacho explicito: "grok" entra por ork phase run --runtime grok; o fallback aceita: claude-bg, codex/);
    assert.throws(() => validarFallback(['gemini:x'], 'claude-bg'), /fallback com runtime desconhecido: "gemini"/);
    assert.deepEqual(normalizarFallback(['grok:grok-modelo', 'codex:gpt-5.5'], 'claude-bg'), ['codex:gpt-5.5']);
    assert.deepEqual(alvosDaOrdemDeFallback(['grok:grok-modelo:high'], 'claude-bg'), []);
    const bloco = editarBloco(p.dir, 'auto', 1, { runtime: 'grok', model: 'grok-modelo' });
    assert.equal(bloco.ok, false);
    assert.equal(bloco.erro, 'runtime so de despacho explicito: "grok" entra por ork phase run --runtime grok; o bloco aceita: claude-bg, codex');
    const fallback = editarBloco(p.dir, 'auto', 1, { fallback: ['grok:grok-modelo'] });
    assert.equal(fallback.ok, false);
    assert.match(fallback.erro ?? '', /so de despacho explicito/);
    assert.equal(fs.existsSync(caminhoSetup(p.dir)), false, 'nada gravado');
    const setup = JSON.parse(JSON.stringify(lerSetup(p.dir)));
    setup.modos.auto.blocos[0] = { runtime: 'grok', model: 'grok-modelo', effort: 'high', fallback: ['grok:grok-modelo', 'codex:gpt-5.5'] };
    fs.writeFileSync(caminhoSetup(p.dir), JSON.stringify(setup));
    const lido = lerSetup(p.dir).modos.auto.blocos[0] as { runtime: string; fallback?: string[] };
    assert.equal(lido.runtime, 'claude-bg', 'bloco do arquivo com grok volta ao padrao do modo');
    assert.deepEqual(lido.fallback, ['codex:gpt-5.5'], 'o grok sai da ordem de fallback lida');
  } finally { p.limpar(); }
});

test('GR5: o manifesto com runtime.adapter grok e invalido, com a recusa do despacho explicito', () => {
  const p = projetoTemporario('grok-manifesto');
  try {
    // O `ajustarManifesto` recarrega com `exigirManifesto`, que lança no manifesto inválido: aqui o arquivo muda direto.
    const caminho = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(caminho, 'utf8');
    assert.match(original, /adapter: claude-bg/);
    fs.writeFileSync(caminho, original.replace(/adapter: claude-bg/, 'adapter: grok'));
    const m = carregarManifesto(p.dir)!;
    assert.ok(m.erros.some((e) => e === 'runtime.adapter so por despacho explicito: "grok" entra por ork phase run --runtime grok ' +
      '(o padrao aceita: claude-bg, codex)'), JSON.stringify(m.erros));
    fs.writeFileSync(caminho, original.replace(/adapter: claude-bg/, 'adapter: gemini'));
    assert.ok(carregarManifesto(p.dir)!.erros.some((e) => e.startsWith('runtime.adapter desconhecido: "gemini"')));
    fs.writeFileSync(caminho, original);
    assert.deepEqual(carregarManifesto(p.dir)!.erros, [], 'o manifesto do claude-bg segue valido');
  } finally { p.limpar(); }
});

test('GR6: o despacho com --runtime grok exige o modelo dele e resolve o trio', () => {
  const p = projetoTemporario('grok-trio');
  try {
    assert.throws(() => resolverDespacho(p.carregado.manifesto, { runtime: 'grok' }), /setup\.model\.required/);
    assert.deepEqual(resolverDespacho(p.carregado.manifesto, { runtime: 'grok', model: 'grok-modelo' }),
      { runtime: 'grok', model: 'grok-modelo', effort: 'high' });
  } finally { p.limpar(); }
});

test('GR7: num projeto com o MCP do Orkastery, o grok despacha sem contexto MCP e segue fora da rotacao automatica', () => {
  const p = projetoTemporario('grok-contexto');
  try {
    instalarAdaptador('claude-code', { projeto: p.dir });
    instalarMcp({ projeto: p.dir, host: 'claude-code' });
    const t = novaThread(p.carregado, { nome: 'ctx', modo: 'auto', criarWorktree: true }).thread;
    assert.ok(contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id), 'o claude-bg recebe o contexto');
    assert.equal(contextoDoProjeto(p.dir, 'grok', t.worktree!, t.id), undefined);
    assert.equal(capacidadeDoRuntimeNoProjeto(p.dir, 'grok').capaz, false);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Mapear o objetivo', runtime: 'grok', model: 'grok-modelo', dryRun: true });
    assert.equal(r.bloqueado, false, r.erro);
    assert.equal(r.runtime, 'grok');
    assert.equal(r.comando[0], 'grok');
    assert.equal(r.comando.includes('--mcp-config'), false);
    assert.equal(r.comando[r.comando.indexOf('--cwd') + 1], t.worktree);
  } finally { p.limpar(); }
});
