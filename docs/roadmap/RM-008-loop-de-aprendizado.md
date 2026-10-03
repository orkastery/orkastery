---
id: RM-008
tipo: roadmap
titulo: Loop de aprendizado
categoria: iniciativa
pai: null
features: [FEAT-006, FEAT-028]
owner: Julio
atualizado_em: 2026-10-03T04:00:00+00:00
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
    commit: 7af7a92
    pr: null
sdlc:
  thread: ork-claimsemprov
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
- **Fatia 3, lições viram avisos (28/09/2026, thread `ork-rm008fatia3l`):** as três lições que o `ork` confere sem ambiguidade viram policy executável em `warn`, por decisão do dono. São elas: GO sem baseline (`verify_regression`, e `verify_failed` com a mesma conferência), bloco sem runtime de fallback (`runtime_unavailable`) e ship com a branch atrás da base (`tree_blocked`). O aviso grava `policy_warn` e imprime a correção; nada para. As outras propostas seguem como lição no GOAL e no PLAN.
- **Fatia 4, conferência opt-in da claim no registro (03/10/2026, thread `ork-claimsemprov`):** a lição `claims.failed` vira a policy `claim_sem_prova_local` (alias `claims_failed`), desligada por padrão. Declarada, o `ork claims add` roda o comando da claim uma vez, no prazo do verify. Se ele reprova ou estoura o prazo, o `ork` grava `policy_warn` e imprime a correção; a claim entra e nada para. O `orkastery.yaml` deste repositório não a declara: ligar é do dono.
- **Fora:** criar policy sozinho (é do dono); busca semântica das lições ([RM-038](RM-038-busca-semantica-na-memoria.md)).

## Plano e decisões

- **Prioridade:** baixa, penúltima da fila (13/09/2026); décimo da lista do dono em 27/09/2026.
- **Lição ratificada = thread fechada pelo MASTER:** desde a inversão de 20/09, a entrega aceita por omissão também é MASTER; a thread aberta não ensina, porque seria auto-relato.
- **A lição sai dos arquivos, não só do OrkMind:** antes ela só existia na coleção `learning`, e só no GOAL; no regime `files`, que é o padrão, nada voltava.
- **Proposta, não policy:** policy muda o que bloqueia a fábrica; a proposta traz as threads que a sustentam e fica para o dono declarar.

## Estado com evidências

- Implementado na thread `ork-i55loopdeapr` e mesclado em 27/09/2026 (PR #38), em produção desde então. Com o histórico real (36 threads fechadas), `ork licoes` já propõe cinco policies: `claims.failed`, `verify.regression`, `runtime.unavailable`, `tree.blocked` e a classe `processo`.
- Fatia 3 (28/09/2026, thread `ork-rm008fatia3l`): três das cinco já são policy executável, declaradas em `warn` no `orkastery.yaml` deste repositório. São elas `verify_regression` (e `verify_failed`), `runtime_unavailable` e `tree_blocked`. `claims.failed` e `processo` seguem como proposta, porque o `ork` não tem como conferir antes do fato.
- Fatia 4 (03/10/2026, thread `ork-claimsemprov`): `claims.failed` ganha avaliador opt-in (`claim_sem_prova_local`), testado em `core/test/rm008-claim-prova-local.test.ts`; o `ork licoes` passa a chamar a proposta `claims_failed` de executável. Fica desligada até o dono declarar.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Mesclado | commit `7af7a92` | 2026-10-03 | Julio |
| Testes | Aprovados | — | 2026-10-03 | Julio |
| Deploy | Produção | — | 2026-10-03 | Julio |
| Exposição | Parcial | — | 2026-10-03 | Julio |
| Habilitação | Em andamento | — | 2026-10-03 | Julio |

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
| 2026-09-28 | fatia 3: três lições viram avisos de policy | decisão do dono (HITL 6 = a); só as que o `ork` confere sem ambiguidade | Julio |
| 2026-10-03 | fatia 4: conferência opt-in da claim no registro | thread `ork-claimsemprov` (#Auto), policy `claim_sem_prova_local` desligada por padrão | Claude (agente, #Auto), revisão de Julio pendente |
