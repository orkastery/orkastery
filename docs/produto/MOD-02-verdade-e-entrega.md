---
id: MOD-02
tipo: modulo
titulo: Verdade e entrega
owner: Julio
estado: vigente
pai: SYS-01
verificado_em: 2026-09-24T21:30:00-03:00
---

# MOD-02 — Verdade e entrega

> **Em uma frase:** Transforma afirmação em prova: claims com comando, verify no HEAD real, CHECK independente no CI e merge com push provado, cada thread na sua worktree.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** nenhuma entrega vale por declaração do agente.
- **Limites:** não decide se a entrega é boa para o produto; só se o que foi dito é verdade.
- **Código:** `core/src/claims.ts`, `core/src/verify.ts`, `core/src/ci.ts`, `core/src/ship.ts`, `core/src/worktree.ts`, `core/src/leases.ts`, `core/src/auditoria.ts`.

## Features

- [FEAT-004](FEAT-004-claims-e-verify.md) Claims e verify no HEAD real
- [FEAT-005](FEAT-005-ci-check-independente.md) CI como CHECK independente
- [FEAT-006](FEAT-006-ship-com-push-provado.md) Ship com push provado
- [FEAT-007](FEAT-007-worktree-e-leases.md) Worktree e leases por thread
- [FEAT-022](FEAT-022-auditoria-e-divida.md) Auditoria periódica e board de dívida

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
