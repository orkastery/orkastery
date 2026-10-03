---
id: FEAT-028
tipo: feature
titulo: Loop de aprendizado
estado: vigente
pai: MOD-05
roadmap: [RM-008]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T09:30:00-03:00
versao: main@949df8e
fontes:
  codigo:
    - core/src/licoes.ts
    - core/src/memoria.ts
  testes:
    - core/test/licoes.test.ts
  docs:
    - docs/guias/memoria-e-handoff.md
  simbolos:
    - core/src/licoes.ts#resumoDasLicoes
    - core/src/licoes.ts#propostasDePolicy
    - core/src/licoes.ts#registrarPropostasNovas
  comandos:
    - ork licoes
    - ork master
---

# FEAT-028 — Loop de aprendizado

> **Em uma frase:** a lição das threads fechadas pelo MASTER volta no GOAL e no PLAN da próxima thread do mesmo produto, e a mesma falha repetida vira proposta de policy.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@949df8e
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-008](../roadmap/RM-008-loop-de-aprendizado.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** a próxima thread recebe a lição sem ninguém pedir; o dono vê o que volta e as propostas com `ork licoes`.
- **Pré-condições e gatilho:** threads fechadas pelo MASTER (`POSTMORTEM.json` e `master-log.json`) no estado do projeto; vale em qualquer regime de memória.
- **Fluxo principal:**

  1. O GOAL e o PLAN recebem um item de memória com as recorrências (no GOAL, só quando o OrkMind não trouxe a lição da coleção `learning`, para não repetir): os três bloqueios que mais apareceram, as duas classes de falha que mais fecharam thread (com o comando que evita cada uma) e as últimas notas de 1 a 3, com a justificativa do MASTER.
  2. Ao fechar uma thread, o `ork master` confere a recorrência: a mesma falha em 3 ou mais threads nos últimos 30 dias vira proposta de policy no ledger do projeto (`policy_proposta`), uma vez por janela.
  3. `ork licoes` mostra a lição que vai voltar e as propostas em vigor, e diz quais já podem ser declaradas em `policies:`.
  4. As que o `ork` confere sem ambiguidade (`verify_regression`, `verify_failed`, `runtime_unavailable` e `tree_blocked`) viram policy executável: em `warn`, avisam no gate com a correção e gravam `policy_warn`; em `block`, reprovam como as outras policies. A lição `claims.failed` vira a policy opt-in `claim_sem_prova_local` (alias `claims_failed`): declarada, o `ork claims add` roda o comando da claim uma vez no prazo do verify e só avisa (B8).

- **Alternativas, erros e recuperação:** sem thread fechada, não há item nem seção vazia no prompt; arquivo ilegível é ignorado.
- **Entrega por PR (I-57):** a thread entregue por PR entra no loop depois de `ork ship registrar-pr` e do `ork master <thread> --aceitar-omissao`; antes, ela ficava aberta para sempre e não ensinava nada.
- **Pós-condições:** o prompt carimbado no ledger já contém a lição, com a origem declarada (`.orkastery/threads/*/POSTMORTEM.json`).
- **Regras de negócio:**
  - BR-028-01: só thread fechada pelo MASTER ensina; a thread corrente nunca aprende consigo mesma.
  - BR-028-02: `sem-falha` e `outra` não entram na recorrência; nota 0 (encerramento de órfã) não é lição.
  - BR-028-03: proposta não bloqueia nada; vira policy só quando o dono a declara em `policies:`.
- **Critérios de aceite e testes:** Dadas três threads fechadas com o mesmo bloqueio nos últimos 30 dias, quando uma thread nova abre, então o GOAL e o PLAN trazem a lição e o ledger do projeto tem uma proposta, sem duplicar (`core/test/licoes.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI e prompt.

## Dados e contratos

- **Entidades:** `POSTMORTEM.json` e `master-log.json` de cada thread fechada; evento `policy_proposta` no `.orkastery/ledger.jsonl` do projeto.
- **APIs:** Não aplicável.
- **Eventos:** `policy_proposta`, `policy_warn` (aviso de policy num gate), `memory_injected` (com a contagem de lições).

## Operação e controle

- **Configuração:** nenhuma; a janela (30 dias) e o piso (3 threads) são constantes do núcleo.
- **Observabilidade:** `ork licoes`, e o bloco `Memoria injetada` do prompt de cada GOAL e PLAN.
- **Rollback:** `git revert` do merge; os eventos `policy_proposta` ficam no ledger, que é append-only, e não governam nada.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-27 | página criada com a RM-008 | Claude (agente) / Julio, revisão pendente | RM-008 |
