# Contribuindo com o Orkastery

Contributions in English are welcome. The codebase, comments and documentation are written in
Brazilian Portuguese, and a pull request that follows that convention is easier to merge, but a
clear technical contribution in English will never be turned away for language alone. The guides
below are in Brazilian Portuguese too.

> **Nada entra sem evidência executável.** Toda mudança de comportamento vem com o comando que a
> comprova, e o comando roda nesta árvore. Vale para quem contribui como vale para os agentes que o
> `ork` conduz.

## Um guia por tarefa

| Guia | Use quando |
| --- | --- |
| [O que contribuir](docs/guias/contribuir/o-que-contribuir.md) | Você quer saber se abre discussão, issue ou PR |
| [Desenvolvimento local](docs/guias/contribuir/desenvolvimento-local.md) | Você vai clonar, compilar e rodar o `ork` do checkout |
| [Testes e verificação](docs/guias/contribuir/testes-e-verificacao.md) | Você quer saber o que rodar, e se uma falha é sua ou já existia |
| [Documentação](docs/guias/contribuir/documentacao.md) | Você vai mexer em texto |
| [Lint e estilo](docs/guias/contribuir/lint-e-estilo.md) | Você quer o estilo de código e de texto |
| [Pull request](docs/guias/contribuir/pull-request.md) | Você vai abrir o PR: título, descrição, prova, checks e commits |
| [Triagem](docs/guias/contribuir/triagem.md) | Você quer entender rótulos, primeira issue e prazo de resposta |
| [Versões e publicação](docs/guias/contribuir/versoes-e-publicacao.md) | Você quer saber como sai uma versão; publicar é ato do mantenedor |
| [Com o próprio ork](docs/guias/contribuir/com-o-ork.md) | Você quer provar a mudança com thread, claims e verify (recomendado, opcional) |

## O caminho curto

1. Escolha discussão, issue ou PR em [o que contribuir](docs/guias/contribuir/o-que-contribuir.md).
2. Prepare o ambiente pelo [desenvolvimento local](docs/guias/contribuir/desenvolvimento-local.md).
3. Rode o que [testes e verificação](docs/guias/contribuir/testes-e-verificacao.md) lista e cole a saída no PR.

## Sem as dependências opcionais

A suíte inteira (`npm --prefix core test`) roda em qualquer máquina. Sem o codex em `/usr/bin`, sem
PostgreSQL (Docker com `pgvector/pgvector:pg16`) ou sem o interpretador do OrkMind, os testes que
precisam deles saem como skip com o motivo, e a suíte termina com 0 falhas. Com
`ORK_TESTE_EXIGE_AMBIENTE=1`, nada é pulado. O detalhe está em
[testes e verificação](docs/guias/contribuir/testes-e-verificacao.md#a-suíte-inteira).

## Também

- Vulnerabilidade: nunca em issue pública. Ver [SECURITY.md](SECURITY.md).
- Convivência: [código de conduta](CODE_OF_CONDUCT.md).
- Toda a documentação: [docs/README.md](docs/README.md).
- Plugin dos marketplaces: `marketplaces/claude-code/orkastery/` e `marketplaces/codex/orkastery/` são cópia gerada do catálogo. Mexeu em `skills/`, `references/`, `adapters/claude-code/`, `adapters/codex/` ou na versão do `core/package.json`? Rode `node core/scripts/gerar-marketplaces.cjs` e comite o resultado; o CI roda o mesmo script com `--verificar`. Guia em [marketplaces/README.md](marketplaces/README.md).
