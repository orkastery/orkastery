---
id: RM-019
tipo: roadmap
titulo: Catálogo multi-repositório
categoria: iniciativa
pai: null
features: [FEAT-025]
owner: Julio
atualizado_em: 2026-09-24T21:30:00-03:00
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
  thread: null
  modo: null
---

# RM-019 — Catálogo multi-repositório

> **Em uma frase:** O CLI `ork portfolio` com workspaces e escopo, para uma mesma fábrica conduzir mais de um repositório.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-025](../produto/FEAT-025-catalogo-de-portfolio.md)
- **Thread:** Não aplicável — sem thread

## Problema e resultado

- **Problema:** um produto com vários repositórios não tinha catálogo.
- **Resultado:** `ork portfolio` e workspaces.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Mudança posterior:** o vínculo ao Objective Envelope saiu com a [RM-013](RM-013-maestro-objetivo.md).

## Plano e decisões

- **Dependência:** [RM-018](RM-018-ontologia-de-portfolio.md).

## Estado com evidências

- Merge `229c310` (PR #5, 13/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-24 | Julio |
| Testes | Aprovados | — | 2026-09-24 | Julio |
| Deploy | Produção | — | 2026-09-24 | Julio |
| Exposição | Geral | — | 2026-09-24 | Julio |
| Habilitação | Concluída | — | 2026-09-24 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-13 | entregue | PR #5, merge `229c310` | Julio |
