---
id: MOD-04
tipo: modulo
titulo: Atenção humana
owner: Julio
estado: vigente
pai: SYS-01
verificado_em: 2026-09-24T21:30:00-03:00
---

# MOD-04 — Atenção humana

> **Em uma frase:** Decide o que merece o tempo do dono e entrega isso em camadas: resumo por hora, lote de até cinco perguntas com recomendação, decisões óbvias já tomadas e informadas.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** interrupções por semana caem para uma ou duas; nada bloqueante fica sem aviso.
- **Limites:** não aprova nada em nome do dono; prazo vencido espera ou escala, nunca aprova.
- **Código:** `core/src/hitl-contract.ts`, `core/src/hitl-resumo.ts`, `core/src/hitl-lote.ts`, `core/src/pulse.ts`, `core/src/decisao-autonoma.ts`, `core/src/horario.ts`, `core/src/master.ts`.

## Features

- [FEAT-011](FEAT-011-hitl-em-camadas.md) HITL em camadas: resumo, consentimento e lote
- [FEAT-012](FEAT-012-decisao-tomada.md) Decisão tomada com prestação de contas
- [FEAT-013](FEAT-013-horario-do-dono.md) Horário do dono em toda superfície humana
- [FEAT-014](FEAT-014-monitor-board-e-pulse.md) Monitor, board e pulse de atenção
- [FEAT-015](FEAT-015-entrega-e-indice-master.md) Entrega e índice de condução (MASTER)

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
