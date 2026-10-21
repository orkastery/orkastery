/**
 * RM-057 (resposta curta, ork-rm057respost): o hook `UserPromptSubmit` do plugin do Claude Code.
 *
 * O hook não tem regra de negócio: só texto curto de uma linha chama o núcleo (`ork noctum terminal --hook-stdin`), e a
 * decisão do núcleo é transportada como o Claude Code a entende (bloquear o prompt com a frase, contexto ao modelo ou
 * aviso ao dono). Erro do hook ou do núcleo nunca bloqueia. O guard do plugin barra o ingresso chamado pela ferramenta.
 * O núcleo aqui é um executável SIMULADO, menos nos casos de ponta a ponta, que usam o `ork` desta árvore numa raiz
 * descartável; sessões e ambientes SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario, projetoTemporario } from './apoio';
import { CONTRATO_ENVELOPE } from '../src/noctum-envelope';
import { lerArco, proporEnvelope } from '../src/noctum-arco';

const RAIZ = path.resolve(__dirname, '../../..');
const HOOK = path.join(RAIZ, 'adapters/claude-code/hooks/ork-resposta.js');
const GUARD = path.join(RAIZ, 'adapters/claude-code/hooks/ork-guard.js');
const HOOKS = path.join(RAIZ, 'adapters/claude-code/hooks/hooks.json');
const CLI = path.resolve(__dirname, '../../dist/index.js');
const SESSAO = '11111111-2222-4333-8444-555555555555';

/** O núcleo SIMULADO: grava os argumentos e a entrada e responde a decisão pedida (ou falha). */
function nucleoSimulado(dir: string, resposta: string, codigo = 0): { bin: string; chamadas: () => Array<{ argv: string[]; entrada: string }> } {
  const log = path.join(dir, 'chamadas.jsonl'), bin = path.join(dir, 'ork-simulado');
  fs.writeFileSync(bin, `#!${process.execPath}\nconst fs=require('fs');let e='';process.stdin.on('data',c=>e+=c).on('end',()=>{` +
    `fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({argv:process.argv.slice(2),entrada:e})+'\\n');` +
    `process.stdout.write(${JSON.stringify(resposta)});process.exit(${codigo});});\n`, { mode: 0o755 });
  return { bin, chamadas: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [] };
}

function rodarHook(entrada: unknown, env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [HOOK], { input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada), encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env }, timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const evento = (prompt: string, cwd: string) => ({ hook_event_name: 'UserPromptSubmit', session_id: SESSAO, cwd, prompt,
  transcript_path: path.join(cwd, 'sessao-SIMULADA.jsonl') });
const decisao = (d: Record<string, unknown>) => JSON.stringify({ contrato: 'ork.noctum-terminal/v1', ...d });

