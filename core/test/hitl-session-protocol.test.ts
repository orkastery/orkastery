/** Receptor, identidades e resposta SIMULADOS. Sem Telegram, sessão operacional ou API. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { assinaturaDaResposta, comLockHitl, responderGate, RespostaHumana } from '../src/hitl-gates';
import { abrirPedidoSessao, ConfirmacaoSessao, ControleSessao, EntregaSessao, IdentidadeSessao, responderSessao } from '../src/hitl-sessions';

import { projetarPergunta } from '../src/adapters/codex-question';

const sid = '00000000-0000-0000-0000-000000000001';
const quando = '2026-09-08T07:00:00.000Z';
const chave = 'chave-SIMULADA-do-protocolo-de-sessao-0000';
const conteudo = 'RESPOSTA-SIMULADA-ç $(não-executar)';

function fixture(runtime = 'claude-bg', instante = quando) {
  const p = projetoTemporario('session-protocol');
  const t = novaThread(p.carregado, { nome: 'sessao simulada', modo: 'auto' }).thread;
  t.faseAtual = 'GO';
  t.sessoes.push({ sessionId: sid, runtime, fase: 'GO', slug: t.slug, bloco: 'GO',
    promptPath: 'simulado.md', promptSha256: '0'.repeat(64), verificada: true, despachadaEm: quando });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: sid, runtime });
  registrar(dir, t.id, 'phase_dispatch_verified', { fase: 'GO', sessionId: sid, encontrada: true });
  const nomes = ['ORK_HITL_INGRESS_KEY', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  [chave, '42', '-7'].forEach((v, i) => { process.env[nomes[i]] = v; });
  let identidade: IdentidadeSessao = { sessionId: sid, runtime, cwd: p.dir, estado: 'blocked', instancia: 'controller-simulado-1', bloqueio: 'prompt-1', perguntaNativa: projetarPergunta({ isBlocking: true, questions: [{ id: 'q1', question: 'Informe a resposta SIMULADA' }] }) };
  const envios: EntregaSessao[] = [];
  let ack: ConfirmacaoSessao | null = null;
  const ctl: ControleSessao = {
    consultar: () => ({ ok: true, sessoes: [{ ...identidade }] }),
    parar: () => { throw new Error('este fluxo não para sessões'); },
    enviar: e => { envios.push(e); const { resposta: _, ...recibo } = e; ack = { ...recibo, estado: 'recebida' }; },
    confirmar: () => ack,
  };
  const abrir = (c = ctl) => abrirPedidoSessao(p.dir, t.id, sid,
    { fase: 'GO', runtime, pergunta: 'Informe a resposta SIMULADA', quando: instante }, c);
  const resposta = (pedidoId: string, mudanca: Partial<RespostaHumana> = {}) => {
    const r = { resposta: conteudo, origem: 'telegram' as const, por: 'telegram:42',
      mensagem: 'telegram:-7:8', recebidoEm: instante, ...mudanca };
    return { ...r, prova: assinaturaDaResposta(t.id, pedidoId, r, chave) };
  };
  return { p, t, dir, ctl, abrir, resposta, envios,
    identidade: () => identidade, mudar: (v: Partial<IdentidadeSessao>) => { identidade = { ...identidade, ...v }; },
    limpar: () => { nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; }); p.limpar(); } };
}

test('SIMULADO: envelope autenticado chega por stdin ao receptor exato; recibo e repetição não duplicam envio', () => {
  const f = fixture();
  try {
    const reciboFile = path.join(f.p.dir, 'recibo-simulado.json');
    let envios = 0;
    f.ctl.enviar = e => {
      envios++;
      const script = `const fs=require('node:fs'); const e=JSON.parse(fs.readFileSync(0,'utf8'));
        const esperado=JSON.parse(process.env.RECEPTOR_SIMULADO);
        if(e.sessao.sessionId!==esperado.sessionId || e.sessao.cwd!==process.cwd() ||
          e.sessao.instancia!==esperado.instancia || e.sessao.bloqueio!==esperado.bloqueio ||
          e.resposta!==process.env.CONTEUDO_SIMULADO) process.exit(4);
        const {resposta,...recibo}=e;
        fs.writeFileSync(process.env.RECIBO_SIMULADO,JSON.stringify({...recibo,estado:'recebida'}),{flag:'wx'});`;
      const r = spawnSync(process.execPath, ['-e', script], { cwd: f.p.dir, encoding: 'utf8',
        input: JSON.stringify(e), timeout: 5000,
        env: { PATH: process.env.PATH, RECEPTOR_SIMULADO: JSON.stringify(f.identidade()),
          CONTEUDO_SIMULADO: conteudo, RECIBO_SIMULADO: reciboFile } });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
      assert.ok(!script.includes(conteudo));
    };
    f.ctl.confirmar = () => JSON.parse(fs.readFileSync(reciboFile, 'utf8')) as ConfirmacaoSessao;
    const p = f.abrir();
    assert.equal(f.abrir().id, p.id);
    const r = f.resposta(p.id);
    assert.equal(responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando).repetida, false);
    f.mudar({ estado: 'working' });
    assert.equal(responderSessao(f.p.dir, f.t.id, p.id, r, undefined, quando).repetida, true);
    assert.equal(responderSessao(f.p.dir, f.t.id, p.id, r, undefined, '2026-09-09T07:00:00.000Z').repetida, true);
    assert.equal(envios, 1);
    const eventos = lerLedger(f.dir);
    assert.equal(eventos.filter(e => e.tipo === 'hitl_requested').length, 1);
    assert.equal(eventos.filter(e => e.tipo === 'session_answered').length, 1);
    assert.equal(eventos.filter(e => e.tipo === 'human_gate').length, 0);
    assert.ok(!fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8').includes(conteudo));
    assert.ok(!fs.readFileSync(reciboFile, 'utf8').includes(conteudo));
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, f.resposta(p.id, { resposta: 'outra' }), f.ctl, quando), /divergente/);
    assert.throws(() => responderGate(f.p.dir, f.t.id, p.id, r, quando), /destina-se à sessão/);
  } finally { f.limpar(); }
});

test('SIMULADO: identidade, prompt, consulta e envelope incorretos recusam antes de enviar', () => {
  const f = fixture();
  try {
    const p = f.abrir(), r = f.resposta(p.id), inicial = { ...f.identidade() };
    for (const mudanca of [{ sessionId: 'alheia' }, { cwd: '/alheio' }, { instancia: 'outra' },
      { bloqueio: 'outro-prompt' }, { estado: 'working' }, { runtime: 'codex' }]) {
      f.mudar(mudanca);
      assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando));
      f.mudar(inicial);
    }
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, { ...r, prova: '0'.repeat(64) }, f.ctl, quando), /autenticada/);
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, f.resposta(p.id, { por: 'telegram:999' }), f.ctl, quando), /proveniência/);
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, f.resposta(p.id, { recebidoEm: '2026-09-08T08:01:00.000Z', mensagem: 'telegram:-7:expirada' }), f.ctl, '2026-09-08T08:01:00.000Z'), /expirado/);
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, { ...f.ctl, consultar: () => ({ ok: false, sessoes: [] }) }, quando), /consulta falhou/);
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, { ...f.ctl,
      consultar: () => ({ ok: true, sessoes: [inicial, inicial] }) }, quando), /exatos/);
    let consultas = 0;
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, { ...f.ctl,
      consultar: () => ({ ok: true, sessoes: [{ ...inicial, bloqueio: consultas++ ? 'novo' : inicial.bloqueio }] }) }, quando), /mudou/);
    assert.equal(f.envios.length, 0);
    assert.ok(!lerLedger(f.dir).some(e => e.tipo === 'session_answer_sending'));
  } finally { f.limpar(); }
});

test('SIMULADO: confirmação perdida ou divergente mantém intenção e só consulta, nunca reenvia', () => {
  const f = fixture();
  try {
    const p = f.abrir(), r = f.resposta(p.id);
    const confirmar = f.ctl.confirmar!;
    f.ctl.confirmar = () => null;
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando), /não confirmou/);
    const ack = confirmar({} as Omit<EntregaSessao, 'resposta'>)!;
    const variantes: Partial<ConfirmacaoSessao>[] = [{ envioId: 'outro' }, { pedidoId: 'outro' },
      { thread: 'outra' }, { fase: 'CHECK' }, { recibo: 'outro' }, { contrato: 'outro' as ConfirmacaoSessao['contrato'] },
      ...[{ sessionId: 'outro' }, { runtime: 'codex' }, { instancia: 'outro' }, { cwd: '/outro' }, { bloqueio: 'outro' }]
        .map(m => ({ sessao: { ...ack.sessao, ...m } }))];
    for (const v of variantes) {
      f.ctl.confirmar = () => ({ ...ack, ...v });
      assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando), /não confirmou/);
    }
    assert.equal(f.envios.length, 1);
    assert.ok(!lerLedger(f.dir).some(e => e.tipo === 'session_answered'));
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, f.resposta(p.id, { resposta: 'outra' }), f.ctl, quando), /divergente/);
    f.ctl.confirmar = confirmar;
    f.mudar({ estado: 'working' });
    assert.equal(responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando).repetida, true);
    assert.equal(f.envios.length, 1);
  } finally { f.limpar(); }
});

test('SIMULADO: crash no envio e lock concorrente não duplicam nem vazam resposta', () => {
  const f = fixture();
  try {
    const p = f.abrir(), r = f.resposta(p.id);
    let chamadas = 0;
    f.ctl.enviar = () => { chamadas++; throw Error(conteudo); };
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando), e => e instanceof Error && /incerto/.test(e.message) && !e.message.includes(conteudo));
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando), /não confirmou/);
    assert.equal(chamadas, 1);
    comLockHitl(f.p.dir, f.t.id, () => {
      assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando), /ocupado/);
    });
    assert.equal(chamadas, 1);
  } finally { f.limpar(); }
});

test('SIMULADO: mensagem reservada por envio incerto não serve para outro pedido', () => {
  const f = fixture();
  try {
    f.ctl.confirmar = () => null;
    const primeiro = f.abrir();
    assert.throws(() => responderSessao(f.p.dir, f.t.id, primeiro.id, f.resposta(primeiro.id), f.ctl, quando), /não confirmou/);
    f.mudar({ bloqueio: 'prompt-2' });
    const segundo = f.abrir();
    assert.notEqual(segundo.id, primeiro.id);
    assert.throws(() => responderSessao(f.p.dir, f.t.id, segundo.id, f.resposta(segundo.id), f.ctl, quando), /reservada/);
    assert.equal(f.envios.length, 1);
  } finally { f.limpar(); }
});

test('SIMULADO: recibo atrasado após expiração e novo despacho só confirma o envio original', () => {
  const f = fixture();
  try {
    const p = f.abrir(), r = f.resposta(p.id), confirmar = f.ctl.confirmar!;
    f.ctl.confirmar = () => null;
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, quando), /não confirmou/);
    f.t.faseAtual = 'CHECK'; gravarThread(f.p.dir, f.t);
    registrar(f.dir, f.t.id, 'phase_dispatch', { fase: 'CHECK', sessionId: 'outra-sessao-simulada', runtime: 'claude-bg' });
    f.ctl.confirmar = confirmar;
    f.ctl.consultar = () => { throw Error('recuperação não deve procurar novo alvo'); };
    assert.equal(responderSessao(f.p.dir, f.t.id, p.id, r, f.ctl, '2026-09-09T07:00:00.000Z').repetida, true);
    assert.equal(f.envios.length, 1);
    const recibo = lerLedger(f.dir).find(e => e.tipo === 'session_answered')!;
    assert.equal(recibo.sessionId, sid);
    assert.equal(recibo.fase, 'GO');
    assert.ok(!lerLedger(f.dir).some(e => e.tipo === 'human_gate'));
  } finally { f.limpar(); }
});

test('SIMULADO: pedido exige UUID/despacho corrente e CLI recusa runtime sem controller de resposta', () => {
  for (const runtime of ['codex', 'claude-bg']) {
    const instante = new Date().toISOString(), f = fixture(runtime, instante);
    try {
      assert.throws(() => f.abrir({ consultar: f.ctl.consultar, parar: f.ctl.parar }), /runtime.unavailable/);
      const cli = path.resolve(__dirname, '../src/index.js');
      const req = spawnSync(process.execPath, [cli, 'sessions', 'request', f.t.id, sid,
        '--fase', 'GO', '--runtime', runtime, '--pergunta', 'Pergunta SIMULADA'], { cwd: f.p.dir, encoding: 'utf8', timeout: 5000 });
      assert.notEqual(req.status, 0);
      assert.match(req.stderr, /runtime.unavailable/);
      assert.ok(!lerLedger(f.dir).some(e => e.tipo === 'hitl_requested'));
      const pedido = f.abrir();
      const resposta = f.resposta(pedido.id);
      const answer = spawnSync(process.execPath, [cli, 'sessions', 'answer', f.t.id, pedido.id,
        '--stdin', '--origem', resposta.origem, '--por', resposta.por, '--mensagem', resposta.mensagem],
        { cwd: f.p.dir, encoding: 'utf8', timeout: 5000, input: JSON.stringify(resposta) });
      assert.notEqual(answer.status, 0);
      assert.match(answer.stderr, /runtime.unavailable/);
      assert.ok(!answer.stderr.includes(conteudo));
      assert.ok(!lerLedger(f.dir).some(e => e.tipo === 'session_answer_sending'));
      assert.throws(() => abrirPedidoSessao(f.p.dir, f.t.id, sid.slice(0, 8),
        { fase: 'GO', runtime, pergunta: 'SIMULADA', quando }, f.ctl), /UUID/);
      registrar(f.dir, f.t.id, 'phase_dispatch', { fase: 'GO', sessionId: 'posterior', runtime });
      assert.throws(() => f.abrir(), /despacho corrente/);
      assert.throws(() => responderSessao(f.p.dir, f.t.id, pedido.id, f.resposta(pedido.id), f.ctl, instante), /pedido antigo/);
    } finally { f.limpar(); }
  }
});

 test('F1 SIMULADO: operador não substitui pergunta, conteúdo mutado é recusado e opções nativas chegam ao receptor', () => {
  const f = fixture();
  try {
    assert.throws(() => abrirPedidoSessao(f.p.dir, f.t.id, sid, { fase: 'GO', runtime: 'claude-bg', pergunta: 'Aprovar produção?', quando }, f.ctl), /operador diverge/);
    assert.equal(lerLedger(f.dir).filter(e => e.tipo === 'hitl_requested').length, 0);
    const perguntaNativa = projetarPergunta({ isBlocking: true, questions: [{ id: 'ambiente', question: 'Qual ambiente?', options: [
      { label: 'Local', description: 'Somente fixture' }, { label: 'Teste', description: 'Teste isolado' }] }] });
    f.mudar({ perguntaNativa });
    const p = abrirPedidoSessao(f.p.dir, f.t.id, sid, { fase: 'GO', runtime: 'claude-bg', quando }, f.ctl);
    assert.equal(p.pergunta, 'Qual ambiente?'); assert.equal(p.respostaAceita.tipo, 'opcao');
    assert.deepEqual(p.opcoes.map(o => o.texto), ['Local — Somente fixture', 'Teste — Teste isolado']);
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, f.resposta(p.id, { resposta: 'aprovo tudo' }), f.ctl, quando), /opção explícita/);
    f.mudar({ perguntaNativa: { ...perguntaNativa, question: 'Mudou' } });
    assert.throws(() => responderSessao(f.p.dir, f.t.id, p.id, f.resposta(p.id, { resposta: '2' }), f.ctl, quando), /mudou/);
    f.mudar({ perguntaNativa });
    responderSessao(f.p.dir, f.t.id, p.id, f.resposta(p.id, { resposta: '2' }), f.ctl, quando);
    assert.equal(f.envios[0].resposta, 'Teste'); assert.equal(f.envios.length, 1);
    assert.equal(lerLedger(f.dir).filter(e => e.tipo === 'human_gate').length, 0);
  } finally { f.limpar(); }
});

test('O1 SIMULADO: número vira rótulo só quando o pedido aceita opção; texto livre chega literal e correlacionado', () => {
  const f = fixture();
  try {
    // (a) pergunta sem opções: aceita texto, e "12" é a resposta humana, não um índice.
    const livre = f.abrir();
    assert.equal(livre.respostaAceita.tipo, 'texto');
    assert.match(livre.recomendacao, /resposta literal, inclusive quando ela for um número/);
    assert.ok(!livre.recomendacao.includes('rótulo nativo'));
    responderSessao(f.p.dir, f.t.id, livre.id, f.resposta(livre.id, { resposta: '12', mensagem: 'telegram:-7:101' }), f.ctl, quando);
    assert.equal(f.envios.at(-1)!.resposta, '12');

    // (b) opções nativas COM isOther: o contrato continua texto, então "1" continua "1".
    const comOutro = projetarPergunta({ isBlocking: true, questions: [{ id: 'porta', question: 'Qual porta SIMULADA?',
      isOther: true, options: [{ label: 'Padrão', description: 'A porta do fixture' }, { label: 'Alternativa', description: 'Outra porta do fixture' }] }] });
    f.mudar({ bloqueio: 'prompt-2', perguntaNativa: comOutro });
    const outro = abrirPedidoSessao(f.p.dir, f.t.id, sid, { fase: 'GO', runtime: 'claude-bg', pergunta: 'Qual porta SIMULADA?', quando }, f.ctl);
    assert.equal(outro.respostaAceita.tipo, 'texto');
    assert.match(outro.recomendacao, /não um seletor/);
    assert.deepEqual(outro.opcoes.map(o => o.texto), ['Padrão — A porta do fixture', 'Alternativa — Outra porta do fixture']);
    const humana = f.resposta(outro.id, { resposta: '1', mensagem: 'telegram:-7:102' });
    responderSessao(f.p.dir, f.t.id, outro.id, humana, f.ctl, quando);
    const enviado = f.envios.at(-1)!;
    assert.equal(enviado.resposta, '1', 'texto livre numérico não pode virar rótulo de opção');
    assert.equal(enviado.pedidoId, outro.id);
    assert.equal(enviado.sessao.bloqueio, 'prompt-2');

    // (c) mesmas opções SEM isOther: aí sim o número seleciona o rótulo nativo.
    const selecao = projetarPergunta({ isBlocking: true, questions: [{ id: 'porta', question: 'Qual porta SIMULADA?',
      options: [{ label: 'Padrão', description: 'A porta do fixture' }, { label: 'Alternativa', description: 'Outra porta do fixture' }] }] });
    f.mudar({ bloqueio: 'prompt-3', perguntaNativa: selecao });
    const escolha = abrirPedidoSessao(f.p.dir, f.t.id, sid, { fase: 'GO', runtime: 'claude-bg', pergunta: 'Qual porta SIMULADA?', quando }, f.ctl);
    assert.equal(escolha.respostaAceita.tipo, 'opcao');
    assert.match(escolha.recomendacao, /rótulo nativo/);
    responderSessao(f.p.dir, f.t.id, escolha.id, f.resposta(escolha.id, { resposta: '1', mensagem: 'telegram:-7:103' }), f.ctl, quando);
    assert.equal(f.envios.at(-1)!.resposta, 'Padrão');

    // (d) repetição do mesmo pedido não reenvia e preserva a correlação já registrada.
    const antes = f.envios.length;
    const repetida = responderSessao(f.p.dir, f.t.id, outro.id, humana, f.ctl, quando);
    assert.equal(repetida.repetida, true);
    assert.equal(f.envios.length, antes);
    const respondidos = lerLedger(f.dir).filter(e => e.tipo === 'session_answered' && e.pedidoId === outro.id);
    assert.equal(respondidos.length, 1);
    assert.equal(respondidos[0].envioId, enviado.envioId);
    assert.equal(lerLedger(f.dir).filter(e => e.tipo === 'human_gate').length, 0);
  } finally { f.limpar(); }
});
