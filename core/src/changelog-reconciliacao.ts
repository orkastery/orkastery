/**
 * RM-063 (F7): a reconciliacao deterministica do CHANGELOG no merge da base na branch da thread.
 *
 * Incidente de 12 e 13/10/2026: os PRs #153 e #154 ficaram prontos e esperaram de 5 a 6 horas pelo condutor, e cada
 * merge da outra maquina na `main` reabria o conflito no CHANGELOG. Duas formas do mesmo defeito:
 *
 *  - o PR de versao troca `## Não publicado` pela secao da versao (`## [0.5.6] - ...`), e o merge da `main` na branch
 *    poe os itens da thread DENTRO da versao publicada, sem conflito nenhum; o `checar-changelog` do CI acusa
 *    `changelog.linha-ausente`;
 *  - duas threads acrescentam item no topo do mesmo grupo de `## Não publicado`, e o merge conflita so no CHANGELOG.
 *
 * O condutor resolvia a mao, com um script. Aqui a mesma regra, num lugar so e sem adivinhar: os itens que a thread
 * acrescentou a `## Não publicado` (os que nem a base comum nem a `main` tem) voltam para la, no mesmo grupo
 * (`### Adicionado`, `### Corrigido`...), no fim dele e na ordem da thread. O resto do arquivo e o da `main` (no conflito)
 * ou o do merge (sem conflito): as secoes publicadas nunca recebem nem perdem item da thread por esta funcao. Item que a
 * thread tirou de `## Não publicado` (a linha reescrita, por exemplo) sai tambem de la, e so de la.
 *
 * Funcao pura: recebe os tres textos (base comum, o da thread e o da `main`) e, quando houve, o resultado do merge sem
 * conflito. Quem roda o git e decide se o conflito e so no CHANGELOG e `conducao-batida.ts`.
 */

export const ARQUIVO_DO_CHANGELOG = 'CHANGELOG.md';
export const SECAO_NAO_PUBLICADA = '## Não publicado';
/** A ordem dos grupos que o CHANGELOG ja usa; grupo fora dela vai para o fim da secao. */
const ORDEM_DOS_GRUPOS = ['Adicionado', 'Alterado', 'Mudado', 'Corrigido', 'Removido', 'Segurança'];
const MARCADOR_DE_CONFLITO = /^(<{7}|={7}|>{7}|\|{7})( |$)/m;

interface ItemLocalizado {
  /** O titulo da secao `## ...` onde o item esta, ou `null` antes da primeira. */
  secao: string | null;
  /** O nome do grupo `### ...`, ou `null` quando o item esta solto na secao. */
  grupo: string | null;
  /** Linhas [inicio, fim) do item no texto. */
  inicio: number;
  fim: number;
  /** O item normalizado (sem espaco no fim das linhas): e a identidade dele. */
  chave: string;
}

export interface ItemDevolvido {
  grupo: string | null;
  /** A primeira linha do item, para o relatorio. */
  titulo: string;
}

export interface ReconciliacaoDoChangelog {
  texto: string;
  /** Os itens da thread que ficaram em `## Não publicado` (os que estavam fora dela e os que ja estavam). */
  itens: ItemDevolvido[];
  /** Quantos deles estavam fora de `## Não publicado` (numa versao publicada) ou ausentes, e voltaram. */
  devolvidos: number;
  mudou: boolean;
}

export interface EntradaDaReconciliacao {
  /** O CHANGELOG na base comum do merge. */
  base: string;
  /** O da thread, antes do merge. */
  nosso: string;
  /** O da base remota (a `main`). */
  deles: string;
  /** O resultado do merge sem conflito, quando houve; com marcador de conflito, ou sem ele, vale o da `main`. */
  mesclado?: string | null;
}

const ehTitulo = (l: string): boolean => /^#{1,6} /.test(l);
const ehSecao = (l: string): boolean => /^## /.test(l);
const ehGrupo = (l: string): boolean => /^### /.test(l);
const ehItem = (l: string): boolean => /^[-*] /.test(l);
const emBranco = (l: string): boolean => l.trim() === '';
const recuada = (l: string): boolean => /^\s+\S/.test(l);
const chaveDe = (linhas: readonly string[]): string => linhas.map((l) => l.trimEnd()).join('\n');

