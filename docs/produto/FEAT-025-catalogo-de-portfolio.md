---
id: FEAT-025
tipo: feature
titulo: Catálogo de portfólio
estado: vigente
pai: MOD-01
roadmap: [RM-018, RM-019]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/portfolio.ts
    - core/src/portfolio-context.ts
  testes:
    - core/test/portfolio.test.ts
    - core/test/portfolio-context.test.ts
  simbolos:
    - core/src/portfolio.ts#createProduct
    - core/src/portfolio.ts#listEntities
  contratos:
    - ork.portfolio/v1
    - ork.portfolio-context/v1
  comandos:
    - ork portfolio create
    - ork portfolio list
    - ork portfolio show
    - ork portfolio inspect
---

# FEAT-025 — Catálogo de portfólio

> **Em uma frase:** Produto, projeto e iniciativa num catálogo com pais, relações e escopo de ciclo, para a condução saber a que resultado cada thread serve.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-018](../roadmap/RM-018-ontologia-de-portfolio.md), [RM-019](../roadmap/RM-019-catalogo-multi-repositorio.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** criar entidade, listar, ver, inspecionar lacunas.
- **Pré-condições e gatilho:** projeto iniciado.
- **Fluxo principal:**

  1. `ork portfolio create <product|project|initiative> <id> --title T [--parent ID]`.
  2. `ork portfolio show <id>` mostra o catálogo `prod -> proj -> init`.
  3. `ork portfolio inspect <id> --json` expõe origem, ciclos e lacunas.

- **Alternativas, erros e recuperação:** pai inexistente é recusado.
- **Pós-condições:** catálogo `ork.portfolio/v1`.
- **Regras de negócio:** BR-025-01: escopo de ciclo validado contra o pai.
- **Critérios de aceite e testes:** Dada uma iniciativa sem projeto pai, quando criada, então é recusada (`core/test/portfolio.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** catálogo de portfólio (`ork.portfolio/v1`).
- **APIs:** Não aplicável.
- **Eventos:** `portfolio_created`.

## Operação e controle

- **Rollback:** Não aplicável — entidades são append-only.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
