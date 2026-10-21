/**
 * RM-057 (resposta curta, ork-rm057respost): o dono responde à pergunta do arco #Noctum pelo Telegram, com resposta curta.
 *
 * O caminho é o receptor do pulse (`ork pulse responder`), com a prova de sempre: o envelope assinado pelo ingresso do
 * Hermes, com a chave do canal, as listas e a janela de 60 s, no endereço do pulse (ou no do reply,
 * `resposta:<código>:<id da mensagem respondida>`). Provado aqui: "<código> a", o reply com "sim" e "a" à mensagem da
 * pergunta, a palavra solta com uma só pendente no chat, o número servido; e os negativos: sem pergunta, duas pendentes,
 * outro chat, depois do prazo, a mesma mensagem de novo, outra chave, a referência trocada, a proposta que mudou, b, c e
 * "não".
 *
 * GO-FIX 1 (CHECK da ork-rm057respost): o reply só vale para a mensagem em que a pergunta foi entregue (o id que o
 * transporte devolveu, no chat dela): o "ok" à confirmação do "b" (S4n e S13), o "1a" em reply à mensagem de outra
 * pergunta (S5), a mesma mensagem em outro arco (S6), a pergunta não entregue que conta para a ambiguidade (P3) e o código
 * em dois lugares (P5) viraram RC15 e RC17 a RC25. O reply à mensagem de um gate não registra nada: o lote não guarda o id.
 *
 * GO-FIX 2 (rodada 2 do CHECK, R1): a palavra solta em reply a uma mensagem que não é a pergunta (a confirmação de um gate,
 * a mensagem de outra pessoa do grupo) chega assinada em `resposta:outra` e nunca vira palavra solta: nada é gravado, e o
 * dono ouve por onde responder (RC26 a RC28). O código e o número dizem a pergunta e seguem valendo.
 *
 * Chaves, usuários, chats, transportes e mensagens SIMULADOS; nenhuma mensagem sai da máquina.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { ambienteDoIngresso, CHAVE_SIMULADA } from './apoio-pulse';
import { assinaturaDaResposta, abrirPedidoGate, EnderecoAssinado, prepararPedidoGate, registrarPedidoHitl, responderGate,
  RespostaHumana } from '../src/hitl-gates';
import { CONTRATO_ENVELOPE, PedidoDeEfeito } from '../src/noctum-envelope';
import { conferirAntesDoEfeito, lerArco, pedirRevogacao, perguntasDoArco, proporEnvelope } from '../src/noctum-arco';
import { entregarPerguntaDoArco } from '../src/noctum-pergunta-canal';
import { ALVO_DO_PULSE, enderecoDoPulse } from '../src/pulse-consentimento';
import { idsDaEntrega } from '../src/pulse-delivery';
import { lerLoteServido, responderPeloPulse } from '../src/pulse-resposta';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';

const P = '2026-10-13T00:30:00.000Z';
const A = '2026-10-13T00:31:00.000Z';
const DENTRO = '2026-10-13T02:00:00.000Z';
const VENCIDA = '2026-10-13T01:31:00.000Z';
const CLI = path.resolve(__dirname, '../../dist/index.js');

const pedido = (arco: string, tetoDoArco = 40): Record<string, unknown> => ({
  contrato: CONTRATO_ENVELOPE, arco,
  janela: { inicio: '2026-10-12T22:00:00-03:00', fim: '2026-10-13T06:00:00-03:00', fuso: 'America/Sao_Paulo' },
  destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: ['push', 'pr'] }],
  orcamento: { arco: { valor: tetoDoArco, unidade: 'sessoes' }, porConta: [{ conta: 'perfil-a', teto: { valor: 20, unidade: 'sessoes' } }],
    porRuntime: [{ runtime: 'claude-bg', teto: { valor: 30, unidade: 'sessoes' } }] },
  relatorio: { horario: '07:30', canal: 'telegram' },
});
const efeito = (arco: string, envelopeSha256: string): PedidoDeEfeito =>
  ({ arco, envelopeSha256, acao: 'push', repositorio: 'exemplo/produto', branch: 'ork/trabalho' });

let n = 0;
/** O que o ingresso do Hermes assina quando o dono digita `texto` no chat `chat`, em reply (`<código>:<id>`) ou não. */
function dizer(texto: string, o: { chat?: string; referencia?: string; recebidoEm?: string; chave?: string; mensagem?: string } = {}): RespostaHumana {
  n += 1;
  const r = { resposta: texto, canal: 'hermes' as const, origem: 'telegram' as const, por: 'telegram:42',
    mensagem: o.mensagem ?? `telegram:${o.chat ?? '-7'}:${1000 + n}`, recebidoEm: o.recebidoEm ?? A };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_PULSE, enderecoDoPulse(o.referencia), r, o.chave ?? CHAVE_SIMULADA) };
}

