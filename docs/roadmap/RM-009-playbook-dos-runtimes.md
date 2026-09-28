---
id: RM-009
tipo: roadmap
titulo: Playbook dos runtimes
categoria: iniciativa
pai: null
features: [FEAT-003]
owner: Julio
atualizado_em: 2026-09-27T23:46:57-03:00
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
  thread: ork-i09playbookr
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-009 — Playbook dos runtimes

> **Em uma frase:** Cada runtime usado no que faz melhor: plan mode, subagentes, limites por bloco, `AGENTS.md` gerado, schema de claims e revisão pelo codex.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-003](../produto/FEAT-003-despacho-de-fase.md)
- **Thread:** `ork-i09playbookr`

## Problema e resultado

- **Problema:** o despacho não usava as capacidades nativas de cada runtime.
- **Resultado:** playbook por runtime e `AGENTS.md` gerado.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** 6 de 6 claims, suíte 1.023 de 1.023 e eval com 13 canários (registro da época).

## Plano e decisões

- **Decisão:** limites nativos não comprovados ficam declarados no contrato.

## Estado com evidências

- Merge `348db2e` (13/09/2026).

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
| 2026-09-13 | entregue | merge `348db2e` | Julio |
