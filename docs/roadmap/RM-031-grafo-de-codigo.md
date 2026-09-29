---
id: RM-031
tipo: roadmap
titulo: Grafo determinístico de código e artefatos
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-29T09:42:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: PR aberto
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: "8589330"
    pr: null
sdlc:
  thread: ork-rm031kg2extr
  modo: "#Auto"
---

# RM-031 — Grafo determinístico de código e artefatos

> **Em uma frase:** Um índice local de código e documentos (AST, arestas extraídas, consulta por caminho e impacto) para as fases pedirem só o contexto que precisam.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | PR aberto | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** Não aplicável — sem feature vigente
- **Thread:** `ork-rm031kg2extr` (KG2); o KG1 foi a `ork-i31kg1contra`

## Problema e resultado

- **Problema:** não há AST nem grafo de código; cada fase relê arquivos inteiros.
- **Resultado pretendido:** pacotes KG1 a KG7 (contrato, extração, índice, incremental, consumo, federação, paridade).
- **Métrica:** mediana de `logical_total_tokens` por par, com B (grafo) menor que A (leitura atual), fatos, claims e verify preservados e zero aresta falsa (critério do [protocolo](../referencia/contratos/benchmark-grafo-kg1.md)).
- **Linha de base:** A definir (Julio): sai da primeira execução medida do protocolo, depois do KG3.

## Escopo e validação

- **KG1, mesclado (PR #20):** o [contrato do grafo](../referencia/contratos/grafo-deterministico-kg1.md) `ork.code-artifact-graph/v1` e o [protocolo do benchmark](../referencia/contratos/benchmark-grafo-kg1.md) `ork.graph-benchmark/v1`, com validação pura e corpus sintético.
- **KG2, no PR da thread `ork-rm031kg2extr`:** a [extração determinística](../referencia/contratos/extracao-grafo-kg2.md) de um repositório local: TypeScript e JavaScript pelo compilador já instalado no core, Markdown (seções, links, frontmatter e IDs citados), proveniência por aresta e o que não se prova fora e declarado.
- **Benchmark:** formato e veredito prontos; o experimento não foi executado e não há número de economia.
- **Fora até aqui:** índice e CLI de consulta (KG3), incremental (KG4), consumo pelas fases (KG5), federação (KG6) e paridade entre hosts (KG7).

## Plano e decisões

- **Decisões:** KG1, D1 a D11 da thread `ork-i31kg1contra`, com premissas aprovadas pelo dono em 27/09/2026 (gate `premissas`). KG2, D1 a D14 da thread `ork-rm031kg2extr`, tomadas em #Auto e registradas no ledger.
- **Próximo passo:** merge do KG2 com o CI verde; depois, KG3 (índice persistente e CLI de consulta, que substitui o comando provisório do KG2).

## Estado com evidências

- KG1 na `main` pelo PR #20 (commit `8589330`), com os grupos KG1 verdes.
- KG2 na branch da thread: `node core/scripts/extrair-grafo.cjs --verificar` passa no repositório inteiro, com `conferirFontes` verificada e o mesmo digest com a ordem de leitura invertida e embaralhada.
- Amostra estratificada de arestas conferida à mão em `core/test/fixtures/kg2-amostra-auditada.json`; amostra não prova zero aresta falsa no universo.
- O contrato v1 do grafo, o Company Brain v1 e o adaptador semântico ficam intactos: os hashes congelados passam no teste de fronteira e em claim.
- Nenhum registro `measured` de benchmark existe; todo veredito é sobre dado sintético.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-29 | Julio |
| Documentação | Em revisão | — | 2026-09-29 | Julio |
| Código | PR aberto | — | 2026-09-29 | Julio |
| Testes | Em execução | — | 2026-09-29 | Julio |
| Deploy | Não implantado | — | 2026-09-29 | Julio |
| Exposição | Flag desligada | — | 2026-09-29 | Julio |
| Habilitação | Pendente | — | 2026-09-29 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-17 | thread aberta | thread `ork-i31kg1contra` | Julio |
| 2026-09-27 | premissas e decisões D1 a D11 aprovadas | gate `premissas` pelo canal do dono | Julio |
| 2026-09-28 | KG1 implementado na branch da thread | contratos do grafo e do benchmark, validação e corpus sintético; benchmark não executado | Julio |
| 2026-09-29 | KG1 mesclado na `main` | PR #20, commit `8589330` | Julio |
| 2026-09-29 | KG2 implementado na thread `ork-rm031kg2extr` | extrator TypeScript e Markdown, comando provisório e amostra auditada; decisões D1 a D14 no ledger | agente em #Auto; revisão: Julio |
