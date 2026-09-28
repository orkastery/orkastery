---
id: RM-034
tipo: roadmap
titulo: Conclusão nativa das sessões claude-bg
categoria: iniciativa
pai: null
features: [FEAT-003, FEAT-010]
owner: Julio
atualizado_em: 2026-09-24T21:33:13-03:00
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
    commit: 34e424e
    pr: 14
sdlc:
  thread: ork-i34claudebgr
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-034 — Conclusão nativa das sessões claude-bg

> **Em uma frase:** A fase termina quando o runtime diz que terminou: `phase_result` idempotente a partir do `done` do `claude agents`, com Stop correlacionado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-003](../produto/FEAT-003-despacho-de-fase.md), [FEAT-010](../produto/FEAT-010-observacao-de-sessoes.md)
- **Thread:** `ork-i34claudebgr`

## Problema e resultado

- **Problema:** sessão claude-bg concluída não fechava a fase (reproduzido em 19/09/2026).
- **Resultado:** observador claude-bg, `phase_result` sem código de saída inventado, PLAN sem plan mode.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Dívida publicada:** lacuna da D18 e P3 do CHECK-REVERIFY `c409bc98`: o núcleo não grava decisão avulsa do dono fora de pausa de bloco.

## Plano e decisões

- **Decisão:** a prova do lado do `ork` é condição da conclusão.

## Estado com evidências

- Merge `34e424e` (PR #14, 19/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `34e424e` · PR #14 | 2026-09-24 | Julio |
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
| 2026-09-19 | entregue | PR #14, merge `34e424e` | Julio |
