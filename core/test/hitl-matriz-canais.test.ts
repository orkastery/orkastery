/**
 * FX7: a matriz 4x2 do HITL, num caso integrado so.
 *
 * A cobertura anterior era honesta e incompleta: `hitl-canal-equivalencia` provava os dois
 * canais de Telegram SO no alvo `gate`, e `hitl-sessao-local` provava os dois canais MCP SO
 * no alvo `session`. Nenhum teste exercitava as oito combinacoes, e por isso ninguem
 * percebia que a evidencia duravel de sessao por Telegram nunca era revalidada, nem que a
 * oferta de canais so existia no canario. Uma matriz cheia tem um efeito que somas de casos
 * parciais nao tem: ela reprova a linha que falta.
 *
 * Tudo aqui e SIMULADO: nao ha rede Telegram, cliente MCP nem sessao real.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { abrirPedidoGate, assinaturaDaResposta, responderGate, RespostaHumana } from '../src/hitl-gates';
import {
  abrirPedidoSessao, ConfirmacaoSessao, ControleSessao, EntregaSessao, IdentidadeSessao, responderSessao,
} from '../src/hitl-sessions';
import { criarIngressoLocal } from '../src/hitl-local';
import { validarEvidenciaDoIngresso } from '../src/hitl-ingress-receipt';
import { validarEvidenciaLocal, validarEvidenciaLocalSessao } from '../src/hitl-local-receipt';
import { Canal, canalDaResposta, ORDEM_DOS_CANAIS, transporteDoCanal } from '../src/hitl-canais';
import { ofertaDoPedido } from '../src/hitl-presentation';
import { projetarPergunta } from '../src/adapters/codex-question';
import { EventoLedger } from '../src/types';

type Alvo = 'gate' | 'session';

const CONTA = 'conta-SIMULADA-do-openclaw';
const CHAVES: Record<string, string> = {
  hermes: 'chave-SIMULADA-exclusiva-da-matriz-hermes-00',
  openclaw: 'chave-SIMULADA-exclusiva-da-matriz-openclaw',
};
const SID = '00000000-0000-0000-0000-0000000000a1';
const TEXTO = 'RESPOSTA-SIMULADA-DA-MATRIZ 12';

function ambiente(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_INGRESS_KEY_OPENCLAW',
    'ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS',
    'ORK_HITL_ROOT', 'ORK_HITL_TELEGRAM_BOT_ID'];
  const antigos = nomes.map(n => process.env[n]);
  const valores = [CHAVES.hermes, CHAVES.openclaw, CONTA, '42', '-7', '/tmp/ork-hitl-matriz', '999'];
  nomes.forEach((n, i) => { process.env[n] = valores[i]; });
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

/** Uma thread por celula da matriz: mensagem de Telegram nao se repete entre pedidos. */
function threadDeGate(p: ProjetoDeTeste, nome: string) {
  const t = novaThread(p.carregado, { nome, modo: 'classic' }).thread;
  registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture SIMULADA' });
  return { t, pedido: abrirPedidoGate(p.dir, t.id) };
}

/** Sessao bloqueada numa pergunta nativa, com receptor SIMULADO que confirma o envio. */
function threadDeSessao(p: ProjetoDeTeste, nome: string) {
  const quando = new Date(Date.now() - 60_000).toISOString();
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  t.faseAtual = 'GO';
  t.sessoes.push({ sessionId: SID, runtime: 'claude-bg', fase: 'GO', slug: t.slug, bloco: 'GO',
    promptPath: 'simulado.md', promptSha256: '0'.repeat(64), verificada: true, despachadaEm: quando });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: SID, runtime: 'claude-bg' });
  registrar(dir, t.id, 'phase_dispatch_verified', { fase: 'GO', sessionId: SID, encontrada: true });
  const pergunta = projetarPergunta({ isBlocking: true,
    questions: [{ id: 'q1', question: 'Informe a resposta SIMULADA da matriz' }] });
  const identidade: IdentidadeSessao = { sessionId: SID, runtime: 'claude-bg', cwd: p.dir,
    estado: 'blocked', instancia: 'controller-simulado-matriz', bloqueio: 'prompt-matriz', perguntaNativa: pergunta };
  const envios: EntregaSessao[] = [];
  let ack: ConfirmacaoSessao | null = null;
  const ctl: ControleSessao = {
    consultar: () => ({ ok: true, sessoes: [{ ...identidade }] }),
    parar: () => { throw new Error('esta matriz nao para sessoes'); },
    enviar: e => { envios.push(e); const { resposta: _r, ...recibo } = e; ack = { ...recibo, estado: 'recebida' }; },
    confirmar: () => ack,
  };
  const pedido = abrirPedidoSessao(p.dir, t.id, SID, { fase: 'GO', runtime: 'claude-bg', quando }, ctl);
  return { t, pedido, ctl, envios };
}

