---
id: MOD-05
tipo: modulo
titulo: Memória e registro
owner: Julio
estado: vigente
pai: SYS-01
verificado_em: 2026-09-24T21:30:00-03:00
---

# MOD-05 — Memória e registro

> **Em uma frase:** Guarda o que a próxima sessão precisa saber e o que o produto é: handoff triado, recall tardio, memória no OrkMind, telemetria do ledger e documentação como código.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** contexto certo na hora certa, sem janela inteira; documentação que não mente sobre o código.
- **Limites:** a memória degrada para arquivos com aviso tipado, nunca cai em silêncio para outra base.
- **Código:** `core/src/handoff.ts`, `core/src/recall.ts`, `core/src/memoria.ts`, `core/src/orkmind.ts`, `core/src/ledger-stats.ts`, `core/src/docs.ts`, `core/src/company-brain-cli.ts`.

## Features

- [FEAT-016](FEAT-016-handoff-e-recall.md) Handoff triado e recall tardio
- [FEAT-017](FEAT-017-memoria-orkmind.md) Memória no OrkMind com degradação honesta
- [FEAT-018](FEAT-018-documentacao-como-codigo.md) Documentação como código
- [FEAT-019](FEAT-019-telemetria-do-ledger.md) Telemetria econômica do ledger
- [FEAT-024](FEAT-024-company-brain-no-cli.md) Company Brain no CLI

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
