---
id: FEAT-024
tipo: feature
titulo: Company Brain no CLI
estado: vigente
pai: MOD-05
roadmap: [RM-025, RM-026]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-28T23:25:00-03:00
versao: main@8469e4b
fontes:
  codigo:
    - core/src/company-brain-cli.ts
    - core/src/company-brain-client.ts
    - core/src/company-brain-contract.ts
    - core/src/company-brain-context.ts
    - core/src/company-brain-mcp.ts
  testes:
    - core/test/company-brain-cli.test.ts
    - core/test/company-brain-contract.test.ts
    - core/test/company-brain-context.test.ts
    - core/test/company-brain-mcp.test.ts
    - core/test/company-brain-hosts.test.ts
  simbolos:
    - core/src/company-brain-cli.ts#runBrain
    - core/src/company-brain-cli.ts#BRAIN_READ
    - core/src/company-brain-context.ts#buildContext
  comandos:
    - ork brain status
    - ork brain inventory
    - ork brain get
    - ork brain query
    - ork brain receipts
    - ork brain reconcile
    - ork brain context
    - ork brain sync
    - ork brain apply
    - ork brain rollback
    - ork brain bind
---

# FEAT-024 — Company Brain no CLI

> **Em uma frase:** O `ork brain` consulta, cita e sincroniza o Company Brain do OrkMind pela identidade do transporte autenticado, somente leitura por padrão e com recibo por operação.

- **Estado:** vigente · **Verificado em:** 2026-09-28 · **Versão:** main@8469e4b
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-025](../roadmap/RM-025-company-brain-fundacao.md), [RM-026](../roadmap/RM-026-workspace-empresarial.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:**
  - Leitura: `ork brain status` (contrato e tenant), `ork brain inventory` e `ork brain query` (seleção por ids, tipos e workspaces), `ork brain get` (uma entidade), `ork brain receipts` (recibos de um evento), `ork brain reconcile` (plano de migração, só com `--dry-run`) e `ork brain context` (pacote de contexto citável).
  - Escrita, com ativação aceita: `ork brain bind` (escopo da thread), `ork brain sync` (captura do portfólio e do ledger da thread), `ork brain apply` (aplica um plano conferido por sha256) e `ork brain rollback` (desfaz um lote).
- **Pré-condições e gatilho:** `memory.mode: orkmind`, o nome da variável de ambiente da DSN no manifesto e o tenant do projeto. As operações de thread exigem `--thread` de uma thread existente.
- **Fluxo principal:**

  1. `ork brain status` mostra o contrato e o tenant efetivo.
  2. `ork brain context --thread <id> --ids <ids>` devolve o pacote `ork.brain-context/v1`: as entidades pedidas e os pais, cada uma com a citação da fonte, o frescor contra o portfólio canônico e as lacunas. Sem `--ids`, vale o escopo vinculado por `ork brain bind`.
  3. `ork brain query` e `ork brain get` leem entidades pela mesma identidade.
  4. As escritas exigem a ativação com aceite e a concessão do banco do Brain; uma não concede a outra.

- **Alternativas, erros e recuperação:** opção fora da lista fechada (por exemplo `--principal` ou `--dsn`) é recusada com `brain.argument.invalid`. Brain indisponível ou recusando devolve o estado recebido, sem pacote montado só da fonte.
- **Pós-condições:** leitura não grava nada; escrita deixa recibos por operação.
- **Regras de negócio:**
  - BR-024-01: a identidade vem só do transporte autenticado (o usuário do PostgreSQL mapeado a um principal pelo OrkMind), nunca de argumento.
  - BR-024-02: no pacote de contexto, item sem a citação inteira (`source_ref`, `source_hash`, `source_version` e `location`) vira a lacuna `citacao.incompleta`, nunca conteúdo.
  - BR-024-03: item retido pela ACL do Brain sai só com o id e o frescor `retido`, sem valor, nem o da fonte local.
- **Critérios de aceite e testes:**
  - Dado um principal vindo da conversa, quando o comando roda, então é recusado (`core/test/company-brain-cli.test.ts`).
  - Dado um Brain atrasado em relação ao portfólio, quando o contexto é pedido, então a entidade que falta sai com frescor `ausente-no-brain` e lacuna `brain.ausente` (`core/test/company-brain-context.test.ts`).
- **Interface e acessibilidade:** não se aplica: CLI, MCP (`ork_brain_*`) e os hosts Hermes e OpenClaw.

## Dados e contratos

- **Entidades:** contrato `orkmind.company-brain/v1` (`core/schemas/company-brain.schema.json`, o mesmo arquivo do OrkMind), com entidades `prod`, `proj` e `init`, afirmações, eventos, recibos, seleção e migração.
- **Pacote de contexto:** `ork.brain-context/v1` com `pedido`, `itens`, `lacunas` e `digest` (sha256 do JSON canônico, sem o horário da consulta).
- **Frescor:** `confere`, `divergente`, `ausente-no-brain`, `ausente-na-fonte` e `retido`.
- **Lacunas:** `dono.sem-principal`, `observado.desconhecido`, `registrado.desconhecido`, `brain.ausente`, `fonte.ausente`, `fonte.divergente`, `brain.retido`, `citacao.incompleta` e `entidade.desconhecida`.
- **APIs:** OrkMind, sem HTTP: o subprocesso `orkmind brain request` na leitura e na captura, e o `orkmind brain migration` em `reconcile`, `apply` e `rollback`.
- **Eventos:** recibos de operação.

## Operação e controle

- **Produto principal:** OrkMind; esta página cobre só a parte do Orkastery.
- **MCP:** as leituras são sempre registradas; as escritas, só com concessão da instalação.
- **Rollback:** `ork brain rollback`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-28 | subcomandos reais, identidade pelo transporte e pacote de contexto | Claude (agente) / Julio, revisão pendente | RM-025, B4.1 |
