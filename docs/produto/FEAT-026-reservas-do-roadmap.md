---
id: FEAT-026
tipo: feature
titulo: Reservas de item do roadmap entre máquinas
estado: vigente
pai: MOD-01
roadmap: [RM-047, RM-058]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T08:00:00-03:00
versao: main@80b366e
fontes:
  codigo:
    - core/src/roadmap-reservas.ts
  testes:
    - core/test/roadmap-reservas.test.ts
    - core/test/rm037-noite-reserva-orfa.test.ts
    - core/test/rm037-noite-numero-de-feat.test.ts
  docs:
    - docs/padroes/roadmap-de-produto.md
  simbolos:
    - core/src/roadmap-reservas.ts#pegarItem
    - core/src/roadmap-reservas.ts#soltarItem
    - core/src/roadmap-reservas.ts#listarReservas
    - core/src/roadmap-reservas.ts#soltarReservaDaThread
    - core/src/roadmap-reservas.ts#reservasOrfas
    - core/src/roadmap-reservas.ts#reservarFeat
  contratos:
    - ork.roadmap-reserva/v1
    - ork.feat-reserva/v1
  comandos:
    - ork roadmap reservas
    - ork roadmap pegar
    - ork roadmap soltar
    - ork roadmap feat
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
  5. `ork master` e `ork thread close` soltam sozinhos a reserva da thread que fecha; se outra thread aberta desta máquina está no mesmo item, a reserva passa para ela (RM-037).
  6. `ork roadmap feat --thread <thread>` reserva o próximo número de FEAT (o maior entre a árvore, as branches locais, as do remoto já buscadas e os números já reservados, mais um) em `feats/FEAT-NNN.json`, pelo mesmo push atômico (RM-037).

- **Alternativas, erros e recuperação:**
  - item de outra máquina: `roadmap.reservado`, com quem, onde e desde quando;
  - item fora do roadmap: `roadmap.item`;
  - sem rede: `roadmap.sem-remoto`, e a listagem mostra a última cópia com aviso;
  - máquina parada: `--forcar --motivo` toma ou solta a reserva, e o motivo fica no commit e no campo `tomadaDe`;
  - fechamento sem rede, ou com a reserva em outra máquina: o fechamento segue, e o ledger da thread guarda `roadmap_reserva_pendente` com a correção;
  - reserva órfã (desta máquina, de thread que aqui já fechou): `ork roadmap reservas` a marca como ÓRFÃ, e `ork roadmap reservas --soltar-orfas` a solta ou a passa adiante, com `roadmap_reserva_liberada` no ledger da thread fechada.
- **Pós-condições:** a branch de reservas tem um commit por mudança, e o `RESERVAS.md` dela mostra o estado atual no GitHub.
- **Regras de negócio:**
  - BR-026-01: o primeiro push vence, e nenhum push é forçado.
  - BR-026-02: renovar a própria reserva é idempotente e mantém o "desde".
  - BR-026-03: a reserva nunca toca a árvore de trabalho, o índice nem a `main`.
  - BR-026-04: thread fechada não segura item; a thread que não existe nesta máquina não prova que acabou, e a reserva dela fica.
  - BR-026-05: número de FEAT reservado não volta, mesmo que a feature não saia; duas máquinas que usam `ork roadmap feat` nunca recebem o mesmo número, e a FEAT criada à mão numa branch local ou já buscada do remoto também conta. Branch que a máquina nunca buscou fica invisível.
- **Critérios de aceite e testes:** Dadas duas máquinas no mesmo remoto, quando a segunda pega o item no meio do push da primeira, então o push dela é recusado e ela recebe `roadmap.reservado` (`core/test/roadmap-reservas.test.ts`).
- **Interface e acessibilidade:** Horários no fuso do dono; `--json` com o contrato `ork.roadmap-reserva/v1` para agentes.

## Dados e contratos

- **Entidades:** `reservas/RM-NNN.json` na branch `ork/roadmap-reservas`, com `item`, `por`, `maquina`, `thread`, `nota`, `desdeEm`, `atualizadaEm` e, quando tomada, `tomadaDe`; `feats/FEAT-NNN.json` (`ork.feat-reserva/v1`), com `feat`, `por`, `maquina`, `thread`, `nota` e `em`.
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
| 2026-09-30 | o fechamento solta a reserva; órfã marcada e solta por `--soltar-orfas` | Claude (agente) / Julio, revisão pendente | RM-037, thread ork-rm037noite |
| 2026-09-30 | número de FEAT reservado por `ork roadmap feat` | Claude (agente) / Julio, revisão pendente | RM-037, thread ork-rm037noite |
