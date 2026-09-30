---
name: go-implementation
description: "Fase GO (F3): implementacao slice por slice dentro da worktree da thread, um commit atomico por tarefa, baseline gravada antes de comecar. Roteia para ork worktree ensure, ork verify --baseline e ork phase run GO."
bucket: phases
roteia: "ork worktree ensure | ork verify --baseline | ork phase run <thread> GO"
license: MIT
---

# GO, implementacao

## O que esta skill e

Um roteador fino da fase GO. **A camada que apresenta nunca escreve codigo de produto:** quem
escreve e a orquestra, despachada pelo `ork`. Esta skill garante a worktree, grava a baseline,
despacha e depois reexecuta a verificacao no mundo real.

## Como rotear

```bash
ork worktree ensure <thread>                  # worktree isolada, base resolvida pelo ork
ork verify <thread> --baseline                # o estado do mundo ANTES de implementar
ork phase run <thread> GO --prompt "<tarefa>"
ork claims add <thread> <arquivo> --claim "<...>" --verificar "<comando>" --fase GO
ork verify <thread>                           # reexecuta no HEAD real
```

## O que o GO entrega

1. **Um commit atomico por tarefa**, com a thread e a tarefa na mensagem, no maximo cinco arquivos.
2. **Trabalho dentro da worktree da thread.** A arvore principal nao e area de trabalho de thread
   nenhuma, e a base carimbada no `thread.json` e o que diz de onde a thread partiu.
3. **Baseline gravada antes da primeira linha.** Sem baseline, uma falha depois nao distingue
   regressao de divida pre-existente, e a thread ou leva culpa alheia ou esconde o que quebrou.
4. **Uma claim por alegacao.** Todo arquivo citado, todo teste citado, toda funcao dita pronta vira
   claim com comando. Passagem relatada por agente nao e passagem.
5. **Nada fora das tarefas do PLAN.** Melhoria oportunista sem tarefa e scope creep: ela vira
   proposta, nunca commit escondido no meio da entrega. O que o diff faz alem do combinado o
   revisor tem que descobrir sozinho, e e assim que uma entrega pequena vira uma revisao cara.

## O que o nucleo verifica por voce

`ork verify` reexecuta claims e comandos do manifesto no HEAD real e compara com a baseline:
comando que passava antes e falha agora sai como `verify.regression`; o que ja falhava sai como
divida declarada. Citacao sem lastro sai como `claims.failed`. Os tres reprovam em qualquer modo.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Eu rodei e passou, pode confiar" | Passagem relatada nao e passagem. `ork verify` reexecuta no HEAD real, e e a saida real que vale. |
| "Deixa eu commitar tudo junto no fim" | Um commit por tarefa. Commit gigante nao reverte, nao revisa e nao diz qual pedaco quebrou. |
| "Mexo direto na arvore principal, e mais rapido" | A arvore principal nao e area de trabalho de thread. Worktree isolada e o que permite N threads sem colisao. |
| "Baseline e perda de tempo, o repo esta verde" | Se estivesse mesmo verde, a baseline custaria um comando. Sem ela, toda falha vira discussao sobre de quem e a culpa. |
| "Aproveitei e arrumei outra coisa no caminho" | Melhoria fora das tarefas do PLAN e scope creep: vira proposta, nunca commit escondido no meio da entrega. |
| "O teste falhando ja falhava antes" | Isso e exatamente o que a baseline responde por comando, em vez de por memoria. |

## Bandeiras vermelhas

- Commit com dezenas de arquivos e mensagem generica.
- Trabalho acontecendo fora da worktree da thread.
- Nenhuma baseline gravada antes do primeiro commit.
- Arquivo citado no resumo do runtime que nao aparece no `git show --stat`.
- Teste desligado ou assercao afrouxada para fechar a tarefa.
- Mudanca no diff que nao corresponde a nenhuma tarefa do PLAN.

## Verificacao antes de sair da fase

Worktree conferida por `ork worktree audit`, baseline gravada antes do GO, um commit por tarefa,
claims com comando para tudo que foi alegado, e `ork verify` verde ou com a divida declarada. Ver
`DoD 1`, `DoD 2`, `DoD 3` e `DoD 4`.
