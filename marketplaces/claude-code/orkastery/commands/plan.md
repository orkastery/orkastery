---
description: Conduz a fase PLAN da thread pelo `ork`.
argument-hint: "<thread-id> [observacao]"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /plan

Fase PLAN (F2): tarefas fatiadas com `touch_paths` e verify por tarefa, decisoes D1..Dn com domicilio unico. PLAN nao implementa.

## O que este comando faz

1. Le o estado real da thread antes de qualquer coisa:

```bash
ork thread status <thread>
```

2. Despacha a fase:

```bash
ork phase run <thread> PLAN --prompt "<o que o plano precisa cobrir>"
```

3. Reserva as regioes que o plano declarou tocar, para que outra thread nao escreva por cima:

```bash
ork lease acquire "path:<glob>" --thread <thread> --motivo "PLAN reservou a regiao"
```

4. Exporta o handoff tipado para a fase seguinte, em vez de confiar na memoria da sessao:

```bash
ork handoff export <thread> --proxima-fase GO
```

5. Se o modo pausa, apresenta os tradeoffs com opcoes e uma recomendacao, e espera o veredito.

## Regras do adaptador

- **Zero regra de negocio aqui.** Este comando traduz intencao em chamada de `ork` e nada mais.
  Quem valida modo, monta prompt, decide gate e prova entrega e o nucleo.
- **A #TAG vem do pedido, nao de configuracao.** O modo sai de `ork modos --do-pedido`, que usa a
  mesma funcao do nucleo; sem tag vale o `conduction.default_mode` do manifesto. A validacao
  contra `conduction.allowed_modes` acontece dentro do `ork thread new`, nunca aqui.
- **Nada de escrever codigo de produto neste comando.** Quem escreve e a sessao que o `ork`
  despacha, com o prompt gravado e o sha no ledger.
