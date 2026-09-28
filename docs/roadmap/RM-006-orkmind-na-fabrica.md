---
id: RM-006
tipo: roadmap
titulo: OrkMind ligado na fábrica
categoria: iniciativa
pai: null
features: [FEAT-017]
owner: Julio
atualizado_em: 2026-09-24T23:03:12-03:00
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
    commit: 175e3cd
    pr: null
sdlc:
  thread: ork-i06orkmindfa
  modo: "#Auto"
  fase: SHIP
  status: aberta
---

# RM-006 — OrkMind ligado na fábrica

> **Em uma frase:** A fábrica publica decisões e handoffs no OrkMind do tenant Orkastery, com ponte npm, handoff G3 e decisão humana comprovada.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-017](../produto/FEAT-017-memoria-orkmind.md)
- **Thread:** `ork-i06orkmindfa`

## Problema e resultado

- **Problema:** a camada OrkMind estava desligada no diagnóstico inicial.
- **Resultado:** tenant Orkastery, ponte npm, handoff G3 e degradação tipada.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** 72 de 72 claims ativas no SHIP e suíte 825 de 825 (registro da época).

## Plano e decisões

- **Produto principal:** OrkMind; este item cobre a parte do Orkastery.

## Estado com evidências

- Merges `175e3cd` e `2765daf` (12/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `175e3cd` | 2026-09-24 | Julio |
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
| 2026-09-12 | entregue | merges `175e3cd` e `2765daf` | Julio |
