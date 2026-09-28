---
id: RM-041
tipo: roadmap
titulo: "HITL invertido: decisão tomada, lote e pergunta rara"
categoria: iniciativa
pai: null
features: [FEAT-011, FEAT-012, FEAT-021]
owner: Julio
atualizado_em: 2026-09-27T09:40:50-03:00
estado:
  ciclo: Disponível
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: f9d9bc1
    pr: 19
sdlc:
  thread: ork-i41hitlinver
  modo: "#Auto"
  fase: SHIP
  status: aberta
---

# RM-041 — HITL invertido: decisão tomada, lote e pergunta rara

> **Em uma frase:** O dono recebe um resumo por hora e escolhe quando responder; as perguntas chegam em lotes de até cinco, e o óbvio vem decidido e informado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Disponível | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-011](../produto/FEAT-011-hitl-em-camadas.md), [FEAT-012](../produto/FEAT-012-decisao-tomada.md), [FEAT-021](../produto/FEAT-021-ingresso-hitl-telegram.md)
- **Thread:** `ork-i41hitlinver`

## Problema e resultado

- **Problema:** "o Ork está sendo um peso, uma burocracia adicional" (dono, 20/09/2026) e 75 mensagens em minutos no Telegram.
- **Métricas:** interrupções por semana caem para uma ou duas; entregas por semana sobem.
- **Linha de base:** A definir — Julio, na primeira semana de uso depois da pausa.

## Escopo e validação

- **Incluído:** resumo recorrente em uma mensagem, consentimento e lote pelo Telegram, `ork.hitl/v2`, profundidade por pedido, decisão registrada com placar.
- **Fora de escopo:** tag de cadência ([RM-039](RM-039-cadencia-do-pulse-por-tag.md)).

## Plano e decisões

- **Decisão de 20/09/2026:** fábrica que entrega e presta contas, em vez de pedir autorização.

## Estado com evidências

- Merge `f9d9bc1` (PR #19, 24/09/2026) pelo CI independente.
- MASTER pendente.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Disponível | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `f9d9bc1` · PR #19 | 2026-09-27 | Julio |
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
| 2026-09-20 | thread aberta | cobrança do dono | Julio |
| 2026-09-24 | mesclado pelo CI independente | PR #19, merge `f9d9bc1` | Julio |