function envelopeTelegram(canal: Canal, thread: string, pedido: string, resposta: string, mensagem: string): RespostaHumana {
  const r: Omit<RespostaHumana, 'prova'> = { resposta, origem: 'telegram', canal, por: 'telegram:42',
    mensagem, recebidoEm: new Date().toISOString(), ...(canal === 'openclaw' ? { conta: CONTA } : {}) };
  return { ...r, prova: assinaturaDaResposta(thread, pedido, r, CHAVES[canal]) };
}

/** Uma celula da matriz: o canal respondeu o alvo e deixou recibo revalidavel. */
interface Celula { canal: Canal; alvo: Alvo; evento: EventoLedger; ledger: string; revalidou: boolean }

test('FX7: os quatro canais respondem os DOIS alvos, e cada recibo revalida', async () => {
  const p = projetoTemporario('matriz-canais'), restaurar = ambiente();
  try {
    const celulas: Celula[] = [];
    for (const canal of ORDEM_DOS_CANAIS) {
      for (const alvo of ['gate', 'session'] as const) {
        const rotulo = `${canal}-${alvo}`;
        if (transporteDoCanal(canal) === 'telegram') {
          if (alvo === 'gate') {
            const { t, pedido } = threadDeGate(p, rotulo);
            responderGate(p.dir, t.id, pedido.id, envelopeTelegram(canal, t.id, pedido.id, '1', `telegram:-7:g-${canal}`));
            const evento = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === 'human_gate')!;
            celulas.push({ canal, alvo, evento, ledger: path.join(dirThread(p.dir, t.id), 'ledger.jsonl'),
              revalidou: validarEvidenciaDoIngresso(p.dir, String(t.id), evento) });
          } else {
            const { t, pedido, ctl, envios } = threadDeSessao(p, rotulo);
            responderSessao(p.dir, t.id, pedido.id,
              envelopeTelegram(canal, t.id, pedido.id, TEXTO, `telegram:-7:s-${canal}`), ctl);
            assert.equal(envios[0].resposta, TEXTO, `${rotulo}: o receptor recebe o texto literal`);
            const evento = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === 'session_answered')!;
            celulas.push({ canal, alvo, evento, ledger: path.join(dirThread(p.dir, t.id), 'ledger.jsonl'),
              revalidou: validarEvidenciaDoIngresso(p.dir, String(t.id), evento) });
          }
          continue;
        }
        // Canal MCP local: o ingresso e assincrono e o caso inteiro aguarda de verdade.
        const host = canal as 'claude-code' | 'codex';
        if (alvo === 'gate') {
          const { t, pedido } = threadDeGate(p, rotulo);
          const i = criarIngressoLocal(p.dir, { host, connectionId: `conn-${rotulo}` },
            async () => ({ action: 'accept', content: { opcao: '1' } }));
          await i.solicitar(t.id, pedido.id);
          const evento = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === 'human_gate')!;
          celulas.push({ canal, alvo, evento, ledger: path.join(dirThread(p.dir, t.id), 'ledger.jsonl'),
            revalidou: validarEvidenciaLocal(p.dir, String(t.id), evento) });
        } else {
          const { t, pedido, ctl, envios } = threadDeSessao(p, rotulo);
          const i = criarIngressoLocal(p.dir, { host, connectionId: `conn-${rotulo}` },
            async () => ({ action: 'accept', content: { opcao: TEXTO } }), { controle: ctl });
          await i.solicitar(t.id, pedido.id);
          assert.equal(envios[0].resposta, TEXTO, `${rotulo}: o receptor recebe o texto literal`);
          const evento = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === 'session_answered')!;
          celulas.push({ canal, alvo, evento, ledger: path.join(dirThread(p.dir, t.id), 'ledger.jsonl'),
            revalidou: validarEvidenciaLocalSessao(p.dir, String(t.id), evento) });
        }
      }
    }
    // As OITO celulas existem, e nenhuma e uma simplificacao da outra.
    assert.equal(celulas.length, 8);
    assert.equal(new Set(celulas.map(c => `${c.canal}:${c.alvo}`)).size, 8);
    for (const c of celulas) {
      const onde = `${c.canal}/${c.alvo}`;
      assert.ok(c.evento, `${onde}: a resposta virou evento no ledger`);
      assert.equal(c.evento.canal, c.canal, `${onde}: o recibo nomeia o canal`);
      assert.equal(canalDaResposta(c.evento).equivalencia, 'completa', `${onde}: equivalencia completa`);
      // FX4: o recibo duravel revalida nos DOIS alvos, e nao so no gate.
      assert.equal(c.revalidou, true, `${onde}: a evidencia duravel revalida`);
      // O corpo respondido nunca e persistido, em nenhuma das oito celulas.
      assert.equal(fs.readFileSync(c.ledger, 'utf8').includes(TEXTO), false, `${onde}: corpo fora do ledger`);
    }
    // Os quatro canais continuam distinguiveis dentro de cada alvo.
    for (const alvo of ['gate', 'session'] as const) {
      const canais = celulas.filter(c => c.alvo === alvo).map(c => c.evento.canal);
      assert.equal(new Set(canais).size, 4, `${alvo}: quatro canais distinguiveis`);
    }
    // Diagnostico de execucao: esta linha so existe se as oito celulas rodaram de verdade.
    // O verificador dedicado le a SAIDA, nao o codigo-fonte, para contar a matriz.
    console.log('matriz-4x2 celulas: ' + celulas.map(c => `${c.canal}/${c.alvo}`).sort().join(' '));
  } finally { restaurar(); p.limpar(); }
});

