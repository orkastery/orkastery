---
description: Fecha a thread com POSTMORTEM tipado e o score humano de 0 a 5.
argument-hint: "<thread-id>"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /master

Fase MASTER (F6): POSTMORTEM tipado, MASTER log no contrato congelado e o score humano com justificativa. Uma entrega sem MASTER log nao aconteceu.

## O que este comando faz

1. Mostra ao builder as classes de falha do catalogo fixo:

```bash
ork master classes
```

2. Pede a nota ao dono pelo canal com prova (RM-048). **O score e do humano, em todos os modos.**
   Este comando nunca inventa nota e nunca escreve `--por` em nome de ninguem:

```bash
ork master pedir <thread> --formato terminal
```

   Mostre a linha como vem. O dono responde no Telegram (`<codigo> <0 a 5> <porque>`) e o nucleo
   grava a nota com o recibo do ingresso. `ork master <thread> --score ... --por` chamado daqui e
   recusado com `master.prova-de-canal`; do terminal dele, fora do host, o dono pode usa-lo.
3. Confira que a nota entrou no ledger:

```bash
ork master --todas
```

4. Nos modos sem pausa de MASTER, a entrega e aceita a menos que o builder diga o contrario; o
   `ork master --todas` mostra as entregas com o indice derivado do ledger, inclusive as ja pontuadas.
   Para fechar por omissao, sempre com a thread, que e so a sua:

```bash
ork master <thread> --aceitar-omissao
```

   Sem a thread, o comando aceita TODAS as entregues do projeto, inclusive as de outras frentes
   paralelas; `ork master --aceitar-omissao --dry-run` mostra quais, sem gravar.

## Regras do adaptador

- **Zero regra de negocio aqui.** Este comando traduz intencao em chamada de `ork` e nada mais.
  Quem valida modo, monta prompt, decide gate e prova entrega e o nucleo.
- **A #TAG vem do pedido, nao de configuracao.** O modo sai de `ork modos --do-pedido`, que usa a
  mesma funcao do nucleo; sem tag vale o `conduction.default_mode` do manifesto. A validacao
  contra `conduction.allowed_modes` acontece dentro do `ork thread new`, nunca aqui.
- **Nada de escrever codigo de produto neste comando.** Quem escreve e a sessao que o `ork`
  despacha, com o prompt gravado e o sha no ledger.
