/**
 * RM-067 (F1 da ork-grokbuild): o adaptador do Grok Build. O comando montado (D2), o perfil de sandbox (D3), o ambiente
 * do filho sem `XAI_API_KEY` (D4), a prova de existência pela pasta da sessão (D5), o despacho pelo supervisor (D6) e a
 * retomada (D11). O `grok` é o falso de `grok-falso.ts`: a máquina não tem o runtime instalado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  acharSessaoGrok, ambienteDoDespacho, ambienteDoFilho, casaDoGrok, despachar, disponivel, ENVS_REMOVIDAS_DO_DESPACHO,
  montarComando, montarComandoDeRetomada, perfilDeSandbox, versao,
} from '../src/adapters/grok';
import { ENVS_DE_PROVIDER_PAGO } from '../src/runtime-ambiente';
import { dirTemporario } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { grokFalso } from './grok-falso';

const SESSAO = '0193c4a2-7b1e-7c3d-9f00-1234567890ab';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PEDIDO = { prompt: 'Conduza a fase GO da thread', nome: 'ork-grok-full', cwd: '/srv/wt', model: 'grok-modelo',
  effort: 'high', sandbox: 'workspace-write', sessionId: SESSAO };

/** Cenário de despacho real: o stub no PATH, a worktree e a pasta de logs da thread. */
function cenario(nome: string) {
  const stub = grokFalso(nome);
  const wt = dirTemporario(`grok-wt-${nome}`);
  const logs = path.join(stub.dir, 'sessoes');
  fs.mkdirSync(logs);
  return { stub, wt, logs, limpar: () => { stub.restaurar(); fs.rmSync(wt, { recursive: true, force: true }); } };
}

test('GK1: o comando completo sai na ordem do contrato, com o prompt no argumento 2', () => {
  assert.deepEqual(montarComando(PEDIDO), ['grok', '-p', PEDIDO.prompt, '--output-format', 'streaming-json', '-s', SESSAO,
    '--cwd', '/srv/wt', '-m', 'grok-modelo', '--effort', 'high', '--sandbox', 'workspace', '--no-auto-update']);
  assert.equal(montarComando(PEDIDO)[2], PEDIDO.prompt, 'o ledger mascara o argumento 2');
});

test('GK2: sem modelo, esforco e id as opcoes somem, e nenhuma aprovacao automatica entra', () => {
  assert.deepEqual(montarComando({ prompt: 'x', nome: 'n', cwd: '/srv/wt' }),
    ['grok', '-p', 'x', '--output-format', 'streaming-json', '--cwd', '/srv/wt', '--sandbox', 'workspace', '--no-auto-update']);
  const comando = montarComando(PEDIDO);
  for (const proibida of ['--yolo', '--always-approve', '--permission-mode', 'bypassPermissions', '--trust']) {
    assert.equal(comando.includes(proibida), false, proibida);
  }
});

test('GK3: a postura do manifesto vira o perfil de sandbox do grok, com workspace de piso e read-only no PLAN', () => {
  assert.equal(perfilDeSandbox('read-only'), 'read-only');
  assert.equal(perfilDeSandbox('workspace-write'), 'workspace');
  assert.equal(perfilDeSandbox('danger-full-access'), 'workspace');
  assert.equal(perfilDeSandbox(undefined), 'workspace');
  assert.equal(perfilDeSandbox('workspace-write', 'plan'), 'read-only');
  assert.throws(() => perfilDeSandbox('off'), /^Error: runtime\.unavailable: sandbox off sem perfil do grok$/);
  assert.throws(() => perfilDeSandbox('__proto__'), /sem perfil do grok/);
  assert.deepEqual(montarComando({ ...PEDIDO, sandbox: 'read-only' }).slice(-3), ['--sandbox', 'read-only', '--no-auto-update']);
  assert.deepEqual(montarComando({ ...PEDIDO, colaboracao: 'plan' }).slice(-3), ['--sandbox', 'read-only', '--no-auto-update']);
  const r = despachar({ ...PEDIDO, sandbox: 'off', dryRun: true });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'runtime.unavailable: sandbox off sem perfil do grok');
});

