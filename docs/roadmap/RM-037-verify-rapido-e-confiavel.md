---
id: RM-037
tipo: roadmap
titulo: Verify rápido e confiável
categoria: iniciativa
pai: null
features: [FEAT-004]
owner: Julio
atualizado_em: 2026-09-27T23:46:57-03:00
estado:
  ciclo: Piloto
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-i54compilaca
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-037 — Verify rápido e confiável

> **Em uma frase:** Verify que distingue "não executado" de "reprovado", diz qual teste falhou e julga a máquina antes de julgar o código.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-004](../produto/FEAT-004-claims-e-verify.md)
- **Thread:** `ork-verifytimeou`

## Problema e resultado

- **Problema:** o verify local reprova por tempo quando a VPS perde 67% a 92% da CPU para o hipervisor (sar, 23 e 24/09/2026): a mesma suíte leva 3,4 min com CPU livre e 24 a 30 min com steal alto.
- **Métrica:** verify local com o mesmo veredito do CI em 10 de 10 rodadas.
- **Linha de base:** A definir — agente da thread, no PLAN revisado.

## Escopo e validação

- **Já entregue:** T5 (a árvore inteira morre no estouro do teto), merge `8f02f44` de 22/09/2026.
- **Incluído:** causa tipada do estouro (T3), `verify.timeout` (T4), prazo do manifesto (T6), compilação única.
- **P2, compilação única (27/09/2026, thread `ork-i54compilaca`):** `verify.preparo` roda uma vez antes das claims; o produto é conferido do preparo ao fim da rodada; `executado` entrou no contrato e comando que não rodou nunca vira verificado (`verify.sem-veredito`). O `incremental` dos dois tsconfig já estava ligado.
- **P6, lint do comando de claim (27/09/2026, thread `ork-i53lintdocom`):** a suíte inteira do npm é recusada no `ci prepare` para a claim nascida sob a regra; SHA intermediário e contagem de commits só avisam; claim antiga só avisa. A lista das integrações locais passou a ter uma fonte só.
- **Entram (24/09/2026):** verify ciente do steal, nome do teste que reprovou no ledger, tempo de boot do CLI, asserções de relógio na suíte paralela, fixtures independentes de umask e a causa real em `registrarObservacao`.

## Plano e decisões

- **Ordem acordada em 20/09/2026:** terceiro, depois de #Fast.

## Estado com evidências

- T5 já está na `main` (merge `8f02f44`).
- Fatia de 27/09/2026 na thread `ork-verifytimeou` (blocos P1, P3 e parte do P4):
  - causa tipada do encerramento e o motivo `verify.timeout`, que não reprova a alegação e o retry reexecuta;
  - prazo no manifesto (`verify.timeout_ms` e `verify.timeout_ms_por_comando`), também no MCP, até 300 s por comando;
  - o ledger guarda, por comando que falha, a causa, o prazo, a duração, os testes que caíram e o trecho redigido;
  - o comando de verificação não herda variável `ORK_HITL_*`.
- Falta: compilação única com identidade verificada (P2), lint de comando de claim e registro de instabilidade (P6), e o verify ciente do steal.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-27 | Julio |
| Testes | Aprovados | — | 2026-09-27 | Julio |
| Deploy | Produção | — | 2026-09-27 | Julio |
| Exposição | Parcial | — | 2026-09-27 | Julio |
| Habilitação | Em andamento | — | 2026-09-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-27 | fatia P1 e P3 implementada | estouro de prazo tipado, prazo no manifesto, evidência da falha no ledger | Julio |
| 2026-09-22 | T5 mesclado por outra thread | merge `8f02f44` | Julio |
| 2026-09-24 | escopo ampliado pela investigação do steal | sar e experimentos A/B | Julio |
| 2026-09-27 | P1 e P3 em produção na VPS de referência | merge `74db81b` (PR #31), `ork` de produção reconstruído; P2 e P6 seguem abertos | Julio |
| 2026-09-27 | P6: lint do comando de claim | a C48 foi para o bundle rodando a suíte inteira e derrubou 33m57s de CI | Julio |
| 2026-09-27 | P2: compilação única e `executado` | fecha o escopo do item: T1 a T14 do PLAN entregues | Julio |
