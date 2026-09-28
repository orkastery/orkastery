---
id: FEAT-027
tipo: feature
titulo: Fábrica compartilhada entre máquinas
estado: vigente
pai: MOD-01
roadmap: [RM-047]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T09:00:00-03:00
versao: main@8480ba1
fontes:
  codigo:
    - core/src/fabrica-estado.ts
    - core/src/fabrica-publicar.ts
    - core/src/branch-de-estado.ts
    - core/src/maquina.ts
  testes:
    - core/test/fabrica-estado.test.ts
  docs:
    - docs/guias/varias-maquinas.md
  simbolos:
    - core/src/fabrica-estado.ts#publicarMaquina
    - core/src/fabrica-estado.ts#lerFabrica
    - core/src/fabrica-estado.ts#retratoDaMaquina
    - core/src/maquina.ts#nomeDaMaquina
  contratos:
    - ork.fabrica-maquina/v1
    - ork.maquina/v1
  comandos:
    - ork fabrica
    - ork fabrica entrar
    - ork fabrica publicar
    - ork fabrica sair
    - ork board
---

# FEAT-027 — Fábrica compartilhada entre máquinas

> **Em uma frase:** cada máquina publica o retrato das próprias threads numa branch do remoto, e o board, o `ork fabrica` e o resumo do pulse de qualquer máquina mostram as outras.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@8480ba1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-047](../roadmap/RM-047-fabrica-em-varias-maquinas.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** entrar na fábrica com um nome de máquina; ver o que cada máquina conduz; saber em qual máquina uma thread espera você; sair.
- **Pré-condições e gatilho:** repositório com remoto; a máquina entrou (`ork fabrica entrar`) ou o projeto declara `fabrica.compartilhada: true`.
- **Fluxo principal:**

  1. `ork fabrica entrar --maquina pc-casa` grava o nome e a adesão em `~/.orkastery/maquina.json` e publica o primeiro retrato.
  2. Ao criar thread, despachar fase, entregar e fechar, e a cada batida do pulse, a máquina grava `maquinas/<nome>.json` e o `FABRICA.md` na branch `ork/fabrica-estado`, em segundo plano, com push sem força.
  3. `ork board` e `ork fabrica` leem a branch; o resumo do pulse lê a última cópia e mostra o bloco **Em outras máquinas**.

- **Alternativas, erros e recuperação:**
  - push recusado: o `ork` relê a ponta e grava de novo;
  - sem rede: `fabrica.sem-remoto`, e a leitura mostra a última cópia com aviso;
  - publicação em segundo plano que falhou fica em `.orkastery/monitor/fabrica.log`;
  - `ork fabrica sair` tira o retrato da máquina da branch.
- **Pós-condições:** a branch tem um arquivo por máquina e um commit por publicação; o retrato igual ao último não vai ao remoto, salvo uma vez por hora.
- **Regras de negócio:**
  - BR-027-01: a adesão é da máquina, não do projeto; quem clona não publica até entrar.
  - BR-027-02: nada de credencial, prompt, log ou caminho local sai da máquina.
  - BR-027-03: thread com `ship(<thread>)` na base aparece como entregue, mesmo sem MASTER.
  - BR-027-04: pergunta que espera o dono em outra máquina chega na hora pelo resumo, e se responde na máquina da thread.
- **Critérios de aceite e testes:** Dadas duas máquinas no mesmo remoto, quando cada uma publica, então o board de uma mostra as threads da outra e o resumo do pulse avisa na hora de quem espera o dono na outra (`core/test/fabrica-estado.test.ts`).
- **Interface e acessibilidade:** Horários no fuso do dono; `ork fabrica --json` com o contrato `ork.fabrica-maquina/v1` para agentes.

## Dados e contratos

- **Entidades:** `maquinas/<nome>.json` na branch `ork/fabrica-estado` (`ork.fabrica-maquina/v1`), com máquina, pessoa, projeto, versão do `ork`, hora da publicação e as threads; `~/.orkastery/maquina.json` (`ork.maquina/v1`), com o nome e a adesão.
- **APIs:** Não aplicável.
- **Eventos:** `thread_created` e `phase_dispatch` levam a `maquina`; os eventos de HITL não mudam.

## Operação e controle

- **Configuração:** `ork fabrica entrar` e `ork fabrica sair`; `ORK_MAQUINA` vence o nome do arquivo; `ORK_FABRICA_COMPARTILHADA=1` ou `0` vence a adesão; `fabrica.compartilhada` e `fabrica.remoto` no manifesto para o time.
- **Observabilidade:** `ork fabrica`, o `FABRICA.md` da branch e `.orkastery/monitor/fabrica.log`.
- **Rollback:** `ork fabrica sair` em cada máquina; apagar a branch `ork/fabrica-estado` zera o retrato de todas sem afetar a `main`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-27 | página criada com a segunda fatia da RM-047 | Claude (agente) / Julio, revisão pendente | RM-047 |
