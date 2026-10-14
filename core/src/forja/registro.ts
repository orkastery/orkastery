import type { AdaptadorDeForja, NomeDaCapacidade } from './adaptador';
import type { TipoDeForja } from './contrato';
import { metadadosGithub } from './github/metadados';
import { metadadosGitlab } from './gitlab/metadados';
import { checksNoCommitGithub, estadoDeCiGithub } from './github/ci';
import { estadoDeCiGitlab } from './gitlab/ci';
import { abrirPedidoGithub, branchPadraoGithub, compararGithub, pedidoMescladoGithub, pedidosDaBranchGithub, pontaDaBranchGithub } from './github/pedidos';

const ADAPTADORES: Record<TipoDeForja, AdaptadorDeForja> = {
  github: { tipo: 'github', checksNoCommit: checksNoCommitGithub, estadoDeCi: estadoDeCiGithub,
    pedidoMesclado: pedidoMescladoGithub, branchPadrao: branchPadraoGithub, pontaDaBranch: pontaDaBranchGithub, comparar: compararGithub,
    pedidosDaBranch: pedidosDaBranchGithub, abrirPedido: abrirPedidoGithub, metadados: metadadosGithub },
  // As capacidades do GitLab entram uma a uma (CI, pulse e rede, entrega); o doctor mostra as desligadas.
  gitlab: { tipo: 'gitlab', estadoDeCi: estadoDeCiGitlab, metadados: metadadosGitlab },
};

export const adaptadorDaForja = (tipo: TipoDeForja): AdaptadorDeForja => ADAPTADORES[tipo];

export function exigirCapacidade<K extends NomeDaCapacidade>(a: AdaptadorDeForja, k: K): NonNullable<AdaptadorDeForja[K]> {
  const f = a[k];
  if (!f) throw new Error(`forja.sem-capacidade: ${a.tipo} não tem ${k}`);
  return f as NonNullable<AdaptadorDeForja[K]>;
}
