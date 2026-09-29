/**
 * RM-031 KG2 (D15): analisador Markdown do extrator. E o micromark que o markdownlint do core ja
 * instala (fixado no package-lock.json), com a tabela GFM. Fica fora do pacote publicado, como o
 * comando provisorio: o modulo do extrator recebe `analisar` por parametro e nao importa o parser.
 *
 * `analisar(texto)` devolve os eventos do micromark com o offset no texto (unidades UTF-16), que o
 * extrator converte em bytes. `versao` entra na versao do `ork.md-structure`.
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
  const extensions = [gfmTable()];
  const analisar = (texto) => postprocess(parse({ extensions }).document().write(preprocess()(texto, undefined, true)))
    .map(([tipo, token]) => ({ entrada: tipo === 'enter', tipo: token.type, inicio: token.start.offset, fim: token.end.offset }));
  return { analisar, versao: `micromark.${versaoDe('micromark')}.gfm-table.${versaoDe('micromark-extension-gfm-table')}` };
}

module.exports = { carregarMarkdown };
