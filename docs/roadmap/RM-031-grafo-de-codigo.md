---
id: RM-031
tipo: roadmap
titulo: Grafo determinístico de código e artefatos
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-01T02:21:24-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: c507a3a
    pr: 35
    anteriores: "8589330 (PR #20, KG1), d2b180e (PR #32, KG2)"
  testes:
    ci: verde no push dos merges (runs 36563021189, 36721687751 e 36773338449) e no da v0.5.0 (run 36815186450)
  deploy:
    release: v0.5.0, @orkastery/cli 0.5.0 no npm
sdlc:
  thread: ork-rm031kg3
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-031 — Grafo determinístico de código e artefatos

> **Em uma frase:** Um índice local de código e documentos (AST, arestas extraídas, consulta por caminho e impacto) para as fases pedirem só o contexto que precisam.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Aprovados | Produção | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** Não aplicável — sem feature vigente
- **Thread:** `ork-rm031kg3` (KG3); o KG2 foi a `ork-rm031kg2extr` e o KG1, a `ork-i31kg1contra`

## Problema e resultado

- **Problema:** não há AST nem grafo de código; cada fase relê arquivos inteiros.
- **Resultado pretendido:** pacotes KG1 a KG7 (contrato, extração, índice, incremental, consumo, federação, paridade).
- **Métrica:** mediana de `logical_total_tokens` por par, com B (grafo) menor que A (leitura atual), fatos, claims e verify preservados e zero aresta falsa (critério do [protocolo](../referencia/contratos/benchmark-grafo-kg1.md)).
- **Linha de base:** A definir (Julio): sai da primeira execução medida do protocolo, depois do KG3. A [primeira medida do custo de consulta](../referencia/contratos/indice-grafo-kg3.md#primeira-medida-do-custo-de-consulta) do KG3 mede os dois lados e não é essa linha de base.

## Escopo e validação

- **KG1, mesclado (PR #20):** o [contrato do grafo](../referencia/contratos/grafo-deterministico-kg1.md) `ork.code-artifact-graph/v1` e o [protocolo do benchmark](../referencia/contratos/benchmark-grafo-kg1.md) `ork.graph-benchmark/v1`, com validação pura e corpus sintético.
- **KG2, mesclado (PR #32, commit `d2b180e`):** a [extração determinística](../referencia/contratos/extracao-grafo-kg2.md) de um repositório local: TypeScript e JavaScript pelo compilador já instalado no core, Markdown (seções, links, frontmatter e IDs citados), proveniência por aresta e o que não se prova fora e declarado.
- **KG3, mesclado (PR #35, commit `c507a3a`):** o [índice persistente e a consulta](../referencia/contratos/indice-grafo-kg3.md) pelo `ork grafo` (vizinhança, quem chama, quem importa e caminho), com a proveniência de cada aresta, no lugar do comando provisório do KG2.
- **Benchmark:** formato e veredito prontos; o experimento não foi executado e não há número de economia.
- **Fora até aqui:** incremental (KG4), consumo pelas fases (KG5), federação (KG6) e paridade entre hosts (KG7).

## Plano e decisões

- **Decisões:** KG1, D1 a D11 da thread `ork-i31kg1contra`, com premissas aprovadas pelo dono em 27/09/2026 (gate `premissas`). KG2, D1 a D16 da thread `ork-rm031kg2extr`, e KG3, D1 a D10 da thread `ork-rm031kg3`, tomadas em #Auto e registradas no ledger.
- **Próximo passo:** a linha de base do protocolo (benchmark A/B) e o KG4 (incremental). O merge do KG3 já aconteceu (PR #35).

## Estado com evidências

- KG1 na `main` pelo PR #20 (commit `8589330`), com os grupos KG1 verdes.
- KG2 na `main` pelo PR #32 (commit `d2b180e`); no KG3, `ork grafo indexar --verificar` passa no repositório inteiro, com `conferirFontes` verificada e o mesmo digest com a ordem de leitura invertida e embaralhada.
- KG3 na `main` pelo PR #35 (commit `c507a3a`): índice no estado do projeto, consulta determinística e grupos KG3 verdes; no mesmo HEAD, o comando provisório e o `ork grafo indexar` deram o mesmo digest antes de o comando sair.
- Amostra estratificada de arestas conferida à mão em `core/test/fixtures/kg2-amostra-auditada.json`, agora pelo `ork grafo amostra --conferir`; amostra não prova zero aresta falsa no universo.
- Primeira medida do custo de consulta contra a leitura crua em `core/test/fixtures/kg3-medida-consulta.json`: os dois lados medidos em bytes, respostas e latência, tokens indisponíveis e nenhuma conclusão de economia.
- O contrato v1 do grafo, o Company Brain v1 e o adaptador semântico ficam intactos: os hashes congelados passam no teste de fronteira e em claim.
- Nenhum registro `measured` de benchmark existe; todo veredito é sobre dado sintético.
- CI verde no push de cada merge: KG1 (run 36563021189), KG2 (run 36721687751) e KG3 (run 36773338449).
- KG1, KG2 e KG3 em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450). O `ork grafo` pede o `typescript` e o micromark no pacote do `ork`, que não são dependências dele; sem eles, a recusa é `grafo.parser.indisponivel` (CHANGELOG da 0.5.0).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-01 | Julio |
| Documentação | Em revisão | — | 2026-10-01 | Julio |
| Código | Mesclado | commit `c507a3a` · PR #35 · anteriores: 8589330 (PR #20, KG1), d2b180e (PR #32, KG2) | 2026-10-01 | Julio |
| Testes | Aprovados | ci: verde no push dos merges (runs 36563021189, 36721687751 e 36773338449) e no da v0.5.0 (run 36815186450) | 2026-10-01 | Julio |
| Deploy | Produção | release: v0.5.0, @orkastery/cli 0.5.0 no npm | 2026-10-01 | Julio |
| Exposição | Flag desligada | — | 2026-10-01 | Julio |
| Habilitação | Pendente | — | 2026-10-01 | Julio |

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
| 2026-09-29 | KG2 implementado na thread `ork-rm031kg2extr` | extrator TypeScript e Markdown, comando provisório e amostra auditada; decisões D1 a D16 no ledger | agente em #Auto; revisão: Julio |
| 2026-09-30 | KG2 mesclado na `main` | commit `d2b180e` | Julio |
| 2026-09-30 | KG3 implementado na thread `ork-rm031kg3` | índice persistente, `ork grafo`, fim do comando provisório e primeira medida do custo de consulta; decisões D1 a D10 no ledger | agente em #Auto; revisão: Julio |
| 2026-09-30 | KG3 mesclado na `main` | PR #35, commit `c507a3a` | Julio |
| 2026-10-01 | KG1, KG2 e KG3 em produção na versão 0.5.0 | tag `v0.5.0` (PR #36), `@orkastery/cli` 0.5.0 no npm | Julio |
