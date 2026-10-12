/**
 * RM-059 (fatia F8, T8.1): a nota do MASTER pelo dialogo nativo do host (`ork_request_master_note`).
 *
 * Prova, pelo estado do projeto: sem formulario no cliente, a recusa tipada nao escreve nada; recusa e cancelamento
 * nao gravam nota; a nota aceita vai ao `master_done` com `mcp-local:claude-code`, o pedido de nota e o recibo
 * assinado; o recibo e o que faz a nota valer (adulterado ou apagado, deixa de valer); o aceite por omissao e o
 * Telegram nao trocam a nota local, e o caminho inverso tambem vale; a identidade do ingresso local nao se digita no
 * `--por`. O cliente MCP e SINTETICO, em memoria, no papel do host; nenhuma resposta de dono real entra aqui.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { ambienteDoIngresso, dizer } from './apoio-pulse';
import { criarServidorMcp } from '../src/mcp-server';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPendentesPorOmissao, aceitarPorOmissao, lerMasterLog, masterRatificado, motivoForaDaOmissao, notaHumanaRegistrada,
  registrarMaster, validarMasterLog } from '../src/master';
import { criarIngressoDaNota, ERRO_SEM_DIALOGO, esquemaDaNota, lerRespostaDaNota } from '../src/master-nota-local';
import { arquivoDasNotas, pedirNota } from '../src/master-nota';
import { responderPeloPulse } from '../src/pulse-resposta';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { raizDoEstado } from '../src/estado-thread';

const QUANDO = '2026-09-28T23:00:00.000Z';
const PORQUE = 'entregou o painel e a nota com prova';

type Formulario = { mode?: string; message?: string; requestedSchema?: Record<string, unknown> };
type Resposta = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> };

function entregue(p: ProjetoDeTeste, nome: string, omissao = true) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', slug: 'x' });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, { fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true });
  if (omissao) aceitarPorOmissao(p.dir, thread.id);
  return thread;
}

const masterDone = (p: ProjetoDeTeste, id: string) => lerLedger(dirThread(p.dir, id)).filter(e => e.tipo === TIPOS_DE_EVENTO.masterConcluido);

/** Os bytes de tudo que a nota pode tocar: ledger, thread, MASTER log, POSTMORTEM e o registro dos pedidos de nota. */
function retrato(p: ProjetoDeTeste, id: string): Record<string, string | null> {
  const dir = dirThread(p.dir, id);
  const ler = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  return {
    ledger: ler(path.join(dir, 'ledger.jsonl')), thread: ler(path.join(dir, 'thread.json')),
    masterLog: ler(path.join(dir, 'master-log.json')), postmortem: ler(path.join(dir, 'POSTMORTEM.json')),
    notas: ler(arquivoDasNotas(p.dir)), recibos: fs.existsSync(path.join(dir, 'hitl-ingress-local')) ? fs.readdirSync(path.join(dir, 'hitl-ingress-local')).join(',') : null,
  };
}

async function comServidor<T>(p: ProjetoDeTeste, opcoes: { formulario: boolean; threadId?: string; responder?: (f: Formulario) => Resposta | Promise<Resposta> },
  corpo: (c: Client, formularios: Formulario[]) => Promise<T>): Promise<T> {
  const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code', ...(opcoes.threadId ? { threadId: opcoes.threadId } : {}) });
  const client = new Client({ name: 'cliente-sintetico-da-nota', version: '1' }, opcoes.formulario ? { capabilities: { elicitation: { form: {} } } } : {});
  const formularios: Formulario[] = [];
  if (opcoes.formulario) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      const f = req.params as Formulario;
      formularios.push(f);
      return (opcoes.responder ?? (() => ({ action: 'decline' as const })))(f);
    });
  }
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    return await corpo(client, formularios);
  } finally {
    await client.close();
    await server.close();
  }
}

