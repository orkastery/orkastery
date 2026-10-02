---
id: FEAT-007
tipo: feature
titulo: Worktree e leases por thread
estado: vigente
pai: MOD-02
roadmap: [RM-100]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/worktree.ts
    - core/src/leases.ts
  testes:
    - core/test/worktree.test.ts
    - core/test/leases-b2.test.ts
  simbolos:
    - core/src/worktree.ts#garantirWorktree
    - core/src/leases.ts#adquirirRegiao
  comandos:
    - ork worktree ensure
    - ork worktree sync
    - ork lease list
    - ork lease acquire
---

# FEAT-007 — Worktree e leases por thread

> **Em uma frase:** Cada thread escreve na própria worktree, e leases tipados impedem duas sessões de mexer na mesma região ao mesmo tempo, com fila quando colidem.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** garantir worktree, rebasear na base, tomar e soltar lease.
- **Pré-condições e gatilho:** thread criada com `worktree.por_thread: true` (sem flag) ou com `--worktree auto`, ou depois por `ork worktree ensure`.
- **Fluxo principal:**

  1. A worktree nasce da base resolvida pelo `ork`.
  2. Escrita fora da worktree exige lease de região (`path:<glob>`).
  3. Lease ocupado entra na fila; vaga devolvida por estado real, não por tempo.

- **Alternativas, erros e recuperação:** `ork worktree audit` sai diferente de zero se a worktree divergir do registro.
- **Pós-condições:** registro da worktree e dos leases em `.orkastery/`.
- **Regras de negócio:** BR-007-01: famílias de lease: `main-tree`, `worktree-write:<thread>`, `path:<glob>`, `board:<card>`, `service:<porta>`.
- **Critérios de aceite e testes:** Dado um lease tomado, quando outra thread pede o mesmo, então ela entra na fila (`core/test/leases-b2.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** leases em `.orkastery/leases/`.
- **APIs:** Não aplicável.
- **Eventos:** `lease_acquired`, `lease_released`, `worktree_created`.

## Operação e controle

- **Rollback:** `ork worktree release <thread>` remove a worktree e limpa o registro.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
