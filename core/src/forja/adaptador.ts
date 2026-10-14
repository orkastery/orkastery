import type { ExecutorCi } from '../ci';
import type { ExecutorGitHub } from '../entrega-pr';
import type { ExecutorDoGh, PrDaForja } from '../parado-no-condutor';
import type { ChamadorDaApi } from './api';
import type { CheckNoCommit, ChecksDoCommit, ForjaResolvida, PedidoMesclado, Resultado, TipoDeForja, VersaoDoServidor } from './contrato';

export type NomeDaCapacidade = 'checksNoCommit' | 'estadoDeCi' | 'pedidoMesclado' | 'branchPadrao' | 'pontaDaBranch' | 'comparar'
  | 'pedidosDaBranch' | 'abrirPedido' | 'metadados' | 'pedidosAbertos';
/** Todas as capacidades, na ordem em que o `doctor` as mostra. */
export const CAPACIDADES: readonly NomeDaCapacidade[] = ['checksNoCommit', 'estadoDeCi', 'pedidoMesclado', 'branchPadrao', 'pontaDaBranch',
  'comparar', 'pedidosDaBranch', 'abrirPedido', 'metadados', 'pedidosAbertos'];

/** A leitura da CI pela API da forja ja resolvida. `edicao` vem dos metadados (`null`: desconhecida). */
export interface EntradaDoEstadoDeCi { api: ChamadorDaApi; repo: string; sha: string; context: string; edicao: VersaoDoServidor['edicao'] }

export interface AdaptadorDeForja {
  tipo: TipoDeForja;
  /** Os checks com esse nome no commit: check-runs paginados e commit statuses; lista truncada é `forja.resposta-invalida`. */
  checksNoCommit?(e: { repository: string; sha: string; context: string; executor: ExecutorCi; host?: string }): Resultado<CheckNoCommit[]>;
  /** Os checks com esse nome no commit, pela API da forja ja resolvida, e se houve resultado mesclado sem vinculo com ele. */
  estadoDeCi?(e: EntradaDoEstadoDeCi): Resultado<ChecksDoCommit>;
  /** O PR da entrega externa; `null` quando a consulta falha. */
  pedidoMesclado?(e: { repo: string; numero: number; executor: ExecutorGitHub }): PedidoMesclado | null;
  /** A branch padrão do repositório; `''` se a resposta não a traz; `null` quando a consulta falha. */
  branchPadrao?(e: { repo: string; executor: ExecutorGitHub }): string | null;
  /** O sha da ponta da branch; `null` quando a consulta falha ou não há sha válido. */
  pontaDaBranch?(e: { repo: string; branch: string; executor: ExecutorGitHub }): string | null;
  /** O status da comparação (`ahead`, `identical`, `behind`, `diverged`); `null` quando a consulta falha. */
  comparar?(e: { repo: string; de: string; ate: string; executor: ExecutorGitHub }): string | null;
  /** Os pedidos da branch na base, do mais novo para o mais velho; `erro` não nulo quando a leitura falha. */
  pedidosDaBranch?(e: { host: string; repositorio: string; base: string; branch: string; executor: ExecutorDoGh; prazoMs: number }):
    { prs: PrDaForja[]; erro: string | null };
  /** Abre o pedido da branch; devolve a saída crua da CLI. */
  abrirPedido?(e: { host: string; repositorio: string; base: string; branch: string; titulo: string; corpo: string;
    executor: ExecutorDoGh; prazoMs: number }): { status: number | null; stdout: string; stderr: string };
  /** A versao e a edicao do servidor, pela API da forja ja resolvida. */
  metadados?(e: { api: ChamadorDaApi }): Resultado<VersaoDoServidor>;
  /**
   * Os pedidos abertos na base, os recentes de qualquer estado e os das branches candidatas, para o pulse. Lista
   * cortada e `parcial` (ou a candidata em `semConferir`), nunca "sem pedido".
   */
  pedidosAbertos?(e: EntradaDosPedidosAbertos): Resultado<PedidosAbertos>;
}

/** O teto de cada lista e o prazo de cada chamada da leitura do pulse. */
export interface LimitesDosPedidos { abertos: number; recentes: number; candidatas: number; minimoDaConferenciaMs: number; prazoMs: number }

export interface EntradaDosPedidosAbertos {
  forja: ForjaResolvida;
  base: string;
  /** As branches de thread com produto publicado, conferidas uma a uma quando nao aparecem nas listas. */
  candidatas: readonly string[];
  /** A API da forja pela CLI logada (`chamadorDaApi`); o GitHub do pulse usa o `executor`. */
  api: ChamadorDaApi;
  executor: ExecutorDoGh;
  /** Quanto sobra do orcamento da leitura, em ms. */
  resta: () => number;
  orcamentoMs: number;
  limites: LimitesDosPedidos;
}

export interface PedidosAbertos { prs: PrDaForja[]; parcial: boolean; semConferir: string[] }
