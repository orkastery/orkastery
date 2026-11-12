/** RM-089 F1: status local/remoto da inscrição coletiva. */
import { adesaoRedeEmpresa, avaliarCoberturaEmpresa, type ResultadoDaCobertura } from './rede-empresa-config';
import { CONTRATO_STATUS_EMPRESA, ehInscricaoDaEmpresa, ehPoliticaDaEmpresa, ehPublicacaoDaEmpresa, type InscricaoDaEmpresa,
  type StatusDaRedeEmpresa } from './rede-empresa-contrato';
import { caminhoDaPublicacao, ErroDocumentoRemotoInvalido, lerDocumentoRemoto,
  type PortaDaBranchEmpresa } from './rede-empresa-transporte';

export type StatusDaRedeEmpresaComCobertura = StatusDaRedeEmpresa & { cobertura: ResultadoDaCobertura };

export function statusDaRedeEmpresa(porta: PortaDaBranchEmpresa, inscricaoId: string, projetoRef: string,
  env: NodeJS.ProcessEnv = process.env): StatusDaRedeEmpresaComCobertura {
  const local = adesaoRedeEmpresa(inscricaoId, env);
  const ponta = porta.ler();
  const inscricaoLida = lerDocumentoRemoto(ponta, `inscricoes/${inscricaoId}.json`, ehInscricaoDaEmpresa);
  const politicaLida = lerDocumentoRemoto(ponta, 'politica.json', ehPoliticaDaEmpresa);
  const publicacaoLida = lerDocumentoRemoto(ponta, caminhoDaPublicacao(inscricaoId, projetoRef), ehPublicacaoDaEmpresa);
  if (inscricaoLida.estado === 'invalido' || politicaLida.estado === 'invalido' || publicacaoLida.estado === 'invalido') {
    throw new ErroDocumentoRemotoInvalido();
  }
  const inscricao = inscricaoLida.estado === 'presente' ? inscricaoLida.valor as InscricaoDaEmpresa : null;
  const publicacao = publicacaoLida.estado === 'presente' ? publicacaoLida.valor : null;
  const forjaAtualizada = ponta.atualizada && inscricaoLida.estado !== 'indisponivel' && politicaLida.estado !== 'indisponivel'
    && publicacaoLida.estado !== 'indisponivel';
  const politica = politicaLida.estado === 'presente' ? politicaLida.valor : undefined;
  const projectKey = publicacao && 'projectKey' in publicacao ? publicacao.projectKey : projetoRef;
  const cobertura = avaliarCoberturaEmpresa({ configurada: !!local, conferida: forjaAtualizada && !!politica,
    ...(politica ? { politica } : {}), ...(local?.politicaCache ? { cache: local.politicaCache } : {}),
    projectKey, itemId: 'RM-000', agora: new Date().toISOString() });
  return { contrato: CONTRATO_STATUS_EMPRESA, inscricaoId, estado: inscricao?.estado ?? local?.estado ?? 'ausente',
    forjaAtualizada, politicaVersao: inscricao?.politicaVersao ?? local?.politicaVersao ?? null,
    ultimaPublicacao: publicacao?.publicadoEm ?? local?.ultimaPublicacao ?? null,
    pendencia: forjaAtualizada ? local?.pendencia ?? null
      : local?.pendencia ?? { codigo: 'rede-empresa.forja-indisponivel', em: new Date().toISOString() },
    publicacao, cobertura };
}
