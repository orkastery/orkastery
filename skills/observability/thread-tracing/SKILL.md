---
name: thread-tracing
description: "Rastro da thread: le o ledger, as sessoes, as claims e o MASTER log para reconstruir o que aconteceu, com quem decidiu e com que evidencia. Somente leitura, nunca escreve no estado."
bucket: observability
roteia: "ork phase list | ork thread status | ork sessions | ork board"
license: MIT
---

# Thread Tracing

## O que esta skill e

Um roteador fino de leitura. Ela reconstroi a historia de uma thread a partir do que esta gravado,
e **nunca escreve no estado**: observabilidade que altera o que observa deixa de ser
observabilidade.

## Como rotear

```bash
ork phase list <thread>       # o ledger inteiro, evento a evento
ork thread status <thread>    # o estado gravado cruzado com o runtime real
ork sessions --all            # as sessoes vivas do runtime
ork claims list <thread>      # as alegacoes e o estado de cada uma
ork board                     # todas as threads, uma visao
ork master --batch            # o que fechou e ainda espera score
```

## O que o rastro precisa responder

1. **O que foi pedido**, com o prompt exato: cada sessao gravou o prompt com `sha256` no nome.
2. **Quem decidiu**, em cada gate: humano com nome, ou decisao autonoma com a #TAG que autorizou.
3. **Com que evidencia**, sempre: comando, saida, sha. Evento sem evidencia e anotacao, nao rastro.
4. **O que falhou e por que**, com o motivo tipado: `claims.failed`, `verify.regression`,
   `policy.violation`, `lease.busy`, `tree.blocked`, `human.pending`.
5. **Onde o tempo e a janela foram**, com a origem da medida declarada: `runtime_reported`,
   `estimated`, `informada` ou `unavailable`.

## A honestidade de medicao

O que o runtime nao expoe sai `unavailable`, com o motivo. **Lacuna e publicada como lacuna, nunca
como zero.** Um rastro que preenche buraco com estimativa silenciosa e pior que um rastro com
buraco declarado, porque o segundo ninguem confunde com dado.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Escrevo um evento a mais para deixar o rastro completo" | Observabilidade nao escreve no estado. Evento inventado depois nao e rastro, e reconstrucao. |
| "O token gasto deve ter sido uns X" | Sem medida do runtime, sai `unavailable`. Estimativa apresentada como leitura e o comeco de todo painel falso. |
| "Coloco zero onde nao tem dado" | Zero e um dado. Lacuna e publicada como lacuna. |
| "Reordeno o ledger para ficar legivel" | O ledger e append-only e a ordem e evidencia. Legibilidade e trabalho da apresentacao, nao do arquivo. |

## Bandeiras vermelhas

- Evento no ledger sem evidencia.
- Gate sem quem decidiu.
- Metrica com numero redondo e sem origem.
- Sessao gravada como viva que o runtime nao reconhece.

## Verificacao antes de entregar o rastro

Pedido, decisor, evidencia, motivo tipado e origem de cada numero, com toda lacuna declarada como
lacuna e nenhuma escrita feita no estado. Ver `PERF 9`, `PERF 10` e `DoD 5`.
