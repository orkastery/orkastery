/** D12: resposta de SESSAO pelo canal MCP local. Receptor, host e resposta SIMULADOS. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { alvoDoPedido } from '../src/hitl-contract';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { abrirPedidoGate } from '../src/hitl-gates';
import {
  abrirPedidoSessao, ConfirmacaoSessao, ControleSessao, EntregaSessao, IdentidadeSessao,
} from '../src/hitl-sessions';
import { criarIngressoLocal, RespostaElicitation } from '../src/hitl-local';
import {
  consumirAtestadoLocal, reciboDoAtestado, reciboDoMaterial, registrarAtestadoLocal,
} from '../src/hitl-local-atestado';
import { validarEvidenciaLocalSessao } from '../src/hitl-local-receipt';
import { canalDaResposta } from '../src/hitl-canais';
import { projetarPergunta } from '../src/adapters/codex-question';

const sid = '00000000-0000-0000-0000-000000000042';
// O pedido precisa estar aberto AGORA: o ingresso local confere o prazo contra o relogio.
const quando = new Date(Date.now() - 60_000).toISOString();
const TEXTO = 'RESPOSTA-LIVRE-SIMULADA ç $(nao-executar) 12';

function fixture(nome: string, opcoesNativas?: { label: string; description: string }[]) {
  const p = projetoTemporario(nome);
  const t = novaThread(p.carregado, { nome: 'sessao local simulada', modo: 'auto' }).thread;
  t.faseAtual = 'GO';
  t.sessoes.push({ sessionId: sid, runtime: 'claude-bg', fase: 'GO', slug: t.slug, bloco: 'GO',
    promptPath: 'simulado.md', promptSha256: '0'.repeat(64), verificada: true, despachadaEm: quando });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: sid, runtime: 'claude-bg' });
  registrar(dir, t.id, 'phase_dispatch_verified', { fase: 'GO', sessionId: sid, encontrada: true });
  const pergunta = projetarPergunta({ isBlocking: true,
    questions: [{ id: 'q1', question: 'Informe a resposta SIMULADA', ...(opcoesNativas ? { options: opcoesNativas } : {}) }] });
  let identidade: IdentidadeSessao = { sessionId: sid, runtime: 'claude-bg', cwd: p.dir,
    estado: 'blocked', instancia: 'controller-simulado-1', bloqueio: 'prompt-1', perguntaNativa: pergunta };
  const envios: EntregaSessao[] = [];
  let ack: ConfirmacaoSessao | null = null;
  const ctl: ControleSessao = {
    consultar: () => ({ ok: true, sessoes: [{ ...identidade }] }),
    parar: () => { throw new Error('este fluxo nao para sessoes'); },
    enviar: e => { envios.push(e); const { resposta: _r, ...recibo } = e; ack = { ...recibo, estado: 'recebida' }; },
    confirmar: () => ack,
  };
  const pedido = abrirPedidoSessao(p.dir, t.id, sid,
    { fase: 'GO', runtime: 'claude-bg', pergunta: 'Informe a resposta SIMULADA', quando }, ctl);
  return { p, t, dir, ctl, pedido, envios, limpar: () => p.limpar() };
}

const ingresso = (f: ReturnType<typeof fixture>, host: 'claude-code' | 'codex',
  responder: (pedido: unknown) => RespostaElicitation, conexao = 'conn-simulada-1') =>
  criarIngressoLocal(f.p.dir, { host, connectionId: conexao },
    async pedido => responder(pedido), { controle: f.ctl });

test('D12 sessao local: texto livre chega literal, com canal e recibo da conexao', async () => {
  const f = fixture('sessao-local-texto');
  try {
    // Pergunta nativa sem opcoes aceita TEXTO: um menu aqui mudaria a pergunta.
    assert.equal(f.pedido.respostaAceita.tipo, 'texto');
    let visto: { respostaAceita?: { tipo: string } } = {};
    const i = ingresso(f, 'claude-code', pedido => {
      visto = pedido as typeof visto;
      return { action: 'accept', content: { opcao: TEXTO } };
    });
    const r = await i.solicitar(f.t.id, f.pedido.id);
    assert.deepEqual(r, { ok: true, pedidoId: f.pedido.id, sessionId: sid, estado: 'entregue', repetida: false });
    assert.equal(visto.respostaAceita?.tipo, 'texto');
    // O receptor recebe o texto literal, inclusive terminando em numero.
    assert.equal(f.envios.length, 1);
    assert.equal(f.envios[0].resposta, TEXTO);

    const e = lerLedger(f.dir).find(x => x.tipo === 'session_answered')!;
    assert.equal(e.origem, 'mcp-local');
    assert.equal(e.canal, 'claude-code');
    assert.equal(e.autorizadoPor, 'mcp-local:claude-code');
    assert.equal(e.contratoResposta, 'ork.hitl-local-session/v1');
    assert.deepEqual(canalDaResposta(e), { canal: 'claude-code', equivalencia: 'completa', motivo: '' });
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id), e), true);

    // A resposta nao e persistida em lugar nenhum: nem ledger, nem recibo duravel.
    const recibo = fs.readFileSync(path.join(f.dir, 'hitl-ingress-local',
      path.basename(String(e.evidencia))), 'utf8');
    assert.equal(fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8').includes(TEXTO), false);
    assert.equal(recibo.includes(TEXTO), false);
    // O recibo confirmado pelo receptor amarra o CONTEUDO, nao so a conexao.
    const dados = JSON.parse(recibo).dados;
    assert.equal(dados.reciboEntrega, reciboDoMaterial(String(e.conexao), String(e.solicitacao),
      String(e.pedidoSha256), dados.respostaSha256));
    assert.equal(f.envios[0].recibo, dados.reciboEntrega);
  } finally { f.limpar(); }
});

test('D12 sessao local: opcao numerada vira rotulo nativo; Codex e Claude Code sao distinguiveis', async () => {
  const f = fixture('sessao-local-opcao', [
    { label: 'Manter', description: 'segue como esta' },
    { label: 'Reverter', description: 'volta ao anterior' },
  ]);
  try {
    assert.equal(f.pedido.respostaAceita.tipo, 'opcao');
    const i = ingresso(f, 'codex', () => ({ action: 'accept', content: { opcao: '2' } }));
    assert.equal((await i.solicitar(f.t.id, f.pedido.id)).repetida, false);
    // Em pedido de OPCAO o numero vira o rotulo nativo que a sessao ofereceu.
    assert.equal(f.envios[0].resposta, 'Reverter');
    const e = lerLedger(f.dir).find(x => x.tipo === 'session_answered')!;
    assert.equal(e.canal, 'codex');
    assert.equal(e.autorizadoPor, 'mcp-local:codex');
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id), e), true);
    // Os dois canais mcp-local nao se confundem no recibo.
    assert.notEqual(e.canal, 'claude-code');
    assert.equal(canalDaResposta(e).canal, 'codex');
    // Opcao fora do pedido e recusada.
    const g = fixture('sessao-local-opcao-invalida', [{ label: 'Unica', description: 'so essa' }]);
    try {
      const j = ingresso(g, 'codex', () => ({ action: 'accept', content: { opcao: '9' } }));
      await assert.rejects(() => j.solicitar(g.t.id, g.pedido.id), /opcao explicita|opção explícita/);
      assert.equal(lerLedger(g.dir).filter(x => x.tipo === 'session_answered').length, 0);
    } finally { g.limpar(); }
  } finally { f.limpar(); }
});

test('D12 sessao local: token e de uso unico e a repeticao nao reenvia', async () => {
  const f = fixture('sessao-local-idempotencia');
  try {
    const i = ingresso(f, 'claude-code', () => ({ action: 'accept', content: { opcao: TEXTO } }));
    assert.equal((await i.solicitar(f.t.id, f.pedido.id)).repetida, false);
    // Segunda chamada nao elicita de novo nem reenvia: le o que ja foi respondido.
    let elicitou = false;
    const j = ingresso(f, 'claude-code', () => { elicitou = true; return { action: 'accept', content: { opcao: 'outra' } }; }, 'conn-simulada-2');
    assert.deepEqual(await j.solicitar(f.t.id, f.pedido.id),
      { ok: true, pedidoId: f.pedido.id, sessionId: sid, estado: 'entregue', repetida: true });
    assert.equal(elicitou, false);
    assert.equal(f.envios.length, 1);
    assert.equal(lerLedger(f.dir).filter(x => x.tipo === 'session_answered').length, 1);
  } finally { f.limpar(); }
});

test('D12 sessao local: recusa, cancelamento e resposta acima do limite nao entregam', async () => {
  const f = fixture('sessao-local-recusas');
  try {
    for (const acao of ['decline', 'cancel'] as const) {
      const i = ingresso(f, 'codex', () => ({ action: acao }));
      assert.deepEqual(await i.solicitar(f.t.id, f.pedido.id),
        { ok: false, pedidoId: f.pedido.id, estado: 'pendente', repetida: false });
    }
    const grande = ingresso(f, 'codex', () => ({ action: 'accept', content: { opcao: 'x'.repeat(5000) } }));
    await assert.rejects(() => grande.solicitar(f.t.id, f.pedido.id), /hitl\.local\.resposta-invalida/);
    // Conteudo extra no envelope da elicitation e recusado: nada alem de `opcao`.
    const extra = ingresso(f, 'codex', () => ({ action: 'accept', content: { opcao: '1', extra: 'x' } as { opcao: string } }));
    await assert.rejects(() => extra.solicitar(f.t.id, f.pedido.id), /hitl\.local\.resposta-invalida/);
    assert.equal(f.envios.length, 0);
    assert.equal(lerLedger(f.dir).filter(x => x.tipo === 'session_answered').length, 0);
  } finally { f.limpar(); }
});

test('D12 sessao local: tamper no recibo duravel reprova a validacao', async () => {
  const f = fixture('sessao-local-tamper');
  try {
    const i = ingresso(f, 'claude-code', () => ({ action: 'accept', content: { opcao: TEXTO } }));
    await i.solicitar(f.t.id, f.pedido.id);
    const e = lerLedger(f.dir).find(x => x.tipo === 'session_answered')!;
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id), e), true);
    // Canal trocado no evento nao passa a validacao do recibo assinado.
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id),
      { ...e, autorizadoPor: 'mcp-local:codex' }), false);
    // Recibo de entrega trocado deixa de derivar do hash da resposta.
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id),
      { ...e, reciboEntrega: '0'.repeat(64) }), false);
    // Bytes do recibo alterados no disco reprovam pela assinatura.
    const arquivo = path.join(f.dir, 'hitl-ingress-local', path.basename(String(e.evidencia)));
    const original = fs.readFileSync(arquivo, 'utf8');
    const adulterado = JSON.parse(original);
    adulterado.dados.respostaSha256 = '1'.repeat(64);
    fs.writeFileSync(arquivo, JSON.stringify(adulterado) + '\n', { mode: 0o600 });
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id), e), false);
    fs.writeFileSync(arquivo, original, { mode: 0o600 });
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id), e), true);
  } finally { f.limpar(); }
});

test('D12 sessao local: o atestado e capacidade de UM uso so', () => {
  const token = Object.freeze({});
  const dados = { raiz: '/r', thread: 't', pedidoId: 'p', contexto: 'c', pedidoSha256: 'h',
    host: 'codex' as const, connectionId: 'c1', requestId: 'r1', opcao: '1',
    recebidoEm: new Date().toISOString(), alvo: 'session' as const };
  registrarAtestadoLocal(token, dados);
  // Primeiro consumo devolve o atestado inteiro.
  assert.deepEqual(consumirAtestadoLocal(token, '/r', 't', 'p'), dados);
  // O MESMO token nao serve de novo: a capacidade morre no consumo, nao no fim do fluxo.
  assert.throws(() => consumirAtestadoLocal(token, '/r', 't', 'p'), /hitl\.local\.atestado-invalido/);
  // Nem com identificadores de outra thread/pedido.
  registrarAtestadoLocal(token, dados);
  assert.throws(() => consumirAtestadoLocal(token, '/r', 'outra', 'p'), /hitl\.local\.atestado-invalido/);
  // A tentativa recusada tambem consumiu o token: nada fica reutilizavel depois de falhar.
  assert.throws(() => consumirAtestadoLocal(token, '/r', 't', 'p'), /hitl\.local\.atestado-invalido/);
  assert.throws(() => consumirAtestadoLocal({}, '/r', 't', 'p'), /hitl\.local\.atestado-invalido/);
  assert.throws(() => consumirAtestadoLocal(null, '/r', 't', 'p'), /hitl\.local\.atestado-invalido/);
});

test('D12 sessao local: canal e contrato adulterados NO LEDGER reprovam a validacao', async () => {
  const f = fixture('sessao-local-tamper-ledger');
  try {
    const i = ingresso(f, 'claude-code', () => ({ action: 'accept', content: { opcao: TEXTO } }));
    await i.solicitar(f.t.id, f.pedido.id);
    const arquivo = path.join(f.dir, 'ledger.jsonl');
    const original = fs.readFileSync(arquivo, 'utf8');
    const linhas = original.trimEnd().split('\n').map(l => JSON.parse(l));
    const alvo = linhas.findIndex(l => l.tipo === 'session_answered');
    assert.ok(alvo >= 0);
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id), linhas[alvo]), true);
    // Adulterar o ledger no disco: sem conferencia explicita, `canal` e campo livre.
    for (const mudanca of [{ canal: 'codex' }, { canal: 'hermes' }, { contratoResposta: 'ork.hitl-answer/v2' }]) {
      const falso = { ...linhas[alvo], ...mudanca };
      fs.writeFileSync(arquivo, linhas.map((l, n) => JSON.stringify(n === alvo ? falso : l)).join('\n') + '\n');
      assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id), falso), false,
        `canal/contrato adulterado passou: ${JSON.stringify(mudanca)}`);
    }
    fs.writeFileSync(arquivo, original);
    assert.equal(validarEvidenciaLocalSessao(f.p.dir, String(f.t.id), linhas[alvo]), true);
  } finally { f.limpar(); }
});

test('D12 sessao local: alvo gate nao cruza com sessao, e o recibo amarra o conteudo', () => {
  // O material do recibo muda quando a resposta muda, mesmo com conexao e pedido iguais.
  const base = { connectionId: 'c1', requestId: 'r1', pedidoSha256: 'p1' };
  assert.notEqual(reciboDoAtestado({ ...base, opcao: 'sim' }), reciboDoAtestado({ ...base, opcao: 'nao' }));
  assert.equal(reciboDoAtestado({ ...base, opcao: 'sim' }), reciboDoAtestado({ ...base, opcao: 'sim' }));
});

test('D12 sessao local: pedido de gate continua indo pelo caminho de gate', async () => {
  const p = projetoTemporario('sessao-local-gate');
  try {
    const t = novaThread(p.carregado, { nome: 'gate simulado', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture' });
    const pedido = abrirPedidoGate(p.dir, t.id, undefined, quando);
    assert.equal(alvoDoPedido(pedido)?.tipo, 'gate');
    const i = criarIngressoLocal(p.dir, { host: 'codex', connectionId: 'conn-gate' },
      async () => ({ action: 'accept', content: { opcao: '1' } }));
    const r = await i.solicitar(t.id, pedido.id) as { estado: string };
    assert.equal(r.estado, 'aprovado');
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.equal(eventos.filter(e => e.tipo === 'human_gate').length, 1);
    assert.equal(eventos.filter(e => e.tipo === 'session_answered').length, 0);
    assert.equal(eventos.find(e => e.tipo === 'human_gate')!.canal, 'codex');
  } finally { p.limpar(); }
});
