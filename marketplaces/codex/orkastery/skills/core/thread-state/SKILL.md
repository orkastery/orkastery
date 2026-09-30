---
name: thread-state
description: "O estado da thread em disco: thread.json, ledger.jsonl, claims.jsonl, prompts com hash e leases. Roteia para ork thread status, ork phase list e ork board; nenhuma leitura de estado por memoria de conversa."
bucket: core
roteia: "ork thread status | ork phase list | ork board"
license: MIT
---

# Thread State

## O que esta skill e

Um roteador fino sobre o estado que o `ork` mantem em disco. Ela nao inventa formato, nao edita
arquivo de estado na mao e nao guarda regra: ela diz qual comando le a verdade e chama esse
comando. **Editar `thread.json` com editor de texto e corromper estado, nao adiantar trabalho.**

## Quando usar

- Ao retomar uma thread que outra sessao abriu.
- Antes de qualquer fase, para saber em que ponto do ciclo a thread esta.
- Quando duas threads parecem estar disputando o mesmo arquivo ou a mesma arvore.

## Onde o estado mora

```text
.orkastery/
|- threads/<thread-id>/
|  |- thread.json          estado da thread: modo, blocos, base carimbada, sessoes
|  |- ledger.jsonl         append-only: todo evento, com quem decidiu e a evidencia
|  |- claims.jsonl         alegacoes verificaveis e o comando que comprova cada uma
|  |- prompts/             o prompt exato de cada sessao, nomeado pelo sha256
|  |- POSTMORTEM.json      fechamento tipado da thread
|  `- master-log.json      o contrato congelado ork.master-log/v1, com o score humano
`- leases/                 leases por familia e a fila de espera
```

## Como rotear

```bash
ork thread list                    # as threads NAO fechadas (aberta e pausada)
ork thread list --todas            # todas, inclusive as fechadas
ork thread list --json             # a mesma listagem como JSON
ork thread status <thread>         # estado da thread, cruzado com o runtime real
ork phase list <thread>            # o ledger inteiro, evento a evento
ork claims list <thread>           # as alegacoes e o estado de cada uma
ork lease list                     # leases, familias e as filas
ork board                          # todas as threads em uma visao
ork memory status                  # regime de memoria efetivo (files ou orkmind)
ork recall <thread> --fase <FASE>  # resolve os ponteiros do handoff DESTE momento
```

## O que o nucleo garante

- **Append-only.** O `ledger.jsonl` so cresce. Correcao entra como evento novo, nunca como linha
  reescrita: historico editado deixa de ser historico.
- **O prompt e artefato, nao lembranca.** Cada sessao grava o prompt exato com `sha256` no nome, e
  o mesmo hash vai ao ledger. Isso e o que permite provar o que foi pedido.
- **A base e carimbada na criacao.** `thread.json` guarda a branch e o commit de onde a thread
  partiu; e contra esse carimbo que `ork worktree audit` detecta que a base andou.
- **O estado real vence o estado gravado.** `ork thread status` cruza as sessoes gravadas com o
  runtime; sessao que o `thread.json` diz viva e o runtime nao conhece aparece como divergencia.
- **A memoria e opcional e declarada.** O handoff carrega o regime (`files` ou `orkmind`) e os
  ponteiros dizem QUANDO devem ser resolvidos. Com OrkMind fora do ar, o mesmo ponteiro resolve
  por `path#ancora`, e nenhum ciclo para por causa disso.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "A conversa ainda tem todo o contexto, nao preciso ler o disco" | Conversa termina e janela rotaciona. Trabalho nao registrado e trabalho nao retomavel e nao auditavel. |
| "E mais rapido editar o thread.json na mao" | Editar estado na mao corrompe estado. Todo campo tem um comando que o escreve, e o comando tambem registra no ledger. |
| "Vou consertar o ledger que ficou errado" | O ledger e append-only. Correcao e evento novo. Historico editado nao e mais historico, e narrativa. |
| "Vou carregar o handoff inteiro na sessao nova" | O handoff separa inline de ponteiro de proposito. `ork recall <thread> --fase <FASE>` traz so o que e daquele momento; o resto continua endereçado, nao perdido. |
| "Duas threads no mesmo arquivo, mas elas nao se cruzam" | Quem decide isso e o lease, nao a intuicao. `ork lease list` mostra colisao de regiao e a fila. |

## Bandeiras vermelhas

- Diretorio de thread sem `thread.json` ou sem `ledger.jsonl`.
- Prompt despachado sem arquivo correspondente em `prompts/` com o sha no nome.
- Sessao gravada como viva que o runtime nao reconhece.
- Lease vencido com a thread ainda escrevendo na regiao.
- Manifesto pedindo `memory.mode: orkmind` com `ork memory status` reportando regime efetivo
  `files`: a memoria semantica nao esta valendo, e o motivo tipado diz por que.

## Verificacao antes de sair da skill

Thread identificada pelo id, estado lido por comando e nao por memoria, fase atual conhecida, e
qualquer divergencia entre disco e runtime dita em voz alta. Ver `DoD 4`.
