---
name: thread-tracing
description: "Thread trace: reads the ledger, the sessions, the claims and the MASTER log to reconstruct what happened, who decided and with what evidence. Read-only, never writes to the state."
bucket: observability
roteia: "ork phase list | ork thread status | ork sessions | ork board"
license: MIT
---

# Thread Tracing

## What this skill is

A thin router for reading. It reconstructs the history of a thread from what is recorded,
and **never writes to the state**: observability that alters what it observes stops being
observability.

## How to route

```bash
ork phase list <thread>       # o ledger inteiro, evento a evento
ork thread status <thread>    # o estado gravado cruzado com o runtime real
ork sessions --all            # as sessoes vivas do runtime
ork claims list <thread>      # as alegacoes e o estado de cada uma
ork board                     # todas as threads, uma visao
ork master                   # as entregas, com o indice derivado do ledger
```

## What the trace must answer

1. **What was requested**, with the exact prompt: each session wrote the prompt with `sha256` in the name.
2. **Who decided**, at each gate: a human by name, or an autonomous decision with the #TAG that authorized it.
3. **With what evidence**, always: command, output, sha. An event without evidence is an annotation, not a trace.
4. **What failed and why**, with the typed reason: `claims.failed`, `verify.regression`,
   `policy.violation`, `lease.busy`, `tree.blocked`, `human.pending`.
5. **Where the time and the window went**, with the source of the measurement declared: `runtime_reported`,
   `estimated`, `informada` or `unavailable`.

## Measurement honesty

What the runtime does not expose comes out as `unavailable`, with the reason. **A gap is published as a gap, never
as zero.** A trace that fills a hole with a silent estimate is worse than a trace with a
declared hole, because nobody mistakes the latter for data.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "I'll write one more event to make the trace complete" | Observability does not write to the state. An event invented afterwards is not a trace, it is reconstruction. |
| "The tokens spent must have been around X" | Without a runtime measurement, it comes out as `unavailable`. An estimate presented as a reading is the start of every fake dashboard. |
| "I'll put zero where there is no data" | Zero is a data point. A gap is published as a gap. |
| "I'll reorder the ledger so it is readable" | The ledger is append-only and the order is evidence. Readability is the presentation's job, not the file's. |

## Bandeiras vermelhas (Red flags)

- An event in the ledger without evidence.
- A gate without who decided.
- A metric with a round number and no source.
- A session recorded as alive that the runtime does not recognize.

## Verification before delivering the trace

Request, decider, evidence, typed reason and source of each number, with every gap declared as a
gap and no write made to the state. See `PERF 9`, `PERF 10` and `DoD 5`.
