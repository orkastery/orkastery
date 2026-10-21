/**
 * RM-057 (resposta curta, ork-rm057respost): o dono responde à pergunta do arco #Noctum pelo Telegram, com resposta curta.
 *
 * O caminho é o receptor do pulse (`ork pulse responder`), com a prova de sempre: o envelope assinado pelo ingresso do
 * Hermes, com a chave do canal, as listas e a janela de 60 s, no endereço do pulse (ou no do reply, `resposta:<código>`).
 * Provado aqui: "<código> a", o reply com "sim" e "a", a palavra solta com uma só pendente no chat, o número servido;
 * e os negativos: sem pergunta, duas pendentes, outro chat, depois do prazo, a mesma mensagem de novo, outra chave, a
 * referência trocada, a proposta que mudou, b, c e "não". O reply também responde a um gate, pelo mesmo `responderGate`.
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
import { assinaturaDaResposta, abrirPedidoGate, RespostaHumana } from '../src/hitl-gates';
import { CONTRATO_ENVELOPE, PedidoDeEfeito } from '../src/noctum-envelope';
import { conferirAntesDoEfeito, lerArco, pedirRevogacao, perguntasDoArco, proporEnvelope } from '../src/noctum-arco';
import { entregarPerguntaDoArco } from '../src/noctum-pergunta-canal';
import { ALVO_DO_PULSE, enderecoDoPulse } from '../src/pulse-consentimento';
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
/** O que o ingresso do Hermes assina quando o dono digita `texto` no chat `chat`, em reply ou não. */
function dizer(texto: string, o: { chat?: string; referencia?: string; recebidoEm?: string; chave?: string; mensagem?: string } = {}): RespostaHumana {
  n += 1;
  const r = { resposta: texto, canal: 'hermes' as const, origem: 'telegram' as const, por: 'telegram:42',
    mensagem: o.mensagem ?? `telegram:${o.chat ?? '-7'}:rc-${n}`, recebidoEm: o.recebidoEm ?? A };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_PULSE, enderecoDoPulse(o.referencia), r, o.chave ?? CHAVE_SIMULADA) };
}

/** O transporte SIMULADO do canal: grava cada mensagem num arquivo e sai 0, como o do Hermes depois do recibo. */
function canalSimulado(dir: string, monitor: string, destino = 'telegram:-7'): () => string[] {
  const saida = path.join(dir, 'canal-simulado.jsonl'), script = path.join(dir, 'canal-simulado.cjs');
  fs.writeFileSync(script, `require('fs').appendFileSync(${JSON.stringify(saida)}, JSON.stringify({ mensagem: process.argv[2] }) + '\\n');\n`);
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
  /** Propõe o arco e, com canal, entrega a pergunta dele, como o `ork noctum propor` faz. */
  const arco = (nomeDoArco: string, o: { entregar?: boolean; teto?: number; quando?: string } = {}) => {
    const r = proporEnvelope(p.dir, pedido(nomeDoArco, o.teto), o.quando ?? P);
    const q = perguntasDoArco(p.dir, nomeDoArco, A).find(x => x.codigo === r.codigo)!;
    const entrega = o.entregar === false ? null : entregarPerguntaDoArco(p.dir, q, { quando: A, estadoDir: monitor });
    return { ...r, codigo: r.codigo!, q, entrega };
  };
  const limpar = () => { restaurar(); p.limpar(); };
  return { p, monitor, responder, arco, limpar };
}

