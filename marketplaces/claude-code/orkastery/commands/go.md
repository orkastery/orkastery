---
description: Conduz a fase GO da thread pelo `ork`, dentro da worktree isolada.
argument-hint: "<thread-id> [tarefa]"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /go

Fase GO (F3): implementacao slice por slice, um commit atomico por tarefa, dentro da worktree da thread. Quem escreve codigo e a sessao despachada, nunca este comando.

## O que este comando faz

1. Garante a worktree e grava a baseline ANTES da primeira linha de codigo:

```bash
ork worktree ensure <thread>
ork verify <thread> --baseline
```

2. Despacha a tarefa:

```bash
ork phase run <thread> GO --prompt "<tarefa do PLAN, uma por vez>"
```

3. Reexecuta a verificacao no HEAD real e compara com a baseline:

```bash
ork verify <thread>
```

4. Confere que a worktree continua consistente no proprio git:

```bash
ork worktree audit <thread>
```

## Regras do adaptador

- **Zero regra de negocio aqui.** Este comando traduz intencao em chamada de `ork` e nada mais.
  Quem valida modo, monta prompt, decide gate e prova entrega e o nucleo.
- **A #TAG vem do pedido, nao de configuracao.** O modo sai de `ork modos --do-pedido`, que usa a
  mesma funcao do nucleo; sem tag vale o `conduction.default_mode` do manifesto. A validacao
  contra `conduction.allowed_modes` acontece dentro do `ork thread new`, nunca aqui.
- **Nada de escrever codigo de produto neste comando.** Quem escreve e a sessao que o `ork`
  despacha, com o prompt gravado e o sha no ledger.
