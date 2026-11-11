/** RM-089 F1: status local/remoto da inscrição coletiva. */
import { adesaoRedeEmpresa } from './rede-empresa-config';
import { CONTRATO_STATUS_EMPRESA, ehInscricaoDaEmpresa, ehPublicacaoDaEmpresa, type InscricaoDaEmpresa,
  type StatusDaRedeEmpresa } from './rede-empresa-contrato';
import { caminhoDaPublicacao, ErroDocumentoRemotoInvalido, lerDocumentoRemoto,
  type PortaDaBranchEmpresa } from './rede-empresa-transporte';

export function statusDaRedeEmpresa(porta: PortaDaBranchEmpresa, inscricaoId: string, projetoRef: string,
  env: NodeJS.ProcessEnv = process.env): StatusDaRedeEmpresa {
  const local = adesaoRedeEmpresa(inscricaoId, env);
  const ponta = porta.ler();
  const inscricaoLida = lerDocumentoRemoto(ponta, `inscricoes/${inscricaoId}.json`, ehInscricaoDaEmpresa);
  const publicacaoLida = lerDocumentoRemoto(ponta, caminhoDaPublicacao(inscricaoId, projetoRef), ehPublicacaoDaEmpresa);
  if (inscricaoLida.estado === 'invalido' || publicacaoLida.estado === 'invalido') throw new ErroDocumentoRemotoInvalido();
  const inscricao = inscricaoLida.estado === 'presente' ? inscricaoLida.valor as InscricaoDaEmpresa : null;
  const publicacao = publicacaoLida.estado === 'presente' ? publicacaoLida.valor : null;
  const forjaAtualizada = ponta.atualizada && inscricaoLida.estado !== 'indisponivel' && publicacaoLida.estado !== 'indisponivel';
  return { contrato: CONTRATO_STATUS_EMPRESA, inscricaoId, estado: inscricao?.estado ?? local?.estado ?? 'ausente',
    forjaAtualizada, politicaVersao: inscricao?.politicaVersao ?? local?.politicaVersao ?? null,
    ultimaPublicacao: publicacao?.publicadoEm ?? local?.ultimaPublicacao ?? null,
    pendencia: forjaAtualizada ? local?.pendencia ?? null
      : local?.pendencia ?? { codigo: 'rede-empresa.forja-indisponivel', em: new Date().toISOString() },
    publicacao };
}