async function pedirPeloDialogo(c: Client, args: Record<string, unknown>) {
  const r = await c.callTool({ name: 'ork_request_master_note', arguments: args });
  const texto = (r.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
  return { erro: r.isError === true, texto, dados: () => JSON.parse(texto) };
}

test('nota local: o formulário tem a nota de 0 a 5 como menu e o porquê como texto, os dois obrigatórios', () => {
  const e = esquemaDaNota();
  assert.deepEqual(e.required, ['nota', 'porque']);
  assert.deepEqual(e.properties.nota.oneOf.map(o => o.const), ['5', '4', '3', '2', '1', '0']);
  assert.equal(e.properties.porque.minLength, 3);
  assert.equal(e.properties.porque.maxLength, 1000);
  assert.deepEqual(lerRespostaDaNota({ nota: '4', porque: `  ${PORQUE}  ` }), { score: 4, justificativa: PORQUE });
  for (const ruim of [undefined, null, [], {}, { nota: '6', porque: PORQUE }, { nota: 4, porque: PORQUE }, { nota: '4', porque: 'ok' },
    { nota: '4', porque: '  ab  ' }, { nota: '4', porque: 'x'.repeat(1001) }, { nota: '4', porque: PORQUE, score: '5' }, { nota: '4' }]) {
    assert.throws(() => lerRespostaDaNota(ruim), /master\.nota\.resposta-invalida/, JSON.stringify(ruim));
  }
});

test('nota local: a ferramenta existe só no servidor do dono e o esquema recusa nota ou porquê nos argumentos, sem efeito', async () => {
  const p = projetoTemporario('nota-local-esquema');
  try {
    const t = entregue(p, 'esquema');
    const antes = retrato(p, t.id);
    await comServidor(p, { formulario: true, responder: () => ({ action: 'accept', content: { nota: '5', porque: PORQUE } }) }, async (c, formularios) => {
      const ferramenta = (await c.listTools()).tools.find(x => x.name === 'ork_request_master_note');
      assert.ok(ferramenta, 'o servidor do dono oferece a ferramenta');
      assert.deepEqual(Object.keys((ferramenta!.inputSchema as { properties: object }).properties).sort(), ['projeto', 'threadId']);
      assert.equal((ferramenta!.inputSchema as { additionalProperties?: boolean }).additionalProperties, false);
      for (const extra of [{ score: 5 }, { nota: '5' }, { porque: PORQUE }, { justificativa: PORQUE }, { resposta: '5 ok ok' }]) {
        const r = await pedirPeloDialogo(c, { threadId: t.id, ...extra });
        assert.equal(r.erro, true, JSON.stringify(extra));
      }
      assert.equal(formularios.length, 0, 'argumento a mais nunca abre o diálogo');
    });
    assert.deepEqual(retrato(p, t.id), antes);
    await comServidor(p, { formulario: true, threadId: t.id }, async (c) => {
      assert.ok(!(await c.listTools()).tools.some(x => x.name === 'ork_request_master_note'), 'o servidor da thread não oferece a ferramenta');
      assert.equal((await pedirPeloDialogo(c, { threadId: t.id })).erro, true);
    });
    assert.deepEqual(retrato(p, t.id), antes);
  } finally { p.limpar(); }
});

test('nota local: sem formulário no cliente, recusa master.nota.sem-dialogo e o estado fica byte a byte igual', async () => {
  const p = projetoTemporario('nota-local-sem-dialogo');
  try {
    for (const omissao of [true, false]) {
      const t = entregue(p, `sem dialogo ${omissao}`, omissao);
      const antes = retrato(p, t.id);
      await comServidor(p, { formulario: false }, async (c) => {
        const r = await pedirPeloDialogo(c, { threadId: t.id });
        assert.equal(r.erro, true);
        assert.match(r.texto, new RegExp(ERRO_SEM_DIALOGO));
        assert.match(r.texto, new RegExp(`ork master pedir ${t.id}`));
      });
      assert.deepEqual(retrato(p, t.id), antes, 'nem o pedido de nota nasce');
    }
  } finally { p.limpar(); }
});

test('nota local: diálogo recusado ou cancelado devolve pendente e não grava nota', async () => {
  const p = projetoTemporario('nota-local-recusa');
  try {
    const t = entregue(p, 'recusa');
    for (const action of ['decline', 'cancel'] as const) {
      await comServidor(p, { formulario: true, responder: () => ({ action }) }, async (c, formularios) => {
        const r = await pedirPeloDialogo(c, { threadId: t.id });
        assert.equal(r.erro, false, r.texto);
        assert.deepEqual(r.dados(), { ok: false, threadId: t.id, estado: 'pendente', repetida: false });
        assert.equal(formularios.length, 1);
        assert.equal(formularios[0].mode, 'form');
        assert.match(String(formularios[0].message), new RegExp(`Nota do MASTER da ${t.id}`));
        assert.match(String(formularios[0].message), /aceita por omissão com \d\/5/);
        assert.match(String(formularios[0].message), /Índice derivado do ledger: /);
      });
    }
    assert.equal(masterDone(p, t.id).length, 1, 'só o master_done da omissão');
    assert.equal(lerThread(p.dir, t.id).score!.regime, 'omissao');
    // O pedido de nota nasceu uma vez (o mesmo código nas duas tentativas): é o mesmo do ork master pedir.
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === TIPOS_DE_EVENTO.notaPedida).length, 1);
  } finally { p.limpar(); }
});