test('GK4: a retomada troca o prompt pelo texto e o -s pelo -r, do comando do despacho mascarado ou nao', () => {
  const comando = montarComando(PEDIDO);
  const esperada = ['grok', '-p', 'continue', '--output-format', 'streaming-json', '-r', SESSAO, '--cwd', '/srv/wt',
    '-m', 'grok-modelo', '--effort', 'high', '--sandbox', 'workspace', '--no-auto-update'];
  assert.deepEqual(montarComandoDeRetomada(comando, SESSAO), esperada);
  assert.deepEqual(montarComandoDeRetomada(comando.map((c, i) => (i === 2 ? '<prompt:abcd1234>' : c)), SESSAO), esperada);
  assert.equal(montarComandoDeRetomada(comando, SESSAO, 'retome do ponto de parada')?.[2], 'retome do ponto de parada');
  assert.equal(montarComandoDeRetomada(['claude', '--bg', 'x'], SESSAO), null, 'comando de outro runtime');
  assert.equal(montarComandoDeRetomada(montarComando({ ...PEDIDO, sessionId: undefined }), SESSAO), null, 'sem -s');
  assert.equal(montarComandoDeRetomada(comando, 'outra-sessao'), null, 'id de outra sessao');
});

test('GK5: o ambiente do filho sai sem XAI_API_KEY nem provider pago, com GROK_HOME, e perfil recusa ate a F3', () => {
  const base: NodeJS.ProcessEnv = { PATH: '/usr/bin', GROK_HOME: '/srv/casa-grok', XAI_API_KEY: 'x', OPENAI_API_KEY: 'x',
    ANTHROPIC_API_KEY: 'x', ORK_HITL_TOKEN: 'x', ORK_DISPATCH_ID: 'herdado' };
  const env = ambienteDoDespacho(base);
  for (const nome of ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ORK_HITL_TOKEN', 'ORK_DISPATCH_ID']) {
    assert.equal(env[nome], undefined, nome);
  }
  assert.equal(env.GROK_HOME, '/srv/casa-grok');
  assert.equal(env.PATH, '/usr/bin');
  assert.ok(ENVS_DE_PROVIDER_PAGO.every((n) => (ENVS_REMOVIDAS_DO_DESPACHO as readonly string[]).includes(n)));
  assert.ok((ENVS_REMOVIDAS_DO_DESPACHO as readonly string[]).includes('XAI_API_KEY'));
  assert.equal(ambienteDoFilho({ ambienteExtra: { ORK_DISPATCH_ID: 'deste-despacho' } }, base).ORK_DISPATCH_ID, 'deste-despacho');
  assert.throws(() => ambienteDoFilho({ perfil: { id: 'p1', runtime: 'codex', codexHome: '/srv/c' } }, base),
    /runtime\.profiles\.invalid: o grok ainda nao tem perfil de conta/);
  assert.equal(casaDoGrok({ GROK_HOME: ' /srv/casa ' }), '/srv/casa');
  assert.ok(casaDoGrok({}).endsWith(`${path.sep}.grok`));
});

test('GK6: o ensaio monta o comando com um id novo e nao roda nada', () => {
  const c = cenario('ensaio');
  try {
    const r = despachar({ ...PEDIDO, sessionId: undefined, cwd: c.wt, logDir: c.logs, dryRun: true });
    assert.equal(r.ok, true);
    assert.equal(r.sessionId, null);
    assert.equal(r.verificada, false);
    assert.match(r.comando[r.comando.indexOf('-s') + 1], UUID);
    assert.deepEqual(c.stub.chamadas(), [], 'o grok nao foi chamado');
    assert.deepEqual(fs.readdirSync(c.logs), [], 'nenhum log nem recibo');
  } finally { c.limpar(); }
});

test('GK7: o grok fora do PATH recusa com runtime.unavailable tipado', () => {
  const vazio = dirTemporario('grok-ausente');
  const antes = process.env.PATH;
  process.env.PATH = vazio;
  try {
    const r = despachar({ ...PEDIDO, logDir: vazio });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'runtime.unavailable: binario grok nao encontrado no PATH');
    assert.equal(r.sessionId, null);
    assert.equal(disponivel(), null);
    assert.equal(versao(), null);
  } finally { process.env.PATH = antes; fs.rmSync(vazio, { recursive: true, force: true }); }
});

