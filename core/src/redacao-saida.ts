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
  // RM-037 (fatia 6): o reporter `spec`, o padrao do `node --test` 24 fora de TTY, nao imprime `not ok`;
  // os nomes moram na secao "failing tests" do fim da saida.
  if (nomes.length === 0) return falhasDeTeste(saida).map((f) => f.nome).slice(0, LIMITE_DE_TESTES);
  return nomes;
}

/** Um teste que o runner reportou como reprovado, e se a falha foi do relogio do proprio runner. */
export interface FalhaDeTeste {
  nome: string;
  /** Estouro do prazo do teste (`testTimeoutFailure`) ou cancelado porque o pai estourou. */
  relogio: boolean;
}

/** As frases do `node --test` para a falha que e do relogio, e nao da asercao. */
const ASSINATURA_DE_RELOGIO = /test timed out after \d+ms|test did not finish before its parent and was cancelled/;
const TIPO_DE_RELOGIO = /failureType:\s*'(?:testTimeoutFailure|cancelledByParent)'/;
/** O teste que so agrega os filhos (subtestes ou arquivo) nao e uma falha por si. */
const TIPO_DE_AGREGADO = /failureType:\s*'subtestsFailed'/;

/**
 * RM-037 (fatia 6): os testes reprovados, folha a folha, com a natureza da falha, para o verify saber
 * se a reprovacao e so de relogio. Le o TAP do `node --test` (o bloco YAML depois do `not ok`, pulando
 * o agregado `subtestsFailed`) e a secao "failing tests" do reporter `spec`. Outros runners (jest,
 * vitest) nao dizem a natureza: os nomes saem com `relogio: false`, e nada e atenuado.
 */
export function falhasDeTeste(saida: string): FalhaDeTeste[] {
  const linhas = saida.split('\n');
  const falhas: FalhaDeTeste[] = [];
  const somar = (nome: string, relogio: boolean) => {
    const limpo = nome.trim().slice(0, LIMITE_DO_NOME);
    if (!limpo) return;
    const ja = falhas.find((f) => f.nome === limpo);
    if (ja) ja.relogio = ja.relogio && relogio;
    else falhas.push({ nome: limpo, relogio });
  };
  for (let i = 0; i < linhas.length; i++) {
    const tap = /^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/.exec(linhas[i]);
    if (!tap) continue;
    const bloco: string[] = [];
    for (let j = i + 1; j < linhas.length && !/^\s*(?:not )?ok \d+ /.test(linhas[j]); j++) bloco.push(linhas[j]);
    const texto = bloco.join('\n');
    if (TIPO_DE_AGREGADO.test(texto)) continue;
    somar(tap[1], TIPO_DE_RELOGIO.test(texto) || ASSINATURA_DE_RELOGIO.test(texto));
  }
  const inicio = linhas.findIndex((l) => /^\s*✖ failing tests:\s*$/.test(l));
  if (inicio >= 0) {
    for (let i = inicio + 1; i < linhas.length; i++) {
      const cabeca = /^✖ (.+?)(?: \([\d.]+m?s\))?\s*$/.exec(linhas[i]);
      if (!cabeca) continue;
      const corpo: string[] = [];
      for (let j = i + 1; j < linhas.length && !/^(?:✖ |test at )/.test(linhas[j]); j++) corpo.push(linhas[j]);
      const primeira = corpo.find((l) => l.trim() !== '') ?? '';
      somar(cabeca[1], ASSINATURA_DE_RELOGIO.test(primeira));
    }
  }
  if (falhas.length === 0) {
    for (const linha of linhas) {
      const fail = /^\s*(?:FAIL|✕|×)\s+(\S.*?)\s*$/.exec(linha);
      if (fail) somar(fail[1], false);
    }
  }
  return falhas;
}
