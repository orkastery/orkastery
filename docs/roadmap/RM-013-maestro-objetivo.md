---
id: RM-013
tipo: roadmap
titulo: "Maestro Mode B7: objetivo e envelope"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-24T21:30:00-03:00
estado:
  ciclo: Descontinuado
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Concluída
evidencias:
  codigo:
    commit: eb778c0
    pr: 2
sdlc:
  thread: null
  modo: null
---

# RM-013 — Maestro Mode B7: objetivo e envelope

> **Em uma frase:** Um runner de objetivo que encadeava threads atrás de um Objective Envelope; entregue em 13/09 e aposentado em 24/09 porque nunca foi usado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Descontinuado | Mesclado | Aprovados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** Não aplicável — sem feature vigente
- **Thread:** Não aplicável — sem thread

## Problema e resultado

- **Problema:** encadear threads inteiras atrás de um contrato de pronto verificável.
- **Resultado da época:** `ork objective`, envelope imutável, ensemble de validação e stop stack.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **O que sobreviveu:** validação por runtime diferente (`--exige-runtime-diferente`) e critério de pronto executável (`--done`), hoje propriedades de thread comum.

## Plano e decisões

- **Decisão de 20/09/2026:** remover o envelope ([RM-043](RM-043-aposentadoria.md)).

## Estado com evidências

- Merge `eb778c0` (PR #2, 13/09/2026), da branch `ork/ork-i13maestro-full`; a thread `ork-i13maestroob` deste projeto ficou no GOAL.
- Comando removido no merge `6c5fe8d` (24/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Descontinuado | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `eb778c0` · PR #2 | 2026-09-24 | Julio |
| Testes | Aprovados | — | 2026-09-24 | Julio |
| Deploy | Não implantado | — | 2026-09-24 | Julio |
| Exposição | Flag desligada | — | 2026-09-24 | Julio |
| Habilitação | Concluída | — | 2026-09-24 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-13 | entregue | PR #2, merge `eb778c0` | Julio |
| 2026-09-24 | descontinuado | RM-043, merge `6c5fe8d` | Julio |
