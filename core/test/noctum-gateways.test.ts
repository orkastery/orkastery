/**
 * RM-058 (N6, D12 da ork-rm058n6): o comando `/ork noctum <arco> autorizar <sha256>|revogar` nos dois ingressos do
 * Telegram. A gramática tem um domicílio, o núcleo, e duas cópias obrigatórias; os testes de cada gateway rodam daqui; e a
 * ponta a ponta leva a mensagem assinada por cada gateway até o `ork` real, numa raiz descartável, onde o arco é autorizado.
 * Chaves, contas, usuários e mensagens são SIMULADOS; nenhuma mensagem sai da máquina.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { projetoTemporario } from './apoio';
import { pedidoV2, prepararIngressoSimulado } from './noctum-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { ALVO_DO_NOCTUM, enderecoDoArco, lerArco, proporEnvelope } from '../src/noctum-arco';
import { GRAMATICA_DO_NOCTUM } from '../src/noctum-modo';
import { novaThread } from '../src/thread';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const RAIZ = path.resolve(__dirname, '../../..');
const CLI = path.resolve(__dirname, '../../dist/index.js');
const HERMES = path.join(RAIZ, 'adapters/hermes');
const PLUGIN_HERMES = path.join(HERMES, 'hitl-ingress/__init__.py');
const DIST_OPENCLAW = path.join(RAIZ, 'adapters/openclaw/dist/hitl-ingress.js');
const temPython = spawnSync('python3', ['--version']).status === 0;
const CHAVE_OPENCLAW = 'chave-do-openclaw-SIMULADA-somente-nos-testes-00';

test('GW1: a gramática do /ork noctum é a MESMA no núcleo e nos dois ingressos, com o mesmo endereço assinado', () => {
  const hermes = fs.readFileSync(PLUGIN_HERMES, 'utf8');
  const fonte = fs.readFileSync(path.join(RAIZ, 'adapters/openclaw/src/hitl-ingress.ts'), 'utf8');
  const dist = fs.readFileSync(DIST_OPENCLAW, 'utf8');
  assert.ok(hermes.includes(`r'${GRAMATICA_DO_NOCTUM}'`), 'hermes divergiu');
  assert.ok(fonte.includes(JSON.stringify(GRAMATICA_DO_NOCTUM)), 'openclaw (fonte) divergiu');
  assert.ok(dist.includes(JSON.stringify(GRAMATICA_DO_NOCTUM)), 'openclaw (dist) divergiu');
  assert.equal(ALVO_DO_NOCTUM, 'noctum');
  assert.equal(enderecoDoArco('x'), 'arco:x');
  assert.match(hermes, /NOCTUM_ALVO, NOCTUM_ENDERECO = 'noctum', 'arco:'/);
  assert.match(fonte, /const NOCTUM_ALVO = 'noctum', NOCTUM_ENDERECO = 'arco:';/);
  const g = new RegExp(GRAMATICA_DO_NOCTUM);
  assert.deepEqual(g.exec(`/ork noctum arco-1 autorizar ${'c'.repeat(64)}`)?.slice(1), ['arco-1', `autorizar ${'c'.repeat(64)}`]);
  for (const nao of ['/ork noctum arco:1 revogar', '/ork noctum Arco revogar', '/ork gate arco-1 revogar', '/ork noctum arco-1 revogar já']) {
    assert.equal(g.test(nao), false, nao);
  }
});

test('GW2: o teste do ingresso do Hermes para o /ork noctum passa pelo unittest', { skip: !temPython }, () => {
  const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'hitl_noctum_test.py'], { cwd: HERMES, encoding: 'utf8',
    timeout: 60_000, env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Ran 6 tests/);
  assert.doesNotMatch(r.stderr, /skipped=/);
});

test('GW3: o teste do ingresso do OpenClaw para o /ork noctum passa', () => {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  const r = spawnSync(process.execPath, ['--test-reporter=tap', path.join(RAIZ, 'adapters/openclaw/test/hitl-noctum.test.mjs')],
    { encoding: 'utf8', timeout: 120_000, env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((r.stdout.match(/^ok \d+ - noctum:/gm) ?? []).length, 4, r.stdout);
  assert.doesNotMatch(r.stdout, /^not ok/m);
});

/** O `ork` real desta árvore, como os gateways o chamam (`ORK_BIN`). */
function orkReal(dir: string): string {
  const bin = path.join(dir, 'ork-real-simulado');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 });
  return bin;
}

function arcoProposto(p: ReturnType<typeof projetoTemporario>, arco: string): string {
  const t = novaThread(p.carregado, { nome: `${arco} trabalho`, modo: 'auto', roadmap: 'RM-901', pedido: 'Trabalho SIMULADO do gateway.',
    criarWorktree: false }).thread;
  return proporEnvelope(p.dir, pedidoV2(arco, { trabalhos: [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }] })).envelopeSha256;
}

