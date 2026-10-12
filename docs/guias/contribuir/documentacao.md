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
- **Com o merge:** depois que o PR da thread entra na `main` (o merge `ship(<thread>)`), o item dela tem de dizer `codigo: Mesclado`, e o índice gerado tem de bater com o frontmatter. O push da `main` reprova os dois (`docs.paridade.merge`, `docs.paridade.indice`); no PR, o CI roda `ork docs verificar --pr`, e eles só avisam, porque a divergência é da `main`. Quem mesclou abre o PR de docs: numa branch nova sobre a `origin/main` atualizada, `ork docs sincronizar --escrever --so RM-NNN`, com o item e os índices.
- **Com o git:** as tabelas entre os marcadores `ork-docs:` saem do frontmatter, e o `ork docs verificar` reprova quando elas divergem. Mudou o frontmatter de um item? Regere as tabelas do item com `--so`, confira o diff e commite só o item que você mudou (na worktree de uma thread, o padrão já é o item dela):

<!-- checagem: citado -->

```bash
node core/dist/index.js docs sincronizar --escrever --so RM-NNN
```

- **De idioma:** `README.md` e `README.pt-BR.md` mudam juntos, no mesmo PR. O resto de `docs/` é pt-BR.

## Como o site usa este texto

- Os dois sites têm repositório próprio: [orkastery/orkastery.com](https://github.com/orkastery/orkastery.com) e [orkastery/orkmind.com](https://github.com/orkastery/orkmind.com). Cada página de documentação sai de um catálogo, sem cópia manual: `src/data/docs-catalog.ts` lista os módulos editoriais, cada módulo (`src/data/docs-*.ts`) diz que arquivos deste repositório cada página usa, e `src/data/docs-sources.json` guarda o SHA-256 de cada fonte e a revisão editorial da página em PT, EN e ES.
- O build do site confere só esse snapshot. A sua mudança aparece lá quando o site roda `npm run docs:check -- --source <clone deste repositório>`, e a página volta a valer depois da revisão nas três línguas. Por isso a correção vai sempre aqui, na fonte.
- Para saber que página do orkastery.com a sua mudança deixa para revisar, compare o checkout com o snapshot publicado. Usa a rede e o `gh` autenticado:

<!-- checagem: citado -->

```bash
gh api repos/orkastery/orkastery.com/contents/src/data/docs-sources.json -H 'Accept: application/vnd.github.raw' | node core/scripts/checar-fontes-do-site.cjs --snapshot - --base origin/main
```

- Sai 0 quando nenhum arquivo da mudança difere do snapshot do site, e 1 com as páginas e as fontes de cada uma: cite as páginas no PR. Fonte nova sai com o destino que o site daria (roadmap, padrões); artigo novo fica sem página até entrar num módulo do catálogo. Sem `--base`, a lista traz tudo o que mudou aqui desde a última revisão do site. O inventário é o do site (os `.md` e `.json` de `docs/`, mais `README.md`, `CONTRIBUTING.md` e `core/package.json`); se o site mudar a regra, vale a dele.
- A página do site está errada e a fonte aqui está certa? Abra a issue no repositório do site.

## Comandos nos guias

- Todo bloco `bash` destes guias roda, da raiz, na checagem completa, e precisa sair 0. Cada linha roda num `bash -c` próprio: `cd`, `export` e `alias` não passam para a linha seguinte.
- Comando que usa rede, tem efeito fora da máquina ou pede uma thread real vai num bloco precedido da linha `<!-- checagem: citado -->`. Ele não roda.
- Em todo PR, a suíte do CI confere que o que os guias citam existe: subcomando do `ork`, script npm, rótulo e link dos modelos. Rodar os blocos é a checagem completa, que você roda ao mudar os guias.
- A checagem roda os blocos com o seu ambiente: rode só sobre guias que você leu.

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

[Lint e estilo](lint-e-estilo.md).

Índice dos guias: [CONTRIBUTING](../../../CONTRIBUTING.md).
