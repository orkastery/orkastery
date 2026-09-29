# Documentação

> **Em uma frase:** cada tipo de texto tem uma pasta, produto e roadmap são conferidos contra o código em todo PR, e a página cita o comando em vez do número.

## Onde cada doc mora

| O que | Onde | Idioma |
| --- | --- | --- |
| Entrada do repositório | [README.md](../../../README.md), espelhado em [README.pt-BR.md](../../../README.pt-BR.md) | Inglês, com o espelho em português |
| README do pacote npm | [core/README.md](../../../core/README.md) | Inglês |
| Primeiro uso | [docs/comecar](../../comecar/quickstart.md) | pt-BR |
| Uma tarefa por página | [docs/guias](../../README.md#guias) | pt-BR |
| Como contribuir | esta pasta, com o índice em [CONTRIBUTING.md](../../../CONTRIBUTING.md) | pt-BR, índice com nota em inglês |
| Comandos e contratos | [docs/referencia](../../referencia/cli.md) | pt-BR |
| Vocabulário e arquitetura | [docs/conceitos](../../conceitos/visao-geral.md) | pt-BR |
| O que o produto faz hoje | [docs/produto](../../produto/README.md), com frontmatter | pt-BR |
| O que vem, com estado provado | [docs/roadmap](../../roadmap/README.md), um arquivo por item | pt-BR |
| As regras de escrita | [docs/padroes](../../padroes/documentacao-de-produto.md) | pt-BR |
| Mudanças por versão | [CHANGELOG.md](../../../CHANGELOG.md) | pt-BR |

## Padrão de escrita

- Português do Brasil, sem travessão longo (U+2014): use vírgula, dois-pontos ou parênteses.
- Resposta primeiro: logo abaixo do título, a linha `> **Em uma frase:**`. Em produto e roadmap ela é obrigatória.
- Uma ideia por linha: tópico em vez de parágrafo longo.
- Cite o comando, não o número. "Rode `npm --prefix core run test:ci`" não envelhece; "a suíte tem tantos testes" envelhece no próximo PR.
- Nome de código, comando, flag e caminho em crase, exatos.
- Nada pessoal: sem caminho da sua máquina, e-mail ou nome de cliente. O repositório é público.
- As regras completas estão nos padrões de [documentação](../../padroes/documentacao-de-produto.md) e de [roadmap](../../padroes/roadmap-de-produto.md).

## Paridade

- **Com o código:** página de produto e item de roadmap têm frontmatter. O `ork docs verificar` reprova fonte que não existe, comando que o CLI não declara, commit de merge fora da `main` e seção esquecida.
- **Com o git:** as tabelas entre os marcadores `ork-docs:` saem do frontmatter. Edite o frontmatter; o mantenedor roda `ork docs sincronizar` na máquina do projeto.
- **De idioma:** `README.md` e `README.pt-BR.md` mudam juntos, no mesmo PR. O resto de `docs/` é pt-BR.

## Como o site usa este texto

- O site orkastery.com tem repositório próprio: [orkastery/orkastery.com](https://github.com/orkastery/orkastery.com).
- A documentação do site vai sair de `docs/` por um catálogo de fontes, em construção na [RM-049](../../roadmap/RM-049-lancamento.md) e na [RM-050](../../roadmap/RM-050-guia-de-contribuicao.md).
- Por isso a correção vai sempre aqui, na fonte. Se a página do site também estiver errada, abra a issue no repositório do site.

## Comandos nos guias

- Todo bloco `bash` destes guias roda na checagem dos comandos, da raiz, e precisa sair 0.
- Comando que usa rede, tem efeito fora da máquina ou pede uma thread real vai num bloco precedido da linha `<!-- checagem: citado -->`. Ele não roda, mas o subcomando do `ork` e o script npm são conferidos.

## Conferir antes do PR

```bash
core/node_modules/.bin/markdownlint-cli2
node core/dist/index.js docs verificar
node core/scripts/checar-links.cjs
```

São os passos do check `documentacao (markdownlint e paridade)`. Mexeu em `CONTRIBUTING.md` ou nesta pasta? Rode também a checagem dos comandos, que leva o tempo da suíte porque roda a suíte:

<!-- checagem: citado -->

```bash
node core/scripts/checar-comandos-dos-guias.cjs
```

## Próximo passo

[Pull request](pull-request.md).
