/**
 * RM-067 (F1 da ork-grokbuild, D1 e D15; F4 da ork-rm067f4setup): o `grok` no registro de runtimes. Ele resolve por nome
 * no despacho (`--runtime grok`) e, desde a F4, é runtime de bloco e de fallback no setup, sempre com o modelo dado pelo
 * dono; nunca o `runtime.adapter` do manifesto. O padrão dos runtimes de bloco não muda, e o comando do `claude-bg` e do
 * `codex` sai igual pelo registro (paridade sem downgrade).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as claudeBg from '../src/adapters/claude-bg';
import * as codex from '../src/adapters/codex';
import * as grok from '../src/adapters/grok';
import {
  ORDEM_DOS_RUNTIMES, resolverRuntime, RUNTIME_PADRAO, RUNTIMES, RUNTIMES_DE_BLOCO, RUNTIMES_SEM_COTA_TIPADA, runtimeConhecido,
  runtimeDeBloco, runtimeDoManifesto,
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

test('GR1: o grok resolve por nome com a fonte da prova, e e runtime de bloco, nunca o padrao do projeto', () => {
  const rt = resolverRuntime('grok');
  assert.equal(rt.nome, 'grok');
  assert.equal(rt.fonteVerificacao, 'pasta da sessao em $GROK_HOME/sessions');
  assert.equal(runtimeConhecido('grok'), true);
  assert.equal(runtimeDeBloco('grok'), true);
  assert.equal(runtimeDoManifesto('grok'), false);
  assert.deepEqual([...RUNTIMES_DE_BLOCO], ['claude-bg', 'codex', 'grok']);
  assert.deepEqual([...ORDEM_DOS_RUNTIMES], ['claude-bg', 'codex'], 'o padrao do projeto nao muda');
  assert.deepEqual([...RUNTIMES_SEM_COTA_TIPADA], ['grok']);
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

test('GR4: o setup aceita o grok no bloco e no fallback, sempre com o modelo dado pelo dono', () => {
  const p = projetoTemporario('grok-setup');
  try {
    assert.deepEqual(validarFallback(['grok:grok-modelo'], 'claude-bg'), ['grok:grok-modelo']);
    assert.throws(() => validarFallback(['grok'], 'claude-bg'), /fallback invalido: "grok" \(use runtime:modelo\[:esforco\]/,
      'sem modelo, o fallback do grok recusa: nao ha modelo padrao');
    assert.throws(() => validarFallback(['gemini:x'], 'claude-bg'), /fallback com runtime desconhecido: "gemini"/);
    assert.deepEqual(normalizarFallback(['grok:grok-modelo', 'codex:gpt-5.5'], 'claude-bg'), ['grok:grok-modelo', 'codex:gpt-5.5']);
    assert.deepEqual(alvosDaOrdemDeFallback(['grok:grok-modelo:high'], 'claude-bg'), [{ runtime: 'grok', model: 'grok-modelo', effort: 'high' }]);
    const semModelo = editarBloco(p.dir, 'auto', 1, { runtime: 'grok' });
    assert.equal(semModelo.ok, false);
    assert.match(semModelo.erro ?? '', /^setup\.model\.required: para mudar o runtime do bloco, informe --runtime e --model juntos/);
    assert.equal(fs.existsSync(caminhoSetup(p.dir)), false, 'nada gravado sem o modelo');
    const bloco = editarBloco(p.dir, 'auto', 1, { runtime: 'grok', model: 'grok-modelo', effort: 'xhigh', fallback: ['claude-bg:opus:high'] });
    assert.equal(bloco.ok, true, bloco.erro);
    assert.deepEqual(bloco.para, { runtime: 'grok', model: 'grok-modelo', effort: 'xhigh', fallback: ['claude-bg:opus:high'] });
    const fallback = editarBloco(p.dir, 'auto', 1, { runtime: 'codex', model: 'gpt-5.5', fallback: ['grok:grok-modelo:max'] });
    assert.equal(fallback.ok, true, fallback.erro);
    const lido = lerSetup(p.dir).modos.auto.blocos[0] as { runtime: string; model: string; fallback?: string[] };
    assert.deepEqual([lido.runtime, lido.model, lido.fallback], ['codex', 'gpt-5.5', ['grok:grok-modelo:max']]);
    const setup = JSON.parse(JSON.stringify(lerSetup(p.dir)));
    setup.modos.auto.blocos[0] = { runtime: 'grok', model: '', effort: 'high' };
    fs.writeFileSync(caminhoSetup(p.dir), JSON.stringify(setup));
    const semModeloNoArquivo = lerSetup(p.dir).modos.auto.blocos[0];
    assert.equal(semModeloNoArquivo.runtime, 'grok');
    assert.equal(semModeloNoArquivo.model, '', 'o modelo do claude-bg nunca vira o do grok: fica pendente');
  } finally { p.limpar(); }
});

test('GR8: o esforco do Orkastery vira o nivel canonico do grok (E6), e o id de menu passa como veio', () => {
  assert.deepEqual(Object.entries(grok.ESFORCO_DO_GROK),
    [['eco', 'minimal'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max']]);
  assert.equal(grok.esforcoDoGrok('ECO'), 'minimal');
  assert.equal(grok.esforcoDoGrok('deep'), 'deep');
  const cmd = grok.montarComando({ prompt: 'x', nome: 'n', cwd: '/tmp', model: 'grok-modelo', effort: 'eco' });
  assert.equal(cmd[cmd.indexOf('--effort') + 1], 'minimal');
  assert.equal(grok.montarComando({ prompt: 'x', nome: 'n', cwd: '/tmp', model: 'grok-modelo', effort: ' ' }).includes('--effort'), false);
});

test('GR5: o manifesto com runtime.adapter grok e invalido: o grok entra pelo setup do bloco, nunca como padrao', () => {
  const p = projetoTemporario('grok-manifesto');
  try {
    // O `ajustarManifesto` recarrega com `exigirManifesto`, que lança no manifesto inválido: aqui o arquivo muda direto.
    const caminho = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(caminho, 'utf8');
    assert.match(original, /adapter: claude-bg/);
    fs.writeFileSync(caminho, original.replace(/adapter: claude-bg/, 'adapter: grok'));
    const m = carregarManifesto(p.dir)!;
    assert.ok(m.erros.some((e) => e === 'runtime.adapter fora do padrao do projeto: "grok" entra por ork setup <modo> --bloco N ' +
      '--runtime grok --model <modelo> ou por ork phase run --runtime grok (o padrao aceita: claude-bg, codex)'), JSON.stringify(m.erros));
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

test('GR7: num projeto com o MCP do Orkastery, o grok recebe o contexto do host grok, segue fora da rotacao automatica, e o ensaio nao escreve a config', () => {
  const p = projetoTemporario('grok-contexto');
  try {
    instalarAdaptador('claude-code', { projeto: p.dir });
    instalarMcp({ projeto: p.dir, host: 'claude-code' });
    const t = novaThread(p.carregado, { nome: 'ctx', modo: 'auto', criarWorktree: true }).thread;
    assert.ok(contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id), 'o claude-bg recebe o contexto');
    // RM-067 (F4b, D7 e GO-FIX A5): o grok recebe o contexto do host dele no despacho pedido, e segue fora dos destinos
    // automaticos do projeto preparado, pelo sandbox.
    assert.equal(contextoDoProjeto(p.dir, 'grok', t.worktree!, t.id)?.host, 'grok');
    assert.equal(capacidadeDoRuntimeNoProjeto(p.dir, 'grok').capaz, false);
    assert.match(String(capacidadeDoRuntimeNoProjeto(p.dir, 'grok').motivo), /^runtime\.context\.sandbox:/);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Mapear o objetivo', runtime: 'grok', model: 'grok-modelo', dryRun: true });
    assert.equal(r.bloqueado, false, r.erro);
    assert.equal(r.runtime, 'grok');
    assert.equal(r.comando[0], 'grok');
    assert.equal(r.comando.includes('--mcp-config'), false, 'o headless do grok nao tem flag de MCP por sessao');
    assert.equal(r.comando[r.comando.indexOf('--cwd') + 1], t.worktree);
    assert.equal(fs.existsSync(path.join(t.worktree!, '.grok')), false, 'o ensaio nao escreve a config da worktree');
  } finally { p.limpar(); }
});
