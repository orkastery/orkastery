import type { AdaptadorDeForja, NomeDaCapacidade } from './adaptador';
import type { TipoDeForja } from './contrato';
import { metadadosGithub } from './github/metadados';
import { metadadosGitlab } from './gitlab/metadados';
import { contaAtualGithub, criarRepositorioPrivadoGithub, donoDaRedeColetivaGithub, donoDaRedeGithub,
  repositorioPrivadoGithub } from './github/dono-da-rede';
import { checksNoCommitGithub, estadoDeCiGithub } from './github/ci';
import { estadoDeCiGitlab } from './gitlab/ci';
import { contaAtualGitlab, criarRepositorioPrivadoGitlab, donoDaRedeGitlab, repositorioPrivadoGitlab } from './gitlab/dono-da-rede';
import { abrirPedidoGitlab, branchPadraoGitlab, compararGitlab, pedidoMescladoGitlab, pedidosDaBranchGitlab, pontaDaBranchGitlab } from './gitlab/pedidos';
import { pedidosAbertosGitlab } from './gitlab/pedidos-abertos';
import { abrirPedidoGithub, branchPadraoGithub, compararGithub, pedidoMescladoGithub, pedidosAbertosGithub, pedidosDaBranchGithub, pontaDaBranchGithub } from './github/pedidos';

const ADAPTADORES: Record<TipoDeForja, AdaptadorDeForja> = {
  github: { tipo: 'github', checksNoCommit: checksNoCommitGithub, estadoDeCi: estadoDeCiGithub,
    pedidoMesclado: pedidoMescladoGithub, branchPadrao: branchPadraoGithub, pontaDaBranch: pontaDaBranchGithub, comparar: compararGithub,
    pedidosDaBranch: pedidosDaBranchGithub, abrirPedido: abrirPedidoGithub, metadados: metadadosGithub,
    pedidosAbertos: pedidosAbertosGithub, donoDaRede: donoDaRedeGithub, contaAtual: contaAtualGithub,
    repositorioPrivado: repositorioPrivadoGithub, criarRepositorioPrivado: criarRepositorioPrivadoGithub },
  // O GitLab le a CI so pelo `estadoDeCi`: o `checksNoCommit` e o caminho antigo do executor do `gh`, e o doctor nao o cobra.
  gitlab: { tipo: 'gitlab', estadoDeCi: estadoDeCiGitlab, metadados: metadadosGitlab, pedidosAbertos: pedidosAbertosGitlab,
    donoDaRede: donoDaRedeGitlab, pedidosDaBranch: pedidosDaBranchGitlab, abrirPedido: abrirPedidoGitlab,
    pedidoMesclado: pedidoMescladoGitlab, branchPadrao: branchPadraoGitlab, pontaDaBranch: pontaDaBranchGitlab, comparar: compararGitlab,
    contaAtual: contaAtualGitlab, repositorioPrivado: repositorioPrivadoGitlab, criarRepositorioPrivado: criarRepositorioPrivadoGitlab },
};

export const adaptadorDaForja = (tipo: TipoDeForja): AdaptadorDeForja => ADAPTADORES[tipo];

/** Resolve o owner empresarial sem ampliar o contrato legado da casa pessoal no GitHub. */
export function donoDaRedeColetiva(tipo: TipoDeForja, e: Parameters<NonNullable<AdaptadorDeForja['donoDaRede']>>[0]) {
  return tipo === 'github' ? donoDaRedeColetivaGithub(e) : donoDaRedeGitlab(e);
}

export function exigirCapacidade<K extends NomeDaCapacidade>(a: AdaptadorDeForja, k: K): NonNullable<AdaptadorDeForja[K]> {
  const f = a[k];
  if (!f) throw new Error(`forja.sem-capacidade: ${a.tipo} não tem ${k}`);
  return f as NonNullable<AdaptadorDeForja[K]>;
}
