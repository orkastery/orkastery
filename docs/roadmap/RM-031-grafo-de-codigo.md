---
id: RM-031
tipo: roadmap
titulo: Grafo determinístico de código e artefatos
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-02T01:43:18-03:00
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
    commit: 99b10d3
    pr: 40
    anteriores: "8589330 (PR #20, KG1), d2b180e (PR #32, KG2), c507a3a (PR #35, KG3)"
  testes:
    ci: verde no push dos merges (runs 36563021189, 36721687751, 36773338449 e 36961667790) e no da v0.5.0 (run 36815186450)
  deploy:
    release: v0.5.0, @orkastery/cli 0.5.0 no npm
sdlc:
  thread: ork-rm031kg5cons
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-031 — Grafo determinístico de código e artefatos

> **Em uma frase:** Um índice local de código e documentos (AST, arestas extraídas, consulta por caminho e impacto) para as fases pedirem só o contexto que precisam.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Aprovados | Produção | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** Não aplicável — sem feature vigente
- **Thread:** `ork-rm031kg5cons` (KG5, consumo pelas fases pelo MCP); a correção de empacotamento (o grafo em quem instala do npm) é a `ork-rm031grafofu`; o KG4 foi a `ork-rm031kg4incr`, o KG3, a `ork-rm031kg3`, o KG2, a `ork-rm031kg2extr` e o KG1, a `ork-i31kg1contra`

## Problema e resultado