test('RC1: "<código> a" autoriza o arco, e o recibo traz a pergunta e o endereço assinado', () => {
  const c = cenario('codigo');
  try {
    const mensagens = canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc1');
    assert.equal(a.entrega?.entregue, true, a.entrega?.detalhe);
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

test('RC2: em reply à mensagem da pergunta, "sim" e "a" autorizam pelo código da mensagem respondida', () => {
  for (const texto of ['sim', 'a']) {
    const c = cenario(`reply-${texto}`);
    try {
      canalSimulado(c.p.dir, c.monitor);
      const a = c.arco('arco-rc2');
      const r = c.responder(dizer(texto, { referencia: a.codigo }), A, a.codigo);
      assert.match(r.mensagem, /está autorizado/, `${texto}: ${r.mensagem}`);
      const quem = lerArco(c.p.dir, 'arco-rc2', A)!.autorizadoPor as unknown as { pergunta: Record<string, unknown> };
      assert.deepEqual(quem.pergunta.enderecoAssinado, { alvo: 'pulse', endereco: `resposta:${a.codigo}` });
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
    assert.throws(() => c.responder(dizer('sim', { referencia: a.codigo, chave: 'chave-que-nao-e-a-do-canal-SIMULADA-000000' }), A, a.codigo),
      /não autenticada/);
    const outro = a.codigo.startsWith('K') ? 'M7QX' : 'K7QX';
    assert.throws(() => c.responder(dizer('sim', { referencia: a.codigo }), A, outro), /não autenticada/);
    assert.throws(() => c.responder(dizer('sim', { referencia: a.codigo }), A), /não autenticada/, 'sem a referência, o endereço é outro');
    assert.equal(lerArco(c.p.dir, 'arco-rc10', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('RC11: a proposta que mudou recusa o código velho e diz o novo; o código digitado diferente do reply é recusado', () => {
  const c = cenario('mudou');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const v1 = c.arco('arco-rc11', { entregar: false });
    const v2 = proporEnvelope(c.p.dir, pedido('arco-rc11', 30), A);
    const r = c.responder(dizer(`${v1.codigo} a`));
    assert.match(r.mensagem, new RegExp(`A pergunta de agora é ${v2.codigo}`));
    const divergente = c.responder(dizer(`${v1.codigo} a`, { referencia: v2.codigo }), A, v2.codigo);
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
    assert.match(c.responder(dizer('adiar', { referencia: a.codigo }), A, a.codigo).mensagem, /b\) Adiar/);
    assert.match(c.responder(dizer(`${a.codigo} c`)).mensagem, /c\) Mudar algo: nada foi autorizado/);
    assert.match(c.responder(dizer('não', { referencia: a.codigo }), A, a.codigo).mensagem, /a \(Autorizo\), b \(Adiar\), c \(Mudar algo\)/);
    assert.equal(lerArco(c.p.dir, 'arco-rc12', A)!.autorizadoPor, null);
    assert.match(c.responder(dizer('a', { referencia: a.codigo }), A, a.codigo).mensagem, /está autorizado/, 'adiar não fecha a pergunta');
  } finally { c.limpar(); }
});

test('RC13: a pergunta de revogação, entregue, revoga com "sim" em reply', () => {
  const c = cenario('revogar');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc13');
    c.responder(dizer(`${a.codigo} a`));
    const rev = pedirRevogacao(c.p.dir, 'arco-rc13', A);
    const q = perguntasDoArco(c.p.dir, 'arco-rc13', A).find(x => x.codigo === rev.codigo)!;
    assert.equal(entregarPerguntaDoArco(c.p.dir, q, { quando: A, estadoDir: c.monitor }).entregue, true);
    const r = c.responder(dizer('sim', { referencia: rev.codigo }), A, rev.codigo);
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

test('RC15: "a" em reply à mensagem curta de um gate responde ao gate certo, com o endereço do reply no rastro', () => {
  const c = cenario('gate');
  try {
    const { thread: t } = novaThread(c.p.carregado, { nome: 'gate do reply', modo: 'classic' });
    registrar(dirThread(c.p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const pedidoDoGate = abrirPedidoGate(c.p.dir, t.id, 'human.pending', A) as { codigo: string };
    const r = c.responder(dizer('a', { referencia: pedidoDoGate.codigo }), A, pedidoDoGate.codigo);
    assert.match(r.mensagem, new RegExp(`${pedidoDoGate.codigo} → a\\)`), r.mensagem);
    const gate = lerLedger(dirThread(c.p.dir, t.id)).find(e => e.tipo === 'human_gate')!;
    assert.equal(gate.estado, 'aprovado');
    assert.equal((gate.enderecoAssinado as { endereco: string }).endereco, `resposta:${pedidoDoGate.codigo}`);
  } finally { c.limpar(); }
});

test('RC16: o CLI recebe a referência pela flag e recusa a referência fora da forma do código', () => {
  const c = cenario('cli');
  try {
    canalSimulado(c.p.dir, c.monitor);
    const a = c.arco('arco-rc16');
    const agora = new Date().toISOString();
    // O CLI usa o relógio real: a pergunta de agora vem de uma proposta de agora, com a janela em volta dele.
    const atual = proporEnvelope(c.p.dir, { ...pedido('arco-rc16b'), janela: { inicio: new Date(Date.now() - 3600_000).toISOString(),
      fim: new Date(Date.now() + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' } }, agora);
    const e = dizer('a', { referencia: atual.codigo, recebidoEm: agora });
    const argv = ['pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', 'hermes', '--por', e.por, '--mensagem', e.mensagem];
    const errado = spawnSync(process.execPath, [CLI, ...argv, '--em-resposta-a', 'nx4k'], { cwd: c.p.dir, input: JSON.stringify(e), encoding: 'utf8',
      env: process.env });
    assert.notEqual(errado.status, 0);
    assert.match(errado.stderr, /--em-resposta-a/);
    const certo = spawnSync(process.execPath, [CLI, ...argv, '--em-resposta-a', atual.codigo!], { cwd: c.p.dir, input: JSON.stringify(e),
      encoding: 'utf8', env: process.env });
    assert.equal(certo.status, 0, certo.stderr);
    const recibo = JSON.parse(certo.stdout);
    assert.equal(recibo.contrato, 'ork.pulse-resposta/v1');
    assert.match(recibo.mensagem, /arco-rc16b está autorizado/);
    void a;
  } finally { c.limpar(); }
});