test('nota local: aceita, vai ao master_done com mcp-local:claude-code, o pedido de nota e o recibo; a omissão vira nota humana', async () => {
  const p = projetoTemporario('nota-local-aceita');
  try {
    const t = entregue(p, 'aceita');
    await comServidor(p, { formulario: true, responder: () => ({ action: 'accept', content: { nota: '4', porque: PORQUE } }) }, async (c) => {
      const r = await pedirPeloDialogo(c, { threadId: t.id });
      assert.equal(r.erro, false, r.texto);
      assert.deepEqual(r.dados(), { ok: true, threadId: t.id, estado: 'registrada', repetida: false, score: 4 });
    });
    const feito = masterDone(p, t.id).at(-1)!;
    assert.equal(feito.por, 'mcp-local:claude-code');
    assert.equal(feito.autorizadoPor, 'mcp-local:claude-code');
    assert.equal(feito.score, 4);
    assert.equal(feito.justificativa, PORQUE);
    assert.equal(feito.prova, 'ingresso-autenticado');
    assert.equal(feito.origem, 'mcp-local');
    assert.equal(feito.canal, 'claude-code');
    assert.equal(feito.contratoResposta, 'ork.hitl-local-master-note/v1');
    const pedida = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === TIPOS_DE_EVENTO.notaPedida)!;
    assert.equal((feito.notaPedida as { pedidoId: string }).pedidoId, pedida.pedidoId);
    assert.match(String(feito.evidencia), new RegExp(`^\\.orkastery/threads/${t.id}/hitl-ingress-local/[a-f0-9]{64}\\.json$`));
    const recibo = path.join(raizDoEstado(p.dir), String(feito.evidencia));
    assert.equal(fs.statSync(recibo).mode & 0o777, 0o600);
    const bruto = fs.readFileSync(recibo, 'utf8');
    assert.ok(!bruto.includes(PORQUE), 'o recibo guarda o hash do porquê, nunca o texto');
    assert.equal(JSON.parse(bruto).dados.contrato, 'ork.hitl-local-master-note/v1');
    const depois = lerThread(p.dir, t.id);
    assert.equal(depois.status, 'fechada');
    assert.equal(depois.score!.avaliadoPor, 'mcp-local:claude-code');
    assert.notEqual(depois.score!.regime, 'omissao');
    assert.equal(masterRatificado(p.dir, t.id), true);
    assert.equal(notaHumanaRegistrada(p.dir, depois), true);
    assert.ok(lerMasterLog(p.dir, t.id), 'o MASTER log da nota local é válido e ratificado');
    assert.deepEqual(validarMasterLog(JSON.parse(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'master-log.json'), 'utf8'))), []);
    assert.ok(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao), 'o aceite por omissão continua no ledger');
  } finally { p.limpar(); }
});

