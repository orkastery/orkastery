---
id: FEAT-001
tipo: feature
titulo: Thread e ciclo de seis fases
estado: vigente
pai: MOD-01
roadmap: [RM-100, RM-043]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/thread.ts
    - core/src/types.ts
    - core/src/estado-thread.ts
  testes:
    - core/test/thread.test.ts
    - core/test/thread-listagem.test.ts
    - core/test/estado-thread.test.ts
  simbolos:
    - core/src/thread.ts#novaThread
    - core/src/thread.ts#threadsDaListagem
    - core/src/estado-thread.ts#raizDoEstado
  comandos:
    - ork thread new
    - ork thread list
    - ork thread status
    - ork thread close
---

# FEAT-001 — Thread e ciclo de seis fases

> **Em uma frase:** Cada pedido vira uma thread com slug de três partes, ledger próprio e seis fases fixas: GOAL, PLAN, GO, CHECK, SHIP e MASTER.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md), [RM-043](../roadmap/RM-043-aposentadoria.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** abrir thread, listar threads abertas, ver o estado de uma thread, fechar thread órfã ou criada por engano.
- **Pré-condições e gatilho:** projeto com `orkastery.yaml`; modo permitido pelo manifesto.
- **Fluxo principal:**

  1. `ork thread new <nome> --modo <MODO>` grava `thread.json` e o primeiro evento do ledger.
  2. Com `--worktree auto`, a thread ganha uma worktree e uma branch `ork/<thread>-<fases>`.
  3. Cada fase avança só depois do gate da anterior.

- **Alternativas, erros e recuperação:** modo aposentado (`#Look`, `#Ork`) recusa com `modo.aposentado` e nomeia o substituto; `--done` aceita critério de pronto executável.
- **Pós-condições:** `.orkastery/threads/<id>/thread.json` e `ledger.jsonl` na árvore principal, mesmo quando o comando roda de uma worktree.
- **Regras de negócio:** BR-001-01: o ledger é append-only. BR-001-02: `ork thread list` mostra só as abertas; `--todas` inclui as fechadas (I-43).
- **Critérios de aceite e testes:** Dado um projeto iniciado, quando `ork thread new` roda, então a thread aparece em `ork thread list` com a fase GOAL (`core/test/thread.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI de texto; `--json` para agentes.

## Dados e contratos

- **Entidades:** `thread.json` (id, slug, modo, fases, blocos, faseAtual, status, base); `ledger.jsonl` (um evento por linha, com `tipo` e `ts` em UTC ISO).
- **APIs:** Não aplicável — CLI local.
- **Eventos:** `thread_created`, `worktree_created`, `phase_dispatched`, `thread_closed_admin`.

## Operação e controle

- **Configuração:** `conduction.allowed_modes` e `conduction.default_mode` no `orkastery.yaml`.
- **Observabilidade:** `ork thread status <id>` e `ork board`.
- **Rollback:** thread fechada por engano não reabre; abre-se outra, e o ledger guarda as duas.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
