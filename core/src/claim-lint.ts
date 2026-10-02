/**
 * I-53 (RM-037, P6): o lint do comando de claim.
 *
 * A claim C48 foi para o bundle rodando a suite inteira do npm e derrubou 33m57s de CI no runner
 * hospedado. O conhecimento existia; faltava a regra no lugar certo. Ela mora aqui, pura e sem
 * disco, e e lida em dois pontos com severidades diferentes (D14 do PLAN da I-37):
 *
 *   regra                        `claims add`   `ci prepare`
 *   (a) suite inteira do npm     avisa          RECUSA (so em claim nascida sob a regra)
 *   (b1) SHA intermediario       avisa          avisa
 *   (b2) contagem de commits     avisa          avisa
 *
 * Toda claim nova nasce com o campo `lint` (vazio quando nada casou). E ele que separa a claim
 * nascida sob a regra da claim antiga: a antiga so recebe aviso, porque corrigir claim de thread
 * alheia e mexer em estado de quem nao pediu (D16). Nada de data de corte no codigo.
 */

import { AchadoDoLint, RegraDoLint } from './types';

export type { AchadoDoLint, RegraDoLint };

const CORRECAO: Record<RegraDoLint, string> = {
  // Fatia 2 do ensaio da 0.5.0 (P6): a correcao vale para qualquer projeto; o script do Orkastery saiu daqui.
  'suite-inteira': 'rode só o teste da claim (`node --test` no arquivo do teste, ou o comando do projeto que roda um arquivo) ' +
    'ou um script hermético do projeto',
  'sha-intermediario': 'ancore na base (`git diff "$(git merge-base origin/main HEAD)" HEAD`) ou prove ancestralidade com `git merge-base --is-ancestor <sha> HEAD`',
  'contagem-de-commits': 'use `git merge-base --is-ancestor <commit> HEAD`: contagem de commits quebra com rebase e merge',
};

/**
 * (a) `npm [--prefix <dir>] [run] test` sem subcomando (`test:ci` nao casa) e sem arquivos
 * nomeados depois de `--` (o comando que nomeia `.test.ts`/`.js` depois de `--` e focado).
 */
const SUITE_INTEIRA = /\bnpm\s+(?:(?:--prefix|-C)\s+\S+\s+)?(?:run\s+|run-script\s+)?test(?![\w:.-])(?!\s+--\s+\S*\.test\.(?:ts|js|mjs|cjs|tsx)\b)/;

/** (b1) Hash de 7 a 40 hex com letra e digito, em comando que cita `git`. */
const HASH = /\b[0-9a-f]{7,40}\b/g;
const SO_ANCESTRALIDADE = /merge-base\s+--is-ancestor\s+\S+\s+\S+/g;

/** (b2) Contagem de commits comparada a um numero. */
const CONTAGEM = /rev-list\s+(?:[^|;&]*\s)?--count\b|\bgit\s+log\b[^|;&]*\|\s*wc\s+-l\b/;
const COMPARACAO = /-(?:eq|ne|gt|lt|ge|le)\s+['"]?\d|[^=!<>]==?\s*['"]?\d|grep\s+-(?:q?x|xq)\s+['"]?\d/;

export function analisarComando(comando: string): AchadoDoLint[] {
  const achados: AchadoDoLint[] = [];
  const suite = SUITE_INTEIRA.exec(comando);
  if (suite) achados.push({ regra: 'suite-inteira', trecho: suite[0].trim(), correcao: CORRECAO['suite-inteira'] });

  if (/\bgit\b/.test(comando)) {
    const semAncestralidade = comando.replace(SO_ANCESTRALIDADE, ' ');
    const hash = [...semAncestralidade.matchAll(HASH)].map((m) => m[0]).find((t) => /\d/.test(t) && /[a-f]/.test(t));
    if (hash) achados.push({ regra: 'sha-intermediario', trecho: hash, correcao: CORRECAO['sha-intermediario'] });
  }

  const contagem = CONTAGEM.exec(comando);
  if (contagem && COMPARACAO.test(comando)) {
    achados.push({ regra: 'contagem-de-commits', trecho: contagem[0].trim(), correcao: CORRECAO['contagem-de-commits'] });
  }
  return achados;
}

/** O lint de todos os comandos de uma claim, na ordem. */
export function analisarComandos(comandos: readonly string[]): AchadoDoLint[] {
  return comandos.flatMap(analisarComando);
}

/** Uma linha por achado, para o terminal e para o ledger. */
export function linhaDoLintDeClaim(claimId: string, a: AchadoDoLint): string {
  const nome = { 'suite-inteira': 'roda a suite inteira', 'sha-intermediario': 'fixa um SHA intermediario',
    'contagem-de-commits': 'compara contagem de commits' }[a.regra];
  return `${claimId} ${nome} (${a.trecho}); ${a.correcao}`;
}
