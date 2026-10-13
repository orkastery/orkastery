/**
 * RM-063 (slice 3): what the owner's channel gains in the OpenClaw host.
 *  H2: #OrkRetomar and #OrkFabrica, alone in the message, reach the core through the signed pulse address;
 *  H1: bin/ork-vigia-batida.js reads `ork doctor --json` and prints the warning, NO_REPLY or the alert, always exit 0.
 * Hooks, identities, chats, keys and the `ork` binary are SIMULATED; the CLI transport is a local subprocess.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isPulseAnswer, registerHitlIngress } from '../dist/hitl-ingress.js';

const VIGIA = fileURLToPath(new URL('../bin/ork-vigia-batida.js', import.meta.url));
const RETOMANDO = 'Retomando: a batida da condução está rodando nesta máquina agora (SIMULADO). O que voltou a andar chega em seguida, por este canal.';
const FABRICA = 'Fabrica: 1 maquina SIMULADA\n  maquina-simulada  3 threads  ultima batida 01:30';
/** Conversation that mentions the tags: it goes to the assistant, never to the core. */
const CONVERSA = ['pode #OrkRetomar', '#OrkRetomarAgora', '#OrkFabrica e o resto', '#Ork', 'fica em #OrkFabrica hoje'];

test('H2: #OrkRetomar and #OrkFabrica are pulse answers only when alone in the message', () => {
  for (const texto of ['#OrkRetomar', '  #orkfabrica! ', '#OrkFabrica.', '#ORKRETOMAR']) assert.equal(isPulseAnswer(texto, ''), true, texto);
  for (const texto of CONVERSA) assert.equal(isPulseAnswer(texto, ''), false, texto);
});

