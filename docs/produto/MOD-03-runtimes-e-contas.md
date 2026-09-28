---
id: MOD-03
tipo: modulo
titulo: Runtimes e contas
owner: Julio
estado: vigente
pai: SYS-01
verificado_em: 2026-09-24T21:30:00-03:00
---

# MOD-03 — Runtimes e contas

> **Em uma frase:** Mantém a fábrica andando quando uma conta esgota ou uma sessão morre: rodízio de perfis, fallback de runtime, fila de rate limit e observação das sessões.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** nenhum roadmap para porque uma conta acabou ou porque uma sessão caiu sem aviso.
- **Limites:** nunca lê, copia ou migra credencial; o login é do próprio CLI do runtime.
- **Código:** `core/src/runtimes.ts`, `core/src/runtime-profiles.ts`, `core/src/retry.ts`, `core/src/ratelimit.ts`, `core/src/session-watcher.ts`, `core/src/session-watcher-claude.ts`.

## Features

- [FEAT-008](FEAT-008-rodizio-de-contas.md) Rodízio de contas dos runtimes
- [FEAT-009](FEAT-009-retry-tipado.md) Retry tipado e fila de rate limit
- [FEAT-010](FEAT-010-observacao-de-sessoes.md) Observação de sessões e sensores

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
