---
id: RM-031
tipo: roadmap
titulo: Grafo determinístico de código e artefatos
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-24T21:33:13-03:00
estado:
  ciclo: Refinamento
  documentacao: Rascunho
  codigo: Branch criada
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-i31kg1contra
  modo: "#Maestro"
  fase: PLAN
  status: aberta
---

# RM-031 — Grafo determinístico de código e artefatos

> **Em uma frase:** Um índice local de código e documentos (AST, arestas extraídas, consulta por caminho e impacto) para as fases pedirem só o contexto que precisam.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Refinamento | Branch criada | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** Não aplicável — sem feature vigente
- **Thread:** `ork-i31kg1contra`

## Problema e resultado

- **Problema:** não há AST nem grafo de código; cada fase relê arquivos inteiros.
- **Resultado pretendido:** pacotes KG1 a KG7 (contrato, extração, índice, incremental, consumo, federação, paridade).
- **Métrica:** A definir — Julio, no gate do KG1.

## Escopo e validação

- **Primeiro pacote:** KG1, contrato do grafo e do benchmark.

## Plano e decisões

- **Bloqueio atual:** gate humano do KG1 pendente.

## Estado com evidências

- Thread no PLAN.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Refinamento | — | 2026-09-24 | Julio |
| Documentação | Rascunho | — | 2026-09-24 | Julio |
| Código | Branch criada | — | 2026-09-24 | Julio |
| Testes | Não iniciados | — | 2026-09-24 | Julio |
| Deploy | Não implantado | — | 2026-09-24 | Julio |
| Exposição | Flag desligada | — | 2026-09-24 | Julio |
| Habilitação | Pendente | — | 2026-09-24 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-17 | thread aberta | thread `ork-i31kg1contra` | Julio |