/**
 * O transporte SIMULADO do canal: grava cada mensagem num arquivo e responde como o do Hermes depois do recibo, com o id da
 * mensagem entregue (500, 501, ...). Sem id, como um transporte que não o diz.
 */
function canalSimulado(dir: string, monitor: string, destino = 'telegram:-7', comId = true): () => string[] {
  const saida = path.join(dir, 'canal-simulado.jsonl'), script = path.join(dir, 'canal-simulado.cjs');
  fs.writeFileSync(script, `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(saida)}, JSON.stringify({ mensagem: process.argv[2] }) + '\\n');\n` +
    (comId ? `const total = fs.readFileSync(${JSON.stringify(saida)}, 'utf8').split('\\n').filter(Boolean).length;\n` +
      "process.stdout.write(JSON.stringify({ success: true, message_id: 499 + total, platform: 'telegram' }));\n" : ''));
  fs.mkdirSync(monitor, { recursive: true });
  fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ host: 'hermes', destino, executavel: process.execPath,
    argumentos: [script, '{{mensagem}}'] }), { mode: 0o600 });
  return () => fs.existsSync(saida) ? fs.readFileSync(saida, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).mensagem) : [];
}

function cenario(nome: string, chats = '-7') {
  const p = projetoTemporario(`rc-${nome}`), restaurar = ambienteDoIngresso();
  process.env.ORK_HITL_TELEGRAM_CHATS = chats;
  const monitor = path.join(p.dir, '.orkastery', 'monitor');
  const responder = (e: RespostaHumana, quando = A, referencia?: string) =>
    responderPeloPulse(p.dir, e, { quando, estadoDir: monitor, ...(referencia ? { referencia } : {}) });
  /** Propõe o arco e, com canal, entrega a pergunta dele, como o `ork noctum propor` faz; `reply` é a referência da entrega. */
  const arco = (nomeDoArco: string, o: { entregar?: boolean; teto?: number; quando?: string } = {}) => {
    const r = proporEnvelope(p.dir, pedido(nomeDoArco, o.teto), o.quando ?? P);
    const q = perguntasDoArco(p.dir, nomeDoArco, A).find(x => x.codigo === r.codigo)!;
    const entrega = o.entregar === false ? null : entregarPerguntaDoArco(p.dir, q, { quando: A, estadoDir: monitor });
    return { ...r, codigo: r.codigo!, q, entrega, reply: `${r.codigo}:${entrega?.mensagens[0] ?? 'sem-id'}` };
  };
  /** O dono responde EM REPLY à mensagem `ref` (`<código>:<id>`), como o ingresso do Hermes assina e chama o núcleo. */
  const emReply = (texto: string, ref: string, o: { chat?: string; recebidoEm?: string; quando?: string } = {}) =>
    responder(dizer(texto, { referencia: ref, chat: o.chat, recebidoEm: o.recebidoEm ?? o.quando }), o.quando ?? A, ref);
  const limpar = () => { restaurar(); p.limpar(); };
  return { p, monitor, responder, emReply, arco, limpar };
}

test('RC1: "<código> a" autoriza o arco, e o recibo traz a pergunta e o endereço assinado', () => {
  const c = cenario('codigo');
  try {
    const mensagens = canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc1');
    assert.equal(a.entrega?.entregue, true, a.entrega?.detalhe);
    assert.deepEqual(a.entrega?.mensagens, ['500'], 'o id da mensagem entregue fica com a pergunta servida');
    assert.equal(mensagens().length, 1);
    assert.match(mensagens()[0], new RegExp(`^🔔 ${a.entrega!.numero}\\. arco arco-rc1 · ${a.codigo}`));
    assert.match(mensagens()[0], /↩️ Responda a, b ou c\./);
    const r = c.responder(dizer(`${a.codigo} a`));
    assert.match(r.mensagem, new RegExp(`^✅ ${a.codigo} → a\\) Autorizo: o arco arco-rc1 está autorizado`));
    assert.equal(r.repetida, false);
    const quem = lerArco(c.p.dir, 'arco-rc1', A)!.autorizadoPor as unknown as { pergunta: Record<string, unknown> };
    assert.deepEqual(quem.pergunta.enderecoAssinado, { alvo: 'pulse', endereco: 'resposta' });
    assert.equal(conferirAntesDoEfeito(c.p.dir, efeito('arco-rc1', a.envelopeSha256), DENTRO).envelopeSha256, a.envelopeSha256);
  } finally { c.limpar(); }
});

