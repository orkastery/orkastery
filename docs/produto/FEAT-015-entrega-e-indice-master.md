---
id: FEAT-015
tipo: feature
titulo: Entrega e índice de condução (MASTER)
estado: vigente
pai: MOD-04
roadmap: [RM-005, RM-043, RM-048]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/master.ts
    - core/src/indice.ts
    - core/src/master-digest.ts
    - core/src/master-nota.ts
  testes:
    - core/test/master.test.ts
    - core/test/indice.test.ts
    - core/test/master-omissao.test.ts
    - core/test/master-prova-canal.test.ts
  simbolos:
    - core/src/indice.ts#calcularIndice
    - core/src/master.ts#CLASSES_DE_FALHA
    - core/src/master-digest.ts#montarDigest
    - core/src/master-nota.ts#exigirNotaSemHost
  contratos:
    - ork.master-digest/v1
    - ork.master-nota/v1
  comandos:
    - ork master
    - ork master classes
    - ork master pedir
---

# FEAT-015 — Entrega e índice de condução (MASTER)

> **Em uma frase:** O MASTER fecha a thread com POSTMORTEM tipado e um índice derivado do ledger que ninguém digita; aceitação por default com registro substitui a fila de notas manuais.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-04](MOD-04-atencao-humana.md)
- **Roadmap:** [RM-005](../roadmap/RM-005-master-e-digest.md), [RM-043](../roadmap/RM-043-aposentadoria.md), [RM-048](../roadmap/RM-048-hitl-humano-no-centro.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** fechar thread, ver entregas com o índice, aceitar por omissão, digest semanal, pedir a nota ao dono pelo canal.
- **Nota com prova de origem (RM-048):** `ork master pedir <thread>` devolve a linha `<código> <0 a 5> <porquê>`; o dono responde pelo Telegram, o ingresso assina no endereço do pulse e o `master_done` grava o remetente autenticado, o canal, a mensagem, o sha da prova e a evidência com o envelope. `ork master` com `--por` (nota, `ratificar`, `batch --aceitar`, `digest responder`) chamado de processo de host é recusado com `master.prova-de-canal`; o canal é lido só do ambiente. `ORK_CANAL=cli` não absolve sessão despachada, Claude Code nem Codex. Limite: quem apaga as variáveis do próprio host passa como terminal, e o Codex interativo sem `CODEX_SANDBOX` não é reconhecido; é a mesma fronteira do `humano-no-cli` do SHIP.
- **Pré-condições e gatilho:** SHIP feito ou artefato com hash conferido.
- **Fluxo principal:**

  1. `ork master <thread>` grava POSTMORTEM e MASTER log.
  2. O índice sai de fatos: rodadas de GO-FIX, veredito do CHECK, CI vermelho antes de verde, reversão.
  3. `ork master --aceitar-omissao` drena o que sobrou, com evento `aceite_por_omissao`.

- **Alternativas, erros e recuperação:** a nota humana sobrescreve a aceitação por omissão, e o evento antigo permanece.
- **Pós-condições:** MASTER log e score na thread.
- **Regras de negócio:** BR-015-01: `ork master --batch` foi aposentado (`master.fila-aposentada`, saída 2).
- **Critérios de aceite e testes:** Dada uma thread entregue sem nota, quando a omissão é aceita, então o índice e os insumos ficam no ledger (`core/test/master-omissao.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** MASTER log, POSTMORTEM, `score` com `regime`.
- **APIs:** Não aplicável.
- **Eventos:** `master_done`, `aceite_por_omissao`, `rollback_done`.

## Operação e controle

- **Rollback:** `ork master <thread> --refazer`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
