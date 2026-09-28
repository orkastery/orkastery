---
id: RM-003
tipo: roadmap
titulo: HITL bidirecional no Telegram
categoria: iniciativa
pai: null
features: [FEAT-011, FEAT-021]
owner: Julio
atualizado_em: 2026-09-27T23:46:56-03:00
estado:
  ciclo: Concluído
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-i03hitlteleg
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-003 — HITL bidirecional no Telegram

> **Em uma frase:** O dono responde gates pelo Telegram com prova de origem, e a aprovação automática cega sai de cena.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-011](../produto/FEAT-011-hitl-em-camadas.md), [FEAT-021](../produto/FEAT-021-ingresso-hitl-telegram.md)
- **Thread:** `ork-i03hitlteleg`

## Problema e resultado

- **Problema:** um watchdog aprovava todo `human.pending` em nome do dono a cada 5 minutos.
- **Resultado:** `human_gate` pelo Telegram e delegação tipada; canário `fx-blanket-approve`.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** gate respondido em menos de 60 s pelo Telegram.

## Plano e decisões

- **Decisão:** o agente nunca responde no lugar do dono.

## Estado com evidências

- Merge `2363e59` (09/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-27 | Julio |
| Testes | Aprovados | — | 2026-09-27 | Julio |
| Deploy | Produção | — | 2026-09-27 | Julio |
| Exposição | Geral | — | 2026-09-27 | Julio |
| Habilitação | Concluída | — | 2026-09-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-09 | entregue | merge `2363e59` | Julio |