test('nota local: o recibo é o que faz a nota valer; adulterado, apagado ou com outra nota no ledger, ela deixa de valer', async () => {
  const p = projetoTemporario('nota-local-recibo');
  try {
    const t = entregue(p, 'recibo');
    await comServidor(p, { formulario: true, responder: () => ({ action: 'accept', content: { nota: '3', porque: PORQUE } }) }, async (c) => {
      assert.equal((await pedirPeloDialogo(c, { threadId: t.id })).erro, false);
    });
    const feito = masterDone(p, t.id).at(-1)!;
    const recibo = path.join(raizDoEstado(p.dir), String(feito.evidencia));
    const original = fs.readFileSync(recibo, 'utf8');
    assert.equal(masterRatificado(p.dir, t.id), true);
    const adulterado = JSON.parse(original);
    adulterado.dados.score = 5;
    fs.writeFileSync(recibo, JSON.stringify(adulterado) + '\n');
    assert.equal(masterRatificado(p.dir, t.id), false, 'recibo adulterado');
    assert.equal(notaHumanaRegistrada(p.dir, lerThread(p.dir, t.id)), false);
    fs.writeFileSync(recibo, original);
    assert.equal(masterRatificado(p.dir, t.id), true);
    fs.renameSync(recibo, `${recibo}.fora`);
    assert.equal(masterRatificado(p.dir, t.id), false, 'recibo apagado');
    fs.renameSync(`${recibo}.fora`, recibo);
    // O mesmo recibo não sustenta outra nota: thread e evento que dizem 5 com o recibo do 3 não valem.
    const resto = Object.fromEntries(Object.entries(feito).filter(([k]) => !['ts', 'thread', 'tipo', 'eventId'].includes(k)));
    const editada = lerThread(p.dir, t.id);
    editada.score = { ...editada.score!, valor: 5 };
    gravarThread(p.dir, editada);
    registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.masterConcluido, { ...resto, score: 5 });
    assert.equal(masterRatificado(p.dir, t.id), false, 'thread e evento com outra nota');
  } finally { p.limpar(); }
});

