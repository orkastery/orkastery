/** Exercícios SIMULADOS em sandbox; não representam resposta humana ou rede Telegram. */
import type { Canario } from './canarios';
import { sandboxGit } from './sandbox';
import { novaThread, dirThread } from './thread';
import { registrar, lerLedger } from './ledger';
import { aprovarGateHumano } from './gates';
import { abrirPedidoGate, assinaturaDaResposta, responderGate } from './hitl-gates';
import { montarPulse } from './pulse';
import { responderGateLocal } from './hitl-gates';
import { contextoHitl } from './hitl-gates';
import { hashPedidoLocal, registrarAtestadoLocal } from './hitl-local-atestado';
import { canaisHomologados, canalDaResposta, conferirRegistro, ofertaDeCanais, recusarIngressoNaoHomologado } from './hitl-canais';

export const CANARIOS_HITL: readonly Canario[] = [
  { id: 'fx-blanket-approve', sobre: 'SIMULADO: aprovação cega e envelope sem autenticação são recusados', precisaDeGit: true, rodar: () => {
    const s = sandboxGit('blanket-approve');
    try {
      let recusas = 0, humanos = 0;
      for (const modo of ['classic'] as const) {
        const t = novaThread(s.carregado, { nome: modo, modo }).thread;
        registrar(dirThread(s.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
        const p = abrirPedidoGate(s.dir, t.id);
        try { aprovarGateHumano(s.dir, t.id, 'push', 'modelo'); } catch { recusas++; }
        try { responderGate(s.dir, t.id, p.id, { origem: 'telegram', por: 'telegram:42', mensagem: 'telegram:-7:1',
          recebidoEm: new Date().toISOString(), resposta: '1', prova: '0'.repeat(64) }); } catch { recusas++; }
        humanos += lerLedger(dirThread(s.dir, t.id)).filter(e => e.tipo === 'human_gate').length;
      }
      return { simulado: true, recusas, humanos };
    } finally { s.limpar(); }
  } },
  { id: 'fx-auto-quiet', sobre: 'SIMULADO: Auto/Maestro silenciosos fora de pausas; policy bloqueia', precisaDeGit: true, rodar: () => {
    const s = sandboxGit('auto-quiet');
    try {
      let pedidosRecusados = 0;
      for (const modo of ['auto', 'maestro'] as const) {
        const t = novaThread(s.carregado, { nome: modo, modo }).thread;
        // Registro histórico incorreto não se sobrepõe ao contrato do modo corrente.
        registrar(dirThread(s.dir, t.id), t.id, 'human_gate', { fase: 'GOAL', estado: 'prevista ao fim do bloco' });
        try { abrirPedidoGate(s.dir, t.id); } catch { pedidosRecusados++; }
      }
      const consulta = { ok: true, sessoes: [], detalhe: 'runtime SIMULADO' };
      const antes = montarPulse(s.carregado, { consulta }).resumo.humanos;
      const t = novaThread(s.carregado, { nome: 'policy', modo: 'auto' }).thread;
      registrar(dirThread(s.dir, t.id), t.id, 'gate_blocked', { fase: 'GOAL', motivo: 'policy.violation' });
      const depois = montarPulse(s.carregado, { consulta });
      return { simulado: true, pedidosRecusados, humanosSemEscalacao: antes,
        policyPreservada: depois.precisaDeHumanoAgora.some(i => i.thread === t.id && i.motivo === 'policy.violation') };
    } finally { s.limpar(); }
  } },
  // O transporte de cada canal tem teste proprio; aqui o alvo e o RECIBO: os quatro
  // precisam responder e ficar distinguiveis depois, que e o que D12 exige.
  { id: 'fx-omnicanal', sobre: 'SIMULADO: os quatro canais respondem e ficam distinguiveis no recibo', precisaDeGit: true, rodar: () => {
    const s = sandboxGit('omnicanal');
    // FX1: cada canal de telegram tem a SUA chave; o canario nunca compartilha segredo.
    const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_INGRESS_KEY_OPENCLAW',
      'ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS',
      'ORK_HITL_ROOT', 'ORK_HITL_TELEGRAM_BOT_ID'];
    const antigos = nomes.map(n => process.env[n]);
    const chaves: Record<string, string> = { hermes: 'chave-SIMULADA-do-canario-hermes-00000000',
      openclaw: 'chave-SIMULADA-do-canario-openclaw-000000' };
    // FX5: so o OpenClaw tem conta homologada, e ela entra no corpo assinado.
    const conta = 'conta-SIMULADA-do-canario-openclaw';
    [chaves.hermes, chaves.openclaw, conta, '42', '-7', '/tmp/ork-hitl-canario', '999']
      .forEach((v, i) => { process.env[nomes[i]] = v; });
    try {
      const registro = conferirRegistro();
      // Um gate por canal: a mensagem do Telegram nao se repete entre pedidos.
      const gate = (nome: string) => {
        const t = novaThread(s.carregado, { nome, modo: 'classic' }).thread;
        registrar(dirThread(s.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
        return { t, pedido: abrirPedidoGate(s.dir, t.id) };
      };
      const recibos: Record<string, unknown> = {};
      for (const canal of ['hermes', 'openclaw'] as const) {
        const { t, pedido } = gate(canal);
        const base = { resposta: '1', origem: 'telegram' as const, canal, por: 'telegram:42',
          mensagem: `telegram:-7:${canal}`, recebidoEm: new Date().toISOString(),
          ...(canal === 'openclaw' ? { conta } : {}) };
        responderGate(s.dir, t.id, pedido.id, { ...base, prova: assinaturaDaResposta(t.id, pedido.id, base, chaves[canal]) });
        recibos[canal] = lerLedger(dirThread(s.dir, t.id)).find(e => e.tipo === 'human_gate');
      }
      for (const canal of ['claude-code', 'codex'] as const) {
        const { t, pedido } = gate(canal);
        // Atestado da conexao, como o servidor MCP emite depois de uma elicitation viva.
        const token = Object.freeze({});
        registrarAtestadoLocal(token, { raiz: s.dir, thread: t.id, pedidoId: pedido.id,
          contexto: contextoHitl(s.dir, t.id), pedidoSha256: hashPedidoLocal(pedido), host: canal,
          connectionId: `conn-${canal}`, requestId: `req-${canal}`, opcao: '1',
          recebidoEm: new Date().toISOString(), alvo: 'gate' });
        responderGateLocal(s.dir, t.id, pedido.id, token);
        recibos[canal] = lerLedger(dirThread(s.dir, t.id)).find(e => e.tipo === 'human_gate');
      }
      // Os quatro responderam, e o recibo de cada um nomeia o seu canal.
      const canais = canaisHomologados().map(c => c.canal);
      const aprovados = canais.filter(c => (recibos[c] as { estado?: string } | undefined)?.estado === 'aprovado');
      const lidos = canais.map(c => canalDaResposta((recibos[c] ?? {}) as Record<string, unknown>).canal);
      // Recusas: aprovacao cega, ingresso nao homologado e canal de outro transporte.
      let recusas = 0;
      const { t: tr, pedido: pr } = gate('recusas');
      try { aprovarGateHumano(s.dir, tr.id, 'push', 'modelo'); } catch { recusas++; }
      try { recusarIngressoNaoHomologado('transcrito-de-tool'); } catch { recusas++; }
      const trocado = { resposta: '1', origem: 'telegram' as const, canal: 'codex' as 'hermes',
        por: 'telegram:42', mensagem: 'telegram:-7:trocado', recebidoEm: new Date().toISOString() };
      try { responderGate(s.dir, tr.id, pr.id, { ...trocado, prova: assinaturaDaResposta(tr.id, pr.id, trocado, chaves.hermes) }); } catch { recusas++; }
      // FX1: chave de um canal nao autentica envelope do outro, mesmo com tudo mais correto.
      const cruzado = { resposta: '1', origem: 'telegram' as const, canal: 'openclaw' as const, conta,
        por: 'telegram:42', mensagem: 'telegram:-7:cruzado', recebidoEm: new Date().toISOString() };
      try { responderGate(s.dir, tr.id, pr.id, { ...cruzado, prova: assinaturaDaResposta(tr.id, pr.id, cruzado, chaves.hermes) }); } catch { recusas++; }
      // FX5: conta fora da allowlist do canal, com assinatura correta, tambem e recusada.
      const outraConta = { ...cruzado, conta: 'conta-nao-autorizada', mensagem: 'telegram:-7:conta' };
      try { responderGate(s.dir, tr.id, pr.id, { ...outraConta, prova: assinaturaDaResposta(tr.id, pr.id, outraConta, chaves.openclaw) }); } catch { recusas++; }
      const semIngresso = lerLedger(dirThread(s.dir, tr.id)).filter(e => e.tipo === 'human_gate').length;
      // Oferta ao humano: com credencial e conexoes, os quatro ficam disponiveis.
      const oferta = ofertaDeCanais({ env: process.env as Record<string, string | undefined>,
        conexoesMcp: ['claude-code', 'codex'] });
      return { simulado: true, canaisRegistrados: registro.canais, transportes: registro.transportes,
        chavesIndependentes: registro.chaves,
        aprovados: aprovados.length, canaisDistinguiveis: new Set(lidos).size,
        canalPorInferencia: lidos.filter(c => c === null).length,
        recusas, humanosSemIngresso: semIngresso,
        ofertaDisponivel: oferta.filter(o => o.estado === 'disponivel').length };
    } finally {
      nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
      s.limpar();
    }
  } },
];
