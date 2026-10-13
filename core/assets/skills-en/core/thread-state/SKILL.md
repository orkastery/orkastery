---
name: thread-state
description: "The thread's state on disk: thread.json, ledger.jsonl, claims.jsonl, hashed prompts and leases. Routes to ork thread status, ork phase list and ork board; no state is read from conversation memory."
bucket: core
roteia: "ork thread status | ork phase list | ork board"
license: MIT
---

# Thread State

## What this skill is

A thin router over the state that `ork` keeps on disk. It does not invent formats, does not edit
state files by hand and does not hold rules: it says which command reads the truth and calls that
command. **Editing `thread.json` with a text editor is corrupting state, not moving work forward.**

## When to use

- When resuming a thread that another session opened.
- Before any phase, to know where the thread stands in the cycle.
- When two threads seem to be fighting over the same file or the same tree.

## Where the state lives

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

## How to route

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

## What the core guarantees

- **Append-only.** The `ledger.jsonl` only grows. A correction goes in as a new event, never as a rewritten
  line: edited history stops being history.
- **The prompt is an artifact, not a recollection.** Each session writes the exact prompt with `sha256` in the name, and
  the same hash goes to the ledger. That is what makes it possible to prove what was requested.
- **The base is stamped at creation.** `thread.json` keeps the branch and the commit the thread
  started from; it is against that stamp that `ork worktree audit` detects that the base has moved.
- **The real state beats the recorded state.** `ork thread status` cross-checks the recorded sessions against the
  runtime; a session that `thread.json` says is alive and the runtime does not know shows up as a divergence.
- **Memory is optional and declared.** The handoff carries the regime (`files` or `orkmind`) and the
  pointers say WHEN they must be resolved. With OrkMind down, the same pointer resolves
  through `path#ancora`, and no cycle stops because of it.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "The conversation still has all the context, I don't need to read the disk" | Conversations end and context windows rotate. Unrecorded work is work that cannot be resumed or audited. |
| "It's faster to edit thread.json by hand" | Editing state by hand corrupts state. Every field has a command that writes it, and the command also records it in the ledger. |
| "I'll fix the part of the ledger that went wrong" | The ledger is append-only. A correction is a new event. Edited history is no longer history, it is narrative. |
| "I'll load the whole handoff into the new session" | The handoff separates inline from pointer on purpose. `ork recall <thread> --fase <FASE>` brings only what belongs to that moment; the rest stays addressed, not lost. |
| "Two threads on the same file, but they don't intersect" | The lease decides that, not intuition. `ork lease list` shows region collisions and the queue. |

## Bandeiras vermelhas (Red flags)

- A thread directory without `thread.json` or without `ledger.jsonl`.
- A dispatched prompt with no matching file in `prompts/` with the sha in its name.
- A session recorded as alive that the runtime does not recognize.
- An expired lease with the thread still writing in the region.
- A manifest asking for `memory.mode: orkmind` with `ork memory status` reporting the effective regime
  `files`: semantic memory is not in effect, and the typed reason says why.

## Verification before leaving the skill

Thread identified by its id, state read by command and not from memory, current phase known, and
any divergence between disk and runtime said out loud. See `DoD 4`.
