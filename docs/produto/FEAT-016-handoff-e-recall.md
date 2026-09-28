---
id: FEAT-016
tipo: feature
titulo: Handoff triado e recall tardio
estado: vigente
pai: MOD-05
roadmap: [RM-100]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/handoff.ts
    - core/src/recall.ts
  testes:
    - core/test/handoff.test.ts
    - core/test/recall.test.ts
  simbolos:
    - core/src/handoff.ts#exportarHandoff
    - core/src/recall.ts#recall
  comandos:
    - ork handoff export
    - ork handoff recall
    - ork recall
---

# FEAT-016 — Handoff triado e recall tardio

> **Em uma frase:** A fase seguinte recebe um handoff triado em CRÍTICO, IMPORTANTE e RESUMÍVEL, e busca o resto só quando precisa, por ponteiro, nunca a janela inteira.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** exportar handoff, resolver ponteiro, recuperar no momento certo.
- **Pré-condições e gatilho:** thread com fase concluída.
- **Fluxo principal:**

  1. `ork handoff export <thread>` tria o que a próxima fase precisa.
  2. `ork recall <thread> --fase F` resolve só os ponteiros com `retrieve_when` da fase.
  3. Ponteiro `path#ancora` volta ao conteúdo com `ork handoff recall`.

- **Alternativas, erros e recuperação:** memória OrkMind indisponível cai para arquivos com aviso tipado.
- **Pós-condições:** handoff gravado na thread e, com memória ligada, no OrkMind.
- **Regras de negócio:** BR-016-01: recall tardio nunca carrega a janela inteira.
- **Critérios de aceite e testes:** Dado um ponteiro com `retrieve_when: GO`, quando o recall roda no PLAN, então ele não volta (`core/test/recall.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** handoff triado; ponteiros `path#ancora`.
- **APIs:** OrkMind, quando ligado.
- **Eventos:** `handoff_exported`, `recall_resolved`.

## Operação e controle

- **Rollback:** Não aplicável — o handoff é regenerável.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
