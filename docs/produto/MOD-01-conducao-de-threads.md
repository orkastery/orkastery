---
id: MOD-01
tipo: modulo
titulo: Condução de threads
owner: Julio
estado: vigente
pai: SYS-01
verificado_em: 2026-09-24T21:30:00-03:00
---

# MOD-01 — Condução de threads

> **Em uma frase:** Abre a thread, escolhe o modo, monta o prompt de cada fase e despacha o runtime certo, com o trio runtime, modelo e esforço registrado no ledger.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** levar um pedido do builder do GOAL ao MASTER sem cerimônia desnecessária.
- **Limites:** não verifica a entrega (isso é do [MOD-02](MOD-02-verdade-e-entrega.md)).
- **Código:** `core/src/thread.ts`, `core/src/modos.ts`, `core/src/phase.ts`, `core/src/prompts.ts`, `core/src/setup.ts`, `core/src/onboarding.ts`, `core/src/portfolio.ts`, `core/src/conducao.ts`.

## Features

- [FEAT-001](FEAT-001-thread-e-seis-fases.md) Thread e ciclo de seis fases
- [FEAT-002](FEAT-002-modos-de-conducao.md) Modos de condução
- [FEAT-003](FEAT-003-despacho-de-fase.md) Despacho de fase para o runtime
- [FEAT-023](FEAT-023-onboarding-do-projeto.md) Onboarding do projeto
- [FEAT-025](FEAT-025-catalogo-de-portfolio.md) Catálogo de portfólio
- [FEAT-029](FEAT-029-conducao-multicanal.md) Condução multicanal da thread

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
