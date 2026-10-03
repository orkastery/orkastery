---
id: FEAT-006
tipo: feature
titulo: Ship com push provado
estado: vigente
pai: MOD-02
roadmap: [RM-100, RM-012, RM-008]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-03T06:52:15-03:00
versao: main@059f257a
evidencias:
  codigo:
    commit: d2a54075
    pr: 50
    fatia4: "107ac246, PR #45"
    fatia5: "d2a54075, PR #50"
fontes:
  codigo:
    - core/src/ship.ts
    - core/src/entrega-pr.ts
  testes:
    - core/test/ship.test.ts
    - core/test/entrega-pr.test.ts
    - core/test/rm037-fatia5-merge-incorporado.test.ts
  simbolos:
    - core/src/ship.ts#ship
    - core/src/ship.ts#commitQueIncorporou
    - core/src/entrega-pr.ts#registrarEntregaPorPr
  comandos:
    - ork ship
    - ork ship registrar-pr
---

# FEAT-006 — Ship com push provado

> **Em uma frase:** A entrega serializa o merge por lease e prova no remoto a ponta da base; o recibo identifica também o commit que incorporou a branch da thread.

- **Estado:** vigente · **Verificado em:** 2026-10-03 · **Versão:** main@059f257a
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md), [RM-012](../roadmap/RM-012-ci-check-independente.md), [RM-008](../roadmap/RM-008-loop-de-aprendizado.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** mesclar a branch da thread na base e provar o push.
- **Pré-condições e gatilho:** CHECK verde; lease de merge livre.
- **Fluxo principal:**

  1. `ork ship <thread> --para main` toma o lease de merge.
  2. Faz merge `--no-ff` com a mensagem `ship(<thread>): merge de ...`.
  3. Empurra e confere a ponta da base no remoto; grava `ship_done` com `mergeSha`, `pontaDaBase` e `shaRemoto`.

- **Branch já incorporada (RM-037, fatia 5):** `mergeSha` é o commit de primeiro pai da base que trouxe a branch, ou a própria ponta da branch no fast-forward. `pontaDaBase` é a ponta publicada, que pode ter avançado depois desse merge. A prova do push e o recibo do Maestro conferem `shaRemoto` contra `pontaDaBase`; não atribuem à thread o merge de outra entrega.

- **Alternativas, erros e recuperação:** `--dry-run` mostra o plano; `--sem-push` registra que o push não aconteceu.
- **Entrega por PR (I-57):** quando o merge é feito pelo PR (CI independente verde no SHA exato e assunto `ship(<thread>): ...`), `ork ship registrar-pr <thread>` (ou `--todas`) grava o mesmo `ship_done`, com a prova do merge dentro da ponta remota (`ls-remote`) e o check do CI no head do PR. Sem CI verde, recusa. O registro também grava `pontaDaBase`.
- **Pós-condições:** evento `ship_done` no ledger; é a fonte que o `ork docs sincronizar` usa para marcar `codigo: Mesclado`.
- **Regras de negócio:** BR-006-01: push sem prova no remoto não é entrega. BR-006-02: push para a base exige autorização explícita (`--autorizar-push`). BR-006-03: a entrega por PR só vira `ship_done` com o merge na base remota e o CI verde no head do PR.
- **Compatibilidade dos recibos (RM-037, fatias 4 e 5):** o leitor de trabalho parado aceita o `ship_done` antigo cujo `mergeSha` era a ponta da base, se ela contém o merge da thread. Isso evita avisar "falta registrar a entrega" para uma entrega já registrada. Uma entrega nova posterior ao recibo continua pendente.
- **Critérios de aceite e testes:** Dado um remoto que recusa, quando o ship roda, então não há `ship_done` (`core/test/ship.test.ts`). Dada uma base que avançou depois do merge da thread, o recibo conserva esse merge e prova a ponta atual, inclusive no fast-forward, em branch de integração e no registro por PR (`core/test/rm037-fatia5-merge-incorporado.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** `ship_done` (`mergeSha`, `pontaDaBase`, `shaRemoto`, `pushVerificado`, remoto, branch). `mergeSha` identifica a incorporação; `pontaDaBase` identifica a ponta conferida no remoto.
- **APIs:** git remoto.
- **Eventos:** `ship_done`, `ship_blocked`.

## Operação e controle

- **Observabilidade:** `ork phase list <thread>`; `git log --grep "ship(<thread>)"`.
- **Rollback:** `git revert -m 1 <mergeSha>` por PR; o ledger registra o `rollback_done`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-27 | a entrega feita por PR também vira `ship_done` (`ork ship registrar-pr`) | Claude (agente) / Julio, revisão pendente | RM-008 |
| 2026-10-03 | Recibo separa o commit de incorporação da ponta provada no remoto; leitor aceita recibos legados sem ocultar nova entrega | Codex (agente) / revisão pendente | RM-037: fatia 4 em `107ac246` (PR #45), fatia 5 em `d2a54075` (PR #50) |
