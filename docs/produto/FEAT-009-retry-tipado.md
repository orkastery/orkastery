---
id: FEAT-009
tipo: feature
titulo: Retry tipado e fila de rate limit
estado: vigente
pai: MOD-03
roadmap: [RM-100]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/retry.ts
    - core/src/ratelimit.ts
  testes:
    - core/test/retry.test.ts
    - core/test/ratelimit.test.ts
    - core/test/fila-fallback.test.ts
  simbolos:
    - core/src/retry.ts#politicaDoMotivo
    - core/src/ratelimit.ts#enfileirar
  comandos:
    - ork retry policy
    - ork retry plan
    - ork retry run
    - ork retry list
    - ork retry resume
---

# FEAT-009 — Retry tipado e fila de rate limit

> **Em uma frase:** Cada reprovação tem motivo tipado e uma política de retry própria; rate limit entra numa fila durável e a fase é retomada sozinha na janela seguinte.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-03](MOD-03-runtimes-e-contas.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver a política, planejar e executar o retry, retomar fase morta por rate limit.
- **Pré-condições e gatilho:** gate reprovado com motivo tipado.
- **Fluxo principal:**

  1. `ork retry plan <thread>` calcula a ação sem gastar tentativa.
  2. `ork retry run <thread>` executa a ação tipada.
  3. `ork retry resume` retoma o que a fila guardou, no horário de reset lido do stderr.

- **Alternativas, erros e recuperação:** `retry.max_tentativas` pausa qualquer modo, inclusive #Auto.
- **Pós-condições:** eventos de retry no ledger; fila em `.orkastery/retry/`.
- **Regras de negócio:** BR-009-01: `cost.violation` nunca recebe retry automático.
- **Critérios de aceite e testes:** Dado um rate limit com horário de reset, quando a janela abre, então a fase é retomada (`core/test/ratelimit.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** fila durável de retomada.
- **APIs:** Não aplicável.
- **Eventos:** `retry_planned`, `retry_executed`, `rate_limit_enqueued`.

## Operação e controle

- **Rollback:** `ork retry cancel <id> --motivo M`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
