/**
 * I-37 (D9): a saida de um comando que falhou, pronta para ir ao ledger.
 *
 * O ledger e append-only e cresce para sempre, e ele viaja: CI, pulse, memoria. Por isso o
 * trecho e curto (1024 caracteres, o fim da saida, onde o erro mora) e passa pela mesma
 * disciplina que o nucleo ja aplica ao prompt: credencial em URL e redigida, e se qualquer
 * padrao de segredo casar, o trecho inteiro e descartado. Relatorio que imprime o segredo e
 * um segundo vazamento.
 */
import { procurarSegredos } from './policies';
import { redigirCredenciaisUrl } from './redacao-url';

export const LIMITE_DO_TRECHO = 1024;
export const LIMITE_DE_TESTES = 10;
const LIMITE_DO_NOME = 200;

/** O trecho que vai ao ledger, ou o aviso de que ele foi omitido de proposito. */
export function redigirSaida(saida: string): string {
  const redigida = redigirCredenciaisUrl(saida.trim()).slice(-LIMITE_DO_TRECHO);
  const achado = procurarSegredos(redigida)[0];
  return achado ? `[trecho omitido: padrao ${achado.nome} casou]` : redigida;
}

/**
 * Os testes que o runner reportou como reprovados, sem reexecutar nada.
 *
 * Reconhece a saida TAP do `node --test` (`not ok N - nome`, ignorando o sumario de arquivo
 * quando ha subteste) e as linhas `FAIL <arquivo>` de jest e vitest. Ate 10 nomes.
 */
export function testesQueCairam(saida: string): string[] {
  const nomes: string[] = [];
  for (const linha of saida.split('\n')) {
    const tap = /^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/.exec(linha);
    const fail = /^\s*(?:FAIL|✕|×)\s+(\S.*?)\s*$/.exec(linha);
    const nome = (tap?.[1] ?? fail?.[1] ?? '').trim();
    if (!nome || nomes.includes(nome)) continue;
    nomes.push(nome.slice(0, LIMITE_DO_NOME));
    if (nomes.length === LIMITE_DE_TESTES) break;
  }
  return nomes;
}
