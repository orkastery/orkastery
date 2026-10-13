/**
 * RM-058, fatia N5 (D4 e D5 da ork-rm058n5): o CHANGELOG e os conflitos só aditivos da atualização do candidato.
 *
 * Nas noites de 11 a 13/10 a `main` andou várias vezes, e cada PR precisou de merge da base com conflito só aditivo no
 * `CHANGELOG.md` (às vezes no código). Depois de uma versão, o merge ainda pôs a linha da thread dentro de `## [versão]`,
 * logo abaixo de um "Não publicado" vazio, sem conflito textual nenhum. Aqui mora a regra que o núcleo aplica sozinho:
 *
 * - um conflito diff3 é só aditivo quando a seção do ancestral comum está vazia, ou é prefixo (ou sufixo) dos dois lados
 *   sem mudança; ele vira a união, com o lado da base de destino primeiro e o da thread depois. Qualquer outro conflito, ou
 *   marcador fora do formato, é recusa: o núcleo não escolhe por ninguém;
 * - a entrada da thread é o bloco novo em "Não publicado" do lado da thread desde o ancestral comum; depois do merge, a que
 *   caiu numa seção de versão que, na base, não a tem volta para "Não publicado", na subseção de origem;
 * - a regra do `core/scripts/checar-changelog.cjs` (que não vai no pacote) está portada aqui para a prova da entrega.
 *
 * Puro: texto entra, texto sai. Quem lê o git e grava o merge é `noctum-entrega.ts`; quem recomputa um merge para saber se
 * ele foi mecânico é `noctum-provas.ts`. As duas usam estas mesmas funções, então a recomputação reproduz a atualização.
 */

export const SECAO_NAO_PUBLICADO = '## Não publicado';
export const ARQUIVO_DO_CHANGELOG = 'CHANGELOG.md';

/** Um item do CHANGELOG: a linha `- ` e as linhas recuadas que continuam o item, sem as linhas em branco depois dele. */
export interface BlocoDoChangelog {
  linhas: string[];
  /** A subseção (`### ...`) em que o item está, ou `null` quando ele vem antes de qualquer subseção. */
  subsecao: string | null;
}

interface Secao { titulo: string; inicio: number; fim: number }

const linhasDe = (texto: string): string[] => texto.replace(/\r\n/g, '\n').split('\n');
const chaveDoBloco = (b: { linhas: string[] }): string => b.linhas.join('\n');
const titulo = (linha: string): boolean => /^## /.test(linha);
const subtitulo = (linha: string): boolean => /^### /.test(linha);
const continuacao = (linha: string): boolean => /^\s+\S/.test(linha);

/** As seções de nível 2, com o índice da linha do título e o fim exclusivo (o título seguinte, ou o fim do texto). */
function secoes(linhas: readonly string[]): Secao[] {
  const s: Secao[] = [];
  linhas.forEach((l, i) => {
    if (!titulo(l)) return;
    if (s.length) s[s.length - 1].fim = i;
    s.push({ titulo: l.trim(), inicio: i, fim: linhas.length });
  });
  return s;
}

/** Os blocos de uma seção, com a posição de cada um. */
function blocosComPosicao(linhas: readonly string[], secao: Secao): Array<BlocoDoChangelog & { inicio: number }> {
  const blocos: Array<BlocoDoChangelog & { inicio: number }> = [];
  let subsecao: string | null = null;
  for (let i = secao.inicio + 1; i < secao.fim; i++) {
    const l = linhas[i];
    if (subtitulo(l)) { subsecao = l.trim(); continue; }
    if (!/^- /.test(l)) continue;
    let j = i + 1;
    while (j < secao.fim && continuacao(linhas[j])) j++;
    blocos.push({ linhas: linhas.slice(i, j), subsecao, inicio: i });
    i = j - 1;
  }
  return blocos;
}

const secaoNaoPublicada = (linhas: readonly string[]): Secao | null =>
  secoes(linhas).find(s => s.titulo === SECAO_NAO_PUBLICADO) ?? null;

