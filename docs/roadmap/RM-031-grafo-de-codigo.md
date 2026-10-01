---
id: RM-031
tipo: roadmap
titulo: Grafo determinístico de código e artefatos
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-30T11:50:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: c507a3a
    pr: null
sdlc:
  thread: ork-rm031kg4incr
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-031 — Grafo determinístico de código e artefatos

> **Em uma frase:** Um índice local de código e documentos (AST, arestas extraídas, consulta por caminho e impacto) para as fases pedirem só o contexto que precisam.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** Não aplicável — sem feature vigente
- **Thread:** `ork-rm031kg4incr` (KG4 e a linha de base do protocolo); o KG3 foi a `ork-rm031kg3`, o KG2, a `ork-rm031kg2extr` e o KG1, a `ork-i31kg1contra`

## Problema e resultado

- **Problema:** não há AST nem grafo de código; cada fase relê arquivos inteiros.
- **Resultado pretendido:** pacotes KG1 a KG7 (contrato, extração, índice, incremental, consumo, federação, paridade).
- **Métrica:** mediana de `logical_total_tokens` por par, com B (grafo) menor que A (leitura atual), fatos, claims e verify preservados e zero aresta falsa (critério do [protocolo](../referencia/contratos/benchmark-grafo-kg1.md)).
- **Linha de base:** a parte determinística do protocolo foi medida no KG4, na revisão `7a1de0c3`: nas seis tarefas, o braço do grafo entrega de 3.148 a 102.479 bytes ao agente, sem abrir arquivo, e a leitura crua de 232.052 a 1.046.262 bytes, em 8 a 45 arquivos, com os fatos obrigatórios presentes nos dois braços ([registro](../referencia/contratos/incremental-grafo-kg4.md#linha-de-base-do-protocolo)). A métrica do item, `logical_total_tokens`, sai da rodada paga do protocolo, que está pendente: o protocolo está fixado (`not-run`) e o harness, pronto.

## Escopo e validação

- **KG1, mesclado (PR #20):** o [contrato do grafo](../referencia/contratos/grafo-deterministico-kg1.md) `ork.code-artifact-graph/v1` e o [protocolo do benchmark](../referencia/contratos/benchmark-grafo-kg1.md) `ork.graph-benchmark/v1`, com validação pura e corpus sintético.
- **KG2, mesclado (commit `d2b180e`):** a [extração determinística](../referencia/contratos/extracao-grafo-kg2.md) de um repositório local: TypeScript e JavaScript pelo compilador já instalado no core, Markdown (seções, links, frontmatter e IDs citados), proveniência por aresta e o que não se prova fora e declarado.
- **KG3, mesclado (commit `c507a3a`):** o [índice persistente e a consulta](../referencia/contratos/indice-grafo-kg3.md) pelo `ork grafo` (vizinhança, quem chama, quem importa e caminho), com a proveniência de cada aresta, no lugar do comando provisório do KG2.
- **KG4, na branch da thread `ork-rm031kg4incr`:** o [índice incremental](../referencia/contratos/incremental-grafo-kg4.md): sem o índice do HEAD, o `ork grafo indexar` parte do índice da revisão ancestral com o mesmo extrator e reextrai só o que a mudança alcança, com os mesmos bytes da extração completa, ou extrai completo e diz por quê; e a linha de base do protocolo.
- **Benchmark:** formato e veredito prontos; protocolo fixado (`not-run`), parte determinística medida e harness da rodada paga pronto e testado com agente simulado; a rodada paga não rodou e não há número de economia.
- **Fora até aqui:** a rodada paga do A/B, identidade estável entre revisões (o contrato v1 deriva os IDs do snapshot), consumo pelas fases (KG5), federação (KG6) e paridade entre hosts (KG7).

## Plano e decisões

- **Decisões:** KG1, D1 a D11 da thread `ork-i31kg1contra`, com premissas aprovadas pelo dono em 27/09/2026 (gate `premissas`). KG2, D1 a D16 da thread `ork-rm031kg2extr`, KG3, D1 a D10 da thread `ork-rm031kg3`, e KG4, D1 a D11 da thread `ork-rm031kg4incr`, tomadas em #Auto e registradas no ledger.
- **Próximo passo:** merge do KG4 com o CI verde; depois, a rodada paga do protocolo (o dono confirma os controles, regera o protocolo e roda o harness com `--pago`) e o KG5 (consumo pelas fases).

## Estado com evidências

- KG1 na `main` pelo PR #20 (commit `8589330`), com os grupos KG1 verdes.
- KG2 na `main` (commit `d2b180e`); no KG3, `ork grafo indexar --verificar` passa no repositório inteiro, com `conferirFontes` verificada e o mesmo digest com a ordem de leitura invertida e embaralhada.
- KG3 na `main` (commit `c507a3a`): índice no estado do projeto, consulta determinística e grupos KG3 verdes; no mesmo HEAD, o comando provisório e o `ork grafo indexar` deram o mesmo digest antes de o comando sair.
- KG4 na branch da thread: em seis pares de revisões reais deste repositório (mudança típica de TypeScript, só docs, só dados, arquivo central, renome, remoção com arquivo novo), o índice incremental deu os mesmos bytes do completo nos quatro arquivos, e a extração de 2418a4e7 com o código do KG4 dá o digest do KG3 (`core/test/fixtures/kg4-medida-incremental.json`). Medianas: incremental 6.203 ms, completo 9.470 ms, completo do código do KG3 12.398 ms, numa VPS com CPU roubada (os números variam entre rodadas); o piso é derivar e validar os IDs do snapshot inteiro.
- KG4: grupos de equivalência (renome, remoção, arquivo novo, alvo mudado, `export *` ambíguo, import divergente, JSDoc, `package.json` da pasta e Markdown), queda (inclusive mudança no que um arquivo global importa), CLI, medida e harness verdes; a revisão independente do CHECK achou a queda pela dependência do global e as sondas do `package.json`, corrigidas com teste que cai por mutação; o `--verificar` compara o incremental com a completa no repositório de quem usa.
- Amostra estratificada de arestas conferida à mão em `core/test/fixtures/kg2-amostra-auditada.json`, agora pelo `ork grafo amostra --conferir`; amostra não prova zero aresta falsa no universo.
- Primeira medida do custo de consulta contra a leitura crua em `core/test/fixtures/kg3-medida-consulta.json`: os dois lados medidos em bytes, respostas e latência, tokens indisponíveis e nenhuma conclusão de economia.
- O contrato v1 do grafo, o Company Brain v1 e o adaptador semântico ficam intactos: os hashes congelados passam no teste de fronteira e em claim.
- O único registro `measured` de benchmark é o protocolo fixado do KG4, com `status: not-run` (veredito `not-run`, nunca publicável); todo outro veredito é sobre dado sintético.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-30 | Julio |
| Documentação | Em revisão | — | 2026-09-30 | Julio |
| Código | Branch criada | commit `c507a3a` | 2026-09-30 | Julio |
| Testes | Em execução | — | 2026-09-30 | Julio |
| Deploy | Não implantado | — | 2026-09-30 | Julio |
| Exposição | Flag desligada | — | 2026-09-30 | Julio |
| Habilitação | Pendente | — | 2026-09-30 | Julio |

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
| 2026-09-30 | KG3 mesclado na `main` | commit `c507a3a` | Julio |
| 2026-10-01 | KG4 implementado na thread `ork-rm031kg4incr` | índice incremental com os mesmos bytes da completa, provado em fixtures e em seis pares reais, linha de base determinística do protocolo, protocolo fixado e harness da rodada paga; decisões D1 a D11 no ledger | agente em #Auto; revisão: Julio |