test('nota local: o aceite por omissão e o Telegram não trocam a nota do diálogo', async () => {
  const p = projetoTemporario('nota-local-sobrescrita'), restaurar = ambienteDoIngresso();
  try {
    const t = entregue(p, 'sobrescrita');
    await comServidor(p, { formulario: true, responder: () => ({ action: 'accept', content: { nota: '2', porque: PORQUE } }) }, async (c) => {
      assert.equal((await pedirPeloDialogo(c, { threadId: t.id })).erro, false);
    });
    const feito = masterDone(p, t.id).at(-1)!;
    assert.equal(motivoForaDaOmissao(p.dir, t.id)?.motivo, 'ja-fechada');
    assert.deepEqual(aceitarPendentesPorOmissao(p.dir, { thread: t.id }), []);
    assert.deepEqual(aceitarPendentesPorOmissao(p.dir), []);
    const codigo = (feito.notaPedida as { codigo: string }).codigo;
    const monitor = path.join(raizDoEstado(p.dir), '.orkastery', 'monitor');
    const r = responderPeloPulse(p.dir, dizer(`${codigo} 5 outra nota pelo telegram`, 'telegram:-7:901', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.equal(r.tipo, 'nota', r.mensagem);
    assert.match(r.mensagem, /já tem nota humana 2\/5/);
    const depois = lerThread(p.dir, t.id);
    assert.equal(depois.score!.valor, 2);
    assert.equal(depois.score!.avaliadoPor, 'mcp-local:claude-code');
    assert.equal(masterDone(p, t.id).at(-1)!.eventId, feito.eventId);
  } finally { restaurar(); p.limpar(); }
});

test('nota local: com nota humana pelo Telegram antes, a ferramenta devolve repetida sem abrir o diálogo', async () => {
  const p = projetoTemporario('nota-local-repetida'), restaurar = ambienteDoIngresso();
  try {
    const t = entregue(p, 'repetida');
    const monitor = path.join(raizDoEstado(p.dir), '.orkastery', 'monitor');
    // O pedido de nota do ork master pedir, respondido pelo Telegram.
    const pedido = pedirNota(p.dir, t.id, { quando: QUANDO });
    const r = responderPeloPulse(p.dir, dizer(`${pedido.codigo} 5 entregou tudo`, 'telegram:-7:902', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.match(r.mensagem, /Nota 5\/5 registrada/);
    const antes = retrato(p, t.id);
    await comServidor(p, { formulario: true, responder: () => ({ action: 'accept', content: { nota: '1', porque: PORQUE } }) }, async (c, formularios) => {
      const n = await pedirPeloDialogo(c, { threadId: t.id });
      assert.deepEqual(n.dados(), { ok: true, threadId: t.id, estado: 'registrada', repetida: true, score: 5 });
      assert.equal(formularios.length, 0);
    });
    assert.deepEqual(retrato(p, t.id), antes);
  } finally { restaurar(); p.limpar(); }
});

test('nota local: a identidade do ingresso local não se digita no --por, nem com uma prova inventada', () => {
  const p = projetoTemporario('nota-local-por');
  try {
    const t = entregue(p, 'por');
    const antes = retrato(p, t.id);
    for (const por of ['mcp-local:claude-code', 'mcp-local:codex']) {
      assert.throws(() => registrarMaster(p.dir, t.id, { score: 4, justificativa: 'x y z', por, refazer: true }), /ingresso local/);
      assert.throws(() => registrarMaster(p.dir, t.id, { score: 4, justificativa: 'x y z', por, refazer: true,
        prova: { origem: 'mcp-local', canal: por.slice(10), contratoResposta: 'ork.hitl-local-master-note/v1', conexao: 'c1', solicitacao: 'r1',
          recebidoEm: QUANDO, recibo: 'a'.repeat(64), evidencia: `.orkastery/threads/${t.id}/hitl-ingress-local/x.json`, evidenciaSha256: 'b'.repeat(64),
          notaPedida: { pedidoId: 'p1' } } }), /ingresso local/);
    }
    assert.deepEqual(retrato(p, t.id), antes);
  } finally { p.limpar(); }
});

test('nota local: sem entrega a recusa é do núcleo, sem diálogo; o mesmo diálogo não abre duas vezes na conexão', async () => {
  const p = projetoTemporario('nota-local-condicoes');
  try {
    const { thread: semEntrega } = novaThread(p.carregado, { nome: 'sem entrega', modo: 'auto' });
    await comServidor(p, { formulario: true }, async (c, formularios) => {
      const r = await pedirPeloDialogo(c, { threadId: semEntrega.id });
      assert.equal(r.erro, true);
      assert.match(r.texto, /MASTER/);
      assert.equal(formularios.length, 0);
    });
    const t = entregue(p, 'em curso');
    let soltar: (r: { action: 'decline' }) => void = () => undefined;
    const ingresso = criarIngressoDaNota(p.dir, { host: 'claude-code', connectionId: 'conexao-de-teste' },
      () => new Promise(resolve => { soltar = resolve; }), () => true);
    const primeira = ingresso.solicitar(t.id);
    await new Promise(r => setTimeout(r, 20));
    await assert.rejects(ingresso.solicitar(t.id), /master\.nota\.em-curso/);
    soltar({ action: 'decline' });
    assert.deepEqual(await primeira, { ok: false, threadId: t.id, estado: 'pendente', repetida: false });
    // A conexão fechada cancela o diálogo aberto e recusa os seguintes.
    const outra = criarIngressoDaNota(p.dir, { host: 'claude-code', connectionId: 'conexao-de-teste-2' }, () => new Promise(() => undefined), () => true);
    const aberta = outra.solicitar(t.id);
    await new Promise(r => setTimeout(r, 20));
    outra.fechar();
    assert.deepEqual(await aberta, { ok: false, threadId: t.id, estado: 'pendente', repetida: false });
    await assert.rejects(outra.solicitar(t.id), /master\.nota\.conexao-fechada/);
    assert.equal(lerThread(p.dir, t.id).score!.regime, 'omissao');
  } finally { p.limpar(); }
});
