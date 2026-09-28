---
id: FEAT-012
tipo: feature
titulo: Decisão tomada com prestação de contas
estado: vigente
pai: MOD-04
roadmap: [RM-041]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/decisao-autonoma.ts
    - core/src/hitl-classificacao.ts
  testes:
    - core/test/decisao-autonoma.test.ts
    - core/test/hitl-classificacao.test.ts
  simbolos:
    - core/src/decisao-autonoma.ts#registrarDecisao
    - core/src/decisao-autonoma.ts#placarDaThread
  contratos:
    - ork.decisao-autonoma/v1
  comandos:
    - ork decisao registrar
    - ork decisao placar
---

# FEAT-012 — Decisão tomada com prestação de contas

> **Em uma frase:** Decisão óbvia não vira pergunta: o agente decide, registra o porquê, como mudar e o custo de mudar agora ou depois, e o dono é informado no próximo resumo.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-04](MOD-04-atencao-humana.md)
- **Roadmap:** [RM-041](../roadmap/RM-041-hitl-invertido.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** registrar decisão, ver o placar de decididas contra perguntas por fase.
- **Pré-condições e gatilho:** item classificado como `decidido` (as quatro condições da decisão óbvia).
- **Fluxo principal:**

  1. `ork decisao registrar <thread> --decidido D --porque P --como-mudar C --custo-agora A --custo-depois B`.
  2. A decisão entra no resumo do dono como informada.
  3. O placar mostra reversões e o limiar por fase.

- **Alternativas, erros e recuperação:** decisão revertida pelo dono entra no placar e pesa no índice da thread.
- **Pós-condições:** rastro tipado da decisão no ledger.
- **Regras de negócio:** BR-012-01: irreversível nunca é decidido pelo agente. BR-012-02: limiar de 13 decisões por fase.
- **Critérios de aceite e testes:** Dada uma decisão registrada, quando o placar é lido, então ela aparece na fase certa (`core/test/decisao-autonoma.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI e resumo do canal.

## Dados e contratos

- **Entidades:** rastro `ork.decisao-autonoma/v1`.
- **APIs:** Não aplicável.
- **Eventos:** `decisao_registrada`, `decisao_revertida`.

## Operação e controle

- **Observabilidade:** `ork decisao placar <thread> --json`.
- **Rollback:** o dono muda a decisão respondendo ao resumo; o evento antigo permanece.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
