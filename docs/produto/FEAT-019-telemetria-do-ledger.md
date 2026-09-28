---
id: FEAT-019
tipo: feature
titulo: Telemetria econômica do ledger
estado: vigente
pai: MOD-05
roadmap: [RM-007]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/ledger.ts
    - core/src/ledger-stats.ts
  testes:
    - core/test/ledger-stats.test.ts
  simbolos:
    - core/src/ledger-stats.ts#coletarEstatisticas
    - core/src/ledger-stats.ts#registrarEstimativaPlano
    - core/src/ledger.ts#lerLedger
  contratos:
    - ork.ledger-stats/v1
  comandos:
    - ork ledger stats
    - ork ledger estimate
---

# FEAT-019 — Telemetria econômica do ledger

> **Em uma frase:** Tempo, tokens, custo, espera humana e risco evitado saem do ledger por período, thread, modo e runtime, com a estimativa do PLAN registrada antes do trabalho.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-007](../roadmap/RM-007-telemetria-economica.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** medir a semana, registrar a estimativa do PLAN.
- **Pré-condições e gatilho:** ledger com eventos no período.
- **Fluxo principal:**

  1. `ork ledger stats --desde 7d` agrega o intervalo `[desde, até)`.
  2. `ork ledger estimate <thread>` grava as horas estimadas sem IA e com IA sem `ork`.
  3. A comparação mostra o que a condução economizou.

- **Alternativas, erros e recuperação:** período sem eventos devolve zero explícito, não erro.
- **Pós-condições:** nenhum para `stats`; evento de estimativa para `estimate`.
- **Regras de negócio:** BR-019-01: a estimativa exige método, premissas e autor.
- **Critérios de aceite e testes:** Dado um ledger com duas fases, quando `stats` roda, então soma tempo e tokens das duas (`core/test/ledger-stats.test.ts`).
- **Interface e acessibilidade:** Texto de CLI; `--json` no contrato `ork.ledger-stats/v1`.

## Dados e contratos

- **Entidades:** eventos do ledger.
- **APIs:** Não aplicável.
- **Eventos:** `plan_estimate`.

## Operação e controle

- **Rollback:** Não aplicável — leitura.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
