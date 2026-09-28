---
id: RM-018
tipo: roadmap
titulo: Ontologia de portfólio
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

# RM-018 — Ontologia de portfólio

> **Em uma frase:** Produto, projeto e iniciativa com relações, status, critérios de aceite e escopo de ciclo, compartilhados entre OrkMind e Orkastery.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-025](../produto/FEAT-025-catalogo-de-portfolio.md)
- **Thread:** Não aplicável — sem thread

## Problema e resultado

- **Problema:** a condução não sabia a que resultado cada thread servia.
- **Resultado:** 23 coleções, 11 dimensões, pais, prefixos e dependências.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Produto principal:** OrkMind; este item cobre o catálogo no Orkastery.

## Plano e decisões

- **Decisão:** ontologia única para os dois produtos.

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
