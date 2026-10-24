/**
 * RM-072 (orcamento por arquivo do Agile Check): reporter do `node --test` que soma, por arquivo, a duracao dos testes de
 * nivel zero dele e escreve no fim um JSON `{ "<caminho do arquivo>": ms }`. As lanes (`test-lanes.cjs`) o usam ao lado do
 * TAP, que segue no stdout para o verify: o TAP de varios arquivos nao diz o arquivo dos testes que passam.
 */
export default async function* duracoes(eventos) {
  const porArquivo = {};
  for await (const evento of eventos) {
    if ((evento.type === 'test:pass' || evento.type === 'test:fail') && evento.data?.nesting === 0 && evento.data.file) {
      porArquivo[evento.data.file] = (porArquivo[evento.data.file] ?? 0) + (evento.data.details?.duration_ms ?? 0);
    }
  }
  yield `${JSON.stringify(porArquivo)}\n`;
}
