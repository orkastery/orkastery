---
name: plan-specification
description: "Fase PLAN (F2): plano com tarefas fatiadas, touch_paths consultaveis, decisoes D1..Dn com domicilio unico e verify executavel por tarefa. Roteia para ork phase run PLAN e ork lease acquire."
bucket: phases
roteia: "ork phase run <thread> PLAN | ork lease acquire"
license: MIT
---

# PLAN, especificacao

## O que esta skill e

Um roteador fino da fase PLAN. Ela nao escreve o codigo do plano e nao decide sozinha o que e
tradeoff do humano: ela despacha a fase pelo `ork` e transforma o plano em tarefas com verify.
**PLAN nao implementa.**

## Como rotear

```bash
ork phase run <thread> PLAN --prompt "<pedido do builder>"
ork lease acquire "path:<glob>" --thread <thread> --motivo "PLAN reservou a regiao"
ork gate approve <thread> premissas --por <quem>
ork handoff export <thread> --proxima-fase GO
```

## O que o PLAN entrega

1. **Tarefas fatiadas ate caberem em um commit atomico.** No maximo cinco arquivos por tarefa.
   Tarefa maior que isso volta a ser fatiada antes do GO, nao durante.
2. **`touch_paths` por tarefa.** O caminho que a tarefa vai tocar e declarado antes, e e ele que
   justifica o lease `path:<glob>`. Regiao nao declarada e colisao esperando acontecer.
3. **Um verify executavel por tarefa.** Toda tarefa carrega o comando que prova que ela terminou.
   Tarefa sem verify e desejo, nao tarefa.
4. **Decisoes D1..Dn com domicilio unico.** Cada decisao mora em um lugar so, e depois de decidida
   fica travada. Reabrir e decisao nova com registro, nunca edicao silenciosa da anterior.
5. **O que fica fora do escopo**, escrito, para que o CHECK possa chamar de scope creep o que
   aparecer alem disso.

## O que o nucleo verifica por voce

O lease `path:<glob>` do `ork` recusa duas threads na mesma regiao e coloca a segunda em fila com
posicao; o handoff tipado leva as decisoes fechadas para a fase seguinte sem depender de a sessao
lembrar delas.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "O plano ja esta na minha cabeca, escrever atrasa" | Plano que nao esta em disco nao sobrevive a rotacao de janela, e a fase seguinte comeca adivinhando. |
| "Essa tarefa e grande mas coesa, deixa inteira" | Tarefa maior que cinco arquivos volta a ser fatiada. Commit atomico e o que torna reversivel o que der errado. |
| "Depois eu decido esse tradeoff, no meio do GO" | Tradeoff decidido no meio do GO e decidido sob pressa e sem registro. Decisao tem domicilio unico e trava ao fechar. |
| "Escrever verify por tarefa e cerimonia" | Tarefa sem verify e desejo. Sem comando, "pronto" vira opiniao do agente e o CHECK nao tem contra o que comparar. |
| "Nao preciso declarar touch_paths, e obvio onde vou mexer" | O lease sai do `touch_paths`. Regiao nao declarada e o caminho normal de duas threads se atropelarem. |

## Bandeiras vermelhas

- Tarefa sem comando de verify.
- Tarefa que toca mais de cinco arquivos.
- Decisao repetida em dois lugares do plano, com redacoes diferentes.
- `touch_paths` ausente numa thread que roda em paralelo com outra.
- PLAN que ja traz o codigo pronto: PLAN nao implementa.

## Verificacao antes de sair da fase

Tarefas fatiadas com verify, `touch_paths` declarados, decisoes com domicilio unico e travadas,
fora de escopo escrito, e o gate de premissas resolvido pelo caminho que o modo exige. Ver
`DoD 19` e `DoD 20`.