/** Os blocos da seção "Não publicado", ou `null` quando ela não existe. */
export function blocosNaoPublicados(texto: string): BlocoDoChangelog[] | null {
  const linhas = linhasDe(texto);
  const s = secaoNaoPublicada(linhas);
  return s ? blocosComPosicao(linhas, s).map(({ linhas: l, subsecao }) => ({ linhas: l, subsecao })) : null;
}

/**
 * D5: as entradas que a thread acrescentou em "Não publicado": os blocos de `depois` que `antes` não tinha na mesma seção,
 * contados como multiconjunto (um bloco repetido que já existia não conta como novo), na ordem em que aparecem.
 */
export function entradasDaThread(antes: string, depois: string): BlocoDoChangelog[] {
  const naBase = new Map<string, number>();
  for (const b of blocosNaoPublicados(antes) ?? []) naBase.set(chaveDoBloco(b), (naBase.get(chaveDoBloco(b)) ?? 0) + 1);
  const novas: BlocoDoChangelog[] = [];
  for (const b of blocosNaoPublicados(depois) ?? []) {
    const n = naBase.get(chaveDoBloco(b)) ?? 0;
    if (n > 0) naBase.set(chaveDoBloco(b), n - 1);
    else novas.push(b);
  }
  return novas;
}

// ---------------------------------------------------------------------------
// D4: conflitos diff3 só aditivos.
// ---------------------------------------------------------------------------

const INICIO = /^<{7}(?: |$)/;
const ANCESTRAL = /^\|{7}(?: |$)/;
const MEIO = /^={7}$/;
const FIM = /^>{7}(?: |$)/;
const marcador = (l: string): boolean => INICIO.test(l) || ANCESTRAL.test(l) || MEIO.test(l) || FIM.test(l);

export type ResolucaoDeConflitos = { ok: true; texto: string; conflitos: number } | { ok: false; recusa: string };

const comeca = (a: readonly string[], p: readonly string[]): boolean => p.every((l, i) => a[i] === l);
const termina = (a: readonly string[], s: readonly string[]): boolean => s.every((l, i) => a[a.length - s.length + i] === l);

/**
 * Um conflito: `primeiro` é o lado do HEAD do merge (a thread), `segundo` o lado que entra (a base de destino) e
 * `ancestral` a seção do ancestral comum. Só aditivo: a união, com a base primeiro; senão, `null`.
 */
function unir(primeiro: string[], ancestral: string[], segundo: string[]): string[] | null {
  if (ancestral.length === 0) return [...segundo, ...primeiro];
  const n = ancestral.length;
  if (primeiro.length >= n && segundo.length >= n && comeca(primeiro, ancestral) && comeca(segundo, ancestral)) {
    return [...ancestral, ...segundo.slice(n), ...primeiro.slice(n)];
  }
  if (primeiro.length >= n && segundo.length >= n && termina(primeiro, ancestral) && termina(segundo, ancestral)) {
    return [...segundo.slice(0, segundo.length - n), ...primeiro.slice(0, primeiro.length - n), ...ancestral];
  }
  return null;
}

/**
 * D4: resolve os conflitos diff3 de um arquivo (os marcadores `<<<<<<<`, `|||||||`, `=======` e `>>>>>>>` do
 * `merge.conflictStyle=diff3`). Só aditivo vira a união; o conflito que muda linha do ancestral, o conflito sem a seção do
 * ancestral (outro estilo de merge) e o marcador fora do formato voltam como recusa, com o motivo.
 */
