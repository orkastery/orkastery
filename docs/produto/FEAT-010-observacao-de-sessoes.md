---
id: FEAT-010
tipo: feature
titulo: Observação de sessões e sensores
estado: vigente
pai: MOD-03
roadmap: [RM-002, RM-004, RM-034, RM-045]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/session-watcher.ts
    - core/src/session-watcher-claude.ts
    - core/src/sessoes.ts
    - core/src/sessoes-adopt.ts
    - core/src/hitl.ts
    - core/src/adapters/claude-bg.ts
  testes:
    - core/test/session-watcher.test.ts
    - core/test/session-watcher-claude.test.ts
    - core/test/claude-sensors.test.ts
    - core/test/sessoes-adopt.test.ts
  simbolos:
    - core/src/session-watcher.ts#observar
    - core/src/session-watcher-claude.ts#classificarSessaoClaude
    - core/src/sessoes-adopt.ts#adotarSessao
    - core/src/hitl.ts#lerSessoesEncerradas
    - core/src/adapters/claude-bg.ts#logsDaSessao
  contratos:
    - ork.session-cursor-claude/v1
  comandos:
    - ork sessions watch
    - ork sessions hitl
    - ork sessions adopt
    - ork sessions
---

# FEAT-010 — Observação de sessões e sensores

> **Em uma frase:** Sensores e observadores leem o estado real de cada sessão claude-bg e codex, e a conclusão da fase vem do runtime, não do relato do agente.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-03](MOD-03-runtimes-e-contas.md)
- **Roadmap:** [RM-002](../roadmap/RM-002-higiene-de-runtime.md), [RM-004](../roadmap/RM-004-sensores-por-hooks.md), [RM-034](../roadmap/RM-034-conclusao-claude-bg.md), [RM-045](../roadmap/RM-045-pulse-enxuto.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** observar a sessão da thread, listar sessões que exigem ação humana, adotar sessão fora do `ork`.
- **Pré-condições e gatilho:** sessão despachada pelo `ork` ou adotada.
- **Fluxo principal:**

  1. O observador lê `claude agents --json --all` e o Stop correlacionado.
  2. O terminal `done` vira `phase_result` idempotente, sem código de saída inventado.
  3. Sessão travada em pergunta aparece em `ork sessions hitl`.

- **Alternativas, erros e recuperação:** thread removida no meio da observação encerra o observador sem estado órfão. Sessão sem thread ou de thread fechada cujo job o runtime declarou ausente entra num cache e não paga outra leitura de tela; as telas têm orçamento por varredura (I-45).
- **Pós-condições:** `phase_result` e `session_watcher_started` no ledger.
- **Regras de negócio:** BR-010-01: self-report não conclui fase. BR-010-02: adoção não executa prompt.
- **Critérios de aceite e testes:** Dada uma sessão claude-bg que termina, quando o observador lê o `done`, então grava um só `phase_result` (`core/test/session-watcher-claude.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** cursores de sessão (`ork.session-cursor-claude/v1`).
- **APIs:** `claude agents --json`, rollout do codex.
- **Eventos:** `phase_result`, `session_watcher_started`, `sessao_bloqueada`.

## Operação e controle

- **Observabilidade:** `ork sessions --global --json --exigir-limpo`.
- **Rollback:** `ork sessions stop <sessão>`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
