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
import { ALVO_DO_NOCTUM, enderecoDoArco, lerArco, perguntasDoArco, proporEnvelope } from '../src/noctum-arco';
import { entregarPerguntaDoArco } from '../src/noctum-pergunta-canal';
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
  // Sob `node --test` com vários arquivos, o runner pai marca o filho com NODE_TEST_CONTEXT e o neto falaria o
  // protocolo binário do runner em vez do TAP pedido; sem a marca, o neto relata em TAP como roda sozinho.
  delete env.NODE_TEST_CONTEXT;
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

// RM-057 (resposta curta, ork-rm057respost): o reply à pergunta do arco nos dois ingressos do Telegram. GO-FIX 1 (achado 2): o
// reply só vale para a mensagem em que a pergunta foi entregue, pelo id que o transporte devolveu.

test('GW6: o teste do reply do Hermes passa pelo unittest', { skip: !temPython }, () => {
  const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'hitl_resposta_curta_test.py'], { cwd: HERMES, encoding: 'utf8',
    timeout: 60_000, env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Ran 13 tests/);
  assert.doesNotMatch(r.stderr, /skipped=/);
});

test('GW7: o teste do reply do OpenClaw passa', () => {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test-reporter=tap', path.join(RAIZ, 'adapters/openclaw/test/hitl-resposta-curta.test.mjs')],
    { encoding: 'utf8', timeout: 120_000, env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((r.stdout.match(/^ok \d+ - reply:/gm) ?? []).length, 7, r.stdout);
  assert.doesNotMatch(r.stdout, /^not ok/m);
});

/**
 * Propõe o arco e entrega a pergunta pelo transporte SIMULADO do canal, que responde como o do Hermes, com o id da mensagem
 * entregue. Devolve o código, o id e o texto exato que saiu: é a ele que o dono responde.
 */
function arcoEntregue(p: ReturnType<typeof projetoTemporario>, arco: string): { sha: string; codigo: string; id: string; texto: string } {
  const sha = arcoProposto(p, arco);
  const monitor = path.join(p.dir, '.orkastery', 'monitor'), saida = path.join(p.dir, 'canal-SIMULADO.txt');
  const script = path.join(p.dir, 'canal-SIMULADO.cjs');
  fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(saida)}, process.argv[2]);\n` +
    "process.stdout.write(JSON.stringify({ success: true, message_id: 5, platform: 'telegram' }));\n");
  fs.mkdirSync(monitor, { recursive: true });
  fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ host: 'hermes', destino: 'telegram:-7', executavel: process.execPath,
    argumentos: [script, '{{mensagem}}'] }), { mode: 0o600 });
  const codigo = lerArco(p.dir, arco)!.propostaPendente!.codigo!;
  const q = perguntasDoArco(p.dir, arco).find(x => x.codigo === codigo)!;
  const entrega = entregarPerguntaDoArco(p.dir, q);
  assert.deepEqual([entrega.entregue, entrega.mensagens], [true, ['5']], entrega.detalhe);
  return { sha, codigo, id: '5', texto: fs.readFileSync(saida, 'utf8') };
}

/**
 * O driver do plugin real do Hermes: o dono responde `texto` em reply à mensagem `respondida` (id `idRespondida`) do bot, ou
 * de outra pessoa quando o passo diz o autor (GO-FIX 2), ou sem reply nenhum quando `respondida` é `null`.
 */
const DRIVER_DO_HERMES = [
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
  'enviadas = []',
  'async def dono(texto, mid, respondida, id_respondida, autor=99):',
  '    alvo = None if respondida is None else Message(text=respondida, message_id=id_respondida, from_user=SimpleNamespace(id=autor, is_bot=(autor == 99)))',
  '    msg = Message(text=texto, message_id=mid, from_user=SimpleNamespace(id=42, is_bot=False), chat=SimpleNamespace(id=-7),',
  '                  date=datetime.now(timezone.utc), reply_to_message=alvo)',
  '    async def responder(t, **_):',
  '        enviadas.append(t)',
  '        return Message(message_id=mid + 100, chat=msg.chat, from_user=SimpleNamespace(id=99, is_bot=True), text=t)',
  '    msg.reply_text = AsyncMock(side_effect=responder)',
  '    ev = MessageEvent(text=texto, raw_message=msg, message_id=str(mid),',
  '                      source=SimpleNamespace(platform=SimpleNamespace(value="telegram"), user_id="42", chat_id="-7"))',
  '    gw = SimpleNamespace(_is_user_authorized=lambda _: True)',
  '    ingresso._ingress(event=ev, gateway=gw)',
  '    await asyncio.gather(*list(ingresso._tasks))',
  '    await asyncio.sleep(0)',
  '    return ingresso._ingress(event=ev, gateway=gw)',
  'async def principal():',
  '    passos = json.loads(sys.argv[2])',
  '    for texto, mid, respondida, id_respondida, *autor in passos:',
  '        if respondida == "@ultima": respondida, id_respondida = enviadas[-1], mid - 10 + 100',
  '        status = await dono(texto, mid, respondida, id_respondida, *autor)',
  '        print(json.dumps({"texto": texto, "status": status, "bot": enviadas[-1] if enviadas else None}, ensure_ascii=False))',
  'asyncio.run(principal())', ''].join('\n');

function rodarHermes(p: ReturnType<typeof projetoTemporario>, passos: Array<[string, number, string | null, number] | [string, number, string, number, number]>) {
  const driver = path.join(p.dir, 'driver-hermes-reply.py');
  fs.writeFileSync(driver, DRIVER_DO_HERMES);
  const r = spawnSync('python3', [driver, PLUGIN_HERMES, JSON.stringify(passos)], { cwd: p.dir, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ORK_HITL_ROOT: p.dir, ORK_BIN: orkReal(p.dir), ORK_HITL_TELEGRAM_BOT_ID: '99' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as { texto: string; status: { effect: string; confirmation: string };
    bot: string | null });
}

test('GW8: ponta a ponta, "sim" em reply à mensagem da pergunta, assinado pelo Hermes, autoriza o arco no ork real', { skip: semKernel || !temPython }, () => {
  const p = projetoTemporario('noctum-gw8');
  try {
    const a = arcoEntregue(p, 'arco-gw8');
    const [passo] = rodarHermes(p, [['sim', 8, a.texto, Number(a.id)]]);
    assert.deepEqual([passo.status.effect, passo.status.confirmation], ['confirmed', 'sent'], JSON.stringify(passo));
    const estado = lerArco(p.dir, 'arco-gw8')!;
    assert.equal(estado.envelopeSha256, a.sha);
    const quem = estado.autorizadoPor as unknown as { origem: string; canal: string; pergunta: { codigo: string; enderecoAssinado: unknown } };
    assert.deepEqual([quem.origem, quem.canal, quem.pergunta.codigo], ['telegram', 'hermes', a.codigo]);
    assert.deepEqual(quem.pergunta.enderecoAssinado, { alvo: 'pulse', endereco: `resposta:${a.codigo}:${a.id}` });
  } finally { p.limpar(); }
});

test('GW9: ponta a ponta, "a" em reply à mensagem da pergunta, assinado pelo OpenClaw, autoriza o arco no ork real, com a conta', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-gw9');
  try {
    const a = arcoEntregue(p, 'arco-gw9');
    const r = rodarOpenClaw(p, 'a', a.texto, a.id);
    assert.equal(r.handled, true);
    assert.match(r.reply?.text ?? '', /está autorizado/);
    const estado = lerArco(p.dir, 'arco-gw9')!;
    assert.equal(estado.envelopeSha256, a.sha);
    const quem = estado.autorizadoPor as unknown as { canal: string; conta: string; pergunta: { codigo: string } };
    assert.deepEqual([quem.canal, quem.conta, quem.pergunta.codigo], ['openclaw', 'conta-simulada', a.codigo]);
  } finally { p.limpar(); }
});

function rodarOpenClaw(p: ReturnType<typeof projetoTemporario>, texto: string, respondida: string, idRespondida: string):
  { handled: boolean; reply?: { text: string } } {
  const driver = path.join(p.dir, 'driver-openclaw-reply.mjs');
  fs.writeFileSync(driver, [
    `import { registerHitlIngress } from ${JSON.stringify(pathToFileURL(DIST_OPENCLAW).href)};`,
    'const [bin, texto, pergunta, id] = process.argv.slice(2);',
    'let handler;',
    'registerHitlIngress({ on(_nome, fn) { handler = fn; } }, bin);',
    "const event = { content: texto, channel: 'telegram', commandAuthorized: true, accountId: 'conta-simulada', senderId: '42',",
    "  conversationId: '-7', messageId: '9', timestamp: Date.now(), replyToBody: pergunta, replyToId: id };",
    "const ctx = { channelId: 'telegram', accountId: 'conta-simulada', senderId: '42', conversationId: '-7', messageId: '9' };",
    'console.log(JSON.stringify(await handler(event, ctx)));', ''].join('\n'));
  const env: NodeJS.ProcessEnv = { ...process.env, ORK_HITL_ROOT: p.dir, ORK_HITL_TELEGRAM_BOT_ID: '99', ORK_HITL_OPENCLAW_ACCOUNT: 'conta-simulada',
    ORK_HITL_INGRESS_KEY_OPENCLAW: CHAVE_OPENCLAW };
  delete env.FORCE_COLOR;
  const r = spawnSync(process.execPath, [driver, orkReal(p.dir), texto, respondida, idRespondida], { cwd: p.dir, encoding: 'utf8', timeout: 90_000, env });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { handled: boolean; reply?: { text: string } };
}

test('GW10: ponta a ponta pelo Hermes, "b" em reply à pergunta e depois "ok" em reply à confirmação do bot: nada é autorizado', { skip: semKernel || !temPython }, () => {
  // S4 do CHECK, invertido: com o plugin real do Hermes e o ork real, o "ok" à confirmação do "b) Adiar" autorizava o arco.
  const p = projetoTemporario('noctum-gw10');
  try {
    const a = arcoEntregue(p, 'arco-gw10');
    const [b, ok] = rodarHermes(p, [['b', 11, a.texto, Number(a.id)], ['ok', 21, '@ultima', 0]]);
    assert.match(b.bot ?? '', new RegExp(`${a.codigo} → b\\) Adiar: nada muda`), JSON.stringify(b));
    // A confirmação não tem o título da pergunta: o "ok" a ela vai sem referência, e ou segue ao assistente (janela fechada)
    // ou volta dizendo que a palavra solta não registra; nunca autoriza.
    assert.ok(ok.status === null || !/está autorizado/.test(ok.bot ?? ''), JSON.stringify(ok));
    assert.equal(lerArco(p.dir, 'arco-gw10')!.autorizadoPor, null);
    assert.equal(lerArco(p.dir, 'arco-gw10')!.situacao, 'proposto');
  } finally { p.limpar(); }
});

test('GW11: ponta a ponta pelo OpenClaw, o título da pergunta copiado por outro membro (outra mensagem) não autoriza', { skip: semKernel }, () => {
  // S8 do CHECK, invertido: o OpenClaw não prova o autor da mensagem respondida; o id da entrega prova que ela é a pergunta.
  const p = projetoTemporario('noctum-gw11');
  try {
    const a = arcoEntregue(p, 'arco-gw11');
    const r = rodarOpenClaw(p, 'sim', a.texto, '77');
    assert.equal(r.handled, true);
    assert.match(r.reply?.text ?? '', new RegExp(`não é a da pergunta ${a.codigo} como o Orkastery a entregou`), JSON.stringify(r));
    assert.equal(lerArco(p.dir, 'arco-gw11')!.autorizadoPor, null);
  } finally { p.limpar(); }
});

// GO-FIX 2 (rodada 2 do CHECK, R1): a palavra solta em reply a uma mensagem que não é a pergunta nunca vira palavra solta.

test('GW12: ponta a ponta pelo Hermes, "ok" em reply à confirmação de um gate e "sim" em reply a outra pessoa não autorizam; sem reply, autoriza', { skip: semKernel || !temPython }, () => {
  // G1 e G1b do CHECK (rodada 2), invertidos: com a pergunta entregue e a janela aberta, o plugin real levava a palavra ao
  // núcleo como palavra solta, e o arco era autorizado.
  const p = projetoTemporario('noctum-gw12');
  try {
    const a = arcoEntregue(p, 'arco-gw12');
    const [ok, sim] = rodarHermes(p, [['ok', 31, '✅ DE6H → a) Aprovo: o gate da thread exemplo-SIMULADA está aprovado.', 40],
      ['sim', 32, 'Alguém revisa o PR de documentação hoje?', 41, 43]]);
    for (const passo of [ok, sim]) {
      assert.deepEqual([passo.status?.effect, passo.status?.confirmation], ['confirmed', 'sent'], JSON.stringify(passo));
      assert.match(passo.bot ?? '', /A mensagem que você respondeu não é a de uma pergunta do Orkastery/, JSON.stringify(passo));
      assert.ok((passo.bot ?? '').includes(a.codigo), 'a recusa diz o código da pergunta que espera');
    }
    assert.equal(lerArco(p.dir, 'arco-gw12')!.autorizadoPor, null);
    const [semReply] = rodarHermes(p, [['ok', 33, null, 0]]);
    assert.match(semReply.bot ?? '', /está autorizado/, JSON.stringify(semReply));
    assert.equal(lerArco(p.dir, 'arco-gw12')!.envelopeSha256, a.sha);
  } finally { p.limpar(); }
});

test('GW13: ponta a ponta pelo OpenClaw, "sim" em reply à mensagem de outra pessoa não autoriza, e o dono ouve por onde responder', { skip: semKernel }, () => {
  // G1c do CHECK (rodada 2), invertido.
  const p = projetoTemporario('noctum-gw13');
  try {
    const a = arcoEntregue(p, 'arco-gw13');
    const r = rodarOpenClaw(p, 'sim', 'Bom dia, pessoal', '77');
    assert.equal(r.handled, true);
    assert.match(r.reply?.text ?? '', /A mensagem que você respondeu não é a de uma pergunta do Orkastery/, JSON.stringify(r));
    assert.ok((r.reply?.text ?? '').includes(a.codigo));
    assert.equal(lerArco(p.dir, 'arco-gw13')!.autorizadoPor, null);
  } finally { p.limpar(); }
});
