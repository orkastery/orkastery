---
id: FEAT-023
tipo: feature
titulo: Onboarding do projeto
estado: vigente
pai: MOD-01
roadmap: [RM-015]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/onboarding.ts
  testes:
    - core/test/onboarding.test.ts
    - core/test/onboarding-cli.test.ts
  simbolos:
    - core/src/onboarding.ts#PAUTA_ONBOARDING
    - core/src/onboarding.ts#lerOnboarding
  contratos:
    - ork.onboarding/v1
  comandos:
    - ork onboarding
    - ork onboarding sync
---

# FEAT-023 — Onboarding do projeto

> **Em uma frase:** Uma pauta de nove etapas prepara o projeto para a fábrica, com respostas idempotentes, referências de credencial sem valor secreto e publicação opcional na memória.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-015](../roadmap/RM-015-onboarding-do-nucleo.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver a pauta, responder uma etapa, resetar, publicar na memória.
- **Pré-condições e gatilho:** projeto iniciado com `ork init`.
- **Fluxo principal:**

  1. `ork onboarding` mostra a pauta e as respostas.
  2. `ork onboarding set <etapa> --conteudo JSON` grava com releitura sob trava.
  3. `ork onboarding sync` publica na memória quando ela está ligada.

- **Alternativas, erros e recuperação:** memória desligada degrada com aviso; reset seletivo ou total é idempotente.
- **Pós-condições:** respostas em `.orkastery/` no contrato `ork.onboarding/v1`.
- **Regras de negócio:** BR-023-01: valores secretos só em `~/.hermes/.env`, nunca na resposta.
- **Critérios de aceite e testes:** Dada uma etapa respondida duas vezes com o mesmo conteúdo, então nada muda (`core/test/onboarding.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** respostas do onboarding (`ork.onboarding/v1`).
- **APIs:** Não aplicável.
- **Eventos:** `onboarding_set`, `onboarding_reset`.

## Operação e controle

- **Rollback:** `ork onboarding reset [etapa]`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
