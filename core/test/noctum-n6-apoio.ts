/**
 * RM-058 (N6): o apoio comum dos testes do fechamento, da medição, do relatório e do transporte. Chaves, provas, contas,
 * sessões e transportes são SIMULADOS. O ingresso é o envelope assinado do Telegram, com a chave que o
 * `prepararIngressoSimulado` do apoio da N2 põe no processo.
 */
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { ALVO_DO_NOCTUM, enderecoDoArco } from '../src/noctum-arco';

let mensagens = 0;

/** O envelope que o gateway do Hermes assina no endereço do arco, agora (ou no instante dado). */
export function assinadoPara(arco: string, resposta: string, recebidoEm = new Date().toISOString(),
  alteracao: Partial<RespostaHumana> = {}): RespostaHumana {
  mensagens += 1;
  const chave = process.env.ORK_HITL_INGRESS_KEY_HERMES;
  if (!chave) throw new Error('teste sem o ingresso simulado: chame prepararIngressoSimulado()');
  const r = { resposta, origem: 'telegram' as const, canal: 'hermes' as const, por: 'telegram:42',
    mensagem: `telegram:-7:n6-${process.pid}-${mensagens}`, recebidoEm, ...alteracao };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_NOCTUM, enderecoDoArco(arco), r, chave) };
}

/** O instante `ms` depois de `base`, em ISO. */
export const depois = (base: string, ms: number): string => new Date(Date.parse(base) + ms).toISOString();

export const MIN = 60_000;
export const HORA = 3600_000;