test('GK8: o despacho real roda pelo supervisor, acha a pasta da sessao pelo id e o filho nao recebe a chave', () => {
  const c = cenario('real');
  const chaveAntes = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = 'x';
  try {
    c.stub.stream('fim-normal.jsonl');
    const r = despachar({ ...PEDIDO, sessionId: undefined, cwd: c.wt, logDir: c.logs, esperaMs: 30000 });
    assert.equal(r.ok, true, r.erro);
    assert.equal(r.verificada, true);
    assert.match(r.sessionId!, UUID);
    assert.equal(r.logPath, path.join(c.logs, `${r.sessionId}.grok.jsonl`));
    assert.equal(r.processoPath, `${r.logPath}.process.json`);
    assert.equal(r.reciboPath, `${r.logPath}.exit.json`);
    esperarCondicao(() => fs.existsSync(r.reciboPath!), 30000);
    const recibo = JSON.parse(fs.readFileSync(r.reciboPath!, 'utf8'));
    assert.equal(recibo.exitCode, 0);
    assert.deepEqual(c.stub.chamadas(), [r.comando.slice(1)], 'o grok rodou com o comando montado');
    assert.equal(r.comando[r.comando.indexOf('-s') + 1], r.sessionId);
    assert.equal(r.comando[r.comando.indexOf('--cwd') + 1], c.wt);
    assert.equal(c.stub.xaiVisto(), false, 'o filho nao recebe XAI_API_KEY');
    assert.ok(acharSessaoGrok(r.sessionId!, c.stub.casa), 'a pasta da sessao e do runtime');
    assert.match(fs.readFileSync(r.logPath!, 'utf8'), new RegExp(`"stopReason":"end_turn","sessionId":"${r.sessionId}"`));
  } finally {
    if (chaveAntes === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = chaveAntes;
    c.limpar();
  }
});

test('GK9: a saida 1 antes da sessao com o error de login vira falha da conta tipada e redigida', () => {
  const c = cenario('login');
  const chave = ['xai', 'Q'.repeat(24)].join('-');
  try {
    c.stub.streamTexto(`${JSON.stringify({ type: 'error', message: `Not logged in: run grok login (key ${chave})` })}\n`);
    c.stub.semSessao();
    c.stub.saida(1);
    const r = despachar({ ...PEDIDO, sessionId: undefined, cwd: c.wt, logDir: c.logs, esperaMs: 30000 });
    assert.equal(r.ok, false);
    assert.equal(r.sessionId, null);
    assert.equal(r.falhaDeConta?.motivo, 'runtime.auth-missing');
    assert.match(r.erro!, /^runtime\.auth-missing: Not logged in/);
    assert.equal(JSON.stringify(r).includes(chave), false, 'a chave nao sai do adaptador');
    assert.ok(r.logPath && r.reciboPath, 'os sensores do despacho falho ficam no resultado');
  } finally { c.limpar(); }
});

test('GK10: a saida 1 sem error vira runtime.unavailable com o codigo, o rate limit volta tipado e sem logDir recusa', () => {
  const c = cenario('sem-erro');
  try {
    c.stub.streamTexto('');
    c.stub.semSessao();
    c.stub.saida(1);
    const r = despachar({ ...PEDIDO, sessionId: undefined, cwd: c.wt, logDir: c.logs, esperaMs: 30000 });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'runtime.unavailable: o grok saiu 1 antes de criar a sessao');
    assert.equal(r.falhaDeConta, null);
    c.stub.streamTexto(`${JSON.stringify({ type: 'error', message: '429 Too Many Requests, retry after 30 seconds' })}\n`);
    const limite = despachar({ ...PEDIDO, sessionId: undefined, cwd: c.wt, logDir: c.logs, esperaMs: 30000 });
    assert.equal(limite.ok, false);
    assert.ok(limite.rateLimit, 'rate limit de janela curta volta para a fila');
    assert.match(limite.erro!, /^limite de uso do runtime atingido: /);
    const semLog = despachar({ ...PEDIDO, cwd: c.wt });
    assert.equal(semLog.erro, 'runtime.unavailable: despacho grok sem o diretorio de logs da thread');
  } finally { c.limpar(); }
});

test('GK11: a pasta da sessao e achada pelo id um nivel abaixo de sessions, sem link e sem ambiguidade', () => {
  const casa = dirTemporario('grok-casa');
  try {
    assert.equal(acharSessaoGrok(SESSAO, casa), null, 'sem sessions');
    const grupo = path.join(casa, 'sessions', '-srv-wt');
    const dir = path.join(grupo, SESSAO);
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(acharSessaoGrok(SESSAO, casa), null, 'sem updates.jsonl');
    fs.writeFileSync(path.join(dir, 'updates.jsonl'), '{}\n');
    const achada = acharSessaoGrok(SESSAO, casa)!;
    assert.equal(achada.dir, dir);
    assert.equal(achada.tamanho, 3);
    fs.symlinkSync(grupo, path.join(casa, 'sessions', 'grupo-por-link'));
    assert.equal(acharSessaoGrok(SESSAO, casa)?.dir, dir, 'grupo por link simbolico nao conta');
    assert.equal(acharSessaoGrok('../fora', casa), null, 'id fora do formato');
    const outro = path.join(casa, 'sessions', 'outro-grupo', SESSAO);
    fs.mkdirSync(outro, { recursive: true });
    fs.symlinkSync(path.join(dir, 'updates.jsonl'), path.join(outro, 'updates.jsonl'));
    assert.equal(acharSessaoGrok(SESSAO, casa)?.dir, dir, 'updates.jsonl por link nao conta');
    fs.rmSync(path.join(outro, 'updates.jsonl'));
    fs.writeFileSync(path.join(outro, 'updates.jsonl'), '');
    assert.equal(acharSessaoGrok(SESSAO, casa), null, 'o mesmo id em dois grupos nao prova qual e a sessao');
  } finally { fs.rmSync(casa, { recursive: true, force: true }); }
});

