---
id: FEAT-004
tipo: feature
titulo: Claims e verify no HEAD real
estado: vigente
pai: MOD-02
roadmap: [RM-100, RM-037]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T09:10:12-03:00
versao: main@949df8e
fontes:
  codigo:
    - core/src/claims.ts
    - core/src/verify.ts
    - core/src/verify-sandbox.ts
    - core/src/redacao-saida.ts
    - core/src/claim-lint.ts
  testes:
    - core/test/verify.test.ts
    - core/test/verify-arvore.test.ts
    - core/test/verify-sandbox.test.ts
    - core/test/verify-timeout.test.ts
    - core/test/claim-lint.test.ts
    - core/test/verify-compilacao-unica.test.ts
  simbolos:
    - core/src/claims.ts#adicionarClaim
    - core/src/verify.ts#verificar
    - core/src/verify.ts#gravarBaseline
    - core/src/verify.ts#causaDoEncerramento
    - core/src/verify.ts#prazoDoComando
    - core/src/redacao-saida.ts#redigirSaida
    - core/src/claim-lint.ts#analisarComando
    - core/src/verify.ts#identidadeDoProduto
  comandos:
    - ork claims add
    - ork claims verificar
    - ork verify
    - ork ci prepare
---

# FEAT-004 — Claims e verify no HEAD real

> **Em uma frase:** Toda afirmação do agente vira claim com comando, e `ork verify` reexecuta os comandos no commit real da worktree; claim sem prova não conta.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@949df8e
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md), [RM-037](../roadmap/RM-037-verify-rapido-e-confiavel.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** registrar claim, anexar comando, reexecutar tudo, gravar baseline antes do GO.
- **Pré-condições e gatilho:** thread com worktree; commit no HEAD.
- **Fluxo principal:**

  1. `ork claims add <thread> <arquivo> --claim "<alegação>" --verificar "<comando>"`.
  2. `ork verify <thread>` roda cada comando no HEAD real, mais o verify do manifesto.
  3. Regressão contra a baseline reprova o gate.

- **Alternativas, erros e recuperação:** comando que estoura o prazo é encerrado com a árvore inteira de processos e sai como `verify.timeout`, sem reprovar a alegação; alegação negativa ("não existe X") também é conferida.
- **Pós-condições:** evento `verify_run` com o resultado de cada claim e `gate_blocked` quando reprova.
- **Regras de negócio:** BR-004-01: claim pendente, reprovada ou retirada não conta. BR-004-02: o verificador nunca afrouxa asserção para passar. BR-004-03: estouro de prazo não é reprovação; o retry reexecuta. BR-004-04: o comando de verificação nunca herda variável `ORK_HITL_*`. BR-004-05: o comando de claim passa pelo lint; a suíte inteira do npm é recusada no `ci prepare` para a claim nascida sob a regra, e o resto só avisa. BR-004-06: só conta o comando que rodou (`executado`); com `verify.preparo`, o produto é conferido do preparo ao fim da rodada, e mudança no meio invalida o veredito (`verify.sem-veredito`).
- **Critérios de aceite e testes:** Dado um comando que passa do teto, quando o verify encerra, então nenhum descendente segue vivo (`core/test/verify-arvore.test.ts`). Dado um comando que estoura o prazo do manifesto, quando o verify roda, então o motivo é `verify.timeout` e o ledger grava causa, prazo e duração (`core/test/verify-timeout.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** `claims.jsonl` da thread, com o campo `lint` em cada claim nova; baseline em `.orkastery/threads/<id>/`.
- **APIs:** Não aplicável.
- **Eventos:** `verify_run`, `gate_blocked` (motivos `claims.failed`, `verify.regression`, `verify.failed`, `verify.timeout`, `verify.sem-veredito`), `claim_lint` (avisos e recusas do `ci prepare`). Por comando que falha, o evento guarda `causa`, `prazoMs`, `duracaoMs`, `testeQueCaiu` e `trecho` redigido.

## Operação e controle

- **Configuração:** bloco `verify` do `orkastery.yaml`: build, test, typecheck, `timeout_ms` (default de cada comando, 600 s sem configuração), `timeout_ms_por_comando` e `preparo` (a compilação única da rodada).
- **Limite conhecido:** em máquina virtual com CPU roubada pelo hipervisor, o verify local pode reprovar por tempo; a prova confiável é o CI ([FEAT-005](FEAT-005-ci-check-independente.md)). Desde a fatia 6 da [RM-037](../roadmap/RM-037-verify-rapido-e-confiavel.md), o verify mede o steal do `/proc/stat` e a reprovação só de teste com relógio sob steal acima de 40% vira `verify.timeout`, nunca regressão ([contrato](../referencia/contratos/instabilidade-rm037.md)).
- **Rollback:** `ork claims retirar <thread> <claim> --motivo "<motivo>"` (o histórico fica).

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-27 | estouro de prazo tipado, prazo no manifesto e evidência da falha no ledger | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-09-27 | lint do comando de claim: avisa no `claims add`, recusa a suíte inteira no `ci prepare` | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-09-27 | compilação única por preparo, identidade do produto e `executado` no contrato | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-10-01 | fatia 3 da RM-037: o verify e o commit pelo MCP não travam em lease de thread fechada nem em hard link de objeto do `.git`, e o CI cobra a linha do CHANGELOG e o estado do item depois do merge | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-10-03 | fatia 6 da RM-037: steal do `/proc/stat` no `verify_run`, teste com relógio sob steal acima de 40% como `verify.timeout` e o registro `ork.instabilidade/v1` | Claude (agente) / Julio, revisão pendente | RM-037 |
