/** Todas as identidades e provas deste arquivo são SIMULADAS em repositórios temporários. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { abrirPedidoGate, assinaturaDaResposta, responderGate, RespostaHumana, registrarPedidoHitl } from '../src/hitl-gates';
import { ehV2, escolhasDoPedido, motivoDoPedido, prazoDoPedido, recomendacaoDoPedido,
  textoDoPedido } from '../src/hitl-contract';
import { aprovarGateHumano, aprovacoesHumanas } from '../src/gates';
import { dirThread, novaThread, gravarThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { projetoTemporario } from './apoio';

const quando = '2026-09-08T01:00:00.000Z';
const chave = 'chave-exclusivamente-simulada-nos-testes-000';
function ambiente() {
  const nomes = ['ORK_HITL_INGRESS_KEY', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY = chave; process.env.ORK_HITL_TELEGRAM_USERS = '42'; process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}
function resposta(thread: string, pedido: string, alteracao: Partial<RespostaHumana> = {}): RespostaHumana {
  const r = { resposta: '1', origem: 'telegram' as const, por: 'telegram:42', mensagem: 'telegram:-7:8', recebidoEm: quando, ...alteracao };
  return { ...r, prova: assinaturaDaResposta(thread, pedido, r, chave) };
}

test('gate simulado: assinatura, correlação, idempotência e recibo sem conteúdo', () => {
  const p = projetoTemporario('hitl-gate'), restaurar = ambiente();
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'gate simulado', modo: 'classic' });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const pedido = abrirPedidoGate(p.dir, t.id, undefined, quando), r = resposta(t.id, pedido.id);
    assert.equal(abrirPedidoGate(p.dir, t.id, undefined, quando).id, pedido.id);
    assert.equal(responderGate(p.dir, t.id, pedido.id, r, quando).estado, 'aprovado');
    assert.equal(responderGate(p.dir, t.id, pedido.id, r, quando).repetida, true);
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 1);
    const humano = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === 'human_gate')!;
    assert.equal(humano.autorizadoPor, 'telegram:42'); assert.equal(humano.mensagem, r.mensagem);
    assert.equal(humano.resposta, undefined); assert.equal(humano.prova, undefined);
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, resposta(t.id, pedido.id, { resposta: '2' }), quando));
    assert.throws(() => registrarPedidoHitl(p.dir, { ...pedido, pergunta: 'alterada' } as typeof pedido));
  } finally { restaurar(); p.limpar(); }
});

test('gate expirado não bloqueia pedido substituto no mesmo contexto', () => {
  const p = projetoTemporario('hitl-gate-expirado');
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'gate expirado', modo: 'classic' });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const primeiro = abrirPedidoGate(p.dir, t.id, undefined, quando);
    const depoisDoPrazo = new Date(Date.parse(prazoDoPedido(primeiro)!) + 1).toISOString();
    const substituto = abrirPedidoGate(p.dir, t.id, undefined, depoisDoPrazo);
    assert.notEqual(substituto.id, primeiro.id);
    assert.equal(substituto.criadoEm, depoisDoPrazo);
    assert.equal(abrirPedidoGate(p.dir, t.id, undefined, depoisDoPrazo).id, substituto.id);
  } finally { p.limpar(); }
});

test('gate simulado recusa falsa origem, automação, mensagem reutilizada, prazo e contexto antigo', () => {
  const p = projetoTemporario('hitl-recusas'), restaurar = ambiente();
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'recusas simuladas', modo: 'classic' });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const pedido = abrirPedidoGate(p.dir, t.id, undefined, quando), r = resposta(t.id, pedido.id);
    for (const falso of [{ ...r, prova: '0'.repeat(64) }, { ...r, resposta: '2' },
      resposta(t.id, pedido.id, { por: 'telegram:43' }), resposta(t.id, pedido.id, { mensagem: 'telegram:-8:8' }),
      resposta(t.id, pedido.id, { origem: 'auto' as 'telegram' }), resposta(t.id, pedido.id, { recebidoEm: 'inválido' })]) {
      assert.throws(() => responderGate(p.dir, t.id, pedido.id, falso, quando));
    }
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, r, '2026-09-08T01:01:01.000Z'));
    const expirada = resposta(t.id, pedido.id, { recebidoEm: prazoDoPedido(pedido)! });
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, expirada, prazoDoPedido(pedido)));
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { fase: 'GOAL', sessionId: 'nova-sessao' });
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, r, quando));
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
    t.faseAtual = 'PLAN'; gravarThread(p.dir, t);
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, r, quando));
  } finally { restaurar(); p.limpar(); }
});

test('aprovação legada não grava; Auto, Maestro e Fast fora da pausa não criam pedidos', () => {
  const p = projetoTemporario('hitl-blanket');
  try {
    for (const modo of ORDEM_DOS_MODOS) {
      const { thread: t } = novaThread(p.carregado, { nome: modo, modo });
      assert.throws(() => aprovarGateHumano(p.dir, t.id, 'push', 'agente'), /aposentada/);
      assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
      // I-42: o #Fast nasce com o bloco unico sem pausa, e o nucleo recusa abrir pedido nele.
      if (modo !== 'classic') assert.throws(() => abrirPedidoGate(p.dir, t.id, undefined, quando), /não prevê pausa humana/);
    }
  } finally { p.limpar(); }
});

test('lock ocupado e ingresso sem chave recusam antes de registrar resposta', () => {
  const p = projetoTemporario('hitl-lock'), restaurar = ambiente();
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'lock simulado', modo: 'classic' });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const pedido = abrirPedidoGate(p.dir, t.id, undefined, quando), r = resposta(t.id, pedido.id);
    const lock = path.join(dirThread(p.dir, t.id), '.hitl.lock'); fs.writeFileSync(lock, 'simulado');
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, r, quando), /ocupado/); fs.unlinkSync(lock);
    delete process.env.ORK_HITL_INGRESS_KEY;
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, r, quando), /hitl.credencial/);
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
  } finally { restaurar(); p.limpar(); }
});

// ---------------------------------------------------------------------------
// I-34: a pausa prevista abre depois do phase_result claude-bg do watcher (D7).
// ---------------------------------------------------------------------------
import { observarSessao } from '../src/session-watcher';
import { ingerirEvento } from '../src/session-events';
import { fonteClaudeDoDespacho } from '../src/session-watcher-claude';

function maestroNoPlan(nome: string, escreverPlano: boolean) {
  const p = projetoTemporario(nome);
  const { thread: t } = novaThread(p.carregado, { nome, modo: 'maestro' });
  const sid = '11111111-2222-3333-4444-555555555555', despacho = '2026-09-08T00:00:00.000Z';
  t.faseAtual = 'PLAN';
  t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'PLAN', bloco: 'GOAL-PLAN', runtime: 'claude-bg', despachadaEm: despacho,
    promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase: 'PLAN', sessionId: sid, runtime: 'claude-bg', cwd: p.dir });
  registrar(dir, t.id, 'session_sensor_registered', { fase: 'PLAN', sessionId: sid, despachoEm: despacho,
    ...fonteClaudeDoDespacho(p.dir, t.id, 'PLAN', p.dir) });
  if (escreverPlano) { fs.mkdirSync(path.join(dir, 'docs'), { recursive: true }); fs.writeFileSync(path.join(dir, 'docs', 'plan.md'), '# plano\n'); }
  ingerirEvento(p.dir, sid, 'stop', JSON.stringify({ observedAt: '2026-09-08T00:10:00.000Z', eventId: 'stop-plan' }), Date.parse(quando));
  const r = observarSessao(p.carregado, sid, { agoraMs: Date.parse('2026-09-08T00:11:00.000Z'), consultaClaude: () => ({ ok: true, detalhe: '',
    consultadoEm: '2026-09-08T00:11:00.000Z', registros: [{ sessionId: sid, cwd: p.dir, state: 'done', status: 'idle' }] }) });
  return { p, t, dir, r };
}

test('I-34: PLAN claude-bg do #Maestro concluído pelo watcher abre a pausa de premissas', () => {
  const { p, t, dir, r } = maestroNoPlan('hitl-i34-pausa', true);
  try {
    assert.equal(r.classificacao, 'gate_blocked');
    const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result')!;
    assert.equal(resultado.motivo, 'human.pending'); assert.equal(resultado.runtime, 'claude-bg');
    const pedido = abrirPedidoGate(p.dir, t.id, 'human.pending', quando);
    assert.equal(motivoDoPedido(pedido), 'human.pending'); assert.equal(pedido.fase, 'PLAN');
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'hitl_requested').length, 1);
  } finally { p.limpar(); }
});

test('I-34: phase_result de bloqueio por outro motivo não abre a pausa; o legado sem classificação abre', () => {
  const { p, t, dir, r } = maestroNoPlan('hitl-i34-sem-plano', false);
  try {
    assert.equal(r.classificacao, 'gate_blocked');
    assert.equal(lerLedger(dir).find(e => e.tipo === 'phase_result')!.motivo, 'artifact.missing');
    assert.throws(() => abrirPedidoGate(p.dir, t.id, 'human.pending', quando), /conclusão da fase precisa estar registrada/);
    registrar(dir, t.id, 'phase_result', { fase: 'PLAN', classificacao: 'gate_blocked', motivo: 'runtime.unavailable', runtime: 'codex' });
    assert.throws(() => abrirPedidoGate(p.dir, t.id, 'human.pending', quando), /conclusão da fase precisa estar registrada/);
    assert.equal(lerLedger(dir).some(e => e.tipo === 'hitl_requested'), false);
    registrar(dir, t.id, 'phase_result', { fase: 'PLAN', evidencia: 'fixture legada SIMULADA' });
    assert.equal(motivoDoPedido(abrirPedidoGate(p.dir, t.id, 'human.pending', quando)), 'human.pending');
  } finally { p.limpar(); }
});

test('GO-FIX 1: parecer negativo do CHECK abre a pausa; resultado de despacho antigo não abre sobre redespacho que falhou', () => {
  const p = projetoTemporario('hitl-i34-despacho');
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'look', modo: 'classic' });
    const dir = dirThread(p.dir, t.id);
    t.faseAtual = 'CHECK'; gravarThread(p.dir, t);
    registrar(dir, t.id, 'phase_dispatch', { fase: 'CHECK', sessionId: 'codex-1', runtime: 'codex' });
    registrar(dir, t.id, 'phase_result', { fase: 'CHECK', sessionId: 'codex-1', runtime: 'codex', classificacao: 'gate_blocked', motivo: 'ci.failed' });
    assert.equal(motivoDoPedido(abrirPedidoGate(p.dir, t.id, 'human.pending', quando)), 'human.pending', 'parecer negativo é fase concluída');
    const u = novaThread(p.carregado, { nome: 'look-2', modo: 'classic' }).thread, d2 = dirThread(p.dir, u.id);
    u.faseAtual = 'PLAN'; gravarThread(p.dir, u);
    registrar(d2, u.id, 'phase_dispatch', { fase: 'PLAN', sessionId: 'claude-1', runtime: 'claude-bg' });
    registrar(d2, u.id, 'gate_blocked', { fase: 'PLAN', sessionId: 'claude-1', motivo: 'human.pending', origem: 'sessions.watch' });
    registrar(d2, u.id, 'phase_result', { fase: 'PLAN', sessionId: 'claude-1', classificacao: 'gate_blocked', motivo: 'human.pending' });
    registrar(d2, u.id, 'phase_dispatch', { fase: 'PLAN', sessionId: 'claude-2', runtime: 'claude-bg' });
    registrar(d2, u.id, 'phase_result', { fase: 'PLAN', sessionId: 'claude-2', classificacao: 'gate_blocked', motivo: 'artifact.missing' });
    assert.throws(() => abrirPedidoGate(p.dir, u.id, 'human.pending', quando), /conclusão da fase precisa estar registrada/);
    registrar(d2, u.id, 'phase_result', { fase: 'PLAN', sessionId: 'claude-2', classificacao: 'fase_concluida', motivo: null });
    assert.equal(abrirPedidoGate(p.dir, u.id, 'human.pending', quando).fase, 'PLAN');
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 3 (D18, achado 10 do CHECK dd50cc0c): human.pending sem conclusão provada leva o
// diagnóstico ao pedido HITL e ao monitor/pulse, sem se apresentar como fase concluída.
// ---------------------------------------------------------------------------
import { commitar } from './apoio';
import { montarMonitor } from '../src/orquestracao';
import { montarPulse } from '../src/pulse';
import { Modo } from '../src/types';
import { ORDEM_DOS_MODOS } from '../src/modos';

function goClaudeBg(nome: string, modo: Modo, comCommit: boolean) {
  const p = projetoTemporario(nome);
  const { thread: t } = novaThread(p.carregado, { nome, modo, criarWorktree: true });
  const sid = '11111111-2222-3333-4444-777777777777', despacho = '2026-09-08T00:00:00.000Z', wt = t.worktree!;
  t.faseAtual = 'GO';
  // I-43: a pausa e propriedade da THREAD (`pausaNaThread` le `thread.blocos`), nao da
  // matriz do modo. `#Look` era o unico modo cujo bloco fechava em GO; o fixture passa a
  // DECLARAR o bloco que ele exercita, em vez de emprestar a matriz de um modo aposentado.
  // Em `#Auto` nao se declara pausa nenhuma: o braco que prova a lacuna de contrato
  // depende justamente de o modo NAO prever pausa na fase.
  if (modo !== 'auto') {
    t.blocos = [{ fases: ['GOAL', 'PLAN'], pausa: true, pausaSobre: 'plano', slugFases: 'f12' },
      { fases: ['GO'], pausa: true, pausaSobre: 'implementacao', slugFases: 'go' },
      { fases: ['CHECK', 'SHIP', 'MASTER'], pausa: false, pausaSobre: '', slugFases: 'f456' }];
  }
  t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'claude-bg', despachadaEm: despacho,
    promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: sid, runtime: 'claude-bg', cwd: wt });
  registrar(dir, t.id, 'session_sensor_registered', { fase: 'GO', sessionId: sid, despachoEm: despacho,
    ...fonteClaudeDoDespacho(p.dir, t.id, 'GO', wt) });
  if (comCommit) registrar(dir, t.id, 'mcp_git_committed', { commit: commitar(wt, 'go.txt', 'entrega\n', 'commit do GO'),
    paths: ['go.txt'], origem: 'mcp.git' });
  ingerirEvento(p.dir, sid, 'stop', JSON.stringify({ observedAt: '2026-09-08T00:10:00.000Z', eventId: 'stop-go' }), Date.parse(quando));
  observarSessao(p.carregado, sid, { agoraMs: Date.parse('2026-09-08T00:11:00.000Z'), consultaClaude: () => ({ ok: true, detalhe: '',
    consultadoEm: '2026-09-08T00:11:00.000Z', registros: [{ sessionId: sid, cwd: wt, state: 'done', status: 'idle' }] }) });
  const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result')!;
  return { p, t, dir, resultado };
}

test('GO-FIX 3 (D18): pausa sobre GO sem prova leva o diagnóstico e não oferece "Aprovar com as evidências apresentadas"', () => {
  const sem = goClaudeBg('hitl-d18-sem-prova', 'classic', false);
  try {
    assert.equal(sem.resultado.motivo, 'human.pending');
    assert.match(String(sem.resultado.diagnostico), /^sem prova do ork: nenhum commit registrado pelo núcleo/);
    const pedido = abrirPedidoGate(sem.p.dir, sem.t.id, 'human.pending', quando);
    // I-41 (D1/T6): o diagnóstico continua chegando ao dono, agora no corpo, que é o bloco de
    // evidência. A pergunta volta a ser uma frase, e a recomendada deixa de ser aviso genérico:
    // sem conclusão provada, ela NOMEIA a alternativa de revisão e diz o porquê em uma linha.
    assert.match(textoDoPedido(pedido), /^Qual é o veredito sobre [^?]+\?$/);
    assert.ok(ehV2(pedido) && pedido.classe === 'pergunta' && pedido.corpo.some(
      l => l.includes('sem prova do ork: nenhum commit registrado pelo núcleo')), JSON.stringify(pedido));
    assert.match(recomendacaoDoPedido(pedido), /^b\) Solicitar revisão: a fase não tem conclusão provada/);
    const escolhas = escolhasDoPedido(pedido);
    assert.notEqual(escolhas[0].texto, 'Aprovar com as evidências apresentadas');
    assert.deepEqual([escolhas[0].texto, escolhas[0].acao], ['Aprovar sem conclusão provada (conferi a entrega)', 'aprovar']);
  } finally { sem.p.limpar(); }
  // Positivo: com a prova, a pausa prevista continua sendo a de fase concluída.
  const com = goClaudeBg('hitl-d18-com-prova', 'classic', true);
  try {
    assert.equal(com.resultado.motivo, 'human.pending');
    assert.equal(com.resultado.diagnostico, null);
    const pedido = abrirPedidoGate(com.p.dir, com.t.id, 'human.pending', quando);
    assert.match(textoDoPedido(pedido), /^Qual é o veredito sobre [^?]+\?$/);
    assert.equal(escolhasDoPedido(pedido)[0].texto, 'Aprovar com as evidências apresentadas');
    // I-41: com conclusão provada a recomendada é aprovar, e o porquê cita o fato registrado.
    assert.match(recomendacaoDoPedido(pedido), /^a\).*registrou conclusão/);
  } finally { com.p.limpar(); }
});

test('GO-FIX 3 (D18): resultado anterior ao campo diagnostico usa provaOrk.fonte; texto de controle não entra no pedido', () => {
  const p = projetoTemporario('hitl-d18-legado');
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'legado', modo: 'classic' });
    const dir = dirThread(p.dir, t.id);
    t.faseAtual = 'GO';
    // I-43: a thread declara o bloco que pausa em GO (ver `goClaudeBg`).
    t.blocos = [{ fases: ['GOAL', 'PLAN'], pausa: true, pausaSobre: 'plano', slugFases: 'f12' },
      { fases: ['GO'], pausa: true, pausaSobre: 'implementacao', slugFases: 'go' },
      { fases: ['CHECK', 'SHIP', 'MASTER'], pausa: false, pausaSobre: '', slugFases: 'f456' }];
    gravarThread(p.dir, t);
    registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: 'claude-1', runtime: 'claude-bg' });
    registrar(dir, t.id, 'phase_result', { fase: 'GO', sessionId: 'claude-1', classificacao: 'gate_blocked', motivo: 'human.pending',
      provaOrk: { ok: false, fonte: 'nenhum commit' + String.fromCharCode(7) + ' registrado' } });
    const pedido = abrirPedidoGate(p.dir, t.id, 'human.pending', quando);
    // I-41 (D1/T6): a evidência saiu da pergunta e foi para o corpo. O diagnóstico continua
    // chegando ao dono, com o caractere de controle já removido, e a pergunta volta a ser uma
    // frase; um diagnóstico de 600 caracteres estourava o teto da pergunta do v2.
    assert.match(textoDoPedido(pedido), /^Qual é o veredito sobre [^?]+\?$/);
    assert.ok(!ehV2(pedido) || pedido.classe !== 'pergunta' ? false : pedido.corpo.some(
      l => l.includes('sem prova do ork: nenhum commit  registrado')), JSON.stringify(pedido));
    assert.equal(escolhasDoPedido(pedido)[0].texto, 'Aprovar sem conclusão provada (conferi a entrega)');
    // Sem conclusão provada, a recomendada é solicitar revisão, e não aprovar.
    assert.match(recomendacaoDoPedido(pedido), /^b\) Solicitar revisão: a fase não tem conclusão provada/);
  } finally { p.limpar(); }
});

test('GO-FIX 3 (D18): em #Auto não há pedido (lacuna de contrato), e o diagnóstico aparece no monitor e no pulse', () => {
  const a = goClaudeBg('hitl-d18-auto', 'auto', false);
  try {
    const diagnostico = String(a.resultado.diagnostico);
    assert.match(diagnostico, /^sem prova do ork: /);
    assert.throws(() => abrirPedidoGate(a.p.dir, a.t.id, 'human.pending', quando), /modo não prevê pausa humana nesta fase/);
    const gate = lerLedger(a.dir).find(e => e.tipo === 'gate_blocked' && e.motivo === 'human.pending')!;
    assert.equal(gate.detalhe, diagnostico);
    const linha = montarMonitor(a.p.carregado).linhas.find(l => l.thread === a.t.id)!;
    assert.ok(linha.paradas.some(x => x.motivo === 'human.pending' && x.detalhe === diagnostico), 'monitor sem o diagnóstico');
    const pulse = montarPulse(a.p.carregado, { fontes: () => ({}), quando: new Date().toISOString(),
      consulta: { ok: true, sessoes: [], detalhe: '' } });
    assert.ok(pulse.precisaDeHumanoAgora.some(i => i.thread === a.t.id && i.motivo === 'human.pending' && i.pergunta === diagnostico),
      'pulse sem o diagnóstico');
  } finally { a.p.limpar(); }
});