export function resolverConflitosAditivos(texto: string): ResolucaoDeConflitos {
  const saida: string[] = [];
  let estado: 'fora' | 'primeiro' | 'ancestral' | 'segundo' = 'fora';
  let primeiro: string[] = [], ancestral: string[] = [], segundo: string[] = [];
  let conflitos = 0;
  const recusa = (motivo: string, n: number): ResolucaoDeConflitos => ({ ok: false, recusa: `${motivo} (linha ${n + 1})` });
  const linhas = linhasDe(texto);
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (estado === 'fora') {
      if (INICIO.test(l)) { estado = 'primeiro'; primeiro = []; ancestral = []; segundo = []; continue; }
      if (marcador(l)) return recusa('marcador de conflito fora do formato', i);
      saida.push(l);
    } else if (estado === 'primeiro') {
      if (ANCESTRAL.test(l)) { estado = 'ancestral'; continue; }
      if (marcador(l)) return recusa('conflito sem a seção do ancestral comum (o merge precisa de merge.conflictStyle=diff3)', i);
      primeiro.push(l);
    } else if (estado === 'ancestral') {
      if (MEIO.test(l)) { estado = 'segundo'; continue; }
      if (marcador(l)) return recusa('marcador de conflito fora do formato', i);
      ancestral.push(l);
    } else {
      if (FIM.test(l)) {
        const unido = unir(primeiro, ancestral, segundo);
        if (!unido) return recusa('conflito que muda linha do ancestral comum: não é só aditivo', i);
        saida.push(...unido);
        conflitos += 1;
        estado = 'fora';
        continue;
      }
      if (marcador(l)) return recusa('marcador de conflito fora do formato', i);
      segundo.push(l);
    }
  }
  if (estado !== 'fora') return recusa('conflito sem o marcador de fim', linhas.length - 1);
  return { ok: true, texto: saida.join('\n'), conflitos };
}

// ---------------------------------------------------------------------------
// D5: a entrada da thread em "Não publicado".
// ---------------------------------------------------------------------------

/** O índice da primeira linha de cada ocorrência do bloco como item inteiro (nem pedaço de outro item, nem prefixo). */
function ocorrencias(linhas: readonly string[], bloco: BlocoDoChangelog): number[] {
  const achadas: number[] = [];
  for (let i = 0; i + bloco.linhas.length <= linhas.length; i++) {
    if (!bloco.linhas.every((l, k) => linhas[i + k] === l)) continue;
    const depois = linhas[i + bloco.linhas.length];
    if (depois !== undefined && continuacao(depois)) continue;
    achadas.push(i);
  }
  return achadas;
}

/** A seção que contém a linha `i`, ou `null` quando ela vem antes da primeira seção. */
const secaoDaLinha = (s: readonly Secao[], i: number): Secao | null => s.find(x => i > x.inicio && i < x.fim) ?? null;

/** A versão é seção de versão? `## [0.5.0] - 2026-09-30` e o formato antigo `## 0.4.3`, sem colchetes. */
const ehVersao = (t: string): boolean => /^## \[?\d+\.\d+\.\d+/.test(t);

export interface Posicionamento {
  texto: string;
  /** As entradas da thread que estavam numa versão e voltaram para "Não publicado". */
  movidas: number;
  /** As entradas da thread que não estão em lugar nenhum do texto: o merge as perdeu. */
  perdidas: number;
}

/**
 * D5: põe em "Não publicado" as entradas da thread que caíram numa seção de versão que, em `daBase` (o CHANGELOG da base de
 * destino), não tem o mesmo bloco. A entrada volta para a subseção de origem (criada no alto da seção quando falta), e
 * "Não publicado" é criada antes da primeira versão quando falta. O subtítulo que fica vazio na versão e que a base não tem
 * sai junto. Entrada que já está em "Não publicado" não muda; a que sumiu conta em `perdidas`.
 */
