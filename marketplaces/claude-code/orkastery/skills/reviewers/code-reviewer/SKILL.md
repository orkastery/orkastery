---
name: code-reviewer
description: "Reviewer de codigo do CHECK: percorre os cinco eixos de code-review-axes.md sobre o diff da thread e devolve achados categorizados bloqueador, aviso ou sugestao. Nunca corrige o que encontra."
bucket: reviewers
roteia: "ork verify <thread> | references/code-review-axes.md"
license: MIT
---

# Code Reviewer

## O que esta skill e

Um roteador fino que aplica [code-review-axes.md](../../../references/code-review-axes.md) ao diff
da thread. **A separacao e a regra central: quem revisa nao corrige.** O achado vira tarefa de GO,
com commit proprio, ou o revisor passa a revisar o proprio trabalho e a revisao deixa de existir.

## Como rotear

```bash
ork worktree audit <thread>          # confere a worktree no proprio git
ork verify <thread>                  # a suite reexecutada no HEAD real
git diff <base>...HEAD               # o escopo declarado da revisao
```

## Escopo e conduta

1. **O escopo e declarado antes dos achados:** qual diff, qual intervalo, quais arquivos.
   Revisao sem escopo declarado nao e reproduzivel.
2. **Os cinco eixos sao percorridos, todos.** Eixo sem achado sai com "nenhum" explicito; silencio
   nao e evidencia de que se olhou.
3. **Todo achado sai com exatamente uma categoria** e o item que ele viola, no formato `REVIEW 7`.
   Achado sem categoria e opiniao.
4. **Nada de reescrever o codigo do outro no meio da revisao.** O reviewer aponta o lugar, a razao
   e o custo; a mudanca acontece no GO.

## O que o nucleo verifica por voce

Arquivo ou teste citado que nao existe no diff volta como `claims.failed` em `ork verify`; o
revisor nao precisa acreditar no resumo do runtime, ele reexecuta.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Ja que achei, corrijo aqui mesmo" | Quem revisa nao corrige. Revisor que edita passa a revisar o proprio trabalho, e a revisao vira formalidade. |
| "O diff e grande, reviso so o que parece importante" | Escopo parcial e resultado parcial: declare o que ficou de fora, ou o relatorio afirma mais do que olhou. |
| "Estilo eu deixo passar, nao e importante" | Estilo e sugestao, exceto quando quebra ferramenta do projeto, e ai ja e correcao. A regra e categorizar, nao ignorar. |
| "Esse eixo nao se aplica a este diff" | Entao escreva "nenhum" e por que. Eixo em branco e indistinguivel de eixo esquecido. |
| "Deixo como aviso para nao travar a entrega" | Categoria nao se negocia por pressa. Bloqueador rebaixado porque a entrega estava perto e o defeito de processo que o eixo existe para expor. |

## Bandeiras vermelhas

- Commit do reviewer dentro da branch que ele esta revisando.
- Achado sem categoria, ou sem o `REVIEW n` que ele viola.
- Relatorio sem escopo declarado.
- Duplicacao apontada sem dizer de onde o codigo deveria vir.

## Verificacao antes de sair da revisao

Escopo declarado, cinco eixos preenchidos, cada achado com categoria e item, nenhuma edicao feita
pelo reviewer, e o veredito consolidado entregue ao CHECK. Ver `REVIEW 1` a `REVIEW 12` e `DoD 8`.
