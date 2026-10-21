/**
 * RM-057 (resposta curta, ork-rm057respost): a pergunta do arco #Noctum pela porta do CLI.
 *
 * O `ork noctum propor` grava a proposta e pergunta ao dono, com código curto e as três alternativas, e entrega a pergunta
 * no canal dele quando há transporte; o `ork noctum revogar` só abre a pergunta de revogação. Nenhum dos dois autoriza ou
 * revoga: quem decide é a resposta do dono, aqui pelo reply assinado que o `ork pulse responder` recebe, ponta a ponta.
 * Nada do que se ensina ao dono traz o hash ou uma linha para copiar.
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
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { CONTRATO_ENVELOPE } from '../src/noctum-envelope';
import { lerArco } from '../src/noctum-arco';
import { aceitarModoNoctum } from '../src/noctum-modo';
import { ALVO_DO_PULSE, CODIGO_CURTO, enderecoDoPulse } from '../src/pulse-consentimento';
import { lerLoteServido } from '../src/pulse-resposta';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const HASH = /\b[a-f0-9]{64}\b/;

/** O pedido de abertura com a janela em volta de agora: o CLI usa o relógio real. */
const pedido = (arco: string): Record<string, unknown> => ({
  contrato: CONTRATO_ENVELOPE, arco,
  janela: { inicio: new Date(Date.now() - 3600_000).toISOString(), fim: new Date(Date.now() + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' },
  destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: ['push', 'pr'] }],
  orcamento: { arco: { valor: 40, unidade: 'sessoes' }, porConta: [{ conta: 'perfil-a', teto: { valor: 20, unidade: 'sessoes' } }],
    porRuntime: [{ runtime: 'claude-bg', teto: { valor: 30, unidade: 'sessoes' } }] },
  relatorio: { horario: '07:30', canal: 'telegram' },
});

let n = 0;
/** O que o ingresso do Hermes assina quando o dono responde `texto` em reply à mensagem da pergunta `referencia`. */
function emReply(texto: string, referencia: string): RespostaHumana {
  n += 1;
  const r = { resposta: texto, canal: 'hermes' as const, origem: 'telegram' as const, por: 'telegram:42',
    mensagem: `telegram:-7:pq-${process.pid}-${n}`, recebidoEm: new Date().toISOString() };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_PULSE, enderecoDoPulse(referencia), r, CHAVE_SIMULADA) };
}

function cenario(nome: string) {
  const p = projetoTemporario(`pq-${nome}`), restaurar = ambienteDoIngresso();
  const monitor = path.join(p.dir, '.orkastery', 'monitor');
  const cli = (args: string[], entrada?: string) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: p.dir, encoding: 'utf8', input: entrada, env: process.env, timeout: 60_000 });
  /** O transporte SIMULADO do canal: grava cada mensagem num arquivo e sai 0, como o do Hermes depois do recibo. */
  const canal = (): (() => string[]) => {
    const saida = path.join(p.dir, 'canal-simulado.jsonl'), script = path.join(p.dir, 'canal-simulado.cjs');
    fs.writeFileSync(script, `require('fs').appendFileSync(${JSON.stringify(saida)}, JSON.stringify({ mensagem: process.argv[2] }) + '\\n');\n`);
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ host: 'hermes', destino: 'telegram:-7', executavel: process.execPath,
      argumentos: [script, '{{mensagem}}'] }), { mode: 0o600 });
    return () => fs.existsSync(saida) ? fs.readFileSync(saida, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).mensagem) : [];
  };
  /** O pedido do arco, gravado uma vez: propor de novo com o mesmo arquivo é a mesma proposta. */
  const envelope = (arco: string) => {
    const arquivo = path.join(p.dir, `${arco}.json`);
    if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, JSON.stringify(pedido(arco)));
    return arquivo;
  };
  const responder = (e: RespostaHumana, referencia: string) => cli(['pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal',
    'hermes', '--por', e.por, '--mensagem', e.mensagem, '--em-resposta-a', referencia], JSON.stringify(e));
  return { p, monitor, cli, canal, envelope, responder, limpar: () => { restaurar(); p.limpar(); } };
}

/** Propõe pelo CLI com `--json` e devolve a resposta dele. */
function proporJson(c: ReturnType<typeof cenario>, arco: string) {
  const r = c.cli(['noctum', 'propor', '--arquivo', c.envelope(arco), '--json']);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { autorizado: boolean; envelopeSha256: string; codigo: string; comoAutorizar: string[];
    pergunta: { codigo: string; prazo: string; texto: string; entrega: { entregue: boolean; jaServida: boolean; numero: number | null } } | null };
}

