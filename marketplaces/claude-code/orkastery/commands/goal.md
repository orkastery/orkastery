---
description: Abre a thread do pedido e conduz a fase GOAL pelo `ork`.
argument-hint: "<pedido do builder, com #TAG opcional>"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /goal

Fase GOAL (F1): objetivo verificavel, exploracao do repositorio real, premissas explicitas e criterios que viram claims com comando. GOAL nao implementa.

## O que este comando faz

1. Extrai o modo de conducao do proprio pedido, sem reimplementar o parse:

```bash
MODO=$(ork modos --do-pedido "$ARGUMENTS")
```

2. Abre a thread com esse modo (o `ork` valida contra `conduction.allowed_modes` e recusa o que
   o projeto nao permite):

```bash
ork thread new "<nome curto da demanda>" --mode "$MODO" --worktree auto
```

3. Despacha a fase, com o pedido inteiro do builder:

```bash
ork phase run <thread> GOAL --prompt "$ARGUMENTS"
```

4. Registra como claim tudo que o GOAL alegou, com o comando que comprova cada alegacao, e
   reexecuta:

```bash
ork claims add <thread> <arquivo> --claim "<alegacao>" --verificar "<comando>" --fase GOAL
ork verify <thread> --so-claims
```

5. Se o modo pausa neste bloco, apresenta a evidencia ao builder e para. O pedido sai do nucleo, e a
   liberacao so e registrada quando o builder responde pelo canal autenticado:

```bash
ork gate request <thread>
```

## Regras do adaptador

- **Zero regra de negocio aqui.** Este comando traduz intencao em chamada de `ork` e nada mais.
  Quem valida modo, monta prompt, decide gate e prova entrega e o nucleo.
- **A #TAG vem do pedido, nao de configuracao.** O modo sai de `ork modos --do-pedido`, que usa a
  mesma funcao do nucleo; sem tag vale o `conduction.default_mode` do manifesto. A validacao
  contra `conduction.allowed_modes` acontece dentro do `ork thread new`, nunca aqui.
- **Nada de escrever codigo de produto neste comando.** Quem escreve e a sessao que o `ork`
  despacha, com o prompt gravado e o sha no ledger.