export function posicionarEntradas(texto: string, entradas: readonly BlocoDoChangelog[], daBase: string): Posicionamento {
  const linhas = linhasDe(texto);
  const base = linhasDe(daBase);
  const naBase = new Map<string, Set<string>>();
  for (const s of secoes(base)) {
    naBase.set(s.titulo, new Set(blocosComPosicao(base, s).map(chaveDoBloco)));
  }
  const subtitulosDaBase = new Map<string, Set<string>>();
  for (const s of secoes(base)) {
    subtitulosDaBase.set(s.titulo, new Set(base.slice(s.inicio + 1, s.fim).filter(subtitulo).map(l => l.trim())));
  }
  let movidas = 0, perdidas = 0;
  for (const e of entradas) {
    const s = secoes(linhas);
    const achadas = ocorrencias(linhas, e);
    if (!achadas.length) { perdidas += 1; continue; }
    if (achadas.some(i => secaoDaLinha(s, i)?.titulo === SECAO_NAO_PUBLICADO)) continue;
    const fora = achadas.find(i => {
      const sec = secaoDaLinha(s, i);
      return !!sec && ehVersao(sec.titulo) && !naBase.get(sec.titulo)?.has(chaveDoBloco(e));
    });
    if (fora === undefined) continue;
    const sec = secaoDaLinha(s, fora)!;
    // Tira o bloco e a linha em branco que sobraria dobrada.
    linhas.splice(fora, e.linhas.length);
    if (linhas[fora] === '' && (fora === 0 || linhas[fora - 1] === '')) linhas.splice(fora, 1);
    // O subtítulo que ficou sem nada na versão, e que a base não tem nela, era da thread: sai também.
    const subAcima = (() => { for (let k = fora - 1; k > sec.inicio; k--) { if (subtitulo(linhas[k])) return k; if (/^- /.test(linhas[k]) || continuacao(linhas[k])) return -1; } return -1; })();
    if (subAcima > 0) {
      let k = subAcima + 1;
      while (k < linhas.length && linhas[k] === '') k++;
      const vazio = k >= linhas.length || titulo(linhas[k]) || subtitulo(linhas[k]);
      if (vazio && !subtitulosDaBase.get(sec.titulo)?.has(linhas[subAcima].trim())) {
        linhas.splice(subAcima, linhas[subAcima + 1] === '' ? 2 : 1);
      }
    }
    inserirEmNaoPublicado(linhas, e);
    movidas += 1;
  }
  return { texto: linhas.join('\n'), movidas, perdidas };
}

/** Insere o bloco no alto da subseção de origem dele em "Não publicado", criando a seção e a subseção quando faltam. */
function inserirEmNaoPublicado(linhas: string[], e: BlocoDoChangelog): void {
  let s = secaoNaoPublicada(linhas);
  if (!s) {
    const primeiraVersao = secoes(linhas).find(x => ehVersao(x.titulo));
    const onde = primeiraVersao ? primeiraVersao.inicio : linhas.length;
    const antes = onde > 0 && linhas[onde - 1] !== '' ? [''] : [];
    linhas.splice(onde, 0, ...antes, SECAO_NAO_PUBLICADO, '');
    s = secaoNaoPublicada(linhas)!;
  }
  // Depois do título da seção (e da linha em branco dele, que é criada quando falta).
  if (linhas[s.inicio + 1] !== '') linhas.splice(s.inicio + 1, 0, '');
  s = secaoNaoPublicada(linhas)!;
  let alvo = s.inicio + 2;
  if (e.subsecao !== null) {
    const h = linhas.slice(s.inicio + 1, s.fim).findIndex(l => l.trim() === e.subsecao);
    if (h < 0) {
      linhas.splice(s.inicio + 2, 0, e.subsecao, '');
      alvo = s.inicio + 4;
    } else {
      const k = s.inicio + 1 + h;
      if (linhas[k + 1] !== '') linhas.splice(k + 1, 0, '');
      alvo = k + 2;
    }
  }
  linhas.splice(alvo, 0, ...e.linhas, '');
}

/** As linhas de texto da base que o resultado não tem mais (multiconjunto, sem as linhas em branco). */
export function linhasDaBasePerdidas(daBase: string, resultado: string): string[] {
  const restantes = new Map<string, number>();
  for (const l of linhasDe(resultado)) if (l.trim()) restantes.set(l, (restantes.get(l) ?? 0) + 1);
  const perdidas: string[] = [];
  for (const l of linhasDe(daBase)) {
    if (!l.trim()) continue;
    const n = restantes.get(l) ?? 0;
    if (n > 0) restantes.set(l, n - 1); else perdidas.push(l);
  }
  return perdidas;
}

// ---------------------------------------------------------------------------
// A regra do checador do CHANGELOG (core/scripts/checar-changelog.cjs), portada.
// ---------------------------------------------------------------------------

