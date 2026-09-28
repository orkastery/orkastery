/** Provas exclusivamente SIMULADAS; nunca usar este helper em estado operacional. */
import { randomUUID } from 'node:crypto';
import { abrirPedidoGate, assinaturaDaResposta, responderGate } from '../src/hitl-gates';
import { dirThread, gravarThread, lerThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { Fase } from '../src/types';

/** Envelope v1 legado: sem canal, autenticado pela chave global. Nada aqui e real. */
export const CHAVE_SIMULADA = 'fixture-SIMULADA-sem-qualquer-credencial-real';
const NOMES = ['ORK_HITL_INGRESS_KEY', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];

function abrirAmbiente(): () => void {
  const antigos = NOMES.map(n => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY = CHAVE_SIMULADA;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  return () => NOMES.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

/**
 * FX2: `retry` e `ship` passaram a reconferir o MAC do ingresso no momento em que a
 * aprovacao autoriza, e nao so no momento em que ela entra no ledger. Por isso a credencial
 * precisa continuar no ambiente enquanto o teste exercita a autorizacao: sem ela a
 * aprovacao existe, mas nao prova nada, que e exatamente o comportamento desejado.
 */
export function comCredencialSimulada<T>(executar: () => T): T {
  const restaurar = abrirAmbiente();
  try { return executar(); } finally { restaurar(); }
}

export function aprovarSimulado(raiz: string, id: string, fase: Fase): void {
  comCredencialSimulada(() => {
    const t = lerThread(raiz, id); t.faseAtual = fase; gravarThread(raiz, t);
    registrar(dirThread(raiz, id), id, 'phase_result', { fase, evidencia: 'fixture SIMULADA' });
    const pedido = abrirPedidoGate(raiz, id);
    const r = { resposta: '1', origem: 'telegram' as const, por: 'telegram:42',
      mensagem: `telegram:-7:${randomUUID()}`, recebidoEm: new Date().toISOString() };
    responderGate(raiz, id, pedido.id, { ...r, prova: assinaturaDaResposta(id, pedido.id, r, CHAVE_SIMULADA) });
  });
}
