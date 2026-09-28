/**
 * FX3: fechar um `session_answer_sending` orfao so com (thread, pedido).
 *
 * O envio pendente e uma reserva duravel, e ela guarda `sha(prova)`, nunca a `prova`. Isso
 * esta certo. O que faltava era um caminho para o caso em que o processo que originou o
 * envio morreu com a `RespostaHumana` so na memoria: sem ele o pendente ficava para sempre,
 * e toda tentativa nova batia em "envio ja iniciado; resposta divergente recusada".
 *
 * Receptor, sessao e resposta sao SIMULADOS.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import {
  abrirPedidoSessao, ConfirmacaoSessao, ControleSessao, EntregaSessao, IdentidadeSessao,
  reconciliarEnvioDeSessao, responderSessao,
} from '../src/hitl-sessions';
import { validarEvidenciaDoIngresso } from '../src/hitl-ingress-receipt';
import { projetarPergunta } from '../src/adapters/codex-question';

const SID = '00000000-0000-0000-0000-0000000000b2';
const CHAVE = 'chave-SIMULADA-exclusiva-da-reconciliacao';
const TEXTO = 'RESPOSTA-SIMULADA-DA-RECONCILIACAO';

function ambiente(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  [CHAVE, '42', '-7'].forEach((v, i) => { process.env[nomes[i]] = v; });
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

/** Receptor SIMULADO com confirmacao controlada: e ela que a reconciliacao consulta. */
function fixture(p: ProjetoDeTeste) {
  const quando = new Date(Date.now() - 60_000).toISOString();
  const t = novaThread(p.carregado, { nome: 'reconciliacao', modo: 'auto' }).thread;
  t.faseAtual = 'GO';
  t.sessoes.push({ sessionId: SID, runtime: 'claude-bg', fase: 'GO', slug: t.slug, bloco: 'GO',
    promptPath: 'simulado.md', promptSha256: '0'.repeat(64), verificada: true, despachadaEm: quando });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: SID, runtime: 'claude-bg' });
  registrar(dir, t.id, 'phase_dispatch_verified', { fase: 'GO', sessionId: SID, encontrada: true });
  const identidade: IdentidadeSessao = { sessionId: SID, runtime: 'claude-bg', cwd: p.dir, estado: 'blocked',
    instancia: 'controller-simulado-recon', bloqueio: 'prompt-recon',
    perguntaNativa: projetarPergunta({ isBlocking: true, questions: [{ id: 'q1', question: 'Pergunta SIMULADA' }] }) };
  const envios: EntregaSessao[] = [];
  const estado = { confirma: true, ack: null as ConfirmacaoSessao | null };
  const ctl: ControleSessao = {
    consultar: () => ({ ok: true, sessoes: [{ ...identidade }] }),
    parar: () => { throw new Error('esta fixture nao para sessoes'); },
    enviar: e => { envios.push(e); const { resposta: _r, ...recibo } = e; estado.ack = { ...recibo, estado: 'recebida' }; },
    confirmar: () => estado.confirma ? estado.ack : null,
  };
  const pedido = abrirPedidoSessao(p.dir, t.id, SID, { fase: 'GO', runtime: 'claude-bg', quando }, ctl);
  const envelope = (): RespostaHumana => {
    const r: Omit<RespostaHumana, 'prova'> = { resposta: TEXTO, origem: 'telegram', canal: 'hermes',
      por: 'telegram:42', mensagem: 'telegram:-7:recon', recebidoEm: new Date().toISOString() };
    return { ...r, prova: assinaturaDaResposta(t.id, pedido.id, r, CHAVE) };
  };
  return { t, dir, pedido, ctl, envios, estado, envelope };
}

