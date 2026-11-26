/** RM-089 F7: gate GitLab. A edição Free usa conta Maintainer e merge ligado ao SHA fonte. */
import { statusDoGitlabAutorizaFabrica } from './forja/gitlab/ci';
import { pedidoDeMergeDaFabricaGitlab } from './forja/gitlab/pedidos';
import type { PoliticaDeReciboCi } from './types';

export type CodigoDoGateGitlab = 'ci.fabrica.prova-ausente' | 'ci.fabrica.regra-destino-invalida'
  | 'ci.fabrica.maintainer-adicional' | 'ci.fabrica.publicacao-recusada';
export interface MembroEfetivoGitlab { id: number; nivel: 10 | 20 | 30 | 40 | 50; }
export interface EntradaGitlabFree {
  nivel: PoliticaDeReciboCi;
  projeto: string;
  iid: number;
  origem: string;
  destino: string;
  head: string;
  headRelido: string;
  projetoOrigem: number;
  projetoDestino: number;
  estado: 'opened' | 'locked' | 'merged' | 'closed';
  divergencia: number | null;
  destinoProtegido: boolean;
  mergeNivel: number;
  pushNivel: number;
  forcePush: boolean;
  contaDaFabrica: number;
  escopoDoToken: string[];
  contaRestritaAosProjetos: boolean;
  membrosCompletos: boolean;
  membros: MembroEfetivoGitlab[];
  comparacaoCompleta: boolean;
  compareTimeout: boolean;
  baseDeMerge: string;
  commitDoVerify: string;
  destinoNaPrimeiraLeitura: string;
  destinoAntesDoEfeito: string;
  limiteDeOwnerDeclarado: boolean;
  mergeAceito?: boolean;
}
export type ResultadoGateGitlabFree = { ok: true; mesclar: boolean; diagnosticos: CodigoDoGateGitlab[];
  pedidoDeMerge: { caminho: string; corpo: { sha: string } } | null } |
  { ok: false; codigo: CodigoDoGateGitlab; diagnosticos: CodigoDoGateGitlab[] };

const SHA = /^[a-f0-9]{40}$/;
const falha = (codigo: CodigoDoGateGitlab, diagnosticos: CodigoDoGateGitlab[] = []): ResultadoGateGitlabFree =>
  ({ ok: false, codigo, diagnosticos });

export function avaliarGateGitlabFree(e: EntradaGitlabFree): ResultadoGateGitlabFree {
  const adicionais = e.membrosCompletos ? e.membros.filter((m) => m.nivel === 40 && m.id !== e.contaDaFabrica) : [];
  const diagnosticos: CodigoDoGateGitlab[] = adicionais.length ? ['ci.fabrica.maintainer-adicional'] : [];
  if (!SHA.test(e.head) || e.headRelido !== e.head || e.projetoOrigem !== e.projetoDestino || e.estado !== 'opened'
      || e.divergencia !== 0 || !e.destinoProtegido || e.mergeNivel !== 40 || e.pushNivel !== 0 || e.forcePush
      || !e.contaRestritaAosProjetos || !e.escopoDoToken.includes('api') || !e.membrosCompletos
      || !e.membros.some((m) => m.id === e.contaDaFabrica && m.nivel === 40) || !e.comparacaoCompleta
      || e.compareTimeout || e.baseDeMerge !== e.commitDoVerify || !SHA.test(e.commitDoVerify)
      || !SHA.test(e.destinoNaPrimeiraLeitura) || e.destinoNaPrimeiraLeitura !== e.destinoAntesDoEfeito
      || !e.limiteDeOwnerDeclarado) return falha('ci.fabrica.regra-destino-invalida', diagnosticos);
  if (e.nivel !== 'exigir') return { ok: true, mesclar: false, diagnosticos, pedidoDeMerge: null };
  if (e.mergeAceito === false) return falha('ci.fabrica.publicacao-recusada', diagnosticos);
  return { ok: true, mesclar: true, diagnosticos,
    pedidoDeMerge: pedidoDeMergeDaFabricaGitlab(e.projeto, e.iid, e.head) };
}

/** Export explícito para a matriz adversarial: nenhum status do GitLab autoriza. */
export const statusPositivoAutorizaGateGitlab = (): boolean =>
  statusDoGitlabAutorizaFabrica('commit-status');
