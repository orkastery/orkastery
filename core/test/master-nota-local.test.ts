/**
 * RM-059 (fatia F8, T8.1): a nota do MASTER pelo dialogo nativo do host (`ork_request_master_note`).
 *
 * Prova, pelo estado do projeto: sem formulario no cliente, a recusa tipada nao escreve nada; recusa e cancelamento
 * nao gravam nota; a nota aceita vai ao `master_done` com `dono (dialogo nativo)` (D12), o host no canal, o pedido de
 * nota e o recibo assinado, e o MASTER log passa no validador congelado sem caso novo; o recibo confere a nota que o
 * dialogo gravou (adulterado, apagado, assinado por outra chave ou com outra nota, nao confere) e nunca decide se ela
 * vale; o aceite por omissao (sob a mesma trava, inclusive na corrida) e o Telegram nao trocam a nota local, e o
 * caminho inverso tambem vale; a identidade da nota nativa nao se digita no `--por`. O cliente MCP e SINTETICO, em
 * memoria, no papel do host; nenhuma resposta de dono real entra aqui.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';
import { ambienteDoIngresso, dizer } from './apoio-pulse';
import { criarServidorMcp } from '../src/mcp-server';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPendentesPorOmissao, aceitarPorOmissao, AUTOR_DA_NOTA_NATIVA, autoriaHumana, entregasParaOmissao, lerMasterLog,
  masterRatificado, motivoForaDaOmissao, notaHumanaRegistrada, registrarMaster, validarMasterLog } from '../src/master';
import { criarIngressoDaNota, ERRO_SEM_DIALOGO, esquemaDaNota, lerRespostaDaNota, RespostaDaNota } from '../src/master-nota-local';
import { conferirReciboLocalNota } from '../src/hitl-local-receipt';
import { comLockHitl } from '../src/hitl-gates';
import { arquivoDasNotas, pedirNota } from '../src/master-nota';
import { responderPeloPulse } from '../src/pulse-resposta';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { raizDoEstado } from '../src/estado-thread';

const QUANDO = '2026-09-28T23:00:00.000Z';
const PORQUE = 'entregou o painel e a nota com prova';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

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

/** O dialogo controlado pelo teste: abre e espera o teste soltar a resposta. */
function dialogoControlado(p: ProjetoDeTeste, conexao: string) {
  let soltar: (r: RespostaDaNota) => void = () => undefined;
  const ingresso = criarIngressoDaNota(p.dir, { host: 'claude-code', connectionId: conexao },
    () => new Promise<RespostaDaNota>((resolve) => { soltar = resolve; }), () => true);
  return { ingresso, soltar: (r: RespostaDaNota) => soltar(r) };
}

/**
 * Segura a trava de HITL da thread como outro processo seguraria (um aceite por omissao, um despacho): o flock fica no
 * descritor aberto aqui ate o prazo. O arquivo nasce pela propria trava do nucleo, privado e no contrato dela.
 */
function segurarTrava(p: ProjetoDeTeste, id: string, ms: number): Promise<void> {
  comLockHitl(p.dir, id, () => undefined);
  const fd = fs.openSync(path.join(dirThread(p.dir, id), '.hitl.lock'), fs.constants.O_RDWR);
  const r = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] });
  assert.equal(r.status, 0, 'a trava de teste foi tomada');
  return new Promise((resolve) => setTimeout(() => { fs.closeSync(fd); resolve(); }, ms));
}

/** O `master_done` sem os campos que o ledger carimba, para regravar uma variante dele. */
const semCarimbo = (e: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(e).filter(([k]) => !['ts', 'thread', 'tipo', 'eventId'].includes(k)));

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

