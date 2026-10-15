/**
 * Quem pode publicar o check exigido (`ci.produtor`). Um check-run vale pelo slug do app que o publicou; um job da CI
 * da forja, pelo produtor que o adaptador da a ele (`gitlab-ci`); um commit status, pela conta que o criou: a conta de
 * um app (`<slug>[bot]`) vale pelo slug, e outra conta so com `status:<login>` na lista. Sem a lista no manifesto,
 * vale o padrao da forja.
 */
import type { Manifesto } from '../types';
import type { CheckNoCommit, TipoDeForja } from './contrato';

export const PRODUTORES_PADRAO: Readonly<Record<TipoDeForja, readonly string[]>> = {
  github: ['github-actions'],
  gitlab: ['gitlab-ci'],
};

/** Os produtores aceitos para uma forja do tipo: os do manifesto ou, sem eles, o padrao. */
export function produtoresAceitos(m: Pick<Manifesto, 'ci'>, tipo: TipoDeForja): readonly string[] {
  return m.ci.produtor ?? PRODUTORES_PADRAO[tipo];
}

/** O check veio de um produtor da lista? Produtor desconhecido (`null`) nunca e aceito. */
export function produtorAceito(c: Pick<CheckNoCommit, 'fonte' | 'produtor'>, aceitos: readonly string[]): boolean {
  if (!c.produtor) return false;
  if (c.fonte !== 'commit-status') return aceitos.includes(c.produtor);
  const app = /^(.+)\[bot\]$/.exec(c.produtor)?.[1];
  return (app !== undefined && aceitos.includes(app)) || aceitos.includes(`status:${c.produtor}`);
}

/**
 * O produtor como a pessoa o escreve em `ci.produtor` (e como o `ork ci status --json` o devolve): o slug para check-run
 * e job da forja, o slug do app para a conta `<slug>[bot]` e `status:<login>` para qualquer outra conta de commit status.
 */
export function produtorDeSaida(c: Pick<CheckNoCommit, 'fonte' | 'produtor'>): string | null {
  if (!c.produtor || c.fonte !== 'commit-status') return c.produtor;
  return /^(.+)\[bot\]$/.exec(c.produtor)?.[1] ?? `status:${c.produtor}`;
}