test('GW4: ponta a ponta, a mensagem assinada pelo Hermes autoriza o arco no ork real', { skip: semKernel || !temPython }, () => {
  const p = projetoTemporario('noctum-gw4');
  try {
    const sha = arcoProposto(p, 'arco-gw4');
    const driver = path.join(p.dir, 'driver-hermes.py');
    fs.writeFileSync(driver, [
      'import asyncio, importlib.util, json, sys',
      'from types import SimpleNamespace, ModuleType',
      'from datetime import datetime, timezone',
      'from unittest.mock import AsyncMock',
      'spec = importlib.util.spec_from_file_location("ingresso", sys.argv[1])',
      'ingresso = importlib.util.module_from_spec(spec); spec.loader.exec_module(ingresso)',
      'class Message(SimpleNamespace):',
      '    def get_bot(self): return SimpleNamespace(id=99)',
      'class MessageEvent(SimpleNamespace): pass',
      'base, telegram = ModuleType("gateway.platforms.base"), ModuleType("telegram")',
      'base.MessageEvent, telegram.Message = MessageEvent, Message',
      'sys.modules.update({"gateway": ModuleType("gateway"), "gateway.platforms": ModuleType("gateway.platforms"),',
      '                    "gateway.platforms.base": base, "telegram": telegram})',
      'async def principal():',
      '    texto = sys.argv[2]',
      '    msg = Message(text=texto, message_id=8, from_user=SimpleNamespace(id=42, is_bot=False), chat=SimpleNamespace(id=-7),',
      '                  date=datetime.now(timezone.utc))',
      '    msg.reply_text = AsyncMock(return_value=Message(message_id=9, chat=msg.chat, from_user=SimpleNamespace(id=99, is_bot=True),',
      '                                                    text=ingresso.CONFIRM_TEXT["noctum"]))',
      '    ev = MessageEvent(text=texto, raw_message=msg, message_id="8",',
      '                      source=SimpleNamespace(platform=SimpleNamespace(value="telegram"), user_id="42", chat_id="-7"))',
      '    gw = SimpleNamespace(_is_user_authorized=lambda _: True)',
      '    ingresso._ingress(event=ev, gateway=gw)',
      '    await asyncio.gather(*list(ingresso._tasks))',
      '    await asyncio.sleep(0)',
      '    print(json.dumps(ingresso._ingress(event=ev, gateway=gw)))',
      'asyncio.run(principal())', ''].join('\n'));
    const r = spawnSync('python3', [driver, PLUGIN_HERMES, `/ork noctum arco-gw4 autorizar ${sha}`], { cwd: p.dir, encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ORK_HITL_ROOT: p.dir, ORK_BIN: orkReal(p.dir), ORK_HITL_TELEGRAM_BOT_ID: '99' } });
    assert.equal(r.status, 0, r.stderr);
    const status = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { effect: string; confirmation: string };
    assert.deepEqual([status.effect, status.confirmation], ['confirmed', 'sent'], r.stdout);
    const estado = lerArco(p.dir, 'arco-gw4')!;
    assert.deepEqual([estado.situacao, estado.envelopeSha256], ['vigente', sha]);
    assert.deepEqual([(estado.autorizadoPor as { origem: string }).origem, (estado.autorizadoPor as { canal: string }).canal], ['telegram', 'hermes']);
  } finally { p.limpar(); }
});

test('GW5: ponta a ponta, a mensagem assinada pelo OpenClaw autoriza o arco no ork real, com a conta autorizada', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-gw5');
  try {
    const sha = arcoProposto(p, 'arco-gw5');
    const driver = path.join(p.dir, 'driver-openclaw.mjs');
    fs.writeFileSync(driver, [
      `import { registerHitlIngress } from ${JSON.stringify(pathToFileURL(DIST_OPENCLAW).href)};`,
      'const [bin, texto] = process.argv.slice(2);',
      'let handler;',
      'registerHitlIngress({ on(_nome, fn) { handler = fn; } }, bin);',
      "const event = { content: texto, channel: 'telegram', commandAuthorized: true, accountId: 'conta-simulada', senderId: '42',",
      "  conversationId: '-7', messageId: '9', timestamp: Date.now() };",
      "const ctx = { channelId: 'telegram', accountId: 'conta-simulada', senderId: '42', conversationId: '-7', messageId: '9' };",
      'console.log(JSON.stringify(await handler(event, ctx)));', ''].join('\n'));
    const env: NodeJS.ProcessEnv = { ...process.env, ORK_HITL_ROOT: p.dir, ORK_HITL_TELEGRAM_BOT_ID: '99', ORK_HITL_OPENCLAW_ACCOUNT: 'conta-simulada',
      ORK_HITL_INGRESS_KEY_OPENCLAW: CHAVE_OPENCLAW };
    delete env.FORCE_COLOR;
    const r = spawnSync(process.execPath, [driver, orkReal(p.dir), `/ork noctum arco-gw5 autorizar ${sha}`], { cwd: p.dir, encoding: 'utf8',
      timeout: 90_000, env });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').at(-1)!), { handled: true, reply: { text: 'Arco arco-gw5 autorizado pelo núcleo.' } });
    const estado = lerArco(p.dir, 'arco-gw5')!;
    assert.deepEqual([estado.situacao, estado.envelopeSha256], ['vigente', sha]);
    const quem = estado.autorizadoPor as { canal: string; conta: string };
    assert.deepEqual([quem.canal, quem.conta], ['openclaw', 'conta-simulada']);
  } finally { p.limpar(); }
});
