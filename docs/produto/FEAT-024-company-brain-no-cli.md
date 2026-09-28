---
id: FEAT-024
tipo: feature
titulo: Company Brain no CLI
estado: vigente
pai: MOD-05
roadmap: [RM-025, RM-026]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/company-brain-cli.ts
    - core/src/company-brain-client.ts
    - core/src/company-brain-contract.ts
  testes:
    - core/test/company-brain-cli.test.ts
    - core/test/company-brain-contract.test.ts
  simbolos:
    - core/src/company-brain-cli.ts#runBrain
    - core/src/company-brain-cli.ts#BRAIN_READ
  comandos:
    - ork brain status
    - ork brain query
    - ork brain get
---

# FEAT-024 — Company Brain no CLI

> **Em uma frase:** O `ork brain` consulta e sincroniza o Company Brain do OrkMind com identidade do login autenticado, somente leitura por padrão e com recibo por operação.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-025](../roadmap/RM-025-company-brain-fundacao.md), [RM-026](../roadmap/RM-026-workspace-empresarial.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver o contrato e o tenant, consultar, ler uma entrada.
- **Pré-condições e gatilho:** login do OrkMind; tenant do projeto.
- **Fluxo principal:**

  1. `ork brain status` mostra contrato e tenant efetivo.
  2. `ork brain query` e `ork brain get` leem com a thread explícita.
  3. Operações de escrita exigem ativação com aceite.

- **Alternativas, erros e recuperação:** principal, DSN ou raiz vindos da conversa são recusados.
- **Pós-condições:** recibos de operação.
- **Regras de negócio:** BR-024-01: a identidade vem só do login autenticado do OrkMind.
- **Critérios de aceite e testes:** Dado um principal vindo da conversa, quando o comando roda, então é recusado (`core/test/company-brain-cli.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** contrato do Company Brain (`core/src/company-brain-contract.ts`).
- **APIs:** OrkMind.
- **Eventos:** recibos de operação.

## Operação e controle

- **Produto principal:** OrkMind; esta página cobre só a parte do Orkastery.
- **Rollback:** `ork brain rollback`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
