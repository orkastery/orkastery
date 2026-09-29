---
id: RM-031
tipo: roadmap
titulo: Grafo determinístico de código e artefatos
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-28T22:14:30-03:00
estado:
  ciclo: Refinamento
  documentacao: Rascunho
  codigo: Branch criada
  testes: Em execução
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
  fase: GO
  status: aberta
---

# RM-031 — Grafo determinístico de código e artefatos

> **Em uma frase:** Um índice local de código e documentos (AST, arestas extraídas, consulta por caminho e impacto) para as fases pedirem só o contexto que precisam.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Refinamento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** Não aplicável — sem feature vigente
- **Thread:** `ork-i31kg1contra`

## Problema e resultado

- **Problema:** não há AST nem grafo de código; cada fase relê arquivos inteiros.
- **Resultado pretendido:** pacotes KG1 a KG7 (contrato, extração, índice, incremental, consumo, federação, paridade).
- **Métrica:** mediana de `logical_total_tokens` por par, com B (grafo) menor que A (leitura atual), fatos, claims e verify preservados e zero aresta falsa (critério do [protocolo](../referencia/contratos/benchmark-grafo-kg1.md)).
- **Linha de base:** A definir (Julio): sai da primeira execução medida do protocolo, depois do KG3.

## Escopo e validação

- **KG1, na branch da thread:** o [contrato do grafo](../referencia/contratos/grafo-deterministico-kg1.md) `ork.code-artifact-graph/v1` e o [protocolo do benchmark](../referencia/contratos/benchmark-grafo-kg1.md) `ork.graph-benchmark/v1`, com validação pura e corpus sintético.
- **Benchmark:** formato e veredito prontos; o experimento não foi executado e não há número de economia.
- **Fora do KG1:** extração (KG2), índice e CLI (KG3), incremental (KG4), consumo pelas fases (KG5), federação (KG6) e paridade entre hosts (KG7).

## Plano e decisões

- **Decisões:** D1 a D11 da thread; premissas aprovadas pelo dono em 27/09/2026 (gate `premissas`).
- **Próximo passo:** CHECK independente e SHIP do KG1; depois, KG2 (extração).

## Estado com evidências

- Contratos, validação e corpus do KG1 implementados na branch da thread, com os testes dos grupos KG1 verdes.
- O Company Brain v1 e o adaptador semântico ficam intactos: os três hashes congelados passam no teste de fronteira.
- Nenhum registro `measured` de benchmark existe; todo veredito do KG1 é sobre dado sintético.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Refinamento | — | 2026-09-28 | Julio |
| Documentação | Rascunho | — | 2026-09-28 | Julio |
| Código | Branch criada | — | 2026-09-28 | Julio |
| Testes | Em execução | — | 2026-09-28 | Julio |
| Deploy | Não implantado | — | 2026-09-28 | Julio |
| Exposição | Flag desligada | — | 2026-09-28 | Julio |
| Habilitação | Pendente | — | 2026-09-28 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-17 | thread aberta | thread `ork-i31kg1contra` | Julio |
| 2026-09-27 | premissas e decisões D1 a D11 aprovadas | gate `premissas` pelo canal do dono | Julio |
| 2026-09-28 | KG1 implementado na branch da thread | contratos do grafo e do benchmark, validação e corpus sintético; benchmark não executado | Julio |
