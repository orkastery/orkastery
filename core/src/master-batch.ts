/**
 * Seleção humana vinculada ao conteúdo exato da proposta apresentada.
 *
 * I-43 (T8): a FILA saiu daqui. O que era `textoDoBatch` ("Fila de score: N esperando
 * o humano") deixou de existir, porque era exatamente o mecanismo que acumulava e não
 * convertia: 13 entradas esperando nota que ninguém dava.
 *
 * O que FICA é outra coisa, e a distinção importa: ratificar uma PROPOSTA explícita de
 * agente (`score_proposto`), com assinatura do conteúdo apresentado, é o caminho que o
 * digest semanal e o HITL usam quando o dono responde. Isso não é fila, é resposta a
 * um pedido específico, e a I-43 não mexe nele.
 */
import { createHash } from 'node:crypto';
import { ScoreProposto, ClasseDeFalha } from './types';
import { pendentesDeScore, exigirAutoriaHumana, preflightMaster, registrarMaster, OpcoesMaster } from './master';

export function assinaturaProposta(p: ScoreProposto): string {
  return createHash('sha256').update(JSON.stringify(p)).digest('hex');
}
export function listarBatch(raiz: string, todas = false) {
  return pendentesDeScore(raiz, todas).map(p => ({ thread: p.thread.id, nome: p.thread.nome, entregue: p.entregou,
    proposta: p.thread.score_proposto ?? null, assinatura: p.thread.score_proposto ? assinaturaProposta(p.thread.score_proposto) : null }));
}
export interface SelecaoMaster { thread: string; assinatura: string; classe?: ClasseDeFalha }
export function ratificarBatch(raiz: string, selecao: SelecaoMaster[], por: string) {
  exigirAutoriaHumana(por);
  if (!selecao.length || new Set(selecao.map(s => s.thread)).size !== selecao.length) throw new Error('selecione threads distintas explicitamente');
  const disponiveis = listarBatch(raiz);
  const planos = selecao.map(s => {
    const item = disponiveis.find(i => i.thread === s.thread);
    if (!item?.proposta || item.assinatura !== s.assinatura) throw new Error(`proposta ausente ou alterada: ${s.thread}; revise o batch`);
    const p = item.proposta;
    const opcoes: OpcoesMaster = { score: p.valor, justificativa: p.justificativa, classes: s.classe ? [s.classe] : p.classes, resumo: p.resumo, por };
    preflightMaster(raiz, s.thread, opcoes);
    return { id: s.thread, opcoes };
  });
  // Todo erro de seleção, prova, autoria, score e classe foi verificado antes de gravar.
  return planos.map(p => registrarMaster(raiz, p.id, p.opcoes));
}
