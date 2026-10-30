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
import { msg, textoDoCatalogo } from './locale';

export type { AchadoDoLint, RegraDoLint };

/**
 * A correcao que vai ao `claims.jsonl` com o achado: dado gravado, sempre em pt-BR. Fatia 2 do ensaio da 0.5.0 (P6): ela
 * vale para qualquer projeto. RM-061 (F3b): o texto mora no catalogo (`claims.correcoesDoLint`), e a impressao do
 * `claims add` a mostra no locale do comando, pela regra.
 */
const CORRECAO: Record<RegraDoLint, string> = {
  'suite-inteira': msg('pt-BR').claims.correcoesDoLint['suite-inteira'],
  'sha-intermediario': msg('pt-BR').claims.correcoesDoLint['sha-intermediario'],
  'contagem-de-commits': msg('pt-BR').claims.correcoesDoLint['contagem-de-commits'],
  'binario-rg': msg('pt-BR').claims.correcoesDoLint['binario-rg'],
  'ork-fora-do-path': msg('pt-BR').claims.correcoesDoLint['ork-fora-do-path'],
  'estado-local': msg('pt-BR').claims.correcoesDoLint['estado-local'],
  'aspas-escapadas': msg('pt-BR').claims.correcoesDoLint['aspas-escapadas'],
};

/** RM-037: estes achados tornam uma claim nova inexequivel no checkout do runner. */
export const REGRAS_FATAIS_DE_CLAIM = new Set<RegraDoLint>([
  'binario-rg', 'ork-fora-do-path', 'estado-local', 'aspas-escapadas',
]);

export function regraFatalDeClaim(regra: RegraDoLint): boolean {
  return REGRAS_FATAIS_DE_CLAIM.has(regra);
}

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

/** Executavel em posicao de comando, no inicio ou depois de um operador do shell. */
function executavelDireto(comando: string, nome: string): RegExpExecArray | null {
  return new RegExp(`(?:^|&&|\\|\\||[;|(])\\s*(?:command\\s+|env\\s+)?(${nome})(?=\\s|$)`).exec(comando);
}

export function analisarComando(comando: string): AchadoDoLint[] {
  const achados: AchadoDoLint[] = [];
  const rg = executavelDireto(comando, 'rg');
  if (rg) achados.push({ regra: 'binario-rg', trecho: rg[1], correcao: CORRECAO['binario-rg'] });

  const ork = executavelDireto(comando, 'ork');
  if (ork) achados.push({ regra: 'ork-fora-do-path', trecho: ork[1], correcao: CORRECAO['ork-fora-do-path'] });

  const estado = /(?:^|[\s"'=])((?:\.\/)?\.orkastery(?:[\\/][^\s"']*)?)/.exec(comando);
  if (estado) achados.push({ regra: 'estado-local', trecho: estado[1], correcao: CORRECAO['estado-local'] });

  const aspas = /\\x(?:22|27)/i.exec(comando);
  if (aspas) achados.push({ regra: 'aspas-escapadas', trecho: aspas[0], correcao: CORRECAO['aspas-escapadas'] });

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
  // RM-061 (F3b): nome e correcao pela regra, no locale ativo. F3d (GO-FIX 1): o montador fica registrado, e o `ci prepare`,
  // que grava a linha no ledger no escopo pt-BR, a remonta no locale do comando ao imprimir.
  return textoDoCatalogo((m) => m.claims.linhaDoLint(claimId, m.claims.nomesDoLint[a.regra] ?? a.regra, a.trecho,
    m.claims.correcoesDoLint[a.regra] ?? a.correcao));
}
