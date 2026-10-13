/**
 * RM-058 (N3): o apoio comum dos testes entre máquinas. Chaves, contas, máquinas e pedidos são SIMULADOS; as "máquinas"
 * são raízes de estado de teste, e nada toca remoto, reserva ou raiz de verdade.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { CONTRATO_ENVELOPE_V3 } from '../src/noctum-envelope';
import { OpcoesDoArco, pedidoV2, TrabalhoSimulado } from './noctum-apoio';

/** Uma chave pública Ed25519 SIMULADA e estável, derivada só do nome dado (SPKI DER em base64). */
export function chaveSimulada(semente: string): string {
  const seed = createHash('sha256').update(`chave-SIMULADA-do-teste:${semente}`).digest();
  const privada = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der', type: 'pkcs8' });
  return createPublicKey(privada).export({ format: 'der', type: 'spki' }).toString('base64');
}

export interface OpcoesDoArcoV3 extends OpcoesDoArco {
  trabalhos: Array<TrabalhoSimulado & { maquina?: string }>;
  maquinas: Array<{ nome: string; chave: string }>;
  /** As permissões no destino `exemplo/produto`; sem elas, push, PR e merge (o merge só com a vez de integrar). */
  permissoes?: string[];
  /** O limite de cada conta somando as máquinas; sem ele, o mesmo de cada máquina (o mais apertado que o contrato aceita). */
  global?: Array<{ conta: string; sessoes: number }>;
}

/** O pedido de abertura `v3`: o `v2` do apoio da N2 mais as máquinas e o limite global. Os trabalhos vêm como dados. */
export function pedidoV3(arco: string, o: OpcoesDoArcoV3): Record<string, unknown> {
  const v2 = pedidoV2(arco, o);
  const capacidade = v2.capacidade as { porConta: Array<{ conta: string; sessoes: number }> };
  return { ...v2, contrato: CONTRATO_ENVELOPE_V3, maquinas: o.maquinas.map(m => ({ ...m })),
    destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: o.permissoes ?? ['push', 'pr', 'merge'] }],
    capacidadeGlobal: { porConta: o.global ?? capacidade.porConta.map(c => ({ conta: c.conta, sessoes: c.sessoes })) } };
}
