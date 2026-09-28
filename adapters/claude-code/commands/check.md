---
description: Conduz a fase CHECK da thread e consolida um veredito unico.
argument-hint: "<thread-id>"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /check

Fase CHECK (F4): verificacao contra a baseline, os cinco eixos de review, seguranca com zero bloqueadores, auditoria de delegacao e exatamente um veredito.

## O que este comando faz

1. Reexecuta tudo no HEAD real:

```bash
ork verify <thread>
ork worktree audit <thread>
```

2. Roda os quatro reviewers do catalogo sobre o escopo declarado: `code-reviewer`,
   `security-auditor`, `test-engineer` e `web-performance-auditor`. Use os subagentes
   `ork-check` e companhia quando quiser isolar o contexto de cada um.

3. Le o ledger para a auditoria de delegacao:

```bash
ork phase list <thread>
```

4. Consolida UM veredito (PASSOU, PRECISA DE MUDANCA, BLOQUEADO) e, se o modo pausa, apresenta ao
   builder e espera:

```bash
ork gate approve <thread> evidencias --por "<quem>"
```

## Regras do adaptador

- **Zero regra de negocio aqui.** Este comando traduz intencao em chamada de `ork` e nada mais.
  Quem valida modo, monta prompt, decide gate e prova entrega e o nucleo.
- **A #TAG vem do pedido, nao de configuracao.** O modo sai de `ork modos --do-pedido`, que usa a
  mesma funcao do nucleo; sem tag vale o `conduction.default_mode` do manifesto. A validacao
  contra `conduction.allowed_modes` acontece dentro do `ork thread new`, nunca aqui.
- **Nada de escrever codigo de produto neste comando.** Quem escreve e a sessao que o `ork`
  despacha, com o prompt gravado e o sha no ledger.
