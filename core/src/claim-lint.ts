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
const CORRECAO: Record<Exclude<RegraDoLint, 'ref-local-do-ramo-base'>, string> = {
  'suite-inteira': msg('pt-BR').claims.correcoesDoLint['suite-inteira'],
  'sha-intermediario': msg('pt-BR').claims.correcoesDoLint['sha-intermediario'],
  'contagem-de-commits': msg('pt-BR').claims.correcoesDoLint['contagem-de-commits'],
  'binario-rg': msg('pt-BR').claims.correcoesDoLint['binario-rg'],
  'ork-fora-do-path': msg('pt-BR').claims.correcoesDoLint['ork-fora-do-path'],
  'estado-local': msg('pt-BR').claims.correcoesDoLint['estado-local'],
  'aspas-escapadas': msg('pt-BR').claims.correcoesDoLint['aspas-escapadas'],
  'contexto-artificial': msg('pt-BR').claims.correcoesDoLint['contexto-artificial'],
  'artefato-de-fechamento': msg('pt-BR').claims.correcoesDoLint['artefato-de-fechamento'],
};

/** RM-079 F2 (D7): a marca persistida na claim enumera o conjunto realmente avaliado. */
export const REGRAS_DO_LINT_DE_CLAIM: readonly RegraDoLint[] = [
  'suite-inteira', 'sha-intermediario', 'contagem-de-commits', 'binario-rg', 'ork-fora-do-path',
  'estado-local', 'aspas-escapadas', 'contexto-artificial', 'artefato-de-fechamento',
  'ref-local-do-ramo-base',
];

