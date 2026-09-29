/**
 * RM-048 (item 8, D8): a nota do MASTER dada por ferramenta de host passa pela mesma prova de
 * canal que o gate ja exige.
 *
 * Prova, pelo ledger: nota em nome de pessoa vinda de processo de host e recusada com motivo
 * tipado e nao escreve nada; a nota que chega pelo ingresso autenticado vai ao `master_done` com o
 * remetente autenticado, o canal, o recibo e a evidencia; a ratificacao do teclado do digest idem;
 * e a `ork_master` do OpenClaw nao recebe mais nome de pessoa. Chaves e identidades SIMULADAS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { ambienteDoIngresso, dizer } from './apoio-pulse';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPorOmissao, masterRatificado, proporMaster } from '../src/master';
import { listarBatch } from '../src/master-batch';
import { ERRO_PROVA_DE_CANAL, exigirNotaSemHost, lerNota, pedirNota } from '../src/master-nota';
import { responderPeloPulse } from '../src/pulse-resposta';
import { prepararPedidoGate, registrarPedidoHitl } from '../src/hitl-gates';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { raizDoEstado } from '../src/estado-thread';
import { main } from '../src/index';

const QUANDO = '2026-09-28T23:00:00.000Z';

function entregou(p: ReturnType<typeof projetoTemporario>, nome: string) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', slug: 'x' });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, { fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true });
  return thread;
}

const masterDone = (dir: string, id: string) => lerLedger(dirThread(dir, id)).filter(e => e.tipo === TIPOS_DE_EVENTO.masterConcluido);

/** Roda `main` com o ambiente de um processo de host, e devolve o ambiente como estava. */
function comAmbiente<T>(env: Record<string, string | undefined>, f: () => T): T {
  const marcas = ['ORK_CANAL', 'CLAUDECODE', 'HERMES_HOME', 'ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'];
  const nomes = [...marcas, ...Object.keys(env)];
  const antes = Object.fromEntries(nomes.map(n => [n, process.env[n]]));
  for (const n of marcas) delete process.env[n];
  for (const [n, v] of Object.entries(env)) if (v === undefined) delete process.env[n]; else process.env[n] = v;
  try { return f(); } finally {
    for (const [n, v] of Object.entries(antes)) if (v === undefined) delete process.env[n]; else process.env[n] = v;
  }
}

test('o canal do processo decide a recusa, lido só do ambiente: argv não conta', () => {
  // B2 do CHECK: `ORK_CANAL=cli` herdado pela sessão despachada, ou declarado ao lado de uma marca de host, não absolve.
  for (const env of [{ CLAUDECODE: '1' }, { ORK_CANAL: 'openclaw' }, { ORK_CANAL: 'codex' }, { HERMES_HOME: '/home/simulado/.hermes' },
    { ORK_CANAL: 'cli', CLAUDECODE: '1' }, { ORK_CANAL: 'cli', ORK_DISPATCH_ID: '11111111-1111-4111-8111-111111111111' },
    { CODEX_SANDBOX: 'seatbelt' }, { CODEX_SANDBOX_NETWORK_DISABLED: '1' }]) {
    assert.throws(() => exigirNotaSemHost(env), new RegExp(ERRO_PROVA_DE_CANAL), JSON.stringify(env));
  }
  assert.doesNotThrow(() => exigirNotaSemHost({}));
  assert.doesNotThrow(() => exigirNotaSemHost({ ORK_CANAL: 'cli' }));
  assert.deepEqual(lerNota(' 4 entregou o que pedi'), { score: 4, justificativa: 'entregou o que pedi' });
  assert.deepEqual(lerNota('3/5 - faltou teste'), { score: 3, justificativa: 'faltou teste' });
  for (const ruim of ['', ' ótimo', ' 6 demais', ' 4', ' 4 ok']) assert.equal(lerNota(ruim), undefined, ruim);
});