test('HK1: conversa comum não chama o núcleo nem muda o prompt', () => {
  const dir = dirTemporario('hk1');
  try {
    const n = nucleoSimulado(dir, decisao({ acao: 'registrada', mensagem: 'nunca' }));
    for (const prompt of ['pode me explicar o plano da fase antes de seguir?', 'sim\nmas rode os testes', '   ']) {
      const r = rodarHook(evento(prompt, dir), { ORK_SENSOR_CLI: n.bin });
      assert.deepEqual([r.status, r.stdout], [0, ''], prompt);
    }
    assert.equal(n.chamadas().length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('HK2: a resposta curta chama o núcleo com a entrada do evento, e a gravada substitui o prompt pela frase dele', () => {
  const dir = dirTemporario('hk2');
  try {
    const n = nucleoSimulado(dir, decisao({ acao: 'registrada', mensagem: '✅ NX4K → a) Autorizo: o arco está autorizado.', repetida: false }));
    const r = rodarHook(evento('sim', dir), { ORK_SENSOR_CLI: n.bin });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), { decision: 'block', reason: '✅ NX4K → a) Autorizo: o arco está autorizado.' });
    const [c] = n.chamadas();
    assert.deepEqual(c.argv, ['noctum', 'terminal', '--hook-stdin']);
    assert.equal(JSON.parse(c.entrada).prompt, 'sim');
    for (const acao of ['sem-efeito', 'detalhe', 'pergunta']) {
      const outro = nucleoSimulado(dir, decisao({ acao, mensagem: `frase de ${acao}` }));
      assert.equal(JSON.parse(rodarHook(evento('a', dir), { ORK_SENSOR_CLI: outro.bin }).stdout).decision, 'block', acao);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('HK3: a resposta a um gate vira contexto ao modelo; a recusa com presença vira aviso, e sem presença nada', () => {
  const dir = dirTemporario('hk3');
  try {
    const gate = nucleoSimulado(dir, decisao({ acao: 'encaminhar', contexto: 'abra o diálogo nativo com ork_request_decision' }));
    assert.deepEqual(JSON.parse(rodarHook(evento('DE6H a', dir), { ORK_SENSOR_CLI: gate.bin }).stdout),
      { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'abra o diálogo nativo com ork_request_decision' } });
    const comPresenca = nucleoSimulado(dir, decisao({ acao: 'recusada', motivo: 'noctum.terminal.worktree-de-thread', mensagem: 'não registrei', presenca: true }));
    assert.deepEqual(JSON.parse(rodarHook(evento('sim', dir), { ORK_SENSOR_CLI: comPresenca.bin }).stdout), { systemMessage: 'não registrei' });
    const semPresenca = nucleoSimulado(dir, decisao({ acao: 'recusada', motivo: 'noctum.terminal.sem-presenca', mensagem: 'x', presenca: false }));
    assert.equal(rodarHook(evento('sim', dir), { ORK_SENSOR_CLI: semPresenca.bin }).stdout, '');
    const ignorar = nucleoSimulado(dir, decisao({ acao: 'ignorar', motivo: 'nenhuma-pergunta-nesta-sessao' }));
    assert.equal(rodarHook(evento('sim', dir), { ORK_SENSOR_CLI: ignorar.bin }).stdout, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('HK4: núcleo ausente, saída inválida, outro contrato ou código de erro nunca bloqueiam nem quebram a sessão', () => {
  const dir = dirTemporario('hk4');
  try {
    const casos = [
      { ORK_SENSOR_CLI: path.join(dir, 'nao-existe') },
      { ORK_SENSOR_CLI: nucleoSimulado(dir, 'isto não é json').bin },
      { ORK_SENSOR_CLI: nucleoSimulado(dir, JSON.stringify({ contrato: 'outro/v1', acao: 'registrada', mensagem: 'x' })).bin },
      { ORK_SENSOR_CLI: nucleoSimulado(dir, decisao({ acao: 'registrada', mensagem: 'x' }), 3).bin },
    ];
    for (const env of casos) {
      const r = rodarHook(evento('sim', dir), env);
      assert.deepEqual([r.status, r.stdout], [0, ''], JSON.stringify(env));
    }
    for (const entrada of ['não é json', JSON.stringify({ hook_event_name: 'Stop', prompt: 'sim', cwd: dir }),
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'sim', cwd: 'relativo' })]) {
      const r = rodarHook(entrada, { ORK_SENSOR_CLI: casos[1].ORK_SENSOR_CLI });
      assert.deepEqual([r.status, r.stdout], [0, ''], entrada);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('HK5: o guard barra o ingresso do terminal chamado pela ferramenta Bash, antes da passagem livre do ork', () => {
  const decidir = (comando: string) => {
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: comando } }), encoding: 'utf8' });
    return { status: r.status, decisao: JSON.parse(r.stdout).hookSpecificOutput.permissionDecision as string, nome: JSON.parse(r.stdout).ork_guard };
  };
  for (const comando of ['ork noctum terminal --hook-stdin < evento.json', 'echo "{}" | node core/dist/index.js noctum terminal --hook-stdin',
    `node ${HOOK} < forjado.json`, 'ORK_SENSOR_CLI=ork node adapters/claude-code/hooks/ork-resposta.js']) {
    assert.deepEqual(decidir(comando), { status: 2, decisao: 'deny', nome: 'resposta-do-dono-por-ferramenta' }, comando);
  }
  for (const comando of ['ork noctum status arco-x', 'ork ship ork-x --para main --autorizar-push dono', 'ork noctum propor --arquivo e.json']) {
    assert.equal(decidir(comando).decisao, 'allow', comando);
  }
});

test('HK6: o hooks.json registra o UserPromptSubmit no hook da resposta, com prazo, sem tirar os outros', () => {
  const config = JSON.parse(fs.readFileSync(HOOKS, 'utf8'));
  const h = config.hooks.UserPromptSubmit[0].hooks[0];
  assert.deepEqual([h.type, h.command, h.timeout], ['command', 'node "${CLAUDE_PLUGIN_ROOT}/hooks/ork-resposta.js"', 10]);
  for (const nome of ['PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStop', 'PostToolUse']) assert.ok(config.hooks[nome], nome);
  assert.ok((fs.statSync(HOOK).mode & 0o111) !== 0, 'o hook sai executável');
});

test('HK7: de ponta a ponta com o ork desta árvore, a sessão despachada que responde é recusada e o arco segue sem autorização', () => {
  const p = projetoTemporario('hk7');
  try {
    const agora = new Date().toISOString();
    const r = proporEnvelope(p.dir, { contrato: CONTRATO_ENVELOPE, arco: 'arco-hk7',
      janela: { inicio: new Date(Date.now() - 3600_000).toISOString(), fim: new Date(Date.now() + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' },
      destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: ['push', 'pr'] }],
      orcamento: { arco: { valor: 10, unidade: 'sessoes' }, porConta: [{ conta: 'perfil-a', teto: { valor: 5, unidade: 'sessoes' } }],
        porRuntime: [{ runtime: 'claude-bg', teto: { valor: 5, unidade: 'sessoes' } }] },
      relatorio: { horario: '07:30', canal: 'telegram' } }, agora);
    const bin = path.join(p.dir, 'ork-desta-arvore');
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 });
    const env = { ORK_SENSOR_CLI: bin, HOME: process.env.HOME ?? '', CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_SESSION_ID: SESSAO,
      ORK_DISPATCH_ID: 'despacho-SIMULADO' };
    const recusa = rodarHook(evento(`${r.codigo} a`, p.dir), env);
    assert.equal(recusa.status, 0, recusa.stderr);
    assert.match(JSON.parse(recusa.stdout).systemMessage, /não registrou .* despachada pelo ork/);
    assert.equal(lerArco(p.dir, 'arco-hk7')!.autorizadoPor, null);
    const conversa = rodarHook(evento('o que falta para o piloto?', p.dir), env);
    assert.deepEqual([conversa.status, conversa.stdout], [0, '']);
  } finally { p.limpar(); }
});