test('GK12: a versao e a disponibilidade vem do proprio grok no PATH', () => {
  const stub = grokFalso('versao');
  try {
    assert.equal(versao(), 'grok 1.0.62');
    assert.equal(disponivel(), path.join(stub.dir, 'grok'));
  } finally { stub.restaurar(); }
});

test('GK13: a cauda longa do stderr descarta a linha cortada pela janela, acha a frase de login no fim e nao vaza a chave', () => {
  const c = cenario('stderr-longo');
  try {
    const chave = ['xai', 'K'.repeat(60)].join('-');
    const primeira = `partida do grok com api_key=${chave}\n`;
    const ultima = 'Not logged in: run grok login\n';
    // A janela de 4096 bytes do fim comeca 30 bytes antes do fim da primeira linha, no meio da chave, e o meio e so
    // espaco em branco: normalizado, ele some e deixaria o pedaco da chave colado na frase do fim.
    const meio = ' \n'.repeat((4096 - 30 - Buffer.byteLength(ultima)) / 2);
    c.stub.stderr(primeira + meio + ultima);
    c.stub.streamTexto('');
    c.stub.semSessao();
    c.stub.saida(1);
    const r = despachar({ ...PEDIDO, sessionId: undefined, cwd: c.wt, logDir: c.logs, esperaMs: 30000 });
    assert.equal(r.ok, false);
    assert.equal(r.falhaDeConta?.motivo, 'runtime.auth-missing', 'a frase do fim da cauda classifica a falha');
    assert.equal(JSON.stringify(r).includes('KKKKK'), false, 'nenhum pedaco da chave cortada sai do adaptador');
    assert.ok(r.stderr.endsWith('Not logged in: run grok login'), r.stderr.slice(-80));
    assert.ok(Array.from(r.stderr).length <= 500);
  } finally { c.limpar(); }
});

test('GK14: a cauda com log de verdade e caractere fora do plano basico classifica pela frase do fim e cabe nas 500 unidades do ledger', () => {
  // GO-FIX 2 (N3 e N6): o meio da cauda é log de verdade, então a cauda normalizada passa de 500 caracteres. A última
  // linha repete um emoji antes da frase, e as 500 unidades UTF-16 do fim começariam na metade baixa de um par.
  const c = cenario('stderr-log');
  try {
    const emoji = String.fromCodePoint(0x1f600);
    const log = Array.from({ length: 80 }, (_, i) => `inicio do grok: modulo ${i} carregado\n`).join('');
    c.stub.stderr(`${log}${emoji.repeat(300)} Not logged in: run grok login.\n`);
    c.stub.streamTexto('');
    c.stub.semSessao();
    c.stub.saida(1);
    const r = despachar({ ...PEDIDO, sessionId: undefined, cwd: c.wt, logDir: c.logs, esperaMs: 30000 });
    assert.equal(r.ok, false);
    assert.equal(r.falhaDeConta?.motivo, 'runtime.auth-missing', 'a frase do fim classifica, com log de verdade antes dela');
    assert.ok(r.stderr.endsWith('Not logged in: run grok login.'), r.stderr.slice(-80));
    assert.ok(r.stderr.length <= 500, `${r.stderr.length} unidades: quem grava corta 500 pelo comeco e tiraria o fim`);
    const primeira = r.stderr.charCodeAt(0);
    assert.ok(primeira < 0xdc00 || primeira > 0xdfff, 'o corte nao comeca na metade baixa de um par');
    assert.equal(r.stderr.codePointAt(0), 0x1f600, 'o primeiro caractere e o emoji inteiro');
  } finally { c.limpar(); }
});