const PASTAS_DE_PRODUTO = ['core/', 'adapters/', 'marketplaces/'];
const DE_CI = [/^\.github\//, /^\.ork-ci\//, /^core\/scripts\/test-ci\.js$/, /^core\/scripts\/checar-[a-z0-9-]+\.cjs$/];

/** Arquivo de teste: pasta `test`, `tests` ou `__tests__` no caminho, ou nome `*.test.*`/`*.spec.*`. */
export function ehTeste(arquivo: string): boolean {
  const partes = arquivo.split('/');
  return partes.slice(0, -1).some(p => p === 'test' || p === 'tests' || p === '__tests__')
    || /\.(test|spec)\.[A-Za-z0-9]+$/.test(partes[partes.length - 1]);
}

/** Arquivo que pede linha no CHANGELOG: dentro das pastas do produto, fora de teste e de CI. */
export function pedeLinha(arquivo: string): boolean {
  return PASTAS_DE_PRODUTO.some(p => arquivo.startsWith(p)) && !ehTeste(arquivo) && !DE_CI.some(re => re.test(arquivo));
}

/** As linhas de texto da seção "Não publicado" (sem título e sem linha em branco); `null` sem a seção. */
export function linhasDaSecao(texto: string): string[] | null {
  const linhas = linhasDe(texto);
  const inicio = linhas.findIndex(l => l.trim() === SECAO_NAO_PUBLICADO);
  if (inicio < 0) return null;
  const corpo: string[] = [];
  for (const linha of linhas.slice(inicio + 1)) {
    if (/^## /.test(linha)) break;
    if (linha.trim() && !/^#/.test(linha.trim())) corpo.push(linha.trimEnd());
  }
  return corpo;
}

/** As versões do CHANGELOG, nos dois formatos que ele já teve. */
export function versoes(texto: string): Set<string> {
  return new Set([...texto.replace(/\r\n/g, '\n').matchAll(/^## \[?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)\]?(?=\s|$)/gm)].map(m => m[1]));
}

export type ConferenciaDoChangelog =
  | { ok: true; detalhe: string; linhas: string[] }
  | { ok: false; motivo: 'changelog.linha-ausente' | 'changelog.secao-ausente'; detalhe: string };

/**
 * A regra do job `documentacao`: o diff que muda `core/`, `adapters/` ou `marketplaces/` (fora de teste e de CI) acrescenta
 * ao menos uma linha em "Não publicado" ou abre uma versão nova. `antes` é o CHANGELOG no ancestral comum com a base;
 * `depois`, o da fonte; `arquivos`, os caminhos que a fonte muda desde esse ancestral.
 */
export function conferirChangelog(antes: string, depois: string, arquivos: readonly string[]): ConferenciaDoChangelog {
  const pedem = arquivos.filter(pedeLinha);
  if (!pedem.length) return { ok: true, detalhe: 'nada pede linha: a mudança não toca core/, adapters/ nem marketplaces/ fora de teste e CI', linhas: [] };
  const nova = [...versoes(depois)].filter(v => !versoes(antes).has(v));
  if (nova.length) return { ok: true, detalhe: `versão nova no CHANGELOG: ${nova.join(', ')}`, linhas: [] };
  const secao = linhasDaSecao(depois);
  if (secao === null) return { ok: false, motivo: 'changelog.secao-ausente', detalhe: `o CHANGELOG não tem a seção "${SECAO_NAO_PUBLICADO}"` };
  const naBase = new Map<string, number>();
  for (const l of linhasDaSecao(antes) ?? []) naBase.set(l, (naBase.get(l) ?? 0) + 1);
  const novas: string[] = [];
  for (const l of secao) {
    const n = naBase.get(l) ?? 0;
    if (n > 0) naBase.set(l, n - 1); else novas.push(l);
  }
  if (novas.length) return { ok: true, detalhe: `${novas.length} linha(s) nova(s) em "${SECAO_NAO_PUBLICADO}"`, linhas: novas };
  return { ok: false, motivo: 'changelog.linha-ausente',
    detalhe: `a mudança toca ${pedem.length} arquivo(s) do produto (${pedem.slice(0, 3).join(', ')}${pedem.length > 3 ? ', ...' : ''}) ` +
      `e não acrescenta linha em "${SECAO_NAO_PUBLICADO}"` };
}
