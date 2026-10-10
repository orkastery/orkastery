# Triagem

> **Em uma frase:** toda issue nova recebe um rótulo de tipo pelo modelo, a primeira resposta do mantenedor em até 7 dias e um destino claro.

## Rótulos

| Rótulo | Quando |
| --- | --- |
| `bug` | O `ork` não faz o que a doc diz. Entra pelo modelo de bug |
| `documentation` | Página errada, desatualizada, confusa ou que falta. Entra pelo modelo de documentação |
| `enhancement` | Ideia ou pedido de funcionalidade. Entra pelo modelo de ideia |
| `needs triage` | Issue nova, ainda sem a primeira resposta. Os modelos pedem; sai na triagem |
| `question` | Dúvida de uso. O lugar melhor é o Discussions, categoria Q&A |
| `good first issue` | Pequena, com o caminho descrito, boa para a primeira contribuição |
| `help wanted` | O mantenedor aceita PR de fora e não vai fazer tão cedo |
| `duplicate` | Já existe outra issue; o comentário aponta qual |
| `wontfix` | Fora do escopo do produto; o comentário diz por quê |
| `invalid` | Não é defeito nem pedido deste projeto |
| `accessibility` | Barreira para pessoas com deficiência |

- Os nomes seguem o padrão do GitHub: `good first issue` alimenta a página de contribuição do repositório.
- Criar rótulo é ato do mantenedor. O GitHub ignora o rótulo que o modelo pede e o repositório ainda não tem.

## Prazo de resposta

- Primeira resposta em até 7 dias, a mesma meta do [SECURITY.md](../../../SECURITY.md). É meta, não garantia.
- PR segue o mesmo prazo para a primeira revisão.
- Passou do prazo? Comente na issue ou no PR.

## Primeira issue

Uma issue recebe `good first issue` quando:

- cabe num PR pequeno;
- diz o arquivo e o comando que prova a correção;
- não mexe em contrato nem em dependência.

A lista está em [good first issue](https://github.com/orkastery/orkastery/labels/good%20first%20issue).

## Destinos da triagem

| Resultado | O que acontece |
| --- | --- |
| Reproduzido | O rótulo de tipo fica e `needs triage` sai; item grande vai para o roadmap |
| Falta informação | O mantenedor pede o que falta, com o comando que ajudaria |
| Duplicado | `duplicate`, com o link da outra issue |
| Fora de escopo | `wontfix`, com o motivo |
| Pergunta | Vai para o Discussions, categoria Q&A |

## Medir os PRs de fora

O [RM-050](../../roadmap/RM-050-guia-de-contribuicao.md) mede este guia pelos PRs de fora: a fração cujo CI passa na primeira execução (meta de 80%) e dois PRs mesclados sem ajuda do mantenedor, que fecham o piloto. A medida usa a rede e o `gh` autenticado:

<!-- checagem: citado -->

```bash
node core/scripts/medir-piloto-de-contribuicao.cjs
```

- De fora é quem não é dono nem membro da organização, e não é bot. Convidado com acesso de escrita conta como de fora.
- A primeira execução é o primeiro run do CI do PR, na branch de origem dele, mesmo que o commit tenha saído depois por push forçado. Esperar o mantenedor liberar o CI do fork não é execução, nem o run cancelado pelo push seguinte; reexecutar até passar não vira verde na primeira.
- Sem ajuda quer dizer nenhum commit de outra pessoa nem commit sem login do GitHub no PR. Ajuda em comentário não vira dado: confira nos PRs que a medida lista.
- `--salvar-dados <arquivo>` guarda a coleta, e `--dados <arquivo>` mede de novo sem rede. Guarde a coleta de cada rodada: quem é de fora sai da associação de hoje com a organização, e um convidado que vira membro some das medidas seguintes.

## Próximo passo

[Versões e publicação](versoes-e-publicacao.md), para quem mantém o projeto.

Índice dos guias: [CONTRIBUTING](../../../CONTRIBUTING.md).
