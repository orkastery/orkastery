/**
 * RM-072 (D2 do dono, 24/10/2026): os dois modos do CHECK.
 *
 * O Classic Check e o CHECK de sempre: os mesmos comandos, na mesma ordem, com as mesmas ferramentas. O Agile Check
 * roda a mesma cobertura com as pecas da RM-072 (lanes em paralelo, claims contra o produto do preparo, varredura em
 * paralelo com cache) e e o padrao quando o projeto nao declara o modo. O modo da rodada vem da opcao do `ork verify`
 * (`--check`), depois do manifesto (`check.mode`), depois do padrao; o `verify_run` grava o modo e de onde ele veio, e
 * os comandos da rodada recebem o modo no ambiente (`ORK_CHECK_MODO`), para o `ork security-scan` filho rodar o mesmo.
 */

/** Os dois modos, na forma escrita no manifesto e na opcao. */
export type ModoDoCheck = 'agile' | 'classic';

/** De onde veio o modo da rodada. */
export type OrigemDoModo = 'opcao' | 'manifesto' | 'padrao';

export const MODOS_DO_CHECK: readonly ModoDoCheck[] = ['agile', 'classic'];

/** O padrao desde a versao que levar a RM-072 a producao. */
export const MODO_PADRAO: ModoDoCheck = 'agile';

/** Os nomes de produto, iguais nas duas linguas. */
export const NOME_DO_MODO: Readonly<Record<ModoDoCheck, string>> = { agile: 'Agile Check', classic: 'Classic Check' };

/** O modo da rodada no ambiente dos comandos dela. */
export const ENV_MODO_DO_CHECK = 'ORK_CHECK_MODO';

/** O arquivo onde as pecas do Agile (varredura, lanes) contam o que rodaram, em linhas JSON. */
export const ENV_RELATORIO_DO_CHECK = 'ORK_CHECK_RELATORIO';
/**
 * RM-072: quantas ferramentas a varredura do Agile roda ao mesmo tempo quando corre no grupo do verify, ao lado das
 * lanes de teste (sozinha, ela roda todas juntas).
 */
export const ENV_VARREDURA_PARALELA_DO_CHECK = 'ORK_CHECK_VARREDURA_PARALELA';

/** O modo resolvido de uma rodada, como vai ao ledger. */
export interface ModoResolvido {
  modo: ModoDoCheck;
  origem: OrigemDoModo;
  nome: string;
}

/** O modo escrito (manifesto, opcao, ambiente), sem diferenca de caixa nem espaco; `null` quando nao e um dos dois. */
export function lerModo(valor: unknown): ModoDoCheck | null {
  if (typeof valor !== 'string') return null;
  const t = valor.trim().toLowerCase();
  return (MODOS_DO_CHECK as readonly string[]).includes(t) ? (t as ModoDoCheck) : null;
}

/** A opcao vence o manifesto, e o manifesto vence o padrao. */
export function resolverModo(doManifesto: ModoDoCheck | undefined, daOpcao?: ModoDoCheck | null): ModoResolvido {
  const [modo, origem]: [ModoDoCheck, OrigemDoModo] = daOpcao ? [daOpcao, 'opcao']
    : doManifesto ? [doManifesto, 'manifesto'] : [MODO_PADRAO, 'padrao'];
  return { modo, origem, nome: NOME_DO_MODO[modo] };
}