test('RC2: em reply à mensagem da pergunta, "sim" e "a" autorizam pela pergunta entregue naquela mensagem', () => {
  for (const texto of ['sim', 'a']) {
    const c = cenario(`reply-${texto}`);
    try {
      canalSimulado(c.p.dir, c.monitor);
      const a = c.arco('arco-rc2');
      const r = c.emReply(texto, a.reply);
      assert.match(r.mensagem, /está autorizado/, `${texto}: ${r.mensagem}`);
      const quem = lerArco(c.p.dir, 'arco-rc2', A)!.autorizadoPor as unknown as { pergunta: Record<string, unknown> };
      assert.deepEqual(quem.pergunta.enderecoAssinado, { alvo: 'pulse', endereco: `resposta:${a.reply}` });
    } finally { c.limpar(); }
  }
});

test('RC3: sem reply, "autorizo" vale com uma só pendente no chat em que a pergunta saiu', () => {
  const c = cenario('sozinha');
  try {
    canalSimulado(c.p.dir, c.monitor);
    c.arco('arco-rc3');
    const r = c.responder(dizer('autorizo'));
    assert.match(r.mensagem, /está autorizado/, r.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc3', A)!.situacao, 'agendado');
  } finally { c.limpar(); }
});

test('RC4: o número servido com a letra ("Na") autoriza, e a pergunta servida fica respondida', () => {
  const c = cenario('numero');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc4');
    const r = c.responder(dizer(`${a.entrega!.numero}a`));
    assert.match(r.mensagem, /está autorizado/, r.mensagem);
    assert.equal(lerLoteServido(c.p.dir, c.monitor).perguntas.find(q => q.arco?.codigo === a.codigo)?.respondida?.letra, 'a');
  } finally { c.limpar(); }
});

test('RC5: sem pergunta pendente, "sim" e um código que nada usa não registram nada', () => {
  const c = cenario('sem-pergunta');
  try {
    const r = c.responder(dizer('sim'));
    assert.match(r.mensagem, /Não há pergunta aberta/);
    const r2 = c.responder(dizer('ZZ9Z a'));
    assert.match(r2.mensagem, /Não reconheço o código ZZ9Z/);
    assert.equal(r2.registradas.length, 0);
  } finally { c.limpar(); }
});

