/**
 * RM-053 (fatia 2): o saneador de saida comum ao nucleo.
 *
 * Texto que vem de fora (o retrato de outra maquina, a branch `ork/fabrica-estado` do remoto de um
 * projeto, onde outras pessoas escrevem) chega a tela do dono. A rede ja limpava o que imprime desde
 * a revisao 4; o `ork fabrica` imprimia o `por` e o `projeto` legados crus. Este modulo e a regra
 * unica: quem imprime valor alheio passa por aqui.
 */

/**
 * Y4 do CHECK 7: as marcas de `Cf` que se veem, lista fechada (todo `Prepended_Concatenation_Mark=Yes`
 * do Unicode 17: os sinais numericos arabes U+0600 a U+0605, o fim de aya U+06DD, a abreviacao siriaca
 * U+070F, as marcas de libra e piastra U+0890 e U+0891, o sanah U+08E2 e as marcas de numero kaithi
 * U+110BD e U+110CD). Elas tem glifo e nao movem o texto, ao contrario das bidi, de largura zero e das
 * tags, que seguem invisiveis. O regex do JS nao aceita `\p{Prepended_Concatenation_Mark}`; por isso a
 * lista literal, presa ao `INVISIVEL` e conferida ponto a ponto no teste.
 */
export const CF_VISIVEL: readonly number[] = Object.freeze([
  0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605, 0x06dd, 0x070f, 0x0890, 0x0891, 0x08e2, 0x110bd, 0x110cd,
]);

/**
 * V2 da revisao 4, W11 da revisao 5 e X3 da revisao 6: caractere que o terminal executa ou que
 * ninguem ve, pelas classes do Unicode: controles (`Cc`: ESC, BEL, CSI, quebra de linha), formato
 * (`Cf`: bidi, largura zero, tags), separadores de linha e todo `Default_Ignorable_Code_Point`
 * (preenchimentos Hangul, seletores de variacao, os de musica e de estenografia), mais o braile
 * vazio. Ficam de fora o ZWJ (U+200D) e os seletores U+FE0E e U+FE0F: eles montam emoji comuns, e as
 * marcas visiveis de `Cf` (`CF_VISIVEL`, Y4 do CHECK 7).
 */
export const INVISIVEL = /(?![\u200d\ufe0e\ufe0f\u0600-\u0605\u06dd\u070f\u0890\u0891\u08e2\u{110bd}\u{110cd}])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
const INVISIVEIS = new RegExp(INVISIVEL.source, 'gu');

/**
 * W4 da revisao 5: o valor numa linha so, sem nada invisivel. A quebra de linha (e a tabulacao) vira
 * espaco: um valor que vem de fora nunca abre uma linha propria na saida, como se fosse do `ork`.
 */
export const emUmaLinha = (texto: string): string =>
  texto.replace(INVISIVEIS, (c) => (/[\t\n\v\f\r\u0085\u2028\u2029]/.test(c) ? ' ' : ''));

/**
 * Cada texto de uma estrutura (objeto, lista, aninhados) em uma linha, sem invisivel; numero,
 * booleano e `null` ficam como estao (X5 da revisao 6: a ida e volta em JSON trocava `NaN` por `null`).
 */
export function valoresEmUmaLinha<T>(valor: T): T {
  const limpar = (v: unknown): unknown => typeof v === 'string' ? emUmaLinha(v)
    : Array.isArray(v) ? v.map(limpar)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpar(x)])) : v;
  return limpar(valor) as T;
}

/**
 * O JSON para a tela: o mesmo valor, com os caracteres invisiveis escritos como `\uXXXX` (quem le o
 * JSON recebe o mesmo texto; so o terminal deixa de executa-lo). A quebra de linha da indentacao fica.
 */
export function jsonSemInvisivel(valor: unknown): string {
  return JSON.stringify(valor, null, 2).replace(INVISIVEIS, (c) => c === '\n' ? c
    : Array.from({ length: c.length }, (_, i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join(''));
}