test('FX3: envio orfao fecha pelo recibo do controller, so com thread e pedido', () => {
  const p = projetoTemporario('reconciliacao-orfa'), restaurar = ambiente();
  try {
    const f = fixture(p);
    // O receptor recebe, mas o processo morre antes de a confirmacao ser conferida.
    f.estado.confirma = false;
    assert.throws(() => responderSessao(p.dir, f.t.id, f.pedido.id, f.envelope(), f.ctl), /nao confirmou|não confirmou/);
    const pendente = lerLedger(f.dir).find(e => e.tipo === 'session_answer_sending');
    assert.ok(pendente, 'a reserva duravel existe');
    assert.equal(lerLedger(f.dir).some(e => e.tipo === 'session_answered'), false);
    assert.equal(f.envios.length, 1);

    // Sem o `r` original, e sem confirmacao ainda, a reconciliacao nao inventa entrega.
    const pendenteAinda = reconciliarEnvioDeSessao(p.dir, f.t.id, f.pedido.id, f.ctl);
    assert.deepEqual({ ok: pendenteAinda.ok, estado: pendenteAinda.estado, prova: pendenteAinda.prova },
      { ok: false, estado: 'pendente', prova: 'nenhuma' });
    assert.equal(f.envios.length, 1, 'reconciliar NUNCA reenvia');
    assert.equal(lerLedger(f.dir).some(e => e.tipo === 'session_answered'), false);

    // O receptor volta a responder o recibo: agora a entrega esta provada e fecha.
    f.estado.confirma = true;
    const fechado = reconciliarEnvioDeSessao(p.dir, f.t.id, f.pedido.id, f.ctl);
    assert.equal(fechado.ok, true);
    assert.equal(fechado.estado, 'entregue');
    assert.equal(fechado.repetida, false);
    assert.equal(fechado.envioId, String(pendente!.envioId));
    // FX4: a prova duravel do canal e reconstruida so do ledger, e revalida de verdade.
    assert.equal(fechado.prova, 'ingresso-duravel');
    const evento = lerLedger(f.dir).find(e => e.tipo === 'session_answered')!;
    assert.equal(evento.reconciliado, true);
    assert.equal(validarEvidenciaDoIngresso(p.dir, String(f.t.id), evento), true);
    assert.equal(f.envios.length, 1, 'fechar tambem nao reenvia');

    // Idempotencia: repetir nao regrava, nao reenvia e nao consulta o receptor de novo.
    const repetida = reconciliarEnvioDeSessao(p.dir, f.t.id, f.pedido.id, f.ctl);
    assert.equal(repetida.repetida, true);
    assert.equal(repetida.estado, 'entregue');
    assert.equal(lerLedger(f.dir).filter(e => e.tipo === 'session_answered').length, 1);
    assert.equal(f.envios.length, 1);
    // A tentativa e auditavel: uma observacao tipada por chamada, com o desfecho.
    const observacoes = lerLedger(f.dir).filter(e => e.tipo === 'session_answer_reconciled');
    assert.deepEqual(observacoes.map(e => e.estado), ['pendente', 'entregue']);
  } finally { restaurar(); p.limpar(); }
});

test('FX3: reconciliar recusa pedido sem envio pendente e pedido que nao e de sessao', () => {
  const p = projetoTemporario('reconciliacao-recusas'), restaurar = ambiente();
  try {
    const f = fixture(p);
    assert.throws(() => reconciliarEnvioDeSessao(p.dir, f.t.id, f.pedido.id, f.ctl), /sem-envio-pendente/);
    assert.throws(() => reconciliarEnvioDeSessao(p.dir, f.t.id, 'pedido-que-nao-existe', f.ctl), /pedido HITL|identifica/);
    assert.equal(lerLedger(f.dir).some(e => e.tipo === 'session_answered'), false);
  } finally { restaurar(); p.limpar(); }
});

/**
 * FX10: o pendente adulterado falha FECHADO, sem `session_answered`.
 *
 * A reconstrucao da evidencia duravel usa so o ledger, e isso esta certo. O que faltava era
 * conferir o MAC ANTES de gravar: qualquer byte trocado no envio pendente, ou no proprio
 * arquivo de ingresso, virava resposta humana aceita com etiqueta `ingresso-duravel`, e a
 * divergencia so apareceria no sync, depois de a resposta ja ter valido. Cada caso abaixo
 * preserva a confirmacao do receptor de proposito: se o desfecho mudasse pelo recibo do
 * controller, o teste nao estaria provando a conferencia criptografica.
 *
 * Adulteracao, receptor e resposta sao SIMULADOS.
 */
