/**
 * RM-031 KG2 (D15): analisador Markdown do extrator. E o micromark que o markdownlint do core ja
 * instala (fixado no package-lock.json), com a tabela GFM. Fica fora do pacote publicado, como o
 * comando provisorio: o modulo do extrator recebe `analisar` por parametro e nao importa o parser.
 *
 * `analisar(texto)` devolve os eventos do micromark com o offset no texto (unidades UTF-16), que o
 * extrator converte em bytes. `referencia(valor)` decodifica uma referencia de caractere (`eacute`,
 * `#233`, `#xE9`) com as mesmas funcoes que o micromark usa ao gerar HTML: as entidades do HTML5 e o
 * numero com a troca de codigo invalido por U+FFFD; devolve `null` se o nome nao e entidade. `versao`
 * entra na versao do `ork.md-structure`.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const versaoDe = (pacote) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', pacote, 'package.json'), 'utf8')).version;

/** O micromark e so ESM: o `import()` nativo de um arquivo CommonJS carrega nas versoes do Node do core. */
async function carregarMarkdown() {
  const { parse, postprocess, preprocess } = await import('micromark');
  const { gfmTable } = await import('micromark-extension-gfm-table');
  const { decodeNamedCharacterReference } = await import('decode-named-character-reference');
  const { decodeNumericCharacterReference } = await import('micromark-util-decode-numeric-character-reference');
  const extensions = [gfmTable()];
  const referencia = (valor) => {
    if (valor[0] !== '#') return decodeNamedCharacterReference(valor) || null;
    const hexa = valor[1] === 'x' || valor[1] === 'X';
    return decodeNumericCharacterReference(valor.slice(hexa ? 2 : 1), hexa ? 16 : 10);
  };
  const analisar = (texto) => postprocess(parse({ extensions }).document().write(preprocess()(texto, undefined, true)))
    .map(([tipo, token]) => ({ entrada: tipo === 'enter', tipo: token.type, inicio: token.start.offset, fim: token.end.offset }));
  return { analisar, referencia, versao: `micromark.${versaoDe('micromark')}.gfm-table.${versaoDe('micromark-extension-gfm-table')}` };
}

module.exports = { carregarMarkdown };
