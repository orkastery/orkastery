---
id: RM-012
tipo: roadmap
titulo: CI como CHECK independente
categoria: iniciativa
pai: null
features: [FEAT-005, FEAT-006]
owner: Julio
atualizado_em: 2026-09-28T15:23:46-03:00
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

# RM-012 — CI como CHECK independente

> **Em uma frase:** O CHECK roda num runner do GitHub, sem o ambiente de quem construiu, e o merge só acontece com o check verde no SHA exato.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-005](../produto/FEAT-005-ci-check-independente.md), [FEAT-006](../produto/FEAT-006-ship-com-push-provado.md)
- **Thread:** Não aplicável — sem thread

## Problema e resultado

- **Problema:** o CHECK na mesma máquina herdava o ambiente de quem construiu.
- **Resultado:** workflow headless e portão do merge pelo check exato.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Entregue:** 2 de 3 resultados.
- **Proteção nativa da `main`:** ligada em 28/09/2026 no repositório público, com os 4 checks obrigatórios e sem push forçado. Até então, recusada com HTTP 403 no repositório privado.

## Plano e decisões

- **Dependência:** plano do GitHub (Julio).
- **Decisão:** sem a proteção nativa, o portão é o `ork` recusar merge sem check verde no SHA.

## Estado com evidências

- Merge `1ff709c` (PR #1, 13/09/2026), da branch `ork/ork-i12cicheckin-full`; a thread `ork-i12cicomoche` deste projeto ficou no GOAL e não conduziu a entrega.
- Desde 24/09/2026 é também a prova confiável desta VPS, onde o verify local sofre com CPU roubada.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-28 | Julio |
| Documentação | Em revisão | — | 2026-09-28 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-28 | Julio |
| Testes | Aprovados | — | 2026-09-28 | Julio |
| Deploy | Produção | — | 2026-09-28 | Julio |
| Exposição | Geral | — | 2026-09-28 | Julio |
| Habilitação | Concluída | — | 2026-09-28 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-13 | entregue em parte (2 de 3) | PR #1, merge `1ff709c` | Julio |
| 2026-09-28 | concluído | proteção nativa da `main` no repositório público, com os 4 checks obrigatórios | Julio |
