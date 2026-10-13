/**
 * RM-063 (fatia 3): o que o canal do dono ganha nos hosts.
 *
 *  H2: `#OrkRetomar` no canal roda a batida da conducao (em segundo plano: o ingresso do host espera ate 10 s) e o que
 *      voltou a andar volta ao dono pelo transporte; `#OrkFabrica` responde o `ork fabrica`. As duas passam pelo mesmo
 *      endereco assinado do pulse: sem a prova do envelope, nada roda;
 *  H3: a etapa `maestro` do onboarding grava o canal do dono e, junto, o `pulse-host.json` pronto do host; o canal de um
 *      segundo host vira o principal, e o primeiro fica como alternativo (H4).
 *
 * Chaves, identidades, chats e executaveis SIMULADOS, em projetos temporarios.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario, projetoTemporario } from './apoio';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { lerOnboarding, gravarEtapa } from '../src/onboarding';
import { ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA } from '../src/pulse-consentimento';
import { GRAMATICA_DO_PULSE, interpretarRespostaDoPulse, responderPeloPulse } from '../src/pulse-resposta';
import { canalValido, caminhoDoPulseHost } from '../src/transporte-do-canal';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const chave = 'chave-SIMULADA-do-canal-hermes-nos-testes-000';

function ambiente(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW'];
  const antigos = nomes.map((n) => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY_HERMES = chave;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  delete process.env.ORK_HITL_INGRESS_KEY_OPENCLAW;
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

/** O que o ingresso do Hermes produz quando o dono digita `texto` no Telegram. */
let mensagens = 9000;
function dizer(texto: string, quando: string): RespostaHumana {
  const r = { resposta: texto, canal: 'hermes' as const, origem: 'telegram' as const, por: 'telegram:42', mensagem: `telegram:-7:${++mensagens}`,
    recebidoEm: quando };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, r, chave) };
}

test('H2: #OrkRetomar e #OrkFabrica sao formas do pulse, sozinhas na mensagem', () => {
  assert.deepEqual(interpretarRespostaDoPulse('#OrkRetomar'), { forma: 'conducao', comando: 'retomar' });
  assert.deepEqual(interpretarRespostaDoPulse('  #orkretomar! '), { forma: 'conducao', comando: 'retomar' });
  assert.deepEqual(interpretarRespostaDoPulse('#OrkFabrica.'), { forma: 'conducao', comando: 'fabrica' });
  for (const conversa of ['pode #OrkRetomar', '#OrkRetomarAgora', '#OrkFabrica e o resto', '#Ork']) {
    assert.notEqual(interpretarRespostaDoPulse(conversa).forma, 'conducao', conversa);
  }
  assert.equal(GRAMATICA_DO_PULSE.conducao, '^[ \\t]*#Ork(?:Retomar|Fabrica)[ \\t]*[.!]?[ \\t]*$');
});

test('H2: com o envelope assinado, #OrkRetomar dispara a batida e responde na hora; #OrkFabrica responde a fabrica', () => {
  const p = projetoTemporario('rm063-h2-canal');
  const voltar = ambiente();
  try {
    const quando = new Date().toISOString();
    const disparos: [string, string | null][] = [];
    const retomar = (raiz: string, canal: string | null) => { disparos.push([raiz, canal]); };
    const r = responderPeloPulse(p.dir, dizer('#OrkRetomar', quando), { quando, retomar, fabrica: () => 'nao deveria' });
    assert.deepEqual([r.tipo, r.ok, disparos], ['retomar', true, [[p.dir, 'hermes']]]);
    assert.match(r.mensagem, /^Retomando: a batida da condução está rodando nesta máquina agora .* O que voltou a andar chega em seguida, por este canal\.$/);
    const f = responderPeloPulse(p.dir, dizer('#OrkFabrica', quando), { quando, retomar,
      fabrica: () => 'Fabrica: 1 maquina\n  maquina-b  3 threads  ultima batida 01:30' });
    assert.deepEqual([f.tipo, f.mensagem], ['fabrica', 'Fabrica: 1 maquina\n  maquina-b  3 threads  ultima batida 01:30']);
    const longa = responderPeloPulse(p.dir, dizer('#OrkFabrica', quando), { quando, fabrica: () => 'x'.repeat(10_000) });
    assert.ok(longa.mensagem.length <= 3900 && longa.mensagem.endsWith('(cortado; ork fabrica)'));
    // Sem a prova do envelope (o texto trocado depois da assinatura), nada roda.
    const forjado = { ...dizer('#OrkFabrica', quando), resposta: '#OrkRetomar' };
    assert.throws(() => responderPeloPulse(p.dir, forjado, { quando, retomar }));
    assert.equal(disparos.length, 1, 'o envelope sem prova nao disparou a batida');
  } finally { voltar(); p.limpar(); }
});

/** Um executavel simulado do host: grava os argumentos que recebeu. */
function executavel(dir: string, nome: string, codigo = 0): string {
  const bin = path.join(dir, nome);
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${bin}.args'\nexit ${codigo}\n`, { mode: 0o755 });
  return bin;
}

