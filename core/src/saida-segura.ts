/**
 * RM-053 (fatia 2): o saneador de saida comum ao nucleo.
 *
 * Texto que vem de fora (o retrato de outra maquina, a branch `ork/fabrica-estado` do remoto de um
 * projeto, onde outras pessoas escrevem) chega a tela do dono. A rede ja limpava o que imprime desde
 * a revisao 4; o `ork fabrica` imprimia o `por` e o `projeto` legados crus. Este modulo e a regra
 * unica: quem imprime valor alheio passa por aqui.
 */

/**
 * V2 da revisao 4, W11 da revisao 5 e X3 da revisao 6: caractere que o terminal executa ou que
 * ninguem ve, pelas classes do Unicode: controles (`Cc`: ESC, BEL, CSI, quebra de linha), formato
 * (`Cf`: bidi, largura zero, tags), separadores de linha e todo `Default_Ignorable_Code_Point`
 * (preenchimentos Hangul, seletores de variacao, os de musica e de estenografia), mais o braile
 * vazio. Ficam de fora o ZWJ (U+200D) e os seletores U+FE0E e U+FE0F: eles montam emoji comuns.
 */
export const INVISIVEL = /(?![\u200d\ufe0e\ufe0f])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
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