/** RM-037: estes achados tornam uma claim nova inexequivel no checkout do runner. */
export const REGRAS_FATAIS_DE_CLAIM = new Set<RegraDoLint>([
  'binario-rg', 'ork-fora-do-path', 'estado-local', 'aspas-escapadas', 'ref-local-do-ramo-base',
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

/** RM-079: execucao isolada que reconstrói contexto do produto dentro da propria claim. */
const NODE_EVAL = /\bnode\b[^;&|]*(?:\s-e\b|\s--eval\b)/;
const PARSER_DE_AST = /\b(?:@babel\/parser|acorn|esprima|recast|ts-morph|typescript)\b|\b(?:createSourceFile|parseExpression|parseScript|parseModule)\s*\(/;
const EXECUCAO_ARTIFICIAL = /\brunIn(?:Context|NewContext|ThisContext)\s*\(|\bnew\s+Function\s*\(/;

/** Artefatos produzidos pelo proprio fechamento nao podem ser a fonte circular da claim. */
const ARTEFATO_DE_FECHAMENTO = /(?:^|[\s"'=])((?:\.\/)?\.ork-ci\/[\w./-]+\.json|(?:\.\/)?docs\/check\.md|(?:\.\/)?pr-body\.md|(?:\.\/)?(?:POSTMORTEM|MASTER)\.(?:json|md))(?=$|[\s"'])/;

/** Executavel em posicao de comando, no inicio ou depois de um operador do shell. */
function executavelDireto(comando: string, nome: string): RegExpExecArray | null {
  return new RegExp(`(?:^|&&|\\|\\||[;|(])\\s*(?:command\\s+|env\\s+)?(${nome})(?=\\s|$)`).exec(comando);
}

interface TokenDoShell { valor: string; substituicoes: string[] }

/** Le o corpo de `$(...)` sem executar, preservando aninhamento e aspas internas. */
function lerSubstituicao(comando: string, inicio: number): { corpo: string; fim: number } | null {
  let profundidade = 1, aspas: string | null = null;
  for (let i = inicio; i < comando.length; i++) {
    const c = comando[i];
    if (aspas) {
      if (c === aspas) aspas = null;
      else if (c === '\\' && aspas === '"') i++;
      continue;
    }
    if (c === '"' || c === "'") { aspas = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '(') profundidade++;
    else if (c === ')' && --profundidade === 0) return { corpo: comando.slice(inicio, i), fim: i };
  }
  return null;
}

/** Lexer pequeno: separa argumentos e operadores e conserva quais substituicoes o shell executa. */
function segmentosDoComando(comando: string): TokenDoShell[][] {
  const segmentos: TokenDoShell[][] = [];
  let atual: TokenDoShell[] = [], token = '', substituicoes: string[] = [], aspas: string | null = null;
  const fecharToken = () => {
    if (token) atual.push({ valor: token, substituicoes });
    token = '';
    substituicoes = [];
  };
  const fecharSegmento = () => { fecharToken(); if (atual.length) { segmentos.push(atual); atual = []; } };
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    if (aspas) {
      if (c === aspas) aspas = null;
      else if (c === '$' && comando[i + 1] === '(' && aspas === '"') {
        const lida = lerSubstituicao(comando, i + 2);
        if (lida) { token += `$(${lida.corpo})`; substituicoes.push(lida.corpo); i = lida.fim; }
        else token += c;
      }
      else if (c === '\\' && aspas === '"' && i + 1 < comando.length) token += comando[++i];
      else token += c;
      continue;
    }
    if (c === '"' || c === "'") { aspas = c; continue; }
    if (c === '$' && comando[i + 1] === '(') {
      const lida = lerSubstituicao(comando, i + 2);
      if (lida) { token += `$(${lida.corpo})`; substituicoes.push(lida.corpo); i = lida.fim; continue; }
    }
    if (/\s/.test(c)) { fecharToken(); continue; }
    if (';&|()'.includes(c)) { fecharSegmento(); continue; }
    if (c === '\\' && i + 1 < comando.length) token += comando[++i];
    else token += c;
  }
  fecharSegmento();
  return segmentos;
}

function indiceDoExecutavel(tokens: readonly TokenDoShell[]): number {
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].valor) || tokens[i].valor === 'env' || tokens[i].valor === 'command')) i++;
  return i;
}

function executavelDoSegmento(tokens: readonly TokenDoShell[]): string | null {
  const token = tokens[indiceDoExecutavel(tokens)]?.valor;
  return token ? token.split('/').at(-1) ?? null : null;
}

/** Forma original mantida como unidade mutável M3: cobre a ref exata e intervalos. */
function refLocalDoRamoBasica(token: string, ramoBase: string): boolean {
  return token === ramoBase || token.startsWith(`${ramoBase}..`) || token.endsWith(`..${ramoBase}`);
}

function refLocalDoRamo(token: string, ramoBase: string): boolean {
  return refLocalDoRamoBasica(token, ramoBase)
    || [`${ramoBase}~`, `${ramoBase}^`, `${ramoBase}:`, `${ramoBase}@{`].some((prefixo) => token.startsWith(prefixo));
}

const SUBCOMANDOS_GIT_COM_REF = new Set([
  'diff', 'log', 'show', 'rev-list', 'merge-base', 'rev-parse', 'cat-file', 'ls-tree', 'diff-tree',
  'archive', 'describe', 'name-rev', 'shortlog', 'format-patch', 'range-diff', 'cherry', 'merge-tree',
  'show-ref', 'verify-commit', 'verify-tag',
]);
const SHELLS_COM_COMANDO = new Set(['sh', 'bash', 'dash', 'ksh', 'zsh']);

/** Segmentos cujo Git e executado, sem reanalisar texto citado por outro programa. */
function segmentosGitExecutados(segmento: readonly TokenDoShell[]): readonly TokenDoShell[][] {
  if (executavelDoSegmento(segmento) === 'git') return [segmento as TokenDoShell[]];
  return [];
}

/** Ref local do ramo-base em opcao de produto ou em argumento de um comando Git. */
function refLocalDoRamoBase(comando: string, ramoBase: string): string | null {
  for (const segmento of segmentosDoComando(comando)) {
    // O texto procurado e dado do grep, mesmo quando parece um comando ou uma opcao.
    const executavel = executavelDoSegmento(segmento);
    if (['grep', 'egrep', 'fgrep'].includes(executavel ?? '')) continue;
    for (let i = 0; i < segmento.length; i++) {
      const token = segmento[i].valor;
      if (token === '--base' && segmento[i + 1]?.valor === ramoBase || token === `--base=${ramoBase}`) return ramoBase;
    }
    if (SHELLS_COM_COMANDO.has(executavel ?? '')) {
      const inicio = indiceDoExecutavel(segmento) + 1;
      const flag = segmento.findIndex((token, i) => i >= inicio && /^-[A-Za-z]*c[A-Za-z]*$/.test(token.valor));
      const ref = flag >= 0 && segmento[flag + 1]
        ? refLocalDoRamoBase(segmento[flag + 1].valor, ramoBase) : null;
      if (ref) return ref;
    }
    for (const token of segmento) {
      for (const substituicao of token.substituicoes) {
        const ref = refLocalDoRamoBase(substituicao, ramoBase);
        if (ref) return ref;
      }
    }
    for (const tokens of segmentosGitExecutados(segmento)) {
      let sub = indiceDoExecutavel(tokens) + 1;
      while (sub < tokens.length && tokens[sub].valor.startsWith('-')) {
        sub += tokens[sub].valor === '-C' || tokens[sub].valor === '--git-dir' || tokens[sub].valor === '--work-tree' ? 2 : 1;
      }
      if (!SUBCOMANDOS_GIT_COM_REF.has(tokens[sub]?.valor ?? '')) continue;
      const separador = tokens.findIndex((token, i) => i > sub && token.valor === '--');
      const argumentos = tokens.slice(sub + 1, separador < 0 ? undefined : separador);
      const ref = argumentos.map((token) => token.valor).find((token) => refLocalDoRamo(token, ramoBase));
      if (ref) return ref;
    }
  }
  return null;
}

export function analisarComando(comando: string, ramoBase?: string): AchadoDoLint[] {
  const achados: AchadoDoLint[] = [];
  const rg = executavelDireto(comando, 'rg');
  if (rg) achados.push({ regra: 'binario-rg', trecho: rg[1], correcao: CORRECAO['binario-rg'] });

  const ork = executavelDireto(comando, 'ork');
  if (ork) achados.push({ regra: 'ork-fora-do-path', trecho: ork[1], correcao: CORRECAO['ork-fora-do-path'] });

  const estado = /(?:^|[\s"'=])((?:\.\/)?\.orkastery(?:[\\/][^\s"']*)?)/.exec(comando);
  if (estado) achados.push({ regra: 'estado-local', trecho: estado[1], correcao: CORRECAO['estado-local'] });

  const aspas = /\\x(?:22|27)/i.exec(comando);
  if (aspas) achados.push({ regra: 'aspas-escapadas', trecho: aspas[0], correcao: CORRECAO['aspas-escapadas'] });

  const artificial = EXECUCAO_ARTIFICIAL.exec(comando)
    ?? (NODE_EVAL.test(comando) ? PARSER_DE_AST.exec(comando) : null);
  if (artificial) achados.push({
    regra: 'contexto-artificial', trecho: artificial[0].trim(), correcao: CORRECAO['contexto-artificial'],
  });

  const fechamento = ARTEFATO_DE_FECHAMENTO.exec(comando);
  if (fechamento) achados.push({
    regra: 'artefato-de-fechamento', trecho: fechamento[1], correcao: CORRECAO['artefato-de-fechamento'],
  });

  const refLocal = ramoBase ? refLocalDoRamoBase(comando, ramoBase) : null;
  if (refLocal && ramoBase) achados.push({
    regra: 'ref-local-do-ramo-base', trecho: refLocal, ramoBase,
    correcao: msg('pt-BR').claims.correcaoRefLocalDoRamoBase(ramoBase),
  });

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
export function analisarComandos(comandos: readonly string[], ramoBase?: string): AchadoDoLint[] {
  return comandos.flatMap((comando) => analisarComando(comando, ramoBase));
}

/** Uma linha por achado, para o terminal e para o ledger. */
export function linhaDoLintDeClaim(claimId: string, a: AchadoDoLint): string {
  // RM-061 (F3b): nome e correcao pela regra, no locale ativo. F3d (GO-FIX 1): o montador fica registrado, e o `ci prepare`,
  // que grava a linha no ledger no escopo pt-BR, a remonta no locale do comando ao imprimir.
  return textoDoCatalogo((m) => m.claims.linhaDoLint(claimId, m.claims.nomesDoLint[a.regra] ?? a.regra, a.trecho,
    a.regra === 'ref-local-do-ramo-base' && a.ramoBase
      ? m.claims.correcaoRefLocalDoRamoBase(a.ramoBase) : m.claims.correcoesDoLint[a.regra] ?? a.correcao));
}