test('nota local: aceita, vai ao master_done com dono (dialogo nativo), o pedido de nota e o recibo; a omissão vira nota humana', async () => {
  const p = projetoTemporario('nota-local-aceita');
  try {
    const t = entregue(p, 'aceita');
    await comServidor(p, { formulario: true, responder: () => ({ action: 'accept', content: { nota: '4', porque: PORQUE } }) }, async (c) => {
      const r = await pedirPeloDialogo(c, { threadId: t.id });
      assert.equal(r.erro, false, r.texto);
      assert.deepEqual(r.dados(), { ok: true, threadId: t.id, estado: 'registrada', repetida: false, score: 4 });
    });
    const feito = masterDone(p, t.id).at(-1)!;
    assert.equal(AUTOR_DA_NOTA_NATIVA, 'dono (dialogo nativo)');
    assert.equal(feito.por, AUTOR_DA_NOTA_NATIVA);
    assert.equal(feito.autorizadoPor, AUTOR_DA_NOTA_NATIVA);
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
    assert.equal(depois.score!.avaliadoPor, AUTOR_DA_NOTA_NATIVA);
    assert.notEqual(depois.score!.regime, 'omissao');
    assert.equal(masterRatificado(p.dir, t.id), true);
    assert.equal(notaHumanaRegistrada(depois), true);
    assert.equal(conferirReciboLocalNota(p.dir, t.id, feito), true, 'o recibo confere com o master_done');
    assert.ok(lerMasterLog(p.dir, t.id), 'o MASTER log da nota local é válido e ratificado');
    // D12: o validador do contrato congelado não ganhou caso novo; a identidade passa pela autoria humana de sempre.
    assert.equal(autoriaHumana(AUTOR_DA_NOTA_NATIVA), true);
    assert.deepEqual(validarMasterLog(JSON.parse(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'master-log.json'), 'utf8'))), []);
    assert.deepEqual(validarMasterLog({ ...lerMasterLog(p.dir, t.id), avaliadoPor: 'mcp-local:claude-code' }),
      ['avaliadoPor precisa de autoria humana explícita']);
    assert.ok(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao), 'o aceite por omissão continua no ledger');
  } finally { p.limpar(); }
});

test('nota local: o recibo confere a nota do diálogo; adulterado, apagado, forjado ou com outra nota não confere, e a nota continua valendo', async () => {
  const p = projetoTemporario('nota-local-recibo');
  try {
    const t = entregue(p, 'recibo');
    await comServidor(p, { formulario: true, responder: () => ({ action: 'accept', content: { nota: '3', porque: PORQUE } }) }, async (c) => {
      assert.equal((await pedirPeloDialogo(c, { threadId: t.id })).erro, false);
    });
    const feito = masterDone(p, t.id).at(-1)!;
    const recibo = path.join(raizDoEstado(p.dir), String(feito.evidencia));
    const original = fs.readFileSync(recibo, 'utf8');
    const confere = () => conferirReciboLocalNota(p.dir, t.id, masterDone(p, t.id).at(-1)!);
    // D12: o recibo é a prova do caminho e nunca decide se a nota vale; a nota segue humana e a omissão não a troca.
    const valeAinda = (porque: string) => {
      assert.equal(masterRatificado(p.dir, t.id), true, porque);
      assert.equal(notaHumanaRegistrada(lerThread(p.dir, t.id)), true, porque);
      assert.deepEqual(aceitarPendentesPorOmissao(p.dir), [], porque);
      assert.equal(lerThread(p.dir, t.id).score!.valor, 3, porque);
    };
    assert.equal(confere(), true);
    const adulterado = JSON.parse(original);
    adulterado.dados.score = 5;
    fs.writeFileSync(recibo, JSON.stringify(adulterado) + '\n');
    assert.equal(confere(), false, 'recibo adulterado');
    valeAinda('recibo adulterado');
    fs.writeFileSync(recibo, original);
    assert.equal(confere(), true);
    fs.renameSync(recibo, `${recibo}.fora`);
    assert.equal(confere(), false, 'recibo apagado');
    valeAinda('recibo apagado');
    fs.renameSync(`${recibo}.fora`, recibo);
    // HMAC: os dados certos com uma assinatura que a chave local não fez não conferem.
    const forjada = 'f'.repeat(64), bytes = JSON.stringify({ dados: JSON.parse(original).dados, assinatura: forjada }) + '\n';
    fs.writeFileSync(recibo, bytes);
    assert.equal(conferirReciboLocalNota(p.dir, t.id, { ...feito, recibo: sha256(forjada), evidenciaSha256: sha256(bytes) }), false,
      'assinatura que a chave local não produziu');
    fs.writeFileSync(recibo, original);
    // A chave local trocada (outra máquina, restauração): o recibo deixa de conferir, e a nota do dono fica.
    const chave = path.join(raizDoEstado(p.dir), '.orkastery', 'private', 'hitl-local-signing.key');
    const chaveOriginal = fs.readFileSync(chave);
    fs.writeFileSync(chave, 'e'.repeat(64) + '\n', { mode: 0o600 });
    assert.equal(confere(), false, 'chave trocada');
    valeAinda('chave trocada');
    fs.writeFileSync(chave, chaveOriginal, { mode: 0o600 });
    assert.equal(confere(), true);
    // O mesmo recibo não sustenta outra nota, nem outro host, nem outra identidade.
    assert.equal(conferirReciboLocalNota(p.dir, t.id, { ...feito, score: 5 }), false, 'outra nota');
    assert.equal(conferirReciboLocalNota(p.dir, t.id, { ...feito, canal: 'codex' }), false, 'outro host');
    assert.equal(conferirReciboLocalNota(p.dir, t.id, { ...feito, por: 'mcp-local:claude-code' }), false, 'outra identidade');
    assert.equal(conferirReciboLocalNota(p.dir, t.id, { ...feito, origem: 'telegram' }), false, 'outra origem');
    assert.equal(conferirReciboLocalNota(p.dir, t.id, { ...feito, justificativa: `${PORQUE}!` }), false, 'outro porquê');
    const editada = lerThread(p.dir, t.id);
    editada.score = { ...editada.score!, valor: 5 };
    gravarThread(p.dir, editada);
    registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.masterConcluido, { ...semCarimbo(feito), score: 5 });
    assert.equal(confere(), false, 'thread e evento com outra nota');
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
    assert.equal(depois.score!.avaliadoPor, AUTOR_DA_NOTA_NATIVA);
    assert.equal(masterDone(p, t.id).at(-1)!.eventId, feito.eventId);
  } finally { restaurar(); p.limpar(); }
});

