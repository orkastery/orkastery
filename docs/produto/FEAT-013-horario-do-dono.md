---
id: FEAT-013
tipo: feature
titulo: Horário do dono em toda superfície humana
estado: vigente
pai: MOD-04
roadmap: [RM-035]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/horario.ts
  testes:
    - core/test/horario.test.ts
    - core/test/horario-lint.test.ts
    - core/test/horario-hitl.test.ts
  simbolos:
    - core/src/horario.ts#fusoDoDono
    - core/src/horario.ts#lerFusoDoDono
  comandos: []
---

# FEAT-013 — Horário do dono em toda superfície humana

> **Em uma frase:** Todo horário mostrado a uma pessoa sai no fuso do dono (`owner.timezone`), em formato brasileiro, com o fuso dito uma vez por mensagem; máquina continua em UTC ISO.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-04](MOD-04-atencao-humana.md)
- **Roadmap:** [RM-035](../roadmap/RM-035-horario-do-dono.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** formatar prazo, horário de evento e janela de resumo para pessoa.
- **Pré-condições e gatilho:** `owner.timezone` (IANA) no manifesto; sem ele, o fuso do sistema.
- **Fluxo principal:**

  1. Um só módulo formata: `19/09 15:16 (horário de Brasília)`.
  2. CLI, HITL, pulse, digest, monitor, board e adaptadores usam o mesmo módulo.
  3. JSON de exibição ganha `prazoLocal` e fatos `*Local`.

- **Alternativas, erros e recuperação:** fuso inválido avisa sem quebrar o comando.
- **Pós-condições:** nenhuma superfície humana mostra UTC cru.
- **Regras de negócio:** BR-013-01: ledger, contratos, recibos e hashes seguem em UTC ISO.
- **Critérios de aceite e testes:** Dada a mesma entrada, quando roda com `TZ=UTC` e `TZ=America/Sao_Paulo`, então a saída para pessoa é a mesma (`core/test/horario.test.ts`); o lint `core/test/horario-lint.test.ts` barra UTC cru.
- **Interface e acessibilidade:** Texto de CLI e de canal.

## Dados e contratos

- **Entidades:** `owner.timezone` no `orkastery.yaml`.
- **APIs:** Não aplicável.
- **Eventos:** Não aplicável — formatação.

## Operação e controle

- **Limite conhecido:** o lint não pega campo ISO passado como argumento de função (item 8 da I-43).
- **Rollback:** Não aplicável — sem estado.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
