---
id: RM-008
tipo: roadmap
titulo: Loop de aprendizado
categoria: iniciativa
pai: null
features: [FEAT-006, FEAT-028]
owner: Julio
atualizado_em: 2026-09-27T09:43:32-03:00
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
    commit: 96a030d
    pr: null
sdlc:
  thread: ork-i57entregasp
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-008 — Loop de aprendizado

> **Em uma frase:** Transformar MASTER e POSTMORTEM em memória que volta no GOAL e no PLAN seguintes, e propor policy quando a mesma falha se repete.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-006](../produto/FEAT-006-ship-com-push-provado.md), [FEAT-028](../produto/FEAT-028-loop-de-aprendizado.md)
- **Thread:** `ork-i55loopdeapr`

## Problema e resultado

- **Problema:** 23 POSTMORTEMs e nenhuma lição reaproveitada no ciclo seguinte (diagnóstico de 07/09).
- **Hipótese:** Se a lição ratificada voltar no GOAL seguinte, então a mesma classe de falha cai, porque o agente passa a ver o erro antes de repeti-lo.
- **Métrica:** a lição volta em 100% dos GOAL e PLAN de thread nova, em qualquer regime de memória; a recorrência de um bloqueio em 3 ou mais threads nos últimos 30 dias gera proposta em até um MASTER.

## Escopo e validação

- **Critério de aceite:** uma lição ratificada reaparece no próximo ciclo; recorrência gera proposta de policy.
- **Incluído:** a lição tirada dos `POSTMORTEM.json` e `master-log.json` das threads fechadas, no GOAL e no PLAN, em qualquer regime; a proposta de policy no ledger do projeto ao fechar uma thread; `ork licoes`.
- **Fatia 2, entregas por PR (27/09/2026, thread `ork-i57entregasp`):** o merge `ship(<thread>)` na base remota, com o CI verde no head do PR, vira `ship_done` (`ork ship registrar-pr`), e o MASTER por omissão fecha a thread. Sem isso, a thread entregue por PR ficava aberta e fora do loop.
- **Fora:** criar policy sozinho (é do dono); busca semântica das lições ([RM-038](RM-038-busca-semantica-na-memoria.md)).

## Plano e decisões

- **Prioridade:** baixa, penúltima da fila (13/09/2026); décimo da lista do dono em 27/09/2026.
- **Lição ratificada = thread fechada pelo MASTER:** desde a inversão de 20/09, a entrega aceita por omissão também é MASTER; a thread aberta não ensina, porque seria auto-relato.
- **A lição sai dos arquivos, não só do OrkMind:** antes ela só existia na coleção `learning`, e só no GOAL; no regime `files`, que é o padrão, nada voltava.
- **Proposta, não policy:** policy muda o que bloqueia a fábrica; a proposta traz as threads que a sustentam e fica para o dono declarar.

## Estado com evidências

- Implementado na thread `ork-i55loopdeapr` e mesclado em 27/09/2026 (PR #38), em produção desde então. Com o histórico real (36 threads fechadas), `ork licoes` já propõe cinco policies: `claims.failed`, `verify.regression`, `runtime.unavailable`, `tree.blocked` e a classe `processo`.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `96a030d` | 2026-09-27 | Julio |
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
| 2026-09-13 | reinserido no roadmap | tabela de percentuais | Julio |
| 2026-09-27 | implementado | lição no GOAL e no PLAN em qualquer regime, proposta de policy por recorrência | Julio |
| 2026-09-27 | em produção na VPS de referência | merge `96a030d` (PR #38); `ork licoes` já lista cinco propostas no histórico real | Julio |
| 2026-09-27 | fatia 2: entregas por PR fecham pelo MASTER | 25 threads entregues por PR estavam abertas e fora do loop | Julio |