/** As linhas do texto, sem o `\r` do Windows. */
function linhasDe(texto: string): string[] {
  return texto.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Os itens de lista de primeiro nivel do CHANGELOG, com a secao e o grupo de cada um. O item vai da linha `- ` ate a
 * proxima linha que nao e continuacao dele: continuacao e a linha recuada, e a linha em branco so continua o item
 * quando a seguinte nao vazia e recuada.
 */
function itensDe(linhas: readonly string[]): ItemLocalizado[] {
  const itens: ItemLocalizado[] = [];
  let secao: string | null = null, grupo: string | null = null;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (ehSecao(l)) { secao = l.trim(); grupo = null; continue; }
    if (ehGrupo(l)) { grupo = l.replace(/^###\s+/, '').trim(); continue; }
    if (ehTitulo(l) || !ehItem(l)) continue;
    let fim = i + 1;
    while (fim < linhas.length) {
      const c = linhas[fim];
      if (recuada(c)) { fim++; continue; }
      if (emBranco(c)) {
        let k = fim;
        while (k < linhas.length && emBranco(linhas[k])) k++;
        if (k < linhas.length && recuada(linhas[k])) { fim = k; continue; }
      }
      break;
    }
    itens.push({ secao, grupo, inicio: i, fim, chave: chaveDe(linhas.slice(i, fim)) });
    i = fim - 1;
  }
  return itens;
}

/** As linhas [inicio, fim) da secao `## Não publicado`, sem o titulo; `null` sem ela. */
function faixaDaSecao(linhas: readonly string[]): { titulo: number; inicio: number; fim: number } | null {
  const titulo = linhas.findIndex((l) => l.trim() === SECAO_NAO_PUBLICADA);
  if (titulo < 0) return null;
  let fim = titulo + 1;
  while (fim < linhas.length && !ehSecao(linhas[fim])) fim++;
  return { titulo, inicio: titulo + 1, fim };
}

/** Junta as linhas em branco seguidas numa so (MD012) e tira as do inicio da secao que sobraram de uma remocao. */
function semBrancosRepetidos(linhas: readonly string[]): string[] {
  const saida: string[] = [];
  for (const l of linhas) {
    if (emBranco(l) && saida.length > 0 && emBranco(saida[saida.length - 1])) continue;
    saida.push(emBranco(l) ? '' : l);
  }
  return saida;
}

/** Tira os grupos `### ...` que ficaram sem item nenhum por causa da remocao (os que ja eram vazios ficam). */
function semGruposEsvaziados(linhas: string[], esvaziados: ReadonlySet<number>): string[] {
  const tirar = new Set<number>();
  for (const g of esvaziados) {
    let k = g + 1;
    while (k < linhas.length && emBranco(linhas[k])) k++;
    if (k >= linhas.length || ehTitulo(linhas[k])) tirar.add(g);
  }
  return linhas.filter((_, i) => !tirar.has(i));
}

/** O indice do titulo do grupo dentro da faixa, ou -1. */
function grupoNaFaixa(linhas: readonly string[], faixa: { inicio: number; fim: number }, grupo: string): number {
  for (let i = faixa.inicio; i < faixa.fim; i++) {
    if (ehGrupo(linhas[i]) && linhas[i].replace(/^###\s+/, '').trim() === grupo) return i;
  }
  return -1;
}

/** Onde o item entra no grupo: depois da ultima linha nao vazia antes do proximo titulo. */
function fimDoGrupo(linhas: readonly string[], titulo: number, limite: number): number {
  let fim = titulo + 1;
  while (fim < limite && !ehTitulo(linhas[fim])) fim++;
  while (fim > titulo + 1 && emBranco(linhas[fim - 1])) fim--;
  return fim;
}

/** Garante a secao `## Não publicado` antes da primeira versao e devolve as linhas com ela. */
function comSecao(linhas: string[]): string[] {
  if (faixaDaSecao(linhas)) return linhas;
  const primeira = linhas.findIndex((l) => ehSecao(l));
  const em = primeira < 0 ? linhas.length : primeira;
  return [...linhas.slice(0, em), SECAO_NAO_PUBLICADA, '', ...linhas.slice(em)];
}

/** Insere o item no grupo dele em `## Não publicado`, criando o grupo na ordem do CHANGELOG quando falta. */
function inserirNoGrupo(linhas: string[], grupo: string | null, item: readonly string[]): string[] {
  const faixa = faixaDaSecao(linhas)!;
  if (grupo === null) {
    // Item solto na secao (sem `###`): entra antes do primeiro grupo, depois dos soltos que ja estao la.
    let em = faixa.inicio;
    while (em < faixa.fim && !ehGrupo(linhas[em])) em++;
    while (em > faixa.inicio && emBranco(linhas[em - 1])) em--;
    return [...linhas.slice(0, em), ...(em === faixa.inicio ? [''] : []), ...item, '', ...linhas.slice(em)];
  }
  const titulo = grupoNaFaixa(linhas, faixa, grupo);
  if (titulo >= 0) {
    const em = fimDoGrupo(linhas, titulo, faixa.fim);
    const vazio = em === titulo + 1;
    return [...linhas.slice(0, em), ...(vazio ? [''] : []), ...item, ...linhas.slice(em)];
  }
  // O grupo ainda nao existe na secao: entra antes do primeiro grupo que vem depois dele na ordem conhecida.
  const ordem = (g: string): number => { const i = ORDEM_DOS_GRUPOS.indexOf(g); return i < 0 ? ORDEM_DOS_GRUPOS.length : i; };
  let em = faixa.fim;
  for (let i = faixa.inicio; i < faixa.fim; i++) {
    if (ehGrupo(linhas[i]) && ordem(linhas[i].replace(/^###\s+/, '').trim()) > ordem(grupo)) { em = i; break; }
  }
  return [...linhas.slice(0, em), '', `### ${grupo}`, '', ...item, '', ...linhas.slice(em)];
}

/** O texto tem marcador de conflito do git? */
export function temMarcadorDeConflito(texto: string): boolean {
  return MARCADOR_DE_CONFLITO.test(texto);
}

/**
 * Reconcilia o CHANGELOG depois do merge da base na branch da thread. Os itens da thread em `## Não publicado`
 * voltam para la, no mesmo grupo; o que a thread tirou de la sai de la; o resto e o da `main` ou o do merge.
 */
export function reconciliarChangelog(e: EntradaDaReconciliacao): ReconciliacaoDoChangelog {
  const base = linhasDe(e.base), nosso = linhasDe(e.nosso), deles = linhasDe(e.deles);
  const daBase = itensDe(base), dosNossos = itensDe(nosso), dosDeles = itensDe(deles);
  const chavesDaBase = new Set(daBase.map((i) => i.chave));
  const chavesDosDeles = new Set(dosDeles.map((i) => i.chave));
  // Os itens da thread: em `## Não publicado` do lado dela, e em nenhum lugar da base comum nem da `main`.
  const vistos = new Set<string>();
  const daThread = dosNossos.filter((i) => i.secao === SECAO_NAO_PUBLICADA && !chavesDaBase.has(i.chave) &&
    !chavesDosDeles.has(i.chave) && !vistos.has(i.chave) && (vistos.add(i.chave), true));
  // O que a thread tirou de `## Não publicado`: estava la na base comum e nao esta mais em lugar nenhum do lado dela.
  const chavesDosNossos = new Set(dosNossos.map((i) => i.chave));
  const tiradas = new Set(daBase.filter((i) => i.secao === SECAO_NAO_PUBLICADA && !chavesDosNossos.has(i.chave)).map((i) => i.chave));

  const textoInicial = e.mesclado && !temMarcadorDeConflito(e.mesclado) ? e.mesclado : e.deles;
  const fimDeLinha = textoInicial.endsWith('\n');
  let linhas = linhasDe(textoInicial);
  if (fimDeLinha) linhas.pop();
  const original = chaveDe(linhas);

  // 1. Tira os itens da thread de onde o merge os pos, e os tirados pela thread de `## Não publicado`. O item da thread
  // que o merge deixou em `## Não publicado`, no grupo dele, fica onde esta (a primeira vez); as outras copias saem.
  const grupoDaThread = new Map(daThread.map((i) => [i.chave, i.grupo]));
  const noLugar = new Set<string>();
  const remover = itensDe(linhas).filter((i) => {
    if (i.secao === SECAO_NAO_PUBLICADA && tiradas.has(i.chave)) return true;
    if (!grupoDaThread.has(i.chave)) return false;
    if (i.secao === SECAO_NAO_PUBLICADA && i.grupo === grupoDaThread.get(i.chave) && !noLugar.has(i.chave)) {
      noLugar.add(i.chave);
      return false;
    }
    return true;
  });
  const gruposTocados = new Set<number>();
  for (const i of remover) {
    for (let g = i.inicio - 1; g >= 0; g--) {
      if (ehGrupo(linhas[g])) { gruposTocados.add(g); break; }
      if (ehSecao(linhas[g])) break;
    }
  }
  const linhasRemovidas = new Set<number>();
  for (const i of remover) for (let k = i.inicio; k < i.fim; k++) linhasRemovidas.add(k);
  // Os titulos de grupo que ficaram vazios saem, com o indice ajustado pela remocao.
  const novoIndice = new Map<number, number>();
  let n = 0;
  const filtradas: string[] = [];
  for (let k = 0; k < linhas.length; k++) {
    if (linhasRemovidas.has(k)) continue;
    novoIndice.set(k, n++);
    filtradas.push(linhas[k]);
  }
  linhas = semGruposEsvaziados(filtradas, new Set([...gruposTocados].map((g) => novoIndice.get(g)!).filter((g) => g !== undefined)));

  // 2. Os itens da thread que nao ficaram no lugar entram em `## Não publicado`, no grupo de cada um, na ordem da thread.
  const aDevolver = daThread.filter((i) => !noLugar.has(i.chave));
  if (aDevolver.length) linhas = comSecao(linhas);
  for (const i of aDevolver) linhas = inserirNoGrupo(linhas, i.grupo, nosso.slice(i.inicio, i.fim).map((l) => l.trimEnd()));
  linhas = semBrancosRepetidos(linhas);
  while (linhas.length && emBranco(linhas[linhas.length - 1])) linhas.pop();

  const texto = linhas.join('\n') + (fimDeLinha ? '\n' : '');
  return {
    texto,
    itens: daThread.map((i) => ({ grupo: i.grupo, titulo: nosso[i.inicio].trim().slice(0, 200) })),
    devolvidos: aDevolver.length,
    mudou: chaveDe(linhas) !== original,
  };
}
