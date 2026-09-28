---
id: RM-002
tipo: roadmap
titulo: Higiene de runtime e governança de sessões
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
  thread: ork-i02higieneru
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-002 — Higiene de runtime e governança de sessões

> **Em uma frase:** Chave paga fora do ambiente da fábrica, sandbox `workspace-write` e inventário de sessões com adoção, para nenhuma sessão rodar fora do `ork` sem ser vista.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-010](../produto/FEAT-010-observacao-de-sessoes.md)
- **Thread:** `ork-i02higieneru`

## Problema e resultado

- **Problema:** 49 sessões fora do `ork` na mesma máquina e codex em `danger-full-access` (diagnóstico de 07/09).
- **Resultado:** política `subscription-only`, sandbox versionado e `ork sessions adopt`.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** `ork doctor` sem aviso e zero sessões fora do `ork`.

## Plano e decisões

- **Decisão:** política `subscription-only`; chave paga é `cost.violation`.

## Estado com evidências

- Merge `c1fe88b` (08/09/2026).

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
| 2026-09-08 | entregue | merge `c1fe88b` | Julio |