- **Problema:** não há AST nem grafo de código; cada fase relê arquivos inteiros.
- **Resultado pretendido:** pacotes KG1 a KG7 (contrato, extração, índice, incremental, consumo, federação, paridade).
- **Métrica:** mediana de `logical_total_tokens` por par, com B (grafo) menor que A (leitura atual), fatos, claims e verify preservados e zero aresta falsa (critério do [protocolo](../referencia/contratos/benchmark-grafo-kg1.md)).
- **Linha de base:** a parte determinística do protocolo foi medida no KG4, na revisão `7a1de0c3`: nas seis tarefas, o braço do grafo entrega de 3.148 a 102.479 bytes ao agente, sem abrir arquivo, e a leitura crua de 232.052 a 1.046.262 bytes, em 8 a 45 arquivos, com os fatos obrigatórios presentes nos dois braços ([registro](../referencia/contratos/incremental-grafo-kg4.md#linha-de-base-do-protocolo)). A métrica do item, `logical_total_tokens`, sai da rodada paga do protocolo, que está pendente: o protocolo está fixado (`not-run`) e o harness, pronto.

## Escopo e validação

- **KG1, mesclado (PR #20):** o [contrato do grafo](../referencia/contratos/grafo-deterministico-kg1.md) `ork.code-artifact-graph/v1` e o [protocolo do benchmark](../referencia/contratos/benchmark-grafo-kg1.md) `ork.graph-benchmark/v1`, com validação pura e corpus sintético.
- **KG2, mesclado (PR #32, commit `d2b180e`):** a [extração determinística](../referencia/contratos/extracao-grafo-kg2.md) de um repositório local: TypeScript e JavaScript pelo compilador já instalado no core, Markdown (seções, links, frontmatter e IDs citados), proveniência por aresta e o que não se prova fora e declarado.
- **KG3, mesclado (PR #35, commit `c507a3a`):** o [índice persistente e a consulta](../referencia/contratos/indice-grafo-kg3.md) pelo `ork grafo` (vizinhança, quem chama, quem importa e caminho), com a proveniência de cada aresta, no lugar do comando provisório do KG2.
- **KG4, mesclado (PR #40, commit `99b10d3`):** o [índice incremental](../referencia/contratos/incremental-grafo-kg4.md): sem o índice do HEAD, o `ork grafo indexar` parte do índice da revisão ancestral com o mesmo extrator e reextrai só o que a mudança alcança, com os mesmos bytes da extração completa, ou extrai completo e diz por quê; e a linha de base do protocolo.
- **KG5, fatia 1, thread `ork-rm031kg5cons`:** o [consumo pelas fases](../referencia/contratos/consumo-grafo-kg5.md) pelo MCP: originalmente quatro consultas por nó (`ork_grafo_vizinhos`, `ork_grafo_chamadores`, `ork_grafo_importadores` e `ork_grafo_caminho`) com o contrato do `ork grafo`, a proveniência de cada aresta e a resposta limitada em bytes (`--teto-bytes`, 32.768 por padrão), atrás da flag `grafo.mcp`, desligada; sem o índice do HEAD, a tool diz se não há índice ou se ele é de outra revisão ou de outro extrator e dá a correção (`ork grafo indexar`). A quinta tool, de contexto, foi acrescentada na fatia 2 e seu formato v2 está descrito abaixo.
- **Benchmark:** formato e veredito prontos; protocolo fixado (`not-run`), parte determinística medida e harness da rodada paga pronto e testado com agente simulado; a rodada paga não rodou e não há número de economia.
- **KG5, fatia 2, na thread `ork-rm031kg5fati`:** pacote determinístico `ork grafo contexto <thread>` / `ork_grafo_contexto`, com fontes diff/GOAL/PLAN/claims, um salto, proveniência, teto em bytes e medida offline dos mesmos arquivos. Dica no pedido da fase somente com a flag ligada; desligada, igualdade byte a byte. [Contrato da fatia 2](../referencia/contratos/consumo-grafo-kg5.md#fatia-2-pacote-de-contexto-da-thread). Implementação em GO, pendente da verificação oficial e revisão independente.
- **KG5, fatia 3, thread `ork-rm031kg5fat2`:** contrato de pacote v2 com referências locais, fan-in agregado, prioridade entre arquivos e proximidade ao diff, sementes ausentes limitadas e diff ignorado sem worktree. Fixture sintética após o GO-FIX: 3.119 bytes contra 22.973 no v0 (7,4 vezes menor). Medida histórica v3 em dois casos reais, na tabela do [contrato](../referencia/contratos/consumo-grafo-kg5.md#dica-e-medidas): pacote mais preciso que a descoberta por grep, com cobertura parcial; sem conclusão sobre tokens.
- **Fora até aqui:** a rodada paga do A/B, identidade estável entre revisões (o contrato v1 deriva os IDs do snapshot), a habilitação da flag `grafo.mcp` (dono), federação (KG6) e paridade entre hosts (KG7).

## Plano e decisões

- **Decisões:** KG1, D1 a D11 da thread `ork-i31kg1contra`, com premissas aprovadas pelo dono em 27/09/2026 (gate `premissas`). KG2, D1 a D16 da thread `ork-rm031kg2extr`, KG3, D1 a D10 da thread `ork-rm031kg3`, KG4, D1 a D11 da thread `ork-rm031kg4incr`, e KG5, D1 a D10 da thread `ork-rm031kg5cons`, tomadas em #Auto e registradas no ledger.
- **Próximo passo:** o dono decide ligar `grafo.mcp` (exposição e habilitação); concluir CHECK/SHIP/MASTER da fatia 2 e, depois, a rodada paga do protocolo (o dono confirma os controles, regera o protocolo e roda o harness com `--pago`).

## Estado com evidências

- KG1 na `main` pelo PR #20 (commit `8589330`), com os grupos KG1 verdes.
- KG2 na `main` pelo PR #32 (commit `d2b180e`); no KG3, `ork grafo indexar --verificar` passa no repositório inteiro, com `conferirFontes` verificada e o mesmo digest com a ordem de leitura invertida e embaralhada.
- KG3 na `main` pelo PR #35 (commit `c507a3a`): índice no estado do projeto, consulta determinística e grupos KG3 verdes; no mesmo HEAD, o comando provisório e o `ork grafo indexar` deram o mesmo digest antes de o comando sair.
- KG4 na `main` pelo PR #40 (merge `99b10d3`), CI verde no push (run 36961667790): em seis pares de revisões reais deste repositório (mudança típica de TypeScript, só docs, só dados, arquivo central, renome, remoção com arquivo novo), o índice incremental deu os mesmos bytes do completo nos quatro arquivos, e a extração de 2418a4e7 com o código do KG4 dá o digest do KG3 (`core/test/fixtures/kg4-medida-incremental.json`). Medianas: incremental 6.203 ms, completo 9.470 ms, completo do código do KG3 12.398 ms, numa VPS com CPU roubada (os números variam entre rodadas); o piso é derivar e validar os IDs do snapshot inteiro.
- KG4: grupos de equivalência (renome, remoção, arquivo novo, alvo mudado, `export *` ambíguo, import divergente, JSDoc, `package.json` da pasta e Markdown), queda (inclusive mudança no que um arquivo global importa), CLI, medida e harness verdes; a revisão independente do CHECK achou a queda pela dependência do global e as sondas do `package.json`, corrigidas com teste que cai por mutação; o `--verificar` compara o incremental com a completa no repositório de quem usa.
- Amostra estratificada de arestas conferida à mão em `core/test/fixtures/kg2-amostra-auditada.json`, agora pelo `ork grafo amostra --conferir`; amostra não prova zero aresta falsa no universo.
- Primeira medida do custo de consulta contra a leitura crua em `core/test/fixtures/kg3-medida-consulta.json`: os dois lados medidos em bytes, respostas e latência, tokens indisponíveis e nenhuma conclusão de economia.
- O contrato v1 do grafo, o Company Brain v1 e o adaptador semântico ficam intactos: os hashes congelados passam no teste de fronteira e em claim.
- O único registro `measured` de benchmark é o protocolo fixado do KG4, com `status: not-run` (veredito `not-run`, nunca publicável); todo outro veredito é sobre dado sintético.
- KG5 na branch da thread: com `grafo.mcp: true`, o servidor MCP acrescenta cinco tools de grafo às tools regulares, e cada uma responde, byte a byte, o JSON que o `ork grafo ... --json --teto-bytes N` escreve na worktree da thread (sem a quebra de linha final); sem a flag, mantém o conjunto regular de tools e o mesmo comando de despacho (`core/test/mcp-grafo.test.ts`, grupos `KG5`). A consulta roda num processo filho com o ambiente mínimo do MCP, prazo e cancelamento, e o servidor não alcança a família do grafo (teste de fronteira).
- KG5, medida offline em `core/test/fixtures/kg5-medida-mcp.json`, na revisão `9000f52e`: nas seis perguntas, a tool entrega de 2.525 a 32.087 bytes (a P5 cortada pelo teto, 41 de 104 arestas), a CLI sem teto de 3.148 a 106.363 e a leitura crua de 273.815 a 1.179.908; as quatro definições custam 5.931 bytes no `tools/list`. Tokens indisponíveis e nenhuma conclusão de economia.
- KG5, revisão independente do CHECK: na rodada 1, nenhum bloqueador e quatro avisos (recusa de outro extrator sem dizer o que mudou, texto do teto e da saída da CLI, pré-requisito dos analisadores), corrigidos no GO-FIX 1 com as sugestões de teste e de endurecimento; as de desempenho e a do worker que segue se o servidor morre de repente ficaram sem mudança, por decisão no ledger. Na rodada 2, nenhum bloqueador nem aviso.
- CI verde no push de cada merge: KG1 (run 36563021189), KG2 (run 36721687751), KG3 (run 36773338449) e KG4 (run 36961667790).
- KG1, KG2 e KG3 em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450). O `ork grafo` pede o `typescript` e o micromark no pacote do `ork`, que não são dependências dele; sem eles, a recusa é `grafo.parser.indisponivel` (CHANGELOG da 0.5.0).
- Correção de empacotamento na thread `ork-rm031grafofu`: o `typescript` 5.9.3, o micromark 4.0.2, a tabela GFM 2.1.1 e os dois decodificadores de referência de caractere passam a ser dependências de runtime do `@orkastery/cli`, com versão exata, e os rótulos `ork.ts-ast` e `ork.md-structure` não mudam. A prova `core/scripts/provar-grafo-instalado.cjs` empacota a árvore, instala o tarball com `npm install -g` num prefixo e num HOME temporários e indexa e consulta um repositório novo; roda no CI (job `nucleo`, em cada Node da matriz) e no `publicar.yml`, num job só de leitura, sem o `id-token`, de que a publicação depende. O `ork doctor` ganha o check "analisadores do grafo", e o `ork grafo status` diz a correção quando eles faltam. Medida: o tarball vai de 1.132.641 para 1.133.927 bytes, e a instalação, de 96 para 125 pacotes e de 29,3 para 55,7 MB em disco.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-02 | Julio |
| Documentação | Em revisão | — | 2026-10-02 | Julio |
| Código | Mesclado | commit `99b10d3` · PR #40 · anteriores: 8589330 (PR #20, KG1), d2b180e (PR #32, KG2), c507a3a (PR #35, KG3) | 2026-10-02 | Julio |
| Testes | Aprovados | ci: verde no push dos merges (runs 36563021189, 36721687751, 36773338449 e 36961667790) e no da v0.5.0 (run 36815186450) | 2026-10-02 | Julio |
| Deploy | Produção | release: v0.5.0, @orkastery/cli 0.5.0 no npm | 2026-10-02 | Julio |
| Exposição | Flag desligada | — | 2026-10-02 | Julio |
| Habilitação | Pendente | — | 2026-10-02 | Julio |

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
| 2026-10-01 | KG4 implementado na thread `ork-rm031kg4incr` | índice incremental com os mesmos bytes da completa, provado em fixtures e em seis pares reais, linha de base determinística do protocolo, protocolo fixado e harness da rodada paga; decisões D1 a D11 no ledger | agente em #Auto; revisão: Julio |
| 2026-10-02 | KG4 mesclado na `main` | PR #40, merge `99b10d3`, CI verde no push (run 36961667790) | Julio |
| 2026-10-02 | KG5 implementado na thread `ork-rm031kg5cons` | tools `ork_grafo_*` no MCP atrás da flag `grafo.mcp` desligada, teto em bytes, recusas do índice com a correção e medida offline; decisões D1 a D10 no ledger | agente em #Auto; revisão: Julio |
| 2026-10-03 | correção de empacotamento na thread `ork-rm031grafofu` | `typescript` e micromark como dependências do pacote, check no `ork doctor`, correção no `ork grafo status` e prova de instalação limpa no CI e no `publicar.yml`; decisões D1 a D10 no ledger | agente em #Auto; revisão: Julio |
| 2026-10-03 | KG5 fatia 2 implementada em GO na thread `ork-rm031kg5fati` | pacote de contexto e dica opt-in; medida sintética: 22.973 bytes de JSON versus 1.567 dos mesmos 3 arquivos, sem conclusão de economia; CHECK/SHIP/MASTER pendentes | agente em #Auto |
| 2026-10-03 | KG5 fatia 3 em GO, thread `ork-rm031kg5fat2` | formato v2 e medida histórica executada; GO-FIX corrige o comparador, sementes de prosa e evidências auxiliares; medida v3 regravada pela condutora (mapa contra mapa, pacote 2,2 e 1,5 vez menor que a saída do grep; precisão 43% e 88% contra 7% e 55%; cobertura 23% e 41% contra 23% e 35%) | agente em #Auto |
| 2026-10-03 | KG5 fatia 4 em GO, thread `ork-rm031kg5fat3` | arestas `cites` de literais e segundo salto com orçamento restante, marcado no pacote v2; medida v3 regravada pela condutora: cobertura 69% e 65% (antes 23% e 41%), precisão 36% e 61%, pacote de 28.015 e 32.706 bytes, maior que a saída do grep no KG4 | agente em #Auto |
| 2026-10-03 | KG5 fatia 4, GO-FIX 2, thread `ork-rm031kg5fat3` | variantes de diretório preservadas no incremental, código inline em rótulo resolvido sem duplicação e nomes de pacote sem sondas; regressões com mutantes em `core/test/rm031-kg5-citacoes.test.ts`; nova medida histórica e verify pela condutora | agente em #Auto |
