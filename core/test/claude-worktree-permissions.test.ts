/** Contrato de renderizacao: nao substitui contraprova do motor nativo de permissoes. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { projetoTemporario } from './apoio';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { novaThread, gravarThread } from '../src/thread';
import { contextoDoProjeto, validarContextoRuntime } from '../src/runtime-context';
import { montarComando } from '../src/adapters/claude-bg';
import { lerArtefatoMcp, escreverArtefatoMcp } from '../src/mcp-artifacts';
import { commitMcp } from '../src/mcp-git';
import { exec } from '../src/util';

const leituras = ['thread_status', 'phase_list', 'hitl_pending', 'observe', 'artifact_read', 'claims_list']
  .map(nome => `mcp__orkastery__ork_${nome}`);
const mutacoes = ['artifact_write', 'claim_add', 'git_commit', 'verify', 'ship']
  .map(nome => `mcp__orkastery__ork_${nome}`);
function preparar(nome: string, perfil: 'interactive' | 'worktree', modo: 'auto' | 'maestro' = 'auto') {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-test-c35-container-'));
  try {
    const p = projetoTemporario(path.basename(container).slice('ork-test-'.length) + '/' + nome);
    const limparOriginal = p.limpar;
    p.limpar = () => { try { limparOriginal(); } finally { fs.rmSync(container, {recursive:true, force:true}); } };
    const instalado = instalarAdaptador('claude-code', {projeto:p.dir});
    instalarMcp({projeto:p.dir, host:'claude-code', permissoesFilho:perfil});
    const t = novaThread(p.carregado, {nome:'permissoes', modo, criarWorktree:true}).thread;
    const contexto = contextoDoProjeto(p.dir, 'claude-bg', t.worktree!, t.id)!;
    return {p, instalado, t, contexto};
  } catch (e) { fs.rmSync(container, {recursive:true, force:true}); throw e; }
}
function lista(args: string[], flag: string): string[] {
  const i = args.indexOf(flag); return i < 0 ? [] : args[i + 1].split(',');
}
test('Claude interactive preserva seis consultas sem grants de arquivo ou denies novos', () => {
  const f = preparar('claude-interactive', 'interactive');
  try {
    const args = montarComando({cwd:f.t.worktree!, nome:'consulta', prompt:'estado', contextoRuntime:f.contexto});
    assert.deepEqual(lista(args, '--allowedTools'), leituras);
    assert.equal(args.includes('--disallowedTools'), false);
    assert.equal(args.includes('--strict-mcp-config'), true);
    assert.deepEqual(montarComando({cwd:f.p.dir,nome:'legado',prompt:'pedido'}), ['claude','--bg','pedido','--name','legado']);
  } finally { f.p.limpar(); }
});
test('Claude worktree concede sete consultas, cinco mutadores e Edit absoluto apenas na WT', () => {
  const f = preparar('claude-worktree', 'worktree');
  try {
    const args = montarComando({cwd:f.t.worktree!,nome:'bloco',prompt:'escopo autorizado',contextoRuntime:f.contexto});
    const allow = lista(args, '--allowedTools'), abs = '/' + f.t.worktree!;
    assert.deepEqual(allow, [...leituras, 'mcp__orkastery__ork_git_status', ...mutacoes, `Edit(${abs}/**)`]);
    assert.equal(allow.some(r => r.startsWith('Write(') || r.startsWith('Bash') || r.startsWith('Read(')), false);
    assert.equal(allow.some(r => r.startsWith('mcp__') && r.includes('*')), false);
    for (const proibida of ['thread_new','phase_run','request_decision','gate_request'])
      assert.equal(allow.includes(`mcp__orkastery__ork_${proibida}`), false);
    for (const flag of ['--permission-mode','--add-dir','--settings','--dangerously-skip-permissions','--allow-dangerously-skip-permissions'])
      assert.equal(args.includes(flag), false);
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    assert.deepEqual(Object.keys(config.mcpServers), ['orkastery']);
    assert.equal(args.includes('--strict-mcp-config'), true);
    const deny = lista(args, '--disallowedTools');
    assert.equal(deny.length, 28);
    for (const nome of ['.git','.orkastery','.claude','.codex','.agents','.env','.env*']) {
      for (const prefixo of [`${abs}/${nome}`, `${abs}/**/${nome}`]) {
        assert.ok(deny.includes(`Edit(${prefixo})`), `entrada ${prefixo}`);
        assert.ok(deny.includes(`Edit(${prefixo}/**)`), `descendentes ${prefixo}`);
      }
    }
    assert.ok(deny.every(r => r.startsWith(`Edit(${abs}/`)));
    const command = fs.readFileSync(path.join(f.instalado.destino,'commands/ork.md'),'utf8');
    const owner = command.match(/^allowed-tools: (.+)$/m)![1].split(',').map(r => r.trim());
    assert.deepEqual(owner, ['Bash(ork:*)','Read',...leituras,'mcp__orkastery__ork_git_status','mcp__orkastery__ork_thread_new','mcp__orkastery__ork_phase_run','mcp__orkastery__ork_preflight']);
    assert.match(command,/valem no turno da invocacao/);
    assert.match(command,/nem aprovam gates/);
  } finally { f.p.limpar(); }
});
for (const caractere of ['*','?','[',']','{','}',',',')',' ']) {
  test(`Claude worktree recusa caminho ambiguo ${JSON.stringify(caractere)}`, () => {
    const f = preparar('claude-caminho-'+caractere, 'worktree');
    try {
      assert.throws(() => montarComando({cwd:f.t.worktree!,nome:'bloqueado',prompt:'consulta',contextoRuntime:f.contexto}), /runtime.context.permissions/);
    } finally { f.p.limpar(); }
  });
}

test('I-34: PLAN claude-bg libera ork_artifact_write e nega escrita de arquivo nos dois perfis', () => {
  for (const perfil of ['interactive', 'worktree'] as const) {
    const f = preparar('claude-plan-' + perfil, perfil);
    try {
      const args = montarComando({cwd:f.t.worktree!,nome:'plano',prompt:'planeje',contextoRuntime:f.contexto,colaboracao:'plan'});
      const allow = lista(args, '--allowedTools'), deny = lista(args, '--disallowedTools'), abs = '/' + f.t.worktree!;
      assert.ok(allow.includes('mcp__orkastery__ork_artifact_write'), perfil);
      assert.equal(allow.some(r => r.startsWith('Edit(') || r.startsWith('Write(') || r.startsWith('Bash')), false, perfil);
      assert.deepEqual(deny.slice(0, 3), ['Edit', 'Write', 'NotebookEdit']);
      for (const flag of ['--permission-mode', '--agent', '--settings', '--dangerously-skip-permissions'])
        assert.equal(args.includes(flag), false, `${perfil} ${flag}`);
      for (const proibida of ['thread_new','phase_run','request_decision','gate_request'])
        assert.equal(allow.includes(`mcp__orkastery__ork_${proibida}`), false);
      // GO-FIX 1: PLAN não implementa, então nenhum mutador além do artefato, em nenhum perfil.
      assert.deepEqual(allow, [...leituras, 'mcp__orkastery__ork_artifact_write']);
      if (perfil === 'interactive') {
        assert.equal(deny.length, 3);
      } else {
        assert.equal(deny.length, 31);
        assert.ok(deny.slice(3).every(r => r.startsWith(`Edit(${abs}/`)));
      }
      // As outras fases do mesmo perfil continuam exatamente como antes.
      const outra = montarComando({cwd:f.t.worktree!,nome:'bloco',prompt:'x',contextoRuntime:f.contexto});
      assert.equal(lista(outra, '--allowedTools').includes('mcp__orkastery__ork_artifact_write'), perfil === 'worktree');
    } finally { f.p.limpar(); }
  }
});

test('Claude newline e recusado no parser Git antes do renderer; fixture parcial sempre limpa', () => {
  assert.throws(() => preparar('claude-caminho-\n', 'worktree'), /worktree nao apareceu em `git worktree list` apos a criacao/);
});


test('Maestro planejamento usa documentos MCP sem grant Edit; capacidade e revalidada no bloco GO', async () => {
  const f = preparar('claude-maestro', 'worktree', 'maestro');
  try {
    const pedido = {cwd:f.t.worktree!,nome:'planejamento',prompt:'planeje',contextoRuntime:f.contexto};
    assert.equal(validarContextoRuntime(f.contexto, pedido.cwd).permiteEditarProduto, false);
    const args = montarComando(pedido), allow = lista(args, '--allowedTools');
    assert.deepEqual(allow, [...leituras, 'mcp__orkastery__ork_git_status', ...mutacoes]);
    assert.equal(allow.some(x => x.startsWith('Edit(')), false);
    assert.equal(lista(args, '--disallowedTools').length, 28);
    for (const tipo of ['goal','plan'] as const) {
      const old = lerArtefatoMcp(f.p.dir, f.t.id, tipo);
      escreverArtefatoMcp(f.p.dir, f.t.id, tipo, '# Planejamento sintetico\n', old.sha256);
      assert.equal(lerArtefatoMcp(f.p.dir,f.t.id,tipo).conteudo, '# Planejamento sintetico\n');
    }
    const head = exec('/usr/bin/git',['rev-parse','HEAD'],pedido.cwd).stdout.trim();
    const commit = await commitMcp(f.p.dir,{threadId:f.t.id,expectedHead:head,paths:['sum.cjs'],mensagem:'prematuro'});
    assert.equal(commit.ok,false);
    assert.match(commit.erro!, /mcp.git.thread.invalid/);
    assert.equal(exec('/usr/bin/git',['rev-parse','HEAD'],pedido.cwd).stdout.trim(),head);
    // Transicao sintetica do estado para testar revalidacao, nao aprovacao humana.
    f.t.faseAtual='GO';gravarThread(f.p.dir,f.t);
    assert.equal(validarContextoRuntime(f.contexto,pedido.cwd).permiteEditarProduto,true);
    const posterior=montarComando(pedido);
    assert.ok(lista(posterior,'--allowedTools').includes(`Edit(/${pedido.cwd}/**)`));
    assert.deepEqual(lista(posterior,'--disallowedTools'),lista(args,'--disallowedTools'));
    f.t.faseAtual='PLAN';gravarThread(f.p.dir,f.t);
    assert.equal(lista(montarComando(pedido),'--allowedTools').some(x=>x.startsWith('Edit(')),false);
  } finally { f.p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 2 (D14, achado 4 do CHECK 2764ac5f): a retomada sai com as mesmas permissões do despacho.
// ---------------------------------------------------------------------------
import { rodarFase } from '../src/phase';
import { redespachar } from '../src/retry';
import { lerThread } from '../src/thread';

test('GO-FIX 2 (D14): retry run claude-bg sai com as mesmas flags de permissão do phase run, no PLAN e no GO', () => {
  const permissoes = (args: string[]) => ({ allow: lista(args, '--allowedTools'), deny: lista(args, '--disallowedTools'),
    plugin: args.includes('--plugin-dir'), estrito: args.includes('--strict-mcp-config'),
    modo: args.includes('--permission-mode'), agente: args.includes('--agent') });
  for (const perfil of ['interactive', 'worktree'] as const) {
    // RM-037 (defeito 2): o modo plano vale para o bloco que termina no PLAN. No #Maestro o PLAN fecha o
    // bloco GOAL-PLAN; no #Auto o bloco segue para o GO e a sessao sai sem modo plano (rm037-modo-do-bloco).
    const f = preparar('claude-retry-' + perfil, perfil, 'maestro');
    try {
      for (const fase of ['PLAN', 'GO'] as const) {
        const run = rodarFase(f.p.carregado, f.t.id, { fase, runtime: 'claude-bg', prompt: 'retomada ' + fase, dryRun: true });
        assert.equal(run.bloqueado, false, run.erro);
        const retry = redespachar(f.p.carregado, lerThread(f.p.dir, f.t.id), fase, run.promptPath, run.promptSha256,
          { runtime: 'claude-bg', dryRun: true });
        assert.equal(retry.ok, true, retry.detalhe);
        assert.deepEqual(permissoes(retry.comando), permissoes(run.comando), `${perfil} ${fase}`);
        if (fase === 'PLAN') {
          // Negativo do achado: sem D14 a retomada saía sem nenhuma negação de escrita.
          assert.deepEqual(lista(retry.comando, '--disallowedTools').slice(0, 3), ['Edit', 'Write', 'NotebookEdit']);
          assert.ok(lista(retry.comando, '--allowedTools').includes('mcp__orkastery__ork_artifact_write'));
          assert.equal(lista(retry.comando, '--allowedTools').some(r => r.startsWith('Edit(')), false);
        } else {
          assert.equal(lista(retry.comando, '--disallowedTools').includes('Write'), false);
        }
      }
    } finally { f.p.limpar(); }
  }
});