function pendenteEmDisco(dir: string) {
  const ledger = path.join(dir, 'ledger.jsonl');
  const original = fs.readFileSync(ledger, 'utf8');
  const linhas = () => original.trimEnd().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
  const alvo = linhas().findIndex(l => l.tipo === 'session_answer_sending');
  assert.ok(alvo >= 0, 'a reserva duravel precisa existir para ser adulterada');
  return {
    adulterar(mudanca: Record<string, unknown>) {
      const todas = linhas();
      todas[alvo] = { ...todas[alvo], ...mudanca };
      fs.writeFileSync(ledger, todas.map(l => JSON.stringify(l)).join('\n') + '\n');
    },
    mensagem: String(linhas()[alvo].mensagem),
    restaurar: () => fs.writeFileSync(ledger, original),
  };
}

test('FX10: evidencia duravel reconstruida so vira resposta depois de revalidar o MAC', () => {
  const p = projetoTemporario('reconciliacao-adulterada'), restaurar = ambiente();
  try {
    const f = fixture(p);
    f.estado.confirma = false;
    assert.throws(() => responderSessao(p.dir, f.t.id, f.pedido.id, f.envelope(), f.ctl), /nao confirmou|não confirmou/);
    // O receptor volta a confirmar: daqui para frente o unico obstaculo e a prova duravel.
    f.estado.confirma = true;
    const pendente = pendenteEmDisco(f.dir);
    const ingresso = path.join(f.dir, 'hitl-ingress',
      createHash('sha256').update(pendente.mensagem).digest('hex') + '.json');
    const bytes = fs.readFileSync(ingresso, 'utf8');
    const respondidos = () => lerLedger(f.dir).filter(e => e.tipo === 'session_answered').length;
    const recusas = () => lerLedger(f.dir).filter(e => e.tipo === 'session_answer_reconciled' && e.estado === 'recusado').length;

    // 1..2: campos do pendente que entram no corpo assinado, e que o recibo do controller
    // nao confere. Sao exatamente os que passariam despercebidos sem esta conferencia.
    for (const mudanca of [{ autorizadoPor: 'telegram:99' }, { recebidoEm: new Date(Date.now() - 30_000).toISOString() }]) {
      pendente.adulterar(mudanca);
      assert.throws(() => reconciliarEnvioDeSessao(p.dir, f.t.id, f.pedido.id, f.ctl),
        /evidencia-duravel-invalida/, `adulteracao aceita: ${JSON.stringify(mudanca)}`);
      assert.equal(respondidos(), 0, `resposta gravada apesar da adulteracao: ${JSON.stringify(mudanca)}`);
      pendente.restaurar();
    }

    // 3: bytes do proprio arquivo de ingresso trocados em disco.
    const v = JSON.parse(bytes);
    v.dados.respostaSha256 = 'c'.repeat(64);
    fs.writeFileSync(ingresso, JSON.stringify(v), { mode: 0o600 });
    assert.throws(() => reconciliarEnvioDeSessao(p.dir, f.t.id, f.pedido.id, f.ctl), /evidencia-duravel-invalida/);
    assert.equal(respondidos(), 0, 'ingresso adulterado em disco virou resposta');

    // 4: prova apagada nao pode ser um caminho MAIS permissivo que prova presente.
    fs.rmSync(ingresso);
    assert.throws(() => reconciliarEnvioDeSessao(p.dir, f.t.id, f.pedido.id, f.ctl), /evidencia-duravel-invalida/);
    assert.equal(respondidos(), 0, 'telegram sem ingresso duravel caiu no recibo do controller');
    // Os dois primeiros casos restauram o ledger inteiro e levam junto a propria recusa;
    // as duas ultimas sobrevivem e provam que a recusa fica auditavel, nao silenciosa.
    assert.equal(recusas(), 2, 'a recusa da reconciliacao precisa ficar no ledger');

    // Com a prova de volta, o mesmo pendente fecha: falhar fechado nao e travar para sempre.
    fs.writeFileSync(ingresso, bytes, { mode: 0o600 });
    const fechado = reconciliarEnvioDeSessao(p.dir, f.t.id, f.pedido.id, f.ctl);
    assert.equal(fechado.estado, 'entregue');
    assert.equal(fechado.prova, 'ingresso-duravel');
    assert.equal(respondidos(), 1);
    assert.equal(f.envios.length, 1, 'nenhuma tentativa reenviou a resposta');
    const evento = lerLedger(f.dir).find(e => e.tipo === 'session_answered')!;
    assert.equal(validarEvidenciaDoIngresso(p.dir, String(f.t.id), evento), true);
  } finally { restaurar(); p.limpar(); }
});
