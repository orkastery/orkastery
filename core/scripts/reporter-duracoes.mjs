/**
 * RM-072 (orcamento por arquivo do Agile Check): reporter do `node --test` que soma, por arquivo, a duracao dos testes de
 * nivel zero dele e guarda tambem o veredito por nome. As lanes (`test-lanes.cjs`) o usam ao lado do TAP, que segue no
 * stdout para o verify: o TAP de varios arquivos nao relaciona de forma segura cada nome ao seu arquivo.
 */
export default async function* duracoes(eventos) {
  const relatorio = { versao: 2, duracoes: {}, testes: [] };
  for await (const evento of eventos) {
    if ((evento.type === 'test:pass' || evento.type === 'test:fail') && evento.data?.nesting === 0 && evento.data.file) {
      relatorio.duracoes[evento.data.file] = (relatorio.duracoes[evento.data.file] ?? 0) + (evento.data.details?.duration_ms ?? 0);
    }
    if ((evento.type === 'test:pass' || evento.type === 'test:fail') && evento.data?.file && typeof evento.data.name === 'string') {
      relatorio.testes.push({ arquivo: evento.data.file, nome: evento.data.name, nesting: evento.data.nesting ?? 0,
        estado: evento.type === 'test:fail' ? 'fail'
          : evento.data.skip || evento.data.details?.skip ? 'skip'
            : evento.data.todo || evento.data.details?.todo ? 'todo' : 'pass' });
    }
  }
  yield `${JSON.stringify(relatorio)}\n`;
}