test('PQ1: propor sem transporte mostra a pergunta com código e alternativas, sem hash na resposta, e não autoriza nada', () => {
  const c = cenario('pq1');
  try {
    const r = c.cli(['noctum', 'propor', '--arquivo', c.envelope('arco-pq1')]);
    assert.equal(r.status, 0, r.stderr);
    const proposta = lerArco(c.p.dir, 'arco-pq1')!;
    assert.equal(proposta.situacao, 'proposto');
    const codigo = proposta.propostaPendente!.codigo!;
    assert.match(codigo, CODIGO_CURTO);
    const [, depois] = r.stdout.split('Nada foi autorizado: o dono autoriza respondendo à pergunta, nunca por silêncio nem por este comando.');
    assert.ok(depois, r.stdout);
    assert.ok(depois.includes(`arco arco-pq1 · ${codigo}`), depois);
    assert.ok(depois.includes('Autorizar o arco arco-pq1 (proposta 1)?'), depois);
    for (const alternativa of ['a) Autorizo', 'b) Adiar', 'c) Mudar algo']) assert.ok(depois.includes(alternativa), alternativa);
    assert.match(depois, /a, b ou c/);
    assert.doesNotMatch(depois, HASH, 'o hash fica no resumo e na pergunta guardada, nunca na resposta ensinada');
    assert.doesNotMatch(r.stdout, /\/ork noctum/);
    assert.match(depois, /A pergunta não saiu no canal do dono: sem transporte/);
  } finally { c.limpar(); }
});

test('PQ2: com o transporte, a pergunta sai uma vez, numerada e registrada; o --json traz a pergunta e o como, sem hash', () => {
  const c = cenario('pq2');
  try {
    const mensagens = c.canal();
    const j = proporJson(c, 'arco-pq2');
    assert.equal(j.autorizado, false);
    assert.ok(j.pergunta, 'a proposta nova é uma pergunta');
    assert.equal(j.pergunta.codigo, j.codigo);
    assert.deepEqual([j.pergunta.entrega.entregue, j.pergunta.entrega.numero], [true, 1]);
    assert.equal(mensagens().length, 1);
    assert.ok(mensagens()[0].startsWith(`🔔 1. arco arco-pq2 · ${j.codigo}`), mensagens()[0]);
    assert.match(mensagens()[0], /Responda a, b ou c\. Detalhes: [A-Z0-9]{4} detalhes\./);
    assert.doesNotMatch(mensagens()[0], HASH);
    assert.ok(j.comoAutorizar.some(l => l.includes(`${j.codigo} a`)), j.comoAutorizar.join('\n'));
    for (const l of [...j.comoAutorizar, j.pergunta.texto]) {
      assert.doesNotMatch(l, HASH, l);
      assert.doesNotMatch(l, /\/ork noctum/, l);
    }
    const servida = lerLoteServido(c.p.dir, c.monitor).perguntas.filter(q => q.arco !== undefined);
    assert.deepEqual(servida.map(q => [q.numero, q.arco?.codigo]), [[1, j.codigo]]);
    const de_novo = proporJson(c, 'arco-pq2');
    assert.deepEqual([de_novo.codigo, de_novo.pergunta?.entrega.jaServida, de_novo.pergunta?.entrega.numero], [j.codigo, true, 1]);
    assert.equal(mensagens().length, 1, 'a mesma pergunta em aberto não sai de novo');
  } finally { c.limpar(); }
});

test('PQ3: ponta a ponta, o "sim" em reply à pergunta autoriza o arco; a mesma mensagem de novo não autoriza outra vez', () => {
  const c = cenario('pq3');
  try {
    const mensagens = c.canal();
    const j = proporJson(c, 'arco-pq3');
    const e = emReply('sim', j.codigo);
    const r = c.responder(e, j.codigo);
    assert.equal(r.status, 0, r.stderr);
    const recibo = JSON.parse(r.stdout) as { ok: boolean; mensagem: string; repetida: boolean };
    assert.equal(recibo.ok, true, r.stdout);
    assert.match(recibo.mensagem, new RegExp(`${j.codigo}.*Autorizo`));
    const arco = lerArco(c.p.dir, 'arco-pq3')!;
    assert.deepEqual([arco.situacao === 'vigente' || arco.situacao === 'agendado', arco.envelopeSha256], [true, j.envelopeSha256]);
    const repetida = c.responder(e, j.codigo);
    assert.equal(repetida.status, 0, repetida.stderr);
    assert.equal(JSON.parse(repetida.stdout).repetida, true, repetida.stdout);
    const log = fs.readFileSync(path.join(c.p.dir, '.orkastery', 'noctum', 'arcos', 'arco-pq3', 'arco.jsonl'), 'utf8');
    assert.equal(log.split('\n').filter(l => l.includes('"tipo":"autorizado"')).length, 1, 'uma autorização só no log');
    const outra = proporJson(c, 'arco-pq3');
    assert.equal(outra.pergunta, null, 'o envelope que já vale não vira pergunta de novo');
    assert.match(outra.comoAutorizar.join('\n'), /já vale no arco arco-pq3/);
    assert.equal(mensagens().length, 1);
  } finally { c.limpar(); }
});

