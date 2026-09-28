---
id: FEAT-006
tipo: feature
titulo: Ship com push provado
estado: vigente
pai: MOD-02
roadmap: [RM-100, RM-012, RM-008]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T09:40:37-03:00
versao: main@96a030d
fontes:
  codigo:
    - core/src/ship.ts
    - core/src/entrega-pr.ts
  testes:
    - core/test/ship.test.ts
    - core/test/entrega-pr.test.ts
  simbolos:
    - core/src/ship.ts#ship
    - core/src/entrega-pr.ts#registrarEntregaPorPr
  comandos:
    - ork ship
    - ork ship registrar-pr
---

# FEAT-006 — Ship com push provado

> **Em uma frase:** O merge da thread na base é serializado por lease e só vale com o SHA que o remoto devolve em `ls-remote`; recibo de commit não substitui recibo de publicação.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@96a030d
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md), [RM-012](../roadmap/RM-012-ci-check-independente.md), [RM-008](../roadmap/RM-008-loop-de-aprendizado.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** mesclar a branch da thread na base e provar o push.
- **Pré-condições e gatilho:** CHECK verde; lease de merge livre.
- **Fluxo principal:**

  1. `ork ship <thread> --para main` toma o lease de merge.
  2. Faz merge `--no-ff` com a mensagem `ship(<thread>): merge de ...`.
  3. Empurra e confere o SHA no remoto; grava `ship_done` com o `mergeSha`.

- **Alternativas, erros e recuperação:** `--dry-run` mostra o plano; `--sem-push` registra que o push não aconteceu.
- **Entrega por PR (I-57):** quando o merge é feito pelo PR (CI independente verde no SHA exato e assunto `ship(<thread>): ...`), `ork ship registrar-pr <thread>` (ou `--todas`) grava o mesmo `ship_done`, com a prova do merge dentro da ponta remota (`ls-remote`) e o check do CI no head do PR. Sem CI verde, recusa.
- **Pós-condições:** evento `ship_done` no ledger; é a fonte que o `ork docs sincronizar` usa para marcar `codigo: Mesclado`.
- **Regras de negócio:** BR-006-01: push sem prova no remoto não é entrega. BR-006-02: push para a base exige autorização explícita (`--autorizar-push`). BR-006-03: a entrega por PR só vira `ship_done` com o merge na base remota e o CI verde no head do PR.
- **Critérios de aceite e testes:** Dado um remoto que recusa, quando o ship roda, então não há `ship_done` (`core/test/ship.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** `ship_done` (mergeSha, remoto, branch).
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