test('ork master com --por, de processo de host, é recusado e não grava nada', () => {
  const p = projetoTemporario('master-prova-recusa');
  const cwd = process.cwd();
  try {
    const t = entregou(p, 'entrega de host');
    process.chdir(p.dir);
    for (const env of [{ CLAUDECODE: '1' }, { ORK_CANAL: 'openclaw' }]) {
      comAmbiente(env, () => {
        assert.throws(() => main(['master', t.id, '--score', '4', '--justificativa', 'pelo host', '--por', 'Dono Simulado', '--canal', 'cli']),
          new RegExp(ERRO_PROVA_DE_CANAL));
        assert.throws(() => main(['master', 'ratificar', '--resposta', `ratificar ${t.id} ${'b'.repeat(64)} processo`, '--por', 'Dono Simulado']),
          new RegExp(ERRO_PROVA_DE_CANAL));
        assert.throws(() => main(['master', 'digest', 'responder', '--resposta', 'ratificar-lote 2026-09-25 x', '--por', 'Dono Simulado']),
          new RegExp(ERRO_PROVA_DE_CANAL));
      });
    }
    assert.equal(masterDone(p.dir, t.id).length, 0);
    assert.equal(lerThread(p.dir, t.id).score ?? null, null);
    // Do terminal, fora de host, o caminho de sempre continua valendo.
    comAmbiente({}, () => {
      const log = console.log; console.log = () => {};
      try { assert.equal(main(['master', t.id, '--score', '4', '--justificativa', 'do terminal', '--por', 'Dono Simulado']), 0); }
      finally { console.log = log; }
    });
    assert.equal(masterDone(p.dir, t.id).length, 1);
  } finally { process.chdir(cwd); p.limpar(); }
});

