---
id: FEAT-026
tipo: feature
titulo: Reservas de item do roadmap entre máquinas
estado: vigente
pai: MOD-01
roadmap: [RM-047]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T08:00:00-03:00
versao: main@80b366e
fontes:
  codigo:
    - core/src/roadmap-reservas.ts
  testes:
    - core/test/roadmap-reservas.test.ts
  docs:
    - docs/padroes/roadmap-de-produto.md
  simbolos:
    - core/src/roadmap-reservas.ts#pegarItem
    - core/src/roadmap-reservas.ts#soltarItem
    - core/src/roadmap-reservas.ts#listarReservas
  contratos:
    - ork.roadmap-reserva/v1
  comandos:
    - ork roadmap reservas
    - ork roadmap pegar
    - ork roadmap soltar
---

# FEAT-026 — Reservas de item do roadmap entre máquinas

> **Em uma frase:** antes de começar um item do roadmap, a máquina o reserva num push atômico ao GitHub; outra máquina que tente o mesmo item é recusada e fica sabendo com quem ele está.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@80b366e
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-047](../roadmap/RM-047-fabrica-em-varias-maquinas.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver quem está com cada item; reservar um item; abrir a thread já reservando o item; devolver o item; tomar a reserva de uma máquina parada.
- **Pré-condições e gatilho:** repositório com remoto (`origin`) e o item em `docs/roadmap/RM-NNN-*.md`.
- **Fluxo principal:**

  1. `ork roadmap reservas` lê a branch `ork/roadmap-reservas` do remoto e mostra item, pessoa, máquina, thread e desde quando.
  2. `ork roadmap pegar RM-NNN` (ou `ork thread new ... --roadmap RM-NNN`) grava `reservas/RM-NNN.json` e o `RESERVAS.md` num commit sobre a ponta lida e faz push sem força.
  3. Se outra máquina gravou antes, o push é recusado; o `ork` relê e aplica a regra de novo sobre o estado novo.
  4. `ork roadmap soltar RM-NNN` apaga o arquivo do item quando o trabalho termina.

- **Alternativas, erros e recuperação:**
  - item de outra máquina: `roadmap.reservado`, com quem, onde e desde quando;
  - item fora do roadmap: `roadmap.item`;
  - sem rede: `roadmap.sem-remoto`, e a listagem mostra a última cópia com aviso;
  - máquina parada: `--forcar --motivo` toma ou solta a reserva, e o motivo fica no commit e no campo `tomadaDe`.
- **Pós-condições:** a branch de reservas tem um commit por mudança, e o `RESERVAS.md` dela mostra o estado atual no GitHub.
- **Regras de negócio:**
  - BR-026-01: o primeiro push vence, e nenhum push é forçado.
  - BR-026-02: renovar a própria reserva é idempotente e mantém o "desde".
  - BR-026-03: a reserva nunca toca a árvore de trabalho, o índice nem a `main`.
- **Critérios de aceite e testes:** Dadas duas máquinas no mesmo remoto, quando a segunda pega o item no meio do push da primeira, então o push dela é recusado e ela recebe `roadmap.reservado` (`core/test/roadmap-reservas.test.ts`).
- **Interface e acessibilidade:** Horários no fuso do dono; `--json` com o contrato `ork.roadmap-reserva/v1` para agentes.

## Dados e contratos

- **Entidades:** `reservas/RM-NNN.json` na branch `ork/roadmap-reservas`, com `item`, `por`, `maquina`, `thread`, `nota`, `desdeEm`, `atualizadaEm` e, quando tomada, `tomadaDe`.
- **APIs:** Não aplicável.
- **Eventos:** um commit por reserva na branch `ork/roadmap-reservas`, com quem, onde e o motivo quando houve `--forcar`.

## Operação e controle

- **Configuração:** a máquina se identifica por `--maquina`, pela variável `ORK_MAQUINA` ou pelo hostname; a pessoa, por `--por` ou pelo `user.name` do git.
- **Observabilidade:** `ork roadmap reservas` e o `RESERVAS.md` da branch.
- **Rollback:** `ork roadmap soltar`; apagar a branch `ork/roadmap-reservas` zera todas as reservas sem afetar a `main`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-27 | página criada com a primeira fatia da RM-047 | Claude (agente) / Julio, revisão pendente | RM-047 |
