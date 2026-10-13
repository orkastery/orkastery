import type { AdaptadorDeForja, NomeDaCapacidade } from './adaptador';
import type { TipoDeForja } from './contrato';
import { checksNoCommitGithub } from './github/ci';
import { abrirPedidoGithub, branchPadraoGithub, compararGithub, pedidoMescladoGithub, pedidosDaBranchGithub, pontaDaBranchGithub } from './github/pedidos';

const ADAPTADORES: Record<TipoDeForja, AdaptadorDeForja> = {
  github: { tipo: 'github', checksNoCommit: checksNoCommitGithub,
    pedidoMesclado: pedidoMescladoGithub, branchPadrao: branchPadraoGithub, pontaDaBranch: pontaDaBranchGithub, comparar: compararGithub,
    pedidosDaBranch: pedidosDaBranchGithub, abrirPedido: abrirPedidoGithub },
  gitlab: { tipo: 'gitlab' },
};

export const adaptadorDaForja = (tipo: TipoDeForja): AdaptadorDeForja => ADAPTADORES[tipo];

export function exigirCapacidade<K extends NomeDaCapacidade>(a: AdaptadorDeForja, k: K): NonNullable<AdaptadorDeForja[K]> {
  const f = a[k];
  if (!f) throw new Error(`forja.sem-capacidade: ${a.tipo} não tem ${k}`);
  return f as NonNullable<AdaptadorDeForja[K]>;
}