test('H2: the ingress signs #OrkRetomar and #OrkFabrica at the pulse address and replies with the core text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm063-canal-'));
  const names = ['ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW', 'ORK_HITL_ROOT'];
  const old = names.map(n => process.env[n]);
  const vals = ['simulated', '99', '42', '-7', 'SIMULATED-native-ingress-key-for-test-000', dir];
  names.forEach((n, i) => process.env[n] = vals[i]);
  const bin = path.join(dir, 'ork'), recebido = path.join(dir, 'received.json');
  const recibo = corpo => fs.writeFileSync(bin, `#!${process.execPath}\nconst fs=require('fs');` +
    `if(process.argv[2]==='receipt-verifiers'){console.log('null');process.exit(0);}` +
    `fs.writeFileSync(${JSON.stringify(recebido)},JSON.stringify({args:process.argv.slice(2),envelope:JSON.parse(fs.readFileSync(0,'utf8'))}));` +
    `console.log(${JSON.stringify(JSON.stringify(corpo))});\n`, { mode: 0o700 });
  try {
    let handler;
    registerHitlIngress({ on(name, fn) { assert.equal(name, 'inbound_claim'); handler = fn; } }, bin);
    const ctx = { channelId: 'telegram', accountId: 'simulated', senderId: '42', conversationId: '-7', messageId: '30' };
    const evento = content => ({ content, channel: 'telegram', commandAuthorized: true, accountId: 'simulated',
      senderId: '42', conversationId: '-7', messageId: '30', timestamp: Date.now() });
    for (const [texto, tipo, mensagem] of [['#OrkRetomar', 'retomar', RETOMANDO], ['  #orkfabrica! ', 'fabrica', FABRICA]]) {
      recibo({ contrato: 'ork.pulse-resposta/v1', ok: true, tipo, repetida: false, registradas: [], recusas: [], mensagem });
      assert.deepEqual(await handler(evento(texto), ctx), { handled: true, reply: { text: mensagem } }, texto);
      const { args, envelope: e } = JSON.parse(fs.readFileSync(recebido, 'utf8'));
      // The whole text is the answer: it travels in the signed envelope on stdin, never in argv.
      assert.deepEqual(args, ['pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', 'openclaw',
        '--conta', 'simulated', '--por', 'telegram:42', '--mensagem', 'telegram:-7:30']);
      assert.equal(e.resposta, texto);
      assert.equal(e.prova, createHmac('sha256', vals[4]).update(JSON.stringify(['ork.hitl-answer/v2', 'pulse', 'resposta',
        'openclaw', 'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, texto])).digest('hex'));
      fs.rmSync(recebido);
    }
    // A tag inside a sentence, or outside Telegram, is not claimed and never reaches the core.
    for (const texto of CONVERSA) assert.deepEqual(await handler(evento(texto), ctx), { handled: false }, texto);
    assert.deepEqual(await handler({ ...evento('#OrkRetomar'), channel: 'discord' }, { ...ctx, channelId: 'discord' }), { handled: false });
    // Another chat is denied before the core is called: without the allowlist, nothing runs.
    assert.match((await handler({ ...evento('#OrkRetomar'), conversationId: '-8' }, { ...ctx, conversationId: '-8' })).reply.text, /não confirmada/);
    assert.equal(fs.existsSync(recebido), false);
    // The same message already handled by the core is never answered again.
    recibo({ contrato: 'ork.pulse-resposta/v1', ok: true, tipo: 'retomar', repetida: true, registradas: [], recusas: [], mensagem: RETOMANDO });
    assert.deepEqual(await handler(evento('#OrkRetomar'), ctx), { handled: true });
  } finally {
    names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const AVISO = 'Orkastery: a fabrica fabrica-simulada na maquina maquina-simulada esta sem batida ha 45 min (ultima rodada SIMULADA). ' +
  'Confira com: ork fabrica batida status';
const BATIDA = { threadsAbertas: 2, instalada: true, ultimaRodadaEm: '2026-10-13T00:15:00.000Z', codigo: 0, haMin: 45, limiteMin: 30,
  atrasada: true, aviso: AVISO };
const doctorJson = batida => JSON.stringify({ contrato: 'ork.doctor/v1', consultadoEm: '2026-10-13T01:00:00.000Z', veredito: 'bloqueado',
  falhas: 1, avisos: 0, projeto: 'fabrica-simulada', maquina: 'maquina-simulada', checks: [], batida }, null, 2);
const alerta = detalhe => `Orkastery: o ork doctor nao respondeu na maquina maquina-simulada (${detalhe}): ` +
  'a batida da fabrica fabrica-simulada nao pode ser conferida.\n';

/** A SIMULATED `ork`: records its path, argv and ORK_* environment, writes stderr like the core and prints the canned stdout. */
function orkFalso(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'ork');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs');
fs.writeFileSync(process.env.ORK_FALSO_REGISTRO, JSON.stringify({ bin: process.argv[1], argv: process.argv.slice(2),
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('ORK_'))) }));
process.stderr.write('Projeto consultado: fabrica-simulada (SIMULADO)\\n');
process.stdout.write(fs.readFileSync(process.env.ORK_FALSO_SAIDA, 'utf8'));
process.exitCode = Number(process.env.ORK_FALSO_CODIGO || 0);
`, { mode: 0o700 });
  return bin;
}

/** Runs the watcher as the automation does, with this process's ORK_* removed; `env` values of undefined unset a name. */
function vigiar(dir, { script = VIGIA, argv = ['--projeto', 'fabrica-simulada'], saida = '', codigo = 0, env = {} } = {}) {
  const registro = path.join(dir, 'registro.json'), arquivoDaSaida = path.join(dir, 'saida.txt');
  fs.writeFileSync(arquivoDaSaida, saida);
  fs.rmSync(registro, { force: true });
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ORK_')));
  const r = spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', timeout: 60000, env: { ...base,
    ORK_BIN: path.join(dir, 'ork'), ORK_FALSO_REGISTRO: registro, ORK_FALSO_SAIDA: arquivoDaSaida, ORK_FALSO_CODIGO: String(codigo),
    ORK_MAQUINA: 'maquina-simulada', ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr,
    chamada: fs.existsSync(registro) ? JSON.parse(fs.readFileSync(registro, 'utf8')) : null };
}

test('H1: late beat prints the core warning, a fine one prints NO_REPLY, a failing ork prints the alert; always exit 0, empty stderr', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm063-vigia-'));
  try {
    orkFalso(dir);
    // The doctor exits 1 (veredito bloqueado) and still prints the JSON: it is read anyway.
    let r = vigiar(dir, { saida: doctorJson(BATIDA), codigo: 1, env: { ORK_CANAL: 'claude-code', ORK_PROJETO_EXPLICITO: '0',
      ORK_HITL_INGRESS_KEY_OPENCLAW: 'SIMULATED-key-that-the-doctor-never-needs-000' } });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, `${AVISO}\n`, '']);
    assert.deepEqual(r.chamada.argv, ['--projeto', 'fabrica-simulada', 'doctor', '--json']);
    assert.equal(r.chamada.env.ORK_CANAL, 'openclaw');
    assert.equal(r.chamada.env.ORK_PROJETO_EXPLICITO, '1');
    assert.deepEqual(Object.keys(r.chamada.env).filter(k => k.startsWith('ORK_HITL_')), [], 'the doctor never gets the HITL keys');
    for (const batida of [{ ...BATIDA, haMin: 5, atrasada: false, aviso: null }, null]) {
      r = vigiar(dir, { saida: doctorJson(batida) });
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'NO_REPLY\n', ''], JSON.stringify(batida));
    }
    r = vigiar(dir, { saida: doctorJson({ ...BATIDA, aviso: null }) });
    assert.deepEqual([r.status, r.stdout], [0, 'Orkastery: a fabrica fabrica-simulada esta sem batida. Confira com: ork fabrica batida status\n']);
    // Garbage on stdout, a typed core error, ork missing: the alert, with a short detail and never the free output.
    r = vigiar(dir, { saida: 'isto nao e json SIMULADO', codigo: 2 });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, alerta('saiu com codigo 2'), '']);
    r = vigiar(dir, { saida: JSON.stringify({ erro: 'projeto.desconhecido', detalhe: 'texto livre SIMULADO do nucleo' }), codigo: 4 });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, alerta('saiu com codigo 4: projeto.desconhecido'), '']);
    r = vigiar(dir, { saida: JSON.stringify({ contrato: 'outro/v1' }) });
    assert.deepEqual([r.status, r.stdout], [0, alerta('resposta fora do contrato ork.doctor/v1')]);
    const ausente = path.join(dir, 'nao-existe', 'ork');
    r = vigiar(dir, { env: { ORK_BIN: ausente } });
    assert.deepEqual([r.status, r.stdout, r.stderr, r.chamada], [0, alerta(`ork nao encontrado em ${ausente}`.slice(0, 160)), '', null]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H1: the project comes from --projeto or ORK_PROJETO; without a valid one the alert says so and ork is not called', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm063-vigia-projeto-'));
  try {
    orkFalso(dir);
    const saida = doctorJson(null);
    assert.equal(vigiar(dir, { saida, argv: ['--projeto=fabrica-igual'] }).chamada.argv[1], 'fabrica-igual');
    assert.equal(vigiar(dir, { saida, argv: [], env: { ORK_PROJETO: 'fabrica-do-ambiente' } }).chamada.argv[1], 'fabrica-do-ambiente');
    let r = vigiar(dir, { saida, argv: [] });
    assert.deepEqual([r.status, r.chamada], [0, null]);
    assert.match(r.stdout, /^Orkastery: a batida do OpenClaw nao sabe qual fabrica conferir: falta --projeto <nome>/);
    for (const invalido of ['../fabrica', '--json', '/caminho/da/fabrica']) {
      r = vigiar(dir, { saida, argv: ['--projeto', invalido] });
      assert.deepEqual([r.status, r.chamada], [0, null], invalido);
      assert.match(r.stdout, /^Orkastery: a batida do OpenClaw recebeu um projeto invalido/, invalido);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H1: the binary is ORK_BIN, else the path the installer rendered, else the ork on PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm063-vigia-bin-'));
  try {
    const doPath = orkFalso(path.join(dir, 'path')), renderizado = orkFalso(path.join(dir, 'renderizado'));
    const saida = doctorJson(null);
    // Unrendered copy (the repository's): the placeholder falls back to `ork` on PATH.
    let r = vigiar(dir, { saida, env: { ORK_BIN: undefined, PATH: path.dirname(doPath) } });
    assert.deepEqual([r.stdout, r.chamada.bin], ['NO_REPLY\n', doPath]);
    // Installed copy: the same replacement the installer applies to .js files, inside a module package.
    const ext = path.join(dir, 'extensions', 'orkastery');
    fs.mkdirSync(path.join(ext, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(ext, 'package.json'), '{"type":"module"}');
    const instalado = fs.readFileSync(VIGIA, 'utf8').replace(/\{\{ork_bin\}\}/g, renderizado);
    assert.equal(instalado.includes('{{'), false, 'pitfall 1: no placeholder left in the installed copy');
    fs.writeFileSync(path.join(ext, 'bin', 'ork-vigia-batida.js'), instalado, { mode: 0o755 });
    r = vigiar(dir, { saida, script: path.join(ext, 'bin', 'ork-vigia-batida.js'), env: { ORK_BIN: undefined, PATH: path.dirname(doPath) } });
    assert.deepEqual([r.stdout, r.chamada.bin], ['NO_REPLY\n', renderizado]);
    r = vigiar(dir, { saida, script: path.join(ext, 'bin', 'ork-vigia-batida.js'), env: { ORK_BIN: doPath } });
    assert.deepEqual([r.stdout, r.chamada.bin], ['NO_REPLY\n', doPath]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