test('nota local: a nota pelo Telegram que chega durante o diálogo vence, pela releitura sob a trava', async () => {
  const p = projetoTemporario('nota-local-corrida-telegram'), restaurar = ambienteDoIngresso();
  try {
    const t = entregue(p, 'corrida telegram');
    const { ingresso, soltar } = dialogoControlado(p, 'conexao-corrida-telegram');
    const aberta = ingresso.solicitar(t.id);
    await new Promise((r) => setTimeout(r, 30));
    const pedida = lerLedger(dirThread(p.dir, t.id)).find((e) => e.tipo === TIPOS_DE_EVENTO.notaPedida)!;
    const monitor = path.join(raizDoEstado(p.dir), '.orkastery', 'monitor');
    const r = responderPeloPulse(p.dir, dizer(`${String(pedida.codigo)} 5 entregou tudo`, 'telegram:-7:950', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.match(r.mensagem, /Nota 5\/5 registrada/);
    soltar({ action: 'accept', content: { nota: '1', porque: PORQUE } });
    assert.deepEqual(await aberta, { ok: true, threadId: t.id, estado: 'registrada', repetida: true, score: 5 });
    const depois = lerThread(p.dir, t.id);
    assert.equal(depois.score!.valor, 5);
    assert.equal(depois.score!.avaliadoPor, 'telegram:42');
    assert.ok(!masterDone(p, t.id).some((e) => e.por === AUTOR_DA_NOTA_NATIVA), 'a nota do diálogo não foi gravada');
  } finally { restaurar(); p.limpar(); }
});

test('nota local: o aceite por omissão que listou antes da nota grava sob a trava e não a troca', async () => {
  const p = projetoTemporario('nota-local-corrida-omissao');
  try {
    const t = entregue(p, 'corrida omissao', false);
    // O condutor lista as entregas (`ork master <t> --aceitar-omissao`) e a nota do diálogo grava no meio.
    const lista = entregasParaOmissao(p.dir, t.id);
    assert.deepEqual(lista.map((x) => x.thread.id), [t.id]);
    const { ingresso, soltar } = dialogoControlado(p, 'conexao-corrida-omissao');
    const aberta = ingresso.solicitar(t.id);
    await new Promise((r) => setTimeout(r, 30));
    soltar({ action: 'accept', content: { nota: '2', porque: PORQUE } });
    assert.deepEqual(await aberta, { ok: true, threadId: t.id, estado: 'registrada', repetida: false, score: 2 });
    const antes = retrato(p, t.id);
    const aceites = lista.map((x) => aceitarPorOmissao(p.dir, x.thread.id));
    assert.equal(aceites[0].preservada, true);
    assert.equal(aceites[0].scoreGravado, 2);
    assert.deepEqual(retrato(p, t.id), antes, 'o aceite atrasado não escreve nada');
    assert.equal(lerThread(p.dir, t.id).score!.avaliadoPor, AUTOR_DA_NOTA_NATIVA);
  } finally { p.limpar(); }
});

test('nota local: o aceite por omissão toma a trava da thread; ocupada, a lista segue sem ela e a thread indicada recebe o erro', () => {
  const p = projetoTemporario('nota-local-omissao-trava');
  try {
    const t = entregue(p, 'trava ocupada', false);
    const outra = entregue(p, 'outra entrega', false);
    comLockHitl(p.dir, t.id, () => {
      assert.throws(() => aceitarPorOmissao(p.dir, t.id), /HITL ocupado/);
      assert.throws(() => aceitarPendentesPorOmissao(p.dir, { thread: t.id }), /HITL ocupado/);
      assert.deepEqual(aceitarPendentesPorOmissao(p.dir).map((a) => a.thread), [outra.id]);
    });
    assert.equal(lerThread(p.dir, t.id).score ?? null, null, 'a thread com a trava tomada segue esperando');
    assert.deepEqual(aceitarPendentesPorOmissao(p.dir).map((a) => a.thread), [t.id]);
  } finally { p.limpar(); }
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

test('nota local: a nota de nome humano sem master_done que a confirme a listagem trata como pendente, e o aceite também', () => {
  const p = projetoTemporario('nota-local-limbo');
  try {
    const t = entregue(p, 'limbo', false);
    // A gravação interrompida entre o thread.json e o ledger (o registrarMaster fecha a thread antes dos eventos):
    // score de nome humano, thread fechada, nenhum master_done.
    const th = lerThread(p.dir, t.id);
    th.score = { valor: 1, justificativa: 'nota antiga sem master_done', avaliadoPor: 'Dono Simulado', avaliadoEm: QUANDO, regime: 'batch' };
    th.status = 'fechada';
    gravarThread(p.dir, th);
    assert.equal(masterRatificado(p.dir, t.id), false);
    assert.deepEqual(entregasParaOmissao(p.dir, t.id).map((x) => x.thread.id), [t.id], 'a listagem a trata como pendente');
    assert.deepEqual(aceitarPendentesPorOmissao(p.dir, { thread: t.id }).map((a) => a.thread), [t.id], 'e o aceite também, como na base');
    assert.equal(lerThread(p.dir, t.id).score!.regime, 'omissao');
    assert.deepEqual(entregasParaOmissao(p.dir, t.id), [], 'a lista e o aceite concordam');
  } finally { p.limpar(); }
});

test('nota local: com a trava da thread tomada por outro processo, a gravação espera e grava quando ela solta', async () => {
  const p = projetoTemporario('nota-local-trava-espera');
  try {
    const t = entregue(p, 'trava espera');
    const { ingresso, soltar } = dialogoControlado(p, 'conexao-trava-espera');
    const aberta = ingresso.solicitar(t.id);
    await new Promise((r) => setTimeout(r, 30));
    const solta = segurarTrava(p, t.id, 600);
    const inicio = Date.now();
    soltar({ action: 'accept', content: { nota: '3', porque: PORQUE } });
    assert.deepEqual(await aberta, { ok: true, threadId: t.id, estado: 'registrada', repetida: false, score: 3 });
    assert.ok(Date.now() - inicio >= 400, 'esperou a trava');
    await solta;
    assert.equal(lerThread(p.dir, t.id).score!.avaliadoPor, AUTOR_DA_NOTA_NATIVA);
  } finally { p.limpar(); }
});

test('nota local: a nota pelo diálogo fecha a thread e solta o que ela segurava, depois da trava', async () => {
  const p = projetoTemporario('nota-local-soltura');
  const bin = dirTemporario('nota-local-soltura-bin');
  const conta = path.join(p.dir, 'contas', 'processo');
  const codex = path.join(p.dir, 'contas', 'codex');
  const sessao = '5959fec0-0000-4000-8000-000000000001';
  fs.mkdirSync(conta, { recursive: true });
  fs.mkdirSync(codex, { recursive: true });
  // O runtime falso: a sessão da thread aparece parada (fantasma); o fechamento só a marca, nunca para nem remove.
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nif [ "$1" = "agents" ]; then cat "$CLAUDE_CONFIG_DIR/agents.json"; fi\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(conta, 'agents.json'), JSON.stringify([{ sessionId: sessao, cwd: '/srv/x', state: 'blocked' }]));
  const anterior = { PATH: process.env.PATH, CLAUDE: process.env.CLAUDE_CONFIG_DIR, CODEX: process.env.CODEX_HOME };
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.CLAUDE_CONFIG_DIR = conta;
  process.env.CODEX_HOME = codex;
  try {
    const t = entregue(p, 'soltura', false);
    const th = lerThread(p.dir, t.id);
    th.sessoes.push({ sessionId: sessao, runtime: 'claude-bg', slug: th.slug, fase: 'GOAL', bloco: 'full', verificada: true,
      origem: 'adocao', adotadaEm: th.criadaEm, cwdOrigem: p.dir });
    gravarThread(p.dir, th);
    registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GOAL', slug: th.slug, sessionId: sessao });
    const { ingresso, soltar } = dialogoControlado(p, 'conexao-soltura');
    const aberta = ingresso.solicitar(t.id);
    await new Promise((r) => setTimeout(r, 30));
    soltar({ action: 'accept', content: { nota: '4', porque: PORQUE } });
    assert.equal((await aberta).estado, 'registrada');
    assert.equal(lerThread(p.dir, t.id).status, 'fechada');
    const mortes = lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'sessao_morta');
    assert.deepEqual(mortes.map((e) => [e.sessionId, e.origem]), [[sessao, 'fechamento']], 'a soltura do fechamento rodou');
  } finally {
    volta('PATH', anterior.PATH); volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE); volta('CODEX_HOME', anterior.CODEX);
    fs.rmSync(bin, { recursive: true, force: true });
    p.limpar();
  }
});

test('nota local: a trava ocupada além da espera recusa com master.nota.trava-ocupada e nada da nota é gravado', async () => {
  const p = projetoTemporario('nota-local-trava-ocupada');
  try {
    const t = entregue(p, 'trava ocupada');
    let soltar: (r: RespostaDaNota) => void = () => undefined;
    const ingresso = criarIngressoDaNota(p.dir, { host: 'claude-code', connectionId: 'conexao-trava-ocupada' },
      () => new Promise<RespostaDaNota>((resolve) => { soltar = resolve; }), () => true, { esperaDaTravaMs: 300 });
    const aberta = ingresso.solicitar(t.id);
    await new Promise((r) => setTimeout(r, 30));
    const antes = retrato(p, t.id);
    const solta = segurarTrava(p, t.id, 1200);
    soltar({ action: 'accept', content: { nota: '1', porque: PORQUE } });
    await assert.rejects(aberta, /master\.nota\.trava-ocupada/);
    await solta;
    assert.deepEqual(retrato(p, t.id), antes, 'nem o MASTER nem o recibo');
    assert.equal(lerThread(p.dir, t.id).score!.regime, 'omissao');
  } finally { p.limpar(); }
});

test('nota local: a identidade da nota nativa não se digita no --por, com qualquer grafia, nem com uma prova inventada', () => {
  const p = projetoTemporario('nota-local-por');
  try {
    const t = entregue(p, 'por');
    const antes = retrato(p, t.id);
    const inventada = { origem: 'mcp-local', canal: 'claude-code', contratoResposta: 'ork.hitl-local-master-note/v1', conexao: 'c1',
      solicitacao: 'r1', recebidoEm: QUANDO, recibo: 'a'.repeat(64), evidencia: `.orkastery/threads/${t.id}/hitl-ingress-local/x.json`,
      evidenciaSha256: 'b'.repeat(64), notaPedida: { pedidoId: 'p1' } };
    for (const por of [AUTOR_DA_NOTA_NATIVA, 'Dono (Diálogo Nativo)', '  dono   (dialogo  nativo) ', 'dono(dialogo nativo)', 'dono (dialogo nativo).',
      'DONO - DIÁLOGO NATIVO']) {
      assert.throws(() => registrarMaster(p.dir, t.id, { score: 4, justificativa: 'x y z', por, refazer: true }), /não se digita no --por/, por);
      assert.throws(() => registrarMaster(p.dir, t.id, { score: 4, justificativa: 'x y z', por, refazer: true, prova: inventada }),
        /não se digita no --por/, por);
    }
    // A forma antiga do ingresso local segue recusada pela autoria humana, como antes desta entrega.
    for (const por of ['mcp-local:claude-code', 'mcp-local:codex']) {
      assert.throws(() => registrarMaster(p.dir, t.id, { score: 4, justificativa: 'x y z', por, refazer: true, prova: inventada }), /--por humano/);
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
