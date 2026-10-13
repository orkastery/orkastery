import type { ExecutorCi } from '../ci';
import type { ExecutorGitHub } from '../entrega-pr';
import type { CheckNoCommit, PedidoMesclado, Resultado, TipoDeForja } from './contrato';

export type NomeDaCapacidade = 'checksNoCommit' | 'pedidoMesclado' | 'branchPadrao' | 'pontaDaBranch' | 'comparar';
export interface AdaptadorDeForja {
  tipo: TipoDeForja;
  /** Os checks com esse nome no commit. Na fatia 1, só check-runs, numa página, como hoje. */
  checksNoCommit?(e: { repository: string; sha: string; context: string; executor: ExecutorCi }): Resultado<CheckNoCommit[]>;
  /** O PR da entrega externa; `null` quando a consulta falha. */
  pedidoMesclado?(e: { repo: string; numero: number; executor: ExecutorGitHub }): PedidoMesclado | null;
  /** A branch padrão do repositório; `''` se a resposta não a traz; `null` quando a consulta falha. */
  branchPadrao?(e: { repo: string; executor: ExecutorGitHub }): string | null;
  /** O sha da ponta da branch; `null` quando a consulta falha ou não há sha válido. */
  pontaDaBranch?(e: { repo: string; branch: string; executor: ExecutorGitHub }): string | null;
  /** O status da comparação (`ahead`, `identical`, `behind`, `diverged`); `null` quando a consulta falha. */
  comparar?(e: { repo: string; de: string; ate: string; executor: ExecutorGitHub }): string | null;
}
