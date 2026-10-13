import type { ExecutorCi } from '../ci';
import type { CheckNoCommit, Resultado, TipoDeForja } from './contrato';

export type NomeDaCapacidade = 'checksNoCommit';
export interface AdaptadorDeForja {
  tipo: TipoDeForja;
  /** Os checks com esse nome no commit. Na fatia 1, só check-runs, numa página, como hoje. */
  checksNoCommit?(e: { repository: string; sha: string; context: string; executor: ExecutorCi }): Resultado<CheckNoCommit[]>;
}
