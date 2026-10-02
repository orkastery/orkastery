---
id: FEAT-005
tipo: feature
titulo: CI como CHECK independente
estado: vigente
pai: MOD-02
roadmap: [RM-012]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/ci.ts
    - .github/workflows/ci.yml
  testes:
    - core/test/ci.test.ts
    - core/test/rm037-noite-bundle-por-thread.test.ts
  simbolos:
    - core/src/ci.ts#prepararBundleCi
    - core/src/ci.ts#executarBundleCi
    - core/src/ci.ts#bundleDaBranch
    - core/src/ci.ts#executarCiDaBranch
    - core/src/ci.ts#consultarCi
  contratos:
    - ork.ci-bundle/v1
    - ork.ci-status/v1
  comandos:
    - ork ci prepare
    - ork ci run
    - ork ci status
---

# FEAT-005 — CI como CHECK independente

> **Em uma frase:** O CHECK roda num runner do GitHub, sem o ambiente de quem construiu: `ork ci prepare` exporta as claims e `ork ci run` as reexecuta no SHA exato da candidata.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-012](../roadmap/RM-012-ci-check-independente.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** exportar bundle, executar no runner, consultar o check do SHA.
- **Pré-condições e gatilho:** claims registradas; branch publicada; workflow `CI` no repositório.
- **Fluxo principal:**

  1. `ork ci prepare <thread>` grava `.ork-ci/<thread>.json` com claims, comandos e a branch da thread.
  2. O job `ork-verify` do workflow roda `ork ci run --branch <branch da PR>` e acha o bundle da thread pelo nome da branch.
  3. `ork ci status --sha <SHA>` consulta o check exato publicado no GitHub.

- **Alternativas, erros e recuperação:** bundle de outra thread não prova esta; claim marcada como adiada precisa de motivo no bundle. Branch `ork/*` sem bundle reprova com a correção; a `main` e as branches que não são de thread rodam só os comandos do manifesto. O `.ork-ci/bundle.json` de antes da RM-037 só vale quando a thread dele bate com a branch.
- **Pós-condições:** check `ork-verify` verde ou vermelho no SHA; o merge usa esse check como portão.
- **Regras de negócio:** BR-005-01: o portão é o SHA exato, não a branch. BR-005-02: proteção nativa da `main` depende do plano do GitHub (HTTP 403 no plano atual). BR-005-03: um bundle por thread, para que duas PRs nunca mudem o mesmo arquivo de bundle (RM-037).
- **Critérios de aceite e testes:** Dado um bundle com claim reprovada, quando o runner executa, então o check fica vermelho (`core/test/ci.test.ts`).
- **Interface e acessibilidade:** Não aplicável — GitHub Actions.

## Dados e contratos

- **Entidades:** `.ork-ci/<thread>.json` (contrato `ork.ci-bundle/v1`, com o campo opcional `branch`).
- **APIs:** GitHub Checks, via `gh`.
- **Jobs:** `ork-verify` e `nucleo ork` (Node 20 e 22) no workflow `CI`.

## Operação e controle

- **Observabilidade:** aba Actions do repositório; `ork ci status`.
- **Rollback:** reverter o commit do bundle; o check refaz no próximo push.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