test('RC6: duas pendentes e "sim" sem referência: o núcleo pergunta qual, com os rótulos, e nada é registrado', () => {
  const c = cenario('duas');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc6a'), b = c.arco('arco-rc6b');
    const r = c.responder(dizer('sim'));
    assert.match(r.mensagem, /Há 2 perguntas esperando você/);
    assert.ok(r.mensagem.includes(`${a.entrega!.numero} ou ${a.codigo}, com a letra (arco arco-rc6a: autorizar)`), r.mensagem);
    assert.ok(r.mensagem.includes(`${b.entrega!.numero} ou ${b.codigo}, com a letra (arco arco-rc6b: autorizar)`), r.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc6a', A)!.autorizadoPor, null);
    assert.equal(lerArco(c.p.dir, 'arco-rc6b', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC7: a palavra solta de outro chat não registra; o código digitado de outro chat autorizado vale', () => {
  const c = cenario('outro-chat', '-7,-8');
  try {
    canalSimulado(c.p.dir, c.monitor, 'telegram:-7');
    const a = c.arco('arco-rc7');
    const r = c.responder(dizer('sim', { chat: '-8' }));
    assert.match(r.mensagem, /saiu por outro chat/);
    assert.equal(lerArco(c.p.dir, 'arco-rc7', A)!.autorizadoPor, null);
    const r2 = c.responder(dizer(`${a.codigo} a`, { chat: '-8' }));
    assert.match(r2.mensagem, /está autorizado/);
    process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
    assert.throws(() => c.responder(dizer('sim', { chat: '-9' })), /proveniência válida/);
  } finally { c.limpar(); }
});

test('RC8: depois do prazo, a pergunta venceu: nada é autorizado e o dono ouve o porquê', () => {
  const c = cenario('prazo');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc8');
    const r = c.responder(dizer(`${a.codigo} a`, { recebidoEm: VENCIDA }), VENCIDA);
    assert.match(r.mensagem, new RegExp(`A pergunta ${a.codigo} venceu`));
    const solta = c.responder(dizer('sim', { recebidoEm: VENCIDA }), VENCIDA);
    assert.match(solta.mensagem, /Não há pergunta aberta/);
    assert.equal(lerArco(c.p.dir, 'arco-rc8', VENCIDA)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC9: a mesma mensagem de novo é repetida (sem segunda confirmação); outra mensagem depois diz que já valia', () => {
  const c = cenario('repetida');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc9');
    const e = dizer(`${a.codigo} a`);
    assert.equal(c.responder(e).repetida, false);
    assert.equal(c.responder(e).repetida, true, 'a mesma mensagem entregue de novo pelo gateway');
    const outra = c.responder(dizer(`${a.codigo} autorizo`));
    assert.equal(outra.repetida, false);
    assert.match(outra.mensagem, /já estava autorizado/);
    const linhas = fs.readFileSync(path.join(c.p.dir, '.orkastery', 'noctum', 'arcos', 'arco-rc9', 'arco.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(linhas.filter(l => l.includes('"tipo":"autorizado"')).length, 1);
  } finally { c.limpar(); }
});

test('RC10: outra chave e a referência trocada no argumento não passam da prova', () => {
  const c = cenario('prova');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc10');
    assert.throws(() => c.responder(dizer('sim', { referencia: a.reply, chave: 'chave-que-nao-e-a-do-canal-SIMULADA-000000' }), A, a.reply),
      /não autenticada/);
    const outro = a.codigo.startsWith('K') ? 'M7QX' : 'K7QX';
    assert.throws(() => c.responder(dizer('sim', { referencia: a.reply }), A, `${outro}:500`), /não autenticada/);
    assert.throws(() => c.responder(dizer('sim', { referencia: a.reply }), A, `${a.codigo}:501`), /não autenticada/, 'outro id');
    assert.throws(() => c.responder(dizer('sim', { referencia: a.reply }), A), /não autenticada/, 'sem a referência, o endereço é outro');
    assert.throws(() => c.responder(dizer('sim'), A, a.codigo), /<código>:<mensagem>/, 'a referência sem o id não tem forma');
    assert.equal(lerArco(c.p.dir, 'arco-rc10', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC11: a proposta que mudou recusa o código velho e diz o novo; o código digitado diferente do reply é recusado', () => {
  const c = cenario('mudou');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const v1 = c.arco('arco-rc11', { entregar: false });
    const v2 = c.arco('arco-rc11', { teto: 30, quando: A });
    const r = c.responder(dizer(`${v1.codigo} a`));
    assert.match(r.mensagem, new RegExp(`A pergunta de agora é ${v2.codigo}`));
    const divergente = c.emReply(`${v1.codigo} a`, v2.reply);
    assert.match(divergente.mensagem, /nada foi registrado/);
    assert.equal(lerArco(c.p.dir, 'arco-rc11', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC12: b e "adiar" não gravam nada, c pede o que mudar, e "não" volta com as alternativas', () => {
  const c = cenario('sem-efeito');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc12');
    assert.match(c.responder(dizer(`${a.codigo} b`)).mensagem, /b\) Adiar: nada muda/);
    assert.match(c.emReply('adiar', a.reply).mensagem, /b\) Adiar/);
    assert.match(c.responder(dizer(`${a.codigo} c`)).mensagem, /c\) Mudar algo: nada foi autorizado/);
    assert.match(c.emReply('não', a.reply).mensagem, /a \(Autorizo\), b \(Adiar\), c \(Mudar algo\)/);
    assert.match(c.emReply('d', a.reply).mensagem, /a \(Autorizo\), b \(Adiar\), c \(Mudar algo\)/, 'a letra fora das alternativas');
    assert.equal(lerArco(c.p.dir, 'arco-rc12', A)!.autorizadoPor, null);
    assert.match(c.emReply('a', a.reply).mensagem, /está autorizado/, 'adiar não fecha a pergunta: o reply à mensagem DELA vale');
  } finally { c.limpar(); }
});

test('RC13: a pergunta de revogação, entregue, revoga com "sim" em reply à mensagem dela', () => {
  const c = cenario('revogar');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc13');
    c.responder(dizer(`${a.codigo} a`));
    const rev = pedirRevogacao(c.p.dir, 'arco-rc13', A);
    const q = perguntasDoArco(c.p.dir, 'arco-rc13', A).find(x => x.codigo === rev.codigo)!;
    const entrega = entregarPerguntaDoArco(c.p.dir, q, { quando: A, estadoDir: c.monitor });
    assert.deepEqual([entrega.entregue, entrega.mensagens], [true, ['501']]);
    const r = c.emReply('sim', `${rev.codigo}:501`);
    assert.match(r.mensagem, /está revogado/, r.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc13', A)!.situacao, 'revogado');
  } finally { c.limpar(); }
});

test('RC14: "<código> detalhes" devolve o envelope inteiro com o hash, e a pergunta continua pendente', () => {
  const c = cenario('detalhes');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc14');
    const r = c.responder(dizer(`${a.codigo} detalhes`));
    assert.ok(r.mensagem.includes(`Hash do envelope: ${a.envelopeSha256}`), r.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc14', A)!.situacao, 'proposto');
  } finally { c.limpar(); }
});

test('RC15: o reply à mensagem de um gate não registra nada no gate, e a prova do gate não aceita o endereço do reply', () => {
  // GO-FIX 1 (achado 2): o lote dos gates sai como resposta do gateway, e o núcleo não grava o id dela; o reply só vale para
  // a mensagem em que a pergunta do arco foi entregue. O gate segue pelo número e pelo código ("DE6H a").
  const c = cenario('gate');
  try {
    const { thread: t } = novaThread(c.p.carregado, { nome: 'gate do reply', modo: 'classic' });
    registrar(dirThread(c.p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const g = abrirPedidoGate(c.p.dir, t.id, 'human.pending', A) as { codigo: string; id: string };
    const r = c.emReply('a', `${g.codigo}:77`);
    assert.match(r.mensagem, new RegExp(`não é a da pergunta ${g.codigo} como o Orkastery a entregou`), r.mensagem);
    assert.equal(lerLedger(dirThread(c.p.dir, t.id)).some(e => e.tipo === 'human_gate'), false);
    // G1b do CHECK: a prova do gate (RM-048) não aceita o envelope assinado no endereço do reply, nem com o alvo certo.
    const ref = `${g.codigo}:77`;
    const e = dizer('a', { referencia: ref });
    const assinado: EnderecoAssinado = { alvo: ALVO_DO_PULSE, endereco: enderecoDoPulse(ref), envelope: e, rastro: { codigo: g.codigo } };
    assert.throws(() => responderGate(c.p.dir, t.id, g.id, { ...e, resposta: 'a' }, A, assinado), /endereço assinado fora do pulse/);
    assert.equal(lerLedger(dirThread(c.p.dir, t.id)).some(e2 => e2.tipo === 'human_gate'), false);
    // O código digitado segue valendo para o gate.
    assert.match(c.responder(dizer(`${g.codigo} a`)).mensagem, new RegExp(`${g.codigo} → a\\)`));
  } finally { c.limpar(); }
});

test('RC16: o CLI recebe a referência pela flag (<código>:<id>) e recusa a referência fora da forma', () => {
  const c = cenario('cli');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const agora = new Date().toISOString();
    // O CLI usa o relógio real: a pergunta de agora vem de uma proposta de agora, com a janela em volta dele.
    const atual = proporEnvelope(c.p.dir, { ...pedido('arco-rc16'), janela: { inicio: new Date(Date.now() - 3600_000).toISOString(),
      fim: new Date(Date.now() + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' } }, agora);
    const q = perguntasDoArco(c.p.dir, 'arco-rc16', agora).find(x => x.codigo === atual.codigo)!;
    const entrega = entregarPerguntaDoArco(c.p.dir, q, { quando: agora, estadoDir: c.monitor });
    const ref = `${atual.codigo}:${entrega.mensagens[0]}`;
    const e = dizer('a', { referencia: ref, recebidoEm: agora });
    const argv = ['pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', 'hermes', '--por', e.por, '--mensagem', e.mensagem];
    for (const errada of ['nx4k:5', atual.codigo!, `${atual.codigo}:0`, `${atual.codigo}:abc`, `${atual.codigo}:5:6`]) {
      const r = spawnSync(process.execPath, [CLI, ...argv, '--em-resposta-a', errada], { cwd: c.p.dir, input: JSON.stringify(e), encoding: 'utf8',
        env: process.env });
      assert.notEqual(r.status, 0, errada);
      assert.match(r.stderr, /--em-resposta-a/, errada);
    }
    const certo = spawnSync(process.execPath, [CLI, ...argv, '--em-resposta-a', ref], { cwd: c.p.dir, input: JSON.stringify(e),
      encoding: 'utf8', env: process.env });
    assert.equal(certo.status, 0, certo.stderr);
    const recibo = JSON.parse(certo.stdout);
    assert.equal(recibo.contrato, 'ork.pulse-resposta/v1');
    assert.match(recibo.mensagem, /arco-rc16 está autorizado/);
  } finally { c.limpar(); }
});

// GO-FIX 1 (achado 2): o reply só vale para a mensagem da PERGUNTA; confirmação, recusa e conversa nunca são pergunta.

test('RC17: "ok" em reply à confirmação do "b) Adiar" não autoriza, e o dono ouve que aquela não é a mensagem da pergunta', () => {
  // S4n do CHECK, invertido: o "ok" em reply à confirmação (que tem o código) autorizava o arco.
  const c = cenario('confirmacao');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc17');
    const adiar = c.emReply('b', a.reply);
    assert.match(adiar.mensagem, /b\) Adiar: nada muda/);
    // A confirmação saiu como resposta do gateway, numa mensagem nova (id 900): o núcleo nunca a gravou como pergunta.
    const depois = '2026-10-13T00:40:00.000Z';
    const ok = c.emReply('ok', `${a.codigo}:900`, { quando: depois });
    assert.match(ok.mensagem, new RegExp(`não é a da pergunta ${a.codigo} como o Orkastery a entregou`), ok.mensagem);
    assert.equal(ok.registradas.length, 0);
    // E a palavra solta sem reply, depois do "b", não acha pergunta recente: só o código ou o reply à mensagem dela.
    const solta = c.responder(dizer('ok', { recebidoEm: depois }), depois);
    assert.equal(solta.registradas.length, 0, solta.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc17', depois)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC18: "ok" em reply à confirmação do "b) Manter o arco" não revoga', () => {
  // S13 do CHECK, invertido.
  const c = cenario('manter');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc18');
    c.responder(dizer(`${a.codigo} a`));
    const rev = pedirRevogacao(c.p.dir, 'arco-rc18', '2026-10-13T01:00:00.000Z');
    const q = perguntasDoArco(c.p.dir, 'arco-rc18', '2026-10-13T01:00:00.000Z').find(x => x.codigo === rev.codigo)!;
    const entrega = entregarPerguntaDoArco(c.p.dir, q, { quando: '2026-10-13T01:00:00.000Z', estadoDir: c.monitor });
    const manter = c.emReply('b', `${rev.codigo}:${entrega.mensagens[0]}`, { quando: '2026-10-13T01:01:00.000Z' });
    assert.match(manter.mensagem, /b\) Manter o arco/);
    const ok = c.emReply('ok', `${rev.codigo}:901`, { quando: '2026-10-13T01:05:00.000Z' });
    assert.equal(ok.registradas.length, 0, ok.mensagem);
    assert.notEqual(lerArco(c.p.dir, 'arco-rc18', '2026-10-13T01:05:00.000Z')!.situacao, 'revogado');
  } finally { c.limpar(); }
});

test('RC19: "1a" em reply à mensagem da pergunta 2 não responde à pergunta 1; "2a" em reply a ela responde à 2', () => {
  // S5 do CHECK, invertido: o arco da pergunta 1 era autorizado com o recibo dizendo o endereço da pergunta 2.
  const c = cenario('outra-pergunta');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const um = c.arco('arco-rc19a'), dois = c.arco('arco-rc19b');
    assert.deepEqual([um.entrega!.numero, dois.entrega!.numero], [1, 2]);
    for (const texto of ['1a', '1. a, 2. a', `${um.codigo} a`]) {
      const r = c.emReply(texto, dois.reply);
      assert.equal(r.registradas.length, 0, `${texto}: ${r.mensagem}`);
      assert.match(r.mensagem, /nada foi registrado/i, texto);
    }
    assert.equal(lerArco(c.p.dir, 'arco-rc19a', A)!.autorizadoPor, null);
    const certo = c.emReply('2a', dois.reply);
    assert.match(certo.mensagem, /arco-rc19b está autorizado/, certo.mensagem);
    const quem = lerArco(c.p.dir, 'arco-rc19b', A)!.autorizadoPor as unknown as { pergunta: { codigo: string; enderecoAssinado: { endereco: string } } };
    assert.deepEqual([quem.pergunta.codigo, quem.pergunta.enderecoAssinado.endereco], [dois.codigo, `resposta:${dois.reply}`]);
    assert.equal(lerArco(c.p.dir, 'arco-rc19a', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC20: a mesma mensagem assinada não autoriza o segundo arco dentro dos 60 s', () => {
  // S6 do CHECK, invertido.
  const c = cenario('uso-unico');
  try {
    canalSimulado(c.p.dir, c.monitor);
    c.arco('arco-rc20a');
    const sim = dizer('sim');
    assert.match(c.responder(sim).mensagem, /está autorizado/);
    c.arco('arco-rc20b', { quando: '2026-10-13T00:30:20.000Z' });
    const replay = c.responder(sim, '2026-10-13T00:31:30.000Z');
    assert.equal(replay.registradas.filter(x => x.estado === 'autorizado').length, 0, replay.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc20b', '2026-10-13T00:31:30.000Z')!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC21: a pergunta que não saiu pelo canal conta para a ambiguidade: a palavra solta pergunta qual', () => {
  // P3 do CHECK: sem a pendente não entregue na conta, a palavra solta caía na única entregue.
  const c = cenario('nao-entregue');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const entregue = c.arco('arco-rc21a'), fora = c.arco('arco-rc21b', { entregar: false });
    const r = c.responder(dizer('sim'));
    assert.match(r.mensagem, /Há 2 perguntas esperando você/, r.mensagem);
    assert.ok(r.mensagem.includes(fora.codigo) && r.mensagem.includes(entregue.codigo), r.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc21a', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC22: o código que é de uma pergunta do arco e de um gate ao mesmo tempo não registra nada em nenhum dos dois', () => {
  // P5 do CHECK: a colisão de código, forçada.
  const c = cenario('colisao');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc22');
    const { thread: g } = novaThread(c.p.carregado, { nome: 'gate com o codigo do arco', modo: 'classic' });
    registrar(dirThread(c.p.dir, g.id), g.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const preparado = prepararPedidoGate(c.p.dir, g.id, 'human.pending', A);
    assert.ok('novo' in preparado);
    registrarPedidoHitl(c.p.dir, { ...preparado.novo, codigo: a.codigo });
    const r = c.responder(dizer(`${a.codigo} a`));
    assert.match(r.mensagem, /está em mais de uma pergunta ao mesmo tempo; nada foi registrado/, r.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc22', A)!.autorizadoPor, null);
    assert.equal(lerLedger(dirThread(c.p.dir, g.id)).some(e => e.tipo === 'human_gate'), false);
  } finally { c.limpar(); }
});

test('RC23: o reply com o id certo vindo de outro chat autorizado não vale (o id é do chat em que a pergunta saiu)', () => {
  const c = cenario('reply-outro-chat', '-7,-8');
  try {
    canalSimulado(c.p.dir, c.monitor, 'telegram:-7');
    const a = c.arco('arco-rc23');
    const r = c.emReply('sim', a.reply, { chat: '-8' });
    assert.match(r.mensagem, /não é a da pergunta/, r.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc23', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC24: a palavra solta de antes de a pergunta sair não responde a ela', () => {
  const c = cenario('antes');
  try {
    canalSimulado(c.p.dir, c.monitor);
    c.arco('arco-rc24');
    const r = c.responder(dizer('sim', { recebidoEm: '2026-10-13T00:30:30.000Z' }));
    assert.match(r.mensagem, /é de antes de a pergunta 1 sair/, r.mensagem);
    assert.equal(lerArco(c.p.dir, 'arco-rc24', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC25: o transporte que não diz o id entrega a pergunta, mas o reply a ela não vale; o código vale', () => {
  const c = cenario('sem-id');
  try {
    canalSimulado(c.p.dir, c.monitor, 'telegram:-7', false);
    const a = c.arco('arco-rc25');
    assert.deepEqual([a.entrega?.entregue, a.entrega?.mensagens], [true, []]);
    assert.equal(c.emReply('sim', `${a.codigo}:500`).registradas.length, 0);
    assert.equal(lerArco(c.p.dir, 'arco-rc25', A)!.autorizadoPor, null);
    assert.match(c.responder(dizer(`${a.codigo} a`)).mensagem, /está autorizado/);
    // O id que os transportes imprimem: o do Hermes (message_id e message_ids) e o do OpenClaw (messageId, no --json).
    assert.deepEqual(idsDaEntrega('{"success": true, "message_id": 4521, "platform": "telegram"}'), ['4521']);
    assert.deepEqual(idsDaEntrega('{"success": true, "message_ids": [7, 8], "message_id": 7}'), ['7', '8']);
    assert.deepEqual(idsDaEntrega('{\n  "action": "send",\n  "messageId": "88",\n  "payload": {}\n}'), ['88']);
    assert.deepEqual(idsDaEntrega('ok\n{"message_id": 9}'), ['9']);
    assert.deepEqual(idsDaEntrega('{"message_id": -3, "messageId": "x1"}'), []);
    assert.deepEqual(idsDaEntrega('não é json'), []);
  } finally { c.limpar(); }
});

// GO-FIX 2 (rodada 2 do CHECK, R1): a palavra solta em reply a outra mensagem nunca vira palavra solta.

test('RC26: o "ok" e o "sim" em reply a outra mensagem (a confirmação de um gate, a de outra pessoa) não gravam nada, e o dono ouve por onde responder', () => {
  // G1 e G1b do CHECK, invertidos no núcleo: o gateway assina a palavra em reply a outra mensagem em resposta:outra.
  const c = cenario('outra-mensagem');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc26');
    for (const texto of ['ok', 'sim', 'a', 'autorizo']) {
      const r = c.emReply(texto, 'outra');
      assert.equal(r.registradas.length, 0, `${texto}: ${r.mensagem}`);
      assert.deepEqual(r.recusas, [{ motivo: 'reply.outra-mensagem' }], texto);
      assert.match(r.mensagem, /^⚠️ A mensagem que você respondeu não é a de uma pergunta do Orkastery.*nada foi registrado/, texto);
      assert.ok(r.mensagem.includes(`${a.entrega!.numero} ou ${a.codigo}, com a letra`), r.mensagem);
    }
    assert.equal(lerArco(c.p.dir, 'arco-rc26', A)!.autorizadoPor, null);
    // O reply está dentro da assinatura: sem a marca no argumento, ou com a marca que a assinatura não cobre, nada passa.
    assert.throws(() => c.responder(dizer('ok', { referencia: 'outra' }), A), /não autenticada/);
    assert.throws(() => c.responder(dizer('ok'), A, 'outra'), /não autenticada/);
    assert.equal(lerArco(c.p.dir, 'arco-rc26', A)!.autorizadoPor, null);
    // Controle (D3): sem reply, com uma só pergunta pendente no chat, a palavra solta vale.
    assert.match(c.responder(dizer('sim')).mensagem, /está autorizado/);
  } finally { c.limpar(); }
});

test('RC27: a palavra em reply à mensagem de um gate não registra o gate; o código dele segue valendo', () => {
  const c = cenario('outra-gate');
  try {
    // Sem pergunta nenhuma esperando, a recusa diz isso, e nada é gravado.
    const nada = c.emReply('ok', 'outra');
    assert.match(nada.mensagem, /Não há pergunta esperando você agora\.$/);
    assert.equal(nada.registradas.length, 0);
    const { thread: t } = novaThread(c.p.carregado, { nome: 'gate da palavra em reply', modo: 'classic' });
    registrar(dirThread(c.p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const g = abrirPedidoGate(c.p.dir, t.id, 'human.pending', A) as { codigo: string; id: string };
    const r = c.emReply('sim', 'outra');
    assert.deepEqual([r.registradas.length, r.recusas], [0, [{ motivo: 'reply.outra-mensagem' }]], r.mensagem);
    assert.ok(r.mensagem.includes(`${g.codigo} a (${t.id}`), r.mensagem);
    assert.equal(lerLedger(dirThread(c.p.dir, t.id)).some(e => e.tipo === 'human_gate'), false);
    assert.match(c.responder(dizer(`${g.codigo} a`)).mensagem, new RegExp(`${g.codigo} → a\\)`));
  } finally { c.limpar(); }
});

test('RC28: o CLI recebe a marca do reply a outra mensagem (--em-resposta-a outra) e só ela, além de <código>:<id>', () => {
  const c = cenario('cli-outra');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const agora = new Date().toISOString();
    const atual = proporEnvelope(c.p.dir, { ...pedido('arco-rc28'), janela: { inicio: new Date(Date.now() - 3600_000).toISOString(),
      fim: new Date(Date.now() + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' } }, agora);
    const q = perguntasDoArco(c.p.dir, 'arco-rc28', agora).find(x => x.codigo === atual.codigo)!;
    entregarPerguntaDoArco(c.p.dir, q, { quando: agora, estadoDir: c.monitor });
    const e = dizer('sim', { referencia: 'outra', recebidoEm: agora });
    const argv = ['pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', 'hermes', '--por', e.por, '--mensagem', e.mensagem];
    for (const errada of ['Outra', 'outra:5', 'outras']) {
      const r = spawnSync(process.execPath, [CLI, ...argv, '--em-resposta-a', errada], { cwd: c.p.dir, input: JSON.stringify(e), encoding: 'utf8',
        env: process.env });
      assert.notEqual(r.status, 0, errada);
      assert.match(r.stderr, /--em-resposta-a/, errada);
    }
    const certo = spawnSync(process.execPath, [CLI, ...argv, '--em-resposta-a', 'outra'], { cwd: c.p.dir, input: JSON.stringify(e),
      encoding: 'utf8', env: process.env });
    assert.equal(certo.status, 0, certo.stderr);
    const recibo = JSON.parse(certo.stdout);
    assert.deepEqual([recibo.contrato, recibo.registradas, recibo.recusas], ['ork.pulse-resposta/v1', [], [{ motivo: 'reply.outra-mensagem' }]]);
    assert.match(recibo.mensagem, new RegExp(`não é a de uma pergunta do Orkastery.*${atual.codigo}, com a letra`));
    assert.equal(lerArco(c.p.dir, 'arco-rc28')!.autorizadoPor, null);
  } finally { c.limpar(); }
});