test('FX7: a oferta de canais chega a um pedido real, com pre-condicoes de verdade', () => {
  const p = projetoTemporario('matriz-oferta'), restaurar = ambiente();
  try {
    const { pedido } = threadDeGate(p, 'oferta');
    // Sem conexao MCP declarada, os dois canais locais dizem POR QUE nao servem agora.
    const semConexao = ofertaDoPedido(pedido);
    assert.deepEqual(semConexao.map(o => o.canal), [...ORDEM_DOS_CANAIS]);
    for (const o of semConexao) {
      if (transporteDoCanal(o.canal) === 'mcp-local') {
        assert.equal(o.estado, 'indisponivel');
        assert.match(o.motivo, /sem-conexao/);
      } else assert.equal(o.estado, 'disponivel', `${o.canal} tem credencial completa`);
    }
    // Com a conexao viva daquele host, ele passa a disponivel; o outro continua honesto.
    const comCodex = ofertaDoPedido(pedido, ['codex']);
    assert.equal(comCodex.find(o => o.canal === 'codex')!.estado, 'disponivel');
    assert.equal(comCodex.find(o => o.canal === 'claude-code')!.estado, 'indisponivel');
    // Credencial ausente derruba o canal de telegram correspondente, e nomeia a variavel.
    delete process.env.ORK_HITL_INGRESS_KEY_HERMES;
    const semHermes = ofertaDoPedido(pedido);
    assert.equal(semHermes.find(o => o.canal === 'openclaw')!.estado, 'disponivel');
    assert.match(semHermes.find(o => o.canal === 'hermes')!.motivo, /ORK_HITL_INGRESS_KEY_HERMES/);
  } finally { restaurar(); p.limpar(); }
});

test('FX16: chaves iguais falham no nucleo antes de gate ou sessao produzir efeito', () => {
  const p = projetoTemporario('matriz-chave-igual'), restaurar = ambiente();
  const compartilhada = 'chave-SIMULADA-igual-entre-canais-telegram-000';
  try {
    process.env.ORK_HITL_INGRESS_KEY_HERMES = compartilhada;
    process.env.ORK_HITL_INGRESS_KEY_OPENCLAW = compartilhada;

    const { t: gate, pedido: pedidoGate } = threadDeGate(p, 'chave-igual-gate');
    const baseGate: Omit<RespostaHumana, 'prova'> = { resposta: '1', origem: 'telegram', canal: 'openclaw',
      conta: CONTA, por: 'telegram:42', mensagem: 'telegram:-7:igual-gate', recebidoEm: new Date().toISOString() };
    assert.throws(() => responderGate(p.dir, gate.id, pedidoGate.id,
      { ...baseGate, prova: assinaturaDaResposta(gate.id, pedidoGate.id, baseGate, compartilhada) }),
      /material distinto/);
    assert.equal(lerLedger(dirThread(p.dir, gate.id)).filter(e => e.tipo === 'human_gate').length, 0);

    const { t: sessao, pedido: pedidoSessao, ctl, envios } = threadDeSessao(p, 'chave-igual-sessao');
    const baseSessao: Omit<RespostaHumana, 'prova'> = { resposta: TEXTO, origem: 'telegram', canal: 'hermes',
      por: 'telegram:42', mensagem: 'telegram:-7:igual-sessao', recebidoEm: new Date().toISOString() };
    assert.throws(() => responderSessao(p.dir, sessao.id, pedidoSessao.id,
      { ...baseSessao, prova: assinaturaDaResposta(sessao.id, pedidoSessao.id, baseSessao, compartilhada) }, ctl),
      /material distinto/);
    assert.equal(envios.length, 0);
    assert.equal(lerLedger(dirThread(p.dir, sessao.id))
      .filter(e => e.tipo === 'session_answer_sending' || e.tipo === 'session_answered').length, 0);
  } finally { restaurar(); p.limpar(); }
});
