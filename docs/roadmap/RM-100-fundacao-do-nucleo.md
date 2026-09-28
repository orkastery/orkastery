---
id: RM-100
tipo: roadmap
titulo: "Fundação do núcleo: blocos B0 a B6"
categoria: iniciativa
pai: null
features:
  - FEAT-001
  - FEAT-002
  - FEAT-004
  - FEAT-006
  - FEAT-007
  - FEAT-009
  - FEAT-016
  - FEAT-022
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

# RM-100 — Fundação do núcleo: blocos B0 a B6

> **Em uma frase:** A base do `ork`: threads e fases, verdade por claims, worktrees e escalonador, autonomia com retry tipado, adaptadores, auditores e a camada de memória.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-001](../produto/FEAT-001-thread-e-seis-fases.md), [FEAT-002](../produto/FEAT-002-modos-de-conducao.md), [FEAT-004](../produto/FEAT-004-claims-e-verify.md), [FEAT-006](../produto/FEAT-006-ship-com-push-provado.md), [FEAT-007](../produto/FEAT-007-worktree-e-leases.md), [FEAT-009](../produto/FEAT-009-retry-tipado.md), [FEAT-016](../produto/FEAT-016-handoff-e-recall.md), [FEAT-022](../produto/FEAT-022-auditoria-e-divida.md)
- **Thread:** Não aplicável — sem thread

## Problema e resultado

- **Problema:** agentes narravam sucesso sem prova e duas sessões pisavam uma na outra.
- **Resultado:** B0 fundação, B1 verdade, B2 threads e score, B3 autonomia, B4 adaptadores, B5 auditores, B6 camada OrkMind.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Incluído:** os blocos B0 a B6: threads e fases, verdade e entrega, worktrees e leases, autonomia, prompts, auditores e memória ([conceitos](../conceitos/visao-geral.md)).
- **Fora de escopo:** B7 (virou [RM-013](RM-013-maestro-objetivo.md)) e B8 (distribuição).
- **Critério de aceite:** comandos da coluna "Prove com" do roadmap histórico.

## Plano e decisões

- **Prioridade:** fundação; precede todos os itens I-NN.
- **Decisões:** registradas nos MASTER logs das threads de agosto e setembro de 2026.

## Estado com evidências

- O código chegou a este repositório no commit `2bea2a7` (sincronização da árvore do produto, 04/09/2026).
- Testes: suíte do núcleo verde no CI.

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
| 2026-09-04 | código dos blocos sincronizado neste repositório | commit `2bea2a7` | Julio |
