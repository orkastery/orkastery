---
id: RM-007
tipo: roadmap
titulo: Telemetria econômica no ledger
categoria: iniciativa
pai: null
features: [FEAT-019]
owner: Julio
atualizado_em: 2026-09-24T21:33:12-03:00
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
    commit: c83a740
    pr: null
sdlc:
  thread: ork-i07telemetri
  modo: "#Auto"
  fase: SHIP
  status: aberta
---

# RM-007 — Telemetria econômica no ledger

> **Em uma frase:** Tempo, tokens, custo, espera humana e risco evitado medidos a partir do ledger, com a estimativa do PLAN registrada antes do trabalho.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-019](../produto/FEAT-019-telemetria-do-ledger.md)
- **Thread:** `ork-i07telemetri`

## Problema e resultado

- **Problema:** não havia como mostrar o que a condução economiza.
- **Resultado:** `ork ledger stats` e o contrato `ork.ledger-stats/v1`.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** 3 de 3 claims ativas e suíte 829 de 829 (registro da época).

## Plano e decisões

- **Decisão:** estimativa do PLAN com método e premissas explícitos.

## Estado com evidências

- Merge `c83a740` (13/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `c83a740` | 2026-09-24 | Julio |
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
| 2026-09-13 | entregue | merge `c83a740` | Julio |
