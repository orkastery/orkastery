---
id: FEAT-017
tipo: feature
titulo: Memória no OrkMind com degradação honesta
estado: vigente
pai: MOD-05
roadmap: [RM-006, RM-038]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/memoria.ts
    - core/src/orkmind.ts
  testes:
    - core/test/memoria.test.ts
    - core/test/degradacao.test.ts
  simbolos:
    - core/src/memoria.ts#abrirMemoria
    - core/src/orkmind.ts#violacoesDeGovernanca
  comandos:
    - ork memory status
    - ork memory sync
    - ork memory search
---

# FEAT-017 — Memória no OrkMind com degradação honesta

> **Em uma frase:** Decisões, handoffs e lições vão para a base OrkMind do tenant do projeto; sem base ou sem permissão, o regime cai para arquivos com evento tipado, nunca em silêncio.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-006](../roadmap/RM-006-orkmind-na-fabrica.md), [RM-038](../roadmap/RM-038-busca-semantica-na-memoria.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver o regime efetivo, publicar, buscar por tag.
- **Pré-condições e gatilho:** `memory.database_url_env` com o NOME da variável; ativação de escrita com aceite humano.
- **Fluxo principal:**

  1. `ork memory status` mostra regime, tenant e degradação.
  2. `ork memory sync <thread>` publica decisões, handoff, lição e roadmap.
  3. `ork memory search --tags` busca determinística; `mandatory` sempre volta.

- **Alternativas, erros e recuperação:** DSN ausente gera `memory_degraded` motivo `dsn.env-ausente`; escrita desligada fica pendente com `write.activation.disabled`.
- **Pós-condições:** entradas no OrkMind com proveniência (`source`, `project`, `producer`).
- **Regras de negócio:** BR-017-01: regra crítica (`mandatory`) só nasce de humano autenticado. BR-017-02: sem fallback para outra base.
- **Critérios de aceite e testes:** Dada a DSN ausente, quando a memória abre, então o regime é `files` com o motivo tipado (`core/test/degradacao.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** coleções `decision`, `handoff`, `rule`, `learning`, `roadmap`.
- **APIs:** OrkMind (PostgreSQL do tenant).
- **Eventos:** `memory_degraded`, `memory_published`.

## Operação e controle

- **Configuração:** `memory: orkmind` e `memory.database_url_env` no manifesto; nunca o valor da DSN.
- **Planejado:** busca semântica em [RM-038](../roadmap/RM-038-busca-semantica-na-memoria.md).
- **Rollback:** `ork activation disable`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
