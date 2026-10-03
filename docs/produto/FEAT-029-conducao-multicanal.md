---
id: FEAT-029
tipo: feature
titulo: Condução multicanal da thread
estado: vigente
pai: MOD-01
roadmap: [RM-036]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T13:00:00-03:00
versao: main@4a8f41a
fontes:
  codigo:
    - core/src/conducao.ts
    - core/src/conducao-texto.ts
    - core/src/leases.ts
    - core/src/verify.ts
    - core/src/phase.ts
    - core/src/mcp-verify.ts
  testes:
    - core/test/conducao-lease.test.ts
    - core/test/conducao-verify.test.ts
    - core/test/conducao-despacho.test.ts
    - core/test/conducao-handoff.test.ts
    - core/test/conducao-paridade.test.ts
    - core/test/rm036-leases-canonicos.test.ts
  docs:
    - docs/guias/modos.md
    - docs/guias/verificacao.md
    - docs/guias/sincronismo-hitl.md
  simbolos:
    - core/src/conducao.ts#tomarConducao
    - core/src/conducao.ts#conducaoDaThread
    - core/src/conducao.ts#recusaDeConducao
    - core/src/conducao.ts#assumirConducao
    - core/src/conducao.ts#liberarSeOrfa
    - core/src/conducao-texto.ts#linhaDeConducao
  contratos:
    - ork.conducao/v1
    - ork.conducao-recusa/v1
  comandos:
    - ork conducao status
    - ork conducao assumir
    - ork verify
    - ork phase run
---

# FEAT-029 — Condução multicanal da thread

> **Em uma frase:** um dono, vários canais: qualquer canal despacha e verifica, e o núcleo garante que duas execuções nunca rodem juntas na mesma worktree, recusando o segundo pedido com quem conduz e o que fazer.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@4a8f41a
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-036](../roadmap/RM-036-maestro-multicanal.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** despachar uma fase pelo Telegram enquanto o terminal verifica a mesma thread; saber quem conduz uma thread em qualquer tela; esperar a vez; assumir a condução sem matar processo por fora.
- **Pré-condições e gatilho:** uma operação que executa na worktree da thread: `ork phase run`, `ork verify`, `ork fix open`, `ork fix reverify`, `ork retry run` ou o `ork_verify` do MCP.
- **Fluxo principal:**

  1. A operação toma a condução da thread, o lease `exec:<thread>` no estado canônico do projeto, com o canal, a fase, o sha do prompt e quem executa.
  2. Num despacho, a condução passa para a sessão do runtime e dura até o resultado da fase no ledger.
  3. Um segundo pedido, de qualquer canal, recebe `conducao.em-andamento` na hora, sem executar nada: quem conduz, desde quando e três ações (esperar, acompanhar, assumir).
  4. A mesma fase com o mesmo prompt devolve a sessão em andamento, sem abrir outra.

- **Alternativas, erros e recuperação:**
  - `--esperar [min]` espera a vez em vez de recusar;
  - `ork conducao assumir` encerra a sessão pelo runtime, registra quem assumiu, de qual canal e por que, e reserva a vez para esse canal por 15 minutos;
  - processo local vivo não recebe sinal: o handoff recusa e diz como esperar;
  - condução sem dono vivo é liberada com prova (trava do kernel livre, ou sessão encerrada no runtime) na próxima tomada, no `ork conducao status` ou na batida do pulse;
  - `ork lease release exec:<thread> --forcar` continua sendo a saída de emergência.
- **Pós-condições:** uma execução por worktree; toda recusa, repetição, liberação e handoff fica no ledger da thread.
- **Regras de negócio:**
  - BR-029-01: canal descreve a porta, nunca concede autoridade; aprovação continua sendo o ingresso humano assinado do HITL.
  - BR-029-02: prazo do lease é metadado; vida se prova pelo kernel (processo) ou pelo ledger e pelo runtime (sessão), nunca por PID ou prazo sozinhos.
  - BR-029-03: a sessão que já conduz reentra pela identidade do despacho, que recebe no ambiente (`ORK_DISPATCH_ID`) e no servidor MCP (`--dispatch`).
  - BR-029-04: liberar a condução nunca conclui fase; só a prova da I-34 grava o resultado.
  - BR-029-05: a linha "conduzido agora por ..." sai de uma função só e é a mesma em todas as telas e hosts.
  - BR-029-06: todas as famílias de lease (`main-tree`, `worktree-write`, `path`, `board`, `service` e `exec`) e a fila por colisão moram no estado canônico do projeto; a raiz e as worktrees disputam os mesmos arquivos. O lease que a versão anterior gravou no `.orkastery/leases` de uma worktree vale até vencer e nunca ganha segunda cópia.
- **Critérios de aceite e testes:** Dados dois `ork verify` na mesma worktree por canais diferentes, quando o segundo chega com o primeiro executando, então ele sai sem executar nada e diz quem conduz (`core/test/conducao-verify.test.ts`); dada uma fase em andamento, quando o mesmo pedido chega de novo, então nenhuma sessão nova é aberta (`core/test/conducao-despacho.test.ts`).
- **Interface e acessibilidade:** Recusa em português claro, para uma pessoa, com o comando exato de cada ação; `--json` com a mesma estrutura (`ork.conducao-recusa/v1`); horários no fuso do dono; o CLI sai com código `3`.

## Dados e contratos

- **Entidades:** o lease `exec:<thread>` com os dados de condução (`ork.conducao/v1`): canal, correlação, operação, fase, sha do prompt, identidade do despacho e dono (processo, sessão ou reserva).
- **APIs:** o `ork_verify` e o `ork_phase_run` do MCP devolvem a recusa tipada; o `ork_thread_status` traz a condução e a linha.
- **Eventos:** `conducao_recusada`, `despacho_idempotente`, `conducao_liberada`, `conducao_orfa_liberada`, `conducao_assumida` e `conducao_renovada`; `phase_dispatch` e `verify_run` passam a gravar o canal.

## Operação e controle

- **Configuração:** `--canal`, `ORK_CANAL`, ou o que o host exporta (`CLAUDECODE=1`, `HERMES_HOME`); o MCP usa o host da conexão; o padrão é `cli`. Os adaptadores Hermes e OpenClaw declaram o canal deles.
- **Observabilidade:** `ork conducao status`, a linha de condução no `ork thread status`, no `ork board`, no monitor, no `ork pulse` e no panorama `orkastery maestro`; `ork lease list`.
- **Rollback:** `git revert` do merge; os leases `exec:` são arquivos efêmeros, liberáveis por `ork lease release`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-27 | página criada com a entrega da RM-036 (D2 do dono: recusa imediata, sempre explicada para humano) | Claude (agente) / Julio, revisão pendente | RM-036 |
| 2026-10-03 | BR-029-06: todas as famílias de lease no estado canônico (fatia dos leases) | Claude (agente) / Julio, revisão pendente | RM-036, thread `ork-rm036leasesd` |
