---
id: FEAT-020
tipo: feature
titulo: Servidor MCP e instalação de adaptadores
estado: vigente
pai: MOD-06
roadmap: [RM-016, RM-032, RM-052]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/mcp-server.ts
    - core/src/mcp-install.ts
    - core/src/hosts.ts
  testes:
    - core/test/mcp-server.test.ts
    - core/test/mcp-install.test.ts
    - core/test/adapter.test.ts
    - core/test/adapter-conflito.test.ts
  simbolos:
    - core/src/mcp-server.ts#servirMcp
    - core/src/mcp-install.ts#instalarMcp
    - core/src/hosts.ts#classificarDivergencia
  contratos:
    - ork.adapter-install/v1
  comandos:
    - ork mcp serve
    - ork mcp install
    - ork adapter install
    - ork adapter list
---

# FEAT-020 — Servidor MCP e instalação de adaptadores

> **Em uma frase:** O mesmo `ork` atende Claude Code e Codex por MCP e se instala em cada host com recibo e sha256 por arquivo; divergência dos dois lados pede decisão, arquivo a arquivo.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-02](SYS-02-hosts-e-canais.md) > [MOD-06](MOD-06-integracao-com-hosts.md)
- **Roadmap:** [RM-016](../roadmap/RM-016-experiencia-do-builder.md), [RM-032](../roadmap/RM-032-bootstrap-maestro.md), [RM-052](../roadmap/RM-052-projeto-alvo-explicito.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** servir MCP, instalar adaptador, resolver divergência.
- **Pré-condições e gatilho:** host instalado na máquina (Claude Code, Codex, Hermes ou OpenClaw).
- **Fluxo principal:**

  1. `ork adapter install <host> --dry-run` mostra novo, idêntico e divergente.
  2. Divergência em que só o catálogo andou resolve sozinha.
  3. Quando os dois lados andaram, o comando pede `--aceitar-catalogo` ou `--manter-copia` por arquivo.

- **Alternativas, erros e recuperação:** `ork` fora do PATH do host: o plugin grava o caminho absoluto e honra `ORK_BIN`.
- **Pós-condições:** recibo de instalação com sha256 por arquivo.
- **Regras de negócio:** BR-020-01: o host não reimplementa o parse da #TAG nem valida `allowed_modes`.
- **Critérios de aceite e testes:** Dado um arquivo alterado nos dois lados, quando a instalação roda, então ela para e pede decisão (`core/test/adapter-conflito.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** recibo `ork.adapter-install/v1`.
- **APIs:** MCP stdio (tools `ork_*`).
- **Eventos:** Não aplicável.

## Operação e controle

- **Rollback:** reinstalar a versão anterior do catálogo.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
