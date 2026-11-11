/** RM-089 F1: status local/remoto da inscrição coletiva. */
import { adesaoRedeEmpresa } from './rede-empresa-config';
import { CONTRATO_STATUS_EMPRESA, ehInscricaoDaEmpresa, ehPublicacaoDaEmpresa, type InscricaoDaEmpresa,
  type StatusDaRedeEmpresa } from './rede-empresa-contrato';
import { caminhoDaPublicacao, type PortaDaBranchEmpresa } from './rede-empresa-transporte';

const ler = <T>(texto: string | null, valido: (v: unknown) => v is T): T | null => {
  if (!texto) return null;
  try { const v = JSON.parse(texto) as unknown; return valido(v) ? v : null; } catch { return null; }
};

export function statusDaRedeEmpresa(porta: PortaDaBranchEmpresa, inscricaoId: string, projetoRef: string,
  env: NodeJS.ProcessEnv = process.env): StatusDaRedeEmpresa {
  const local = adesaoRedeEmpresa(inscricaoId, env);
  const ponta = porta.ler();
  const inscricao = ponta.atualizada
    ? ler(ponta.ler(`inscricoes/${inscricaoId}.json`), ehInscricaoDaEmpresa) as InscricaoDaEmpresa | null : null;
  const publicacao = ler(ponta.ler(caminhoDaPublicacao(inscricaoId, projetoRef)), ehPublicacaoDaEmpresa);
  return { contrato: CONTRATO_STATUS_EMPRESA, inscricaoId, estado: inscricao?.estado ?? local?.estado ?? 'ausente',
    forjaAtualizada: ponta.atualizada, politicaVersao: inscricao?.politicaVersao ?? local?.politicaVersao ?? null,
    ultimaPublicacao: publicacao?.publicadoEm ?? local?.ultimaPublicacao ?? null,
    pendencia: ponta.atualizada ? local?.pendencia ?? null
      : local?.pendencia ?? { codigo: 'rede-empresa.forja-indisponivel', em: new Date().toISOString() },
    publicacao };
}