test('PQ4: ork noctum revogar só abre a pergunta e a entrega uma vez; o "a" em reply revoga', () => {
  const c = cenario('pq4');
  try {
    const mensagens = c.canal();
    const j = proporJson(c, 'arco-pq4');
    assert.equal(c.responder(emReply('a', j.codigo), j.codigo).status, 0);
    const r = c.cli(['noctum', 'revogar', 'arco-pq4', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const q = JSON.parse(r.stdout) as { revogado: boolean; comoRevogar: string[]; pergunta: { codigo: string; nova: boolean; texto: string;
      entrega: { entregue: boolean; numero: number | null } } };
    assert.deepEqual([q.revogado, q.pergunta.nova, q.pergunta.entrega.entregue], [false, true, true]);
    assert.notEqual(q.pergunta.codigo, j.codigo);
    assert.match(q.pergunta.texto, /Revogar o arco arco-pq4\?/);
    assert.ok(q.comoRevogar.some(l => l.includes(`${q.pergunta.codigo} a`)), q.comoRevogar.join('\n'));
    assert.ok(q.comoRevogar.every(l => !HASH.test(l) && !l.includes('/ork noctum')), q.comoRevogar.join('\n'));
    assert.equal(mensagens().length, 2);
    assert.match(mensagens()[1], new RegExp(`arco arco-pq4 · ${q.pergunta.codigo}`));
    assert.notEqual(lerArco(c.p.dir, 'arco-pq4')!.situacao, 'revogado', 'pedir a revogação não revoga');
    const de_novo = JSON.parse(c.cli(['noctum', 'revogar', 'arco-pq4', '--json']).stdout) as typeof q;
    assert.deepEqual([de_novo.pergunta.codigo, de_novo.pergunta.nova], [q.pergunta.codigo, false]);
    assert.equal(mensagens().length, 2, 'a pergunta em aberto não sai de novo');
    const texto = c.cli(['noctum', 'revogar', 'arco-pq4']);
    assert.match(texto.stdout, /Nada foi revogado: o dono revoga respondendo à pergunta\./);
    assert.doesNotMatch(texto.stdout, HASH);
    const resposta = c.responder(emReply('a', q.pergunta.codigo), q.pergunta.codigo);
    assert.equal(resposta.status, 0, resposta.stderr);
    assert.equal(lerArco(c.p.dir, 'arco-pq4')!.situacao, 'revogado');
  } finally { c.limpar(); }
});

test('PQ5: ork noctum revogar recusa tipado o arco sem autorização, o revogado, o inexistente e o uso errado', () => {
  const c = cenario('pq5');
  try {
    const j = proporJson(c, 'arco-pq5');
    const proposto = c.cli(['noctum', 'revogar', 'arco-pq5']);
    assert.equal(proposto.status, 2);
    assert.match(proposto.stderr, /noctum\.efeito\.sem-autorizacao/);
    assert.match(c.cli(['noctum', 'revogar', 'arco-que-nao-existe']).stderr, /noctum\.efeito\.sem-autorizacao/);
    assert.equal(c.cli(['noctum', 'revogar']).status, 2);
    assert.match(c.cli(['noctum', 'revogar', 'arco-pq5', 'sobra']).stderr, /uso: ork noctum .*revogar <arco> \[--json\]/);
    c.responder(emReply('a', j.codigo), j.codigo);
    const q = JSON.parse(c.cli(['noctum', 'revogar', 'arco-pq5', '--json']).stdout) as { pergunta: { codigo: string } };
    c.responder(emReply('a', q.pergunta.codigo), q.pergunta.codigo);
    assert.equal(lerArco(c.p.dir, 'arco-pq5')!.situacao, 'revogado');
    const revogado = c.cli(['noctum', 'revogar', 'arco-pq5']);
    assert.equal(revogado.status, 2);
    assert.match(revogado.stderr, /noctum\.efeito\.revogado/);
  } finally { c.limpar(); }
});

test('PQ6: sem arco vigente, a recusa do #Noctum ensina a resposta curta, nunca a linha com o hash', () => {
  const c = cenario('pq6');
  try {
    let mensagem = '';
    try { aceitarModoNoctum(c.p.dir); } catch (e) { mensagem = (e as Error).message; }
    assert.match(mensagem, /ork noctum propor/);
    assert.match(mensagem, /respondendo à pergunta dele com a letra/);
    assert.doesNotMatch(mensagem, /sha256|\/ork noctum/);
    const uso = c.cli(['noctum']);
    assert.equal(uso.status, 2);
    assert.match(uso.stderr, /revogar <arco> \[--json\]/);
    assert.match(uso.stderr, /terminal --hook-stdin/);
  } finally { c.limpar(); }
});
