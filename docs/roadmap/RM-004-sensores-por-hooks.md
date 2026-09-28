---
id: RM-004
tipo: roadmap
titulo: Sensores por hooks e watcher do codex
categoria: iniciativa
pai: null
features: [FEAT-010]
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
  thread: ork-i0404sensore
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-004 — Sensores por hooks e watcher do codex

> **Em uma frase:** Hooks de Notification, Stop e SubagentStop e o watcher do rollout do codex avisam em segundos quando uma sessão trava ou morre.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-010](../produto/FEAT-010-observacao-de-sessoes.md)
- **Thread:** `ork-i0404sensore`

## Problema e resultado

- **Problema:** sessão morria sem evento e o despacho era dado como vivo.
- **Resultado:** `sessao_bloqueada` em menos de 5 s; zero sessões mortas sem evento.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** harness `core/scripts/smoke-sensores.cjs` e canário `fx-sensores-runtime`.

## Plano e decisões

- **Decisão:** sensor lê o runtime; nunca o relato do agente.

## Estado com evidências

- Merge `1e00996` (08/09/2026).

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
| 2026-09-08 | entregue | merge `1e00996` | Julio |
