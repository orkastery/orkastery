/** RM-089 F7: contrato do transporte autenticado e projeção sanitizada para o runner. */
import { CONTRATO_CAPACIDADE_RUNNER_EXCECAO, CONTRATO_PROVA_NOTIFICACAO_EXCECAO,
  validarProvaDaExcecaoNoRunner, type BlocoDaExcecaoNoRunner, type CapacidadeDoRunnerParaExcecao,
  type ProvaProtegidaDaNotificacao } from './excecao-notificacao';
import type { ConfiguracaoPublicaDoTransporteCi, PoliticaDeReciboCi } from './types';

export const CONTRATO_TRANSPORTE_EXCECAO_RUNNER = 'ork.excecao-transporte-runner/v1' as const;
export const CONTRATO_RESULTADO_TRANSPORTE_EXCECAO = 'ork.excecao-transporte-resultado/v1' as const;
export const AUDIENCIA_FABRICA_CI = 'urn:orkastery:fabrica:ci' as const;

export interface TransporteDaExcecaoDoRunner {
  contrato: typeof CONTRATO_TRANSPORTE_EXCECAO_RUNNER;
  proof: ProvaProtegidaDaNotificacao;
  capability: CapacidadeDoRunnerParaExcecao;
}

export type CausaDeConsultaDoTransporte = 'ausente' | 'indisponivel' | 'timeout';
export type CodigoDoTransporteDaExcecao = 'ci.excecao.transporte-invalido'
  | 'ci.recibo.ausente'
  | 'ci.excecao.transporte-indisponivel'
  | 'ci.excecao.transporte-prazo-excedido';

export type RespostaBrutaDoTransporte = { estado: CausaDeConsultaDoTransporte } | TransporteDaExcecaoDoRunner;

export type ResultadoSanitizadoDoTransporte = {
  contrato: typeof CONTRATO_RESULTADO_TRANSPORTE_EXCECAO;
  aplicado: true;
  exception: BlocoDaExcecaoNoRunner;
} | {
  contrato: typeof CONTRATO_RESULTADO_TRANSPORTE_EXCECAO;
  aplicado: false;
  code: CodigoDoTransporteDaExcecao;
  reprova: boolean;
  avisar: boolean;
};

const CHAVES_TRANSPORTE = ['contrato', 'proof', 'capability'] as const;
const objeto = (valor: unknown): valor is Record<string, unknown> =>
  !!valor && typeof valor === 'object' && !Array.isArray(valor);
const exatas = (valor: Record<string, unknown>, chaves: readonly string[]): boolean => {
  const lidas = Object.keys(valor).sort(), esperadas = [...chaves].sort();
  return lidas.length === esperadas.length && lidas.every((chave, indice) => chave === esperadas[indice]);
};

export function configuracaoPublicaDoTransporteValida(valor: unknown): valor is ConfiguracaoPublicaDoTransporteCi {
  if (!objeto(valor) || !exatas(valor, ['contrato', 'origem', 'audiencia', 'cliente'])
      || valor.contrato !== CONTRATO_TRANSPORTE_EXCECAO_RUNNER || valor.audiencia !== AUDIENCIA_FABRICA_CI
      || typeof valor.origem !== 'string' || !/^https:\/\/(?![^/]*@)[^\s]+$/.test(valor.origem)
      || !objeto(valor.cliente) || !exatas(valor.cliente, ['versao', 'sha256'])) return false;
  return typeof valor.cliente.versao === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(valor.cliente.versao)
    && typeof valor.cliente.sha256 === 'string' && /^[a-f0-9]{64}$/.test(valor.cliente.sha256);
}

function codigoDaCausa(causa: CausaDeConsultaDoTransporte): CodigoDoTransporteDaExcecao {
  if (causa === 'ausente') return 'ci.recibo.ausente';
  if (causa === 'indisponivel') return 'ci.excecao.transporte-indisponivel';
  return 'ci.excecao.transporte-prazo-excedido';
}

export function projetarResultadoDoTransporte(resposta: unknown, nivel: PoliticaDeReciboCi,
  esperado: { project: string; source: string; target: string; head: string; operation: string },
  agora: string): ResultadoSanitizadoDoTransporte {
  if (objeto(resposta) && exatas(resposta, ['estado'])
      && (resposta.estado === 'ausente' || resposta.estado === 'indisponivel' || resposta.estado === 'timeout')) {
    return { contrato: CONTRATO_RESULTADO_TRANSPORTE_EXCECAO, aplicado: false,
      code: codigoDaCausa(resposta.estado), reprova: nivel === 'exigir', avisar: nivel === 'avisar' };
  }
  if (!objeto(resposta) || !exatas(resposta, CHAVES_TRANSPORTE)
      || resposta.contrato !== CONTRATO_TRANSPORTE_EXCECAO_RUNNER || !objeto(resposta.proof)
      || resposta.proof.schema !== CONTRATO_PROVA_NOTIFICACAO_EXCECAO || !objeto(resposta.capability)
      || resposta.capability.schema !== CONTRATO_CAPACIDADE_RUNNER_EXCECAO) {
    return { contrato: CONTRATO_RESULTADO_TRANSPORTE_EXCECAO, aplicado: false,
      code: 'ci.excecao.transporte-invalido', reprova: nivel === 'exigir', avisar: nivel === 'avisar' };
  }
  const validado = validarProvaDaExcecaoNoRunner(resposta.proof, resposta.capability, esperado, agora);
  return validado.ok
    ? { contrato: CONTRATO_RESULTADO_TRANSPORTE_EXCECAO, aplicado: true, exception: validado.exception }
    : { contrato: CONTRATO_RESULTADO_TRANSPORTE_EXCECAO, aplicado: false,
      code: 'ci.excecao.transporte-invalido', reprova: nivel === 'exigir', avisar: nivel === 'avisar' };
}