test('a nota pelo ingresso vai ao ledger com o remetente autenticado, o canal e o recibo', () => {
  const p = projetoTemporario('master-prova-nota'), restaurar = ambienteDoIngresso();
  try {
    const t = entregou(p, 'entrega com nota');
    aceitarPorOmissao(p.dir, t.id);
    const pedido = pedirNota(p.dir, t.id, { quando: QUANDO });
    assert.equal(pedirNota(p.dir, t.id, { quando: QUANDO }).codigo, pedido.codigo, 'o mesmo pedido, o mesmo código');
    const monitor = path.join(raizDoEstado(p.dir), '.orkastery', 'monitor');
    const r = responderPeloPulse(p.dir, dizer(`${pedido.codigo} 4 entregou o que pedi`, 'telegram:-7:900', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.equal(r.tipo, 'nota', r.mensagem);
    assert.match(r.mensagem, new RegExp(`^🧾 Nota 4/5 registrada para ${t.id}, por telegram:42\\.`));
    const feito = masterDone(p.dir, t.id).at(-1)!;
    assert.equal(feito.por, 'telegram:42');
    assert.equal(feito.score, 4);
    assert.equal(feito.prova, 'ingresso-autenticado');
    assert.equal(feito.canal, 'hermes');
    assert.equal(feito.mensagem, 'telegram:-7:900');
    assert.match(String(feito.recibo), /^[a-f0-9]{64}$/);
    assert.equal((feito.notaPedida as { codigo: string }).codigo, pedido.codigo);
    // O envelope assinado fica guardado para a auditoria reconferir o HMAC do canal.
    const evidencia = JSON.parse(fs.readFileSync(path.join(raizDoEstado(p.dir), String(feito.evidencia)), 'utf8'));
    assert.equal(evidencia.envelope.prova.length, 64);
    const depois = lerThread(p.dir, t.id);
    assert.equal(depois.score!.avaliadoPor, 'telegram:42');
    assert.notEqual(depois.score!.regime, 'omissao', 'a nota do dono sobrescreve a omissão');
    assert.equal(masterRatificado(p.dir, t.id), true);
    // A mesma mensagem entregue de novo pelo gateway não vira segunda nota.
    const de = responderPeloPulse(p.dir, dizer(`${pedido.codigo} 4 entregou o que pedi`, 'telegram:-7:900', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.equal(de.repetida, true);
    assert.equal(masterDone(p.dir, t.id).length, 2, 'omissão e nota, nada mais');
    // Nota humana dada não muda por outra mensagem.
    const outra = responderPeloPulse(p.dir, dizer(`${pedido.codigo} 1 mudei de ideia`, 'telegram:-7:901', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.match(outra.mensagem, /já tem nota humana 4\/5/);
  } finally { restaurar(); p.limpar(); }
});

test('nota sem forma volta como pergunta, e envelope sem prova não é lido', () => {
  const p = projetoTemporario('master-prova-forma'), restaurar = ambienteDoIngresso();
  try {
    const t = entregou(p, 'entrega sem forma');
    const pedido = pedirNota(p.dir, t.id, { quando: QUANDO });
    const monitor = path.join(raizDoEstado(p.dir), '.orkastery', 'monitor');
    const sem = responderPeloPulse(p.dir, dizer(`${pedido.codigo} ótimo trabalho`, 'telegram:-7:910', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.match(sem.mensagem, new RegExp(`responda ${pedido.codigo} <0 a 5> <porquê>`));
    const forjado = { ...dizer(`${pedido.codigo} 5 perfeito demais`, 'telegram:-7:911', QUANDO), prova: '0'.repeat(64) };
    assert.throws(() => responderPeloPulse(p.dir, forjado, { quando: QUANDO, estadoDir: monitor }), /proveniência válida|não autenticada/);
    assert.equal(masterDone(p.dir, t.id).length, 0);
  } finally { restaurar(); p.limpar(); }
});

test('a ratificação do teclado do digest passa pelo ingresso, com o recibo', () => {
  const p = projetoTemporario('master-prova-ratifica'), restaurar = ambienteDoIngresso();
  try {
    const t = entregou(p, 'entrega com proposta');
    proporMaster(p.dir, t.id, { score: 3, justificativa: 'proposta do agente simulado', por: 'agente-simulado' });
    const item = listarBatch(p.dir).find(i => i.thread === t.id)!;
    const monitor = path.join(raizDoEstado(p.dir), '.orkastery', 'monitor');
    const r = responderPeloPulse(p.dir, dizer(`ratificar ${t.id} ${item.assinatura} processo`, 'telegram:-7:920', QUANDO),
      { quando: QUANDO, estadoDir: monitor });
    assert.match(r.mensagem, new RegExp(`Ratificado por telegram:42: ${t.id} 3/5\\.`), r.mensagem);
    const feito = masterDone(p.dir, t.id).at(-1)!;
    assert.equal(feito.por, 'telegram:42');
    assert.equal(feito.prova, 'ingresso-autenticado');
    assert.equal(feito.canal, 'hermes');
  } finally { restaurar(); p.limpar(); }
});

test('A1 do CHECK: código de nota que também é de gate aberto não vira veredito nem nota', () => {
  const p = projetoTemporario('master-prova-colisao'), restaurar = ambienteDoIngresso();
  try {
    const t = entregou(p, 'entrega com colisao');
    const pedido = pedirNota(p.dir, t.id, { quando: QUANDO });
    // Um gate aberto de outra thread com o MESMO código, forçado.
    const { thread: g } = novaThread(p.carregado, { nome: 'gate classic', modo: 'classic' });
    registrar(dirThread(p.dir, g.id), g.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const preparado = prepararPedidoGate(p.dir, g.id, 'human.pending', QUANDO);
    assert.ok('novo' in preparado);
    registrarPedidoHitl(p.dir, { ...preparado.novo, codigo: pedido.codigo });
    const monitor = path.join(raizDoEstado(p.dir), '.orkastery', 'monitor');
    const r = responderPeloPulse(p.dir, dizer(`${pedido.codigo} 2 faltou teste`, 'telegram:-7:930', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.match(r.mensagem, /é de uma nota e de uma pergunta ao mesmo tempo; nada foi registrado/);
    assert.equal(masterDone(p.dir, t.id).length, 0);
    assert.equal(lerLedger(dirThread(p.dir, g.id)).some(e => e.tipo === 'human_gate'), false);
  } finally { restaurar(); p.limpar(); }
});

test('a ork_master do OpenClaw pede a nota e não recebe nome de pessoa', () => {
  const fonte = fs.readFileSync(path.resolve(__dirname, '../../../adapters/openclaw/src/index.ts'), 'utf8');
  const bloco = fonte.slice(fonte.indexOf("name: 'ork_master',"), fonte.indexOf("name: 'ork_board',"));
  assert.match(bloco, /argv: \(p\) => \['master', 'pedir', texto\(p, 'thread'\), '--formato', 'telegram'\]/);
  assert.equal(/quem|--por|score/.test(bloco.replace(/description:[\s\S]*?parameters/, 'parameters')), false);
});
