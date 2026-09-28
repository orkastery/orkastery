---
description: Fecha a thread com POSTMORTEM tipado e o score humano de 0 a 5.
argument-hint: "<thread-id> --score 0-5"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /master

Fase MASTER (F6): POSTMORTEM tipado, MASTER log no contrato congelado e o score humano com justificativa. Uma entrega sem MASTER log nao aconteceu.

## O que este comando faz

1. Mostra ao builder as classes de falha do catalogo fixo:

```bash
ork master classes
```

2. Pede ao builder o score e a justificativa. **O score e do humano, em todos os modos.** Este
   comando nunca inventa nota.

3. Fecha a thread:

```bash
ork master <thread> --score <0-5> --justificativa "<texto>" --classe <classe> --por "<quem>"
```

4. Nos modos sem pausa de MASTER, a entrega e aceita a menos que o builder diga o contrario. Mostra
   as entregas com o indice derivado do ledger, inclusive as ja pontuadas:

```bash
ork master --todas
```

## Regras do adaptador

- **Zero regra de negocio aqui.** Este comando traduz intencao em chamada de `ork` e nada mais.
  Quem valida modo, monta prompt, decide gate e prova entrega e o nucleo.
- **A #TAG vem do pedido, nao de configuracao.** O modo sai de `ork modos --do-pedido`, que usa a
  mesma funcao do nucleo; sem tag vale o `conduction.default_mode` do manifesto. A validacao
  contra `conduction.allowed_modes` acontece dentro do `ork thread new`, nunca aqui.
- **Nada de escrever codigo de produto neste comando.** Quem escreve e a sessao que o `ork`
  despacha, com o prompt gravado e o sha no ledger.
