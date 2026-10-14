import type { ExecutorCi } from '../ci';
import type { ExecutorGitHub } from '../entrega-pr';
import type { ExecutorDoGh, PrDaForja } from '../parado-no-condutor';
import type { ChamadorDaApi } from './api';
import type { CheckNoCommit, PedidoMesclado, Resultado, TipoDeForja, VersaoDoServidor } from './contrato';

export type NomeDaCapacidade = 'checksNoCommit' | 'pedidoMesclado' | 'branchPadrao' | 'pontaDaBranch' | 'comparar' | 'pedidosDaBranch'
  | 'abrirPedido' | 'metadados';
/** Todas as capacidades, na ordem em que o `doctor` as mostra. */
export const CAPACIDADES: readonly NomeDaCapacidade[] = ['checksNoCommit', 'pedidoMesclado', 'branchPadrao', 'pontaDaBranch', 'comparar',
  'pedidosDaBranch', 'abrirPedido', 'metadados'];
export interface AdaptadorDeForja {
  tipo: TipoDeForja;
  /** Os checks com esse nome no commit: check-runs paginados e commit statuses; lista truncada é `forja.resposta-invalida`. */
  checksNoCommit?(e: { repository: string; sha: string; context: string; executor: ExecutorCi; host?: string }): Resultado<CheckNoCommit[]>;
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
}