test('H2: ork conducao batida --entregar leva o que voltou a andar pelo transporte do pulse', () => {
  const p = projetoTemporario('rm063-h2-entregar');
  try {
    const bins = dirTemporario('rm063-h2-bins');
    const host = executavel(bins, 'openclaw');
    fs.mkdirSync(path.dirname(caminhoDoPulseHost(p.dir)), { recursive: true });
    fs.writeFileSync(caminhoDoPulseHost(p.dir), JSON.stringify({ host: 'openclaw', executavel: host, argumentos: ['--message', '{{mensagem}}'] }));
    const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C.UTF-8' };
    for (const k of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'LC_ALL']) delete env[k];
    const r = spawnSync(process.execPath, [CLI, 'conducao', 'batida', '--entregar'], { cwd: p.dir, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    const enviado = fs.readFileSync(`${host}.args`, 'utf8');
    assert.match(enviado, /^--message\n🔁 Orkastery, retomada em .+:\nSem autorização durável válida \(autorizacao\.ausente\)/);
    const log = fs.readFileSync(path.join(p.dir, '.orkastery', 'monitor', 'transporte.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((l) => [l.oQue, l.ok, l.host]), [['a retomada', true, 'openclaw']]);
  } finally { p.limpar(); }
});

test('H3: o canal do dono e validado pela forma: host conhecido, chat Telegram explicito, caminhos absolutos', () => {
  assert.equal(canalValido({ host: 'openclaw', destino: 'telegram:-1001234' }), true);
  assert.equal(canalValido({ host: 'hermes', destino: 'telegram:123:45', script: '/opt/hermes/bin/ork-pulse-enviar.py' }), true);
  for (const ruim of [{ host: 'slack', destino: 'telegram:1' }, { host: 'openclaw', destino: '@dono' }, { host: 'openclaw', destino: 'telegram:1:2' },
    { host: 'hermes', destino: 'telegram:1', executavel: 'python3' }, { host: 'openclaw', destino: 'telegram:1', script: '/x.py' },
    { host: 'hermes', destino: 'telegram:1', token: 'x' }, 'openclaw']) {
    assert.equal(canalValido(ruim), false, JSON.stringify(ruim));
  }
});

test('H3: a etapa maestro grava o canal e o pulse-host.json pronto; o segundo host vira o principal e o primeiro, o alternativo', () => {
  const p = projetoTemporario('rm063-h3-onboarding');
  try {
    const bins = dirTemporario('rm063-h3-bins');
    const openclaw = executavel(bins, 'openclaw'), python = executavel(bins, 'python3');
    const script = path.join(bins, 'ork-pulse-enviar.py');
    fs.writeFileSync(script, '# simulado\n');
    gravarEtapa(p.dir, 'maestro', { objetivo: 'fabrica que nao para' }, 'Dona Simulada');
    gravarEtapa(p.dir, 'maestro', { canal: { host: 'openclaw', destino: 'telegram:-7', executavel: openclaw } }, 'Dona Simulada');
    const maestro = lerOnboarding(p.dir).etapas.maestro?.conteudo as Record<string, unknown>;
    assert.deepEqual(maestro, { objetivo: 'fabrica que nao para', canal: { host: 'openclaw', destino: 'telegram:-7', executavel: openclaw } },
      'o canal nao apaga as outras respostas da etapa');
    const primeiro = JSON.parse(fs.readFileSync(caminhoDoPulseHost(p.dir), 'utf8'));
    assert.deepEqual(primeiro, { host: 'openclaw', destino: 'telegram:-7', executavel: openclaw,
      argumentos: ['message', 'send', '--channel', 'telegram', '--target', '-7', '--message', '{{mensagem}}', '--json'] });
    assert.equal(fs.statSync(caminhoDoPulseHost(p.dir)).mode & 0o777, 0o600);
    // O Hermes chega depois: vira o principal, e o OpenClaw fica como o outro host configurado.
    gravarEtapa(p.dir, 'maestro', { canal: { host: 'hermes', destino: 'telegram:-7', executavel: python, script } }, 'Dona Simulada');
    const segundo = JSON.parse(fs.readFileSync(caminhoDoPulseHost(p.dir), 'utf8'));
    assert.deepEqual([segundo.host, segundo.executavel, segundo.argumentos], ['hermes', python, [script, '--target', 'telegram:-7', '--message', '{{mensagem}}']]);
    assert.deepEqual(segundo.alternativos.map((a: { host: string }) => a.host), ['openclaw']);
    // A mesma resposta de novo regrava o transporte apagado: a maquina nunca fica sem ele.
    fs.rmSync(caminhoDoPulseHost(p.dir));
    gravarEtapa(p.dir, 'maestro', { canal: { host: 'hermes', destino: 'telegram:-7', executavel: python, script } }, 'Dona Simulada');
    assert.equal(JSON.parse(fs.readFileSync(caminhoDoPulseHost(p.dir), 'utf8')).host, 'hermes');
    // Fora do git.
    assert.equal(spawnSync('git', ['status', '--porcelain', '--', caminhoDoPulseHost(p.dir)], { cwd: p.dir, encoding: 'utf8' }).stdout.trim(), '');
  } finally { p.limpar(); }
});

test('H3: sem o executavel do host nesta maquina, nada e gravado e o motivo diz o que informar', () => {
  const p = projetoTemporario('rm063-h3-sem-host');
  try {
    const antes = JSON.stringify(lerOnboarding(p.dir));
    assert.throws(() => gravarEtapa(p.dir, 'maestro', { canal: { host: 'hermes', destino: 'telegram:-7',
      executavel: '/caminho/que/nao/existe/python3', script: '/caminho/que/nao/existe/ork-pulse-enviar.py' } }, 'Dona Simulada'),
    /onboarding\.canal\.transporte: o Python do venv do Hermes não está em .*; informe canal\.executavel/);
    assert.equal(fs.existsSync(caminhoDoPulseHost(p.dir)), false);
    assert.equal(JSON.stringify(lerOnboarding(p.dir)), antes, 'a etapa nao mudou');
    assert.throws(() => gravarEtapa(p.dir, 'maestro', { canal: { host: 'openclaw', destino: 'telegram:-7:9' } }, 'Dona Simulada'),
      /onboarding\.input\.invalid/);
  } finally { p.limpar(); }
});
