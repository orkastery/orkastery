---
id: FEAT-003
tipo: feature
titulo: Despacho de fase para o runtime
estado: vigente
pai: MOD-01
roadmap: [RM-009, RM-034, RM-047]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T08:49:45-03:00
versao: main@8480ba1
fontes:
  codigo:
    - core/src/phase.ts
    - core/src/prompts.ts
    - core/src/setup.ts
    - core/src/runtimes.ts
  testes:
    - core/test/despacho.test.ts
    - core/test/prompts.test.ts
    - core/test/setup.test.ts
    - core/test/setup-fallback.test.ts
    - core/test/setup-versionado.test.ts
  simbolos:
    - core/src/phase.ts#rodarFase
    - core/src/setup.ts#fallbackDoBloco
    - core/src/setup.ts#versionarSetup
    - core/src/runtimes.ts#resolverRuntime
  contratos:
    - ork.setup/v1
  comandos:
    - ork phase run
    - ork phase list
    - ork prompt render
    - ork setup
    - ork setup versionar
---

# FEAT-003 — Despacho de fase para o runtime

> **Em uma frase:** Monta o prompt exato da fase, escolhe runtime, modelo e esforço do bloco e despacha a sessão em segundo plano, com o sha256 do prompt e o trio efetivo no ledger.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@8480ba1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-009](../roadmap/RM-009-playbook-dos-runtimes.md), [RM-034](../roadmap/RM-034-conclusao-claude-bg.md), [RM-047](../roadmap/RM-047-fabrica-em-varias-maquinas.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** despachar fase, ver o prompt antes de despachar, configurar runtime por bloco.
- **Pré-condições e gatilho:** thread na fase certa; `ork doctor` sem bloqueio; perfil de conta com login conferido.
- **Fluxo principal:**

  1. `ork phase run <thread> <FASE> --prompt "<texto>"` renderiza o template da fase.
  2. O runtime vem da CLI, senão do setup do bloco, senão do manifesto.
  3. O `ork` reverifica no runtime que a sessão existe; self-report de despacho não vale.

- **Alternativas, erros e recuperação:** conta esgotada segue pela rotação ([FEAT-008](FEAT-008-rodizio-de-contas.md)); runtime indisponível segue pelo fallback do bloco.
- **Pós-condições:** evento `phase_dispatched` com runtime, modelo, esforço e sha256 do prompt.
- **Regras de negócio:** BR-003-01: só `--model` assume `--effort high`. BR-003-02: prompt quebrado reprova em `ork prompt lint` antes de virar despacho.
- **Critérios de aceite e testes:** Dado um bloco com fallback, quando o runtime primário falha por cota, então o mesmo prompt segue pelo próximo da ordem (`core/test/setup-fallback.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** `orkastery.setup.json` versionado na raiz do checkout, que vale para todas as máquinas, ou, sem ele, o `.orkastery/setup.json` local da raiz de estado (os dois no contrato `ork.setup/v1`); templates em `core/prompts/`.
- **APIs:** CLIs `claude` e `codex` em modo headless.
- **Eventos:** `phase_dispatched`, `phase_dispatch_verified`, `phase_result`.

## Operação e controle

- **Configuração:** `ork setup <modo> --bloco N --runtime R --model M --effort E --fallback R:M:E`; `ork setup versionar` leva o setup para o repositório ([RM-047](../roadmap/RM-047-fabrica-em-varias-maquinas.md)), e `ork setup` diz de onde vem o que vale.
- **Observabilidade:** `ork phase list <thread>` mostra o trio real de cada fase.
- **Rollback:** `ork setup [<modo>] --reset` volta ao default.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-27 | setup versionado no repositório, e o local lido da raiz de estado | Claude (agente) / Julio, revisão pendente | RM-047 |
